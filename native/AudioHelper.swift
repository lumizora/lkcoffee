import AVFoundation
import AudioToolbox
import CoreAudio
import Foundation

let frameBytes = 640

struct Command: Decodable {
  let id: String
  let type: String
  let payload: [String: String]?
}

final class AudioHelper {
  private var engine = AVAudioEngine()
  private let conversionQueue = DispatchQueue(label: "com.alwaysmissly.voice-coffee.audio-conversion")
  private var converter: AVAudioConverter?
  private var targetFormat: AVAudioFormat?
  private var pendingPCM = Data()
  private var selectedDeviceID = "default"
  private var capturing = false
  private var tapInstalled = false

  init() {
    event(["type": "ready", "protocolVersion": 1, "helperVersion": "0.1.0", "platform": "darwin"])
  }

  func handle(_ command: Command) {
    switch command.type {
    case "hello":
      response(command.id, payload: ["protocolVersion": 1, "capabilities": ["capture", "device-list", "permission"]])
    case "get_permission":
      response(command.id, payload: permissionStatus())
    case "request_permission":
      requestPermission { status in self.response(command.id, payload: status) }
    case "get_devices":
      response(command.id, payload: inputDevices())
    case "get_default_device":
      response(command.id, payload: defaultDevice())
    case "select_device":
      guard let id = command.payload?["deviceId"] else {
        response(command.id, error: "DEVICE_NOT_FOUND", message: "缺少输入设备 ID")
        return
      }
      guard id == "default" || inputDevices().contains(where: { ($0["id"] as? String) == id }) else {
        response(command.id, error: "DEVICE_NOT_FOUND", message: "未找到输入设备")
        return
      }
      selectedDeviceID = id
      response(command.id, payload: nil)
    case "start":
      do {
        try startCapture()
        response(command.id, payload: nil)
      } catch {
        response(command.id, error: "CAPTURE_START_FAILED", message: error.localizedDescription)
      }
    case "stop":
      stopCapture()
      response(command.id, payload: nil)
    case "shutdown":
      stopCapture()
      response(command.id, payload: nil)
      exit(0)
    default:
      response(command.id, error: "PROTOCOL_ERROR", message: "不支持的命令")
    }
  }

  private func startCapture() throws {
    if capturing { return }
    if permissionStatus() != "granted" {
      throw NSError(domain: "AudioHelper", code: 1, userInfo: [NSLocalizedDescriptionKey: "麦克风权限未授权"])
    }
    let input = engine.inputNode
    if selectedDeviceID != "default" {
      guard let rawID = UInt32(selectedDeviceID) else {
        throw NSError(domain: "AudioHelper", code: 2, userInfo: [NSLocalizedDescriptionKey: "无效输入设备"])
      }
      guard let audioUnit = input.audioUnit else {
        throw NSError(domain: "AudioHelper", code: 2, userInfo: [NSLocalizedDescriptionKey: "无法访问输入设备"])
      }
      var deviceID = AudioDeviceID(rawID)
      let status = AudioUnitSetProperty(
        audioUnit,
        kAudioOutputUnitProperty_CurrentDevice,
        kAudioUnitScope_Global,
        0,
        &deviceID,
        UInt32(MemoryLayout<AudioDeviceID>.size))
      guard status == noErr else {
        throw NSError(domain: "AudioHelper", code: Int(status), userInfo: [NSLocalizedDescriptionKey: "无法切换输入设备"])
      }
    }
    let sourceFormat = input.outputFormat(forBus: 0)
    guard sourceFormat.sampleRate > 0, sourceFormat.channelCount > 0,
      let outputFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16_000, channels: 1, interleaved: true),
      let newConverter = AVAudioConverter(from: sourceFormat, to: outputFormat)
    else {
      throw NSError(domain: "AudioHelper", code: 3, userInfo: [NSLocalizedDescriptionKey: "当前输入设备不可用"])
    }
    converter = newConverter
    targetFormat = outputFormat
    if tapInstalled {
      input.removeTap(onBus: 0)
      tapInstalled = false
    }
    input.installTap(onBus: 0, bufferSize: 1024, format: sourceFormat) { [weak self] buffer, _ in
      guard let copy = buffer.copy() as? AVAudioPCMBuffer else { return }
      self?.conversionQueue.async { self?.convertAndWrite(copy) }
    }
    tapInstalled = true
    do {
      engine.prepare()
      try engine.start()
    } catch {
      input.removeTap(onBus: 0)
      tapInstalled = false
      converter = nil
      targetFormat = nil
      engine = AVAudioEngine()
      throw error
    }
    capturing = true
    event(["type": "capture_started"])
  }

  private func stopCapture() {
    if !capturing { return }
    if tapInstalled {
      engine.inputNode.removeTap(onBus: 0)
      tapInstalled = false
    }
    engine.stop()
    engine.reset()
    engine = AVAudioEngine()
    converter = nil
    targetFormat = nil
    pendingPCM.removeAll(keepingCapacity: true)
    capturing = false
    event(["type": "capture_stopped"])
  }

  private func convertAndWrite(_ input: AVAudioPCMBuffer) {
    guard let converter, let targetFormat else { return }
    let capacity = AVAudioFrameCount(max(1, Int(Double(input.frameLength) * targetFormat.sampleRate / input.format.sampleRate) + 1))
    guard let output = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: capacity) else { return }
    var error: NSError?
    let status = converter.convert(to: output, error: &error) { _, inputStatus in
      inputStatus.pointee = .haveData
      return input
    }
    guard status != .error, error == nil, output.frameLength > 0,
      let samples = output.int16ChannelData else { return }
    let byteCount = Int(output.frameLength) * MemoryLayout<Int16>.size
    pendingPCM.append(Data(bytes: samples[0], count: byteCount))
    while pendingPCM.count >= frameBytes {
      FileHandle.standardOutput.write(pendingPCM.prefix(frameBytes))
      pendingPCM.removeFirst(frameBytes)
    }
  }

  private func permissionStatus() -> String {
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized: return "granted"
    case .notDetermined: return "not_determined"
    case .denied: return "denied"
    case .restricted: return "restricted"
    @unknown default: return "unknown"
    }
  }

  private func requestPermission(_ completion: @escaping (String) -> Void) {
    if permissionStatus() != "not_determined" {
      completion(permissionStatus())
      return
    }
    AVCaptureDevice.requestAccess(for: .audio) { _ in completion(self.permissionStatus()) }
  }

  private func inputDevices() -> [[String: Any]] {
    let defaultID = defaultInputDeviceID()
    return deviceIDs().filter(hasInput).map { id in
      ["id": String(id), "name": deviceName(id), "isDefault": id == defaultID]
    }
  }

  private func defaultDevice() -> [String: Any]? {
    guard let id = defaultInputDeviceID() else { return nil }
    return ["id": "default", "name": deviceName(id), "isDefault": true]
  }

  private func deviceIDs() -> [AudioDeviceID] {
    var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size) == noErr else { return [] }
    var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &ids) == noErr else { return [] }
    return ids
  }

  private func defaultInputDeviceID() -> AudioDeviceID? {
    var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultInputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var id: AudioDeviceID = 0
    var size = UInt32(MemoryLayout<AudioDeviceID>.size)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &id) == noErr else { return nil }
    return id
  }

  private func hasInput(_ id: AudioDeviceID) -> Bool {
    var address = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreamConfiguration, mScope: kAudioDevicePropertyScopeInput, mElement: kAudioObjectPropertyElementMain)
    var size: UInt32 = 0
    return AudioObjectGetPropertyDataSize(id, &address, 0, nil, &size) == noErr && size >= UInt32(MemoryLayout<AudioBufferList>.size)
  }

  private func deviceName(_ id: AudioDeviceID) -> String {
    var address = AudioObjectPropertyAddress(mSelector: kAudioObjectPropertyName, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var value: Unmanaged<CFString>?
    var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    guard AudioObjectGetPropertyData(id, &address, 0, nil, &size, &value) == noErr else { return String(id) }
    return (value?.takeUnretainedValue() as String?) ?? String(id)
  }

  private func response(_ id: String, payload: Any? = nil, error: String? = nil, message: String? = nil) {
    var record: [String: Any] = ["id": id, "type": "response", "success": error == nil]
    if let payload { record["payload"] = payload }
    if let error, let message {
      record["error"] = ["code": error, "message": message, "recoverable": error != "PROTOCOL_ERROR"]
    }
    event(record)
  }

  private func event(_ record: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: record) else { return }
    FileHandle.standardError.write(data)
    FileHandle.standardError.write(Data([10]))
  }
}

let helper = AudioHelper()
while let line = readLine() {
  guard let data = line.data(using: .utf8), let command = try? JSONDecoder().decode(Command.self, from: data) else { continue }
  helper.handle(command)
}
