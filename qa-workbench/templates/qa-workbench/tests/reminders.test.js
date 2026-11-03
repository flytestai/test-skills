'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Reminders = require('../lib/reminders');
const { Store } = require('../lib/store');

const NOW = new Date('2026-11-02T09:30:00+08:00');
const ACCOUNT = 'weizhen';
const WEBHOOK = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcdefgh12345678';

function daysAgo(days, hours) {
  return new Date(NOW.getTime() - days * 86400000 - (hours || 0) * 3600000).toISOString();
}

function bug(overrides) {
  return Object.assign({
    id: '12021',
    title: '【自选股】点击清空品种后客户端闪退',
    status: 'new',
    rawStatus: 'active',
    statusLabel: '激活',
    severity: 'P1',
    version: '3.0.0',
    moduleId: '278',
    module: '模块 278',
    productId: '13',
    project: '新好人好股PC客户端',
    assignee: '孙涛',
    assigneeAccount: 'suntao',
    reporter: '卫珍',
    reporterAccount: ACCOUNT,
    isMine: true,
    isAssignedToMe: false,
    assignedAt: daysAgo(5),
    createdAt: daysAgo(8)
  }, overrides || {});
}

test('normalizeReminderConfig 校验 Webhook、阈值和提醒日期', () => {
  const config = Reminders.normalizeReminderConfig({
    enabled: true,
    webhookUrl: WEBHOOK,
    thresholdDays: 4,
    repeatDays: 5,
    scheduleTime: '10:15',
    weekdays: [1, 1, 3, 5],
    mentionMap: { suntao: 'SunTao' },
    productIds: ['13', '47', '13'],
    versions: ['3.0.0', '主干']
  }, null, { strict: true });
  assert.equal(config.enabled, true);
  assert.equal(config.webhookUrl, WEBHOOK);
  assert.equal(config.thresholdDays, 4);
  assert.equal(config.repeatDays, 5);
  assert.equal(config.scheduleTime, '10:15');
  assert.deepEqual(config.weekdays, [1, 3, 5]);
  assert.deepEqual(config.mentionMap, { suntao: 'SunTao' });
  assert.deepEqual(config.productIds, ['13', '47']);
  assert.deepEqual(config.versions, ['3.0.0', '主干']);
  assert.throws(
    () => Reminders.normalizeReminderConfig({ webhookUrl: 'https://example.com/send' }, null, { strict: true }),
    /企业微信官方群机器人/
  );
  assert.throws(
    () => Reminders.normalizeReminderConfig({ thresholdDays: 0 }, null, { strict: true }),
    /超期天数/
  );
  assert.throws(
    () => Reminders.normalizeReminderConfig({ productIds: ['bad id'] }, null, { strict: true }),
    /产品范围/
  );
  assert.throws(
    () => Reminders.normalizeReminderConfig({ repeatDays: 91 }, null, { strict: true }),
    /重复提醒间隔/
  );
  assert.throws(
    () => Reminders.normalizeReminderConfig({ repeatDays: -1 }, null, { strict: true }),
    /重复提醒间隔/
  );
  assert.equal(Reminders.normalizeReminderConfig({ repeatDays: 0 }, null, { strict: true }).repeatDays, 0);
  assert.equal(Reminders.normalizeReminderConfig({}, null, { strict: true }).repeatDays, 3);
});

test('normalizeReminderLastSent 只保留合法键和一年内的时间', () => {
  const recent = daysAgo(2);
  const old = new Date(Date.now() - 400 * 86400000).toISOString();
  const normalized = Reminders.normalizeReminderLastSent({
    'bug:12021:suntao': recent,
    'task:501:liming': recent,
    'bug:bad key:suntao': recent,
    'unknown:12021:suntao': recent,
    'bug:12023:suntao': old,
    'bug:12024:suntao': 'not-a-date'
  });
  assert.deepEqual(Object.keys(normalized).sort(), ['bug:12021:suntao', 'task:501:liming']);
  assert.equal(normalized['bug:12021:suntao'], new Date(recent).toISOString());
});

test('normalizeReminderJob 与 publicReminderJob 校验名称、标识并隐藏 Webhook', () => {
  const job = Reminders.normalizeReminderJob({
    name: '  3.0.0 超期提醒  ',
    webhookUrl: WEBHOOK,
    thresholdDays: 5,
    productIds: ['52'],
    versions: ['3.0.0']
  }, null, { strict: true });
  assert.equal(job.name, '3.0.0 超期提醒');
  assert.equal(job.id, '');
  assert.equal(job.thresholdDays, 5);
  assert.deepEqual(job.lastSent, {});
  assert.throws(
    () => Reminders.normalizeReminderJob({ id: 'bad-id' }, null, { strict: true }),
    /任务标识/
  );
  const publicJob = Reminders.publicReminderJob(Object.assign({}, job, { id: 'RJ-1' }));
  assert.equal(publicJob.id, 'RJ-1');
  assert.equal(publicJob.name, '3.0.0 超期提醒');
  assert.equal(publicJob.configured, true);
  assert.equal(Object.prototype.hasOwnProperty.call(publicJob, 'webhookUrl'), false);
  assert.match(publicJob.webhookMasked, /^https:\/\/qyapi\.weixin\.qq\.com\/.+key=\*+$/);
});

test('Store.markReminderItemsSent 按任务隔离并持久化上次提醒时间', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qdesk-reminder-'));
  try {
    const store = new Store(path.join(dir, 'app-data.json'));
    const first = store.createReminderJob({ name: '任务一', webhookUrl: WEBHOOK });
    const second = store.createReminderJob({ name: '任务二', webhookUrl: WEBHOOK });
    const at = '2026-11-02T01:00:00.000Z';
    store.markReminderItemsSent(first.id, [
      { reminderKey: 'bug:12021:suntao' },
      { reminderKey: 'task:501:suntao' },
      { reminderKey: '' },
      {}
    ], at);
    assert.deepEqual(store.getReminderLastSent(first.id), {
      'bug:12021:suntao': at,
      'task:501:suntao': at
    });
    assert.deepEqual(store.getReminderLastSent(second.id), {});
    const reloaded = new Store(path.join(dir, 'app-data.json'));
    assert.deepEqual(reloaded.getReminderLastSent(first.id), store.getReminderLastSent(first.id));
    assert.deepEqual(reloaded.getReminderLastSent(second.id), {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Store 支持创建、修改、删除多个定时任务并保留各自 Webhook', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qdesk-reminder-jobs-'));
  try {
    const file = path.join(dir, 'app-data.json');
    const store = new Store(file);
    const first = store.createReminderJob({
      name: '3.0.0 超期提醒',
      webhookUrl: WEBHOOK,
      thresholdDays: 3,
      productIds: ['52'],
      versions: ['3.0.0']
    });
    const second = store.createReminderJob({
      name: '全部产品周提醒',
      webhookUrl: WEBHOOK,
      thresholdDays: 7,
      repeatDays: 0
    });
    assert.equal(first.id, 'RJ-1');
    assert.equal(second.id, 'RJ-2');
    assert.deepEqual(store.getReminderJobs().map((job) => job.name), ['3.0.0 超期提醒', '全部产品周提醒']);

    const updated = store.updateReminderJob(second.id, { name: '全部产品周提醒（改）', thresholdDays: 10 });
    assert.equal(updated.id, 'RJ-2');
    assert.equal(updated.name, '全部产品周提醒（改）');
    assert.equal(updated.thresholdDays, 10);
    assert.equal(updated.webhookUrl, WEBHOOK);
    assert.deepEqual(updated.productIds, []);
    assert.deepEqual(store.getReminders().productIds, ['52']);

    store.markReminderItemsSent(second.id, [{ reminderKey: 'bug:99:liming' }], '2026-11-02T02:00:00.000Z');
    assert.deepEqual(store.getReminderLastSent(first.id), {});
    assert.deepEqual(Object.keys(store.getReminderLastSent(second.id)), ['bug:99:liming']);

    store.finishReminderRun({ total: 1 }, { jobId: second.id, autoRun: true, autoRunDate: '2026-11-02' });
    assert.equal(store.getReminderJob(second.id).lastAutoRunDate, '2026-11-02');
    assert.equal(store.getReminders().lastAutoRunDate, '');
    store.finishReminderRun({ total: 1 }, { jobId: first.id, autoRun: true, autoRunDate: '2026-11-02' });
    assert.equal(store.getReminders().lastAutoRunDate, '2026-11-02');

    store.deleteReminderJob(first.id);
    assert.deepEqual(store.getReminderJobs().map((job) => job.id), ['RJ-2']);
    const reloaded = new Store(file);
    assert.deepEqual(reloaded.getReminderJobs().map((job) => job.id), ['RJ-2']);
    assert.deepEqual(Object.keys(reloaded.getReminderLastSent('RJ-2')), ['bug:99:liming']);

    reloaded.deleteReminderJob('RJ-2');
    assert.deepEqual(reloaded.getReminderJobs(), []);
    assert.deepEqual(reloaded.getReminders().productIds, []);
    assert.equal(reloaded.getReminders().enabled, false);
    const emptyAgain = new Store(file);
    assert.deepEqual(emptyAgain.getReminderJobs(), []);
    assert.deepEqual(emptyAgain.getReminders().productIds, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('旧版单任务配置迁移为 RJ-1，并保留计划与提醒历史', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qdesk-reminder-migrate-'));
  try {
    const file = path.join(dir, 'app-data.json');
    const at = daysAgo(2);
    fs.writeFileSync(file, JSON.stringify({
      reminders: {
        enabled: true,
        webhookUrl: WEBHOOK,
        thresholdDays: 5,
        repeatDays: 4,
        scheduleTime: '10:20',
        weekdays: [1, 2, 3, 4, 5],
        productIds: ['52'],
        versions: ['3.0.0'],
        lastAutoRunDate: '2026-11-01',
        updatedAt: at
      },
      reminderLastSent: { 'bug:12021:suntao': at }
    }, null, 2));
    const store = new Store(file);
    const jobs = store.getReminderJobs();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].id, 'RJ-1');
    assert.equal(jobs[0].name, '默认提醒');
    assert.equal(jobs[0].enabled, true);
    assert.equal(jobs[0].webhookUrl, WEBHOOK);
    assert.equal(jobs[0].thresholdDays, 5);
    assert.equal(jobs[0].lastAutoRunDate, '2026-11-01');
    assert.deepEqual(jobs[0].lastSent, { 'bug:12021:suntao': new Date(at).toISOString() });
    assert.equal(store.getReminders().productIds[0], '52');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('没有实际内容的旧版默认配置不会自动创建任务', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qdesk-reminder-empty-'));
  try {
    const file = path.join(dir, 'app-data.json');
    fs.writeFileSync(file, JSON.stringify({
      reminders: {
        enabled: false,
        thresholdDays: 3,
        repeatDays: 3,
        scheduleTime: '09:30',
        weekdays: [1, 2, 3, 4, 5]
      }
    }, null, 2));
    const store = new Store(file);
    assert.deepEqual(store.getReminderJobs(), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('重复提醒：按上次提醒时间计算下次到期，间隔为 0 时不再重复', () => {
  const rows = [bug({ assignedAt: daysAgo(10) })];
  const first = Reminders.selectReminderBugs(rows, ACCOUNT, 3, NOW, {}, null, {
    lastSent: {},
    repeatDays: 3
  });
  assert.equal(first.length, 1);
  assert.equal(first[0].isRepeat, false);
  assert.equal(first[0].daysSinceReminded, null);

  const key = 'bug:12021:suntao';
  const twoDaysAgo = Reminders.selectReminderBugs(rows, ACCOUNT, 3, NOW, {}, null, {
    lastSent: { [key]: daysAgo(2) },
    repeatDays: 3
  });
  assert.equal(twoDaysAgo.length, 0);

  const threeDaysAgo = Reminders.selectReminderBugs(rows, ACCOUNT, 3, NOW, {}, null, {
    lastSent: { [key]: daysAgo(3) },
    repeatDays: 3
  });
  assert.equal(threeDaysAgo.length, 1);
  assert.equal(threeDaysAgo[0].isRepeat, true);
  assert.equal(threeDaysAgo[0].daysSinceReminded, 3);

  const onlyOnce = Reminders.selectReminderBugs(rows, ACCOUNT, 3, NOW, {}, null, {
    lastSent: { [key]: daysAgo(30) },
    repeatDays: 0
  });
  assert.equal(onlyOnce.length, 0);
});

test('重复提醒按条目和指派人分别记录，不会被其他开发的上次提醒影响', () => {
  const rows = [bug({ assignedAt: daysAgo(10) })];
  const selected = Reminders.selectReminderBugs(rows, ACCOUNT, 3, NOW, {}, null, {
    lastSent: { 'bug:12021:liming': daysAgo(10) },
    repeatDays: 3
  });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].isRepeat, false);
  assert.equal(selected[0].reminderKey, 'bug:12021:suntao');
});

test('buildReminderPreview 区分首次与重复提醒并输出距上次提醒天数', () => {
  const config = Reminders.normalizeReminderConfig({ thresholdDays: 3, repeatDays: 3 }, null, { strict: true });
  const preview = Reminders.buildReminderPreview({
    account: ACCOUNT,
    config,
    now: NOW,
    bugs: [
      bug({ id: '1', assignedAt: daysAgo(10) }),
      bug({ id: '2', assignedAt: daysAgo(9) }),
      bug({ id: '3', assignedAt: daysAgo(12) })
    ],
    lastSent: {
      'bug:1:suntao': daysAgo(4),
      'bug:2:suntao': daysAgo(1)
    }
  });
  assert.deepEqual(preview.groups[0].items.map((item) => item.id).sort(), ['1', '3']);
  assert.equal(preview.repeatCount, 1);
  assert.equal(preview.firstCount, 1);
  assert.equal(preview.groups[0].repeatCount, 1);
  assert.match(preview.groups[0].message, /你有 2 个 Bug 已超过10天未处理，最长 12 天未处理！\n其中 2 个 Bug 待修复，请尽快修复并更新禅道状态。/);

  assert.doesNotMatch(preview.groups[0].message, /#1 /);

  const filtered = Reminders.filterReminderPreview(preview, ['suntao']);
  assert.equal(filtered.repeatCount, 1);
  assert.equal(filtered.firstCount, 1);
});

test('buildReminderPreview 手动预览忽略重复间隔，包含全部超期项', () => {
  const config = Reminders.normalizeReminderConfig({ thresholdDays: 3, repeatDays: 3 }, null, { strict: true });
  const preview = Reminders.buildReminderPreview({
    account: ACCOUNT,
    config,
    now: NOW,
    includeAll: true,
    bugs: [
      bug({ id: '1', assignedAt: daysAgo(10) }),
      bug({ id: '2', assignedAt: daysAgo(9) }),
      bug({ id: '3', assignedAt: daysAgo(12) })
    ],
    lastSent: {
      'bug:1:suntao': daysAgo(4),
      'bug:2:suntao': daysAgo(1)
    }
  });
  assert.deepEqual(preview.groups[0].items.map((item) => item.id).sort(), ['1', '2', '3']);
  assert.equal(preview.total, 3);
  assert.equal(preview.repeatCount, 2);
  assert.equal(preview.firstCount, 1);
  assert.match(preview.groups[0].message, /你有 3 个 Bug 已超过9天未处理，最长 12 天未处理！/);
});

test('buildReminderPreview 消息按实际最短超期天数展示，而不是固定写阈值', () => {
  [
    [7, 10, 3],
    [10, 10, 3],
    [12, 12, 2]
  ].forEach(([thresholdDays, expectedDays, expectedCount]) => {
    const config = Reminders.normalizeReminderConfig({ thresholdDays }, null, { strict: true });
    const preview = Reminders.buildReminderPreview({
      account: ACCOUNT,
      config,
      now: NOW,
      bugs: [
        bug({ id: '1', assignedAt: daysAgo(10) }),
        bug({ id: '2', assignedAt: daysAgo(12) }),
        bug({ id: '3', assignedAt: daysAgo(19) })
      ]
    });
    assert.match(
      preview.groups[0].message,
      new RegExp(`你有 ${expectedCount} 个 Bug 已超过${expectedDays}天未处理，最长 19 天未处理！`)
    );
  });
});

test('publicReminderConfig 不回传 Webhook 密钥', () => {
  const config = Reminders.normalizeReminderConfig({ enabled: true, webhookUrl: WEBHOOK }, null, { strict: true });
  const publicConfig = Reminders.publicReminderConfig(config);
  assert.equal(publicConfig.configured, true);
  assert.equal(publicConfig.webhookMasked, 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=****');
  assert.equal(Object.prototype.hasOwnProperty.call(publicConfig, 'webhookUrl'), false);
  assert.equal(JSON.stringify(publicConfig).includes('abcdefgh12345678'), false);
});

test('selectReminderBugs 按当前责任人选择超期 Bug，并排除自己的待修复项', () => {
  const rows = [
    bug(),
    bug({ id: '2', assignedAt: daysAgo(1) }),
    bug({ id: '3', rawStatus: 'resolved', status: 'verifying' }),
    bug({ id: '4', assigneeAccount: ACCOUNT, assignee: '卫珍', isAssignedToMe: true }),
    bug({ id: '5', isMine: false, reporterAccount: 'other' }),
    bug({ id: '6', assignedAt: '', createdAt: daysAgo(6) })
  ];
  const selected = Reminders.selectReminderBugs(rows, ACCOUNT, 3, NOW);
  assert.deepEqual(selected.map((item) => item.id).sort(), ['12021', '3', '6']);
  assert.equal(selected.find((item) => item.id === '12021').days, 5);
  assert.equal(selected.find((item) => item.id === '3').role, 'tester');
  assert.equal(selected.find((item) => item.id === '6').days, 6);
});

test('buildReminderPreview 按状态提醒产品确认、开发修复和测试验证', () => {
  const config = Reminders.normalizeReminderConfig({ thresholdDays: 7 }, null, { strict: true });
  const products = [{
    id: '52',
    name: '新好人好股PC客户端',
    po: 'anlaigen',
    poName: '安来根',
    qd: 'weizhen',
    qdName: '魏振'
  }];
  const preview = Reminders.buildReminderPreview({
    account: ACCOUNT,
    config,
    now: NOW,
    products,
    bugs: [
      bug({ id: 'U1', productId: '52', assigneeAccount: 'shesiwei', assignee: '佘思维', confirmed: false, createdAt: daysAgo(14) }),
      bug({ id: 'U2', productId: '52', assigneeAccount: '', assignee: '', confirmed: false, createdAt: daysAgo(12) }),
      bug({ id: 'D1', productId: '52', assigneeAccount: 'suntao', assignee: '孙涛', confirmed: true, assignedAt: daysAgo(10) }),
      bug({
        id: 'T1', productId: '52', rawStatus: 'resolved', status: 'verifying',
        assigneeAccount: ACCOUNT, assignee: '魏振', confirmed: true, resolvedAt: daysAgo(8)
      })
    ]
  });
  const byAccount = new Map(preview.groups.map((group) => [group.account, group]));
  assert.equal(byAccount.has('shesiwei'), false);

  const product = byAccount.get('anlaigen');
  assert.equal(product.count, 2);
  assert.equal(product.reasonCounts.unconfirmed, 1);
  assert.equal(product.reasonCounts.unassigned, 1);
  assert.match(product.message, /你有 2 个 Bug 已超过12天未处理，最长 14 天未处理！\n其中 1 个 Bug 待确认、1 个 Bug 待指派，请确认后指派处理人。/);

  const developer = byAccount.get('suntao');
  assert.equal(developer.reasonCounts.developer, 1);
  assert.match(developer.message, /其中 1 个 Bug 待修复，请尽快修复并更新禅道状态。/);

  const tester = byAccount.get('weizhen');
  assert.equal(tester.reasonCounts.tester, 1);
  assert.match(tester.message, /你有 1 个 Bug 已超过8天未处理，最长 8 天未处理！\n其中 1 个 Bug 待测试，请及时验证并更新禅道状态。/);
});

test('buildReminderPreview 已修复待验证时优先提醒实际验证人', () => {
  const config = Reminders.normalizeReminderConfig({ thresholdDays: 3 }, null, { strict: true });
  const preview = Reminders.buildReminderPreview({
    account: ACCOUNT,
    config,
    now: NOW,
    products: [{ id: '52', name: '新好人好股PC客户端', po: 'anlaigen', poName: '安来根', qd: '', qdName: '' }],
    bugs: [
      bug({
        id: 'T2', productId: '52', rawStatus: 'resolved', status: 'verifying',
        assigneeAccount: 'fengzhizheng', assignee: '冯智政', confirmed: true,
        needsMyVerification: true, createdAt: daysAgo(9), resolvedAt: daysAgo(5)
      })
    ]
  });
  assert.equal(preview.groups.length, 1);
  const tester = preview.groups[0];
  assert.equal(tester.account, ACCOUNT);
  assert.equal(tester.reasonCounts.tester, 1);
  assert.match(tester.message, /你有 1 个 Bug 已超过5天未处理，最长 5 天未处理！\n其中 1 个 Bug 待测试，请及时验证并更新禅道状态。/);
});

test('buildReminderPreview 按开发分组并生成简短的版本、数量和最长未处理天数摘要', () => {
  const config = Reminders.normalizeReminderConfig({
    thresholdDays: 3,
    mentionMap: { 孙涛: 'SunTao' }
  }, null, { strict: true });
  const preview = Reminders.buildReminderPreview({
    account: ACCOUNT,
    config,
    now: NOW,
    moduleNames: { 278: '自选', 300: '持仓' },
    bugs: [
      bug(),
      bug({ id: '12023', title: '【自选股】开启记忆旁问号无反应', version: '3.0.0', module: '自选', assignedAt: daysAgo(7) }),
      bug({ id: '12024', title: '【持仓】底部菜单文字颜色异常', version: '3.1.0', moduleId: '300', module: '模块 300', assignee: '李明', assigneeAccount: 'liming', assignedAt: daysAgo(4) })
    ]
  });
  assert.equal(preview.total, 3);
  assert.equal(preview.groupCount, 2);
  assert.equal(preview.messageCount, 2);
  const suntao = preview.groups.find((group) => group.account === 'suntao');
  assert.equal(suntao.count, 2);
  assert.equal(suntao.maxDays, 7);
  assert.equal(suntao.mention, 'SunTao');
  assert.equal(suntao.mentionMapped, true);
  assert.match(suntao.message, /@孙涛\s+产品：新好人好股PC客户端\s+版本：3\.0\.0\s+你有 2 个 Bug 已超过5天未处理，最长 7 天未处理！\n其中 2 个 Bug 待修复，请尽快修复并更新禅道状态。/);

  assert.doesNotMatch(suntao.message, /提醒阈值/);
  assert.doesNotMatch(suntao.message, /技术处理/);
  assert.doesNotMatch(suntao.message, /#12021/);
  assert.doesNotMatch(suntao.message, /合计：/);
  assert.deepEqual(Reminders.buildWecomPayload(suntao, suntao.message).text.mentioned_list, ['SunTao']);
  const liming = preview.groups.find((group) => group.account === 'liming');
  assert.equal(liming.mention, 'liming');
  assert.equal(liming.mentionMapped, false);
  assert.equal(preview.mentionUnmappedCount, 1);
});

test('长列表简化为单条摘要，不再把全部 Bug 标题塞进群消息', () => {
  const bugs = Array.from({ length: 40 }, (_, index) => bug({
    id: String(13000 + index),
    title: `【自选股】第 ${index + 1} 个超期 Bug 的标题比较长，用于验证消息摘要逻辑`,
    assignedAt: daysAgo(4 + (index % 5))
  }));
  const config = Reminders.normalizeReminderConfig({ thresholdDays: 3 }, null, { strict: true });
  const preview = Reminders.buildReminderPreview({ account: ACCOUNT, config, now: NOW, bugs });
  const group = preview.groups[0];
  assert.equal(group.messages.length, 1);
  assert.equal(preview.messageCount, 1);
  assert.ok(Buffer.byteLength(group.message, 'utf8') <= Reminders.WECOM_TEXT_LIMIT);
  assert.match(group.message, /@孙涛/);
  assert.match(group.message, /你有 40 个 Bug 已超过4天未处理，最长 8 天未处理！\n其中 40 个 Bug 待修复，请尽快修复并更新禅道状态。/);

  assert.doesNotMatch(group.message, /#13000/);
  assert.doesNotMatch(group.message, /合计：/);
});

function task(overrides) {
  return Object.assign({
    id: '501',
    title: '回归验证自选股清空品种',
    status: 'doing',
    rawStatus: 'doing',
    statusLabel: '进行中',
    project: '新好人好股PC客户端',
    execution: '3.0.0 迭代',
    moduleId: '278',
    module: '模块 278',
    assignee: '孙涛',
    assigneeAccount: 'suntao',
    creator: '卫珍',
    creatorAccount: ACCOUNT,
    isMine: false,
    isOpenedByMe: true,
    assignedAt: daysAgo(6),
    createdAt: daysAgo(9),
    dueDate: '2026-10-30'
  }, overrides || {});
}

test('selectReminderTasks 只选择我创建并指派给开发、仍未完成的任务', () => {
  const rows = [
    task(),
    task({ id: '502', rawStatus: 'done', status: 'done', completedAt: daysAgo(1) }),
    task({ id: '503', rawStatus: 'closed', status: 'done' }),
    task({ id: '504', isOpenedByMe: false, creatorAccount: 'other' }),
    task({ id: '505', assigneeAccount: ACCOUNT, assignee: '卫珍', isMine: true }),
    task({ id: '506', assignedAt: '', createdAt: daysAgo(5) })
  ];
  const selected = Reminders.selectReminderTasks(rows, ACCOUNT, 3, NOW);
  assert.deepEqual(selected.map((item) => item.id).sort(), ['501', '506']);
  assert.equal(selected.find((item) => item.id === '501').kind, 'task');
  assert.equal(selected.find((item) => item.id === '501').days, 6);
  assert.equal(selected.find((item) => item.id === '506').days, 5);
});

test('buildReminderPreview 同时汇总 Bug 与任务，并排除别人指派给开发的任务', () => {
  const config = Reminders.normalizeReminderConfig({
    thresholdDays: 3,
    mentionMap: { suntao: 'SunTao' }
  }, null, { strict: true });
  const preview = Reminders.buildReminderPreview({
    account: ACCOUNT,
    config,
    now: NOW,
    moduleNames: { 278: '自选' },
    bugs: [bug()],
    tasks: [
      task(),
      task({ id: '507', title: '不是我的任务', isOpenedByMe: false, creatorAccount: 'other' })
    ]
  });
  assert.equal(preview.total, 2);
  assert.equal(preview.bugTotal, 1);
  assert.equal(preview.taskTotal, 1);
  assert.equal(preview.groupCount, 1);
  const group = preview.groups[0];
  assert.equal(group.count, 2);
  assert.equal(group.bugCount, 1);
  assert.equal(group.taskCount, 1);
  assert.match(group.message, /Bug \/ 任务超期未处理提醒/);
  assert.match(group.message, /你有 2 项（Bug 1 个、任务 1 个）已超过5天未处理，最长 6 天未处理！\n其中 1 个 Bug 待修复、1 个任务待处理，请及时处理并更新禅道状态。/);

  assert.doesNotMatch(group.message, /提醒阈值/);
  assert.doesNotMatch(group.message, /\[Bug\] #12021/);
  assert.doesNotMatch(group.message, /\[任务\] #501/);
  assert.doesNotMatch(group.message, /合计：/);
  assert.doesNotMatch(group.message, /#507/);
});

test('buildReminderPreview 按产品和版本筛选 Bug，选择筛选后任务不参与', () => {
  const config = Reminders.normalizeReminderConfig({
    thresholdDays: 3,
    productIds: ['13'],
    versions: ['3.0.0']
  }, null, { strict: true });
  const preview = Reminders.buildReminderPreview({
    account: ACCOUNT,
    config,
    now: NOW,
    bugs: [
      bug(),
      bug({ id: '2', productId: '47' }),
      bug({ id: '3', version: '3.1.0' }),
      bug({ id: '4', productId: '13', version: '3.0.0', assignee: '李明', assigneeAccount: 'liming' })
    ],
    tasks: [task()],
    products: [
      { id: '13', name: '新好人好股PC客户端' },
      { id: '47', name: '好人好股PC' }
    ]
  });
  assert.equal(preview.total, 2);
  assert.equal(preview.bugTotal, 2);
  assert.equal(preview.taskTotal, 0);
  assert.deepEqual(preview.groups.map((group) => group.account).sort(), ['liming', 'suntao']);
  assert.deepEqual(preview.productIds, ['13']);
  assert.deepEqual(preview.versions, ['3.0.0']);
  assert.ok(preview.options.products.some((product) => product.id === '47'));
  assert.ok(preview.options.versions.some((version) => version.name === '3.0.0'));
  assert.ok(preview.options.versions.some((version) => version.name === '3.1.0'));
});

test('filterReminderPreview 只保留手动选中的开发并重算总数', () => {
  const config = Reminders.normalizeReminderConfig({ thresholdDays: 3 }, null, { strict: true });
  const preview = Reminders.buildReminderPreview({
    account: ACCOUNT,
    config,
    now: NOW,
    bugs: [
      bug(),
      bug({ id: '2', assignee: '李明', assigneeAccount: 'liming' })
    ]
  });
  assert.equal(preview.total, 2);
  assert.equal(preview.groupCount, 2);
  const filtered = Reminders.filterReminderPreview(preview, ['liming']);
  assert.equal(filtered.total, 1);
  assert.equal(filtered.groupCount, 1);
  assert.equal(filtered.messageCount, 1);
  assert.deepEqual(filtered.groups.map((group) => group.account), ['liming']);
  assert.equal(preview.groups.length, 2);
});

test('buildWecomPayload 使用 text 消息并艾特对应企微 userid', () => {
  const payload = Reminders.buildWecomPayload({ mention: 'SunTao' }, '测试消息');
  assert.deepEqual(payload, {
    msgtype: 'text',
    text: {
      content: '测试消息',
      mentioned_list: ['SunTao']
    }
  });
});
