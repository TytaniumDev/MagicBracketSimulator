/**
 * Detects if the current browser supports Google popup authentication.
 * Returns false for embedded browsers (Cursor, Electron, etc.) where popups are restricted.
 */
export function supportsGooglePopup(): boolean {
  if (typeof window === 'undefined') {
    return true; // SSR - assume supported
  }

  // Electron detection (Cursor is Electron-based)
  if ('electron' in window || navigator.userAgent.includes('Electron')) {
    return false;
  }

  // Generic embedded webview detection
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('webview') || ua.includes('wv)')) {
    return false;
  }

  // Check if running in an iframe (popups often blocked)
  if (window.self !== window.top) {
    return false;
  }

  return true;
}
