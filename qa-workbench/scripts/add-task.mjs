#!/usr/bin/env node
'use strict';

/**
 * Create a local QDesk task through the local HTTP API.
 * This only writes data/app-data.json in QDesk; it never calls ZenTao.
 */

const args = process.argv.slice(2);

function usage() {
  console.log(`Create a local QDesk task (no ZenTao write).

Usage:
  node scripts/add-task.mjs --title "回归验证登录流程" [options]
  node scripts/add-task.mjs --json '{"title":"回归验证","priority":"P1"}'

Options:
  --title <text>         Required task title (maximum 160 characters)
  --description <text>   Optional task content (maximum 4000 characters)
  --start <datetime>     Optional start time, e.g. 2026-10-30T09:00
  --end <datetime>       Optional end time, e.g. 2026-10-30T18:00
  --priority <P0-P3>     Optional priority, default P2
  --pinned               Pin the task to the top
  --no-pinned            Do not pin the task
  --json <json|->        JSON payload, or - to read JSON from stdin
  --url <url>            QDesk base URL, default QDESK_URL or http://127.0.0.1:4173
  --help                 Show this help

The response is printed as JSON with the created task.`);
}

function readOption(name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  return args[index + 1];
}

function hasFlag(name) {
  return args.includes(name);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

(async () => {
  if (hasFlag('--help') || hasFlag('-h')) {
    usage();
    return;
  }

  let payload = {};
  const jsonIndex = args.indexOf('--json');
  if (jsonIndex >= 0) {
    const raw = args[jsonIndex + 1];
    if (!raw) throw new Error('--json requires a JSON string or - for stdin.');
    const source = raw === '-' ? await readStdin() : raw;
    const parsed = JSON.parse(source);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('--json must contain a JSON object.');
    }
    payload = parsed;
  }

  const title = readOption('--title');
  const description = readOption('--description');
  const startAt = readOption('--start');
  const endAt = readOption('--end');
  const priority = readOption('--priority');
  if (title !== undefined) payload.title = title;
  if (description !== undefined) payload.description = description;
  if (startAt !== undefined) payload.startAt = startAt;
  if (endAt !== undefined) payload.endAt = endAt;
  if (priority !== undefined) payload.priority = priority;
  if (hasFlag('--pinned')) payload.pinned = true;
  if (hasFlag('--no-pinned')) payload.pinned = false;

  if (!payload.title || !String(payload.title).trim()) {
    throw new Error('Task title is required. Use --title or --json.');
  }

  const baseUrl = String(readOption('--url') || process.env.QDESK_URL || 'http://127.0.0.1:4173').replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (error) {
    throw new Error(`QDesk returned non-JSON response (HTTP ${response.status}).`);
  }
  if (!response.ok || !body || body.ok === false) {
    const message = body && body.error && body.error.message
      ? body.error.message
      : `QDesk request failed with HTTP ${response.status}.`;
    throw new Error(message);
  }
  console.log(JSON.stringify(body.data && body.data.task ? body.data.task : body.data, null, 2));
})().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
