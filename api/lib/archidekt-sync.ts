/**
 * Archidekt precon sync service.
 * Fetches all commander precon decks from the Archidekt_Precons account
 * and upserts them into the deck store (SQLite or Firestore).
 * Sources from https://archidekt.com/commander-precons
 */
import { fetchArchidektDeck } from './ingestion/archidekt';
import { toDck } from './ingestion/to-dck';
import { slugify } from './saved-decks';
import { parseCommanderFromContent } from './saved-decks';

const ARCHIDEKT_LIST_URL = 'https://archidekt.com/api/decks/v3/';
const ARCHIDEKT_OWNER = 'Archidekt_Precons';
const PAGE_SIZE = 100;
const RATE_LIMIT_MS = 3000;

interface ArchidektListDeck {
  id: number;
  name: string;
  updatedAt: string;
  colors: Record<string, number>; // e.g. { W: 23, U: 15, B: 0, R: 10, G: 12 }
}

interface ArchidektListResponse {
  count: number;
  next: string | null;
  results: ArchidektListDeck[];
}

export interface SyncResult {
  total: number;
  added: number;
  updated: number;
  unchanged: number;
  removed: number;
  errors: string[];
}

/**
 * Paginate through the Archidekt v3 list endpoint to get all precons.
 */
export async function fetchArchidektPreconList(): Promise<ArchidektListDeck[]> {
  const allDecks: ArchidektListDeck[] = [];
  let url: string | null = `${ARCHIDEKT_LIST_URL}?ownerUsername=${ARCHIDEKT_OWNER}&ownerexact=true&pageSize=${PAGE_SIZE}`;

  while (url) {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Archidekt precon list: ${response.status} ${response.statusText}`);
    }

    const data: ArchidektListResponse = await response.json();
    allDecks.push(...data.results);
    url = data.next;

    if (url) {
      await sleep(RATE_LIMIT_MS);
    }
  }

  return allDecks;
}

/**
 * Parse Archidekt precon name into deck name and set/product name.
 * Format: "{Precon Name} - {Product/Set Name} Commander Deck"
 */
export function parsePreconName(fullName: string): { name: string; setName: string | null } {
  const dashIndex = fullName.indexOf(' - ');
  if (dashIndex === -1) {
    return { name: fullName.trim(), setName: null };
  }

  const name = fullName.substring(0, dashIndex).trim();
  let setName = fullName.substring(dashIndex + 3).trim();

  // Strip common suffixes
  setName = setName
    .replace(/\s+Commander\s+Deck$/i, '')
    .replace(/\s+Commander$/i, '')
    .trim();

  return { name, setName: setName || null };
}

/**
 * Convert Archidekt color counts to color identity array.
 * Only includes colors with non-zero counts.
 */
export function archidektColorsToIdentity(colors: Record<string, number>): string[] {
  const order = ['W', 'U', 'B', 'R', 'G'];
  return order.filter((c) => (colors[c] ?? 0) > 0);
}

/**
 * Generate a stable slug ID from a precon name.
 */
function generatePreconId(name: string, allIds: Set<string>): string {
  let id = slugify(name);
  if (!id) id = 'precon';

  if (!allIds.has(id)) return id;

  // Handle duplicates by appending a counter
  let counter = 2;
  while (allIds.has(`${id}-${counter}`)) {
    counter++;
  }
  return `${id}-${counter}`;
}

/**
 * Main sync function: fetches precon list from Archidekt, diffs against
 * existing precons in the store, and upserts new/changed decks.
 */
export async function syncPrecons(): Promise<SyncResult> {
  const USE_FIRESTORE =
    typeof process.env.GOOGLE_CLOUD_PROJECT === 'string' && process.env.GOOGLE_CLOUD_PROJECT.length > 0;

  console.log('[PreconSync] Starting Archidekt precon sync...');

  // 1. Fetch full list from Archidekt
  const archidektDecks = await fetchArchidektPreconList();
  console.log(`[PreconSync] Found ${archidektDecks.length} precons on Archidekt`);

  // 2. Load existing precons from store (indexed by archidektId)
  const existingByArchidektId = new Map<number, { id: string; archidektUpdatedAt: string | null }>();
  const allExistingPreconIds = new Set<string>();

  if (USE_FIRESTORE) {
    const firestoreDecks = await import('./firestore-decks');
    const allDecks = await firestoreDecks.listAllDecks();
    for (const deck of allDecks) {
      if (deck.isPrecon) {
        allExistingPreconIds.add(deck.id);
        if (deck.archidektId) {
          existingByArchidektId.set(deck.archidektId, {
            id: deck.id,
            archidektUpdatedAt: (deck as { archidektUpdatedAt?: string | null }).archidektUpdatedAt ?? null,
          });
        }
      }
    }
  } else {
    const { getDb } = await import('./db');
    const db = getDb();
    const rows = db.prepare('SELECT id, archidekt_id, archidekt_updated_at FROM precons').all() as {
      id: string;
      archidekt_id: number | null;
      archidekt_updated_at: string | null;
    }[];
    for (const row of rows) {
      allExistingPreconIds.add(row.id);
      if (row.archidekt_id) {
        existingByArchidektId.set(row.archidekt_id, {
          id: row.id,
          archidektUpdatedAt: row.archidekt_updated_at,
        });
      }
    }
  }

  const result: SyncResult = { total: archidektDecks.length, added: 0, updated: 0, unchanged: 0, removed: 0, errors: [] };
  const keepPreconIds = new Set<string>();
  const usedIds = new Set(allExistingPreconIds);

  // 3. Process each Archidekt deck
  for (const adeck of archidektDecks) {
    try {
      const existing = existingByArchidektId.get(adeck.id);

      // Skip if unchanged
      if (existing && existing.archidektUpdatedAt === adeck.updatedAt) {
        keepPreconIds.add(existing.id);
        result.unchanged++;
        continue;
      }

      // Need to fetch full deck details
      const { name: parsedName, setName } = parsePreconName(adeck.name);
      const colorIdentity = archidektColorsToIdentity(adeck.colors);
      const id = existing?.id ?? generatePreconId(parsedName, usedIds);
      usedIds.add(id);
      keepPreconIds.add(id);

      console.log(`[PreconSync] ${existing ? 'Updating' : 'Adding'}: ${parsedName} (archidekt:${adeck.id})`);

      // Fetch full deck from Archidekt
      const parsedDeck = await fetchArchidektDeck(String(adeck.id));
      const dck = toDck(parsedDeck);
      const primaryCommander = parseCommanderFromContent(dck) ?? (parsedDeck.commanders[0]?.name || null);
      const link = `https://archidekt.com/decks/${adeck.id}`;
      const filename = `${id}.dck`;

      // Upsert into store
      if (USE_FIRESTORE) {
        const firestoreDecks = await import('./firestore-decks');
        await firestoreDecks.upsertPrecon({
          id,
          name: parsedName,
          filename,
          dck,
          primaryCommander,
          colorIdentity,
          link,
          setName,
          archidektId: adeck.id,
          archidektUpdatedAt: adeck.updatedAt,
        });
      } else {
        const { getDb } = await import('./db');
        const db = getDb();
        db.prepare(`
          INSERT INTO precons (id, archidekt_id, name, set_name, filename, primary_commander, color_identity, dck, link, archidekt_updated_at, synced_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            archidekt_id = excluded.archidekt_id,
            name = excluded.name,
            set_name = excluded.set_name,
            filename = excluded.filename,
            primary_commander = excluded.primary_commander,
            color_identity = excluded.color_identity,
            dck = excluded.dck,
            link = excluded.link,
            archidekt_updated_at = excluded.archidekt_updated_at,
            synced_at = excluded.synced_at
        `).run(
          id,
          adeck.id,
          parsedName,
          setName,
          filename,
          primaryCommander,
          JSON.stringify(colorIdentity),
          dck,
          link,
          adeck.updatedAt,
          new Date().toISOString(),
        );
      }

      if (existing) {
        result.updated++;
      } else {
        result.added++;
      }

      // Rate limit between deck detail fetches
      await sleep(RATE_LIMIT_MS);
    } catch (err) {
      const msg = `Failed to sync "${adeck.name}" (${adeck.id}): ${err instanceof Error ? err.message : err}`;
      console.error(`[PreconSync] ${msg}`);
      result.errors.push(msg);
    }
  }

  // 4. Remove orphaned precons (legacy hand-imported or wrongly synced)
  const orphanIds = [...allExistingPreconIds].filter((id) => !keepPreconIds.has(id));
  if (orphanIds.length > 0 && archidektDecks.length >= allExistingPreconIds.size * 0.5) {
    console.log(`[PreconSync] Removing ${orphanIds.length} orphaned precons...`);
    for (const id of orphanIds) {
      try {
        if (USE_FIRESTORE) {
          const firestoreDecks = await import('./firestore-decks');
          await firestoreDecks.deletePrecon(id);
        } else {
          const { getDb } = await import('./db');
          const db = getDb();
          db.prepare('DELETE FROM precons WHERE id = ?').run(id);
        }
        result.removed++;
        console.log(`[PreconSync] Removed orphan: ${id}`);
      } catch (err) {
        const msg = `Failed to remove orphan "${id}": ${err instanceof Error ? err.message : err}`;
        console.error(`[PreconSync] ${msg}`);
        result.errors.push(msg);
      }
    }
  } else if (orphanIds.length > 0) {
    console.warn(`[PreconSync] Skipping orphan deletion: got ${archidektDecks.length} decks but have ${allExistingPreconIds.size} existing — sync may be incomplete`);
  }

  console.log(`[PreconSync] Sync complete: ${result.added} added, ${result.updated} updated, ${result.unchanged} unchanged, ${result.removed} removed, ${result.errors.length} errors`);
  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
