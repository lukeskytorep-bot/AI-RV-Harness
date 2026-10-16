"""Verify exact PE/PDB identity and collect provenance; stdlib only, no EXE execution.
Formats: llvm.org/docs/PDB/{MsfFile,PdbStream}.html and Microsoft PE Debug Directory.
"""
import argparse
import hashlib
import json
import mmap
import platform
import shlex
import struct
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path


def span(data, offset, size):
    if offset < 0 or size < 0 or offset + size > len(data):
        raise ValueError("Truncated or out-of-range binary record")
    return data[offset:offset + size]


def u32(data, offset):
    return struct.unpack("<I", span(data, offset, 4))[0]


def pe_identity(data):
    if span(data, 0, 2) != b"MZ": raise ValueError("Expected PE image")
    pe = u32(data, 0x3C)
    if span(data, pe, 4) != b"PE\0\0": raise ValueError("Invalid PE signature")
    count = struct.unpack("<H", span(data, pe + 6, 2))[0]
    size = struct.unpack("<H", span(data, pe + 20, 2))[0]
    optional = pe + 24
    if struct.unpack("<H", span(data, optional, 2))[0] != 0x20B: raise ValueError("Expected PE32+")
    if size < 168 or u32(data, optional + 108) < 7: raise ValueError("No debug directory")
    def rva_offset(rva, length):
        for i in range(count):
            virtual, raw_size, raw = struct.unpack("<III", span(data, optional + size + i * 40 + 12, 12))
            if virtual <= rva and rva - virtual + length <= raw_size: return raw + rva - virtual
        raise ValueError("Debug RVA not backed by section")
    rva, length = struct.unpack("<II", span(data, optional + 160, 8))
    if not rva or not length or length % 28: raise ValueError("Invalid debug directory")
    start = rva_offset(rva, length)
    records = []
    for pos in range(start, start + length, 28):
        if u32(data, pos + 12) != 2: continue
        record = span(data, u32(data, pos + 24), u32(data, pos + 16))
        if record[:4] != b"RSDS" or len(record) < 25: continue
        name = record[24:].split(b"\0", 1)[0].decode("utf-8", errors="replace").replace("\\", "/").split("/")[-1]
        records.append({"guid": str(uuid.UUID(bytes_le=record[4:20])), "age": u32(record, 20), "pdbName": name})
    if len(records) != 1: raise ValueError("Expected exactly one RSDS CodeView identity")
    return {**records[0], "peTimestamp": f"0x{u32(data, pe + 8):08x}"}


def pdb_identity(data):
    if span(data, 0, 32) != b"Microsoft C/C++ MSF 7.00\r\n\x1aDS\0\0\0": raise ValueError("Expected MSF 7 PDB")
    block_size, _, blocks, size, _, block_map = struct.unpack("<6I", span(data, 32, 24))
    if block_size not in (512, 1024, 2048, 4096, 8192, 16384, 32768) or blocks * block_size > len(data): raise ValueError("Invalid block geometry")
    count = (size + block_size - 1) // block_size
    if not count or count * 4 > block_size: raise ValueError("Unsupported directory map size")
    directory_blocks = struct.unpack(f"<{count}I", span(data, block_map * block_size, count * 4))
    directory = b"".join(span(data, block * block_size, block_size) for block in directory_blocks)[:size]
    streams = u32(directory, 0)
    if streams < 2 or streams * 4 > len(directory) - 4: raise ValueError("Invalid stream directory")
    sizes = struct.unpack(f"<{streams}I", span(directory, 4, streams * 4))
    offset = 4 + streams * 4
    info = None
    for index, size in enumerate(sizes):
        length = 0 if size == 0xFFFFFFFF else (size + block_size - 1) // block_size
        stream_blocks = struct.unpack(f"<{length}I", span(directory, offset, length * 4)); offset += length * 4
        if index == 1:
            if size == 0xFFFFFFFF or size < 28: raise ValueError("Missing Info stream")
            info = b"".join(span(data, block * block_size, block_size) for block in stream_blocks)[:size]
    return {"guid": str(uuid.UUID(bytes_le=span(info, 12, 16))), "age": u32(info, 8)}


def read_identity(path, reader):
    with path.open("rb") as file, mmap.mmap(file.fileno(), 0, access=mmap.ACCESS_READ) as data: return reader(data)


def sha256(path):
    with path.open("rb") as file: return hashlib.file_digest(file, "sha256").hexdigest()


def verify_pair(exe, pdb):
    pe, symbols = read_identity(exe, pe_identity), read_identity(pdb, pdb_identity)
    if (pe["guid"], pe["age"]) != (symbols["guid"], symbols["age"]): raise ValueError("EXE and PDB GUID/age mismatch")
    return {"exe": {"name": exe.name, "sha256": sha256(exe), **pe}, "pdb": {"name": pdb.name, "sha256": sha256(pdb), **symbols}}


def command(*args): return subprocess.check_output(args, text=True).strip()


# The diagnostic workflow is intentionally a single, explicit standalone recipe.
# A Cargo optimization profile alone does not switch Tauri out of dev mode.
DIAGNOSTIC_BUILD_COMMAND = (
    "cargo build --manifest-path src-tauri/Cargo.toml --profile diagnostic "
    "--locked --bin ai-rv-harness --features tauri/custom-protocol"
)


def build_recipe(value):
    argv = shlex.split(value)
    if argv != shlex.split(DIAGNOSTIC_BUILD_COMMAND):
        raise ValueError("Expected locked diagnostic app build with tauri/custom-protocol")
    return {"command": value, "argv": argv, "cargoProfile": "diagnostic",
            "cargoFeatures": ["tauri/custom-protocol"],
            "frontendMode": "embedded", "manifestPath": "src-tauri/Cargo.toml",
            "binary": "ai-rv-harness"}


def main():
    parser = argparse.ArgumentParser()
    for name in ["exe", "pdb", "output"]: parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--build-command", required=True)
    args = parser.parse_args()
    recipe = build_recipe(args.build_command)
    result = verify_pair(args.exe, args.pdb)
    result.update({"build": recipe, "createdAt": datetime.now(timezone.utc).isoformat(), "sourceCommit": command("git", "rev-parse", "HEAD"),
                   "sourceGitTree": command("git", "rev-parse", "HEAD^{tree}"), "platform": platform.platform(),
                   "rustc": command("rustc", "-Vv"), "cargo": command("cargo", "-V"),
                   "cargoLockSha256": sha256(Path("src-tauri/Cargo.lock")), "packageLockSha256": sha256(Path("package-lock.json")),
                   "runtimePatchManifestSha256": sha256(Path("src-tauri/vendor/tauri-runtime-wry/PATCH.json")),
                   "runtimeResolution": command("cargo", "tree", "--manifest-path", "src-tauri/Cargo.toml", "--locked", "--offline", "--features", ",".join(recipe["cargoFeatures"]), "-i", "tauri-runtime-wry")})
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print("PASS: exact EXE/PDB GUID and age; hashes and provenance saved")


if __name__ == "__main__": main()
