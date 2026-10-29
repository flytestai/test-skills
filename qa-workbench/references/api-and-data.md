# HTTP API, snapshot and local data

All endpoints are served by `server.js` on the configured local host. JSON write endpoints enforce same-origin checks and a 1 MB body limit (256 KB for Bug creation).

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Service status, snapshot age, sync revision, product/project counts, masked connection, last error |
| GET | `/api/connection` | Current connection mask; never includes a password |
| POST | `/api/zentao/test` | Validate form values and probe accessible products/projects; does not save |
| POST | `/api/zentao/connection` | Validate, save locally, return current snapshot, start background sync |
| GET | `/api/zentao/file/:id` | Proxy a ZenTao image attachment through the local service; only raster images, credentials stay server-side |
| GET | `/api/bootstrap` | Return the current snapshot immediately; may trigger a background refresh |
| GET | `/api/bootstrap?meta=1` | Compact sync state and counts only; use for polling |
| GET | `/api/bootstrap?refresh=1` | Return current snapshot and trigger a background refresh |
| POST | `/api/sync` | Start a forced background sync; returns HTTP 202 immediately |
| GET | `/api/bugs?scope=opened\|assigned\|autojob\|all` | Bug list and stats for the requested scope |
| GET | `/api/bugs/stats?scope=…` | Bug classification stats and scope totals |
| POST | `/api/bugs` | Create a formal ZenTao Bug through the CLI |
| POST | `/api/bugs/:id/refresh` | Re-read one Bug and update the in-memory snapshot in place; no full sync |
| PUT / PATCH | `/api/bugs/:id` | Update CLI-supported Bug fields |
| POST | `/api/bugs/:id/assign` | Assign the Bug to a ZenTao account |
| POST | `/api/bugs/:id/resolve` | Resolve the Bug with resolution, build, assignee and comment |
| POST | `/api/bugs/:id/close` | Close the Bug with an optional comment |
| POST | `/api/bugs/:id/activate` | Re-activate the Bug with build, assignee and comment |
| POST | `/api/bugs/:id/confirm` | Confirm the Bug (ZenTao 22.5+ only) |
| POST | `/api/bugs/:id/delete` | Delete the Bug through the CLI (`--yes`) |
| GET | `/api/tasks?scope=mine\|test\|all` | Task list and stats, including merged local tasks |
| POST | `/api/tasks` | Create a local QDesk task; never writes to ZenTao |
| PATCH | `/api/tasks/:id` | Update a local task's fields, status or pin flag |
| DELETE | `/api/tasks/:id` | Delete a local task (`LT-…` only) |
| GET | `/api/releases` | Release catalog merged with local test windows, pinning and priorities, plus saved `releasePlans` |
| POST | `/api/releases` | Set or clear one version's test start/end time, pin flag or P1–P3 priority; does not write to ZenTao |
| GET | `/api/reports` | Stored daily reports |
| POST | `/api/reports` | Create or update one report |
| POST | `/api/settings` | Update display profile and UI preferences |

Static files are limited to `/`, `/index.html`, `/styles.css`, `/core.js`, `/app.js`. `config.json`, `data/`, `lib/`, `server.js` and tests are not exposed.

## Bug write payloads

`PUT /api/bugs/:id` accepts any subset of `title`, `severity` (`P0`–`P3`), `pri` (`P0`–`P3`), `type`, `openedBuild`, `project` (ID), `execution` (ID), `story` (ID), `assignedTo` (account) and `steps`. The server validates values, calls `zentao bug update`, then triggers a forced background sync.

Action payloads:

- `assign`: `{ assignedTo }` (required).
- `resolve`: `{ resolution, resolvedBuild, assignedTo, comment }`.
- `close`: `{ comment }`.
- `activate`: `{ openedBuild, assignedTo, comment }`.
- `confirm`: `{ assignedTo, type, pri, deadline, comment }`; requires ZenTao 22.5+.
- `delete`: no fields; runs `zentao bug delete <id> --yes`.

All action responses contain `{ ok: true, data: { id, action, message, incremental, refreshRequired } }`. After a successful write the server calls `zentao bug <id>` for that one Bug, re-normalizes it, updates the in-memory snapshot, recalculates Bug/autojob statistics, increments `revision` and writes the snapshot cache. `incremental: true` and `refreshRequired: false` mean the next `/api/bootstrap` already has the new state; a full sync is started only when the single-Bug read fails. ZenTao 22.4 does not support `bug confirm`, and its `bug update` CLI does not accept product or module changes.

## Release test windows, pinning and priority

Release records are derived from synchronized ZenTao data; no build or release write API is required. A version key is the first numeric version found in `task.execution` or `bug.version` (for example `PC2.9.0版本` → `2.9.0`); `主干` / `trunk` values are ignored. Tasks and account-related Bugs are grouped by that key, and `Core.releaseCatalog(tasks, bugs, releasePlans)` returns task progress, pending verification Bugs, open Bugs, the current test-window status (`testing`, `upcoming`, `ended`, `unplanned`), `pinned` and `priority`.

`POST /api/releases` payload:

```json
{ "key": "2.9.0", "testStart": "2026-10-01T09:00", "testEnd": "2026-10-31T18:00", "closed": false, "pinned": true, "priority": "P2" }
```

- `key`: required, letters, digits, dot, underscore or hyphen, maximum 64 characters.
- `testStart` / `testEnd`: optional local `YYYY-MM-DDTHH:mm` values; send both as empty strings to clear the window.
- `closed`: optional local close flag. Closing a release does not write to ZenTao and does not require a test window.
- `pinned`: optional local pin flag. Pinned releases sort above all non-pinned releases.
- `priority`: optional `P1`, `P2` or `P3`; any other value returns HTTP 400. Among pinned or non-pinned releases, order is P1 → P2 → P3 → unset.
- Every field is merged with the stored plan, so a request may update only one field.
- `testEnd` must not be earlier than `testStart`.
- A plan is deleted only when both times are empty and `closed` is false, `pinned` is false and `priority` is empty.
- Test windows, pinning, priorities and close flags are stored only in `data/app-data.json` under `releasePlans`; they never write back to ZenTao.
- The response returns `{ plan, releases, releasePlans, revision }`. Clients can merge `releasePlans` locally without a full snapshot reload.

The snapshot exposes both `releasePlans` (raw saved windows keyed by version) and `releases` (derived catalog). `Core.dailyFocus` merges the same records into `focus.versions.items[].testStart`, `testEnd`, `releaseStatus`, `pinned` and `priority`, so dashboard version labels, tooltips and ordering stay in sync with the release page. `focus.versions.pending` counts only version items whose `testStart` or `testEnd` is non-empty; unplanned versions still appear in `items` for version readiness but are not counted as awaiting release. Locally `closed` versions are removed from the queue entirely. The dashboard `发版：…` line uses the same scheduled-only filter and follows the same pin/priority order.

## Local tasks

The 任务管理 page can create local tasks. They are stored only in `data/app-data.json`, merged into the response-time snapshot, and never written to ZenTao.

`POST /api/tasks` payload:

```json
{
  "title": "回归验证登录流程",
  "description": "覆盖账号密码与验证码登录",
  "startAt": "2026-10-30T09:00",
  "endAt": "2026-10-30T18:00",
  "priority": "P1",
  "pinned": true
}
```

- `title`: required, maximum 160 characters.
- `description`: optional, maximum 4000 characters.
- `startAt` / `endAt`: optional local `YYYY-MM-DDTHH:mm` values; a date-only value is treated as `T00:00`.
- `priority`: `P0`, `P1`, `P2` or `P3`; default `P2`.
- `pinned`: optional local flag; pinned tasks sort before non-pinned tasks.
- `status`: optional for create (`todo` default); `PATCH` accepts `todo`, `doing`, `blocked`, `done`.
- `endAt` must not be earlier than `startAt`.
- The server generates an ID such as `LT-1001`; `PATCH` and `DELETE` only accept local IDs.
- A created task receives `isLocal: true`, `isMine: true`, `project: "本地任务"` and a derived `dueDate` from `endAt`.

The created task is included in `/api/bootstrap`, `/api/tasks`, task scope counts, the project chip for 本地任务, daily report data and dashboard/date logic. `POST`, `PATCH` and `DELETE` increment `revision` so the browser refreshes without a ZenTao sync. Use `scripts/add-task.mjs` from the skill as a CLI wrapper.

## Health example

```bash
curl -s http://127.0.0.1:4173/api/health
```

Important fields:

- `ok`: HTTP service is alive.
- `ready`: a snapshot exists.
- `syncing`: a background build is currently running.
- `lastSyncAt`: timestamp of the last successful snapshot.
- `cacheAgeMs`: age of the in-memory snapshot.
- `revision`: increments after each successful sync; clients poll this to detect changes.
- `productCount` / `projectCount`: discovered scope.
- `lastError`: sanitized background error.
- `connection`: `{ url, account, hasPassword, source, testerName }`, never a password.

## Polling pattern

1. `GET /api/bootstrap` once. Render immediately if it contains data.
2. If no snapshot, show the boot screen and poll `/api/bootstrap?meta=1` every 2.5 seconds.
3. When `revision` changes, fetch `/api/bootstrap` and render the new data.
4. After a manual sync, poll until `syncing` becomes false and `revision` changes.

Do not call `/api/bootstrap?refresh=1` in a loop; it starts a background sync and returns the old snapshot. Normal `/api/bootstrap` and `/api/bootstrap?meta=1` never start a full sync when a snapshot exists. Full syncs run every 30 minutes on workdays from 08:30 to 18:00 local time (configurable through `zentao.syncIntervalMinutes`, `zentao.syncWindow` and `zentao.syncWorkdays`), on an explicit `/api/sync`, or when no snapshot exists yet. Weekends and times outside the window are manual-only.

`syncState` includes `schedule` (legacy fixed times), `scheduleText`, `mode`, `intervalMinutes`, `window`, `workdays` and `nextSyncAt` (next scheduled full sync, ISO timestamp). `cacheSeconds` only controls the displayed `stale` flag; it does not trigger a sync.

## Manual sync

```bash
curl -s -X POST http://127.0.0.1:4173/api/sync
```

HTTP 202 response contains `started` and the current `syncState`. The request never waits for ZenTao.

## Snapshot shape (selected fields)

```json
{
  "tester": { "account": "...", "name": "..." },
  "products": [{ "id": "...", "name": "...", "bugCount": 0, "openBugs": 0 }],
  "projectList": [{ "id": "...", "name": "...", "taskCount": 0, "myTasks": 0 }],
  "tasks": [
    {
      "id": "LT-1001",
      "title": "回归验证登录流程",
      "description": "覆盖账号密码与验证码登录",
      "priority": "P1",
      "status": "todo",
      "startAt": "2026-10-30T09:00",
      "endAt": "2026-10-30T18:00",
      "dueDate": "2026-10-30",
      "pinned": true,
      "isLocal": true,
      "isMine": true,
      "project": "本地任务"
    }
  ],
  "bugs": [],
  "bugStats": {},
  "bugScopeStats": { "opened": {}, "assigned": {}, "autojob": {}, "all": {} },
  "autojob": {
    "enabled": true,
    "accounts": ["autojob"],
    "label": "AI 客服提取",
    "summary": {
      "active": 0,
      "resolved": 0,
      "closed": 0,
      "open": 0,
      "highPriorityOpen": 0,
      "createdToday": 0
    },
    "bugs": []
  },
  "taskStats": { "mine": {}, "test": {}, "all": {} },
  "scopeCounts": {
    "bugs": { "opened": 0, "assigned": 0, "autojob": 0, "all": 0 },
    "tasks": { "mine": 0, "test": 0, "all": 0 }
  },
  "reports": [],
  "releasePlans": {
    "2.9.0": {
      "key": "2.9.0",
      "name": "2.9.0",
      "testStart": "2026-10-01T09:00",
      "testEnd": "2026-10-31T18:00",
      "pinned": true,
      "priority": "P2",
      "updatedAt": "..."
    }
  },
  "releases": [
    {
      "key": "2.9.0",
      "name": "2.9.0",
      "projects": ["PC客户端"],
      "executions": ["PC2.9.0版本"],
      "taskTotal": 28,
      "taskDone": 23,
      "taskProgress": 82,
      "pendingBugs": 0,
      "openBugs": 5,
      "testStart": "2026-10-01T09:00",
      "testEnd": "2026-10-31T18:00",
      "pinned": true,
      "priority": "P2",
      "status": "testing"
    }
  ],
  "creation": {
    "products": [],
    "projects": [],
    "executions": [],
    "modules": [],
    "types": [],
    "priorities": [],
    "severities": []
  },
  "sync": { "lastSyncAt": "...", "durationMs": 0, "counts": {} },
  "syncState": {
    "syncing": false,
    "stale": false,
    "schedule": ["08:30", "12:00", "17:00"],
    "scheduleText": "工作日 08:30–18:00 每 30 分钟自动全量 · 其余时间手动",
    "mode": "interval",
    "intervalMinutes": 30,
    "window": { "start": "08:30", "end": "18:00" },
    "workdays": [1, 2, 3, 4, 5],
    "nextSyncAt": "2026-10-29T09:30:00.000Z",
    "revision": 1
  },
  "generatedAt": "..."
}
```

Bug scope semantics:

- `opened`: `bug.isMine` (opened by the configured account).
- `assigned`: `bug.isAssignedToMe`.
- `autojob`: AI customer-service Bugs related to the configured account; `autojobRelation` is `assigned`, `resolved` or `closed`.
- `all`: union of account-related Bugs plus related AI customer-service Bugs.

Customer-feedback summary semantics:

- `active`: `rawStatus = active`, still unresolved.
- `resolved`: my pending verification only (`needsMyVerification`): assigned to me, or opened by me and resolved by someone else.
- `resolvedByMe`: resolved by me but assigned back to the reporter; it is not my pending verification.
- `open`: all related items with `rawStatus != closed`.
- `closed`: `rawStatus = closed`.
- `highPriorityOpen`: open items whose ZenTao priority (`pri`) is P0 or P1. AI customer-service Bugs often use severity P3 while carrying the real priority in `pri`; the dashboard ranks by priority.

UI labels in the customer-feedback scope: autojob `active` Bugs assigned to me are shown as `待验证` (need triage), resolved-by-me Bugs as `我已解决`, and `closed` as `已关闭`.

The dashboard `当日进度` ring is computed client-side by `Core.dailyFocus(state, date)` and combines three queues:

- pending verification Bugs (`needsMyVerification`, plus autojob `active` Bugs assigned to me);
- versions awaiting release: versions with my pending or open Bugs, and recent executions (last 45 days) that still contain my unfinished tasks; versions whose only remaining work is stale historical tasks are ignored;
- my unfinished tasks that are due today, overdue, or in progress.

The ring percentage counts only pending-verification Bugs and my unfinished tasks. Version readiness (completed tasks ÷ all tasks in that version) is shown in its own row for reference and is not included in the percentage. The three category rows show Bug verification, version readiness, and task completion separately.

On the 发版管理 page, the `待验证 Bug` and `未关闭 Bug` counters are buttons that open `#/bugs` with `ui.bugFilters.version` set to the release key and `ui.bugFilters.releaseKind` set to `pending` or `open`. `Core.filterBugs` applies the same predicates as `Core.releaseCatalog` (`needsMyVerification` for pending; `isMine && status !== 'closed'` excluding pending for open), so the destination list count matches the card counter. The Bug page shows a removable version-filter banner that sticks below the top bar while the list scrolls; switching Bug scope clears the release filter.

The dashboard reads version test windows from `releasePlans` via `Core.releaseCatalog`. Version names in the hero append `（测试中）` for versions whose window contains the current time, and the version tooltip lists the configured start/end time. Editing a window on the 发版管理 page updates the dashboard immediately after the API response; no ZenTao sync is needed.

The fourth dashboard KPI card is `今日待验证`. It lists every pending-verification Bug regardless of creation date, sorted by priority, inside a scrollable area. Each row is a `data-action="open-bug"` button that opens that Bug's detail page directly. A card click does not open a separate list page.

Task scope semantics:

- `mine`: assigned to the configured account.
- `test`: task type is test.
- `all`: all tasks from visible executions.

## Local files

| File | Contents | Sensitive |
| --- | --- | --- |
| `data/app-data.json` | reports, local tasks, release test windows / pinning / priorities, display profile, UI preferences | moderate |
| `data/zentao-auth.json` | URL, account, plaintext local password, display name, version 2 schema | **yes** |
| `data/snapshot-cache.json` | full last successful snapshot, including tasks and Bugs | **yes** |
| `data/qdesk-autostart.log` | autostart stdout/stderr | low |
| browser `localStorage:qdesk.ui.v2` | view, scope, sort, report date | low |

All JSON files use temporary files plus atomic rename. Corrupt files are moved to `.broken-*` before rebuilding defaults.

`data/zentao-auth.json` is written with `0600` where the OS supports it. On Windows the mode may display differently, but the file is still local to the user profile.

## Security model

- Default bind address is `127.0.0.1`.
- Password is sent only to `/api/zentao/connection` or `/api/zentao/test`; it is never returned or logged.
- Errors are sanitized by replacing the password with a placeholder.
- Credentials are passed to the CLI through a child-process environment, not shell interpolation.
- Static whitelist, CSP, `X-Frame-Options: DENY`, same-origin checks and body-size limits are enabled.
- Existing ZenTao tasks are read-only. Local QDesk tasks (`LT-…`, `isLocal: true`) can be created, edited, completed and deleted locally without any ZenTao write. Existing Bugs can be updated, assigned, resolved, closed, activated, confirmed (22.5+) and deleted through the ZenTao CLI only when `assignedTo` is the current account.
- Batch close requires a read-only confirmation list and explicit user approval; only the confirmed IDs may be processed. See `references/safety.md`.
- After every write, re-read the affected Bug and report success, failure, and skipped items separately.

## Reset behavior

- Stop the service.
- Delete `data/snapshot-cache.json` to force a clean full snapshot on next start.
- Delete `data/zentao-auth.json` to remove the saved connection and fall back to the CLI profile.
- Delete `data/app-data.json` to reset reports, profile and preferences (destructive; confirm with the user first).

Never delete `data/` while the service is running.
