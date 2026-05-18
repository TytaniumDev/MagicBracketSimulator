# Desktop Worker — Auto-Release on PR Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual `worker-v*` tagging + hand-edited appcast.xml flow with a workflow that runs on every PR merge: compute version → tag → build → sign → release → publish appcast item.

**Architecture:** `worker_flutter/pubspec.yaml`'s `MAJOR.MINOR` is the source of major/minor; CI bumps `PATCH` from the latest `worker-v*` git tag. Version is passed to `flutter build` via `--build-name`/`--build-number` flags (pubspec is read but never edited by CI). After release, a new `<item>` is prepended to `worker_flutter/appcast.xml` and committed back to `main` with `GITHUB_TOKEN`.

**Tech Stack:** GitHub Actions YAML, Python 3 (stdlib only: `argparse`, `re`, `json`, `unittest`), Bash, Fastlane (Ruby).

**Spec:** `docs/superpowers/specs/2026-05-16-worker-auto-release-design.md`

---

## File Structure

**New files:**
- `.github/scripts/compute_worker_version.py` — pure version computation (no I/O beyond stdin/stdout/argv). Inputs: pubspec MAJOR.MINOR + latest tag. Output: next semver.
- `.github/scripts/compute_worker_version_test.py` — `unittest`-based tests covering all 6 version-computation cases from the spec.
- `.github/scripts/prepend_appcast_item.py` — reads `sparkle-manifest.json` + appcast.xml, prepends a new `<item>` after `<language>en</language>`, writes appcast.xml in place.
- `.github/scripts/prepend_appcast_item_test.py` — `unittest`-based tests over a fixture appcast.

**Modified files:**
- `worker_flutter/pubspec.yaml` — `version: 0.1.0+1` → `version: 0.2.0+1`, with a comment block above explaining the CI/pubspec contract.
- `worker_flutter/appcast.xml` — delete the stale `<item>` for `worker-v0.1.0`.
- `worker_flutter/macos/fastlane/Fastfile` (the `release` lane) — read `BUILD_NAME` + `BUILD_NUMBER` from env, pass to `flutter build` via `--build-name`/`--build-number`.
- `.github/workflows/release-worker.yml` — restructured per the spec: new triggers, new version job, drop `build-<sha>` branching, new `update-appcast` job.
- `.github/workflows/ci.yml` — add a job that runs the Python tests on every PR so the scripts can't bit-rot.

**Boundaries:** The two Python scripts have one job each and are fully testable in isolation. The workflow YAML stays thin (orchestration only). The Fastfile change is minimal — it accepts new env vars and forwards them.

---

## Task 1: Add `compute_worker_version.py` with TDD

Implements the version computation rule from the spec (Section "Version computation"). Pure function: inputs are CLI args (pubspec MAJOR.MINOR string + latest tag string); output is the next semver to a single line on stdout.

**Files:**
- Create: `.github/scripts/compute_worker_version.py`
- Test: `.github/scripts/compute_worker_version_test.py`

- [ ] **Step 1: Create the scripts directory and write the failing test**

Create `.github/scripts/compute_worker_version_test.py`:

```python
"""Tests for compute_worker_version.py.

Run from repo root:
  python3 -m unittest .github/scripts/compute_worker_version_test.py

Each test invokes the script as a subprocess so the CLI surface itself
is exercised, not just the internal function. This matches how the
workflow calls it.
"""

import subprocess
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).parent / "compute_worker_version.py"


def run(pubspec_mm: str, latest_tag: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--pubspec-major-minor",
            pubspec_mm,
            "--latest-tag",
            latest_tag,
        ],
        capture_output=True,
        text=True,
    )


class ComputeWorkerVersionTest(unittest.TestCase):
    def test_pubspec_minor_exceeds_tag_minor_uses_pubspec(self) -> None:
        result = run("0.2", "worker-v0.1.0")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "0.2.0")

    def test_normal_patch_bump(self) -> None:
        result = run("0.2", "worker-v0.2.5")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "0.2.6")

    def test_first_release_no_tag(self) -> None:
        result = run("0.2", "")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "0.2.0")

    def test_minor_bump_resets_patch(self) -> None:
        result = run("0.3", "worker-v0.2.42")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "0.3.0")

    def test_major_bump_resets_patch(self) -> None:
        result = run("1.0", "worker-v0.9.3")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "1.0.0")

    def test_downgrade_fails_loudly(self) -> None:
        # pubspec regressed below current tag — the spec's sanity check.
        result = run("0.1", "worker-v0.2.0")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("downgrade", result.stderr.lower())

    def test_three_digit_patch_bump(self) -> None:
        # Guard against zero-padding / string-sort bugs in the patch bump.
        result = run("0.2", "worker-v0.2.99")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "0.2.100")

    def test_invalid_pubspec_format_fails(self) -> None:
        result = run("abc", "")
        self.assertNotEqual(result.returncode, 0)

    def test_invalid_tag_format_fails(self) -> None:
        result = run("0.2", "v0.2.0")  # missing 'worker-' prefix
        self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
python3 -m unittest .github/scripts/compute_worker_version_test.py -v
```

Expected: all 9 tests FAIL with `FileNotFoundError` or similar (script doesn't exist yet).

- [ ] **Step 3: Write the script**

Create `.github/scripts/compute_worker_version.py`:

```python
#!/usr/bin/env python3
"""Compute the next worker-v* version for a CI release.

Pure function over CLI args — no git, no file I/O. The caller (workflow
YAML) is responsible for reading pubspec and `git tag --list` and
passing the relevant values in.

Rule (matches docs/superpowers/specs/2026-05-16-worker-auto-release-design.md):
  - If latest tag's MAJOR.MINOR == pubspec MAJOR.MINOR: bump tag's PATCH by 1.
  - Otherwise: use pubspec MAJOR.MINOR + ".0".
  - If no latest tag: use pubspec MAJOR.MINOR + ".0".
  - Sanity check: result must be > latest tag (semver). Otherwise exit 1.

Usage:
  compute_worker_version.py --pubspec-major-minor 0.2 --latest-tag worker-v0.2.5
  -> prints "0.2.6"
"""

from __future__ import annotations

import argparse
import re
import sys

_MAJOR_MINOR_RE = re.compile(r"^(\d+)\.(\d+)$")
_TAG_RE = re.compile(r"^worker-v(\d+)\.(\d+)\.(\d+)$")


def parse_pubspec_major_minor(s: str) -> tuple[int, int]:
    m = _MAJOR_MINOR_RE.match(s)
    if not m:
        raise SystemExit(
            f"--pubspec-major-minor must look like 'X.Y' (got: {s!r})"
        )
    return int(m.group(1)), int(m.group(2))


def parse_tag(s: str) -> tuple[int, int, int] | None:
    if not s:
        return None
    m = _TAG_RE.match(s)
    if not m:
        raise SystemExit(
            f"--latest-tag must look like 'worker-vX.Y.Z' or empty (got: {s!r})"
        )
    return int(m.group(1)), int(m.group(2)), int(m.group(3))


def compute(pubspec_mm: tuple[int, int], tag: tuple[int, int, int] | None) -> tuple[int, int, int]:
    p_major, p_minor = pubspec_mm
    if tag is None:
        return (p_major, p_minor, 0)
    t_major, t_minor, t_patch = tag
    if (t_major, t_minor) == (p_major, p_minor):
        return (t_major, t_minor, t_patch + 1)
    return (p_major, p_minor, 0)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pubspec-major-minor", required=True)
    parser.add_argument("--latest-tag", required=True, help="Empty string if no tag yet")
    args = parser.parse_args()

    pubspec_mm = parse_pubspec_major_minor(args.pubspec_major_minor)
    tag = parse_tag(args.latest_tag)
    result = compute(pubspec_mm, tag)

    # Sanity: must be strictly > latest tag.
    if tag is not None and result <= tag:
        raise SystemExit(
            f"Computed version {result} is not greater than latest tag {tag}; "
            f"refusing to ship a downgrade. Check pubspec MAJOR.MINOR."
        )

    print(f"{result[0]}.{result[1]}.{result[2]}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
python3 -m unittest .github/scripts/compute_worker_version_test.py -v
```

Expected: all 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add .github/scripts/compute_worker_version.py .github/scripts/compute_worker_version_test.py
git commit -m "feat(release): add compute_worker_version.py + tests

Pure-function CLI that computes the next worker-v* version from
pubspec MAJOR.MINOR + the latest git tag. Tested in isolation; the
workflow YAML will call it with values read from pubspec and
\`git tag --list\`.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Add `prepend_appcast_item.py` with TDD

Inserts a new `<item>` block immediately after the `<language>en</language>` line so the newest entry sits at the top of the feed. Uses **raw text manipulation** (not XML parsing) to preserve the existing comment blocks in `appcast.xml` — `xml.etree.ElementTree` strips comments and is not safe for this file.

**Files:**
- Create: `.github/scripts/prepend_appcast_item.py`
- Test: `.github/scripts/prepend_appcast_item_test.py`

- [ ] **Step 1: Write the failing test**

Create `.github/scripts/prepend_appcast_item_test.py`:

```python
"""Tests for prepend_appcast_item.py.

Run from repo root:
  python3 -m unittest .github/scripts/prepend_appcast_item_test.py
"""

import json
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

SCRIPT = Path(__file__).parent / "prepend_appcast_item.py"

FIXTURE_APPCAST = textwrap.dedent(
    """\
    <?xml version="1.0" encoding="utf-8"?>
    <!--
      Comment block that MUST survive a rewrite.
    -->
    <rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
      <channel>
        <title>Magic Bracket Simulator</title>
        <description>Desktop worker.</description>
        <language>en</language>

        <!-- existing v0.2.0 item should stay below the new one -->
        <item>
          <title>Version 0.2.0 (macOS)</title>
          <sparkle:os>macos</sparkle:os>
          <sparkle:version>7</sparkle:version>
          <sparkle:shortVersionString>0.2.0</sparkle:shortVersionString>
          <enclosure url="https://example.com/old.zip" length="100" type="application/octet-stream" />
        </item>
      </channel>
    </rss>
    """
)

FIXTURE_MANIFEST = {
    "tag": "worker-v0.2.1",
    "version": "0.2.1+8",
    "edSignature": "abcDEF==",
    "length": 12345,
}


class PrependAppcastItemTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.appcast = Path(self.tmpdir.name) / "appcast.xml"
        self.appcast.write_text(FIXTURE_APPCAST)
        self.manifest = Path(self.tmpdir.name) / "sparkle-manifest.json"
        self.manifest.write_text(json.dumps(FIXTURE_MANIFEST))

    def run_script(self, *extra_args: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--appcast",
                str(self.appcast),
                "--manifest",
                str(self.manifest),
                "--version",
                "0.2.1",
                "--build-number",
                "8",
                "--enclosure-url",
                "https://github.com/Org/Repo/releases/download/worker-v0.2.1/worker_flutter-macos.zip",
                *extra_args,
            ],
            capture_output=True,
            text=True,
        )

    def test_new_item_is_at_the_top(self) -> None:
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        text = self.appcast.read_text()
        new_idx = text.find("<sparkle:shortVersionString>0.2.1</sparkle:shortVersionString>")
        old_idx = text.find("<sparkle:shortVersionString>0.2.0</sparkle:shortVersionString>")
        self.assertGreater(new_idx, -1, "new item missing")
        self.assertGreater(old_idx, -1, "old item missing")
        self.assertLess(new_idx, old_idx, "new item must precede old item")

    def test_existing_comments_are_preserved(self) -> None:
        self.run_script()
        text = self.appcast.read_text()
        self.assertIn("Comment block that MUST survive a rewrite", text)
        self.assertIn("existing v0.2.0 item should stay below", text)

    def test_signature_and_length_come_from_manifest(self) -> None:
        self.run_script()
        text = self.appcast.read_text()
        self.assertIn('sparkle:edSignature="abcDEF=="', text)
        self.assertIn('length="12345"', text)

    def test_enclosure_url_is_used_verbatim(self) -> None:
        self.run_script()
        text = self.appcast.read_text()
        self.assertIn(
            'url="https://github.com/Org/Repo/releases/download/worker-v0.2.1/worker_flutter-macos.zip"',
            text,
        )

    def test_sparkle_version_uses_build_number(self) -> None:
        self.run_script()
        text = self.appcast.read_text()
        # `sparkle:version` is the integer Sparkle uses to compare versions —
        # it must be the build number, not the semver short string.
        self.assertIn("<sparkle:version>8</sparkle:version>", text)

    def test_short_version_uses_semver(self) -> None:
        self.run_script()
        text = self.appcast.read_text()
        self.assertIn(
            "<sparkle:shortVersionString>0.2.1</sparkle:shortVersionString>",
            text,
        )

    def test_idempotent_marker_prevents_duplicate_insert(self) -> None:
        # If the script is re-run for the same version (e.g. workflow rerun),
        # it should NOT produce a duplicate item block — it should exit
        # non-zero with a clear message so the operator notices.
        self.run_script()
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("already", result.stderr.lower())

    def test_missing_anchor_fails_cleanly(self) -> None:
        # If the appcast has no <language>en</language> anchor, the script
        # must fail instead of silently writing the item to the wrong place.
        self.appcast.write_text("<rss></rss>")
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("anchor", result.stderr.lower())


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
python3 -m unittest .github/scripts/prepend_appcast_item_test.py -v
```

Expected: all 8 tests FAIL (script not present).

- [ ] **Step 3: Write the script**

Create `.github/scripts/prepend_appcast_item.py`:

```python
#!/usr/bin/env python3
"""Prepend a Sparkle <item> to worker_flutter/appcast.xml.

Reads ed-signature + byte length from a sparkle-manifest.json. Builds
the <item> from CLI args. Inserts immediately after the <language>en</language>
line so the newest entry is on top.

Raw text manipulation is intentional — xml.etree strips comments, and
the appcast file has important comments we don't want to lose.

Usage:
  prepend_appcast_item.py \\
    --appcast worker_flutter/appcast.xml \\
    --manifest artifacts/macos/sparkle-manifest.json \\
    --version 0.2.1 \\
    --build-number 8 \\
    --enclosure-url https://github.com/.../worker-v0.2.1/worker_flutter-macos.zip
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

_ANCHOR = "<language>en</language>"


def build_item(
    *,
    version: str,
    build_number: int,
    enclosure_url: str,
    ed_signature: str,
    length: int,
    pub_date: str,
) -> str:
    # Indented to match the existing channel-children indentation
    # (4 spaces) in worker_flutter/appcast.xml. The fixture in the test
    # uses the same indent. If the appcast formatting ever changes,
    # update both.
    return (
        "\n    <item>\n"
        f"      <title>Version {version} (macOS)</title>\n"
        "      <sparkle:os>macos</sparkle:os>\n"
        f"      <pubDate>{pub_date}</pubDate>\n"
        f"      <sparkle:version>{build_number}</sparkle:version>\n"
        f"      <sparkle:shortVersionString>{version}</sparkle:shortVersionString>\n"
        "      <sparkle:minimumSystemVersion>11.0</sparkle:minimumSystemVersion>\n"
        f'      <enclosure url="{enclosure_url}"\n'
        f'                 sparkle:edSignature="{ed_signature}"\n'
        f'                 length="{length}"\n'
        '                 type="application/octet-stream" />\n'
        "    </item>"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--appcast", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--version", required=True)
    parser.add_argument("--build-number", required=True, type=int)
    parser.add_argument("--enclosure-url", required=True)
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text())
    ed_signature = manifest["edSignature"]
    length = int(manifest["length"])

    appcast = args.appcast.read_text()

    # Idempotency guard: the version short string should appear exactly
    # once in the final file. If it's already present, the workflow has
    # rerun against the same release — bail with a clear message rather
    # than silently producing duplicate <item>s.
    short_marker = f"<sparkle:shortVersionString>{args.version}</sparkle:shortVersionString>"
    if short_marker in appcast:
        raise SystemExit(
            f"appcast.xml already contains an <item> for {args.version}; "
            "refusing to insert a duplicate."
        )

    if _ANCHOR not in appcast:
        raise SystemExit(
            f"appcast.xml does not contain the expected anchor {_ANCHOR!r}; "
            "refusing to insert at an unknown location."
        )

    pub_date = datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000")
    item = build_item(
        version=args.version,
        build_number=args.build_number,
        enclosure_url=args.enclosure_url,
        ed_signature=ed_signature,
        length=length,
        pub_date=pub_date,
    )

    insert_at = appcast.find(_ANCHOR) + len(_ANCHOR)
    updated = appcast[:insert_at] + item + appcast[insert_at:]
    args.appcast.write_text(updated)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
python3 -m unittest .github/scripts/prepend_appcast_item_test.py -v
```

Expected: all 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add .github/scripts/prepend_appcast_item.py .github/scripts/prepend_appcast_item_test.py
git commit -m "feat(release): add prepend_appcast_item.py + tests

Raw-text appcast updater that prepends a new <item> after
<language>en</language>, reads ed-signature + length from a
sparkle-manifest.json, and refuses to insert a duplicate if the
version is already present. Comments in appcast.xml are preserved
because we don't round-trip through xml.etree.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Bump `pubspec.yaml` to `0.2.0+1` with the new CI contract comment

**Files:**
- Modify: `worker_flutter/pubspec.yaml:4-5`

- [ ] **Step 1: Edit the version block**

Replace:

```yaml
name: worker_flutter
description: "Magic Bracket Simulator desktop worker (macOS)."
publish_to: 'none'
version: 0.1.0+1
```

with:

```yaml
name: worker_flutter
description: "Magic Bracket Simulator desktop worker (macOS)."
publish_to: 'none'
# MAJOR.MINOR (`0.2`) is read by .github/workflows/release-worker.yml
# to drive the next release version — CI bumps the PATCH automatically
# from the most recent `worker-v*` git tag. Bump MAJOR or MINOR here
# when you want the next release to start a new line (e.g. 0.3.0).
# The `+1` build number is cosmetic; CI overrides it with the workflow
# run number via `--build-number`.
version: 0.2.0+1
```

- [ ] **Step 2: Verify pubspec still parses**

Run from the `worker_flutter/` directory:
```bash
cd worker_flutter && flutter pub get
```

Expected: no errors, normal `Got dependencies!` output.

- [ ] **Step 3: Commit**

```bash
git add worker_flutter/pubspec.yaml
git commit -m "chore(worker): bump pubspec to 0.2.0 + document CI contract

CI reads MAJOR.MINOR from this file to drive the release version.
Bumping it manually is how a human cuts a minor/major release.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Delete the stale `worker-v0.1.0` item from `appcast.xml`

The release this item points to is a 404 and the entry has no `sparkle:edSignature`. With Task 6 the same workflow run will prepend the real `worker-v0.2.0` item, but we delete the stale one in this task so the appcast is correct even between the merge and the first successful run.

**Files:**
- Modify: `worker_flutter/appcast.xml`

- [ ] **Step 1: Read the current file**

Run:
```bash
cat worker_flutter/appcast.xml
```

Confirm the file contains an `<item>` block with `<sparkle:version>1</sparkle:version>` and `<sparkle:shortVersionString>0.1.0</sparkle:shortVersionString>`.

- [ ] **Step 2: Delete the stale item**

Remove the entire block:

```xml
    <!-- macOS (Sparkle) -->
    <item>
      <title>Version 0.1.0 (macOS)</title>
      <sparkle:os>macos</sparkle:os>
      <pubDate>Wed, 13 May 2026 06:37:00 -0700</pubDate>
      <sparkle:version>1</sparkle:version>
      <sparkle:shortVersionString>0.1.0</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>11.0</sparkle:minimumSystemVersion>
      <enclosure
        url="https://github.com/TytaniumDev/MagicBracketSimulator/releases/download/worker-v0.1.0/worker_flutter-macos.zip"
        type="application/octet-stream" />
    </item>
```

Leave the surrounding comment about the release flow and the `<language>en</language>` anchor in place. CI's `prepend_appcast_item.py` will insert items immediately after that anchor.

- [ ] **Step 3: Sanity-check the file is still well-formed XML**

Run:
```bash
python3 -c "import xml.etree.ElementTree as ET; ET.parse('worker_flutter/appcast.xml')"
```

Expected: no output (success). If it prints a `ParseError`, you've left a stray `</item>` or similar — fix it.

- [ ] **Step 4: Commit**

```bash
git add worker_flutter/appcast.xml
git commit -m "chore(appcast): remove stale worker-v0.1.0 entry

The worker-v0.1.0 GitHub Release was deleted; this entry's enclosure
URL has been a 404 for weeks. It also had no sparkle:edSignature, so
Sparkle 2 with SUPublicEDKey set would have refused to install it
anyway. CI will start prepending real signed entries after the first
auto-release run.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Modify the macOS `Fastfile` to accept `BUILD_NAME` / `BUILD_NUMBER` from env

Today the Fastfile relies on the workflow's "Bump pubspec version" step writing the version to `worker_flutter/pubspec.yaml` before `flutter build macos` reads it. That step is going away. The Fastfile must pass `--build-name` and `--build-number` explicitly so the binary still gets the right version regardless of what's in pubspec.

**Files:**
- Modify: `worker_flutter/macos/fastlane/Fastfile` (the `release` lane — the `sh "cd ../.. && flutter build macos ..."` call inside `Bundler.with_unbundled_env`)

- [ ] **Step 1: Read the current build invocation**

Open `worker_flutter/macos/fastlane/Fastfile` and locate this block inside `lane :release`:

```ruby
Bundler.with_unbundled_env do
  desktop_secret = ENV.fetch("GOOGLE_DESKTOP_OAUTH_CLIENT_SECRET", "")
  sentry_dsn     = ENV.fetch("SENTRY_DSN_WORKER", "")
  sentry_release = ENV.fetch("SENTRY_RELEASE", "worker_flutter@dev")
  git_sha        = ENV.fetch("GITHUB_SHA", "local")
  sh(
    "cd ../.. && flutter build macos --release " \
    "--obfuscate --split-debug-info=build/debug-info/macos " \
    "--dart-define=GOOGLE_DESKTOP_OAUTH_CLIENT_SECRET=#{desktop_secret.shellescape} " \
    "--dart-define=SENTRY_DSN=#{sentry_dsn.shellescape} " \
    "--dart-define=SENTRY_RELEASE=#{sentry_release.shellescape} " \
    "--dart-define=GIT_SHA=#{git_sha.shellescape}"
  )
end
```

- [ ] **Step 2: Read BUILD_NAME + BUILD_NUMBER from env and pass them in**

Replace the block above with:

```ruby
Bundler.with_unbundled_env do
  desktop_secret = ENV.fetch("GOOGLE_DESKTOP_OAUTH_CLIENT_SECRET", "")
  sentry_dsn     = ENV.fetch("SENTRY_DSN_WORKER", "")
  sentry_release = ENV.fetch("SENTRY_RELEASE", "worker_flutter@dev")
  git_sha        = ENV.fetch("GITHUB_SHA", "local")
  # BUILD_NAME + BUILD_NUMBER come from the release-worker.yml `version`
  # job. Required for CI builds (the workflow always sets them); for
  # local `bundle exec fastlane release` invocations they fall back to
  # whatever pubspec.yaml says, matching the historical behavior.
  build_name   = ENV.fetch("BUILD_NAME", "")
  build_number = ENV.fetch("BUILD_NUMBER", "")
  version_flags = ""
  unless build_name.empty?
    version_flags += " --build-name=#{build_name.shellescape}"
  end
  unless build_number.empty?
    version_flags += " --build-number=#{build_number.shellescape}"
  end
  sh(
    "cd ../.. && flutter build macos --release " \
    "--obfuscate --split-debug-info=build/debug-info/macos" \
    "#{version_flags} " \
    "--dart-define=GOOGLE_DESKTOP_OAUTH_CLIENT_SECRET=#{desktop_secret.shellescape} " \
    "--dart-define=SENTRY_DSN=#{sentry_dsn.shellescape} " \
    "--dart-define=SENTRY_RELEASE=#{sentry_release.shellescape} " \
    "--dart-define=GIT_SHA=#{git_sha.shellescape}"
  )
end
```

- [ ] **Step 3: Manually verify the Ruby parses**

Run:
```bash
ruby -c worker_flutter/macos/fastlane/Fastfile
```

Expected: `Syntax OK`. If it errors, you've likely missed a `"` or `\` continuation.

- [ ] **Step 4: Commit**

```bash
git add worker_flutter/macos/fastlane/Fastfile
git commit -m "feat(worker/fastlane): pass --build-name + --build-number from env

CI's new \`version\` job computes the next version and exports
BUILD_NAME + BUILD_NUMBER. Fastfile forwards them to \`flutter build
macos\` so the resulting binary's CFBundleShortVersionString /
CFBundleVersion match the git tag, regardless of what pubspec says.

Empty values fall back to pubspec — matches local-dev behavior.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Rewrite `.github/workflows/release-worker.yml`

This is the biggest change. The new workflow:
- Triggers on `push: main`, `push: tags: worker-v*`, and `workflow_dispatch`.
- `version` job computes the version (using `compute_worker_version.py`), tags the commit, exports outputs.
- `build-macos` + `build-windows` jobs pass `--build-name`/`--build-number` (the macOS path goes through the Fastfile change from Task 5; the Windows path is updated inline here).
- `publish` job is unchanged except for the dropped `prerelease` field.
- New `update-appcast` job runs `prepend_appcast_item.py` and commits the result.

**Files:**
- Modify: `.github/workflows/release-worker.yml` (full rewrite)

- [ ] **Step 1: Write the new workflow**

Replace the entire contents of `.github/workflows/release-worker.yml` with:

```yaml
name: Release magic-bracket-simulator

# One workflow, two platform builds, one GitHub Release, one appcast
# update. Runs on every merge to main (auto-bumped patch), on a manual
# `workflow_dispatch`, or on a hand-pushed `worker-v*` tag (for
# deliberate minor/major bumps that should jump past the auto-bump).

on:
  workflow_dispatch:
  push:
    branches:
      - main
    tags:
      - "worker-v*"

permissions:
  contents: write

jobs:
  version:
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.compute.outputs.version }}
      tag: ${{ steps.compute.outputs.tag }}
      build_number: ${{ steps.compute.outputs.build_number }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0  # need full history so `git tag --list` sees everything

      - name: Compute version + tag
        id: compute
        env:
          REF: ${{ github.ref }}
          BUILD_NUM: ${{ github.run_number }}
        run: |
          set -euo pipefail

          if [[ "${REF}" == refs/tags/worker-v* ]]; then
            # Tag-push trigger: use the ref name verbatim, skip computation.
            TAG="${REF#refs/tags/}"
            VERSION="${TAG#worker-v}"
          else
            # main-push or workflow_dispatch: read pubspec + latest tag,
            # compute the next version, and tag the current commit.
            PUBSPEC_MM=$(awk -F'[ .+]' '/^version:/{print $2"."$3}' worker_flutter/pubspec.yaml)
            LATEST_TAG=$(git tag --list 'worker-v*' --sort=-v:refname | head -1 || true)
            VERSION=$(python3 .github/scripts/compute_worker_version.py \
              --pubspec-major-minor "$PUBSPEC_MM" \
              --latest-tag "$LATEST_TAG")
            TAG="worker-v${VERSION}"

            git config user.name  "github-actions[bot]"
            git config user.email "github-actions[bot]@users.noreply.github.com"
            git tag "$TAG" "$GITHUB_SHA"
            git push origin "$TAG"
          fi

          echo "version=${VERSION}"              >> "$GITHUB_OUTPUT"
          echo "tag=${TAG}"                      >> "$GITHUB_OUTPUT"
          echo "build_number=${BUILD_NUM}"       >> "$GITHUB_OUTPUT"

  build-macos:
    needs: version
    runs-on: macos-15
    timeout-minutes: 45
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          ref: ${{ needs.version.outputs.tag }}

      - name: Install Doppler CLI
        uses: dopplerhq/cli-action@v3

      - name: Load secrets from Doppler
        env:
          DOPPLER_TOKEN: ${{ secrets.DOPPLER_BLINKBREAK_TOKEN }}
        run: |
          DELIM=$(openssl rand -hex 16)
          SECRETS=$(doppler secrets download --project blinkbreak --config prd --no-file --format json)
          KEYS='[
            "MATCH_PASSWORD",
            "MATCH_SSH_PRIVATE_KEY",
            "MATCH_KEYCHAIN_PASSWORD",
            "ASC_KEY_ID",
            "ASC_ISSUER_ID",
            "ASC_API_KEY_CONTENT",
            "ASC_API_KEY_IS_BASE64",
            "GOOGLE_DESKTOP_OAUTH_CLIENT_SECRET",
            "SENTRY_DSN_WORKER",
            "SENTRY_AUTH_TOKEN_WORKER"
          ]'
          echo "$SECRETS" | jq -r --argjson keys "$KEYS" '
            to_entries[] | select(.key | IN($keys[])) | .value
          ' | while IFS= read -r val; do
            [ -n "$val" ] && echo "::add-mask::$val"
          done
          echo "$SECRETS" | jq -r --argjson keys "$KEYS" --arg d "$DELIM" '
            to_entries[] | select(.key | IN($keys[])) | "\(.key)<<\($d)\n\(.value)\n\($d)"
          ' >> "$GITHUB_ENV"

      - name: Install SSH deploy key for certs repo
        env:
          MATCH_SSH_PRIVATE_KEY: ${{ env.MATCH_SSH_PRIVATE_KEY }}
        run: |
          mkdir -p ~/.ssh
          printf '%s\n' "$MATCH_SSH_PRIVATE_KEY" > ~/.ssh/match_deploy_key
          chmod 600 ~/.ssh/match_deploy_key
          ssh-keyscan github.com >> ~/.ssh/known_hosts 2>/dev/null

      - name: Install Flutter
        uses: subosito/flutter-action@v2
        with:
          channel: stable
          cache: true

      - name: Set up Ruby
        uses: ruby/setup-ruby@v1
        with:
          ruby-version: "3.3"
          bundler-cache: true
          working-directory: worker_flutter/macos

      - name: Install CocoaPods via Homebrew
        run: brew list cocoapods >/dev/null 2>&1 || brew install cocoapods

      - name: flutter pub get
        working-directory: worker_flutter
        run: flutter pub get

      - name: Pod install
        working-directory: worker_flutter/macos
        run: pod install --repo-update

      - name: Fastlane release (sign + notarize)
        working-directory: worker_flutter/macos
        env:
          MATCH_PASSWORD: ${{ env.MATCH_PASSWORD }}
          MATCH_KEYCHAIN_PASSWORD: ${{ env.MATCH_KEYCHAIN_PASSWORD }}
          ASC_KEY_ID: ${{ env.ASC_KEY_ID }}
          ASC_ISSUER_ID: ${{ env.ASC_ISSUER_ID }}
          ASC_API_KEY_CONTENT: ${{ env.ASC_API_KEY_CONTENT }}
          ASC_API_KEY_IS_BASE64: ${{ env.ASC_API_KEY_IS_BASE64 }}
          GOOGLE_DESKTOP_OAUTH_CLIENT_SECRET: ${{ env.GOOGLE_DESKTOP_OAUTH_CLIENT_SECRET }}
          SENTRY_DSN_WORKER: ${{ env.SENTRY_DSN_WORKER }}
          SENTRY_RELEASE: worker_flutter@${{ needs.version.outputs.version }}
          GITHUB_SHA: ${{ github.sha }}
          # New: drive --build-name / --build-number from the version job.
          BUILD_NAME: ${{ needs.version.outputs.version }}
          BUILD_NUMBER: ${{ needs.version.outputs.build_number }}
          FASTLANE_HIDE_CHANGELOG: "1"
          FASTLANE_SKIP_UPDATE_CHECK: "1"
          FASTLANE_DISABLE_COLORS: "1"
          GIT_SSH_COMMAND: "ssh -i ~/.ssh/match_deploy_key -o IdentitiesOnly=yes -o StrictHostKeyChecking=no"
        run: bundle exec fastlane release

      - name: Upload Dart debug symbols to Sentry (macOS)
        if: env.SENTRY_AUTH_TOKEN_WORKER != ''
        working-directory: worker_flutter
        env:
          SENTRY_AUTH_TOKEN: ${{ env.SENTRY_AUTH_TOKEN_WORKER }}
          SENTRY_RELEASE: worker_flutter@${{ needs.version.outputs.version }}
        continue-on-error: true
        run: dart run sentry_dart_plugin

      - name: Sign zip for Sparkle (EdDSA)
        env:
          SPARKLE_ED_PRIVATE_KEY: ${{ secrets.SPARKLE_ED_PRIVATE_KEY }}
          TAG: ${{ needs.version.outputs.tag }}
          VER: ${{ needs.version.outputs.version }}
        working-directory: worker_flutter
        run: |
          if [ -z "$SPARKLE_ED_PRIVATE_KEY" ]; then
            echo "::error::SPARKLE_ED_PRIVATE_KEY is unset" >&2
            exit 1
          fi
          ZIP=build/worker_flutter-macos.zip
          SIGN_UPDATE=macos/Pods/Sparkle/bin/sign_update
          SIG_LINE=$(printf '%s' "$SPARKLE_ED_PRIVATE_KEY" | "$SIGN_UPDATE" --ed-key-file - "$ZIP")
          echo "Sparkle signature line: $SIG_LINE"
          ED_SIG=$(echo "$SIG_LINE" | sed -n 's/.*sparkle:edSignature="\([^"]*\)".*/\1/p')
          LEN=$(echo "$SIG_LINE" | sed -n 's/.*length="\([^"]*\)".*/\1/p')
          if [ -z "$ED_SIG" ] || [ -z "$LEN" ]; then
            echo "::error::Failed to parse sign_update output: $SIG_LINE" >&2
            exit 1
          fi
          jq -n --arg sig "$ED_SIG" --arg len "$LEN" \
                --arg ref "$TAG" --arg ver "$VER" \
            '{tag: $ref, version: $ver, edSignature: $sig, length: ($len|tonumber)}' \
            > build/sparkle-manifest.json
          cat build/sparkle-manifest.json

      - name: Upload macOS artifact
        uses: actions/upload-artifact@v4
        with:
          name: macos
          path: |
            worker_flutter/build/worker_flutter-macos.zip
            worker_flutter/build/sparkle-manifest.json
          if-no-files-found: error

  build-windows:
    needs: version
    runs-on: windows-latest
    timeout-minutes: 45
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          ref: ${{ needs.version.outputs.tag }}

      - name: Install Doppler CLI
        uses: dopplerhq/cli-action@v3

      - name: Load secrets from Doppler
        shell: bash
        env:
          DOPPLER_TOKEN: ${{ secrets.DOPPLER_BLINKBREAK_TOKEN }}
        run: |
          fetch_secret() {
            doppler secrets get "$1" --project blinkbreak --config prd --plain
          }
          SECRET=$(fetch_secret GOOGLE_DESKTOP_OAUTH_CLIENT_SECRET)
          if [ -z "$SECRET" ]; then
            echo "::error::Doppler returned empty GOOGLE_DESKTOP_OAUTH_CLIENT_SECRET" >&2
            exit 1
          fi
          echo "::add-mask::$SECRET"
          echo "GOOGLE_DESKTOP_OAUTH_CLIENT_SECRET=$SECRET" >> "$GITHUB_ENV"

          SENTRY_DSN=$(fetch_secret SENTRY_DSN_WORKER || true)
          if [ -n "$SENTRY_DSN" ]; then
            echo "::add-mask::$SENTRY_DSN"
            echo "SENTRY_DSN_WORKER=$SENTRY_DSN" >> "$GITHUB_ENV"
          fi
          SENTRY_TOKEN=$(fetch_secret SENTRY_AUTH_TOKEN_WORKER || true)
          if [ -n "$SENTRY_TOKEN" ]; then
            echo "::add-mask::$SENTRY_TOKEN"
            echo "SENTRY_AUTH_TOKEN_WORKER=$SENTRY_TOKEN" >> "$GITHUB_ENV"
          fi

      - name: Install Flutter
        uses: subosito/flutter-action@v2
        with:
          channel: stable
          cache: true

      - name: flutter pub get
        working-directory: worker_flutter
        run: flutter pub get

      - name: flutter build windows --release
        working-directory: worker_flutter
        shell: bash
        env:
          DESKTOP_SECRET: ${{ env.GOOGLE_DESKTOP_OAUTH_CLIENT_SECRET }}
          SENTRY_DSN: ${{ env.SENTRY_DSN_WORKER }}
          SENTRY_RELEASE: worker_flutter@${{ needs.version.outputs.version }}
          GIT_SHA: ${{ github.sha }}
          BUILD_NAME: ${{ needs.version.outputs.version }}
          BUILD_NUMBER: ${{ needs.version.outputs.build_number }}
        run: |
          flutter build windows --release \
            --obfuscate \
            --split-debug-info=build/debug-info/windows \
            --build-name="$BUILD_NAME" \
            --build-number="$BUILD_NUMBER" \
            --dart-define=GOOGLE_DESKTOP_OAUTH_CLIENT_SECRET="$DESKTOP_SECRET" \
            --dart-define=SENTRY_DSN="$SENTRY_DSN" \
            --dart-define=SENTRY_RELEASE="$SENTRY_RELEASE" \
            --dart-define=GIT_SHA="$GIT_SHA"

      - name: Upload Dart debug symbols to Sentry (Windows)
        if: env.SENTRY_AUTH_TOKEN_WORKER != ''
        working-directory: worker_flutter
        shell: bash
        env:
          SENTRY_AUTH_TOKEN: ${{ env.SENTRY_AUTH_TOKEN_WORKER }}
          SENTRY_RELEASE: worker_flutter@${{ needs.version.outputs.version }}
        continue-on-error: true
        run: dart run sentry_dart_plugin

      - name: Package release as zip
        working-directory: worker_flutter
        shell: pwsh
        run: |
          $src = "build/windows/x64/runner/Release"
          if (-not (Test-Path $src)) {
            $src = "build/windows/runner/Release"
          }
          $dst = "build/worker_flutter-windows.zip"
          if (Test-Path $dst) { Remove-Item $dst }
          Compress-Archive -Path "$src/*" -DestinationPath $dst
          Get-ChildItem $dst

      - name: Sign zip for WinSparkle (DSA)
        env:
          SPARKLE_DSA_PRIVATE_KEY: ${{ secrets.SPARKLE_DSA_PRIVATE_KEY }}
          TAG: ${{ needs.version.outputs.tag }}
          VER: ${{ needs.version.outputs.version }}
        shell: bash
        working-directory: worker_flutter
        run: |
          if [ -z "$SPARKLE_DSA_PRIVATE_KEY" ]; then
            echo "::error::SPARKLE_DSA_PRIVATE_KEY is unset" >&2
            exit 1
          fi
          KEY_FILE=$(mktemp)
          trap 'rm -f "$KEY_FILE"' EXIT
          printf '%s' "$SPARKLE_DSA_PRIVATE_KEY" > "$KEY_FILE"
          ZIP=build/worker_flutter-windows.zip
          LEN=$(wc -c < "$ZIP")
          SIG=$(openssl dgst -sha1 -binary < "$ZIP" \
            | openssl dgst -sha1 -sign "$KEY_FILE" \
            | openssl enc -base64 -A)
          if [ -z "$SIG" ]; then
            echo "::error::DSA signing produced an empty signature" >&2
            exit 1
          fi
          echo "WinSparkle signature: $SIG (length: $LEN)"
          jq -n --arg sig "$SIG" --arg len "$LEN" \
                --arg ref "$TAG" --arg ver "$VER" \
            '{tag: $ref, version: $ver, dsaSignature: $sig, length: ($len|tonumber)}' \
            > build/sparkle-manifest-windows.json
          cat build/sparkle-manifest-windows.json

      - name: Upload Windows artifact
        uses: actions/upload-artifact@v4
        with:
          name: windows
          path: |
            worker_flutter/build/worker_flutter-windows.zip
            worker_flutter/build/sparkle-manifest-windows.json
          if-no-files-found: error

  publish:
    needs: [version, build-macos, build-windows]
    runs-on: ubuntu-latest
    steps:
      - name: Download macOS artifact
        uses: actions/download-artifact@v4
        with:
          name: macos
          path: artifacts/macos
      - name: Download Windows artifact
        uses: actions/download-artifact@v4
        with:
          name: windows
          path: artifacts/windows
      - name: Inspect artifacts
        run: |
          ls -lah artifacts/macos
          ls -lah artifacts/windows
      - name: Publish to GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ needs.version.outputs.tag }}
          name: ${{ needs.version.outputs.tag }}
          files: |
            artifacts/macos/worker_flutter-macos.zip
            artifacts/macos/sparkle-manifest.json
            artifacts/windows/worker_flutter-windows.zip
            artifacts/windows/sparkle-manifest-windows.json
          fail_on_unmatched_files: true

  update-appcast:
    needs: [version, publish]
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - name: Checkout main
        uses: actions/checkout@v4
        with:
          ref: main
          token: ${{ secrets.GITHUB_TOKEN }}
          fetch-depth: 1

      - name: Download macOS artifact
        uses: actions/download-artifact@v4
        with:
          name: macos
          path: artifacts/macos

      - name: Prepend appcast item
        env:
          VERSION: ${{ needs.version.outputs.version }}
          BUILD_NUMBER: ${{ needs.version.outputs.build_number }}
          TAG: ${{ needs.version.outputs.tag }}
        run: |
          python3 .github/scripts/prepend_appcast_item.py \
            --appcast worker_flutter/appcast.xml \
            --manifest artifacts/macos/sparkle-manifest.json \
            --version "$VERSION" \
            --build-number "$BUILD_NUMBER" \
            --enclosure-url "https://github.com/${GITHUB_REPOSITORY}/releases/download/${TAG}/worker_flutter-macos.zip"

      - name: Commit and push
        env:
          TAG: ${{ needs.version.outputs.tag }}
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          if git diff --quiet worker_flutter/appcast.xml; then
            echo "No appcast change to commit (script produced no diff)."
            exit 0
          fi
          git add worker_flutter/appcast.xml
          git commit -m "chore(appcast): publish ${TAG} [skip ci]"
          git push origin main
```

- [ ] **Step 2: Lint the YAML**

Run:
```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release-worker.yml'))"
```

Expected: no output (parses cleanly).

If `actionlint` is installed, also run:
```bash
actionlint .github/workflows/release-worker.yml
```

Expected: no errors. (Skip this step if actionlint isn't installed; the YAML parse check is enough to catch syntax issues.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release-worker.yml
git commit -m "feat(release): auto-tag + publish to appcast on every main push

Restructured release-worker.yml:
- version job reads pubspec MAJOR.MINOR + the latest worker-v* tag,
  computes the next version via compute_worker_version.py, tags the
  commit, and exports BUILD_NAME / BUILD_NUMBER for downstream jobs.
- build-macos + build-windows now pass --build-name / --build-number
  from the version job (the macOS path goes via the Fastfile change;
  Windows passes the flags directly).
- The old build-<sha> prerelease branching is gone — every main push
  now produces a real tagged release.
- New update-appcast job prepends a signed <item> to appcast.xml and
  commits the change back to main with GITHUB_TOKEN.
- Manual workflow_dispatch + worker-v* tag pushes still work as
  escape hatches.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Run the Python scripts in CI so they can't bit-rot

Add a tiny job to `ci.yml` so a PR that breaks the release scripts fails the PR rather than the next release run.

**Files:**
- Modify: `.github/workflows/ci.yml` (add a `release-scripts` job)

- [ ] **Step 1: Append the job**

Add this job to the bottom of `.github/workflows/ci.yml` (after the existing `test` job, at the same indent):

```yaml
  release-scripts:
    name: CI / Release scripts
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Run unit tests
        # Stdlib-only — no pip install needed.
        run: python3 -m unittest discover -s .github/scripts -p '*_test.py' -v
```

- [ ] **Step 2: Verify ci.yml still parses**

Run:
```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"
```

Expected: no output.

- [ ] **Step 3: Run the tests once locally to confirm everything still passes**

Run:
```bash
python3 -m unittest discover -s .github/scripts -p '*_test.py' -v
```

Expected: 17 tests pass (9 from compute_worker_version_test.py + 8 from prepend_appcast_item_test.py).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run release-script unit tests on PRs

Catches regressions in compute_worker_version.py and
prepend_appcast_item.py at PR time instead of release time.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Open the PR and verify the auto-release end-to-end

The plan's tasks above produce a self-contained set of commits on the
`feat/worker-auto-release` branch. This task ships them and validates
the whole pipeline by actually running it.

**Files:** None — operational only.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/worker-auto-release
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --base main --head feat/worker-auto-release \
  --title "feat: auto-release worker on every PR merge" \
  --body "$(cat <<'EOF'
## Summary
- Adds `compute_worker_version.py` + `prepend_appcast_item.py` (stdlib-only, unit-tested)
- Restructures `release-worker.yml`: every merge to `main` auto-bumps patch, tags, builds (macOS + Windows), publishes, and prepends a signed `<item>` to `appcast.xml`
- Bumps `worker_flutter/pubspec.yaml` to `0.2.0+1` and documents the CI/pubspec contract inline
- Deletes the stale `worker-v0.1.0` `<item>` from `appcast.xml` (release was a 404)
- Adds a `release-scripts` job to `ci.yml` so the Python scripts can't bit-rot

## Why
The Sparkle auto-update path has been silently broken since v0.1.0 — the only appcast entry points to a deleted release, has no `sparkle:edSignature`, and no new entries have been added since. Existing installs (including mine) are stuck on Build 2 (pre-PR-#211), which still calls the broken `signInWithProvider` on macOS. With this in place, future merges ship + propagate to existing installs within ~1h via Sparkle.

Spec: `docs/superpowers/specs/2026-05-16-worker-auto-release-design.md`

## Test plan
- [ ] CI / Release scripts job passes (17 unit tests across both scripts)
- [ ] CI / Lint, Build, Test jobs still pass
- [ ] After merge, observe the `release-worker.yml` run: `worker-v0.2.0` tag created, GitHub Release published with macOS + Windows zips + manifests, `update-appcast` commit lands on main with a real `sparkle:edSignature`
- [ ] Existing Build 2 install on my Mac picks up the v0.2.0 update via Sparkle within ~1h (or immediately on app restart), installs, relaunches
- [ ] Sign-in completes via the PKCE flow (system browser opens, Google OAuth, app comes back authenticated)
- [ ] `~/Library/Logs/com.tytaniumdev.magicBracketSimulator.log` has no `Sentry capture:` lines after a successful sign-in (or has one with the expected error code if it fails — proving Sentry is firing)
- [ ] A subsequent trivial PR merge produces `worker-v0.2.1` and a new appcast entry — proving the auto-bump loop is healthy

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Wait for CI on the PR to pass**

CI runs the standard Lint / Build / Test plus the new `release-scripts` job. All must pass before merge.

- [ ] **Step 4: Merge the PR**

After review/approval, squash-merge the PR into `main`. This triggers `release-worker.yml`'s main-push branch.

- [ ] **Step 5: Watch the release workflow**

Open the Actions tab for the new run. Expected stages, in order:
1. `version` job: prints `tag=worker-v0.2.0`, creates and pushes the tag.
2. `build-macos`: ~15–25 minutes (notarization is the slow part).
3. `build-windows`: ~5–10 minutes.
4. `publish`: GitHub Release `worker-v0.2.0` appears with the four expected files.
5. `update-appcast`: a new commit on `main` titled `chore(appcast): publish worker-v0.2.0 [skip ci]`.

- [ ] **Step 6: Verify the appcast entry**

Pull main locally and confirm `worker_flutter/appcast.xml` now contains:
```xml
<item>
  <title>Version 0.2.0 (macOS)</title>
  ...
  <sparkle:shortVersionString>0.2.0</sparkle:shortVersionString>
  ...
  <enclosure url="https://github.com/TytaniumDev/MagicBracketSimulator/releases/download/worker-v0.2.0/worker_flutter-macos.zip"
             sparkle:edSignature="..."
             length="..."
             type="application/octet-stream" />
</item>
```

The `sparkle:edSignature` should be a non-empty Base64 string (~88 chars ending in `==`).

- [ ] **Step 7: Trigger the Sparkle update on the running install**

On the Mac running Build 2:
1. Open the running worker app (tray icon → Dashboard).
2. From the app's menu (Cmd-,), trigger "Check for Updates…" if exposed, or simply restart the app — the boot-time `autoUpdater.checkForUpdates(inBackground: true)` call in `worker_flutter/lib/main.dart` will hit the new appcast.
3. Sparkle should show an "Update available — v0.2.0" dialog. Install it.
4. The app relaunches as v0.2.0.

- [ ] **Step 8: Verify sign-in works**

Click "Sign in with Google". A system browser tab should open with Google's OAuth consent screen (the PKCE flow). After consent, the tab shows "Sign-in complete" and the worker app transitions from AuthGate to Dashboard.

If sign-in still fails, check `~/Library/Logs/com.tytaniumdev.magicBracketSimulator.log` for a `Sentry capture:` line — its presence confirms Sentry is firing in production; the captured error code helps diagnose any residual issue.

- [ ] **Step 9: Confirm the auto-bump loop with a follow-up trivial PR**

Open a tiny PR (e.g. fix a typo in a comment) and merge. Within ~30 minutes you should see:
- A new `worker-v0.2.1` tag + Release.
- A second `chore(appcast): publish worker-v0.2.1 [skip ci]` commit on main.
- `worker_flutter/appcast.xml` now has a v0.2.1 `<item>` *above* the v0.2.0 `<item>`.

If that succeeds, the auto-release loop is healthy and Sentry is fully wired up.
