"""Synthetic format fixtures, not a real Windows build."""
import importlib.util
import struct
import tempfile
import unittest
from unittest import mock
import uuid
from pathlib import Path
spec = importlib.util.spec_from_file_location("provenance", Path(__file__).with_name("collect-windows-crash-build.py"))
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
GUID = uuid.UUID("fdf8e992-48dd-41ce-a07d-f9384747d8d7")


def pe():
    data = bytearray(2048); data[:2] = b"MZ"; struct.pack_into("<I", data, 0x3C, 0x80)
    data[0x80:0x84] = b"PE\0\0"; struct.pack_into("<H", data, 0x86, 1)
    struct.pack_into("<H", data, 0x94, 240); struct.pack_into("<H", data, 0x98, 0x20B)
    struct.pack_into("<I", data, 0x98 + 108, 16); struct.pack_into("<II", data, 0x98 + 160, 0x1000, 28)
    struct.pack_into("<III", data, 0x98 + 240 + 12, 0x1000, 1024, 0x400)
    record = b"RSDS" + GUID.bytes_le + struct.pack("<I", 1) + b"C:\\private\\ai_rv_harness.pdb\0"
    struct.pack_into("<I", data, 0x40C, 2); struct.pack_into("<I", data, 0x410, len(record))
    struct.pack_into("<I", data, 0x418, 0x500); data[0x500:0x500 + len(record)] = record
    data[0x600:0x604] = b"RSDS"  # Decoy outside the real debug directory.
    return data


def pdb(age=1):
    data = bytearray(512 * 7); data[:32] = b"Microsoft C/C++ MSF 7.00\r\n\x1aDS\0\0\0"
    struct.pack_into("<6I", data, 32, 512, 1, 7, 20, 0, 2); struct.pack_into("<I", data, 1024, 3)
    struct.pack_into("<5I", data, 1536, 2, 0, 600, 4, 6)  # Info stream: non-contiguous blocks.
    struct.pack_into("<3I", data, 2048, 20000404, 0, age); data[2060:2076] = GUID.bytes_le
    return data


class ProvenanceTests(unittest.TestCase):
    def pair(self, symbols):
        with tempfile.TemporaryDirectory() as directory:
            exe, pdb_path = Path(directory)/"app.exe", Path(directory)/"app.pdb"
            exe.write_bytes(pe()); pdb_path.write_bytes(symbols)
            return module.verify_pair(exe, pdb_path)

    def test_sha256_without_python_311_file_digest(self):
        # CI may use Python 3.10: exercise the absence of the newer helper.
        with mock.patch.dict(module.hashlib.__dict__):
            module.hashlib.__dict__.pop("file_digest", None)
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "hash-fixture.bin"
                for payload in [b"", b"abc", b"ab\x00cd" * 500000]:
                    with self.subTest(size=len(payload)):
                        path.write_bytes(payload)
                        self.assertEqual(module.sha256(path), module.hashlib.sha256(payload).hexdigest())

    def test_standalone_build_recipe(self):
        recipe = module.build_recipe(module.DIAGNOSTIC_BUILD_COMMAND)
        self.assertEqual(recipe["cargoProfile"], "diagnostic")
        self.assertEqual(recipe["cargoFeatures"], ["tauri/custom-protocol"])
        self.assertEqual(recipe["frontendMode"], "embedded")
        self.assertIn("--locked", recipe["argv"])

    def test_rejects_dev_or_different_build_recipe(self):
        good = module.DIAGNOSTIC_BUILD_COMMAND
        for bad in [good.replace(" --features tauri/custom-protocol", ""),
                    good.replace("tauri/custom-protocol", "tauri/devtools"),
                    good.replace("diagnostic", "release"),
                    good.replace("--locked ", ""),
                    good.replace("--bin ai-rv-harness", "--example runtime_owner_stress")]:
            with self.subTest(command=bad), self.assertRaises(ValueError):
                module.build_recipe(bad)

    def test_workflow_build_and_provenance_use_same_standalone_recipe(self):
        workflow = (Path(__file__).resolve().parents[1] /
                    ".github/workflows/windows-runtime-diagnostic.yml").read_text()
        lines = [line.strip() for line in workflow.splitlines()]
        app_builds = [line for line in lines if line.startswith("cargo build ") and "--bin" in line]
        self.assertEqual(app_builds, [module.DIAGNOSTIC_BUILD_COMMAND])
        collectors = [line for line in lines if line.startswith("python -B scripts/collect-windows-crash-build.py ")]
        self.assertEqual(len(collectors), 1)
        self.assertIn('--build-command "' + module.DIAGNOSTIC_BUILD_COMMAND + '"', collectors[0])

    def test_exact_pair_and_private_path_basename(self):
        result = self.pair(pdb()); self.assertEqual(result["exe"]["guid"], str(GUID))
        self.assertEqual(result["exe"]["pdbName"], "ai_rv_harness.pdb")
        self.assertEqual(len(result["exe"]["sha256"]), 64)

    def test_wrong_age(self):
        with self.assertRaisesRegex(ValueError, "GUID/age mismatch"): self.pair(pdb(2))

    def test_wrong_guid(self):
        data = pdb(); data[2060:2076] = uuid.UUID(int=0).bytes_le
        with self.assertRaisesRegex(ValueError, "GUID/age mismatch"): self.pair(data)

    def test_decoy_string_is_not_a_debug_record(self):
        data = pe(); struct.pack_into("<I", data, 0x40C, 0)
        with self.assertRaisesRegex(ValueError, "exactly one RSDS"): module.pe_identity(data)

    def test_invalid_bounds_and_geometry(self):
        for data in [b"", pdb()[:2048], b"x" * 4000]:
            with self.assertRaises(ValueError): module.pdb_identity(data)
        data = pdb(); struct.pack_into("<I", data, 1024, 99)
        with self.assertRaises(ValueError): module.pdb_identity(data)
        with self.assertRaises(ValueError): module.pe_identity(pe()[:300])


if __name__ == "__main__": unittest.main()
