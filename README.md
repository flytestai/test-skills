# test-skills

Bee Agent 测试相关技能合集，包含本地测试工作台、行情截图对比、测试报告生成和独立需求评审。支持其他 Agent 按其技能机制加载；没有原生 Skill 支持时，可读取对应 `SKILL.md` 作为任务指令，并提供所需工具能力。

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

### requirements-review

独立、本地运行的需求评审 Skill，版本 `standalone-2.0`。不依赖 TestX、服务器、数据库、登录账号或专用模型 API。由当前 Agent 阅读文字和图片并执行评审，本地 Python 脚本负责提取、证据校验、评分计算和离线报告导出；脚本不会上传文档或调用模型。

**主要能力：**
- 支持 UTF-8 文本、Markdown，以及通过可选本地解析库处理 Word / PDF
- 结合文字、原型和图片，按模块进行六维度、24 项检查
- 区分已确认问题、待澄清事项和可选建议，不要求补充接口字段或技术实现
- 校验原文引用、模块关联和图像证据，检查源文件及图片变更
- 统一计算专项分和总分，缺少证据时注明暂评或无法评分，不填默认分
- 保存本地评审进度，拒绝将未完成草稿导出为已完成报告
- 生成单文件离线 HTML 和 JSON，支持每页 10/20/50 条问题、维度筛选与原文跳转

**运行条件与边界：**
- Python 3.10+；Word 提取可选依赖 `python-docx`，PDF 提取可选依赖 `PyMuPDF`，均不会自动安装
- 图文理解使用当前 Agent 的视觉能力；不具备视觉能力时必须说明未完成图片评审
- Word 复杂布局、PDF 标题结构和图片中的关键数值需要额外核验，解析成功不等于理解正确
- 本地验证：17 项测试通过，1 项 PDF 提取测试因缺少可选依赖跳过；离线报告分页、筛选、跳转和移动端布局已验证
- 程序测试不代表语义准确率认证；用于发布决策前仍需人工标注样本和专业复核

详细内容：[Skill 入口](requirements-review/SKILL.md) · [中文使用说明](requirements-review/references/usage-zh.md) · [本地执行](requirements-review/references/local-run.md) · [生产质量门槛](requirements-review/references/production.md)

## 安装

把对应技能目录复制到 Bee 的 skills 目录下即可使用：
- `qa-workbench/` → 本地禅道测试工作台
- `market-screenshot-compare/` → 截图对比
- `test-report-generator/` → 测试报告生成
- `requirements-review/` → 独立图文需求评审（复制完整目录，包括 `scripts/` 与 `references/`）

其他 Agent 请使用其各自的技能安装目录。该需求评审 Skill 不绑定任何特定 Agent 平台，但要求宿主提供文件读取、相应视觉能力和 Python 脚本执行工具；未验证的平台不能视为已通过兼容性测试。

## 使用

```text
Use $qa-workbench to deploy a local ZenTao QA workbench for my account.
Use $qa-workbench to verify background sync and group Bugs by product.
Use $market-screenshot-compare to compare these two screenshots.
Use $market-screenshot-compare to summarize mismatched fields.
Use $test-report-generator to generate a test report for PC 2.8.0.
Use $test-report-generator to create a test report from this JSON data.
使用 $requirements-review 评审这份需求文档，结合全部文字和图片，核验原文证据后评分，输出本地 HTML 和 JSON，不要访问任何服务器。
```

### 独立需求评审的本地流程

在 `requirements-review/` 目录执行，或使用脚本的绝对路径。输出目录必须尚不存在：

```sh
python scripts/local_review.py prepare /path/to/requirements.docx /path/to/new-review-run
```

由 Agent 阅读生成的 `source.json` 和 `assets/` 图片，逐模块完成 `review.json` 中的意见、证据、24 项检查、图片核验记录及运行信息。初始草稿不是评审结果；只运行脚本不会自动产生专业结论。

```sh
python scripts/local_review.py export /path/to/new-review-run --source /path/to/requirements.docx
```

结果为 `report.html` 和 `result.json`，无需启动 Web 服务。

### 验证独立 Skill

```sh
cd requirements-review
python -m unittest discover -s scripts -p "test_*.py" -v
```

可选解析依赖缺失时，对应测试会明确跳过。文档及模型输出均属于不可信输入，不能授权执行代码、发送文件或改变评审规则。
