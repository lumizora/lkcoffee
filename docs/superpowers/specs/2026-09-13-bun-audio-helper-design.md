# Bun 与 AudioHelper 迁移设计

## 目标

将 Voice Coffee 的运行时迁移至 Bun + TypeScript，并以独立的 macOS Swift `AudioHelper` 替代 FFmpeg `avfoundation` 收音。应用层只经 `AudioManager` 获取标准 PCM 帧。

本次交付范围是 macOS 第一阶段：权限、输入设备列表、默认或指定设备、启动、停止、关闭，以及标准化 PCM 实时输出。Windows、热插拔、自动恢复、Unix socket/Named Pipe 和二进制帧头留作后续阶段。

## 数据与控制边界

`AudioHelper` 是独立进程，崩溃不会直接终止 Bun 主进程。

```text
Bun TypeScript → AudioManager → Bun.spawn(AudioHelper)
                                      ├ stdin: JSONL commands
                                      ├ stdout: raw PCM only
                                      └ stderr: JSONL ready / response / event only
```

音频固定为 PCM S16LE、16 kHz、单声道、20 ms。每帧 640 bytes。Bun 的公共帧数据类型为 `Uint8Array`；管道 chunk 不等于帧，`PCMFrameParser` 负责缓存和切分。

## Bun 模块

```text
src/audio/
  AudioManager.ts             public API and state
  AudioProtocol.ts            JSONL command/response/event definitions
  PCMFrameParser.ts           arbitrary chunks → 640-byte frames
  BunAudioHelperProcess.ts    Bun.spawn lifecycle and request correlation
```

`AudioManager` 提供 `initialize`、`getDevices`、`getDefaultDevice`、`selectDevice`、`getPermissionStatus`、`requestPermission`、`start`、`stop`、`shutdown` 与 `onAudio`。本版本以显式 API 返回错误，不实现自动重启；Helper 意外退出会触发 `HELPER_CRASHED` 事件并结束音频流。

每条命令带 UUID，由 `BunAudioHelperProcess` 保存在等待表中；默认超时为 5 秒。`start` 和 `stop` 是幂等的。Helper 的 `ready` 事件必须声明 `protocolVersion: 1`，版本不匹配时初始化失败。

## macOS AudioHelper

新增 Swift 可执行文件，使用 `AVAudioEngine`：

1. 从标准输入解析 JSONL 命令。
2. 通过 AVFoundation 查询/请求麦克风权限，并列出输入设备。
3. 使用默认或选定设备创建输入节点 tap。
4. 用 `AVAudioConverter` 将原始音频转换为 16 kHz、mono、Int16。
5. 累积后严格按 640 bytes 写入标准输出。
6. 将 ready、response、error、capture 状态以 JSONL 写入标准错误；不得向标准输出写入日志或控制数据。

第一阶段命令为 `hello`、`get_permission`、`request_permission`、`get_devices`、`get_default_device`、`select_device`、`start`、`stop`、`shutdown`。`default` 是允许的设备 ID。设备 ID 对 Bun 是不透明字符串。

## 应用接入

`src/index.ts` 创建 `AudioManager`，向 ASR session 写入 `onAudio(frame.data)` 的音频。原有 `StreamRecorder` 和 `AUDIO_DEVICE` 数字编号删除；按键、ASR、咖啡 MCP、TTS 和定位行为保持不变。开始录音仍会中止 TTS；退出时先关闭 AudioManager。

## 运行与构建

- 使用 Bun 执行 TypeScript，`bun run start` 和 `bun test` 取代 npm/node。
- `scripts/build-audio-helper.sh` 用 `swiftc` 编译 helper 至 `native/AudioHelper.app/Contents/MacOS/AudioHelper`，写入 `NSMicrophoneUsageDescription` 并进行临时签名。
- 保留现有定位 helper 构建，并由统一的 `prestart` 依次构建两个 native helper。

## 验证

使用 Bun 测试覆盖：PCM 分帧（拆分与合并 chunk）、命令请求/响应与协议版本校验、Helper 退出错误、AudioManager 将 640-byte `Uint8Array` 交给监听者，以及现有 ASR/TTS/咖啡逻辑回归。实际 macOS 验证：启动后授权麦克风，选择默认设备并完成一次语音转写。

## 明确不做

本次不实现 Windows C++/WASAPI、热插拔、设备自动切换、Helper 自动重启、Unix socket/Named Pipe、时间戳/序号帧头、持久化录音或 VAD。这些都不改变本版本的 `AudioManager` 公共边界。
