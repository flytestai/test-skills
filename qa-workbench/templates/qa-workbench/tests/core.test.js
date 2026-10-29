'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');

const FIXED_DATE = '2026-10-26';
const fixedState = () => Core.defaultState(new Date(2026, 9, 26, 9, 0, 0));

test('defaultState 生成完整的演示工作台', () => {
  const state = fixedState();
  assert.equal(state.version, Core.VERSION);
  assert.equal(state.tasks.length, 9);
  assert.equal(state.bugs.length, 6);
  assert.equal(state.reports.length, 1);
  assert.equal(state.reports[0].date, '2026-10-25');
  assert.equal(state.reports[0].status, 'submitted');
  assert.ok(state.projects.includes('行情终端'));
  assert.ok(state.profile.role.length > 0);
});

test('metrics 正确统计任务、Bug 和今日进度', () => {
  const state = fixedState();
  const metrics = Core.metrics(state, FIXED_DATE);
  assert.equal(metrics.taskOpen, 7);
  assert.equal(metrics.taskDoing, 2);
  assert.equal(metrics.taskBlocked, 1);
  assert.equal(metrics.taskDueToday, 3);
  assert.equal(metrics.taskDoneToday, 1);
  assert.equal(metrics.bugOpen, 5);
  assert.equal(metrics.bugSevere, 3);
  assert.equal(metrics.bugFoundToday, 2);
  assert.equal(metrics.reportStatus, 'none');
  assert.ok(metrics.progress >= 0 && metrics.progress <= 100);
});

test('collectDailyData 和 buildReport 能采集并生成日报', () => {
  const state = fixedState();
  const data = Core.collectDailyData(state, FIXED_DATE);
  assert.deepEqual(data.doneTasks.map((task) => task.id), ['T-1005']);
  assert.deepEqual(data.foundBugs.map((bug) => bug.id).sort(), ['BUG-1183', 'BUG-1185']);
  assert.equal(data.ongoingTasks.length, 4);

  const report = Core.buildReport(state, FIXED_DATE);
  assert.equal(report.date, FIXED_DATE);
  assert.equal(report.status, 'draft');
  assert.match(report.content.summary, /完成 1 项任务/);
  assert.match(report.content.done, /完成测试环境升级与冒烟验证/);
  assert.match(report.content.bugs, /BUG-1183/);
  assert.match(report.content.bugs, /BUG-1185/);
  assert.match(report.content.risks, /BUG-1182/);
  assert.match(report.content.risks, /条件单触发规则/);
});

test('renderReportMarkdown 输出完整 Markdown 结构', () => {
  const state = fixedState();
  const report = Core.buildReport(state, FIXED_DATE);
  const markdown = Core.renderReportMarkdown(report, state.profile);
  assert.match(markdown, /^# 工作日报｜2026-10-26/);
  assert.match(markdown, /## 今日摘要/);
  assert.match(markdown, /## 已完成/);
  assert.match(markdown, /## Bug 跟踪/);
  assert.match(markdown, /## 进行中/);
  assert.match(markdown, /## 明日计划/);
  assert.match(markdown, /## 风险与阻塞/);
  assert.match(markdown, /测试开发工程师/);
});

test('setTaskStatus 维护完成时间与历史', () => {
  const state = fixedState();
  const task = state.tasks.find((item) => item.id === 'T-1001');
  const at = Core.dateAt(FIXED_DATE, 11, 30);
  Core.setTaskStatus(task, 'done', at);
  assert.equal(task.status, 'done');
  assert.equal(task.completedAt, at);
  assert.match(task.history[0].text, /完成了任务/);

  Core.setTaskStatus(task, 'doing', Core.dateAt(FIXED_DATE, 12, 0));
  assert.equal(task.status, 'doing');
  assert.equal(task.completedAt, null);
  assert.match(task.history[0].text, /待开始|已完成|变更为/);
});

test('setBugStatus 关闭时补齐验证与关闭时间，重开时清理', () => {
  const state = fixedState();
  const bug = state.bugs.find((item) => item.id === 'BUG-1182');
  const closedAt = Core.dateAt(FIXED_DATE, 17, 0);
  Core.setBugStatus(bug, 'closed', closedAt);
  assert.equal(bug.status, 'closed');
  assert.equal(bug.verifiedAt, closedAt);
  assert.equal(bug.closedAt, closedAt);

  Core.setBugStatus(bug, 'fixing', Core.dateAt(FIXED_DATE, 18, 0));
  assert.equal(bug.status, 'fixing');
  assert.equal(bug.verifiedAt, null);
  assert.equal(bug.closedAt, null);
});

test('筛选器支持关键词、优先级、项目和逾期条件', () => {
  const state = fixedState();
  const tasks = Core.filterTasks(state.tasks, { q: '回归', priority: 'P0' });
  assert.deepEqual(tasks.map((task) => task.id), ['T-1001']);

  const projectTasks = Core.filterTasks(state.tasks, { project: '交易系统', status: 'doing' });
  assert.deepEqual(projectTasks.map((task) => task.id), ['T-1006']);

  const overdue = Core.filterTasks(state.tasks, { due: 'overdue', date: FIXED_DATE });
  assert.equal(overdue.length, 0);

  const dueToday = Core.filterTasks(state.tasks, { due: 'today', date: FIXED_DATE });
  assert.equal(dueToday.length, 4);

  const p0Bugs = Core.filterBugs(state.bugs, { severity: 'P0' });
  assert.deepEqual(p0Bugs.map((bug) => bug.id), ['BUG-1183']);

  const verifying = Core.filterBugs(state.bugs, { status: 'verifying' });
  assert.deepEqual(verifying.map((bug) => bug.id).sort(), ['BUG-1184', 'BUG-1187']);

  const unclosed = Core.filterBugs(state.bugs, { status: 'unclosed' });
  assert.ok(unclosed.length > 0);
  assert.ok(unclosed.every((bug) => bug.status !== 'closed'));
  assert.ok(unclosed.length < state.bugs.length);
});

test('weekSeries 覆盖连续七天并返回可绘制数据', () => {
  const state = fixedState();
  const week = Core.weekSeries(state, FIXED_DATE);
  assert.equal(week.length, 7);
  assert.equal(week[6].date, FIXED_DATE);
  assert.equal(week[6].tasksDone, 1);
  assert.equal(week[6].bugsFound, 2);
  assert.ok(week.every((day) => typeof day.label === 'string'));
});

test('normalizeState 容忍损坏数据并保留合法内容', () => {
  const fallback = Core.normalizeState(null);
  assert.equal(fallback.tasks.length, 9);

  const normalized = Core.normalizeState({
    profile: { name: ' 一位测试 ', role: 'QA', avatar: 'T' },
    projects: ['项目 A', '项目 A', '项目 B'],
    tasks: [{
      id: 'T-9001',
      title: '回归测试',
      status: 'doing',
      priority: 'P1',
      tags: ['冒烟', '冒烟', ''],
      createdAt: 'not-a-date'
    }],
    bugs: 'wrong-type',
    reports: [{
      date: '2026-10-20',
      status: 'submitted',
      content: { summary: '完成验证', done: '' }
    }]
  });

  assert.equal(normalized.profile.name, ' 一位测试 ');
  assert.deepEqual(normalized.projects, ['项目 A', '项目 B']);
  assert.equal(normalized.tasks.length, 1);
  assert.equal(normalized.tasks[0].status, 'doing');
  assert.deepEqual(normalized.tasks[0].tags, ['冒烟']);
  assert.equal(normalized.bugs.length, 6);
  assert.equal(normalized.reports[0].status, 'submitted');
  assert.equal(normalized.reports[0].content.summary, '完成验证');
});

test('nextId 在现有编号基础上递增', () => {
  const state = fixedState();
  assert.equal(Core.nextId('T', state.tasks), 'T-1010');
  assert.equal(Core.nextId('BUG', state.bugs), 'BUG-1188');
});

test('recentActivity 按时间倒序返回活动', () => {
  const state = fixedState();
  const activity = Core.recentActivity(state, 10);
  assert.ok(activity.length > 0);
  for (let i = 1; i < activity.length; i += 1) {
    assert.ok(String(activity[i - 1].at) >= String(activity[i].at));
  }
  assert.ok(activity.some((item) => item.kind === 'task'));
  assert.ok(activity.some((item) => item.kind === 'bug'));
});

test('renderRichText parses ZenTao Markdown, lists and file images', () => {
  const source = '**现象**：列表不同步\n\n复现步骤：\n1\\. 打开弹窗；\n2\\. 提交计划。\n\n![原图](/zentao/index.php?m=file&f=read&t=png&fileID=14533)';
  const html = Core.renderRichText(source);
  assert.match(html, /<strong>现象<\/strong>/);
  assert.match(html, /<ol><li>打开弹窗；<\/li><li>提交计划。<\/li><\/ol>/);
  assert.match(html, /src="\/api\/zentao\/file\/14533"/);
  assert.match(html, /<figcaption>原图<\/figcaption>/);
  assert.doesNotMatch(html, /<\/p>\s*<figure/);
});

test('renderRichText sanitizes HTML and resolves ZenTao image URLs', () => {
  const html = Core.renderRichText('<p onclick="x()">说明<img src="{14534.png}" onerror="evil()" alt="局部"></p><script>alert(1)</script>');
  assert.match(html, /<p>说明/);
  assert.match(html, /src="\/api\/zentao\/file\/14534"/);
  assert.match(html, /alt="局部"/);
  assert.doesNotMatch(html, /onclick|onerror|script|alert/);
});

test('renderRichText turns bare URLs into clickable links without nesting', () => {
  const html = Core.renderRichText('查看企微原文链接: https://wecom-ai-alarm.integrity.com.cn/chatRecord?RequestId=2115300516902121472');
  assert.match(html, /<a href="https:\/\/wecom-ai-alarm\.integrity\.com\.cn\/chatRecord\?RequestId=2115300516902121472" target="_blank" rel="noopener noreferrer">/);
  assert.match(html, /查看企微原文链接/);
  const markdown = Core.renderRichText('见 [原文](https://example.com/a?b=1&amp;c=2)');
  assert.equal((markdown.match(/<a /g) || []).length, 1);
  const code = Core.renderRichText('`https://example.com/code` 与 https://example.com/ok');
  assert.equal((code.match(/<a /g) || []).length, 1);
});

test('extractAttachments returns unique ZenTao file references', () => {
  const files = Core.extractAttachments([
    '![原图]({14533.png})',
    '![重复]({14533.png})',
    '![放大](/zentao/index.php?m=file&f=read&t=png&fileID=14534)'
  ]);
  assert.deepEqual(files.map((item) => item.id), ['14533', '14534']);
  assert.equal(files[0].url, '/api/zentao/file/14533');
  assert.equal(files[1].alt, '放大');
});
