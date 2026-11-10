#!/usr/bin/env python3
"""Convert an Eaglercraft 26.2 world export (.epk) into a vanilla world folder.

Usage: python3 tools/epk_to_vanilla.py <world.epk> <output-folder> [--zip]

The game's own "Convert to Vanilla" button is disabled, so this does the same
job offline. An epk/world262 archive holds the world directory with one file
per chunk:

    <namespace>_<path>/<region|entities|poi>/<XXXXXXZZZZZZ>

where the name is two 6-digit hex numbers, chunk x + 1900000 and chunk z +
1900000, and the content is the chunk's NBT (gzip, or raw in old exports).
Vanilla 26.2 stores the same NBT in region files:

    dimensions/<namespace>/<path>/<region|entities|poi>/r.<rx>.<rz>.mca

Everything else (level.dat, data/, players/ ...) is copied unchanged.
The output folder can be used as the `world` folder of a 26.2 server.
"""
import gzip
import io
import re
import struct
import sys
import time
import zipfile
import zlib
from pathlib import Path

CHUNK_RE = re.compile(r"^([^/]+)/(region|entities|poi)/([0-9a-fA-F]{12})$")
COORD_BIAS = 1900000
SECTOR = 4096


def read_epk(data: bytes):
    """Yield (type, name, bytes) for every entry of an EPK v2 archive."""
    if data[:8] != b"EAGPKG$$":
        raise ValueError("not an EPK file (missing EAGPKG$$ header)")
    if data[-8:] != b":::YEE:>":
        raise ValueError("EPK file is truncated (missing end marker)")
    src = io.BytesIO(data[8:-8])

    def byte():
        b = src.read(1)
        if not b:
            raise ValueError("unexpected end of EPK header")
        return b[0]

    version = src.read(byte()).decode("latin1")
    if not version.startswith("ver2."):
        raise ValueError("unsupported EPK version: " + version)
    src.read(byte())                                  # file name
    src.read(struct.unpack(">H", src.read(2))[0])     # comment
    src.read(8)                                       # timestamp
    count = struct.unpack(">i", src.read(4))[0]
    compression = chr(byte())
    body = src.read()
    if compression == "G":
        body = gzip.decompress(body)
    elif compression == "Z":
        body = zlib.decompress(body)
    elif compression != "0":
        raise ValueError("unsupported EPK compression: " + compression)

    pos = 0
    for _ in range(count):
        kind = body[pos:pos + 4].decode("latin1")
        pos += 4
        if kind == "END$":
            raise ValueError("EPK ended early")
        name_len = body[pos]
        name = body[pos + 1:pos + 1 + name_len].decode("latin1")
        pos += 1 + name_len
        length = struct.unpack(">i", body[pos:pos + 4])[0]
        pos += 4
        if kind == "FILE":
            crc = struct.unpack(">I", body[pos:pos + 4])[0]
            content = body[pos + 4:pos + length - 1]
            if zlib.crc32(content) != crc:
                raise ValueError("checksum mismatch in " + name)
            if body[pos + length - 1:pos + length] != b":":
                raise ValueError("corrupt entry " + name)
        else:
            content = body[pos:pos + length]
        pos += length
        if body[pos:pos + 1] != b">":
            raise ValueError("corrupt entry " + name)
        pos += 1
        yield kind, name, content
    if body[pos:pos + 4] != b"END$":
        raise ValueError("EPK is missing its END marker")


def safe_relative(name: str):
    parts = [p for p in name.replace("\\", "/").split("/") if p not in ("", ".")]
    if not parts or any(p == ".." or ":" in p for p in parts):
        return None
    return "/".join(parts)


def dimension_folder(vfs_name: str) -> str:
    """minecraft_the_nether -> dimensions/minecraft/the_nether"""
    namespace, sep, path = vfs_name.partition("_")
    if not sep:
        namespace, path = "minecraft", vfs_name
    return f"dimensions/{namespace}/{path}"


def build_region(chunks: dict) -> bytes:
    """chunks: {(local_x, local_z): nbt blob} -> .mca file bytes"""
    locations = bytearray(SECTOR)
    timestamps = bytearray(SECTOR)
    body = bytearray()
    now = int(time.time())
    for (lx, lz), blob in sorted(chunks.items()):
        if blob[:2] == b"\x1f\x8b":
            scheme, payload = 1, blob            # gzip, stored as is
        else:
            scheme, payload = 2, zlib.compress(blob)
        record = struct.pack(">IB", len(payload) + 1, scheme) + payload
        sectors = -(-len(record) // SECTOR)
        if sectors > 255:
            raise ValueError(f"chunk {lx},{lz} is too large for a region file")
        offset = 2 + len(body) // SECTOR
        index = 4 * (lx + lz * 32)
        locations[index:index + 4] = struct.pack(">I", (offset << 8) | sectors)
        timestamps[index:index + 4] = struct.pack(">I", now)
        body += record + b"\x00" * (sectors * SECTOR - len(record))
    return bytes(locations) + bytes(timestamps) + bytes(body)


def convert(epk_bytes: bytes):
    """Return ({relative path: bytes}, stats) for the vanilla world folder."""
    files = {}
    regions = {}
    stats = {"type": None, "name": None, "chunks": 0, "other": 0, "skipped": []}
    for kind, name, content in read_epk(epk_bytes):
        if kind == "HEAD":
            if name == "file-type":
                stats["type"] = content.decode("latin1")
            elif name == "world-name":
                stats["name"] = content.decode("latin1")
            continue
        if kind != "FILE":
            continue
        rel = safe_relative(name)
        if rel is None:
            stats["skipped"].append(name)
            continue
        match = CHUNK_RE.match(rel)
        if not match:
            files[rel] = content
            stats["other"] += 1
            continue
        dim, storage, code = match.groups()
        x = int(code[:6], 16) - COORD_BIAS
        z = int(code[6:], 16) - COORD_BIAS
        key = (f"{dimension_folder(dim)}/{storage}", x >> 5, z >> 5)
        regions.setdefault(key, {})[(x & 31, z & 31)] = content
        stats["chunks"] += 1
    if stats["type"] != "epk/world262":
        raise ValueError(f"not an Eaglercraft 26.2 world export (type: {stats['type']})")
    if "level.dat" not in files and "level.dat_old" not in files:
        raise ValueError("the EPK does not contain a level.dat")
    for (folder, rx, rz), chunks in regions.items():
        files[f"{folder}/r.{rx}.{rz}.mca"] = build_region(chunks)
    stats["regions"] = len(regions)
    return files, stats


def main() -> int:
    args = [a for a in sys.argv[1:] if a != "--zip"]
    if len(args) != 2:
        print(__doc__)
        return 2
    source, out = Path(args[0]), Path(args[1])
    files, stats = convert(source.read_bytes())
    for rel, content in files.items():
        path = out / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    print(f"world name : {stats['name']}")
    print(f"chunks     : {stats['chunks']} in {stats['regions']} region files")
    print(f"other files: {stats['other']}")
    if stats["skipped"]:
        print(f"skipped    : {len(stats['skipped'])} entries with unsafe names")
    print(f"written to : {out}")
    if "--zip" in sys.argv:
        target = out.with_suffix(".zip")
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
            for rel, content in sorted(files.items()):
                archive.writestr(f"{out.name}/{rel}", content)
        print(f"zip        : {target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
