// 排版：把用户填的正文、落款、印章，按版式自动排成 engine.js 需要的方案。
// 坐标都是“逻辑像素”，画布实际尺寸 = 逻辑尺寸 × 分辨率倍数 K。
import S2T from './s2t.js';

export const FORMATS = {
  tiaofu: { label: '条幅', w: 800, h: 1400 },
  doufang: { label: '斗方', w: 1000, h: 1000 },
  hengpi: { label: '横披', w: 1500, h: 850 },
};

const HAN = /\p{Script=Han}/u;
export const hanOnly = s => [...(s || '')].filter(c => HAN.test(c));
// 篆字字体以繁体为键，“陈”要写成“陳”
export const toTrad = chars => chars.map(c => S2T[c] || c);

// 正文分行的候选：用户手动换行就照办；否则试“一句一行”和各种等长断行
function candidates(text) {
  const raw = (text || '').trim();
  if (raw.includes('\n')) return [{ lines: raw.split(/\n+/).map(hanOnly).filter(l => l.length), forced: true }];
  const all = hanOnly(raw), out = [];
  const clauses = raw.split(/[^\p{Script=Han}]+/u).map(hanOnly).filter(l => l.length);
  if (clauses.length > 1) out.push({ lines: clauses, natural: true });
  for (let r = 1; r <= all.length; r++) {
    const lines = [];
    for (let i = 0; i < all.length; i += r) lines.push(all.slice(i, i + r));
    out.push({ lines });
  }
  return out;
}

const inscSize = s => Math.min(58, Math.max(30, s * .26));

// 落款：上款“录××　书赠××”，下款“丙午秋　署名”；一列写不下就续到下一列
function inscLines({ src, to, date, from }) {
  const first = [src && `录${src}`, to && `书赠${to}`].filter(Boolean).join('　');
  const second = [date, from].filter(Boolean).join('　');
  return [first, second].filter(Boolean);
}

function splitColumn(text, maxLen) {
  const cols = []; let cur = '', len = 0;
  for (const ch of text) {
    const l = ch === '　' ? .5 : 1;
    if (len + l > maxLen && cur) { cols.push(cur.replace(/^　+|　+$/g, '')); cur = ''; len = 0; if (ch === '　') continue; }
    cur += ch; len += l;
  }
  if (cur.trim()) cols.push(cur.replace(/^　+|　+$/g, ''));
  return cols;
}

// 名章：三字名加“印”，两字名加“之印”，凑成四字方印
function sealChars(name) {
  const n = toTrad(hanOnly(name)).slice(0, 4);
  if (n.length === 3) return [...n, '印'];
  if (n.length === 2) return [...n, '之', '印'];
  if (n.length === 1) return [n[0], '印'];
  return n;
}

/**
 * @param input {text, src, to, from, date, lead, format, wild}
 *   wild：放纵度 0~1，越大字越欹侧、大小反差越大
 */
export function layout(input) {
  const F = FORMATS[input.format] || FORMATS.tiaofu, W = F.w, H = F.h;
  const wild = Math.min(1, Math.max(0, input.wild ?? .5));
  const lead = toTrad(hanOnly(input.lead)).slice(0, 2);
  const lines = inscLines(input);
  const inscLen = lines.reduce((a, l) => a + [...l].length, 0);
  const top = H * .085, bot = H * .075, availH = H - top - bot;

  // 在所有断行方案里挑字最大的；“一句一行”只要不比最大的小太多就优先，读起来更自然
  const fit = c => {
    const n = c.lines.length, len = Math.max(...c.lines.map(l => l.length));
    const sH = availH / (len * 1.1);
    let s = sH;
    for (let k = 0; k < 3; k++) {   // 右边距要给引首章留位置，和字号互相依赖，迭代几次即收敛
      const i = inscSize(s), rightM = lead.length ? s * .32 + W * .03 : W * .06, leftM = W * .05;
      const inscCols = inscLen ? Math.max(lines.length, Math.ceil(inscLen * i * 1.04 / (availH * .8))) : 0;
      const inscW = inscCols ? inscCols * i * 1.35 + s * .3 : 0;
      s = Math.min(sH, (W - rightM - leftM - inscW) / (n * 1.16));
    }
    return s;
  };
  const cands = candidates(input.text).filter(c => c.lines.length);
  if (!cands.length) return null;
  let best = cands[0], bestS = fit(best);
  for (const c of cands.slice(1)) { const s = fit(c); if (s > bestS) { best = c; bestS = s; } }
  const nat = cands.find(c => c.natural || c.forced);
  if (nat && nat !== best && fit(nat) >= bestS * .8) { best = nat; bestS = fit(nat); }
  // 横披字少时按习惯排成一行，每列一个字
  const row = F === FORMATS.hengpi && cands.find(c => !c.forced && c.lines.every(l => l.length === 1));
  if (row && row !== best && fit(row) >= bestS * .6) { best = row; bestS = fit(row); }

  const s = bestS, n = best.lines.length, pitch = s * 1.16, i = inscSize(s);
  const rightM = lead.length ? s * .32 + W * .03 : W * .06, leftM = W * .05;

  // 落款各列：从正文左侧往左排；最后一列下面钤名章
  const sealSize = i * 1.45, inscTop = top + s * .5;
  const maxLen = Math.max(4, Math.floor((H - bot - inscTop - sealSize - i * .5) / (i * 1.04)));
  const inscCols = lines.flatMap((l, k) => splitColumn(l, k === lines.length - 1 ? maxLen : (H - bot - inscTop) / (i * 1.04)));
  const inscW = inscCols.length ? inscCols.length * i * 1.35 + s * .3 : 0;
  const free = Math.max(0, W - rightM - leftM - n * pitch - inscW);
  const right = W - rightM - free / 2;
  const cols = best.lines.map((chars, k) => ({ chars, x: right - pitch * (k + .5), y: top + (k % 2 ? s * .18 : 0) }));
  const mainLeft = right - n * pitch;
  const colLen = t => [...t].reduce((a, ch) => a + (ch === '　' ? .5 : 1.04), 0) * i;
  const insc = {
    size: i,
    cols: inscCols.map((text, k) => {
      const last = k === inscCols.length - 1;
      const limit = H - bot * (last ? .6 : 1) - colLen(text) - (last ? sealSize + i * .5 : 0);
      return { text, x: mainLeft - s * .3 - i * .68 - k * i * 1.35, y: Math.max(top, Math.min(inscTop + k * i * 1.5, limit)) };
    }),
  };
  const lastX = insc.cols.length ? insc.cols[insc.cols.length - 1].x : mainLeft - s * .5;
  const seal = { chars: sealChars(input.from), size: sealSize, x: lastX, gap: i * .5 };
  const leadW = i * .88, leadH = i * 1.46;
  const leadPlan = lead.length ? { chars: lead, w: leadW, h: lead.length === 1 ? leadW * 1.2 : leadH, x: Math.min(W - leadW - W * .025, cols[0].x + s * .62), y: top + s * .05 } : null;

  return {
    w: W, h: H, cols,
    center: best.lines.every(l => l.length === 1),
    size: [s * (.86 - wild * .06), s * (.12 + wild * .2)],
    tilt: .12 + wild * .28, spread: .1 + wild * .22, drift: s * (.04 + wild * .12),
    bottom: bot, insc, seal, lead: leadPlan,
  };
}
