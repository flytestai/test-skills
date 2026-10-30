# QDesk 全功能操作（qdesk.mjs）

`scripts/qdesk.mjs` 是 QDesk 的唯一技能操作入口。页面上的同步、工作台、任务、Bug、发版、日报、设置、连接、搜索、通知、导出和页面跳转都可以通过它完成。

所有命令只访问本机 QDesk HTTP API；禅道写入由 QDesk 内部调用禅道 CLI 完成。本脚本不会直接读取 `data/zentao-auth.json`、`data/snapshot-cache.json` 或任何凭据文件。

## 基本用法

```bash
node <skill_dir>/scripts/qdesk.mjs --help
node <skill_dir>/scripts/qdesk.mjs status
```

通用参数：

| 参数 | 作用 |
| --- | --- |
| `--qdesk-url <url>` | QDesk 地址，默认 `QDESK_URL` 或 `http://127.0.0.1:4173`；`connection` 命令里的 `--url` 专指禅道地址 |
| `--format json\|text` | 输出 JSON（默认）或便于阅读的文本 |
| `--dry-run` | 写操作只输出将要发送的请求，不真正执行 |
| `--no-verify` | 写入后不等待复核；默认会重新读取并核对状态/负责人 |
| `--json '<对象>'` | 传入完整 JSON 负载；`--json -` 从 stdin 读取 |
| `--help` | 显示全部命令 |

退出码：

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功 |
| `1` | 请求失败、校验失败或复核失败 |
| `2` | 安全限制：Bug 不属于当前账号、缺少确认或批量清单不合格 |
| `3` | 批量关闭超过 100 条且未追加 `--allow-large` |

## 功能覆盖表

| 页面/功能 | 技能命令 |
| --- | --- |
| 服务健康、同步状态、账号、数据量 | `status` |
| 手动同步 | `sync` / `sync --wait` |
| 本地快照 | `bootstrap` / `bootstrap --full` |
| 工作台当日进度、指标、聚焦 | `dashboard` / `metrics` / `focus` |
| 顶栏通知铃铛 | `notifications` |
| 最近动态、最近 7 天节奏 | `activity` / `week` |
| 全局搜索/命令面板 | `search <关键词>` |
| 任务列表、筛选、排序、统计 | `tasks list` / `tasks stats` |
| 任务详情 | `tasks get <任务ID>` |
| 新建本地任务 | `tasks create` |
| 编辑、完成、重新打开、置顶 | `tasks update` / `complete` / `reopen` / `pin` / `unpin` |
| 删除本地任务 | `tasks delete <任务ID> --yes` |
| Bug 列表、范围、筛选、排序 | `bugs list` |
| Bug 详情 | `bugs get <BugID>` |
| Bug 上一条/下一条 | `bugs nav <BugID> --direction prev\|next` |
| Bug 统计 | `bugs stats` |
| Bug 版本下拉及数量 | `bugs versions` |
| 单条 Bug 刷新 | `bugs refresh <BugID>` |
| 新建 Bug | `bugs create` |
| 编辑 Bug | `bugs update <BugID>` |
| 指派、解决、关闭、激活、确认、删除 | `bugs assign` / `resolve` / `close` / `activate` / `confirm` / `delete` |
| 批量关闭确认清单 | `bugs plan-close --ids ...` |
| 批量关闭 | `bugs close-many --ids ... --yes` |
| 发版列表 | `releases list` |
| 设置测试开始/结束、优先级、置顶、关闭/重开、清空 | `releases set <版本>` |
| 发版卡片对应的 Bug | `releases bugs <版本> --kind pending\|open\|all` |
| 日报列表/详情 | `reports list` / `reports get [日期]` |
| 生成日报（可保存） | `reports generate --date ... [--save]` |
| 手动保存日报 | `reports save [日期]` |
| 重新采集日报 | `reports refresh [日期]` |
| 提交/转草稿 | `reports submit` / `reports draft` |
| 一键复制文本 | `reports copy [日期] [--clipboard]` |
| Markdown 导出 | `reports markdown` / `reports export` |
| 偏好、角色、团队、迭代、视图 | `settings get` / `settings update` |
| 禅道连接查询 | `connection get` |
| 连接测试/保存并同步 | `connection test` / `connection save` |
| 全量 JSON 备份 | `export backup --output ...` |
| 任务/Bug CSV | `export tasks-csv` / `export bugs-csv` |
| 打开页面或 Bug 深链 | `open ...` |

## 服务与工作台

```bash
node scripts/qdesk.mjs status
node scripts/qdesk.mjs sync --wait
node scripts/qdesk.mjs bootstrap
node scripts/qdesk.mjs dashboard --format text
node scripts/qdesk.mjs metrics
node scripts/qdesk.mjs focus
node scripts/qdesk.mjs notifications --format text
node scripts/qdesk.mjs activity --limit 5
node scripts/qdesk.mjs week --date 2026-10-30
```

- `sync` 只触发后台同步；`--wait` 默认最多等待 180 秒，可用 `--timeout <秒>` 调整。
- `dashboard` 返回 `metrics`、`focus` 和通知列表。
- 待发版数量只统计已设置测试结束时间且尚未结束的版本；只设置开始时间、未排期或已结束的版本不计入。

## 任务

```bash
node scripts/qdesk.mjs tasks list --scope mine
node scripts/qdesk.mjs tasks list --scope all --status todo --priority P1
node scripts/qdesk.mjs tasks list --scope all --due overdue --q 登录 --limit 20
node scripts/qdesk.mjs tasks list --scope all --local
node scripts/qdesk.mjs tasks stats --scope all
node scripts/qdesk.mjs tasks get LT-1001

node scripts/qdesk.mjs tasks create \
  --title "回归验证登录流程" \
  --description "覆盖账号密码与验证码登录" \
  --start "2026-10-30T09:00" \
  --end "2026-10-30T18:00" \
  --priority P1 --pinned

node scripts/qdesk.mjs tasks update LT-1001 --status doing --priority P2
node scripts/qdesk.mjs tasks complete LT-1001
node scripts/qdesk.mjs tasks reopen LT-1001
node scripts/qdesk.mjs tasks pin LT-1001
node scripts/qdesk.mjs tasks unpin LT-1001
node scripts/qdesk.mjs tasks delete LT-1001 --yes
```

- 只能修改或删除 `LT-...` 本地任务；禅道任务保持只读。
- `--status` 支持 `todo`、`doing`、`blocked`、`done`。
- `--due` 支持 `today`、`overdue`，与页面筛选一致。
- 创建任务属于本地写入，不访问禅道。

## Bug 读取

```bash
node scripts/qdesk.mjs bugs list --scope opened --limit 20
node scripts/qdesk.mjs bugs list --scope assigned
node scripts/qdesk.mjs bugs list --scope all --severity P0 --status unclosed
node scripts/qdesk.mjs bugs list --scope all --version 2.9.0 --type codeerror
node scripts/qdesk.mjs bugs list --scope all --assignee weizhen --sort severity --order asc
node scripts/qdesk.mjs bugs list --scope all --mine
node scripts/qdesk.mjs bugs list --scope all --pending --format text
node scripts/qdesk.mjs bugs list --scope assigned --assigned-open --format text
node scripts/qdesk.mjs bugs get 11911
node scripts/qdesk.mjs bugs nav 11911 --direction next
node scripts/qdesk.mjs bugs stats --scope opened
node scripts/qdesk.mjs bugs versions --scope all
node scripts/qdesk.mjs bugs refresh 11911
```

- `--scope`：`opened`（我创建）、`assigned`（指派给我）、`autojob`（AI 客服提取）、`all`（账号相关并集）。
- `--status` 支持 `unclosed`、`open`、`closed`、`resolved`、`active` 等页面筛选项。
- `--sort`：`updated`（默认）、`created`、`severity`、`priority`。
- `bugs nav` 沿用同样的筛选参数和排序，可直接得到上一条/下一条 Bug 的完整信息。
- 读取范围较宽，但任何 Bug 写入都必须满足 `assignedTo` 等于当前账号。

## Bug 写入

```bash
node scripts/qdesk.mjs bugs create \
  --title "【登录】验证码刷新后仍提示已过期" \
  --severity P1 --pri P1 \
  --product-id 53 --type codeerror \
  --steps "1. 打开登录页；2. 点击刷新验证码；3. 输入新验证码。" \
  --expected "可以正常登录" \
  --actual "仍然提示验证码已过期"

node scripts/qdesk.mjs bugs update 11911 --title "..." --severity P1 --pri P1
node scripts/qdesk.mjs bugs assign 11911 weizhen
node scripts/qdesk.mjs bugs resolve 11911 --resolution fixed --build trunk --comment "已修复"
node scripts/qdesk.mjs bugs close 11911 --comment "验证通过" --yes
node scripts/qdesk.mjs bugs activate 11911 --build trunk --comment "问题复现"
node scripts/qdesk.mjs bugs confirm 11911 --pri P1 --type codeerror --deadline 2026-11-01
node scripts/qdesk.mjs bugs delete 11911 --yes
```

安全规则：

- 修改前先读取 Bug；`isAssignedToMe !== true` 时以退出码 `2` 拒绝，不发送写请求。
- 关闭和删除单条 Bug 需要 `--yes`。
- 写入后默认重新读取，核对状态、负责人或字段；复核失败会返回 `verified: false` 并以退出码 `1` 结束。
- 不要创建真实 Bug，除非用户明确要求并给出产品与内容。参数通过校验不等于授权。

### 批量关闭

必须先出清单，再经用户确认后执行：

```bash
# 1. 只读清单：分组输出 owned / notOwned / missing
node scripts/qdesk.mjs bugs plan-close --ids 11911,11912,11913

# 2. 用户明确确认后执行
node scripts/qdesk.mjs bugs close-many --ids 11911,11912,11913 --yes --comment "版本收尾"
```

- `plan-close` 不会关闭任何 Bug；有非本人或缺失项时退出码为 `2`。
- `close-many` 要求全部 ID 都属于当前账号；只要有一项不属于当前账号或找不到，就整体中止，不关闭任何记录。
- 默认上限 100 条；超过后需用户确认完整清单并追加 `--allow-large`。
- 每条关闭后都会复核，结果逐条返回。

## 发版管理

```bash
node scripts/qdesk.mjs releases list
node scripts/qdesk.mjs releases set 2.9.0 --start 2026-10-26T09:00 --end 2026-10-29T18:00
node scripts/qdesk.mjs releases set 2.9.0 --priority P1 --pinned
node scripts/qdesk.mjs releases set 2.9.0 --unpinned
node scripts/qdesk.mjs releases close 2.9.0
node scripts/qdesk.mjs releases reopen 2.9.0
node scripts/qdesk.mjs releases set 2.9.0 --clear
node scripts/qdesk.mjs releases bugs 2.9.0 --kind pending --limit 20
node scripts/qdesk.mjs releases bugs 3.0.0 --kind open
```

- 发版时间、置顶、优先级、关闭状态都是 QDesk 本地数据，不写回禅道。
- `--start` / `--end` 使用本地时间 `YYYY-MM-DDTHH:mm`；结束时间不能早于开始时间。
- 版本只设置开始时间时仍出现在版本就绪度中，但不会计入待发版。
- 已结束或已关闭的版本不再进入工作台待发版队列。
- `--clear` 清空测试时间、优先级、置顶和关闭状态；全部为空时计划会被删除。

## 日报

```bash
node scripts/qdesk.mjs reports list
node scripts/qdesk.mjs reports get 2026-10-30
node scripts/qdesk.mjs reports generate --date 2026-10-30
node scripts/qdesk.mjs reports generate --date 2026-10-30 --save
node scripts/qdesk.mjs reports refresh 2026-10-30
node scripts/qdesk.mjs reports save 2026-10-30 --summary "今日完成回归，剩余 1 个 P1"
node scripts/qdesk.mjs reports submit 2026-10-30
node scripts/qdesk.mjs reports draft 2026-10-30
node scripts/qdesk.mjs reports copy 2026-10-30
node scripts/qdesk.mjs reports copy 2026-10-30 --clipboard
node scripts/qdesk.mjs reports markdown 2026-10-30 --output 工作日报.md
node scripts/qdesk.mjs reports export 2026-10-30 --format md --output 工作日报.md
node scripts/qdesk.mjs reports export 2026-10-30 --format json --output 工作日报.json
```

- `generate` 默认只生成不保存；加 `--save` 才写入。
- `save` 可传 `--summary`、`--version`、`--bugs-summary`、`--tasks`、`--autojob`、`--done`、`--bugs`、`--ongoing`、`--next`、`--risks`，也可用 `--json` 传完整对象。
- 手动保存会把 `autoGenerated` 置为 false，停止自动覆盖；`refresh` 会重新采集并恢复自动日报。
- `submit` 要求摘要非空。
- `copy` 输出固定精简格式，只保留进度、版本剩余未关闭 Bug、今日任务和 AI 客服新增/验证关闭数。

## 设置与连接

```bash
node scripts/qdesk.mjs settings get
node scripts/qdesk.mjs settings update --role "测试开发工程师" --team "质量保障组" --sprint "PC客户端"
node scripts/qdesk.mjs settings update --task-view list --task-scope test --bug-scope assigned

node scripts/qdesk.mjs connection get
node scripts/qdesk.mjs connection test --url https://example/zentao --account weizhen --password-env QDESK_ZENTAO_PASSWORD
node scripts/qdesk.mjs connection save --url https://example/zentao --account weizhen --tester-name 魏振 --password-env QDESK_ZENTAO_PASSWORD
```

密码规则：

- 不支持 `--password`，避免密码进入命令历史和日志。
- 只从 `QDESK_ZENTAO_PASSWORD`（或 `--password-env` 指定的变量）读取，或用 `--password-stdin` 从 stdin 读取。
- 不打印密码；连接查询只显示 `hasPassword` 和脱敏信息。
- `--dry-run` 会把密码字段替换为 `***`。
- 已有保存的连接时，`connection test` / `connection save` 可以省略密码。

## 搜索、页面与导出

```bash
node scripts/qdesk.mjs search 登录 --limit 10
node scripts/qdesk.mjs notifications
node scripts/qdesk.mjs open dashboard
node scripts/qdesk.mjs open releases
node scripts/qdesk.mjs open tasks
node scripts/qdesk.mjs open bugs
node scripts/qdesk.mjs open reports
node scripts/qdesk.mjs open settings
node scripts/qdesk.mjs open bug/11911
node scripts/qdesk.mjs open bug/11911 --edit
node scripts/qdesk.mjs open bug/11911 --launch

node scripts/qdesk.mjs export backup --output QDesk_backup_2026-10-30.json
node scripts/qdesk.mjs export tasks-csv --output 任务清单.csv
node scripts/qdesk.mjs export bugs-csv --output Bug清单.csv
node scripts/qdesk.mjs export backup --stdout
```

- `open` 只打印深链；加 `--launch` 才会调用系统浏览器。
- `export backup` 输出本地快照、设置、日报和发版计划；不包含禅道密码。
- CSV 带 UTF-8 BOM，Excel 直接打开不乱码。

## 推荐工作流

### 每日开始

```bash
node scripts/qdesk.mjs status
node scripts/qdesk.mjs sync --wait
node scripts/qdesk.mjs dashboard --format text
node scripts/qdesk.mjs notifications --format text
```

### 处理待验证 Bug

```bash
node scripts/qdesk.mjs bugs list --scope assigned --status unclosed --format text
node scripts/qdesk.mjs bugs get <ID>
node scripts/qdesk.mjs bugs close <ID> --comment "验证通过" --yes
```

### 版本收尾

```bash
node scripts/qdesk.mjs releases list --format text
node scripts/qdesk.mjs releases bugs 2.9.0 --kind pending --format text
node scripts/qdesk.mjs bugs plan-close --ids <ID1>,<ID2>
# 等待用户确认清单后
node scripts/qdesk.mjs bugs close-many --ids <ID1>,<ID2> --yes --comment "版本收尾"
node scripts/qdesk.mjs releases set 2.9.0 --end 2026-10-29T18:00
```

### 日报收尾

```bash
node scripts/qdesk.mjs reports refresh
node scripts/qdesk.mjs reports copy
node scripts/qdesk.mjs reports submit
```

## 禁止事项

- 不读取、不打印 `data/zentao-auth.json`、`data/snapshot-cache.json`、token 或密码。
- 不把 `data/` 提交到 Git。
- 不让服务监听 `0.0.0.0`，除非用户明确要求并理解风险。
- 不修改、关闭、删除 `assignedTo` 不是当前账号的 Bug。
- 批量关闭前必须展示清单并等待用户明确确认。
- 不在聊天中收集密码；使用连接表单、环境变量或 stdin。
- 不直接调用禅道 CLI 写入；所有禅道写入都经过 QDesk。
