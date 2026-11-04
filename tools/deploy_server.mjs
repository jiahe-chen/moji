#!/usr/bin/env node
// 一键把 AI 代理部署到阿里云函数计算：打包 → 上传代码 → 等部署完成 → 核对线上版本。
// 只换代码，环境变量（DEEPSEEK_API_KEY 等）和触发器都不动；部署前后会核对环境变量一个不少。
//
// 先装好阿里云 CLI，登录一次：aliyun configure --mode OAuth
// 用法（在仓库根目录）：npm run deploy
//   --dry-run         只打包，打印要发的请求，不真的部署
// 可选环境变量：FC_FUNCTION（默认 noji-ai）、FC_REGION（默认 cn-hangzhou）、ALIYUN_PROFILE（CLI 的配置名）、
//   FC_HEALTH_URL（默认由 src/config.js 的 ONLINE 推出）
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const FN = process.env.FC_FUNCTION || 'noji-ai';
const REGION = process.env.FC_REGION || 'cn-hangzhou';
const PROFILE = process.env.ALIYUN_PROFILE ? ['--profile', process.env.ALIYUN_PROFILE] : [];
const DRY = process.argv.includes('--dry-run');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const die = msg => { console.error(`\n部署失败：${msg}`); process.exit(1); };

// 线上地址取自网页的配置，把 /api/suggest 换成 /api/health
const online = readFileSync(`${ROOT}src/config.js`, 'utf8').match(/ONLINE = '([^']+)'/)?.[1];
if (!online) die('没在 src/config.js 里找到 ONLINE 地址');
const HEALTH = process.env.FC_HEALTH_URL || online.replace(/\/api\/suggest$/, '/api/health');

// GetFunction 的返回里有环境变量的值（含 DeepSeek Key），所以每次调用都用 --cli-query 只取需要的字段
const STATUS = '{state: state, update: lastUpdateStatus, reason: lastUpdateStatusReason, env: keys(environmentVariables || `{}`)}';
function aliyun(args, query) {
  try {
    const out = execFileSync('aliyun', ['fc', ...args, '--region', REGION, ...PROFILE, ...(query ? ['--cli-query', query] : [])],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 24 });
    return DRY ? out : JSON.parse(out || 'null');
  } catch (e) {
    if (e.code === 'ENOENT') die('没找到阿里云 CLI。安装方法见 README「部署」一节，装好后运行 aliyun configure --mode OAuth 登录');
    const msg = `${e.stderr || ''}${e.stdout || ''}`.trim() || e.message;
    if (/credential|AccessKey|profile|configure/i.test(msg)) die(`阿里云 CLI 还没登录，先运行 aliyun configure --mode OAuth\n${msg}`);
    die(msg);
  }
}
const getStatus = () => aliyun(['GetFunction', '--functionName', FN], STATUS);

// 1. 打包
const packed = execFileSync('python3', [`${ROOT}tools/pack_server.py`], { encoding: 'utf8' });
const version = packed.match(/版本 (\w+)/)?.[1];
if (!version) die(`打包输出里没有版本号：${packed}`);
const zip = readFileSync(`${ROOT}dist/moji-ai-server.zip`).toString('base64');
if (zip.length > 100e3) die('代码包太大，命令行放不下，需要改成先传到 OSS');
console.log(`打包好了：版本 ${version}，${Math.round(zip.length * .75 / 1024)} KB`);

const body = JSON.stringify({ code: { zipFile: zip } });
if (DRY) {
  console.log(aliyun(['UpdateFunction', '--functionName', FN, '--body', body, '--cli-dry-run']).replace(/[A-Za-z0-9+/=]{200,}/g, '<代码包 base64>'));
  process.exit(0);
}

// 2. 上传前记下环境变量有哪些（只看名字）
const before = getStatus();
if (!before) die(`没找到函数 ${FN}（地域 ${REGION}）`);
console.log(`函数 ${FN}：${before.state}，环境变量 ${before.env.join('、') || '（无）'}`);

// 3. 只更新 code 字段，其他配置保持原样
aliyun(['UpdateFunction', '--functionName', FN, '--body', body], 'lastUpdateStatus');
process.stdout.write('已上传，等待部署');
let now = before;
for (let t = 0; t < 40; t++) {
  await sleep(3000);
  now = getStatus();
  if (now.update === 'Failed') die(`函数计算报告更新失败：${now.reason || '没有给出原因'}`);
  if (now.update === 'Successful' && now.state === 'Active') break;
  process.stdout.write('.');
}
console.log(` ${now.update}`);
if (now.update !== 'Successful') die('两分钟内没部署完，去控制台看看函数状态');
const lost = before.env.filter(k => !now.env.includes(k));
if (lost.length) die(`环境变量少了 ${lost.join('、')}，去控制台「配置 → 环境变量」补上`);

// 4. 线上 /api/health 返回新版本号才算部署完成（旧实例回收需要一点时间）
process.stdout.write(`核对线上版本 ${HEALTH}`);
for (let t = 0; t < 30; t++) {
  const live = await fetch(HEALTH).then(r => r.json()).catch(() => null);
  if (live?.version === version) { console.log(`\n部署完成：线上已是版本 ${version}，今天已用 ${live.today}/${live.limit} 次`); process.exit(0); }
  process.stdout.write('.');
  await sleep(3000);
}
die('代码已经更新，但 90 秒内线上还没返回新版本号，稍后用 curl 看一下 /api/health');
