# Configuration and data scope

## Prerequisites

- Node.js 18 or newer.
- A working `zentao` CLI (`zentao --version`).
- ZenTao credential source, one of:
  - an existing local CLI profile;
  - URL + account + password saved through the workbench connection form.

Do not read or print the CLI credential file. If authentication is missing, ask the user to run `zentao login` in their own interactive terminal, or use the workbench form.

## `config.json`

Start from `config.example.json`. The installer creates this file automatically.

```json
{
  "server": {
    "host": "127.0.0.1",
    "port": 4173
  },
  "tester": {
    "account": "your-zentao-account",
    "name": "Your Name"
  },
  "zentao": {
    "openedBuild": "trunk",
    "openedBuildLabel": "主干",
    "serverVersion": "22.4",
    "cacheSeconds": 300,
    "syncIntervalMinutes": 30,
    "syncWindow": { "start": "08:30", "end": "18:00" },
    "syncWorkdays": [1, 2, 3, 4, 5],
    "refreshCooldownMs": 5000,
    "moduleNames": {},
    "bugModules": [
      { "id": "0", "name": "未指定" }
    ]
  },
  "watch": {
    "enabled": true,
    "autojobAccounts": ["autojob"],
    "productIds": [],
    "label": "AI 客服提取",
    "description": "来自客服群聊天记录，自动提取为禅道 Bug"
  }
}
```

| Key | Required | Meaning |
| --- | --- | --- |
| `server.host` | no | Bind address. Keep `127.0.0.1` for local-only use |
| `server.port` | no | HTTP port, default `4173` |
| `tester.account` | yes* | ZenTao login used for "mine" filters |
| `tester.name` | no | Display name; falls back to account |
| `zentao.openedBuild` | no | Build value used when creating a Bug, default `trunk` |
| `zentao.openedBuildLabel` | no | Display label for the build |
| `zentao.serverVersion` | no | Informational ZenTao version shown in settings |
| `zentao.cacheSeconds` | no | Snapshot freshness threshold, minimum 60, default 300; display only, does not trigger sync |
| `zentao.syncIntervalMinutes` | no | Workday full-sync interval in minutes, default 30; set to 0 to use fixed `syncTimes` instead |
| `zentao.syncWindow` | no | Auto-sync window, default `{ "start": "08:30", "end": "18:00" }`; no automatic sync outside it |
| `zentao.syncWorkdays` | no | Weekdays for auto-sync, default `[1,2,3,4,5]` (Mon–Fri); 0 is Sunday |
| `zentao.syncTimes` | no | Legacy fixed times used only when `syncIntervalMinutes` is 0, default `["08:30","12:00","17:00"]` |
| `zentao.refreshCooldownMs` | no | Minimum gap between manual refreshes |
| `zentao.cliPath` | no | Optional explicit path to the ZenTao CLI JS entry |
| `zentao.moduleNames` | no | Map of module IDs to display names |
| `zentao.bugModules` | no | Optional module choices in the Bug creation dialog |
| `watch.enabled` | no | Enable the AI customer-service feedback dashboard, default `true` |
| `watch.autojobAccounts` | no | Accounts that create Bugs from customer-service chat, default `["autojob"]` |
| `watch.productIds` | no | Product IDs to scan for autojob Bugs; empty scans all visible products |
| `watch.label` / `watch.description` | no | Dashboard label and source description |

\* If `tester.account` is empty, all data can still be listed, but "my tasks" and "my Bugs" scopes will be empty. The connection form sets this automatically when a saved connection is used.

`productId` and `taskProjectIds` are **not required**. Older configurations may contain them; they are treated only as compatibility fallbacks and do not limit synchronization.

## Release test windows, pinning and priority

发版管理 does not add configuration keys. It derives the version catalog from synchronized task `execution` values and Bug `version` values, then stores local test start/end times, a pin flag and an optional priority in `data/app-data.json`:

```json
{
  "releasePlans": {
    "2.9.0": {
      "key": "2.9.0",
      "name": "2.9.0",
      "testStart": "2026-10-01T09:00",
      "testEnd": "2026-10-31T18:00",
      "closed": false,
      "pinned": true,
      "priority": "P2",
      "updatedAt": "2026-10-29T11:51:30.181Z"
    }
  }
}
```

- Version keys come from the first numeric version in an execution or Bug version; `主干` / `trunk` is excluded.
- `testStart` and `testEnd` use local time in `YYYY-MM-DDTHH:mm` format. `testEnd` cannot be earlier than `testStart`.
- `closed` is a local flag; a closed release is hidden from the dashboard's awaiting-release queue and can be reopened at any time.
- `pinned` is a local flag that sorts a card above every non-pinned release, regardless of its status.
- `priority` accepts `P1`, `P2` or `P3`; within each pinned/non-pinned group, ordering is P1 → P2 → P3 → unset, then the existing status and test-window ordering.
- A plan is removed only when both times are empty and `closed`, `pinned` and `priority` are all empty/false.
- Test windows, pinning, priorities and close flags never write back to ZenTao and are not included in the snapshot cache; they are merged at response time.
- Status is derived at read time: `closed` when the local flag is set, otherwise `testing` when the current time is inside the window, `upcoming` before it, `ended` after it, and `unplanned` when no window is set.
- The dashboard awaiting-release count and `发版：…` line only include versions with a configured test end time that have not ended; versions with only a test start time and unplanned versions remain in version readiness but are not counted. Both follow the same pin/priority ordering.
- The 发版管理 page has no separate permission switch. Anyone who can open the local workbench can edit the windows, pinning, priorities and close/reopen releases.

## Environment variables

| Variable | Effect |
| --- | --- |
| `QDESK_PORT` | Overrides `server.port` |
| `QDESK_HOST` | Overrides `server.host` |
| `QDESK_URL` | Base URL used by `scripts/qdesk.mjs`, default `http://127.0.0.1:4173` |
| `QDESK_TIMEOUT_MS` | HTTP timeout for `qdesk.mjs`, default `60000` |
| `QDESK_ZENTAO_PASSWORD` | Password read by `qdesk.mjs connection test/save`; never printed. Prefer a temporary environment variable or `--password-stdin` |
| `ZENTAO_ACCOUNT` | Overrides `tester.account` |
| `ZENTAO_PRODUCT_ID` | Compatibility fallback for Bug creation only |
| `ZENTAO_CLI_JS` | Explicit ZenTao CLI entry path |
| `QDESK_AUTOJOB_ACCOUNTS` | Comma-separated AI customer-service accounts, default `autojob` |
| `QDESK_AUTOJOB_PRODUCTS` | Comma-separated product IDs to scan; empty means all |
| `QDESK_SYNC_INTERVAL_MINUTES` | Workday sync interval, default `30`; `0` falls back to `QDESK_SYNC_TIMES` |
| `QDESK_SYNC_WINDOW` | Sync window in `08:30-18:00` form |
| `QDESK_SYNC_WORKDAYS` | Comma-separated weekdays, default `1,2,3,4,5` |
| `QDESK_SYNC_TIMES` | Legacy fixed times, used only when the interval is 0 |
| `ZENTAO_URL`, `ZENTAO_TOKEN`, `ZENTAO_PASSWORD` | Read by the ZenTao CLI, not logged by QDesk |

## Account resolution order

1. A saved connection in `data/zentao-auth.json` (URL, account, password, display name).
2. Environment values used by the CLI (`ZENTAO_URL`, `ZENTAO_ACCOUNT`, token or password).
3. `config.json` / `ZENTAO_ACCOUNT`.
4. Existing local CLI profile for the actual CLI calls.

The account name controls "mine" filtering. It does not grant permissions by itself; ZenTao still enforces access control.

## Data scope

A full sync performs:

1. `product` list: all products visible to the account.
2. `project` list: all visible projects.
3. `execution` list: all visible executions, filtered to visible projects.
4. For every product:
   - `bug --product=<id> --browseType=openedbyme`
   - `bug --product=<id> --browseType=assignedtome`
   - merge by Bug ID and de-duplicate.
5. For every configured watch product (or all products):
   - `bug --product=<id> --browseType=all`
   - keep Bugs whose `openedBy` is in `watch.autojobAccounts`
   - retain the current account's items by `assignedTo` (active), `resolvedBy` (resolved) or `closedBy` (closed), because closed Bugs lose their original assignee.
6. For every execution: `task --executionID=<id>`.

This intentionally avoids the ZenTao 22.4 unsupported `my tasks`, `my bugs`, `bug --browseType=closed` and `closedbyme` commands. The customer-feedback scan uses `browseType=all` and filters locally.

"All Bugs" in the UI means **the account-related union** (opened by me + assigned to me + AI customer-service Bugs I handled), not every Bug in the company.

## Caching and concurrency

- `cacheSeconds` only controls the displayed `stale` flag; it does not schedule a refresh.
- Full syncs run every 30 minutes on workdays inside the configured window. Weekends and the rest of the day are manual-only.
- The first sync starts about 600 ms after server startup when no fresh snapshot exists.
- `/api/sync` triggers a background refresh and returns immediately.
- A failed sync keeps the previous snapshot and retries after roughly 60 seconds.
- An expired login (`AUTH_EXPIRED`) retries after 10 minutes. If a password is saved, the CLI logs in again and refreshes the token automatically; no manual step is needed.
- Each background sync is bounded at 15 minutes.
- List-level caches (products/projects/executions) are in memory; the full last successful snapshot is persisted.
- The customer-feedback scan is cached for 15 minutes independently of the main snapshot. A manual sync (`force`) refreshes it; normal page refreshes reuse the cache.
- Scanning all products for `browseType=all` is the slowest part of the first sync. Set `watch.productIds` to the products that actually receive AI customer-service Bugs (for example `[53, 55]`) to shorten it.

## Local tasks

Manual tasks created from 任务管理 or `scripts/add-task.mjs` are stored in `data/app-data.json`:

```json
{
  "localTasks": [
    {
      "id": "LT-1001",
      "title": "回归验证登录流程",
      "description": "覆盖账号密码与验证码登录",
      "priority": "P1",
      "status": "todo",
      "startAt": "2026-10-30T09:00",
      "endAt": "2026-10-30T18:00",
      "pinned": true,
      "isLocal": true,
      "isMine": true,
      "project": "本地任务"
    }
  ]
}
```

- Local tasks are merged into the snapshot at response time with `isLocal: true`; they are never added to `data/snapshot-cache.json` and never written to ZenTao.
- `startAt` / `endAt` use local `YYYY-MM-DDTHH:mm`; `priority` is `P0`–`P3`; `pinned` sorts before non-pinned tasks.
- `status` accepts `todo`, `doing`, `blocked` and `done`. Completing a task fills `completedAt`; reopening clears it.
- They appear in task scopes, project chips, due filters, daily reports and dashboard calculations. The synthetic project name is 本地任务.
- Delete `data/app-data.json` only after confirming with the user; it also removes reports and release plans.

## Scheduled reminders

Each saved reminder job is stored in `data/app-data.json` under `reminderJobs`; `reminders` mirrors the first job only for backward compatibility. The last 20 send results are in `reminderLogs`, and each job's own last-successful reminder times are stored in `reminderJobs[].lastSent` as `bug:<id>:<assignee>` / `task:<id>:<assignee>`. They are not written to `config.json` and do not require a restart.

```json
{
  "reminderJobs": [
    {
      "id": "RJ-1",
      "name": "3.0.0 超期 3 天提醒",
      "enabled": true,
      "webhookUrl": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...",
      "thresholdDays": 3,
      "repeatDays": 3,
      "scheduleTime": "09:30",
      "weekdays": [1, 2, 3, 4, 5],
      "productIds": ["52"],
      "versions": ["3.0.0"],
      "mentionMap": { "suntao": "SunTao" },
      "lastAutoRunDate": "",
      "lastRunAt": "",
      "lastRunResult": null,
      "lastSent": {}
    }
  ]
}
```

- Up to 30 jobs are supported. Each job has an independent name, enabled flag, Webhook, product / version scope, threshold, repeat interval, schedule, weekdays, mention map, last-auto-run date, last-send result and reminder history. Overlapping jobs do not suppress each other.
- `webhookUrl` is masked by every read API; use the UI or `reminders update --job RJ-1` to replace or clear it. A blank `webhookUrl` in an update keeps the existing URL unless `clearWebhook: true` is sent.
- Only records opened by the current account and assigned to another developer are eligible: Bugs with raw status `active`, and tasks with raw status `wait` / `doing` / `pause` that are not completed. Records opened by other users, assigned back to the current account, or already resolved / closed / done / cancelled are excluded. Unhandled days start from `assignedAt`, falling back to `createdAt` for old snapshots.
- `repeatDays` (0–90, default 3) controls repeat reminders per job: after the first reminder, a still-unhandled item is reminded again every `repeatDays` days, indefinitely. `0` means remind once. Records are keyed by `bug:<id>:<assignee>` / `task:<id>:<assignee>` inside that job, so reassigning to another developer starts a fresh timing. A group is marked as reminded only when all of its WeCom message pages were sent successfully.
- `productIds` and `versions` narrow Bug reminders by `bug.productId` / `bug.version`; empty arrays mean all, and both filters intersect. Any active product / version filter excludes tasks because tasks have no reliable version field. Changing these checkboxes refreshes the preview immediately through `POST /api/reminders/preview` with the unsaved draft filters; the preview refresh does not persist them until the user saves.
- Manual send uses the selected job's saved filters. The preview lets the user send all groups or batch-send only checked developers via `POST /api/reminders/run { jobId, accounts }`.
- `mentionMap` maps either the ZenTao account or the display name to a WeCom userid. The userid is shown as the account in WeCom Admin Console → Contacts → member details; it is not the ZenTao account, phone number or email. Without a valid entry the ZenTao account itself is used in `mentioned_list`; WeCom may not recognize it, in which case the group only shows plain `@name` text. The preview exposes `mentionUnmappedCount` and flags each unmapped developer; fill in the real userid before sending.
- Group messages are one short summary per developer (product / project, version / execution, count, max days unhandled), not a full item list. The preview still contains every item for review.
- Automatic sending runs each enabled job at most once per local calendar day on a configured weekday at/after `scheduleTime`. Starting the service later that day catches up once per job. Saving a job after its schedule or manually sending it marks that job's day as done; other jobs are unaffected.
- All jobs share the WeCom group-robot limit of 20 messages per minute. Sends across jobs are queued and throttled automatically.
- Legacy single-job data (`reminders` plus `reminderLastSent`) is migrated to `RJ-1` only when it has meaningful content.
- Module labels use `zentao.moduleNames`; unmapped IDs appear as `模块 <id>`.

## Customizing module names

If the ZenTao server does not expose module names through the CLI, add a mapping:

```json
"moduleNames": {
  "0": "未指定",
  "276": "客户端整体",
  "277": "选股"
}
```

Unmapped IDs are displayed as `模块 <id>`.

For Bug creation, `bugModules` is optional. Keep at least the default `0 / 未指定` entry.

## Port and auto-start

- Default URL: `http://127.0.0.1:4173`.
- `start.bat` / `start.sh` respect `QDESK_PORT`.
- `install-autostart.ps1` registers the logon task `QDeskWorkbench`.
- `start-hidden.vbs` checks `/api/health` before starting a second instance. The installer patches its health-check port. If the port is changed manually, update `healthUrl` in that file or reinstall.

## Windows notes

- The scheduled task runs only after the current user logs on.
- It uses an interactive, limited-privilege principal.
- Logs are written to `data/qdesk-autostart.log`.
- Use `start-hidden.vbs` for silent start; use `start.bat` for a visible console during debugging.
