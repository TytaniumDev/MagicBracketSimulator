import * as fs from 'fs';
import * as path from 'path';

const DECK_METADATA_FILENAME = 'deck-metadata.json';

function getCacheDir(): string {
  const base = process.env.ORCHESTRATOR_CACHE_DIR || path.resolve(process.cwd(), '.cache');
  return path.resolve(base);
}

function getMetadataPath(): string {
  return path.join(getCacheDir(), DECK_METADATA_FILENAME);
}

export interface DeckMetadataEntry {
  colorIdentity: string[];
}

function loadMetadata(): Record<string, DeckMetadataEntry> {
  const metadataPath = getMetadataPath();
  try {
    if (fs.existsSync(metadataPath)) {
      const raw = fs.readFileSync(metadataPath, 'utf-8');
      return JSON.parse(raw) as Record<string, DeckMetadataEntry>;
    }
  } catch (err) {
    console.error('Failed to load deck metadata:', err);
  }
  return {};
}

function saveMetadata(metadata: Record<string, DeckMetadataEntry>): void {
  const cacheDir = getCacheDir();
  try {
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    const metadataPath = getMetadataPath();
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save deck metadata:', err);
  }
}

/**
 * Get color identity for a deck or precon by key (precon id or deck filename).
 */
export function getColorIdentityByKey(key: string): string[] | undefined {
  const metadata = loadMetadata();
  const entry = metadata[key];
  return entry?.colorIdentity;
}

/**
 * Set color identity for a deck or precon (key = precon id or deck filename).
 */
export function setColorIdentity(key: string, colorIdentity: string[]): void {
  const metadata = loadMetadata();
  metadata[key] = { colorIdentity };
  saveMetadata(metadata);
}

/**
 * Remove color identity entry (e.g. when a saved deck is deleted).
 */
export function removeColorIdentity(key: string): void {
  const metadata = loadMetadata();
  if (Object.prototype.hasOwnProperty.call(metadata, key)) {
    delete metadata[key];
    saveMetadata(metadata);
  }
}
