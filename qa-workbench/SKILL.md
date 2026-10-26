---
name: qa-workbench
description: "Deploy and operate a local QA workbench powered by the ZenTao CLI. It auto-discovers every product, project and execution visible to the account, syncs Bugs and tasks silently in the background, groups Bugs by product and tasks by project, supports created/updated time sorting, Bug creation, daily reports, local snapshots and Windows auto-start. Use when users ask for a local test-management dashboard, a ZenTao task/Bug workbench, a QA daily-report tool, or want to run this workbench for another account or team."
---

# QDesk QA Workbench

Deploy a self-contained local test workbench. The template is a vanilla HTML/CSS/JS frontend plus a dependency-free Node.js server. All ZenTao access goes through the local `zentao` CLI.

## What the workbench provides

- **QDesk dashboard**: clickable KPI cards for pending tasks, open Bugs opened by the account, tasks due today, and today's report.
- **Tasks**: all tasks from every execution in projects visible to the account, grouped by project; scopes for mine / test / all.
- **Bugs**: per-product groups; scope is the union of Bugs opened by the account and assigned to the account; sortable by created time and updated time (newest update first by default).
- **Reports**: daily report draft generated from the day's tasks and Bugs, with Markdown copy and exports.
- **Background sync**: the page renders the last local snapshot immediately; ZenTao sync runs silently in the background.
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
  --port 4173 \
  --cli-path <zentao-cli>/bin/zentao.js
```

The installer copies the application, creates `config.json`, creates `data/`, and patches the Windows launcher health-check port. It has no npm dependencies. `--cli-path` writes `zentao.cliPath` into the configuration; omit it to resolve the CLI from `PATH`.

Use `--force` only when updating an existing installation. Existing `data/` and `config.json` are preserved.

#### Independent deployment

To keep the workbench running after the agent is closed or removed, install it outside the agent directory and vendor the CLI:

- target: a neutral path such as `C:\Users\<user>\QDesk` or `~/qdesk`
- CLI: copy `zentao-cli` to `<install>/tools/zentao-cli` and pass `--cli-path <install>/tools/zentao-cli/bin/zentao.js`
- auto-start: register the Windows task against `<install>/start-hidden.vbs`
- credentials: keep the CLI profile in the user profile, not in the workbench directory

See `references/configuration.md` for the full layout.

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

- **Read-only by default.** Existing tasks and Bugs must not be edited, deleted, or transitioned through this workbench.
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
6. Group Bugs by product and tasks by project; atomically replace the snapshot.

## References

- `references/configuration.md` — configuration fields, environment variables, data scope and caching.
- `references/api-and-data.md` — HTTP API, snapshot lifecycle, local storage and security model.
- `references/troubleshooting.md` — CLI errors, empty data, port conflicts, stale snapshots and Windows auto-start.

## Delivery checklist

- [ ] Template copied to a writable directory.
- [ ] `npm test` passes.
- [ ] Service responds on `127.0.0.1:<port>`.
- [ ] First background sync completes without `lastError`.
- [ ] User knows how to open the connection form and that product/project IDs are not required.
- [ ] User knows existing ZenTao records are read-only.
- [ ] If auto-start was requested, the scheduled task exists and starts the service.
