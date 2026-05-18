#!/usr/bin/env python3
"""Generate Magic Bracket Worker app icons (macOS .iconset + Windows .ico).

Renders a tournament-bracket motif (two 2→1 brackets meeting at a center
championship line) on a dark slate squircle, using the app's accent
blue (#60A5FA). Outputs:

  - macOS: 7 PNG files in <macos_dir>, one per AppIcon.appiconset slot.
  - Windows: a single multi-resolution app_icon.ico at <ico_path>.

Run from repo root:
  python3 worker_flutter/scripts/generate_app_icon.py \\
    --macos worker_flutter/macos/Runner/Assets.xcassets/AppIcon.appiconset \\
    --ico   worker_flutter/windows/runner/resources/app_icon.ico
"""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

# macOS Big Sur+ squircle corner radius ratio.
CORNER_RADIUS_RATIO = 0.2237

# Supersample so PIL's aliased line drawing reads smooth after LANCZOS
# downscaling — 4096 → 1024 is enough; 16/32 still come out crisp.
MASTER = 4096

# AppIcon.appiconset slot sizes.
MACOS_SIZES = (16, 32, 64, 128, 256, 512, 1024)

# Windows .ico embedded sizes. Windows shells use the size closest to
# the requested render size; 256 is the largest standard slot.
WINDOWS_SIZES = (16, 24, 32, 48, 64, 128, 256)

# Brand palette — matches worker_flutter/lib/ui/dashboard.dart.
BG_TOP = (15, 23, 42)        # slate-900 #0F172A
BG_BOTTOM = (30, 41, 80)     # slate-800 with extra blue
BRACKET = (96, 165, 250)     # blue-400 #60A5FA — dashboard accent.


def draw_squircle_bg(canvas: Image.Image) -> None:
    w, h = canvas.size
    grad = Image.new("RGB", (1, h))
    for y in range(h):
        t = y / (h - 1)
        r = int(BG_TOP[0] * (1 - t) + BG_BOTTOM[0] * t)
        g = int(BG_TOP[1] * (1 - t) + BG_BOTTOM[1] * t)
        b = int(BG_TOP[2] * (1 - t) + BG_BOTTOM[2] * t)
        grad.putpixel((0, y), (r, g, b))
    grad = grad.resize((w, h))

    mask = Image.new("L", (w, h), 0)
    md = ImageDraw.Draw(mask)
    radius = int(min(w, h) * CORNER_RADIUS_RATIO)
    md.rounded_rectangle((0, 0, w - 1, h - 1), radius=radius, fill=255)
    canvas.paste(grad, (0, 0), mask)


def _round_segment(d: ImageDraw.ImageDraw, p1, p2, width: int, color):
    """PIL doesn't round line caps; draw a filled circle at each
    endpoint so perpendicular joins look intentional instead of
    blocky-T-shaped."""
    d.line([p1, p2], fill=color, width=width)
    r = width / 2
    for (x, y) in (p1, p2):
        d.ellipse((x - r, y - r, x + r, y + r), fill=color)


def draw_bracket(canvas: Image.Image) -> None:
    """Two mirrored 2→1 brackets meeting at a center championship line.
    Reads as a tournament bracket at every size from 1024 down to 16.
    """
    w, h = canvas.size
    d = ImageDraw.Draw(canvas)
    cx, cy = w / 2, h / 2

    stroke = max(2, int(w * 0.055))

    arm_dy = h * 0.22
    outer_x_left = w * 0.16
    inner_x_left = w * 0.40
    final_x_left = w * 0.46
    final_x_right = w * 0.54
    inner_x_right = w * 0.60
    outer_x_right = w * 0.84

    # Left bracket arms + vertical joiner.
    _round_segment(d, (outer_x_left, cy - arm_dy), (inner_x_left, cy - arm_dy), stroke, BRACKET)
    _round_segment(d, (outer_x_left, cy + arm_dy), (inner_x_left, cy + arm_dy), stroke, BRACKET)
    _round_segment(d, (inner_x_left, cy - arm_dy), (inner_x_left, cy + arm_dy), stroke, BRACKET)
    _round_segment(d, (inner_x_left, cy), (final_x_left, cy), stroke, BRACKET)

    # Right bracket mirror.
    _round_segment(d, (inner_x_right, cy - arm_dy), (outer_x_right, cy - arm_dy), stroke, BRACKET)
    _round_segment(d, (inner_x_right, cy + arm_dy), (outer_x_right, cy + arm_dy), stroke, BRACKET)
    _round_segment(d, (inner_x_right, cy - arm_dy), (inner_x_right, cy + arm_dy), stroke, BRACKET)
    _round_segment(d, (final_x_right, cy), (inner_x_right, cy), stroke, BRACKET)

    # Center championship line.
    _round_segment(d, (final_x_left, cy), (final_x_right, cy), stroke, BRACKET)


def add_glow(canvas: Image.Image) -> Image.Image:
    glow = canvas.copy()
    glow = glow.filter(ImageFilter.GaussianBlur(radius=MASTER * 0.008))
    out = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    out = Image.alpha_composite(out, glow)
    out = Image.alpha_composite(out, canvas)
    return out


def render_master() -> Image.Image:
    canvas = Image.new("RGBA", (MASTER, MASTER), (0, 0, 0, 0))
    draw_squircle_bg(canvas)
    draw_bracket(canvas)
    return add_glow(canvas)


def write_macos_pngs(master: Image.Image, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for size in MACOS_SIZES:
        small = master.resize((size, size), Image.LANCZOS)
        path = out_dir / f"app_icon_{size}.png"
        small.save(path, "PNG")
        print(f"  wrote {path} ({size}x{size})")


def write_ico(master: Image.Image, ico_path: Path) -> None:
    """Multi-resolution Windows .ico. PIL's `save(..., format='ICO')`
    bundles each `sizes=` entry as its own embedded image; Windows
    picks the best fit for the requested render context."""
    ico_path.parent.mkdir(parents=True, exist_ok=True)
    sizes = [(s, s) for s in WINDOWS_SIZES]
    master.save(ico_path, format="ICO", sizes=sizes)
    print(f"  wrote {ico_path} (multi-resolution ICO: {sorted({s[0] for s in sizes})})")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--macos", required=True,
                   help="Path to AppIcon.appiconset directory")
    p.add_argument("--ico", required=True,
                   help="Path to write the Windows .ico file")
    args = p.parse_args()

    print("Rendering master canvas…")
    master = render_master()

    print("Writing macOS PNGs…")
    write_macos_pngs(master, Path(args.macos))

    print("Writing Windows ICO…")
    write_ico(master, Path(args.ico))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
