## 2024-05-22 - Timing Attack on Worker Authentication

**Vulnerability:** The `isWorkerRequest` function in `orchestrator-service/lib/auth.ts` used a direct string comparison (`secret === expected`) to validate the `X-Worker-Secret` header against the `WORKER_SECRET` environment variable.

**Learning:** This implementation is vulnerable to timing attacks, where an attacker can deduce the secret character by character by measuring the response time of the request. Standard string comparison returns `false` as soon as a mismatch is found, leaking information about the matching prefix length.

**Prevention:** Always use `crypto.timingSafeEqual` (or a constant-time comparison library) when comparing secrets or hashes. Ensure both inputs are of the same length (e.g., by hashing them first) to avoid leaking length information or causing runtime errors.

## 2024-05-30 - File Format Injection in .dck Generation

**Vulnerability:** The `.dck` file generator in `orchestrator-service/lib/ingestion/to-dck.ts` did not sanitize newlines in user-supplied deck names and card names. This allowed an attacker to inject arbitrary sections or key-value pairs into the generated `.dck` file (e.g., overriding metadata or injecting cards).

**Learning:** Text-based file formats (INI, DCK, etc.) are vulnerable to injection attacks if newlines are not treated as delimiters. Simple string interpolation is insufficient when generating structured text files from untrusted input.

**Prevention:** Always sanitize input used in file generation by removing or escaping control characters, especially newlines (`\n`, `\r`). Validate that the input conforms to the expected format (e.g., single line) before using it.
