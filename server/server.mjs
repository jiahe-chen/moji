#!/usr/bin/env node
// moji 的 AI 代理：网页把“想送给谁、什么场合”发过来，这里用站长的 DeepSeek Key 跑选句助手。
// 零依赖，Node 20 以上直接运行；阿里云函数计算（Web 函数）、腾讯云、任意云主机都能部署。
//
// 环境变量：
//   DEEPSEEK_API_KEY   必填，站长的 DeepSeek Key，只放在服务器上
//   PORT               监听端口，默认 8787（阿里云 Web 函数用 9000）
//   ALLOWED_ORIGINS    额外允许调用的网页来源，逗号分隔，默认 http://localhost:8080；
//                      正式站点的来源写在下面的 SITE_ORIGINS 里，换域名改代码、npm run deploy 就行，不用动环境变量
//   PER_IP_PER_HOUR    每个 IP 每小时最多几次，默认 10
//   DAILY_LIMIT        全站每天最多几次，默认 300（防止费用失控；DeepSeek 后台也建议设消费上限）
//   HIT_DAILY_LIMIT    每天最多记多少条匿名计数，默认 20000
//
// 接口：POST /api/suggest（AI 选句）、POST /api/hit（匿名计数）、GET /api/health。
// 每次 AI 调用和计数各打一行 JSON 日志（t 字段区分），函数开了日志服务就能用 tools/stats.mjs 出报表。
// 日志里不记 IP、不记用户写的内容。
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { suggest } from './agent.mjs';

// 打包时写入的代码版本（tools/pack_server.py），部署脚本靠它确认线上已经换成新代码
const VERSION = (() => { try { return readFileSync(new URL('./version.txt', import.meta.url), 'utf8').trim(); } catch { return 'dev'; } })();

const KEY = process.env.DEEPSEEK_API_KEY;
if (!KEY) { console.error('缺少环境变量 DEEPSEEK_API_KEY'); process.exit(1); }
const PORT = +(process.env.PORT || 8787);
const SITE_ORIGINS = ['https://mojishufa.com', 'https://www.mojishufa.com', 'https://jiahe-chen.github.io'];
const ORIGINS = [...new Set([...SITE_ORIGINS, ...(process.env.ALLOWED_ORIGINS ?? 'http://localhost:8080').split(',').map(s => s.trim()).filter(Boolean)])];
const PER_IP = +(process.env.PER_IP_PER_HOUR || 10);
const DAILY = +(process.env.DAILY_LIMIT || 300);

// 限流计数放在内存里：单实例够用；多实例时每个实例各自计数，总量以 DeepSeek 后台的消费上限兜底
const hits = new Map();
let day = '', dayCount = 0;
function allow(ip) {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) { day = today; dayCount = 0; hits.clear(); }
  if (dayCount >= DAILY) return '今天的 AI 选句次数已经用完了，明天再来';
  const now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < 3600e3);
  if (list.length >= PER_IP) return '用得太频繁了，过一会儿再试';
  list.push(now); hits.set(ip, list); dayCount++;
  return null;
}

// 匿名计数：网页打开、下载、从灵感集市做同款。只收认识的事件和几个是/否标记
const EVENTS = ['open', 'png', 'pdf', 'remix'];
const HIT_DAILY = +(process.env.HIT_DAILY_LIMIT || 20000);   // 每个实例每天最多记这么多条，防止被刷出日志费用
const hitTimes = new Map();
let hitDay = '', hitCount = 0;
function countHit(ip, raw) {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== hitDay) { hitDay = today; hitCount = 0; hitTimes.clear(); }
  if (hitCount >= HIT_DAILY) return;
  const now = Date.now(), list = (hitTimes.get(ip) || []).filter(t => now - t < 3600e3);
  if (list.length >= 200) return;   // 刷计数的直接丢掉
  list.push(now); hitTimes.set(ip, list); hitCount++;
  if (hitTimes.size > 5000) hitTimes.clear();
  let b; try { b = JSON.parse(raw); } catch { return; }
  if (!EVENTS.includes(b.e)) return;
  const ref = typeof b.ref === 'string' && /^[a-z0-9.-]{1,60}$/.test(b.ref) ? b.ref : '';
  console.log(JSON.stringify({ t: 'hit', e: b.e, wx: !!b.wx, m: !!b.m, n: !!b.n, ref }));
}

function send(res, status, body, origin) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    ...(origin ? { 'access-control-allow-origin': origin, vary: 'origin' } : {}),
  });
  res.end(JSON.stringify(body));
}

http.createServer(async (req, res) => {
  const origin = ORIGINS.includes(req.headers.origin) ? req.headers.origin : null;
  if (req.method === 'OPTIONS') {
    res.writeHead(origin ? 204 : 403, origin ? {
      'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST',
      'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400', vary: 'origin',
    } : {});
    return res.end();
  }
  if (req.method === 'GET' && req.url === '/api/health') return send(res, 200, { ok: true, version: VERSION, today: dayCount, limit: DAILY }, origin);
  if (req.method !== 'POST' || !['/api/suggest', '/api/hit'].includes(req.url)) return send(res, 404, { error: '没有这个接口' }, origin);
  if (!origin) return send(res, 403, { error: '不允许的来源' }, null);

  // X-Forwarded-For 前面几段是客户端自己能填的，最后一段才是阿里云网关看到的真实来源，限流只认它
  const ip = (req.headers['x-forwarded-for'] || '').split(',').pop().trim() || req.socket.remoteAddress;
  if (req.url === '/api/hit') {   // 网页用 sendBeacon 发，不等回应
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 500) break; }
    if (raw.length <= 500) countHit(ip, raw);
    res.writeHead(204, { 'access-control-allow-origin': origin, vary: 'origin' });
    return res.end();
  }
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 4000) return send(res, 413, { error: '内容太长' }, origin); }
  let request, current;
  try { const body = JSON.parse(raw); request = String(body.request || '').trim(); current = body.current; } catch { return send(res, 400, { error: '请求格式不对' }, origin); }
  if (!request) return send(res, 400, { error: '先说一句想写什么、送给谁' }, origin);
  if ([...request].length > 200) return send(res, 400, { error: '描述请控制在 200 字以内' }, origin);
  const blocked = allow(ip);
  if (blocked) { console.log(JSON.stringify({ t: 'ai', status: 429 })); return send(res, 429, { error: blocked }, origin); }

  const t0 = Date.now();
  try {
    const out = await suggest({ apiKey: KEY, request, current });
    // 只记改了哪些字段、给了几条候选，不记用户说的话和写的内容
    console.log(JSON.stringify({ t: 'ai', status: 200, ms: Date.now() - t0, searches: out.searches.length, suggestions: out.suggestions.length, set: Object.keys(out.set), usage: out.usage }));
    send(res, 200, { reply: out.reply, set: out.set, suggestions: out.suggestions, searches: out.searches }, origin);
  } catch (e) {
    console.error(e);
    console.log(JSON.stringify({ t: 'ai', status: 502, ms: Date.now() - t0 }));
    send(res, 502, { error: 'AI 暂时没有回应，稍后再试' }, origin);
  }
}).listen(PORT, '0.0.0.0', () => console.log(`moji AI 代理已启动：http://localhost:${PORT}/api/suggest`));   // 云函数要求监听 0.0.0.0
