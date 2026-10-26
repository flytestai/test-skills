#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(scriptDir, '..');
const templateDir = path.join(skillDir, 'templates', 'qa-workbench');

function usage() {
  console.log(`Usage: node install_workbench.mjs [options]

Options:
  --target <dir>     Install directory (default: ./qa-workbench)
  --account <name>   ZenTao login account
  --name <name>      Display name (default: account)
  --port <number>    Local port (default: 4173)
  --cli-path <file>  Explicit path to zentao-cli/bin/zentao.js
  --force            Overwrite existing application files (keeps data/)
  --help             Show this help

The installed workbench has no runtime dependencies. It reuses the local
zentao CLI profile, or the URL/account/password saved in its settings page.`);
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

const options = {
  target: 'qa-workbench',
  account: '',
  name: '',
  port: 4173,
  cliPath: '',
  force: false
};

for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg === '--help' || arg === '-h') {
    usage();
    process.exit(0);
  }
  if (arg === '--force') {
    options.force = true;
    continue;
  }
  const value = process.argv[i + 1];
  if (!value || value.startsWith('--')) fail(`${arg} requires a value`);
  if (arg === '--target') options.target = value;
  else if (arg === '--account') options.account = value.trim();
  else if (arg === '--name') options.name = value.trim();
  else if (arg === '--port') options.port = Number(value);
  else if (arg === '--cli-path') options.cliPath = value;
  else fail(`unknown option: ${arg}`);
  i += 1;
}

if (!fs.existsSync(templateDir)) fail(`template directory not found: ${templateDir}`);
if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
  fail('--port must be an integer between 1 and 65535');
}
if (options.account && !/^[A-Za-z0-9_.@-]{1,64}$/.test(options.account)) {
  fail('--account contains unsupported characters');
}
if (options.cliPath) {
  const resolvedCli = path.resolve(process.cwd(), options.cliPath);
  if (!fs.existsSync(resolvedCli) || !fs.statSync(resolvedCli).isFile()) {
    fail(`--cli-path is not a file: ${resolvedCli}`);
  }
  options.cliPath = resolvedCli.split(path.sep).join('/');
}

const targetDir = path.resolve(process.cwd(), options.target);
if (fs.existsSync(targetDir)) {
  const entries = fs.readdirSync(targetDir).filter((name) => name !== '.git');
  if (entries.length && !options.force) {
    fail(`target directory is not empty: ${targetDir} (use --force to overwrite application files)`);
  }
}

fs.mkdirSync(targetDir, { recursive: true });

for (const entry of fs.readdirSync(templateDir)) {
  if (entry === 'data') continue;
  fs.cpSync(path.join(templateDir, entry), path.join(targetDir, entry), {
    recursive: true,
    force: true
  });
}

const dataDir = path.join(targetDir, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const keepFile = path.join(dataDir, '.gitkeep');
if (!fs.existsSync(keepFile)) fs.writeFileSync(keepFile, '');

const configPath = path.join(targetDir, 'config.json');
let effectivePort = options.port;
let effectiveAccount = options.account;
let effectiveName = options.name;
if (!fs.existsSync(configPath)) {
  const examplePath = path.join(targetDir, 'config.example.json');
  const config = JSON.parse(fs.readFileSync(examplePath, 'utf8'));
  config.server = config.server || {};
  config.server.host = '127.0.0.1';
  config.server.port = options.port;
  config.tester = config.tester || {};
  config.tester.account = options.account;
  config.tester.name = options.name || options.account;
  if (options.cliPath) {
    config.zentao = config.zentao || {};
    config.zentao.cliPath = options.cliPath;
  }
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  effectivePort = Number(config.server.port) || options.port;
  effectiveAccount = config.tester.account;
  effectiveName = config.tester.name;
} else {
  try {
    const existing = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    effectivePort = Number(existing.server && existing.server.port) || options.port;
    effectiveAccount = (existing.tester && existing.tester.account) || options.account;
    effectiveName = (existing.tester && existing.tester.name) || options.name;
    if (options.cliPath) {
      existing.zentao = existing.zentao || {};
      existing.zentao.cliPath = options.cliPath;
      fs.writeFileSync(configPath, `${JSON.stringify(existing, null, 2)}\n`);
    }
  } catch {
    // Keep the requested port if an existing config cannot be parsed.
  }
  console.log(`Kept existing config: ${configPath}`);
}

const launcherPath = path.join(targetDir, 'start-hidden.vbs');
if (fs.existsSync(launcherPath)) {
  const launcher = fs.readFileSync(launcherPath, 'utf8');
  const patched = launcher.replace(
    /healthUrl\s*=\s*"http:\/\/127\.0\.0\.1:\d+\/api\/health"/,
    `healthUrl = "http://127.0.0.1:${effectivePort}/api/health"`
  );
  fs.writeFileSync(launcherPath, patched);
}

const display = effectiveName || effectiveAccount || '（在连接设置中填写）';
console.log('');
console.log('QDesk workbench installed');
console.log(`  location : ${targetDir}`);
console.log(`  port     : ${effectivePort}`);
console.log(`  account  : ${display}`);
if (options.cliPath) console.log(`  cli      : ${options.cliPath}`);
console.log('');
console.log('Next steps:');
console.log(`  1. cd "${targetDir}"`);
console.log('  2. npm start');
console.log(`  3. open http://127.0.0.1:${effectivePort}`);
console.log('  4. Configure ZenTao URL/account/password in the settings page.');
console.log('     Product and project IDs are NOT required; they are discovered automatically.');
console.log('');
console.log('Optional Windows auto-start:');
console.log('  powershell -ExecutionPolicy Bypass -File .\\install-autostart.ps1');
