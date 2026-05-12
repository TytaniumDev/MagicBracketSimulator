import 'package:flutter/foundation.dart';
import 'package:tray_manager/tray_manager.dart';
import 'package:window_manager/window_manager.dart';

import '../worker/worker_engine.dart';

/// Sets up the menu-bar tray icon and click-to-open-window behavior.
///
/// With `LSUIElement=true` in Info.plist the app has no Dock icon and no
/// visible window unless explicitly shown. The tray icon is the only
/// affordance; left-clicking it shows the dashboard window.
///
/// Right-click menu has: Show, Start/Stop worker, Quit.
class TraySetup with TrayListener {
  TraySetup({required this.engine});

  final WorkerEngine engine;

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

    await trayManager.setContextMenu(Menu(items: [
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
    ]));
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
  }

  Future<void> _showDashboard() async {
    await windowManager.show();
    await windowManager.focus();
  }
}
