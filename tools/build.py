#!/usr/bin/env python3
"""Rebuild the single-file HTML from src/ and payloads/.

Usage: python3 tools/build.py [output.html]

Reads src/index.template.html, replaces every token with the content of the
file it names (see tools/split.py for the token format; @@EAG:json:<path>@@
inserts an optional local JSON file, or null when it does not exist) and writes
dist/eaglercraft-26.2.html. Finally compares the SHA-256 of the result with
tools/original.sha256 and reports whether the output is byte-identical to the
original file.
"""
import base64
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOKEN_RE = re.compile(rb"@@EAG:(file|b64|json):([^:@]+)(?::(\d+))?@@")


def b64_wrap(data: bytes, width: int) -> bytes:
    enc = base64.b64encode(data)
    if width <= 0:
        return enc
    return b"\n".join(enc[i:i + width] for i in range(0, len(enc), width))


def expand(m: "re.Match[bytes]") -> bytes:
    kind, rel, width = m.group(1), m.group(2).decode(), m.group(3)
    if kind == b"json":
        # Optional local configuration: the literal null when the file is absent.
        path = ROOT / rel
        if not path.exists():
            return b"null"
        text = json.dumps(json.loads(path.read_text(encoding="utf-8")))
        print(f"included local configuration from {rel}")
        return text.replace("</", "<\\/").encode("utf-8")
    data = (ROOT / rel).read_bytes()
    if kind == b"b64":
        return b64_wrap(data, int(width or 0))
    return data


def main() -> int:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "dist" / "eaglercraft-26.2.html"
    template = (ROOT / "src" / "index.template.html").read_bytes()
    html = TOKEN_RE.sub(expand, template)

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(html)
    digest = hashlib.sha256(html).hexdigest()
    print(f"wrote {out} ({len(html):,d} bytes)")
    print(f"sha256 {digest}")

    expected = (ROOT / "tools" / "original.sha256").read_text().strip()
    if digest == expected:
        print("OK: byte-identical to the original file")
        return 0
    print(f"DIFFERENT from the original file (expected {expected})")
    print("This is expected if you edited src/ or payloads/ on purpose.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
