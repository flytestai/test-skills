#!/usr/bin/env node
/**
 * Build a read-only confirmation list for a bulk Bug close.
 *
 * It never closes or edits anything. The CSV contains only Bugs whose
 * assignedTo equals the current account. Review the CSV with the user and
 * close only the confirmed IDs after an explicit confirmation.
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const zentao = require('../templates/qa-workbench/lib/zentao.js');

function usage() {
  console.log(`Usage:
  node scripts/plan-bulk-close.mjs --product <id> [--product <id>...] [--status resolved]
                                    [--output close-plan.csv] [--max-count 100] [--allow-large]
  node scripts/plan-bulk-close.mjs --all-products --status resolved --output close-plan.csv

Read-only. Exit code 3 means the owned set exceeds --max-count; review the CSV
and rerun with --allow-large only after the user confirms the full list.`);
}

function parseArgs(argv) {
  const options = {
    products: [], allProducts: false, status: 'resolved', account: '',
    output: 'zentao-close-plan.csv', maxCount: 100, allowLarge: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--product') options.products.push(Number(argv[++i]));
    else if (arg === '--all-products') options.allProducts = true;
    else if (arg === '--status') options.status = argv[++i] || 'resolved';
    else if (arg === '--account') options.account = argv[++i] || '';
    else if (arg === '--output') options.output = argv[++i] || options.output;
    else if (arg === '--max-count') options.maxCount = Number(argv[++i]);
    else if (arg === '--allow-large') options.allowLarge = true;
    else if (arg === '--help' || arg === '-h') { usage(); process.exit(0); }
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

async function baseUrl() {
  if (process.env.ZENTAO_URL) return process.env.ZENTAO_URL.replace(/\/+$/, '');
  const profile = await zentao.runJson(['profile', '--format=json']);
  const current = String((profile && profile.currentProfile) || '');
  if (!current.includes('@')) throw new Error('Cannot determine the ZenTao URL; pass ZENTAO_URL.');
  return current.split('@').slice(1).join('@').replace(/\/+$/, '');
}

function csvCell(value) {
  const text = String(value == null ? '' : value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const products = [...new Set(options.products)];
  if (options.allProducts) {
    const result = await zentao.listProducts({ perPage: 200, maxPages: 5 });
    const rows = Array.isArray(result) ? result : (result.items || []);
    for (const row of rows) {
      if (row && row.id !== undefined && !products.includes(Number(row.id))) products.push(Number(row.id));
    }
  }
  if (!products.length) throw new Error('Provide --product <id> or --all-products.');
  if (products.some((id) => !Number.isInteger(id))) throw new Error('--product requires integer ids.');

  const me = await currentAccount(options.account);
  const root = await baseUrl();
  const scanned = [];

  for (const product of products) {
    const result = await zentao.listBugs(product, { perPage: 300, maxPages: 20 });
    const rows = Array.isArray(result) ? result : (result.items || []);
    for (const row of rows) {
      if (!row || row.id === undefined) continue;
      if (row.status !== options.status) continue;
      scanned.push({
        id: Number(row.id),
        title: row.title || '',
        status: row.status || '',
        assignedTo: row.assignedTo || '',
        resolution: row.resolution || ''
      });
    }
  }

  const owned = [];
  const notOwned = [];
  const closedUnverified = [];
  for (const bug of scanned) {
    if (bug.assignedTo === me) owned.push(bug);
    else if (bug.assignedTo === 'closed') closedUnverified.push(bug);
    else notOwned.push(bug);
  }

  owned.sort((a, b) => a.id - b.id);
  const header = ['Bug ID', '标题', '当前状态', '当前指派', '解决方案', '链接'];
  const lines = [header.map(csvCell).join(',')];
  for (const bug of owned) {
    lines.push([
      bug.id, bug.title, bug.status, bug.assignedTo, bug.resolution,
      `${root}/bug-view-${bug.id}.html`
    ].map(csvCell).join(','));
  }
  fs.writeFileSync(options.output, `﻿${lines.join('\r\n')}\r\n`, 'utf8');

  const large = owned.length > options.maxCount;
  console.log(JSON.stringify({
    account: me,
    products,
    status: options.status,
    scanned: scanned.length,
    owned: owned.length,
    not_owned: notOwned.length,
    closed_unverified: closedUnverified.length,
    max_count: options.maxCount,
    large_batch: large,
    output: options.output
  }, null, 2));

  if (large && !options.allowLarge) {
    console.error(`owned count ${owned.length} exceeds --max-count ${options.maxCount}; review the CSV and rerun with --allow-large only after the user explicitly confirms the full list.`);
    return 3;
  }
  return 0;
}

main().then((code) => {
  process.exitCode = code;
}).catch((error) => {
  console.error(JSON.stringify({ error: error.message }, null, 2));
  process.exitCode = 1;
});
