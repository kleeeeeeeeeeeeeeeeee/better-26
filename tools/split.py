#!/usr/bin/env python3
"""Split the single-file Eaglercraft HTML into readable source files.

Usage: python3 tools/split.py <original.html>

Writes src/ (template, js, css, img), payloads/ (binary blobs) and
tools/original.sha256. tools/build.py reverses the process.

Every extracted piece is replaced in the template by a token:
    @@EAG:file:<path>@@          file content inserted verbatim
    @@EAG:b64:<path>:<width>@@   file base64-encoded, wrapped at <width> chars
                                 (width 0 = no wrapping)
A payload whose base64 re-encoding does not reproduce the original text is
kept as raw base64 text and referenced with a `file` token instead.
"""
import base64
import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOKEN = b"@@EAG:"

# Inline payload <script id="..."> -> output file
PAYLOAD_NAMES = {
    "eag-inline-decoder": "decoder.wasm",
    "eag-inline-wasm-br": "client.wasm.br",
    "eag-inline-mesh-wasm-br": "mesh.wasm.br",
    "eag-inline-server-wasm-br": "server.wasm.br",
    "eag-inline-assets": "assets.epk",
    "eag-inline-sounds": "sounds.epk",
}
# Code <script> blocks, in document order
SCRIPT_NAMES = [
    "01-brotli-decoder.js",
    "02-inline-payload-loader.js",
    "03-debug-flags.js",
    "04-teavm-wasmgc-runtime.js",
    "05-worker-bootstrap.js",
    "06-main.js",
]
IMAGE_NAMES = ["icon.png", "boot.png"]


def b64_wrap(data: bytes, width: int) -> bytes:
    enc = base64.b64encode(data)
    if width <= 0:
        return enc
    return b"\n".join(enc[i:i + width] for i in range(0, len(enc), width))


def write(rel: str, data: bytes) -> None:
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    print(f"  {rel:45s} {len(data):>10,d} bytes")


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    src = Path(sys.argv[1]).read_bytes()
    if TOKEN in src:
        print("error: input already contains the token marker", TOKEN)
        return 1

    # (start, end, replacement) spans, collected then applied back to front
    spans = []
    script_i = 0

    for m in re.finditer(rb"<(script|style)\b([^>]*)>", src):
        tag, attrs = m.group(1), m.group(2)
        start = m.end()
        end = src.index(b"</" + tag + b">", start)
        body = src[start:end]

        if tag == b"style":
            rel = "src/css/style.css"
            write(rel, body)
            spans.append((start, end, TOKEN + b"file:" + rel.encode() + b"@@"))
            continue

        if b"application/octet-stream" in attrs:
            ident = re.search(rb'id="([^"]+)"', attrs).group(1).decode()
            name = PAYLOAD_NAMES.get(ident, ident + ".bin")
            text = body.strip()
            lead = len(body) - len(body.lstrip())
            s, e = start + lead, start + lead + len(text)
            width = len(text.split(b"\n", 1)[0]) if b"\n" in text else 0
            raw = base64.b64decode(text)
            if b64_wrap(raw, width) == text:
                rel = "payloads/" + name
                write(rel, raw)
                token = TOKEN + f"b64:{rel}:{width}".encode() + b"@@"
            else:
                rel = "payloads/" + name + ".b64"
                write(rel, text)
                token = TOKEN + b"file:" + rel.encode() + b"@@"
                print(f"  ! {ident}: base64 does not round-trip, kept as text")
            spans.append((s, e, token))
            continue

        name = (SCRIPT_NAMES[script_i] if script_i < len(SCRIPT_NAMES)
                else f"{script_i + 1:02d}-script.js")
        script_i += 1
        rel = "src/js/" + name
        write(rel, body)
        spans.append((start, end, TOKEN + b"file:" + rel.encode() + b"@@"))

    # Inline PNG data URIs (outside the script/style bodies)
    covered = [(s, e) for s, e, _ in spans]
    img_i = 0
    for m in re.finditer(rb"data:image/png;base64,([A-Za-z0-9+/=]+)", src):
        if any(s <= m.start() < e for s, e in covered):
            continue
        raw = base64.b64decode(m.group(1))
        if base64.b64encode(raw) != m.group(1):
            continue
        name = IMAGE_NAMES[img_i] if img_i < len(IMAGE_NAMES) else f"image-{img_i + 1}.png"
        img_i += 1
        rel = "src/img/" + name
        write(rel, raw)
        spans.append((m.start(1), m.end(1), TOKEN + f"b64:{rel}:0".encode() + b"@@"))

    template = src
    for s, e, token in sorted(spans, reverse=True):
        template = template[:s] + token + template[e:]
    write("src/index.template.html", template)

    digest = hashlib.sha256(src).hexdigest()
    write("tools/original.sha256", (digest + "\n").encode())
    print("sha256", digest)
    return 0


if __name__ == "__main__":
    sys.exit(main())
