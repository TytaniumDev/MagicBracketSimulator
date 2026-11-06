import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:launch_at_startup/launch_at_startup.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../telemetry.dart';
import 'launch_origin.dart';

/// The command the OS runs at login.
typedef LoginEntry = ({String appPath, List<String> args});

/// The login entry for this platform.
///
/// Windows writes `appPath args` into the registry Run key as one
/// string, so the path is quoted (the installer puts the app under
/// "%LOCALAPPDATA%\Magic Bracket Worker") and [launchedAtLoginArg]
/// marks the launch so the worker starts hidden. macOS login items take
/// no arguments; the app reads the login flag from the launch Apple
/// event instead (see `LaunchOriginDetector`).
@visibleForTesting
LoginEntry loginEntryFor({
  required TargetPlatform platform,
  required String executable,
}) {
  if (platform == TargetPlatform.windows) {
    return (appPath: '"$executable"', args: const [launchedAtLoginArg]);
  }
  return (appPath: executable, args: const []);
}

/// Thin wrapper around the cross-platform `launch_at_startup` package.
///
/// The worker is only useful if it's running — a user who has to remember
/// to launch the app every morning won't bother. This service registers
/// the app with macOS Login Items / the Windows registry Run key so it
/// comes back online automatically after a reboot.
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
      if (defaultTargetPlatform == TargetPlatform.windows) {
        await _upgradeWindowsEntry(pkg);
      }
      _setupWith(
        pkg,
        loginEntryFor(
          platform: defaultTargetPlatform,
          executable: Platform.resolvedExecutable,
        ),
      );
      _setupComplete = true;
    } catch (e, st) {
      // Failure here is non-fatal — auto-start is a convenience, not
      // load-bearing for the worker's actual work.
      debugPrint('AutoStartService.setup failed (non-fatal): $e\n$st');
      await Telemetry.captureError(
        e,
        st,
        category: TelemetryCategory.boot,
        extra: {'phase': 'auto_start_setup'},
      );
    }
  }

  /// Builds before this one registered the bare executable path on
  /// Windows, which starts the worker with its window open. Rewrite an
  /// enabled entry so it carries [launchedAtLoginArg]; the package only
  /// reports the new entry as enabled, so without this the dashboard
  /// toggle would also read "off".
  static Future<void> _upgradeWindowsEntry(PackageInfo pkg) async {
    final executable = Platform.resolvedExecutable;
    _setupWith(pkg, (appPath: executable, args: const []));
    if (!await launchAtStartup.isEnabled()) return;
    _setupWith(
      pkg,
      loginEntryFor(platform: TargetPlatform.windows, executable: executable),
    );
    await launchAtStartup.enable();
    debugPrint('AutoStartService: upgraded login entry to start hidden');
  }

  static void _setupWith(PackageInfo pkg, LoginEntry entry) {
    launchAtStartup.setup(
      appName: pkg.appName,
      appPath: entry.appPath,
      // packageName is required for MSIX installs, where duplicate
      // names can collide with other vendors' apps.
      packageName: pkg.packageName,
      args: entry.args,
    );
  }

  static Future<bool> isEnabled() async {
    await setup();
    try {
      return await launchAtStartup.isEnabled();
    } catch (e, st) {
      debugPrint('AutoStartService.isEnabled failed: $e');
      await Telemetry.captureError(
        e,
        st,
        category: TelemetryCategory.boot,
        extra: {'phase': 'auto_start_is_enabled'},
      );
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
