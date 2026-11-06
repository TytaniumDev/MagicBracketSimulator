import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Flag the Windows launch-at-login entry passes to the worker, so a
/// login launch can be told apart from the user opening the app.
/// Registered by `AutoStartService`.
const launchedAtLoginArg = '--launched-at-login';

/// Who started this worker process.
enum LaunchOrigin {
  /// The user opened the app (Start menu, Finder, Dock, installer,
  /// update restart). The dashboard window opens as usual.
  user,

  /// The OS started the app because "Launch at login" is on. The
  /// worker starts hidden in the tray and only shows its window when
  /// the user has to do something (sign in, pick a mode, install).
  login;

  bool get startsHidden => this == LaunchOrigin.login;
}

/// Reads the launch origin from the process arguments (Windows).
LaunchOrigin launchOriginFromArgs(List<String> args) =>
    args.contains(launchedAtLoginArg) ? LaunchOrigin.login : LaunchOrigin.user;

/// Works out how this process was started.
///
/// - Windows: the login entry passes [launchedAtLoginArg].
/// - macOS: login items get no arguments, so the native side checks the
///   "launched as login item" flag on the launch Apple event
///   (`LaunchOriginBridge` in `MainFlutterWindow.swift`).
/// - Anything else counts as a user launch.
class LaunchOriginDetector {
  LaunchOriginDetector._();

  /// Channel name matches `LaunchOriginBridge` in MainFlutterWindow.swift.
  @visibleForTesting
  static const channel = MethodChannel('magic_bracket/launch_origin');

  /// The native side answers once macOS has finished launching the app,
  /// which is well before Dart asks. The timeout keeps a missing answer
  /// from blocking boot; the caller treats the error as a user launch.
  static const _macTimeout = Duration(seconds: 3);

  /// Throws when the macOS bridge fails or times out, so the caller can
  /// report it and fall back to showing the window.
  static Future<LaunchOrigin> detect(List<String> args) async {
    switch (defaultTargetPlatform) {
      case TargetPlatform.windows:
        return launchOriginFromArgs(args);
      case TargetPlatform.macOS:
        final atLogin = await channel
            .invokeMethod<bool>('launchedAtLogin')
            .timeout(_macTimeout);
        return atLogin == true ? LaunchOrigin.login : LaunchOrigin.user;
      default:
        return LaunchOrigin.user;
    }
  }
}
