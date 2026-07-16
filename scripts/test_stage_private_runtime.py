from __future__ import annotations

import hashlib
import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path


SCRIPT_PATH = Path(__file__).with_name("stage-private-runtime.py")
SPEC = importlib.util.spec_from_file_location("stage_private_runtime", SCRIPT_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"cannot load {SCRIPT_PATH}")
stage_script = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(stage_script)


class StagePrivateRuntimeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.archive = self.root / "mediago-rights-marketplace-darwin-arm64.zip"
        with zipfile.ZipFile(self.archive, "w") as zipped:
            zipped.writestr("mediago-rights", "runtime")
        self.manifest = self.root / "mediago-rights-marketplace-tools.json"
        self.write_manifest(hashlib.sha256(self.archive.read_bytes()).hexdigest())

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def write_manifest(self, sha256: str) -> None:
        self.manifest.write_text(
            json.dumps(
                {
                    "mediago-rights": {
                        "bin": "mediago-rights",
                        "version": "rights-v1.2.3",
                        "policy": "marketplace",
                        "platforms": {
                            "darwin-arm64": {
                                "url": (
                                    "https://api.github.com/repos/mediago-dev/"
                                    "mediago-drama-private/releases/assets/1"
                                ),
                                "archivePath": "mediago-rights",
                                "sizeBytes": self.archive.stat().st_size,
                                "sha256": sha256,
                            }
                        },
                    }
                }
            ),
            encoding="utf-8",
        )

    def test_stages_verified_runtime_and_cache_manifest(self) -> None:
        binary = stage_script.stage_runtime(
            self.manifest,
            self.archive,
            "darwin-arm64",
            "rights-v1.2.3",
            self.root / "dist",
        )
        self.assertEqual(binary.read_text(encoding="utf-8"), "runtime")
        cached = json.loads(binary.with_name("tool.json").read_text(encoding="utf-8"))
        self.assertEqual(cached["sha256"], hashlib.sha256(self.archive.read_bytes()).hexdigest())

    def test_rejects_sha_mismatch(self) -> None:
        self.write_manifest("0" * 64)
        with self.assertRaisesRegex(ValueError, "sha256"):
            stage_script.stage_runtime(
                self.manifest,
                self.archive,
                "darwin-arm64",
                "rights-v1.2.3",
                self.root / "dist",
            )

    def test_rejects_http_asset_url(self) -> None:
        manifest = json.loads(self.manifest.read_text(encoding="utf-8"))
        manifest["mediago-rights"]["platforms"]["darwin-arm64"]["url"] = "http://github.com/asset"
        self.manifest.write_text(json.dumps(manifest), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "HTTPS"):
            stage_script.stage_runtime(
                self.manifest,
                self.archive,
                "darwin-arm64",
                "rights-v1.2.3",
                self.root / "dist",
            )


if __name__ == "__main__":
    unittest.main()
