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

## Auto-update flow

The worker has two independent update channels:

1. **Forge updates** — manifest-driven, no .app release needed.
   - Source of truth: `worker_flutter/forge-manifest.json`.
   - Fetched at boot from raw.githubusercontent.com on `main`.
   - To bump Forge: download the new tarball, compute its sha256,
     update the manifest JSON, commit + push to `main`. Existing
     installs pick it up on next launch — the installer cleans the
     old jar, verifies the new sha256, extracts.

2. **App updates** — Sparkle appcast at `worker_flutter/appcast.xml`.
   - Fetched at boot (and every hour while running) from
     raw.githubusercontent.com on `main`.
   - One appcast covers both platforms; each `<item>` has a
     `<sparkle:os>` tag so macOS clients ignore Windows items and
     vice-versa.
   - To release a new app version:
     1. Bump `version:` in `worker_flutter/pubspec.yaml` (e.g.
        `0.1.0+1` → `0.2.0+2`). The `+N` is the monotonic build
        number Sparkle uses internally.
     2. Tag the commit (e.g. `worker-v0.2.0`) and push. Both
        release workflows fire:
        - `release-worker-macos.yml` (macos-14): signs, notarizes,
          attaches `worker_flutter-macos.zip`.
        - `release-worker-windows.yml` (windows-latest): builds
          unsigned, attaches `worker_flutter-windows.zip`.
     3. Add new `<item>` entries to `appcast.xml` (one per OS;
        `<sparkle:os>macos</sparkle:os>` or `windows`). Commit +
        push to `main`.
     4. Existing installs see the update within ~1 hour.

### EdDSA signing of appcast entries (macOS) — ENABLED

The macOS release workflow runs `sign_update` against the notarized
zip and produces a `sparkle-manifest.json` next to it. The host app
embeds the public key (`SUPublicEDKey`) in `Info.plist`, so Sparkle 2
will refuse to install any update whose appcast entry lacks a
matching `sparkle:edSignature`.

Setup (already done on 2026-05-13):

- The Ed25519 keypair was generated with Sparkle's `generate_keys`
  (the `mbs-prod` keychain account on the maintainer's machine holds
  the private half).
- The public key (`+IEgM5RRA9Fq9nlcBaBaZY1jrKAIYu+XT6uvbfAbCfY=`) is
  embedded in `worker_flutter/macos/Runner/Info.plist` under
  `SUPublicEDKey`.
- The base64-encoded private seed lives in the
  `SPARKLE_ED_PRIVATE_KEY` GitHub Actions secret.

Per release, the workflow:

1. Builds, signs, and notarizes the .app → produces `worker_flutter-macos.zip`.
2. Runs `sign_update --ed-key-file -` against the zip with the
   private key streamed via stdin → captures `sparkle:edSignature`
   and `length`.
3. Writes `build/sparkle-manifest.json` with `{tag, edSignature, length}`.
4. Attaches both the zip and the manifest to the GitHub Release.

To publish the new version to existing installs, add an
`<enclosure ... sparkle:edSignature="...">` line to `appcast.xml`
(values from the manifest), then commit + push to `main`.

### ⚠️ Key rotation warning

Existing installs verify update zips against the embedded
`SUPublicEDKey`. Replacing it before all users have updated past
the change will permanently strand pre-rotation installs — they
cannot accept any future update zip signed with the new key.
Rotation requires a transition release whose update is signed with
BOTH keys (Sparkle 2 supports `SUPublicEDKey` as a comma-separated
list during transition windows).

### DSA signing of appcast entries (Windows) — ENABLED

WinSparkle (0.8.x) refuses to install an update unless the appcast
entry carries a `sparkle:dsaSignature` attribute that validates against
the DSA public key embedded in the .exe.

Setup (already done on 2026-05-13):

- DSA keypair generated locally with `openssl dsaparam -genkey` (2048
  bits).
- The public key (`dsa_pub.pem`) lives at
  `worker_flutter/windows/runner/dsa_pub.pem` and is referenced from
  `Runner.rc` as a `DSAPub`/`DSAPEM` resource — Flutter's Windows
  build embeds it into the .exe automatically.
- The private half is stored in the `SPARKLE_DSA_PRIVATE_KEY` GitHub
  Actions secret.

Per release, `release-worker-windows.yml`:

1. Builds the Windows runner and zips it.
2. Streams the private key from the secret into a tempfile, runs
   `openssl dgst -sha1 -binary < zip | openssl dgst -sha1 -sign priv
   | openssl enc -base64` (exactly what WinSparkle's `sign_update.bat`
   does), and captures the signature.
3. Writes `build/sparkle-manifest-windows.json` carrying
   `{tag, dsaSignature, length}`.
4. Attaches both the zip and the manifest to the GitHub Release.

To publish to existing installs, copy `dsaSignature` and `length`
from the manifest into the appcast item's `<enclosure>` tag as
`sparkle:dsaSignature="..." length="..."` and commit + push to `main`.

### ⚠️ Key rotation warning (Windows)

The DSA public key is compiled into the .exe via Runner.rc. Rotating
the key strands every existing install — they verify against the
public key from their installed version. Plan rotation through a
transition release that ships a new .exe carrying the new public key
before any update is signed only with the new private key.

### ⚠️ Pre-go-live TODO: Authenticode signing of the .exe

The Windows .exe ships unsigned. Every user will see "Windows protected
your PC" on first launch and have to click *More info → Run anyway*.
Long-term fixes:

- Buy an OV code-signing cert (~$100–300/yr) — SmartScreen still warns
  briefly per publisher until reputation accumulates, then trusts.
- Buy an EV code-signing cert (~$300–700/yr) — instant SmartScreen pass.
- Use Microsoft Trusted Signing (newer, $9.99/mo + Azure setup).

Whichever route, the GitHub Actions step that signs is the same shape
as macOS Fastlane: pull cert (typically a `.pfx` blob) from Doppler,
run `signtool sign /f cert.pfx /p $PASS /t http://timestamp.digicert.com worker_flutter.exe` before zipping.

## Known issue: fastlane G2 cert preference

Fastlane 2.234.0 defaults to creating `DEVELOPER_ID_APPLICATION_G2` certs,
which Apple's API rejects unless your team is enrolled in the G2 program.
The Fastfile is paired with a small `RUBYOPT=-r/path/to/patch.rb`
workaround in the original cert-seeding session that reverses fastlane's
type preference. Day-to-day runs of `release` (which uses the existing
cert in the repo) don't need the patch.
