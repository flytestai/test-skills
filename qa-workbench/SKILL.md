---
name: qa-workbench
description: "Deploy and operate a local QA workbench powered by the ZenTao CLI. It auto-discovers every product, project and execution visible to the account, syncs Bugs and tasks silently in the background, groups Bugs by product and tasks by project, supports created/updated time sorting, Bug creation, local task creation, daily reports, local snapshots and Windows auto-start. It also watches Bugs created by an AI customer-service account (default autojob) from customer-service group chats and shows unresolved, pending-verification, closed and high-priority counts on the dashboard for daily follow-up. A release-management page groups versions from task executions and Bug versions and stores local test start/end windows, pinning and P1–P3 priorities linked to the dashboard. Use when users ask for a local test-management dashboard, a ZenTao task/Bug workbench, a QA daily-report tool, a customer-feedback tracker, or want to run this workbench for another account or team."
---

# QDesk QA Workbench

Deploy a self-contained local test workbench. The template is a vanilla HTML/CSS/JS frontend plus a dependency-free Node.js server. All ZenTao access goes through the local `zentao` CLI.

## What the workbench provides

- **QDesk dashboard**: clickable KPI cards for pending-verification Bugs, open Bugs opened by the account, tasks due today, and pending tasks.
- **Releases**: a 发版管理 page above 任务管理 that derives versions from synchronized task executions and Bug versions, shows task progress and pending/open Bug counts that link directly to a version-filtered Bug list, and lets the user set local test start/end windows, pin versions, assign P1/P2/P3 priorities, or close/reopen a release. Pinned versions sort first; the rest sort P1 → P2 → P3 → unset. Test windows, pinning, priorities and close flags are local-only and never written back to ZenTao. The dashboard's awaiting-release count and `发版：…` line only include versions with a configured test start or end time; unplanned versions remain in version readiness but are not counted as awaiting release. Both follow the same pin/priority order.
- **Tasks**: all tasks from every execution in projects visible to the account, grouped by project; scopes for mine / test / all. Users can also create local tasks with a title, content, start/end time, priority and pin flag; local tasks participate in the task board/list, due filters and dashboard counts, but never sync to ZenTao.
- **Bugs**: per-product groups; read scope is the union of Bugs opened by the account and assigned to the account. Write scope is stricter: only Bugs whose `assignedTo` is the current account may be changed. Sortable by created time and updated time (newest update first by default). The top toolbar filters by keyword, severity, status, product, version and type; the version dropdown lists versions in the current scope with their Bug counts.
- **Customer-feedback watch**: detects Bugs opened by the configured AI/autojob account (default `autojob`) that the current account handled, and shows unresolved, pending-verification and closed counts on the dashboard. It highlights P0/P1 items, lists daily follow-ups, and labels the source as AI-extracted customer-service chat. The source is usually a customer-service group chat where AI extracts customer complaints into ZenTao Bugs. Write scope is unchanged: follow-up reads are broad, but any Bug edit still requires `assignedTo` to be the current account.
- **Reports**: a daily report draft is generated automatically for the current day and refreshed from the latest snapshot while it remains an unedited auto draft (at most every 5 minutes). It follows a fixed template: test progress for scheduled versions, new / accepted / remaining-open Bug counts, today's task list with completion percentages, and AI customer-service counts (new, verified-closed, assigned-to-development). Manual saves stop automatic overwrites. Markdown copy and exports are supported.
- **Scheduled and incremental sync**: the page renders the last local snapshot immediately. A full sync runs every 30 minutes on workdays (Mon–Fri) from 08:30 to 18:00 local time by default, or when the user clicks sync; weekends and times outside the window are manual-only. Bug edits and status changes refresh just that one Bug via `zentao bug <id>` without a full sync.
- **Connection setup**: only URL, account, password and display name. Product IDs and project IDs are discovered automatically.
- **Local-only security**: binds `127.0.0.1`; passwords are never returned by the API.

## Prerequisites

Check these before installation:

```bash
node --version                 # Node.js >= 18
zentao --version               # ZenTao CLI available
zentao profile --format=json   # optional; lists configured accounts
```

Do **not** read, print, or copy credential files. If the CLI is not logged in, ask the user to run `zentao login` in their own terminal, or plan to enter credentials in the workbench UI.

## Installation workflow

### 1. Collect only the necessary choices

Ask for, or infer from context:

- target directory (default `./qa-workbench`)
- ZenTao login account (required for "mine" filters)
- display name (optional; defaults to account)
- local port (default `4173`)
- whether Windows auto-start is needed

Never ask the user to paste a password into the chat. The password belongs in the workbench connection form.

### 2. Install from the bundled template

Resolve `<skill_dir>` as the directory containing this `SKILL.md`, then run:

```bash
node <skill_dir>/scripts/install_workbench.mjs \
  --target ./qa-workbench \
  --account <zentao-account> \
  --name "<display-name>" \
  --port 4173
```

The installer copies the application, creates `config.json`, creates `data/`, and patches the Windows launcher health-check port. It has no npm dependencies.

Use `--force` only when updating an existing installation. Existing `data/` and `config.json` are preserved.

### Customer-feedback watch (autojob)

The optional `watch` block tracks Bugs created by an AI customer-service account:

```json
"watch": {
  "enabled": true,
  "autojobAccounts": ["autojob"],
  "productIds": [],
  "label": "AI 客服提取",
  "description": "来自客服群聊天记录，自动提取为禅道 Bug"
}
```

- `autojobAccounts`: accounts that create Bugs from customer-service chat logs. Default `["autojob"]`.
- `productIds`: optional product IDs to scan. An empty array scans every visible product; set IDs such as `[53, 55]` to reduce sync time.
- The watch counts only Bugs related to the current account: actively assigned to it, resolved by it, or closed by it. Closed Bugs lose their original `assignedTo`, so `resolvedBy` / `closedBy` are used as the ownership signal.
- `browseType=closed` and `closedbyme` return empty on some ZenTao versions, so the scan uses `browseType=all` per configured product and filters by `openedBy` locally. The autojob scan is cached separately for 15 minutes.
- Environment overrides: `QDESK_AUTOJOB_ACCOUNTS=autojob` and `QDESK_AUTOJOB_PRODUCTS=53,55`.
- The dashboard shows unresolved (active), resolved-by-me, closed, and high-priority (P0/P1) counts. Resolved items assigned back to the reporter or autojob are not counted as my pending verification. The workbench also adds unresolved items to the daily report and notification bell.

### 3. Verify the template before starting

```bash
cd qa-workbench
node --check server.js
node --check app.js
node --check core.js
npm test
```

Expected: all tests pass. The suite does not call ZenTao and does not create real Bugs.

### 4. Start and verify

```bash
npm start
# or: start.bat on Windows, ./start.sh on macOS/Linux
```

Then verify in a second terminal:

```bash
curl -s http://127.0.0.1:4173/api/health
curl -s "http://127.0.0.1:4173/api/bootstrap?meta=1"
```

Success criteria:

- `/api/health` returns `ok: true`.
- `ready` becomes true after the first background sync.
- `lastError` is null.
- counts include products, projects, tasks and Bugs.
- Opening `/` returns immediately even while `syncing` is true.

The first sync can take tens of seconds when the account has many products and executions. Poll `?meta=1` rather than repeatedly forcing a sync.

### 5. Connect ZenTao

Tell the user to open `http://127.0.0.1:4173` and use **偏好与数据 → 配置禅道连接**:

- URL
- account
- password
- display name

No product ID or project ID is required. Clicking **测试连接** validates the account and reports accessible product/project counts. Clicking **保存并同步** saves locally and starts background sync.

If the local CLI profile is already authenticated and the account is known, the workbench can run without saving a password. Ensure `tester.account` in `config.json` is set to that account.

### Local task creation

Users can click **新建任务** on the 任务管理 page and fill in title, content, start time, end time, priority and 置顶. Local tasks are stored only in `data/app-data.json`; they never write to ZenTao.

To create one through the skill, call the local API with the bundled helper:

```bash
node <skill_dir>/scripts/add-task.mjs \
  --title "回归验证登录流程" \
  --description "覆盖账号密码与验证码登录" \
  --start "2026-10-30T09:00" \
  --end "2026-10-30T18:00" \
  --priority P1 \
  --pinned
```

- The helper posts to `http://127.0.0.1:4173/api/tasks`; override with `QDESK_URL` or `--url`.
- It prints the created task as JSON, including the generated `LT-…` ID.
- Use `--json '{...}'` (or `--json -` with stdin) when passing a full payload.
- This is a local QDesk write, not a ZenTao write. It does not need ZenTao credentials.

### 6. Optional Windows auto-start

```powershell
powershell -ExecutionPolicy Bypass -File .\install-autostart.ps1
```

This registers the scheduled task `QDeskWorkbench`, which starts `start-hidden.vbs` after the current user logs on. Verify with:

```powershell
Start-ScheduledTask -TaskName QDeskWorkbench
```

Remove with `uninstall-autostart.ps1`. If the port is not `4173`, use the installer so the launcher health check is patched correctly.

## Operating rules

- **Read-only by default.** Existing ZenTao tasks must not be edited, deleted, or transitioned through this workbench. Local QDesk tasks (`isLocal: true`) may be created, edited, completed or deleted locally. Bug writes are explicit user actions only.
- **Only operate on your own Bugs.** Any Bug edit, close, resolve, activate, or batch transition must be limited to Bugs whose `assignedTo` is the current account. A Bug opened by the account but assigned to someone else is out of scope. A closed Bug stores `assignedTo=closed`, so its previous owner cannot be proven from the current field.
- **Batch close needs a confirmation list.** Before closing multiple Bugs, generate a read-only list (Bug ID, title, current status) filtered by `assignedTo`, present it to the user, and wait for an explicit "confirm/execute" reply. Close only the confirmed IDs; never include Bugs outside the list. Default cap is 100; require explicit approval to exceed it.
- **Verify after writing.** Re-read status and assignee for every changed ID, then report success, failure, and skipped items separately.
- **Never create a real Bug** unless the user explicitly asks to do so and provides the target product and content. Parameter validation alone is not authorization to write.
- **Do not collect passwords in chat.** Direct the user to the connection form or their own `zentao login`.
- **Do not expose** `data/zentao-auth.json`, `data/snapshot-cache.json`, tokens, or environment credentials.
- **Do not commit** the installed workbench's `data/` directory.
- Keep the service bound to `127.0.0.1` unless the user explicitly asks for network access and understands the risk.

## Architecture at a glance

```text
qa-workbench/
├── server.js               # HTTP API, snapshot cache, background sync
├── config.json             # local settings (no credentials)
├── lib/
│   ├── zentao.js           # CLI wrapper using spawn + argument arrays
│   ├── connection.js       # connection validation, masking, credential storage
│   ├── normalize.js        # ZenTao -> UI model
│   └── store.js            # reports/settings atomic JSON storage
├── index.html
├── styles.css
├── core.js                 # filters, sorting, report generation
├── app.js                  # views, routing, polling, interactions
├── data/                   # runtime only; ignored by git
├── tests/
└── start scripts
```

Sync flow:

1. Load `data/snapshot-cache.json` at startup.
2. Return it immediately from `/api/bootstrap`.
3. In the background, list products, projects and executions.
4. For each product, query Bugs with `--browseType=openedbyme` and `--browseType=assignedtome`.
5. For each execution, query tasks.
6. In parallel, scan configured autojob products with `--browseType=all`, keep Bugs opened by the autojob account, and compute the customer-feedback summary (cached 15 minutes).
7. Group Bugs by product and tasks by project; atomically replace the snapshot.

## Safety tooling

Both scripts are read-only and never close or edit a Bug:

```bash
# Check ownership of specific Bugs; exit 2 if any are not owned or not verifiable
node scripts/check-bug-owner.mjs 123 456 --require-all-owned

# Generate a confirmation CSV containing only Bugs assigned to the current account
node scripts/plan-bulk-close.mjs --product 13 --status resolved --output close-plan.csv
```

`plan-bulk-close.mjs` exits 3 when the owned set exceeds 100; review the CSV and rerun with `--allow-large` only after the user confirms the full list. See `references/safety.md` for the complete workflow.

## References

- `references/configuration.md` — configuration fields, environment variables, data scope and caching.
- `references/api-and-data.md` — HTTP API, snapshot lifecycle, local storage and security model.
- `references/safety.md` — ownership rules, bulk-close confirmation and post-write verification.
- `references/troubleshooting.md` — CLI errors, empty data, port conflicts, stale snapshots and Windows auto-start.

## Delivery checklist

- [ ] Template copied to a writable directory.
- [ ] `npm test` passes.
- [ ] Service responds on `127.0.0.1:<port>`.
- [ ] First background sync completes without `lastError`.
- [ ] User knows how to open the connection form and that product/project IDs are not required.
- [ ] User knows existing tasks are read-only, while Bugs assigned to the current account can be edited and moved through ZenTao status actions via the CLI; other users' Bugs are off-limits.
- [ ] User knows batch close requires a confirmed list and that every write must be re-read and verified.
- [ ] The dashboard shows the customer-feedback watch counts (unresolved / pending verification / closed / P0-P1), or the user explicitly disabled `watch.enabled`.
- [ ] If auto-start was requested, the scheduled task exists and starts the service.
