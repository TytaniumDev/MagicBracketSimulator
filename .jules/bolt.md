## 2024-05-22 - Frontend Verification Requires Firebase
**Learning:** The frontend application crashes on initialization if Firebase API keys are missing (specifically `auth/invalid-api-key`). This prevents Playwright verification of UI changes without a valid `.env` file or mocked Firebase.
**Action:** When verifying frontend changes, ensure Firebase environment variables are set, or rely on `npm run build` (tsc) for static analysis if runtime verification is blocked by missing credentials.

## 2024-05-24 - File I/O Bottleneck in Log Analysis
**Learning:** The `forge-log-analyzer` was reading all raw log files (potentially hundreds of MBs) for every request, even when only cached metadata (condensed logs) was needed. This caused significant I/O overhead and memory usage.
**Action:** Implemented lazy loading for raw logs. Always check if metadata/cache can satisfy the request before reading raw files. Added `getJobMeta` and `countGameLogFiles` to separate metadata access from data access.
