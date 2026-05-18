import 'dart:io';

import 'package:flutter/services.dart';

/// Hybrid Dock / menu-bar bridge for macOS.
///
/// The worker launches as a normal Mac app (Dock icon + menu bar via
/// the standard MainMenu.xib) and folds into a menu-bar-only
/// "Accessory" app once the user closes the dashboard window. The
/// engine keeps running through the transition — `NSApp.activationPolicy`
/// only governs UI affordances (Dock icon, menu bar, Cmd-Tab), not
/// lifecycle. See `MainFlutterWindow.swift` for the native handler.
///
/// On non-macOS platforms every method is a no-op so callers don't
/// need to gate on `Platform.isMacOS` at every callsite.
enum MacActivationPolicy {
  /// Standard Mac app: Dock icon, menu bar, Cmd-Tab entry.
  regular('regular'),

  /// Menu-bar-only: no Dock icon, no Cmd-Tab, no menu bar — only the
  /// tray icon installed by `tray_manager` remains visible.
  accessory('accessory');

  const MacActivationPolicy(this.wireName);

  /// String form sent across the method channel. Keep in sync with the
  /// switch in `MainFlutterWindow.swift`.
  final String wireName;
}

class MacActivationPolicyBridge {
  MacActivationPolicyBridge._();

  /// Channel name matches the native handler in MainFlutterWindow.swift.
  static const MethodChannel _channel = MethodChannel(
    'magic_bracket/activation_policy',
  );

  /// Promote the app to a regular Mac app (Dock + menu bar) and bring
  /// it to the foreground. Idempotent; calling while already `.regular`
  /// just re-activates the app.
  ///
  /// No-op on Windows/Linux.
  static Future<void> setRegular() => _set(MacActivationPolicy.regular);

  /// Demote to a menu-bar-only accessory app — drops the Dock icon
  /// and menu bar. Idempotent.
  ///
  /// No-op on Windows/Linux.
  static Future<void> setAccessory() => _set(MacActivationPolicy.accessory);

  static Future<void> _set(MacActivationPolicy policy) async {
    if (!Platform.isMacOS) return;
    await _channel.invokeMethod<void>('set', {'policy': policy.wireName});
  }
}
