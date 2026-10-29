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

## Login expired (`AUTH_EXPIRED`, HTTP 302)

When the ZenTao token expires, the CLI follows a 302 redirect to the login page. QDesk reports this as `AUTH_EXPIRED` instead of the raw redirect.

- If a password is saved in `data/zentao-auth.json`, QDesk passes URL, account and password to the CLI. The CLI then logs in again automatically and writes a fresh token; the next sync usually recovers without any action.
- While waiting for that retry, `/api/health` keeps the old snapshot and exposes `lastErrorCode: "AUTH_EXPIRED"`. The retry interval is 10 minutes instead of 60 seconds to avoid repeated failed logins.
- If recovery does not happen, open **偏好与数据 → 配置禅道连接**, click **测试连接**, then **保存并同步** to re-save the password. Or run `zentao login` in your own terminal.
- Saving the connection again is the only required step after a password change.

## Connection test seems to run forever

The test has bounded timeouts: 20 seconds per CLI call and a 30-second server deadline. The page aborts its request after 35 seconds, so a result or a timeout message always appears.

- A timeout means the network, ZenTao URL, or credentials did not respond in time.
- `请求超时` / `连接测试超时`: check the URL and network reachability first.
- `当前用户名和密码不正确`: the credentials are wrong; re-enter them.
- Stray `UV_HANDLE_CLOSING` assertion lines from the CLI are filtered out of user-facing messages.

Background sync is also bounded at 15 minutes per run, so a stuck CLI call cannot block the scheduler indefinitely.

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
- AI customer-service Bugs opened by `watch.autojobAccounts` that are assigned to, resolved by, or closed by the account
- The de-duplicated union of those sets

It is not a company-wide Bug export. If broader scope is required, that is a custom change and must respect ZenTao permissions.

## Customer-feedback counts are zero or missing

- Confirm `watch.enabled` is not `false`.
- Confirm the AI account name matches ZenTao exactly, usually `autojob`. Accounts are case-sensitive.
- Closed Bugs lose their original assignee (`assignedTo=closed`), so the workbench counts them through `closedBy` / `resolvedBy`. If someone else closed or resolved the Bug, it will not appear under this account.
- If `watch.productIds` is set, the AI customer-service Bug must be in one of those products. Clear the array to scan every visible product.
- `bug --browseType=closed` and `closedbyme` return empty on ZenTao 22.4; the workbench uses `browseType=all` and filters locally. This is expected.
- The scan is cached for 15 minutes. Click **立即同步** or call `POST /api/sync` to force a refresh.

## Sync is slow

A full sync calls ZenTao once per product and once per execution. Large accounts can take 20–60 seconds or more. This is why:

- the page reads a cached snapshot first;
- polling uses `?meta=1`;
- manual sync returns HTTP 202.

The customer-feedback watch adds one `browseType=all` scan per product. Set `watch.productIds` to the products that actually receive AI customer-service Bugs to cut first-sync time; the result is cached for 15 minutes.

`cacheSeconds` no longer schedules syncs; it only controls the `stale` flag. Auto-sync frequency is controlled by `zentao.syncIntervalMinutes` (default 30) inside `zentao.syncWindow`. Do not set a very small interval without a reason; extremely frequent full syncs can burden ZenTao.

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
