import AppKit
import CoreLocation
import Foundation

final class Locator: NSObject, CLLocationManagerDelegate {
  private let manager = CLLocationManager()

  func start() {
    if !CLLocationManager.locationServicesEnabled() {
      finish(error: "定位服务未开启")
      return
    }
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    NSApplication.shared.setActivationPolicy(.accessory)
    NSApplication.shared.activate(ignoringOtherApps: true)
    requestLocation()
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    requestLocation()
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let location = locations.last else { return finish(error: "未收到位置") }
    print("{\"latitude\":\(location.coordinate.latitude),\"longitude\":\(location.coordinate.longitude)}")
    exit(0)
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    finish(error: "定位失败")
  }

  private func requestLocation() {
    switch manager.authorizationStatus {
    case .notDetermined: manager.requestWhenInUseAuthorization()
    case .authorizedAlways, .authorizedWhenInUse: manager.requestLocation()
    default: finish(error: "未获定位权限")
    }
  }

  private func finish(error: String) {
    FileHandle.standardError.write(Data(error.utf8))
    exit(1)
  }
}

let locator = Locator()
locator.start()
RunLoop.main.run()
