'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeTask,
  normalizeBug,
  autojobRelation,
  buildBugStats,
  buildAutojobStats,
  buildTaskStats,
  businessCategory,
  severityFromRaw,
  severityRaw,
  priorityValue,
  bugUiStatus,
  taskUiStatus,
  userMap,
  realName,
  localDate,
  dateOnly,
  toIso
} = require('../lib/normalize');

const users = userMap([
  { account: 'qa_user', realname: '测试员' },
  { account: 'dev01', realname: '开发一号' }
]);

function task(overrides) {
  return normalizeTask(Object.assign({
    id: 101,
    name: 'PC 客户端回归测试',
    type: 'test',
    pri: 2,
    status: 'wait',
    projectName: '示例产品',
    assignedTo: 'qa_user',
    openedBy: 'qa_user',
    openedDate: '2026-10-20 09:00:00',
    estimate: 4,
    consumed: 1,
    left: 3,
    desc: '执行版本回归'
  }, overrides), {
    users,
    account: 'qa_user',
    execution: {
      id: 245,
      name: 'PC 10 月迭代',
      projectName: '示例产品',
      begin: '2026-10-01',
      end: '2026-10-31'
    },
    webUrl: 'https://chandao.example.com/zentao'
  });
}

function bug(overrides) {
  return normalizeBug(Object.assign({
    id: 5201,
    title: '【快速选股】条件单保存后丢失',
    severity: 1,
    pri: 2,
    type: 'codeerror',
    status: 'active',
    confirmed: '1',
    openedBy: 'qa_user',
    assignedTo: 'dev01',
    openedDate: '2026-10-24 10:00:00',
    openedBuild: 'trunk',
    module: '277',
    steps: '1. 打开快速选股\n2. 保存条件单\n\n**预期结果**\n条件单保留\n\n**实际结果**\n刷新后丢失'
  }, overrides), {
    users,
    account: 'qa_user',
    productId: '52',
    productName: '示例产品',
    moduleNames: { 277: '选股' },
    webUrl: 'https://chandao.example.com/zentao'
  });
}

function autojobBug(overrides) {
  return normalizeBug(Object.assign({
    id: 9001,
    title: 'PC端登录失败[PC]:P0',
    severity: 1,
    pri: 1,
    type: 'codeerror',
    status: 'active',
    openedBy: 'autojob',
    assignedTo: 'qa_user',
    openedDate: '2026-10-28 01:00:00',
    steps: '客服群聊记录'
  }, overrides), {
    users,
    account: 'qa_user',
    productId: '53',
    productName: '企微客户问题需求',
    moduleNames: {},
    webUrl: 'https://chandao.example.com/zentao',
    autojobAccounts: new Set(['autojob'])
  });
}

test('task status and ownership are mapped from ZenTao', () => {
  const row = task();
  assert.equal(row.status, 'todo');
  assert.equal(row.rawStatus, 'wait');
  assert.equal(row.statusLabel, '待开始');
  assert.equal(row.isMine, true);
  assert.equal(row.isTest, true);
  assert.equal(row.assignee, '测试员');
  assert.equal(row.priority, 'P1');
  assert.equal(row.dueDate, '2026-10-31');
  assert.equal(row.dueSource, 'execution');
  assert.equal(row.url, 'https://chandao.example.com/zentao/task-view-101.html');
});

test('task status variants and task deadline take precedence', () => {
  assert.equal(task({ status: 'doing' }).status, 'doing');
  assert.equal(task({ status: 'pause' }).status, 'blocked');
  assert.equal(task({ status: 'done' }).status, 'done');
  assert.equal(task({ status: 'closed' }).status, 'done');
  assert.equal(task({ status: 'cancel' }).status, 'done');
  const row = task({ deadline: '2026-10-15', assignedTo: 'dev01' });
  assert.equal(row.dueDate, '2026-10-15');
  assert.equal(row.dueSource, 'task');
  assert.equal(row.isMine, false);
});

test('bug severity, status, module and ownership are normalized', () => {
  const row = bug();
  assert.equal(row.severity, 'P0');
  assert.equal(row.severityRaw, '1');
  assert.equal(row.severityLabel, 'P0 致命');
  assert.equal(row.pri, 'P1');
  assert.equal(row.status, 'confirmed');
  assert.equal(row.rawStatus, 'active');
  assert.equal(row.statusLabel, '激活');
  assert.equal(row.module, '选股');
  assert.equal(row.typeLabel, '代码错误');
  assert.equal(row.businessCategory, '选股');
  assert.equal(row.isMine, true);
  assert.equal(row.isAssignedToMe, false);
  assert.equal(row.isOpen, true);
  assert.equal(row.url, 'https://chandao.example.com/zentao/bug-view-5201.html');
});

test('bug expected and actual sections are extracted from ZenTao steps', () => {
  const row = bug();
  assert.equal(row.expected, '条件单保留');
  assert.equal(row.actual, '刷新后丢失');
  const inline = bug({
    steps: '**环境**：Windows 11\n\n**期望**：每个标的显示自己的分价表。\n\n**实际**：显示了其他标的的数据。'
  });
  assert.equal(inline.expected, '每个标的显示自己的分价表。');
  assert.equal(inline.actual, '显示了其他标的的数据。');
  const bracket = bug({
    steps: '\\[步骤\\]打开个股详情\n\n\\[结果\\]分时成交量错误\n\n\\[期望\\]数据和画线正确显示'
  });
  assert.equal(bracket.expected, '数据和画线正确显示');
  assert.equal(bracket.actual, '分时成交量错误');
});

test('bug status aliases map to the UI model', () => {
  assert.equal(bug({ status: 'active', confirmed: '0' }).status, 'new');
  assert.equal(bug({ status: 'active', confirmed: '1' }).status, 'confirmed');
  assert.equal(bug({ status: 'resolved' }).status, 'verifying');
  assert.equal(bug({ status: 'closed' }).status, 'closed');
  assert.equal(bug({ status: 'closed' }).isOpen, false);
});

test('autojob bugs are tagged and related to the current account', () => {
  const assigned = autojobBug();
  assert.equal(assigned.isAutojob, true);
  assert.equal(assigned.sourceLabel, 'AI 客服提取');
  assert.equal(assigned.reporterAccount, 'autojob');
  assert.equal(assigned.resolvedByAccount, '');
  assert.equal(autojobRelation(assigned, 'qa_user'), 'assigned');
  assert.equal(autojobRelation(assigned, 'dev01'), '');

  const resolved = autojobBug({
    id: 9002,
    status: 'resolved',
    assignedTo: 'autojob',
    resolvedBy: 'qa_user',
    resolution: 'fixed'
  });
  assert.equal(autojobRelation(resolved, 'qa_user'), 'resolved');
  assert.equal(resolved.needsMyVerification, false);

  const assignedBack = autojobBug({
    id: 9004,
    status: 'resolved',
    assignedTo: 'qa_user',
    resolvedBy: 'dev01'
  });
  assert.equal(assignedBack.needsMyVerification, true);

  const closed = autojobBug({
    id: 9003,
    status: 'closed',
    assignedTo: 'closed',
    closedBy: 'qa_user'
  });
  assert.equal(autojobRelation(closed, 'qa_user'), 'closed');
});

test('autojob stats split unresolved, pending verification and closed', () => {
  const rows = [
    autojobBug({ id: 9001, status: 'active', assignedTo: 'qa_user', severity: 1 }),
    autojobBug({ id: 9002, status: 'active', assignedTo: 'qa_user', severity: 2 }),
    autojobBug({ id: 9003, status: 'resolved', assignedTo: 'autojob', resolvedBy: 'qa_user', severity: 2 }),
    autojobBug({ id: 9004, status: 'closed', assignedTo: 'closed', closedBy: 'qa_user', severity: 3 }),
    autojobBug({ id: 9005, status: 'active', assignedTo: 'dev01', severity: 1 }),
    autojobBug({ id: 9006, status: 'resolved', assignedTo: 'autojob', resolvedBy: 'dev01', severity: 1 })
  ];
  const stats = buildAutojobStats(rows, 'qa_user');
  assert.equal(stats.total, 4);
  assert.equal(stats.active, 2);
  assert.equal(stats.resolved, 0);
  assert.equal(stats.resolvedByMe, 1);
  assert.equal(stats.resolvedWaitingOthers, 1);
  assert.equal(stats.closed, 1);
  assert.equal(stats.open, 3);
  assert.equal(stats.severeOpen, 3);
  assert.equal(stats.highPriorityOpen, 3);
  assert.equal(stats.highPriorityActive, 2);
  assert.equal(stats.assigned, 2);
  assert.equal(stats.closedByMe, 1);
  assert.equal(stats.allTotal, 6);
  assert.equal(stats.allClosed, 1);
  assert.equal(stats.byProduct[0].key, '企微客户问题需求');
});

test('business category uses title feature prefixes before keywords', () => {
  assert.equal(businessCategory('【自选股】分组顺序异常', '自选股'), '自选股');
  assert.equal(businessCategory('【主窗口】启动崩溃', ''), '客户端体验');
  assert.equal(businessCategory('港股行情刷新缓慢', ''), '行情数据');
  assert.equal(businessCategory('没有明显业务关键词', ''), '未归类');
  assert.equal(businessCategory('没有明显业务关键词', '自定义功能'), '自定义功能');
});

test('bug stats groups are populated and totals stay consistent', () => {
  const bugs = [
    bug(),
    bug({ id: 5202, title: '【行情数据】指数刷新失败', severity: 2, status: 'active', confirmed: '0', assignedTo: 'dev01' }),
    bug({ id: 5203, title: '【自选股】分组丢失', severity: 3, status: 'resolved', type: 'performance', module: '278' }),
    bug({ id: 5204, title: '【主窗口】启动较慢', severity: 4, status: 'closed', type: 'performance', openedBy: 'dev01', assignedTo: 'qa_user', module: '0' })
  ];
  const stats = buildBugStats(bugs);
  assert.equal(stats.total, 4);
  assert.equal(stats.open, 3);
  assert.equal(stats.closed, 1);
  assert.equal(stats.resolved, 1);
  assert.equal(stats.severeOpen, 2);
  assert.equal(stats.byStatus.length, 4);
  assert.equal(stats.bySeverity.length, 4);
  assert.equal(stats.byType.length, 2);
  assert.equal(stats.byBusinessCategory.length, 4);
  assert.equal(stats.byModule.length, 3);
  assert.equal(stats.byCreator.length, 2);
  assert.equal(stats.byAssignee.length, 2);
  assert.equal(stats.byStatus.find((item) => item.key === 'confirmed').count, 1);
  assert.equal(stats.bySeverity.find((item) => item.key === 'P0').count, 1);
  assert.equal(stats.byType.find((item) => item.key === 'performance').count, 2);
  assert.equal(stats.byBusinessCategory.find((item) => item.key === '选股').count, 1);
});

test('task stats count open, doing, blocked and test tasks', () => {
  const rows = [
    task({ id: 1, status: 'wait' }),
    task({ id: 2, status: 'doing' }),
    task({ id: 3, status: 'pause' }),
    task({ id: 4, status: 'done' }),
    task({ id: 5, status: 'wait', type: 'devel' })
  ];
  const stats = buildTaskStats(rows);
  assert.equal(stats.total, 5);
  assert.equal(stats.open, 4);
  assert.equal(stats.doing, 1);
  assert.equal(stats.blocked, 1);
  assert.equal(stats.tests, 4);
});

test('severity and priority helpers accept P labels and raw 1-4 values', () => {
  assert.equal(priorityValue(1), 'P0');
  assert.equal(priorityValue(4), 'P3');
  assert.equal(priorityValue(99), 'P3');
  assert.equal(severityFromRaw(2), 'P1');
  assert.equal(severityRaw('P0'), 1);
  assert.equal(severityRaw('P3'), 4);
  assert.equal(severityRaw(2), 2);
  assert.equal(taskUiStatus('pause'), 'blocked');
  assert.equal(bugUiStatus({ status: 'resolved' }), 'verifying');
});

test('user and date helpers are defensive', () => {
  assert.equal(realName(users, 'qa_user'), '测试员');
  assert.equal(realName(users, ''), '未指派');
  assert.equal(realName(users, 'unknown'), 'unknown');
  assert.equal(dateOnly('2026-10-26 08:30:00'), '2026-10-26');
  assert.equal(dateOnly('not a date'), '');
  assert.match(localDate(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(toIso('invalid'), null);
  assert.match(toIso('2026-10-26 08:30:00'), /^2026-10-26T/);
});
