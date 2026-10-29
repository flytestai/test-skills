(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.QAWorkbenchCore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 1;

  const TASK_STATUS = {
    todo: { label: '待开始', order: 1 },
    doing: { label: '进行中', order: 2 },
    blocked: { label: '已阻塞', order: 3 },
    done: { label: '已完成', order: 4 }
  };

  const BUG_STATUS = {
    new: { label: '新建', order: 1 },
    confirmed: { label: '已确认', order: 2 },
    fixing: { label: '修复中', order: 3 },
    verifying: { label: '待验证', order: 4 },
    closed: { label: '已关闭', order: 5 },
    hold: { label: '已挂起', order: 6 }
  };

  const SEVERITY = {
    P0: { label: 'P0 致命', short: 'P0', order: 1 },
    P1: { label: 'P1 严重', short: 'P1', order: 2 },
    P2: { label: 'P2 一般', short: 'P2', order: 3 },
    P3: { label: 'P3 轻微', short: 'P3', order: 4 }
  };

  const RELEASE_PRIORITIES = ['P1', 'P2', 'P3'];
  const RELEASE_PRIORITY_ORDER = { P1: 0, P2: 1, P3: 2 };
  const TASK_TYPES = ['功能测试', '回归测试', '接口测试', '自动化测试', '性能测试', '需求评审', '环境维护', '其他'];
  const REPRO = ['必现', '偶现', '无法复现', '未确认'];

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function localDate(value) {
    const d = value instanceof Date ? value : value ? new Date(value) : new Date();
    if (Number.isNaN(d.getTime())) return localDate(new Date());
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function dateAt(dateStr, hour, minute) {
    const parts = String(dateStr).split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2], hour || 0, minute || 0, 0, 0).toISOString();
  }

  function addDays(dateStr, amount) {
    const parts = String(dateStr).split('-').map(Number);
    const d = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
    d.setDate(d.getDate() + Number(amount || 0));
    return localDate(d);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function formatDateCN(dateStr, withWeekday) {
    const parts = String(dateStr).split('-').map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return dateStr;
    const d = new Date(parts[0], parts[1] - 1, parts[2], 12);
    const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
    return withWeekday ? `${parts[0]} 年 ${parts[1]} 月 ${parts[2]} 日 · ${week}` : `${parts[0]}年${parts[1]}月${parts[2]}日`;
  }

  function relativeDay(dateStr, baseDate) {
    const base = baseDate || localDate();
    if (!dateStr) return '';
    if (dateStr === base) return '今天';
    if (dateStr === addDays(base, 1)) return '明天';
    if (dateStr === addDays(base, -1)) return '昨天';
    const diff = Math.round((new Date(dateStr + 'T12:00:00') - new Date(base + 'T12:00:00')) / 86400000);
    if (diff > 1 && diff <= 7) return `${diff} 天后`;
    if (diff < -1 && diff >= -7) return `${Math.abs(diff)} 天前`;
    return dateStr.slice(5).replace('-', '/');
  }

  function uid(prefix) {
    const rand = Math.random().toString(36).slice(2, 8);
    return `${prefix || 'id'}-${Date.now().toString(36)}-${rand}`;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function text(value, fallback, maxLength) {
    if (typeof value !== 'string' && typeof value !== 'number') return fallback || '';
    return String(value).slice(0, maxLength || 5000);
  }

  function isDateString(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value + 'T12:00:00').getTime());
  }

  function safeIso(value, fallback) {
    if (!value) return fallback;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
  }

  function normalizeTags(tags) {
    if (!Array.isArray(tags)) return [];
    return Array.from(new Set(tags.map((tag) => text(tag, '', 24).trim()).filter(Boolean))).slice(0, 10);
  }

  function normalizeHistory(history) {
    if (!Array.isArray(history)) return [];
    return history
      .filter((item) => item && item.at)
      .map((item) => ({
        at: safeIso(item.at, nowIso()),
        text: text(item.text, '更新了记录', 200)
      }))
      .slice(0, 50);
  }

  function normalizeTask(raw, index) {
    const created = safeIso(raw && raw.createdAt, nowIso());
    return {
      id: text(raw && raw.id, `T-${1001 + index}`, 40),
      title: text(raw && raw.title, '未命名任务', 160),
      description: text(raw && raw.description, '', 4000),
      type: TASK_TYPES.includes(raw && raw.type) ? raw.type : '其他',
      priority: SEVERITY[raw && raw.priority] ? raw.priority : 'P2',
      status: TASK_STATUS[raw && raw.status] ? raw.status : 'todo',
      project: text(raw && raw.project, '未分类', 60),
      module: text(raw && raw.module, '', 60),
      dueDate: isDateString(raw && raw.dueDate) ? raw.dueDate : '',
      estimate: Math.max(0, Math.min(999, Number(raw && raw.estimate) || 0)),
      tags: normalizeTags(raw && raw.tags),
      bugIds: Array.isArray(raw && raw.bugIds) ? raw.bugIds.map((id) => text(id, '', 40)).filter(Boolean) : [],
      createdAt: created,
      updatedAt: safeIso(raw && raw.updatedAt, created),
      completedAt: raw && raw.completedAt ? safeIso(raw.completedAt, null) : null,
      history: normalizeHistory(raw && raw.history)
    };
  }

  function normalizeBug(raw, index) {
    const created = safeIso(raw && raw.createdAt, nowIso());
    return {
      id: text(raw && raw.id, `BUG-${1181 + index}`, 40),
      title: text(raw && raw.title, '未命名 Bug', 180),
      severity: SEVERITY[raw && raw.severity] ? raw.severity : 'P2',
      status: BUG_STATUS[raw && raw.status] ? raw.status : 'new',
      project: text(raw && raw.project, '未分类', 60),
      module: text(raw && raw.module, '', 60),
      version: text(raw && raw.version, '', 40),
      environment: text(raw && raw.environment, '', 120),
      assignee: text(raw && raw.assignee, '未指派', 40),
      reporter: text(raw && raw.reporter, '我', 40),
      reproducibility: REPRO.includes(raw && raw.reproducibility) ? raw.reproducibility : '未确认',
      steps: text(raw && raw.steps, '', 5000),
      expected: text(raw && raw.expected, '', 3000),
      actual: text(raw && raw.actual, '', 3000),
      taskId: text(raw && raw.taskId, '', 40),
      createdAt: created,
      updatedAt: safeIso(raw && raw.updatedAt, created),
      verifiedAt: raw && raw.verifiedAt ? safeIso(raw.verifiedAt, null) : null,
      closedAt: raw && raw.closedAt ? safeIso(raw && raw.closedAt, null) : null,
      history: normalizeHistory(raw && raw.history)
    };
  }

  function normalizeReport(raw, index) {
    const date = isDateString(raw && raw.date) ? raw.date : localDate();
    const content = raw && raw.content && typeof raw.content === 'object' ? raw.content : {};
    return {
      id: text(raw && raw.id, `R-${date}-${index}`, 60),
      date,
      status: raw && raw.status === 'submitted' ? 'submitted' : 'draft',
      content: {
        summary: text(content.summary, '', 3000),
        done: text(content.done, '', 6000),
        bugs: text(content.bugs, '', 6000),
        ongoing: text(content.ongoing, '', 6000),
        next: text(content.next, '', 4000),
        risks: text(content.risks, '', 4000)
      },
      createdAt: safeIso(raw && raw.createdAt, nowIso()),
      updatedAt: safeIso(raw && raw.updatedAt, nowIso()),
      submittedAt: raw && raw.submittedAt ? safeIso(raw.submittedAt, null) : null
    };
  }

  function defaultState(baseDate) {
    const today = localDate(baseDate || new Date());
    const yesterday = addDays(today, -1);
    const tomorrow = addDays(today, 1);
    const in2 = addDays(today, 2);
    const in3 = addDays(today, 3);
    const in4 = addDays(today, 4);

    const tasks = [
      {
        id: 'T-1001',
        title: '港股 K 线复权切换回归验证',
        description: '覆盖前复权、后复权、不复权三种模式，重点检查成交量柱、均线与右侧盘口数据联动。',
        type: '回归测试',
        priority: 'P0',
        status: 'doing',
        project: '行情终端',
        module: 'K 线',
        dueDate: today,
        estimate: 3,
        tags: ['回归', '港股'],
        bugIds: ['BUG-1182'],
        createdAt: dateAt(addDays(today, -3), 10, 20),
        updatedAt: dateAt(today, 9, 40),
        completedAt: null,
        history: [
          { at: dateAt(today, 9, 40), text: '开始执行回归，已完成不复权与后复权场景' },
          { at: dateAt(addDays(today, -3), 10, 20), text: '创建了任务' }
        ]
      },
      {
        id: 'T-1002',
        title: '补充自选股批量导入自动化用例',
        description: '覆盖 TXT / CSV 两种格式、重复代码、非法代码与超量导入场景，并接入 CI 冒烟集。',
        type: '自动化测试',
        priority: 'P1',
        status: 'todo',
        project: '自动化平台',
        module: '自选股',
        dueDate: tomorrow,
        estimate: 4,
        tags: ['自动化', 'Pytest'],
        bugIds: [],
        createdAt: dateAt(yesterday, 15, 10),
        updatedAt: dateAt(yesterday, 15, 10),
        completedAt: null,
        history: [{ at: dateAt(yesterday, 15, 10), text: '创建了任务' }]
      },
      {
        id: 'T-1003',
        title: '盘口千档行情压测与性能基线复核',
        description: '在模拟高并发行情下采集首屏耗时、内存增量与消息积压情况，输出性能基线偏差。',
        type: '性能测试',
        priority: 'P1',
        status: 'todo',
        project: '行情终端',
        module: '盘口',
        dueDate: in2,
        estimate: 6,
        tags: ['性能', '压测'],
        bugIds: [],
        createdAt: dateAt(yesterday, 14, 0),
        updatedAt: dateAt(yesterday, 14, 0),
        completedAt: null,
        history: [{ at: dateAt(yesterday, 14, 0), text: '创建了任务' }]
      },
      {
        id: 'T-1004',
        title: '条件单触发规则评审与用例设计',
        description: '等待产品补充极端行情下的触发优先级说明，评审后同步更新用例库。',
        type: '需求评审',
        priority: 'P1',
        status: 'blocked',
        project: '交易系统',
        module: '条件单',
        dueDate: today,
        estimate: 2,
        tags: ['评审', '阻塞'],
        bugIds: ['BUG-1183'],
        createdAt: dateAt(addDays(today, -2), 11, 0),
        updatedAt: dateAt(today, 8, 55),
        completedAt: null,
        history: [
          { at: dateAt(today, 8, 55), text: '阻塞原因：产品侧尚未确认触发优先级' },
          { at: dateAt(addDays(today, -2), 11, 0), text: '创建了任务' }
        ]
      },
      {
        id: 'T-1005',
        title: '完成测试环境升级与冒烟验证',
        description: '环境升级到 V3.8.2，核心登录、行情、自选、下单链路冒烟通过。',
        type: '环境维护',
        priority: 'P2',
        status: 'done',
        project: '测试基建',
        module: '测试环境',
        dueDate: today,
        estimate: 2,
        tags: ['环境', '冒烟'],
        bugIds: [],
        createdAt: dateAt(yesterday, 17, 0),
        updatedAt: dateAt(today, 10, 5),
        completedAt: dateAt(today, 10, 5),
        history: [
          { at: dateAt(today, 10, 5), text: '完成了任务' },
          { at: dateAt(yesterday, 17, 0), text: '创建了任务' }
        ]
      },
      {
        id: 'T-1006',
        title: '模拟交易下单主链路回归',
        description: '覆盖市价、限价、撤单、废单与盘后交易场景，核对委托回报和持仓变化。',
        type: '回归测试',
        priority: 'P2',
        status: 'doing',
        project: '交易系统',
        module: '模拟交易',
        dueDate: in3,
        estimate: 5,
        tags: ['交易', '回归'],
        bugIds: ['BUG-1184'],
        createdAt: dateAt(addDays(today, -2), 9, 20),
        updatedAt: dateAt(today, 9, 10),
        completedAt: null,
        history: [
          { at: dateAt(today, 9, 10), text: '完成市价与限价单验证，盘后场景待执行' },
          { at: dateAt(addDays(today, -2), 9, 20), text: '创建了任务' }
        ]
      },
      {
        id: 'T-1007',
        title: '修复分时图区间统计误差回归验证',
        description: '验证区间统计在停牌、集合竞价和跨日场景下的数值准确性。',
        type: '回归测试',
        priority: 'P1',
        status: 'done',
        project: '行情终端',
        module: '分时图',
        dueDate: yesterday,
        estimate: 3,
        tags: ['回归', '分时'],
        bugIds: ['BUG-1186'],
        createdAt: dateAt(addDays(today, -5), 13, 30),
        updatedAt: dateAt(yesterday, 16, 10),
        completedAt: dateAt(yesterday, 16, 10),
        history: [
          { at: dateAt(yesterday, 16, 10), text: '完成了任务，覆盖场景全部通过' },
          { at: dateAt(addDays(today, -5), 13, 30), text: '创建了任务' }
        ]
      },
      {
        id: 'T-1008',
        title: '整理 9 月质量数据与复盘材料',
        description: '汇总 Bug 收敛趋势、逃逸率与自动化覆盖率，补充月度质量复盘。',
        type: '其他',
        priority: 'P3',
        status: 'todo',
        project: '测试基建',
        module: '质量运营',
        dueDate: in4,
        estimate: 2,
        tags: ['复盘', '数据'],
        bugIds: [],
        createdAt: dateAt(addDays(today, -1), 16, 40),
        updatedAt: dateAt(addDays(today, -1), 16, 40),
        completedAt: null,
        history: [{ at: dateAt(addDays(today, -1), 16, 40), text: '创建了任务' }]
      },
      {
        id: 'T-1009',
        title: '输出本周质量风险清单',
        description: '汇总阻塞项、P0/P1 未关闭 Bug 与版本准入风险，周五前同步项目组。',
        type: '其他',
        priority: 'P2',
        status: 'todo',
        project: '测试基建',
        module: '质量运营',
        dueDate: today,
        estimate: 1,
        tags: ['风险', '周报'],
        bugIds: [],
        createdAt: dateAt(today, 8, 30),
        updatedAt: dateAt(today, 8, 30),
        completedAt: null,
        history: [{ at: dateAt(today, 8, 30), text: '创建了任务' }]
      }
    ];

    const bugs = [
      {
        id: 'BUG-1182',
        title: '港股 K 线切换复权后成交量柱未刷新',
        severity: 'P1',
        status: 'fixing',
        project: '行情终端',
        module: 'K 线',
        version: 'V3.8.2',
        environment: 'Windows 11 · 模拟行情',
        assignee: '陈默',
        reporter: '我',
        reproducibility: '必现',
        steps: '1. 打开 00700 港股 K 线\n2. 在前复权与不复权之间切换\n3. 观察成交量副图',
        expected: '成交量柱随复权方式同步刷新',
        actual: '成交量柱保持切换前的数据，切换两次后恢复',
        taskId: 'T-1001',
        createdAt: dateAt(addDays(today, -2), 15, 35),
        updatedAt: dateAt(today, 9, 20),
        verifiedAt: null,
        closedAt: null,
        history: [
          { at: dateAt(today, 9, 20), text: '陈默开始修复，已定位到缓存刷新时序' },
          { at: dateAt(addDays(today, -1), 11, 0), text: '状态变更为「修复中」' },
          { at: dateAt(addDays(today, -2), 15, 35), text: '提交了 Bug' }
        ]
      },
      {
        id: 'BUG-1183',
        title: '极端行情下条件单出现重复触发',
        severity: 'P0',
        status: 'confirmed',
        project: '交易系统',
        module: '条件单',
        version: 'V3.8.2',
        environment: 'Windows 11 · 行情回放',
        assignee: '周文',
        reporter: '我',
        reproducibility: '偶现',
        steps: '1. 使用 2 倍速行情回放\n2. 设置价格上穿触发条件单\n3. 在价格快速穿越时观察委托列表',
        expected: '同一条件单仅生成一笔委托',
        actual: '偶发连续生成两笔相同委托，第二笔未去重',
        taskId: 'T-1004',
        createdAt: dateAt(today, 9, 15),
        updatedAt: dateAt(today, 9, 45),
        verifiedAt: null,
        closedAt: null,
        history: [
          { at: dateAt(today, 9, 45), text: '开发确认可复现，状态变更为「已确认」' },
          { at: dateAt(today, 9, 15), text: '提交了 Bug' }
        ]
      },
      {
        id: 'BUG-1184',
        title: '模拟交易登录窗口偶发白屏',
        severity: 'P1',
        status: 'verifying',
        project: '行情终端',
        module: '模拟交易',
        version: 'V3.8.1',
        environment: 'Windows 11 · 正式行情',
        assignee: '陈默',
        reporter: '我',
        reproducibility: '偶现',
        steps: '1. 冷启动客户端\n2. 连续打开模拟交易登录窗口 5 次\n3. 观察窗口内容',
        expected: '登录窗口正常展示账号与密码输入框',
        actual: '约 1/10 概率出现纯白窗口，关闭重开可恢复',
        taskId: 'T-1006',
        createdAt: dateAt(addDays(today, -1), 10, 20),
        updatedAt: dateAt(today, 8, 50),
        verifiedAt: null,
        closedAt: null,
        history: [
          { at: dateAt(today, 8, 50), text: '开发修复完成，等待回归验证' },
          { at: dateAt(addDays(today, -1), 10, 20), text: '提交了 Bug' }
        ]
      },
      {
        id: 'BUG-1185',
        title: '自选股拖拽排序重启后丢失',
        severity: 'P2',
        status: 'new',
        project: '交易系统',
        module: '自选股',
        version: 'V3.8.2',
        environment: 'Windows 11 · 正式行情',
        assignee: '未指派',
        reporter: '我',
        reproducibility: '必现',
        steps: '1. 打开自选股\n2. 拖动调整任意两只股票顺序\n3. 退出并重新启动客户端',
        expected: '重启后保留调整后的顺序',
        actual: '重启后恢复默认排序',
        taskId: 'T-1002',
        createdAt: dateAt(today, 10, 28),
        updatedAt: dateAt(today, 10, 28),
        verifiedAt: null,
        closedAt: null,
        history: [{ at: dateAt(today, 10, 28), text: '提交了 Bug' }]
      },
      {
        id: 'BUG-1186',
        title: '分时图十字光标时间提示偶发错位',
        severity: 'P3',
        status: 'closed',
        project: '行情终端',
        module: '分时图',
        version: 'V3.8.1',
        environment: 'Windows 11 · 正式行情',
        assignee: '陈默',
        reporter: '我',
        reproducibility: '偶现',
        steps: '1. 打开任意股票分时图\n2. 在 14:57 附近快速移动十字光标\n3. 观察顶部时间提示',
        expected: '时间提示与光标位置一致',
        actual: '提示框偏移约 1 个数据点',
        taskId: 'T-1007',
        createdAt: dateAt(addDays(today, -5), 14, 15),
        updatedAt: dateAt(yesterday, 16, 10),
        verifiedAt: dateAt(yesterday, 16, 10),
        closedAt: dateAt(yesterday, 16, 10),
        history: [
          { at: dateAt(yesterday, 16, 10), text: '回归通过，关闭 Bug' },
          { at: dateAt(addDays(today, -4), 10, 0), text: '状态变更为「待验证」' },
          { at: dateAt(addDays(today, -5), 14, 15), text: '提交了 Bug' }
        ]
      },
      {
        id: 'BUG-1187',
        title: '自动化用例报告附件下载失败',
        severity: 'P2',
        status: 'verifying',
        project: '测试基建',
        module: '自动化平台',
        version: 'CI-2026.10',
        environment: 'Chrome 130 · 内网 CI',
        assignee: '李可',
        reporter: '我',
        reproducibility: '必现',
        steps: '1. 打开任意一次流水线执行报告\n2. 点击「下载附件」\n3. 查看下载结果',
        expected: '下载包含日志与截图的压缩包',
        actual: '提示 404，附件链接指向已过期构建',
        taskId: 'T-1002',
        createdAt: dateAt(addDays(today, -2), 11, 45),
        updatedAt: dateAt(today, 8, 40),
        verifiedAt: null,
        closedAt: null,
        history: [
          { at: dateAt(today, 8, 40), text: '附件存储路径已调整，等待验证' },
          { at: dateAt(addDays(today, -2), 11, 45), text: '提交了 Bug' }
        ]
      }
    ];

    const state = {
      version: VERSION,
      profile: {
        name: '测试工程师',
        role: '测试开发工程师',
        team: '质量保障组',
        sprint: '2026 Q4 · Sprint 1',
        avatar: 'QA'
      },
      projects: ['行情终端', '交易系统', '自动化平台', '测试基建'],
      preferences: {
        taskView: 'board',
        compactSidebar: false
      },
      tasks,
      bugs,
      reports: [],
      createdAt: dateAt(addDays(today, -12), 9, 0),
      updatedAt: nowIso()
    };

    const yesterdayReport = buildReport(state, yesterday);
    yesterdayReport.status = 'submitted';
    yesterdayReport.submittedAt = dateAt(yesterday, 18, 20);
    yesterdayReport.createdAt = dateAt(yesterday, 17, 50);
    yesterdayReport.updatedAt = dateAt(yesterday, 18, 20);
    yesterdayReport.content.summary =
      '完成分时图区间统计误差的回归验证并关闭对应 Bug，测试环境升级准备就绪；整体无新增阻塞项。';
    yesterdayReport.content.next = '- 推进港股 K 线复权切换回归\n- 输出本周质量风险清单';
    state.reports.push(yesterdayReport);

    return state;
  }

  function normalizeState(raw) {
    let input = raw;
    if (typeof input === 'string') {
      try {
        input = JSON.parse(input);
      } catch (error) {
        return defaultState();
      }
    }
    if (!input || typeof input !== 'object') return defaultState();

    const base = defaultState();
    const profile = input.profile && typeof input.profile === 'object' ? input.profile : {};
    const preferences = input.preferences && typeof input.preferences === 'object' ? input.preferences : {};
    const projects = Array.isArray(input.projects)
      ? Array.from(new Set(input.projects.map((p) => text(p, '', 50).trim()).filter(Boolean))).slice(0, 30)
      : base.projects;

    return {
      version: VERSION,
      profile: {
        name: text(profile.name, base.profile.name, 40),
        role: text(profile.role, base.profile.role, 50),
        team: text(profile.team, base.profile.team, 50),
        sprint: text(profile.sprint, base.profile.sprint, 60),
        avatar: text(profile.avatar, base.profile.avatar, 4)
      },
      projects: projects.length ? projects : ['未分类'],
      preferences: {
        taskView: preferences.taskView === 'list' ? 'list' : 'board',
        compactSidebar: Boolean(preferences.compactSidebar)
      },
      tasks: Array.isArray(input.tasks) ? input.tasks.map(normalizeTask).filter(Boolean) : base.tasks,
      bugs: Array.isArray(input.bugs) ? input.bugs.map(normalizeBug).filter(Boolean) : base.bugs,
      reports: Array.isArray(input.reports) ? input.reports.map(normalizeReport).filter(Boolean) : [],
      createdAt: safeIso(input.createdAt, base.createdAt),
      updatedAt: safeIso(input.updatedAt, nowIso())
    };
  }

  function nextId(prefix, items) {
    let max = 1000;
    (items || []).forEach((item) => {
      const number = parseInt(String(item.id || '').replace(/\D/g, ''), 10);
      if (!Number.isNaN(number) && number > max) max = number;
    });
    return `${prefix}-${max + 1}`;
  }

  function compareTasks(a, b) {
    if (Boolean(b.pinned) !== Boolean(a.pinned)) return b.pinned ? 1 : -1;
    const statusA = TASK_STATUS[a.status] ? TASK_STATUS[a.status].order : 9;
    const statusB = TASK_STATUS[b.status] ? TASK_STATUS[b.status].order : 9;
    if (statusA !== statusB) return statusA - statusB;
    const priorityA = SEVERITY[a.priority] ? SEVERITY[a.priority].order : 9;
    const priorityB = SEVERITY[b.priority] ? SEVERITY[b.priority].order : 9;
    if (priorityA !== priorityB) return priorityA - priorityB;
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return String(b.updatedAt).localeCompare(String(a.updatedAt));
  }

  function compareBugs(a, b) {
    const timeDiff = String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    if (timeDiff) return timeDiff;
    return String(b.id || '').localeCompare(String(a.id || ''), 'zh-CN', { numeric: true });
  }

  function isTaskOverdue(task, date) {
    return Boolean(task.dueDate && task.status !== 'done' && task.dueDate < (date || localDate()));
  }

  function isBugOpen(bug) {
    return bug.status !== 'closed';
  }

  function needsMyVerification(bug) {
    if (!bug) return false;
    if (bug.needsMyVerification === true) return true;
    if (bug.isAutojob && bug.rawStatus === 'active' && bug.autojobRelation === 'assigned') return true;
    // Demo/local records do not carry the ZenTao ownership flags yet.
    if (bug.needsMyVerification === undefined && bug.status === 'verifying') return true;
    return false;
  }

  function versionKey(value) {
    const name = String(value == null ? '' : value).trim();
    if (!name || /主干|trunk/i.test(name)) return '';
    const match = name.match(/(\d+(?:\.\d+){1,3})/);
    return match ? match[1] : '';
  }

  function versionProgress(done, total) {
    return total ? Math.round((done / total) * 100) : 0;
  }

  // 发版管理：从禅道执行与 Bug 版本字段汇总版本，并合并本地测试时间。
  function releaseCatalog(state, plans) {
    const tasks = (state && state.tasks) || [];
    const bugs = (state && state.bugs) || [];
    const planMap = plans && typeof plans === 'object' ? plans : {};
    const versions = new Map();
    const ensure = (key, project) => {
      const normalized = String(key || '').trim();
      if (!normalized) return null;
      let item = versions.get(normalized);
      if (!item) {
        item = {
          key: normalized,
          name: normalized,
          projects: new Set(),
          executions: new Set(),
          tasks: new Map(),
          pendingBugs: 0,
          openBugs: 0,
          latestEnd: ''
        };
        versions.set(normalized, item);
      }
      if (project) item.projects.add(String(project));
      return item;
    };

    tasks.forEach((task) => {
      const item = ensure(versionKey(task.execution), task.project);
      if (!item) return;
      item.tasks.set(String(task.id), task);
      if (task.execution) item.executions.add(String(task.execution));
      if (task.executionEnd && task.executionEnd > item.latestEnd) item.latestEnd = task.executionEnd;
    });

    bugs.forEach((bug) => {
      const item = ensure(versionKey(bug.version), bug.project);
      if (!item) return;
      if (needsMyVerification(bug)) item.pendingBugs += 1;
      else if (bug.isMine && bug.status !== 'closed') item.openBugs += 1;
    });

    Object.keys(planMap).forEach((key) => ensure(key));

    const now = Date.now();
    const items = [];
    versions.forEach((item) => {
      const allTasks = Array.from(item.tasks.values());
      const doneTasks = allTasks.filter((task) => task.status === 'done').length;
      const myOpenTasks = allTasks.filter((task) => task.status !== 'done' && (
        typeof task.isMine === 'boolean' ? task.isMine : true
      )).length;
      const plan = planMap[item.key] || {};
      const testStart = typeof plan.testStart === 'string' ? plan.testStart : '';
      const testEnd = typeof plan.testEnd === 'string' ? plan.testEnd : '';
      const closed = plan.closed === true;
      const pinned = plan.pinned === true;
      const priority = RELEASE_PRIORITIES.includes(plan.priority) ? plan.priority : '';
      const startMs = testStart ? new Date(testStart).getTime() : 0;
      const endMs = testEnd ? new Date(testEnd).getTime() : 0;
      let status = 'unplanned';
      if (closed) {
        status = 'closed';
      } else if (testStart || testEnd) {
        if (endMs && endMs < now) status = 'ended';
        else if (startMs && startMs > now) status = 'upcoming';
        else status = 'testing';
      }
      items.push({
        key: item.key,
        name: item.name,
        projects: Array.from(item.projects),
        executions: Array.from(item.executions),
        taskTotal: allTasks.length,
        taskDone: doneTasks,
        taskOpen: allTasks.length - doneTasks,
        myTaskOpen: myOpenTasks,
        taskProgress: versionProgress(doneTasks, allTasks.length),
        pendingBugs: item.pendingBugs,
        openBugs: item.openBugs,
        pending: myOpenTasks + item.pendingBugs + item.openBugs,
        latestEnd: item.latestEnd,
        testStart,
        testEnd,
        closed,
        pinned,
        priority,
        status,
        planUpdatedAt: plan.updatedAt || ''
      });
    });

    const cutoff = addDays(localDate(), -120);
    const visible = items.filter((item) => (
      item.closed
      || item.testStart
      || item.testEnd
      || item.pendingBugs
      || item.openBugs
      || item.myTaskOpen
      || item.pinned
      || item.priority
      || (item.latestEnd && item.latestEnd >= cutoff)
    ));
    const rank = { testing: 0, upcoming: 1, unplanned: 2, ended: 3, closed: 4 };
    visible.sort((a, b) => (
      Number(b.pinned) - Number(a.pinned)
      || (RELEASE_PRIORITY_ORDER[a.priority] ?? 9) - (RELEASE_PRIORITY_ORDER[b.priority] ?? 9)
      || (rank[a.status] || 0) - (rank[b.status] || 0)
      || String(a.testStart || '9999').localeCompare(String(b.testStart || '9999'))
      || String(b.latestEnd || '').localeCompare(String(a.latestEnd || ''))
      || a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
    ));
    return visible;
  }

  // 当日进度 = 待我验证的 Bug + 待发版版本 + 我今天要完成的任务。
  function dailyFocus(state, date) {
    const day = date || localDate();
    const tasks = (state && state.tasks) || [];
    const bugs = (state && state.bugs) || [];
    const account = String((state && state.tester && state.tester.account) || '');
    const scopedTasks = tasks.some((task) => typeof task.isMine === 'boolean')
      ? tasks.filter((task) => task.isMine)
      : tasks;

    const taskQueue = scopedTasks.filter((task) => task.status !== 'done' && (
      task.status === 'doing'
      || task.status === 'blocked'
      || task.dueDate === day
      || (task.dueDate && task.dueDate < day)
    ));
    const taskDoneToday = scopedTasks.filter((task) => task.completedAt && localDate(task.completedAt) === day);
    const taskMap = new Map();
    taskQueue.forEach((task) => taskMap.set(task.id, task));
    taskDoneToday.forEach((task) => taskMap.set(task.id, task));
    const taskItems = Array.from(taskMap.values());
    const taskTotal = taskItems.length;
    const taskDone = taskDoneToday.length;

    const releaseMap = new Map();
    ((state && state.releases) || []).forEach((release) => {
      if (release && release.key) releaseMap.set(String(release.key), release);
    });
    const pendingBugs = bugs.filter(needsMyVerification);
    const bugDoneToday = bugs.filter((bug) => bug.verifiedAt && localDate(bug.verifiedAt) === day && (
      bug.isAssignedToMe
      || bug.isMine
      || bug.autojobRelation === 'closed'
      || (account && bug.closedByAccount === account)
    ));
    const bugTotal = pendingBugs.length + bugDoneToday.length;
    const bugDone = bugDoneToday.length;

    const versions = new Map();
    const ensureVersion = (key, project) => {
      if (!key) return null;
      let item = versions.get(key);
      if (!item) {
        item = { key, name: key, projects: new Set(), tasks: new Map(), pendingBugs: [], openBugs: [], doneBugs: [] };
        versions.set(key, item);
      }
      if (project) item.projects.add(project);
      return item;
    };
    tasks.forEach((task) => {
      const item = ensureVersion(versionKey(task.execution), task.project);
      if (item) item.tasks.set(task.id, task);
    });
    pendingBugs.forEach((bug) => {
      const item = ensureVersion(versionKey(bug.version), bug.project);
      if (item) item.pendingBugs.push(bug);
    });
    bugs.filter((bug) => bug.isMine && bug.status !== 'closed' && !needsMyVerification(bug)).forEach((bug) => {
      const item = ensureVersion(versionKey(bug.version), bug.project);
      if (item) item.openBugs.push(bug);
    });
    bugDoneToday.forEach((bug) => {
      const item = ensureVersion(versionKey(bug.version), bug.project);
      if (item) item.doneBugs.push(bug);
    });
    releaseMap.forEach((release) => {
      if (release.status === 'closed') return;
      if (!release.testStart && !release.testEnd) return;
      if (release.status === 'ended') return;
      ensureVersion(release.key, release.projects && release.projects[0]);
    });

    const releaseCutoff = addDays(day, -45);
    const versionItems = [];
    versions.forEach((item) => {
      const release = releaseMap.get(item.key) || null;
      if (release && release.status === 'closed') return;
      const allTasks = Array.from(item.tasks.values());
      const doneTasks = allTasks.filter((task) => task.status === 'done').length;
      const myOpenTasks = allTasks.filter((task) => task.status !== 'done' && (typeof task.isMine === 'boolean' ? task.isMine : true)).length;
      const pendingCount = item.pendingBugs.length;
      const openCount = item.openBugs.length;
      const hasActiveWindow = Boolean(release && (release.testStart || release.testEnd) && release.status !== 'ended');
      if (!myOpenTasks && !pendingCount && !openCount && !hasActiveWindow) return;
      // 仍有我提交的未关闭 Bug 或待我验证 Bug 的版本，按待发版处理；
      // 只有历史遗留任务时，结束日期超过 45 天的旧版本不再计入。
      const ends = allTasks.map((task) => task.executionEnd).filter(Boolean).sort();
      const latestEnd = ends.length ? ends[ends.length - 1] : '';
      if (!pendingCount && !openCount && latestEnd && latestEnd < releaseCutoff) return;
      const totalUnits = allTasks.length + pendingCount + openCount + item.doneBugs.length;
      const doneUnits = doneTasks + item.doneBugs.length;
      versionItems.push({
        key: item.key,
        name: release && release.name ? release.name : item.name,
        projects: Array.from(item.projects),
        taskTotal: allTasks.length,
        taskDone: doneTasks,
        myTaskOpen: myOpenTasks,
        pendingBugs: pendingCount,
        openBugs: openCount,
        pending: myOpenTasks + pendingCount + openCount,
        progress: versionProgress(doneUnits, totalUnits),
        testStart: release ? release.testStart : '',
        testEnd: release ? release.testEnd : '',
        releaseStatus: release ? release.status : 'unplanned',
        pinned: release ? release.pinned === true : false,
        priority: release && RELEASE_PRIORITIES.includes(release.priority) ? release.priority : ''
      });
    });
    versionItems.sort((a, b) => (
      Number(b.pinned) - Number(a.pinned)
      || (RELEASE_PRIORITY_ORDER[a.priority] ?? 9) - (RELEASE_PRIORITY_ORDER[b.priority] ?? 9)
      || b.pendingBugs - a.pendingBugs
      || b.pending - a.pending
      || a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
    ));

    const versionTotal = versionItems.length;
    const scheduledVersionTotal = versionItems.filter((item) => item.testStart || item.testEnd).length;
    const versionReadiness = versionItems.reduce((sum, item) => sum + item.progress, 0) / 100;
    // 综合进度只统计待验证 Bug 和待完成任务；版本就绪度单独展示，不计入百分比。
    const plannedCount = bugTotal + taskTotal;
    const completedCount = bugDone + taskDone;
    const progress = plannedCount ? Math.min(100, Math.round((completedCount / plannedCount) * 100)) : 0;

    return {
      date: day,
      tasks: {
        total: taskTotal,
        pending: taskQueue.length,
        doneToday: taskDone,
        progress: versionProgress(taskDone, taskTotal),
        items: taskQueue
      },
      bugs: {
        total: bugTotal,
        pending: pendingBugs.length,
        doneToday: bugDone,
        progress: versionProgress(bugDone, bugTotal),
        items: pendingBugs
      },
      versions: {
        total: versionTotal,
        pending: scheduledVersionTotal,
        scheduled: scheduledVersionTotal,
        doneToday: 0,
        progress: versionTotal ? Math.round(versionReadiness * 100 / versionTotal) : 0,
        items: versionItems
      },
      plannedCount,
      completedCount,
      pendingTotal: pendingBugs.length + taskQueue.length,
      progress
    };
  }

  function metrics(state, date) {
    const day = date || localDate();
    const tasks = state.tasks || [];
    const bugs = state.bugs || [];
    const openTasks = tasks.filter((task) => task.status !== 'done');
    const doing = tasks.filter((task) => task.status === 'doing');
    const dueToday = openTasks.filter((task) => task.dueDate === day);
    const overdue = openTasks.filter((task) => isTaskOverdue(task, day));
    const doneToday = tasks.filter((task) => task.completedAt && localDate(task.completedAt) === day);
    const openBugs = bugs.filter(isBugOpen);
    const severeBugs = openBugs.filter((bug) => bug.severity === 'P0' || bug.severity === 'P1');
    const foundToday = bugs.filter((bug) => localDate(bug.createdAt) === day);
    const verifiedToday = bugs.filter((bug) => bug.verifiedAt && localDate(bug.verifiedAt) === day);
    const report = (state.reports || []).find((item) => item.date === day);
    const focus = dailyFocus(state, day);

    return {
      date: day,
      taskOpen: openTasks.length,
      taskDoing: doing.length,
      taskBlocked: openTasks.filter((task) => task.status === 'blocked').length,
      taskDueToday: dueToday.length,
      taskOverdue: overdue.length,
      taskDoneToday: doneToday.length,
      bugOpen: openBugs.length,
      bugSevere: severeBugs.length,
      bugFoundToday: foundToday.length,
      bugVerifiedToday: verifiedToday.length,
      bugBlocked: openBugs.filter((bug) => bug.status === 'hold').length,
      reportStatus: report ? report.status : 'none',
      reportId: report ? report.id : '',
      progress: focus.progress,
      plannedCount: focus.plannedCount,
      completedCount: focus.completedCount,
      focus
    };
  }

  function statusCounts(items, key, allowed) {
    return Object.keys(allowed).reduce((acc, value) => {
      acc[value] = items.filter((item) => item[key] === value).length;
      return acc;
    }, {});
  }

  function severityCounts(bugs) {
    return Object.keys(SEVERITY).reduce((acc, key) => {
      acc[key] = (bugs || []).filter((bug) => bug.severity === key && bug.status !== 'closed').length;
      return acc;
    }, {});
  }

  function collectDailyData(state, date) {
    const day = isDateString(date) ? date : localDate();
    const tasks = state.tasks || [];
    const bugs = state.bugs || [];
    const doneTasks = tasks.filter((task) => task.completedAt && localDate(task.completedAt) === day);
    const foundBugs = bugs.filter((bug) => localDate(bug.createdAt) === day);
    const verifiedBugs = bugs.filter((bug) => bug.verifiedAt && localDate(bug.verifiedAt) === day);
    const closedBugs = bugs.filter((bug) => bug.closedAt && localDate(bug.closedAt) === day);
    const ongoingTasks = tasks.filter((task) => {
      if (task.status === 'done') return false;
      if (task.createdAt && localDate(task.createdAt) > day) return false;
      return task.status === 'doing' || task.status === 'blocked' || (task.dueDate && task.dueDate <= day);
    });
    const nextTasks = tasks
      .filter((task) => task.status !== 'done' && task.dueDate && task.dueDate > day)
      .sort(compareTasks)
      .slice(0, 5);
    const riskyTasks = tasks.filter((task) => task.status === 'blocked' || isTaskOverdue(task, day));
    const riskyBugs = bugs.filter((bug) => isBugOpen(bug) && (bug.severity === 'P0' || bug.severity === 'P1'));
    const autojobActive = (state.autojobBugs || []).filter(
      (bug) => bug.rawStatus === 'active' && bug.autojobRelation === 'assigned'
    );
    const autojobRisky = autojobActive.filter((bug) => bug.pri === 'P0' || bug.pri === 'P1');

    return { day, doneTasks, foundBugs, verifiedBugs, closedBugs, ongoingTasks, nextTasks, riskyTasks, riskyBugs, autojobActive, autojobRisky };
  }

  function taskLine(task) {
    const meta = [task.project, task.module].filter(Boolean).join(' / ');
    return `- ${task.title}${meta ? `（${meta}）` : ''}`;
  }

  function bugLine(bug, prefix) {
    return `- ${prefix || ''}${bug.id} [${bug.severity}] ${bug.title}${bug.module ? `（${bug.module}）` : ''}`;
  }

  function uniqueBy(items, key) {
    return Array.from(new Map(items.map((item) => [item[key], item])).values());
  }

  function buildReport(state, date) {
    const day = isDateString(date) ? date : localDate();
    const data = collectDailyData(state, day);
    const foundIds = new Set(data.foundBugs.map((bug) => bug.id));
    const verifiedOnly = data.verifiedBugs.filter((bug) => !foundIds.has(bug.id));
    const closedOnly = data.closedBugs.filter(
      (bug) => !foundIds.has(bug.id) && !verifiedOnly.some((item) => item.id === bug.id)
    );

    const doneParts = [];
    if (data.doneTasks.length) doneParts.push(...data.doneTasks.map(taskLine));
    if (closedOnly.length) doneParts.push(...closedOnly.map((bug) => bugLine(bug, '已完成验证并关闭 ')));

    const bugParts = [];
    if (data.foundBugs.length) {
      bugParts.push('【新发现】');
      bugParts.push(...data.foundBugs.map((bug) => bugLine(bug)));
    }
    if (verifiedOnly.length) {
      bugParts.push('【已验证】');
      bugParts.push(...verifiedOnly.map((bug) => bugLine(bug, '验证通过 ')));
    }
    if (data.autojobActive && data.autojobActive.length) {
      bugParts.push('【客服反馈·待处理】');
      bugParts.push(...data.autojobActive.slice(0, 10).map((bug) => bugLine(bug)));
    }

    const ongoingParts = data.ongoingTasks.map((task) => {
      const suffix = task.status === 'blocked' ? ' · 已阻塞' : task.status === 'doing' ? ' · 进行中' : '';
      return `${taskLine(task)}${suffix}`;
    });

    const nextParts = data.nextTasks.map((task) => `- ${task.title}（截止 ${relativeDay(task.dueDate, day)}）`);

    const riskParts = [];
    data.riskyTasks.forEach((task) => {
      const reason = task.status === 'blocked' ? '存在阻塞，需协调资源' : `已逾期至 ${task.dueDate}`;
      riskParts.push(`- ${task.title}：${reason}`);
    });
    data.riskyBugs.forEach((bug) => {
      riskParts.push(`- ${bug.id} [${bug.severity}] ${bug.title}：当前${BUG_STATUS[bug.status].label}`);
    });
    (data.autojobRisky || []).forEach((bug) => {
      riskParts.push(`- ${bug.id} [${bug.pri}] ${bug.title}：客服反馈待处理（${bug.project}）`);
    });

    const summaryBits = [];
    summaryBits.push(`今日完成 ${data.doneTasks.length} 项任务`);
    summaryBits.push(`推进 ${data.ongoingTasks.length} 项`);
    if (data.foundBugs.length) summaryBits.push(`新发现 ${data.foundBugs.length} 个 Bug`);
    if (data.verifiedBugs.length) summaryBits.push(`验证 ${data.verifiedBugs.length} 个 Bug`);
    if (data.autojobActive && data.autojobActive.length) {
      summaryBits.push(`客服反馈待处理 ${data.autojobActive.length} 条`);
    }
    const summary = summaryBits.join('，') + '。';

    return {
      id: `R-${day}`,
      date: day,
      status: 'draft',
      content: {
        summary,
        done: doneParts.join('\n'),
        bugs: bugParts.join('\n'),
        ongoing: ongoingParts.join('\n'),
        next: nextParts.join('\n'),
        risks: riskParts.join('\n')
      },
      createdAt: nowIso(),
      updatedAt: nowIso(),
      submittedAt: null
    };
  }

  function section(markdown, title, value) {
    return `## ${title}\n\n${value && value.trim() ? value.trim() : '无'}\n`;
  }

  function renderReportMarkdown(report, profile) {
    const who = profile || {};
    const content = report.content || {};
    return [
      `# 工作日报｜${report.date}`,
      `**${who.name || '测试工程师'}** · ${who.role || '测试开发工程师'}${who.team ? ` · ${who.team}` : ''}`,
      '',
      `> 日报状态：${report.status === 'submitted' ? '已提交' : '草稿'} · 生成时间：${new Date(report.updatedAt || report.createdAt || Date.now()).toLocaleString('zh-CN', { hour12: false })}`,
      '',
      section('', '今日摘要', content.summary),
      section('', '已完成', content.done),
      section('', 'Bug 跟踪', content.bugs),
      section('', '进行中', content.ongoing),
      section('', '明日计划', content.next),
      section('', '风险与阻塞', content.risks),
      '---',
      '由 QDesk 测试工作台生成'
    ].join('\n');
  }

  function weekSeries(state, endDate) {
    const end = isDateString(endDate) ? endDate : localDate();
    const days = [];
    for (let i = 6; i >= 0; i -= 1) {
      const date = addDays(end, -i);
      const tasksDone = (state.tasks || []).filter((task) => task.completedAt && localDate(task.completedAt) === date).length;
      const bugsFound = (state.bugs || []).filter((bug) => localDate(bug.createdAt) === date).length;
      const bugsVerified = (state.bugs || []).filter((bug) => bug.verifiedAt && localDate(bug.verifiedAt) === date).length;
      const d = new Date(date + 'T12:00:00');
      days.push({
        date,
        label: ['日', '一', '二', '三', '四', '五', '六'][d.getDay()],
        tasksDone,
        bugsFound,
        bugsVerified
      });
    }
    return days;
  }

  function recentActivity(state, limit) {
    const activity = [];
    (state.tasks || []).forEach((task) => {
      (task.history || []).slice(0, 4).forEach((item) => {
        activity.push({ at: item.at, text: item.text, kind: 'task', title: task.title, id: task.id });
      });
    });
    (state.bugs || []).forEach((bug) => {
      (bug.history || []).slice(0, 4).forEach((item) => {
        activity.push({ at: item.at, text: item.text, kind: 'bug', title: bug.title, id: bug.id });
      });
    });
    (state.reports || []).forEach((report) => {
      if (report.submittedAt) {
        activity.push({
          at: report.submittedAt,
          text: '提交了工作日报',
          kind: 'report',
          title: report.date,
          id: report.id
        });
      }
    });
    return activity
      .filter((item) => item.at)
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, limit || 6);
  }

  function setTaskStatus(task, status, at) {
    if (!TASK_STATUS[status]) throw new Error('无效的任务状态');
    const timestamp = at || nowIso();
    const previous = task.status;
    task.status = status;
    task.updatedAt = timestamp;
    if (status === 'done') {
      task.completedAt = timestamp;
    } else {
      task.completedAt = null;
    }
    if (previous !== status) {
      task.history = task.history || [];
      task.history.unshift({
        at: timestamp,
        text: status === 'done' ? '完成了任务' : `状态由「${TASK_STATUS[previous].label}」变更为「${TASK_STATUS[status].label}」`
      });
      task.history = task.history.slice(0, 50);
    }
    return task;
  }

  function setBugStatus(bug, status, at) {
    if (!BUG_STATUS[status]) throw new Error('无效的 Bug 状态');
    const timestamp = at || nowIso();
    const previous = bug.status;
    bug.status = status;
    bug.updatedAt = timestamp;
    if (status === 'closed') {
      if (!bug.verifiedAt) bug.verifiedAt = timestamp;
      bug.closedAt = timestamp;
    } else if (previous === 'closed') {
      bug.verifiedAt = null;
      bug.closedAt = null;
    }
    if (previous !== status) {
      bug.history = bug.history || [];
      bug.history.unshift({
        at: timestamp,
        text: status === 'closed' ? '验证通过并关闭 Bug' : `状态由「${BUG_STATUS[previous].label}」变更为「${BUG_STATUS[status].label}」`
      });
      bug.history = bug.history.slice(0, 50);
    }
    return bug;
  }

  function filterTasks(tasks, filters) {
    const f = filters || {};
    const query = String(f.q || '').trim().toLowerCase();
    const day = f.date || localDate();
    return (tasks || [])
      .filter((task) => {
        if (f.status && f.status !== 'all' && task.status !== f.status) return false;
        if (f.priority && f.priority !== 'all' && task.priority !== f.priority) return false;
        if (f.project && f.project !== 'all' && task.project !== f.project) return false;
        if (f.due === 'today' && task.dueDate !== day) return false;
        if (f.due === 'overdue' && !isTaskOverdue(task, day)) return false;
        if (query) {
          const haystack = [task.title, task.description, task.project, task.module, task.type, ...(task.tags || [])]
            .join(' ')
            .toLowerCase();
          if (!haystack.includes(query)) return false;
        }
        return true;
      })
      .sort(compareTasks);
  }

  function filterBugs(bugs, filters) {
    const f = filters || {};
    const query = String(f.q || '').trim().toLowerCase();
    return (bugs || [])
      .filter((bug) => {
        if (f.status === 'unclosed') {
          if (bug.status === 'closed') return false;
        } else if (f.status && f.status !== 'all' && bug.status !== f.status) {
          return false;
        }
        if (f.version && f.version !== 'all' && versionKey(bug.version) !== f.version) return false;
        if (f.releaseKind === 'pending' && !needsMyVerification(bug)) return false;
        if (f.releaseKind === 'open' && (needsMyVerification(bug) || !bug.isMine || bug.status === 'closed')) return false;
        if (f.severity && f.severity !== 'all' && bug.severity !== f.severity) return false;
        if (f.product && f.product !== 'all' && bug.project !== f.product) return false;
        if (f.project && f.project !== 'all' && bug.project !== f.project) return false;
        if (f.mine && bug.assignee !== '我' && bug.reporter !== '我') return false;
        if (query) {
          const haystack = [bug.id, bug.title, bug.project, bug.module, bug.assignee, bug.environment]
            .join(' ')
            .toLowerCase();
          if (!haystack.includes(query)) return false;
        }
        return true;
      })
      .sort(compareBugs);
  }

  /* =========================================================
     Rich text (ZenTao Markdown / HTML)
     ========================================================= */

  function escapeRichHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

  function decodeRichEntities(value) {
    return String(value == null ? '' : value)
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }

  function zenTaoFileId(value) {
    const text = String(value == null ? '' : value).trim();
    let match = text.match(/^\{(\d{1,12})(?:\.[a-z0-9]{1,10})?\}$/i);
    if (match) return match[1];
    match = text.match(/[?&](?:fileID|fileId|fileid)=(\d{1,12})/);
    if (match) return match[1];
    match = text.match(/\/api\.php\/v1\/files\/(\d{1,12})/i);
    if (match) return match[1];
    return '';
  }

  function sanitizeRichUrl(value) {
    const raw = decodeRichEntities(String(value == null ? '' : value)).trim();
    if (!raw) return '';
    const fileId = zenTaoFileId(raw);
    if (fileId) return `/api/zentao/file/${fileId}`;
    if (/^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(raw)) return raw;
    if (/^https?:\/\//i.test(raw)) return raw;
    if (/^mailto:/i.test(raw)) return raw;
    if (/^\/(?!\/)/.test(raw)) return raw;
    if (/^#[\w-]+$/.test(raw)) return raw;
    return '';
  }

  function normalizeImageSource(value) {
    const raw = decodeRichEntities(String(value == null ? '' : value)).trim().replace(/^<|>$/g, '');
    const fileId = zenTaoFileId(raw);
    if (fileId) return { src: `/api/zentao/file/${fileId}`, fileId, raw };
    if (/^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(raw)) return { src: raw, fileId: '', raw };
    return { src: '', fileId: '', raw };
  }

  function cleanImageAlt(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text || /^bug[\s_-]*screenshot$/i.test(text) || text === '截图') return '';
    return text;
  }

  function richImageHtml(rawSrc, alt) {
    const normalized = normalizeImageSource(rawSrc);
    const label = escapeRichHtml(cleanImageAlt(alt) || '截图');
    if (normalized.src) {
      return `<figure class="rich-image"><a href="${escapeRichHtml(normalized.src)}" target="_blank" rel="noopener noreferrer"><img src="${escapeRichHtml(normalized.src)}" alt="${label}" loading="lazy"></a><figcaption>${label}</figcaption></figure>`;
    }
    if (/^https?:\/\//i.test(normalized.raw)) {
      return `<p class="rich-image-link"><a href="${escapeRichHtml(normalized.raw)}" target="_blank" rel="noopener noreferrer">查看图片：${label}</a></p>`;
    }
    return `<p class="rich-image-link">${label}（该图片需在禅道中查看）</p>`;
  }

  function inlineRichText(value) {
    let text = escapeRichHtml(value);
    const stash = [];
    const keep = (html) => {
      const token = `\u0000${stash.length}\u0000`;
      stash.push(html);
      return token;
    };
    text = text.replace(/\\([\\`*_{}\[\]()#+\-.!>~|])/g, (_, char) => keep(escapeRichHtml(char)));
    text = text.replace(/`([^`\n]+)`/g, (_, code) => keep(`<code>${code}</code>`));
    text = text.replace(/!\[([^\]]*)\]\(([^)\n]+)\)/g, (_, alt, src) => {
      const clean = src.replace(/\s+&quot;.*?&quot;\s*$/, '').trim();
      return keep(richImageHtml(clean, alt));
    });
    text = text.replace(/\[([^\]]+)\]\(([^)\n]+)\)/g, (_, label, href) => {
      const url = sanitizeRichUrl(href.replace(/\s+&quot;.*?&quot;\s*$/, '').trim());
      if (!url) return label;
      return keep(`<a href="${escapeRichHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`);
    });
    text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
    text = text.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    text = text.replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?，。；：])/g, '$1<em>$2</em>');
    text = text.replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?，。；：])/g, '$1<em>$2</em>');
    text = text.replace(/\u0000(\d+)\u0000/g, (_, index) => stash[Number(index)]);
    return text;
  }

  function trimUrlTail(raw) {
    let url = String(raw || '');
    let tail = '';
    const trimChars = /[.,;:!?，。；：、"'”’]/;
    while (url && trimChars.test(url.slice(-1))) {
      tail = url.slice(-1) + tail;
      url = url.slice(0, -1);
    }
    [[')', '('], [']', '['], ['}', '{']].forEach(([close, open]) => {
      while (url.endsWith(close)) {
        const closeCount = url.split(close).length - 1;
        const openCount = url.split(open).length - 1;
        if (closeCount <= openCount) break;
        tail = close + tail;
        url = url.slice(0, -1);
      }
    });
    return { url, tail };
  }

  function autoLinkBareUrls(html) {
    let anchorDepth = 0;
    let skipDepth = 0;
    return String(html == null ? '' : html).split(/(<[^>]*>)/g).map((part) => {
      if (!part) return part;
      if (part.charAt(0) === '<') {
        if (/^<a\b/i.test(part)) anchorDepth += 1;
        else if (/^<\/a\s*>/i.test(part)) anchorDepth = Math.max(0, anchorDepth - 1);
        else if (/^<(?:code|pre)\b/i.test(part)) skipDepth += 1;
        else if (/^<\/(?:code|pre)\s*>/i.test(part)) skipDepth = Math.max(0, skipDepth - 1);
        return part;
      }
      if (anchorDepth || skipDepth) return part;
      return part.replace(/(^|[\s（(【>:：])(https?:\/\/[^\s<>"'\u0000]+)/g, (match, prefix, rawUrl) => {
        const trimmed = trimUrlTail(rawUrl);
        if (!trimmed.url) return match;
        return `${prefix}<a href="${trimmed.url}" target="_blank" rel="noopener noreferrer">${trimmed.url}</a>${trimmed.tail}`;
      });
    }).join('');
  }

  function matchListLine(line) {
    return String(line || '').match(/^(\s*)([-*+]|(\d+)\\?[.)])\s+(.*)$/);
  }

  function startsMarkdownBlock(line) {
    return /^\s*(```|#{1,6}\s|>|[-*+]\s+|\d+\\?[.)]\s+|([-*_])(?:\s*\2){2,}\s*$|\|)/.test(line);
  }

  function splitTableRow(line) {
    return String(line || '')
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim());
  }

  function buildMarkdownList(rows, start, indent) {
    const ordered = rows[start].ordered;
    const tag = ordered ? 'ol' : 'ul';
    let html = `<${tag}>`;
    let index = start;
    while (index < rows.length && rows[index].indent >= indent) {
      if (rows[index].indent > indent) {
        const nested = buildMarkdownList(rows, index, rows[index].indent);
        html += nested.html;
        index = nested.index;
        continue;
      }
      html += `<li>${inlineRichText(rows[index].text.replace(/[ \t]+$/gm, '')).replace(/\n/g, '<br>')}`;
      index += 1;
      if (index < rows.length && rows[index].indent > indent) {
        const nested = buildMarkdownList(rows, index, rows[index].indent);
        html += nested.html;
        index = nested.index;
      }
      html += '</li>';
    }
    return { html: `${html}</${tag}>`, index };
  }

  function renderMarkdown(value) {
    const lines = String(value == null ? '' : value).replace(/\r\n?/g, '\n').replace(/\t/g, '  ').split('\n');
    const output = [];
    let index = 0;
    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) { index += 1; continue; }

      if (/^\s*```/.test(line)) {
        const fence = line.match(/^\s*```([\w+#.-]*)\s*$/);
        const language = fence ? fence[1] : '';
        const buffer = [];
        index += 1;
        while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
          buffer.push(lines[index]);
          index += 1;
        }
        if (index < lines.length) index += 1;
        output.push(`<pre><code${language ? ` class="language-${escapeRichHtml(language)}"` : ''}>${escapeRichHtml(buffer.join('\n'))}</code></pre>`);
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        const level = heading[1].length;
        output.push(`<h${level}>${inlineRichText(heading[2])}</h${level}>`);
        index += 1;
        continue;
      }

      if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
        output.push('<hr>');
        index += 1;
        continue;
      }

      if (/^\s*>/.test(line)) {
        const buffer = [];
        while (index < lines.length && /^\s*>/.test(lines[index])) {
          buffer.push(lines[index].replace(/^\s*>\s?/, ''));
          index += 1;
        }
        output.push(`<blockquote>${renderMarkdown(buffer.join('\n'))}</blockquote>`);
        continue;
      }

      if (line.includes('|') && index + 1 < lines.length && lines[index + 1].includes('|')) {
        const header = splitTableRow(line);
        const divider = splitTableRow(lines[index + 1]);
        if (header.length && divider.length === header.length && divider.every((cell) => /^:?-{2,}:?$/.test(cell))) {
          index += 2;
          const rows = [];
          while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
            rows.push(splitTableRow(lines[index]));
            index += 1;
          }
          output.push(`<div class="rich-table-wrap"><table><thead><tr>${header.map((cell) => `<th>${inlineRichText(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${header.map((_, cellIndex) => `<td>${inlineRichText(row[cellIndex] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
          continue;
        }
      }

      if (matchListLine(line)) {
        const rows = [];
        while (index < lines.length) {
          const item = matchListLine(lines[index]);
          if (item) {
            rows.push({
              indent: item[1].length,
              ordered: /^\d/.test(item[2]),
              text: item[4]
            });
            index += 1;
            continue;
          }
          if (rows.length && /^\s{2,}\S/.test(lines[index]) && !startsMarkdownBlock(lines[index])) {
            rows[rows.length - 1].text += `\n${lines[index].trim()}`;
            index += 1;
            continue;
          }
          break;
        }
        output.push(buildMarkdownList(rows, 0, rows[0].indent).html);
        continue;
      }

      const paragraph = [line];
      index += 1;
      while (index < lines.length && lines[index].trim() && !startsMarkdownBlock(lines[index])) {
        paragraph.push(lines[index]);
        index += 1;
      }
      const rendered = paragraph.map((item) => inlineRichText(item.replace(/[ \t]+$/, ''))).join('<br>');
      const onlyImages = /^(?:\s*<figure class="rich-image">[\s\S]*?<\/figure>\s*)+$/.test(rendered);
      output.push(onlyImages ? rendered : `<p>${rendered}</p>`);
    }
    return output.join('\n');
  }

  function looksLikeHtml(value) {
    return /<(?:p|div|br|span|img|a|ul|ol|li|h[1-6]|pre|code|blockquote|table|thead|tbody|tr|td|th|strong|b|em|i|u|s|del|figure|figcaption|hr)\b[^>]*>/i.test(String(value || ''));
  }

  function htmlAttribute(source, name) {
    const regex = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s"\'=<>`]+))', 'i');
    const match = regex.exec(String(source || ''));
    if (!match) return '';
    return decodeRichEntities(match[1] != null ? match[1] : match[2] != null ? match[2] : match[3] || '');
  }

  function sanitizeHtmlFragment(value) {
    const source = String(value == null ? '' : value)
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style|iframe|object|embed|svg|math|link|meta)\b[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<(script|style|iframe|object|embed|svg|math|link|meta)\b[^>]*\/?>/gi, '');
    const allowed = new Set([
      'p', 'div', 'br', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'del',
      'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'hr', 'a', 'img', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'th', 'td'
    ]);
    let output = '';
    let cursor = 0;
    const tagPattern = /<\/?([a-zA-Z][\w:-]*)((?:\s+[^<>]*)?)\/?>/g;
    let match;
    while ((match = tagPattern.exec(source))) {
      output += escapeRichHtml(source.slice(cursor, match.index));
      cursor = tagPattern.lastIndex;
      const name = match[1].toLowerCase();
      const attrs = match[2] || '';
      const closing = match[0].startsWith('</');
      if (!allowed.has(name)) continue;
      if (closing) {
        if (name !== 'br' && name !== 'hr' && name !== 'img') output += `</${name}>`;
        continue;
      }
      if (name === 'br') { output += '<br>'; continue; }
      if (name === 'hr') { output += '<hr>'; continue; }
      if (name === 'img') {
        const src = htmlAttribute(attrs, 'src');
        const alt = htmlAttribute(attrs, 'alt');
        const image = normalizeImageSource(src);
        if (image.src) {
          const label = escapeRichHtml(cleanImageAlt(alt) || '截图');
          output += `<figure class="rich-image"><a href="${escapeRichHtml(image.src)}" target="_blank" rel="noopener noreferrer"><img src="${escapeRichHtml(image.src)}" alt="${label}" loading="lazy"></a><figcaption>${label}</figcaption></figure>`;
        }
        continue;
      }
      if (name === 'a') {
        const href = sanitizeRichUrl(htmlAttribute(attrs, 'href'));
        const title = htmlAttribute(attrs, 'title');
        output += `<a${href ? ` href="${escapeRichHtml(href)}" target="_blank" rel="noopener noreferrer"` : ''}${title ? ` title="${escapeRichHtml(title)}"` : ''}>`;
        continue;
      }
      output += `<${name}>`;
    }
    output += escapeRichHtml(source.slice(cursor));
    return output;
  }

  function renderRichText(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text) return '';
    let body = looksLikeHtml(text) ? sanitizeHtmlFragment(text) : renderMarkdown(text);
    body = autoLinkBareUrls(body);
    body = body.replace(/<p>((?:\s*<figure class="rich-image">[\s\S]*?<\/figure>\s*)+)<\/p>/g, '$1');
    return `<div class="rich-text">${body}</div>`;
  }

  function extractAttachments(values) {
    const source = Array.isArray(values) ? values.join('\n') : String(values == null ? '' : values);
    const seen = new Set();
    const attachments = [];
    const add = (id, alt) => {
      const key = String(id || '');
      if (!key || seen.has(key)) return;
      seen.add(key);
      attachments.push({ id: key, fileId: key, alt: cleanImageAlt(alt), url: `/api/zentao/file/${key}` });
    };
    source.replace(/!\[([^\]]*)\]\(([^)\n]+)\)/g, (_, alt, src) => {
      add(zenTaoFileId(src), alt);
      return '';
    });
    source.replace(/[?&](?:fileID|fileId|fileid)=(\d{1,12})/g, (_, id) => {
      add(id, '');
      return '';
    });
    source.replace(/\{(\d{1,12})\.(?:png|jpe?g|gif|webp|bmp)\}/gi, (_, id) => {
      add(id, '');
      return '';
    });
    return attachments;
  }

  return {
    VERSION,
    TASK_STATUS,
    BUG_STATUS,
    SEVERITY,
    TASK_TYPES,
    REPRO,
    localDate,
    dateAt,
    addDays,
    nowIso,
    formatDateCN,
    relativeDay,
    uid,
    clone,
    defaultState,
    normalizeState,
    nextId,
    compareTasks,
    compareBugs,
    isTaskOverdue,
    isBugOpen,
    needsMyVerification,
    releaseCatalog,
    dailyFocus,
    metrics,
    statusCounts,
    severityCounts,
    collectDailyData,
    buildReport,
    renderReportMarkdown,
    weekSeries,
    recentActivity,
    setTaskStatus,
    setBugStatus,
    filterTasks,
    filterBugs,
    versionKey,
    uniqueBy,
    renderRichText,
    extractAttachments,
    zenTaoFileId
  };
});
