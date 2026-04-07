## 2024-05-22 - Timing Attack on Worker Authentication

**Vulnerability:** The `isWorkerRequest` function in `api/lib/auth.ts` used a direct string comparison (`secret === expected`) to validate the `X-Worker-Secret` header against the `WORKER_SECRET` environment variable.

**Learning:** This implementation is vulnerable to timing attacks, where an attacker can deduce the secret character by character by measuring the response time of the request. Standard string comparison returns `false` as soon as a mismatch is found, leaking information about the matching prefix length.

**Prevention:** Always use `crypto.timingSafeEqual` (or a constant-time comparison library) when comparing secrets or hashes. Ensure both inputs are of the same length (e.g., by hashing them first) to avoid leaking length information or causing runtime errors.

## 2024-05-23 - .dck File Injection Vulnerability

**Vulnerability:** The `.dck` file generation logic in `api/lib/ingestion/to-dck.ts` did not sanitize deck names or card names, allowing attackers to inject newlines and control characters. This could be used to manipulate file metadata or inject arbitrary content into the generated file.

**Learning:** File format generators must treat all inputs as untrusted, especially when the format relies on line breaks or delimiters. Even if the file isn't executed directly, injected content can lead to logic errors or parser exploits in downstream consumers (like Forge).

**Prevention:** Sanitize all string inputs used in file generation. Remove control characters (including newlines) or properly escape them according to the target file format's specification.
## 2025-02-18 - SSRF / URL Validation in Deck Links

**Vulnerability:** The deck link validation in `api/app/api/decks/route.ts` used a simple regular expression `^https?:\/\//i` to validate manually provided URLs (`deckLink`). This was insufficient as it allowed malformed URLs, URLs with embedded credentials (e.g. `http://user:pass@evil.com`), and potentially bypassed strict URL parsing expected by other components or the frontend.

**Learning:** Regular expressions are rarely sufficient for comprehensive URL validation. Attackers can craft tricky inputs that bypass regex checks but are interpreted as valid (and potentially malicious) URLs by the browser or HTTP clients.

**Prevention:** Always use the built-in `URL` constructor to parse, validate, and extract components from user-provided URLs. Checking the `protocol` property of the parsed `URL` object is the most robust way to ensure safe schemes like `http:` or `https:`.
## 2025-02-18 - CORS Wildcard and Credentials Vulnerability

**Vulnerability:** The CORS implementation in `api/middleware.ts` allowed specifying a wildcard `*` in `CORS_ALLOWED_ORIGINS`, which caused the middleware to dynamically reflect any requesting origin and always set `Access-Control-Allow-Credentials: true`.

**Learning:** Combining dynamic origin reflection with allowed credentials defeats CORS entirely. A malicious site can make authenticated cross-origin requests, have its own origin reflected back, and successfully read the response, bypassing browser security policies. The CORS specification forbids `Access-Control-Allow-Origin: *` when credentials are true for this very reason, but dynamic reflection bypassed this check.

**Prevention:** When wildcard `*` is intended to allow any origin, literal `*` should be returned as the `Access-Control-Allow-Origin` and `Access-Control-Allow-Credentials` must be `false` (or omitted). Only return `Access-Control-Allow-Credentials: true` when matching explicitly configured, trusted origins.
