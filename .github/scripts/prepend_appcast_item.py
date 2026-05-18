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
    --version 0.2.5 \\
    --build-number 12 \\
    --enclosure-url https://github.com/.../worker-v0.2.5/MagicBracketWorker-macos.zip
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
