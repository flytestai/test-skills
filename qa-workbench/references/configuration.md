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
    "refreshCooldownMs": 5000,
    "moduleNames": {},
    "bugModules": [
      { "id": "0", "name": "未指定" }
    ]
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
| `zentao.cacheSeconds` | no | Background refresh interval, minimum 60, default 300 |
| `zentao.refreshCooldownMs` | no | Minimum gap between manual refreshes |
| `zentao.cliPath` | no | Optional explicit path to the ZenTao CLI JS entry |
| `zentao.moduleNames` | no | Map of module IDs to display names |
| `zentao.bugModules` | no | Optional module choices in the Bug creation dialog |

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
5. For every execution: `task --executionID=<id>`.

This intentionally avoids the ZenTao 22.4 unsupported `my tasks` and `my bugs` commands.

"All Bugs" in the UI means **the account-related union** (opened by me + assigned to me), not every Bug in the company.

## Caching and concurrency

- `cacheSeconds` controls the automatic background refresh interval.
- The first sync starts about 600 ms after server startup when no fresh snapshot exists.
- `/api/sync` triggers a background refresh and returns immediately.
- A failed sync keeps the previous snapshot and retries after roughly 60 seconds.
- List-level caches (products/projects/executions) are in memory; the full last successful snapshot is persisted.

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
