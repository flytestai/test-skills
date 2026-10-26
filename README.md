# test-skills

Bee Agent 测试相关技能合集，包含本地测试工作台、行情截图对比和测试报告生成。

## 技能列表

### qa-workbench

部署一个通过禅道 CLI 驱动的本地测试工作台：自动发现账号可访问的产品、项目和执行，后台静默同步 Bug 与任务，按产品/项目分类，支持 Bug 时间排序、Bug 创建、日报生成、快照缓存和 Windows 开机自启。

**主要能力：**
- 只需 URL、账号和密码，无需填写产品 ID / 项目 ID
- Bug 按产品归类，任务按项目归类
- Bug 支持创建时间、更新时间升序/降序，默认最新更新优先
- 页面读取本地快照秒开，禅道同步在后台执行
- 工作日报、Markdown / CSV 导出
- 本地部署、密码不回传、Windows 登录自启

### market-screenshot-compare

对比两张行情或报价截图，对齐相同行与字段，穷举检查所有共享可见字段，汇总不一致的数据，并将结论整理成适合开发或测试使用的问题标题。

**主要能力：**
- 对比新旧行情截图
- 对比不同软件的行情截图
- 对两张截图中所有相同字段的数值、行情数据和排序进行对比
- 忽略背景颜色、样式和排版差异
- 自动区分盘中和盘后
- 输出适合开发和测试使用的精简问题标题

### test-report-generator

根据标准模板生成 Word (.docx) 测试报告，包含 12 个板块：标题、需求地址、测试范围、测试计划、测试环境及配置、测试依据、测试用例、测试缺陷、风险评估、产品文档验证、测试结果、测试结论。

**主要能力：**
- 对话描述 / 结构化 JSON 文件 / 模板交互引导 三种数据输入方式
- 生成段落式 Word 测试报告（List Paragraph 格式，18pt 标题 + 14pt 正文）
- 自动汇总测试用例执行率、BUG 修复率
- 支持 PC / iOS / Android / Web 多平台

## 安装

把对应技能目录复制到 Bee 的 skills 目录下即可使用：
- `qa-workbench/` → 本地禅道测试工作台
- `market-screenshot-compare/` → 截图对比
- `test-report-generator/` → 测试报告生成

## 使用

```text
Use $qa-workbench to deploy a local ZenTao QA workbench for my account.
Use $qa-workbench to verify background sync and group Bugs by product.
Use $market-screenshot-compare to compare these two screenshots.
Use $market-screenshot-compare to summarize mismatched fields.
Use $test-report-generator to generate a test report for PC 2.8.0.
Use $test-report-generator to create a test report from this JSON data.
```
