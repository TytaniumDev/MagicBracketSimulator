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

FIXTURE_MANIFEST_MACOS = {
    "tag": "worker-v0.2.1",
    "version": "0.2.1+8",
    "edSignature": "abcED_SIG==",
    "length": 12345,
}

FIXTURE_MANIFEST_WINDOWS = {
    "tag": "worker-v0.2.1",
    "version": "0.2.1+8",
    "dsaSignature": "xyzDSA_SIG==",
    "length": 54321,
}


class PrependAppcastItemTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.appcast = Path(self.tmpdir.name) / "appcast.xml"
        self.appcast.write_text(FIXTURE_APPCAST)
        self.manifest_macos = Path(self.tmpdir.name) / "sparkle-manifest.json"
        self.manifest_macos.write_text(json.dumps(FIXTURE_MANIFEST_MACOS))
        self.manifest_windows = Path(self.tmpdir.name) / "sparkle-manifest-windows.json"
        self.manifest_windows.write_text(json.dumps(FIXTURE_MANIFEST_WINDOWS))

    def run_script_macos(self, *extra_args: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--appcast",
                str(self.appcast),
                "--manifest",
                str(self.manifest_macos),
                "--version",
                "0.2.1",
                "--build-number",
                "8",
                "--os",
                "macos",
                "--enclosure-url",
                "https://github.com/Org/Repo/releases/download/worker-v0.2.1/MagicBracketWorker-macos.zip",
                *extra_args,
            ],
            capture_output=True,
            text=True,
        )

    def run_script_windows(self, *extra_args: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--appcast",
                str(self.appcast),
                "--manifest",
                str(self.manifest_windows),
                "--version",
                "0.2.1",
                "--build-number",
                "8",
                "--os",
                "windows",
                "--enclosure-url",
                "https://github.com/Org/Repo/releases/download/worker-v0.2.1/MagicBracketWorker-Installer.exe",
                *extra_args,
            ],
            capture_output=True,
            text=True,
        )

    def test_macos_and_windows_can_both_be_prepended(self) -> None:
        # Prepend macOS first
        result_macos = self.run_script_macos()
        self.assertEqual(result_macos.returncode, 0, result_macos.stderr)
        
        # Prepend Windows second (should NOT throw version duplicate error because URLs are different)
        result_windows = self.run_script_windows()
        self.assertEqual(result_windows.returncode, 0, result_windows.stderr)

        text = self.appcast.read_text()
        
        # Verify macOS properties exist in prepended item
        self.assertIn("<title>Version 0.2.1 (macOS)</title>", text)
        self.assertIn("<sparkle:os>macos</sparkle:os>", text)
        self.assertIn('sparkle:edSignature="abcED_SIG=="', text)
        self.assertIn('length="12345"', text)

        # Verify Windows properties exist in prepended item
        self.assertIn("<title>Version 0.2.1 (Windows)</title>", text)
        self.assertIn("<sparkle:os>windows</sparkle:os>", text)
        self.assertIn('sparkle:dsaSignature="xyzDSA_SIG=="', text)
        self.assertIn('length="54321"', text)

    def test_existing_comments_are_preserved(self) -> None:
        self.run_script_macos()
        text = self.appcast.read_text()
        self.assertIn("Comment block that MUST survive a rewrite", text)
        self.assertIn("existing v0.2.0 item should stay below", text)

    def test_idempotent_marker_prevents_duplicate_enclosure_insert(self) -> None:
        # Running the exact same enclosure twice should be blocked.
        self.run_script_macos()
        result = self.run_script_macos()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("already", result.stderr.lower())

    def test_missing_anchor_fails_cleanly(self) -> None:
        # If the appcast has no <language>en</language> anchor, the script
        # must fail instead of silently writing the item to the wrong place.
        self.appcast.write_text("<rss></rss>")
        result = self.run_script_macos()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("anchor", result.stderr.lower())


if __name__ == "__main__":
    unittest.main()
