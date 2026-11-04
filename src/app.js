// 网页：读写表单和网址参数，调用引擎预览，导出图片和 PDF，接 AI 选句。
import { createScene, finish, animate, FONT } from './engine.js';
import { layout, hanOnly, FORMATS } from './layout.js';
import { ganzhiSeason } from './calendar.js';
import { toQuery, fromQuery } from './share.js';
import { jpegToPdf } from './pdf.js';
import { AI_ENDPOINT } from './config.js';

const $ = id => document.getElementById(id);
const canvas = $('c'), g = canvas.getContext('2d', { willReadFrequently: true });
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const inWeChat = /MicroMessenger/i.test(navigator.userAgent);
const newSeed = () => (Math.random() * 1e9) | 0;
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const tick = () => new Promise(r => setTimeout(r, 0));

const DEFAULTS = { text: '厚德载物', src: '周易句', to: '', from: '墨迹', date: ganzhiSeason(), lead: '', format: 'auto', wild: .5 };
// 打开分享链接时，链接里没写的项就是留空，不能拿首次访问的示例去补
const BLANK = { text: '', src: '', to: '', from: '', date: '', lead: '', format: 'auto', wild: .5 };
const state = fromQuery(location.search, new URLSearchParams(location.search).has('t') ? BLANK : DEFAULTS);
if (!state.seed) state.seed = newSeed();

// ---- 表单 ----
const fields = { text: 'f-text', src: 'f-src', to: 'f-to', from: 'f-from', date: 'f-date', lead: 'f-lead' };
function fillForm() {
  for (const [k, id] of Object.entries(fields)) $(id).value = state[k] || '';
  $('f-wild').value = Math.round(state.wild * 100); $('o-wild').value = Math.round(state.wild * 100);
  for (const r of document.querySelectorAll('input[name="fmt"]')) r.checked = r.value === state.format;
}
function syncUrl() {
  history.replaceState(null, '', '?' + toQuery(state));
  $('seed').textContent = `种子 ${state.seed}`;
}
let debounce = 0;
$('form').addEventListener('input', e => {
  const t = e.target;
  const key = Object.keys(fields).find(k => fields[k] === t.id);
  if (key) state[key] = t.value;
  if (t.name === 'fmt') state.format = t.value;
  if (t.id === 'f-wild') { state.wild = +t.value / 100; $('o-wild').value = t.value; pinned.wild = true; }
  syncUrl();
  clearTimeout(debounce);
  debounce = setTimeout(() => render(), 500);
});
$('form').addEventListener('submit', e => e.preventDefault());

// ---- 字体 ----
// 书法字体按 unicode-range 分片托管，load() 只下载用到的那几片；篆字字体不能切分，约 21MB，后台慢慢加载
let sealReady = false;
const sealLoading = document.fonts.load(`40px ${FONT.SEAL}`, '印').then(() => { sealReady = true; }).catch(() => {});
function loadFonts(plan) {
  const main = plan.cols.flatMap(c => c.chars).join(''), insc = plan.insc.cols.map(c => c.text).join('');
  return Promise.race([
    Promise.all([document.fonts.load(`100px ${FONT.CAO}`, main), document.fonts.load(`100px ${FONT.XING}`, main), document.fonts.load(`100px ${FONT.KAI}`, insc)]),
    new Promise(r => setTimeout(r, 12000)),
  ]).catch(() => {});
}

// ---- 预览 ----
const status = text => { $('status').textContent = text; $('status').hidden = !text; };
let renderId = 0, stopAnim = null, current = null;
async function render({ anim = false } = {}) {
  const id = ++renderId;
  stopAnim?.(); stopAnim = null;
  const plan = layout(state);
  if (!plan) { status('正文里还没有汉字'); return; }
  $('fmt-auto').textContent = plan.auto ? `·${FORMATS[plan.format].label}` : '';
  status('研墨中…');
  await loadFonts(plan);
  if (id !== renderId) return;
  canvas.width = plan.w; canvas.height = plan.h;
  status('书写中…');
  const scene = await createScene(g, plan, { K: 1, seed: state.seed, mk, tick });
  if (id !== renderId) return;
  current = scene;
  status(sealReady ? '' : '印章字体加载中…');
  if (anim && !reduceMotion) stopAnim = animate(g, scene, { raf: requestAnimationFrame, caf: cancelAnimationFrame, now: () => performance.now(), onDone: () => { stopAnim = null; } });
  else finish(g, scene);
  if (!sealReady) sealLoading.then(() => {
    if (current !== scene) return;
    scene.makeSeals(); status('');
    if (!stopAnim) finish(g, scene);   // 动画还在写的话，写完时会画上新印章
  });
}

$('b-again').addEventListener('click', () => { state.seed = newSeed(); syncUrl(); render({ anim: true }); });

// ---- 分享 ----
const msg = (text, el = 'msg') => { $(el).textContent = text; };
$('b-share').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(location.href); msg('链接已复制，打开就是这一幅'); }
  catch { sheet(`复制下面的链接：\n${location.href}`); }
});

// ---- 导出 ----
function fileName() {
  const from = hanOnly(state.from).join(''), to = hanOnly(state.to).join('');
  return to ? `${from || '墨迹'}赠${to}` : `${from || '墨迹'}书${hanOnly(state.text).slice(0, 6).join('')}`;
}
function sheet(text, imgUrl) {
  $('sheet-text').textContent = text;
  $('sheet-img').hidden = !imgUrl; if (imgUrl) $('sheet-img').src = imgUrl;
  $('sheet').hidden = false;
}
$('sheet-close').addEventListener('click', () => { $('sheet').hidden = true; });
const toBlob = (c, type, q) => new Promise(r => c.toBlob(r, type, q));

async function exportArt(kind) {
  const plan = layout(state); if (!plan) return;
  const buttons = [$('b-png'), $('b-pdf')]; buttons.forEach(b => { b.disabled = true; });
  try {
    if (!sealReady) { msg('等印章字体加载完…'); await Promise.race([sealLoading, new Promise(r => setTimeout(r, 60000))]); }
    await loadFonts(plan);
    const K = Math.min(3, 4500 / Math.max(plan.w, plan.h));   // 印刷用 300dpi，长边约 4500 像素
    const big = mk(Math.round(plan.w * K), Math.round(plan.h * K)), bg = big.getContext('2d', { willReadFrequently: true });
    const scene = await createScene(bg, plan, { K, seed: state.seed, mk, tick, onProgress: (d, n) => msg(`正在生成印刷大图… ${Math.round(d / n * 100)}%`) });
    finish(bg, scene);
    const name = fileName();
    if (kind === 'png') {
      const blob = await toBlob(big, 'image/png');
      if (inWeChat) { sheet('长按图片，保存到手机', URL.createObjectURL(blob)); msg(''); return; }
      download(blob, name + '.png');
    } else {
      if (inWeChat) { sheet('微信里不能下载文件。点右上角“…”，选“在浏览器打开”，再下载 PDF。'); msg(''); return; }
      const jpeg = new Uint8Array(await (await toBlob(big, 'image/jpeg', .95)).arrayBuffer());
      download(new Blob([jpegToPdf(jpeg, big.width, big.height)], { type: 'application/pdf' }), name + '.pdf');
    }
    msg(`已下载 ${name}，${big.width}×${big.height} 像素，300dpi`);
  } catch (e) {
    console.error(e); msg('导出失败，换个浏览器再试试');
  } finally { buttons.forEach(b => { b.disabled = false; }); }
}
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
$('b-png').addEventListener('click', () => exportArt('png'));
$('b-pdf').addEventListener('click', () => exportArt('pdf'));

// ---- AI：说一句话，直接改字段、选句、写出来 ----
const FIELD_KEYS = ['text', 'src', 'to', 'from', 'date', 'lead', 'format', 'wild'];
const pick = o => Object.fromEntries(FIELD_KEYS.filter(k => o[k] !== undefined).map(k => [k, o[k]]));
let shown = [];   // 当前列出的候选句
// 版式只在用户明说时才改，换句子不动它。放纵度用户定过就保持不变，没定过才跟着候选句走
const pinned = { wild: false };

function useSuggestion(s) {
  state.text = s.text; state.src = s.src || ''; state.lead = s.lead || '';
  if (!pinned.wild && s.wild !== undefined) state.wild = s.wild;
}

async function askAI() {
  const q = $('ai-q').value.trim();
  if (!q) { msg('先说一句：想写什么、送给谁、你是谁', 'ai-msg'); return; }
  $('ai-go').disabled = true;
  msg('AI 正在想…要选新句子的话，会先上网核对原文，大约十几秒', 'ai-msg');
  try {
    const res = await fetch(AI_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request: q, current: pick(state) }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'AI 暂时没有回应');
    const set = pick(data.set || {}), list = data.suggestions || [];
    const before = state.text;
    Object.assign(state, set);
    if ('wild' in set) pinned.wild = true;
    if (list.length) { useSuggestion(list[0]); showSuggestions(list, 0); }
    if (!list.length && !Object.keys(set).length) { msg(data.reply || '没听懂要改什么，换个说法试试', 'ai-msg'); return; }
    // 换了正文就换个种子重新写；只改落款、版式这类，保留种子，正文的字形不变
    const fresh = state.text !== before;
    if (fresh) state.seed = newSeed();
    fillForm(); syncUrl(); render({ anim: fresh });
    msg(data.reply || '写好了', 'ai-msg');
    $('ai-q').value = '';
    $('ai-q').placeholder = '接着说：署名改成王五、换成竖的、再狂一点、换一句';
    if (fresh) $('mount').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
  } catch (e) { msg(e.message || 'AI 暂时没有回应，稍后再试', 'ai-msg'); }
  finally { $('ai-go').disabled = false; }
}

function showSuggestions(list, active) {
  shown = list;
  const ol = $('ai-list'); ol.replaceChildren();
  list.forEach((s, idx) => {
    const li = document.createElement('li'); li.classList.toggle('on', idx === active);
    const add = (cls, text, tag = 'div') => { const el = document.createElement(tag); el.className = cls; el.textContent = text; li.append(el); return el; };
    add('ai-text', s.text);
    add('ai-meta', [s.author, s.work && `《${s.work}》`].filter(Boolean).join(' ') + (s.lead ? ` · 引首章“${s.lead}”` : ''));
    if (s.reason) add('ai-why', s.reason);
    if (s.sources?.length) {
      const src = add('ai-src', '核对：');
      s.sources.forEach((u, i) => { const a = document.createElement('a'); a.href = u; a.target = '_blank'; a.rel = 'noopener'; a.textContent = `来源${i + 1}`; src.append(a, ' '); });
    }
    const b = add('btn ai-use', idx === active ? '正在用' : '换这句', 'button'); b.type = 'button';
    b.addEventListener('click', () => {
      if (li.classList.contains('on')) return;
      useSuggestion(s); state.seed = newSeed();
      fillForm(); syncUrl(); render({ anim: true }); showSuggestions(shown, idx);
      $('mount').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
    });
    ol.append(li);
  });
}

if (AI_ENDPOINT) {
  $('ai').hidden = false;
  $('ai-go').addEventListener('click', askAI);
  // 回车发送，Shift+回车换行；输入法选字时的回车不算
  $('ai-q').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); askAI(); } });
} else {
  $('b-again').classList.add('primary');
}

fillForm(); syncUrl(); render({ anim: true });
