'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPORT_FIELDS = ['summary', 'version', 'bugsSummary', 'tasks', 'autojob', 'done', 'bugs', 'ongoing', 'next', 'risks'];
const RELEASE_PRIORITIES = ['P1', 'P2', 'P3'];
const TASK_PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const LOCAL_TASK_STATUSES = ['todo', 'doing', 'blocked', 'done'];
const VIEWS = new Set(['dashboard', 'releases', 'tasks', 'bugs', 'reports', 'settings']);
const TASK_SCOPES = new Set(['mine', 'test']);
const BUG_SCOPES = new Set(['opened', 'assigned', 'all']);

function text(value, maxLength) {
  return String(value == null ? '' : value).slice(0, maxLength || 6000);
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function boolValue(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function normalizeTaskDateTime(value, label) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  const candidate = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00` : raw;
  const match = candidate.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
  if (!match || Number.isNaN(new Date(match[1]).getTime())) {
    throw badRequest(`${label || '任务时间'}格式无效，请使用日期和时间。`);
  }
  return match[1];
}

function isDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

function normalizeDateTime(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  const match = raw.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
  if (!match || Number.isNaN(new Date(match[1]).getTime())) {
    const error = new Error('测试时间格式无效，请使用日期和时间。');
    error.status = 400;
    throw error;
  }
  return match[1];
}

function normalizeReleaseKey(value) {
  const key = String(value == null ? '' : value).trim();
  if (!/^[0-9A-Za-z._-]{1,64}$/.test(key)) {
    const error = new Error('版本标识无效。');
    error.status = 400;
    throw error;
  }
  return key;
}

function normalizeReleasePlan(raw, existing) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const base = existing && typeof existing === 'object' ? existing : {};
  const key = normalizeReleaseKey(input.key != null ? input.key : base.key);
  const testStart = normalizeDateTime(input.testStart != null ? input.testStart : base.testStart);
  const testEnd = normalizeDateTime(input.testEnd != null ? input.testEnd : base.testEnd);
  if (testStart && testEnd && testEnd < testStart) {
    const error = new Error('测试结束时间不能早于开始时间。');
    error.status = 400;
    throw error;
  }
  const closedInput = input.closed != null ? input.closed : base.closed;
  const closed = closedInput === true || closedInput === 1 || closedInput === '1' || closedInput === 'true';
  const pinnedInput = input.pinned != null ? input.pinned : base.pinned;
  const pinned = pinnedInput === true || pinnedInput === 1 || pinnedInput === '1' || pinnedInput === 'true';
  const priorityInput = String(input.priority != null ? input.priority : base.priority || '').trim().toUpperCase();
  if (priorityInput && !RELEASE_PRIORITIES.includes(priorityInput)) {
    const error = new Error('发版优先级无效，请选择 P1、P2 或 P3。');
    error.status = 400;
    throw error;
  }
  return {
    key,
    name: text(input.name != null ? input.name : base.name || key, 120).trim() || key,
    testStart,
    testEnd,
    closed,
    pinned,
    priority: priorityInput,
    updatedAt: new Date().toISOString()
  };
}

function normalizeReleasePlans(raw) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const plans = {};
  Object.keys(input).forEach((key) => {
    try {
      const plan = normalizeReleasePlan(Object.assign({}, input[key], { key }), null);
      plans[plan.key] = plan;
    } catch (error) {
      // Ignore invalid saved plans instead of blocking the whole store.
    }
  });
  return plans;
}

function normalizeLocalTaskRecord(raw, fallbackId) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const title = text(input.title, 160).trim();
  if (!title) throw badRequest('任务标题不能为空。');
  const startAt = normalizeTaskDateTime(input.startAt, '任务开始时间');
  const endAt = normalizeTaskDateTime(input.endAt, '任务结束时间');
  if (startAt && endAt && endAt < startAt) throw badRequest('任务结束时间不能早于开始时间。');
  const priority = String(input.priority || 'P2').trim().toUpperCase();
  if (!TASK_PRIORITIES.includes(priority)) throw badRequest('任务优先级无效，请选择 P0、P1、P2 或 P3。');
  const statusInput = String(input.status || 'todo');
  if (!LOCAL_TASK_STATUSES.includes(statusInput)) throw badRequest('任务状态无效。');
  const idRaw = String(input.id || '');
  const id = /^LT-\d{1,12}$/.test(idRaw) ? idRaw : fallbackId;
  const now = new Date().toISOString();
  const createdAt = input.createdAt && !Number.isNaN(new Date(input.createdAt).getTime())
    ? new Date(input.createdAt).toISOString()
    : now;
  const updatedAt = input.updatedAt && !Number.isNaN(new Date(input.updatedAt).getTime())
    ? new Date(input.updatedAt).toISOString()
    : createdAt;
  const status = statusInput;
  const completedAt = status === 'done'
    ? (input.completedAt && !Number.isNaN(new Date(input.completedAt).getTime())
      ? new Date(input.completedAt).toISOString()
      : now)
    : null;
  const history = Array.isArray(input.history)
    ? input.history
      .filter((item) => item && item.at)
      .map((item) => {
        const at = new Date(item.at);
        return {
          at: Number.isNaN(at.getTime()) ? '' : at.toISOString(),
          text: text(item.text, 200)
        };
      })
      .filter((item) => item.at)
      .slice(0, 50)
    : [];
  return {
    id,
    title,
    description: text(input.description, 4000),
    type: '其他',
    priority,
    status,
    project: '本地任务',
    module: '',
    startAt,
    endAt,
    dueDate: endAt ? endAt.slice(0, 10) : '',
    estimate: 0,
    tags: [],
    bugIds: [],
    assignee: '我',
    isMine: true,
    isTest: false,
    isLocal: true,
    pinned: boolValue(input.pinned),
    createdAt,
    updatedAt,
    completedAt,
    history
  };
}

function normalizeLocalTasks(raw) {
  const input = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const tasks = [];
  input.forEach((item, index) => {
    try {
      let task = normalizeLocalTaskRecord(item, `LT-${1001 + index}`);
      if (seen.has(task.id)) task = normalizeLocalTaskRecord(Object.assign({}, item, { id: '' }), `LT-${1001 + index}`);
      if (seen.has(task.id)) return;
      seen.add(task.id);
      tasks.push(task);
    } catch (error) {
      // Ignore invalid local tasks instead of blocking the store.
    }
  });
  return tasks;
}

function nextLocalTaskId(tasks) {
  let max = 1000;
  (tasks || []).forEach((task) => {
    const match = String(task && task.id || '').match(/^LT-(\d+)$/);
    if (match) max = Math.max(max, Number(match[1]));
  });
  return `LT-${max + 1}`;
}

function defaultData() {
  return {
    version: 2,
    settings: {
      profile: {
        role: '测试工程师',
        team: '质量保障组',
        sprint: 'PC客户端'
      },
      preferences: {
        taskView: 'board',
        taskScope: 'mine',
        bugScope: 'opened'
      }
    },
    reports: [],
    releasePlans: {},
    localTasks: [],
    updatedAt: new Date().toISOString()
  };
}

function normalizeReport(raw, existing) {
  const input = raw || {};
  const base = existing || {};
  const date = isDate(input.date) ? String(input.date) : (isDate(base.date) ? base.date : '');
  if (!date) {
    const error = new Error('日报日期无效。');
    error.status = 400;
    throw error;
  }
  const inputContent = input.content && typeof input.content === 'object' ? input.content : {};
  const baseContent = base.content && typeof base.content === 'object' ? base.content : {};
  const content = {};
  REPORT_FIELDS.forEach((field) => {
    content[field] = text(inputContent[field] != null ? inputContent[field] : baseContent[field], 8000);
  });
  const status = input.status === 'submitted' ? 'submitted' : 'draft';
  const now = new Date().toISOString();
  const createdAt = base.createdAt || input.createdAt || now;
  const updatedAt = now;
  const autoGenerated = input.autoGenerated !== undefined
    ? input.autoGenerated === true
    : base.autoGenerated === true;
  const autoUpdatedAt = text(input.autoUpdatedAt != null ? input.autoUpdatedAt : base.autoUpdatedAt, 40) || null;
  return {
    id: `R-${date}`,
    date,
    status,
    content,
    autoGenerated,
    autoUpdatedAt,
    createdAt,
    updatedAt,
    submittedAt: status === 'submitted'
      ? (base.status === 'submitted' && base.submittedAt ? base.submittedAt : now)
      : null
  };
}

function normalizeSettings(raw, existing) {
  const input = raw || {};
  const base = existing || {};
  const inputProfile = input.profile && typeof input.profile === 'object' ? input.profile : {};
  const baseProfile = base.profile && typeof base.profile === 'object' ? base.profile : {};
  const inputPrefs = input.preferences && typeof input.preferences === 'object' ? input.preferences : {};
  const basePrefs = base.preferences && typeof base.preferences === 'object' ? base.preferences : {};
  const profile = {
    role: text(inputProfile.role != null ? inputProfile.role : baseProfile.role, 50).trim() || '测试工程师',
    team: text(inputProfile.team != null ? inputProfile.team : baseProfile.team, 50).trim() || '质量保障组',
    sprint: text(inputProfile.sprint != null ? inputProfile.sprint : baseProfile.sprint, 60).trim() || 'PC客户端'
  };
  const preferences = {
    taskView: (inputPrefs.taskView || basePrefs.taskView) === 'list' ? 'list' : 'board',
    taskScope: TASK_SCOPES.has(inputPrefs.taskScope || basePrefs.taskScope)
      ? (inputPrefs.taskScope || basePrefs.taskScope)
      : 'mine',
    bugScope: BUG_SCOPES.has(inputPrefs.bugScope || basePrefs.bugScope)
      ? (inputPrefs.bugScope || basePrefs.bugScope)
      : 'opened'
  };
  return { profile, preferences };
}

class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = null;
    this.ensure();
  }

  ensure() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      this.data = defaultData();
      this.write(this.data);
      return;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      this.data = this.normalizeData(parsed);
    } catch (error) {
      const backup = `${this.filePath}.broken-${Date.now()}`;
      try { fs.copyFileSync(this.filePath, backup); } catch (copyError) { /* noop */ }
      this.data = defaultData();
      this.write(this.data);
    }
  }

  normalizeData(raw) {
    const base = defaultData();
    const input = raw && typeof raw === 'object' ? raw : {};
    const settings = normalizeSettings(input.settings || base.settings, base.settings);
    const reports = Array.isArray(input.reports)
      ? input.reports.map((report) => {
        try { return normalizeReport(report, report); } catch (error) { return null; }
      }).filter(Boolean)
      : [];
    const deduped = new Map();
    reports.forEach((report) => {
      const existing = deduped.get(report.date);
      if (!existing || String(report.updatedAt) > String(existing.updatedAt)) deduped.set(report.date, report);
    });
    return {
      version: 2,
      settings,
      reports: Array.from(deduped.values()).sort((a, b) => b.date.localeCompare(a.date)),
      releasePlans: normalizeReleasePlans(input.releasePlans),
      localTasks: normalizeLocalTasks(input.localTasks),
      updatedAt: input.updatedAt || new Date().toISOString()
    };
  }

  write(next) {
    const payload = JSON.stringify(next, null, 2);
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, payload, 'utf8');
    fs.renameSync(tmp, this.filePath);
  }

  save() {
    this.data.updatedAt = new Date().toISOString();
    this.write(this.data);
    return this.data;
  }

  getSettings() {
    return this.data.settings;
  }

  updateSettings(raw) {
    this.data.settings = normalizeSettings(raw, this.data.settings);
    this.save();
    return this.data.settings;
  }

  getReports() {
    return this.data.reports.slice().sort((a, b) => b.date.localeCompare(a.date));
  }

  getReleasePlans() {
    return Object.assign({}, this.data.releasePlans);
  }

  getLocalTasks() {
    return this.data.localTasks.map((task) => Object.assign({}, task, {
      history: (task.history || []).map((item) => Object.assign({}, item))
    }));
  }

  createLocalTask(raw) {
    const now = new Date().toISOString();
    const id = nextLocalTaskId(this.data.localTasks);
    const task = normalizeLocalTaskRecord(Object.assign({}, raw, {
      id,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      history: [{ at: now, text: '创建了本地任务' }]
    }), id);
    this.data.localTasks.push(task);
    this.save();
    return Object.assign({}, task, { history: task.history.map((item) => Object.assign({}, item)) });
  }

  updateLocalTask(id, raw) {
    const index = this.data.localTasks.findIndex((task) => task.id === id);
    if (index < 0) {
      const error = new Error('本地任务不存在。');
      error.status = 404;
      throw error;
    }
    const input = raw && typeof raw === 'object' ? raw : {};
    const has = (key) => Object.prototype.hasOwnProperty.call(input, key);
    const existing = this.data.localTasks[index];
    const merged = Object.assign({}, existing, input, { id: existing.id });
    const statusChanged = has('status') && input.status !== existing.status;
    const updated = [
      'title', 'description', 'startAt', 'endAt', 'priority', 'pinned'
    ].some((key) => has(key) && String(input[key] == null ? '' : input[key]) !== String(existing[key] == null ? '' : existing[key]));
    const now = new Date().toISOString();
    const history = (existing.history || []).slice();
    if (statusChanged) {
      const statusLabels = { todo: '待开始', doing: '进行中', blocked: '已阻塞', done: '已完成' };
      history.unshift({
        at: now,
        text: input.status === 'done'
          ? '完成了本地任务'
          : `状态由「${statusLabels[existing.status] || existing.status}」变更为「${statusLabels[input.status] || input.status}」`
      });
    } else if (updated) {
      history.unshift({ at: now, text: '更新了本地任务信息' });
    }
    merged.updatedAt = now;
    merged.history = history.slice(0, 50);
    const task = normalizeLocalTaskRecord(merged, existing.id);
    this.data.localTasks[index] = task;
    this.save();
    return Object.assign({}, task, { history: task.history.map((item) => Object.assign({}, item)) });
  }

  deleteLocalTask(id) {
    const index = this.data.localTasks.findIndex((task) => task.id === id);
    if (index < 0) {
      const error = new Error('本地任务不存在。');
      error.status = 404;
      throw error;
    }
    this.data.localTasks.splice(index, 1);
    this.save();
    return true;
  }

  updateReleasePlan(raw) {
    const input = Object.assign({}, raw);
    const key = normalizeReleaseKey(input.key);
    const existing = this.data.releasePlans[key] || null;
    const plan = normalizeReleasePlan(input, existing);
    if (!plan.testStart && !plan.testEnd && !plan.closed && !plan.pinned && !plan.priority) {
      delete this.data.releasePlans[key];
      this.save();
      return Object.assign({}, plan, { removed: true });
    }
    this.data.releasePlans[key] = plan;
    this.save();
    return plan;
  }

  upsertReport(raw) {
    const date = isDate(raw && raw.date) ? String(raw.date) : '';
    if (!date) {
      const error = new Error('日报日期无效。');
      error.status = 400;
      throw error;
    }
    const index = this.data.reports.findIndex((report) => report.date === date);
    const existing = index >= 0 ? this.data.reports[index] : null;
    const report = normalizeReport(raw, existing);
    if (index >= 0) this.data.reports[index] = report;
    else this.data.reports.push(report);
    this.data.reports.sort((a, b) => b.date.localeCompare(a.date));
    this.save();
    return report;
  }

  snapshot() {
    return {
      settings: this.data.settings,
      reports: this.getReports(),
      releasePlans: this.getReleasePlans(),
      localTasks: this.getLocalTasks()
    };
  }
}

module.exports = {
  Store,
  defaultData,
  normalizeReport,
  normalizeSettings,
  normalizeReleasePlan,
  normalizeReleasePlans,
  normalizeLocalTaskRecord,
  normalizeLocalTasks,
  RELEASE_PRIORITIES,
  TASK_PRIORITIES,
  REPORT_FIELDS,
  VIEWS
};
