import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getDatabase, Database } from 'firebase/database';

// When VITE_FIREBASE_API_KEY is absent, Firebase is not configured (local mode).
// Exports will be null and AuthContext will provide a mock user instead.
const isFirebaseConfigured = !!import.meta.env.VITE_FIREBASE_API_KEY;

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let rtdb: Database | null = null;
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
    databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || `https://${projectId}-default-rtdb.firebaseio.com`,
  };

  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  rtdb = getDatabase(app);
  googleProvider = new GoogleAuthProvider();
}

export { auth, db, rtdb, googleProvider, isFirebaseConfigured };
export default app;
