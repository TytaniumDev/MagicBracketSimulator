/**
 * Deck store factory: delegates to Firestore when GOOGLE_CLOUD_PROJECT is set,
 * otherwise to filesystem (precons + saved-decks).
 */
import * as fs from 'fs';
import * as path from 'path';
import { loadPrecons } from './precons';
import { listSavedDecks, readSavedDeckContent, saveDeck, deleteSavedDeck } from './saved-decks';
import { slugify } from './saved-decks';
import { getColorIdentityByKey } from './deck-metadata';
import * as firestoreDecks from './firestore-decks';

const USE_FIRESTORE =
  typeof process.env.GOOGLE_CLOUD_PROJECT === 'string' && process.env.GOOGLE_CLOUD_PROJECT.length > 0;

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

export async function listAllDecks(): Promise<DeckListItem[]> {
  if (USE_FIRESTORE) {
    return firestoreDecks.listAllDecks();
  }

  const precons = loadPrecons();
  const saved = listSavedDecks();

  const preconItems: DeckListItem[] = precons.map((p) => ({
    id: p.id,
    name: p.name,
    filename: p.filename,
    primaryCommander: p.primaryCommander ?? null,
    colorIdentity: getColorIdentityByKey(p.id),
    isPrecon: true,
    link: null,
    ownerId: null,
    ownerEmail: null,
    createdAt: '',
  }));

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

  const precon = loadPrecons().find((p) => p.id === id);
  if (precon) {
    const forgeEnginePath = process.env.FORGE_ENGINE_PATH || '../forge-simulation-engine';
    const preconPath = path.resolve(forgeEnginePath, 'precons', precon.filename);
    try {
      const dck = fs.readFileSync(preconPath, 'utf-8');
      return { name: precon.name, dck };
    } catch {
      return null;
    }
  }

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

export async function deleteDeck(id: string, userId: string): Promise<boolean> {
  if (USE_FIRESTORE) {
    return firestoreDecks.deleteDeck(id, userId);
  }

  const precons = loadPrecons();
  if (precons.some((p) => p.id === id)) {
    return false;
  }

  try {
    return deleteSavedDeck(id);
  } catch {
    return false;
  }
}
