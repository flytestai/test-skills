#!/usr/bin/env node
'use strict';

/**
 * Unified QDesk operation CLI.
 *
 * Everything the local QDesk workbench can do is exposed here: health and sync,
 * dashboard metrics, tasks, Bugs, releases, reports, settings, connection
 * management, search, notifications, exports and page links.
 *
 * Read commands use the local HTTP API plus the running QDesk Core module.
 * Write commands call the same local API as the browser UI. No ZenTao access is
 * performed directly by this script, and passwords are never accepted as
 * command-line arguments.
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';

class CliError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode || 1;
  }
}

function fail(message, exitCode) {
  throw new CliError(message, exitCode);
}

function readOption(name) {
  const withValue = parsed.opts.get(name);
  if (withValue !== undefined) return withValue;
  return undefined;
}

function hasFlag(name) {
  return parsed.opts.has(name) || parsed.flags.has(name);
}

function firstValue(...names) {
  for (const name of names) {
    const value = readOption(name);
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}

function flagPair(on, off, current) {
  if (hasFlag(off)) return false;
  if (hasFlag(on)) return true;
  return current;
}

function numberOption(name, fallback) {
  const raw = readOption(name);
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) fail(`--${name} 必须是非负数字。`);
  return value;
}

function parseArgv(argv) {
  const positional = [];
  const opts = new Map();
  const flags = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (token.startsWith('--')) {
      const equal = token.indexOf('=');
      if (equal > 2) {
        opts.set(token.slice(2, equal), token.slice(equal + 1));
        continue;
      }
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && next !== '--' && !next.startsWith('--')) {
        opts.set(key, next);
        i += 1;
      } else {
        flags.add(key);
      }
      continue;
    }
    if (token.startsWith('-') && token.length === 2) {
      flags.add(token.slice(1));
      continue;
    }
    positional.push(token);
  }
  return { positional, opts, flags };
}

const parsed = parseArgv(process.argv.slice(2));

const BASE_URL = String(
  firstValue('qdesk-url', 'server')
  || (parsed.positional[0] === 'connection' ? undefined : firstValue('url'))
  || process.env.QDESK_URL
  || 'http://127.0.0.1:4173'
).replace(/\/+$/, '');
const TIMEOUT_MS = Number(process.env.QDESK_TIMEOUT_MS || 60000);
const FORMAT = String(firstValue('format') || 'json').toLowerCase();
const DRY_RUN = hasFlag('dry-run');
const VERIFY = !hasFlag('no-verify');

let corePromise = null;
let stdinPromise = null;

function readStdin() {
  if (!stdinPromise) {
    stdinPromise = (async () => {
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      return Buffer.concat(chunks).toString('utf8');
    })();
  }
  return stdinPromise;
}

function usage() {
  console.log(`QDesk 全能操作 CLI

用法:
  node scripts/qdesk.mjs <命令> [子命令] [参数] [--格式选项]

通用:
  --qdesk-url <url>    QDesk 地址，默认 QDESK_URL 或 http://127.0.0.1:4173
                       （connection 命令中的 --url 表示禅道地址）
  --format json|text   输出格式，默认 json
  --dry-run            写操作只打印请求，不执行
  --no-verify          写入后不等待复核
  --json <json|->      传入 JSON 对象，- 表示从 stdin 读取
  --help               显示帮助

服务与总览:
  status                         服务、同步、账号与数据量
  sync [--wait] [--timeout 秒]   触发后台同步，--wait 等待完成
  bootstrap [--full]             本地快照概览或完整数据
  dashboard                      当日进度、指标与提醒
  metrics                        当日指标
  focus                          今日聚焦
  notifications                  今日提醒
  activity [--limit 5]           最近动态
  week [--date YYYY-MM-DD]       最近 7 天节奏
  search <关键词>                搜索我的任务与 Bug

任务:
  tasks list [--scope mine|test|all] [--status ...] [--priority ...]
             [--project ...] [--due today|overdue] [--q ...] [--local|--remote]
  tasks get <任务ID>
  tasks stats [--scope mine|test|all]
  tasks create --title ... [--description ...] [--start ...] [--end ...]
               [--priority P0-P3] [--pinned]
  tasks update <LT-...> [--title ...] [--description ...] [--start ...]
               [--end ...] [--priority ...] [--status todo|doing|blocked|done]
               [--pinned|--unpinned]
  tasks complete <LT-...>
  tasks reopen <LT-...>
  tasks pin <LT-...> / tasks unpin <LT-...>
  tasks delete <LT-...> --yes

Bug:
  bugs list [--scope opened|assigned|autojob|all] [--status ...]
            [--severity ...] [--type ...] [--product ...] [--version ...]
            [--assignee ...] [--mine] [--pending] [--assigned-open] [--q ...]
            [--sort updated|created|severity|priority] [--order desc|asc]
            [--limit N|--all]         --pending 只看等待我验证的 Bug
                                      --assigned-open 只看指派给我且未关闭的 Bug
  bugs get <BugID>
  bugs nav <BugID> [--direction prev|next] [同 list 筛选参数]
  bugs stats [--scope ...]
  bugs versions [--scope ...]      版本下拉：每个版本的待验证/未关闭数量
  bugs refresh <BugID>
  bugs create --title ... --severity P0-P3 --pri P0-P3 [--product-id ...]
              [--type ...] [--assigned-to ...] [--project-id ...]
              [--execution-id ...] [--steps ...] [--expected ...] [--actual ...]
  bugs update <BugID> [--title ...] [--severity ...] [--pri ...] [--type ...]
              [--opened-build ...] [--steps ...] [--project ...] [--execution ...]
              [--story ...] [--assigned-to ...]
  bugs assign <BugID> <账号>
  bugs resolve <BugID> [--resolution fixed|...] [--build ...] [--assigned-to ...] [--comment ...]
  bugs close <BugID> [--comment ...] --yes
  bugs activate <BugID> [--build ...] [--assigned-to ...] [--comment ...]
  bugs confirm <BugID> [--pri ...] [--type ...] [--deadline ...] [--assigned-to ...] [--comment ...]
  bugs delete <BugID> --yes
  bugs plan-close --ids 1,2,3        只读生成可关闭清单，不关闭
  bugs close-many --ids 1,2,3 --yes [--allow-large]
                                     仅关闭全部属于当前账号的 Bug

发版:
  releases list
  releases set <版本> [--start ...] [--end ...] [--priority P1-P3]
               [--pinned|--unpinned] [--closed|--reopen] [--clear]
  releases close <版本>
  releases reopen <版本>
  releases bugs <版本> [--kind pending|open|all] [--limit N]

日报:
  reports list
  reports get [YYYY-MM-DD]
  reports generate [--date ...] [--save]
  reports save [YYYY-MM-DD] [--summary ...] [--version ...] [--bugs-summary ...]
               [--tasks ...] [--autojob ...] [--status draft|submitted]
  reports refresh [YYYY-MM-DD]
  reports submit [YYYY-MM-DD]
  reports draft [YYYY-MM-DD]
  reports copy [YYYY-MM-DD] [--clipboard]
  reports markdown [YYYY-MM-DD] [--output 文件]
  reports export [YYYY-MM-DD] [--format md|json] [--output 文件]

设置与连接:
  settings get
  settings update [--role ...] [--team ...] [--sprint ...]
                  [--task-view board|list] [--task-scope mine|test]
                  [--bug-scope opened|assigned|all]
  connection get
  connection test [--url ...] [--account ...] [--tester-name ...] [--password-env ...] [--password-stdin]
  connection save [--url ...] [--account ...] [--tester-name ...] [--password-env ...] [--password-stdin]

导出与页面:
  export backup [--output QDesk_backup_YYYY-MM-DD.json]
  export tasks-csv [--output 文件]
  export bugs-csv [--output 文件]
  open <dashboard|releases|tasks|bugs|reports|settings>
  open bug <BugID> [--edit] [--launch]

密码只从 QDESK_ZENTAO_PASSWORD 环境变量或 --password-stdin 读取，不支持 --password。
Bug 写操作只允许 assignedTo=当前账号 的记录；批量关闭必须先 plan-close 再 close-many。`);
}

async function api(pathname, options) {
  const opts = options || {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${BASE_URL}${pathname}`, {
      method: opts.method || 'GET',
      headers: {
        Accept: 'application/json',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {})
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store',
      signal: controller.signal
    });
  } catch (error) {
    if (error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      fail(`本地服务响应超时：${BASE_URL}${pathname}`, 1);
    }
    fail(`无法连接 QDesk（${BASE_URL}）：${error.message}`, 1);
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (error) {
    fail(`QDesk 返回了无法解析的内容（HTTP ${response.status}）。`, 1);
  }
  if (!response.ok || (payload && payload.ok === false)) {
    const message = payload && payload.error && payload.error.message
      ? payload.error.message
      : `QDesk 请求失败（HTTP ${response.status}）。`;
    fail(message, 1);
  }
  return payload && Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload;
}

async function request(method, pathname, body, options) {
  if (DRY_RUN && method !== 'GET') {
    return {
      dryRun: true,
      request: {
        method,
        path: pathname,
        body: redact(body)
      }
    };
  }
  return api(pathname, { method, body, timeoutMs: options && options.timeoutMs });
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const copy = {};
    for (const [key, item] of Object.entries(value)) {
      copy[key] = /password|token|secret/i.test(key) ? '***' : redact(item);
    }
    return copy;
  }
  return value;
}

async function readJsonOption() {
  const raw = readOption('json');
  if (raw === undefined) return null;
  if (raw === '-') {
    const text = await readStdin();
    if (!text.trim()) fail('--json - 没有收到 stdin 内容。');
    return parseJson(text, 'stdin');
  }
  return parseJson(raw, '--json');
}

function parseJson(text, label) {
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      fail(`${label} 必须是 JSON 对象。`);
    }
    return value;
  } catch (error) {
    if (error instanceof CliError) throw error;
    fail(`${label} 不是有效 JSON：${error.message}`);
  }
}

async function loadCore() {
  if (!corePromise) {
    corePromise = (async () => {
      const response = await fetch(`${BASE_URL}/core.js`, { cache: 'no-store' });
      if (!response.ok) fail('无法从 QDesk 加载 core.js。');
      const code = await response.text();
      const sandbox = { module: { exports: {} }, exports: {}, console };
      try {
        vm.runInNewContext(code, sandbox, { timeout: 5000, filename: 'qdesk-core.js' });
      } catch (error) {
        fail(`加载 QDesk Core 失败：${error.message}`);
      }
      const core = sandbox.module.exports;
      if (!core || typeof core.dailyFocus !== 'function') fail('QDesk Core 模块无效。');
      return core;
    })();
  }
  return corePromise;
}

async function bootstrap() {
  return api('/api/bootstrap');
}

function coreState(data) {
  const allTasks = Array.isArray(data.tasks) ? data.tasks : [];
  const allBugs = Array.isArray(data.bugs) ? data.bugs : [];
  return {
    ...data,
    tasks: allTasks.filter((task) => task.isMine !== false),
    bugs: allBugs.filter((bug) => bug.isMine !== false),
    allTasks,
    allBugs,
    autojobBugs: data.autojob && Array.isArray(data.autojob.bugs) ? data.autojob.bugs : [],
    autojobStats: data.autojob && data.autojob.summary ? data.autojob.summary : (data.autojobStats || null),
    reports: Array.isArray(data.reports) ? data.reports : [],
    releases: Array.isArray(data.releases) ? data.releases : [],
    releasePlans: data.releasePlans && typeof data.releasePlans === 'object' ? data.releasePlans : {},
    tester: data.tester || null,
    profile: data.profile || {}
  };
}

function currentDate() {
  const raw = firstValue('date');
  if (raw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) fail('日期格式应为 YYYY-MM-DD。');
    return raw;
  }
  return new Date().toLocaleDateString('sv-SE');
}

function briefTask(task) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    project: task.project,
    execution: task.execution,
    dueDate: task.dueDate,
    assignee: task.assignee,
    isMine: Boolean(task.isMine),
    isLocal: Boolean(task.isLocal),
    pinned: Boolean(task.pinned),
    updatedAt: task.updatedAt
  };
}

function briefBug(bug) {
  return {
    id: String(bug.id),
    title: bug.title,
    severity: bug.severity,
    pri: bug.pri,
    status: bug.status,
    statusLabel: bug.statusLabel || statusLabel(bug.status),
    type: bug.type,
    typeLabel: bug.typeLabel,
    project: bug.project,
    module: bug.module,
    version: bug.version,
    assignee: bug.assignee,
    assigneeAccount: bug.assigneeAccount,
    reporter: bug.reporter,
    isMine: Boolean(bug.isMine),
    isAssignedToMe: Boolean(bug.isAssignedToMe),
    needsMyVerification: Boolean(bug.needsMyVerification),
    createdAt: bug.createdAt,
    updatedAt: bug.updatedAt
  };
}

function statusLabel(status) {
  const map = {
    active: '激活',
    resolved: '已解决',
    closed: '已关闭',
    verifying: '待验证',
    confirmed: '已确认',
    new: '新建',
    hold: '已挂起'
  };
  return map[status] || status;
}

function limitValue(defaultLimit) {
  if (hasFlag('all')) return 0;
  return numberOption('limit', defaultLimit);
}

function sliceLimit(list, limit) {
  return limit > 0 ? list.slice(0, limit) : list;
}

function sortBugList(list, sort, order) {
  const direction = String(order || 'desc').toLowerCase() === 'asc' ? 1 : -1;
  const rank = (value) => ({ P0: 0, P1: 1, P2: 2, P3: 3 }[value] ?? 9);
  const keyed = list.map((bug, index) => ({ bug, index }));
  keyed.sort((a, b) => {
    let diff = 0;
    switch (sort) {
      case 'created':
        diff = String(a.bug.createdAt || '').localeCompare(String(b.bug.createdAt || ''));
        break;
      case 'severity':
        diff = rank(a.bug.severity) - rank(b.bug.severity);
        break;
      case 'priority':
        diff = rank(a.bug.pri) - rank(b.bug.pri);
        break;
      default:
        diff = String(a.bug.updatedAt || '').localeCompare(String(b.bug.updatedAt || ''));
        break;
    }
    if (!diff) {
      diff = String(a.bug.id || '').localeCompare(String(b.bug.id || ''), 'zh-CN', { numeric: true });
    }
    return diff * direction;
  });
  return keyed.map((entry) => entry.bug);
}

async function listBugs(options) {
  const opts = options || {};
  const scope = opts.scope || firstValue('scope') || 'opened';
  const data = await api(`/api/bugs?scope=${encodeURIComponent(scope)}`);
  const core = await loadCore();
  let bugs = Array.isArray(data.bugs) ? data.bugs.slice() : [];
  bugs = core.filterBugs(bugs, {
    q: opts.q !== undefined ? opts.q : readOption('q'),
    status: opts.status !== undefined ? opts.status : readOption('status'),
    severity: opts.severity !== undefined ? opts.severity : readOption('severity'),
    version: opts.version !== undefined ? opts.version : readOption('version'),
    product: opts.product !== undefined ? opts.product : firstValue('product', 'project'),
    project: opts.project !== undefined ? opts.project : readOption('project'),
    assignee: opts.assignee !== undefined ? opts.assignee : readOption('assignee'),
    pendingVerification: opts.pendingVerification !== undefined
      ? opts.pendingVerification
      : (hasFlag('pending') ? true : undefined),
    assignedOpen: opts.assignedOpen !== undefined
      ? opts.assignedOpen
      : (hasFlag('assigned-open') ? true : undefined)
  });
  if (opts.mine !== undefined ? opts.mine : hasFlag('mine')) {
    bugs = bugs.filter((bug) => bug.isMine);
  }
  const type = opts.type !== undefined ? opts.type : readOption('type');
  if (type && type !== 'all') {
    bugs = bugs.filter((bug) => (
      String(bug.type || '') === String(type)
      || String(bug.typeLabel || '') === String(type)
    ));
  }
  const assignee = opts.assignee !== undefined ? opts.assignee : readOption('assignee');
  if (assignee) {
    bugs = bugs.filter((bug) => (
      String(bug.assigneeAccount || '') === String(assignee)
      || String(bug.assignee || '') === String(assignee)
    ));
  }
  const sort = opts.sort !== undefined ? opts.sort : firstValue('sort') || 'updated';
  const order = opts.order !== undefined ? opts.order : firstValue('order') || 'desc';
  return sortBugList(bugs, sort, order);
}

async function allBugs() {
  const data = await api('/api/bugs?scope=all');
  return Array.isArray(data.bugs) ? data.bugs : [];
}

async function findBug(id) {
  const bugs = await allBugs();
  const bug = bugs.find((item) => String(item.id) === String(id));
  if (!bug) fail(`找不到 Bug #${id}。`);
  return bug;
}

function requireOwned(bug) {
  if (!bug.isAssignedToMe) {
    fail(
      `Bug #${bug.id} 当前不在你名下（assignee=${bug.assigneeAccount || bug.assignee || '未知'}），`
      + '按 QDesk 安全规则不能修改或关闭。',
      2
    );
  }
}

async function verifyBug(id, predicate) {
  if (!VERIFY) return { verified: null, skipped: true };
  const delays = [0, 600, 1200, 2000, 3000, 5000];
  let last = null;
  for (const delay of delays) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      last = await findBug(id);
    } catch (error) {
      return { verified: false, error: error.message };
    }
    if (predicate(last)) return { verified: true, bug: briefBug(last) };
  }
  return { verified: false, bug: last ? briefBug(last) : null };
}

function taskText(task) {
  return `${task.id}\t${task.status}\t${task.priority}\t${task.dueDate || '-'}\t${task.title}`;
}

function bugText(bug) {
  return `#${bug.id}\t${bug.statusLabel || statusLabel(bug.status)}\t${bug.severity}\t${bug.project || '-'}\t${bug.title}`;
}

function csvCell(value) {
  return `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
}

function writeFile(filePath, content, binary) {
  const absolute = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, binary ? undefined : 'utf8');
  return absolute;
}

function printResult(data, text) {
  if (FORMAT === 'text' && text) {
    console.log(text);
    return;
  }
  console.log(JSON.stringify(data, null, 2));
}

async function copyToClipboard(text) {
  const platform = process.platform;
  const command = platform === 'win32' ? 'clip' : platform === 'darwin' ? 'pbcopy' : 'xclip';
  const args = platform === 'linux' ? ['-selection', 'clipboard'] : [];
  await new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { stdio: ['pipe', 'ignore', 'ignore'] });
    } catch (error) {
      reject(error);
      return;
    }
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} 退出码 ${code}`));
    });
    child.stdin.end(text, 'utf8');
  });
}

function launchUrl(url) {
  const platform = process.platform;
  let command;
  let args;
  if (platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '', url];
  } else if (platform === 'darwin') {
    command = 'open';
    args = [url];
  } else {
    command = 'xdg-open';
    args = [url];
  }
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

function pageUrl(target, edit) {
  const base = BASE_URL;
  const view = String(target || '').replace(/^#\/?/, '').replace(/\/+$/, '');
  const routes = {
    dashboard: '/',
    releases: '/#/releases',
    tasks: '/#/tasks',
    bugs: '/#/bugs',
    reports: '/#/reports',
    settings: '/#/settings'
  };
  if (routes[view]) return `${base}${routes[view]}`;
  const bugMatch = view.match(/^(?:bug|bugs)\/(\d{1,12})(?:\/edit)?$/);
  if (bugMatch) {
    return `${base}/#/bugs/${bugMatch[1]}${edit ? '/edit' : ''}`;
  }
  fail(`未知页面：${target}。可用页面：dashboard、releases、tasks、bugs、reports、settings，或 bug/<ID>。`);
}

async function commandStatus() {
  const health = await api('/api/health');
  const meta = await api('/api/bootstrap?meta=1');
  const data = {
    ok: Boolean(health.ok && health.ready),
    app: health.app,
    account: health.account,
    server: BASE_URL,
    syncing: Boolean(health.syncing),
    lastSyncAt: health.lastSyncAt,
    cacheAgeMs: health.cacheAgeMs,
    revision: health.revision,
    counts: (meta && meta.counts) || null,
    lastError: health.lastError || null
  };
  const text = [
    `QDesk ${data.ok ? '就绪' : '未就绪'} · ${data.account || '-'}`,
    `同步：${data.syncing ? '进行中' : '空闲'} · 最近 ${data.lastSyncAt || '-'}`,
    `数据：${data.counts ? `${data.counts.products || 0} 个产品 / ${data.counts.projects || 0} 个项目 / ${data.counts.tasks || 0} 个任务 / ${data.counts.bugs || 0} 个 Bug` : '-'}`,
    data.lastError ? `错误：${data.lastError}` : '错误：无'
  ].join('\n');
  printResult(data, text);
}

async function commandSync() {
  const ack = await request('POST', '/api/sync');
  if (!hasFlag('wait') || DRY_RUN) {
    printResult(ack, '已触发后台同步。');
    return;
  }
  const timeoutMs = numberOption('timeout', 180) * 1000;
  const started = Date.now();
  let health = null;
  while (Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    health = await api('/api/health');
    if (!health.syncing) break;
  }
  if (!health) health = await api('/api/health');
  const result = { ack, health };
  printResult(result, health.syncing ? '同步仍在进行中。' : '同步完成。');
}

async function commandBootstrap() {
  const data = await bootstrap();
  if (!hasFlag('full')) {
    const summary = {
      generatedAt: data.generatedAt,
      account: data.tester && data.tester.account,
      productCount: (data.products || []).length,
      projectCount: (data.projectList || []).length,
      taskCount: (data.tasks || []).length,
      bugCount: (data.bugs || []).length,
      reportCount: (data.reports || []).length,
      releaseCount: (data.releases || []).length,
      scopeCounts: data.scopeCounts,
      sync: data.sync
    };
    printResult(summary);
    return;
  }
  printResult(data);
}

async function commandDashboard() {
  const data = await bootstrap();
  const core = await loadCore();
  const state = coreState(data);
  const metrics = core.metrics(state);
  const focus = core.dailyFocus(state);
  const notifications = await buildNotifications(state, core);
  const result = { metrics, focus, notifications };
  const text = [
    `当日进度 ${focus.progress}% · ${focus.completedCount}/${focus.plannedCount} 项`,
    `待验证 ${focus.bugs.pending} 个 · 待发版 ${focus.versions.pending} 个 · 待完成 ${focus.tasks.pending} 项`,
    focus.versions.items.length
      ? `发版：${focus.versions.items.filter((item) => item.testEnd && item.releaseStatus !== 'ended').map((item) => item.name).join(' / ') || '无'}`
      : '发版：无',
    `提醒：${notifications.length} 条`
  ].join('\n');
  printResult(result, text);
}

async function buildNotifications(state, core) {
  const today = core.localDate();
  const items = [];
  (state.tasks || []).forEach((task) => {
    if (task.status === 'done') return;
    if (task.status === 'blocked') {
      items.push({ type: 'task', id: task.id, title: task.title, meta: '任务已阻塞，需要协调', weight: 1 });
    } else if (task.dueDate && task.dueDate < today) {
      items.push({ type: 'task', id: task.id, title: task.title, meta: `已逾期 ${core.relativeDay(task.dueDate, today)}`, weight: 0 });
    } else if (task.dueDate === today) {
      items.push({ type: 'task', id: task.id, title: task.title, meta: '今天到期', weight: 2 });
    }
  });
  (state.bugs || []).forEach((bug) => {
    if (bug.status === 'closed') return;
    if (bug.severity === 'P0' || bug.severity === 'P1') {
      items.push({
        type: 'bug',
        id: bug.id,
        title: bug.title,
        meta: `${bug.severity} · ${statusLabel(bug.status)}`,
        weight: bug.severity === 'P0' ? 0 : 1
      });
    }
  });
  const autojob = state.autojobStats || (state.autojob && state.autojob.summary);
  if (autojob && autojob.active) {
    items.push({
      type: 'autojob',
      id: '',
      title: `客服反馈还有 ${autojob.active} 条待验证`,
      meta: `${autojob.highPriorityOpen ? `${autojob.highPriorityOpen} 条 P0/P1 · ` : ''}AI 从客服群聊提取`,
      weight: 0
    });
  }
  if (core.metrics(state).reportStatus === 'none') {
    items.push({ type: 'report', id: today, title: '今天的日报还没有生成', meta: '花一分钟汇总今天的工作', weight: 3 });
  }
  return items.sort((a, b) => a.weight - b.weight).slice(0, 8);
}

async function commandMetrics() {
  const data = await bootstrap();
  const core = await loadCore();
  const metrics = core.metrics(coreState(data));
  printResult(metrics);
}

async function commandFocus() {
  const data = await bootstrap();
  const core = await loadCore();
  const focus = core.dailyFocus(coreState(data));
  printResult(focus);
}

async function commandNotifications() {
  const data = await bootstrap();
  const core = await loadCore();
  const items = await buildNotifications(coreState(data), core);
  const text = items.length
    ? items.map((item) => `${item.type}\t${item.id || '-'}\t${item.title}\t${item.meta}`).join('\n')
    : '今天没有逾期或高优先级提醒。';
  printResult(items, text);
}

async function commandActivity() {
  const data = await bootstrap();
  const core = await loadCore();
  const limit = numberOption('limit', 5);
  const items = core.recentActivity(coreState(data), limit);
  printResult(items);
}

async function commandWeek() {
  const data = await bootstrap();
  const core = await loadCore();
  const series = core.weekSeries(coreState(data), currentDate());
  printResult(series);
}

async function commandSearch() {
  const query = String(parsed.positional.slice(1).join(' ') || firstValue('q') || '').trim();
  if (!query) fail('请提供搜索关键词。');
  const data = await bootstrap();
  const core = await loadCore();
  const state = coreState(data);
  const limit = numberOption('limit', 20);
  const q = query.toLowerCase();
  const tasks = (state.tasks || []).filter((task) => (
    [task.id, task.title, task.description, task.project, task.module, task.type, ...(task.tags || [])]
      .join(' ').toLowerCase().includes(q)
  )).sort(core.compareTasks).slice(0, limit);
  const bugs = (state.bugs || []).filter((bug) => (
    [bug.id, bug.title, bug.project, bug.module, bug.assignee, bug.environment]
      .join(' ').toLowerCase().includes(q)
  )).sort(core.compareBugs).slice(0, limit);
  const result = { query, tasks: tasks.map(briefTask), bugs: bugs.map(briefBug) };
  const text = [
    `任务 ${tasks.length} 个`,
    ...tasks.map(taskText),
    `Bug ${bugs.length} 个`,
    ...bugs.map(bugText)
  ].join('\n');
  printResult(result, text);
}

async function commandTasks(action) {
  const id = parsed.positional[2];
  if (!action || action === 'list') {
    const scope = firstValue('scope') || 'mine';
    const data = await api(`/api/tasks?scope=${encodeURIComponent(scope)}`);
    const core = await loadCore();
    let tasks = Array.isArray(data.tasks) ? data.tasks.slice() : [];
    tasks = core.filterTasks(tasks, {
      q: readOption('q'),
      status: readOption('status'),
      priority: readOption('priority'),
      project: readOption('project'),
      due: readOption('due'),
      date: readOption('date')
    });
    const type = readOption('type');
    if (type && type !== 'all') tasks = tasks.filter((task) => String(task.type) === String(type));
    if (hasFlag('local')) tasks = tasks.filter((task) => task.isLocal);
    if (hasFlag('remote')) tasks = tasks.filter((task) => !task.isLocal);
    const limit = limitValue(50);
    const total = tasks.length;
    const result = { scope, total, tasks: sliceLimit(tasks, limit).map(briefTask) };
    const text = [`任务 ${total} 个（显示 ${result.tasks.length} 个）`, ...result.tasks.map(taskText)].join('\n');
    printResult(result, text);
    return;
  }

  if (action === 'get') {
    if (!id) fail('请提供任务 ID。');
    const data = await api('/api/tasks?scope=all');
    const task = (data.tasks || []).find((item) => String(item.id) === String(id));
    if (!task) fail(`找不到任务 ${id}。`);
    printResult(task);
    return;
  }

  if (action === 'stats') {
    const scope = firstValue('scope') || 'mine';
    const data = await api(`/api/tasks?scope=${encodeURIComponent(scope)}`);
    printResult({ scope, stats: data.stats });
    return;
  }

  if (action === 'create') {
    const input = (await readJsonOption()) || {};
    const payload = {
      ...input,
      title: firstValue('title') !== undefined ? firstValue('title') : input.title,
      description: firstValue('description') !== undefined ? firstValue('description') : input.description,
      startAt: firstValue('start') !== undefined ? firstValue('start') : input.startAt,
      endAt: firstValue('end') !== undefined ? firstValue('end') : input.endAt,
      priority: firstValue('priority') !== undefined ? firstValue('priority') : input.priority,
      pinned: hasFlag('pinned') ? true : hasFlag('unpinned') ? false : input.pinned
    };
    if (!payload.title || !String(payload.title).trim()) fail('创建任务需要 --title。');
    const result = await request('POST', '/api/tasks', payload);
    printResult(result);
    return;
  }

  if (action === 'update' || action === 'complete' || action === 'reopen' || action === 'pin' || action === 'unpin') {
    if (!id) fail('请提供本地任务 ID（LT-...）。');
    if (!/^LT-\d{1,12}$/.test(id)) fail('只能修改 QDesk 本地任务（LT-...），禅道任务保持只读。', 2);
    const input = (await readJsonOption()) || {};
    const payload = { ...input };
    const mapping = {
      title: 'title',
      description: 'description',
      start: 'startAt',
      end: 'endAt',
      priority: 'priority',
      status: 'status'
    };
    for (const [option, key] of Object.entries(mapping)) {
      const value = readOption(option);
      if (value !== undefined) payload[key] = value;
    }
    if (action === 'complete') payload.status = 'done';
    if (action === 'reopen') payload.status = 'todo';
    if (action === 'pin') payload.pinned = true;
    if (action === 'unpin') payload.pinned = false;
    if (hasFlag('pinned')) payload.pinned = true;
    if (hasFlag('unpinned')) payload.pinned = false;
    if (!Object.keys(payload).length) fail('没有需要更新的字段。');
    const result = await request('PATCH', `/api/tasks/${encodeURIComponent(id)}`, payload);
    printResult(result);
    return;
  }

  if (action === 'delete') {
    if (!id) fail('请提供本地任务 ID（LT-...）。');
    if (!/^LT-\d{1,12}$/.test(id)) fail('只能删除 QDesk 本地任务（LT-...）。', 2);
    if (!hasFlag('yes') && !DRY_RUN) fail('删除本地任务需要 --yes 确认。', 2);
    const result = await request('DELETE', `/api/tasks/${encodeURIComponent(id)}`);
    printResult(result);
    return;
  }

  fail(`未知任务子命令：${action}。`);
}

async function commandBugs(action) {
  if (!action || action === 'list') {
    const scope = firstValue('scope') || 'opened';
    const limit = limitValue(50);
    const bugs = await listBugs({ scope });
    const result = { scope, total: bugs.length, bugs: sliceLimit(bugs, limit).map(briefBug) };
    const text = [`Bug ${bugs.length} 个（显示 ${result.bugs.length} 个）`, ...result.bugs.map(bugText)].join('\n');
    printResult(result, text);
    return;
  }

  const id = parsed.positional[2];
  if (action === 'get') {
    if (!id) fail('请提供 Bug ID。');
    printResult(await findBug(id));
    return;
  }

  if (action === 'nav') {
    if (!id) fail('请提供当前 Bug ID。');
    const list = await listBugs({ scope: firstValue('scope') || 'opened' });
    const index = list.findIndex((bug) => String(bug.id) === String(id));
    if (index < 0) fail(`当前筛选结果中找不到 Bug #${id}。`);
    const direction = firstValue('direction') || 'next';
    if (direction !== 'prev' && direction !== 'next') fail('--direction 只能是 prev 或 next。');
    const target = direction === 'prev' ? list[index - 1] : list[index + 1];
    const result = {
      current: briefBug(list[index]),
      position: `${index + 1} / ${list.length}`,
      direction,
      target: target ? briefBug(target) : null
    };
    printResult(result, target ? `#${target.id}\t${target.title}` : (direction === 'prev' ? '已经是第一个 Bug。' : '已经是最后一个 Bug。'));
    return;
  }

  if (action === 'stats') {
    const scope = firstValue('scope') || 'opened';
    const data = await api(`/api/bugs/stats?scope=${encodeURIComponent(scope)}`);
    printResult(data);
    return;
  }

  if (action === 'versions') {
    const scope = firstValue('scope') || 'opened';
    const data = await api(`/api/bugs?scope=${encodeURIComponent(scope)}`);
    const core = await loadCore();
    const map = new Map();
    for (const bug of data.bugs || []) {
      const key = core.versionKey(bug.version);
      if (!key) continue;
      if (!map.has(key)) map.set(key, { version: key, total: 0, pending: 0, open: 0 });
      const item = map.get(key);
      item.total += 1;
      if (core.needsMyVerification(bug)) item.pending += 1;
      if (bug.status !== 'closed') item.open += 1;
    }
    const versions = Array.from(map.values()).sort((a, b) => (
      String(a.version).localeCompare(String(b.version), 'zh-CN', { numeric: true })
    ));
    const text = [`版本 ${versions.length} 个`, ...versions.map((item) => `${item.version}\t待验证 ${item.pending}\t未关闭 ${item.open}\t共 ${item.total}`)].join('\n');
    printResult({ scope, versions }, text);
    return;
  }

  if (action === 'refresh') {
    if (!id) fail('请提供 Bug ID。');
    const result = await request('POST', `/api/bugs/${encodeURIComponent(id)}/refresh`);
    printResult(result);
    return;
  }

  if (action === 'create') {
    const input = (await readJsonOption()) || {};
    const data = await bootstrap();
    const payload = {
      ...input,
      productId: firstValue('product-id', 'product') !== undefined ? firstValue('product-id', 'product') : input.productId,
      title: firstValue('title') !== undefined ? firstValue('title') : input.title,
      severity: firstValue('severity') !== undefined ? firstValue('severity') : input.severity,
      pri: firstValue('pri', 'priority') !== undefined ? firstValue('pri', 'priority') : input.pri,
      type: firstValue('type') !== undefined ? firstValue('type') : input.type,
      assignedTo: firstValue('assigned-to') !== undefined ? firstValue('assigned-to') : input.assignedTo,
      projectId: firstValue('project-id') !== undefined ? firstValue('project-id') : input.projectId,
      executionId: firstValue('execution-id') !== undefined ? firstValue('execution-id') : input.executionId,
      steps: firstValue('steps') !== undefined ? firstValue('steps') : input.steps,
      expected: firstValue('expected') !== undefined ? firstValue('expected') : input.expected,
      actual: firstValue('actual') !== undefined ? firstValue('actual') : input.actual
    };
    if (!payload.productId && data.creation && data.creation.product) {
      payload.productId = data.creation.product.id;
    }
    if (!payload.title) fail('创建 Bug 需要 --title。');
    if (!payload.severity) fail('创建 Bug 需要 --severity。');
    if (!payload.pri) fail('创建 Bug 需要 --pri。');
    const result = await request('POST', '/api/bugs', payload, { timeoutMs: 180000 });
    if (!DRY_RUN && result.id) {
      result.verification = await verifyBug(result.id, () => true);
    }
    printResult(result);
    return;
  }

  if (action === 'update') {
    if (!id) fail('请提供 Bug ID。');
    const bug = await findBug(id);
    requireOwned(bug);
    const input = (await readJsonOption()) || {};
    const payload = { ...input };
    const mapping = {
      title: 'title',
      severity: 'severity',
      pri: 'pri',
      type: 'type',
      'opened-build': 'openedBuild',
      steps: 'steps',
      project: 'project',
      execution: 'execution',
      story: 'story',
      'assigned-to': 'assignedTo'
    };
    for (const [option, key] of Object.entries(mapping)) {
      const value = readOption(option);
      if (value !== undefined) payload[key] = value;
    }
    if (!Object.keys(payload).length) fail('没有需要更新的字段。');
    const result = await request('PATCH', `/api/bugs/${encodeURIComponent(id)}`, payload, { timeoutMs: 180000 });
    if (!DRY_RUN) {
      const fieldMap = {
        title: 'title',
        severity: 'severity',
        pri: 'pri',
        type: 'type',
        assignedTo: 'assigneeAccount',
        project: 'projectId',
        execution: 'executionId',
        story: 'storyId'
      };
      const comparable = Object.keys(payload).filter((key) => fieldMap[key]);
      const unverifiedFields = Object.keys(payload).filter((key) => !fieldMap[key]);
      if (!comparable.length) {
        result.verification = {
          verified: null,
          skipped: true,
          reason: '该字段无法从本地快照直接复核',
          unverifiedFields
        };
      } else {
        result.verification = await verifyBug(id, (current) => comparable.every((key) => (
          String(current[fieldMap[key]]) === String(payload[key])
        )));
        result.verification.unverifiedFields = unverifiedFields;
      }
    }
    printResult(result);
    return;
  }

  if (action === 'assign') {
    if (!id || !parsed.positional[3]) fail('用法：bugs assign <BugID> <账号>。');
    const bug = await findBug(id);
    requireOwned(bug);
    const account = parsed.positional[3];
    const result = await request('POST', `/api/bugs/${encodeURIComponent(id)}/assign`, { assignedTo: account });
    if (!DRY_RUN) result.verification = await verifyBug(id, (current) => current.assigneeAccount === account);
    printResult(result);
    return;
  }

  if (action === 'resolve' || action === 'close' || action === 'activate' || action === 'confirm' || action === 'delete') {
    if (!id) fail('请提供 Bug ID。');
    const bug = await findBug(id);
    requireOwned(bug);
    if ((action === 'close' || action === 'delete') && !hasFlag('yes') && !DRY_RUN) {
      fail(`${action === 'close' ? '关闭' : '删除'} Bug 需要 --yes 确认。`, 2);
    }
    const input = (await readJsonOption()) || {};
    const payload = {
      ...input,
      comment: firstValue('comment') !== undefined ? firstValue('comment') : input.comment,
      resolution: firstValue('resolution') !== undefined ? firstValue('resolution') : input.resolution,
      resolvedBuild: firstValue('build') !== undefined ? firstValue('build') : input.resolvedBuild,
      openedBuild: firstValue('build') !== undefined ? firstValue('build') : input.openedBuild,
      assignedTo: firstValue('assigned-to') !== undefined ? firstValue('assigned-to') : input.assignedTo,
      pri: firstValue('pri', 'priority') !== undefined ? firstValue('pri', 'priority') : input.pri,
      type: firstValue('type') !== undefined ? firstValue('type') : input.type,
      deadline: firstValue('deadline') !== undefined ? firstValue('deadline') : input.deadline
    };
    Object.keys(payload).forEach((key) => {
      if (payload[key] === undefined) delete payload[key];
    });
    const result = await request('POST', `/api/bugs/${encodeURIComponent(id)}/${action}`, payload, { timeoutMs: 180000 });
    if (!DRY_RUN) {
      if (action === 'delete') {
        const still = (await allBugs()).some((item) => String(item.id) === String(id));
        result.verification = { verified: !still };
      } else {
        const expected = action === 'resolve' ? 'resolved' : action === 'close' ? 'closed' : 'active';
        result.verification = await verifyBug(id, (current) => current.status === expected);
      }
    }
    printResult(result);
    return;
  }

  if (action === 'plan-close' || action === 'close-many') {
    const rawIds = firstValue('ids') || parsed.positional.slice(2).join(',');
    const ids = Array.from(new Set(
      String(rawIds || '').split(',').map((item) => item.trim()).filter(Boolean)
    ));
    if (!ids.length) fail('请通过 --ids 1,2,3 提供 Bug ID。');
    const bugs = await allBugs();
    const found = ids.map((bugId) => ({ id: bugId, bug: bugs.find((item) => String(item.id) === String(bugId)) }));
    const missing = found.filter((item) => !item.bug).map((item) => item.id);
    const notOwned = found.filter((item) => item.bug && !item.bug.isAssignedToMe).map((item) => item.bug);
    const owned = found.filter((item) => item.bug && item.bug.isAssignedToMe).map((item) => item.bug);
    const list = {
      requested: ids.length,
      owned: owned.map(briefBug),
      notOwned: notOwned.map(briefBug),
      missing
    };
    if (action === 'plan-close') {
      printResult(list);
      if (missing.length || notOwned.length) process.exitCode = 2;
      return;
    }
    if (!hasFlag('yes')) {
      printResult({ ...list, message: '批量关闭需要 --yes；请先确认 plan-close 清单。' });
      process.exitCode = 2;
      return;
    }
    if (!owned.length) fail('没有属于当前账号的可关闭 Bug。', 2);
    if (owned.length > 100 && !hasFlag('allow-large')) {
      fail('批量关闭超过 100 条，需先确认完整清单并追加 --allow-large。', 3);
    }
    if (missing.length || notOwned.length) {
      printResult({ ...list, message: '存在不属于当前账号或找不到的 Bug，已全部中止，未关闭任何记录。' });
      process.exitCode = 2;
      return;
    }
    const comment = firstValue('comment') || '';
    const results = [];
    for (const bug of owned) {
      try {
        const current = await findBug(bug.id);
        requireOwned(current);
        const closed = await request('POST', `/api/bugs/${encodeURIComponent(bug.id)}/close`, { comment });
        const verification = DRY_RUN ? null : await verifyBug(bug.id, (current) => current.status === 'closed');
        results.push({ id: bug.id, ok: true, result: closed, verification });
      } catch (error) {
        results.push({ id: bug.id, ok: false, error: error.message });
      }
    }
    printResult({ list, results });
    if (results.some((item) => !item.ok || (item.verification && item.verification.verified === false))) process.exitCode = 1;
    return;
  }

  fail(`未知 Bug 子命令：${action}。`);
}

function releaseText(release) {
  const window = release.testStart || release.testEnd
    ? `${release.testStart || '未设置'} ~ ${release.testEnd || '未设置'}`
    : '未排期';
  return `${release.name}\t${release.status}\t${window}\t${release.priority || '-'}\t${release.pinned ? '置顶' : ''}`;
}

async function commandReleases(action) {
  if (!action || action === 'list') {
    const data = await api('/api/releases');
    const releases = data.releases || [];
    const text = [`版本 ${releases.length} 个`, ...releases.map(releaseText)].join('\n');
    printResult(data, text);
    return;
  }

  if (action === 'set' || action === 'close' || action === 'reopen') {
    const key = parsed.positional[2];
    if (!key) fail('请提供版本号，例如 2.9.0。');
    const payload = { key };
    if (action === 'close') payload.closed = true;
    else if (action === 'reopen') payload.closed = false;
    else {
      for (const [option, field] of [['start', 'testStart'], ['end', 'testEnd'], ['priority', 'priority']]) {
        const value = readOption(option);
        if (value !== undefined) payload[field] = value;
      }
      const pinned = flagPair('pinned', 'unpinned', undefined);
      if (pinned !== undefined) payload.pinned = pinned;
      if (hasFlag('closed')) payload.closed = true;
      if (hasFlag('reopen')) payload.closed = false;
      if (hasFlag('clear')) {
        payload.testStart = '';
        payload.testEnd = '';
        payload.pinned = false;
        payload.priority = '';
        payload.closed = false;
      }
      if (Object.keys(payload).length === 1) fail('没有需要更新的版本字段。');
    }
    const result = await request('POST', '/api/releases', payload);
    printResult(result);
    return;
  }

  if (action === 'bugs') {
    const key = parsed.positional[2];
    if (!key) fail('请提供版本号，例如 2.9.0。');
    const kind = firstValue('kind') || 'all';
    const core = await loadCore();
    const data = await api('/api/bugs?scope=all');
    let bugs = core.filterBugs(data.bugs || [], {
      version: key,
      releaseKind: kind === 'pending' ? 'pending' : kind === 'open' ? 'open' : undefined
    });
    const limit = limitValue(50);
    const total = bugs.length;
    const result = { version: key, kind, total, bugs: sliceLimit(bugs, limit).map(briefBug) };
    const text = [`版本 ${key} · ${kind} · ${total} 个`, ...result.bugs.map(bugText)].join('\n');
    printResult(result, text);
    return;
  }

  fail(`未知发版子命令：${action}。`);
}

function reportBrief(report) {
  return {
    date: report.date,
    status: report.status,
    autoGenerated: Boolean(report.autoGenerated),
    autoUpdatedAt: report.autoUpdatedAt,
    updatedAt: report.updatedAt,
    summary: report.content && report.content.summary ? report.content.summary.slice(0, 200) : ''
  };
}

async function getReports() {
  const data = await api('/api/reports');
  return Array.isArray(data.reports) ? data.reports : [];
}

function pickReport(reports, date) {
  if (date) return reports.find((report) => report.date === date) || null;
  return reports.length ? reports[0] : null;
}

async function generateReport(date, core, data) {
  const state = coreState(data);
  const report = core.buildReport(state, date);
  return { report, state };
}

async function saveReportPayload(payload) {
  return request('POST', '/api/reports', payload);
}

async function commandReports(action) {
  if (!action || action === 'list') {
    const reports = await getReports();
    const result = { total: reports.length, reports: reports.map(reportBrief) };
    const text = [`日报 ${reports.length} 篇`, ...result.reports.map((item) => `${item.date}\t${item.status}\t${item.autoGenerated ? '自动' : '手动'}\t${item.summary}`)].join('\n');
    printResult(result, text);
    return;
  }

  const dated = parsed.positional[2];
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(dated || '')) ? dated : currentDate();

  if (action === 'get') {
    const reports = await getReports();
    const report = pickReport(reports, /^\d{4}-\d{2}-\d{2}$/.test(String(dated || '')) ? dated : undefined);
    if (!report) fail('暂无日报。');
    printResult(report);
    return;
  }

  if (action === 'generate') {
    const data = await bootstrap();
    const core = await loadCore();
    const generated = await generateReport(date, core, data);
    let saved = null;
    if (hasFlag('save')) {
      saved = await saveReportPayload({
        date,
        status: 'draft',
        content: generated.report.content,
        autoGenerated: true,
        autoUpdatedAt: generated.report.autoUpdatedAt
      });
    }
    const result = { date, saved, report: generated.report };
    printResult(result);
    return;
  }

  if (action === 'save') {
    const input = (await readJsonOption()) || {};
    const saveDate = /^\d{4}-\d{2}-\d{2}$/.test(String(dated || ''))
      ? dated
      : (input.date && /^\d{4}-\d{2}-\d{2}$/.test(String(input.date)) ? String(input.date) : currentDate());
    const reports = await getReports();
    const existing = pickReport(reports, saveDate);
    const content = { ...(existing && existing.content ? existing.content : {}) };
    if (input.content && typeof input.content === 'object') Object.assign(content, input.content);
    const fieldMap = {
      summary: 'summary',
      version: 'version',
      'bugs-summary': 'bugsSummary',
      tasks: 'tasks',
      autojob: 'autojob',
      done: 'done',
      bugs: 'bugs',
      ongoing: 'ongoing',
      next: 'next',
      risks: 'risks'
    };
    for (const [option, key] of Object.entries(fieldMap)) {
      const value = readOption(option);
      if (value !== undefined) content[key] = value;
    }
    if (!existing && input.content === undefined && !Object.keys(fieldMap).some((option) => readOption(option) !== undefined)) {
      fail('没有可保存的日报内容。');
    }
    const payload = {
      date: saveDate,
      status: firstValue('status') || (existing ? existing.status : 'draft'),
      content,
      autoGenerated: hasFlag('auto') ? true : false,
      autoUpdatedAt: hasFlag('auto') ? new Date().toISOString() : (existing && existing.autoUpdatedAt) || null
    };
    if (payload.status === 'submitted') payload.submittedAt = new Date().toISOString();
    const result = await saveReportPayload(payload);
    printResult(result);
    return;
  }

  if (action === 'refresh') {
    const data = await bootstrap();
    const core = await loadCore();
    const generated = await generateReport(date, core, data);
    const result = await saveReportPayload({
      date,
      status: 'draft',
      content: generated.report.content,
      autoGenerated: true,
      autoUpdatedAt: generated.report.autoUpdatedAt
    });
    printResult(result);
    return;
  }

  if (action === 'submit' || action === 'draft') {
    const reports = await getReports();
    let report = pickReport(reports, date);
    if (!report) {
      const data = await bootstrap();
      const core = await loadCore();
      report = (await generateReport(date, core, data)).report;
    }
    if (action === 'submit' && !String((report.content && report.content.summary) || '').trim()) {
      fail('请先填写今日摘要，再提交日报。');
    }
    const payload = {
      ...report,
      status: action === 'submit' ? 'submitted' : 'draft',
      autoGenerated: action === 'submit' ? false : report.autoGenerated,
      submittedAt: action === 'submit' ? new Date().toISOString() : null
    };
    const result = await saveReportPayload(payload);
    printResult(result);
    return;
  }

  if (action === 'copy' || action === 'markdown') {
    const reports = await getReports();
    let report = pickReport(reports, date);
    if (!report) {
      const data = await bootstrap();
      const core = await loadCore();
      report = (await generateReport(date, core, data)).report;
    }
    const data = await bootstrap();
    const core = await loadCore();
    const profile = data.profile || {};
    const text = action === 'copy'
      ? core.renderReportCopyText(report, profile)
      : core.renderReportMarkdown(report, profile);
    const output = readOption('output');
    if (output) {
      const absolute = writeFile(output, text);
      printResult({ output: absolute, date: report.date }, absolute);
    } else if (hasFlag('clipboard') && action === 'copy') {
      await copyToClipboard(text);
      printResult({ copied: true, date: report.date, chars: text.length }, '已复制到剪贴板。');
    } else {
      console.log(text);
    }
    return;
  }

  if (action === 'export') {
    const format = String(firstValue('format') || 'md').toLowerCase();
    const reports = await getReports();
    let report = pickReport(reports, date);
    if (!report) {
      const data = await bootstrap();
      const core = await loadCore();
      report = (await generateReport(date, core, data)).report;
    }
    const data = await bootstrap();
    const core = await loadCore();
    const content = format === 'json'
      ? JSON.stringify(report, null, 2)
      : core.renderReportMarkdown(report, data.profile || {});
    const output = firstValue('output') || `工作日报_${report.date}.${format === 'json' ? 'json' : 'md'}`;
    const absolute = writeFile(output, content);
    printResult({ output: absolute, date: report.date, format }, absolute);
    return;
  }

  fail(`未知日报子命令：${action}。`);
}

async function commandSettings(action) {
  if (!action || action === 'get') {
    const data = await bootstrap();
    printResult({ settings: data.settings, profile: data.profile });
    return;
  }
  if (action === 'update') {
    const payload = {};
    const profile = {};
    for (const [option, key] of [['role', 'role'], ['team', 'team'], ['sprint', 'sprint']]) {
      const value = readOption(option);
      if (value !== undefined) profile[key] = value;
    }
    if (Object.keys(profile).length) payload.profile = profile;
    const preferences = {};
    for (const [option, key] of [['task-view', 'taskView'], ['task-scope', 'taskScope'], ['bug-scope', 'bugScope']]) {
      const value = readOption(option);
      if (value !== undefined) preferences[key] = value;
    }
    if (Object.keys(preferences).length) payload.preferences = preferences;
    if (!Object.keys(payload).length) fail('没有需要更新的设置。');
    const result = await request('POST', '/api/settings', payload);
    printResult(result);
    return;
  }
  fail(`未知设置子命令：${action}。`);
}

function connectionPayload() {
  const payload = {};
  const url = readOption('url');
  const account = readOption('account');
  const testerName = firstValue('tester-name', 'name');
  if (url !== undefined) payload.url = url;
  if (account !== undefined) payload.account = account;
  if (testerName !== undefined) payload.testerName = testerName;
  return payload;
}

async function passwordValue() {
  if (hasFlag('password-stdin')) {
    const text = await readStdin();
    const line = String(text || '').split(/\r?\n/)[0];
    if (!line) fail('stdin 没有收到密码。');
    return line;
  }
  const envName = firstValue('password-env') || 'QDESK_ZENTAO_PASSWORD';
  const value = process.env[envName];
  if (value) return value;
  return undefined;
}

async function commandConnection(action) {
  if (!action || action === 'get') {
    const data = await api('/api/connection');
    printResult(data);
    return;
  }
  if (action === 'test' || action === 'save') {
    const payload = connectionPayload();
    const password = await passwordValue();
    if (password !== undefined) payload.password = password;
    const pathname = action === 'test' ? '/api/zentao/test' : '/api/zentao/connection';
    const result = await request('POST', pathname, payload, { timeoutMs: 120000 });
    if (action === 'test') {
      printResult(result);
      return;
    }
    const summary = {
      connection: result.connection,
      probe: result.probe,
      snapshot: result.snapshot ? {
        generatedAt: result.snapshot.generatedAt,
        productCount: (result.snapshot.products || []).length,
        projectCount: (result.snapshot.projectList || []).length,
        taskCount: (result.snapshot.tasks || []).length,
        bugCount: (result.snapshot.bugs || []).length
      } : null,
      warning: result.warning || ''
    };
    printResult(summary);
    return;
  }
  fail(`未知连接子命令：${action}。`);
}

function taskCsv(tasks) {
  const headers = ['编号', '标题', '类型', '优先级', '状态', '禅道状态', '项目', '执行', '截止日期', '截止来源', '工时', '负责人', '标签', '创建时间', '完成时间', '说明'];
  const rows = tasks.map((task) => [
    task.id, task.title, task.type, task.priority, task.status, task.rawStatus,
    task.project, task.execution, task.dueDate, task.dueSource === 'execution' ? '迭代截止' : '任务截止',
    task.estimate, task.assignee, (task.tags || []).join(' / '), task.createdAt, task.completedAt, task.description
  ]);
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

function bugCsv(bugs) {
  const headers = ['编号', '标题', '严重程度', '禅道状态', '类型', '业务分类', '产品', '模块', '影响版本', '负责人', '报告人', '复现步骤', '预期结果', '实际结果', '创建时间', '解决时间', '关闭时间'];
  const rows = bugs.map((bug) => [
    bug.id, bug.title, bug.severity, bug.statusLabel, bug.typeLabel, bug.businessCategory, bug.project, bug.module,
    bug.version, bug.assignee, bug.reporter, bug.steps, bug.expected, bug.actual,
    bug.createdAt, bug.resolvedAt, bug.closedAt
  ]);
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

async function commandExport(action) {
  if (!action) fail('请指定导出类型：backup、tasks-csv 或 bugs-csv。');
  const data = await bootstrap();
  if (action === 'backup' || action === 'json') {
    const payload = {
      ...data,
      exportedAt: new Date().toISOString(),
      app: 'QDesk 测试工作台',
      exportedBy: 'qa-workbench/qdesk.mjs'
    };
    const output = firstValue('output') || `QDesk_backup_${currentDate()}.json`;
    if (hasFlag('stdout')) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    const absolute = writeFile(output, JSON.stringify(payload, null, 2));
    printResult({ output: absolute, tasks: (data.tasks || []).length, bugs: (data.bugs || []).length }, absolute);
    return;
  }
  if (action === 'tasks-csv') {
    const csv = taskCsv(data.tasks || []);
    const output = firstValue('output') || `任务清单_${currentDate()}.csv`;
    if (hasFlag('stdout')) {
      console.log(csv);
      return;
    }
    const absolute = writeFile(output, `﻿${csv}`);
    printResult({ output: absolute, count: (data.tasks || []).length }, absolute);
    return;
  }
  if (action === 'bugs-csv') {
    const csv = bugCsv(data.bugs || []);
    const output = firstValue('output') || `Bug清单_${currentDate()}.csv`;
    if (hasFlag('stdout')) {
      console.log(csv);
      return;
    }
    const absolute = writeFile(output, `﻿${csv}`);
    printResult({ output: absolute, count: (data.bugs || []).length }, absolute);
    return;
  }
  fail(`未知导出类型：${action}。`);
}

async function commandOpen() {
  let target = parsed.positional[1] || firstValue('target');
  const second = parsed.positional[2];
  let edit = hasFlag('edit');
  if (target === 'bug' && second) target = `bug/${second}`;
  if (!target) fail('用法：open <dashboard|releases|tasks|bugs|reports|settings|bug/ID>。');
  const url = pageUrl(target, edit);
  if (hasFlag('launch')) launchUrl(url);
  printResult({ url, launched: hasFlag('launch') }, url);
}

async function main() {
  if (hasFlag('help') || hasFlag('h') || parsed.positional.length === 0) {
    usage();
    return;
  }
  const group = parsed.positional[0];
  const action = parsed.positional[1];
  switch (group) {
    case 'status':
      await commandStatus();
      return;
    case 'sync':
      await commandSync();
      return;
    case 'bootstrap':
      await commandBootstrap();
      return;
    case 'dashboard':
      await commandDashboard();
      return;
    case 'metrics':
      await commandMetrics();
      return;
    case 'focus':
      await commandFocus();
      return;
    case 'notifications':
      await commandNotifications();
      return;
    case 'activity':
      await commandActivity();
      return;
    case 'week':
      await commandWeek();
      return;
    case 'search':
      await commandSearch();
      return;
    case 'tasks':
      await commandTasks(action);
      return;
    case 'bugs':
      await commandBugs(action);
      return;
    case 'releases':
      await commandReleases(action);
      return;
    case 'reports':
      await commandReports(action);
      return;
    case 'settings':
      await commandSettings(action);
      return;
    case 'connection':
      await commandConnection(action);
      return;
    case 'export':
      await commandExport(action);
      return;
    case 'open':
      await commandOpen();
      return;
    default:
      fail(`未知命令：${group}。使用 --help 查看全部命令。`);
  }
}

main().catch((error) => {
  console.error(error instanceof CliError ? error.message : (error.stack || error.message || String(error)));
  process.exit(error && error.exitCode ? error.exitCode : 1);
});
