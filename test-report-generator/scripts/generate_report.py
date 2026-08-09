#!/usr/bin/env python3
"""
Test Report DOCX Generator (测试报告生成器)

Generates a Word (.docx) test report with 11 sections.
- Environment defaults hardcoded; override only if user provides env override.
- 测试依据 removed.
- risk_assessment, test_summary, conclusion provided as AI-generated text in JSON.

Usage:
    python generate_report.py --input data.json --output report.docx
    python generate_report.py --output report.docx --json-stdin
"""

import argparse
import json
import sys
from pathlib import Path

try:
    from docx import Document
    from docx.shared import Pt, Cm
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml.ns import qn
except ImportError:
    print("[ERROR] python-docx is required. Install it with: pip install python-docx")
    sys.exit(1)


# ── defaults ─────────────────────────────────────────────────────────

ENV_DEFAULTS = {
    "os": "Win11",
    "device_name": "DESKTOP-B476138",
    "processor": "13th Gen Intel(R) Core(TM) i7-13620H (2.40 GHz)",
    "ram": "24.0 GB (23.7 GB 可用)",
}


# ── helpers ──────────────────────────────────────────────────────────

def _east(run, font_name="宋体"):
    run.font.name = font_name
    run._element.rPr.rFonts.set(qn("w:eastAsia"), font_name)


def add_section_header(doc, text):
    """18pt bold 宋体, List Paragraph style."""
    p = doc.add_paragraph()
    p.style = doc.styles["List Paragraph"]
    run = p.add_run(text)
    run.font.size = Pt(18)
    run.bold = True
    _east(run, "宋体")
    return p


def add_content(doc, text, size=14, bold=False):
    """Content paragraph, List Paragraph style."""
    p = doc.add_paragraph()
    p.style = doc.styles["List Paragraph"]
    run = p.add_run(text)
    run.font.size = Pt(size)
    run.bold = bold
    _east(run, "宋体")
    return p


def add_blank(doc):
    p = doc.add_paragraph()
    p.style = doc.styles["List Paragraph"]
    return p


# ── section builders ─────────────────────────────────────────────────

def build_title(doc, meta):
    platform = meta.get("platform", "PC")
    version = meta.get("version", "X.X.X")
    title_text = f"{platform} {version}版本测试测试报告"
    p = doc.add_paragraph()
    p.style = doc.styles["Heading 1"]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run(title_text)
    _east(run, "宋体")
    return p


def build_requirement_url(doc, meta):
    add_section_header(doc, "需求地址")
    url = meta.get("requirement_url", "")
    if url:
        add_content(doc, url)
    else:
        add_content(doc, "（未提供）")
    add_blank(doc)


def build_test_scope(doc, data):
    add_section_header(doc, "测试范围")
    scope_items = data.get("test_scope", [])
    if not scope_items:
        add_content(doc, "（待填写）", size=12)
        add_blank(doc)
        return
    p = doc.add_paragraph()
    p.style = doc.styles["List Paragraph"]
    for i, item in enumerate(scope_items, 1):
        run = p.add_run(f"{i}.{item}")
        run.font.size = Pt(12)
        _east(run, "宋体")
        if i < len(scope_items):
            run_br = p.add_run("\n")
            run_br.font.size = Pt(12)
    add_blank(doc)


def build_test_plan(doc, meta):
    add_section_header(doc, "测试计划")
    start = meta.get("test_start_date", "")
    end = meta.get("test_end_date", "")
    testers = meta.get("testers", "")
    smoke = meta.get("smoke_test_date", "")
    sys_start = meta.get("system_test_start", "")
    sys_end = meta.get("system_test_end", "")

    if start or end:
        add_content(doc, f"测试时间：{start}-{end}")
    if testers:
        add_content(doc, f"测试人员：{testers}")
    if smoke:
        add_content(doc, f"冒烟测试时间：{smoke}")
    if sys_start or sys_end:
        add_content(doc, f"系统测试时间：{sys_start}-{sys_end}")
    add_blank(doc)


def build_test_environment(doc, meta):
    """Use hardcoded defaults; override only if meta provides env_override."""
    add_section_header(doc, "测试环境及配置：")

    env = dict(ENV_DEFAULTS)
    # User can override individual fields via meta
    for key in ("os", "device_name", "processor", "ram"):
        if meta.get(key):
            env[key] = meta[key]

    lines = [
        f"系统：{env['os']}",
        f"设备名称\t{env['device_name']}",
        f"处理器\t{env['processor']}",
        f"机带 RAM\t{env['ram']}",
    ]
    add_content(doc, "\n".join(lines))
    add_blank(doc)


def build_test_cases(doc, data):
    add_section_header(doc, "测试用例：")
    tc = data.get("test_cases", {})
    total = tc.get("total", 0)
    executed = tc.get("executed", 0)
    exec_rate = tc.get("execution_rate", f"{executed}/{total}")

    if total > 0:
        add_content(doc, f"测试用例总数：{total}个")
        add_content(doc, f"已执行：{executed}个")
        add_content(doc, f"测试用例执行率：{exec_rate}")
    else:
        add_content(doc, "（待填写）")
    add_blank(doc)


def build_test_defects(doc, data):
    add_section_header(doc, "测试缺陷")
    meta = data.get("report_meta", {})
    bugs = data.get("bugs", {})

    bug_url = meta.get("bug_system_url", "")
    bug_total = bugs.get("total", 0)
    bug_fixed = bugs.get("fixed", 0)
    bug_unfixed = bugs.get("unfixed", 0)
    fix_rate = bugs.get("fix_rate", "")

    if bug_url:
        add_content(doc, "禅道bug链接：")
        add_content(doc, bug_url)

    parts = [f"测试bug总计：{bug_total}个"]
    if bug_fixed:
        parts.append(f"修复BUG：{bug_fixed}个")
    if bug_unfixed:
        parts.append(f"未修复：{bug_unfixed}个")
    add_content(doc, "，".join(parts))
    if fix_rate:
        add_content(doc, f"bug修复率：{fix_rate}")

    # Detailed bug list if provided
    bug_details = bugs.get("details", [])
    if bug_details:
        add_blank(doc)
        add_content(doc, "BUG详细列表：", bold=True)
        for i, bug in enumerate(bug_details, 1):
            sev = bug.get("severity", "")
            status = bug.get("status", "")
            title = bug.get("title", "")
            bug_id = bug.get("id", "")
            add_content(doc, f"{i}. [{sev}][{status}] {bug_id} - {title}")

    add_blank(doc)


def build_risk_assessment(doc, data):
    """AI-generated risk assessment based on unresolved bugs."""
    add_section_header(doc, "风险评估")
    risk = data.get("risk_assessment", "")
    if risk:
        add_content(doc, risk)
    else:
        # Fallback: generic assessment
        meta = data.get("report_meta", {})
        fallback = meta.get("risk_assessment", "经测试，所覆盖测试场景，全部测试通过，风险可控。")
        add_content(doc, fallback)
    add_blank(doc)


def build_doc_verification(doc, meta):
    add_section_header(doc, "产品功能说明文档验证结果")
    doc_status = meta.get("doc_status", "未提供")
    clarity_status = meta.get("doc_clarity_status", "未提供")
    add_content(doc, f"产品功能说明文档链接或者文档\t{doc_status}")
    add_content(doc, f"根据产品功能说明文档操作是否清晰明了？{clarity_status}")
    add_blank(doc)


def build_test_results(doc, data):
    """AI-generated test results summary."""
    add_section_header(doc, "测试结果")
    summary = data.get("test_summary", "")
    if summary:
        add_content(doc, summary)
    else:
        # Fallback from legacy field
        fallback = data.get("report_meta", {}).get("risk_assessment", "")
        if fallback:
            add_content(doc, fallback)
        else:
            add_content(doc, "（待生成）")
    add_blank(doc)


def build_conclusion(doc, data):
    """AI-generated conclusion."""
    conclusion = data.get("conclusion", "")
    if not conclusion:
        conclusion = "（待判定）"
    add_content(doc, f"测试结论：{conclusion}")


# ── document setup ───────────────────────────────────────────────────

def setup_document():
    doc = Document()
    for section in doc.sections:
        section.page_width = Cm(21.0)
        section.page_height = Cm(29.7)
        section.top_margin = Cm(2.54)
        section.bottom_margin = Cm(2.54)
        section.left_margin = Cm(3.175)
        section.right_margin = Cm(3.175)

    style = doc.styles["Normal"]
    style.font.name = "宋体"
    style.font.size = Pt(14)
    style.element.rPr.rFonts.set(qn("w:eastAsia"), "宋体")

    if "List Paragraph" not in [s.name for s in doc.styles]:
        doc.styles.add_style("List Paragraph", 1)
    lp_style = doc.styles["List Paragraph"]
    lp_style.font.name = "宋体"
    lp_style.element.rPr.rFonts.set(qn("w:eastAsia"), "宋体")

    return doc


# ── main generation ──────────────────────────────────────────────────

def generate_report(input_data, output_path):
    doc = setup_document()
    meta = input_data.get("report_meta", {})

    # 1. 标题
    build_title(doc, meta)
    add_blank(doc)
    # 2. 需求地址
    build_requirement_url(doc, meta)
    # 3. 测试范围
    build_test_scope(doc, input_data)
    # 4. 测试计划
    build_test_plan(doc, meta)
    # 5. 测试环境及配置 (defaults)
    build_test_environment(doc, meta)
    # 6. 测试用例
    build_test_cases(doc, input_data)
    # 7. 测试缺陷
    build_test_defects(doc, input_data)
    # 8. 风险评估 (AI)
    build_risk_assessment(doc, input_data)
    # 9. 产品功能说明文档验证
    build_doc_verification(doc, meta)
    # 10. 测试结果 (AI)
    build_test_results(doc, input_data)
    # 11. 测试结论 (AI)
    build_conclusion(doc, input_data)

    doc.save(output_path)
    return output_path


def main():
    parser = argparse.ArgumentParser(
        description="Generate a Word (.docx) test report from JSON data."
    )
    parser.add_argument("--input", help="Path to JSON input file")
    parser.add_argument("--output", required=True, help="Path to output .docx file")
    parser.add_argument("--json-stdin", action="store_true",
                        help="Read JSON from stdin instead of file")

    args = parser.parse_args()

    if args.json_stdin:
        raw = sys.stdin.read()
        input_data = json.loads(raw)
    elif args.input:
        with open(args.input, "r", encoding="utf-8") as f:
            input_data = json.load(f)
    else:
        print("[ERROR] Either --input or --json-stdin is required.")
        sys.exit(1)

    if "report_meta" not in input_data:
        print("[ERROR] Input JSON must contain 'report_meta' field.")
        sys.exit(1)

    output = generate_report(input_data, args.output)
    print(f"[OK] Report generated: {output}")


if __name__ == "__main__":
    main()
