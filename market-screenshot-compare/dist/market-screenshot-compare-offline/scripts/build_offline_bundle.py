#!/usr/bin/env python3
"""
Build an offline-distributable market-screenshot-compare skill package.

The bundle contains:
- the skill files
- a prepared local Python runtime under scripts/.runtime
- a warmed OCR model cache under scripts/.paddle-models

After extracting the bundle, users can run the OCR helper without manually
installing PaddleOCR or downloading models again.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent
COMPARE_SCRIPT = SCRIPT_DIR / "compare_with_paddleocr.py"
DIST_DIR = SKILL_DIR / "dist"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="构建可离线分发的 OCR skill 包")
    parser.add_argument(
        "--output",
        default=str(DIST_DIR / "market-screenshot-compare-offline"),
        help="离线包输出目录",
    )
    parser.add_argument(
        "--zip",
        action="store_true",
        help="额外生成 zip 压缩包",
    )
    return parser.parse_args()


def run(command: list[str]) -> None:
    subprocess.run(command, check=True)


def copy_skill_tree(target_dir: Path) -> None:
    if target_dir.exists():
        shutil.rmtree(target_dir)
    shutil.copytree(SKILL_DIR, target_dir, ignore=shutil.ignore_patterns("dist", "__pycache__", "*.pyc"))


def prepare_runtime_and_models(target_dir: Path) -> None:
    target_script = target_dir / "scripts" / "compare_with_paddleocr.py"
    run([sys.executable, str(target_script), "--prepare-models-only"])


def make_zip(target_dir: Path) -> Path:
    archive_base = str(target_dir)
    zip_path = shutil.make_archive(archive_base, "zip", root_dir=target_dir.parent, base_dir=target_dir.name)
    return Path(zip_path)


def main() -> int:
    args = parse_args()
    output_dir = Path(args.output).resolve()
    output_dir.parent.mkdir(parents=True, exist_ok=True)

    print(f"正在复制 skill 到离线输出目录：{output_dir}")
    copy_skill_tree(output_dir)

    print("正在预热本地运行时和 OCR 模型缓存，这一步可能较慢...")
    prepare_runtime_and_models(output_dir)

    print(f"离线目录已生成：{output_dir}")
    if args.zip:
        zip_path = make_zip(output_dir)
        print(f"离线压缩包已生成：{zip_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
