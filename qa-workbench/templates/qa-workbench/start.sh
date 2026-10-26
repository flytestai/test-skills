#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found. Install Node.js 18 or newer and try again." >&2
  exit 1
fi

export QDESK_PORT="${QDESK_PORT:-4173}"
URL="http://127.0.0.1:${QDESK_PORT}"

echo "Starting QDesk local service at ${URL} ..."
echo "ZenTao CLI credentials are reused from the existing local CLI profile."
echo "Press Ctrl+C to stop the service."

(
  sleep 2
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "${URL}" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then
    open "${URL}" >/dev/null 2>&1 || true
  elif command -v cmd.exe >/dev/null 2>&1; then
    cmd.exe //c start "" "${URL}" >/dev/null 2>&1 || true
  fi
) &

exec node server.js
