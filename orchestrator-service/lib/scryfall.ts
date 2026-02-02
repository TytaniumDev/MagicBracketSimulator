import * as fs from 'fs';
import * as path from 'path';

const SCRYFALL_CACHE_FILENAME = 'scryfall-color-identity.json';

function getCacheDir(): string {
  const base = process.env.ORCHESTRATOR_CACHE_DIR || path.resolve(process.cwd(), '.cache');
  return path.resolve(base);
}

function getCachePath(): string {
  return path.join(getCacheDir(), SCRYFALL_CACHE_FILENAME);
}

/**
 * Normalize card name for cache key: trim and take part before first | (e.g. "Galadriel, Elven-Queen|LTC|1" -> "Galadriel, Elven-Queen").
 */
function normalizeCardName(cardName: string): string {
  const trimmed = cardName.trim();
  const pipeIndex = trimmed.indexOf('|');
  return pipeIndex >= 0 ? trimmed.substring(0, pipeIndex).trim() : trimmed;
}

function loadCache(): Record<string, string[] | null> {
  const cachePath = getCachePath();
  try {
    if (fs.existsSync(cachePath)) {
      const raw = fs.readFileSync(cachePath, 'utf-8');
      return JSON.parse(raw) as Record<string, string[] | null>;
    }
  } catch (err) {
    console.error('Failed to load Scryfall cache:', err);
  }
  return {};
}

function saveCache(cache: Record<string, string[] | null>): void {
  const cacheDir = getCacheDir();
  try {
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    const cachePath = getCachePath();
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 0), 'utf-8');
  } catch (err) {
    console.error('Failed to save Scryfall cache:', err);
  }
}

/**
 * Fetch color identity for a card from Scryfall API.
 * Returns array of WUBRG letters (e.g. ["W","U","B","R","G"]) or [] if not found.
 * Results are cached on disk keyed by normalized card name (lowercase).
 */
export async function getColorIdentity(cardName: string): Promise<string[]> {
  const normalized = normalizeCardName(cardName);
  if (!normalized) {
    return [];
  }
  const cacheKey = normalized.toLowerCase();

  const cache = loadCache();
  if (Object.prototype.hasOwnProperty.call(cache, cacheKey)) {
    const cached = cache[cacheKey];
    return cached ?? [];
  }

  const url = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(normalized)}`;
  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'MagicBracketSimulator (https://github.com/)',
      },
    });
    if (!res.ok) {
      cache[cacheKey] = null;
      saveCache(cache);
      return [];
    }
    const data = (await res.json()) as { color_identity?: string[] };
    const colorIdentity = Array.isArray(data.color_identity) ? data.color_identity : [];
    cache[cacheKey] = colorIdentity;
    saveCache(cache);
    return colorIdentity;
  } catch (err) {
    console.error(`Scryfall lookup failed for "${normalized}":`, err);
    cache[cacheKey] = null;
    saveCache(cache);
    return [];
  }
}
