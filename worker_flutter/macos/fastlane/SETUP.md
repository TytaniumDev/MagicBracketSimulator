# macOS code signing + notarization setup

Fastlane match + notarytool pipeline for distributing the Magic Bracket
worker as a signed, notarized `.app` outside the Mac App Store.

The certs live alongside BlinkBreak's (same Apple team `F2HXQGU2CC`) in
the private repo `TytaniumDev/TytaniumDev-certificates`.

> **Note:** Fastlane regenerates `README.md` in this directory on every run.
> Read this `SETUP.md` instead — it survives.

## Secrets

All secrets live in **Doppler**, project `blinkbreak`, config `prd`.
Both BlinkBreak's iOS pipeline and this macOS pipeline read from the same
config. The only GitHub Actions secret the workflow needs is
`DOPPLER_TOKEN` — everything else is pulled at runtime via
`doppler secrets download`.

Required Doppler keys (already populated for BlinkBreak; this pipeline
reuses them):

| Key | What it is |
|---|---|
| `MATCH_PASSWORD` | AES key for the certs repo. |
| `MATCH_KEYCHAIN_PASSWORD` | Password for the ephemeral CI keychain. |
| `MATCH_SSH_PRIVATE_KEY` | Private half of the SSH deploy key for the certs repo (must be added as a read-only deploy key on `TytaniumDev/TytaniumDev-certificates`). |
| `ASC_KEY_ID` | App Store Connect API key ID. |
| `ASC_ISSUER_ID` | Same page in App Store Connect. |
| `ASC_API_KEY_CONTENT` | Contents of the `AuthKey_<ID>.p8` file (raw or base64). |
| `ASC_API_KEY_IS_BASE64` | `"true"` if the previous is base64-encoded. |

## Running locally

```bash
cd worker_flutter/macos
bundle install
doppler run --project blinkbreak --config prd -- bundle exec fastlane release
```

`release` does: `sync_certs` → flutter macos release build → codesign →
notarize (waits on Apple ~1–3 min) → staple → zip. Output ends up at
`worker_flutter/build/worker_flutter-macos.zip`.

## Releasing via CI

Tag a release commit with `worker-v*` and push:

```bash
git tag worker-v0.1.0
git push origin worker-v0.1.0
```

The `release-worker-macos.yml` workflow signs, notarizes, and attaches
the zipped `.app` to the matching GitHub Release.

## Seed-certs (one-time, already done as of 2026-05-12)

The Developer ID Application cert + provisioning profile for
`com.tytaniumdev.magicBracketSimulator` have already been seeded into
the certs repo (commits visible in `TytaniumDev/TytaniumDev-certificates`
under `certs/developer_id/` and `profiles/developer_id/`). If you ever
need to re-seed (e.g. after cert revocation), the steps are documented
in the Fastfile header.

## Known issue: fastlane G2 cert preference

Fastlane 2.234.0 defaults to creating `DEVELOPER_ID_APPLICATION_G2` certs,
which Apple's API rejects unless your team is enrolled in the G2 program.
The Fastfile is paired with a small `RUBYOPT=-r/path/to/patch.rb`
workaround in the original cert-seeding session that reverses fastlane's
type preference. Day-to-day runs of `release` (which uses the existing
cert in the repo) don't need the patch.
