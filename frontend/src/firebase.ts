import { initializeApp, FirebaseApp } from 'firebase/app';
import { initializeAppCheck, AppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { getAuth, GoogleAuthProvider, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';

// When VITE_FIREBASE_API_KEY is absent, Firebase is not configured (local mode).
// Exports will be null and AuthContext will provide a mock user instead.
const isFirebaseConfigured = !!import.meta.env.VITE_FIREBASE_API_KEY;

let app: FirebaseApp | null = null;
let appCheck: AppCheck | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let googleProvider: GoogleAuthProvider | null = null;

if (isFirebaseConfigured) {
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID || 'magic-bracket-simulator';
  const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'magic-bracket-simulator.firebaseapp.com',
    projectId,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'magic-bracket-simulator.appspot.com',
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  };

  app = initializeApp(firebaseConfig);

  // Enable App Check debug token in development so local requests pass verification.
  // The debug token is logged to the console — register it in Firebase Console → App Check.
  if (import.meta.env.DEV) {
    (self as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
  appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider('6Ldm6XQsAAAAAJ3SVyxtnI0qdqKb47uhTOaFMHqq'),
    isTokenAutoRefreshEnabled: true,
  });

  auth = getAuth(app);
  db = getFirestore(app);
  googleProvider = new GoogleAuthProvider();
}

export { appCheck, auth, db, googleProvider, isFirebaseConfigured };
export default app;
