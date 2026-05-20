import 'package:flutter/foundation.dart';
import 'package:tray_manager/tray_manager.dart';
import 'package:window_manager/window_manager.dart';

import '../macos/activation_policy.dart';
import '../worker/worker_engine.dart';

/// Sets up the menu-bar tray icon and click-to-open-window behavior.
///
/// The tray icon is the user's way back to the dashboard after they
/// close the window: closing demotes the app to `.accessory` (no Dock
/// icon, no menu bar) while keeping the engine alive. A tray click —
/// or the "Show dashboard" menu item — promotes back to `.regular` and
/// re-shows the window. See `lib/macos/activation_policy.dart`.
///
/// Right-click menu has: Show, Start/Stop worker, Quit.
class TraySetup with TrayListener {
  TraySetup({required this.engine});

  final WorkerEngine engine;

  /// Guard against double-firing the show-window flow on rapid tray
  /// clicks. `setRegular` + `show` + `focus` are individually
  /// idempotent, but interleaving two calls can produce a visible
  /// Dock-icon flicker as the second call races the first.
  bool _showingDashboard = false;

  Future<void> init() async {
    trayManager.addListener(this);
    try {
      await trayManager.setIcon('assets/tray_icon.png');
    } catch (e) {
      if (kDebugMode) {
        // Asset may be missing on first run; system tray still works without
        // a custom icon (uses a default placeholder on some platforms).
        debugPrint('tray icon set failed: $e');
      }
    }
    await trayManager.setToolTip('Magic Bracket Worker');
    await _rebuildMenu();
    engine.stateStream.listen((_) => _rebuildMenu());
  }

  Future<void> _rebuildMenu() async {
    final running = engine.currentState.running;
    final active = engine.currentState.activeSims.length;
    final completed = engine.currentState.completedCount;

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
    await trayManager.destroy();
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
          if (engine.currentState.running) {
            await engine.stop();
          } else {
            await engine.start();
          }
          break;
        case 'quit':
          await engine.stop();
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
      // Order matters: promote to `.regular` first so the Dock icon
      // and menu bar are already in place when the window animates
      // in, otherwise the user sees a brief flicker where the window
      // is up but the Dock icon is still missing. The native bridge
      // is a no-op on non-macOS and also calls `NSApp.activate` for
      // us on macOS — we still call focus() afterwards as a safety
      // net for any edge case where activate raced the show.
      await MacActivationPolicyBridge.setRegular();
      await windowManager.show();
      await windowManager.focus();
    } finally {
      _showingDashboard = false;
    }
  }
}
