'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

class ZentaoError extends Error {
  constructor(message, options) {
    super(message);
    const opts = options || {};
    this.name = 'ZentaoError';
    this.code = opts.code || 'ZENTAO_ERROR';
    this.details = opts.details || null;
    this.exitCode = opts.exitCode == null ? null : opts.exitCode;
  }
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function cliCandidates(configuredPath) {
  const dirs = unique((process.env.PATH || '').split(path.delimiter));
  const candidates = [];
  if (configuredPath) {
    candidates.push(configuredPath);
  }
  if (process.env.ZENTAO_CLI_JS) {
    candidates.push(process.env.ZENTAO_CLI_JS);
  }
  dirs.forEach((dir) => {
    candidates.push(path.join(dir, 'node_modules', 'zentao-cli', 'bin', 'zentao.js'));
    candidates.push(path.join(dir, '..', 'node_modules', 'zentao-cli', 'bin', 'zentao.js'));
    candidates.push(path.join(dir, 'zentao.js'));
  });
  const npmPrefix = path.dirname(process.execPath);
  candidates.push(path.join(npmPrefix, '..', 'npm-global', 'node_modules', 'zentao-cli', 'bin', 'zentao.js'));
  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', 'zentao-cli', 'bin', 'zentao.js'));
    candidates.push(path.join(process.env.APPDATA, 'bee-pc-agent-test', 'agent-runtime', 'npm-global', 'node_modules', 'zentao-cli', 'bin', 'zentao.js'));
  }
  return unique(candidates);
}

function resolveCommand(configuredPath) {
  for (const candidate of cliCandidates(configuredPath)) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile() && candidate.endsWith('.js')) {
        return { command: process.execPath, prefix: [candidate], entry: candidate };
      }
    } catch (error) {
      // Ignore inaccessible PATH entries and keep looking for the CLI.
    }
  }
  if (configuredPath && fs.existsSync(configuredPath)) {
    return { command: configuredPath, prefix: [], entry: configuredPath };
  }
  throw new ZentaoError(
    '未找到禅道 CLI。请先安装 zentao-cli，或在 config.json 中设置 zentao.cliPath。',
    { code: 'CLI_NOT_FOUND' }
  );
}

function terminateChild(child) {
  if (!child || !child.pid) return;
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      });
      return;
    } catch (error) {
      // Fall through to the portable kill below.
    }
  }
  try { child.kill('SIGKILL'); } catch (error) { /* noop */ }
}

function isAuthExpired(value) {
  const text = String(value || '');
  return /Status[：:]\s*302/.test(text)
    || /"status"\s*:\s*302/.test(text)
    || /Status[：:]\s*401/.test(text)
    || /"status"\s*:\s*401/.test(text);
}

function cleanCliText(value) {
  return String(value || '')
    .split(/\r?\n/)
    .filter((line) => !/Assertion failed:.*UV_HANDLE_CLOSING/i.test(line))
    .join('\n')
    .trim();
}

function extractCliMessage(value) {
  const text = cleanCliText(value);
  const start = text.indexOf('{');
  if (start >= 0) {
    try {
      const parsed = JSON.parse(text.slice(start));
      if (parsed && parsed.error && parsed.error.message) return String(parsed.error.message);
      if (parsed && parsed.message) return String(parsed.message);
    } catch (error) {
      // Fall back to the cleaned text below.
    }
  }
  return text;
}

function parseJsonOutput(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return null;
  const objectStart = text.indexOf('{');
  const arrayStart = text.indexOf('[');
  let start = -1;
  if (objectStart === -1) start = arrayStart;
  else if (arrayStart === -1) start = objectStart;
  else start = Math.min(objectStart, arrayStart);
  if (start > 0) {
    const parsed = parseJsonOutput(text.slice(start));
    if (parsed) return parsed;
  }
  try {
    return JSON.parse(text.slice(start === -1 ? 0 : start));
  } catch (error) {
    throw new ZentaoError('禅道 CLI 返回了无法解析的内容。', {
      code: 'INVALID_CLI_OUTPUT',
      details: { preview: text.slice(0, 240) }
    });
  }
}

function runCli(args, options) {
  const opts = options || {};
  const resolved = resolveCommand(opts.cliPath);
  const timeoutMs = opts.timeoutMs || 120000;
  const fullArgs = [...resolved.prefix, ...args];
  return new Promise((resolve, reject) => {
    const child = spawn(resolved.command, fullArgs, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env || {}) },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn(value);
    };

    const trimOutput = (value) => {
      const text = String(value || '');
      return text.length > 20000 ? text.slice(0, 20000) + '\n…' : text;
    };

    timer = setTimeout(() => {
      terminateChild(child);
      finish(reject, new ZentaoError(`禅道 CLI 执行超时（${Math.round(timeoutMs / 1000)} 秒）。`, {
        code: 'CLI_TIMEOUT'
      }));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > 20 * 1024 * 1024) {
        terminateChild(child);
        finish(reject, new ZentaoError('禅道 CLI 返回内容过大。', { code: 'CLI_OUTPUT_TOO_LARGE' }));
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 1024 * 1024) stderr = stderr.slice(0, 1024 * 1024);
    });
    child.on('error', (error) => {
      finish(reject, new ZentaoError(`无法启动禅道 CLI：${error.message}`, {
        code: 'CLI_SPAWN_FAILED'
      }));
    });
    child.on('close', (exitCode) => {
      let parsed = null;
      let parseError = null;
      if (stdout.trim()) {
        try {
          parsed = parseJsonOutput(stdout);
        } catch (error) {
          parseError = error;
        }
      }
      if (parsed && parsed.error) {
        const error = parsed.error;
        if (isAuthExpired(error.message) || isAuthExpired(error.details && error.details.status)) {
          finish(reject, new ZentaoError(
            '禅道登录已失效（服务端返回 302 跳转到登录页）。请打开 QDesk 的「配置禅道连接」重新输入密码并保存，或运行 zentao login 重新登录。',
            { code: 'AUTH_EXPIRED', details: error.details || null, exitCode }
          ));
          return;
        }
        finish(reject, new ZentaoError(cleanCliText(error.message) || '禅道请求失败。', {
          code: error.code || 'ZENTAO_API_ERROR',
          details: error.details || null,
          exitCode
        }));
        return;
      }
      if (exitCode !== 0) {
        const stderrText = cleanCliText(stderr);
        const message = (parsed && (parsed.message || parsed.error && parsed.error.message))
          || extractCliMessage(stderrText)
          || `禅道 CLI 退出码 ${exitCode}。`;
        if (isAuthExpired(message) || isAuthExpired(stderrText)) {
          finish(reject, new ZentaoError(
            '禅道登录已失效（服务端返回 302 跳转到登录页）。请打开 QDesk 的「配置禅道连接」重新输入密码并保存，或运行 zentao login 重新登录。',
            { code: 'AUTH_EXPIRED', details: trimOutput(stderrText), exitCode }
          ));
          return;
        }
        finish(reject, new ZentaoError(cleanCliText(message), {
          code: 'CLI_EXIT_ERROR',
          details: trimOutput(stderrText),
          exitCode
        }));
        return;
      }
      if (parseError) {
        finish(reject, parseError);
        return;
      }
      finish(resolve, parsed);
    });

    if (opts.input != null) {
      child.stdin.end(String(opts.input));
    } else {
      child.stdin.end();
    }
  });
}

async function runJson(args, options) {
  return runCli(args, options);
}

function ensureArray(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

async function listPaged(baseArgs, options) {
  const opts = options || {};
  const perPage = opts.perPage || 300;
  const maxPages = opts.maxPages || 20;
  const items = [];
  let total = 0;
  for (let page = 1; page <= maxPages; page += 1) {
    const args = [...baseArgs, '--format=json', `--recPerPage=${perPage}`, `--page=${page}`];
    const payload = await runJson(args, opts);
    const rows = ensureArray(payload);
    items.push(...rows);
    total = Number(payload && payload.pager && payload.pager.total) || items.length;
    if (!rows.length || items.length >= total) break;
  }
  return { items, total: total || items.length };
}

async function getVersion(options) {
  try {
    return await runJson(['version', '--format=json'], options);
  } catch (error) {
    return { cli: 'zentao-cli', server: '' };
  }
}

async function getProduct(productId, options) {
  return runJson(['product', String(productId), '--format=json'], options);
}

async function listProducts(options) {
  return listPaged(['product', '--pick=id,name,status'], {
    ...options,
    perPage: 200,
    maxPages: 5
  });
}

async function listProjects(options) {
  return listPaged(['project', '--pick=id,name,status,PM,begin,end,type'], {
    ...options,
    perPage: 200,
    maxPages: 5
  });
}

async function listUsers(options) {
  return listPaged(['user', '--pick=id,account,realname,role,deleted'], {
    ...options,
    perPage: 500,
    maxPages: 4
  });
}

async function listExecutions(options) {
  return listPaged(['execution', '--pick=id,project,projectName,name,status,begin,end'], {
    ...options,
    perPage: 200,
    maxPages: 3
  });
}

async function listTasks(executionId, options) {
  return listPaged([
    'task',
    `--executionID=${executionId}`,
    '--pick=id,project,execution,module,name,type,pri,estimate,consumed,left,status,openedBy,openedDate,assignedTo,assignedToRealName,assignedDate,deadline,estStarted,realStarted,finishedBy,finishedDate,closedDate,lastEditedDate,desc'
  ], {
    ...options,
    perPage: 500,
    maxPages: 4
  });
}

const BUG_FIELDS = [
  'id', 'project', 'product', 'module', 'execution', 'task', 'story', 'title', 'keywords',
  'severity', 'pri', 'type', 'os', 'browser', 'hardware', 'found', 'steps', 'status',
  'confirmed', 'openedBy', 'openedDate', 'openedBuild', 'assignedTo', 'assignedDate',
  'deadline', 'resolvedBy', 'resolution', 'resolvedDate', 'closedBy', 'closedDate',
  'lastEditedDate', 'activatedCount', 'activatedDate'
].join(',');

async function listBugs(productId, options) {
  const opts = options || {};
  const args = ['bug', `--product=${productId}`];
  if (opts.browseType) args.push(`--browseType=${opts.browseType}`);
  args.push(`--pick=${BUG_FIELDS}`);
  return listPaged(args, {
    ...opts,
    perPage: opts.perPage || 300,
    maxPages: opts.maxPages || 20
  });
}

async function createBug(input, options) {
  const bug = input || {};
  const args = [
    'bug',
    'create',
    `--productID=${bug.productId}`,
    `--title=${bug.title}`,
    `--openedBuild=${bug.openedBuild || 'trunk'}`,
    `--severity=${bug.severity}`,
    `--pri=${bug.pri}`,
    `--type=${bug.type}`
  ];
  if (bug.steps) args.push(`--steps=${bug.steps}`);
  if (bug.assignedTo) args.push(`--assignedTo=${bug.assignedTo}`);
  if (bug.projectId) args.push(`--project=${bug.projectId}`);
  if (bug.executionId) args.push(`--execution=${bug.executionId}`);
  args.push('--format=json');
  return runJson(args, options);
}

async function getBug(bugId, options) {
  return runJson(['bug', String(bugId), '--format=json'], options);
}

function pushOption(args, name, value) {
  if (value == null || value === '') return;
  args.push(`--${name}=${value}`);
}

async function updateBug(bugId, input, options) {
  const bug = input || {};
  const args = ['bug', 'update', String(bugId)];
  pushOption(args, 'title', bug.title);
  pushOption(args, 'severity', bug.severity);
  pushOption(args, 'pri', bug.pri);
  pushOption(args, 'type', bug.type);
  pushOption(args, 'openedBuild', bug.openedBuild);
  pushOption(args, 'steps', bug.steps);
  if (bug.project !== undefined) pushOption(args, 'project', bug.project);
  if (bug.execution !== undefined) pushOption(args, 'execution', bug.execution);
  if (bug.story !== undefined) pushOption(args, 'story', bug.story);
  pushOption(args, 'assignedTo', bug.assignedTo);
  args.push('--format=json');
  return runJson(args, options);
}

async function bugAction(action, bugId, input, options) {
  const data = input || {};
  const args = ['bug', String(action), String(bugId)];
  if (action === 'resolve') {
    pushOption(args, 'resolution', data.resolution);
    pushOption(args, 'resolvedBuild', data.resolvedBuild);
    pushOption(args, 'assignedTo', data.assignedTo);
    pushOption(args, 'comment', data.comment);
  } else if (action === 'close') {
    pushOption(args, 'comment', data.comment);
  } else if (action === 'activate') {
    pushOption(args, 'openedBuild', data.openedBuild);
    pushOption(args, 'assignedTo', data.assignedTo);
    pushOption(args, 'comment', data.comment);
  } else if (action === 'confirm') {
    pushOption(args, 'assignedTo', data.assignedTo);
    pushOption(args, 'type', data.type);
    pushOption(args, 'pri', data.pri);
    pushOption(args, 'deadline', data.deadline);
    pushOption(args, 'comment', data.comment);
  } else if (action === 'delete') {
    args.push('--yes');
  } else {
    throw new ZentaoError('不支持的 Bug 操作。', { code: 'INVALID_ACTION' });
  }
  args.push('--format=json');
  return runJson(args, options);
}

module.exports = {
  ZentaoError,
  resolveCommand,
  parseJsonOutput,
  runCli,
  runJson,
  getVersion,
  getProduct,
  listProducts,
  listProjects,
  listUsers,
  listExecutions,
  listTasks,
  listBugs,
  createBug,
  getBug,
  updateBug,
  bugAction
};
