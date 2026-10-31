/**
 * Set codes from Scryfall, so precons can show "TDM" instead of
 * "Tarkir: Dragonstorm". One request for every set, called straight from the
 * browser like the card lookups in `scryfall.ts`.
 */

const SETS_URL = 'https://api.scryfall.com/sets';

export interface ScryfallSet {
  code: string;
  name: string;
  setType: string;
}

interface ScryfallSetJson {
  code: string;
  name: string;
  set_type: string;
}

/**
 * Set types a precon's set name can refer to, most likely first. Token,
 * promo and art series sets share the main set's name, so they're left out.
 */
const PRODUCT_SET_TYPES = ['expansion', 'core', 'masters', 'draft_innovation', 'commander', 'box'];

export async function fetchScryfallSets(): Promise<ScryfallSet[]> {
  const res = await fetch(SETS_URL, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`Scryfall set lookup failed (${res.status})`);
  }
  const body = (await res.json()) as { data?: ScryfallSetJson[] };
  return (body.data ?? [])
    .filter((s) => PRODUCT_SET_TYPES.includes(s.set_type))
    .map((s) => ({ code: s.code, name: s.name, setType: s.set_type }));
}

/**
 * The code for a precon's set name, uppercased, or null when no set matches.
 * Archidekt names sets loosely ("Tales of Middle-earth", "Secret Lair"), so
 * after an exact match this accepts a set whose name ends with ": <name>" or
 * where one name starts with the other, preferring main sets, then the
 * shortest name.
 */
export function setCodeFor(setName: string | null | undefined, sets: ScryfallSet[]): string | null {
  const wanted = setName?.trim().toLowerCase();
  if (!wanted) return null;

  const exact = sets.find((s) => s.name.toLowerCase() === wanted);
  if (exact) return exact.code.toUpperCase();

  const rank = (s: ScryfallSet) => PRODUCT_SET_TYPES.indexOf(s.setType);
  const loose = sets
    .filter((s) => {
      const name = s.name.toLowerCase();
      return name.endsWith(`: ${wanted}`) || name.startsWith(wanted) || wanted.startsWith(name);
    })
    .sort((a, b) => rank(a) - rank(b) || a.name.length - b.name.length);
  return loose[0]?.code.toUpperCase() ?? null;
}
