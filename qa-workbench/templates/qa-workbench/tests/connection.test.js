'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  normalizeUrl,
  normalizeConnection,
  maskConnection,
  credentialEnv,
  readAuth,
  writeAuth,
  sanitizeSecret
} = require('../lib/connection');

const validInput = {
  url: 'https://zentao.example.com/zentao/',
  account: 'zhangsan',
  password: 'p@ss word',
  testerName: '张三'
};

test('normalizeConnection keeps trailing separators out and does not require product IDs', () => {
  const result = normalizeConnection(validInput);
  assert.equal(result.url, 'https://zentao.example.com/zentao');
  assert.equal(result.account, 'zhangsan');
  assert.equal(result.password, 'p@ss word');
  assert.equal(result.version, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'productId'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'taskProjectIds'), false);
});

test('normalizeConnection ignores legacy product and project fields', () => {
  const result = normalizeConnection({ ...validInput, productId: '52', taskProjectIds: '47,251' });
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'productId'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'taskProjectIds'), false);
});

test('normalizeConnection keeps an existing password when the field is blank', () => {
  const existing = normalizeConnection(validInput);
  const result = normalizeConnection({ ...validInput, password: '' }, existing);
  assert.equal(result.password, 'p@ss word');
});

test('normalizeConnection rejects unsafe or incomplete input', () => {
  const cases = [
    [{ ...validInput, url: '' }, /URL/],
    [{ ...validInput, url: 'ftp://example.com' }, /http/],
    [{ ...validInput, url: 'https://user:pass@example.com' }, /账号或密码/],
    [{ ...validInput, account: 'bad account' }, /账号/],
    [{ ...validInput, password: '' }, /密码/]
  ];
  cases.forEach(([input, pattern]) => {
    assert.throws(() => normalizeConnection(input), (error) => {
      assert.equal(error.status, 400);
      assert.match(error.message, pattern);
      return true;
    });
  });
});

test('maskConnection never exposes the password', () => {
  const saved = normalizeConnection(validInput);
  const masked = maskConnection(saved, {});
  assert.equal(masked.hasPassword, true);
  assert.equal(masked.source, 'saved');
  assert.equal(Object.prototype.hasOwnProperty.call(masked, 'password'), false);
  assert.equal(JSON.stringify(masked).includes('p@ss word'), false);
});

test('credentialEnv maps saved values to ZenTao CLI variables', () => {
  const saved = normalizeConnection(validInput);
  const env = credentialEnv(saved, { ZENTAO_TOKEN: 'old-token', PATH: '/bin' });
  assert.equal(env.ZENTAO_URL, 'https://zentao.example.com/zentao');
  assert.equal(env.ZENTAO_ACCOUNT, 'zhangsan');
  assert.equal(env.ZENTAO_PASSWORD, 'p@ss word');
  assert.equal(env.ZENTAO_TOKEN, undefined);
  assert.equal(env.PATH, '/bin');
});

test('saved connection round-trips without leaking into the mask', () => {
  const dir = fs.mkdtempSync(path.join(__dirname, '.tmp-auth-'));
  const file = path.join(dir, 'zentao-auth.json');
  try {
    const saved = normalizeConnection(validInput);
    writeAuth(file, saved);
    const loaded = readAuth(file);
    assert.equal(loaded.url, saved.url);
    assert.equal(loaded.password, saved.password);
    const masked = maskConnection(loaded, {});
    assert.equal(masked.account, 'zhangsan');
    assert.equal(JSON.stringify(masked).includes('p@ss word'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sanitizeSecret replaces every password occurrence', () => {
  assert.equal(sanitizeSecret('bad p@ss word and p@ss word', 'p@ss word'), 'bad *** and ***');
  assert.equal(sanitizeSecret('plain error', ''), 'plain error');
});
