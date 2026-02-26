/**
 * Mock Firebase module for tests.
 * Prevents Firebase SDK initialization (which requires env vars and network).
 */
export const auth = null;
export const db = null;
export const rtdb = null;
export const appCheck = null;
export const googleProvider = null;
export const isFirebaseConfigured = false;
export default null;
