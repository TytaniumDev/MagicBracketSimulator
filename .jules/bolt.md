## 2024-05-22 - Frontend Verification Requires Firebase
**Learning:** The frontend application crashes on initialization if Firebase API keys are missing (specifically `auth/invalid-api-key`). This prevents Playwright verification of UI changes without a valid `.env` file or mocked Firebase.
**Action:** When verifying frontend changes, ensure Firebase environment variables are set, or rely on `npm run build` (tsc) for static analysis if runtime verification is blocked by missing credentials.

## 2024-06-12 - Missing Memoization Implementation
**Learning:** An architectural guideline or memory explicitly specified that the `ColorIdentity` component was memoized to prevent unnecessary re-renders in list views. However, the actual code implementation simply exported a standard function without `React.memo()`. This is a classic example of documentation or "intended design" drifting from the actual codebase reality.
**Action:** When optimizing, always verify that expected performance patterns (like memoization on frequently-rendered list items) are actually present in the source code, rather than assuming they exist based on documentation or prior knowledge.

## 2024-06-21 - SimulationGrid Hover Re-render
**Learning:** `SimulationGrid` in `frontend/src/components/SimulationGrid.tsx` contained an inline rendering loop for thousands of game cells, and inline `onMouseEnter` / `onMouseLeave` handlers that updated a top-level hovered state. This meant hovering over a single tiny pixel re-rendered the entire grid.
**Action:** Used `React.memo` to memoize the rendering of each individual game cell, and extracted the state handlers via `useCallback` to stop a state change causing an unnecesary cascade of full child re-renders. Always ensure that fine-grained hovering state isn't driving a large list rendering update.

## 2024-07-15 - Unnecessary Array Reductions in Map Loop
**Learning:** In `frontend/src/components/DeckShowcase.tsx`, an O(N) array reduction (`turns.reduce`) was being calculated inline within a `Array.map` render loop for calculating `avgTurn` stats for each deck. This meant that on every re-render of `DeckShowcase` (even if stats didn't change), the iteration logic ran again for every item.
**Action:** Always extract O(N) inline list computations (such as array reduction, mapping, or formatting data) into a `useMemo` block that runs *before* the render loop, especially when rendering lists or grids. This preserves the O(1) performance expectation of the render function itself.

## 2024-07-28 - Parallelizing Synchronous State
**Learning:** In `api/lib/archidekt-sync.ts`, the Archidekt Precon synchronization was running completely sequentially, which created a significant N+1 bottleneck when making API calls and querying the database to upsert entries. While `Promise.all` allows parallel execution, we must take care when parallelizing code that involves synchronous state updates, such as ID generation (`usedIds`) and tracking set additions (`keepPreconIds`, `processedArchidektIds`), to prevent race conditions or collisions.
**Action:** When converting sequential asynchronous loops into batched or parallel execution using `Promise.all`, always extract the necessary synchronous state mutations to execute sequentially *before* pushing the asynchronous promises to the execution array.
