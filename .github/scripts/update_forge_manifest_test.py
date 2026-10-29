"""Tests for update_forge_manifest.py.

Run from repo root:
  python3 -m unittest .github/scripts/update_forge_manifest_test.py
"""

import hashlib
import io
import json
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import update_forge_manifest as ufm  # noqa: E402

SCRIPT = Path(__file__).parent / "update_forge_manifest.py"


def _write_tarball(path: Path, member_names: list[str]) -> None:
    with tarfile.open(path, "w:bz2") as tar:
        for name in member_names:
            data = b"jar bytes"
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))


class HasDesktopJarTest(unittest.TestCase):
    def test_finds_top_level_jar(self):
        names = ["forge.sh", "forge-gui-desktop-2.0.15-jar-with-dependencies.jar"]
        self.assertTrue(ufm.has_desktop_jar(names, "2.0.15"))

    def test_accepts_dot_slash_prefix(self):
        names = ["./forge-gui-desktop-2.0.15-jar-with-dependencies.jar"]
        self.assertTrue(ufm.has_desktop_jar(names, "2.0.15"))

    def test_rejects_other_version(self):
        names = ["forge-gui-desktop-2.0.14-jar-with-dependencies.jar"]
        self.assertFalse(ufm.has_desktop_jar(names, "2.0.15"))

    def test_rejects_mobile_jar(self):
        names = ["forge-gui-mobile-dev-2.0.15-jar-with-dependencies.jar"]
        self.assertFalse(ufm.has_desktop_jar(names, "2.0.15"))


class BuildManifestTest(unittest.TestCase):
    def test_fields_match_worker_schema(self):
        manifest = ufm.build_manifest(version="2.0.15", sha256="abc", size=42)
        self.assertEqual(
            manifest,
            {
                "version": "2.0.15",
                "url": "https://github.com/Card-Forge/forge/releases/download/"
                "forge-2.0.15/forge-installer-2.0.15.tar.bz2",
                "sha256": "abc",
                "size": 42,
                "jarName": "forge-gui-desktop-2.0.15-jar-with-dependencies.jar",
            },
        )


class CliTest(unittest.TestCase):
    def test_writes_manifest_from_tarball(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            tarball = tmp_path / "forge.tar.bz2"
            _write_tarball(tarball, ["forge-gui-desktop-2.0.15-jar-with-dependencies.jar"])
            manifest_path = tmp_path / "forge-manifest.json"
            manifest_path.write_text('{"version": "2.0.10"}\n')

            subprocess.run(
                [sys.executable, str(SCRIPT), "--manifest", str(manifest_path),
                 "--tarball", str(tarball), "--version", "2.0.15"],
                check=True,
                capture_output=True,
            )

            manifest = json.loads(manifest_path.read_text())
            self.assertEqual(manifest["version"], "2.0.15")
            self.assertEqual(manifest["size"], tarball.stat().st_size)
            self.assertEqual(
                manifest["sha256"], hashlib.sha256(tarball.read_bytes()).hexdigest()
            )

    def test_missing_jar_fails_and_leaves_manifest_alone(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            tarball = tmp_path / "forge.tar.bz2"
            _write_tarball(tarball, ["forge.sh"])
            manifest_path = tmp_path / "forge-manifest.json"
            original = '{"version": "2.0.10"}\n'
            manifest_path.write_text(original)

            result = subprocess.run(
                [sys.executable, str(SCRIPT), "--manifest", str(manifest_path),
                 "--tarball", str(tarball), "--version", "2.0.15"],
                capture_output=True,
                text=True,
            )

            self.assertEqual(result.returncode, 1)
            self.assertIn("not found", result.stderr)
            self.assertEqual(manifest_path.read_text(), original)


if __name__ == "__main__":
    unittest.main()
