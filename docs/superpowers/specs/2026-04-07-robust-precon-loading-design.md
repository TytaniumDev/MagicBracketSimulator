# Robust Precon Loading Design

**Date:** 2026-04-07
**Status:** Approved
**Problem:** Preconstructed decks intermittently fail to load on the submit page. The loading chain (config.json -> Firebase Auth -> App Check -> CORS -> API route module -> Firestore) is fragile, and failures are completely silent to the user.

## Goals

1. Decouple precon reading from the deck creation code path
2. Make precon loading independent of auth/App Check
3. Surface errors to the user instead of silently showing empty lists
4. Tolerate API cold starts
5. Minimize cost exposure from unauthenticated endpoints

## Changes

### 1. Split GET/POST deck route

**Why:** `api/app/api/decks/route.ts` imports `@/lib/ingestion` at the top level. This import is only needed by POST (deck creation), but because GET and POST share a route file, a failure in the ingestion module chain crashes the entire file — taking GET (deck listing) down with it.

**Change:**
- Move POST handler to `api/app/api/decks/create/route.ts` with the ingestion imports
- Keep GET handler in `api/app/api/decks/route.ts`, now with no ingestion dependency
- Update frontend to POST to `/api/decks/create` instead of `/api/decks`

**Files:**
- `api/app/api/decks/route.ts` — remove POST handler and ingestion imports
- `api/app/api/decks/create/route.ts` — new file, POST handler + ingestion imports
- `frontend/src/pages/Home.tsx` — update POST URL

### 2. Static precons via GCS

**Why:** Precons are essentially static data that only changes when the Archidekt sync runs. Loading them through the full API auth chain (Firebase Auth + App Check + CORS + Firestore) is unnecessary and fragile. Serving from GCS removes all of those dependencies.

**Change — Sync side (`api/lib/archidekt-sync.ts`):**
- After `syncPrecons()` finishes writing to Firestore, generate a `precons.json` containing the precon `DeckListItem[]` array
- Upload to `gs://magic-bracket-simulator-artifacts/precons.json`
- Set object metadata: `Cache-Control: public, max-age=3600`, `Content-Type: application/json`
- Make the object publicly readable via `storage.makePublic()` on the object (fine-grained ACL)
- Use `@google-cloud/storage` (already a direct dependency in `api/package.json`)

**Change — GCS bucket CORS (one-time setup via gcloud CLI):**
- Add CORS rule to `magic-bracket-simulator-artifacts` bucket:
  - Origin: `https://magic-bracket-simulator.web.app`
  - Methods: `GET`
  - Response headers: `Content-Type`
  - Max age: `3600`

**Change — Frontend (`frontend/src/pages/Home.tsx`):**
- Add a new `fetchPrecons()` function that fetches from the GCS URL directly (plain `fetch`, no `fetchWithAuth`)
- GCS URL: `https://storage.googleapis.com/magic-bracket-simulator-artifacts/precons.json`
- On success, set precons state directly
- On failure, fall back to extracting precons from the authenticated `/api/decks` response (existing path)
- Fetch precons and community decks in parallel

**Change — API GET `/api/decks`:**
- No change to the endpoint itself — it still returns all decks (precons + community) for backward compatibility and as a fallback
- The frontend just won't rely on it for precons anymore in the happy path

**Change — Frontend config:**
- Add the GCS precons URL to `frontend/public/config.json` so it's not hardcoded:
  ```json
  {
    "apiUrl": "...",
    "preconsUrl": "https://storage.googleapis.com/magic-bracket-simulator-artifacts/precons.json"
  }
  ```
- Update `RuntimeConfig` type and `loadRuntimeConfig()` to parse `preconsUrl`
- In local mode (no `preconsUrl` configured), skip GCS fetch entirely and use the API as before

**Data shape of `precons.json`:**
```typescript
// Same DeckListItem shape the frontend already uses
interface PreconListItem {
  id: string;
  name: string;
  filename: string;
  primaryCommander?: string | null;
  colorIdentity?: string[];
  isPrecon: true;
  link?: string | null;
  ownerId: null;
  ownerEmail?: null;
  createdAt: string;
  setName?: string | null;
  archidektId?: number | null;
}
```

**Cost exposure:** ~$17 per 1M malicious requests (GCS reads + egress for ~100KB file). Cache-Control headers cause browsers and proxies to cache aggressively, so real-world cost is negligible.

### 3. Frontend error handling for deck fetching

**Why:** Currently `fetchDecks` doesn't check `res.ok`. If the API returns 401, 500, or any error JSON, the code parses it successfully, finds `data.decks` is undefined, and silently sets an empty array. The user sees no error — just missing decks.

**Change:**
- Add `deckError: string | null` state
- Check `res.ok` before parsing JSON in both `fetchPrecons()` and `fetchCommunityDecks()`
- On error, set `deckError` with a user-facing message
- Display an inline error banner in the deck list area (not a toast/modal — keep it contextual)
- Include a "Retry" button in the error banner

**Files:**
- `frontend/src/pages/Home.tsx` — add error state, check res.ok, render error banner

### 4. Loading state for deck fetching

**Why:** No loading indicator while decks are being fetched. The deck list area is empty during the fetch, which is indistinguishable from "no decks exist."

**Change:**
- Add `decksLoading: boolean` state (defaults to `true`)
- Show a spinner or skeleton in the deck list area while loading
- Set to `false` after both precon and community deck fetches complete (or fail)
- This is distinct from the Suspense fallback (which is for lazy chunk loading)

**Files:**
- `frontend/src/pages/Home.tsx` — add loading state, render loading indicator

### 5. Retry with backoff

**Why:** With `minInstances: 0`, the API often cold-starts on the first request. A single failed fetch (timeout, 502) leaves the user with no decks and no way to recover without refreshing.

**Change:**
- On fetch failure (community decks from API), auto-retry once after 2 seconds
- If the retry also fails, show the error banner with a manual "Retry" button
- Precon fetch from GCS doesn't need retry (GCS is highly available), but if it fails, the fallback to API already provides a second chance

**Files:**
- `frontend/src/pages/Home.tsx` — add retry logic to community deck fetch

## Testing

- **API unit test:** Verify POST at `/api/decks/create` works (update existing ingestion test if needed)
- **Sync integration:** Verify `syncPrecons()` writes `precons.json` to GCS after Firestore upserts
- **Frontend manual testing:**
  - Precons load from GCS URL (check Network tab — no auth headers)
  - Community decks load from API (check Network tab — auth headers present)
  - Simulate GCS failure → fallback to API precons
  - Simulate API failure → error banner shows with retry button
  - Retry button works

## Files Changed (Summary)

| File | Change |
|------|--------|
| `api/app/api/decks/route.ts` | Remove POST handler, remove ingestion imports |
| `api/app/api/decks/create/route.ts` | New file — POST handler with ingestion imports |
| `api/lib/archidekt-sync.ts` | After sync, write precons.json to GCS |
| `frontend/public/config.json` | Add `preconsUrl` field |
| `frontend/src/config.ts` | Parse `preconsUrl` from config |
| `frontend/src/pages/Home.tsx` | Separate precon/community fetches, error/loading states, retry |

## Out of Scope

- Cloud CDN setup (can be added later if traffic warrants)
- Removing precons from the `/api/decks` response (kept for fallback and backward compat)
- Changing precon sync cadence or trigger mechanism
