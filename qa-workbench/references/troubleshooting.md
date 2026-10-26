# Troubleshooting

## Service does not start

Check Node and the port:

```bash
node --version
curl -s http://127.0.0.1:4173/api/health
```

- `EADDRINUSE`: another process owns the port. Set `QDESK_PORT` or edit `server.port`.
- `Cannot find module`: run from the installed workbench directory, where `server.js` and `lib/` live.
- Visible console: run `npm start` or `start.bat`; use `start-hidden.vbs` only for silent start.

## Page opens but shows the boot screen

This is expected when no snapshot exists yet. Poll:

```bash
curl -s "http://127.0.0.1:4173/api/bootstrap?meta=1"
```

- `syncing: true` — wait; the first full sync can take tens of seconds.
- `lastError` — read the sanitized message and fix the connection or CLI.
- `counts` all zero — check the account and ZenTao permissions.

If it never progresses, inspect the server console for the background sync error.

## `E1001` / `E1006` / `E1003` / `E1004` / `E1005`

Authentication problems.

- E1001 / E1006: no usable credential. Run `zentao login` or save a connection in the UI.
- E1003 / E1004: wrong password or expired token. Re-enter or re-login.
- E1005 / E1007: config unreadable or profile missing. Check `zentao profile`.

Never ask the user to paste a password into the chat; use the workbench form or their own terminal.

## `E2010` on `my tasks` / `my bugs`

ZenTao 22.4 does not support these commands. The workbench already avoids them:

- tasks: per-execution `task --executionID=…`
- Bugs: per-product `bug --browseType=openedbyme` and `assignedtome`

Do not fake the server version. If an alternative command is needed, confirm it in `zentao <module> --help`.

## Connection test succeeds but "my" scopes are empty

`tester.account` does not match the ZenTao login or the account returned by the CLI.

- Open **偏好与数据 → 配置禅道连接** and re-save the account.
- Or set `tester.account` in `config.json` / `ZENTAO_ACCOUNT`.
- Check `/api/health` and confirm the `account` field.

## Products or projects are missing

- The account may not have permission in ZenTao. Verify in the ZenTao web UI.
- The CLI may be using a different credential source than expected. Re-login or save the connection explicitly.
- A failed list call is recorded in `sync.warnings`; use `/api/bootstrap` or the settings page to inspect warnings.

## Tasks are missing from some projects

Executions are filtered to projects visible to the account. If a project or execution is not returned by the CLI list, it cannot be included.

## Bugs are fewer than expected

The workbench intentionally syncs only:

- Bugs opened by the account (`openedbyme`)
- Bugs assigned to the account (`assignedtome`)
- The de-duplicated union of those two sets

It is not a company-wide Bug export. If broader scope is required, that is a custom change and must respect ZenTao permissions.

## Sync is slow

A full sync calls ZenTao once per product and once per execution. Large accounts can take 20–60 seconds or more. This is why:

- the page reads a cached snapshot first;
- polling uses `?meta=1`;
- manual sync returns HTTP 202.

Do not reduce `cacheSeconds` below 60 without a reason. Extremely frequent full syncs can burden ZenTao.

## Manual sync appears to do nothing

Check:

```bash
curl -s -X POST http://127.0.0.1:4173/api/sync
curl -s "http://127.0.0.1:4173/api/bootstrap?meta=1"
```

- HTTP 202 means the request was accepted.
- `syncing: true` means it is running.
- A new `revision` means the snapshot changed.
- `lastError` explains failures.

## Stale or inconsistent snapshot

Stop the service, then delete `data/snapshot-cache.json`. A fresh sync starts on next launch. Keep `data/zentao-auth.json` if the connection should be preserved.

Do not edit `data/snapshot-cache.json` by hand.

## Bug creation rejects the request

Common causes:

- no product selected (a product is now required);
- product is not in the account's accessible product list;
- title is empty or longer than 180 characters;
- severity or priority outside P0–P3;
- invalid assignee account format;
- invalid project or execution ID.

Parameter validation does not authorize creating a real Bug. Only create one when the user explicitly asks and confirms the target product/content.

## Windows auto-start does not run

```powershell
Get-ScheduledTask -TaskName QDeskWorkbench
Start-ScheduledTask -TaskName QDeskWorkbench
Get-Content .\data\qdesk-autostart.log -Tail 40
```

- The task triggers at user logon, not before.
- If the port is not `4173`, the health check in `start-hidden.vbs` must match. Use the installer or update `healthUrl`.
- Check that `wscript.exe` and Node.js are available to the user.
- Re-register with `install-autostart.ps1` if the directory moved.

## Resetting without losing reports

- To reset only ZenTao data: delete `data/snapshot-cache.json`.
- To reset only the connection: delete `data/zentao-auth.json`.
- To reset reports and profile: back up and delete `data/app-data.json` only after user confirmation.

## Security reminders

- Never print `data/zentao-auth.json` or environment credentials.
- Never commit the installed `data/` directory.
- Keep the bind address on `127.0.0.1` for personal use.
- Do not add write operations to existing tasks/Bugs without an explicit product decision and authorization.
