'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_PASSWORD_LENGTH = 512;

function fail(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function normalizeUrl(value, options) {
  const opts = options || {};
  const raw = String(value == null ? '' : value).trim();
  if (!raw) {
    if (opts.required === false) return '';
    throw fail('请填写禅道 URL，例如 https://zentao.example.com。');
  }
  if (raw.length > 500) throw fail('禅道 URL 过长。');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (error) {
    throw fail('禅道 URL 格式无效，请填写完整的 http:// 或 https:// 地址。');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw fail('禅道 URL 只支持 http:// 或 https://。');
  }
  if (parsed.username || parsed.password) {
    throw fail('请不要把账号或密码写在 URL 中。');
  }
  const pathname = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.origin}${pathname === '/' ? '' : pathname}`;
}

function normalizeAccount(value) {
  const account = String(value == null ? '' : value).trim();
  if (!account) throw fail('请填写禅道登录账号。');
  if (account.length > 64 || /[\s<>"']/.test(account)) {
    throw fail('禅道账号格式无效。');
  }
  return account;
}

function normalizeProductId(value) {
  const productId = String(value == null ? '' : value).trim();
  if (!/^\d{1,12}$/.test(productId)) throw fail('请填写数字形式的禅道产品 ID。');
  return productId;
}

function normalizeProjectIds(value) {
  const list = Array.isArray(value)
    ? value
    : String(value == null ? '' : value).split(',');
  const ids = [];
  list.forEach((item) => {
    const id = String(item == null ? '' : item).trim();
    if (!id) return;
    if (!/^\d{1,12}$/.test(id)) throw fail('任务项目 ID 只能使用数字，多个项目用逗号分隔。');
    if (!ids.includes(id)) ids.push(id);
  });
  if (ids.length > 30) throw fail('任务项目最多配置 30 个。');
  return ids;
}

function normalizeText(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength || 50);
}

function normalizeConnection(raw, existing) {
  const input = raw || {};
  const base = existing || {};
  const url = normalizeUrl(
    input.url !== undefined ? input.url : base.url,
    { required: true }
  );
  const account = normalizeAccount(
    input.account !== undefined ? input.account : base.account
  );
  const rawPassword = input.password !== undefined ? String(input.password) : '';
  const password = rawPassword ? rawPassword : String(base.password || '');
  if (!password.trim()) throw fail('请填写禅道密码。');
  if (password.length > MAX_PASSWORD_LENGTH) throw fail('禅道密码过长。');
  const testerName = normalizeText(
    input.testerName !== undefined ? input.testerName : base.testerName,
    50
  );
  return {
    version: 2,
    url,
    account,
    password,
    testerName,
    updatedAt: new Date().toISOString()
  };
}

function maskConnection(auth, fallback) {
  const saved = auth || null;
  const base = fallback || {};
  return {
    url: (saved && saved.url) || base.url || '',
    account: (saved && saved.account) || base.account || '',
    hasPassword: Boolean(saved && (saved.password || saved.token)),
    source: saved ? 'saved' : 'profile',
    testerName: (saved && saved.testerName) || base.testerName || '',
    updatedAt: saved && saved.updatedAt ? saved.updatedAt : null
  };
}

function credentialEnv(auth, baseEnv) {
  const env = { ...(baseEnv || {}) };
  if (!auth) return env;
  if (auth.url) env.ZENTAO_URL = auth.url;
  if (auth.account) env.ZENTAO_ACCOUNT = auth.account;
  if (auth.token) {
    env.ZENTAO_TOKEN = auth.token;
    delete env.ZENTAO_PASSWORD;
  } else if (auth.password) {
    env.ZENTAO_PASSWORD = auth.password;
    delete env.ZENTAO_TOKEN;
  }
  return env;
}

function readAuth(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    const url = normalizeUrl(parsed.url);
    const account = normalizeAccount(parsed.account);
    const password = String(parsed.password || '');
    if (!password) return null;
    return {
      version: 2,
      url,
      account,
      password,
      testerName: normalizeText(parsed.testerName, 50),
      updatedAt: parsed.updatedAt || null
    };
  } catch (error) {
    return null;
  }
}

function writeAuth(filePath, auth) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(auth, null, 2), { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(tmp, 0o600); } catch (error) { /* Windows may ignore POSIX modes. */ }
  fs.renameSync(tmp, filePath);
  try { fs.chmodSync(filePath, 0o600); } catch (error) { /* noop */ }
  return auth;
}

function removeAuth(filePath) {
  try { fs.unlinkSync(filePath); } catch (error) { /* already absent */ }
}

function sanitizeSecret(message, secret) {
  const text = String(message == null ? '' : message);
  if (!secret) return text;
  return text.split(String(secret)).join('***');
}

module.exports = {
  normalizeUrl,
  normalizeAccount,
  normalizeProductId,
  normalizeProjectIds,
  normalizeConnection,
  maskConnection,
  credentialEnv,
  readAuth,
  writeAuth,
  removeAuth,
  sanitizeSecret
};
