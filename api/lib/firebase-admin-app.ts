/**
 * Firebase Admin SDK app singleton (GCP mode only).
 *
 * Shared by token verification (auth.ts) and Realtime Database access
 * (rtdb-client.ts). Credentials come from FIREBASE_ADMIN_KEY when set (a
 * service-account JSON string), otherwise Application Default Credentials
 * (the App Hosting service account in production).
 */
import { initializeApp, getApps, cert, App } from 'firebase-admin/app';

let firebaseApp: App | undefined;

function projectId(): string {
  return process.env.GOOGLE_CLOUD_PROJECT || 'magic-bracket-simulator';
}

/** The Realtime Database URL: FIREBASE_DATABASE_URL, or the project's default instance. */
export function databaseUrl(): string {
  return process.env.FIREBASE_DATABASE_URL || `https://${projectId()}-default-rtdb.firebaseio.com`;
}

export function getFirebaseAdminApp(): App {
  if (firebaseApp) return firebaseApp;

  const existingApps = getApps();
  if (existingApps.length > 0) {
    firebaseApp = existingApps[0];
    return firebaseApp;
  }

  const options = { projectId: projectId(), databaseURL: databaseUrl() };
  firebaseApp = process.env.FIREBASE_ADMIN_KEY
    ? initializeApp({ ...options, credential: cert(JSON.parse(process.env.FIREBASE_ADMIN_KEY)) })
    : initializeApp(options);
  return firebaseApp;
}
