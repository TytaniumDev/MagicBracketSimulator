#!/usr/bin/env python3
"""
Generate or update precons/manifest.json from precons/*.dck.

Scans precons/ for .dck files, derives id/name/filename (and optionally
primaryCommander from .dck content). Merges with existing manifest.json
when present (preserves set, colors, etc.; adds new entries for new .dck files).

Usage: run from worker/forge-engine/ or project root:
  python scripts/generate_manifest.py
  # or: python worker/forge-engine/scripts/generate_manifest.py
"""

import json
import re
from datetime import datetime, timezone
from pathlib import Path


def script_dir() -> Path:
    return Path(__file__).resolve().parent


def find_precons_dir() -> Path:
    base = script_dir().parent
    precons = base / "precons"
    if precons.is_dir():
        return precons
    # Maybe we're at repo root
    precons = base / "worker" / "forge-engine" / "precons"
    if precons.is_dir():
        return precons
    raise SystemExit("precons/ directory not found (run from worker/forge-engine/ or repo root)")


def to_kebab(s: str) -> str:
    """Convert display name to kebab-case id."""
    s = s.strip().lower()
    s = re.sub(r"[^a-z0-9\s-]", "", s)
    s = re.sub(r"[\s_]+", "-", s)
    return re.sub(r"-+", "-", s).strip("-")


def parse_dck(path: Path) -> dict:
    """Parse .dck for Name (metadata) and first commander line. Returns {name?, primaryCommander?}."""
    out = {}
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return out
    in_metadata = False
    in_commander = False
    for line in text.splitlines():
        line = line.strip()
        if line == "[metadata]":
            in_metadata = True
            in_commander = False
            continue
        if line.startswith("["):
            in_metadata = False
            in_commander = line.lower() in ("[commander]", "[Commander]")
            continue
        if in_metadata and line.lower().startswith("name="):
            out["name"] = line.split("=", 1)[1].strip()
            in_metadata = False
        if in_commander and line and line[0].isdigit():
            # "1 Commander Name" or "1x Commander Name"
            m = re.match(r"^\d+\s*(?:x\s*)?(.+)$", line.strip())
            if m:
                out["primaryCommander"] = m.group(1).strip()
            in_commander = False
    return out


def default_entry(filename: str, path: Path) -> dict:
    """Build minimal entry for a .dck file. name from filename or parsed from file."""
    base_name = filename
    if base_name.lower().endswith(".dck"):
        base_name = base_name[:-4]
    parsed = parse_dck(path)
    name = parsed.get("name") or base_name
    entry = {
        "id": to_kebab(name),
        "name": name,
        "filename": filename,
    }
    if parsed.get("primaryCommander"):
        entry["primaryCommander"] = parsed["primaryCommander"]
    return entry


def main() -> None:
    precons_dir = find_precons_dir()
    dck_files = sorted(f for f in precons_dir.iterdir() if f.is_file() and f.suffix.lower() == ".dck")
    manifest_path = precons_dir / "manifest.json"

    by_filename: dict[str, dict] = {}
    if manifest_path.exists():
        try:
            data = json.loads(manifest_path.read_text(encoding="utf-8"))
            for p in data.get("precons", []):
                fn = p.get("filename")
                if fn:
                    by_filename[fn] = dict(p)
        except (json.JSONDecodeError, OSError):
            pass

    precons_list = []
    for path in dck_files:
        filename = path.name
        if filename in by_filename:
            precons_list.append(by_filename[filename])
        else:
            precons_list.append(default_entry(filename, path))

    manifest = {
        "version": "1.0.0",
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "precons": precons_list,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(precons_list)} precons to {manifest_path}")


if __name__ == "__main__":
    main()
