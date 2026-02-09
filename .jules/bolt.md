## 2024-05-22 - Frontend Verification Requires Firebase
**Learning:** The frontend application crashes on initialization if Firebase API keys are missing (specifically `auth/invalid-api-key`). This prevents Playwright verification of UI changes without a valid `.env` file or mocked Firebase.
**Action:** When verifying frontend changes, ensure Firebase environment variables are set, or rely on `npm run build` (tsc) for static analysis if runtime verification is blocked by missing credentials.
