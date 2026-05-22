import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:tray_manager/tray_manager.dart';
import 'package:window_manager/window_manager.dart';

import '../macos/activation_policy.dart';
import '../telemetry.dart';
import '../worker/worker_engine.dart';

/// Sets up the system-tray icon and click-to-open-window behavior.
///
/// The tray icon is the user's way back to the dashboard after they
/// close the window. Closing hides the window while the worker engine
/// keeps running:
///   - macOS: demotes the app to `.accessory` (no Dock icon, no menu
///     bar). A tray click promotes back to `.regular`.
///   - Windows: hides the window; the tray icon is the only remaining
///     affordance. A tray click re-shows the window.
///
/// Right-click menu has: Show, Start/Stop worker, Quit.
class TraySetup with TrayListener, WindowListener {
  TraySetup({this.engine});

  WorkerEngine? engine;

  /// Guard against double-firing the show-window flow on rapid tray
  /// clicks. `setRegular` + `show` + `focus` are individually
  /// idempotent, but interleaving two calls can produce a visible
  /// Dock-icon flicker as the second call races the first.
  bool _showingDashboard = false;

  void _log(String msg) {
    if (kDebugMode) {
      debugPrint('${DateTime.now().toIso8601String()} [TraySetup] $msg');
    }
    Telemetry.breadcrumb(TelemetryCategory.tray, msg);
  }

  Future<void> init() async {
    trayManager.addListener(this);
    windowManager.addListener(this);
    try {
      // Windows requires .ico; macOS/Linux use .png.
      final iconPath = Platform.isWindows
          ? 'assets/tray_icon.ico'
          : 'assets/tray_icon.png';
      await trayManager.setIcon(iconPath);
    } catch (e) {
      if (kDebugMode) {
        // Asset may be missing on first run; system tray still works without
        // a custom icon (uses a default placeholder on some platforms).
        debugPrint('tray icon set failed: $e');
      }
    }
    await trayManager.setToolTip('Magic Bracket Worker');
    await updateMenu();
  }

  Future<void> updateMenu() async {
    final eng = engine;
    if (eng == null) {
      await trayManager.setContextMenu(
        Menu(
          items: [
            MenuItem(key: 'show', label: 'Show dashboard'),
            MenuItem.separator(),
            MenuItem(key: 'quit', label: 'Quit Magic Bracket Worker'),
          ],
        ),
      );
      return;
    }

    final running = eng.currentState.running;
    final active = eng.currentState.activeSims.length;
    final completed = eng.currentState.completedCount;

    await trayManager.setContextMenu(
      Menu(
        items: [
          MenuItem(
            key: 'status',
            label: running
                ? (active == 0
                      ? 'Idle • $completed done'
                      : 'Running $active sim(s)')
                : 'Stopped',
            disabled: true,
          ),
          MenuItem.separator(),
          MenuItem(key: 'show', label: 'Show dashboard'),
          MenuItem(
            key: 'toggle',
            label: running ? 'Stop worker' : 'Start worker',
          ),
          MenuItem.separator(),
          MenuItem(key: 'quit', label: 'Quit Magic Bracket Worker'),
        ],
      ),
    );
  }

  Future<void> dispose() async {
    trayManager.removeListener(this);
    windowManager.removeListener(this);
    await trayManager.destroy();
  }

  // ── WindowListener ───────────────────────────────────────────

  @override
  void onWindowClose() async {
    // Both macOS and Windows get the hide-to-tray treatment (see
    // _appMain's setPreventClose). Pressing X hides the window while
    // the worker engine keeps running. The tray icon is the user's
    // way back; right-click → Quit is the only way to fully exit.
    //
    // The listener has a `void` return type, so a throw here would
    // be silently dropped by the framework. Wrap the whole body in
    // try/catch so a bridge failure (PlatformException) is at least
    // visible in the log file.
    try {
      if (Platform.isMacOS) {
        _log('onWindowClose: hiding window, demoting to accessory');
        // Hide the window first, then demote to `.accessory` so the
        // Dock icon and menu bar disappear in a single visual beat.
        // Tray icon stays around as the way back. Engine keeps running
        // — the activation policy only affects UI affordances.
        await windowManager.hide();
        await MacActivationPolicyBridge.setAccessory();
      } else if (Platform.isWindows) {
        _log('onWindowClose: hiding window to tray (Windows)');
        // On Windows there's no activation-policy equivalent; just
        // hide the window. The tray icon remains as the sole
        // affordance. The taskbar entry disappears when hidden.
        await windowManager.hide();
      } else {
        _log('onWindowClose: destroying window (Linux quit-on-close)');
        await windowManager.destroy();
      }
    } catch (e, st) {
      _log('onWindowClose: transition failed: $e\n$st');
    }
  }

  // ── TrayListener ─────────────────────────────────────────────

  @override
  void onTrayIconMouseDown() {
    _showDashboard();
  }

  @override
  void onTrayIconRightMouseDown() {
    trayManager.popUpContextMenu();
  }

  @override
  void onTrayMenuItemClick(MenuItem menuItem) async {
    // tray_manager's listener has a `void` return type, so a throw
    // from any of the awaited calls would be silently dropped. Wrap
    // the body so engine.stop/start or a bridge transition failure at
    // least surfaces in the log file.
    try {
      switch (menuItem.key) {
        case 'show':
          await _showDashboard();
          break;
        case 'toggle':
          final eng = engine;
          if (eng != null) {
            if (eng.currentState.running) {
              await eng.stop();
            } else {
              await eng.start();
            }
          }
          break;
        case 'quit':
          final eng = engine;
          if (eng != null) {
            await eng.stop();
          }
          await dispose();
          await windowManager.destroy();
          break;
      }
    } catch (e, st) {
      if (kDebugMode) {
        debugPrint('tray menu "${menuItem.key}" failed: $e\n$st');
      }
    }
  }

  Future<void> _showDashboard() async {
    if (_showingDashboard) return;
    _showingDashboard = true;
    try {
      // macOS: promote to `.regular` first so the Dock icon and menu
      // bar are already in place when the window animates in,
      // otherwise the user sees a brief flicker where the window is
      // up but the Dock icon is still missing.
      // Windows: no activation-policy equivalent; just show + focus.
      if (Platform.isMacOS) {
        await MacActivationPolicyBridge.setRegular();
      }
      await windowManager.show();
      await windowManager.focus();
    } finally {
      _showingDashboard = false;
    }
  }
}
