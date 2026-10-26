'use strict';

const http = require('node:http');
const fs = require('node:fs');
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
  createBug
} = require('./lib/zentao');
const {
  BUG_TYPES,
  normalizeTask,
  normalizeBug,
  buildBugStats,
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
    refreshCooldownMs: 5000,
    cliPath: '',
    moduleNames: {},
    bugModules: [{ id: '0', name: '未指定' }]
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
  config.server.port = Math.max(1, Math.min(65535, Number(config.server.port) || 4173));
  config.server.host = config.server.host || '127.0.0.1';
  config.tester.account = String(config.tester.account || '').trim();
  config.tester.name = String(config.tester.name || config.tester.account || '').trim();
  config.zentao.productId = String(config.zentao.productId || '').trim();
  config.zentao.taskProjectIds = (config.zentao.taskProjectIds || [])
    .map((id) => String(id)).filter((id) => /^\d+$/.test(id));
  config.zentao.cacheSeconds = Math.max(60, Number(config.zentao.cacheSeconds) || 300);
  config.zentao.refreshCooldownMs = Math.max(0, Number(config.zentao.refreshCooldownMs) || 0);
  config.zentao.openedBuild = String(config.zentao.openedBuild || 'trunk');
  config.zentao.openedBuildLabel = String(config.zentao.openedBuildLabel || '主干');
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

const caches = {
  version: { at: 0, ttl: 10 * 60 * 1000, value: null },
  users: { at: 0, ttl: 60 * 60 * 1000, value: null },
  products: { at: 0, ttl: 10 * 60 * 1000, value: null },
  projects: { at: 0, ttl: 10 * 60 * 1000, value: null },
  executions: { at: 0, ttl: 10 * 60 * 1000, value: null }
};

let snapshot = null;
let snapshotAt = 0;
let snapshotRevision = 0;
let snapshotInflight = null;
let snapshotEpoch = 0;
let lastConnectionError = '';
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
  if (nextSyncTimer) {
    clearTimeout(nextSyncTimer);
    nextSyncTimer = null;
  }
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

  const bugBundles = await mapLimit(productRows, 3, async (product) => {
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
      webUrl
    }));
    return { product, bugs, warnings: bundleWarnings };
  });

  const globalBugs = new Map();
  bugBundles.forEach((bundle) => {
    warnings.push(...bundle.warnings);
    bundle.bugs.forEach((bug) => globalBugs.set(String(bug.id), bug));
  });
  const bugs = Array.from(globalBugs.values()).sort(compareBug);

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
    connection: currentConnection(webUrl)
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
      all: buildBugStats(bugs)
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
        all: bugs.length
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
    revision: snapshotRevision,
    lastError: lastConnectionError || null
  };
}

function decorateSnapshot(base) {
  const latest = store.snapshot();
  const settings = latest.settings;
  const profile = {
    ...base.profile,
    role: settings.profile.role,
    team: settings.profile.team,
    sprint: settings.profile.sprint
  };
  const zentao = base.zentao || {};
  return {
    ...base,
    settings,
    profile,
    reports: latest.reports,
    products: base.products || [],
    projectList: base.projectList || [],
    projects: base.projects || [],
    zentao: {
      ...zentao,
      connection: currentConnection(zentao.server || '')
    },
    syncState: currentSyncState()
  };
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
  return {
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
    bugScopeStats: { opened: emptyStats, assigned: emptyStats, all: emptyStats },
    taskStats: { all: buildTaskStats([]), mine: buildTaskStats([]), test: buildTaskStats([]) },
    scopeCounts: {
      bugs: { opened: 0, assigned: 0, all: 0 },
      tasks: { mine: 0, test: 0, all: 0 }
    },
    reports: store.getReports(),
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
      connection: currentConnection(config.zentao.url || '')
    },
    generatedAt: null
  };
}

function triggerSync(options) {
  const opts = options || {};
  if (snapshotInflight) return snapshotInflight;
  const epoch = snapshotEpoch;
  syncStartedAt = Date.now();
  syncSource = opts.reason || 'auto';
  syncReason = opts.reason || '';
  let task = null;
  task = (async () => {
    try {
      const built = await buildSnapshot(Boolean(opts.force));
      if (epoch === snapshotEpoch) {
        snapshot = built;
        snapshotAt = Date.now();
        snapshotRevision += 1;
        lastConnectionError = '';
        writeSnapshotCache({ snapshot: built, revision: snapshotRevision });
      }
      return snapshot ? decorateSnapshot(snapshot) : emptySnapshot();
    } catch (error) {
      if (epoch === snapshotEpoch) lastConnectionError = String(error && error.message ? error.message : error);
      console.error(`[QDesk] 后台同步失败（${syncSource}）：`, lastConnectionError);
      return snapshot ? decorateSnapshot(snapshot) : emptySnapshot();
    } finally {
      if (snapshotInflight === task) snapshotInflight = null;
      syncStartedAt = 0;
      scheduleNextSync();
    }
  })();
  snapshotInflight = task;
  return task;
}

function scheduleNextSync(delayMs) {
  if (!schedulerStarted) return;
  if (nextSyncTimer) clearTimeout(nextSyncTimer);
  const delay = delayMs == null
    ? (lastConnectionError ? 60000 : config.zentao.cacheSeconds * 1000)
    : delayMs;
  nextSyncTimer = setTimeout(() => {
    nextSyncTimer = null;
    triggerSync({ reason: 'auto' });
  }, Math.max(1000, delay));
  if (nextSyncTimer.unref) nextSyncTimer.unref();
}

let schedulerStarted = false;

function startSyncScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  const ttl = config.zentao.cacheSeconds * 1000;
  const fresh = snapshot && Date.now() - snapshotAt < ttl;
  if (fresh) {
    scheduleNextSync();
    return;
  }
  const bootTimer = setTimeout(() => {
    triggerSync({ reason: snapshot ? 'auto' : 'startup' });
  }, 600);
  if (bootTimer.unref) bootTimer.unref();
}

function getSnapshot(options) {
  const opts = options || {};
  if (!snapshot) {
    triggerSync({ reason: opts.reason || 'bootstrap' });
  } else if (opts.force) {
    triggerSync({ force: true, reason: opts.reason || 'manual' });
  } else if (Date.now() - snapshotAt >= config.zentao.cacheSeconds * 1000) {
    triggerSync({ reason: 'stale' });
  }
  return snapshot ? decorateSnapshot(snapshot) : emptySnapshot();
}

loadSnapshotCache();

function scopeBugs(data, scope) {
  const value = ['opened', 'assigned', 'all'].includes(scope) ? scope : 'opened';
  if (value === 'all') return data.bugs;
  if (value === 'assigned') return data.bugs.filter((bug) => bug.isAssignedToMe);
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

async function probeConnection(candidate) {
  const started = Date.now();
  const options = {
    ...cliOptions,
    env: credentialEnv(candidate, process.env),
    timeoutMs: 90000
  };
  const [version, products, projects] = await Promise.all([
    getVersion({ ...options, timeoutMs: 30000 }).catch(() => ({ cli: 'zentao-cli', server: '' })),
    listProducts(options),
    listProjects(options).catch(() => ({ items: [] }))
  ]);
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
      lastError: lastConnectionError || null
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
          all: data.scopeCounts.bugs.all
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
    triggerSync({ force: true, reason: 'bug-created' });
    sendJson(res, 201, {
      ok: true,
      data: {
        id: bugId ? String(bugId) : '',
        message: bugId ? `Bug #${bugId} 已创建。` : 'Bug 已创建。',
        refreshRequired: true
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
    console.log(`  禅道账号: ${config.tester.account}（只读同步，Bug 创建除外）`);
    console.log(`  同步范围: 账号可访问的全部产品与项目 · 后台静默同步（${config.zentao.cacheSeconds}s）`);
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
