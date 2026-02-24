## 2024-05-22 - Timing Attack on Worker Authentication

**Vulnerability:** The `isWorkerRequest` function in `api/lib/auth.ts` used a direct string comparison (`secret === expected`) to validate the `X-Worker-Secret` header against the `WORKER_SECRET` environment variable.

**Learning:** This implementation is vulnerable to timing attacks, where an attacker can deduce the secret character by character by measuring the response time of the request. Standard string comparison returns `false` as soon as a mismatch is found, leaking information about the matching prefix length.

**Prevention:** Always use `crypto.timingSafeEqual` (or a constant-time comparison library) when comparing secrets or hashes. Ensure both inputs are of the same length (e.g., by hashing them first) to avoid leaking length information or causing runtime errors.

## 2024-05-23 - .dck File Injection Vulnerability

**Vulnerability:** The `.dck` file generation logic in `api/lib/ingestion/to-dck.ts` did not sanitize deck names or card names, allowing attackers to inject newlines and control characters. This could be used to manipulate file metadata or inject arbitrary content into the generated file.

**Learning:** File format generators must treat all inputs as untrusted, especially when the format relies on line breaks or delimiters. Even if the file isn't executed directly, injected content can lead to logic errors or parser exploits in downstream consumers (like Forge).

**Prevention:** Sanitize all string inputs used in file generation. Remove control characters (including newlines) or properly escape them according to the target file format's specification.

## 2024-05-24 - Sensitive Data Exposure in Process List

**Vulnerability:** The worker service passed full deck contents as base64-encoded environment variables (`DECK_N_B64`) to the simulation containers via command-line arguments. This exposed sensitive user data to any user on the host system capable of running `ps aux` or inspecting `/proc/PID/environ`.

**Learning:** Passing large or sensitive data via environment variables on the command line is insecure because process arguments and environment blocks are often visible to other users. It also risks hitting shell or kernel command-line length limits.

**Prevention:** Use temporary files and volume mounts to pass large or sensitive data to containers. Ensure the temporary files are created with restricted permissions (though Docker volume mounting usually requires read access) and cleaned up immediately after use.
