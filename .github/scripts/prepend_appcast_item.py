#!/usr/bin/env python3
"""Prepend a Sparkle <item> to worker_flutter/appcast.xml.

Reads signature + byte length from a sparkle-manifest.json. Builds
the <item> from CLI args. Inserts immediately after the <language>en</language>
line so the newest entry is on top.

Raw text manipulation is intentional — xml.etree strips comments, and
the appcast file has important comments we don't want to lose.

Usage:
  prepend_appcast_item.py \
    --appcast worker_flutter/appcast.xml \
    --manifest artifacts/macos/sparkle-manifest.json \
    --version 0.2.5 \
    --build-number 12 \
    --os macos \
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
    signature: str,
    sig_attr: str,  # "sparkle:edSignature" or "sparkle:dsaSignature"
    length: int,
    pub_date: str,
    os_name: str,   # "macos" or "windows"
    title_suffix: str, # "(macOS)" or "(Windows)"
) -> str:
    # Indented to match the existing channel-children indentation
    # (4 spaces) in worker_flutter/appcast.xml.
    return (
        "\n    <item>\n"
        f"      <title>Version {version} {title_suffix}</title>\n"
        f"      <sparkle:os>{os_name}</sparkle:os>\n"
        f"      <pubDate>{pub_date}</pubDate>\n"
        f"      <sparkle:version>{build_number}</sparkle:version>\n"
        f"      <sparkle:shortVersionString>{version}</sparkle:shortVersionString>\n"
        f"      <sparkle:minimumSystemVersion>{'11.0' if os_name == 'macos' else '10.0'}</sparkle:minimumSystemVersion>\n"
        f'      <enclosure url="{enclosure_url}"\n'
        f'                 {sig_attr}="{signature}"\n'
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
    parser.add_argument("--os", required=True, choices=["macos", "windows"])
    parser.add_argument("--enclosure-url", required=True)
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text())
    
    try:
        if args.os == "macos":
            signature = manifest["edSignature"]
            sig_attr = "sparkle:edSignature"
            os_name = "macos"
            title_suffix = "(macOS)"
        else:
            signature = manifest["dsaSignature"]
            sig_attr = "sparkle:dsaSignature"
            os_name = "windows"
            title_suffix = "(Windows)"

        length = int(manifest["length"])
    except (KeyError, ValueError) as e:
        raise SystemExit(f"Manifest at {args.manifest} is malformed or missing required keys: {e}")

    appcast = args.appcast.read_text()

    if f'url="{args.enclosure_url}"' in appcast:
        raise SystemExit(
            f"appcast.xml already contains an <item> for enclosure {args.enclosure_url}; "
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
        signature=signature,
        sig_attr=sig_attr,
        length=length,
        pub_date=pub_date,
        os_name=os_name,
        title_suffix=title_suffix,
    )

    insert_at = appcast.find(_ANCHOR) + len(_ANCHOR)
    updated = appcast[:insert_at] + item + appcast[insert_at:]
    args.appcast.write_text(updated)


if __name__ == "__main__":
    main()
