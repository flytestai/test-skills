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
  scheduledSyncAt,
  createHttpServer
} = require('../server');
const {
  Store,
  normalizeReport,
  normalizeSettings,
  defaultData
} = require('../lib/store');

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

test('scheduledSyncAt picks the next daily sync slot', () => {
  const morning = scheduledSyncAt(new Date(2026, 9, 29, 8, 0, 0));
  assert.equal(morning.getHours(), 8);
  assert.equal(morning.getMinutes(), 30);

  const noon = scheduledSyncAt(new Date(2026, 9, 29, 9, 30, 0));
  assert.equal(noon.getHours(), 12);
  assert.equal(noon.getMinutes(), 0);

  const evening = scheduledSyncAt(new Date(2026, 9, 29, 18, 0, 0));
  assert.equal(evening.getDate(), 30);
  assert.equal(evening.getHours(), 8);
  assert.equal(evening.getMinutes(), 30);
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
