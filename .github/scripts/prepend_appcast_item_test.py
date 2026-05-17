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
