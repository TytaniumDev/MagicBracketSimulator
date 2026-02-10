## 2024-05-22 - Frontend Verification Requires Firebase
**Learning:** The frontend application crashes on initialization if Firebase API keys are missing (specifically `auth/invalid-api-key`). This prevents Playwright verification of UI changes without a valid `.env` file or mocked Firebase.
**Action:** When verifying frontend changes, ensure Firebase environment variables are set, or rely on `npm run build` (tsc) for static analysis if runtime verification is blocked by missing credentials.

## 2025-05-22 - Large List Rendering in React
**Learning:** Rendering large lists (like simulation logs) directly in a complex parent component causes expensive re-renders when unrelated parent state (e.g., timers, other UI toggles) changes.
**Action:** Extract large list rendering into a `React.memo` component (`GameLogs`) and lift state up if necessary to isolate the expensive render tree. Ensure memoized components rely only on props that change when the list data actually changes.
