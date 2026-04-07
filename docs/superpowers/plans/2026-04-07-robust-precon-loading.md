# Robust Precon Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make precon loading resilient by serving precons from GCS, splitting the API route, and adding proper error/loading/retry states in the frontend.

**Architecture:** Precons are written to a public GCS object during Archidekt sync. The frontend fetches precons directly from GCS (no auth) and community decks from the API (auth). The API route is split so GET (listing) can't be broken by POST (creation) dependencies.

**Tech Stack:** React, Next.js App Router, @google-cloud/storage, gcloud CLI

---

### Task 1: Split GET/POST deck route

Decouple the deck listing endpoint from the deck creation endpoint so a broken ingestion import can't crash GET.

**Files:**
- Modify: `api/app/api/decks/route.ts` — remove POST handler and ingestion imports
- Create: `api/app/api/decks/create/route.ts` — POST handler with ingestion imports
- Modify: `frontend/src/pages/Home.tsx` — update POST URL

- [ ] **Step 1: Create the new POST route file**

Create `api/app/api/decks/create/route.ts` with the POST handler moved from the existing route:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { verifyAllowedUser, unauthorizedResponse } from '@/lib/auth';
import { createDeck } from '@/lib/deck-store-factory';
import { parseCommanderFromContent } from '@/lib/saved-decks';
import { getColorIdentity } from '@/lib/scryfall';
import { fetchDeckAsDck, parseTextAsDck, isMoxfieldUrl, isArchidektUrl, isManaboxUrl, isManaPoolUrl } from '@/lib/ingestion';
import { errorResponse, badRequestResponse } from '@/lib/api-response';

/**
 * POST /api/decks/create - Create a deck from URL or pasted text
 * Body: { deckUrl: string } OR { deckText: string, deckName?: string }
 */
export async function POST(request: NextRequest) {
  let user;
  try {
    user = await verifyAllowedUser(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const body = await request.json();
    const { deckUrl, deckText, deckName, deckLink } = body;

    let name: string;
    let dck: string;
    let link: string | undefined;

    const url = typeof deckUrl === 'string' ? deckUrl.trim() : '';
    const text = typeof deckText === 'string' ? deckText.trim() : '';

    if (url) {
      // URL-based import
      if (!isMoxfieldUrl(url) && !isArchidektUrl(url) && !isManaboxUrl(url) && !isManaPoolUrl(url)) {
        return badRequestResponse('Invalid deck URL. Please use Moxfield, Archidekt, ManaBox, or ManaPool URLs.');
      }

      const result = await fetchDeckAsDck(url);
      name = result.name;
      dck = result.dck;
      link = url;
    } else if (text) {
      // Text-based import
      const customName = typeof deckName === 'string' ? deckName.trim() : '';
      const result = parseTextAsDck(text);
      name = customName || result.name;
      dck = result.dck;
      // Use provided link (e.g., Moxfield URL for manual paste flow)
      if (typeof deckLink === 'string' && deckLink.trim()) {
        link = deckLink.trim();
      }
    } else {
      return badRequestResponse('Either deckUrl or deckText is required');
    }

    if (link) {
      try {
        const parsedUrl = new URL(link);
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          return badRequestResponse('Deck link must be a valid HTTP or HTTPS URL');
        }
      } catch (err) {
        return badRequestResponse('Deck link must be a valid URL');
      }
    }

    const commander = parseCommanderFromContent(dck);
    let colorIdentity: string[] | undefined;
    if (commander) {
      colorIdentity = await getColorIdentity(commander);
    }

    const savedDeck = await createDeck({
      name,
      dck,
      link,
      ownerId: user.uid,
      ownerEmail: user.email,
      colorIdentity,
    });

    return NextResponse.json(
      { ...savedDeck, colorIdentity },
      { status: 201 }
    );
  } catch (error) {
    console.error('Failed to save deck:', error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to save deck', 500);
  }
}
```

- [ ] **Step 2: Strip POST and ingestion imports from the original route**

Edit `api/app/api/decks/route.ts` to only contain the GET handler:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorizedResponse } from '@/lib/auth';
import { listAllDecks } from '@/lib/deck-store-factory';
import { errorResponse } from '@/lib/api-response';

/**
 * GET /api/decks - List all decks (precons + every user's submissions, public)
 */
export async function GET(request: NextRequest) {
  try {
    await verifyAuth(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const decks = await listAllDecks();
    return NextResponse.json({ decks });
  } catch (error) {
    console.error('Failed to list decks:', error);
    return errorResponse('Failed to list decks', 500);
  }
}
```

- [ ] **Step 3: Update frontend POST URL**

In `frontend/src/pages/Home.tsx`, find the `handleSaveDeck` function. Change the POST URL from `/api/decks` to `/api/decks/create`. There are two calls to `doPost` — both use the same URL variable, so update the one definition:

Find:
```typescript
      const doPost = async () => {
        const res = await fetchWithAuth(`${apiBase}/api/decks`, {
```

Replace with:
```typescript
      const doPost = async () => {
        const res = await fetchWithAuth(`${apiBase}/api/decks/create`, {
```

- [ ] **Step 4: Verify API type-check passes**

Run: `cd api && npx tsc --noEmit`
Expected: No errors. The new route file uses the same types and the old route file has fewer imports.

- [ ] **Step 5: Commit**

```bash
git add api/app/api/decks/route.ts api/app/api/decks/create/route.ts frontend/src/pages/Home.tsx
git commit -m "refactor: split deck GET/POST into separate route files

GET /api/decks stays in decks/route.ts (no ingestion dependency).
POST moves to decks/create/route.ts with all ingestion imports.
This prevents ingestion module failures from crashing deck listing."
```

---

### Task 2: Add GCS precon upload to sync pipeline

After Archidekt sync writes precons to Firestore, also write a `precons.json` to GCS for direct frontend consumption.

**Files:**
- Modify: `api/lib/gcs-storage.ts` — add `uploadPreconsJson` function
- Modify: `api/lib/archidekt-sync.ts` — call `uploadPreconsJson` at end of `syncPrecons()`

- [ ] **Step 1: Add `uploadPreconsJson` to gcs-storage.ts**

Add this function at the end of `api/lib/gcs-storage.ts` (before the final `export` line):

```typescript
/**
 * Upload the precons list as a public JSON file for direct frontend consumption.
 * Sets Cache-Control for CDN/browser caching and makes the object publicly readable.
 */
export async function uploadPreconsJson(precons: unknown[]): Promise<string> {
  const objectPath = 'precons.json';
  const file = bucket.file(objectPath);

  await withRetry(
    async () => {
      await file.save(JSON.stringify(precons), {
        contentType: 'application/json',
      });
      await file.setMetadata({
        cacheControl: 'public, max-age=3600',
      });
      await file.makePublic();
    },
    { maxAttempts: 3, delayMs: 1000, backoffMultiplier: 2 },
    'GCS upload precons.json',
    isRetryableGcsError
  );

  return `https://storage.googleapis.com/${BUCKET_NAME}/${objectPath}`;
}
```

- [ ] **Step 2: Call `uploadPreconsJson` at the end of `syncPrecons()`**

In `api/lib/archidekt-sync.ts`, add an import at the top:

```typescript
import { uploadPreconsJson } from './gcs-storage';
```

Then, at the end of `syncPrecons()`, after the log line `console.log('[PreconSync] Sync complete: ...')` (line 328) and before `return result;` (line 329), add the GCS upload step:

```typescript
  // 5. Write precons.json to GCS for direct frontend access
  if (USE_FIRESTORE) {
    try {
      const firestoreDecks = await import('./firestore-decks');
      const allDecks = await firestoreDecks.listAllDecks();
      const preconItems = allDecks.filter(d => d.isPrecon);
      const gcsUrl = await uploadPreconsJson(preconItems);
      console.log(`[PreconSync] Uploaded precons.json to GCS (${preconItems.length} precons): ${gcsUrl}`);
    } catch (err) {
      // Non-fatal: precons still available via API fallback
      console.error('[PreconSync] Failed to upload precons.json to GCS:', err);
      result.errors.push(`GCS upload failed: ${err instanceof Error ? err.message : err}`);
    }
  }
```

- [ ] **Step 3: Verify API type-check passes**

Run: `cd api && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add api/lib/gcs-storage.ts api/lib/archidekt-sync.ts
git commit -m "feat: upload precons.json to GCS after Archidekt sync

After syncing precons to Firestore, writes a public precons.json to
GCS with 1-hour cache. Frontend can fetch this directly without auth.
Non-fatal if upload fails — API fallback still works."
```

---

### Task 3: Configure GCS bucket CORS

One-time setup: allow the frontend domain to fetch precons.json from the GCS bucket.

**Files:** None (gcloud CLI commands only)

- [ ] **Step 1: Create a CORS config file**

Create a temporary file `/tmp/cors.json`:

```json
[
  {
    "origin": ["https://magic-bracket-simulator.web.app"],
    "method": ["GET"],
    "responseHeader": ["Content-Type"],
    "maxAgeSeconds": 3600
  }
]
```

- [ ] **Step 2: Apply CORS config to the bucket**

Run:
```bash
gcloud storage buckets update gs://magic-bracket-simulator-artifacts --cors-file=/tmp/cors.json --project=magic-bracket-simulator
```

Expected: Success message confirming CORS was updated.

- [ ] **Step 3: Verify CORS config**

Run:
```bash
gcloud storage buckets describe gs://magic-bracket-simulator-artifacts --project=magic-bracket-simulator --format="json(cors_config)"
```

Expected: Output shows the CORS rule with `magic-bracket-simulator.web.app` as origin.

- [ ] **Step 4: Clean up temp file**

```bash
rm /tmp/cors.json
```

No commit needed — this is infrastructure config, not code.

---

### Task 4: Add preconsUrl to frontend config

Add the GCS URL to config.json and update the config loader to parse it.

**Files:**
- Modify: `frontend/public/config.json` — add `preconsUrl` field
- Modify: `frontend/src/config.ts` — parse `preconsUrl` from config

- [ ] **Step 1: Add `preconsUrl` to config.json**

Edit `frontend/public/config.json`:

```json
{
  "apiUrl": "https://api--magic-bracket-simulator.us-central1.hosted.app",
  "preconsUrl": "https://storage.googleapis.com/magic-bracket-simulator-artifacts/precons.json"
}
```

- [ ] **Step 2: Update RuntimeConfig type and parser**

In `frontend/src/config.ts`, update the `RuntimeConfig` interface to add `preconsUrl`:

Find:
```typescript
export interface RuntimeConfig {
  apiUrl?: string;
  sentryDsn?: string;
}
```

Replace with:
```typescript
export interface RuntimeConfig {
  apiUrl?: string;
  preconsUrl?: string;
  sentryDsn?: string;
}
```

Then update the `loadRuntimeConfig` function's cached assignment to include `preconsUrl`:

Find:
```typescript
          cached = {
            apiUrl: typeof j.apiUrl === 'string' ? j.apiUrl.replace(/\/$/, '') : undefined,
            sentryDsn: typeof j.sentryDsn === 'string' ? j.sentryDsn : undefined,
          };
```

Replace with:
```typescript
          cached = {
            apiUrl: typeof j.apiUrl === 'string' ? j.apiUrl.replace(/\/$/, '') : undefined,
            preconsUrl: typeof j.preconsUrl === 'string' ? j.preconsUrl : undefined,
            sentryDsn: typeof j.sentryDsn === 'string' ? j.sentryDsn : undefined,
          };
```

- [ ] **Step 3: Verify frontend lint passes**

Run: `cd frontend && npx eslint . --max-warnings 0`
Expected: No errors or warnings.

- [ ] **Step 4: Commit**

```bash
git add frontend/public/config.json frontend/src/config.ts
git commit -m "feat: add preconsUrl to frontend runtime config

Configures the GCS precons.json URL so the frontend can fetch
precons directly without going through the API auth chain."
```

---

### Task 5: Refactor frontend deck fetching with error/loading/retry

Replace the single `fetchDecks` call with separate precon (GCS) and community deck (API) fetches, add loading state, error display, and retry logic.

**Files:**
- Modify: `frontend/src/pages/Home.tsx` — refactor SimulationForm's data fetching and UI

- [ ] **Step 1: Add new state variables**

In the `SimulationForm` function, find the existing deck state block:

```typescript
  // Data state - unified deck list
  const [decks, setDecks] = useState<Deck[]>([]);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
```

Replace with:

```typescript
  // Data state - separate precon and community deck lists
  const [preconDecks, setPreconDecks] = useState<Deck[]>([]);
  const [communityDeckList, setCommunityDeckList] = useState<Deck[]>([]);
  const [decksLoading, setDecksLoading] = useState(true);
  const [deckError, setDeckError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
```

- [ ] **Step 2: Add the config import**

At the top of the file, add the config import:

Find:
```typescript
import { getApiBase, fetchWithAuth } from '../api';
```

Replace with:
```typescript
import { getApiBase, fetchWithAuth } from '../api';
import { getRuntimeConfig } from '../config';
```

- [ ] **Step 3: Replace `fetchDecks` with separate fetch functions**

Remove the old `fetchDecks` callback and `useEffect`, and replace with the new fetch logic. Find:

```typescript
  // Fetch all decks (unified API)
  const fetchDecks = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`${apiBase}/api/decks`);
      const data = await res.json();
      setDecks(data.decks || []);
    } catch (err) {
      console.error('Failed to load decks:', err);
    }
  }, [apiBase]);

  useEffect(() => {
    fetchDecks();
  }, [fetchDecks]);
```

Replace with:

```typescript
  // Fetch precons from GCS (no auth needed) with API fallback
  const fetchPrecons = useCallback(async (): Promise<Deck[]> => {
    const { preconsUrl } = getRuntimeConfig();
    if (!preconsUrl) return []; // local mode — precons come from API

    try {
      const res = await fetch(preconsUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (err) {
      console.warn('GCS precon fetch failed, will use API fallback:', err);
      return [];
    }
  }, []);

  // Fetch community decks from API (auth required), with one auto-retry for cold starts
  const fetchCommunityDecks = useCallback(async (): Promise<Deck[]> => {
    const attempt = async (): Promise<Deck[]> => {
      const res = await fetchWithAuth(`${apiBase}/api/decks`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data.decks || [];
    };

    try {
      return await attempt();
    } catch (firstErr) {
      // Auto-retry once after 2s (handles cold start)
      await new Promise(r => setTimeout(r, 2000));
      return await attempt(); // Let this throw if it also fails
    }
  }, [apiBase]);

  // Load all decks on mount
  const loadDecks = useCallback(async () => {
    setDecksLoading(true);
    setDeckError(null);

    const [gcsPrecons, apiResult] = await Promise.allSettled([
      fetchPrecons(),
      fetchCommunityDecks(),
    ]);

    const precons = gcsPrecons.status === 'fulfilled' ? gcsPrecons.value : [];
    let community: Deck[] = [];
    let allApiDecks: Deck[] = [];

    if (apiResult.status === 'fulfilled') {
      allApiDecks = apiResult.value;
      community = allApiDecks.filter(d => !d.isPrecon);
    } else {
      setDeckError('Failed to load community decks. Please try again.');
    }

    // If GCS returned no precons, fall back to precons from API response
    if (precons.length === 0 && allApiDecks.length > 0) {
      setPreconDecks(allApiDecks.filter(d => d.isPrecon));
    } else {
      setPreconDecks(precons);
    }

    setCommunityDeckList(community);
    setDecksLoading(false);
  }, [fetchPrecons, fetchCommunityDecks]);

  useEffect(() => {
    loadDecks();
  }, [loadDecks]);
```

- [ ] **Step 4: Update derived state to use the new separate lists**

Find the old `filteredDecks`, `precons`, `communityDecks`, and `deckOptions` memos:

```typescript
  const filteredDecks = useMemo(() => {
    if (!searchQuery.trim()) return decks;
    const q = searchQuery.toLowerCase();
    return decks.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        (d.setName && d.setName.toLowerCase().includes(q)) ||
        (d.primaryCommander && d.primaryCommander.toLowerCase().includes(q)) ||
        (d.ownerEmail && d.ownerEmail.toLowerCase().includes(q))
    );
  }, [decks, searchQuery]);

  const precons = useMemo(() => filteredDecks.filter((d) => d.isPrecon), [filteredDecks]);
  const communityDecks = useMemo(() => filteredDecks.filter((d) => !d.isPrecon), [filteredDecks]);

  // Build combined deck options
  const deckOptions: DeckOption[] = useMemo(
    () =>
      decks.map((d) => ({
        id: d.id,
        name: d.name,
        type: d.isPrecon ? ('precon' as const) : ('saved' as const),
        deck: d,
      })),
    [decks]
  );
```

Replace with:

```typescript
  // Combine for filtering and selection
  const allDecks = useMemo(() => [...preconDecks, ...communityDeckList], [preconDecks, communityDeckList]);

  const filteredDecks = useMemo(() => {
    if (!searchQuery.trim()) return allDecks;
    const q = searchQuery.toLowerCase();
    return allDecks.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        (d.setName && d.setName.toLowerCase().includes(q)) ||
        (d.primaryCommander && d.primaryCommander.toLowerCase().includes(q)) ||
        (d.ownerEmail && d.ownerEmail.toLowerCase().includes(q))
    );
  }, [allDecks, searchQuery]);

  const precons = useMemo(() => filteredDecks.filter((d) => d.isPrecon), [filteredDecks]);
  const communityDecks = useMemo(() => filteredDecks.filter((d) => !d.isPrecon), [filteredDecks]);

  // Build combined deck options (used for selection display)
  const deckOptions: DeckOption[] = useMemo(
    () =>
      allDecks.map((d) => ({
        id: d.id,
        name: d.name,
        type: d.isPrecon ? ('precon' as const) : ('saved' as const),
        deck: d,
      })),
    [allDecks]
  );
```

- [ ] **Step 5: Update `handleSaveDeck` and `handleDeleteDeck` to use `loadDecks`**

These functions call `fetchDecks()` after saving/deleting. Replace those calls with `loadDecks()`.

In `handleSaveDeck`, find:
```typescript
      await fetchDecks();
```
Replace with:
```typescript
      await loadDecks();
```

In `handleDeleteDeck`, find:
```typescript
      await fetchDecks();
```
Replace with:
```typescript
      await loadDecks();
```

- [ ] **Step 6: Add loading and error UI**

In the JSX, find the deck list container (the `<div className="max-h-80 overflow-y-auto bg-gray-700 rounded-md p-3">`). Wrap the contents with loading/error states.

Find:
```typescript
          <div className="max-h-80 overflow-y-auto bg-gray-700 rounded-md p-3">
            {/* Community Decks Group */}
```

Replace with:
```typescript
          <div className="max-h-80 overflow-y-auto bg-gray-700 rounded-md p-3">
            {decksLoading && (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin h-6 w-6 border-2 border-purple-500 border-t-transparent rounded-full mr-3" />
                <span className="text-sm text-gray-400">Loading decks...</span>
              </div>
            )}

            {deckError && !decksLoading && (
              <div className="bg-red-900/30 border border-red-600 rounded-md p-3 mb-3">
                <p className="text-sm text-red-200">{deckError}</p>
                <button
                  type="button"
                  onClick={() => loadDecks()}
                  className="mt-2 text-sm text-red-300 hover:text-white underline"
                >
                  Retry
                </button>
              </div>
            )}

            {!decksLoading && (
              <>
            {/* Community Decks Group */}
```

Then find the closing of the deck list container. Look for the `</div>` that closes the `max-h-80` div — it's after the Preconstructed Decks section and before the selected decks summary. Add the closing `</>` for the fragment:

Find the `</div>` that closes the precons section's grid:
```typescript
              </div>
            </div>
          </div>
```

The last `</div>` above closes the `max-h-80` container. Insert `</>` before it:

```typescript
              </div>
            </div>
            </>
            )}
          </div>
```

- [ ] **Step 7: Verify frontend lint passes**

Run: `cd frontend && npx eslint . --max-warnings 0`
Expected: No errors or warnings.

- [ ] **Step 8: Verify frontend build succeeds**

Run: `cd frontend && npx tsc -b && npx vite build`
Expected: Build succeeds with no errors.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/Home.tsx
git commit -m "feat: fetch precons from GCS with error/loading/retry

- Precons load from GCS directly (no auth chain)
- Community decks load from API with auto-retry on cold start
- Falls back to API precons if GCS fetch fails
- Shows loading spinner while fetching
- Shows error banner with retry button on failure"
```

---

### Task 6: Seed initial precons.json to GCS

The sync pipeline now writes precons.json after each sync, but we need the file to exist before the next sync runs. Trigger a sync or manually upload.

**Files:** None (CLI commands only)

- [ ] **Step 1: Trigger a precon sync to generate the initial file**

The simplest approach: call the sync endpoint directly. You'll need the worker secret. Run:

```bash
WORKER_SECRET=$(gcloud secrets versions access latest --secret=worker-secret --project=magic-bracket-simulator)
curl -X POST \
  https://api--magic-bracket-simulator.us-central1.hosted.app/api/sync/precons \
  -H "X-Worker-Secret: $WORKER_SECRET" \
  -H "Content-Type: application/json"
```

Expected: JSON response with sync results (added/updated/unchanged counts). Console log should show `[PreconSync] Uploaded precons.json to GCS`.

Note: This step can only run AFTER the API is deployed with the Task 2 changes. If you need the file before deployment, you can manually create it by fetching precons from the API and uploading:

```bash
# Alternative: manual upload if sync can't run yet
curl -s "https://api--magic-bracket-simulator.us-central1.hosted.app/api/decks" \
  -H "Authorization: Bearer <YOUR_TOKEN>" \
  -H "X-Firebase-AppCheck: <YOUR_APP_CHECK_TOKEN>" | \
  jq '[.decks[] | select(.isPrecon == true)]' > /tmp/precons.json

gcloud storage cp /tmp/precons.json gs://magic-bracket-simulator-artifacts/precons.json \
  --project=magic-bracket-simulator \
  --cache-control="public, max-age=3600" \
  --content-type="application/json"

gcloud storage objects update gs://magic-bracket-simulator-artifacts/precons.json \
  --add-acl-grant=entity=allUsers,role=READER \
  --project=magic-bracket-simulator
```

- [ ] **Step 2: Verify the file is publicly accessible**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}" https://storage.googleapis.com/magic-bracket-simulator-artifacts/precons.json
```

Expected: `200`

- [ ] **Step 3: Verify the content is valid**

Run:
```bash
curl -s https://storage.googleapis.com/magic-bracket-simulator-artifacts/precons.json | jq 'length'
```

Expected: A number > 0 (the count of precon decks).
