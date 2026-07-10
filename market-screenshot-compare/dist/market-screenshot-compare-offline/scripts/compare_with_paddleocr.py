#!/usr/bin/env python3
"""
PaddleOCR-assisted comparison helper for the market-screenshot-compare skill.

Turnkey behavior:
1. On first run it creates a local virtual environment under the skill folder.
2. It installs PaddleOCR dependencies into that local runtime automatically.
3. It re-runs itself inside the local runtime and performs field comparison.

When packaged for offline distribution, the same script reuses the bundled
runtime and local model cache without downloading anything again.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import venv
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple


SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent
RUNTIME_DIR = SCRIPT_DIR / ".runtime"
MODEL_CACHE_DIR = SCRIPT_DIR / ".paddle-models"
WINDOWS_PYTHON = RUNTIME_DIR / "Scripts" / "python.exe"
POSIX_PYTHON = RUNTIME_DIR / "bin" / "python"
RUNTIME_READY_FLAG = "MARKET_SCREENSHOT_COMPARE_RUNTIME_READY"
RUNTIME_PACKAGES = (
    "pip",
    "setuptools",
    "wheel",
    "pillow",
    "paddleocr",
    "paddlepaddle>=3.0.0",
)

FIELD_ALIASES: Dict[str, Tuple[str, ...]] = {
    "代码": ("代码", "证券代码", "股票代码"),
    "名称": ("名称", "股票名称", "证券名称"),
    "最新": ("最新", "现价", "最新价", "价格"),
    "涨跌": ("涨跌", "涨跌额"),
    "涨幅": ("涨幅", "涨跌幅"),
    "今开": ("今开", "开盘", "开"),
    "最高": ("最高", "最高价", "高"),
    "最低": ("最低", "最低价", "低"),
    "昨收": ("昨收", "昨收价", "昨"),
    "均价": ("均价", "平均价"),
    "涨速": ("涨速",),
    "振幅": ("振幅",),
    "总手": ("总手", "成交量"),
    "金额": ("金额", "成交额"),
    "换手": ("换手", "换手率"),
    "量比": ("量比",),
    "市盈率": ("市盈率", "pe"),
    "市净率": ("市净率", "pb"),
    "总股本": ("总股本",),
    "流通股本": ("流通股本", "流股本"),
    "总市值": ("总市值",),
    "流通市值": ("流通市值", "流值", "市值"),
}

NOISE_PATTERNS = (
    re.compile(r"^\d{1,2}:\d{2}(:\d{2})?$"),
    re.compile(r"^\d{4}/\d{1,2}/\d{1,2}$"),
)

VALUE_PATTERN = re.compile(r"[-+]?[\d,.]+%?|--|nan|N/A", re.IGNORECASE)


@dataclass
class OcrToken:
    text: str
    x: float
    y: float


def runtime_python() -> Path:
    return WINDOWS_PYTHON if os.name == "nt" else POSIX_PYTHON


def prepare_runtime_env(base: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    env = dict(base or os.environ)
    env.setdefault("PADDLE_HOME", str(MODEL_CACHE_DIR))
    env.setdefault("XDG_CACHE_HOME", str(SCRIPT_DIR / ".cache"))
    return env


def runtime_has_dependencies(python_path: Path) -> bool:
    probe = (
        "import importlib.util, sys; "
        "mods = ['PIL', 'paddleocr']; "
        "sys.exit(0 if all(importlib.util.find_spec(m) for m in mods) else 1)"
    )
    result = subprocess.run(
        [str(python_path), "-c", probe],
        check=False,
        env=prepare_runtime_env(),
    )
    return result.returncode == 0


def install_runtime_packages(python_path: Path) -> None:
    subprocess.run(
        [str(python_path), "-m", "pip", "install", "--upgrade", *RUNTIME_PACKAGES],
        check=True,
        env=prepare_runtime_env(),
    )


def ensure_runtime() -> None:
    if os.environ.get(RUNTIME_READY_FLAG) == "1":
        return

    MODEL_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    python_path = runtime_python()
    if not python_path.exists():
        print("正在为 skill 初始化本地 PaddleOCR 运行时，请稍候...", file=sys.stderr)
        venv.EnvBuilder(with_pip=True).create(RUNTIME_DIR)
        install_runtime_packages(python_path)
    elif not runtime_has_dependencies(python_path):
        print("检测到本地 OCR 运行时缺少依赖，正在自动补齐...", file=sys.stderr)
        install_runtime_packages(python_path)

    env = prepare_runtime_env()
    env[RUNTIME_READY_FLAG] = "1"
    command = [str(python_path), str(Path(__file__).resolve()), *sys.argv[1:]]
    raise SystemExit(subprocess.call(command, env=env))


ensure_runtime()

from PIL import Image, ImageEnhance, ImageFilter  # noqa: E402
from paddleocr import PaddleOCR  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="使用 skill 内置 PaddleOCR 能力对比两张行情截图")
    parser.add_argument("new_image", nargs="?", help="新行情截图路径")
    parser.add_argument("old_image", nargs="?", help="老行情截图路径")
    parser.add_argument(
        "--known-issue",
        action="append",
        default=[],
        help="已知问题类型，可重复传入，用于去重",
    )
    parser.add_argument("--lang", default="ch", help="PaddleOCR 语言参数，默认 ch")
    parser.add_argument("--json-only", action="store_true", help="仅输出 JSON，不输出中文摘要")
    parser.add_argument(
        "--prepare-models-only",
        action="store_true",
        help="仅预热本地 OCR 模型缓存，不执行截图对比",
    )
    return parser.parse_args()


def create_ocr(lang: str) -> "PaddleOCR":
    try:
        return PaddleOCR(lang=lang, use_doc_orientation_classify=False, use_doc_unwarping=False)
    except TypeError:
        return PaddleOCR(lang=lang, use_angle_cls=True)


def preprocess_image(path: Path) -> Image.Image:
    image = Image.open(path).convert("L")
    width, height = image.size
    image = image.resize((width * 2, height * 2))
    image = ImageEnhance.Contrast(image).enhance(1.8)
    image = image.filter(ImageFilter.SHARPEN)
    return image


def normalize_text(text: str) -> str:
    return text.strip().replace(" ", "").replace(":", "：")


def is_noise(text: str) -> bool:
    value = normalize_text(text)
    return any(pattern.match(value) for pattern in NOISE_PATTERNS)


def run_ocr(ocr: "PaddleOCR", image: Image.Image) -> List[OcrToken]:
    result = ocr.predict(image)
    tokens: List[OcrToken] = []
    for item in result:
        rec_texts = item.get("rec_texts", [])
        rec_polys = item.get("rec_polys", [])
        for text, poly in zip(rec_texts, rec_polys):
            normalized = normalize_text(str(text))
            if not normalized or is_noise(normalized):
                continue
            xs = [point[0] for point in poly]
            ys = [point[1] for point in poly]
            tokens.append(OcrToken(text=normalized, x=sum(xs) / len(xs), y=sum(ys) / len(ys)))
    tokens.sort(key=lambda token: (token.y, token.x))
    return tokens


def find_anchor_field(text: str) -> Optional[str]:
    for field, aliases in FIELD_ALIASES.items():
        if text in aliases:
            return field
    return None


def nearest_value(tokens: Sequence[OcrToken], anchor: OcrToken) -> Optional[str]:
    same_row = [
        token
        for token in tokens
        if abs(token.y - anchor.y) <= 20 and token.x > anchor.x and VALUE_PATTERN.search(token.text)
    ]
    if same_row:
        same_row.sort(key=lambda token: token.x)
        return same_row[0].text

    below_row = [
        token
        for token in tokens
        if token.y > anchor.y and abs(token.x - anchor.x) <= 120 and VALUE_PATTERN.search(token.text)
    ]
    if below_row:
        below_row.sort(key=lambda token: token.y)
        return below_row[0].text
    return None


def extract_fields(tokens: Sequence[OcrToken]) -> Tuple[Dict[str, str], List[str]]:
    fields: Dict[str, str] = {}
    unreadable: List[str] = []
    for token in tokens:
        field = find_anchor_field(token.text)
        if field is None or field in fields:
            continue
        value = nearest_value(tokens, token)
        if value is None:
            unreadable.append(field)
        else:
            fields[field] = value
    return fields, sorted(set(unreadable))


def issue_type_for_field(field: str) -> str:
    if field in {"总股本", "流通股本", "总市值", "流通市值"}:
        return "股本/市值字段不一致"
    if field in {"最高", "最低", "今开", "昨收", "均价"}:
        return "关键行情字段不一致"
    if field in {"涨幅", "涨跌", "涨速", "振幅"}:
        return "涨跌统计字段不一致"
    return f"{field}字段不一致"


def compare_fields(
    new_fields: Dict[str, str],
    old_fields: Dict[str, str],
    known_issues: Iterable[str],
) -> Tuple[List[Dict[str, str]], List[Dict[str, str]]]:
    shared_fields = sorted(set(new_fields) & set(old_fields))
    known_set = set(known_issues)
    mismatches: List[Dict[str, str]] = []
    new_issue_types: List[Dict[str, str]] = []
    seen_issue_types = set()

    for field in shared_fields:
        new_value = new_fields[field]
        old_value = old_fields[field]
        if new_value == old_value:
            continue
        issue_type = issue_type_for_field(field)
        item = {
            "field": field,
            "new_value": new_value,
            "old_value": old_value,
            "issue_type": issue_type,
        }
        mismatches.append(item)
        if issue_type in known_set or issue_type in seen_issue_types:
            continue
        seen_issue_types.add(issue_type)
        new_issue_types.append(item)
    return mismatches, new_issue_types


def build_summary(
    new_fields: Dict[str, str],
    old_fields: Dict[str, str],
    unreadable_new: List[str],
    unreadable_old: List[str],
    mismatches: List[Dict[str, str]],
    new_issue_types: List[Dict[str, str]],
) -> Dict[str, object]:
    shared_fields = sorted(set(new_fields) & set(old_fields))
    unreadable_fields = sorted(set(unreadable_new) | set(unreadable_old))
    return {
        "skill_dir": str(SKILL_DIR),
        "runtime_dir": str(RUNTIME_DIR),
        "model_cache_dir": str(MODEL_CACHE_DIR),
        "shared_fields": shared_fields,
        "checked_field_count": len(shared_fields),
        "unreadable_fields": unreadable_fields,
        "mismatches": mismatches,
        "new_issue_types": new_issue_types,
    }


def print_human_summary(summary: Dict[str, object]) -> None:
    print("结论：")
    new_issue_types = summary["new_issue_types"]
    unreadable_fields = summary["unreadable_fields"]
    if new_issue_types:
        for item in new_issue_types:
            print(
                f"- {item['issue_type']}：{item['field']}，新行情={item['new_value']}，老行情={item['old_value']}"
            )
    else:
        print("- 排除已知问题后，当前未发现新的问题类型。")
    print("")
    print(f"已检查共享字段数：{summary['checked_field_count']}")
    if unreadable_fields:
        print("未能确认字段：")
        for field in unreadable_fields:
            print(f"- {field}")


def warm_up_models(lang: str) -> None:
    create_ocr(lang)
    print(f"模型缓存已准备完成：{MODEL_CACHE_DIR}")


def main() -> int:
    args = parse_args()
    if args.prepare_models_only:
        warm_up_models(args.lang)
        return 0

    if not args.new_image or not args.old_image:
        raise SystemExit("请提供新行情截图和老行情截图路径，或使用 --prepare-models-only 预热模型。")

    new_path = Path(args.new_image)
    old_path = Path(args.old_image)
    ocr = create_ocr(args.lang)

    new_tokens = run_ocr(ocr, preprocess_image(new_path))
    old_tokens = run_ocr(ocr, preprocess_image(old_path))

    new_fields, unreadable_new = extract_fields(new_tokens)
    old_fields, unreadable_old = extract_fields(old_tokens)
    mismatches, new_issue_types = compare_fields(new_fields, old_fields, args.known_issue)

    summary = build_summary(
        new_fields,
        old_fields,
        unreadable_new,
        unreadable_old,
        mismatches,
        new_issue_types,
    )

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if not args.json_only:
        print("")
        print_human_summary(summary)
    return 0


if __name__ == "__main__":
    sys.exit(main())
