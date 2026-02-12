## 2024-05-22 - Timing Attack on Worker Authentication

**Vulnerability:** The `isWorkerRequest` function in `api/lib/auth.ts` used a direct string comparison (`secret === expected`) to validate the `X-Worker-Secret` header against the `WORKER_SECRET` environment variable.

**Learning:** This implementation is vulnerable to timing attacks, where an attacker can deduce the secret character by character by measuring the response time of the request. Standard string comparison returns `false` as soon as a mismatch is found, leaking information about the matching prefix length.

**Prevention:** Always use `crypto.timingSafeEqual` (or a constant-time comparison library) when comparing secrets or hashes. Ensure both inputs are of the same length (e.g., by hashing them first) to avoid leaking length information or causing runtime errors.

## 2025-02-23 - Deck File Format Injection

**Vulnerability:** The `toDck` function in `api/lib/ingestion/to-dck.ts` did not sanitize deck names before writing them to the `.dck` file format (ini-style). This allowed attackers to inject newlines and create arbitrary sections (e.g., `[commander]`) or card entries by crafting a malicious deck name.

**Learning:** When generating structured files (like INI, YAML, CSV) from user input, always sanitize the input to remove delimiters or characters that have special meaning in that format. In INI files, newlines are structural delimiters.

**Prevention:** Sanitized `deck.name` and card names by replacing newlines and control characters with spaces before writing to the file. Added a regression test `api/test/security_dck_injection.test.ts` to prevent recurrence.
