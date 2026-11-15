#!/usr/bin/env python3
"""Write dist/panel-preview.html: the performance panel alone, without the game.

Usage: python3 tools/panel_preview.py

About 60 KB, so the panel's look can be checked or shared without the 75 MB game.
It loads src/css/mc-ui.css (with its images and font inlined), 02b, 02f and 02c, and
opens the panel. Nothing in it talks to a server.
"""
import base64
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOKEN_RE = re.compile(rb"@@EAG:(file|b64|json):([^:@]+)(?::(\d+))?@@")


def expand(m):
    kind, rel = m.group(1), m.group(2).decode()
    data = (ROOT / rel).read_bytes()
    if kind == b"b64":
        return base64.b64encode(data)
    if rel.endswith(".css"):
        return TOKEN_RE.sub(expand, data)
    return data


def main():
    css = TOKEN_RE.sub(expand, (ROOT / "src/css/mc-ui.css").read_bytes()).decode()
    js = lambda name: (ROOT / "src/js" / name).read_text(encoding="utf-8")
    page = (
        '<!doctype html><html><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1"><title>Panel preview</title>'
        "<style>html,body{margin:0;height:100%}"
        "body{background:linear-gradient(#78a7ff 0 55%,#5d8f3a 55% 62%,#866043 62%)}"
        "#note{position:fixed;right:12px;bottom:12px;font:14px sans-serif;color:#fff;"
        "background:rgba(0,0,0,.5);padding:6px 10px}</style>"
        '<style id="eag-mc-ui">' + css + "</style>"
        '<script>try{localStorage.setItem("eaglercraft26.perfPanel","open")}catch(e){}</script>'
        "<script>" + js("02b-m1-air-profile.js") + "</script>"
        "<script>" + js("02f-features.js") + "</script>"
        "<script>" + js("02c-perf-panel.js") + "</script>"
        '</head><body><div id="note">Panel preview only (no game). Click the tabs and buttons.</div></body></html>'
    )
    out = ROOT / "dist" / "panel-preview.html"
    out.parent.mkdir(exist_ok=True)
    out.write_text(page, encoding="utf-8")
    print(f"wrote {out} ({len(page.encode()):,d} bytes)")


if __name__ == "__main__":
    main()
