#!/usr/bin/env python3
"""Validate and stage a pinned private runtime without receiving its token."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import stat
import zipfile
from pathlib import Path
from urllib.parse import urlparse


PLATFORMS = {
    "darwin-arm64": ("darwin-arm64", "mediago-rights"),
    "windows-x64": ("win32-x64", "mediago-rights.exe"),
}


def stage_runtime(
    manifest_path: Path,
    archive_path: Path,
    target: str,
    release_tag: str,
    dist_root: Path,
) -> Path:
    if target not in PLATFORMS:
        raise ValueError(f"unsupported private runtime target: {target}")
    manifest_platform, binary_name = PLATFORMS[target]
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    tool = manifest.get("mediago-rights")
    if not isinstance(tool, dict):
        raise ValueError("private runtime manifest is missing mediago-rights")
    if tool.get("version") != release_tag or tool.get("policy") != "marketplace":
        raise ValueError("private runtime version or policy does not match the release build")
    platform = tool.get("platforms", {}).get(manifest_platform)
    if not isinstance(platform, dict):
        raise ValueError(f"private runtime manifest is missing {manifest_platform}")
    asset_url = str(platform.get("url", ""))
    parsed_url = urlparse(asset_url)
    if (
        parsed_url.scheme != "https"
        or parsed_url.username is not None
        or parsed_url.password is not None
        or parsed_url.hostname not in {"github.com", "api.github.com"}
    ):
        raise ValueError("private runtime URL must use HTTPS on GitHub without user information")
    size = platform.get("sizeBytes")
    if isinstance(size, bool) or not isinstance(size, int) or size <= 0:
        raise ValueError("private runtime sizeBytes must be positive")
    expected_sha = str(platform.get("sha256", "")).lower()
    if re.fullmatch(r"[0-9a-f]{64}", expected_sha) is None:
        raise ValueError("private runtime sha256 must contain 64 hexadecimal characters")
    member_name = str(platform.get("archivePath", ""))
    if member_name != binary_name:
        raise ValueError(f"private runtime archivePath must be {binary_name}")
    raw = archive_path.read_bytes()
    if len(raw) != size:
        raise ValueError(f"private runtime size is {len(raw)}, expected {size}")
    actual_sha = hashlib.sha256(raw).hexdigest()
    if actual_sha != expected_sha:
        raise ValueError(f"private runtime sha256 is {actual_sha}, expected {expected_sha}")
    with zipfile.ZipFile(archive_path) as archive:
        names = [entry.filename for entry in archive.infolist() if not entry.is_dir()]
        if names != [member_name]:
            raise ValueError(f"private runtime archive entries are invalid: {names}")
        binary = archive.read(member_name)
    if not binary:
        raise ValueError("private runtime binary is empty")

    dist_dir = dist_root / target / "tools" / "mediago-rights"
    shutil.rmtree(dist_dir, ignore_errors=True)
    dist_dir.mkdir(parents=True)
    binary_path = dist_dir / binary_name
    binary_path.write_bytes(binary)
    binary_path.chmod(binary_path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    cached_manifest = {
        "id": "mediago-rights",
        "bin": binary_name,
        "version": release_tag,
        "policy": "marketplace",
        "platform": manifest_platform,
        "url": asset_url,
        "archivePath": member_name,
        "sizeBytes": size,
        "sha256": expected_sha,
    }
    (dist_dir / "tool.json").write_text(
        json.dumps(cached_manifest, indent=2) + "\n",
        encoding="utf-8",
    )
    return binary_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--target", choices=tuple(PLATFORMS), required=True)
    parser.add_argument("--release-tag", required=True)
    parser.add_argument("--dist-root", type=Path, required=True)
    args = parser.parse_args()
    stage_runtime(args.manifest, args.archive, args.target, args.release_tag, args.dist_root)


if __name__ == "__main__":
    main()
