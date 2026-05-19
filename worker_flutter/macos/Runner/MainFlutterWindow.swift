import Cocoa
import FlutterMacOS
import LaunchAtLogin

class MainFlutterWindow: NSWindow {
  /// Retained reference so the "Check for Updates…" menu item action
  /// can route through it. The auto_updater plugin owns Sparkle's
  /// SPUStandardUpdaterController internally and only exposes a Dart
  /// API, so the menu item round-trips Swift → Dart → autoUpdater.
  private var autoUpdaterChannel: FlutterMethodChannel?

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

    // "Check for Updates…" menu item.
    //
    // Sparkle 2 doesn't install a menu item for you — host apps wire
    // one up themselves and bind it to SPUStandardUpdaterController's
    // `checkForUpdates:` IBAction. The auto_updater Flutter plugin
    // owns its updater controller privately, so we can't bind a menu
    // item directly to it. Instead we route the click back through a
    // FlutterMethodChannel and let the Dart side call
    // `autoUpdater.checkForUpdates(inBackground: false)`, which
    // eventually reaches the same controller. One extra hop, no extra
    // cost the user can feel.
    autoUpdaterChannel = FlutterMethodChannel(
      name: "magic_bracket/auto_updater",
      binaryMessenger: flutterViewController.engine.binaryMessenger
    )
    installCheckForUpdatesMenuItem()

    RegisterGeneratedPlugins(registry: flutterViewController)

    super.awakeFromNib()
  }

  /// Insert "Check for Updates…" into the app menu, right after
  /// "About <AppName>". The app menu (`MagicBracketWorker`) is always
  /// the first entry in `NSApp.mainMenu` — the system-rendered Apple
  /// menu isn't part of the app's NSMenu structure.
  private func installCheckForUpdatesMenuItem() {
    guard let mainMenu = NSApp.mainMenu,
          let appMenu = mainMenu.items.first?.submenu else {
      // Defensive: if the standard MainMenu.xib didn't load (e.g.
      // somebody rewrites it later), don't crash — just skip and let
      // the dashboard's in-app update button be the only affordance.
      return
    }
    let item = NSMenuItem(
      title: "Check for Updates…",
      action: #selector(handleCheckForUpdates(_:)),
      keyEquivalent: ""
    )
    item.target = self
    // Index 0 is "About <AppName>" in the Flutter-generated XIB. Slot
    // the new item + a separator immediately after it so the layout
    // matches the macOS HIG convention (About / Check for Updates /
    // separator / Settings / Services / …). `min(numberOfItems, …)`
    // is defensive against a future MainMenu.xib rewrite that ships
    // with an empty app menu — `insertItem(at:)` would crash on an
    // out-of-range index, but clamping keeps it valid even then.
    let itemIndex = min(appMenu.numberOfItems, 1)
    appMenu.insertItem(item, at: itemIndex)
    appMenu.insertItem(NSMenuItem.separator(), at: min(appMenu.numberOfItems, itemIndex + 1))
  }

  @objc private func handleCheckForUpdates(_ sender: Any?) {
    // inBackground: false on the Dart side — this is an interactive
    // user-initiated check, so Sparkle should surface a "You're up to
    // date" dialog when there's no new version, instead of staying
    // silent the way the scheduled hourly poll does.
    autoUpdaterChannel?.invokeMethod("checkForUpdates", arguments: nil)
  }
}
