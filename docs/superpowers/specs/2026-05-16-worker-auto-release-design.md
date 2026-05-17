# Desktop Worker — Auto-Release on PR Merge

**Date:** 2026-05-16
**Status:** Draft
**Surface:** `.github/workflows/release-worker.yml`, `worker_flutter/appcast.xml`

## Motivation

The desktop worker's auto-update path has been silently broken since the
project's first release:

- `worker_flutter/appcast.xml` has a single `<item>` pointing at
  `worker-v0.1.0/worker_flutter-macos.zip` — that release no longer
  exists on GitHub (404).
- The entry has no `sparkle:edSignature`, so Sparkle 2 with
  `SUPublicEDKey` set in the Info.plist would refuse to install it
  anyway.
- Every "Build N" CI prerelease (build-3 through build-7) has working,
  signed artifacts attached, but **none of them are listed in the
  appcast**, so Sparkle can't discover them.

Net effect: every install is stuck on whatever it originally downloaded.
A real user (the project owner) is currently running Build 2
(`CFBundleVersion=2`, code from `aa4daae`), which predates PR #211. That
build calls `signInWithProvider` on macOS, which is broken on the
desktop port of `firebase_auth` — surfacing as
`[firebase_auth/null-error] Host platform returned null value for
non-null return value`. PR #211 (Build 3+) fixed the auth path by
routing macOS through PKCE + `signInWithCredential`, but the user can't
reach that fix because Sparkle has no way to offer it.

This design replaces the manual "tag a worker-v* commit + remember to
hand-edit appcast.xml" flow with a CI workflow that runs on every PR
merge: bump → tag → build → sign → release → publish to appcast.

## Scope

### In scope

- Modify `.github/workflows/release-worker.yml` so a PR merge to `main`
  triggers a full release cycle.
- Compute the next version from `worker_flutter/pubspec.yaml`'s
  `MAJOR.MINOR` combined with the latest `worker-v*` tag's `PATCH+1`
  (see Version computation for the rule). Override the build's version
  via `--build-name` / `--build-number` flags at `flutter build` time.
  **`pubspec.yaml` is read by CI but never edited by CI.**
- Prepend a new `<item>` to `worker_flutter/appcast.xml` after each
  release succeeds, signed with the EdDSA key embedded in the binary.
- Preserve the manual `workflow_dispatch` escape hatch and the
  `push: tags: [worker-v*]` trigger (for the case where a human pushes a
  deliberate version bump like `worker-v1.0.0`).
- Remove the existing "Pre-release `build-<sha>`" code path (the
  `prerelease`/`name`/`tag` branching in the `version` job) — every main
  push now produces a real tagged release.
- Delete the stale `worker-v0.1.0` `<item>` from appcast.xml so Sparkle
  isn't tripping over an entry whose enclosure URL 404s.

### Out of scope

- Conventional-commits parsing (`feat:` → minor, `fix:` → patch). The
  recommended versioning is "always patch-bump" with manual minor/major
  bumps done by tagging `worker-vX.Y.0` explicitly. Adding commit
  parsing is a follow-up if patch-only proves limiting.
- Changelog generation. The GitHub Release body stays as-is (basic
  default).
- Linux builds. macOS and Windows only, matching the current workflow.
- Backfilling a release for Build 3–7 (the workflow's first run after
  merge will produce a fresh `worker-v0.2.0`; users skip straight to
  that).

## Design

### Trigger surface

Three triggers, all funneling into the same `version` job:

| Trigger                          | Version source                                   | Use case                              |
|----------------------------------|--------------------------------------------------|---------------------------------------|
| `push: branches: [main]`         | Computed (see Version computation)               | PR merge — the new default            |
| `push: tags: [worker-v*]`        | Use the ref name verbatim                        | Human deliberately cuts a minor/major |
| `workflow_dispatch`              | Computed (see Version computation)               | "Ship right now" button               |

`pull_request` is **not** a trigger — only merged work gets released.

### Version computation

`pubspec.yaml` is the source of `MAJOR.MINOR`. CI is the source of
`PATCH`. A human bumps minor/major by editing pubspec; everything else
is automatic.

The `version` job's logic, in order:

1. If the trigger is a tag push, set `VERSION` to the tag name with the
   `worker-v` prefix stripped (e.g. `worker-v0.3.0` → `0.3.0`). Skip the
   rest of the steps in this section.
2. Read `MAJOR.MINOR.PATCH` from `worker_flutter/pubspec.yaml`'s
   `version:` line. Call this `PUBSPEC_VER`. The `PATCH` value in
   pubspec is ignored — only `MAJOR.MINOR` matters.
3. Find the most recent `worker-v*` tag via
   `git tag --list 'worker-v*' --sort=-v:refname | head -1`. Parse its
   `MAJOR.MINOR.PATCH`. Call this `TAG_VER`.
4. Compute the candidate `BUMPED`:
   - If `TAG_VER`'s `MAJOR.MINOR` == `PUBSPEC_VER`'s `MAJOR.MINOR`:
     `BUMPED = TAG_VER` with `PATCH + 1`. (Normal patch-bump path.)
   - Otherwise: `BUMPED = PUBSPEC_VER`'s `MAJOR.MINOR` + `.0`. (The
     human edited pubspec to a new minor/major — start fresh at `.0`.)
   - If no `worker-v*` tag exists at all: `BUMPED = PUBSPEC_VER`'s
     `MAJOR.MINOR` + `.0`.
5. Sanity check: `BUMPED` must be strictly greater than `TAG_VER` under
   semver comparison. If not (e.g. a human accidentally regresses
   pubspec), fail loudly so the release doesn't ship a downgrade.
6. Set `VERSION = BUMPED`. Set the build number to `github.run_number`
   (preserves Sparkle's monotonic version comparison).
7. Export `version=X.Y.Z`, `build_number=N`, `tag=worker-vX.Y.Z` as job
   outputs.

**Worked examples** for the rules above:

| `pubspec.yaml` | Latest tag       | Computed version | Why                                  |
|----------------|------------------|------------------|--------------------------------------|
| `0.2.0+1`      | `worker-v0.1.0`  | `0.2.0`          | pubspec MAJOR.MINOR exceeds tag      |
| `0.2.0+1`      | `worker-v0.2.5`  | `0.2.6`          | Normal patch bump                    |
| `0.2.0+1`      | (none)           | `0.2.0`          | First release                        |
| `0.3.0+1`      | `worker-v0.2.42` | `0.3.0`          | Human bumped minor → reset patch     |
| `1.0.0+1`      | `worker-v0.9.3`  | `1.0.0`          | Human bumped major → reset patch     |

This makes `worker_flutter/pubspec.yaml`'s version line meaningful in
source — it's the upper-half of the version, locally and in CI. The
`+BUILD_NUMBER` suffix in pubspec is still cosmetic (CI overrides it
via `--build-number`).

After computing the version, the `version` job creates and pushes the
git tag using the default `GITHUB_TOKEN`:

```yaml
- name: Tag and push
  if: github.event_name != 'push' || !startsWith(github.ref, 'refs/tags/')
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: |
    git tag "$TAG" "$GITHUB_SHA"
    git push origin "$TAG"
```

`GITHUB_TOKEN`-driven tag pushes do **not** retrigger workflows. This
is intentional — the same workflow run continues into `build-macos`,
`build-windows`, `publish`, and `update-appcast` without a new run
being spawned.

### Build flags

Both `build-macos` (in `worker_flutter/macos/fastlane/Fastfile`) and
`build-windows` (in `.github/workflows/release-worker.yml`) currently
read the version from pubspec because the workflow's "Bump pubspec
version" step writes it there. **That step is removed.** Instead, both
build invocations pass:

```bash
flutter build <macos|windows> --release \
  --obfuscate --split-debug-info=build/debug-info/<platform> \
  --build-name="${{ needs.version.outputs.version }}" \
  --build-number="${{ needs.version.outputs.build_number }}" \
  --dart-define=...
```

`--build-name` sets `CFBundleShortVersionString`; `--build-number` sets
`CFBundleVersion`. These are what Sparkle's `sparkle:version` field
compares against on the client. `pubspec.yaml`'s `MAJOR.MINOR` is read
by the `version` job (see Version computation) but the file itself is
untouched by CI.

### Appcast update

A new `update-appcast` job runs after `publish` succeeds:

```yaml
update-appcast:
  needs: [version, publish]
  runs-on: ubuntu-latest
  permissions:
    contents: write
  steps:
    - uses: actions/checkout@v4
      with:
        ref: main
        token: ${{ secrets.GITHUB_TOKEN }}
    - uses: actions/download-artifact@v4
      with:
        name: macos
        path: artifacts/macos
    - name: Prepend appcast item
      run: |
        # read sparkle-manifest.json, prepend new <item> to appcast.xml
        # (see "Appcast item generation" below)
    - name: Commit
      run: |
        git config user.name "github-actions[bot]"
        git config user.email "github-actions[bot]@users.noreply.github.com"
        git add worker_flutter/appcast.xml
        git commit -m "chore(appcast): publish ${{ needs.version.outputs.tag }} [skip ci]"
        git push origin main
```

The `[skip ci]` marker is belt-and-suspenders — GITHUB_TOKEN pushes
already don't trigger workflows, but it makes the intent explicit for
humans reading the log.

### Appcast item generation

The new `<item>` is built from `sparkle-manifest.json` (already
produced by the existing `Sign zip for Sparkle (EdDSA)` step). Format:

```xml
<item>
  <title>Version X.Y.Z (macOS)</title>
  <sparkle:os>macos</sparkle:os>
  <pubDate>RFC 822 date from `date -u`</pubDate>
  <sparkle:version>BUILD_NUMBER</sparkle:version>
  <sparkle:shortVersionString>X.Y.Z</sparkle:shortVersionString>
  <sparkle:minimumSystemVersion>11.0</sparkle:minimumSystemVersion>
  <enclosure
    url="https://github.com/TytaniumDev/MagicBracketSimulator/releases/download/worker-vX.Y.Z/worker_flutter-macos.zip"
    sparkle:edSignature="<from manifest>"
    length="<from manifest>"
    type="application/octet-stream" />
</item>
```

Insertion: prepend immediately after the `<language>en</language>` line
so the newest entry is on top. Implementation is a `python3` one-liner
or a small `sed`/`yq`/`xq` script — exact tool chosen during
implementation. No XML-comment preservation guarantees beyond what
`xml.etree` gives for free.

A symmetric `<item>` for Windows is **not** generated in this design.
The existing `appcast.xml` reserves Windows for a future appcast (or a
separate file with a `<sparkle:os>windows</sparkle:os>` entry once
WinSparkle integration is verified end-to-end). The DSA-signed Windows
zip still ships to the GitHub Release; WinSparkle just won't auto-update
yet. This matches the comment block already in `appcast.xml`.

### Stale v0.1.0 item

The current `<item>` for v0.1.0 is deleted in the same PR that ships
this workflow change. The release it points to (`worker-v0.1.0`) is
already a 404 and the entry has no signature, so removing it loses
nothing.

### Cleanup of the prerelease path

The `version` job today branches on tag vs. non-tag to produce either a
`worker-v*` release or a `build-<sha>` prerelease. With the new
design, the non-tag branch is *the* main path (just with auto-bumped
versions), so:

- Delete the `if [[ "${REF}" == refs/tags/* ]] ... else ...` branch.
- Delete the `prerelease` output and the corresponding `prerelease:`
  field in the `publish` job.
- Existing `build-<sha>` prereleases on GitHub (build-1 through build-7)
  are left in place. They're useful artifacts; manually deleting them is
  not in scope.

## Failure modes

| Scenario                                            | Outcome                                                                                                                       |
|-----------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------|
| Tag push step fails (network, permission)           | Workflow fails before build. No release, no appcast update. PR is merged but no release ships. Re-run the workflow to recover.|
| `build-macos` fails (notarization flake)            | Tag was already pushed. No `.app` artifact, no Release, no appcast update. **Dead tag remains.** Next merge bumps past it.    |
| `build-windows` fails                               | `build-macos` may have succeeded but `publish` won't run (it `needs: [build-macos, build-windows]`). No Release, no appcast.  |
| `publish` succeeds, `update-appcast` fails          | Users see the Release on GitHub but Sparkle doesn't offer it. Re-run the `update-appcast` job manually, or hand-edit appcast. |
| Two PRs merge within seconds                        | GitHub queues workflow runs; they execute sequentially. Each one reads the latest tag, so each gets a unique patch bump.      |
| Human pushes `worker-v0.5.0` while auto-bumps go    | Tag-push trigger uses the ref name verbatim, skipping bump. Next merge reads `0.5.0` as latest and bumps to `0.5.1`.           |

The "dead tag" outcome is the chief tradeoff. Alternatives — tagging
after build succeeds, or rolling tags back on failure — add meaningful
complexity (multiple workflow jobs reorder, or tags become non-immutable
which breaks GitHub Release expectations) for an event that should be
rare (notary flakes recover on rerun). We accept dead tags as the
simpler failure mode.

## Open questions

None.

## Testing

The workflow itself can't be unit-tested. Verification is done by
running it:

1. Merge the PR that ships this design. The PR bumps
   `worker_flutter/pubspec.yaml` to `0.2.0+1`; because the only existing
   `worker-v*` tag is `worker-v0.1.0`, the version computation rule
   produces `0.2.0` (pubspec MAJOR.MINOR beats the tag's MAJOR.MINOR).
2. Observe the workflow run: `version` job emits `worker-v0.2.0`, tag
   is pushed, builds succeed, GitHub Release `worker-v0.2.0` appears
   with `worker_flutter-macos.zip` + `sparkle-manifest.json` attached.
3. Observe the `update-appcast` commit on main: a new `<item>` for
   v0.2.0 appears in `worker_flutter/appcast.xml` with a real
   `sparkle:edSignature`.
4. On the existing Build 2 install: within the next Sparkle check
   interval (1 hour, or restart the app to trigger an immediate check),
   the "Update available" dialog should appear offering v0.2.0.
   Accepting it should download, verify the EdDSA signature against
   `SUPublicEDKey` in the running app's Info.plist, install, and
   relaunch.
5. After the relaunch, sign in to verify the PKCE flow works
   end-to-end. Check `~/Library/Logs/com.tytaniumdev.magicBracketSimulator.log`
   for any `Sentry capture:` lines (the tee-into-log hook from
   `main.dart:62-70`). If sign-in succeeds, none should appear; if it
   fails, the captured event confirms Sentry is firing in production.

A subsequent trivial PR merge (e.g. a typo fix in a comment) should
trigger another release cycle. pubspec still says `0.2.0+1`, the latest
tag is now `worker-v0.2.0`, so the rule produces `worker-v0.2.1`. A
corresponding new `<item>` in appcast.xml appears — proving the
auto-bump loop is healthy.

## Rollout

Single PR contains:

- `.github/workflows/release-worker.yml` — restructured per the design.
- `worker_flutter/appcast.xml` — stale v0.1.0 item deleted; the new
  v0.2.0 item is inserted *by CI*, not by hand in this PR.
- `worker_flutter/pubspec.yaml` — bumped from `0.1.0+1` to `0.2.0+1`.
  The `MAJOR.MINOR` (`0.2`) is read by CI to drive the release version;
  the `+1` build number is cosmetic (CI overrides via `--build-number`).
  Bumping minor/major in the future is a manual edit to this file.
- This design doc.

No new secrets, no new permissions beyond `contents: write` (which
the existing release workflow already has).
