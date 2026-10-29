#!/usr/bin/env node
/**
 * Give a user access by email: marks their `users/{uid}` access record allowed.
 * The user must have signed in at least once (so they exist in Firebase Auth).
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./firebase-admin-key.json node scripts/add-allowed-user.js user@gmail.com
 *   # or set FIREBASE_ADMIN_KEY to the service account JSON string
 *
 * Get a service account key: Firebase Console → Project settings → Service accounts → Generate new private key
 */

const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const USERS_COLLECTION = 'users';

function getFirebaseApp() {
  if (getApps().length > 0) return getApps()[0];

  if (process.env.FIREBASE_ADMIN_KEY) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
    return initializeApp({
      credential: cert(serviceAccount),
      projectId: process.env.GOOGLE_CLOUD_PROJECT || 'magic-bracket-simulator',
    });
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return initializeApp({
      projectId: process.env.GOOGLE_CLOUD_PROJECT || 'magic-bracket-simulator',
    });
  }

  console.error('Set GOOGLE_APPLICATION_CREDENTIALS to your service account JSON path, or FIREBASE_ADMIN_KEY to the JSON string.');
  console.error('Get a key from: Firebase Console → Project settings → Service accounts → Generate new private key');
  process.exit(1);
}

async function main() {
  const email = process.argv[2];
  if (!email || !email.includes('@')) {
    console.error('Usage: node scripts/add-allowed-user.js <email>');
    console.error('Example: node scripts/add-allowed-user.js you@gmail.com');
    process.exit(1);
  }

  getFirebaseApp();
  const auth = getAuth();
  const db = getFirestore();

  try {
    const userRecord = await auth.getUserByEmail(email.trim());
    const uid = userRecord.uid;

    await db.collection(USERS_COLLECTION).doc(uid).set(
      {
        email: userRecord.email,
        displayName: userRecord.displayName ?? null,
        status: 'allowed',
        approvedAt: new Date(),
      },
      { merge: true },
    );

    console.log(`Gave ${email} (UID: ${uid}) access.`);
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      console.error(`No Firebase Auth user found for ${email}.`);
      console.error('The person must sign in to the app at least once (they will see "Access denied"); then run this script again.');
      process.exit(1);
    }
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
