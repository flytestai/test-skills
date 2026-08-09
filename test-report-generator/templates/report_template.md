# Test Report Template (DOCX Layout Specification)

Based on the actual template: `测试报告-PC 2.1.7版本测试.docx`

## Document Setup

- Page size: A4 (210mm × 297mm)
- Margins: top/bottom 2.54cm (1 inch), left/right 3.175cm (1.25 inches)
- Default font: 宋体
- Style: List Paragraph for all content

## Format Rules

| Element | Format |
|---------|--------|
| Title (H1) | Heading 1, CENTER, 宋体 |
| Section headers | List Paragraph, 18pt (小三号), **bold**, 宋体 |
| Content body | List Paragraph, 14pt (四号), 宋体 |
| Scope items | List Paragraph, 12pt (小四), 宋体 |
| Section spacing | One empty paragraph between sections |

## Report Sections (in order)

### 1. 标题 (Title)
```
PC X.X.X版本测试测试报告
```
- Style: Heading 1, centered

### 2. 需求地址 (Requirement Document Link)
**Section header**: 需求地址 (18pt bold)
**Content**: URL link (14pt)

### 3. 测试范围 (Test Scope)
**Section header**: 测试范围 (18pt bold)
**Content**: Numbered list of feature/module names (12pt)
```
1.功能模块A
2.功能模块B
3.功能模块C
...
```
Each item on its own line within the same paragraph, separated by line breaks.

### 4. 测试计划 (Test Plan)
**Section header**: 测试计划 (18pt bold)
**Content** (14pt each line):
```
测试时间：{start_date}-{end_date}
测试人员：{testers}
冒烟测试时间：{smoke_test_date}
系统测试时间：{system_test_start}-{system_test_end}
```

### 5. 测试环境及配置 (Test Environment)
**Section header**: 测试环境及配置： (18pt bold)
**Content** (14pt):
```
系统：{os}
设备名称	{device_name}
处理器	{processor}
机带 RAM	{ram}
```
Tab-separated key-value pairs in a single paragraph.

### 6. 测试依据 (Test Basis)
**Section header**: 测试依据： (18pt bold)
**Content** (14pt):
```
{test_basis_description}
```

### 7. 测试用例 (Test Cases)
**Section header**: 测试用例： (18pt bold)
**Content**: Usually populated via a separate table/chart. Can include:
- Test case execution stats
- Test case execution rate

### 8. 测试缺陷 (Test Defects/Bugs)
**Section header**: 测试缺陷 (18pt bold)
**Content** (14pt):
```
禅道bug链接：
{bug_system_url}
bug修复率：{fix_rate}%
```

### 9. 风险评估 (Risk Assessment)
**Section header**: 风险评估 (18pt bold)
**Content** (14pt):
```
{risk_assessment_text}
```

### 10. 产品功能说明文档验证结果 (Product Doc Verification)
**Section header**: 产品功能说明文档验证结果 (18pt bold)
**Content** (14pt):
```
产品功能说明文档链接或者文档       {doc_status}
根据产品功能说明文档操作是否清晰明了？{clarity_status}
```

### 11. 测试结果 (Test Results)
**Section header**: 测试结果 (18pt bold)
**Content** (14pt):
```
测试用例执行情况：{total}个测试用例全部执行，
测试用例执行率：{execution_rate}%
测试bug总计：{bug_total}个，修复BUG：{bug_fixed}个，BUG修复率：{bug_fix_rate}%
{test_summary}
```

### 12. 测试结论 (Test Conclusion)
**Content** (14pt):
```
测试结论：{conclusion}
```
