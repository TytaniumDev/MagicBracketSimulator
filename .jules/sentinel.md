## 2024-05-22 - Timing Attack on Worker Authentication

**Vulnerability:** The `isWorkerRequest` function in `orchestrator-service/lib/auth.ts` used a direct string comparison (`secret === expected`) to validate the `X-Worker-Secret` header against the `WORKER_SECRET` environment variable.

**Learning:** This implementation is vulnerable to timing attacks, where an attacker can deduce the secret character by character by measuring the response time of the request. Standard string comparison returns `false` as soon as a mismatch is found, leaking information about the matching prefix length.

**Prevention:** Always use `crypto.timingSafeEqual` (or a constant-time comparison library) when comparing secrets or hashes. Ensure both inputs are of the same length (e.g., by hashing them first) to avoid leaking length information or causing runtime errors.

## 2024-05-23 - File Format Injection via Card Names

**Vulnerability:** The `toDck` function in `orchestrator-service/lib/ingestion/to-dck.ts` did not sanitize card names, allowing newline characters (`\n`) to be injected into generated `.dck` files. This could allow attackers to inject arbitrary lines into the deck file (e.g. metadata overrides, extra cards) if they could control the card name (e.g. via a malicious Moxfield deck or API response).

**Learning:** When generating line-based file formats (like Forge's `.dck` or `.ini`), user input must be strictly sanitized to remove control characters, especially newlines. Splitting input by newline is not enough if the input is re-assembled without sanitization.

**Prevention:** Always strip control characters (`\x00-\x1F`) from user input before writing to files or logs. Use strict allowlists where possible.
