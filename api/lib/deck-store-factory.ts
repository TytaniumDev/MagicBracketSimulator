/**
 * Deck store factory: delegates to Firestore when GOOGLE_CLOUD_PROJECT is set,
 * otherwise to SQLite (precons) + filesystem (saved-decks).
 */
import { listSavedDecks, readSavedDeckContent, saveDeck, deleteSavedDeck } from './saved-decks';
import { slugify } from './saved-decks';
import { getColorIdentityByKey } from './deck-metadata';
import * as firestoreDecks from './firestore-decks';

const USE_FIRESTORE =
  typeof process.env.GOOGLE_CLOUD_PROJECT === 'string' && process.env.GOOGLE_CLOUD_PROJECT.length > 0;

// Log mode detection at startup
console.log(`[Deck Store] Running in ${USE_FIRESTORE ? 'GCP' : 'LOCAL'} mode`);
if (USE_FIRESTORE) {
  console.log(`[Deck Store] Project: ${process.env.GOOGLE_CLOUD_PROJECT}`);
  console.log(`[Deck Store] Using: Firestore`);
} else {
  console.log(`[Deck Store] Using: Filesystem (precons + saved-decks)`);
}

export interface DeckListItem {
  id: string;
  name: string;
  filename: string;
  primaryCommander?: string | null;
  colorIdentity?: string[];
  isPrecon: boolean;
  link?: string | null;
  ownerId: string | null;
  ownerEmail?: string | null;
  createdAt: string;
  setName?: string | null;
  archidektId?: number | null;
}

export interface CreateDeckInput {
  name: string;
  dck: string;
  link?: string | null;
  ownerId: string;
  ownerEmail: string;
  colorIdentity?: string[];
}

export function isGcpMode(): boolean {
  return USE_FIRESTORE;
}

interface PreconRow {
  id: string;
  archidekt_id: number | null;
  name: string;
  set_name: string | null;
  filename: string;
  primary_commander: string | null;
  color_identity: string | null;
  dck: string;
  link: string | null;
}

function listPreconsFromSqlite(): DeckListItem[] {
  const { getDb } = require('./db') as { getDb: () => import('better-sqlite3').Database };
  const db = getDb();
  const rows = db.prepare('SELECT id, archidekt_id, name, set_name, filename, primary_commander, color_identity, link FROM precons ORDER BY name').all() as PreconRow[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    filename: r.filename,
    primaryCommander: r.primary_commander,
    colorIdentity: r.color_identity ? JSON.parse(r.color_identity) : getColorIdentityByKey(r.id),
    isPrecon: true,
    link: r.link,
    ownerId: null,
    ownerEmail: null,
    createdAt: '',
    setName: r.set_name,
    archidektId: r.archidekt_id,
  }));
}

function readPreconFromSqlite(id: string): { name: string; dck: string } | null {
  const { getDb } = require('./db') as { getDb: () => import('better-sqlite3').Database };
  const db = getDb();
  const row = db.prepare('SELECT name, dck FROM precons WHERE id = ?').get(id) as { name: string; dck: string } | undefined;
  if (row) return row;
  // Fallback: try matching by name (for legacy IDs)
  const byName = db.prepare('SELECT name, dck FROM precons WHERE LOWER(REPLACE(name, \' \', \'-\')) = LOWER(?)').get(id) as { name: string; dck: string } | undefined;
  return byName ?? null;
}

export async function listAllDecks(): Promise<DeckListItem[]> {
  if (USE_FIRESTORE) {
    return firestoreDecks.listAllDecks();
  }

  const preconItems = listPreconsFromSqlite();
  const saved = listSavedDecks();

  const savedItems: DeckListItem[] = saved.map((s) => ({
    id: s.filename,
    name: s.name,
    filename: s.filename,
    primaryCommander: null,
    colorIdentity: getColorIdentityByKey(s.filename),
    isPrecon: false,
    link: null,
    ownerId: null,
    ownerEmail: null,
    createdAt: '',
  }));

  return [...preconItems, ...savedItems].sort((a, b) => a.name.localeCompare(b.name));
}

export async function readDeckContent(id: string): Promise<{ name: string; dck: string } | null> {
  if (USE_FIRESTORE) {
    return firestoreDecks.readDeckContent(id);
  }

  // Try precons from SQLite first
  const precon = readPreconFromSqlite(id);
  if (precon) return precon;

  return readSavedDeckContent(id);
}

export async function createDeck(input: CreateDeckInput): Promise<DeckListItem> {
  if (USE_FIRESTORE) {
    const baseFilename = slugify(input.name) || 'deck';
    let filename = `${baseFilename}.dck`;
    const decks = await firestoreDecks.listAllDecks();
    const existing = decks.filter((d) => d.filename === filename || d.id.startsWith(baseFilename));
    if (existing.length > 0) {
      let counter = 1;
      while (decks.some((d) => d.filename === filename)) {
        filename = `${baseFilename}-${counter}.dck`;
        counter++;
      }
    }

    const deck = await firestoreDecks.createDeck({
      name: input.name,
      filename,
      dck: input.dck,
      isPrecon: false,
      link: input.link ?? null,
      ownerId: input.ownerId,
      ownerEmail: input.ownerEmail,
      colorIdentity: input.colorIdentity,
    });

    return {
      id: deck.id,
      name: deck.name,
      filename: deck.filename,
      colorIdentity: deck.colorIdentity,
      isPrecon: false,
      link: deck.link,
      ownerId: deck.ownerId,
      ownerEmail: deck.ownerEmail,
      createdAt: deck.createdAt?.toDate?.()?.toISOString() ?? new Date().toISOString(),
    };
  }

  const saved = saveDeck(input.name, input.dck);
  return {
    id: saved.filename,
    name: saved.name,
    filename: saved.filename,
    isPrecon: false,
    link: null,
    ownerId: null,
    ownerEmail: null,
    createdAt: '',
  };
}

export async function getDeckById(id: string): Promise<DeckListItem | null> {
  if (USE_FIRESTORE) {
    const deck = await firestoreDecks.getDeck(id);
    if (!deck) return null;
    return {
      id: deck.id,
      name: deck.name,
      filename: deck.filename,
      primaryCommander: deck.primaryCommander ?? null,
      colorIdentity: deck.colorIdentity,
      isPrecon: deck.isPrecon,
      link: deck.link,
      ownerId: deck.ownerId,
      ownerEmail: deck.ownerEmail,
      createdAt: deck.createdAt?.toDate?.()?.toISOString() ?? '',
      setName: deck.setName ?? null,
      archidektId: deck.archidektId ?? null,
    };
  }

  const all = await listAllDecks();
  return all.find((d) => d.id === id) ?? null;
}

export async function deleteDeck(id: string, userId: string): Promise<boolean> {
  if (USE_FIRESTORE) {
    return firestoreDecks.deleteDeck(id, userId);
  }

  // Cannot delete precons
  const precon = readPreconFromSqlite(id);
  if (precon) return false;

  try {
    return deleteSavedDeck(id);
  } catch {
    return false;
  }
}
