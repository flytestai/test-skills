#!/usr/bin/env node
/**
 * 从企业微信通讯录查询开发成员的 userid，并写入 QDesk 定时任务的 mentionMap。
 *
 * 安全约定：
 * - 只从环境变量读取企业微信 corpid / corpsecret，绝不写入磁盘、绝不打印。
 * - 不打印 access_token，也不打印任何 member userid。
 * - 默认只更新 QDesk，不发送任何企微消息。
 *
 * 用法：
 *   set WECOM_CORP_ID=...
 *   set WECOM_CORP_SECRET=...
 *   node tools/wecom-fill-mentions.mjs --job RJ-1
 *
 * 可选：
 *   --job RJ-1          定时任务 ID，默认 RJ-1
 *   --base http://127.0.0.1:4173   QDesk 地址
 *   --dry-run           只匹配、不写入 QDesk
 *   --help              显示帮助
 *
 * 企业微信自建应用需要「通讯录 → 读取成员 / 读取部门」权限。
 */

const DEFAULT_JOB = 'RJ-1';
const DEFAULT_BASE = process.env.QDESK_URL || 'http://127.0.0.1:4173';
const WECOM_API_BASE = (process.env.WECOM_API_BASE || 'https://qyapi.weixin.qq.com').replace(/\/+$/, '');

function splitNames(value) {
  return String(value == null ? '' : value)
    .split(/[,，\s]+/)
    .map((name) => normalizeName(name))
    .filter(Boolean);
}

function parseArgs(argv) {
  const args = {
    job: DEFAULT_JOB,
    base: DEFAULT_BASE,
    dryRun: false,
    help: false,
    names: splitNames(process.env.WECOM_TARGET_NAMES)
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--job') args.job = String(argv[++i] || '').trim();
    else if (arg === '--base') args.base = String(argv[++i] || '').trim();
    else if (arg === '--names') args.names = splitNames(argv[++i]);
    else throw new Error(`未知参数：${arg}`);
  }
  if (!args.job) throw new Error('--job 不能为空。');
  if (!/^https?:\/\//i.test(args.base)) throw new Error('--base 必须是 http(s) 地址。');
  if (!args.help && !args.names.length) {
    throw new Error('请用 --names 指定要查询的姓名，例如 --names 张三,李四。');
  }
  return args;
}

function printHelp() {
  console.log(`查询企业微信成员 userid 并写入 QDesk 定时任务映射

用法：
  node wecom-fill-mentions.mjs --job RJ-1 --names 张三,李四

环境变量：
  WECOM_CORP_ID       企业微信企业 ID
  WECOM_CORP_SECRET   有通讯录读取权限的自建应用 Secret
  WECOM_TARGET_NAMES  可选，目标姓名，逗号分隔；也可用 --names 传入
  QDESK_URL           可选，默认 http://127.0.0.1:4173
  WECOM_API_BASE      可选，仅测试用，默认 https://qyapi.weixin.qq.com

参数：
  --job <id>          定时任务 ID，默认 ${DEFAULT_JOB}
  --names <list>      目标姓名，逗号分隔
  --base <url>        QDesk 地址
  --dry-run           只匹配，不写入
  --help              显示帮助

说明：
  - 不会打印 userid、corpid、corpsecret 或 access_token。
  - 只更新指定任务的 mentionMap，不会发送企微消息。`);
}

async function requestJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    cache: 'no-store'
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`接口返回非 JSON（HTTP ${res.status}）。`);
  }
  if (!res.ok) {
    throw new Error(body?.error?.message || body?.errmsg || `HTTP ${res.status}`);
  }
  return body;
}

async function qdesk(base, path, options = {}) {
  const body = await requestJson(`${base}${path}`, options);
  if (body && body.ok === false) {
    throw new Error(body?.error?.message || 'QDesk 接口返回失败。');
  }
  return body;
}

async function wecom(path, params = {}) {
  const url = new URL(`${WECOM_API_BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  });
  const body = await requestJson(url.toString());
  if (Number(body.errcode) !== 0) {
    const hint = body.errmsg || `errcode ${body.errcode}`;
    throw new Error(`企业微信接口失败：${hint}`);
  }
  return body;
}

function normalizeName(value) {
  return String(value == null ? '' : value).replace(/\s+/g, '').trim();
}

function listDepartments(depBody) {
  const list = Array.isArray(depBody.department) ? depBody.department : [];
  const ids = [];
  const seen = new Set();
  const push = (id) => {
    const text = String(id == null ? '' : id).trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    ids.push(text);
  };
  push(1);
  list.forEach((item) => push(item && item.id));
  return ids;
}

async function fetchDirectoryUsers(token) {
  let departmentIds = ['1'];
  try {
    const depBody = await wecom('/cgi-bin/department/list', { access_token: token });
    departmentIds = listDepartments(depBody);
  } catch (error) {
    // 部门接口不可用时，至少尝试根部门；不要因为一个可选调用阻断主流程。
    console.warn(`读取部门列表失败，改为只扫描根部门：${error.message}`);
  }

  const users = [];
  const seen = new Set();
  for (const departmentId of departmentIds) {
    let body;
    try {
      body = await wecom('/cgi-bin/user/list', {
        access_token: token,
        department_id: departmentId,
        fetch_child: 0
      });
    } catch (error) {
      throw new Error(`读取部门成员失败：${error.message}`);
    }
    for (const user of Array.isArray(body.userlist) ? body.userlist : []) {
      const userid = String(user && user.userid || '').trim();
      if (!userid || seen.has(userid)) continue;
      seen.add(userid);
      users.push({
        userid,
        name: String(user.name || '').trim(),
        alias: String(user.alias || user.english_name || '').trim(),
        departments: Array.isArray(user.department) ? user.department : []
      });
    }
  }
  return users;
}

function matchTargets(users, groups, targets) {
  const byName = new Map();
  users.forEach((user) => {
    const key = normalizeName(user.name);
    if (!key) return;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(user);
  });

  const accountByName = new Map();
  (groups || []).forEach((group) => {
    const key = normalizeName(group && group.name);
    const account = String(group && group.account || '').trim();
    if (key && account) accountByName.set(key, account);
  });

  const matched = [];
  const missing = [];
  const ambiguous = [];
  for (const target of targets) {
    const candidates = byName.get(normalizeName(target)) || [];
    if (!candidates.length) {
      missing.push(target);
      continue;
    }
    if (candidates.length === 1) {
      matched.push({ target, user: candidates[0], account: accountByName.get(normalizeName(target)) || '' });
      continue;
    }
    const account = accountByName.get(normalizeName(target)) || '';
    const byAccount = account
      ? candidates.filter((user) => user.userid.toLowerCase() === account.toLowerCase())
      : [];
    if (byAccount.length === 1) {
      matched.push({ target, user: byAccount[0], account });
      continue;
    }
    ambiguous.push({ target, count: candidates.length });
  }
  return { matched, missing, ambiguous };
}

function buildNextMap(currentMap, matched) {
  const next = Object.assign({}, currentMap && typeof currentMap === 'object' ? currentMap : {});
  let changed = 0;
  matched.forEach(({ target, user, account }) => {
    const userid = String(user.userid || '').trim();
    if (!userid) return;
    if (next[target] !== userid) changed += 1;
    next[target] = userid;
    const accountKey = String(account || '').trim();
    if (accountKey && accountKey !== target) {
      if (next[accountKey] !== userid) changed += 1;
      next[accountKey] = userid;
    }
  });
  return { next, changed };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const corpid = String(process.env.WECOM_CORP_ID || '').trim();
  const corpsecret = String(process.env.WECOM_CORP_SECRET || '').trim();
  if (!corpid || !corpsecret) {
    console.error('缺少 WECOM_CORP_ID 或 WECOM_CORP_SECRET。');
    console.error('请在当前终端设置这两个环境变量后再运行；不要把 Secret 发到聊天里。');
    console.error('可先运行 --help 查看说明。');
    process.exitCode = 2;
    return;
  }

  const base = args.base.replace(/\/+$/, '');
  console.log(`读取 QDesk 任务：${args.job}`);
  const reminderBody = await qdesk(base, `/api/reminders?jobId=${encodeURIComponent(args.job)}`);
  const job = reminderBody?.data?.selectedJob;
  if (!job) throw new Error(`QDesk 中找不到任务 ${args.job}。`);

  let groups = [];
  try {
    const previewBody = await qdesk(base, '/api/reminders/preview', {
      method: 'POST',
      body: JSON.stringify({
        productIds: Array.isArray(job.productIds) ? job.productIds : [],
        versions: Array.isArray(job.versions) ? job.versions : [],
        thresholdDays: job.thresholdDays,
        repeatDays: 0
      })
    });
    groups = previewBody?.data?.preview?.groups || [];
  } catch (error) {
    console.warn(`读取 QDesk 预览失败，将只按姓名匹配：${error.message}`);
  }

  console.log('获取企业微信 access_token...');
  const tokenBody = await wecom('/cgi-bin/gettoken', {
    corpid,
    corpsecret
  });
  const token = String(tokenBody.access_token || '');
  if (!token) throw new Error('企业微信未返回 access_token。');

  console.log('扫描企业微信通讯录成员...');
  const users = await fetchDirectoryUsers(token);
  console.log(`通讯录成员数：${users.length}`);

  const { matched, missing, ambiguous } = matchTargets(users, groups, args.names);
  console.log(`匹配结果：${matched.length}/${args.names.length}`);
  if (matched.length) console.log(`已匹配：${matched.map((item) => item.target).join('、')}`);
  if (missing.length) console.log(`未找到：${missing.join('、')}`);
  if (ambiguous.length) {
    ambiguous.forEach((item) => {
      console.log(`同名成员：${item.target} 共 ${item.count} 位，无法自动确定。`);
    });
  }

  if (missing.length || ambiguous.length) {
    console.error('为避免填错，未写入 QDesk。请用账号/邮箱区分同名成员，或让管理员确认后手动填写。');
    process.exitCode = 3;
    return;
  }

  const { next, changed } = buildNextMap(job.mentionMap, matched);
  console.log(`映射变更：${changed} 项；任务原有映射 ${Object.keys(job.mentionMap || {}).length} 项。`);

  if (args.dryRun) {
    console.log('[DRY-RUN] 未写入 QDesk。');
    return;
  }

  await qdesk(base, '/api/reminders', {
    method: 'POST',
    body: JSON.stringify({ id: args.job, mentionMap: next })
  });

  const verifyBody = await qdesk(base, `/api/reminders?jobId=${encodeURIComponent(args.job)}`);
  const written = verifyBody?.data?.selectedJob?.mentionMap || {};
  const verified = args.names.filter((name) => String(written[name] || '').trim());
  console.log(`已写入任务 ${args.job}：${verified.length}/${args.names.length} 位开发。`);
  console.log(`任务列表中的「艾特未配置」应已消失；刷新 QDesk 页面即可看到。`);
}

main().catch((error) => {
  console.error(`执行失败：${error.message}`);
  process.exitCode = 1;
});
