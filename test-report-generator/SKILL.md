---
name: test-report-generator
description: "Generate Word (.docx) test reports with 11 sections: title, requirement URL, test scope, test plan, test environment (default Win11), test cases, test defects, risk assessment (AI-generated from unresolved bugs), product doc verification, test results (AI-generated summary), and test conclusion (AI-determined pass/fail). Use when users need to create software test reports, summarize test cycles, or produce quality assessment reports. Guides users through missing sections with examples before generating."
---

# Test Report Generator

Generate a Word (.docx) test report. Guide user through 7 mandatory sections with examples, auto-fill defaults, and use AI to generate risk assessment, test results, and conclusion.

## Section Overview

| # | Section | Source | Required |
|---|---------|--------|----------|
| 1 | **标题** | User provides platform + version | ✅ |
| 2 | **需求地址** | User provides URL | ✅ |
| 3 | **测试范围** | User lists features | ✅ |
| 4 | **测试计划** | User provides dates/testers | ✅ |
| 5 | **测试环境及配置** | Auto-default (Win11), override if user says | ❌ default |
| 6 | **测试用例** | User provides total/executed/rate | ✅ |
| 7 | **测试缺陷** | User provides bug link + total/fixed/rate | ✅ |
| 8 | **风险评估** | AI generates from unresolved bugs | 🤖 auto |
| 9 | **产品功能说明文档验证** | User provides doc status | ✅ |
| 10 | **测试结果** | AI generates summary from all data | 🤖 auto |
| 11 | **测试结论** | AI determines pass/fail/conditional | 🤖 auto |

## Workflow

### Phase 1: Collect User Data

Go through the 7 mandatory sections one at a time. For each missing section, show an example before asking.

**❌ Never ask for:**
- 测试环境及配置 (use defaults)
- 风险评估 (AI generates)
- 测试结果 (AI generates)
- 测试结论 (AI generates)

#### Guided Examples for Each Section

**标题** — ask platform + version:
> 示例：PC 2.8.0 / iOS 3.1.5 / Android 4.2.0

**需求地址** — ask for doc URL(s):
> 示例：
> 【腾讯文档】PC客户端2.8.0版本需求文档
> https://docs.qq.com/doc/xxxxx

**测试范围** — ask for numbered feature list:
> 示例：
> 1. 首页全景图
> 2. 多周期K线训练
> 3. 持仓分析
> ...

**测试计划** — ask for dates and testers:
> 示例：
> 测试时间：2026.7.3-2026.8.7
> 测试人员：张三、李四
> 冒烟测试时间：2026.7.3
> 系统测试时间：2026.7.4-2026.8.7

**测试用例** — ask for counts:
> 示例：
> 测试用例总数：365条
> 已执行：365条
> 执行率：100%

**测试缺陷** — ask for bug link + stats:
> 示例：
> 禅道bug链接：https://chandao.xxx.com/...
> bug总计：27个，已修复：25个，未修复：2个
> bug修复率：92.6%

**产品功能说明文档验证** — ask for doc availability:
> 示例：
> 产品功能说明文档是否提供？是/否
> 文档操作说明是否清晰明了？是/否/部分

### Phase 2: AI Auto-Generate

Once all 7 mandatory sections have data, generate the 3 AI sections:

#### 风险评估

Analyze **unresolved bugs** AND **incompletely tested modules**. Logic:

**No risks:**
- All bugs fixed AND all scope items fully tested → "经测试，所覆盖测试场景，全部测试通过，风险可控。"

**Has risks — combine both sources:**

1. **遗留 BUG 风险**：List each unresolved bug with severity, impact scope, suggested action.
2. **未测试完成模块风险**：List modules that were not fully tested or couldn't be verified (e.g., "到期提醒 VIP专区-生产环境无法测试"), explain why and what risk it poses.

Output as prose:
```
存在以下遗留问题：
1. [致命] BUG-002 支付回调超时 — 影响所有支付功能 — 建议紧急修复后回归验证
2. [一般] 到期提醒VIP专区未完成测试 — 生产环境无法验证，存在上线后功能异常风险 — 建议上线后重点监控
```

#### 测试结果

Synthesize from test cases + bugs + scope:
```
测试用例执行情况：{total}个测试用例全部执行，
测试用例执行率：{rate}
测试bug总计：{bug_total}个，修复BUG：{bug_fixed}个，BUG修复率：{bug_fix_rate}
{overall_assessment}
```
If bugs remain unresolved, note them in the assessment. Otherwise use: "经测试，所覆盖测试场景，全部测试通过，风险可控。"

#### 测试结论

Determine from bug fix rate:
- fix rate = 100% → "测试通过"
- fix rate ≥ 90% but < 100% → "有条件通过（需修复剩余{count}个BUG后发布）"
- fix rate < 90% or critical unresolved bugs → "测试不通过"
- If user explicitly states a conclusion, use theirs instead.

### Phase 3: Generate Report

Build JSON from collected + generated data, then execute:

```bash
python <skill_dir>/scripts/generate_report.py --input data.json --output {platform}{version}版本测试测试报告.docx
```

JSON structure (all fields):
```json
{
  "report_meta": {
    "platform": "PC", "version": "2.8.0",
    "requirement_url": "https://...",
    "test_start_date": "2026.7.3", "test_end_date": "2026.8.7",
    "smoke_test_date": "2026.7.3",
    "system_test_start": "2026.7.4", "system_test_end": "2026.8.7",
    "testers": "魏振、黎平",
    "bug_system_url": "https://chandao...",
    "doc_status": "未提供", "doc_clarity_status": "未提供"
  },
  "test_scope": ["功能A", "功能B"],
  "test_cases": {"total": 365, "executed": 365, "execution_rate": "100%"},
  "bugs": {"total": 27, "fixed": 25, "unfixed": 2, "fix_rate": "92.6%"},
  "risk_assessment": "AI-generated text...",
  "test_summary": "AI-generated text...",
  "conclusion": "测试通过"
}
```

Environment fields (os, device_name, processor, ram) are NOT needed in JSON — the script hardcodes defaults. Override only if user explicitly provides different env info.

### Phase 4: Deliver

Output: `{platform}{version}版本测试测试报告.docx`

## Environment Defaults

```
系统：Win11
设备名称：DESKTOP-B476138
处理器：13th Gen Intel(R) Core(TM) i7-13620H (2.40 GHz)
机带 RAM：24.0 GB (23.7 GB 可用)
```

Only change these if user explicitly says "我的环境是 XXX".

## Format Reference

Full DOCX layout spec in `templates/report_template.md`. Complete JSON example in `templates/sample_data.json`. Detailed input guide in `references/data_input_guide.md`.
