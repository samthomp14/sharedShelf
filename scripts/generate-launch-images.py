#!/usr/bin/env python3
"""Render iOS launch (startup) images for the installed home-screen web app.

iOS only shows an apple-touch-startup-image whose pixel size exactly matches the
device, so there's one per screen size. Each is the shelf artwork from
assets/icon-source.svg plus the wordmark, centered on the app background.

Usage (macOS, needs Google Chrome):  python3 scripts/generate-launch-images.py
Writes public/splash/*.png and prints the <link> tags for public/index.html.
"""
import pathlib
import re
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "splash"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
BACKGROUND = "#f5f7fa"  # colors.background in lib/theme.ts

# (CSS width, CSS height, device pixel ratio) — portrait only; the app is portrait-locked.
DEVICES = [
    (440, 956, 3),   # iPhone 16/17 Pro Max
    (420, 912, 3),   # iPhone Air
    (402, 874, 3),   # iPhone 16/17 Pro, 17
    (430, 932, 3),   # iPhone 14 Pro Max, 15 Plus/Pro Max, 16 Plus
    (393, 852, 3),   # iPhone 14 Pro, 15, 15 Pro, 16, 16e
    (428, 926, 3),   # iPhone 12/13 Pro Max, 14 Plus
    (390, 844, 3),   # iPhone 12/13/14, 12/13 Pro
    (375, 812, 3),   # iPhone X/XS/11 Pro, 12/13 mini
    (414, 896, 3),   # iPhone XS Max, 11 Pro Max
    (414, 896, 2),   # iPhone XR, 11
    (414, 736, 3),   # iPhone 6-8 Plus
    (375, 667, 2),   # iPhone SE 2/3, 6-8
    (320, 568, 2),   # iPhone SE (1st gen)
    (1032, 1376, 2), # iPad Pro 13" (M4)
    (1024, 1366, 2), # iPad Pro 12.9"
    (834, 1210, 2),  # iPad Pro 11" (M4)
    (834, 1194, 2),  # iPad Pro 11"
    (820, 1180, 2),  # iPad Air / iPad 10th gen
    (810, 1080, 2),  # iPad 7-9th gen
    (768, 1024, 2),  # iPad mini 5, older iPads
    (744, 1133, 2),  # iPad mini 6+
]


def artwork_svg() -> str:
    svg = (ROOT / "assets" / "icon-source.svg").read_text()
    svg = re.sub(r"<!--.*?-->", "", svg, flags=re.S)
    svg = re.sub(r'<rect width="1024" height="1024"[^>]*/>', "", svg)  # drop the icon's square background
    # Crop to the shelf artwork and let CSS size it.
    return svg.replace('width="1024" height="1024" viewBox="0 0 1024 1024"', 'viewBox="176 176 672 672"')


def page(w: int, h: int) -> str:
    art = min(w, h) * 0.38
    return f"""<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital@1&display=swap" rel="stylesheet">
<style>
html,body{{margin:0;width:{w}px;height:{h}px;background:{BACKGROUND}}}
body{{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:{art * 0.12:.0f}px}}
svg{{width:{art:.0f}px;height:{art:.0f}px;display:block}}
h1{{margin:0;font-family:'Libre Baskerville',serif;font-style:italic;font-weight:400;font-size:{art * 0.2:.0f}px;color:#0e1116}}
</style></head><body>{artwork_svg()}<h1>sharedShelf</h1></body></html>"""


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    links = []
    with tempfile.TemporaryDirectory() as tmp:
        for w, h, dpr in DEVICES:
            name = f"launch-{w * dpr}x{h * dpr}.png"
            html = pathlib.Path(tmp) / f"{w}x{h}.html"
            html.write_text(page(w, h))
            subprocess.run(
                [CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                 f"--force-device-scale-factor={dpr}", f"--window-size={w},{h}",
                 "--virtual-time-budget=5000", f"--screenshot={OUT / name}", html.as_uri()],
                check=True, capture_output=True,
            )
            links.append(
                f'    <link rel="apple-touch-startup-image" href="/splash/{name}" '
                f'media="(device-width: {w}px) and (device-height: {h}px) and '
                f'(-webkit-device-pixel-ratio: {dpr}) and (orientation: portrait)" />'
            )
    print("\n".join(links))


if __name__ == "__main__":
    main()
