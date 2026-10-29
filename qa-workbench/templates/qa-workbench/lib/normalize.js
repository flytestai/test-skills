'use strict';

const TASK_STATUS = {
  wait: { value: 'todo', label: '待开始' },
  doing: { value: 'doing', label: '进行中' },
  pause: { value: 'blocked', label: '已阻塞' },
  done: { value: 'done', label: '已完成' },
  closed: { value: 'done', label: '已关闭' },
  cancel: { value: 'done', label: '已取消' }
};

const BUG_STATUS = {
  active: { value: 'new', label: '激活' },
  resolved: { value: 'verifying', label: '已解决' },
  closed: { value: 'closed', label: '已关闭' }
};

const SEVERITY_LABELS = {
  P0: 'P0 致命',
  P1: 'P1 严重',
  P2: 'P2 一般',
  P3: 'P3 轻微'
};

const SEVERITY_SHORT = {
  1: 'P0',
  2: 'P1',
  3: 'P2',
  4: 'P3'
};

const BUG_TYPES = {
  codeerror: '代码错误',
  config: '配置相关',
  install: '安装部署',
  security: '安全相关',
  performance: '性能问题',
  standard: '标准规范',
  automation: '测试脚本',
  designdefect: '设计缺陷',
  others: '其他'
};

const TASK_TYPES = {
  test: '测试',
  devel: '开发',
  design: '设计',
  study: '研究',
  discuss: '讨论',
  ui: 'UI',
  affair: '事务',
  misc: '其他',
  request: '需求'
};

const RESOLUTIONS = {
  fixed: '已修复',
  duplicate: '重复 Bug',
  bydesign: '设计如此',
  wontfix: '不予修复',
  external: '外部原因',
  postponed: '延期处理',
  notrepro: '无法重现'
};

const FEATURE_RULES = [
  ['自选股', /自选|自定义分组/],
  ['选股', /选股|策略|条件单|智能选股|快速选股/],
  ['个股详情', /个股|详情页/],
  ['行情工具', /全景图|多股同列|区间统计|键盘精灵|指标|训练营/],
  ['行情数据', /行情|沪深|港股|基金|债券|期货|指数|板块|REITs|B股|环球|大盘/],
  ['交易与训练', /模拟交易|交易计划|训练|下单|委托/],
  ['客户端体验', /启动|崩溃|UI|窗口|安装|卸载|登录|升级|进程|MainFrame/],
  ['用户与消息', /用户中心|IM|消息|头像/]
];

function text(value, maxLength) {
  if (value == null) return '';
  return String(value).slice(0, maxLength || 8000);
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : (fallback == null ? 0 : fallback);
}

function toIso(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const candidate = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const date = new Date(candidate);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function dateOnly(value) {
  if (!value) return '';
  const raw = String(value).trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function localDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return localDate();
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function userMap(users) {
  const map = new Map();
  (users || []).forEach((user) => {
    if (!user || !user.account) return;
    map.set(String(user.account), String(user.realname || user.account));
  });
  return map;
}

function realName(users, account) {
  if (!account) return '未指派';
  return users.get(String(account)) || String(account);
}

function priorityValue(value) {
  const raw = number(value, 3);
  return SEVERITY_SHORT[Math.max(1, Math.min(4, raw))] || 'P2';
}

function severityFromRaw(value) {
  return priorityValue(value);
}

function severityRaw(value) {
  if (value == null || value === '') return 3;
  if (typeof value === 'string' && value.startsWith('P')) {
    return Math.max(1, Math.min(4, Number(value.slice(1)) + 1)) || 3;
  }
  return Math.max(1, Math.min(4, number(value, 3)));
}

function bugUiStatus(bug) {
  const raw = String(bug && bug.status || 'active');
  if (raw === 'closed') return 'closed';
  if (raw === 'resolved') return 'verifying';
  if (raw === 'active') {
    return String(bug.confirmed) === '1' ? 'confirmed' : 'new';
  }
  return 'new';
}

function taskUiStatus(value) {
  const meta = TASK_STATUS[String(value || 'wait')];
  return meta ? meta.value : 'todo';
}

function bugStatusLabel(value) {
  const meta = BUG_STATUS[String(value || 'active')];
  return meta ? meta.label : String(value || '激活');
}

function extractFeature(title) {
  const match = String(title || '').match(/^【([^】]{1,30})】/);
  return match ? match[1].trim() : '';
}

function businessCategory(title, feature) {
  const source = feature || extractFeature(title) || String(title || '');
  for (const [label, pattern] of FEATURE_RULES) {
    if (pattern.test(source) || pattern.test(String(title || ''))) return label;
  }
  return feature || '未归类';
}

function moduleLabel(moduleId, moduleNames) {
  const id = String(moduleId == null ? '0' : moduleId);
  if (!id || id === '0') return '未指定';
  const names = moduleNames || {};
  return names[id] || `模块 ${id}`;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractSection(steps, headings) {
  const source = String(steps || '')
    .replace(/\\\[/g, '[')
    .replace(/\\\]/g, ']');
  if (!source) return '';
  const headingPattern = String(headings).split('|').map(escapeRegex).join('|');
  const stopPattern = [
    '预期结果', '预期', '期望', '实际结果', '实际', '结果',
    '复现步骤', '重现步骤', '步骤', '运行环境', '环境', '复现'
  ].map(escapeRegex).join('|');
  const tail = `(?=\\s*(?:\\n\\s*)?(?:\\*\\*(?:${stopPattern})\\*\\*|\\[(?:${stopPattern})\\]|#{1,6}\\s*(?:${stopPattern}))|$)`;
  const patterns = [
    new RegExp(`\\*\\*(?:${headingPattern})\\*\\*\\s*[:：]?[ \\t]*\\n?([\\s\\S]*?)${tail}`, 'i'),
    new RegExp(`\\[(?:${headingPattern})\\]\\s*[:：]?[ \\t]*\\n?([\\s\\S]*?)${tail}`, 'i'),
    new RegExp(`(?:^|\\n)#{1,6}\\s*(?:${headingPattern})\\s*[:：]?[ \\t]*\\n?([\\s\\S]*?)${tail}`, 'i')
  ];
  for (const re of patterns) {
    const match = source.match(re);
    if (!match) continue;
    const value = match[1].trim().replace(/\n{3,}/g, '\n\n');
    if (value) return value;
  }
  return '';
}

function buildUrl(base, suffix) {
  if (!base) return '';
  return `${String(base).replace(/\/+$/, '')}/${suffix}`;
}

function normalizeTask(raw, context) {
  const task = raw || {};
  const ctx = context || {};
  const users = ctx.users || new Map();
  const account = ctx.account || '';
  const exec = ctx.execution || {};
  const projectName = text(task.projectName || exec.projectName || '未分类', 80);
  const executionName = text(task.executionName || exec.name || '', 100);
  const dueFromTask = dateOnly(task.deadline);
  const dueFromExecution = dateOnly(exec.end);
  const dueDate = dueFromTask || dueFromExecution;
  const statusMeta = TASK_STATUS[String(task.status || 'wait')] || TASK_STATUS.wait;
  const openedAt = toIso(task.openedDate) || new Date().toISOString();
  const finishedAt = toIso(task.finishedDate || task.closedDate);
  const assignedAt = toIso(task.assignedDate);
  const type = String(task.type || 'misc');
  const assignedAccount = String(task.assignedTo || '');
  const history = [{ at: openedAt, text: '任务创建于禅道' }];
  if (assignedAt && assignedAt !== openedAt) {
    history.unshift({ at: assignedAt, text: `指派给 ${realName(users, assignedAccount)}` });
  }
  if (finishedAt) {
    history.unshift({ at: finishedAt, text: statusMeta.value === 'done' ? '任务已完成' : `任务状态变更为「${statusMeta.label}」` });
  }
  return {
    id: String(task.id || ''),
    zenId: String(task.id || ''),
    displayId: `#${task.id || ''}`,
    title: text(task.name || '未命名任务', 180),
    description: text(task.desc || '', 8000),
    type: TASK_TYPES[type] || type || '其他',
    rawType: type,
    priority: priorityValue(task.pri),
    status: statusMeta.value,
    rawStatus: String(task.status || 'wait'),
    statusLabel: statusMeta.label,
    project: projectName,
    module: String(task.module && task.module !== '0' ? task.module : ''),
    execution: executionName,
    executionId: String(task.execution || exec.id || ''),
    executionBegin: dateOnly(exec.begin),
    executionEnd: dueFromExecution,
    dueDate,
    dueSource: dueFromTask ? 'task' : dueFromExecution ? 'execution' : '',
    estimate: number(task.estimate),
    consumed: number(task.consumed),
    left: number(task.left),
    tags: [TASK_TYPES[type] ? `${TASK_TYPES[type]}任务` : '', executionName].filter(Boolean).slice(0, 4),
    bugIds: [],
    assignee: realName(users, assignedAccount),
    assigneeAccount: assignedAccount,
    isMine: Boolean(account && assignedAccount === account),
    isTest: type === 'test',
    createdAt: openedAt,
    updatedAt: toIso(task.lastEditedDate || task.finishedDate || task.assignedDate || task.openedDate) || openedAt,
    completedAt: finishedAt,
    history,
    source: 'zentao',
    url: buildUrl(ctx.webUrl, `task-view-${task.id}.html`)
  };
}

function normalizeBug(raw, context) {
  const bug = raw || {};
  const ctx = context || {};
  const users = ctx.users || new Map();
  const account = ctx.account || '';
  const moduleNames = ctx.moduleNames || {};
  const openedBy = String(bug.openedBy || '');
  const assignedTo = String(bug.assignedTo || '');
  const resolvedBy = String(bug.resolvedBy || '');
  const closedBy = String(bug.closedBy || '');
  const autojobAccounts = ctx.autojobAccounts instanceof Set
    ? ctx.autojobAccounts
    : new Set(ctx.autojobAccounts || []);
  const isAutojob = Boolean(openedBy && autojobAccounts.has(openedBy));
  const feature = extractFeature(bug.title);
  const statusMeta = BUG_STATUS[String(bug.status || 'active')] || BUG_STATUS.active;
  const uiStatus = bugUiStatus(bug);
  const openedAt = toIso(bug.openedDate) || new Date().toISOString();
  const assignedAt = toIso(bug.assignedDate);
  const resolvedAt = toIso(bug.resolvedDate);
  const closedAt = toIso(bug.closedDate);
  const updatedAt = toIso(bug.lastEditedDate || bug.resolvedDate || bug.closedDate || bug.openedDate) || openedAt;
  const steps = text(bug.steps || '', 8000);
  const history = [{ at: openedAt, text: `${realName(users, openedBy)} 提交了 Bug` }];
  if (assignedAt && assignedAt !== openedAt) {
    history.unshift({ at: assignedAt, text: `指派给 ${realName(users, assignedTo)}` });
  }
  if (resolvedAt) {
    const resolution = RESOLUTIONS[String(bug.resolution || '')] || String(bug.resolution || '已解决');
    history.unshift({ at: resolvedAt, text: `${realName(users, bug.resolvedBy)} 处理为「${resolution}」` });
  }
  if (closedAt) {
    history.unshift({ at: closedAt, text: `${realName(users, bug.closedBy)} 关闭了 Bug` });
  }
  return {
    id: String(bug.id || ''),
    zenId: String(bug.id || ''),
    displayId: `#${bug.id || ''}`,
    title: text(bug.title || '未命名 Bug', 200),
    severity: severityFromRaw(bug.severity),
    severityRaw: String(severityRaw(bug.severity)),
    severityLabel: SEVERITY_LABELS[severityFromRaw(bug.severity)] || severityFromRaw(bug.severity),
    pri: priorityValue(bug.pri),
    status: uiStatus,
    rawStatus: String(bug.status || 'active'),
    statusLabel: statusMeta.label,
    confirmed: String(bug.confirmed) === '1',
    resolution: String(bug.resolution || ''),
    resolutionLabel: RESOLUTIONS[String(bug.resolution || '')] || '',
    type: String(bug.type || 'others'),
    typeLabel: BUG_TYPES[String(bug.type || 'others')] || '其他',
    project: text(ctx.productName || '禅道产品', 80),
    productId: String(bug.product || ctx.productId || ''),
    moduleId: String(bug.module == null ? '0' : bug.module),
    module: moduleLabel(bug.module, moduleNames),
    feature,
    businessCategory: businessCategory(bug.title, feature),
    version: text(bug.openedBuild || '', 60),
    environment: [bug.os, bug.browser, bug.found].filter(Boolean).join(' · '),
    assignee: realName(users, assignedTo),
    assigneeAccount: assignedTo,
    reporter: realName(users, openedBy),
    reporterAccount: openedBy,
    resolvedByAccount: resolvedBy,
    resolvedByName: realName(users, resolvedBy),
    closedByAccount: closedBy,
    closedByName: realName(users, closedBy),
    isAutojob,
    sourceLabel: isAutojob ? 'AI 客服提取' : '',
    sourceDetail: isAutojob ? '客服群聊记录自动提取' : '',
    reproducibility: '未确认',
    steps,
    expected: extractSection(steps, '预期结果|期望|预期'),
    actual: extractSection(steps, '实际结果|实际|结果'),
    taskId: bug.task && String(bug.task) !== '0' ? String(bug.task) : '',
    createdAt: openedAt,
    updatedAt,
    resolvedAt,
    verifiedAt: closedAt,
    closedAt,
    history,
    isMine: Boolean(account && openedBy === account),
    isAssignedToMe: Boolean(account && assignedTo === account),
    needsMyVerification: Boolean(
      account
      && String(bug.status || '') === 'resolved'
      && (
        assignedTo === account
        || (openedBy === account && resolvedBy !== account)
      )
    ),
    isOpen: uiStatus !== 'closed',
    source: 'zentao',
    url: buildUrl(ctx.webUrl, `bug-view-${bug.id}.html`)
  };
}

function groupCount(items, keyFn, labelFn) {
  const map = new Map();
  (items || []).forEach((item) => {
    const key = keyFn(item);
    const label = labelFn(item, key);
    const current = map.get(key) || { key, label, count: 0 };
    current.count += 1;
    map.set(key, current);
  });
  return Array.from(map.values())
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN'));
}

function buildBugStats(items) {
  const bugs = items || [];
  const open = bugs.filter((bug) => bug.status !== 'closed');
  const today = localDate();
  const byStatus = groupCount(bugs, (bug) => bug.status, (bug) => ({
    new: '新建',
    confirmed: '已确认',
    fixing: '修复中',
    verifying: '待验证',
    closed: '已关闭',
    hold: '已挂起'
  }[bug.status] || bug.status));
  const byRawStatus = groupCount(bugs, (bug) => bug.rawStatus, (bug) => bug.statusLabel);
  const bySeverity = ['P0', 'P1', 'P2', 'P3'].map((key) => ({
    key,
    label: SEVERITY_LABELS[key],
    count: bugs.filter((bug) => bug.severity === key).length
  }));
  const byType = groupCount(bugs, (bug) => bug.type, (bug) => bug.typeLabel);
  const byModule = groupCount(bugs, (bug) => bug.module, (bug) => bug.module);
  const byBusinessCategory = groupCount(bugs, (bug) => bug.businessCategory, (bug) => bug.businessCategory);
  const byCreator = groupCount(bugs, (bug) => bug.reporterAccount || 'unknown', (bug) => bug.reporter);
  const byAssignee = groupCount(bugs, (bug) => bug.assigneeAccount || 'unassigned', (bug) => bug.assignee);
  return {
    total: bugs.length,
    open: open.length,
    closed: bugs.filter((bug) => bug.status === 'closed').length,
    resolved: bugs.filter((bug) => bug.rawStatus === 'resolved').length,
    severeOpen: open.filter((bug) => bug.severity === 'P0' || bug.severity === 'P1').length,
    foundToday: bugs.filter((bug) => localDate(bug.createdAt) === today).length,
    byStatus,
    byRawStatus,
    bySeverity,
    byType,
    byModule,
    byBusinessCategory,
    byCreator,
    byAssignee
  };
}

function autojobRelation(bug, account) {
  if (!bug || !account) return '';
  if (bug.assigneeAccount === account) return 'assigned';
  if (bug.resolvedByAccount === account) return 'resolved';
  if (bug.closedByAccount === account) return 'closed';
  return '';
}

function buildAutojobStats(items, account) {
  const all = items || [];
  const related = all
    .map((bug) => {
      const relation = autojobRelation(bug, account);
      return relation ? { ...bug, autojobRelation: relation } : null;
    })
    .filter(Boolean);
  const active = related.filter((bug) => bug.rawStatus === 'active');
  const resolved = related.filter((bug) => bug.rawStatus === 'resolved');
  const pendingVerification = resolved.filter((bug) => bug.needsMyVerification);
  const closed = related.filter((bug) => bug.rawStatus === 'closed');
  const open = related.filter((bug) => bug.rawStatus !== 'closed');
  const today = localDate();
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDayKey = localDate(sevenDaysAgo.toISOString());
  const severe = open.filter((bug) => bug.severity === 'P0' || bug.severity === 'P1');
  const highPriority = open.filter((bug) => bug.pri === 'P0' || bug.pri === 'P1');
  return {
    total: related.length,
    open: open.length,
    active: active.length,
    resolved: pendingVerification.length,
    resolvedByMe: related.filter((bug) => bug.autojobRelation === 'resolved').length,
    resolvedWaitingOthers: resolved.filter((bug) => !bug.needsMyVerification).length,
    closed: closed.length,
    severeOpen: severe.length,
    highPriorityOpen: highPriority.length,
    highPriorityActive: active.filter((bug) => bug.pri === 'P0' || bug.pri === 'P1').length,
    p0Open: open.filter((bug) => bug.severity === 'P0').length,
    p1Open: open.filter((bug) => bug.severity === 'P1').length,
    createdToday: related.filter((bug) => localDate(bug.createdAt) === today).length,
    createdLast7Days: related.filter((bug) => localDate(bug.createdAt) >= sevenDayKey).length,
    assigned: related.filter((bug) => bug.autojobRelation === 'assigned').length,
    closedByMe: related.filter((bug) => bug.autojobRelation === 'closed').length,
    allTotal: all.length,
    allOpen: all.filter((bug) => bug.rawStatus !== 'closed').length,
    allClosed: all.filter((bug) => bug.rawStatus === 'closed').length,
    byProduct: groupCount(related, (bug) => bug.project || bug.productId || '未分类', (bug) => bug.project || '未分类'),
    byRelation: groupCount(related, (bug) => bug.autojobRelation, (bug) => ({
      assigned: '指派给我',
      resolved: '我已解决',
      closed: '我已关闭'
    }[bug.autojobRelation] || bug.autojobRelation))
  };
}

function buildTaskStats(items) {
  const tasks = items || [];
  return {
    total: tasks.length,
    open: tasks.filter((task) => task.status !== 'done').length,
    doing: tasks.filter((task) => task.status === 'doing').length,
    blocked: tasks.filter((task) => task.status === 'blocked').length,
    tests: tasks.filter((task) => task.isTest).length
  };
}

module.exports = {
  TASK_STATUS,
  BUG_STATUS,
  SEVERITY_LABELS,
  BUG_TYPES,
  TASK_TYPES,
  RESOLUTIONS,
  toIso,
  dateOnly,
  localDate,
  userMap,
  realName,
  priorityValue,
  severityFromRaw,
  severityRaw,
  bugUiStatus,
  taskUiStatus,
  bugStatusLabel,
  businessCategory,
  moduleLabel,
  normalizeTask,
  normalizeBug,
  autojobRelation,
  buildBugStats,
  buildAutojobStats,
  buildTaskStats
};
