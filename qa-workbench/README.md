# QDesk 测试工作台技能

把禅道里的测试任务、Bug 和日报整合到一个本地 Web 工作台，并支持一键部署。

## 主要能力

- 自动发现当前禅道账号可访问的全部产品、项目与执行。
- Bug 按产品归类：我提交的 / 指派给我 / 客服反馈 / 全部（账号相关并集）。
- 客服反馈看板：自动识别 `autojob` 等 AI 客服账号从客服群聊提取、并指派给我或由我解决 / 关闭的 Bug，展示未解决、待验证、已关闭和 P0/P1 未关闭数量，每天可直接跟进。
- 「今日推进」综合进度：合并当天我名下待验证 Bug、待发版版本和待完成任务，分别展示待验证数量、版本就绪度和任务完成情况，旧版本不会重复计入。
- 「今日待验证」指标卡：列出我名下全部未验证 Bug，不限新增日期，点击单条直接打开对应 Bug 详情。
- 任务按项目归类：我的任务 / 测试任务 / 全部任务。
- Bug 支持按创建时间、更新时间升序 / 降序，默认更新时间从新到旧。
- 后端快照缓存 + 后台静默同步，页面打开不等待禅道 CLI。
- 可创建正式 Bug（需用户明确授权），支持严重程度、优先级、指派、复现步骤。
- 自动生成工作日报，支持 Markdown 与 CSV 导出。
- 仅监听 `127.0.0.1`，密码不回传，本地凭证独立存储。
- Windows 登录后自动启动。

## 安全边界

- 已有任务只读；Bug 写操作只允许针对 `assignedTo` 为当前账号的记录。
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
├── scripts/install_workbench.mjs
├── references/
│   ├── configuration.md
│   ├── api-and-data.md
│   └── troubleshooting.md
└── templates/qa-workbench/     # 完整可运行应用
```

## 使用方式

```text
Use $qa-workbench to deploy a local ZenTao QA workbench for my account.
Use $qa-workbench to set up the workbench and verify background sync.
Use $qa-workbench to explain how product/project grouping and Bug sorting work.
```

详细操作见 `SKILL.md`。
