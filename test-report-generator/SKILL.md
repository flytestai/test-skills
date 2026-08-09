---
name: test-report-generator
description: "Generate Word (.docx) test reports matching the standard template format. Report includes 12 sections: title, requirement URL, test scope (numbered list), test plan (dates/personnel), test environment (OS/hardware), test basis, test cases (execution stats), test defects (bug link + fix rate), risk assessment, product doc verification, test results summary, and test conclusion (pass/fail). Use when users need to create or generate software test reports, summarize test cycles, document bug statistics, or produce quality assessment reports. Supports conversational input, structured JSON files, or step-by-step template-guided data entry."
---

# Test Report Generator

Generate a Word (.docx) test report matching the standard paragraph-based template (`测试报告-PC 2.1.7版本测试.docx`).

## Quick Start

### Step 1: Collect Data

Three input methods are supported. See `references/data_input_guide.md` for full details.

1. **Conversation** — User describes data in chat. Extract and normalize.
2. **Structured file** — User provides a JSON file. Read and validate.
3. **Template-guided** — Guide user section by section through the 12 report sections.

### Step 2: Prepare JSON Input

Normalize collected data into this structure (see `templates/sample_data.json` for a complete example):

```json
{
  "report_meta": {
    "platform": "PC", "version": "2.1.7",
    "requirement_url": "...",
    "test_start_date": "2025.9.15", "test_end_date": "2025.9.28",
    "smoke_test_date": "...", "system_test_start": "...", "system_test_end": "...",
    "testers": "...",
    "os": "Win11", "device_name": "...", "processor": "...", "ram": "...",
    "test_basis": "...",
    "bug_system_url": "...",
    "risk_assessment": "...",
    "doc_status": "...", "doc_clarity_status": "..."
  },
  "test_scope": ["功能A", "功能B", "..."],
  "test_cases": {"total": 82, "executed": 82, "execution_rate": "100%", "passed": 82, "failed": 0},
  "bugs": {"total": 27, "fixed": 27, "fix_rate": "100%", "details": []},
  "test_summary": "...",
  "conclusion": "测试通过"
}
```

### Step 3: Generate the Report

Write JSON to a temp file, then run:

```bash
python <skill_dir>/scripts/generate_report.py --input data.json --output <report_name>.docx
```

Or pipe JSON directly:

```bash
echo '<json>' | python <skill_dir>/scripts/generate_report.py --output report.docx --json-stdin
```

Requires `python-docx`. Install: `pip install python-docx`.

### Step 4: Deliver

Output naming: `{platform}{version}版本测试测试报告.docx` (e.g., `PC2.1.7版本测试测试报告.docx`).

## Report Structure (12 Sections)

| # | Section | Format |
|---|---------|--------|
| 1 | **标题** | Heading 1, centered, "PC X.X.X版本测试测试报告" |
| 2 | **需求地址** | 18pt bold header + 14pt URL link |
| 3 | **测试范围** | 18pt bold header + 12pt numbered list (1.xxx, 2.xxx...) |
| 4 | **测试计划** | 18pt bold header + 14pt lines: 测试时间、测试人员、冒烟/系统测试时间 |
| 5 | **测试环境及配置** | 18pt bold header + 14pt tab-separated: 系统、设备名称、处理器、RAM |
| 6 | **测试依据** | 18pt bold header + 14pt text |
| 7 | **测试用例** | 18pt bold header + 14pt: total/executed/execution rate |
| 8 | **测试缺陷** | 18pt bold header + 14pt: 禅道链接 + bug total/fixed/fix rate |
| 9 | **风险评估** | 18pt bold header + 14pt risk conclusion text |
| 10 | **产品文档验证** | 18pt bold header + 14pt: doc status + clarity |
| 11 | **测试结果** | 18pt bold header + 14pt: execution summary + bug stats + overall summary |
| 12 | **测试结论** | 14pt: "测试结论：通过/不通过" |

All sections use `List Paragraph` style. Section headers: 18pt bold 宋体. Content: 14pt 宋体. Scope items: 12pt 宋体.

## Format Reference

Full layout specification is in `templates/report_template.md`. A complete working example JSON is in `templates/sample_data.json`.
