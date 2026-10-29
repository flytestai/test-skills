'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  validateBugInput,
  parseSeverityInput,
  scopeBugs,
  scopeTasks,
  createHttpServer,
  scheduledSyncAt,
  syncScheduleText,
  config
} = require('../server');
const {
  Store,
  normalizeReport,
  normalizeSettings,
  defaultData
} = require('../lib/store');

function formatLocal(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

test('scheduledSyncAt runs every 30 minutes on workdays inside the configured window', () => {
  const saved = {
    syncIntervalMinutes: config.zentao.syncIntervalMinutes,
    syncWindow: config.zentao.syncWindow,
    syncWorkdays: config.zentao.syncWorkdays
  };
  config.zentao.syncIntervalMinutes = 30;
  config.zentao.syncWindow = { start: '08:30', end: '18:00' };
  config.zentao.syncWorkdays = [1, 2, 3, 4, 5];
  try {
    const next = (month, day, hour, minute) =>
      formatLocal(scheduledSyncAt(new Date(2026, month - 1, day, hour, minute, 0, 0)));
    assert.equal(next(10, 26, 8, 10), '2026-10-26 08:30');
    assert.equal(next(10, 26, 8, 30), '2026-10-26 09:00');
    assert.equal(next(10, 26, 12, 7), '2026-10-26 12:30');
    assert.equal(next(10, 26, 17, 59), '2026-10-26 18:00');
    assert.equal(next(10, 26, 18, 0), '2026-10-27 08:30');
    assert.equal(next(10, 30, 18, 30), '2026-11-02 08:30');
    assert.equal(next(10, 31, 10, 0), '2026-11-02 08:30');
    assert.equal(syncScheduleText(), '工作日 08:30–18:00 每 30 分钟自动全量 · 其余时间手动');
  } finally {
    Object.assign(config.zentao, saved);
  }
});

test('syncIntervalMinutes 0 falls back to the legacy fixed sync times', () => {
  const saved = {
    syncIntervalMinutes: config.zentao.syncIntervalMinutes,
    syncTimes: config.zentao.syncTimes
  };
  config.zentao.syncIntervalMinutes = 0;
  config.zentao.syncTimes = ['09:15', '17:45'];
  try {
    const at = (hour, minute) =>
      formatLocal(scheduledSyncAt(new Date(2026, 9, 26, hour, minute, 0, 0)));
    assert.equal(at(9, 0), '2026-10-26 09:15');
    assert.equal(at(9, 15), '2026-10-26 17:45');
    assert.equal(at(17, 45), '2026-10-27 09:15');
    assert.equal(syncScheduleText(), '每天 09:15 / 17:45 自动全量 · 其余时间手动');
  } finally {
    Object.assign(config.zentao, saved);
  }
});

function withTempStore(fn) {
  const dir = fs.mkdtempSync(path.join(__dirname, '.tmp-store-'));
  const file = path.join(dir, 'app-data.json');
  try {
    return fn(new Store(file), file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('validateBugInput accepts a complete payload and normalizes severity', () => {
  const payload = validateBugInput({
    title: '  【快速选股】保存后条件丢失  ',
    severity: 'P0',
    pri: 'P2',
    type: 'codeerror',
    assignedTo: 'dev01',
    productId: '101',
    projectId: '47',
    executionId: '245',
    steps: '1. 打开快速选股\n2. 保存条件单',
    expected: '条件保留',
    actual: '刷新后丢失'
  });
  assert.equal(payload.productId, '101');
  assert.equal(payload.title, '【快速选股】保存后条件丢失');
  assert.equal(payload.openedBuild, 'trunk');
  assert.equal(payload.severity, 1);
  assert.equal(payload.pri, 3);
  assert.equal(payload.type, 'codeerror');
  assert.equal(payload.assignedTo, 'dev01');
  assert.equal(payload.projectId, '47');
  assert.equal(payload.executionId, '245');
  assert.match(payload.steps, /^1\. 打开快速选股/);
  assert.match(payload.steps, /\*\*预期结果\*\*\n条件保留/);
  assert.match(payload.steps, /\*\*实际结果\*\*\n刷新后丢失/);
});

test('validateBugInput accepts numeric severity and omits empty associations', () => {
  const payload = validateBugInput({
    productId: '101',
    title: '普通 Bug',
    severity: '1',
    pri: '3',
    type: 'others'
  });
  assert.equal(payload.severity, 1);
  assert.equal(payload.pri, 3);
  assert.equal(payload.projectId, undefined);
  assert.equal(payload.executionId, undefined);
  assert.equal(payload.assignedTo, '');
  assert.equal(payload.steps, '');
});

test('validateBugInput rejects invalid fields before any CLI write', () => {
  const base = { productId: '101' };
  const cases = [
    [base, /标题/],
    [{ ...base, title: 'x'.repeat(181) }, /180/],
    [{ ...base, title: 'x', severity: '5' }, /P0–P3/],
    [{ ...base, title: 'x', severity: 'P0', pri: 'P9' }, /优先级/],
    [{ ...base, title: 'x', severity: 'P0', pri: 'P1', type: 'unknown' }, /类型/],
    [{ ...base, title: 'x', severity: 'P0', pri: 'P1', assignedTo: 'bad account' }, /账号/],
    [{ ...base, title: 'x', severity: 'P0', pri: 'P1', projectId: '47abc' }, /项目/],
    [{ ...base, title: 'x', severity: 'P0', pri: 'P1', executionId: '2.5' }, /执行/]
  ];
  cases.forEach(([input, pattern]) => {
    assert.throws(() => validateBugInput(input), (error) => {
      assert.equal(error.status, 400);
      assert.match(error.message, pattern);
      return true;
    });
  });
});

test('parseSeverityInput supports P labels and raw priorities', () => {
  assert.equal(parseSeverityInput('P0'), 'P0');
  assert.equal(parseSeverityInput('p3'), 'P3');
  assert.equal(parseSeverityInput('1'), 'P0');
  assert.equal(parseSeverityInput('4'), 'P3');
  assert.equal(parseSeverityInput('0'), '');
  assert.equal(parseSeverityInput('P4'), '');
  assert.equal(parseSeverityInput(''), '');
});

test('scope filters keep Bug and task counts consistent', () => {
  const bugs = [
    { id: '1', isMine: true, isAssignedToMe: false },
    { id: '2', isMine: false, isAssignedToMe: true },
    { id: '3', isMine: false, isAssignedToMe: false }
  ];
  assert.deepEqual(scopeBugs({ bugs }, 'opened').map((bug) => bug.id), ['1']);
  assert.deepEqual(scopeBugs({ bugs }, 'assigned').map((bug) => bug.id), ['2']);
  assert.equal(scopeBugs({ bugs }, 'all').length, 3);
  assert.equal(scopeBugs({ bugs }, 'invalid').length, 1);

  const tasks = [
    { id: '1', isMine: true, isTest: true },
    { id: '2', isMine: false, isTest: true },
    { id: '3', isMine: true, isTest: false }
  ];
  assert.deepEqual(scopeTasks({ tasks }, 'mine').map((task) => task.id), ['1', '3']);
  assert.deepEqual(scopeTasks({ tasks }, 'test').map((task) => task.id), ['1', '2']);
  assert.equal(scopeTasks({ tasks }, 'all').length, 3);
  assert.equal(scopeTasks({ tasks }, 'invalid').length, 2);
});

test('normalizeReport validates date and preserves allowed content', () => {
  assert.throws(() => normalizeReport({ content: {} }), (error) => {
    assert.equal(error.status, 400);
    return true;
  });
  const report = normalizeReport({
    date: '2026-10-26',
    status: 'submitted',
    content: {
      summary: '完成回归',
      done: '任务 A',
      bugs: '验证 #1',
      ongoing: '任务 B',
      next: '继续回归',
      risks: '无',
      ignored: '不应保存'
    }
  });
  assert.equal(report.id, 'R-2026-10-26');
  assert.equal(report.status, 'submitted');
  assert.equal(report.content.summary, '完成回归');
  assert.equal(report.content.risks, '无');
  assert.equal(Object.prototype.hasOwnProperty.call(report.content, 'ignored'), false);
  assert.ok(report.submittedAt);
});

test('Store persists one report per date and updates the existing report', () => {
  withTempStore((store, file) => {
    const first = store.upsertReport({
      date: '2026-10-26',
      status: 'draft',
      content: { summary: '初稿' }
    });
    assert.equal(first.status, 'draft');
    const second = store.upsertReport({
      date: '2026-10-26',
      status: 'submitted',
      content: { summary: '提交版', done: '完成 A' }
    });
    assert.equal(second.id, first.id);
    assert.equal(store.getReports().length, 1);
    assert.equal(store.getReports()[0].content.summary, '提交版');
    assert.equal(store.getReports()[0].status, 'submitted');

    const reloaded = new Store(file);
    assert.equal(reloaded.getReports().length, 1);
    assert.equal(reloaded.getReports()[0].status, 'submitted');
    assert.equal(reloaded.getReports()[0].content.done, '完成 A');
  });
});

test('Store normalizes settings and rejects invalid scope preferences', () => {
  withTempStore((store) => {
    const saved = store.updateSettings({
      profile: { role: ' 高级测试工程师 ', team: '', sprint: 'PC 客户端' },
      preferences: { taskView: 'list', taskScope: 'invalid', bugScope: 'all' }
    });
    assert.equal(saved.profile.role, '高级测试工程师');
    assert.equal(saved.profile.team, '质量保障组');
    assert.equal(saved.preferences.taskView, 'list');
    assert.equal(saved.preferences.taskScope, 'mine');
    assert.equal(saved.preferences.bugScope, 'all');

    const defaults = normalizeSettings({});
    assert.equal(defaults.preferences.taskView, 'board');
    assert.equal(defaults.profile.role, '测试工程师');
    assert.equal(defaultData().version, 2);
  });
});

test('Store persists release test windows and rejects invalid ranges', () => {
  withTempStore((store, file) => {
    const saved = store.updateReleasePlan({
      key: '9.9.0',
      name: 'PC 9.9.0',
      testStart: '2026-10-01T09:00',
      testEnd: '2026-10-03T18:00'
    });
    assert.equal(saved.key, '9.9.0');
    assert.equal(saved.testStart, '2026-10-01T09:00');
    assert.equal(saved.testEnd, '2026-10-03T18:00');

    const reloaded = new Store(file);
    assert.equal(reloaded.getReleasePlans()['9.9.0'].testEnd, '2026-10-03T18:00');
    assert.equal(reloaded.snapshot().releasePlans['9.9.0'].name, 'PC 9.9.0');

    assert.throws(
      () => store.updateReleasePlan({ key: '9.9.0', testStart: '2026-10-03T18:00', testEnd: '2026-10-01T09:00' }),
      /测试结束时间不能早于开始时间/
    );
    assert.throws(() => store.updateReleasePlan({ key: 'bad key!' }), /版本标识无效/);

    store.updateReleasePlan({ key: '9.9.0', testStart: '', testEnd: '' });
    assert.equal(store.getReleasePlans()['9.9.0'], undefined);
    assert.equal(new Store(file).getReleasePlans()['9.9.0'], undefined);
  });
});

test('HTTP service exposes only whitelisted static files and safe health data', async () => {
  const server = createHttpServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    const healthBody = await health.json();
    assert.equal(healthBody.ok, true);
    assert.equal(typeof healthBody.account, 'string');
    assert.equal(typeof healthBody.productId, 'string');
    assert.match(health.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(health.headers.get('x-frame-options'), 'DENY');

    const index = await fetch(`${base}/`);
    assert.equal(index.status, 200);
    assert.match(await index.text(), /QDesk/);

    const config = await fetch(`${base}/config.json`);
    assert.equal(config.status, 404);
    const data = await fetch(`${base}/data/app-data.json`);
    assert.equal(data.status, 404);
    const backend = await fetch(`${base}/server.js`);
    assert.equal(backend.status, 404);

    const invalidBug = await fetch(`${base}/api/bugs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: base
      },
      body: JSON.stringify({ productId: '101' })
    });
    assert.equal(invalidBug.status, 400);
    const invalidBody = await invalidBug.json();
    assert.equal(invalidBody.ok, false);
    assert.match(invalidBody.error.message, /标题/);

    const crossOrigin = await fetch(`${base}/api/sync`, {
      method: 'POST',
      headers: { Origin: 'https://example.com' }
    });
    assert.equal(crossOrigin.status, 403);

    const missing = await fetch(`${base}/api/unknown`);
    assert.equal(missing.status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
