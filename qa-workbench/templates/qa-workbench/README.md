# QDesk · 本地测试工作台

一个只在本机运行的测试工作台，通过禅道 CLI 同步账号相关的 Bug、任务与项目数据，并提供日报、筛选、排序和本地快照能力。

- 前端：原生 HTML / CSS / JavaScript，无构建步骤。
- 后端：Node.js 原生 HTTP 服务，无第三方运行时依赖。
- 数据来源：本机 `zentao` CLI。
- 连接配置：只需 **ZenTao URL、账号、密码、显示姓名**，不需要产品 ID 或任务项目 ID。
- 数据范围：账号可访问的全部产品、项目与执行；Bug 取「我提交的 + 指派给我」，任务取可访问执行下的全部任务。
- 打开体验：优先读取本地快照，禅道同步在后台静默执行。
- 默认只监听 `127.0.0.1`。

## 环境要求

1. Node.js 18 或更高版本。
2. 已安装并可使用禅道 CLI：`zentao --version`。
3. 任意一种凭证：
   - 本机禅道 CLI 已登录；或
   - 在工作台「配置禅道连接」中填写 URL、账号和密码。

## 独立部署（推荐）

工作台是独立的 Node.js 进程，安装后不依赖 Agent 运行时。建议：

1. 安装到与 Agent 无关的目录，例如 `C:\Users\<user>\QDesk`。
2. 将 `zentao-cli` 复制到 `<安装目录>\tools\zentao-cli`。
3. 在 `config.json` 中设置 `"zentao.cliPath": "<安装目录>/tools/zentao-cli/bin/zentao.js"`；通过安装器部署时可直接使用 `--cli-path`。
4. Windows 登录自启指向 `<安装目录>\start-hidden.vbs`。

这样关闭、升级或卸载 Agent 都不会影响工作台；禅道凭据保存在用户目录的 CLI Profile 中。

## 快速开始

```bash
# 1. 生成配置（如果通过技能安装，安装器已自动完成）
cp config.example.json config.json

# 2. 启动服务
npm start
```

Windows 也可以双击 `start.bat`；macOS / Linux / Git Bash 可执行 `./start.sh`。

打开 **http://127.0.0.1:4173**，在「偏好与数据 → 配置禅道连接」中填写：

- 禅道 URL
- 登录账号
- 密码
- 显示姓名（可选）

点「测试连接」可先验证账号，并查看可访问的产品数与项目数；点「保存并同步」后开始后台同步。首次同步会遍历账号可访问的全部产品与执行，数据量大时可能需要几十秒；完成后页面自动更新，无需刷新。

如果只使用本机 CLI Profile，请把 `config.json` 中的 `tester.account` 设为 CLI 登录账号，或设置环境变量 `ZENTAO_ACCOUNT`。

## 功能

### QDesk 工作台

- 今日聚焦、质量雷达、最近动态和本周测试节奏。
- 四张指标卡可点击：待办任务、我提交的未关闭 Bug、今日到期、今日日报。
- 指标卡支持键盘 Enter / 空格操作。

### 任务管理（只读）

- 自动汇总账号可访问项目下的全部任务。
- 范围：我的任务 / 测试任务 / 全部任务。
- 项目数量条与项目下拉筛选，按项目归类。
- 支持关键词、优先级、项目、今日到期筛选。
- 任务详情展示执行、截止日期、工时、说明与变更记录。
- 不修改禅道中的已有任务。

### Bug 跟踪

- Bug 范围：我提交的 / 指派给我 / 全部（两者并集）。
- 按产品归类，展示每个产品的 Bug 总量、未关闭量、P0/P1 未关闭数、我提交数与指派给我数。
- 默认按更新时间从新到旧；创建时间、更新时间均支持升序 / 降序。
- 同时展示创建时间与更新时间，移动端自动切换为卡片。
- 支持关键词、严重程度、状态（含「未关闭」聚合项）、产品与类型筛选。
- 详情展示复现步骤、预期 / 实际结果、处理记录和禅道直达链接。
- 「登记 Bug」可选择账号可访问的产品，并填写严重程度、优先级、类型、指派账号、项目 / 执行、复现步骤等。
- 已有 Bug 只读。

### 工作日报

- 从当天任务与 Bug 自动生成六个栏目：今日摘要、已完成、Bug 跟踪、进行中、明日计划、风险与阻塞。
- 支持草稿、提交、转回草稿、重新采集。
- 支持复制 Markdown、导出 `.md`、导出任务 / Bug CSV。
- 日报保存在本地，不回写禅道。

### 偏好与数据

- 配置禅道连接（URL、账号、密码、显示姓名）。
- 展示产品数、项目数、后台同步间隔、最近同步时间、同步耗时和错误。
- 维护岗位、团队、迭代等展示信息。
- 任务与 Bug 的 JSON / CSV 导出。

## 同步机制

- 服务启动时读取 `data/snapshot-cache.json` 中的最近成功快照。
- `/api/bootstrap` 立即返回本地快照，页面打开不等待禅道 CLI。
- 快照缺失或过期时，后台自动同步；默认缓存 300 秒。
- 首次启动无快照时会返回结构完整的空快照，页面显示后台读取进度。
- 同步失败时保留旧快照，继续显示上一次数据，并记录脱敏错误。
- 右上角「禅道同步」只发起后台同步，接口立即返回 `202`。

一次完整同步会：

1. 读取全部可访问产品。
2. 读取全部项目与执行，并保留属于可访问项目的执行。
3. 对每个产品分别查询 `openedbyme` 与 `assignedtome` 的 Bug，按 ID 去重合并。
4. 对每个执行查询任务。
5. 生成按产品分组的 Bug 统计和按项目分组的任务统计。

## 配置

`config.json` 可参考 `config.example.json`。常用字段：

| 字段 | 说明 |
| --- | --- |
| `server.host` / `server.port` | 本地监听地址与端口，默认 `127.0.0.1:4173` |
| `tester.account` | 当前禅道登录账号；使用 CLI Profile 时需填写 |
| `tester.name` | 显示姓名，可留空 |
| `zentao.cacheSeconds` | 后台缓存秒数，最小 60，默认 300 |
| `zentao.openedBuild` | 创建 Bug 时的影响版本，默认 `trunk` |
| `zentao.openedBuildLabel` | 影响版本显示名，默认「主干」 |
| `zentao.moduleNames` | 可选：模块 ID 到显示名的映射 |
| `zentao.bugModules` | 可选：登记 Bug 时可选的模块列表 |
| `zentao.cliPath` | 可选：自定义 `zentao.js` 路径 |

环境变量：

- `QDESK_PORT` / `QDESK_HOST`
- `ZENTAO_ACCOUNT`
- `ZENTAO_PRODUCT_ID`（仅作为创建 Bug 的默认产品回退）
- `ZENTAO_CLI_JS`

## Windows 开机自启

```powershell
powershell -ExecutionPolicy Bypass -File .\install-autostart.ps1
```

默认注册计划任务 `QDeskWorkbench`，在当前用户登录后通过 `start-hidden.vbs` 静默启动。服务已在运行时不会重复启动。

取消：

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall-autostart.ps1
```

如果修改了端口，请同步修改 `start-hidden.vbs` 中的 `healthUrl`，或使用技能安装器重新生成。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 服务、快照、后台同步状态和错误（已脱敏） |
| GET | `/api/connection` | 当前连接（不含密码） |
| POST | `/api/zentao/test` | 测试连接，返回可访问产品 / 项目数量 |
| POST | `/api/zentao/connection` | 保存连接并启动后台同步 |
| GET | `/api/bootstrap` | 立即返回本地快照；`?meta=1` 返回同步状态；`?refresh=1` 触发后台刷新 |
| POST | `/api/sync` | 发起后台同步，返回 `202` |
| GET | `/api/bugs?scope=opened\|assigned\|all` | Bug 列表与统计 |
| POST | `/api/bugs` | 创建正式 Bug |
| GET | `/api/tasks?scope=mine\|test\|all` | 任务列表与统计 |
| GET / POST | `/api/reports` | 日报读取与保存 |
| POST | `/api/settings` | 展示信息与界面偏好 |

## 数据存储

| 数据 | 位置 |
| --- | --- |
| 日报、展示信息、范围偏好 | `data/app-data.json` |
| 禅道连接（含本地密码） | `data/zentao-auth.json` |
| 最近成功快照（含任务 / Bug 业务数据） | `data/snapshot-cache.json` |
| 界面偏好 | 浏览器 `localStorage`，键名 `qdesk.ui.v2` |

`data/` 已加入 `.gitignore`。密码和快照均只保存在本机，静态资源接口不会暴露 `data/`。

## 测试

```bash
npm test
# node --test tests/*.test.js
```

## 安全与边界

- 服务默认只绑定 `127.0.0.1`。
- 密码只保存在本机 `data/zentao-auth.json`，接口只返回 `hasPassword`。
- 错误信息会替换密码后再返回，日志不记录请求体或凭证。
- 已有任务和 Bug 不提供编辑、删除、状态流转。
- 只有主动提交「登记 Bug」时才会向禅道写入新记录。
- 已启用静态资源白名单、CSP、`X-Frame-Options: DENY`、同源校验和请求体大小限制。
- 这是个人效率工具，不替代正式项目管理和缺陷管理系统。
