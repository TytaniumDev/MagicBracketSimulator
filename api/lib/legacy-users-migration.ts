/**
 * One-time copy of access records into `users/{uid}` (GCP mode):
 *
 *   allowedUsers/{uid}                      -> users/{uid}, status 'allowed'
 *   accessRequests/* with status 'pending'  -> users/{uid}, status 'requested'
 *
 * user-store.ts awaits ensureLegacyUsersMigrated() before every read and
 * write, so the first access check after deploy runs it. A users doc that
 * already exists is never overwritten, so re-running is safe, and
 * `config/legacyUsersMigration` records completion. The old collections are
 * left in place; deleting them, and this module, is a later cleanup.
 */
import { FieldValue, type DocumentData } from '@google-cloud/firestore';
import { getFirestore } from './firestore-client';
import { USE_FIRESTORE } from './env';
import { createLogger } from './logger';

const log = createLogger('LegacyUsersMigration');

/** gRPC status code Firestore returns when create() finds a doc. */
const ALREADY_EXISTS = 6;

function markerRef() {
  return getFirestore().collection('config').doc('legacyUsersMigration');
}

let migrated: Promise<void> | null = null;

/** Resolve once legacy access records are copied, migrating on first call. */
export function ensureLegacyUsersMigrated(): Promise<void> {
  if (!USE_FIRESTORE) return Promise.resolve();
  migrated ??= migrateIfNeeded().catch((err) => {
    migrated = null; // let the next call retry
    throw err;
  });
  return migrated;
}

async function migrateIfNeeded(): Promise<void> {
  if ((await markerRef().get()).exists) return;
  const db = getFirestore();

  const allowed = await db.collection('allowedUsers').get();
  // Allowed users first, so a stale pending request never wins.
  const records: [string, DocumentData][] = allowed.docs.map((doc) => [
    doc.id,
    {
      email: doc.get('email') ?? null,
      displayName: doc.get('displayName') ?? null,
      status: 'allowed',
      message: null,
      requestedAt: null,
      approvedAt: doc.get('approvedAt') ?? null,
    },
  ]);

  const pending = await db.collection('accessRequests').where('status', '==', 'pending').get();
  for (const doc of pending.docs) {
    records.push([
      doc.get('uid'),
      {
        email: doc.get('email') ?? null,
        displayName: doc.get('displayName') ?? null,
        status: 'requested',
        message: doc.get('message') ?? null,
        requestedAt: doc.get('createdAt') ?? null,
        approvedAt: null,
      },
    ]);
  }

  let copied = 0;
  for (const [uid, data] of records) {
    if (!uid) continue;
    try {
      await db.collection('users').doc(uid).create(data);
      copied++;
    } catch (err) {
      if ((err as { code?: number }).code !== ALREADY_EXISTS) throw err;
    }
  }

  await markerRef().set({ migratedAt: FieldValue.serverTimestamp(), copied });
  log.info('Copied legacy access records to users', { copied });
}
