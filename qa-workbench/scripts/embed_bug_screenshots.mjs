#!/usr/bin/env node
// 把截图嵌入禅道 Bug 的「重现步骤」最前面，而不是只上传到附件列表。
// 只调用本机 zentao CLI，不读取、不打印任何账号密码或 Token。

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function usage() {
  console.log(`用法：
  node embed_bug_screenshots.mjs --bug <BugID> --image <标注图> [--image <原图>] [选项]

必填：
  --bug <id>             禅道 Bug ID
  --image <path>         截图路径，可重复传入；顺序就是正文中的显示顺序
                         建议：标注图（局部放大+红圈）在前，原图在后

可选：
  --text <text>          正文文字（不含截图）；不传则沿用 Bug 当前 steps 的文字
  --text-file <path>     从文件读取正文文字
  --host <url>           禅道地址，如 https://chandao.example.com
                         不传则从 zentao version --format=json 读取
  --dry-run              只打印将写入的 HTML，不上传、不修改 Bug
  --help                 显示帮助

说明：
  - 脚本会先上传图片，拿到 fileID，再更新 Bug 的 steps。
  - 更新后会回读 steps，确认图片链接位于最前面，否则报错退出。
  - 不会修改指派、状态、优先级等其他字段。
`);
}

function parseArgs(argv) {
  const args = { images: [], dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`${item} 缺少参数值`);
      return argv[i];
    };
    if (item === '--help' || item === '-h') args.help = true;
    else if (item === '--dry-run') args.dryRun = true;
    else if (item === '--bug') args.bug = next();
    else if (item === '--image') args.images.push(next());
    else if (item === '--text') args.text = next();
    else if (item === '--text-file') args.textFile = next();
    else if (item === '--host') args.host = next();
    else throw new Error(`未知参数：${item}`);
  }
  return args;
}

function resolveZentaoCli() {
  const candidates = [
    process.env.ZENTAO_CLI_JS,
    path.join(path.dirname(process.execPath), '..', 'npm-global', 'node_modules', 'zentao-cli', 'bin', 'zentao.js'),
    process.env.APPDATA && path.join(process.env.APPDATA, 'bee-pc-agent', 'agent-runtime', 'npm-global', 'node_modules', 'zentao-cli', 'bin', 'zentao.js'),
    process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'node_modules', 'zentao-cli', 'bin', 'zentao.js')
  ].filter(Boolean);
  return candidates.find((candidate) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch (error) {
      return false;
    }
  }) || '';
}

function runZentao(args, input) {
  const cli = resolveZentaoCli();
  const command = cli ? process.execPath : 'zentao';
  const fullArgs = cli ? [cli, ...args] : args;
  return execFileSync(command, fullArgs, {
    encoding: 'utf8',
    input,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
    shell: !cli && process.platform === 'win32'
  });
}

function parseJson(text, label) {
  try {
    return JSON.parse(String(text || '').trim());
  } catch (error) {
    throw new Error(`${label} 返回的不是有效 JSON：${String(text || '').slice(0, 300)}`);
  }
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function absoluteImageUrl(url, host) {
  const value = String(url || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  const base = String(host || '').trim().replace(/\/+$/, '');
  return base && value.startsWith('/') ? `${base}${value}` : value;
}

function imageBlock(url, alt) {
  return `<p><img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" /></p>`;
}

// 去掉正文开头已有的图片块，避免重复执行时堆叠多份截图。
function stripLeadingImages(steps) {
  let text = String(steps || '').trimStart();
  const patterns = [
    /^<p>\s*<img\b[\s\S]*?<\/p>\s*/i,
    /^<img\b[^>]*>\s*/i,
    /^!\[[^\]]*\]\([^)]*fileID=[^)]*\)\s*/i
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of patterns) {
      const next = text.replace(pattern, '');
      if (next !== text) {
        text = next.trimStart();
        changed = true;
      }
    }
  }
  return text;
}

function currentSteps(bugId) {
  const payload = parseJson(
    runZentao(['bug', String(bugId), '--pick=steps', '--format=json']),
    '查询 Bug'
  );
  return String((payload && payload.steps) || '');
}

function uploadImage(bugId, file) {
  const absolute = path.resolve(file);
  if (!fs.existsSync(absolute)) throw new Error(`截图不存在：${absolute}`);
  const payload = parseJson(
    runZentao([
      'file', 'create',
      `--file=${absolute}`,
      '--objectType=bug',
      `--objectID=${String(bugId)}`,
      '--format=json'
    ]),
    '上传截图'
  );
  const data = (payload && payload.data) || payload;
  const fileId = data && data.id;
  const url = data && data.url;
  if (!fileId || !url) throw new Error(`上传截图后没有拿到 fileID/url：${JSON.stringify(payload).slice(0, 300)}`);
  return { fileId: String(fileId), url: String(url), name: path.basename(absolute) };
}

function detectHost(explicitHost) {
  if (explicitHost) return explicitHost;
  try {
    const version = parseJson(runZentao(['version', '--format=json']), '查询禅道地址');
    return String(version && version.server || '');
  } catch (error) {
    return '';
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  if (!args.bug) throw new Error('缺少 --bug');
  if (!args.images.length) throw new Error('至少传入一张 --image');

  const host = detectHost(args.host);
  const existing = currentSteps(args.bug);
  const bodyText = args.textFile
    ? fs.readFileSync(path.resolve(args.textFile), 'utf8')
    : (args.text != null ? args.text : stripLeadingImages(existing));

  const images = args.dryRun
    ? args.images.map((file, index) => ({
      fileId: `DRY${index + 1}`,
      url: `https://<禅道域名>/zentao/index.php?m=file&f=read&t=png&fileID=DRY${index + 1}`,
      name: path.basename(file)
    }))
    : args.images.map((file) => uploadImage(args.bug, file));

  const blocks = images
    .map((image, index) => imageBlock(
      absoluteImageUrl(image.url, host),
      args.images.length > 1 ? `截图 ${index + 1}：${image.name}` : image.name
    ))
    .join('\n');
  const steps = `${blocks}\n\n${String(bodyText || '').trim()}\n`;

  if (args.dryRun) {
    console.log(steps);
    console.log(`\n[dry-run] 未上传、未修改 Bug ${args.bug}`);
    return;
  }

  runZentao(
    ['bug', 'update', String(args.bug), '--data=@-', '--format=json'],
    JSON.stringify({ steps })
  );

  const verify = currentSteps(args.bug).trimStart();
  if (!/^(<p>\s*<img\b|<img\b|!\[[^\]]*\]\()/i.test(verify)) {
    throw new Error('图片没有出现在 steps 最前面，请检查禅道是否改写了正文格式。');
  }

  console.log(JSON.stringify({
    ok: true,
    bug: String(args.bug),
    images: images.map((image) => ({ fileId: image.fileId, name: image.name })),
    stepsHead: verify.slice(0, 200)
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(`失败：${error.message}`);
  process.exitCode = 1;
}
