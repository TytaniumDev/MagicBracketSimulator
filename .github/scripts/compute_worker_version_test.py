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
