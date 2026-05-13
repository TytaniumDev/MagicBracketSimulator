# macOS code signing + notarization

Fastlane match + notarytool pipeline for distributing the Magic Bracket
worker as a signed, notarized `.app` outside the Mac App Store.

The certs live alongside BlinkBreak's (same Apple team `F2HXQGU2CC`)
in the private repo `TytaniumDev/TytaniumDev-certificates` — which is
the renamed `BlinkBreak-certificates` repo, generalized for all of
this team's signing assets.

## One-time setup (manual)

Before the CI workflow can succeed:

- The cert storage repo must be renamed from `BlinkBreak-certificates`
  → `TytaniumDev-certificates` in GitHub (Settings → Repository name).
  GitHub auto-redirects the old name to the new one, so BlinkBreak's
  existing pipeline continues to work without changes; updating its
  Matchfile/Fastfile to the new name is a follow-up cleanup.
- A "Developer ID Application" cert must exist for team `F2HXQGU2CC`.
  As of 2026-05-12 the repo only has the iOS App Store cert.

1. **Create the cert in the Apple Developer portal** (or let match create
   it on first run — it will try). Required: a "Developer ID Application"
   cert for team `F2HXQGU2CC`. If you let match create it, your dev
   account needs the "Account Holder" or "Admin" role.

2. **Seed the cert into the certs repo locally:**

   ```bash
   cd worker_flutter/macos
   bundle install
   export MATCH_PASSWORD=...           # AES key for the certs repo
   export ASC_KEY_ID=...               # App Store Connect API key ID
   export ASC_ISSUER_ID=...
   export ASC_API_KEY_CONTENT=...      # contents of AuthKey_*.p8
   export ASC_API_KEY_IS_BASE64=false  # or "true" if base64-encoded
   bundle exec fastlane seed_certs
   ```

   This pushes a `developer_id/` directory into the certs repo. After it
   succeeds, the cert is available to CI and other developers.

3. **Add GitHub Actions secrets** to this repo (Settings → Secrets and
   variables → Actions):

   | Secret | Source |
   |---|---|
   | `MATCH_PASSWORD` | Same value as the local `MATCH_PASSWORD` above. |
   | `MATCH_KEYCHAIN_PASSWORD` | Any random string; CI uses it for the ephemeral keychain. |
   | `ASC_KEY_ID` | App Store Connect → Users and Access → Keys. |
   | `ASC_ISSUER_ID` | Same page. |
   | `ASC_API_KEY_CONTENT` | Contents of the `AuthKey_<ID>.p8` file (raw text or base64). |
   | `ASC_API_KEY_IS_BASE64` | `"true"` if you base64-encoded the previous; else omit. |
   | `CERTS_REPO_DEPLOY_KEY` | Private half of an SSH deploy key. Add the public half to `TytaniumDev-certificates` repo settings → Deploy keys, read-only. |

## Releasing

Tag a release commit with `worker-v*` and push:

```bash
git tag worker-v0.1.0
git push origin worker-v0.1.0
```

The `release-worker-macos.yml` workflow signs, notarizes, and attaches
the zipped `.app` to the GitHub release.

## Local signed build (smoke test)

```bash
cd worker_flutter/macos
# Same env vars as the "seed_certs" step above.
bundle exec fastlane release
open ../build/macos/Build/Products/Release/worker_flutter.app
```

If macOS refuses to open it ("damaged", "unidentified developer"), the
signing step didn't apply or notarization isn't stapled. Run with
`FASTLANE_VERBOSE=1 bundle exec fastlane release` to see the full log.
