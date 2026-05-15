import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:launch_at_startup/launch_at_startup.dart';
import 'package:package_info_plus/package_info_plus.dart';

/// Thin wrapper around the cross-platform `launch_at_startup` package.
///
/// The worker is only useful if it's running — a user who has to remember
/// to launch the app every morning won't bother. This service registers
/// the app with macOS Login Items / Windows Startup so it comes back
/// online automatically after a reboot.
///
/// The setup call is idempotent and cheap; the dashboard toggle just
/// flips between `enable()` and `disable()`.
class AutoStartService {
  AutoStartService._();

  static bool _setupComplete = false;

  /// Register the app with the launch-at-login system. Safe to call
  /// repeatedly. Call once at boot — before any `enable/disable/isEnabled`
  /// usage — so the package has the executable path it needs.
  static Future<void> setup() async {
    if (_setupComplete) return;
    try {
      final pkg = await PackageInfo.fromPlatform();
      launchAtStartup.setup(
        appName: pkg.appName,
        appPath: Platform.resolvedExecutable,
        // packageName is required for the Windows .lnk shortcut, where
        // duplicate names can collide with other vendors' apps.
        packageName: pkg.packageName,
      );
      _setupComplete = true;
    } catch (e, st) {
      // Failure here is non-fatal — auto-start is a convenience, not
      // load-bearing for the worker's actual work.
      debugPrint('AutoStartService.setup failed (non-fatal): $e\n$st');
    }
  }

  static Future<bool> isEnabled() async {
    await setup();
    try {
      return await launchAtStartup.isEnabled();
    } catch (e) {
      debugPrint('AutoStartService.isEnabled failed: $e');
      return false;
    }
  }

  static Future<void> enable() async {
    await setup();
    try {
      await launchAtStartup.enable();
    } catch (e) {
      debugPrint('AutoStartService.enable failed: $e');
      rethrow;
    }
  }

  static Future<void> disable() async {
    await setup();
    try {
      await launchAtStartup.disable();
    } catch (e) {
      debugPrint('AutoStartService.disable failed: $e');
      rethrow;
    }
  }
}
