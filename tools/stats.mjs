#!/usr/bin/env node
// 访问报表：从阿里云日志服务读 AI 代理的日志，按天统计网页打开、访客、下载、分享和 AI 调用。
// 日志是 server/server.mjs 打的 JSON 行（t 字段区分：hit 是网页计数，ai 是 AI 调用），里面没有 IP 和用户写的内容。
//
// 前提：函数开了日志（控制台「配置 → 日志」），阿里云 CLI 已登录。
// 用法（在仓库根目录）：npm run stats [-- --days 7]
// 可选环境变量：FC_FUNCTION（默认 noji-ai）、FC_REGION（默认 cn-hangzhou）、ALIYUN_PROFILE
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const FN = process.env.FC_FUNCTION || 'noji-ai';
const REGION = process.env.FC_REGION || 'cn-hangzhou';
const PROFILE = process.env.ALIYUN_PROFILE ? ['--profile', process.env.ALIYUN_PROFILE] : [];
const i = process.argv.indexOf('--days'), DAYS = i > 0 ? +process.argv[i + 1] || 7 : 7;
const die = msg => { console.error(msg); process.exit(1); };

async function aliyun(args) {
  for (let attempt = 1; ; attempt++) {   // 接口偶尔 connection reset，重试两次
    try { return JSON.parse((await run('aliyun', [...args, '--region', REGION, ...PROFILE], { maxBuffer: 1 << 26 })).stdout || 'null'); }
    catch (e) {
      const msg = `${e.stderr || ''}${e.stdout || ''}`.trim() || e.message;
      if (/connection reset|timeout|EOF/i.test(msg) && attempt < 3) continue;
      die(e.code === 'ENOENT' ? '没找到阿里云 CLI，见 README「部署」一节' : msg);
    }
  }
}

const log = await aliyun(['fc', 'GetFunction', '--functionName', FN, '--cli-query', 'logConfig']);
if (!log?.project || !log?.logstore) die(`函数 ${FN} 还没开日志：去函数计算控制台「配置 → 日志」启用，之后的访问才会被记下来`);

// 一页一页取原始日志，本地汇总；量大了再换成 SQL 分析
const to = Math.floor(Date.now() / 1000), from = to - DAYS * 86400, lines = [];
for (let offset = 0; ; offset += 100) {
  const page = await aliyun(['sls', 'GetLogsV2', '--project', log.project, '--logstore', log.logstore, '--header', 'Accept-Encoding=identity',
    '--body', JSON.stringify({ from, to, query: 't', line: 100, offset, reverse: false })]);
  const rows = Array.isArray(page) ? page : page?.data || [];
  lines.push(...rows);
  if (rows.length < 100) break;
}

const day = ts => new Date((+ts + 8 * 3600) * 1000).toISOString().slice(5, 10);   // 北京时间
const days = new Map(), get = d => days.get(d) || days.set(d, { open: 0, visitors: 0, link: 0, market: 0, wx: 0, mobile: 0, png: 0, pdf: 0, share: 0, ai: 0, aiLimited: 0, aiFailed: 0, refs: {} }).get(d);
for (const row of lines) {
  let r; try { r = JSON.parse(row.message ?? row.content ?? ''); } catch { continue; }
  const s = get(day(row.__time__));
  if (r.t === 'hit') {
    if (r.e === 'open') {
      s.open++; if (r.n) s.visitors++; if (r.k === 'link') s.link++; if (r.k === 'market') s.market++;
      if (r.wx) s.wx++; if (r.m) s.mobile++; if (r.ref) s.refs[r.ref] = (s.refs[r.ref] || 0) + 1;
    } else if (r.e in s) s[r.e]++;
  } else if (r.t === 'ai') {
    if (r.status === 200) s.ai++; else if (r.status === 429) s.aiLimited++; else s.aiFailed++;
  }
}

if (!days.size) { console.log(`最近 ${DAYS} 天没有访问记录`); process.exit(0); }
const cols = [['open', '打开'], ['visitors', '访客'], ['link', '分享链接'], ['market', '集市'], ['wx', '微信'], ['mobile', '手机'], ['png', '下图片'], ['pdf', '下PDF'], ['share', '分享'], ['ai', 'AI'], ['aiLimited', '限频'], ['aiFailed', 'AI失败']];
const total = Object.fromEntries(cols.map(([k]) => [k, 0]));
console.log(`最近 ${DAYS} 天（北京时间）。访客按“这个浏览器当天第一次来”估算，不是精确人数\n`);
console.log(['日期 ', ...cols.map(c => c[1])].join('\t'));
for (const [d, s] of [...days].sort()) {
  console.log([d, ...cols.map(([k]) => s[k])].join('\t'));
  for (const [k] of cols) total[k] += s[k];
}
console.log(['合计 ', ...cols.map(([k]) => total[k])].join('\t'));
const refs = {};
for (const s of days.values()) for (const [h, n] of Object.entries(s.refs)) refs[h] = (refs[h] || 0) + n;
const top = Object.entries(refs).sort((a, b) => b[1] - a[1]).slice(0, 8);
if (top.length) console.log('\n从哪些网站点进来：' + top.map(([h, n]) => `${h} ${n}`).join('，'));
