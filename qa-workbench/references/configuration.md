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

## Environment variables

| Variable | Effect |
| --- | --- |
| `QDESK_PORT` | Overrides `server.port` |
| `QDESK_HOST` | Overrides `server.host` |
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
