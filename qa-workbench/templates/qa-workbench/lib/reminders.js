'use strict';

// 超期 Bug / 任务企微提醒的纯逻辑：配置校验、超期筛选、按开发分组、消息生成。
// 只处理当前账号提交并指派给其他开发的 Bug 和任务。
// 该模块不发起网络请求，便于单元测试，也避免把 Webhook 密钥带到浏览器。

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_LOGS = 20;
const WECOM_TEXT_LIMIT = 2048;
const WEBHOOK_PREFIX = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=';

const DEFAULT_REMINDER_CONFIG = {
  enabled: false,
  webhookUrl: '',
  thresholdDays: 3,
  repeatDays: 3,
  scheduleTime: '09:30',
  weekdays: [1, 2, 3, 4, 5],
  mentionMap: {},
  productIds: [],
  versions: [],
  updatedAt: '',
  lastAutoRunDate: '',
  lastRunAt: '',
  lastRunResult: null
};

const DEFAULT_REMINDER_JOB_NAME = '未命名提醒';
const REMINDER_JOB_ID_PATTERN = /^RJ-\d{1,12}$/;
const MAX_REMINDER_JOBS = 30;

function text(value, maxLength) {
  return String(value == null ? '' : value).slice(0, maxLength || 200);
}

function hasOwn(object, key) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function boolValue(value, fallback) {
  if (value === undefined || value === null) return fallback;
  return value === true || value === 1 || value === '1' || value === 'true';
}

function normalizeWeekdays(value, fallback) {
  const source = Array.isArray(value) ? value : fallback;
  const days = Array.from(new Set((source || [])
    .map((day) => Number(day))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)))
    .sort((a, b) => a - b);
  return days.length ? days : fallback.slice();
}

function normalizeStringList(value, fallback, strict, options) {
  const opts = options || {};
  if (value === undefined || value === null) {
    return Array.isArray(fallback) ? fallback.slice() : [];
  }
  if (!Array.isArray(value)) {
    if (strict) throw badRequest(opts.label ? `${opts.label}必须是数组。` : '列表格式无效。');
    return Array.isArray(fallback) ? fallback.slice() : [];
  }
  const maxLength = opts.maxLength || 100;
  const maxItems = opts.maxItems || 200;
  const pattern = opts.pattern || null;
  const result = [];
  const seen = new Set();
  value.forEach((raw) => {
    const item = String(raw == null ? '' : raw).trim().slice(0, maxLength);
    if (!item) return;
    if (pattern && !pattern.test(item)) {
      if (strict) throw badRequest(`${opts.label || '选项'}「${item}」格式无效。`);
      return;
    }
    if (seen.has(item)) return;
    seen.add(item);
    if (result.length < maxItems) result.push(item);
  });
  return result;
}

function normalizeWebhookUrl(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  let url;
  try {
    url = new URL(raw);
  } catch (error) {
    throw badRequest('企微群机器人 Webhook 地址格式无效。');
  }
  if (url.protocol !== 'https:') {
    throw badRequest('企微群机器人 Webhook 必须使用 https 地址。');
  }
  if (url.hostname !== 'qyapi.weixin.qq.com') {
    throw badRequest('Webhook 必须是企业微信官方群机器人地址（qyapi.weixin.qq.com）。');
  }
  if (!/^\/cgi-bin\/webhook\/send\/?$/.test(url.pathname)) {
    throw badRequest('Webhook 路径应为 /cgi-bin/webhook/send。');
  }
  const key = String(url.searchParams.get('key') || '').trim();
  if (!key || key.length < 8) {
    throw badRequest('Webhook 缺少有效的 key 参数，请在企微群机器人设置中复制完整地址。');
  }
  return `${WEBHOOK_PREFIX}${encodeURIComponent(key)}`;
}

function maskWebhook(value) {
  return value ? `${WEBHOOK_PREFIX}****` : '';
}

const ACCOUNT_PATTERN = /^[A-Za-z0-9_.@-]{1,64}$/;
// 映射键既可以是禅道账号，也可以是开发姓名；姓名允许中文，不能包含空白或分隔符。
const MENTION_KEY_PATTERN = /^[^\s=:：]{1,64}$/u;

function normalizeMentionMap(value, fallback, strict) {
  if (value === undefined || value === null) {
    return Object.assign({}, fallback || {});
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    if (strict) throw badRequest('企微账号映射必须是“禅道账号=企微userid”的对象。');
    return Object.assign({}, fallback || {});
  }
  const map = {};
  Object.entries(value).forEach(([rawKey, rawValue]) => {
    const key = String(rawKey || '').trim();
    const mention = String(rawValue || '').trim();
    if (!MENTION_KEY_PATTERN.test(key)) {
      if (strict) throw badRequest(`企微账号映射中的禅道账号或姓名「${key || '空'}」格式无效。`);
      return;
    }
    if (mention !== '@all' && !ACCOUNT_PATTERN.test(mention)) {
      if (strict) throw badRequest(`企微账号映射中的 userid「${mention || '空'}」格式无效。`);
      return;
    }
    map[key] = mention;
  });
  return map;
}

function normalizeReminderConfig(raw, existing, options) {
  const strict = Boolean(options && options.strict);
  const input = raw && typeof raw === 'object' ? raw : {};
  const base = existing && typeof existing === 'object'
    ? Object.assign({}, DEFAULT_REMINDER_CONFIG, existing)
    : Object.assign({}, DEFAULT_REMINDER_CONFIG);
  const now = new Date().toISOString();

  let webhookUrl = String(base.webhookUrl || '');
  if (input.clearWebhook === true) {
    webhookUrl = '';
  } else if (hasOwn(input, 'webhookUrl')) {
    const rawUrl = String(input.webhookUrl == null ? '' : input.webhookUrl).trim();
    if (rawUrl) {
      try {
        webhookUrl = normalizeWebhookUrl(rawUrl);
      } catch (error) {
        if (strict) throw error;
        webhookUrl = '';
      }
    } else {
      webhookUrl = '';
    }
  }

  const thresholdRaw = hasOwn(input, 'thresholdDays') ? Number(input.thresholdDays) : Number(base.thresholdDays);
  let thresholdDays = Number.isFinite(thresholdRaw) && thresholdRaw >= 1
    ? Math.min(90, Math.round(thresholdRaw))
    : Number(base.thresholdDays) || DEFAULT_REMINDER_CONFIG.thresholdDays;
  if (hasOwn(input, 'thresholdDays') && !(Number.isFinite(thresholdRaw) && thresholdRaw >= 1)) {
    if (strict) throw badRequest('超期天数必须是 1–90 之间的整数。');
    thresholdDays = DEFAULT_REMINDER_CONFIG.thresholdDays;
  }

  const repeatRaw = hasOwn(input, 'repeatDays') ? Number(input.repeatDays) : Number(base.repeatDays);
  const repeatInRange = Number.isFinite(repeatRaw) && repeatRaw >= 0 && repeatRaw <= 90;
  let repeatDays = repeatInRange
    ? Math.round(repeatRaw)
    : Number(base.repeatDays) || 0;
  if (hasOwn(input, 'repeatDays') && !repeatInRange) {
    if (strict) throw badRequest('重复提醒间隔必须是 0–90 之间的整数。');
    repeatDays = DEFAULT_REMINDER_CONFIG.repeatDays;
  }

  const scheduleRaw = hasOwn(input, 'scheduleTime')
    ? String(input.scheduleTime == null ? '' : input.scheduleTime).trim()
    : String(base.scheduleTime || DEFAULT_REMINDER_CONFIG.scheduleTime);
  let scheduleTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(scheduleRaw)
    ? scheduleRaw
    : String(base.scheduleTime || DEFAULT_REMINDER_CONFIG.scheduleTime);
  if (hasOwn(input, 'scheduleTime') && !/^([01]\d|2[0-3]):[0-5]\d$/.test(scheduleRaw)) {
    if (strict) throw badRequest('提醒时间格式无效，请使用 HH:MM。');
    scheduleTime = DEFAULT_REMINDER_CONFIG.scheduleTime;
  }

  const fallbackWeekdays = Array.isArray(base.weekdays) && base.weekdays.length
    ? base.weekdays
    : DEFAULT_REMINDER_CONFIG.weekdays;
  const weekdays = normalizeWeekdays(
    hasOwn(input, 'weekdays') ? input.weekdays : base.weekdays,
    fallbackWeekdays
  );

  const mentionMap = normalizeMentionMap(
    hasOwn(input, 'mentionMap') ? input.mentionMap : base.mentionMap,
    base.mentionMap || {},
    strict
  );

  const productIds = normalizeStringList(
    hasOwn(input, 'productIds') ? input.productIds : base.productIds,
    base.productIds || [],
    strict,
    { label: '产品范围', pattern: /^[A-Za-z0-9_.-]{1,64}$/, maxItems: 100 }
  );
  const versions = normalizeStringList(
    hasOwn(input, 'versions') ? input.versions : base.versions,
    base.versions || [],
    strict,
    { label: '版本范围', maxLength: 100, maxItems: 200 }
  );

  return {
    enabled: hasOwn(input, 'enabled') ? boolValue(input.enabled, base.enabled) : base.enabled !== false,
    webhookUrl,
    thresholdDays,
    repeatDays,
    scheduleTime,
    weekdays,
    mentionMap,
    productIds,
    versions,
    updatedAt: now,
    lastAutoRunDate: text(base.lastAutoRunDate, 10),
    lastRunAt: text(base.lastRunAt, 40),
    lastRunResult: base.lastRunResult && typeof base.lastRunResult === 'object'
      ? base.lastRunResult
      : null
  };
}

function publicReminderConfig(config) {
  const value = config || {};
  return {
    enabled: value.enabled === true,
    configured: Boolean(value.webhookUrl),
    webhookMasked: maskWebhook(value.webhookUrl),
    thresholdDays: Number(value.thresholdDays) || DEFAULT_REMINDER_CONFIG.thresholdDays,
    repeatDays: Number.isFinite(Number(value.repeatDays)) ? Math.max(0, Math.min(90, Math.round(Number(value.repeatDays)))) : DEFAULT_REMINDER_CONFIG.repeatDays,
    scheduleTime: value.scheduleTime || DEFAULT_REMINDER_CONFIG.scheduleTime,
    weekdays: Array.isArray(value.weekdays) ? value.weekdays.slice() : DEFAULT_REMINDER_CONFIG.weekdays.slice(),
    mentionMap: Object.assign({}, value.mentionMap || {}),
    productIds: Array.isArray(value.productIds) ? value.productIds.slice() : [],
    versions: Array.isArray(value.versions) ? value.versions.slice() : [],
    updatedAt: value.updatedAt || '',
    lastAutoRunDate: value.lastAutoRunDate || '',
    lastRunAt: value.lastRunAt || '',
    lastRunResult: value.lastRunResult || null
  };
}

function normalizeReminderJob(raw, existing, options) {
  const strict = Boolean(options && options.strict);
  const input = raw && typeof raw === 'object' ? raw : {};
  const base = existing && typeof existing === 'object' ? existing : {};
  const now = new Date().toISOString();
  const idRaw = String(input.id != null ? input.id : base.id || '').trim();
  let id = idRaw;
  if (id && !REMINDER_JOB_ID_PATTERN.test(id)) {
    if (strict) throw badRequest('定时任务标识无效。');
    id = '';
  }
  const nameRaw = String(input.name != null ? input.name : base.name || '').trim();
  const name = text(nameRaw || DEFAULT_REMINDER_JOB_NAME, 60);
  const config = normalizeReminderConfig(input, base, options);
  const createdAt = input.createdAt && !Number.isNaN(new Date(input.createdAt).getTime())
    ? new Date(input.createdAt).toISOString()
    : (base.createdAt && !Number.isNaN(new Date(base.createdAt).getTime())
      ? new Date(base.createdAt).toISOString()
      : now);
  return Object.assign({}, config, {
    id,
    name,
    createdAt,
    lastSent: normalizeReminderLastSent(base.lastSent)
  });
}

function normalizeReminderJobs(raw) {
  const input = Array.isArray(raw) ? raw : [];
  const jobs = [];
  const seen = new Set();
  input.forEach((item, index) => {
    try {
      const fallbackId = `RJ-${index + 1}`;
      const base = Object.assign({}, item, {
        lastSent: item && item.lastSent
      });
      let job = normalizeReminderJob(
        Object.assign({}, item, { id: item && item.id ? item.id : fallbackId }),
        base,
        { strict: false }
      );
      if (!job.id) job = normalizeReminderJob(Object.assign({}, job, { id: fallbackId }), job, { strict: false });
      if (!job.id || seen.has(job.id)) return;
      seen.add(job.id);
      jobs.push(job);
    } catch (error) {
      // 忽略损坏的单个任务，不阻塞整个配置加载。
    }
  });
  return jobs.slice(0, MAX_REMINDER_JOBS);
}

function publicReminderJob(job) {
  const value = job || {};
  return Object.assign(publicReminderConfig(value), {
    id: REMINDER_JOB_ID_PATTERN.test(String(value.id || '')) ? String(value.id) : '',
    name: text(value.name || DEFAULT_REMINDER_JOB_NAME, 60),
    createdAt: value.createdAt || ''
  });
}

function reminderReferenceAt(bug) {
  const assignedAt = bug && bug.assignedAt ? new Date(bug.assignedAt) : null;
  if (assignedAt && !Number.isNaN(assignedAt.getTime())) return assignedAt.getTime();
  const createdAt = bug && bug.createdAt ? new Date(bug.createdAt) : null;
  if (createdAt && !Number.isNaN(createdAt.getTime())) return createdAt.getTime();
  return NaN;
}

function unhandledDays(bug, now) {
  const reference = reminderReferenceAt(bug);
  if (!Number.isFinite(reference)) return 0;
  const millis = Math.max(0, now.getTime() - reference);
  return Math.floor(millis / DAY_MS);
}

function isUnhandledBug(bug, account) {
  if (!bug || !bug.id) return false;
  const assignee = String(bug.assigneeAccount || '').trim();
  if (!assignee || assignee === account) return false;
  if (String(bug.rawStatus || '') !== 'active') return false;
  if (bug.status === 'closed') return false;
  const mine = bug.isMine === true
    || (account && String(bug.reporterAccount || '') === account);
  return Boolean(mine);
}

const FINISHED_TASK_STATUSES = new Set(['done', 'closed', 'cancel']);

function isUnhandledTask(task, account) {
  if (!task || !task.id) return false;
  const assignee = String(task.assigneeAccount || '').trim();
  if (!assignee || assignee === account) return false;
  if (FINISHED_TASK_STATUSES.has(String(task.rawStatus || ''))) return false;
  if (task.status === 'done' || task.completedAt) return false;
  const mine = task.isOpenedByMe === true
    || (account && String(task.creatorAccount || '') === account);
  return Boolean(mine);
}

function short(value, maxLength) {
  return text(String(value == null ? '' : value).replace(/\s+/g, ' ').trim(), maxLength);
}

function reminderFilters(config) {
  const value = config || {};
  return {
    productIds: Array.isArray(value.productIds) ? value.productIds.map(String) : [],
    versions: Array.isArray(value.versions) ? value.versions.map(String) : []
  };
}

function bugMatchesReminderFilters(bug, filters) {
  const value = filters || {};
  const productIds = Array.isArray(value.productIds) ? value.productIds : [];
  const versions = Array.isArray(value.versions) ? value.versions : [];
  if (productIds.length) {
    const productId = String(bug && bug.productId || '');
    if (!productIds.includes(productId)) return false;
  }
  if (versions.length) {
    const version = String(bug && bug.version || '');
    if (!versions.includes(version)) return false;
  }
  return true;
}

function hasReminderFilters(filters) {
  const value = filters || {};
  return Boolean(
    (Array.isArray(value.productIds) && value.productIds.length)
    || (Array.isArray(value.versions) && value.versions.length)
  );
}

const REMINDER_KEY_PATTERN = /^(bug|task):[A-Za-z0-9_.-]{1,64}:[A-Za-z0-9_.@-]{1,64}$/;
const LAST_SENT_RETENTION_DAYS = 366;

function normalizeReminderLastSent(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const cutoff = Date.now() - LAST_SENT_RETENTION_DAYS * DAY_MS;
  const result = {};
  Object.entries(raw).forEach(([key, value]) => {
    if (!REMINDER_KEY_PATTERN.test(key)) return;
    const at = new Date(value);
    if (Number.isNaN(at.getTime()) || at.getTime() < cutoff) return;
    result[key] = at.toISOString();
  });
  return result;
}

function reminderItemDue(item, thresholdDays, repeatDays) {
  if (!item || !item.reminderKey) return false;
  if (!item.lastRemindedAt) return Number(item.days) >= thresholdDays;
  const repeat = Math.max(0, Number(repeatDays) || 0);
  if (!repeat) return false;
  return Number(item.daysSinceReminded) >= repeat;
}

function reminderTiming(reminderKey, lastSent, now) {
  const raw = lastSent && reminderKey ? lastSent[reminderKey] : '';
  const at = raw ? new Date(raw) : null;
  if (!at || Number.isNaN(at.getTime())) return { lastRemindedAt: '', daysSinceReminded: null };
  return {
    lastRemindedAt: at.toISOString(),
    daysSinceReminded: Math.floor(Math.max(0, now.getTime() - at.getTime()) / DAY_MS)
  };
}

function buildReminderItem(bug, now, moduleNames, lastSent) {
  const moduleId = String(bug.moduleId == null ? '' : bug.moduleId);
  const mappedModule = moduleNames && moduleId ? moduleNames[moduleId] : '';
  const assigneeAccount = String(bug.assigneeAccount || '').trim();
  const reminderKey = assigneeAccount ? `bug:${bug.id}:${assigneeAccount}` : '';
  const timing = reminderTiming(reminderKey, lastSent, now);
  return {
    kind: 'bug',
    id: String(bug.id),
    title: short(bug.title || '未命名 Bug', 80),
    version: short(bug.version || '未填写', 40),
    module: short(mappedModule || bug.module || '未指定', 40),
    product: short(bug.project || '未填写产品', 40),
    severity: short(bug.severity || '', 4),
    statusLabel: short(bug.statusLabel || '激活', 12),
    days: unhandledDays(bug, now),
    assignee: short(bug.assignee || assigneeAccount, 30),
    assigneeAccount,
    reminderKey,
    lastRemindedAt: timing.lastRemindedAt,
    daysSinceReminded: timing.daysSinceReminded,
    isRepeat: Boolean(timing.lastRemindedAt),
    assignedAt: bug.assignedAt || '',
    createdAt: bug.createdAt || '',
    url: short(bug.url || '', 300)
  };
}

function selectReminderBugs(bugs, account, thresholdDays, now, moduleNames, filters, options) {
  const opts = options || {};
  const current = String(account || '').trim();
  const threshold = Math.max(1, Number(thresholdDays) || DEFAULT_REMINDER_CONFIG.thresholdDays);
  const repeatDays = Math.max(0, Number(opts.repeatDays) || 0);
  const lastSent = opts.lastSent || {};
  const at = now instanceof Date ? now : new Date();
  return (Array.isArray(bugs) ? bugs : [])
    .filter((bug) => isUnhandledBug(bug, current) && bugMatchesReminderFilters(bug, filters))
    .map((bug) => buildReminderItem(bug, at, moduleNames, lastSent))
    .filter((item) => (opts.includeAll
      ? Number(item.days) >= threshold
      : reminderItemDue(item, threshold, repeatDays)))
    .sort((a, b) => b.days - a.days || String(a.id).localeCompare(String(b.id)));
}

function buildReminderTaskItem(task, now, moduleNames, lastSent) {
  const moduleId = String(task.moduleId == null ? '' : task.moduleId);
  const mappedModule = moduleNames && moduleId ? moduleNames[moduleId] : '';
  const assigneeAccount = String(task.assigneeAccount || '').trim();
  const reminderKey = assigneeAccount ? `task:${task.id}:${assigneeAccount}` : '';
  const timing = reminderTiming(reminderKey, lastSent, now);
  return {
    kind: 'task',
    id: String(task.id),
    title: short(task.title || '未命名任务', 80),
    version: '',
    module: short(mappedModule || task.module || '未指定', 40),
    product: short(task.project || '未分类项目', 40),
    execution: short(task.execution || '未指定执行', 40),
    dueDate: short(task.dueDate || '', 10),
    severity: '',
    statusLabel: short(task.statusLabel || '未完成', 12),
    days: unhandledDays(task, now),
    assignee: short(task.assignee || assigneeAccount, 30),
    assigneeAccount,
    reminderKey,
    lastRemindedAt: timing.lastRemindedAt,
    daysSinceReminded: timing.daysSinceReminded,
    isRepeat: Boolean(timing.lastRemindedAt),
    assignedAt: task.assignedAt || '',
    createdAt: task.createdAt || '',
    url: short(task.url || '', 300)
  };
}

function selectReminderTasks(tasks, account, thresholdDays, now, moduleNames, filters, options) {
  if (hasReminderFilters(filters)) return [];
  const opts = options || {};
  const current = String(account || '').trim();
  const threshold = Math.max(1, Number(thresholdDays) || DEFAULT_REMINDER_CONFIG.thresholdDays);
  const repeatDays = Math.max(0, Number(opts.repeatDays) || 0);
  const lastSent = opts.lastSent || {};
  const at = now instanceof Date ? now : new Date();
  return (Array.isArray(tasks) ? tasks : [])
    .filter((task) => isUnhandledTask(task, current))
    .map((task) => buildReminderTaskItem(task, at, moduleNames, lastSent))
    .filter((item) => (opts.includeAll
      ? Number(item.days) >= threshold
      : reminderItemDue(item, threshold, repeatDays)))
    .sort((a, b) => b.days - a.days || String(a.id).localeCompare(String(b.id)));
}

function resolveReminderMention(mentionMap, account, name) {
  const map = mentionMap && typeof mentionMap === 'object' ? mentionMap : {};
  const wanted = [account, name]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
  const entry = Object.entries(map).find(([key]) => wanted.includes(String(key || '').trim().toLowerCase()));
  if (entry) {
    const mention = String(entry[1] || '').trim();
    if (mention) return { mention, mapped: true };
  }
  return { mention: String(account || '').trim(), mapped: false };
}

function uniqueShortText(values, maxItems) {
  const seen = new Set();
  const list = [];
  (values || []).forEach((value) => {
    const text = short(String(value == null ? '' : value).trim(), 60);
    if (!text || seen.has(text)) return;
    seen.add(text);
    list.push(text);
  });
  const limit = Math.max(1, Number(maxItems) || 3);
  return list.length > limit
    ? `${list.slice(0, limit).join('、')}等 ${list.length} 个`
    : list.join('、');
}

function buildGroupMessages(group) {
  const mixed = group.bugCount > 0 && group.taskCount > 0;
  const items = Array.isArray(group.items) ? group.items : [];
  let title = 'Bug 超期未处理提醒';
  if (group.taskCount && !group.bugCount) title = '任务超期未处理提醒';
  else if (group.taskCount) title = 'Bug / 任务超期未处理提醒';

  const products = uniqueShortText(items.map((item) => item.product), 3);
  const versions = uniqueShortText(items.map((item) => item.version || item.execution), 3);
  const productLabel = group.taskCount && !group.bugCount ? '项目' : '产品';
  const versionLabel = group.taskCount && !group.bugCount ? '执行' : '版本';
  const scope = [
    products ? `${productLabel}：${products}` : '',
    versions ? `${versionLabel}：${versions}` : ''
  ].filter(Boolean).join('  ');

  const countText = mixed
    ? `${group.count} 项（Bug ${group.bugCount} 个、任务 ${group.taskCount} 个）`
    : group.taskCount
      ? `${group.count} 个任务`
      : `${group.count} 个 Bug`;
  const actionText = group.taskCount ? '处理' : '修复';
  const countGap = group.taskCount ? '' : ' ';
  const prefix = scope ? `  ${scope}  ` : '  ';
  const thresholdDays = Math.max(1, Number(group.thresholdDays) || DEFAULT_REMINDER_CONFIG.thresholdDays);
  // 文案按本组实际超期项中最短的天数展示，不再固定使用任务的超期阈值。
  const overdueDays = Math.max(thresholdDays, Number(group.minDays) || thresholdDays);
  return [`【${title}】\n`
    + `@${group.name || group.account}${prefix}你有 ${countText}${countGap}已超过${overdueDays}天未处理，最长 ${group.maxDays} 天未处理！`
    + `请尽快${actionText}并更新禅道状态！`];
}

function buildReminderGroups(sources, account, config, now, moduleNames) {
  const at = now instanceof Date ? now : new Date();
  const input = Array.isArray(sources) ? { bugs: sources, tasks: [] } : (sources || {});
  const filters = reminderFilters(config);
  const selectionOptions = {
    lastSent: input.lastSent || {},
    repeatDays: config.repeatDays,
    // 手动发送 / 手动预览不受重复提醒间隔影响，始终展示当前全部超期项。
    includeAll: Boolean(input.includeAll)
  };
  const bugs = selectReminderBugs(input.bugs || [], account, config.thresholdDays, at, moduleNames, filters, selectionOptions);
  const tasks = selectReminderTasks(input.tasks || [], account, config.thresholdDays, at, moduleNames, filters, selectionOptions);
  const items = bugs.concat(tasks)
    .sort((a, b) => b.days - a.days || String(a.kind).localeCompare(String(b.kind)) || String(a.id).localeCompare(String(b.id)));
  const map = new Map();
  items.forEach((item) => {
    const accountKey = String(item.assigneeAccount || '').trim();
    if (!accountKey) return;
    if (!map.has(accountKey)) {
      const rawName = String(item.assignee || accountKey).trim() || accountKey;
      const mentionInfo = resolveReminderMention(config.mentionMap, accountKey, rawName);
      map.set(accountKey, {
        account: accountKey,
        name: short(rawName, 30),
        mention: mentionInfo.mention,
        mentionMapped: mentionInfo.mapped,
        count: 0,
        bugCount: 0,
        taskCount: 0,
        repeatCount: 0,
        thresholdDays: Math.max(1, Number(config.thresholdDays) || DEFAULT_REMINDER_CONFIG.thresholdDays),
        minDays: 0,
        maxDays: 0,
        items: [],
        bugs: [],
        tasks: []
      });
    }
    const group = map.get(accountKey);
    group.count += 1;
    if (item.isRepeat) group.repeatCount += 1;
    if (item.kind === 'task') {
      group.taskCount += 1;
      group.tasks.push(item);
    } else {
      group.bugCount += 1;
      group.bugs.push(item);
    }
    group.maxDays = Math.max(group.maxDays, item.days);
    group.minDays = group.minDays ? Math.min(group.minDays, item.days) : item.days;
    group.items.push(item);
  });

  const groups = Array.from(map.values())
    .sort((a, b) => b.count - a.count || b.maxDays - a.maxDays || a.account.localeCompare(b.account));
  groups.forEach((group) => {
    group.messages = buildGroupMessages(group);
    group.message = group.messages[0] || '';
  });
  return groups;
}

function buildReminderOptions(options) {
  const opts = options || {};
  const account = String(opts.account || '').trim();
  const bugs = (Array.isArray(opts.bugs) ? opts.bugs : [])
    .filter((bug) => isUnhandledBug(bug, account));
  const products = new Map();
  (Array.isArray(opts.products) ? opts.products : []).forEach((product) => {
    const id = String(product && product.id || '').trim();
    const name = short(product && product.name || id, 60);
    if (!id) return;
    products.set(id, { id, name, count: 0 });
  });
  const versions = new Map();
  bugs.forEach((bug) => {
    const id = String(bug.productId || '').trim();
    if (id) {
      if (!products.has(id)) products.set(id, { id, name: short(bug.project || id, 60), count: 0 });
      products.get(id).count += 1;
    }
    const version = short(bug.version || '', 100);
    if (!version) return;
    if (!versions.has(version)) versions.set(version, { name: version, count: 0 });
    versions.get(version).count += 1;
  });
  return {
    products: Array.from(products.values())
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN')),
    versions: Array.from(versions.values())
      .sort((a, b) => b.name.localeCompare(a.name, 'zh-CN', { numeric: true }))
  };
}

function filterReminderPreview(preview, accounts) {
  const source = preview || {};
  const selected = (Array.isArray(accounts) ? accounts : [])
    .map((account) => String(account == null ? '' : account).trim())
    .filter(Boolean);
  if (!selected.length) return source;
  const allowed = new Set(selected);
  const groups = (Array.isArray(source.groups) ? source.groups : [])
    .filter((group) => allowed.has(String(group.account || '')));
  const total = groups.reduce((sum, group) => sum + (Number(group.count) || 0), 0);
  const bugTotal = groups.reduce((sum, group) => sum + (Number(group.bugCount) || 0), 0);
  const taskTotal = groups.reduce((sum, group) => sum + (Number(group.taskCount) || 0), 0);
  const repeatCount = groups.reduce((sum, group) => sum + (Number(group.repeatCount) || 0), 0);
  const messageCount = groups.reduce((sum, group) => sum + (Array.isArray(group.messages) ? group.messages.length : 0), 0);
  return Object.assign({}, source, {
    groups,
    total,
    bugTotal,
    taskTotal,
    repeatCount,
    firstCount: Math.max(0, total - repeatCount),
    groupCount: groups.length,
    mentionUnmappedCount: groups.filter((group) => !group.mentionMapped).length,
    messageCount
  });
}

function buildReminderPreview(options) {
  const opts = options || {};
  const now = opts.now instanceof Date ? opts.now : new Date();
  const config = normalizeReminderConfig(opts.config || {}, null, { strict: false });
  const filters = reminderFilters(config);
  const groups = buildReminderGroups(
    {
      bugs: opts.bugs || [],
      tasks: opts.tasks || [],
      lastSent: opts.lastSent || {},
      includeAll: opts.includeAll === true
    },
    opts.account || '',
    config,
    now,
    opts.moduleNames || {}
  );
  const total = groups.reduce((sum, group) => sum + group.count, 0);
  const bugTotal = groups.reduce((sum, group) => sum + group.bugCount, 0);
  const taskTotal = groups.reduce((sum, group) => sum + group.taskCount, 0);
  const repeatCount = groups.reduce((sum, group) => sum + group.repeatCount, 0);
  const messageCount = groups.reduce((sum, group) => sum + group.messages.length, 0);
  return {
    generatedAt: now.toISOString(),
    thresholdDays: config.thresholdDays,
    repeatDays: config.repeatDays,
    scheduleTime: config.scheduleTime,
    weekdays: config.weekdays.slice(),
    productIds: config.productIds.slice(),
    versions: config.versions.slice(),
    filters,
    total,
    bugTotal,
    taskTotal,
    repeatCount,
    firstCount: Math.max(0, total - repeatCount),
    groupCount: groups.length,
    mentionUnmappedCount: groups.filter((group) => !group.mentionMapped).length,
    messageCount,
    configured: Boolean(config.webhookUrl),
    options: buildReminderOptions({
      bugs: opts.bugs || [],
      products: opts.products || [],
      account: opts.account || ''
    }),
    groups
  };
}

function buildWecomPayload(group, message) {
  const mention = group && group.mention ? String(group.mention) : '';
  return {
    msgtype: 'text',
    text: {
      content: String(message || '').slice(0, WECOM_TEXT_LIMIT),
      mentioned_list: mention ? [mention] : []
    }
  };
}

function normalizeReminderLogs(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      at: text(item.at, 40),
      trigger: item.trigger === 'auto' ? 'auto' : 'manual',
      jobId: REMINDER_JOB_ID_PATTERN.test(String(item.jobId || '')) ? String(item.jobId) : '',
      jobName: text(item.jobName, 60),
      ok: item.ok !== false,
      total: Number(item.total) || 0,
      repeatTotal: Number(item.repeatTotal) || 0,
      groupCount: Number(item.groupCount) || 0,
      messageCount: Number(item.messageCount) || 0,
      sent: Number(item.sent) || 0,
      failed: Number(item.failed) || 0,
      error: text(item.error, 500)
    }))
    .filter((item) => item.at)
    .slice(0, MAX_LOGS);
}

function appendReminderLog(logs, entry) {
  const list = normalizeReminderLogs(logs);
  list.unshift(normalizeReminderLogs([entry])[0] || null);
  return list.filter(Boolean).slice(0, MAX_LOGS);
}

function weekdaysText(days) {
  const labels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return (Array.isArray(days) ? days : [])
    .map((day) => labels[Number(day)] || '')
    .filter(Boolean)
    .join('、');
}

module.exports = {
  DAY_MS,
  MAX_LOGS,
  WECOM_TEXT_LIMIT,
  DEFAULT_REMINDER_CONFIG,
  DEFAULT_REMINDER_JOB_NAME,
  REMINDER_JOB_ID_PATTERN,
  MAX_REMINDER_JOBS,
  normalizeReminderConfig,
  normalizeReminderJob,
  normalizeReminderJobs,
  publicReminderConfig,
  publicReminderJob,
  normalizeWebhookUrl,
  maskWebhook,
  reminderReferenceAt,
  unhandledDays,
  isUnhandledBug,
  isUnhandledTask,
  bugMatchesReminderFilters,
  reminderFilters,
  hasReminderFilters,
  normalizeReminderLastSent,
  reminderItemDue,
  selectReminderBugs,
  selectReminderTasks,
  buildReminderTaskItem,
  buildReminderOptions,
  filterReminderPreview,
  buildReminderGroups,
  buildReminderPreview,
  buildGroupMessages,
  buildWecomPayload,
  normalizeReminderLogs,
  appendReminderLog,
  weekdaysText
};
