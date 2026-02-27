# Architecture Issues & Future Improvements

Identified during the architecture hardening analysis (PR #78). Organized by priority and category.

**Resolved in PR #78:**
- State machine for simulation/job lifecycle transitions (`shared/types/state-machine.ts`)
- Type consolidation — `api/lib/types.ts` re-exports from `@shared/types/`
- Silent error elimination — all `.catch(() => {})` replaced with contextual warnings
- Dead code removal — unused `useJobStream.ts` hook deleted
- Input validation — job PATCH validates status before state machine check

---

## High Priority

### 1. Race Conditions in Job Lifecycle

**Location:** `api/app/api/jobs/[id]/simulations/[simId]/route.ts` (lines 92-104)

The sim PATCH route auto-transitions jobs from QUEUED → RUNNING when the first sim reports RUNNING. This read-then-write is not atomic — concurrent sim PATCH requests from parallel workers can both read `job.status === 'QUEUED'` and both call `setJobStartedAt` / `updateJobStatus`. The job ends up with correct state but duplicate writes occur.

**Mitigation:** Use a conditional/atomic update for the QUEUED → RUNNING transition (similar to the existing `conditionalUpdateSimulationStatus` pattern for COMPLETED transitions).

### 2. Aggregation Reliability

**Location:** `api/lib/job-store-factory.ts` — `aggregateJobResults()`

Aggregation is fire-and-forget from the sim PATCH response path. If it fails (timeout, transient Firestore error), the job stays RUNNING in Firestore even though RTDB already shows COMPLETED. The `recoverStaleJob` mechanism catches this eventually, but there's a window where state is inconsistent.

**Mitigation:** Add an aggregation retry mechanism (exponential backoff or a Cloud Task). At minimum, persist a `needsAggregation: true` flag that `recoverStaleJob` can check.

### 3. Missing Request Validation

**Locations:**
- `api/app/api/jobs/route.ts` — POST body validation relies on runtime checks, no schema validation (e.g., zod)
- `api/app/api/jobs/[id]/simulations/[simId]/route.ts` — body fields destructured without type validation
- Various PATCH endpoints accept `Record<string, unknown>` without sanitization

**Mitigation:** Add zod schemas for request bodies at system boundaries. Internal service-to-service calls (worker → API) still benefit from validation since Pub/Sub redelivery can send malformed payloads.

---

## Medium Priority

### 4. Inconsistent Error Response Shapes

**Locations:** All API routes under `api/app/api/`

Some errors return `{ error: string }`, others return `{ error: string, details: ... }`, and the state machine guards return `{ updated: false, reason: string }`. The worker handles all of these, but there's no shared error response type.

**Mitigation:** Define a standard `ApiError` response type in `@shared/types/` and use it consistently.

### 5. `REQUIRED_DECK_COUNT` Import Path Inconsistency

**Locations:**
- `api/app/api/jobs/[id]/route.ts` — imports from `@shared/types/job`
- `api/lib/stream-utils.ts` — imports from `@shared/types/job`
- `frontend/src/pages/JobStatus.tsx` — imports from `@shared/types/job`
- `api/lib/types.ts` — re-exports from `@shared/types/job`

The re-export exists in `api/lib/types.ts` but nobody uses it. Either remove the re-export or standardize all API-internal imports to go through `@/lib/types`.

**Recommendation:** Since `@shared/types/job` is the canonical source and both api and frontend can import it directly, remove the re-export from `api/lib/types.ts` to avoid confusion. The re-export pattern is useful for types that the API consumes differently (like `Job` with Date fields), but `REQUIRED_DECK_COUNT` is a plain constant.

### 6. Worker Health Check Gap

**Location:** `worker/src/worker.ts`, `worker/src/worker-api.ts`

The worker exposes a health endpoint and sends heartbeats, but there's no mechanism to detect a worker that's "alive but stuck" — e.g., a simulation container that hangs indefinitely. The worker's semaphore-based concurrency control doesn't have per-simulation timeouts.

**Mitigation:** Add a per-simulation timeout (configurable, e.g., 10 minutes). If a simulation container doesn't exit within the timeout, kill it and report FAILED.

### 7. Frontend Bundle Size

**Location:** `frontend/`

The frontend bundles all of Firebase (auth, firestore client) and several large dependencies. No code splitting beyond route-level React.lazy.

**Mitigation:** Audit bundle with `npx vite-bundle-visualizer`, lazy-load Firebase modules, consider dynamic imports for heavy components (e.g., log viewer, charts).

### 8. Test Coverage Gaps

**Locations:**
- `api/app/api/jobs/route.ts` — POST (job creation) has no unit tests
- `api/app/api/jobs/[id]/cancel/route.ts` — no tests
- `api/app/api/jobs/[id]/recover/route.ts` — no tests
- `api/lib/deck-resolver.ts` — no tests for Moxfield URL parsing edge cases
- `worker/src/worker.ts` — no unit tests for `processJobWithContainers`

**Mitigation:** Add targeted tests for the highest-risk paths first (job creation validation, cancel/recover state transitions, worker container orchestration).

---

## Low Priority

### 9. Hardcoded Constants

**Locations:**
- `api/lib/job-store-factory.ts` — stale job timeout (30 minutes) hardcoded
- `worker/src/worker.ts` — polling interval, max retries hardcoded
- Various files — magic numbers for timeouts, limits

**Mitigation:** Extract to a `shared/constants.ts` or per-service config file.

### 10. Logging Inconsistency

**Locations:** All API routes and lib files

Mix of `console.log`, `console.warn`, `console.error` with inconsistent prefixes (`[RTDB]`, `[Aggregation]`, etc.). No structured logging.

**Mitigation:** Adopt a lightweight structured logger (e.g., pino) with consistent fields: `{ component, jobId, simId, action }`. Low priority since Sentry captures errors.

### 11. SSE Stream Cleanup

**Location:** `api/app/api/jobs/[id]/stream/route.ts`

The SSE stream doesn't have explicit cleanup for Firestore snapshot listeners if the client disconnects abruptly. The `request.signal` abort handler covers HTTP-level disconnects, but Firestore `onSnapshot` unsubscribe might leak in edge cases.

**Mitigation:** Add defensive unsubscribe in a `finally` block.

### 12. Docker Socket Security

**Location:** `worker/docker-compose.yml`

The worker mounts the Docker socket (`/var/run/docker.sock`) to spawn simulation containers. This gives the worker container root-equivalent access to the host.

**Mitigation:** For production, consider Docker-in-Docker (dind) or a rootless Docker setup. For the current single-VM deployment this is acceptable.

### 13. Frontend Accessibility

**Location:** `frontend/src/`

No ARIA labels on interactive elements, no keyboard navigation for the deck selector, color-only status indicators.

**Mitigation:** Add `aria-label` attributes, keyboard event handlers, and text/icon indicators alongside color.

### 14. Duplicate Deck Detection

**Location:** `api/app/api/jobs/route.ts`

Users can submit a job with 4 identical decks. While technically valid (useful for testing), it produces meaningless results.

**Mitigation:** Add a warning (not error) in the response if duplicate decks are detected.

---

## Systemic Patterns Identified

These cross-cutting patterns contributed to past regressions:

1. **No state machine enforcement** (resolved in PR #78) — Invalid state transitions from Pub/Sub redelivery caused COMPLETED simulations to revert to RUNNING.

2. **Silent error swallowing** (resolved in PR #78) — `.catch(() => {})` on fire-and-forget operations hid failures that later caused data inconsistency.

3. **Type divergence** (resolved in PR #78) — Parallel type definitions in `api/lib/types.ts` and `shared/types/` could drift, causing runtime shape mismatches.

4. **Read-then-write without atomicity** — Multiple routes read current state, check a condition, then write. Under concurrent requests, this creates race windows. The `conditionalUpdateSimulationStatus` pattern is the fix; apply it to more transitions.

5. **Missing integration test coverage** — Most regressions were in the integration boundaries (worker → API, API → Firestore, SSE → frontend). Unit tests alone don't catch these.

6. **No schema validation at API boundaries** — Request bodies are destructured and used directly. Invalid payloads from retries or bugs propagate silently.

7. **Fire-and-forget side effects** — RTDB writes, aggregation, and GCS uploads happen outside the main request flow. Failures are logged but not retried, leading to stale UI state.
