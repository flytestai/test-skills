'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPORT_FIELDS = ['summary', 'done', 'bugs', 'ongoing', 'next', 'risks'];
const VIEWS = new Set(['dashboard', 'tasks', 'bugs', 'reports', 'settings']);
const TASK_SCOPES = new Set(['mine', 'test']);
const BUG_SCOPES = new Set(['opened', 'assigned', 'all']);

function text(value, maxLength) {
  return String(value == null ? '' : value).slice(0, maxLength || 6000);
}

function isDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
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
  return {
    id: `R-${date}`,
    date,
    status,
    content,
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
      reports: this.getReports()
    };
  }
}

module.exports = {
  Store,
  defaultData,
  normalizeReport,
  normalizeSettings,
  REPORT_FIELDS,
  VIEWS
};
