/**
 * Access records: one private doc per user at `users/{uid}` (GCP mode),
 * holding their email, whether they asked for access or were given it, and
 * when. Only the API reads or writes these docs.
 *
 * LOCAL mode has no access control, so callers skip this store there.
 */
import { Timestamp } from '@google-cloud/firestore';
import { getFirestore } from './firestore-client';

export type AccessStatus = 'requested' | 'allowed';

export interface UserAccess {
  uid: string;
  email: string | null;
  displayName: string | null;
  status: AccessStatus;
  message: string | null;
  requestedAt: Date | null;
  approvedAt: Date | null;
}

function usersCollection() {
  return getFirestore().collection('users');
}

function toDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  return null;
}

/** The user's access record, or null if they never asked for access. */
export async function getUserAccess(uid: string): Promise<UserAccess | null> {
  const snap = await usersCollection().doc(uid).get();
  if (!snap.exists) return null;
  return {
    uid,
    email: snap.get('email') ?? null,
    displayName: snap.get('displayName') ?? null,
    status: snap.get('status') === 'allowed' ? 'allowed' : 'requested',
    message: snap.get('message') ?? null,
    requestedAt: toDate(snap.get('requestedAt')),
    approvedAt: toDate(snap.get('approvedAt')),
  };
}

/**
 * Record an access request. Returns the user's status before the call:
 * null when this created the request.
 */
export async function requestAccess(
  uid: string,
  request: { email: string; displayName: string | null; message: string | null },
): Promise<AccessStatus | null> {
  const ref = usersCollection().doc(uid);
  return getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) return snap.get('status') === 'allowed' ? 'allowed' : 'requested';
    tx.create(ref, {
      ...request,
      status: 'requested',
      requestedAt: Timestamp.now(),
      approvedAt: null,
    });
    return null;
  });
}

/**
 * Give a user access. Returns their record as it was before, or null when
 * they never asked for access.
 */
export async function approveUser(uid: string): Promise<UserAccess | null> {
  const before = await getUserAccess(uid);
  if (before && before.status !== 'allowed') {
    await usersCollection().doc(uid).update({ status: 'allowed', approvedAt: Timestamp.now() });
  }
  return before;
}

/**
 * Make sure a pre-approved account (an admin or an ALLOWED_EMAILS address)
 * has an allowed access record, so the Firestore rules, which only see
 * users/{uid}, let it read. Writes only when the record is missing or not
 * yet allowed.
 */
export async function ensureAllowed(uid: string, email: string): Promise<void> {
  const ref = usersCollection().doc(uid);
  await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.get('status') === 'allowed') return;
    const approvedAt = Timestamp.now();
    if (snap.exists) {
      tx.update(ref, { status: 'allowed', approvedAt });
    } else {
      tx.create(ref, { email, displayName: null, message: null, status: 'allowed', requestedAt: null, approvedAt });
    }
  });
}
