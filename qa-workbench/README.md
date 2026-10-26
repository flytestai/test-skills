# QDesk 测试工作台技能

把禅道里的测试任务、Bug 和日报整合到一个本地 Web 工作台，并支持一键部署。

## 主要能力

- 自动发现当前禅道账号可访问的全部产品、项目与执行。
- Bug 按产品归类：我提交的 / 指派给我 / 全部（账号相关并集）。
- 任务按项目归类：我的任务 / 测试任务 / 全部任务。
- Bug 支持按创建时间、更新时间升序 / 降序，默认更新时间从新到旧。
- 后端快照缓存 + 后台静默同步，页面打开不等待禅道 CLI。
- 可创建正式 Bug（需用户明确授权），支持严重程度、优先级、指派、复现步骤。
- 自动生成工作日报，支持 Markdown 与 CSV 导出。
- 仅监听 `127.0.0.1`，密码不回传，本地凭证独立存储。
- Windows 登录后自动启动。

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
