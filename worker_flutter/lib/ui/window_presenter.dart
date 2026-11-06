import 'package:window_manager/window_manager.dart';

import '../macos/activation_policy.dart';

/// Shows the dashboard window or folds the worker into the tray, the
/// same way from every caller (boot, tray click, window close, sign-in).
///
/// - macOS: the window plus the Dock icon and menu bar. Hidden, the app
///   is a menu-bar-only accessory app (`MacActivationPolicyBridge`).
/// - Windows: just the window; the tray icon stays either way.
///
/// The worker engine keeps running in both states.
class WindowPresenter {
  WindowPresenter._();

  /// Bring the dashboard window to the front.
  static Future<void> show() async {
    // Promote to `.regular` first so the Dock icon and menu bar are in
    // place when the window animates in; otherwise there's a flicker
    // where the window is up but the Dock icon is still missing.
    await MacActivationPolicyBridge.setRegular();
    await windowManager.show();
    await windowManager.focus();
  }

  /// Hide the window and leave only the tray icon.
  static Future<void> hideToTray() async {
    // Hide first, then demote, so the window, Dock icon and menu bar
    // disappear in a single visual beat.
    await windowManager.hide();
    await MacActivationPolicyBridge.setAccessory();
  }
}
