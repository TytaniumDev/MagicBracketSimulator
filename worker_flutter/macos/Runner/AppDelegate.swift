import Cocoa
import FlutterMacOS

@main
class AppDelegate: FlutterAppDelegate {
  // Hybrid Dock / menu-bar model: closing the dashboard window flips
  // the activation policy to `.accessory` so the Dock icon goes away,
  // but the engine + tray icon must keep running. Returning `false`
  // here keeps the app alive when the last window closes regardless of
  // whether window_manager's `setPreventClose` intercept fires (e.g.
  // AXPress on the close button bypasses `windowShouldClose:` and
  // closes the window directly — without this override the OS would
  // terminate the process on that path). The user explicitly quits via
  // Cmd-Q, the tray menu's Quit item, or Force Quit.
  override func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    return false
  }

  override func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool {
    return true
  }
}
