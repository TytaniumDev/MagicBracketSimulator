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
