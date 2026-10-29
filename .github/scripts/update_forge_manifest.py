#!/usr/bin/env python3
"""Point worker_flutter/forge-manifest.json at a downloaded Forge release.

The desktop worker fetches the manifest from `main` on every boot and
re-installs Forge when the version changes, so rewriting this file is
all it takes to roll a new Forge out to every desktop install.

Reads sha256 + size from the local tarball and checks that it contains
the desktop jar the worker launches. Fails (exit 1) rather than writing
a manifest that would brick installs.

Usage:
  update_forge_manifest.py \
    --manifest worker_flutter/forge-manifest.json \
    --tarball /tmp/forge-installer-2.0.15.tar.bz2 \
    --version 2.0.15
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import tarfile
from pathlib import Path

_URL_TEMPLATE = (
    "https://github.com/Card-Forge/forge/releases/download/"
    "forge-{version}/forge-installer-{version}.tar.bz2"
)


def desktop_jar_name(version: str) -> str:
    return f"forge-gui-desktop-{version}-jar-with-dependencies.jar"


def has_desktop_jar(member_names: list[str], version: str) -> bool:
    """True when the tarball ships the jar at its top level.

    Members may be prefixed with "./" depending on how the tarball was
    built, so compare on the normalized path.
    """
    expected = desktop_jar_name(version)
    return any(name.removeprefix("./") == expected for name in member_names)


def build_manifest(*, version: str, sha256: str, size: int) -> dict:
    return {
        "version": version,
        "url": _URL_TEMPLATE.format(version=version),
        "sha256": sha256,
        "size": size,
        "jarName": desktop_jar_name(version),
    }


def _sha256_and_size(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest(), size


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--tarball", required=True, type=Path)
    parser.add_argument("--version", required=True)
    args = parser.parse_args(argv)

    with tarfile.open(args.tarball, "r:bz2") as tar:
        names = tar.getnames()
    if not has_desktop_jar(names, args.version):
        print(
            f"error: {desktop_jar_name(args.version)} not found in {args.tarball}",
            file=sys.stderr,
        )
        return 1

    sha256, size = _sha256_and_size(args.tarball)
    manifest = build_manifest(version=args.version, sha256=sha256, size=size)
    args.manifest.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Wrote {args.manifest}: Forge {args.version}, {size} bytes, sha256 {sha256}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
