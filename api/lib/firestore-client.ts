/**
 * Shared Firestore client singleton.
 *
 * Every module that needs a Firestore client must import `getFirestore()` from
 * here rather than calling `new Firestore(...)` directly. One gRPC channel +
 * one copy of the protobuf descriptors, shared across the process.
 */
import { Firestore } from '@google-cloud/firestore';

let _firestore: Firestore | null = null;

export function getFirestore(): Firestore {
  if (_firestore) return _firestore;
  _firestore = new Firestore({
    projectId: process.env.GOOGLE_CLOUD_PROJECT || 'magic-bracket-simulator',
  });
  return _firestore;
}
