# Data Input Guide

This reference covers all supported ways to provide test data, matching the structure of `测试报告-PC 2.1.7版本测试.docx`.

## JSON Schema

```json
{
  "report_meta": {
    "platform": "PC / iOS / Android / Web",
    "version": "版本号，如 2.1.7",
    "requirement_url": "需求文档链接",
    "test_start_date": "2025.9.15",
    "test_end_date": "2025.9.28",
    "smoke_test_date": "冒烟测试日期",
    "system_test_start": "系统测试开始日期",
    "system_test_end": "系统测试结束日期",
    "testers": "测试人员姓名",
    "os": "Win11 / Win10 / macOS 14 / etc.",
    "device_name": "设备名称",
    "processor": "处理器型号",
    "ram": "内存大小",
    "test_basis": "测试依据说明",
    "bug_system_url": "禅道/Jira等BUG系统链接",
    "risk_assessment": "风险评估结论",
    "doc_status": "产品文档提供状态",
    "doc_clarity_status": "文档清晰度评估"
  },
  "test_scope": ["功能1", "功能2", "..."],
  "test_cases": {
    "total": 82,
    "executed": 82,
    "execution_rate": "100%",
    "passed": 82,
    "failed": 0
  },
  "bugs": {
    "total": 27,
    "fixed": 27,
    "fix_rate": "100%",
    "details": [
      {"id": "BUG-001", "title": "标题", "severity": "严重/一般/建议", "status": "已修复/未修复"}
    ]
  },
  "test_summary": "测试总结文字",
  "conclusion": "测试通过 / 测试不通过 / 有条件通过"
}
```

## Input Methods

### Method 1: 对话中描述 (Conversational)

User describes data naturally. Agent extracts structured data from the conversation.

**Example:**
```
请为 PC 3.0.0 版本生成测试报告：
- 平台：PC
- 版本：3.0.0
- 测试时间：2026.8.1-2026.8.7
- 测试人员：张三、李四
- 测试范围：登录改版、支付优化、消息推送
- 测试用例：120个全执行，通过率95%
- BUG：共15个，修复13个，修复率86.7%
- 测试结论：有条件通过，需修复2个未解决BUG后发布
```

### Method 2: 结构化 JSON 文件

User provides a JSON file. Agent reads and validates, then generates the report.

### Method 3: 模板交互引导 (Template-Guided)

Agent guides user section by section:
1. 先确认平台和版本号
2. 需求文档链接
3. 测试范围（列出功能点）
4. 测试计划（时间、人员）
5. 测试环境及配置
6. 测试依据
7. 测试用例执行情况
8. 测试缺陷统计
9. 风险评估
10. 产品文档验证

For each section, show the expected format and let user fill in or skip.

## Report Sections Mapped to JSON Fields

| Report Section | JSON Field(s) |
|---------------|---------------|
| 标题 | report_meta.platform + report_meta.version |
| 需求地址 | report_meta.requirement_url |
| 测试范围 | test_scope[] |
| 测试计划 | report_meta.test_*_date, testers |
| 测试环境及配置 | report_meta.os, device_name, processor, ram |
| 测试依据 | report_meta.test_basis |
| 测试用例 | test_cases.* |
| 测试缺陷 | report_meta.bug_system_url, bugs.* |
| 风险评估 | report_meta.risk_assessment |
| 产品文档验证 | report_meta.doc_status, doc_clarity_status |
| 测试结果 | test_cases + bugs + test_summary |
| 测试结论 | conclusion |
