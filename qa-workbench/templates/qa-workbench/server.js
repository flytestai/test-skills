'use strict';

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  ZentaoError,
  runJson,
  getVersion,
  listProducts,
  listProjects,
  listUsers,
  listExecutions,
  listTasks,
  listBugs,
  getBug,
  createBug,
  updateBug,
  bugAction
} = require('./lib/zentao');
const Core = require('./core');
const {
  BUG_TYPES,
  normalizeTask,
  normalizeBug,
  autojobRelation,
  buildBugStats,
  buildAutojobStats,
  buildTaskStats,
  userMap,
  severityRaw,
  priorityValue,
  localDate
} = require('./lib/normalize');
const {
  normalizeConnection,
  maskConnection,
  credentialEnv,
  readAuth,
  writeAuth,
  sanitizeSecret
} = require('./lib/connection');
const { Store, VIEWS } = require('./lib/store');

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data', 'app-data.json');
const AUTH_FILE = path.join(ROOT, 'data', 'zentao-auth.json');
const SNAPSHOT_FILE = path.join(ROOT, 'data', 'snapshot-cache.json');
const CONFIG_FILE = path.join(ROOT, 'config.json');

const DEFAULT_CONFIG = {
  server: { host: '127.0.0.1', port: 4173 },
  tester: { account: '', name: '' },
  zentao: {
    productId: '',
    taskProjectIds: [],
    openedBuild: 'trunk',
    openedBuildLabel: '主干',
    serverVersion: '22.4',
    cacheSeconds: 300,
    syncTimes: ['08:30', '12:00', '17:00'],
    syncIntervalMinutes: 30,
    syncWindow: { start: '08:30', end: '18:00' },
    syncWorkdays: [1, 2, 3, 4, 5],
    refreshCooldownMs: 5000,
    cliPath: '',
    moduleNames: {},
    bugModules: [{ id: '0', name: '未指定' }]
  },
  watch: {
    enabled: true,
    autojobAccounts: ['autojob'],
    productIds: [],
    label: 'AI 客服提取',
    description: '来自客服群聊天记录，自动提取为禅道 Bug'
  }
};

const STATIC_FILES = new Map([
  ['/', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/index.html', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/styles.css', { file: 'styles.css', type: 'text/css; charset=utf-8' }],
  ['/core.js', { file: 'core.js', type: 'text/javascript; charset=utf-8' }],
  ['/app.js', { file: 'app.js', type: 'text/javascript; charset=utf-8' }]
]);

const BUG_TYPE_OPTIONS = Object.entries(BUG_TYPES).map(([value, label]) => ({ value, label }));
const PRIORITY_OPTIONS = [
  { value: 'P0', label: 'P0 最高' },
  { value: 'P1', label: 'P1 高' },
  { value: 'P2', label: 'P2 中' },
  { value: 'P3', label: 'P3 低' }
];
const SEVERITY_OPTIONS = [
  { value: 'P0', label: 'P0 致命' },
  { value: 'P1', label: 'P1 严重' },
  { value: 'P2', label: 'P2 一般' },
  { value: 'P3', label: 'P3 轻微' }
];

function deepMerge(base, override) {
  const out = { ...(base || {}) };
  Object.entries(override || {}).forEach(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = deepMerge(out[key], value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  });
  return out;
}

function loadConfig() {
  let fileConfig = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (error) {
      throw new Error(`配置文件无法解析：${CONFIG_FILE}`);
    }
  }
  const config = deepMerge(DEFAULT_CONFIG, fileConfig);
  if (process.env.QDESK_PORT) config.server.port = Number(process.env.QDESK_PORT);
  if (process.env.QDESK_HOST) config.server.host = process.env.QDESK_HOST;
  if (process.env.ZENTAO_PRODUCT_ID) config.zentao.productId = String(process.env.ZENTAO_PRODUCT_ID);
  if (process.env.ZENTAO_ACCOUNT) config.tester.account = String(process.env.ZENTAO_ACCOUNT);
  if (process.env.ZENTAO_CLI_JS) config.zentao.cliPath = process.env.ZENTAO_CLI_JS;
  if (process.env.ZENTAO_TASK_PROJECT_IDS) {
    config.zentao.taskProjectIds = String(process.env.ZENTAO_TASK_PROJECT_IDS)
      .split(',').map((id) => id.trim()).filter(Boolean);
  }
  if (process.env.QDESK_AUTOJOB_ACCOUNTS) {
    config.watch.autojobAccounts = String(process.env.QDESK_AUTOJOB_ACCOUNTS)
      .split(',').map((account) => account.trim()).filter(Boolean);
  }
  if (process.env.QDESK_AUTOJOB_PRODUCTS) {
    config.watch.productIds = String(process.env.QDESK_AUTOJOB_PRODUCTS)
      .split(',').map((id) => id.trim()).filter(Boolean);
  }
  if (process.env.QDESK_SYNC_TIMES) {
    config.zentao.syncTimes = String(process.env.QDESK_SYNC_TIMES)
      .split(',').map((time) => time.trim()).filter(Boolean);
  }
  if (process.env.QDESK_SYNC_INTERVAL_MINUTES) {
    config.zentao.syncIntervalMinutes = Number(process.env.QDESK_SYNC_INTERVAL_MINUTES);
  }
  if (process.env.QDESK_SYNC_WINDOW) {
    config.zentao.syncWindow = String(process.env.QDESK_SYNC_WINDOW).trim();
  }
  if (process.env.QDESK_SYNC_WORKDAYS) {
    config.zentao.syncWorkdays = String(process.env.QDESK_SYNC_WORKDAYS)
      .split(',').map((day) => Number(day.trim())).filter((day) => Number.isInteger(day));
  }
  config.server.port = Math.max(1, Math.min(65535, Number(config.server.port) || 4173));
  config.server.host = config.server.host || '127.0.0.1';
  config.tester.account = String(config.tester.account || '').trim();
  config.tester.name = String(config.tester.name || config.tester.account || '').trim();
  config.zentao.productId = String(config.zentao.productId || '').trim();
  config.zentao.taskProjectIds = (config.zentao.taskProjectIds || [])
    .map((id) => String(id)).filter((id) => /^\d+$/.test(id));
  config.zentao.cacheSeconds = Math.max(60, Number(config.zentao.cacheSeconds) || 300);
  config.zentao.syncTimes = (Array.isArray(config.zentao.syncTimes)
    ? config.zentao.syncTimes
    : DEFAULT_CONFIG.zentao.syncTimes)
    .map((time) => String(time).trim())
    .filter((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    .sort();
  if (!config.zentao.syncTimes.length) config.zentao.syncTimes = DEFAULT_CONFIG.zentao.syncTimes.slice();
  const intervalValue = Number(config.zentao.syncIntervalMinutes);
  config.zentao.syncIntervalMinutes = Number.isFinite(intervalValue) && intervalValue >= 0
    ? Math.min(720, Math.round(intervalValue))
    : DEFAULT_CONFIG.zentao.syncIntervalMinutes;
  const rawWindow = config.zentao.syncWindow;
  let windowStart = '';
  let windowEnd = '';
  if (typeof rawWindow === 'string') {
    const parts = rawWindow.split('-').map((part) => part.trim());
    windowStart = parts[0] || '';
    windowEnd = parts[1] || '';
  } else if (rawWindow && typeof rawWindow === 'object') {
    windowStart = String(rawWindow.start || '').trim();
    windowEnd = String(rawWindow.end || '').trim();
  }
  const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!timePattern.test(windowStart)) windowStart = DEFAULT_CONFIG.zentao.syncWindow.start;
  if (!timePattern.test(windowEnd) || windowEnd <= windowStart) windowEnd = DEFAULT_CONFIG.zentao.syncWindow.end;
  config.zentao.syncWindow = { start: windowStart, end: windowEnd };
  config.zentao.syncWorkdays = (Array.isArray(config.zentao.syncWorkdays) ? config.zentao.syncWorkdays : DEFAULT_CONFIG.zentao.syncWorkdays)
    .map((day) => Number(day))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  config.zentao.syncWorkdays = Array.from(new Set(config.zentao.syncWorkdays)).sort((a, b) => a - b);
  if (!config.zentao.syncWorkdays.length) config.zentao.syncWorkdays = DEFAULT_CONFIG.zentao.syncWorkdays.slice();
  config.zentao.refreshCooldownMs = Math.max(0, Number(config.zentao.refreshCooldownMs) || 0);
  config.zentao.openedBuild = String(config.zentao.openedBuild || 'trunk');
  config.zentao.openedBuildLabel = String(config.zentao.openedBuildLabel || '主干');
  config.watch.enabled = config.watch.enabled !== false;
  config.watch.autojobAccounts = (config.watch.autojobAccounts || [])
    .map((account) => String(account).trim()).filter(Boolean);
  config.watch.productIds = (config.watch.productIds || [])
    .map((id) => String(id)).filter((id) => /^\d+$/.test(id));
  config.watch.label = String(config.watch.label || 'AI 客服提取');
  config.watch.description = String(config.watch.description || '来自客服群聊天记录，自动提取为禅道 Bug');
  return config;
}

const config = loadConfig();
const baseConfig = JSON.parse(JSON.stringify(config));
const store = new Store(DATA_FILE);
let auth = readAuth(AUTH_FILE);
applyConnectionToConfig(auth);
const cliOptions = {
  cliPath: config.zentao.cliPath || undefined,
  timeoutMs: 120000,
  env: credentialEnv(auth, process.env)
};

const fileTokenCache = {
  token: '',
  base: '',
  account: '',
  expiresAt: 0
};

const caches = {
  version: { at: 0, ttl: 10 * 60 * 1000, value: null },
  users: { at: 0, ttl: 60 * 60 * 1000, value: null },
  products: { at: 0, ttl: 10 * 60 * 1000, value: null },
  projects: { at: 0, ttl: 10 * 60 * 1000, value: null },
  executions: { at: 0, ttl: 10 * 60 * 1000, value: null },
  autojob: { at: 0, ttl: 15 * 60 * 1000, value: null }
};

let snapshot = null;
let snapshotAt = 0;
let snapshotRevision = 0;
let snapshotInflight = null;
let snapshotEpoch = 0;
let lastConnectionError = '';
let lastConnectionErrorCode = '';
let syncStartedAt = 0;
let syncSource = '';
let syncReason = '';
let nextSyncTimer = null;

function applyConnectionToConfig(value) {
  const saved = value || null;
  config.tester.account = saved && saved.account ? saved.account : baseConfig.tester.account;
  config.tester.name = saved && saved.account
    ? (saved.testerName || saved.account)
    : baseConfig.tester.name;
  config.zentao.productId = baseConfig.zentao.productId;
  config.zentao.taskProjectIds = baseConfig.zentao.taskProjectIds.slice();
  config.zentao.url = saved && saved.url ? saved.url : '';
}

function connectionFallback(webUrl) {
  return {
    url: webUrl || config.zentao.url || '',
    account: config.tester.account,
    testerName: config.tester.name
  };
}

function currentConnection(webUrl) {
  return maskConnection(auth, connectionFallback(webUrl));
}

function resetRuntime() {
  snapshotEpoch += 1;
  snapshot = null;
  snapshotAt = 0;
  snapshotRevision = 0;
  snapshotInflight = null;
  syncStartedAt = 0;
  syncSource = '';
  syncReason = '';
  lastConnectionError = '';
  lastConnectionErrorCode = '';
  if (nextSyncTimer) {
    clearTimeout(nextSyncTimer);
    nextSyncTimer = null;
  }
  fileTokenCache.token = '';
  fileTokenCache.base = '';
  fileTokenCache.account = '';
  fileTokenCache.expiresAt = 0;
  Object.values(caches).forEach((entry) => {
    entry.at = 0;
    entry.value = null;
  });
  removeSnapshotCache();
}

function applySavedConnection(next) {
  auth = next;
  applyConnectionToConfig(auth);
  cliOptions.env = credentialEnv(auth, process.env);
  resetRuntime();
}

function readSnapshotCache() {
  try {
    if (!fs.existsSync(SNAPSHOT_FILE)) return null;
    const parsed = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
    if (!parsed || !parsed.snapshot || typeof parsed.snapshot !== 'object') return null;
    if (!Array.isArray(parsed.snapshot.bugs) || !Array.isArray(parsed.snapshot.tasks)) return null;
    return parsed;
  } catch (error) {
    return null;
  }
}

function writeSnapshotCache(value) {
  try {
    fs.mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true });
    const tmp = `${SNAPSHOT_FILE}.${process.pid}.tmp`;
    const payload = JSON.stringify({
      version: 2,
      savedAt: new Date().toISOString(),
      revision: value.revision,
      snapshot: value.snapshot
    });
    fs.writeFileSync(tmp, payload, { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(tmp, 0o600); } catch (error) { /* Windows may ignore POSIX modes. */ }
    fs.renameSync(tmp, SNAPSHOT_FILE);
    try { fs.chmodSync(SNAPSHOT_FILE, 0o600); } catch (error) { /* noop */ }
  } catch (error) {
    console.error('[QDesk] 快照缓存写入失败：', error.message);
  }
}

function removeSnapshotCache() {
  try { fs.unlinkSync(SNAPSHOT_FILE); } catch (error) { /* already absent */ }
}

function loadSnapshotCache() {
  const cachedSnapshot = readSnapshotCache();
  if (!cachedSnapshot) return false;
  snapshot = cachedSnapshot.snapshot;
  const savedAt = new Date(cachedSnapshot.savedAt || cachedSnapshot.snapshot.generatedAt || 0).getTime();
  snapshotAt = Number.isFinite(savedAt) ? savedAt : 0;
  snapshotRevision = Number(cachedSnapshot.revision) || 1;
  lastConnectionError = '';
  return true;
}

function cacheFresh(entry, force) {
  return !force && entry.value && Date.now() - entry.at < entry.ttl;
}

async function cached(entry, force, loader) {
  if (cacheFresh(entry, force)) return entry.value;
  const value = await loader();
  entry.value = value;
  entry.at = Date.now();
  return value;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;
  async function run() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function compareTask(a, b) {
  const order = { todo: 1, doing: 2, blocked: 3, done: 4 };
  const statusDiff = (order[a.status] || 9) - (order[b.status] || 9);
  if (statusDiff) return statusDiff;
  const priorityDiff = Number(a.priority.slice(1)) - Number(b.priority.slice(1));
  if (priorityDiff) return priorityDiff;
  return String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999'));
}

function compareBug(a, b) {
  const timeDiff = String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  if (timeDiff) return timeDiff;
  return String(b.id || '').localeCompare(String(a.id || ''), 'zh-CN', { numeric: true });
}

function cleanWarnings(warnings) {
  return warnings.filter(Boolean).slice(0, 8);
}

function primaryProductId(products) {
  const ids = (products || []).map((product) => String(product.id));
  if (ids.includes(String(config.zentao.productId))) return String(config.zentao.productId);
  return ids[0] || String(config.zentao.productId || '');
}

async function loadAutojobBugs(products, users, webUrl, moduleNames, force) {
  const configured = Array.from(new Set(config.watch.autojobAccounts || []));
  const known = configured.filter((account) => users.has(account));
  if (!config.watch.enabled || !known.length) {
    return { enabled: false, accounts: known, items: [], warnings: [], scannedProducts: 0 };
  }
  const accountSet = new Set(known);
  const wanted = new Set(config.watch.productIds || []);
  const selected = wanted.size
    ? (products || []).filter((product) => wanted.has(String(product.id)))
    : (products || []);

  return cached(caches.autojob, force, async () => {
    const warnings = [];
    const bundles = await mapLimit(selected, 2, async (product) => {
      try {
        const result = await listBugs(product.id, {
          ...cliOptions,
          browseType: 'all',
          perPage: 1000,
          maxPages: 20
        });
        const bugs = (result.items || [])
          .filter((raw) => raw && accountSet.has(String(raw.openedBy || '')))
          .map((raw) => normalizeBug(raw, {
            users,
            account: config.tester.account,
            productId: product.id,
            productName: product.name,
            moduleNames,
            webUrl,
            autojobAccounts: accountSet
          }));
        return { bugs };
      } catch (error) {
        warnings.push(`产品「${product.name}」客服反馈扫描失败：${error.message}`);
        return { bugs: [] };
      }
    });
    const deduped = new Map();
    bundles.forEach((bundle) => {
      bundle.bugs.forEach((bug) => deduped.set(String(bug.id), bug));
    });
    return {
      enabled: true,
      accounts: known,
      items: Array.from(deduped.values()),
      warnings,
      scannedProducts: selected.length,
      scannedAt: new Date().toISOString()
    };
  });
}

function sortAutojobBugs(rows) {
  const priority = ['P0', 'P1', 'P2', 'P3'];
  return (rows || []).slice().sort((a, b) => {
    const byPriority = priority.indexOf(a.pri) - priority.indexOf(b.pri);
    if (byPriority) return byPriority;
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  });
}

function relatedAutojobBugs(items, account) {
  return sortAutojobBugs((items || [])
    .map((bug) => {
      const relation = autojobRelation(bug, account);
      return relation ? { ...bug, autojobRelation: relation } : null;
    })
    .filter(Boolean));
}

function autojobItemsForSnapshot() {
  if (caches.autojob.value && Array.isArray(caches.autojob.value.items)) {
    return caches.autojob.value.items;
  }
  const info = (snapshot && snapshot.autojob) || {};
  const seeded = (info.bugs || []).map((bug) => {
    const copy = { ...bug };
    delete copy.autojobRelation;
    return copy;
  });
  caches.autojob.value = {
    enabled: Boolean(info.enabled),
    accounts: info.accounts || (config.watch.autojobAccounts || []),
    items: seeded,
    warnings: [],
    scannedProducts: info.scannedProducts || 0,
    scannedAt: info.scannedAt || null
  };
  return seeded;
}

function snapshotUsersMap() {
  const map = new Map();
  const cachedUsers = caches.users.value && Array.isArray(caches.users.value.items)
    ? caches.users.value.items
    : [];
  cachedUsers.forEach((user) => {
    if (user && user.account) map.set(String(user.account), String(user.realname || user.account));
  });
  ((snapshot && snapshot.bugs) || []).forEach((bug) => {
    [
      [bug.reporterAccount, bug.reporter],
      [bug.assigneeAccount, bug.assignee],
      [bug.resolvedByAccount, bug.resolvedByName],
      [bug.closedByAccount, bug.closedByName]
    ].forEach(([account, name]) => {
      if (account && account !== 'closed' && name) map.set(String(account), String(name));
    });
  });
  return map;
}

function rebuildSnapshotState(bugs, autojobItems) {
  const account = config.tester.account;
  const rows = (bugs || []).slice().sort(compareBug);
  const autojobBugs = relatedAutojobBugs(autojobItems || [], account);
  const autojobSummary = buildAutojobStats(autojobItems || [], account);
  const openedBugs = rows.filter((bug) => bug.isMine);
  const assignedBugs = rows.filter((bug) => bug.isAssignedToMe);
  const groups = (snapshot.products || []).map((product) => {
    const productBugs = rows.filter((bug) => String(bug.productId) === String(product.id));
    const open = productBugs.filter((bug) => bug.status !== 'closed');
    return {
      ...product,
      bugCount: productBugs.length,
      openBugs: open.length,
      severeOpen: open.filter((bug) => bug.severity === 'P0' || bug.severity === 'P1').length,
      openedByMe: productBugs.filter((bug) => bug.isMine).length,
      assignedToMe: productBugs.filter((bug) => bug.isAssignedToMe).length
    };
  });
  const previousCounts = (snapshot.sync && snapshot.sync.counts) || {};
  const now = new Date().toISOString();

  snapshotEpoch += 1;
  snapshot.bugs = rows;
  snapshot.products = groups;
  snapshot.bugStats = buildBugStats(rows);
  snapshot.bugScopeStats = {
    opened: buildBugStats(openedBugs),
    assigned: buildBugStats(assignedBugs),
    all: buildBugStats(rows),
    autojob: buildBugStats(autojobBugs)
  };
  snapshot.autojob = {
    ...(snapshot.autojob || {}),
    summary: autojobSummary,
    bugs: autojobBugs
  };
  if (snapshot.zentao) snapshot.zentao.products = groups;
  snapshot.sync = {
    ...(snapshot.sync || {}),
    counts: {
      ...previousCounts,
      bugs: rows.length,
      myBugs: openedBugs.length,
      assignedBugs: assignedBugs.length,
      autojobBugs: autojobBugs.length,
      autojobOpen: autojobSummary.open,
      autojobClosed: autojobSummary.closed
    },
    lastIncrementalAt: now
  };
  snapshot.scopeCounts = {
    ...(snapshot.scopeCounts || {}),
    bugs: {
      opened: openedBugs.length,
      assigned: assignedBugs.length,
      all: rows.length,
      autojob: autojobBugs.length
    }
  };
  snapshot.generatedAt = now;
  snapshotAt = Date.now();
  snapshotRevision += 1;
  lastConnectionError = '';
  lastConnectionErrorCode = '';
  writeSnapshotCache({ snapshot, revision: snapshotRevision });
}

function applyBugToSnapshot(bug) {
  if (!snapshot) return false;
  const account = config.tester.account;
  const bugId = String(bug.id);
  const relation = bug.isAutojob ? autojobRelation(bug, account) : '';
  const belongs = Boolean(bug.isMine || bug.isAssignedToMe || relation);

  const items = autojobItemsForSnapshot();
  const itemIndex = items.findIndex((row) => String(row.id) === bugId);
  if (bug.isAutojob) {
    if (itemIndex >= 0) items[itemIndex] = bug;
    else items.push(bug);
  } else if (itemIndex >= 0) {
    items.splice(itemIndex, 1);
  }

  const bugs = (snapshot.bugs || []).filter((row) => String(row.id) !== bugId);
  if (belongs) bugs.push(bug);
  rebuildSnapshotState(bugs, items);
  refreshDailyReport();
  return true;
}

function removeBugFromSnapshot(bugId) {
  if (!snapshot) return false;
  const id = String(bugId);
  const items = autojobItemsForSnapshot();
  const itemIndex = items.findIndex((row) => String(row.id) === id);
  if (itemIndex >= 0) items.splice(itemIndex, 1);
  const bugs = (snapshot.bugs || []).filter((row) => String(row.id) !== id);
  rebuildSnapshotState(bugs, items);
  refreshDailyReport();
  return true;
}

async function refreshSnapshotBug(bugId, expectedStatus) {
  if (!snapshot) return false;
  let raw = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await getBug(bugId, cliOptions);
    raw = result && result.data && typeof result.data === 'object' ? result.data : result;
    if (!raw || raw.id == null) {
      throw new Error(`禅道未返回 Bug #${bugId} 的数据。`);
    }
    if (!expectedStatus || String(raw.status || '') === expectedStatus) break;
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (expectedStatus && String(raw.status || '') !== expectedStatus) {
    throw new Error(`禅道返回的状态仍为「${raw.status || '未知'}」，预期「${expectedStatus}」，稍后会自动重新同步。`);
  }
  const existing = (snapshot.bugs || []).find((bug) => String(bug.id) === String(bugId));
  const productId = String(raw.product || (existing && existing.productId) || '');
  const product = (snapshot.products || []).find((row) => String(row.id) === productId);
  const normalized = normalizeBug(raw, {
    users: snapshotUsersMap(),
    account: config.tester.account,
    productId,
    productName: product ? product.name : (existing ? existing.project : '禅道产品'),
    moduleNames: config.zentao.moduleNames || {},
    webUrl: (snapshot.zentao && snapshot.zentao.server) || '',
    autojobAccounts: new Set(config.watch.autojobAccounts || [])
  });
  return applyBugToSnapshot(normalized);
}

async function buildSnapshot(force) {
  const start = Date.now();
  const warnings = [];
  const [version, usersResult, productsResult, projectsResult, executionsResult] = await Promise.all([
    cached(caches.version, force, () => getVersion(cliOptions)).catch(() => ({ cli: 'zentao-cli', server: '' })),
    cached(caches.users, force, () => listUsers(cliOptions)).catch((error) => {
      warnings.push(`用户姓名映射加载失败：${error.message}`);
      return { items: [] };
    }),
    cached(caches.products, force, () => listProducts(cliOptions)),
    cached(caches.projects, force, () => listProjects(cliOptions)).catch((error) => {
      warnings.push(`项目列表加载失败：${error.message}`);
      return { items: [] };
    }),
    cached(caches.executions, force, () => listExecutions(cliOptions)).catch((error) => {
      warnings.push(`迭代列表加载失败：${error.message}`);
      return { items: [] };
    })
  ]);

  const users = userMap(usersResult.items || []);
  const testerName = users.get(config.tester.account) || config.tester.name || config.tester.account || '测试工程师';
  const webUrl = version && version.server ? String(version.server) : '';
  const moduleNames = config.zentao.moduleNames || {};

  const productRows = (productsResult.items || []).map((product) => ({
    id: String(product.id),
    name: String(product.name || `产品 ${product.id}`),
    status: String(product.status || '')
  }));
  const projectRows = (projectsResult.items || []).map((project) => ({
    id: String(project.id),
    name: String(project.name || `项目 ${project.id}`),
    status: String(project.status || ''),
    owner: String(project.PM || ''),
    begin: String(project.begin || ''),
    end: String(project.end || '')
  }));
  const accessibleProjectIds = new Set(projectRows.map((project) => project.id));
  const executionRows = (executionsResult.items || []).filter((exec) => (
    !accessibleProjectIds.size || accessibleProjectIds.has(String(exec.project))
  ));

  const autojobAccountSet = new Set(config.watch.autojobAccounts || []);
  const [bugBundles, autojobResult] = await Promise.all([
    mapLimit(productRows, 3, async (product) => {
      const bundleWarnings = [];
      const read = (browseType) => listBugs(product.id, {
        ...cliOptions,
        browseType
      }).catch((error) => {
        bundleWarnings.push(`产品「${product.name}」${browseType === 'assignedtome' ? '指派给我' : '我提交的'} Bug 读取失败：${error.message}`);
        return { items: [] };
      });
      const [openedResult, assignedResult] = await Promise.all([
        read('openedbyme'),
        read('assignedtome')
      ]);
      const unique = new Map();
      [...(openedResult.items || []), ...(assignedResult.items || [])].forEach((raw) => {
        if (raw && raw.id != null) unique.set(String(raw.id), raw);
      });
      const bugs = Array.from(unique.values()).map((raw) => normalizeBug(raw, {
        users,
        account: config.tester.account,
        productId: product.id,
        productName: product.name,
        moduleNames,
        webUrl,
        autojobAccounts: autojobAccountSet
      }));
      return { product, bugs, warnings: bundleWarnings };
    }),
    loadAutojobBugs(productRows, users, webUrl, moduleNames, force).catch((error) => {
      warnings.push(`客服反馈扫描失败：${error.message}`);
      return { enabled: false, accounts: [], items: [], warnings: [], scannedProducts: 0 };
    })
  ]);
  warnings.push(...(autojobResult.warnings || []));

  const globalBugs = new Map();
  bugBundles.forEach((bundle) => {
    warnings.push(...bundle.warnings);
    bundle.bugs.forEach((bug) => globalBugs.set(String(bug.id), bug));
  });
  const account = config.tester.account;
  const autojobBugs = relatedAutojobBugs(autojobResult.items || [], account);
  autojobBugs.forEach((bug) => {
    if (!globalBugs.has(String(bug.id))) globalBugs.set(String(bug.id), bug);
  });
  const bugs = Array.from(globalBugs.values()).sort(compareBug);
  const autojobSummary = buildAutojobStats(autojobResult.items || [], account);

  const taskWarnings = [];
  const taskBundles = await mapLimit(executionRows, 4, async (exec) => {
    try {
      const result = await listTasks(exec.id, cliOptions);
      return { exec, tasks: result.items || [] };
    } catch (error) {
      taskWarnings.push(`迭代 ${exec.id}「${exec.name || ''}」任务读取失败：${error.message}`);
      return { exec, tasks: [] };
    }
  });
  warnings.push(...taskWarnings);
  const taskRows = [];
  taskBundles.forEach(({ exec, tasks: rows }) => {
    rows.forEach((row) => {
      taskRows.push(normalizeTask(row, {
        users,
        account: config.tester.account,
        execution: exec,
        webUrl
      }));
    });
  });
  taskRows.sort(compareTask);

  const taskMine = taskRows.filter((task) => task.isMine);
  const taskTests = taskRows.filter((task) => task.isTest);
  const openedBugs = bugs.filter((bug) => bug.isMine);
  const assignedBugs = bugs.filter((bug) => bug.isAssignedToMe);

  const bugGroups = productRows.map((product) => {
    const rows = bugs.filter((bug) => String(bug.productId) === product.id);
    const open = rows.filter((bug) => bug.status !== 'closed');
    return {
      ...product,
      bugCount: rows.length,
      openBugs: open.length,
      severeOpen: open.filter((bug) => bug.severity === 'P0' || bug.severity === 'P1').length,
      openedByMe: rows.filter((bug) => bug.isMine).length,
      assignedToMe: rows.filter((bug) => bug.isAssignedToMe).length
    };
  });

  const projectGroups = projectRows.map((project) => {
    const rows = taskRows.filter((task) => task.project === project.name);
    return {
      ...project,
      taskCount: rows.length,
      openTasks: rows.filter((task) => task.status !== 'done').length,
      myTasks: rows.filter((task) => task.isMine).length,
      testTasks: rows.filter((task) => task.isTest).length
    };
  });

  const settings = store.getSettings();
  const profile = {
    name: testerName,
    account: config.tester.account,
    role: settings.profile.role,
    team: settings.profile.team,
    sprint: settings.profile.sprint,
    avatar: String(testerName).slice(0, 2)
  };
  const projectNames = projectRows.map((project) => project.name);
  const primaryId = primaryProductId(productRows);
  const primaryProduct = productRows.find((product) => product.id === primaryId) || {
    id: primaryId,
    name: '禅道产品'
  };

  const creation = {
    product: { id: primaryProduct.id, name: primaryProduct.name },
    products: productRows.map((product) => ({ id: product.id, name: product.name })),
    openedBuild: config.zentao.openedBuild,
    openedBuildLabel: config.zentao.openedBuildLabel,
    modules: (config.zentao.bugModules || []).map((module) => ({
      id: String(module.id),
      name: String(module.name)
    })),
    types: BUG_TYPE_OPTIONS,
    priorities: PRIORITY_OPTIONS,
    severities: SEVERITY_OPTIONS,
    users: Array.from(users.entries()).map(([account, name]) => ({ account, name })),
    projects: projectRows.map((project) => ({ id: project.id, name: project.name })),
    executions: executionRows.map((exec) => ({
      id: String(exec.id),
      name: String(exec.name || exec.id),
      projectId: String(exec.project),
      projectName: String(exec.projectName || '')
    }))
  };

  const sync = {
    lastSyncAt: new Date().toISOString(),
    durationMs: Date.now() - start,
    source: 'zentao-cli',
    account: config.tester.account,
    testerName,
    warnings: cleanWarnings(warnings),
    counts: {
      tasks: taskRows.length,
      myTasks: taskMine.length,
      testTasks: taskTests.length,
      bugs: bugs.length,
      myBugs: openedBugs.length,
      assignedBugs: assignedBugs.length,
      autojobBugs: autojobBugs.length,
      autojobOpen: autojobSummary.open,
      autojobClosed: autojobSummary.closed,
      products: productRows.length,
      projects: projectRows.length,
      executions: executionRows.length
    }
  };

  const zentao = {
    account: config.tester.account,
    testerName,
    cliVersion: version && version.cli ? String(version.cli) : 'zentao-cli',
    server: webUrl,
    serverVersion: String(config.zentao.serverVersion || ''),
    product: primaryProduct,
    products: bugGroups,
    projects: projectGroups,
    taskProjectIds: projectRows.map((project) => project.id),
    cacheSeconds: config.zentao.cacheSeconds,
    connection: currentConnection(webUrl),
    autojob: {
      enabled: Boolean(autojobResult.enabled),
      accounts: autojobResult.accounts || [],
      label: config.watch.label,
      scannedProducts: autojobResult.scannedProducts || 0,
      scannedAt: autojobResult.scannedAt || null
    }
  };

  const data = {
    app: { name: 'QDesk · 测试工作台', version: '2.1.0', mode: 'zentao' },
    tester: { account: config.tester.account, name: testerName },
    profile,
    settings,
    products: bugGroups,
    projects: projectNames.length ? projectNames : [],
    projectList: projectGroups,
    tasks: taskRows,
    bugs,
    bugStats: buildBugStats(bugs),
    bugScopeStats: {
      opened: buildBugStats(openedBugs),
      assigned: buildBugStats(assignedBugs),
      all: buildBugStats(bugs),
      autojob: buildBugStats(autojobBugs)
    },
    autojob: {
      enabled: Boolean(autojobResult.enabled),
      accounts: autojobResult.accounts || [],
      label: config.watch.label,
      description: config.watch.description,
      scannedProducts: autojobResult.scannedProducts || 0,
      scannedAt: autojobResult.scannedAt || null,
      summary: autojobSummary,
      bugs: autojobBugs
    },
    taskStats: {
      all: buildTaskStats(taskRows),
      mine: buildTaskStats(taskMine),
      test: buildTaskStats(taskTests)
    },
    scopeCounts: {
      bugs: {
        opened: openedBugs.length,
        assigned: assignedBugs.length,
        all: bugs.length,
        autojob: autojobBugs.length
      },
      tasks: {
        mine: taskMine.length,
        test: taskTests.length,
        all: taskRows.length
      }
    },
    reports: store.getReports(),
    creation,
    sync,
    zentao,
    generatedAt: sync.lastSyncAt
  };
  return data;
}

function currentSyncState() {
  const ttl = config.zentao.cacheSeconds * 1000;
  return {
    syncing: Boolean(snapshotInflight),
    startedAt: syncStartedAt ? new Date(syncStartedAt).toISOString() : null,
    source: syncSource,
    reason: syncReason,
    lastSyncAt: snapshot && snapshot.sync ? snapshot.sync.lastSyncAt : null,
    cacheAgeMs: snapshotAt ? Date.now() - snapshotAt : null,
    cacheSeconds: config.zentao.cacheSeconds,
    stale: !snapshot || Date.now() - snapshotAt >= ttl,
    schedule: config.zentao.syncTimes,
    scheduleText: syncScheduleText(),
    mode: config.zentao.syncIntervalMinutes > 0 ? 'interval' : 'times',
    intervalMinutes: config.zentao.syncIntervalMinutes,
    window: config.zentao.syncWindow,
    workdays: config.zentao.syncWorkdays,
    nextSyncAt: scheduledSyncAt().toISOString(),
    revision: snapshotRevision,
    lastError: lastConnectionError || null
  };
}

function mergeLocalTaskData(base) {
  const localTasks = store.getLocalTasks();
  if (!localTasks.length) return base;
  const tasks = localTasks.concat(base.tasks || []);
  const mine = tasks.filter((task) => task.isMine);
  const test = tasks.filter((task) => task.isTest);
  const projectList = (base.projectList || []).slice();
  const localGroup = {
    id: 'local-tasks',
    name: '本地任务',
    status: 'local',
    taskCount: localTasks.length,
    myTasks: localTasks.filter((task) => task.status !== 'done').length
  };
  const existing = projectList.findIndex((project) => project.name === '本地任务');
  if (existing >= 0) projectList[existing] = Object.assign({}, projectList[existing], localGroup);
  else projectList.push(localGroup);
  return {
    ...base,
    tasks,
    projectList,
    taskStats: {
      all: buildTaskStats(tasks),
      mine: buildTaskStats(mine),
      test: buildTaskStats(test)
    },
    scopeCounts: {
      ...(base.scopeCounts || {}),
      tasks: { mine: mine.length, test: test.length, all: tasks.length }
    }
  };
}

function hasTemplateReport(report) {
  if (!report || !report.content) return false;
  return ['version', 'bugsSummary', 'tasks', 'autojob']
    .some((key) => String(report.content[key] || '').trim());
}

function ensureDailyReport(data) {
  const day = localDate();
  const existing = store.getReports().find((report) => report.date === day);
  if (existing && existing.status === 'submitted') return existing;
  const legacyAuto = Boolean(existing)
    && !hasTemplateReport(existing)
    && /^今日完成 \d+ 项任务/.test(String(existing.content && existing.content.summary || ''));
  if (existing && !existing.autoGenerated && !legacyAuto) return existing;
  const report = Core.buildReport(data, day);
  if (existing && JSON.stringify(existing.content || {}) === JSON.stringify(report.content || {})) {
    return existing;
  }
  report.autoGenerated = true;
  report.autoUpdatedAt = new Date().toISOString();
  return store.upsertReport(report);
}

function reportDataFromSnapshot() {
  if (!snapshot) return null;
  const merged = mergeLocalTaskData(snapshot);
  const releasePlans = store.getReleasePlans();
  const releases = Core.releaseCatalog({
    tasks: merged.tasks || [],
    bugs: merged.bugs || []
  }, releasePlans);
  return {
    ...merged,
    releasePlans,
    releases
  };
}

function refreshDailyReport() {
  const data = reportDataFromSnapshot();
  if (!data) return null;
  return ensureDailyReport(data);
}

function decorateSnapshot(base) {
  const latest = store.snapshot();
  const settings = latest.settings;
  const releasePlans = latest.releasePlans || store.getReleasePlans();
  const merged = mergeLocalTaskData(base);
  const releases = Core.releaseCatalog({ tasks: merged.tasks || [], bugs: merged.bugs || [] }, releasePlans);
  const profile = {
    ...base.profile,
    role: settings.profile.role,
    team: settings.profile.team,
    sprint: settings.profile.sprint
  };
  const zentao = base.zentao || {};
  const decorated = {
    ...merged,
    settings,
    profile,
    reports: latest.reports,
    releasePlans,
    releases,
    products: base.products || [],
    projectList: merged.projectList || [],
    projects: base.projects || [],
    zentao: {
      ...zentao,
      connection: currentConnection(zentao.server || '')
    },
    syncState: currentSyncState()
  };
  ensureDailyReport(decorated);
  decorated.reports = store.getReports();
  return decorated;
}

function emptySnapshot() {
  const settings = store.getSettings();
  const account = config.tester.account;
  const testerName = config.tester.name || account || '测试工程师';
  const product = {
    id: String(config.zentao.productId || ''),
    name: '禅道产品'
  };
  const emptyStats = buildBugStats([]);
  return mergeLocalTaskData({
    app: { name: 'QDesk · 测试工作台', version: '2.1.0', mode: 'zentao' },
    tester: { account, name: testerName },
    profile: {
      name: testerName,
      account,
      role: settings.profile.role,
      team: settings.profile.team,
      sprint: settings.profile.sprint,
      avatar: String(testerName).slice(0, 2)
    },
    settings,
    products: [],
    projects: [],
    projectList: [],
    tasks: [],
    bugs: [],
    bugStats: emptyStats,
    bugScopeStats: { opened: emptyStats, assigned: emptyStats, all: emptyStats, autojob: emptyStats },
    autojob: {
      enabled: false,
      accounts: config.watch.autojobAccounts || [],
      label: config.watch.label,
      description: config.watch.description,
      scannedProducts: 0,
      scannedAt: null,
      summary: buildAutojobStats([], account),
      bugs: []
    },
    taskStats: { all: buildTaskStats([]), mine: buildTaskStats([]), test: buildTaskStats([]) },
    scopeCounts: {
      bugs: { opened: 0, assigned: 0, all: 0, autojob: 0 },
      tasks: { mine: 0, test: 0, all: 0 }
    },
    reports: store.getReports(),
    releasePlans: store.getReleasePlans(),
    releases: [],
    creation: {
      product,
      products: [],
      openedBuild: config.zentao.openedBuild,
      openedBuildLabel: config.zentao.openedBuildLabel,
      modules: (config.zentao.bugModules || []).map((module) => ({
        id: String(module.id),
        name: String(module.name)
      })),
      types: BUG_TYPE_OPTIONS,
      priorities: PRIORITY_OPTIONS,
      severities: SEVERITY_OPTIONS,
      projects: [],
      executions: []
    },
    sync: {
      lastSyncAt: null,
      durationMs: 0,
      source: 'zentao-cli',
      account,
      testerName,
      warnings: [],
      counts: {
        tasks: 0, myTasks: 0, testTasks: 0, bugs: 0, myBugs: 0, assignedBugs: 0,
        products: 0, projects: 0, executions: 0
      }
    },
    zentao: {
      account,
      testerName,
      cliVersion: 'zentao-cli',
      server: config.zentao.url || '',
      serverVersion: String(config.zentao.serverVersion || ''),
      product,
      products: [],
      projects: [],
      taskProjectIds: [],
      cacheSeconds: config.zentao.cacheSeconds,
      connection: currentConnection(config.zentao.url || ''),
      autojob: {
        enabled: false,
        accounts: config.watch.autojobAccounts || [],
        label: config.watch.label,
        scannedProducts: 0,
        scannedAt: null
      }
    },
    generatedAt: null
  });
}

const SYNC_TIMEOUT_MS = 15 * 60 * 1000;

function triggerSync(options) {
  const opts = options || {};
  if (snapshotInflight) return snapshotInflight;
  const epoch = snapshotEpoch;
  syncStartedAt = Date.now();
  syncSource = opts.reason || 'auto';
  syncReason = opts.reason || '';
  let task = null;
  let watchdogTimer = null;
  task = (async () => {
    const watchdog = new Promise((resolve, reject) => {
      watchdogTimer = setTimeout(() => {
        reject(new Error('后台同步超时（15 分钟），已中止本轮；将按计划重试。'));
      }, SYNC_TIMEOUT_MS);
      if (watchdogTimer.unref) watchdogTimer.unref();
    });
    try {
      const built = await Promise.race([buildSnapshot(Boolean(opts.force)), watchdog]);
      if (epoch === snapshotEpoch) {
        snapshot = built;
        snapshotAt = Date.now();
        snapshotRevision += 1;
        lastConnectionError = '';
        lastConnectionErrorCode = '';
        writeSnapshotCache({ snapshot: built, revision: snapshotRevision });
      }
      return snapshot ? decorateSnapshot(snapshot) : emptySnapshot();
    } catch (error) {
      if (epoch === snapshotEpoch) {
        lastConnectionError = String(error && error.message ? error.message : error);
        lastConnectionErrorCode = error && error.code ? String(error.code) : '';
      }
      console.error(`[QDesk] 后台同步失败（${syncSource}）：`, lastConnectionError);
      return snapshot ? decorateSnapshot(snapshot) : emptySnapshot();
    } finally {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      if (snapshotInflight === task) snapshotInflight = null;
      syncStartedAt = 0;
      scheduleNextSync();
    }
  })();
  snapshotInflight = task;
  return task;
}

function timeToMinutes(value) {
  const [hour, minute] = String(value || '').split(':').map(Number);
  return hour * 60 + minute;
}

function syncScheduleText() {
  const interval = config.zentao.syncIntervalMinutes;
  if (interval > 0) {
    const days = config.zentao.syncWorkdays || [];
    const workdayText = days.length === 7
      ? '每天'
      : days.length === 5 && days.every((day, index) => day === index + 1)
        ? '工作日'
        : `周${days.map((day) => '日一二三四五六'[day]).join('、')}`;
    return `${workdayText} ${config.zentao.syncWindow.start}–${config.zentao.syncWindow.end} 每 ${interval} 分钟自动全量 · 其余时间手动`;
  }
  const times = config.zentao.syncTimes && config.zentao.syncTimes.length
    ? config.zentao.syncTimes
    : DEFAULT_CONFIG.zentao.syncTimes;
  return `每天 ${times.join(' / ')} 自动全量 · 其余时间手动`;
}

function scheduledSyncAt(from) {
  const now = from instanceof Date ? new Date(from.getTime()) : new Date();
  const interval = config.zentao.syncIntervalMinutes;
  if (!(interval > 0)) {
    const times = config.zentao.syncTimes && config.zentao.syncTimes.length
      ? config.zentao.syncTimes
      : DEFAULT_CONFIG.zentao.syncTimes;
    for (let dayOffset = 0; dayOffset <= 1; dayOffset += 1) {
      for (const value of times) {
        const [hour, minute] = value.split(':').map(Number);
        const candidate = new Date(now.getTime());
        candidate.setDate(candidate.getDate() + dayOffset);
        candidate.setHours(hour, minute, 0, 0);
        if (candidate.getTime() > now.getTime()) return candidate;
      }
    }
    const fallback = new Date(now.getTime());
    fallback.setDate(fallback.getDate() + 1);
    fallback.setHours(8, 30, 0, 0);
    return fallback;
  }

  const start = timeToMinutes(config.zentao.syncWindow.start);
  const end = timeToMinutes(config.zentao.syncWindow.end);
  const workdays = config.zentao.syncWorkdays || DEFAULT_CONFIG.zentao.syncWorkdays;
  for (let dayOffset = 0; dayOffset <= 8; dayOffset += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, 0, 0, 0, 0);
    if (!workdays.includes(day.getDay())) continue;
    for (let minutes = start; minutes <= end; minutes += interval) {
      const candidate = new Date(day.getTime());
      candidate.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
      if (candidate.getTime() > now.getTime()) return candidate;
    }
  }
  const fallback = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  fallback.setHours(Math.floor(start / 60), start % 60, 0, 0);
  return fallback;
}

function scheduleNextSync(delayMs) {
  if (!schedulerStarted) return;
  if (nextSyncTimer) clearTimeout(nextSyncTimer);
  const delay = delayMs == null
    ? scheduledSyncAt().getTime() - Date.now()
    : delayMs;
  nextSyncTimer = setTimeout(() => {
    nextSyncTimer = null;
    triggerSync({ force: true, reason: 'scheduled' });
  }, Math.max(1000, delay));
  if (nextSyncTimer.unref) nextSyncTimer.unref();
}

let schedulerStarted = false;

function startSyncScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  if (!snapshot) {
    const bootTimer = setTimeout(() => {
      triggerSync({ reason: 'startup' });
    }, 600);
    if (bootTimer.unref) bootTimer.unref();
    return;
  }
  scheduleNextSync();
}

function getSnapshot(options) {
  const opts = options || {};
  if (!snapshot) {
    triggerSync({ reason: opts.reason || 'bootstrap' });
  } else if (opts.force) {
    triggerSync({ force: true, reason: opts.reason || 'manual' });
  }
  return snapshot ? decorateSnapshot(snapshot) : emptySnapshot();
}

loadSnapshotCache();

function scopeBugs(data, scope) {
  const value = ['opened', 'assigned', 'all', 'autojob'].includes(scope) ? scope : 'opened';
  if (value === 'all') return data.bugs;
  if (value === 'assigned') return data.bugs.filter((bug) => bug.isAssignedToMe);
  if (value === 'autojob') return data.autojob && Array.isArray(data.autojob.bugs) ? data.autojob.bugs : [];
  return data.bugs.filter((bug) => bug.isMine);
}

function scopeTasks(data, scope) {
  const value = ['mine', 'test', 'all'].includes(scope) ? scope : 'mine';
  if (value === 'all') return data.tasks;
  if (value === 'test') return data.tasks.filter((task) => task.isTest);
  return data.tasks.filter((task) => task.isMine);
}

function parseSeverityInput(value) {
  const raw = String(value == null ? '' : value).trim();
  if (/^P[0-3]$/i.test(raw)) return raw.toUpperCase();
  const number = Number(raw);
  if (Number.isInteger(number) && number >= 1 && number <= 4) return `P${number - 1}`;
  return '';
}

const BUG_RESOLUTIONS = new Set([
  'fixed', 'notrepro', 'bydesign', 'duplicate', 'external', 'postponed', 'willnotfix', 'tostory'
]);

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function normalizeBugFields(body) {
  const input = body || {};
  const fields = {};
  if (input.title !== undefined) {
    const title = String(input.title || '').trim();
    if (!title) throw badRequest('请填写 Bug 标题。');
    if (title.length > 180) throw badRequest('Bug 标题不能超过 180 个字符。');
    fields.title = title;
  }
  if (input.severity !== undefined) {
    const severity = parseSeverityInput(input.severity);
    if (!severity) throw badRequest('严重程度只能是 P0–P3。');
    fields.severity = severityRaw(severity);
  }
  if (input.pri !== undefined) {
    const priority = parseSeverityInput(input.pri);
    if (!priority) throw badRequest('优先级只能是 P0–P3。');
    fields.pri = Number(priority.slice(1)) + 1;
  }
  if (input.type !== undefined) {
    const type = String(input.type || '');
    if (!Object.prototype.hasOwnProperty.call(BUG_TYPES, type)) throw badRequest('Bug 类型无效。');
    fields.type = type;
  }
  if (input.openedBuild !== undefined) {
    const build = String(input.openedBuild || '').trim().slice(0, 120);
    fields.openedBuild = build || config.zentao.openedBuild || 'trunk';
  }
  if (input.steps !== undefined) {
    fields.steps = String(input.steps || '').slice(0, 200000);
  }
  if (input.project !== undefined) {
    const value = String(input.project || '0').trim();
    if (!/^\d{1,12}$/.test(value)) throw badRequest('所属项目 ID 无效。');
    fields.project = Number(value);
  }
  if (input.execution !== undefined) {
    const value = String(input.execution || '0').trim();
    if (!/^\d{1,12}$/.test(value)) throw badRequest('所属执行 ID 无效。');
    fields.execution = Number(value);
  }
  if (input.story !== undefined) {
    const value = String(input.story || '0').trim();
    if (!/^\d{1,12}$/.test(value)) throw badRequest('相关需求 ID 无效。');
    fields.story = Number(value);
  }
  if (input.assignedTo !== undefined) {
    const account = String(input.assignedTo || '').trim();
    if (account && !/^[A-Za-z0-9_.@-]{1,64}$/.test(account)) {
      throw badRequest('指派账号格式无效，请填写禅道登录账号。');
    }
    fields.assignedTo = account;
  }
  if (!Object.keys(fields).length) throw badRequest('没有需要更新的字段。');
  return fields;
}

function normalizeBugAction(action, body) {
  const input = body || {};
  const data = {
    comment: String(input.comment || '').slice(0, 4000)
  };
  const account = String(input.assignedTo || '').trim();
  if (account) {
    if (!/^[A-Za-z0-9_.@-]{1,64}$/.test(account)) {
      throw badRequest('指派账号格式无效，请填写禅道登录账号。');
    }
    data.assignedTo = account;
  }
  if (action === 'resolve') {
    const resolution = String(input.resolution || 'fixed');
    if (!BUG_RESOLUTIONS.has(resolution)) throw badRequest('解决方案无效。');
    data.resolution = resolution;
    const build = String(input.resolvedBuild || '').trim().slice(0, 120);
    data.resolvedBuild = build || config.zentao.openedBuild || 'trunk';
  }
  if (action === 'activate') {
    const build = String(input.openedBuild || '').trim().slice(0, 120);
    data.openedBuild = build || config.zentao.openedBuild || 'trunk';
  }
  if (action === 'confirm') {
    if (input.pri !== undefined && input.pri !== '') {
      const priority = parseSeverityInput(input.pri);
      if (!priority) throw badRequest('优先级只能是 P0–P3。');
      data.pri = Number(priority.slice(1)) + 1;
    }
    if (input.type !== undefined && input.type !== '') {
      if (!Object.prototype.hasOwnProperty.call(BUG_TYPES, input.type)) throw badRequest('Bug 类型无效。');
      data.type = String(input.type);
    }
    if (input.deadline) data.deadline = String(input.deadline).slice(0, 20);
  }
  return data;
}

function validateBugInput(body) {
  const input = body || {};
  const productId = String(input.productId || config.zentao.productId || '').trim();
  if (!/^\d{1,12}$/.test(productId)) {
    const error = new Error('请选择有效的禅道产品。');
    error.status = 400;
    throw error;
  }
  const knownProducts = snapshot && snapshot.creation && Array.isArray(snapshot.creation.products)
    ? snapshot.creation.products
    : [];
  if (knownProducts.length && !knownProducts.some((product) => String(product.id) === productId)) {
    const error = new Error('所选产品不在当前账号可访问的产品列表中。');
    error.status = 400;
    throw error;
  }
  const title = String(input.title || '').trim();
  if (!title) {
    const error = new Error('请填写 Bug 标题。');
    error.status = 400;
    throw error;
  }
  if (title.length > 180) {
    const error = new Error('Bug 标题不能超过 180 个字符。');
    error.status = 400;
    throw error;
  }
  const severity = parseSeverityInput(input.severity);
  if (!severity) {
    const error = new Error('严重程度只能是 P0–P3。');
    error.status = 400;
    throw error;
  }
  const priority = parseSeverityInput(input.pri);
  if (!priority) {
    const error = new Error('优先级只能是 P0–P3。');
    error.status = 400;
    throw error;
  }
  const type = String(input.type || 'codeerror');
  if (!Object.prototype.hasOwnProperty.call(BUG_TYPES, type)) {
    const error = new Error('Bug 类型无效。');
    error.status = 400;
    throw error;
  }
  const assignedTo = String(input.assignedTo || '').trim();
  if (assignedTo && !/^[A-Za-z0-9_.-]{1,40}$/.test(assignedTo)) {
    const error = new Error('指派账号格式无效，请填写禅道登录账号。');
    error.status = 400;
    throw error;
  }
  const projectId = String(input.projectId || '').trim();
  if (projectId && !/^\d+$/.test(projectId)) {
    const error = new Error('所属项目 ID 无效。');
    error.status = 400;
    throw error;
  }
  const executionId = String(input.executionId || '').trim();
  if (executionId && !/^\d+$/.test(executionId)) {
    const error = new Error('所属执行 ID 无效。');
    error.status = 400;
    throw error;
  }
  let steps = String(input.steps || '').trim().slice(0, 6000);
  const expected = String(input.expected || '').trim().slice(0, 3000);
  const actual = String(input.actual || '').trim().slice(0, 3000);
  if (expected) steps += `${steps ? '\n\n' : ''}**预期结果**\n${expected}`;
  if (actual) steps += `${steps ? '\n\n' : ''}**实际结果**\n${actual}`;
  return {
    productId,
    title,
    openedBuild: config.zentao.openedBuild,
    severity: severityRaw(severity),
    pri: Number(priority.slice(1)) + 1,
    type,
    steps,
    assignedTo,
    projectId: projectId || undefined,
    executionId: executionId || undefined
  };
}

function requestTimeout(ms) {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ms)
    : undefined;
}

function readCliProfileAuth() {
  try {
    const profilePath = path.join(os.homedir(), '.config', 'zentao', 'zentao.json');
    const parsed = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    const profiles = parsed && parsed.profiles && typeof parsed.profiles === 'object' ? parsed.profiles : {};
    const current = parsed && parsed.currentProfile ? profiles[parsed.currentProfile] : null;
    const profile = current || Object.values(profiles)[0];
    if (!profile || !profile.token || !profile.server) return null;
    return {
      url: String(profile.server).replace(/\/+$/, ''),
      account: String(profile.account || ''),
      token: String(profile.token)
    };
  } catch (error) {
    return null;
  }
}

async function getFileToken(force) {
  const now = Date.now();
  const expectedBase = auth && auth.url ? auth.url.replace(/\/+$/, '') : '';
  const expectedAccount = auth && auth.account ? auth.account : '';
  const cacheMatches = (!expectedBase || fileTokenCache.base === expectedBase)
    && (!expectedAccount || fileTokenCache.account === expectedAccount);
  if (!force && cacheMatches && fileTokenCache.token && fileTokenCache.expiresAt > now) {
    return { token: fileTokenCache.token, base: fileTokenCache.base };
  }
  let token = '';
  let base = '';
  let account = auth && auth.account ? auth.account : '';
  if (auth && auth.url && auth.password) {
    const response = await fetch(`${auth.url.replace(/\/+$/, '')}/api.php/v1/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ account: auth.account, password: auth.password }),
      signal: requestTimeout(15000)
    });
    if (response.ok) {
      const payload = await response.json().catch(() => null);
      if (payload && payload.token) {
        token = String(payload.token);
        base = auth.url.replace(/\/+$/, '');
      }
    }
  }
  if (!token) {
    const profile = readCliProfileAuth();
    if (profile) {
      token = profile.token;
      base = profile.url;
      account = account || profile.account;
    }
  }
  if (!token || !base) {
    const error = new Error('未找到可用的禅道登录凭证，无法读取附件。请先在「配置禅道连接」保存账号密码，或运行 zentao login。');
    error.status = 502;
    throw error;
  }
  fileTokenCache.token = token;
  fileTokenCache.base = base;
  fileTokenCache.account = account;
  fileTokenCache.expiresAt = now + 20 * 60 * 1000;
  return { token, base };
}

function sniffImageMime(buffer) {
  if (!buffer || buffer.length < 4) return '';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.slice(0, 6).toString('ascii') === 'GIF87a' || buffer.slice(0, 6).toString('ascii') === 'GIF89a') return 'image/gif';
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) return 'image/bmp';
  return '';
}

async function serveZentaoFile(req, res, fileId) {
  const id = String(fileId || '');
  if (!/^\d{1,12}$/.test(id)) {
    sendJson(res, 400, { ok: false, error: { message: '附件 ID 无效。' } });
    return;
  }
  let response = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const credentials = await getFileToken(attempt > 0);
    response = await fetch(`${credentials.base}/api.php/v1/files/${id}`, {
      headers: { Token: credentials.token, Accept: '*/*' },
      redirect: 'manual',
      signal: requestTimeout(30000)
    });
    if (response.status !== 401 && response.status !== 403 && response.status !== 302) break;
  }
  if (!response || !response.ok) {
    const status = response && response.status === 404 ? 404 : 502;
    sendJson(res, status, {
      ok: false,
      error: {
        message: response && response.status === 404
          ? '禅道中找不到该附件，可能已被删除。'
          : '读取禅道附件失败，请重新保存禅道连接或稍后重试。'
      }
    });
    return;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const mime = sniffImageMime(buffer);
  if (!mime) {
    sendJson(res, 415, { ok: false, error: { message: '该附件不是可预览的图片格式。' } });
    return;
  }
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': buffer.length,
    'Cache-Control': 'private, max-age=3600',
    'Content-Disposition': 'inline',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(buffer);
}

function createHttpServer() {
  return http.createServer(async (req, res) => {
    const requestStart = Date.now();
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    } catch (error) {
      sendJson(res, 400, { ok: false, error: { message: '请求地址无效。' } });
      return;
    }

    setSecurityHeaders(res);

    try {
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
        return;
      }
      serveStatic(req, res, url);
    } catch (error) {
      const status = error.status || (error instanceof ZentaoError ? 502 : 500);
      const message = error instanceof ZentaoError
        ? error.message
        : (status >= 500 ? '本地服务处理失败，请查看服务端日志。' : error.message);
      if (status >= 500) {
        console.error(`[QDesk] ${req.method} ${url.pathname} -> ${status} (${Date.now() - requestStart}ms):`, error.message);
        if (!(error instanceof ZentaoError)) console.error(error.stack);
      }
      sendJson(res, status, {
        ok: false,
        error: {
          message,
          code: error.code || 'INTERNAL_ERROR'
        }
      });
    }
  });
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'"
  );
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, status, text, type) {
  const body = String(text);
  res.writeHead(status, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function originAllowed(req) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return true;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return parsed.host === req.headers.host;
  } catch (error) {
    return false;
  }
}

function readJsonBody(req, limit) {
  const maxBytes = limit || 1024 * 1024;
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        const error = new Error('请求内容过大。');
        error.status = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          const error = new Error('请求体必须是 JSON 对象。');
          error.status = 400;
          reject(error);
          return;
        }
        resolve(parsed);
      } catch (error) {
        const invalid = new Error('请求体不是有效的 JSON。');
        invalid.status = 400;
        reject(invalid);
      }
    });
    req.on('error', reject);
  });
}

const PROBE_TIMEOUT_MS = 30000;

async function probeConnection(candidate) {
  const started = Date.now();
  const options = {
    ...cliOptions,
    env: credentialEnv(candidate, process.env),
    timeoutMs: 20000
  };
  let probeTimer = null;
  const deadline = new Promise((resolve, reject) => {
    probeTimer = setTimeout(() => {
      reject(new Error('连接测试超时（30 秒），请检查网络、禅道地址或账号密码后重试。'));
    }, PROBE_TIMEOUT_MS);
    if (probeTimer.unref) probeTimer.unref();
  });
  let version;
  let products;
  let projects;
  try {
    [version, products, projects] = await Promise.race([
      Promise.all([
        getVersion({ ...options, timeoutMs: 10000 }).catch(() => ({ cli: 'zentao-cli', server: '' })),
        listProducts(options),
        listProjects(options).catch(() => ({ items: [] }))
      ]),
      deadline
    ]);
  } finally {
    if (probeTimer) clearTimeout(probeTimer);
  }
  const productRows = products.items || [];
  if (!productRows.length) {
    throw new Error('连接成功，但当前账号没有可访问的产品。请确认账号权限。');
  }
  return {
    connected: true,
    url: String(version.server || candidate.url),
    account: candidate.account,
    cliVersion: String(version.cli || 'zentao-cli'),
    productCount: productRows.length,
    projectCount: (projects.items || []).length,
    products: productRows.slice(0, 10).map((product) => ({
      id: String(product.id),
      name: String(product.name || `产品 ${product.id}`)
    })),
    durationMs: Date.now() - started
  };
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  if (pathname === '/api/health' && req.method === 'GET') {
    const state = currentSyncState();
    sendJson(res, 200, {
      ok: true,
      ready: Boolean(snapshot),
      app: 'QDesk 测试工作台',
      mode: 'zentao',
      lastSyncAt: state.lastSyncAt,
      cacheAgeMs: state.cacheAgeMs,
      syncing: state.syncing,
      revision: state.revision,
      account: config.tester.account,
      productId: (snapshot && snapshot.zentao && snapshot.zentao.product && snapshot.zentao.product.id)
        || config.zentao.productId,
      productCount: snapshot ? (snapshot.products || []).length : 0,
      projectCount: snapshot ? (snapshot.projectList || []).length : 0,
      connection: currentConnection(snapshot && snapshot.zentao ? snapshot.zentao.server : ''),
      lastError: lastConnectionError || null,
      lastErrorCode: lastConnectionErrorCode || null
    });
    return;
  }

  if (pathname === '/api/connection' && req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      data: {
        connection: currentConnection(snapshot && snapshot.zentao ? snapshot.zentao.server : '')
      }
    });
    return;
  }

  if (pathname === '/api/zentao/test' && req.method === 'POST') {
    if (!originAllowed(req)) {
      sendJson(res, 403, { ok: false, error: { message: '请求来源无效。' } });
      return;
    }
    const body = await readJsonBody(req, 32 * 1024);
    const candidate = normalizeConnection(body, auth);
    try {
      const probe = await probeConnection(candidate);
      sendJson(res, 200, { ok: true, data: probe });
    } catch (error) {
      const message = sanitizeSecret(error.message, candidate.password);
      const failure = new Error(`连接测试失败：${message}`);
      failure.status = 400;
      throw failure;
    }
    return;
  }

  if (pathname === '/api/zentao/connection' && req.method === 'POST') {
    if (!originAllowed(req)) {
      sendJson(res, 403, { ok: false, error: { message: '请求来源无效。' } });
      return;
    }
    const body = await readJsonBody(req, 32 * 1024);
    const candidate = normalizeConnection(body, auth);
    let probe;
    try {
      probe = await probeConnection(candidate);
    } catch (error) {
      const message = sanitizeSecret(error.message, candidate.password);
      const failure = new Error(`连接测试失败，未保存：${message}`);
      failure.status = 400;
      throw failure;
    }
    writeAuth(AUTH_FILE, candidate);
    applySavedConnection(candidate);
    const data = getSnapshot({ force: true, reason: 'connection' });
    sendJson(res, 200, {
      ok: true,
      data: {
        connection: currentConnection(probe.server),
        probe,
        snapshot: data,
        warning: ''
      }
    });
    return;
  }

  if (pathname === '/api/bootstrap' && req.method === 'GET') {
    const refresh = url.searchParams.get('refresh') === '1' || url.searchParams.get('refresh') === 'true';
    if (url.searchParams.get('meta') === '1') {
      sendJson(res, 200, {
        ok: true,
        data: {
          syncState: currentSyncState(),
          counts: snapshot && snapshot.sync ? snapshot.sync.counts : null,
          generatedAt: snapshot ? snapshot.generatedAt : null
        }
      });
      return;
    }
    const data = getSnapshot({ force: refresh, reason: refresh ? 'refresh' : 'bootstrap' });
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (pathname === '/api/sync' && req.method === 'POST') {
    if (!originAllowed(req)) {
      sendJson(res, 403, { ok: false, error: { message: '请求来源无效。' } });
      return;
    }
    const started = !snapshotInflight;
    triggerSync({ force: true, reason: 'manual' });
    sendJson(res, 202, {
      ok: true,
      data: {
        started,
        syncState: currentSyncState()
      }
    });
    return;
  }

  if (pathname === '/api/bugs' && req.method === 'GET') {
    const data = await getSnapshot();
    const scope = url.searchParams.get('scope') || 'opened';
    const bugs = scopeBugs(data, scope);
    sendJson(res, 200, {
      ok: true,
      data: {
        scope,
        bugs,
        stats: buildBugStats(bugs)
      }
    });
    return;
  }

  if (pathname === '/api/bugs/stats' && req.method === 'GET') {
    const data = await getSnapshot();
    const scope = url.searchParams.get('scope') || 'opened';
    const bugs = scopeBugs(data, scope);
    sendJson(res, 200, {
      ok: true,
      data: {
        scope,
        stats: buildBugStats(bugs),
        counts: {
          opened: data.scopeCounts.bugs.opened,
          assigned: data.scopeCounts.bugs.assigned,
          all: data.scopeCounts.bugs.all,
          autojob: data.scopeCounts.bugs.autojob || 0
        }
      }
    });
    return;
  }

  if (pathname === '/api/bugs' && req.method === 'POST') {
    if (!originAllowed(req)) {
      sendJson(res, 403, { ok: false, error: { message: '请求来源无效。' } });
      return;
    }
    const body = await readJsonBody(req, 256 * 1024);
    const payload = validateBugInput(body);
    let result;
    try {
      result = await createBug(payload, cliOptions);
    } catch (error) {
      if (error instanceof ZentaoError) {
        error.message = `创建 Bug 失败：${error.message}`;
      }
      throw error;
    }
    const created = result && result.data && typeof result.data === 'object'
      ? result.data
      : (result && result.data != null ? { id: result.data } : {});
    const bugId = created.id || created.bugID || created.bugId || (created.bug && created.bug.id) || '';
    let incremental = false;
    if (bugId) {
      try {
        incremental = await refreshSnapshotBug(String(bugId));
      } catch (error) {
        console.error(`[QDesk] 单条 Bug 刷新失败（#${bugId}）：`, error.message);
      }
    }
    if (!incremental) triggerSync({ force: true, reason: 'bug-created' });
    sendJson(res, 201, {
      ok: true,
      data: {
        id: bugId ? String(bugId) : '',
        message: bugId
          ? (incremental ? `Bug #${bugId} 已创建并更新到本地数据。` : `Bug #${bugId} 已创建，正在从禅道重新同步。`)
          : 'Bug 已创建。',
        incremental,
        refreshRequired: !incremental
      }
    });
    return;
  }

  const bugEditMatch = pathname.match(/^\/api\/bugs\/(\d{1,12})$/);
  if (bugEditMatch && (req.method === 'PUT' || req.method === 'PATCH')) {
    if (!originAllowed(req)) {
      sendJson(res, 403, { ok: false, error: { message: '请求来源无效。' } });
      return;
    }
    const bugId = bugEditMatch[1];
    const body = await readJsonBody(req, 1024 * 1024);
    const fields = normalizeBugFields(body);
    try {
      await updateBug(bugId, fields, cliOptions);
    } catch (error) {
      if (error instanceof ZentaoError) error.message = `更新 Bug 失败：${error.message}`;
      throw error;
    }
    let incremental = false;
    try {
      incremental = await refreshSnapshotBug(bugId);
    } catch (error) {
      console.error(`[QDesk] 单条 Bug 刷新失败（#${bugId}）：`, error.message);
    }
    if (!incremental) triggerSync({ force: true, reason: 'bug-updated' });
    sendJson(res, 200, {
      ok: true,
      data: {
        id: bugId,
        message: incremental
          ? `Bug #${bugId} 已更新。`
          : `Bug #${bugId} 已更新，正在从禅道重新同步。`,
        incremental,
        refreshRequired: !incremental
      }
    });
    return;
  }

  const bugRefreshMatch = pathname.match(/^\/api\/bugs\/(\d{1,12})\/refresh$/);
  if (bugRefreshMatch && req.method === 'POST') {
    if (!originAllowed(req)) {
      sendJson(res, 403, { ok: false, error: { message: '请求来源无效。' } });
      return;
    }
    const bugId = bugRefreshMatch[1];
    const refreshed = await refreshSnapshotBug(bugId);
    if (!refreshed) {
      triggerSync({ force: true, reason: 'bug-refresh' });
      sendJson(res, 202, {
        ok: true,
        data: {
          id: bugId,
          action: 'refresh',
          message: '本地快照尚未就绪，已开始初始化同步。',
          incremental: false,
          refreshRequired: true
        }
      });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      data: {
        id: bugId,
        action: 'refresh',
        message: `Bug #${bugId} 已更新。`,
        incremental: true,
        refreshRequired: false,
        autojobSummary: snapshot && snapshot.autojob ? snapshot.autojob.summary : null
      }
    });
    return;
  }

  const bugActionMatch = pathname.match(/^\/api\/bugs\/(\d{1,12})\/(resolve|close|activate|confirm|delete|assign)$/);
  if (bugActionMatch && req.method === 'POST') {
    if (!originAllowed(req)) {
      sendJson(res, 403, { ok: false, error: { message: '请求来源无效。' } });
      return;
    }
    const bugId = bugActionMatch[1];
    const action = bugActionMatch[2];
    const body = await readJsonBody(req, 256 * 1024);
    try {
      if (action === 'assign') {
        const account = String(body.assignedTo || '').trim();
        if (!/^[A-Za-z0-9_.@-]{1,64}$/.test(account)) {
          throw badRequest('请选择要指派的禅道账号。');
        }
        await updateBug(bugId, { assignedTo: account }, cliOptions);
      } else {
        await bugAction(action, bugId, normalizeBugAction(action, body), cliOptions);
      }
    } catch (error) {
      if (error instanceof ZentaoError) {
        const verb = action === 'resolve' ? '解决' : action === 'close' ? '关闭' : action === 'activate' ? '激活' : action === 'confirm' ? '确认' : '指派';
        const prefix = action === 'delete' ? '删除 Bug 失败：' : `${verb} Bug 失败：`;
        error.message = `${prefix}${error.message}`;
      }
      throw error;
    }
    let incremental = false;
    if (action === 'delete') {
      incremental = removeBugFromSnapshot(bugId);
    } else {
      const expectedStatus = {
        resolve: 'resolved',
        close: 'closed',
        activate: 'active',
        confirm: 'active'
      }[action];
      try {
        incremental = await refreshSnapshotBug(bugId, expectedStatus);
      } catch (error) {
        console.error(`[QDesk] 单条 Bug 刷新失败（#${bugId}）：`, error.message);
      }
    }
    if (!incremental) triggerSync({ force: true, reason: `bug-${action}` });
    const actionLabels = {
      resolve: '标记为解决',
      close: '关闭',
      activate: '激活',
      confirm: '确认',
      assign: '指派',
      delete: '删除'
    };
    sendJson(res, 200, {
      ok: true,
      data: {
        id: bugId,
        action,
        message: incremental
          ? `Bug #${bugId} 已${actionLabels[action]}。`
          : `Bug #${bugId} 已${actionLabels[action]}，正在从禅道重新同步。`,
        incremental,
        refreshRequired: !incremental
      }
    });
    return;
  }

  if (pathname === '/api/tasks' && req.method === 'GET') {
    const data = await getSnapshot();
    const scope = url.searchParams.get('scope') || 'mine';
    const tasks = scopeTasks(data, scope);
    sendJson(res, 200, {
      ok: true,
      data: {
        scope,
        tasks,
        stats: buildTaskStats(tasks)
      }
    });
    return;
  }

  if (pathname === '/api/tasks' && req.method === 'POST') {
    if (!originAllowed(req)) {
      sendJson(res, 403, { ok: false, error: { message: '请求来源无效。' } });
      return;
    }
    const body = await readJsonBody(req, 64 * 1024);
    const task = store.createLocalTask(body);
    snapshotRevision += 1;
    refreshDailyReport();
    sendJson(res, 200, { ok: true, data: { task, revision: snapshotRevision } });
    return;
  }

  const localTaskMatch = pathname.match(/^\/api\/tasks\/(LT-\d{1,12})$/);
  if (localTaskMatch && req.method === 'PATCH') {
    if (!originAllowed(req)) {
      sendJson(res, 403, { ok: false, error: { message: '请求来源无效。' } });
      return;
    }
    const body = await readJsonBody(req, 64 * 1024);
    const task = store.updateLocalTask(localTaskMatch[1], body);
    snapshotRevision += 1;
    refreshDailyReport();
    sendJson(res, 200, { ok: true, data: { task, revision: snapshotRevision } });
    return;
  }

  if (localTaskMatch && req.method === 'DELETE') {
    if (!originAllowed(req)) {
      sendJson(res, 403, { ok: false, error: { message: '请求来源无效。' } });
      return;
    }
    store.deleteLocalTask(localTaskMatch[1]);
    snapshotRevision += 1;
    refreshDailyReport();
    sendJson(res, 200, { ok: true, data: { removed: true, revision: snapshotRevision } });
    return;
  }

  if (pathname === '/api/releases' && req.method === 'GET') {
    const releasePlans = store.getReleasePlans();
    const data = await getSnapshot();
    const releases = Core.releaseCatalog({
      tasks: data.tasks || [],
      bugs: data.bugs || []
    }, releasePlans);
    sendJson(res, 200, { ok: true, data: { releases, releasePlans } });
    return;
  }

  if (pathname === '/api/releases' && req.method === 'POST') {
    if (!originAllowed(req)) {
      sendJson(res, 403, { ok: false, error: { message: '请求来源无效。' } });
      return;
    }
    const body = await readJsonBody(req, 64 * 1024);
    const plan = store.updateReleasePlan(body);
    snapshotRevision += 1;
    refreshDailyReport();
    const releasePlans = store.getReleasePlans();
    const releases = Core.releaseCatalog({
      tasks: snapshot ? snapshot.tasks || [] : [],
      bugs: snapshot ? snapshot.bugs || [] : []
    }, releasePlans);
    sendJson(res, 200, { ok: true, data: { plan, releases, releasePlans, revision: snapshotRevision } });
    return;
  }

  if (pathname === '/api/reports' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, data: { reports: store.getReports() } });
    return;
  }

  if (pathname === '/api/reports' && req.method === 'POST') {
    if (!originAllowed(req)) {
      sendJson(res, 403, { ok: false, error: { message: '请求来源无效。' } });
      return;
    }
    const body = await readJsonBody(req, 512 * 1024);
    const report = store.upsertReport(body);
    sendJson(res, 200, { ok: true, data: { report } });
    return;
  }

  if (pathname === '/api/settings' && req.method === 'POST') {
    if (!originAllowed(req)) {
      sendJson(res, 403, { ok: false, error: { message: '请求来源无效。' } });
      return;
    }
    const body = await readJsonBody(req, 64 * 1024);
    const settings = store.updateSettings(body);
    sendJson(res, 200, { ok: true, data: { settings } });
    return;
  }

  const fileMatch = pathname.match(/^\/api\/zentao\/file\/(\d{1,12})$/);
  if (fileMatch && req.method === 'GET') {
    try {
      await serveZentaoFile(req, res, fileMatch[1]);
    } catch (error) {
      console.error('[QDesk] 读取禅道附件失败：', error.message);
      if (!res.headersSent) {
        sendJson(res, 502, {
          ok: false,
          error: { message: '读取禅道附件失败，请检查网络或重新保存禅道连接。' }
        });
      }
    }
    return;
  }
  if (pathname === '/api/zentao/file' && req.method === 'GET') {
    try {
      await serveZentaoFile(req, res, url.searchParams.get('id') || url.searchParams.get('fileID'));
    } catch (error) {
      console.error('[QDesk] 读取禅道附件失败：', error.message);
      if (!res.headersSent) {
        sendJson(res, 502, {
          ok: false,
          error: { message: '读取禅道附件失败，请检查网络或重新保存禅道连接。' }
        });
      }
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: { message: '接口不存在。' } });
}

function serveStatic(req, res, url) {
  if (!['GET', 'HEAD'].includes(req.method)) {
    sendJson(res, 405, { ok: false, error: { message: 'Method not allowed' } });
    return;
  }
  const entry = STATIC_FILES.get(url.pathname);
  if (!entry) {
    if (url.pathname.startsWith('/assets/')) {
      sendJson(res, 404, { ok: false, error: { message: '文件不存在。' } });
      return;
    }
    sendText(res, 404, 'Not found');
    return;
  }
  const filePath = path.join(ROOT, entry.file);
  let content;
  try {
    content = fs.readFileSync(filePath);
  } catch (error) {
    sendText(res, 404, 'Not found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': entry.type,
    'Cache-Control': 'no-store',
    'Content-Length': content.length
  });
  if (req.method === 'HEAD') res.end();
  else res.end(content);
}

function start() {
  const server = createHttpServer();
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`端口 ${config.server.port} 已被占用。请关闭占用该端口的程序，或修改 config.json 中的 server.port。`);
    } else {
      console.error('QDesk 服务启动失败：', error.message);
    }
    process.exitCode = 1;
  });
  server.listen(config.server.port, config.server.host, () => {
    console.log('');
    console.log('  QDesk · 测试工作台');
    console.log(`  本地地址: http://${config.server.host === '0.0.0.0' ? '127.0.0.1' : config.server.host}:${config.server.port}`);
    console.log(`  禅道账号: ${config.tester.account}（同步读取；Bug 创建、编辑与状态流转通过 CLI 写入）`);
    console.log(`  同步范围: 账号可访问的全部产品与项目 · ${syncScheduleText()}（本地时间）`);
    if (snapshot) {
      console.log(`  已载入缓存: ${snapshot.sync ? snapshot.sync.lastSyncAt : '未知时间'}`);
    } else {
      console.log('  暂无缓存，将在后台执行首次同步。');
    }
    console.log('  按 Ctrl+C 停止服务。');
    console.log('');
    startSyncScheduler();
  });
  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return server;
}

if (require.main === module) {
  start();
}

module.exports = {
  config,
  store,
  createHttpServer,
  start,
  getSnapshot,
  buildSnapshot,
  triggerSync,
  scheduledSyncAt,
  syncScheduleText,
  refreshSnapshotBug,
  applyBugToSnapshot,
  removeBugFromSnapshot,
  currentSyncState,
  emptySnapshot,
  loadSnapshotCache,
  validateBugInput,
  scopeBugs,
  scopeTasks,
  parseSeverityInput,
  compareTask,
  compareBug,
  VIEWS
};
