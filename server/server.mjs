#!/usr/bin/env node
// moji 的 AI 代理：网页把“想送给谁、什么场合”发过来，这里用站长的 DeepSeek Key 跑选句助手。
// 零依赖，Node 20 以上直接运行；阿里云函数计算（Web 函数）、腾讯云、任意云主机都能部署。
//
// 环境变量：
//   DEEPSEEK_API_KEY   必填，站长的 DeepSeek Key，只放在服务器上
//   PORT               监听端口，默认 8787（阿里云 Web 函数用 9000）
//   ALLOWED_ORIGINS    允许调用的网页来源，逗号分隔，默认 https://jiahe-chen.github.io,http://localhost:8080
//   PER_IP_PER_HOUR    每个 IP 每小时最多几次，默认 10
//   DAILY_LIMIT        全站每天最多几次，默认 300（防止费用失控；DeepSeek 后台也建议设消费上限）
import http from 'node:http';
import { suggest } from './agent.mjs';

const KEY = process.env.DEEPSEEK_API_KEY;
if (!KEY) { console.error('缺少环境变量 DEEPSEEK_API_KEY'); process.exit(1); }
const PORT = +(process.env.PORT || 8787);
const ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://jiahe-chen.github.io,http://localhost:8080').split(',').map(s => s.trim());
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
  if (req.method === 'GET' && req.url === '/api/health') return send(res, 200, { ok: true, today: dayCount, limit: DAILY }, origin);
  if (req.method !== 'POST' || req.url !== '/api/suggest') return send(res, 404, { error: '没有这个接口' }, origin);
  if (!origin) return send(res, 403, { error: '不允许的来源' }, null);

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 4000) return send(res, 413, { error: '内容太长' }, origin); }
  let request;
  try { request = String(JSON.parse(raw).request || '').trim(); } catch { return send(res, 400, { error: '请求格式不对' }, origin); }
  if (!request) return send(res, 400, { error: '先说说想送给谁、什么场合' }, origin);
  if ([...request].length > 200) return send(res, 400, { error: '描述请控制在 200 字以内' }, origin);
  const blocked = allow(ip);
  if (blocked) return send(res, 429, { error: blocked }, origin);

  const t0 = Date.now();
  try {
    const out = await suggest({ apiKey: KEY, request });
    console.log(JSON.stringify({ at: new Date().toISOString(), ms: Date.now() - t0, searches: out.searches.length, usage: out.usage }));
    send(res, 200, { suggestions: out.suggestions, searches: out.searches }, origin);
  } catch (e) {
    console.error(e);
    send(res, 502, { error: 'AI 暂时没有回应，稍后再试' }, origin);
  }
}).listen(PORT, () => console.log(`moji AI 代理已启动：http://localhost:${PORT}/api/suggest`));
