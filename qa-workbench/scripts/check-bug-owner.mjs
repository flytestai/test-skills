#!/usr/bin/env node
/**
 * Check whether ZenTao Bugs are assigned to the current account.
 *
 * Read-only: never edits, closes, resolves or deletes anything.
 * A closed Bug stores assignedTo=closed, so its previous owner cannot be
 * proven from the current field; such Bugs are reported as closed_unverified.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const zentao = require('../templates/qa-workbench/lib/zentao.js');

function usage() {
  console.log(`Usage:
  node scripts/check-bug-owner.mjs <id...> [--require-all-owned] [--account <account>]
  node scripts/check-bug-owner.mjs --product <id> [--status <status>] [--require-all-owned]
  node scripts/check-bug-owner.mjs --ids-file ids.txt [--require-all-owned]

Exit codes: 0 = check completed; 2 = not owned or ownership unknown.`);
}

function parseArgs(argv) {
  const options = { ids: [], idsFile: '', product: null, status: '', account: '', requireAllOwned: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--require-all-owned') options.requireAllOwned = true;
    else if (arg === '--account') options.account = argv[++i] || '';
    else if (arg === '--ids-file') options.idsFile = argv[++i] || '';
    else if (arg === '--product') options.product = Number(argv[++i]);
    else if (arg === '--status') options.status = argv[++i] || '';
    else if (arg === '--help' || arg === '-h') { usage(); process.exit(0); }
    else if (/^\d+$/.test(arg)) options.ids.push(Number(arg));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function currentAccount(explicit) {
  if (explicit) return explicit;
  if (process.env.ZENTAO_ACCOUNT) return process.env.ZENTAO_ACCOUNT;
  const profile = await zentao.runJson(['profile', '--format=json']);
  const current = String((profile && profile.currentProfile) || '');
  if (!current.includes('@')) throw new Error('Cannot determine the current account; pass --account or set ZENTAO_ACCOUNT.');
  return current.split('@', 1)[0];
}

async function fetchOne(id) {
  const payload = await zentao.runJson([
    'bug', String(id), '--pick=id,title,status,assignedTo', '--format=json'
  ]);
  const bug = payload && payload.data ? payload.data : payload;
  if (!bug || bug.id === undefined) throw new Error(`Bug ${id} not found or has no id.`);
  return {
    id: Number(bug.id),
    title: bug.title || '',
    status: bug.status || '',
    assignedTo: bug.assignedTo || ''
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const me = await currentAccount(options.account);
  const bugs = [];

  if (options.product !== null) {
    if (!Number.isInteger(options.product)) throw new Error('--product requires an integer id.');
    const result = await zentao.listBugs(options.product, { perPage: 300, maxPages: 20 });
    const rows = Array.isArray(result) ? result : (result.items || []);
    for (const row of rows) {
      if (!row || row.id === undefined) continue;
      if (options.status && row.status !== options.status) continue;
      bugs.push({
        id: Number(row.id),
        title: row.title || '',
        status: row.status || '',
        assignedTo: row.assignedTo || ''
      });
    }
  }

  const ids = [...options.ids];
  if (options.idsFile) {
    const fs = await import('node:fs');
    for (const line of fs.readFileSync(options.idsFile, 'utf8').split(/\r?\n/)) {
      if (line.trim()) ids.push(Number(line.trim()));
    }
  }
  for (const id of [...new Set(ids)]) bugs.push(await fetchOne(id));

  const unique = new Map();
  for (const bug of bugs) unique.set(bug.id, bug);
  const all = [...unique.values()];

  const owned = [];
  const notOwned = [];
  const closedUnverified = [];
  for (const bug of all) {
    if (bug.assignedTo === me) owned.push(bug);
    else if (bug.assignedTo === 'closed') closedUnverified.push(bug);
    else notOwned.push(bug);
  }

  console.log(JSON.stringify({
    account: me,
    owned,
    not_owned: notOwned,
    closed_unverified: closedUnverified,
    summary: {
      total: all.length,
      owned: owned.length,
      not_owned: notOwned.length,
      closed_unverified: closedUnverified.length
    }
  }, null, 2));

  if (options.requireAllOwned && (notOwned.length || closedUnverified.length)) return 2;
  return 0;
}

main().then((code) => {
  process.exitCode = code;
}).catch((error) => {
  console.error(JSON.stringify({ error: error.message }, null, 2));
  process.exitCode = 1;
});
