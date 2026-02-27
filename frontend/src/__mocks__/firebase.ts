/**
 * Mock Firebase module for tests.
 * Prevents Firebase SDK initialization (which requires env vars and network).
 *
 * NOTE: Vitest does NOT auto-apply __mocks__ files. Any test that imports
 * from '../firebase' (directly or transitively) must call:
 *   vi.mock('../firebase');
 * at the top of the test file for this mock to take effect.
 */
export const auth = null;
export const db = null;
export const appCheck = null;
export const googleProvider = null;
export const isFirebaseConfigured = false;
export default null;
