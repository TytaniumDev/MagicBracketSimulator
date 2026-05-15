import Cocoa
import FlutterMacOS
import LaunchAtLogin

class MainFlutterWindow: NSWindow {
  override func awakeFromNib() {
    let flutterViewController = FlutterViewController()
    let windowFrame = self.frame
    self.contentViewController = flutterViewController
    self.setFrame(windowFrame, display: true)

    // launch_at_startup (the Dart package) is a thin wrapper that expects
    // the host app to register a MethodChannel handler backed by Apple's
    // ServiceManagement APIs. The pub package ships no native code on
    // macOS, so without this bridge every isEnabled/enable/disable call
    // throws MissingPluginException and the dashboard toggle silently
    // snaps back to its prior state.
    FlutterMethodChannel(
      name: "launch_at_startup",
      binaryMessenger: flutterViewController.engine.binaryMessenger
    ).setMethodCallHandler { (call, result) in
      switch call.method {
      case "launchAtStartupIsEnabled":
        result(LaunchAtLogin.isEnabled)
      case "launchAtStartupSetEnabled":
        guard let arguments = call.arguments as? [String: Any],
              let enabled = arguments["setEnabledValue"] as? Bool else {
          result(FlutterError(
            code: "BAD_ARGS",
            message: "launchAtStartupSetEnabled requires setEnabledValue: Bool",
            details: nil
          ))
          return
        }
        LaunchAtLogin.isEnabled = enabled
        result(nil)
      default:
        result(FlutterMethodNotImplemented)
      }
    }

    RegisterGeneratedPlugins(registry: flutterViewController)

    super.awakeFromNib()
  }
}
