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

    // Hybrid Dock/menu-bar mode: Dart toggles NSApp.activationPolicy at
    // runtime so the worker behaves like a normal Mac app while the
    // dashboard window is open (Dock icon + menu bar), then folds back
    // into a menu-bar-only "Accessory" app once the user closes the
    // window — the engine keeps running through the transition since
    // the policy only affects UI affordances. `LSUIElement` is left
    // unset (i.e. false) in Info.plist so cold launch starts as
    // `.regular`; the Dart side calls `setActivationPolicy("accessory")`
    // on window-close and `setActivationPolicy("regular")` before
    // re-showing from the tray icon.
    //
    // The transition from `.regular` to `.accessory` removes the Dock
    // icon and menu bar without affecting any of our long-lived
    // singletons (window_manager, tray_manager, Firestore listeners).
    FlutterMethodChannel(
      name: "magic_bracket/activation_policy",
      binaryMessenger: flutterViewController.engine.binaryMessenger
    ).setMethodCallHandler { (call, result) in
      switch call.method {
      case "set":
        guard let arguments = call.arguments as? [String: Any],
              let policy = arguments["policy"] as? String else {
          result(FlutterError(
            code: "BAD_ARGS",
            message: "set requires policy: String (regular|accessory)",
            details: nil
          ))
          return
        }
        let target: NSApplication.ActivationPolicy
        switch policy {
        case "regular":
          target = .regular
        case "accessory":
          target = .accessory
        default:
          result(FlutterError(
            code: "BAD_POLICY",
            message: "Unknown activation policy '\(policy)' — expected 'regular' or 'accessory'",
            details: nil
          ))
          return
        }
        // `setActivationPolicy` must run on the main thread; method channel
        // callbacks already arrive there, but be explicit for safety.
        DispatchQueue.main.async {
          NSApp.setActivationPolicy(target)
          // Going .accessory drops the Dock icon. Going .regular adds it
          // back but doesn't automatically promote the window to the
          // foreground — call activate so the app gets focus and the
          // menu bar reflects the new policy immediately. We always
          // activate here; the Dart caller decides when to invoke this,
          // so the activation is intentional.
          //
          // `activate(ignoringOtherApps:)` was deprecated in macOS 14
          // (Sonoma) in favor of the no-arg `activate()` which respects
          // the OS's cooperative activation rules. Fall back to the old
          // signature for 10.13–13.x deployment targets.
          if target == .regular {
            if #available(macOS 14.0, *) {
              NSApp.activate()
            } else {
              NSApp.activate(ignoringOtherApps: true)
            }
          }
          result(nil)
        }
      default:
        result(FlutterMethodNotImplemented)
      }
    }

    RegisterGeneratedPlugins(registry: flutterViewController)

    super.awakeFromNib()
  }
}
