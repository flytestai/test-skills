(function () {
  'use strict';

  const Core = window.QAWorkbenchCore;
  const PREF_KEY = 'qdesk.ui.v2';
  const VIEWS = ['dashboard', 'tasks', 'bugs', 'reports', 'settings'];
  const STATUS_COLORS = { todo: '#8592a8', doing: '#4f6ef7', blocked: '#f0783c', done: '#1eab7a' };
  const TASK_STATUS_CLASS = { todo: 'status-todo', doing: 'status-doing', blocked: 'status-blocked', done: 'status-done' };
  const BUG_STATUS_CLASS = { new: 'bug-new', confirmed: 'bug-confirmed', fixing: 'bug-fixing', verifying: 'bug-verifying', closed: 'bug-closed', hold: 'bug-hold' };
  const SEVERITY_CLASS = { P0: 'sev-p0', P1: 'sev-p1', P2: 'sev-p2', P3: 'sev-p3' };
  const SEVERITY_COLOR = { P0: '#e95366', P1: '#f0783c', P2: '#4f6ef7', P3: '#9aa8bd' };
  const KIND_TINT = { task: 'tint-blue', bug: 'tint-red', report: 'tint-teal', system: 'tint-slate' };
  const KIND_ICON = { task: 'tasks', bug: 'bug', report: 'report', system: 'activity' };

  let state = null;
  let ui = null;
  let dragTaskId = null;
  let lastFocus = null;
  let confirmResolve = null;
  let commandItems = [];
  let commandIndex = 0;
  let bootError = null;
  let syncing = false;
  let fetching = false;
  let pollTimer = null;
  let lastRevision = -1;

  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));

  function icon(name, className) {
    return `<svg class="${className || ''}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

  const esc = escapeHtml;

  function avatarInitial(value) {
    const text = String(value == null ? '' : value).trim() || 'QA';
    return /[㐀-鿿]/.test(text) ? text.slice(0, 1) : text.slice(0, 2).toUpperCase();
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function fmtFullDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function timeAgo(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const diff = Date.now() - d.getTime();
    if (diff < 0) return fmtDateTime(iso);
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    if (hours < 48) return `昨天 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    if (hours < 24 * 7) return `${Math.floor(hours / 24)} 天前`;
    return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function weekday(dateStr) {
    const d = new Date(`${dateStr}T12:00:00`);
    if (Number.isNaN(d.getTime())) return '';
    return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  }

  function greeting() {
    const hour = new Date().getHours();
    if (hour < 6) return '夜深了';
    if (hour < 12) return '早上好';
    if (hour < 14) return '中午好';
    if (hour < 18) return '下午好';
    return '晚上好';
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function loadUiPrefs() {
    try {
      const raw = localStorage.getItem(PREF_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function persistState() {
    const prefs = {
      view: ui.view,
      taskView: ui.taskView,
      taskScope: ui.taskScope,
      bugScope: ui.bugScope,
      bugSort: ui.bugSort,
      reportDate: ui.reportDate
    };
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
    } catch (error) {
      // UI preferences are optional; the server remains the source of truth.
    }
  }

  async function apiRequest(path, options) {
    const opts = options || {};
    const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 60000;
    let response;
    let timeoutTimer = null;
    try {
      let signal;
      if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        signal = AbortSignal.timeout(timeoutMs);
      } else {
        const controller = new AbortController();
        timeoutTimer = setTimeout(() => controller.abort(), timeoutMs);
        signal = controller.signal;
      }
      response = await fetch(path, {
        method: opts.method || 'GET',
        headers: Object.assign({ Accept: 'application/json' }, opts.body ? { 'Content-Type': 'application/json' } : {}),
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        cache: 'no-store',
        signal
      });
    } catch (error) {
      if (error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new Error(`本地服务响应超时（${Math.round(timeoutMs / 1000)} 秒），请稍后重试。`);
      }
      throw error;
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      throw new Error(`本地服务返回了无法解析的内容（HTTP ${response.status}）。`);
    }
    if (!response.ok || !payload || payload.ok === false) {
      const message = payload && payload.error && payload.error.message
        ? payload.error.message
        : `请求失败（HTTP ${response.status}）。`;
      const error = new Error(message);
      error.code = payload && payload.error && payload.error.code;
      throw error;
    }
    return payload.data;
  }

  function visibleTasks() {
    if (ui.taskScope === 'all') return state.allTasks;
    if (ui.taskScope === 'test') return state.allTasks.filter((task) => task.isTest);
    return state.allTasks.filter((task) => task.isMine);
  }

  function visibleBugs() {
    if (ui.bugScope === 'assigned') return state.allBugs.filter((bug) => bug.isAssignedToMe);
    if (ui.bugScope === 'autojob') return state.autojobBugs || [];
    if (ui.bugScope === 'all') return state.allBugs;
    return state.allBugs.filter((bug) => bug.isMine);
  }

  function scopedBugStats() {
    return classifyBugs(visibleBugs());
  }

  function applySnapshot(data) {
    const preferences = data.settings && data.settings.preferences ? data.settings.preferences : {};
    const local = loadUiPrefs();
    const priorDate = ui && ui.reportDate;
    state = {
      version: 2,
      profile: Object.assign({}, data.profile),
      products: Array.isArray(data.products) ? data.products.slice() : [],
      projects: Array.isArray(data.projects) ? data.projects.slice() : [],
      projectList: Array.isArray(data.projectList) ? data.projectList.slice() : [],
      preferences: preferences,
      tasks: Array.isArray(data.tasks) ? data.tasks.filter((task) => task.isMine) : [],
      allTasks: Array.isArray(data.tasks) ? data.tasks : [],
      bugs: Array.isArray(data.bugs) ? data.bugs.filter((bug) => bug.isMine) : [],
      allBugs: Array.isArray(data.bugs) ? data.bugs : [],
      autojob: data.autojob || null,
      autojobBugs: data.autojob && Array.isArray(data.autojob.bugs) ? data.autojob.bugs : [],
      autojobStats: data.autojob && data.autojob.summary ? data.autojob.summary : null,
      bugStats: data.bugStats || null,
      bugScopeStats: data.bugScopeStats || null,
      taskStats: data.taskStats || null,
      scopeCounts: data.scopeCounts || null,
      reports: Array.isArray(data.reports) ? data.reports : [],
      creation: data.creation || null,
      sync: data.sync || null,
      syncState: data.syncState || null,
      zentao: data.zentao || null,
      settings: data.settings || null,
      generatedAt: data.generatedAt || Core.nowIso()
    };
    if (!ui) {
      ui = {
        view: syncFromHash(),
        bugDetailId: parseHash().bugId,
        bugEditing: parseHash().bugEditing,
        taskView: 'board',
        taskScope: 'mine',
        bugScope: 'opened',
        taskFilters: { q: '', status: 'all', priority: 'all', project: 'all', due: 'all' },
        bugFilters: { q: '', status: 'all', severity: 'all', type: 'all', product: 'all' },
        bugSort: { key: 'updatedAt', dir: 'desc' },
        reportDate: Core.localDate(),
        drawer: null
      };
    }
    if (!ui.bugFilters) ui.bugFilters = { q: '', status: 'all', severity: 'all', type: 'all', product: 'all' };
    if (!ui.bugFilters.product) ui.bugFilters.product = 'all';
    if (!ui.bugSort) ui.bugSort = { key: 'updatedAt', dir: 'desc' };
    ui.taskView = (local.taskView || preferences.taskView) === 'list' ? 'list' : 'board';
    ui.taskScope = ['mine', 'test', 'all'].includes(local.taskScope || preferences.taskScope)
      ? (local.taskScope || preferences.taskScope)
      : 'mine';
    ui.bugScope = ['opened', 'assigned', 'autojob', 'all'].includes(local.bugScope || preferences.bugScope)
      ? (local.bugScope || preferences.bugScope)
      : 'opened';
    ui.bugSort = local.bugSort && ['createdAt', 'updatedAt'].includes(local.bugSort.key)
      ? { key: local.bugSort.key, dir: local.bugSort.dir === 'asc' ? 'asc' : 'desc' }
      : ui.bugSort;
    syncing = Boolean(state.syncState && state.syncState.syncing);
    const reportDate = local.reportDate || priorDate;
    ui.reportDate = reportDate && /^\d{4}-\d{2}-\d{2}$/.test(reportDate) ? reportDate : Core.localDate();
    if (!state.reports.some((report) => report.date === ui.reportDate) && state.reports.length) {
      ui.reportDate = state.reports[0].date;
    }
  }

  function setSyncChrome() {
    const button = $('#sync-button');
    if (!button) return;
    button.classList.toggle('is-syncing', syncing);
    button.disabled = syncing;
    const label = $('#sync-label');
    const dot = $('#sync-dot');
    const sidebar = $('#sidebar-sync-text');
    if (syncing) {
      if (label) label.textContent = '后台同步中';
      if (dot) dot.className = 'sync-dot syncing';
      if (sidebar) sidebar.textContent = '后台同步中 · 页面可继续使用';
      return;
    }
    if (bootError && !state) {
      if (label) label.textContent = '连接失败';
      if (dot) dot.className = 'sync-dot error';
      if (sidebar) sidebar.textContent = '本地服务未连接';
      return;
    }
    if (!state || !state.sync || !state.sync.lastSyncAt) {
      if (label) label.textContent = '等待同步';
      return;
    }
    const at = new Date(state.sync.lastSyncAt);
    const time = Number.isNaN(at.getTime())
      ? '—'
      : `${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
    if (label) label.textContent = `${time} 已同步`;
    if (dot) dot.className = state.syncState && state.syncState.lastError ? 'sync-dot error' : 'sync-dot';
    if (sidebar) {
      const productCount = (state.products || []).length;
      sidebar.textContent = `${state.zentao.account} · ${productCount} 个产品 / ${state.allTasks.length} 项任务 / ${state.allBugs.length} 个 Bug`;
    }
  }

  function guardReady() {
    if (state) return true;
    showToast(
      bootError ? '本地服务尚未连接，请先重新连接。' : '正在连接禅道并读取数据，请稍候…',
      bootError ? 'warn' : 'info'
    );
    return false;
  }

  async function pullData(options) {
    const opts = options || {};
    if (fetching) return false;
    fetching = true;
    bootError = null;
    try {
      const data = await apiRequest('/api/bootstrap');
      const background = Boolean(data.syncState && data.syncState.syncing);
      if (!data.sync || !data.sync.lastSyncAt) {
        state = null;
        syncing = background;
        renderBootScreen();
        setSyncChrome();
        schedulePolling(2500);
        return true;
      }
      applySnapshot(data);
      syncing = background;
      lastRevision = data.syncState ? data.syncState.revision : lastRevision;
      if (opts.initial || !$('#view-root').children.length) {
        renderView(true);
        renderNotificationPanel();
        updateNotificationBadge();
      } else {
        refreshAll({ animate: false });
        if (!opts.silent) {
          showToast(`禅道数据已更新：${state.allTasks.length} 项任务，${state.allBugs.length} 个 Bug。`);
        }
      }
      setSyncChrome();
      schedulePolling();
      return true;
    } catch (error) {
      bootError = error;
      if (!state) {
        renderBootError(error);
      } else if (!opts.silent) {
        showToast(`本地服务暂时不可用：${error.message}`, 'error');
      }
      setSyncChrome();
      schedulePolling(15000);
      return false;
    } finally {
      fetching = false;
    }
  }

  function schedulePolling(delayMs) {
    if (pollTimer) clearTimeout(pollTimer);
    const busy = syncing || !state || !state.sync || !state.sync.lastSyncAt;
    pollTimer = setTimeout(pollStatus, delayMs == null ? (busy ? 2500 : 45000) : delayMs);
  }

  let manualSyncPending = false;

  async function pollStatus() {
    if (fetching) {
      schedulePolling(1500);
      return;
    }
    try {
      const meta = await apiRequest('/api/bootstrap?meta=1');
      const next = meta.syncState || {};
      const changed = Number(next.revision) !== Number(lastRevision);
      syncing = Boolean(next.syncing);
      if (changed) {
        bootError = null;
        const wasManual = manualSyncPending;
        manualSyncPending = false;
        await pullData({ silent: true });
        if (wasManual && state && state.sync && state.sync.lastSyncAt) {
          showToast(`禅道已同步：${state.allTasks.length} 项任务，${state.allBugs.length} 个 Bug。`);
        }
        return;
      }
      if (next.lastError && !state) {
        bootError = new Error(next.lastError);
        renderBootError(bootError);
        setSyncChrome();
        schedulePolling(15000);
        return;
      }
      if (next.lastError && state && state.syncState) {
        state.syncState.lastError = next.lastError;
      }
      setSyncChrome();
      schedulePolling(syncing ? 2500 : 45000);
    } catch (error) {
      schedulePolling(15000);
    }
  }

  async function startManualSync() {
    if (syncing) {
      showToast('后台正在同步，请稍候。', 'info');
      return;
    }
    try {
      await apiRequest('/api/sync', { method: 'POST' });
      manualSyncPending = true;
      syncing = true;
      setSyncChrome();
      schedulePolling(2000);
      showToast('已开始后台同步，当前页面可以继续使用。', 'info');
    } catch (error) {
      showToast(`同步请求失败：${error.message}`, 'error');
    }
  }

  function renderBootScreen() {
    const root = $('#view-root');
    if (!root) return;
    $('#page-eyebrow').textContent = 'ZENTAO / BACKGROUND SYNC';
    $('#page-title').textContent = '正在准备数据';
    $('#page-subtitle').textContent = '首次读取在后台进行，页面打开不会被禅道同步阻塞。';
    root.innerHTML = `<div class="boot-screen">
      <div class="boot-mark"><span class="spinner"></span></div>
      <h2>正在后台读取禅道数据</h2>
      <p>正在拉取当前账号可访问的产品、项目、Bug 与任务。完成后会自动展示，无需刷新页面。</p>
      <div class="boot-skeleton">
        <span></span><span></span><span></span>
      </div>
      <small>同步期间可以继续使用其他本地功能。</small>
    </div>`;
  }

  function renderBootError(error) {
    const root = $('#view-root');
    if (!root) return;
    $('#page-eyebrow').textContent = 'ZENTAO / OFFLINE';
    $('#page-title').textContent = '本地服务未连接';
    $('#page-subtitle').textContent = '请确认 Node 服务与禅道 CLI 可用。';
    root.innerHTML = `<div class="boot-screen boot-error">
      <div class="boot-mark error">${icon('alert-triangle')}</div>
      <h2>读取禅道数据失败</h2>
      <p>${esc(error && error.message ? error.message : '本地服务暂时不可用。')}</p>
      <div class="boot-actions">
        <button class="btn btn-primary" type="button" data-action="configure-connection">${icon('database')}配置禅道连接</button>
        <button class="btn" type="button" data-action="retry-boot">${icon('refresh')}重新连接</button>
      </div>
      <small>请先在「配置禅道连接」中填写 URL、账号和密码；也可以继续使用本机禅道 CLI 已登录的凭证。</small>
    </div>`;
  }

  function taskById(id) {
    return state.allTasks.find((task) => task.id === id) || state.tasks.find((task) => task.id === id) || null;
  }

  function bugById(id) {
    return state.allBugs.find((bug) => bug.id === id)
      || state.bugs.find((bug) => bug.id === id)
      || (state.autojobBugs || []).find((bug) => bug.id === id)
      || null;
  }

  function projectOptions(selected) {
    const projects = Array.from(new Set([...(state.projects || []), selected].filter(Boolean)));
    return projects.map((project) => `<option value="${esc(project)}"${project === selected ? ' selected' : ''}>${esc(project)}</option>`).join('');
  }

  function statusOptions(map, selected) {
    return Object.keys(map).map((key) => `<option value="${key}"${key === selected ? ' selected' : ''}>${map[key].label}</option>`).join('');
  }

  function priorityOptions(selected) {
    return Object.keys(Core.SEVERITY).map((key) => `<option value="${key}"${key === selected ? ' selected' : ''}>${Core.SEVERITY[key].label}</option>`).join('');
  }

  function typeOptions(selected) {
    return Core.TASK_TYPES.map((type) => `<option value="${esc(type)}"${type === selected ? ' selected' : ''}>${esc(type)}</option>`).join('');
  }

  function reproOptions(selected) {
    return Core.REPRO.map((value) => `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(value)}</option>`).join('');
  }

  function taskStatusPill(status) {
    const meta = Core.TASK_STATUS[status] || Core.TASK_STATUS.todo;
    return `<span class="status-pill ${TASK_STATUS_CLASS[status] || 'status-todo'}">${esc(meta.label)}</span>`;
  }

  function bugStatusLabel(bug) {
    if (bug && bug.isAutojob && bug.rawStatus === 'active' && bug.autojobRelation === 'assigned') {
      return '待验证';
    }
    if (bug && bug.status === 'verifying' && bug.needsMyVerification === false && bug.autojobRelation === 'resolved') {
      return '我已解决';
    }
    return (Core.BUG_STATUS[bug && bug.status] || Core.BUG_STATUS.new).label;
  }

  function bugStatusPill(status, bug) {
    const label = bug ? bugStatusLabel(bug) : (Core.BUG_STATUS[status] || Core.BUG_STATUS.new).label;
    return `<span class="status-pill ${BUG_STATUS_CLASS[status] || 'bug-new'}">${esc(label)}</span>`;
  }

  function severityBadge(severity) {
    return `<span class="severity-badge ${SEVERITY_CLASS[severity] || 'sev-p3'}">${esc(severity)}</span>`;
  }

  function priorityDot(priority) {
    return `<span class="priority-dot ${String(priority).toLowerCase()}" title="${esc(priority)}"></span>`;
  }

  function dueChip(task) {
    if (!task.dueDate) return '<span class="due-chip">未设置日期</span>';
    const today = Core.localDate();
    const isOverdue = task.dueDate < today && task.status !== 'done';
    const isToday = task.dueDate === today;
    const label = Core.relativeDay(task.dueDate, today);
    return `<span class="due-chip ${isOverdue ? 'overdue' : isToday ? 'today' : ''}">${icon('calendar')}${esc(label)}</span>`;
  }

  function tagList(tags) {
    return (tags || []).map((tag) => `<span class="mini-tag">${esc(tag)}</span>`).join('');
  }

  function pageMeta(view) {
    const m = Core.metrics(state);
    if (view === 'bugs' && ui && ui.bugDetailId) {
      const bug = bugById(ui.bugDetailId);
      if (bug) {
        return {
          eyebrow: ui.bugEditing ? 'ZENTAO / BUG EDIT' : 'ZENTAO / BUG DETAIL',
          title: ui.bugEditing ? `编辑 Bug ${bug.displayId || '#' + bug.id}` : `Bug ${bug.displayId || '#' + bug.id}`,
          subtitle: `${bug.title} · ${bug.project || '未归属产品'} · ${bug.statusLabel}`
        };
      }
    }
    switch (view) {
      case 'tasks':
        return {
          eyebrow: 'ZENTAO / TASKS',
          title: '测试任务',
          subtitle: `${state.allTasks.length} 项任务 · ${(state.projectList || []).length} 个项目 · 按项目自动归类`
        };
      case 'bugs':
        return {
          eyebrow: 'QUALITY / BUG TRACKER',
          title: 'Bug 跟踪',
          subtitle: `${state.allBugs.length} 个账号相关 Bug · ${(state.products || []).length} 个产品 · 按更新时间排序`
        };
      case 'reports':
        return {
          eyebrow: 'WORKSPACE / DAILY LOG',
          title: '工作日报',
          subtitle: '自动采集当日禅道任务与 Bug 进展，保存在本地服务。'
        };
      case 'settings':
        return {
          eyebrow: 'SYSTEM / SETTINGS',
          title: '偏好与数据',
          subtitle: '查看禅道连接、同步范围与本地日报存储。'
        };
      default:
        return {
          eyebrow: 'ZENTAO / OVERVIEW',
          title: 'QDesk 工作台',
          subtitle: `${state.profile.name}的测试节奏 · ${(state.products || []).length} 个产品 / ${(state.projectList || []).length} 个项目 · 同步于 ${fmtDateTime(state.sync && state.sync.lastSyncAt)}`
        };
    }
  }

  function updateChrome() {
    if (!state || !ui) return;
    const meta = pageMeta(ui.view);
    $('#page-eyebrow').textContent = meta.eyebrow;
    $('#page-title').textContent = meta.title;
    $('#page-subtitle').textContent = meta.subtitle;
    $$('.nav-item[data-view]').forEach((item) => {
      item.classList.toggle('active', item.dataset.view === ui.view);
    });
    const openTasks = state.tasks.filter((task) => task.status !== 'done').length;
    const openBugs = state.bugs.filter((bug) => bug.status !== 'closed').length;
    $('#nav-task-count').textContent = String(openTasks);
    $('#nav-bug-count').textContent = String(openBugs);
    $('#sidebar-name').textContent = state.profile.name;
    $('#sidebar-role').textContent = state.profile.role;
    $('#sidebar-sprint').textContent = state.profile.sprint || 'PC客户端';
    const initials = avatarInitial(state.profile.avatar || state.profile.name);
    $('#sidebar-avatar').textContent = initials;
    $('#header-avatar').textContent = initials;
    setSyncChrome();
  }

  function updateNotificationBadge() {
    const items = getNotifications();
    $('#notification-dot').hidden = items.length === 0;
    $('#notification-btn').setAttribute('aria-label', items.length ? `查看 ${items.length} 条提醒` : '暂无提醒');
  }

  function renderView(animate) {
    updateChrome();
    const renderers = {
      dashboard: renderDashboard,
      tasks: renderTasks,
      bugs: renderBugs,
      reports: renderReports,
      settings: renderSettings
    };
    const html = (renderers[ui.view] || renderDashboard)();
    $('#view-root').innerHTML = `<div class="${animate === false ? '' : 'view-enter'}">${html}</div>`;
    $('#view-root').classList.toggle('is-command-open', false);
    updateNotificationBadge();
    if (ui.view === 'reports') autoGrowReportTextareas();
  }

  function refreshAll(options) {
    const opts = options || {};
    renderView(opts.animate === true);
    if (ui.drawer) renderDrawer();
    renderNotificationPanel();
    updateNotificationBadge();
  }

  function navigate(view) {
    if (!guardReady()) return;
    closeQuickMenu();
    closeNotifications();
    closeSidebar();
    if (!VIEWS.includes(view)) view = 'dashboard';
    ui.view = view;
    ui.bugDetailId = null;
    ui.bugEditing = false;
    const nextHash = `#/${view}`;
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
    renderView(true);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function parseHash() {
    const raw = (window.location.hash || '').replace(/^#\/?/, '').split('?')[0];
    const parts = raw.split('/');
    const view = VIEWS.includes(parts[0]) ? parts[0] : 'dashboard';
    const bugId = view === 'bugs' && /^\d{1,12}$/.test(parts[1] || '') ? parts[1] : null;
    const bugEditing = Boolean(bugId) && parts[2] === 'edit';
    return { view, bugId, bugEditing };
  }

  function syncFromHash() {
    return parseHash().view;
  }

  /* =========================================================
     Dashboard
     ========================================================= */

  function autojobOpenBugs() {
    const order = { P0: 0, P1: 1, P2: 2, P3: 3 };
    const statusOrder = { active: 0, verifying: 1, confirmed: 2, new: 0, closed: 9 };
    return (state.autojobBugs || [])
      .filter((bug) => bug.rawStatus !== 'closed')
      .slice()
      .sort((a, b) => {
        const byStatus = (statusOrder[a.status] == null ? 5 : statusOrder[a.status]) - (statusOrder[b.status] == null ? 5 : statusOrder[b.status]);
        if (byStatus) return byStatus;
        const byPriority = (order[a.pri] == null ? 9 : order[a.pri]) - (order[b.pri] == null ? 9 : order[b.pri]);
        if (byPriority) return byPriority;
        return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
      });
  }

  function autojobBanner() {
    const info = state.autojob;
    if (!info || !info.enabled) return '';
    const stats = state.autojobStats || {};
    const account = (info.accounts && info.accounts[0]) || 'autojob';
    return `<section class="autojob-banner" aria-label="客服反馈概览">
      <span class="autojob-mark">${icon('message')}</span>
      <div class="autojob-copy">
        <div class="autojob-kicker"><span class="live-dot"></span>客服群聊 · AI 自动提取 · 每日关注</div>
        <h2>${esc(account)} 指派给我的客户反馈</h2>
        <p>${esc(info.description || '来自客服群聊天记录，自动提取为禅道 Bug')}。优先处理待验证与 P0/P1，已解决项等待客服或提交人确认。</p>
      </div>
      <div class="autojob-numbers">
        <div><strong>${stats.active || 0}</strong><span>待验证</span></div>
        <div><strong>${stats.resolvedByMe || 0}</strong><span>我已解决</span></div>
        <div><strong>${stats.closed || 0}</strong><span>已关闭</span></div>
        <div class="${stats.highPriorityOpen ? 'is-warn' : ''}"><strong>${stats.highPriorityOpen || 0}</strong><span>P0/P1 未关闭</span></div>
      </div>
      <button class="btn btn-primary autojob-cta" type="button" data-action="open-autojob">查看队列 ${icon('arrow-right')}</button>
    </section>`;
  }

  function autojobPanel() {
    const info = state.autojob;
    if (!info || !info.enabled) return '';
    const stats = state.autojobStats || {};
    const rows = autojobOpenBugs().slice(0, 6);
    const today = Core.localDate();
    return `<section class="panel autojob-panel">
      <div class="panel-head">
        <div><h2>客服反馈跟进</h2><p>AI 从客服群聊提取，按优先级排列</p></div>
        <span class="role-badge role-badge-warm">${stats.open || 0} 未关闭</span>
      </div>
      <div class="autojob-list">
        ${rows.length ? rows.map((bug) => `
          <button class="autojob-row" type="button" data-action="open-bug" data-id="${esc(bug.id)}">
            <span title="禅道优先级">${severityBadge(bug.pri)}</span>
            <span class="autojob-row-main">
              <strong>${esc(bug.title)}</strong>
              <small>${esc(bug.project)}<span class="sep"></span>${esc(bugStatusLabel(bug))}<span class="sep"></span>${esc(Core.relativeDay(String(bug.createdAt || '').slice(0, 10), today))}</small>
            </span>
            <span class="autojob-row-meta">
              ${bug.autojobRelation === 'assigned' ? '<span class="source-badge">待验证</span>' : '<span class="source-badge is-soft">我已解决</span>'}
              ${icon('chevron-right')}
            </span>
          </button>`).join('') : `
          <div class="autojob-empty">${icon('check-circle')}<span>当前没有未关闭的客服反馈</span></div>`}
      </div>
      <div class="autojob-foot">
        <span>今日新增 <b>${stats.createdToday || 0}</b> · 近 7 天 <b>${stats.createdLast7Days || 0}</b> · 共 ${stats.total || 0} 条</span>
        <button class="text-link" type="button" data-action="open-autojob">全部反馈 ${icon('arrow-right')}</button>
      </div>
    </section>`;
  }

  function renderDashboard() {
    const m = Core.metrics(state);
    const today = Core.localDate();
    const todayLabel = Core.formatDateCN(today, true);
    const focusCandidates = state.tasks
      .filter((task) => task.status !== 'done' && (
        task.dueDate === today
        || (task.dueDate && task.dueDate < today)
        || task.status === 'doing'
        || task.status === 'blocked'
      ));
    const heroFocusCount = Array.from(new Map(focusCandidates.map((task) => [task.id, task])).values()).length;
    const focusTasks = focusCandidates
      .sort((a, b) => {
        if (a.status === 'blocked' && b.status !== 'blocked') return -1;
        if (a.status !== 'blocked' && b.status === 'blocked') return 1;
        const pa = Core.SEVERITY[a.priority].order;
        const pb = Core.SEVERITY[b.priority].order;
        if (pa !== pb) return pa - pb;
        return String(a.dueDate || '').localeCompare(String(b.dueDate || ''));
      })
      .slice(0, 6);

    const week = Core.weekSeries(state, today);
    const weekTotals = week.reduce((acc, day) => {
      acc.tasks += day.tasksDone;
      acc.bugs += day.bugsFound;
      acc.verified += day.bugsVerified;
      return acc;
    }, { tasks: 0, bugs: 0, verified: 0 });
    const maxWeek = Math.max(1, ...week.flatMap((day) => [day.tasksDone, day.bugsFound, day.bugsVerified]));
    const severity = Core.severityCounts(state.bugs);
    const maxSeverity = Math.max(1, ...Object.values(severity));
    const severe = state.bugs.filter((bug) => bug.status !== 'closed' && (bug.severity === 'P0' || bug.severity === 'P1'));
    const activity = Core.recentActivity(state, 5);
    const reportStatus = m.reportStatus;
    const reportValue = reportStatus === 'submitted' ? '已提交' : reportStatus === 'draft' ? '草稿待提交' : '未生成';
    const reportFoot = reportStatus === 'none'
      ? '自动汇总今日进展'
      : `${m.taskDoneToday} 项已完成 · ${m.bugFoundToday} 个新 Bug`;

    const riskRows = Object.keys(Core.SEVERITY).map((key) => {
      const count = severity[key];
      const width = count ? Math.max(5, Math.round((count / maxSeverity) * 100)) : 0;
      return `
        <button class="risk-row ${key.toLowerCase()}" data-action="filter-bugs-severity" data-severity="${key}" type="button">
          <span class="risk-label">${key}</span>
          <span class="risk-track"><i style="width:${width}%"></i></span>
          <span class="risk-count">${count}</span>
        </button>`;
    }).join('');

    return `
      <section class="hero">
        <div class="hero-copy">
          <div class="hero-kicker"><span class="live-dot"></span>${esc(todayLabel)} · 禅道数据 ${esc(fmtDateTime(state.sync && state.sync.lastSyncAt))}</div>
          <h2>${greeting()}，<span>${esc(state.profile.name)}</span></h2>
          <p>今天有 ${heroFocusCount} 项工作需要推进${m.bugSevere ? `，${m.bugSevere} 个 P0/P1 Bug 需要重点关注` : '，当前没有高优先级缺陷'}。先处理关键路径，再留一点复盘时间。</p>
          <div class="hero-actions">
            <button class="btn btn-primary" type="button" data-action="navigate" data-view="tasks">${icon('play')}查看今日任务</button>
            <button class="btn" type="button" data-action="create-report">${icon('sparkles')}生成工作日报</button>
            <button class="btn" type="button" data-action="create-bug">${icon('plus')}登记 Bug</button>
          </div>
        </div>
        <div class="hero-progress-wrap">
          <div class="focus-ring" style="--progress:${m.progress}" role="img" aria-label="今日推进进度 ${m.progress}%">
            <div class="focus-ring-inner">
              <strong>${m.progress}<span>%</span></strong>
              <small>今日推进</small>
            </div>
          </div>
          <div class="hero-progress-meta">
            <strong>${m.completedCount} / ${m.plannedCount} 项已完成</strong>
            <span>${m.progress >= 70 ? '节奏不错，保持收尾质量。' : '优先清掉关键路径上的任务。'}</span>
            <div class="mini-line"><i style="width:${m.progress}%"></i></div>
          </div>
        </div>
      </section>

      ${autojobBanner()}

      <section class="kpi-grid" aria-label="工作概览">
        <article class="kpi-card is-clickable" role="button" tabindex="0" data-action="kpi-tasks" aria-label="查看待办任务" title="打开任务管理">
          <div class="kpi-top"><span class="kpi-label">待办任务</span><span class="kpi-icon tint-blue">${icon('tasks')}</span></div>
          <div class="kpi-value">${m.taskOpen}<small>项</small></div>
          <div class="kpi-foot"><span class="up">${m.taskDoing}</span> 项进行中${m.taskBlocked ? ` · <span class="warn">${m.taskBlocked} 项阻塞</span>` : ''}</div>
        </article>
        <article class="kpi-card is-clickable" role="button" tabindex="0" data-action="kpi-bugs" aria-label="查看我提交的未关闭 Bug" title="打开 Bug 跟踪">
          <div class="kpi-top"><span class="kpi-label">我提交的未关闭 Bug</span><span class="kpi-icon tint-red">${icon('bug')}</span></div>
          <div class="kpi-value">${m.bugOpen}<small>个</small></div>
          <div class="kpi-foot"><span class="${m.bugSevere ? 'danger' : ''}">${m.bugSevere}</span> 个 P0/P1 待处理</div>
        </article>
        <article class="kpi-card is-clickable" role="button" tabindex="0" data-action="kpi-due" aria-label="查看今日到期任务" title="打开今日到期任务">
          <div class="kpi-top"><span class="kpi-label">今日到期</span><span class="kpi-icon tint-amber">${icon('calendar')}</span></div>
          <div class="kpi-value">${m.taskDueToday}<small>项</small></div>
          <div class="kpi-foot">${m.taskOverdue ? `<span class="danger">${m.taskOverdue} 项已逾期</span>` : '<span class="up">暂无逾期任务</span>'} · 今日完成 ${m.taskDoneToday} 项</div>
        </article>
        <article class="kpi-card is-clickable" role="button" tabindex="0" data-action="kpi-report" aria-label="查看今日工作日报" title="打开工作日报">
          <div class="kpi-top"><span class="kpi-label">今日日报</span><span class="kpi-icon tint-teal">${icon('report')}</span></div>
          <div class="kpi-value is-text">${reportValue}</div>
          <div class="kpi-foot">${esc(reportFoot)}</div>
        </article>
      </section>

      <div class="dashboard-grid">
        <div class="dashboard-stack">
          <section class="panel">
            <div class="panel-head">
              <div><h2>今日聚焦</h2><p>优先处理到期、阻塞与关键路径任务</p></div>
              <button class="text-link" type="button" data-action="navigate" data-view="tasks">全部任务 ${icon('arrow-right')}</button>
            </div>
            <div class="focus-list">
              ${focusTasks.length ? focusTasks.map((task) => `
                <div class="focus-item">
                  <button class="focus-check" type="button" data-action="open-task" data-id="${esc(task.id)}" aria-label="查看「${esc(task.title)}」详情">${icon('arrow-up-right')}</button>
                  <div class="focus-main">
                    <button class="focus-title" type="button" data-action="open-task" data-id="${esc(task.id)}">${esc(task.title)}</button>
                    <div class="focus-meta">
                      ${priorityDot(task.priority)}
                      <span>${esc(task.priority)}</span>
                      <span class="sep"></span>
                      <span>${esc(task.project)}</span>
                      ${task.module ? `<span class="sep"></span><span>${esc(task.module)}</span>` : ''}
                      ${task.status === 'blocked' ? '<span class="sep"></span><span style="color:var(--orange);font-weight:650">已阻塞</span>' : ''}
                    </div>
                  </div>
                  <div class="focus-side">
                    ${dueChip(task)}
                    ${task.bugIds && task.bugIds.length ? `<span class="bug-link">${icon('bug')}${task.bugIds.length}</span>` : ''}
                  </div>
                </div>
              `).join('') : `
                <div class="empty-state" style="min-height:190px;border:0;box-shadow:none">
                  <div class="empty-icon">${icon('check-circle')}</div>
                  <h3>今天的重点已经清空</h3>
                  <p>可以检查分配给我的待验证 Bug，或提前规划下一轮测试。</p>
                  <button class="btn btn-soft btn-sm" type="button" data-action="sync-zentao">${icon('refresh')}刷新禅道任务</button>
                </div>`}
            </div>
          </section>

          ${autojobPanel()}

          <section class="panel">
            <div class="panel-head">
              <div><h2>本周测试节奏</h2><p>近 7 天的完成、发现与验证</p></div>
              <button class="text-link" type="button" data-action="navigate" data-view="reports">查看日报 ${icon('arrow-right')}</button>
            </div>
            <div class="week-chart-wrap">
              <div class="week-summary">
                <div class="week-stat"><strong>${weekTotals.tasks}</strong><span>任务完成</span></div>
                <div class="week-stat"><strong>${weekTotals.bugs}</strong><span>Bug 发现</span></div>
                <div class="week-stat"><strong>${weekTotals.verified}</strong><span>Bug 验证</span></div>
              </div>
              <div class="week-chart" role="img" aria-label="近七天任务完成、Bug 发现与验证趋势">
                ${week.map((day) => {
                  const height = (value) => value === 0 ? 3 : Math.max(8, Math.round((value / maxWeek) * 100));
                  const isToday = day.date === today;
                  return `<div class="day-col${isToday ? ' today' : ''}">
                    <div class="day-bars">
                      <span class="day-bar tasks" style="height:${height(day.tasksDone)}%" title="完成 ${day.tasksDone} 项任务"></span>
                      <span class="day-bar bugs" style="height:${height(day.bugsFound)}%" title="发现 ${day.bugsFound} 个 Bug"></span>
                      <span class="day-bar verified" style="height:${height(day.bugsVerified)}%" title="验证 ${day.bugsVerified} 个 Bug"></span>
                    </div>
                    <span class="day-label">${isToday ? '今天' : `周${day.label}`}</span>
                  </div>`;
                }).join('')}
              </div>
              <div class="legend">
                <span><i style="background:#5b75f2"></i>任务完成</span>
                <span><i style="background:#f0a34c"></i>Bug 发现</span>
                <span><i style="background:#52c7b5"></i>Bug 验证</span>
              </div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head">
              <div><h2>快捷入口</h2><p>常用动作，减少来回切换</p></div>
            </div>
            <div class="quick-actions">
              <button class="quick-action" type="button" data-action="sync-zentao"><span class="quick-icon tint-blue">${icon('refresh')}</span>刷新禅道</button>
              <button class="quick-action" type="button" data-action="create-bug"><span class="quick-icon tint-red">${icon('bug')}</span>登记 Bug</button>
              <button class="quick-action" type="button" data-action="create-report"><span class="quick-icon tint-teal">${icon('report')}</span>生成日报</button>
              <button class="quick-action" type="button" data-action="navigate" data-view="settings"><span class="quick-icon tint-purple">${icon('download')}</span>导出数据</button>
            </div>
          </section>
        </div>

        <div class="dashboard-stack right-stack">
          <section class="panel risk-panel">
            <div class="panel-head">
              <div><h2>质量雷达</h2><p>未关闭 Bug 的严重程度分布</p></div>
              <span class="role-badge">${m.bugOpen} 未关闭</span>
            </div>
            <div class="panel-body">
              <div class="risk-list">${riskRows}</div>
              <div class="risk-foot">
                <span><strong>${m.bugSevere}</strong> 个 P0/P1 需优先关注</span>
                <button class="text-link" type="button" data-action="navigate" data-view="bugs">处理队列 ${icon('arrow-right')}</button>
              </div>
              ${severe.length ? `<div style="margin-top:11px;padding-top:11px;border-top:1px solid var(--line)">
                ${severe.slice(0, 2).map((bug) => `
                  <button class="linked-item" type="button" data-action="open-bug" data-id="${esc(bug.id)}" style="margin-top:6px">
                    ${severityBadge(bug.severity)}
                    <span style="min-width:0;flex:1"><span class="linked-id">${esc(bug.id)}</span><strong>${esc(bug.title)}</strong></span>
                    ${icon('chevron-right')}
                  </button>`).join('')}
              </div>` : ''}
            </div>
          </section>

          <section class="panel">
            <div class="panel-head">
              <div><h2>最近动态</h2><p>任务、Bug 与日报的最新变化</p></div>
              <span class="role-badge">${activity.length} 条</span>
            </div>
            <div class="activity-list">
              ${activity.length ? activity.map((item) => `
                <div class="activity-item">
                  <span class="activity-icon ${KIND_TINT[item.kind] || 'tint-slate'}">${icon(KIND_ICON[item.kind] || 'activity')}</span>
                  <div class="activity-text">
                    <p><strong>${esc(item.title)}</strong><br>${esc(item.text)}</p>
                    <small>${esc(timeAgo(item.at))}</small>
                  </div>
                </div>`).join('') : '<div class="empty-state" style="min-height:160px;border:0;box-shadow:none"><p>还没有活动记录</p></div>'}
            </div>
          </section>

        </div>
      </div>
    `;
  }

  /* =========================================================
     Tasks
     ========================================================= */

  function filteredTasks() {
    return Core.filterTasks(visibleTasks(), ui.taskFilters);
  }

  function taskScopeRow() {
    const counts = state.scopeCounts && state.scopeCounts.tasks
      ? state.scopeCounts.tasks
      : {
        mine: state.tasks.length,
        test: state.allTasks.filter((task) => task.isTest).length,
        all: state.allTasks.length
      };
    return `<div class="scope-row">
      <div class="segmented scope-switch" role="group" aria-label="任务范围">
        <button type="button" data-action="set-task-scope" data-scope="mine" class="${ui.taskScope === 'mine' ? 'active' : ''}">${icon('user')}我的任务 <b>${counts.mine}</b></button>
        <button type="button" data-action="set-task-scope" data-scope="test" class="${ui.taskScope === 'test' ? 'active' : ''}">${icon('shield')}测试任务 <b>${counts.test}</b></button>
        <button type="button" data-action="set-task-scope" data-scope="all" class="${ui.taskScope === 'all' ? 'active' : ''}">${icon('layers')}全部任务 <b>${counts.all}</b></button>
      </div>
      <span class="scope-note">${icon('database')}${(state.projectList || []).length} 个项目 · 账号 ${esc(state.zentao ? state.zentao.account : '')} · 后台同步</span>
    </div>`;
  }

  function taskProjectStrip() {
    const groups = (state.projectList || []).slice()
      .sort((a, b) => (b.taskCount || 0) - (a.taskCount || 0) || a.name.localeCompare(b.name, 'zh-CN'));
    if (!groups.length) return '';
    const active = ui.taskFilters.project || 'all';
    const total = state.allTasks.length;
    return `<div class="project-strip" aria-label="按项目分类">
      <button class="project-chip${active === 'all' ? ' active' : ''}" type="button" data-action="filter-task-project" data-project="all">全部项目 <b>${total}</b></button>
      ${groups.map((group) => `<button class="project-chip${active === group.name ? ' active' : ''}" type="button" data-action="filter-task-project" data-project="${esc(group.name)}" title="${esc(group.status || '')}">${esc(group.name)} <b>${group.taskCount || 0}</b></button>`).join('')}
    </div>`;
  }

  function taskResultsHtml() {
    const tasks = filteredTasks();
    if (!tasks.length) {
      return `<div class="empty-state">
        <div class="empty-icon">${icon('tasks')}</div>
        <h3>${hasActiveTaskFilters() ? '没有匹配的任务' : '禅道中没有对应的测试任务'}</h3>
        <p>${hasActiveTaskFilters() ? '试试调整筛选条件，或清空搜索关键词。' : '任务由禅道同步，当前范围下没有待处理记录。可刷新或切换任务范围。'}</p>
        ${hasActiveTaskFilters()
          ? `<button class="btn btn-soft btn-sm" type="button" data-action="clear-task-filters">${icon('refresh')}清空筛选</button>`
          : `<button class="btn btn-primary btn-sm" type="button" data-action="sync-zentao">${icon('refresh')}从禅道刷新</button>`}
      </div>`;
    }
    return ui.taskView === 'list' ? taskTableHtml(tasks) : taskBoardHtml(tasks);
  }

  function taskCountLabel() {
    const filtered = filteredTasks();
    const total = visibleTasks().length;
    return filtered.length === total ? `共 ${total} 项任务` : `筛选出 ${filtered.length} / ${total} 项任务`;
  }

  function taskBoardHtml(tasks) {
    return `<div class="kanban-board readonly-board">
      ${Object.keys(Core.TASK_STATUS).map((status) => {
        const items = tasks.filter((task) => task.status === status);
        return `<section class="kanban-col" data-status="${status}" aria-label="${esc(Core.TASK_STATUS[status].label)}列">
          <div class="kanban-col-head">
            <span class="kanban-status-dot" style="background:${STATUS_COLORS[status]}"></span>
            <strong>${esc(Core.TASK_STATUS[status].label)}</strong>
            <span class="count">${items.length}</span>
          </div>
          <div class="kanban-list">
            ${items.length ? items.map(renderTaskCard).join('') : `<div class="kanban-empty">${icon('inbox')}<p>暂无${esc(Core.TASK_STATUS[status].label)}任务</p></div>`}
          </div>
        </section>`;
      }).join('')}
    </div>`;
  }

  function renderTaskCard(task) {
    return `<article class="kanban-card readonly" data-task-id="${esc(task.id)}">
      <div class="kanban-card-top">
        ${priorityDot(task.priority)}
        <span class="type-badge">${esc(task.type)}</span>
        <button class="card-menu" type="button" data-action="open-task" data-id="${esc(task.id)}" aria-label="查看任务详情">${icon('more')}</button>
      </div>
      <h3><button type="button" data-action="open-task" data-id="${esc(task.id)}">${esc(task.title)}</button></h3>
      <div class="kanban-meta">
        <span class="project">${esc(task.project)}</span>
        ${task.execution ? '<span class="sep"></span><span>' + esc(task.execution) + '</span>' : ''}
      </div>
      ${task.tags && task.tags.length ? `<div class="kanban-tags">${tagList(task.tags.slice(0, 3))}</div>` : ''}
      <div class="kanban-footer">
        ${dueChip(task)}
        <span class="mini-avatar" title="负责人：${esc(task.assignee || state.profile.name)}">${esc(avatarInitial(task.assignee === state.profile.name ? state.profile.avatar : task.assignee))}</span>
      </div>
    </article>`;
  }

  function taskTableHtml(tasks) {
    return `<div class="table-panel">
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            <th>任务</th><th>状态</th><th>优先级</th><th>项目 / 执行</th><th>截止日期</th><th>更新时间</th><th style="text-align:right">操作</th>
          </tr></thead>
          <tbody>
            ${tasks.map((task) => `<tr>
              <td class="col-title">
                <button class="task-title-btn" type="button" data-action="open-task" data-id="${esc(task.id)}">${esc(task.title)}</button>
                <span class="cell-sub"><span class="mono">${esc(task.displayId || '#' + task.id)}</span><span class="sep"></span>${esc(task.type)}${task.execution ? '<span class="sep"></span>' + esc(task.execution) : ''}</span>
              </td>
              <td>${taskStatusPill(task.status)}</td>
              <td>${severityBadge(task.priority)}</td>
              <td><span class="role-badge">${esc(task.project)}</span></td>
              <td class="nowrap">${task.dueDate ? esc(Core.formatDateCN(task.dueDate)) : '<span class="muted">未设置</span>'}</td>
              <td class="nowrap muted">${esc(fmtDateTime(task.updatedAt))}</td>
              <td>
                <div class="table-actions">
                  <button class="table-action" type="button" data-action="open-task" data-id="${esc(task.id)}" title="查看任务详情" aria-label="查看任务详情">${icon('arrow-up-right')}</button>
                  ${task.url ? `<a class="table-action" href="${esc(task.url)}" target="_blank" rel="noopener noreferrer" title="在禅道中打开" aria-label="在禅道中打开">${icon('link')}</a>` : ''}
                </div>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  function hasActiveTaskFilters() {
    const f = ui.taskFilters;
    return Boolean(f.q || (f.priority && f.priority !== 'all') || (f.project && f.project !== 'all') || (f.due && f.due !== 'all'));
  }

  function updateTaskCount() {
    const count = $('#task-result-count');
    if (count) count.innerHTML = taskCountLabel();
  }

  function renderTaskResults() {
    const host = $('#task-results');
    if (!host) return;
    host.innerHTML = taskResultsHtml();
    updateTaskCount();
    const clear = $('#task-search-clear');
    if (clear) clear.hidden = !ui.taskFilters.q;
  }

  function renderTasks() {
    const f = ui.taskFilters;
    const projectNames = Array.from(new Set([
      ...(state.projectList || []).map((project) => project.name),
      ...visibleTasks().map((task) => task.project)
    ].filter(Boolean)));
    return `${taskScopeRow()}
    ${taskProjectStrip()}
    <div class="page-toolbar">
      <div class="search-field">
        ${icon('search')}
        <input id="task-search" type="search" value="${esc(f.q)}" placeholder="搜索任务、项目或执行…" autocomplete="off" aria-label="搜索任务">
      </div>
      <select class="select" data-filter="task-priority" aria-label="按优先级筛选">
        <option value="all">全部优先级</option>
        ${Object.keys(Core.SEVERITY).map((key) => `<option value="${key}"${f.priority === key ? ' selected' : ''}>${Core.SEVERITY[key].label}</option>`).join('')}
      </select>
      <select class="select" data-filter="task-project" aria-label="按项目筛选">
        <option value="all">全部项目</option>
        ${projectNames.map((project) => `<option value="${esc(project)}"${f.project === project ? ' selected' : ''}>${esc(project)}</option>`).join('')}
      </select>
      <button class="filter-chip${f.due === 'today' ? ' active' : ''}" type="button" data-action="toggle-task-due" style="height:37px;border:1px solid var(--line-strong);background:${f.due === 'today' ? '#fff' : 'rgba(255,255,255,.65)'}">${icon('calendar')} 今日到期</button>
      <div class="toolbar-spacer"></div>
      <div class="segmented" role="group" aria-label="任务视图">
        <button type="button" data-action="set-task-view" data-view="board" class="${ui.taskView === 'board' ? 'active' : ''}">${icon('columns')}看板</button>
        <button type="button" data-action="set-task-view" data-view="list" class="${ui.taskView === 'list' ? 'active' : ''}">${icon('list')}列表</button>
      </div>
      <button class="btn" type="button" data-action="sync-zentao">${icon('refresh')}刷新禅道</button>
    </div>
    <div class="result-meta" id="task-result-count">${taskCountLabel()}</div>
    <div id="task-results">${taskResultsHtml()}</div>`;
  }

  /* =========================================================
     Bugs
     ========================================================= */

  function classifyBugs(bugs) {
    const rows = bugs || [];
    const group = (labelFn, keyFn) => {
      const map = new Map();
      rows.forEach((bug) => {
        const key = keyFn ? keyFn(bug) : labelFn(bug);
        const label = labelFn(bug);
        const current = map.get(key) || { key, label, count: 0 };
        current.count += 1;
        map.set(key, current);
      });
      return Array.from(map.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN'));
    };
    const open = rows.filter((bug) => bug.status !== 'closed');
    const today = Core.localDate();
    return {
      total: rows.length,
      open: open.length,
      closed: rows.filter((bug) => bug.status === 'closed').length,
      verifying: rows.filter((bug) => bugStatusLabel(bug) === '待验证').length,
      severeOpen: open.filter((bug) => bug.severity === 'P0' || bug.severity === 'P1').length,
      foundToday: rows.filter((bug) => Core.localDate(bug.createdAt) === today).length,
      status: group((bug) => bugStatusLabel(bug)),
      severity: ['P0', 'P1', 'P2', 'P3'].map((key) => ({
        key,
        label: key,
        count: rows.filter((bug) => bug.severity === key).length
      })),
      type: group((bug) => bug.typeLabel || '其他'),
      category: group((bug) => bug.businessCategory || '未归类'),
      module: group((bug) => bug.module || '未指定'),
      product: group((bug) => bug.project || '未分类产品')
    };
  }

  function classificationCard(title, entries, tone, hint) {
    const list = (entries || []).filter((entry) => entry.count > 0).slice(0, 6);
    const max = Math.max(1, ...list.map((entry) => entry.count));
    return `<div class="classification-card ${tone || ''}">
      <div class="classification-head"><strong>${esc(title)}</strong><span>${entries.reduce((sum, entry) => sum + entry.count, 0)}</span></div>
      ${list.length ? `<div class="classification-rows">${list.map((entry) => `
        <div class="classification-row">
          <span class="classification-label" title="${esc(entry.label)}">${esc(entry.label)}</span>
          <span class="classification-track"><i style="width:${Math.max(4, Math.round((entry.count / max) * 100))}%"></i></span>
          <b>${entry.count}</b>
        </div>`).join('')}</div>` : `<div class="classification-empty">${esc(hint || '暂无数据')}</div>`}
    </div>`;
  }

  function bugClassificationPanel() {
    const stats = scopedBugStats();
    return `<section class="panel classification-panel">
      <div class="panel-head">
        <div><h2>Bug 分类概览</h2><p>来自禅道 CLI 的状态、严重程度、类型、业务分类与模块统计</p></div>
        <span class="role-badge">${stats.total} 个当前范围</span>
      </div>
      <div class="classification-grid">
        ${classificationCard('产品', stats.product, 'tone-indigo')}
        ${classificationCard('状态', stats.status, 'tone-blue')}
        ${classificationCard('严重程度', stats.severity, 'tone-red')}
        ${classificationCard('Bug 类型', stats.type, 'tone-amber')}
        ${classificationCard('业务分类', stats.category, 'tone-teal')}
        ${classificationCard('模块', stats.module, 'tone-violet')}
      </div>
    </section>`;
  }

  function bugScopeRow() {
    const counts = state.scopeCounts && state.scopeCounts.bugs
      ? state.scopeCounts.bugs
      : { opened: state.bugs.length, assigned: state.allBugs.filter((bug) => bug.isAssignedToMe).length, autojob: (state.autojobBugs || []).length, all: state.allBugs.length };
    const autojobCount = counts.autojob == null ? (state.autojobBugs || []).length : counts.autojob;
    return `<div class="scope-row">
      <div class="segmented scope-switch" role="group" aria-label="Bug 范围">
        <button type="button" data-action="set-bug-scope" data-scope="opened" class="${ui.bugScope === 'opened' ? 'active' : ''}">${icon('user')}我提交的 <b>${counts.opened}</b></button>
        <button type="button" data-action="set-bug-scope" data-scope="assigned" class="${ui.bugScope === 'assigned' ? 'active' : ''}">${icon('flag')}指派给我 <b>${counts.assigned}</b></button>
        <button type="button" data-action="set-bug-scope" data-scope="autojob" class="${ui.bugScope === 'autojob' ? 'active' : ''}">${icon('message')}客服反馈 <b>${autojobCount}</b></button>
        <button type="button" data-action="set-bug-scope" data-scope="all" class="${ui.bugScope === 'all' ? 'active' : ''}">${icon('layers')}全部 Bug <b>${counts.all}</b></button>
      </div>
      <span class="scope-note">${icon('database')}${(state.products || []).length} 个产品 · 账号 ${esc(state.zentao ? state.zentao.account : '')} · 按产品归类</span>
    </div>`;
  }

  function sortBugs(bugs) {
    const key = ui.bugSort && ui.bugSort.key === 'createdAt' ? 'createdAt' : 'updatedAt';
    const dir = ui.bugSort && ui.bugSort.dir === 'asc' ? 1 : -1;
    return (bugs || []).slice().sort((a, b) => {
      const diff = String(a[key] || '').localeCompare(String(b[key] || ''));
      if (diff) return diff * dir;
      return String(b.id || '').localeCompare(String(a.id || ''), 'zh-CN', { numeric: true });
    });
  }

  function filteredBugs() {
    let bugs = Core.filterBugs(visibleBugs(), ui.bugFilters);
    if (ui.bugFilters.type && ui.bugFilters.type !== 'all') {
      bugs = bugs.filter((bug) => bug.type === ui.bugFilters.type);
    }
    if (ui.bugFilters.product && ui.bugFilters.product !== 'all') {
      bugs = bugs.filter((bug) => bug.project === ui.bugFilters.product);
    }
    return sortBugs(bugs);
  }

  function bugSortHeader(key, label) {
    const active = ui.bugSort && ui.bugSort.key === key;
    const dir = active ? ui.bugSort.dir : '';
    return `<th class="th-sort${active ? ' active' : ''}" aria-sort="${active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}">
      <button type="button" data-action="sort-bugs" data-sort="${key}" title="按${label}${dir === 'asc' ? '降序' : '升序'}排列">
        ${label}<span class="sort-ind">${active ? (dir === 'asc' ? '↑' : '↓') : '↕'}</span>
      </button>
    </th>`;
  }

  function bugResultsHtml() {
    const bugs = filteredBugs();
    if (!bugs.length) {
      return `<div class="empty-state">
        <div class="empty-icon">${icon('shield')}</div>
        <h3>${hasActiveBugFilters() ? '没有匹配的 Bug' : '当前范围没有 Bug'}</h3>
        <p>${hasActiveBugFilters() ? '调整严重程度、状态或搜索关键词再看看。' : '可以切换 Bug 范围，或直接登记一个可复现的问题。'}</p>
        ${hasActiveBugFilters()
          ? `<button class="btn btn-soft btn-sm" type="button" data-action="clear-bug-filters">${icon('refresh')}清空筛选</button>`
          : `<button class="btn btn-primary btn-sm" type="button" data-action="create-bug">${icon('plus')}登记 Bug</button>`}
      </div>`;
    }
    return `<div class="table-panel">
      <div class="table-scroll">
        <table class="data-table bug-table">
          <thead><tr>
            <th>编号</th><th>Bug 标题</th><th>严重</th><th>状态</th><th>负责人</th>
            ${bugSortHeader('createdAt', '创建时间')}
            ${bugSortHeader('updatedAt', '更新时间')}
            <th style="text-align:right">操作</th>
          </tr></thead>
          <tbody>
            ${bugs.map((bug) => `<tr>
              <td class="table-id">${esc(bug.displayId || '#' + bug.id)}</td>
              <td class="col-title">
                ${bug.isAutojob ? '<span class="source-badge" title="来自客服群聊记录，由 AI 自动提取">AI客服</span>' : ''}
                <button class="task-title-btn" type="button" data-action="open-bug" data-id="${esc(bug.id)}">${esc(bug.title)}</button>
                <span class="cell-sub">${esc(bug.project)}${bug.version ? `<span class="sep"></span>${esc(bug.version)}` : ''}${bug.isAutojob ? `<span class="sep"></span>优先级 ${esc(bug.pri || '—')}` : ''}${bug.typeLabel ? `<span class="sep"></span>${esc(bug.typeLabel)}` : ''}${bug.businessCategory ? `<span class="sep"></span>${esc(bug.businessCategory)}` : ''}</span>
              </td>
              <td class="col-severity">${severityBadge(bug.severity)}</td>
              <td class="col-status">${bugStatusPill(bug.status, bug)}</td>
              <td class="col-assignee" data-label="负责人">${esc(bug.assignee)}</td>
              <td class="col-created nowrap muted" data-label="创建">${esc(fmtDateTime(bug.createdAt))}</td>
              <td class="col-updated nowrap muted" data-label="更新">${esc(fmtDateTime(bug.updatedAt))}</td>
              <td class="col-actions">
                <div class="table-actions">
                  <button class="table-action" type="button" data-action="open-bug" data-id="${esc(bug.id)}" title="查看详情" aria-label="查看详情">${icon('arrow-up-right')}</button>
                  ${bug.url ? `<a class="table-action" href="${esc(bug.url)}" target="_blank" rel="noopener noreferrer" title="在禅道中打开" aria-label="在禅道中打开">${icon('link')}</a>` : ''}
                </div>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  function hasActiveBugFilters() {
    const f = ui.bugFilters;
    return Boolean(f.q || (f.status && f.status !== 'all') || (f.severity && f.severity !== 'all') || (f.type && f.type !== 'all') || (f.product && f.product !== 'all') || (f.project && f.project !== 'all'));
  }

  function bugCountLabel() {
    const filtered = filteredBugs();
    const total = visibleBugs().length;
    return filtered.length === total ? `共 ${total} 个 Bug` : `筛选出 ${filtered.length} / ${total} 个 Bug`;
  }

  function updateBugCount() {
    const count = $('#bug-result-count');
    if (count) count.innerHTML = bugCountLabel();
  }

  function renderBugResults() {
    const host = $('#bug-results');
    if (!host) return;
    host.innerHTML = bugResultsHtml();
    updateBugCount();
  }

  function renderBugs() {
    if (ui.bugDetailId) {
      const bug = bugById(ui.bugDetailId);
      if (bug) return ui.bugEditing ? renderBugEditPage(bug) : renderBugPage(bug);
      ui.bugDetailId = null;
      ui.bugEditing = false;
    }
    const stats = scopedBugStats();
    const f = ui.bugFilters;
    return `
      <div class="mini-metric-grid">
        <article class="mini-metric"><span class="mini-metric-icon tint-red">${icon('bug')}</span><div><p>当前范围 Bug</p><strong>${stats.total} <small>个</small></strong></div></article>
        <article class="mini-metric"><span class="mini-metric-icon tint-orange">${icon('alert-triangle')}</span><div><p>未关闭 / P0–P1</p><strong>${stats.open} <small>个</small></strong><span class="mini-metric-sub">${stats.severeOpen} 个高优先级</span></div></article>
        <article class="mini-metric"><span class="mini-metric-icon tint-teal">${icon('check-circle')}</span><div><p>等待验证</p><strong>${stats.verifying} <small>个</small></strong></div></article>
        <article class="mini-metric"><span class="mini-metric-icon tint-blue">${icon('activity')}</span><div><p>今日新增</p><strong>${stats.foundToday} <small>个</small></strong></div></article>
      </div>
      ${bugScopeRow()}
      <div class="page-toolbar">
        <div class="search-field">
          ${icon('search')}
          <input id="bug-search" type="search" value="${esc(f.q)}" placeholder="搜索 Bug 编号、标题、负责人…" autocomplete="off" aria-label="搜索 Bug">
        </div>
        <select class="select" data-filter="bug-severity" aria-label="按严重程度筛选">
          <option value="all">全部严重程度</option>
          ${Object.keys(Core.SEVERITY).map((key) => `<option value="${key}"${f.severity === key ? ' selected' : ''}>${Core.SEVERITY[key].label}</option>`).join('')}
        </select>
        <select class="select" data-filter="bug-status" aria-label="按状态筛选">
          <option value="all">全部状态</option>
          <option value="unclosed"${f.status === 'unclosed' ? ' selected' : ''}>未关闭</option>
          ${Object.keys(Core.BUG_STATUS).map((key) => {
            let label = Core.BUG_STATUS[key].label;
            if (ui.bugScope === 'autojob' && key === 'new') label = '待验证';
            if (ui.bugScope === 'autojob' && key === 'verifying') label = '我已解决';
            return `<option value="${key}"${f.status === key ? ' selected' : ''}>${label}</option>`;
          }).join('')}
        </select>
        <select class="select" data-filter="bug-product" aria-label="按产品筛选">
          <option value="all">全部产品</option>
          ${(state.products || []).map((product) => `<option value="${esc(product.name)}"${f.product === product.name ? ' selected' : ''}>${esc(product.name)}（${product.bugCount || 0}）</option>`).join('')}
        </select>
        <select class="select" data-filter="bug-type" aria-label="按类型筛选">
          <option value="all">全部类型</option>
          ${(state.creation && state.creation.types ? state.creation.types : []).map((type) => `<option value="${esc(type.value)}"${f.type === type.value ? ' selected' : ''}>${esc(type.label)}</option>`).join('')}
        </select>
        <div class="toolbar-spacer"></div>
        <button class="btn btn-primary" type="button" data-action="create-bug">${icon('plus')}登记 Bug</button>
      </div>
      ${bugClassificationPanel()}
      <div class="result-meta" id="bug-result-count">${bugCountLabel()}</div>
      <div id="bug-results">${bugResultsHtml()}</div>`;
  }

  /* =========================================================
     Bug detail page
     ========================================================= */

  function bugDetailFact(label, valueHtml) {
    return `<div class="bug-detail-fact"><dt>${esc(label)}</dt><dd>${valueHtml || '—'}</dd></div>`;
  }

  function renderBugAttachments(bug) {
    const attachments = Core.extractAttachments([bug.steps, bug.expected, bug.actual]);
    if (!attachments.length) return '';
    return `<section class="bug-detail-section">
      <div class="bug-detail-section-head">
        <h2>附件截图</h2>
        <span class="bug-detail-section-count">${attachments.length}</span>
      </div>
      <div class="bug-attachment-grid">
        ${attachments.map((item, index) => `
          <a class="bug-attachment" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer" title="${esc(item.alt || '附件 ' + item.id)}">
            <span class="bug-attachment-preview"><img src="${esc(item.url)}" alt="${esc(item.alt || '附件 ' + (index + 1))}" loading="lazy"></span>
            <span class="bug-attachment-copy">
              <strong>${esc(item.alt || `截图 ${index + 1}`)}</strong>
              <small>FILE-${esc(item.id)} · 点击查看原图</small>
            </span>
          </a>`).join('')}
      </div>
    </section>`;
  }

  function stepsWithoutResults(bug) {
    let text = String(bug.steps || '');
    [bug.expected, bug.actual].filter(Boolean).forEach((value) => {
      const index = text.indexOf(value);
      if (index >= 0) text = `${text.slice(0, index)}${text.slice(index + value.length)}`;
    });
    return text
      .replace(/^\s*\*\*(?:期望|预期结果|预期|实际结果|实际)\*\*\s*[：:]?\s*$/gm, '')
      .replace(/^\s*(?:期望|预期结果|预期|实际结果|实际)\s*[：:]\s*$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function renderBugPage(bug) {
    const task = bug.taskId ? taskById(bug.taskId) : null;
    const stepSource = stepsWithoutResults(bug);
    const steps = Core.renderRichText(stepSource || '禅道中没有填写复现步骤。');
    const expected = bug.expected ? Core.renderRichText(bug.expected) : '';
    const actual = bug.actual ? Core.renderRichText(bug.actual) : '';
    return `<div class="bug-detail-page">
      <div class="bug-detail-topbar">
        <button class="bug-detail-back" type="button" data-action="close-bug-page">
          ${icon('chevron-left')}<span>返回 Bug 列表</span>
        </button>
        <div class="bug-detail-topbar-actions">
          <span class="bug-detail-number">${esc(bug.displayId || '#' + bug.id)}</span>
          ${bug.url ? `<a class="btn btn-sm" href="${esc(bug.url)}" target="_blank" rel="noopener noreferrer">${icon('link')}在禅道打开</a>` : ''}
          <button class="btn btn-sm btn-primary" type="button" data-action="edit-bug-page" data-id="${esc(bug.id)}">${icon('edit')}编辑 Bug</button>
        </div>
      </div>

      <article class="bug-detail-doc">
        <header class="bug-detail-head">
          <div class="bug-detail-kicker">${icon('bug')}ZENTAO BUG · ${esc(bug.project || '未归属产品')} · ${esc(bug.module || '未指定模块')}</div>
          <h1>${esc(bug.title)}</h1>
          <div class="bug-detail-badges">
            ${severityBadge(bug.severity)}
            ${bugStatusPill(bug.status, bug)}
            <span class="role-badge">${esc(bug.typeLabel || 'Bug')}</span>
            ${bug.resolutionLabel ? `<span class="bug-detail-resolution">${icon('check-circle')}${esc(bug.resolutionLabel)}</span>` : ''}
          </div>
          <div class="bug-detail-byline">
            <span>报告人 <strong>${esc(bug.reporter || '—')}</strong></span>
            <span>负责人 <strong>${esc(bug.assignee || '未指派')}</strong></span>
            <span>创建于 <strong>${esc(fmtFullDate(bug.createdAt))}</strong></span>
            <span>更新于 <strong>${esc(fmtFullDate(bug.updatedAt))}</strong></span>
          </div>
        </header>

        <div class="bug-detail-grid">
          <div class="bug-detail-main">
            <section class="bug-detail-section">
              <div class="bug-detail-section-head"><h2>复现步骤</h2></div>
              ${steps}
            </section>

            ${(expected || actual) ? `<section class="bug-detail-section">
              <div class="bug-detail-section-head"><h2>预期结果与实际结果</h2></div>
              <div class="bug-result-pair">
                <div class="bug-result-card expected">
                  <span class="bug-result-label">${icon('check-circle')}预期结果</span>
                  ${expected || '<p class="muted">未填写</p>'}
                </div>
                <div class="bug-result-card actual">
                  <span class="bug-result-label">${icon('alert-triangle')}实际结果</span>
                  ${actual || '<p class="muted">未填写</p>'}
                </div>
              </div>
            </section>` : ''}

            ${renderBugAttachments(bug)}

            <section class="bug-detail-section">
              <div class="bug-detail-section-head"><h2>处理记录</h2></div>
              ${timelineHtml(bug.history)}
            </section>

            <div class="bug-detail-actions">
              ${bugActionButtons(bug)}
            </div>

            <div class="readonly-note">${icon('shield')}<span>编辑、指派、解决、关闭、激活和删除都会通过禅道 CLI 写入正式 Bug，写入后自动重新同步。</span></div>
          </div>

          <aside class="bug-detail-side">
            <section class="bug-detail-card">
              <div class="bug-detail-card-head"><h2>Bug 信息</h2></div>
              <dl class="bug-detail-facts">
                ${bugDetailFact('Bug 编号', esc(bug.displayId || '#' + bug.id))}
                ${bugDetailFact('所属产品', esc(bug.project || '未归属产品'))}
                ${bugDetailFact('所属模块', esc(bug.module || '未指定'))}
                ${bugDetailFact('功能模块', esc(bug.feature || '—'))}
                ${bug.isAutojob ? bugDetailFact('来源', '<span class="source-badge">AI客服提取</span><span class="bug-detail-fact-text">客服群聊记录</span>') : ''}
                ${bugDetailFact('严重程度', `${severityBadge(bug.severity)}<span class="bug-detail-fact-text">${esc(bug.severityLabel || bug.severity)}</span>`)}
                ${bugDetailFact('优先级', `${priorityDot(bug.pri)}<span class="bug-detail-fact-text">${esc(bug.pri || '—')}</span>`)}
                ${bugDetailFact('Bug 类型', esc(bug.typeLabel || '—'))}
                ${bugDetailFact('当前状态', bugStatusPill(bug.status, bug))}
                ${bugDetailFact('解决方案', esc(bug.resolutionLabel || '未解决'))}
                ${bugDetailFact('影响版本', esc(bug.version || '未填写'))}
                ${bugDetailFact('运行环境', esc(bug.environment || '—'))}
                ${bugDetailFact('报告人', esc(bug.reporter || '—'))}
                ${bugDetailFact('负责人', esc(bug.assignee || '未指派'))}
                ${bugDetailFact('创建时间', esc(fmtFullDate(bug.createdAt)))}
                ${bugDetailFact('更新时间', esc(fmtFullDate(bug.updatedAt)))}
                ${bug.deadline ? bugDetailFact('截止日期', esc(dateInputValue(bug.deadline))) : ''}
                ${bug.resolvedAt ? bugDetailFact('解决时间', esc(fmtFullDate(bug.resolvedAt))) : ''}
              </dl>
            </section>

            ${task ? `<section class="bug-detail-card">
              <div class="bug-detail-card-head"><h2>关联任务</h2></div>
              <button class="linked-item" type="button" data-action="open-task" data-id="${esc(task.id)}">
                ${icon('tasks')}
                <span style="min-width:0;flex:1"><span class="linked-id">${esc(task.displayId || '#' + task.id)}</span><strong>${esc(task.title)}</strong></span>
                ${taskStatusPill(task.status)}
              </button>
            </section>` : ''}
          </aside>
        </div>
      </article>
    </div>`;
  }

  /* =========================================================
     Bug editing and ZenTao actions
     ========================================================= */

  function serverVersionAtLeast(minVersion) {
    const current = state && state.zentao ? String(state.zentao.serverVersion || '') : '';
    const currentMatch = current.match(/(\d+)\.(\d+)/);
    const minMatch = String(minVersion || '').match(/(\d+)\.(\d+)/);
    if (!currentMatch || !minMatch) return false;
    const currentMajor = Number(currentMatch[1]);
    const currentMinor = Number(currentMatch[2]);
    const minMajor = Number(minMatch[1]);
    const minMinor = Number(minMatch[2]);
    return currentMajor > minMajor || (currentMajor === minMajor && currentMinor >= minMinor);
  }

  function bugCanConfirm() {
    return serverVersionAtLeast('22.5');
  }

  function bugBuildValue(value) {
    const text = String(value || '').trim();
    if (!text || text === '主干' || text === 'trunk') return 'trunk';
    return text;
  }

  function dateInputValue(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function bugUserOptions(selected) {
    const users = state.creation && Array.isArray(state.creation.users) ? state.creation.users.slice() : [];
    const current = String(selected || '');
    if (current && !users.some((user) => String(user.account) === current)) {
      users.unshift({ account: current, name: current });
    }
    users.sort((a, b) => String(a.name || a.account).localeCompare(String(b.name || b.account), 'zh-CN'));
    return `<option value="">不指派</option>${users.map((user) => {
      const account = String(user.account || '');
      const label = user.name && user.name !== account ? `${user.name}（${account}）` : account;
      return `<option value="${esc(account)}"${account === current ? ' selected' : ''}>${esc(label)}</option>`;
    }).join('')}`;
  }

  function bugActionMeta(action) {
    const meta = {
      assign: { label: '指派', icon: 'user', title: '指派 Bug', description: '把 Bug 指派给禅道账号中的负责人。', submit: '确认指派' },
      resolve: { label: '解决', icon: 'check-circle', title: '解决 Bug', description: '填写解决方案与解决版本，Bug 将进入已解决状态，等待提交人验证。', submit: '解决并同步' },
      close: { label: '关闭', icon: 'check', title: '关闭 Bug', description: '关闭后 Bug 不再出现在未关闭列表，可随时重新激活。', submit: '关闭并同步' },
      activate: { label: '激活', icon: 'refresh', title: '重新激活 Bug', description: '把已解决或已关闭的 Bug 重新置为激活状态。', submit: '激活并同步' },
      confirm: { label: '确认', icon: 'shield', title: '确认 Bug', description: '确认 Bug 有效，可同时调整类型、优先级和截止日期。', submit: '确认并同步' },
      delete: { label: '删除', icon: 'trash', title: '删除 Bug', description: '删除后无法在 QDesk 中恢复，请确认这是正式删除操作。', submit: '删除 Bug' }
    };
    return meta[action] || null;
  }

  function bugActionsFor(bug) {
    const status = String(bug.rawStatus || 'active');
    const actions = [];
    if (bugCanConfirm() && status === 'active' && !bug.confirmed) actions.push('confirm');
    actions.push('assign');
    if (status === 'active') actions.push('resolve');
    if (status !== 'closed') actions.push('close');
    if (status === 'resolved' || status === 'closed') actions.push('activate');
    return actions;
  }

  function bugActionButtons(bug) {
    const actions = bugActionsFor(bug);
    return `<div class="bug-action-buttons">
      ${actions.map((action) => {
        const meta = bugActionMeta(action);
        if (!meta) return '';
        return `<button class="btn btn-sm" type="button" data-action="bug-action" data-bug-action="${action}" data-id="${esc(bug.id)}">${icon(meta.icon)}${esc(meta.label)}</button>`;
      }).join('')}
      <button class="btn btn-sm btn-danger-ghost" type="button" data-action="bug-action" data-bug-action="delete" data-id="${esc(bug.id)}">${icon('trash')}删除</button>
    </div>`;
  }

  function renderBugEditPage(bug) {
    const statusNote = String(bug.rawStatus || 'active') === 'closed'
      ? '当前 Bug 已关闭，保存基本信息后仍保持关闭状态；如需继续处理，请先使用「激活」。'
      : '保存后会通过禅道 CLI 更新正式 Bug，并自动从禅道重新同步。';
    return `<div class="bug-detail-page bug-edit-page">
      <div class="bug-detail-topbar">
        <button class="bug-detail-back" type="button" data-action="close-bug-edit" data-id="${esc(bug.id)}">
          ${icon('chevron-left')}<span>返回 Bug 详情</span>
        </button>
        <div class="bug-detail-topbar-actions">
          <span class="bug-detail-number">${esc(bug.displayId || '#' + bug.id)}</span>
          ${bug.url ? `<a class="btn btn-sm" href="${esc(bug.url)}" target="_blank" rel="noopener noreferrer">${icon('link')}在禅道打开</a>` : ''}
        </div>
      </div>

      <form class="bug-edit-form" data-form="bug-edit" data-id="${esc(bug.id)}" novalidate>
        <article class="bug-detail-doc">
          <header class="bug-detail-head">
            <div class="bug-detail-kicker">${icon('edit')}EDIT BUG · ${esc(bug.project || '未归属产品')} · ${esc(bug.module || '未指定模块')}</div>
            <h1>${esc(bug.title)}</h1>
            <div class="bug-detail-badges">
              ${severityBadge(bug.severity)}
              ${bugStatusPill(bug.status, bug)}
              <span class="role-badge">${esc(bug.typeLabel || 'Bug')}</span>
            </div>
            <div class="bug-detail-byline">
              <span>报告人 <strong>${esc(bug.reporter || '—')}</strong></span>
              <span>负责人 <strong>${esc(bug.assignee || '未指派')}</strong></span>
              <span>创建于 <strong>${esc(fmtFullDate(bug.createdAt))}</strong></span>
              <span>更新于 <strong>${esc(fmtFullDate(bug.updatedAt))}</strong></span>
            </div>
          </header>

          <div class="bug-detail-grid">
            <div class="bug-detail-main">
              <section class="bug-detail-section">
                <div class="bug-detail-section-head"><h2>编辑 Bug 字段</h2></div>
                <div class="form-grid">
                  ${field('Bug 标题', `<input name="title" value="${esc(bug.title)}" maxlength="180" placeholder="一句话说明问题" autofocus required>`, { full: true, required: true })}
                  ${field('严重程度', `<select name="severity" required>${bugSeverityOptions(bug.severity)}</select>`, { required: true })}
                  ${field('优先级', `<select name="pri" required>${bugPriorityOptions(bug.pri)}</select>`, { required: true })}
                  ${field('Bug 类型', `<select name="type" required>${bugTypeOptions(bug.type)}</select>`, { required: true })}
                  ${field('指派给', `<select name="assignedTo">${bugUserOptions(bug.assigneeAccount)}</select>`)}
                  ${field('影响版本', `<input name="openedBuild" value="${esc(bugBuildValue(bug.version))}" maxlength="120" placeholder="trunk">`, { hint: '主干填写 trunk，否则填写禅道版本 ID。' })}
                  ${field('所属项目', `<select name="project">${bugProjectOptions(bug.projectId)}</select>`, { hint: '留空或选择“不关联项目”即产品级 Bug。' })}
                  ${field('所属执行', `<select name="execution">${bugExecutionOptions(bug.executionId)}</select>`, { hint: '可选；对应禅道迭代或执行。' })}
                  ${field('相关需求', `<input name="story" type="number" min="0" step="1" value="${esc(bug.storyId || '')}" placeholder="需求 ID，留空表示不关联">`, { hint: '填写禅道需求 ID，留空表示不关联。' })}
                  ${field('复现步骤', `<textarea name="steps" class="bug-edit-steps" placeholder="1. 打开…&#10;2. 操作…&#10;3. 观察…">${esc(bug.steps || '')}</textarea>`, { full: true, hint: '支持禅道 Markdown 与 HTML；保存后会原样写入禅道。' })}
                </div>
                <div class="form-error" role="alert"></div>
                <div class="bug-edit-note">${icon('alert-triangle')}<span>${esc(statusNote)}</span></div>
                <div class="bug-edit-readonly">${icon('layers')}<span>所属产品、所属模块由禅道同步维护；当前禅道 22.4 的 CLI 更新接口不支持修改这两项，请到禅道处理。解决方案、状态等请使用右侧操作按钮。</span></div>
                <div class="bug-edit-footer">
                  <button class="btn" type="button" data-action="close-bug-edit" data-id="${esc(bug.id)}">取消</button>
                  <button class="btn btn-primary" type="submit">${icon('check')}保存并同步到禅道</button>
                </div>
              </section>
            </div>

            <aside class="bug-detail-side">
              <section class="bug-detail-card">
                <div class="bug-detail-card-head"><h2>Bug 操作</h2></div>
                <div class="bug-action-panel">
                  <p>状态流转与指派都会写入正式 Bug。</p>
                  ${bugActionButtons(bug)}
                </div>
              </section>

              <section class="bug-detail-card">
                <div class="bug-detail-card-head"><h2>只读信息</h2></div>
                <dl class="bug-detail-facts">
                  ${bugDetailFact('Bug 编号', esc(bug.displayId || '#' + bug.id))}
                  ${bugDetailFact('所属产品', esc(bug.project || '未归属产品'))}
                  ${bugDetailFact('所属模块', esc(bug.module || '未指定'))}
                  ${bugDetailFact('当前状态', bugStatusPill(bug.status, bug))}
                  ${bugDetailFact('解决方案', esc(bug.resolutionLabel || '未解决'))}
                  ${bugDetailFact('报告人', esc(bug.reporter || '—'))}
                  ${bugDetailFact('创建时间', esc(fmtFullDate(bug.createdAt)))}
                </dl>
              </section>
            </aside>
          </div>
        </article>
      </form>
    </div>`;
  }

  function bugActionFormHtml(action, bug) {
    if (action === 'assign') {
      return field('指派给', `<select name="assignedTo" required>${bugUserOptions(bug.assigneeAccount)}</select>`, { required: true, hint: '只能指派给禅道中的有效账号。' });
    }
    if (action === 'resolve') {
      return `
        ${field('解决方案', `<select name="resolution" required>
          <option value="fixed">已修复</option>
          <option value="notrepro">无法重现</option>
          <option value="bydesign">设计如此</option>
          <option value="duplicate">重复 Bug</option>
          <option value="external">外部原因</option>
          <option value="postponed">延期处理</option>
          <option value="willnotfix">不予解决</option>
          <option value="tostory">转为需求</option>
        </select>`, { required: true })}
        ${field('解决版本', `<input name="resolvedBuild" value="${esc(bugBuildValue(bug.version))}" maxlength="120" placeholder="trunk">`)}
        ${field('指派给', `<select name="assignedTo">${bugUserOptions(bug.assigneeAccount)}</select>`)}
        ${field('备注', `<textarea name="comment" maxlength="4000" placeholder="可选，说明解决方式或验证建议"></textarea>`, { full: true })}`;
    }
    if (action === 'close') {
      return field('关闭备注', `<textarea name="comment" maxlength="4000" placeholder="可选，说明关闭原因"></textarea>`, { full: true });
    }
    if (action === 'activate') {
      return `
        ${field('影响版本', `<input name="openedBuild" value="${esc(bugBuildValue(bug.version))}" maxlength="120" placeholder="trunk">`, { hint: '重新激活后使用的影响版本。' })}
        ${field('指派给', `<select name="assignedTo">${bugUserOptions(bug.assigneeAccount)}</select>`)}
        ${field('备注', `<textarea name="comment" maxlength="4000" placeholder="可选，说明重新打开的原因"></textarea>`, { full: true })}`;
    }
    if (action === 'confirm') {
      return `
        ${field('指派给', `<select name="assignedTo">${bugUserOptions(bug.assigneeAccount)}</select>`)}
        ${field('Bug 类型', `<select name="type">${bugTypeOptions(bug.type)}</select>`)}
        ${field('优先级', `<select name="pri">${bugPriorityOptions(bug.pri)}</select>`)}
        ${field('截止日期', `<input name="deadline" type="date" value="${esc(dateInputValue(bug.deadline))}">`)}
        ${field('备注', `<textarea name="comment" maxlength="4000" placeholder="可选，说明确认结论"></textarea>`, { full: true })}`;
    }
    return '';
  }

  function openBugActionModal(action, bugId) {
    if (!guardReady()) return;
    const meta = bugActionMeta(action);
    const bug = bugById(String(bugId));
    if (!meta || !bug) return;
    closeQuickMenu();
    closeNotifications();
    const isDelete = action === 'delete';
    const html = `<div class="overlay">
      <form class="modal modal-form bug-action-modal" data-bug-form="action" data-bug-action="${esc(action)}" data-id="${esc(bug.id)}" novalidate>
        <div class="modal-head">
          <div class="modal-title-wrap"><h2>${esc(meta.title)}</h2><p>${esc(meta.description)}</p></div>
          <button class="icon-btn modal-close" type="button" data-action="close-modal" aria-label="关闭">${icon('close')}</button>
        </div>
        <div class="modal-body">
          <div class="bug-action-summary">
            <span class="bug-action-summary-id">${esc(bug.displayId || '#' + bug.id)}</span>
            <div><strong>${esc(bug.title)}</strong><small>${esc(bug.project || '未归属产品')} · ${esc(bug.statusLabel || '')}</small></div>
            ${bugStatusPill(bug.status, bug)}
          </div>
          ${isDelete
            ? `<div class="bug-delete-warning">${icon('alert-triangle')}<div><strong>确认删除这个 Bug？</strong><span>删除会通过禅道 CLI 立即执行，禅道中删除后无法在 QDesk 恢复。</span></div></div>`
            : `<div class="form-grid">${bugActionFormHtml(action, bug)}</div>`}
          <div class="form-error" role="alert"></div>
        </div>
        <div class="modal-footer">
          <span class="footer-left">操作会写入 ${esc(bug.displayId || '#' + bug.id)}</span>
          <button class="btn" type="button" data-action="close-modal">取消</button>
          <button class="btn ${isDelete ? 'btn-danger' : 'btn-primary'}" type="submit">${icon(isDelete ? 'trash' : 'check')}${esc(meta.submit)}</button>
        </div>
      </form>
    </div>`;
    mountModal(html);
  }

  function openBugAction(action, bugId) {
    if (action === 'edit') {
      openBugEdit(bugId);
      return;
    }
    if (!bugActionMeta(action)) return;
    openBugActionModal(action, bugId);
  }

  function openBugEdit(bugId) {
    if (!guardReady()) return;
    const bug = bugById(String(bugId));
    if (!bug) return;
    closeQuickMenu();
    closeNotifications();
    closeDrawer();
    closeModal({ restoreFocus: false });
    ui.view = 'bugs';
    ui.bugDetailId = String(bug.id);
    ui.bugEditing = true;
    const nextHash = `#/bugs/${encodeURIComponent(bug.id)}/edit`;
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    } else {
      renderView(true);
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }

  function closeBugEdit() {
    const id = ui.bugDetailId;
    ui.bugEditing = false;
    const nextHash = id ? `#/bugs/${encodeURIComponent(id)}` : '#/bugs';
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    } else {
      renderView(true);
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }

  async function saveBugEdit(form) {
    if (form.dataset.busy === '1') return;
    if (!form.reportValidity()) return;
    const bugId = form.dataset.id;
    const data = new FormData(form);
    const payload = {
      title: String(data.get('title') || '').trim(),
      severity: String(data.get('severity') || ''),
      pri: String(data.get('pri') || ''),
      type: String(data.get('type') || ''),
      openedBuild: String(data.get('openedBuild') || '').trim(),
      project: String(data.get('project') || ''),
      execution: String(data.get('execution') || ''),
      story: String(data.get('story') || ''),
      assignedTo: String(data.get('assignedTo') || ''),
      steps: String(data.get('steps') || '')
    };
    if (!payload.title) {
      showFormError(form, '请填写 Bug 标题。');
      return;
    }
    form.dataset.busy = '1';
    const submit = $('button[type="submit"]', form);
    if (submit) { submit.disabled = true; submit.classList.add('is-busy'); }
    try {
      const result = await apiRequest(`/api/bugs/${encodeURIComponent(bugId)}`, {
        method: 'PUT',
        body: payload,
        timeoutMs: 120000
      });
      closeModal({ restoreFocus: false });
      showToast((result && result.message) || `Bug #${bugId} 已更新，正在重新同步。`, 'success');
      ui.bugEditing = false;
      const nextHash = `#/bugs/${encodeURIComponent(bugId)}`;
      if (window.location.hash !== nextHash) {
        window.location.hash = nextHash;
      } else {
        renderView(true);
        window.scrollTo({ top: 0, behavior: 'auto' });
      }
      schedulePolling(result && result.incremental ? 150 : 800);
    } catch (error) {
      showFormError(form, error.message);
      form.dataset.busy = '';
      if (submit) { submit.disabled = false; submit.classList.remove('is-busy'); }
    }
  }

  async function submitBugAction(form) {
    if (form.dataset.busy === '1') return;
    if (!form.reportValidity()) return;
    const action = form.dataset.bugAction;
    const bugId = form.dataset.id;
    const data = new FormData(form);
    const payload = {};
    ['assignedTo', 'resolution', 'resolvedBuild', 'openedBuild', 'comment', 'type', 'pri', 'deadline'].forEach((key) => {
      if (data.has(key)) payload[key] = String(data.get(key) || '');
    });
    if (action === 'assign' && !payload.assignedTo) {
      showFormError(form, '请选择要指派的禅道账号。');
      return;
    }
    form.dataset.busy = '1';
    const submit = $('button[type="submit"]', form);
    if (submit) { submit.disabled = true; submit.classList.add('is-busy'); }
    const endpoint = action === 'assign'
      ? `/api/bugs/${encodeURIComponent(bugId)}/assign`
      : `/api/bugs/${encodeURIComponent(bugId)}/${action}`;
    try {
      const result = await apiRequest(endpoint, {
        method: 'POST',
        body: payload,
        timeoutMs: 120000
      });
      closeModal({ restoreFocus: false });
      showToast((result && result.message) || '操作已提交，正在重新同步。', 'success');
      if (action === 'delete') {
        ui.bugDetailId = null;
        ui.bugEditing = false;
        const nextHash = '#/bugs';
        if (window.location.hash !== nextHash) window.location.hash = nextHash;
        else renderView(true);
      } else {
        ui.bugEditing = false;
        const nextHash = `#/bugs/${encodeURIComponent(bugId)}`;
        if (window.location.hash !== nextHash) window.location.hash = nextHash;
        else renderView(true);
      }
      schedulePolling(result && result.incremental ? 150 : 800);
    } catch (error) {
      showFormError(form, error.message);
      form.dataset.busy = '';
      if (submit) { submit.disabled = false; submit.classList.remove('is-busy'); }
    }
  }

  /* =========================================================
     Reports
     ========================================================= */

  function sortedReports() {
    return state.reports.slice().sort((a, b) => b.date.localeCompare(a.date));
  }

  function currentReport() {
    return state.reports.find((report) => report.date === ui.reportDate) || null;
  }

  function renderReportHistory() {
    const reports = sortedReports();
    if (!reports.length) {
      return `<div class="report-history-empty">${icon('inbox')}<div>还没有历史日报</div></div>`;
    }
    return reports.map((report) => {
      const date = new Date(`${report.date}T12:00:00`);
      const summary = report.content && report.content.summary ? report.content.summary : '暂无摘要';
      return `<button class="report-history-item${report.date === ui.reportDate ? ' active' : ''}" type="button" data-action="report-select" data-date="${esc(report.date)}">
        <span class="report-date-block"><strong>${pad2(date.getDate())}</strong><small>${date.getMonth() + 1}月</small></span>
        <span class="report-history-copy">
          <strong>${esc(weekday(report.date))} · ${esc(report.status === 'submitted' ? '已提交' : '草稿')}</strong>
          <p>${esc(summary)}</p>
          <span class="report-status-line"><i class="report-status-dot ${report.status === 'submitted' ? 'submitted' : ''}"></i>${esc(report.status === 'submitted' ? '已提交' : '本地服务草稿')}</span>
        </span>
      </button>`;
    }).join('');
  }

  function renderReportEditor(report) {
    const data = Core.collectDailyData(state, report.date);
    const statusLabel = report.status === 'submitted' ? '已提交' : '草稿';
    const statusClass = report.status === 'submitted' ? 'status-done' : 'status-blocked';
    return `<article class="report-editor">
      <div class="report-editor-head">
        <div class="report-title-block">
          <div class="report-kicker">${icon('calendar')}DAILY REPORT · ${esc(weekday(report.date))}</div>
          <h2>${esc(Core.formatDateCN(report.date))}</h2>
          <p>${esc(state.profile.name)} · ${esc(state.profile.role)} · ${esc(state.profile.team)}</p>
        </div>
        <div class="report-actions">
          <div class="report-date-picker">
            <button class="icon-btn" type="button" data-action="report-prev-date" aria-label="前一天">${icon('chevron-left')}</button>
            <input type="date" value="${esc(report.date)}" data-role="report-date" aria-label="选择日报日期">
            <button class="icon-btn" type="button" data-action="report-next-date" aria-label="后一天">${icon('chevron-right')}</button>
          </div>
          <button class="btn" type="button" data-action="copy-report" title="复制 Markdown">${icon('copy')}<span>复制</span></button>
          <button class="btn" type="button" data-action="download-report" title="下载 Markdown">${icon('download')}<span>导出</span></button>
          <button class="btn" type="button" data-action="report-refresh" title="重新采集数据">${icon('refresh')}<span>采集</span></button>
        </div>
      </div>
      <div class="report-stats">
        <div class="report-stat"><span>完成任务</span><strong>${data.doneTasks.length}</strong></div>
        <div class="report-stat"><span>新发现 Bug</span><strong>${data.foundBugs.length}</strong></div>
        <div class="report-stat"><span>验证 Bug</span><strong>${data.verifiedBugs.length}</strong></div>
        <div class="report-stat"><span>进行中</span><strong>${data.ongoingTasks.length}</strong></div>
      </div>
      <form class="report-form" data-form="report" data-report-id="${esc(report.id)}">
        <div class="report-section">
          <div class="report-section-head">
            <label for="report-summary"><span class="report-section-num">01</span>今日摘要</label>
            <span class="report-section-hint">用一两句话概括今天的测试产出</span>
          </div>
          <textarea id="report-summary" name="summary" class="summary-area" placeholder="例如：完成核心回归并验证 2 个修复，版本准入风险可控。">${esc(report.content.summary)}</textarea>
        </div>
        <div class="report-section">
          <div class="report-section-head">
            <label for="report-done"><span class="report-section-num">02</span>已完成</label>
            <span class="report-section-hint">任务完成与 Bug 关闭会自动采集</span>
          </div>
          <textarea id="report-done" name="done" placeholder="每行一条">${esc(report.content.done)}</textarea>
        </div>
        <div class="report-section">
          <div class="report-section-head">
            <label for="report-bugs"><span class="report-section-num">03</span>Bug 跟踪</label>
            <span class="report-section-hint">新发现与验证结论</span>
          </div>
          <textarea id="report-bugs" name="bugs" placeholder="每行一条">${esc(report.content.bugs)}</textarea>
        </div>
        <div class="report-section">
          <div class="report-section-head">
            <label for="report-ongoing"><span class="report-section-num">04</span>进行中</label>
            <span class="report-section-hint">尚未收尾的工作与当前进度</span>
          </div>
          <textarea id="report-ongoing" name="ongoing" placeholder="每行一条">${esc(report.content.ongoing)}</textarea>
        </div>
        <div class="report-section">
          <div class="report-section-head">
            <label for="report-next"><span class="report-section-num">05</span>明日计划</label>
            <span class="report-section-hint">给明天留一份清晰的起点</span>
          </div>
          <textarea id="report-next" name="next" placeholder="每行一条">${esc(report.content.next)}</textarea>
        </div>
        <div class="report-section">
          <div class="report-section-head">
            <label for="report-risks"><span class="report-section-num">06</span>风险与阻塞</label>
            <span class="report-section-hint">需要协调或影响版本准入的问题</span>
          </div>
          <textarea id="report-risks" name="risks" placeholder="每行一条">${esc(report.content.risks)}</textarea>
        </div>
        <div class="report-form-footer">
          <div class="report-form-note">
            <span class="report-status-line" style="margin:0"><i class="report-status-dot ${report.status === 'submitted' ? 'submitted' : ''}"></i>${statusLabel} · 最后更新 ${esc(fmtDateTime(report.updatedAt))}</span>
          </div>
          <div class="report-form-actions">
            ${report.status === 'submitted' ? `<button class="btn" type="button" data-action="report-reopen">${icon('edit')}转为草稿</button>` : ''}
            <button class="btn" type="submit">${icon('check')}${report.status === 'submitted' ? '保存修改' : '保存草稿'}</button>
            ${report.status === 'submitted' ? '' : `<button class="btn btn-primary" type="button" data-action="report-submit">${icon('check-circle')}提交日报</button>`}
          </div>
        </div>
      </form>
    </article>`;
  }

  function renderReportEmpty() {
    const data = Core.collectDailyData(state, ui.reportDate);
    const previewItems = [
      ...data.doneTasks.slice(0, 2).map((task) => ({ icon: 'check-circle', tint: 'tint-teal', label: '完成任务', text: task.title })),
      ...data.foundBugs.slice(0, 2).map((bug) => ({ icon: 'bug', tint: 'tint-red', label: '新发现 Bug', text: `${bug.id} ${bug.title}` })),
      ...data.ongoingTasks.slice(0, 2).map((task) => ({ icon: 'activity', tint: 'tint-blue', label: '进行中', text: task.title }))
    ].slice(0, 3);
    const previewCount = data.doneTasks.length + data.foundBugs.length + data.verifiedBugs.length + data.ongoingTasks.length;
    return `<div class="report-empty">
      <div class="report-empty-copy">
        <div class="report-kicker">${icon('sparkles')}DAILY DIGEST · ${esc(weekday(ui.reportDate))}</div>
        <h2>${esc(Core.formatDateCN(ui.reportDate))} 还没有日报</h2>
        <p>一键采集当天的完成任务、Bug 发现与验证记录，自动生成可编辑的日报草稿。</p>
        <div class="report-empty-actions">
          <div class="report-date-picker">
            <button class="icon-btn" type="button" data-action="report-prev-date" aria-label="前一天">${icon('chevron-left')}</button>
            <input type="date" value="${esc(ui.reportDate)}" data-role="report-date" aria-label="选择日报日期">
            <button class="icon-btn" type="button" data-action="report-next-date" aria-label="后一天">${icon('chevron-right')}</button>
          </div>
          <button class="btn btn-primary btn-lg" type="button" data-action="report-generate">${icon('sparkles')}生成这一天的日报</button>
        </div>
        <div class="report-empty-note">${icon('shield')}日报只保存在本机，不会自动提交到禅道。</div>
      </div>
      <aside class="report-preview" aria-label="今日可采集内容">
        <div class="report-preview-head"><span>可采集内容</span><b>${previewCount} 条记录</b></div>
        <div class="report-preview-stats">
          <div><strong>${data.doneTasks.length}</strong><span>完成任务</span></div>
          <div><strong>${data.foundBugs.length}</strong><span>新发现</span></div>
          <div><strong>${data.verifiedBugs.length}</strong><span>验证通过</span></div>
          <div><strong>${data.ongoingTasks.length}</strong><span>进行中</span></div>
        </div>
        <div class="report-preview-list">
          ${previewItems.length ? previewItems.map((item) => `
            <div class="report-preview-item">
              <span class="report-preview-icon ${item.tint}">${icon(item.icon)}</span>
              <div><span>${esc(item.label)}</span><strong>${esc(item.text)}</strong></div>
            </div>`).join('') : `
            <div class="report-preview-empty">${icon('inbox')}<span>这一天还没有可自动采集的记录，生成后可以手动补充。</span></div>`}
        </div>
      </aside>
    </div>`;
  }

  function renderReports() {
    const report = currentReport();
    return `<div class="reports-layout">
      <aside class="report-history">
        <div class="report-history-head">
          <h2>日报记录</h2>
          <span>${state.reports.length} 篇</span>
        </div>
        <div class="report-history-list">${renderReportHistory()}</div>
      </aside>
      ${report ? renderReportEditor(report) : renderReportEmpty()}
    </div>`;
  }

  function autoGrowTextarea(area) {
    if (!area) return;
    area.style.height = 'auto';
    area.style.height = `${Math.max(area.scrollHeight + 2, area.classList.contains('summary-area') ? 74 : 66)}px`;
    area.style.overflowY = 'hidden';
  }

  function autoGrowReportTextareas() {
    $$('.report-section textarea').forEach(autoGrowTextarea);
  }

  function readReportForm(form) {
    const data = new FormData(form);
    return {
      summary: String(data.get('summary') || ''),
      done: String(data.get('done') || ''),
      bugs: String(data.get('bugs') || ''),
      ongoing: String(data.get('ongoing') || ''),
      next: String(data.get('next') || ''),
      risks: String(data.get('risks') || '')
    };
  }

  async function saveReportRemote(report, message) {
    try {
      const data = await apiRequest('/api/reports', { method: 'POST', body: report });
      const saved = data.report;
      const index = state.reports.findIndex((item) => item.date === saved.date);
      if (index >= 0) state.reports[index] = saved;
      else state.reports.push(saved);
      state.reports.sort((a, b) => b.date.localeCompare(a.date));
      if (message) showToast(message);
      return saved;
    } catch (error) {
      showToast(`保存日报失败：${error.message}`, 'error');
      return null;
    }
  }

  async function saveReportForm(showMessage) {
    const form = $('form[data-form="report"]');
    if (!form) return false;
    const report = currentReport();
    if (!report) return false;
    report.content = readReportForm(form);
    report.updatedAt = Core.nowIso();
    const saved = await saveReportRemote(
      report,
      showMessage === false ? '' : report.status === 'submitted' ? '日报修改已保存到本地服务。' : '日报草稿已保存到本地服务。'
    );
    return Boolean(saved);
  }

  async function generateReport(date) {
    if (!guardReady()) return;
    const day = date || Core.localDate();
    let report = state.reports.find((item) => item.date === day);
    if (!report) {
      report = Core.buildReport(state, day);
      state.reports.push(report);
      const saved = await saveReportRemote(report, `${Core.formatDateCN(day)} 的日报已生成并保存。`);
      if (!saved) {
        state.reports = state.reports.filter((item) => item.date !== day);
        return;
      }
    } else {
      showToast('已打开这一天的日报。', 'info');
    }
    ui.reportDate = day;
    persistState();
    navigate('reports');
    renderView(true);
  }

  /* =========================================================
     Settings
     ========================================================= */

  function renderSettings() {
    const z = state.zentao || {};
    const sync = state.sync || {};
    const counts = state.scopeCounts || { tasks: {}, bugs: {} };
    const warnings = sync.warnings || [];
    const product = z.product || {};
    const conn = z.connection || {};
    const products = state.products || [];
    const projects = state.projectList || [];
    const syncState = state.syncState || {};
    const lastError = syncState.lastError || '';
    return `<div class="settings-grid">
      <section class="settings-panel">
        <div class="settings-panel-head">
          <span class="settings-icon tint-blue">${icon('user')}</span>
          <div><h2>测试人员</h2><p>姓名与账号来自禅道，用于任务、Bug 和日报归属。</p></div>
        </div>
        <form class="profile-form" data-form="profile">
          <div class="form-field"><label for="setting-name">姓名</label><input id="setting-name" name="name" value="${esc(state.profile.name)}" readonly><span class="form-hint">由禅道账号实时读取。</span></div>
          <div class="form-field"><label for="setting-account">禅道账号</label><input id="setting-account" name="account" value="${esc(state.profile.account || '')}" readonly></div>
          <div class="form-field"><label for="setting-role">岗位</label><input id="setting-role" name="role" value="${esc(state.profile.role)}" maxlength="50"></div>
          <div class="form-field"><label for="setting-team">团队</label><input id="setting-team" name="team" value="${esc(state.profile.team)}" maxlength="50"></div>
          <div class="form-field full"><label for="setting-sprint">当前迭代标签</label><input id="setting-sprint" name="sprint" value="${esc(state.profile.sprint)}" maxlength="60"><span class="form-hint">仅用于界面与日报展示；任务迭代以禅道为准。</span></div>
          <div class="full settings-actions"><button class="btn btn-primary" type="submit">${icon('check')}保存展示信息</button></div>
        </form>
      </section>

      <section class="settings-panel">
        <div class="settings-panel-head">
          <span class="settings-icon tint-purple">${icon('database')}</span>
          <div><h2>禅道数据源</h2><p>自动读取当前账号可访问的全部产品与项目，后台静默同步。</p></div>
        </div>
        <div class="settings-facts">
          <div><span>连接状态</span><strong class="${lastError ? 'fact-warn' : 'fact-ok'}"><i></i>${syncState.syncing ? '后台同步中' : lastError ? '最近同步失败' : '已连接'}</strong></div>
          <div><span>登录方式</span><strong>${conn.source === 'saved' ? '已保存连接' : '本机 CLI 登录'}</strong></div>
          <div><span>禅道账号</span><strong>${esc(conn.account || z.account || '—')}</strong></div>
          <div><span>服务器</span><strong class="fact-url">${esc(conn.url || z.server || '—')}</strong></div>
          <div><span>产品范围</span><strong>${products.length} 个产品${products.length ? ` · 主产品 ${esc(product.name || '')}` : ''}</strong></div>
          <div><span>项目范围</span><strong>${projects.length} 个项目</strong></div>
          <div><span>客服反馈源</span><strong>${z.autojob && z.autojob.enabled ? `${(z.autojob.accounts || []).join(', ')} · ${z.autojob.scannedProducts || 0} 个产品` : '未启用'}</strong></div>
          <div><span>同步方式</span><strong>每天 ${(syncState.schedule || ['08:30', '12:00', '17:00']).join(' / ')} 自动全量 · 其余时间手动或单条更新</strong></div>
          <div><span>下次自动同步</span><strong>${esc(syncState.nextSyncAt ? fmtFullDate(syncState.nextSyncAt) : '—')}</strong></div>
          <div><span>最近同步</span><strong>${esc(fmtFullDate(sync.lastSyncAt))}</strong></div>
          <div><span>读取耗时</span><strong>${sync.durationMs ? `${(sync.durationMs / 1000).toFixed(1)} 秒` : '—'}</strong></div>
        </div>
        ${lastError ? `<div class="sync-warning">${icon('alert-triangle')}<span>最近一次后台同步失败：${esc(lastError)}</span></div>` : ''}
        ${warnings.length ? `<div class="sync-warning">${icon('alert-triangle')}<span>${warnings.map(esc).join('<br>')}</span></div>` : ''}
        <div class="data-action-row" style="margin-top:14px">
          <button class="btn btn-primary" type="button" data-action="edit-connection">${icon('user')}编辑连接</button>
          <button class="btn" type="button" data-action="sync-zentao">${icon('refresh')}立即同步</button>
        </div>
        <div class="data-note">${icon('shield')}<span>账号、密码与 URL 只保存在本机，接口不会回传密码。页面打开时直接使用缓存，禅道数据在后台更新，不会阻塞浏览。</span></div>
      </section>

      <section class="settings-panel">
        <div class="settings-panel-head">
          <span class="settings-icon tint-teal">${icon('download')}</span>
          <div><h2>数据与导出</h2><p>日报保存在本地服务，任务与 Bug 可直接导出。</p></div>
        </div>
        <div class="data-summary">
          <div class="data-stat"><span>产品</span><strong>${products.length}</strong></div>
          <div class="data-stat"><span>项目</span><strong>${projects.length}</strong></div>
          <div class="data-stat"><span>我的任务</span><strong>${counts.tasks.mine || 0}</strong></div>
          <div class="data-stat"><span>账号 Bug</span><strong>${counts.bugs.all || 0}</strong></div>
          <div class="data-stat"><span>客服反馈</span><strong>${counts.bugs.autojob || 0}</strong></div>
        </div>
        <div class="data-action-row">
          <button class="btn" type="button" data-action="export-json">${icon('download')}导出完整快照</button>
          <button class="btn" type="button" data-action="export-tasks-csv">${icon('download')}任务 CSV</button>
          <button class="btn" type="button" data-action="export-bugs-csv">${icon('download')}Bug CSV</button>
        </div>
        <div class="data-note">${icon('database')}<span>日报写入 <code>data/app-data.json</code>，任务与 Bug 每次同步从禅道重新读取，不在本地修改。</span></div>
      </section>

      <section class="settings-panel">
        <div class="settings-panel-head">
          <span class="settings-icon tint-amber">${icon('keyboard')}</span>
          <div><h2>快捷操作</h2><p>减少鼠标移动，把节奏留给测试。</p></div>
        </div>
        <div class="shortcut-list">
          <div class="shortcut-row"><span>全局搜索</span><kbd>Ctrl K</kbd></div>
          <div class="shortcut-row"><span>关闭弹窗 / 抽屉</span><kbd>Esc</kbd></div>
          <div class="shortcut-row"><span>刷新禅道数据</span><span class="muted">右上角同步按钮</span></div>
          <div class="shortcut-row"><span>切换日报日期</span><span class="muted">日期选择器</span></div>
        </div>
        <div class="version-line"><span>${icon('layers')} QDesk 测试工作台</span><span>v2.1 · 后台同步 · ZenTao CLI</span></div>
      </section>

      <section class="settings-panel wide">
        <div class="settings-panel-head">
          <span class="settings-icon tint-red">${icon('shield')}</span>
          <div><h2>数据边界</h2><p>避免误操作禅道中的正式记录。</p></div>
        </div>
        <div class="boundary-grid">
          <div><strong>任务</strong><p>只读。状态、负责人、截止日期均以禅道为准；需要变更请到禅道处理。</p></div>
          <div><strong>Bug</strong><p>支持登记新 Bug，也可编辑已有 Bug 并执行指派、解决、关闭、激活和删除；所有写入均通过禅道 CLI 完成。</p></div>
          <div><strong>日报</strong><p>仅保存在本地服务，不会回写禅道，也不会自动发送给团队。</p></div>
        </div>
      </section>
    </div>`;
  }

  /* =========================================================
     Task / Bug drawers
     ========================================================= */

  function renderDrawer() {
    if (!ui.drawer) {
      $('#drawer-root').innerHTML = '';
      syncBodyLock();
      return;
    }
    const root = $('#drawer-root');
    if (ui.drawer.type === 'task') {
      const task = taskById(ui.drawer.id);
      if (!task) {
        ui.drawer = null;
        root.innerHTML = '';
        syncBodyLock();
        return;
      }
      root.innerHTML = renderTaskDrawer(task);
    } else {
      const bug = bugById(ui.drawer.id);
      if (!bug) {
        ui.drawer = null;
        root.innerHTML = '';
        syncBodyLock();
        return;
      }
      root.innerHTML = renderBugDrawer(bug);
    }
    syncBodyLock();
    setTimeout(() => {
      const close = $('.drawer [data-action="close-drawer"]');
      if (close && !root.dataset.focused) {
        close.focus({ preventScroll: true });
        root.dataset.focused = '1';
      }
    }, 30);
  }

  function openTaskDrawer(id) {
    if (!guardReady()) return;
    closeQuickMenu();
    closeNotifications();
    ui.drawer = { type: 'task', id };
    $('#drawer-root').dataset.focused = '';
    renderDrawer();
  }

  function openBugPage(id) {
    if (!guardReady()) return;
    const bug = bugById(String(id));
    if (!bug) return;
    closeQuickMenu();
    closeNotifications();
    closeDrawer();
    ui.view = 'bugs';
    ui.bugDetailId = String(bug.id);
    ui.bugEditing = false;
    const nextHash = `#/bugs/${encodeURIComponent(bug.id)}`;
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    } else {
      renderView(true);
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }

  function closeBugPage() {
    ui.bugDetailId = null;
    ui.bugEditing = false;
    const nextHash = '#/bugs';
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    } else {
      renderView(true);
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }

  function closeDrawer() {
    ui.drawer = null;
    $('#drawer-root').innerHTML = '';
    $('#drawer-root').dataset.focused = '';
    syncBodyLock();
  }

  function timelineHtml(history) {
    if (!history || !history.length) return '<p class="drawer-description">暂无变更记录。</p>';
    return `<div class="timeline">${history.slice(0, 8).map((item) => `
      <div class="timeline-item">
        <span class="timeline-dot"></span>
        <div class="timeline-copy"><p>${esc(item.text)}</p><small>${esc(fmtFullDate(item.at))}</small></div>
      </div>`).join('')}</div>`;
  }

  function renderTaskDrawer(task) {
    const linkedBugs = state.allBugs.filter((bug) => bug.taskId === task.id);
    return `<div class="drawer-overlay" data-drawer-overlay></div>
      <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <header class="drawer-head">
          <div class="drawer-head-copy">
            <div class="drawer-kicker">${icon('tasks')}禅道任务 ${esc(task.displayId || '#' + task.id)} · ${esc(task.type)}</div>
            <h2 id="drawer-title">${esc(task.title)}</h2>
            <p>${esc(task.project)}${task.execution ? ` / ${esc(task.execution)}` : ''} · 创建于 ${esc(fmtDateTime(task.createdAt))}</p>
          </div>
          <button class="icon-btn" type="button" data-action="close-drawer" aria-label="关闭详情">${icon('close')}</button>
        </header>
        <div class="drawer-body">
          <div class="drawer-section">
            <div class="drawer-field-grid">
              <div class="drawer-field"><span>当前状态</span><div>${taskStatusPill(task.status)}</div></div>
              <div class="drawer-field"><span>优先级</span><div style="display:flex;align-items:center;gap:6px">${priorityDot(task.priority)}<strong style="font-size:10.5px">${esc(task.priority)}</strong></div></div>
              <div class="drawer-field"><span>负责人</span><strong>${esc(task.assignee || '未指派')}</strong></div>
              <div class="drawer-field"><span>${task.dueSource === 'execution' ? '迭代截止' : '任务截止'}</span><strong>${task.dueDate ? esc(Core.formatDateCN(task.dueDate, true)) : '未设置'}</strong></div>
              <div class="drawer-field"><span>预计工时</span><strong>${task.estimate ? `${task.estimate} 小时` : '未评估'}</strong></div>
              <div class="drawer-field"><span>所属项目</span><strong>${esc(task.project)}</strong></div>
              <div class="drawer-field"><span>所属执行</span><strong>${esc(task.execution || '—')}</strong></div>
              <div class="drawer-field"><span>任务类型</span><strong>${esc(task.type)}</strong></div>
            </div>
          </div>
          <div class="drawer-section">
            <div class="drawer-section-title">任务说明</div>
            <p class="drawer-description">${task.description ? esc(task.description) : '禅道中没有补充说明。'}</p>
            ${task.tags && task.tags.length ? `<div class="drawer-tags">${tagList(task.tags)}</div>` : ''}
          </div>
          ${linkedBugs.length ? `<div class="drawer-section">
            <div class="drawer-section-title">关联 Bug <span>${linkedBugs.length}</span></div>
            ${linkedBugs.map((bug) => `<button class="linked-item" type="button" data-action="open-bug" data-id="${esc(bug.id)}" style="margin-bottom:6px">
              ${severityBadge(bug.severity)}
              <span style="min-width:0;flex:1"><span class="linked-id">${esc(bug.displayId || '#' + bug.id)}</span><strong>${esc(bug.title)}</strong></span>
              ${bugStatusPill(bug.status, bug)}
            </button>`).join('')}
          </div>` : ''}
          <div class="drawer-section">
            <div class="drawer-section-title">变更记录</div>
            ${timelineHtml(task.history)}
          </div>
          <div class="readonly-note">${icon('shield')}<span>任务从禅道只读同步。需要修改状态、负责人或截止日期，请到禅道处理。</span></div>
        </div>
        <footer class="drawer-footer">
          <span class="drawer-source">${icon('database')}ZENTAO · ${esc(task.rawStatus)}</span>
          <span class="push"></span>
          <button class="btn btn-sm" type="button" data-action="close-drawer">关闭</button>
          ${task.url ? `<a class="btn btn-sm btn-primary" href="${esc(task.url)}" target="_blank" rel="noopener noreferrer">${icon('link')}在禅道打开</a>` : ''}
        </footer>
      </aside>`;
  }

  function renderBugDrawer(bug) {
    const task = bug.taskId ? taskById(bug.taskId) : null;
    return `<div class="drawer-overlay" data-drawer-overlay></div>
      <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <header class="drawer-head">
          <div class="drawer-head-copy">
            <div class="drawer-kicker">${icon('bug')}禅道 Bug ${esc(bug.displayId || '#' + bug.id)} · ${esc(bug.project)}</div>
            <h2 id="drawer-title">${esc(bug.title)}</h2>
            <p>${severityBadge(bug.severity)} <span style="display:inline-block;margin-left:4px">${bugStatusPill(bug.status, bug)}</span> <span class="role-badge" style="margin-left:6px">${esc(bug.typeLabel)}</span></p>
          </div>
          <button class="icon-btn" type="button" data-action="close-drawer" aria-label="关闭详情">${icon('close')}</button>
        </header>
        <div class="drawer-body">
          <div class="drawer-section">
            <div class="bug-facts">
              <div class="bug-fact"><span>严重程度</span><strong>${esc(bug.severityLabel)}</strong></div>
              <div class="bug-fact"><span>禅道状态</span><strong>${esc(bug.statusLabel)}</strong></div>
              <div class="bug-fact"><span>业务分类</span><strong>${esc(bug.businessCategory || '未归类')}</strong></div>
              <div class="bug-fact"><span>模块</span><strong>${esc(bug.module || '未指定')}</strong></div>
              <div class="bug-fact"><span>负责人</span><strong>${esc(bug.assignee)}</strong></div>
              <div class="bug-fact"><span>报告人</span><strong>${esc(bug.reporter)}</strong></div>
              <div class="bug-fact"><span>影响版本</span><strong>${esc(bug.version || '未填写')}</strong></div>
              <div class="bug-fact"><span>Bug 类型</span><strong>${esc(bug.typeLabel)}</strong></div>
              <div class="bug-fact"><span>创建时间</span><strong>${esc(fmtDateTime(bug.createdAt))}</strong></div>
              <div class="bug-fact"><span>更新时间</span><strong>${esc(fmtDateTime(bug.updatedAt))}</strong></div>
              ${bug.resolutionLabel ? `<div class="bug-fact"><span>解决方案</span><strong>${esc(bug.resolutionLabel)}</strong></div>` : ''}
              ${bug.environment ? `<div class="bug-fact full"><span>运行环境</span><strong>${esc(bug.environment)}</strong></div>` : ''}
            </div>
          </div>
          <div class="drawer-section">
            <div class="drawer-section-title">复现步骤</div>
            <div class="bug-text-block"><strong>Steps to reproduce</strong>${Core.renderRichText(bug.steps || '未填写')}</div>
          </div>
          ${(bug.expected || bug.actual) ? `<div class="drawer-section">
            <div class="drawer-section-title">预期结果 vs 实际结果</div>
            <div class="bug-text-block"><strong>预期结果</strong>${Core.renderRichText(bug.expected || '未填写')}</div>
            <div class="bug-text-block"><strong>实际结果</strong>${Core.renderRichText(bug.actual || '未填写')}</div>
          </div>` : ''}
          ${task ? `<div class="drawer-section">
            <div class="drawer-section-title">关联任务</div>
            <button class="linked-item" type="button" data-action="open-task" data-id="${esc(task.id)}">
              ${icon('tasks')}
              <span style="min-width:0;flex:1"><span class="linked-id">${esc(task.displayId || '#' + task.id)}</span><strong>${esc(task.title)}</strong></span>
              ${taskStatusPill(task.status)}
            </button>
          </div>` : ''}
          <div class="drawer-section">
            <div class="drawer-section-title">处理记录</div>
            ${timelineHtml(bug.history)}
          </div>
          <div class="readonly-note">${icon('shield')}<span>编辑、指派和状态流转会通过禅道 CLI 写入正式 Bug。</span></div>
        </div>
        <footer class="drawer-footer">
          <span class="drawer-source">${icon('database')}ZENTAO · ${esc(bug.rawStatus)}</span>
          <span class="push"></span>
          <button class="btn btn-sm" type="button" data-action="close-drawer">关闭</button>
          ${bug.url ? `<a class="btn btn-sm btn-primary" href="${esc(bug.url)}" target="_blank" rel="noopener noreferrer">${icon('link')}在禅道打开</a>` : ''}
        </footer>
      </aside>`;
  }

  /* =========================================================
     Modals
     ========================================================= */

  function syncBodyLock() {
    const locked = Boolean($('#modal-root').firstElementChild || $('#drawer-root').firstElementChild);
    document.body.style.overflow = locked ? 'hidden' : '';
  }

  function mountModal(html, options) {
    const opts = options || {};
    if ($('#modal-root').firstElementChild) closeModal({ restoreFocus: false });
    lastFocus = document.activeElement;
    const root = $('#modal-root');
    root.innerHTML = html;
    const overlay = $('.overlay', root);
    if (overlay) {
      overlay.addEventListener('mousedown', (event) => {
        if (event.target === overlay) closeModal();
      });
    }
    syncBodyLock();
    if (opts.onMount) opts.onMount(root);
    setTimeout(() => {
      const target = root.querySelector('[autofocus]') || root.querySelector('input:not([type="hidden"]), select, textarea, button');
      if (target) target.focus({ preventScroll: false });
    }, 30);
  }

  function closeModal(options) {
    const opts = options || {};
    if (!$('#modal-root').firstElementChild) return;
    $('#modal-root').innerHTML = '';
    syncBodyLock();
    if (confirmResolve) {
      confirmResolve(false);
      confirmResolve = null;
    }
    if (opts.restoreFocus !== false && lastFocus && lastFocus.isConnected) {
      try { lastFocus.focus({ preventScroll: true }); } catch (error) { /* noop */ }
    }
    lastFocus = null;
  }

  function field(label, inputHtml, options) {
    const opts = options || {};
    return `<div class="form-field${opts.full ? ' full' : ''}">
      <label>${esc(label)}${opts.required ? '<span class="required">*</span>' : ''}</label>
      ${inputHtml}
      ${opts.hint ? `<span class="form-hint">${esc(opts.hint)}</span>` : ''}
    </div>`;
  }

  function showFormError(form, message) {
    const box = $('.form-error', form);
    if (!box) return;
    box.textContent = message;
    box.classList.add('visible');
    const first = form.querySelector('input, select, textarea');
    if (first) first.focus();
  }

  function openTaskModal() {
    closeQuickMenu();
    closeNotifications();
    showToast('任务由禅道同步，请在禅道中创建或调整任务。', 'info');
  }

  function bugTypeOptions(selected) {
    const types = state.creation && state.creation.types
      ? state.creation.types
      : [{ value: 'codeerror', label: '代码错误' }, { value: 'others', label: '其他' }];
    return types.map((type) => `<option value="${esc(type.value)}"${type.value === selected ? ' selected' : ''}>${esc(type.label)}</option>`).join('');
  }

  function bugSeverityOptions(selected) {
    return Object.keys(Core.SEVERITY).map((key) => (
      `<option value="${key}"${key === selected ? ' selected' : ''}>${Core.SEVERITY[key].label}</option>`
    )).join('');
  }

  function bugPriorityOptions(selected) {
    const values = ['P0', 'P1', 'P2', 'P3'];
    return values.map((key) => `<option value="${key}"${key === selected ? ' selected' : ''}>${key} · ${key === 'P0' ? '最高' : key === 'P1' ? '高' : key === 'P2' ? '中' : '低'}</option>`).join('');
  }

  function bugProjectOptions(selected) {
    const projects = state.creation && state.creation.projects ? state.creation.projects : [];
    const current = String(selected || '');
    return `<option value="">不关联项目</option>${projects.map((project) => `<option value="${esc(project.id)}"${String(project.id) === current ? ' selected' : ''}>${esc(project.name)}</option>`).join('')}`;
  }

  function bugExecutionOptions(selected) {
    const executions = state.creation && state.creation.executions ? state.creation.executions : [];
    const current = String(selected || '');
    return `<option value="">不关联执行</option>${executions.map((exec) => `<option value="${esc(exec.id)}"${String(exec.id) === current ? ' selected' : ''}>${esc(exec.name)} · ${esc(exec.projectName)}</option>`).join('')}`;
  }

  async function openConnectionModal() {
    closeQuickMenu();
    closeNotifications();
    let conn = state && state.zentao && state.zentao.connection
      ? state.zentao.connection
      : null;
    if (!conn) {
      try {
        const result = await apiRequest('/api/connection');
        conn = result.connection;
      } catch (error) {
        conn = null;
      }
    }
    const saved = conn || {};
    const hasPassword = Boolean(saved.hasPassword);
    const passwordHint = hasPassword
      ? '已保存密码，留空则保持不变。'
      : '首次配置请填写禅道登录密码。';
    const html = `<div class="overlay">
      <form class="modal modal-lg modal-form" data-form="connection" novalidate>
        <div class="modal-head">
          <div class="modal-title-wrap"><h2>配置禅道连接</h2><p>只需 URL、账号和密码，保存后自动读取该账号可访问的全部产品与项目。</p></div>
          <button class="icon-btn modal-close" type="button" data-action="close-modal" aria-label="关闭">${icon('close')}</button>
        </div>
        <div class="modal-body">
          <div class="connection-banner">${icon('shield')}<span>密码只写入本机 <code>data/zentao-auth.json</code>，接口不会回传密码，也不会出现在日志中。如果本机 CLI 已经登录，也可以直接关闭此窗口继续使用。</span></div>
          <div class="form-grid">
            ${field('禅道 URL', `<input name="url" type="url" value="${esc(saved.url || '')}" placeholder="https://zentao.example.com" autocomplete="url" autofocus required>`, { full: true, required: true, hint: '支持带子路径，例如 https://example.com/zentao。' })}
            ${field('禅道账号', `<input name="account" value="${esc(saved.account || '')}" maxlength="64" autocomplete="username" placeholder="例如 zhangsan" required>`, { required: true })}
            ${field('禅道密码', `<input name="password" type="password" maxlength="512" autocomplete="new-password" placeholder="${hasPassword ? '已保存，留空保持不变' : '请输入禅道密码'}"${hasPassword ? '' : ' required'}>`, { required: !hasPassword, hint: passwordHint })}
            ${field('显示姓名', `<input name="testerName" value="${esc(saved.testerName || '')}" maxlength="50" placeholder="留空则自动读取禅道姓名">`, { full: true, hint: '用于工作台问候与日报署名。' })}
          </div>
          <div class="connection-scope-note">${icon('layers')}<span>无需填写产品 ID 或项目 ID：同步时会自动获取当前账号可访问的全部产品、项目与执行，Bug 按产品归类，任务按项目归类。</span></div>
          <div class="form-error" role="alert"></div>
          <div class="connection-result" hidden></div>
        </div>
        <div class="modal-footer">
          <span class="footer-left">${icon('database')}通过本机 zentao CLI 连接</span>
          <button class="btn" type="button" data-action="test-connection">测试连接</button>
          <button class="btn btn-primary" type="submit">${icon('check')}保存并同步</button>
        </div>
      </form>
    </div>`;

    mountModal(html, {
      onMount(root) {
        const form = $('form[data-form="connection"]', root);
        const submit = $('button[type="submit"]', form);
        const test = $('[data-action="test-connection"]', form);
        const resultBox = $('.connection-result', form);
        const submitLabel = submit.innerHTML;
        const testLabel = test.innerHTML;

        const payload = () => {
          const data = new FormData(form);
          return {
            url: String(data.get('url') || '').trim(),
            account: String(data.get('account') || '').trim(),
            password: String(data.get('password') || ''),
            testerName: String(data.get('testerName') || '').trim()
          };
        };

        const setBusy = (mode) => {
          const busy = Boolean(mode);
          submit.disabled = busy;
          test.disabled = busy;
          submit.innerHTML = mode === 'save' ? `<span class="spinner small"></span>正在连接并同步…` : submitLabel;
          test.innerHTML = mode === 'test' ? `<span class="spinner small"></span>正在测试…` : testLabel;
          form.dataset.busy = busy ? '1' : '';
        };

        const showResult = (message, tone) => {
          resultBox.hidden = false;
          resultBox.className = `connection-result ${tone || ''}`;
          resultBox.textContent = message;
        };

        const clearError = () => {
          const box = $('.form-error', form);
          if (!box) return;
          box.classList.remove('visible');
          box.textContent = '';
        };

        test.addEventListener('click', async () => {
          if (form.dataset.busy === '1') return;
          if (!form.reportValidity()) return;
          clearError();
          setBusy('test');
          resultBox.hidden = true;
          try {
            const result = await apiRequest('/api/zentao/test', { method: 'POST', body: payload(), timeoutMs: 35000 });
            const names = (result.products || []).slice(0, 3).map((product) => product.name).filter(Boolean);
            showResult(`连接成功：${result.account} · ${result.productCount || 0} 个产品 / ${result.projectCount || 0} 个项目${names.length ? ` · ${names.join('、')}${result.productCount > names.length ? ' 等' : ''}` : ''}`, 'success');
          } catch (error) {
            showFormError(form, error.message);
          } finally {
            setBusy('');
          }
        });

        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          if (form.dataset.busy === '1') return;
          if (!form.reportValidity()) return;
          clearError();
          resultBox.hidden = true;
          setBusy('save');
          try {
            const result = await apiRequest('/api/zentao/connection', {
              method: 'POST',
              body: payload(),
              timeoutMs: 120000
            });
            closeModal();
            if (result.snapshot && result.snapshot.sync && result.snapshot.sync.lastSyncAt) {
              applySnapshot(result.snapshot);
              syncing = Boolean(result.snapshot.syncState && result.snapshot.syncState.syncing);
              renderView(true);
              renderNotificationPanel();
              updateNotificationBadge();
              setSyncChrome();
              schedulePolling();
            } else {
              state = null;
              syncing = true;
              renderBootScreen();
              setSyncChrome();
              schedulePolling(2000);
            }
            showToast('禅道连接已保存，正在后台读取该账号的全部产品、项目与 Bug。', 'info');
          } catch (error) {
            showFormError(form, error.message);
            setBusy('');
          }
        });
      }
    });
  }

  function openBugModal() {
    if (!guardReady()) return;
    closeQuickMenu();
    closeNotifications();
    const creation = state.creation || {};
    const product = creation.product || { id: '', name: '禅道产品' };
    const products = creation.products && creation.products.length ? creation.products : [product];
    const buildLabel = creation.openedBuildLabel || '主干';
    const html = `<div class="overlay">
      <form class="modal modal-lg modal-form" data-form="bug" novalidate>
        <div class="modal-head">
          <div class="modal-title-wrap"><h2>登记 Bug</h2><p>提交后会直接写入禅道，生成正式 Bug 记录。</p></div>
          <button class="icon-btn modal-close" type="button" data-action="close-modal" aria-label="关闭">${icon('close')}</button>
        </div>
        <div class="modal-body">
          <div class="zt-create-banner">
            <span class="quick-icon tint-red">${icon('bug')}</span>
            <div><strong><span id="bug-product-name">${esc(product.name)}</span> <small>#<span id="bug-product-id">${esc(product.id)}</span></small></strong><span>影响版本 ${esc(buildLabel)} · 提交人 ${esc(state.profile.name)} · 通过禅道 CLI 创建</span></div>
          </div>
          <div class="form-grid">
            ${field('Bug 标题', `<input name="title" value="" maxlength="180" placeholder="一句话说明问题，可用【功能名】开头便于分类" autofocus required>`, { full: true, required: true, hint: '建议以【快速选股】【行情列表】等功能名开头，工作台会自动归入业务分类。' })}
            ${field('所属产品', `<select name="productId" required>${products.map((item) => `<option value="${esc(item.id)}"${item.id === product.id ? ' selected' : ''}>${esc(item.name)}（#${esc(item.id)}）</option>`).join('')}</select>`, { required: true, hint: '仅显示当前账号可访问的产品。' })}
            ${field('严重程度', `<select name="severity">${bugSeverityOptions('P1')}</select>`, { required: true })}
            ${field('优先级', `<select name="pri">${bugPriorityOptions('P2')}</select>`, { required: true })}
            ${field('Bug 类型', `<select name="type">${bugTypeOptions('codeerror')}</select>`, { required: true })}
            ${field('指派人', `<input name="assignedTo" maxlength="40" placeholder="禅道账号，可留空">`, { hint: '填写开发账号，留空时由禅道按产品规则指派。' })}
            ${field('所属项目', `<select name="projectId">${bugProjectOptions()}</select>`, { hint: '可选；留空则创建为产品级 Bug。' })}
            ${field('所属执行', `<select name="executionId">${bugExecutionOptions()}</select>`, { hint: '可选；一般选择当前 PC 版本迭代。' })}
            ${field('复现步骤', '<textarea name="steps" placeholder="1. 打开…&#10;2. 操作…&#10;3. 观察…"></textarea>', { full: true, hint: '建议包含环境、版本、操作路径和实际现象。' })}
            ${field('预期结果', `<textarea name="expected" placeholder="正确表现是什么？"></textarea>`, { full: true })}
            ${field('实际结果', `<textarea name="actual" placeholder="实际发生了什么？"></textarea>`, { full: true })}
          </div>
          <div class="form-error" role="alert"></div>
          <div class="create-warning">${icon('alert-triangle')}<span>这是正式写入操作。创建成功后，请到禅道继续处理状态流转；QDesk 中不会重复提交。</span></div>
        </div>
        <div class="modal-footer">
          <span class="footer-left">写入产品 <span id="bug-product-footer">${esc(product.name)}</span> · 影响版本 ${esc(buildLabel)}</span>
          <button class="btn" type="button" data-action="close-modal">取消</button>
          <button class="btn btn-primary" type="submit">${icon('check')}提交到禅道</button>
        </div>
      </form>
    </div>`;
    mountModal(html, {
      onMount(root) {
        const form = $('form[data-form="bug"]', root);
        const productSelect = $('[name="productId"]', form);
        if (productSelect) {
          productSelect.addEventListener('change', () => {
            const selected = products.find((item) => item.id === productSelect.value) || product;
            const name = $('#bug-product-name', form);
            const id = $('#bug-product-id', form);
            const footer = $('#bug-product-footer', form);
            if (name) name.textContent = selected.name;
            if (id) id.textContent = String(selected.id);
            if (footer) footer.textContent = selected.name;
          });
        }
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          if (form.dataset.submitting === '1') return;
          const data = new FormData(form);
          const title = String(data.get('title') || '').trim();
          if (!title) {
            showFormError(form, '请填写 Bug 标题。');
            return;
          }
          const button = $('button[type="submit"]', form);
          const original = button ? button.innerHTML : '';
          form.dataset.submitting = '1';
          if (button) {
            button.disabled = true;
            button.innerHTML = `<span class="spinner small"></span>正在写入禅道…`;
          }
          try {
            const result = await apiRequest('/api/bugs', {
              method: 'POST',
              body: {
                title,
                productId: String(data.get('productId') || product.id),
                severity: String(data.get('severity') || 'P1'),
                pri: String(data.get('pri') || 'P2'),
                type: String(data.get('type') || 'codeerror'),
                assignedTo: String(data.get('assignedTo') || '').trim(),
                projectId: String(data.get('projectId') || ''),
                executionId: String(data.get('executionId') || ''),
                steps: String(data.get('steps') || ''),
                expected: String(data.get('expected') || ''),
                actual: String(data.get('actual') || '')
              }
            });
            closeModal();
            ui.bugScope = 'opened';
            persistState();
            showToast(`${result.message || 'Bug 已创建。'} 正在后台刷新列表。`, 'success');
            syncing = true;
            setSyncChrome();
            schedulePolling(2000);
            navigate('bugs');
            if (result.id && bugById(String(result.id))) openBugPage(String(result.id));
          } catch (error) {
            showFormError(form, error.message);
            form.dataset.submitting = '';
            if (button) {
              button.disabled = false;
              button.innerHTML = original;
            }
          }
        });
      }
    });
  }

  function syncBugTaskLink(bug, oldTaskId, newTaskId) {
    state.tasks.forEach((task) => {
      if (oldTaskId && task.id === oldTaskId && oldTaskId !== newTaskId) {
        task.bugIds = (task.bugIds || []).filter((id) => id !== bug.id);
      }
      if (newTaskId && task.id === newTaskId && !(task.bugIds || []).includes(bug.id)) {
        task.bugIds = task.bugIds || [];
        task.bugIds.push(bug.id);
      }
    });
  }

  function confirmDialog(options) {
    const opts = options || {};
    return new Promise((resolve) => {
      if (confirmResolve) {
        confirmResolve(false);
        confirmResolve = null;
      }
      confirmResolve = resolve;
      const tone = opts.danger ? 'btn-danger' : 'btn-primary';
      const html = `<div class="overlay">
        <div class="modal modal-sm" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <div class="modal-head">
            <div class="modal-title-wrap"><h2 id="confirm-title">${esc(opts.title || '请确认')}</h2><p>${esc(opts.subtitle || '这个操作需要你的确认。')}</p></div>
            <button class="icon-btn" type="button" data-action="close-modal" aria-label="关闭">${icon('close')}</button>
          </div>
          <div class="modal-body"><p style="margin:0;color:var(--ink-soft);font-size:11px;line-height:1.8">${esc(opts.message || '')}</p></div>
          <div class="modal-footer">
            <button class="btn" type="button" data-action="close-modal">取消</button>
            <button class="btn ${tone}" type="button" data-confirm-button>${esc(opts.confirmText || '确认')}</button>
          </div>
        </div>
      </div>`;
      mountModal(html, {
        onMount(root) {
          const ok = $('[data-confirm-button]', root);
          ok.addEventListener('click', () => {
            const finish = confirmResolve;
            confirmResolve = null;
            closeModal({ restoreFocus: false });
            if (finish) finish(true);
          });
        }
      });
    });
  }

  /* =========================================================
     Actions
     ========================================================= */

  async function toggleTaskDone() {
    showToast('任务从禅道只读同步，请到禅道完成任务。', 'warn');
  }

  async function changeTaskStatus() {
    showToast('任务状态以禅道为准，请在禅道中更新。', 'warn');
  }

  async function changeBugStatus() {
    showToast('请在 Bug 详情页使用编辑、解决、关闭或激活操作。', 'info');
  }

  async function deleteTask() {
    showToast('QDesk 不删除禅道任务。如需关闭，请在禅道处理。', 'warn');
  }

  async function deleteBug() {
    showToast('QDesk 不删除禅道 Bug。如需关闭，请在禅道处理。', 'warn');
  }

  async function refreshReportData() {
    const report = currentReport();
    if (!report) return;
    const ok = await confirmDialog({
      title: '重新采集数据？',
      subtitle: '会覆盖当前日报中的自动汇总内容。',
      message: report.status === 'submitted'
        ? '这篇日报已经提交，重新采集会覆盖现有内容并把状态改为草稿。建议先复制备份。'
        : '重新采集会覆盖当前六个栏目的内容，包括你手动修改过的文字。',
      confirmText: '重新采集',
      danger: report.status === 'submitted'
    });
    if (!ok) return;
    const regenerated = Core.buildReport(state, report.date);
    report.content = regenerated.content;
    report.status = 'draft';
    report.submittedAt = null;
    report.updatedAt = Core.nowIso();
    const saved = await saveReportRemote(report, '已根据当前禅道任务与 Bug 数据重新生成。');
    if (saved) refreshAll({ animate: true });
  }

  async function submitReport() {
    const form = $('form[data-form="report"]');
    const report = currentReport();
    if (!report) return;
    if (form) {
      report.content = readReportForm(form);
    }
    if (!report.content.summary.trim()) {
      showToast('请先填写今日摘要，再提交日报。', 'warn');
      const summary = $('#report-summary');
      if (summary) summary.focus();
      return;
    }
    report.status = 'submitted';
    report.submittedAt = Core.nowIso();
    report.updatedAt = report.submittedAt;
    const saved = await saveReportRemote(report, '日报已提交并保存到本地服务。');
    if (saved) refreshAll({ animate: false });
  }

  async function reopenReport() {
    const report = currentReport();
    if (!report) return;
    const ok = await confirmDialog({
      title: '将日报转为草稿？',
      subtitle: '提交状态会被撤销。',
      message: '你可以继续编辑内容，稍后重新提交。',
      confirmText: '转为草稿'
    });
    if (!ok) return;
    report.status = 'draft';
    report.submittedAt = null;
    report.updatedAt = Core.nowIso();
    const saved = await saveReportRemote(report, '日报已转为草稿。');
    if (saved) refreshAll({ animate: false });
  }

  async function copyReport() {
    const report = currentReport();
    if (!report) return;
    const markdown = Core.renderReportMarkdown(report, state.profile);
    try {
      await navigator.clipboard.writeText(markdown);
      showToast('日报 Markdown 已复制到剪贴板。');
    } catch (error) {
      const textarea = document.createElement('textarea');
      textarea.value = markdown;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
      showToast('日报 Markdown 已复制。');
    }
  }

  function downloadReport() {
    const report = currentReport();
    if (!report) return;
    const markdown = Core.renderReportMarkdown(report, state.profile);
    downloadFile(markdown, `工作日报_${report.date}.md`, 'text/markdown;charset=utf-8');
    showToast('日报已下载为 Markdown。');
  }

  function downloadFile(content, filename, type) {
    const isCsv = String(type).includes('csv');
    const blob = new Blob([isCsv ? '﻿' + content : content], { type: type || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function csvCell(value) {
    return `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
  }

  function exportJson() {
    const payload = Object.assign({}, state, { exportedAt: Core.nowIso(), app: 'QDesk 测试工作台' });
    downloadFile(JSON.stringify(payload, null, 2), `QDesk_backup_${Core.localDate()}.json`, 'application/json;charset=utf-8');
    showToast('完整备份已导出。');
  }

  function exportTasksCsv() {
    const headers = ['编号', '标题', '类型', '优先级', '状态', '禅道状态', '项目', '执行', '截止日期', '截止来源', '工时', '负责人', '标签', '创建时间', '完成时间', '说明'];
    const rows = state.allTasks.map((task) => [
      task.id, task.title, task.type, task.priority, Core.TASK_STATUS[task.status].label, task.rawStatus,
      task.project, task.execution, task.dueDate, task.dueSource === 'execution' ? '迭代截止' : '任务截止',
      task.estimate, task.assignee, (task.tags || []).join(' / '), fmtFullDate(task.createdAt), fmtFullDate(task.completedAt), task.description
    ]);
    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
    downloadFile(csv, `任务清单_${Core.localDate()}.csv`, 'text/csv;charset=utf-8');
    showToast('任务 CSV 已导出。');
  }

  function exportBugsCsv() {
    const headers = ['编号', '标题', '严重程度', '禅道状态', '类型', '业务分类', '产品', '模块', '影响版本', '负责人', '报告人', '复现步骤', '预期结果', '实际结果', '创建时间', '解决时间', '关闭时间'];
    const rows = state.allBugs.map((bug) => [
      bug.id, bug.title, bug.severity, bug.statusLabel, bug.typeLabel, bug.businessCategory, bug.project, bug.module,
      bug.version, bug.assignee, bug.reporter, bug.steps, bug.expected, bug.actual,
      fmtFullDate(bug.createdAt), fmtFullDate(bug.resolvedAt), fmtFullDate(bug.closedAt)
    ]);
    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
    downloadFile(csv, `Bug清单_${Core.localDate()}.csv`, 'text/csv;charset=utf-8');
    showToast('Bug CSV 已导出。');
  }

  function triggerImport() {
    const input = $('#import-file');
    if (input) input.click();
  }

  function handleImportFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      let parsed;
      try {
        parsed = JSON.parse(String(reader.result || ''));
      } catch (error) {
        showToast('备份文件不是有效的 JSON。', 'error');
        event.target.value = '';
        return;
      }
      if (!parsed || !Array.isArray(parsed.tasks) || !Array.isArray(parsed.bugs)) {
        showToast('备份文件缺少 tasks 或 bugs 数据。', 'error');
        event.target.value = '';
        return;
      }
      const ok = await confirmDialog({
        title: '导入这份备份？',
        subtitle: '当前数据将被备份内容替换。',
        message: `备份包含 ${parsed.tasks.length} 个任务、${parsed.bugs.length} 个 Bug、${Array.isArray(parsed.reports) ? parsed.reports.length : 0} 篇日报。建议先导出当前数据再导入。`,
        confirmText: '覆盖并导入',
        danger: true
      });
      if (!ok) {
        event.target.value = '';
        return;
      }
      state = Core.normalizeState(parsed);
      ui.taskFilters = { q: '', status: 'all', priority: 'all', project: 'all', due: 'all' };
      ui.bugFilters = { q: '', status: 'all', severity: 'all', project: 'all', mine: false };
      ui.reportDate = state.reports.length ? sortedReports()[0].date : Core.localDate();
      persistState();
      refreshAll({ animate: false });
      showToast('备份已导入。');
      event.target.value = '';
    };
    reader.onerror = () => {
      showToast('读取文件失败，请重试。', 'error');
      event.target.value = '';
    };
    reader.readAsText(file, 'utf-8');
  }

  async function clearData() {
    const ok = await confirmDialog({
      title: '清空工作台数据？',
      subtitle: '个人信息和项目列表会保留。',
      message: '所有任务、Bug 和日报将被永久删除，且无法恢复。',
      confirmText: '清空数据',
      danger: true
    });
    if (!ok) return;
    state.tasks = [];
    state.bugs = [];
    state.reports = [];
    ui.reportDate = Core.localDate();
    if (ui.drawer) closeDrawer();
    persistState();
    refreshAll({ animate: false });
    showToast('工作台已清空，可以开始记录新的工作。');
  }

  async function resetDemo() {
    const ok = await confirmDialog({
      title: '恢复演示数据？',
      subtitle: '当前全部数据会被示例内容覆盖。',
      message: '示例包含任务、Bug 和昨日日报，适合重新体验完整流程。请确认已经导出需要保留的数据。',
      confirmText: '恢复演示数据',
      danger: true
    });
    if (!ok) return;
    const preserve = state.profile;
    const projects = state.projects;
    state = Core.defaultState();
    state.profile = preserve;
    state.projects = projects.length ? projects : state.projects;
    ui.taskFilters = { q: '', status: 'all', priority: 'all', project: 'all', due: 'all' };
    ui.bugFilters = { q: '', status: 'all', severity: 'all', project: 'all', mine: false };
    ui.reportDate = Core.localDate();
    if (ui.drawer) closeDrawer();
    persistState();
    refreshAll({ animate: false });
    showToast('演示数据已恢复。');
  }

  async function saveProfile(form) {
    const data = new FormData(form);
    const profile = {
      role: String(data.get('role') || '').trim(),
      team: String(data.get('team') || '').trim(),
      sprint: String(data.get('sprint') || '').trim()
    };
    try {
      const result = await apiRequest('/api/settings', {
        method: 'POST',
        body: {
          profile,
          preferences: {
            taskView: ui.taskView,
            taskScope: ui.taskScope,
            bugScope: ui.bugScope
          }
        }
      });
      const settings = result.settings;
      state.settings = settings;
      state.profile.role = settings.profile.role;
      state.profile.team = settings.profile.team;
      state.profile.sprint = settings.profile.sprint;
      renderView(false);
      updateChrome();
      showToast('展示信息已保存到本地服务。');
    } catch (error) {
      showToast(`保存失败：${error.message}`, 'error');
    }
  }

  /* =========================================================
     Notifications, quick create, command palette
     ========================================================= */

  function getNotifications() {
    const today = Core.localDate();
    const items = [];
    state.tasks.forEach((task) => {
      if (task.status === 'done') return;
      if (task.status === 'blocked') {
        items.push({ type: 'task', id: task.id, title: task.title, meta: '任务已阻塞，需要协调', color: '#f0783c', weight: 1 });
      } else if (task.dueDate && task.dueDate < today) {
        items.push({ type: 'task', id: task.id, title: task.title, meta: `已逾期 ${Core.relativeDay(task.dueDate, today)}`, color: '#e95366', weight: 0 });
      } else if (task.dueDate === today) {
        items.push({ type: 'task', id: task.id, title: task.title, meta: '今天到期', color: '#e69b28', weight: 2 });
      }
    });
    state.bugs.forEach((bug) => {
      if (bug.status === 'closed') return;
      if (bug.severity === 'P0' || bug.severity === 'P1') {
        items.push({ type: 'bug', id: bug.id, title: bug.title, meta: `${bug.severity} · ${bugStatusLabel(bug)}`, color: SEVERITY_COLOR[bug.severity], weight: bug.severity === 'P0' ? 0 : 1 });
      }
    });
    const autojob = state.autojobStats;
    if (autojob && autojob.active) {
      items.push({
        type: 'autojob',
        id: '',
        title: `客服反馈还有 ${autojob.active} 条待验证`,
        meta: `${autojob.highPriorityOpen ? `${autojob.highPriorityOpen} 条 P0/P1 · ` : ''}AI 从客服群聊提取`,
        color: '#e95366',
        weight: 0
      });
    }
    if (Core.metrics(state).reportStatus === 'none') {
      items.push({ type: 'report', id: today, title: '今天的日报还没有生成', meta: '花一分钟汇总今天的工作', color: '#11aa99', weight: 3 });
    }
    return items.sort((a, b) => a.weight - b.weight).slice(0, 8);
  }

  function renderNotificationPanel() {
    const panel = $('#notification-panel');
    if (!panel) return;
    const items = getNotifications();
    panel.innerHTML = `<div class="notification-head"><strong>今日提醒</strong><span>${items.length} 条</span></div>
      <div class="notification-list">
        ${items.length ? items.map((item) => `
          <button class="notification-item" type="button" data-action="${item.type === 'task' ? 'open-task' : item.type === 'bug' ? 'open-bug' : item.type === 'autojob' ? 'open-autojob' : 'report-today'}" data-id="${esc(item.id)}">
            <span class="dot" style="background:${item.color}"></span>
            <span style="min-width:0;flex:1"><strong>${esc(item.title)}</strong><small>${esc(item.meta)}</small></span>
            ${icon('chevron-right')}
          </button>`).join('') : `
          <div style="padding:26px 18px;text-align:center;color:var(--muted);font-size:10px">
            ${icon('check-circle')}<div style="margin-top:7px">今天没有逾期或高优先级提醒</div>
          </div>`}
      </div>`;
  }

  function toggleNotifications() {
    if (!guardReady()) return;
    const panel = $('#notification-panel');
    const shouldOpen = panel.hidden;
    closeQuickMenu();
    if (shouldOpen) {
      renderNotificationPanel();
      panel.hidden = false;
    } else {
      panel.hidden = true;
    }
  }

  function closeNotifications() {
    const panel = $('#notification-panel');
    if (panel) panel.hidden = true;
  }

  function closeQuickMenu() {
    const menu = $('#quick-create-menu');
    const button = $('.quick-create-btn');
    if (menu) menu.hidden = true;
    if (button) button.setAttribute('aria-expanded', 'false');
  }

  function toggleQuickMenu() {
    const menu = $('#quick-create-menu');
    const button = $('.quick-create-btn');
    const shouldOpen = menu.hidden;
    closeNotifications();
    menu.hidden = !shouldOpen;
    button.setAttribute('aria-expanded', String(shouldOpen));
  }

  function openSidebar() {
    $('#sidebar').classList.add('open');
    $('#sidebar-scrim').classList.add('visible');
  }

  function closeSidebar() {
    $('#sidebar').classList.remove('open');
    $('#sidebar-scrim').classList.remove('visible');
  }

  function openCommand() {
    if (!guardReady()) return;
    closeQuickMenu();
    closeNotifications();
    closeSidebar();
    const root = $('#command-root');
    root.innerHTML = `<div class="command-overlay" data-command-overlay>
      <div class="command-panel" role="dialog" aria-modal="true" aria-label="全局搜索">
        <div class="command-input-wrap">
          ${icon('search')}
          <input id="command-input" class="command-input" type="text" placeholder="搜索任务、Bug，或输入操作…" autocomplete="off" aria-label="搜索任务、Bug 或操作">
          <kbd>ESC</kbd>
        </div>
        <div class="command-results" id="command-results"></div>
        <div class="command-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd>选择</span>
          <span><kbd>↵</kbd>打开</span>
          <span><kbd>ESC</kbd>关闭</span>
        </div>
      </div>
    </div>`;
    commandIndex = 0;
    renderCommandResults('');
    const input = $('#command-input');
    input.addEventListener('input', () => {
      commandIndex = 0;
      renderCommandResults(input.value);
    });
    const overlay = $('[data-command-overlay]', root);
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) closeCommand();
    });
    setTimeout(() => input.focus(), 30);
  }

  function closeCommand() {
    const root = $('#command-root');
    if (root) root.innerHTML = '';
    commandItems = [];
    commandIndex = 0;
  }

  function buildCommandItems(query) {
    const q = String(query || '').trim().toLowerCase();
    const actions = [
      { group: '操作', label: '同步禅道数据', sub: '后台刷新测试任务、Bug 与分类统计', icon: 'refresh', tint: 'tint-blue', run: () => startManualSync() },
      { group: '操作', label: '登记 Bug', sub: '选择产品后写入禅道', icon: 'bug', tint: 'tint-red', run: () => openBugModal() },
      { group: '操作', label: '生成今日日报', sub: '自动汇总任务与 Bug 进展', icon: 'sparkles', tint: 'tint-teal', run: () => generateReport(Core.localDate()) }
    ];
    const pages = [
      { group: '页面', label: 'QDesk 工作台', sub: '查看今日聚焦与质量概览', icon: 'home', tint: 'tint-blue', run: () => navigate('dashboard') },
      { group: '页面', label: '测试任务', sub: '我的任务与全部测试任务', icon: 'tasks', tint: 'tint-blue', run: () => navigate('tasks') },
      { group: '页面', label: 'Bug 跟踪', sub: '数量、分类、范围与详情', icon: 'bug', tint: 'tint-red', run: () => navigate('bugs') },
      { group: '页面', label: '工作日报', sub: '生成、编辑与导出日报', icon: 'report', tint: 'tint-teal', run: () => navigate('reports') },
      { group: '页面', label: '偏好与数据', sub: '禅道连接、同步范围与导出', icon: 'settings', tint: 'tint-purple', run: () => navigate('settings') }
    ];
    const taskItems = state.allTasks
      .filter((task) => !q || [task.title, task.id, task.project, task.execution, task.type, ...(task.tags || [])].join(' ').toLowerCase().includes(q))
      .slice(0, q ? 6 : 3)
      .map((task) => ({
        group: '任务',
        label: task.title,
        sub: `${task.displayId || '#' + task.id} · ${task.project} · ${Core.TASK_STATUS[task.status].label}`,
        icon: 'tasks',
        tint: 'tint-blue',
        run: () => openTaskDrawer(task.id)
      }));
    const bugItems = state.allBugs
      .filter((bug) => !q || [bug.title, bug.id, bug.project, bug.module, bug.assignee, bug.businessCategory].join(' ').toLowerCase().includes(q))
      .slice(0, q ? 6 : 3)
      .map((bug) => ({
        group: 'Bug',
        label: bug.title,
        sub: `${bug.displayId || '#' + bug.id} · ${bug.severity} · ${bug.statusLabel}`,
        icon: 'bug',
        tint: 'tint-red',
        run: () => openBugPage(bug.id)
      }));

    const matches = (item) => !q || `${item.label} ${item.sub}`.toLowerCase().includes(q);
    if (!q) return [...actions, ...pages, ...taskItems, ...bugItems];
    return [...pages.filter(matches), ...actions.filter(matches), ...taskItems, ...bugItems];
  }

  function renderCommandResults(query) {
    commandItems = buildCommandItems(query);
    const host = $('#command-results');
    if (!host) return;
    if (!commandItems.length) {
      host.innerHTML = `<div class="command-empty">没有找到与「${esc(query)}」相关的内容</div>`;
      return;
    }
    let lastGroup = '';
    let index = 0;
    const parts = [];
    commandItems.forEach((item) => {
      if (item.group !== lastGroup) {
        parts.push(`<div class="command-group-label">${esc(item.group)}</div>`);
        lastGroup = item.group;
      }
      parts.push(`<button class="command-item${index === commandIndex ? ' selected' : ''}" type="button" data-action="command-run" data-command-index="${index}">
        <span class="command-icon ${item.tint}">${icon(item.icon)}</span>
        <span class="command-copy"><strong>${esc(item.label)}</strong><small>${esc(item.sub)}</small></span>
        ${icon('arrow-up-right')}
      </button>`);
      index += 1;
    });
    host.innerHTML = parts.join('');
  }

  function runCommand(index) {
    const item = commandItems[index];
    if (!item) return;
    closeCommand();
    item.run();
  }

  function moveCommand(delta) {
    if (!commandItems.length) return;
    commandIndex = (commandIndex + delta + commandItems.length) % commandItems.length;
    const input = $('#command-input');
    const query = input ? input.value : '';
    renderCommandResults(query);
    const selected = $('.command-item.selected');
    if (selected) selected.scrollIntoView({ block: 'nearest' });
  }

  /* =========================================================
     Toasts and event wiring
     ========================================================= */

  function showToast(message, tone) {
    const stack = $('#toast-root');
    if (!stack) return;
    const toast = document.createElement('div');
    toast.className = `toast${tone === 'error' ? ' error' : tone === 'warn' ? ' warn' : ''}`;
    toast.innerHTML = `${icon(tone === 'error' ? 'alert-circle' : tone === 'warn' ? 'alert-triangle' : 'check-circle')}<span>${esc(message)}</span>`;
    stack.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(10px)';
      toast.style.transition = 'opacity 160ms ease, transform 160ms ease';
      setTimeout(() => toast.remove(), 180);
    }, tone === 'error' ? 4800 : 3200);
  }

  function focusTrap(event) {
    if (event.key !== 'Tab') return;
    const container = $('#modal-root').querySelector('.modal') || $('#drawer-root').querySelector('.drawer');
    if (!container) return;
    const focusable = $$('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', container)
      .filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function handleDocumentClick(event) {
    const quick = event.target.closest('.quick-create');
    if (!quick) closeQuickMenu();
    const notification = event.target.closest('.notification-wrap');
    if (!notification) closeNotifications();

    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    if (!action) return;

    if (action === 'navigate') {
      event.preventDefault();
      navigate(actionEl.dataset.view);
      return;
    }
    if (action === 'open-sidebar') { openSidebar(); return; }
    if (action === 'close-sidebar') { closeSidebar(); return; }
    if (action === 'open-command') { openCommand(); return; }
    if (action === 'close-command') { closeCommand(); return; }
    if (action === 'command-run') {
      runCommand(Number(actionEl.dataset.commandIndex));
      return;
    }
    if (action === 'toggle-quick-create') { toggleQuickMenu(); return; }
    if (action === 'toggle-notifications') { toggleNotifications(); return; }
    if (action === 'sync-zentao') {
      closeQuickMenu();
      closeNotifications();
      startManualSync();
      return;
    }
    if (action === 'retry-boot') {
      renderBootScreen();
      pullData({ initial: true });
      return;
    }
    if (action === 'configure-connection' || action === 'edit-connection') {
      closeQuickMenu();
      closeNotifications();
      openConnectionModal();
      return;
    }
    if (action === 'create-task') { closeQuickMenu(); closeNotifications(); openTaskModal(); return; }
    if (action === 'create-bug') { closeQuickMenu(); closeNotifications(); openBugModal(); return; }
    if (action === 'create-report') { closeQuickMenu(); closeNotifications(); generateReport(Core.localDate()); return; }
    if (action === 'report-generate') { generateReport(ui.reportDate); return; }
    if (action === 'report-today') { ui.reportDate = Core.localDate(); closeNotifications(); navigate('reports'); return; }
    if (action === 'open-task') { openTaskDrawer(actionEl.dataset.id); return; }
    if (action === 'open-bug') { openBugPage(actionEl.dataset.id); return; }
    if (action === 'close-bug-page') { closeBugPage(); return; }
    if (action === 'edit-bug-page') { openBugEdit(actionEl.dataset.id); return; }
    if (action === 'close-bug-edit') { closeBugEdit(); return; }
    if (action === 'bug-action') { openBugAction(actionEl.dataset.bugAction, actionEl.dataset.id); return; }
    if (action === 'close-drawer') { closeDrawer(); return; }
    if (action === 'close-modal') { closeModal(); return; }
    if (action === 'edit-task') { showToast('任务从禅道只读同步，请到禅道编辑。', 'warn'); return; }
    if (action === 'edit-bug') { const bug = bugById(actionEl.dataset.id); if (bug) openBugEdit(bug.id); return; }
    if (action === 'delete-task') { deleteTask(); return; }
    if (action === 'delete-bug') { deleteBug(); return; }
    if (action === 'toggle-task-done') { toggleTaskDone(); return; }
    if (action === 'add-task-status') { openTaskModal(); return; }
    if (action === 'kpi-tasks') {
      ui.taskScope = 'mine';
      ui.taskFilters = { q: '', status: 'all', priority: 'all', project: 'all', due: 'all' };
      navigate('tasks');
      persistState();
      return;
    }
    if (action === 'kpi-bugs') {
      ui.bugScope = 'opened';
      ui.bugFilters = { q: '', status: 'unclosed', severity: 'all', type: 'all', product: 'all', project: 'all' };
      navigate('bugs');
      persistState();
      return;
    }
    if (action === 'open-autojob') {
      closeQuickMenu();
      closeNotifications();
      ui.bugScope = 'autojob';
      ui.bugFilters = { q: '', status: 'unclosed', severity: 'all', type: 'all', product: 'all', project: 'all' };
      navigate('bugs');
      persistState();
      return;
    }
    if (action === 'kpi-due') {
      ui.taskScope = 'mine';
      ui.taskFilters = { q: '', status: 'all', priority: 'all', project: 'all', due: 'today' };
      navigate('tasks');
      persistState();
      return;
    }
    if (action === 'kpi-report') {
      ui.reportDate = Core.localDate();
      navigate('reports');
      persistState();
      return;
    }
    if (action === 'set-task-scope') {
      ui.taskScope = ['mine', 'test', 'all'].includes(actionEl.dataset.scope) ? actionEl.dataset.scope : 'mine';
      persistState();
      renderView(false);
      return;
    }
    if (action === 'filter-task-project') {
      ui.taskFilters.project = actionEl.dataset.project || 'all';
      renderView(false);
      return;
    }
    if (action === 'sort-bugs') {
      const key = actionEl.dataset.sort === 'createdAt' ? 'createdAt' : 'updatedAt';
      if (ui.bugSort.key === key) {
        ui.bugSort.dir = ui.bugSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        ui.bugSort = { key, dir: 'desc' };
      }
      persistState();
      renderView(false);
      return;
    }
    if (action === 'set-bug-scope') {
      ui.bugScope = ['opened', 'assigned', 'autojob', 'all'].includes(actionEl.dataset.scope) ? actionEl.dataset.scope : 'opened';
      persistState();
      renderView(false);
      return;
    }
    if (action === 'set-task-view') {
      ui.taskView = actionEl.dataset.view === 'list' ? 'list' : 'board';
      persistState();
      renderView(false);
      return;
    }
    if (action === 'toggle-task-due') {
      ui.taskFilters.due = ui.taskFilters.due === 'today' ? 'all' : 'today';
      actionEl.classList.toggle('active', ui.taskFilters.due === 'today');
      actionEl.style.background = ui.taskFilters.due === 'today' ? '#fff' : 'rgba(255,255,255,.65)';
      renderTaskResults();
      return;
    }
    if (action === 'clear-task-filters') {
      ui.taskFilters = { q: '', status: 'all', priority: 'all', project: 'all', due: 'all' };
      renderView(false);
      return;
    }
    if (action === 'clear-bug-filters') {
      ui.bugFilters = { q: '', status: 'all', severity: 'all', type: 'all', project: 'all' };
      renderView(false);
      return;
    }
    if (action === 'filter-bugs-severity') {
      ui.bugFilters.severity = actionEl.dataset.severity;
      ui.bugFilters.q = '';
      navigate('bugs');
      renderView(true);
      return;
    }
    if (action === 'report-select') {
      ui.reportDate = actionEl.dataset.date;
      renderView(true);
      return;
    }
    if (action === 'report-prev-date') {
      ui.reportDate = Core.addDays(ui.reportDate, -1);
      renderView(true);
      return;
    }
    if (action === 'report-next-date') {
      ui.reportDate = Core.addDays(ui.reportDate, 1);
      renderView(true);
      return;
    }
    if (action === 'report-refresh') { refreshReportData(); return; }
    if (action === 'report-submit') { submitReport(); return; }
    if (action === 'report-reopen') { reopenReport(); return; }
    if (action === 'copy-report') { copyReport(); return; }
    if (action === 'download-report') { downloadReport(); return; }
    if (action === 'export-json') { exportJson(); return; }
    if (action === 'export-tasks-csv') { exportTasksCsv(); return; }
    if (action === 'export-bugs-csv') { exportBugsCsv(); return; }
    if (action === 'import-json' || action === 'clear-data' || action === 'reset-demo') {
      showToast('禅道数据由服务端同步，不再提供本地覆盖或清空。', 'warn');
      return;
    }
  }

  function handleChange(event) {
    const target = event.target;
    if (target.matches('[data-role="task-status"]')) {
      changeTaskStatus(target.dataset.id, target.value);
      return;
    }
    if (target.matches('[data-role="bug-status"]')) {
      changeBugStatus(target.dataset.id, target.value);
      return;
    }
    if (target.matches('[data-role="report-date"]')) {
      if (target.value) {
        ui.reportDate = target.value;
        renderView(false);
      }
      return;
    }
    if (target.matches('[data-filter="task-priority"]')) {
      ui.taskFilters.priority = target.value;
      renderTaskResults();
      return;
    }
    if (target.matches('[data-filter="task-project"]')) {
      ui.taskFilters.project = target.value;
      renderTaskResults();
      return;
    }
    if (target.matches('[data-filter="bug-severity"]')) {
      ui.bugFilters.severity = target.value;
      renderBugResults();
      return;
    }
    if (target.matches('[data-filter="bug-status"]')) {
      ui.bugFilters.status = target.value;
      renderBugResults();
      return;
    }
    if (target.matches('[data-filter="bug-type"]')) {
      ui.bugFilters.type = target.value;
      renderBugResults();
      return;
    }
    if (target.matches('[data-filter="bug-product"]')) {
      ui.bugFilters.product = target.value;
      renderBugResults();
      return;
    }
    if (target.matches('[data-filter="bug-project"]')) {
      ui.bugFilters.project = target.value;
      renderBugResults();
      return;
    }
  }

  function handleInput(event) {
    const target = event.target;
    if (target.id === 'task-search') {
      ui.taskFilters.q = target.value;
      renderTaskResults();
      return;
    }
    if (target.id === 'bug-search') {
      ui.bugFilters.q = target.value;
      renderBugResults();
      return;
    }
    if (target.matches('.report-section textarea')) {
      autoGrowTextarea(target);
    }
  }

  async function handleSubmit(event) {
    const form = event.target;
    if (form.matches('form[data-form="report"]')) {
      event.preventDefault();
      const saved = await saveReportForm(true);
      if (saved) renderView(false);
      return;
    }
    if (form.matches('form[data-form="profile"]')) {
      event.preventDefault();
      await saveProfile(form);
    }
    if (form.matches('form[data-form="bug-edit"]')) {
      event.preventDefault();
      await saveBugEdit(form);
      return;
    }
    if (form.matches('form[data-bug-form="action"]')) {
      event.preventDefault();
      await submitBugAction(form);
    }
  }

  function handleKeydown(event) {
    const commandOpen = Boolean($('#command-root').firstElementChild);
    if (commandOpen) {
      if (event.key === 'ArrowDown') { event.preventDefault(); moveCommand(1); return; }
      if (event.key === 'ArrowUp') { event.preventDefault(); moveCommand(-1); return; }
      if (event.key === 'Enter') { event.preventDefault(); runCommand(commandIndex); return; }
      if (event.key === 'Escape') { event.preventDefault(); closeCommand(); return; }
      if (event.key === 'Tab') { event.preventDefault(); return; }
    }
    const kpiCard = event.target.closest('.kpi-card[data-action]');
    if (kpiCard && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      kpiCard.click();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (commandOpen) closeCommand();
      else openCommand();
      return;
    }
    if (event.key === 'Escape') {
      if ($('#modal-root').firstElementChild) { closeModal(); return; }
      if ($('#drawer-root').firstElementChild) { closeDrawer(); return; }
      if (ui.bugEditing) { closeBugEdit(); return; }
      if (ui.bugDetailId) { closeBugPage(); return; }
      if ($('#quick-create-menu') && !$('#quick-create-menu').hidden) { closeQuickMenu(); return; }
      if ($('#notification-panel') && !$('#notification-panel').hidden) { closeNotifications(); return; }
      if ($('#sidebar').classList.contains('open')) { closeSidebar(); return; }
    }
    focusTrap(event);
  }

  function handleDragStart(event) {
    const card = event.target.closest('.kanban-card');
    if (!card) return;
    dragTaskId = card.dataset.taskId;
    card.classList.add('dragging');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', dragTaskId);
    }
  }

  function handleDragOver(event) {
    const column = event.target.closest('.kanban-col');
    if (!column) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    $$('.kanban-col.drag-over').forEach((col) => {
      if (col !== column) col.classList.remove('drag-over');
    });
    column.classList.add('drag-over');
  }

  function handleDrop(event) {
    const column = event.target.closest('.kanban-col');
    if (!column) return;
    event.preventDefault();
    column.classList.remove('drag-over');
    const id = dragTaskId || (event.dataTransfer ? event.dataTransfer.getData('text/plain') : '');
    const status = column.dataset.status;
    dragTaskId = null;
    if (id && status) changeTaskStatus(id, status);
  }

  function handleDragEnd() {
    dragTaskId = null;
    $$('.kanban-card.dragging').forEach((card) => card.classList.remove('dragging'));
    $$('.kanban-col.drag-over').forEach((col) => col.classList.remove('drag-over'));
  }

  function handleWindowHashChange() {
    if (!state) return;
    const parsed = parseHash();
    ui.view = parsed.view;
    ui.bugDetailId = parsed.bugId;
    ui.bugEditing = parsed.bugEditing;
    closeDrawer();
    closeCommand();
    closeSidebar();
    renderView(true);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function bindEvents() {
    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('change', handleChange);
    document.addEventListener('input', handleInput);
    document.addEventListener('submit', handleSubmit);
    document.addEventListener('keydown', handleKeydown);
    document.addEventListener('dragstart', handleDragStart);
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('drop', handleDrop);
    document.addEventListener('dragend', handleDragEnd);
    window.addEventListener('hashchange', handleWindowHashChange);
    document.addEventListener('click', (event) => {
      if (event.target.matches('[data-drawer-overlay]')) closeDrawer();
    });
  }

  async function init() {
    const prefs = loadUiPrefs();
    ui = {
      view: syncFromHash(),
      bugDetailId: parseHash().bugId,
      bugEditing: parseHash().bugEditing,
      taskView: prefs.taskView === 'list' ? 'list' : 'board',
      taskScope: prefs.taskScope === 'test' ? 'test' : 'mine',
      bugScope: ['opened', 'assigned', 'autojob', 'all'].includes(prefs.bugScope) ? prefs.bugScope : 'opened',
      taskFilters: { q: '', status: 'all', priority: 'all', project: 'all', due: 'all' },
      bugFilters: { q: '', status: 'all', severity: 'all', type: 'all', project: 'all' },
      reportDate: prefs.reportDate || Core.localDate(),
      drawer: null
    };
    bindEvents();
    renderBootScreen();
    setSyncChrome();
    await pullData({ initial: true });
    if (state) {
      renderNotificationPanel();
      updateNotificationBadge();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
