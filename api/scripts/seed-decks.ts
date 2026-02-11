/**
 * Seed precons into Firestore decks collection.
 * Run: npx tsx scripts/seed-decks.ts
 *
 * Prerequisites:
 * - GOOGLE_CLOUD_PROJECT set
 * - GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_ADMIN_KEY
 */
import * as fs from 'fs';
import * as path from 'path';
import { Firestore, Timestamp } from '@google-cloud/firestore';

const forgeEnginePath =
  process.env.FORGE_ENGINE_PATH || path.resolve(process.cwd(), '../worker/forge-engine');
const manifestPath = path.resolve(forgeEnginePath, 'precons', 'manifest.json');

interface PreconManifest {
  precons: Array<{
    id: string;
    name: string;
    filename: string;
    primaryCommander?: string;
  }>;
}

async function main() {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) {
    console.error('GOOGLE_CLOUD_PROJECT environment variable is required');
    process.exit(1);
  }

  const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
  const manifest: PreconManifest = JSON.parse(manifestContent);

  const firestore = new Firestore({ projectId });
  const decksCollection = firestore.collection('decks');

  console.log(`Seeding ${manifest.precons.length} precons to Firestore...`);

  const batch = firestore.batch();

  for (const precon of manifest.precons) {
    const dckPath = path.resolve(forgeEnginePath, 'precons', precon.filename);
    let dckContent: string;
    try {
      dckContent = fs.readFileSync(dckPath, 'utf-8');
    } catch (err) {
      console.error(`Failed to read ${precon.filename}:`, err);
      continue;
    }

    const docRef = decksCollection.doc(precon.id);
    batch.set(docRef, {
      id: precon.id,
      name: precon.name,
      filename: precon.filename,
      dck: dckContent,
      primaryCommander: precon.primaryCommander ?? null,
      colorIdentity: null,
      isPrecon: true,
      link: null,
      ownerId: null,
      ownerEmail: null,
      createdAt: Timestamp.now(),
    });
    console.log(`  Queued: ${precon.name} (${precon.id})`);
  }

  await batch.commit();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
