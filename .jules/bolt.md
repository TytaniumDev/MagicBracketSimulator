## 2024-05-22 - Frontend Verification Requires Firebase
**Learning:** The frontend application crashes on initialization if Firebase API keys are missing (specifically `auth/invalid-api-key`). This prevents Playwright verification of UI changes without a valid `.env` file or mocked Firebase.
**Action:** When verifying frontend changes, ensure Firebase environment variables are set, or rely on `npm run build` (tsc) for static analysis if runtime verification is blocked by missing credentials.

## 2024-06-12 - Missing Memoization Implementation
**Learning:** An architectural guideline or memory explicitly specified that the `ColorIdentity` component was memoized to prevent unnecessary re-renders in list views. However, the actual code implementation simply exported a standard function without `React.memo()`. This is a classic example of documentation or "intended design" drifting from the actual codebase reality.
**Action:** When optimizing, always verify that expected performance patterns (like memoization on frequently-rendered list items) are actually present in the source code, rather than assuming they exist based on documentation or prior knowledge.
