# QDesk 测试工作台技能

把禅道里的测试任务、Bug 和日报整合到一个本地 Web 工作台，并支持一键部署。

## 主要能力

- 自动发现当前禅道账号可访问的全部产品、项目与执行。
- Bug 按产品归类：我提交的 / 指派给我 / 客服反馈 / 全部（账号相关并集）。
- 客服反馈看板：自动识别 `autojob` 等 AI 客服账号从客服群聊提取、并指派给我或由我解决 / 关闭的 Bug，展示未解决、待验证、已关闭和 P0/P1 未关闭数量，每天可直接跟进。
- 「当日进度」综合进度：只统计当天我名下待验证 Bug 和待完成任务；待发版版本与版本就绪度单独展示，不计入综合百分比，旧版本不会重复计入。
- 发版管理：从禅道同步的执行与 Bug 版本字段自动汇总版本，可为每个版本设置测试开始/结束时间并手动关闭/重新开启；点击版本卡片中的待验证/未关闭 Bug 数量可直接跳到按版本筛选的 Bug 列表。工作台的待发版数量与「发版：…」只统计已设置测试结束时间且尚未结束的版本，测试结束时间已过的版本仍保留在发版管理并标记「已结束」，但不再计入待发版队列；只设置开始时间或未排期的版本同样不计入，并同步显示测试窗口与「测试中」状态；测试时间与关闭状态均为本机独立记录。
- 「今日待验证」指标卡：列出我名下全部未验证 Bug，不限新增日期；点击卡片标题或「查看列表」进入同口径筛选的待验证 Bug 列表，点击单条直接打开对应 Bug 详情。「指派给我的未关闭 Bug」指标卡同样支持点击卡片或「查看列表」进入同口径筛选列表。
- 任务按项目归类：我的任务 / 测试任务 / 全部任务；支持在页面手动新建本地任务，填写标题、内容、开始 / 结束时间、优先级和置顶，也可通过 `scripts/add-task.mjs` 创建。
- 本地任务保存在 QDesk 本机，参与任务看板 / 列表、时间筛选和工作台统计，但不会写入禅道；支持编辑、完成、重新打开、删除和置顶。
- 全部页面功能可通过 `scripts/qdesk.mjs` 执行：同步、工作台、任务、Bug、发版、日报、设置、连接、搜索、通知、CSV/JSON 导出和页面深链；写操作内置归属校验、批量关闭确认和写后复核。
- Bug 支持按创建时间、更新时间升序 / 降序，默认更新时间从新到旧；顶部筛选栏支持关键词、严重程度、状态、产品、版本与类型，版本下拉显示当前范围内的 Bug 数量。Bug 详情页左右两侧悬浮方向切换按钮（仅显示箭头图标），滚动时保持可见，也可用 ← / → 快捷键切换。
- 后端快照缓存 + 后台静默同步，页面打开不等待禅道 CLI；工作日 08:30–18:00 每 30 分钟自动全量同步，周末与窗口外仅手动触发。
- 可创建正式 Bug（需用户明确授权），支持严重程度、优先级、指派、复现步骤。
- 每个工作日自动生成工作日报草稿：汇总版本测试进度、今日新增 / 验收 / 按版本分别统计的剩余未关闭 Bug、今日任务完成进度和 AI 客服今日数据；相关数据变化后立即重新采集并自动保存，手动保存后不再自动覆盖。支持一键复制紧凑纯文本（不含标题、页脚和「指派开发」），以及 Markdown 与 CSV 导出。
- 仅监听 `127.0.0.1`，密码不回传，本地凭证独立存储。
- Windows 登录后自动启动。

## 安全边界

- 禅道已有任务只读；本地任务只写入 QDesk，不产生禅道写入。Bug 写操作只允许针对 `assignedTo` 为当前账号的记录。
- 我提交但已指派给他人的 Bug 不能修改；已关闭 Bug 的 `assignedTo` 会变成 `closed`，归属必须在关闭前确认。
- 批量关闭前必须先只读生成清单并让用户确认，只关闭清单内的 ID；默认超过 100 条会拦截。
- 每次写入后逐条复核状态和指派人，分别报告成功、失败、跳过项。
- 配套的只读校验和清单工具见 `scripts/check-bug-owner.mjs` 与 `scripts/plan-bulk-close.mjs`，完整流程见 `references/safety.md`。

## 安装

```bash
node scripts/install_workbench.mjs \
  --target ./qa-workbench \
  --account <zentao-account> \
  --name "<display-name>" \
  --port 4173
```

安装后：

```bash
cd qa-workbench
npm test
npm start
```

打开 `http://127.0.0.1:4173`，在「偏好与数据 → 配置禅道连接」填写 URL、账号和密码。无需产品 ID 或项目 ID。

客服反馈看板默认监听 `autojob` 账号。可在 `qa-workbench/config.json` 中调整：

```json
"watch": {
  "enabled": true,
  "autojobAccounts": ["autojob"],
  "productIds": [53, 55],
  "label": "AI 客服提取",
  "description": "来自客服群聊天记录，自动提取为禅道 Bug"
}
```

`productIds` 留空会扫描全部可见产品；指定产品 ID 可显著缩短首次同步时间。关闭该看板时设置 `"enabled": false`。

## 目录

```text
qa-workbench/
├── SKILL.md
├── agents/openai.yaml
├── scripts/
│   ├── install_workbench.mjs
│   ├── qdesk.mjs                # 全功能操作 CLI
│   ├── add-task.mjs
│   ├── check-bug-owner.mjs
│   └── plan-bulk-close.mjs
├── references/
│   ├── operations.md            # 全部 CLI 命令与 UI 对应表
│   ├── configuration.md
│   ├── api-and-data.md
│   ├── safety.md
│   └── troubleshooting.md
└── templates/qa-workbench/     # 完整可运行应用
```

## 使用方式

```text
Use $qa-workbench to deploy a local ZenTao QA workbench for my account.
Use $qa-workbench to set up the workbench and verify background sync.
Use $qa-workbench to explain how product/project grouping and Bug sorting work.
Use $qa-workbench to add a local task for regression testing, priority P1 and pin it.
Use $qa-workbench to show today's dashboard, sync ZenTao and copy the daily report.
Use $qa-workbench to list pending Bugs for 2.9.0 and plan a batch close.
```

详细操作见 `SKILL.md` 与 `references/operations.md`。
