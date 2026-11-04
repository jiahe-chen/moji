// moji 渲染引擎：给定排版方案（layout.js 的输出）和随机种子，在 canvas 上写出一幅书法。
// 不依赖 DOM：画布由调用方通过 mk(w,h) 提供，浏览器和 Node（@napi-rs/canvas）共用同一份代码。
// 字形来自字体；墨色、飞白、毛边、纸纹、印章全部由算法生成。

export const FONT = {
  CAO: '"Liu Jian Mao Cao","Zhi Mang Xing","STXingkai","华文行楷",cursive',
  XING: '"Zhi Mang Xing","Liu Jian Mao Cao","STXingkai","华文行楷",cursive',
  KAI: '"Ma Shan Zheng","STKaiti","KaiTi","楷体",serif',
  SEAL: '"ChongXi Seal","Songti SC","SimSun",serif',
};
const INK = [14, 12, 11];
const RED = '#b8322a';

export function mulberry(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// 标准正态分布函数，把纹理值摊平成 0~1 的均匀分布，阈值即“枯掉的比例”
const Phi = z => {
  const t = 1 / (1 + .2316419 * Math.abs(z));
  const p = t * (.31938153 + t * (-.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const v = 1 - .3989422804 * Math.exp(-z * z / 2) * p;
  return z >= 0 ? v : 1 - v;
};

function makeNoise(rnd) {
  const P = new Uint8Array(512), V = new Float32Array(256);
  for (let i = 0; i < 256; i++) { P[i] = i; V[i] = rnd(); }
  for (let i = 255; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [P[i], P[j]] = [P[j], P[i]]; }
  for (let i = 0; i < 256; i++) P[i + 256] = P[i];
  const s = t => t * t * (3 - 2 * t);
  const n = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, X = xi & 255, Y = yi & 255;
    const a = V[P[P[X] + Y]], b = V[P[P[X + 1] + Y]], c = V[P[P[X] + Y + 1]], d = V[P[P[X + 1] + Y + 1]], u = s(xf), v = s(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return (x, y) => n(x, y) * .57 + n(x * 2.03, y * 2.03) * .29 + n(x * 4.1, y * 4.1) * .14;
}

// 可分离盒式模糊，两遍近似高斯
function blur(src, w, h, r) {
  let a = src; const n = 2 * r + 1;
  for (let pass = 0; pass < 2; pass++) {
    const b = new Float32Array(w * h), c = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = y * w; let s = 0;
      for (let x = -r; x <= r; x++) s += a[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) { b[row + x] = s / n; s += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)]; }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let y = -r; y <= r; y++) s += b[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) { c[y * w + x] = s / n; s += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x]; }
    }
    a = c;
  }
  return a;
}

/**
 * 生成一幅字的全部素材（纸、每个字、牵丝、印章），之后用 finish() 一次画完，或用 animate() 逐字写出。
 * @param g      目标画布的 2D 上下文，尺寸为 plan.w*K × plan.h*K
 * @param plan   layout.js 的排版方案
 * @param opt.K    分辨率倍数，屏幕 1~2，印刷 3
 * @param opt.seed 随机种子，同一种子永远写出同一幅
 * @param opt.mk   (w,h) => canvas
 * @param opt.tick 可选，每写完一个字 await 一次，让浏览器界面不卡
 * @param opt.onProgress 可选，(已完成, 总数)
 */
export async function createScene(g, plan, { K = 1, seed = 1, mk, tick, onProgress } = {}) {
  const W = Math.round(plan.w * K), H = Math.round(plan.h * K);

  function paper(seed) {
    const rnd = mulberry(seed);
    g.fillStyle = '#f2eee4'; g.fillRect(0, 0, W, H);
    const img = g.getImageData(0, 0, W, H), d = img.data, fn = makeNoise(rnd);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, k = (rnd() - .5) * 9 + (fn(x / (90 * K), y / (90 * K)) - .5) * 14;
      d[i] += k; d[i + 1] += k; d[i + 2] += k * 1.1;
    }
    g.putImageData(img, 0, 0);
    g.lineCap = 'round';
    const fibers = 420 * K * (plan.w * plan.h) / 1.2e6;
    for (let i = 0; i < fibers; i++) {
      const x = rnd() * W, y = rnd() * H, l = (20 + rnd() * 70) * K, a = rnd() * Math.PI * 2;
      g.strokeStyle = `rgba(${110 + rnd() * 40 | 0},${95 + rnd() * 30 | 0},70,${.05 + rnd() * .07})`;
      g.lineWidth = (.4 + rnd() * .7) * Math.sqrt(K); g.beginPath(); g.moveTo(x, y);
      g.quadraticCurveTo(x + Math.cos(a + 1) * l * .5, y + Math.sin(a + 1) * l * .5, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    const v = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .3, W / 2, H / 2, Math.max(W, H) * .75);
    v.addColorStop(0, 'rgba(120,95,60,0)'); v.addColorStop(1, 'rgba(120,95,60,.14)');
    g.fillStyle = v; g.fillRect(0, 0, W, H);
  }

  // 单字：字形 → 笔画走向 → 顺笔势的笔毛纹理 → 零星飞白；墨色通篇纯黑
  // wet：笔上剩的墨（1 = 刚蘸），dry：飞白程度
  function renderChar(ch, size, rnd, opt = {}) {
    const wet = opt.wet ?? .7, dry = opt.dry ?? 0;
    const S = Math.ceil(size * 1.4), m = mk(S, S), c = m.getContext('2d', { willReadFrequently: true });
    c.translate(S / 2, S / 2); c.rotate((rnd() - .5) * (opt.tilt ?? .14));
    const sp = opt.spread ?? .14; c.scale(1 - sp / 2 + rnd() * sp, 1 - sp / 2 + rnd() * sp);
    c.font = `${size}px ${opt.font || FONT.KAI}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#000'; c.strokeStyle = '#000'; c.lineJoin = 'round';
    c.lineWidth = size * (opt.weight ?? .012) * (.7 + .6 * wet);
    c.strokeText(ch, 0, 0); c.fillText(ch, 0, 0);
    c.setTransform(1, 0, 0, 1, 0, 0);
    const img = c.getImageData(0, 0, S, S), d = img.data, N = S * S;
    const A = new Float32Array(N); for (let i = 0; i < N; i++) A[i] = d[i * 4 + 3] / 255;
    const B = blur(A, S, S, Math.max(1, Math.round(size * .018)));
    const lr = mulberry(rnd() * 1e9 | 0);   // 笔毛纹理用独立的随机流，换分辨率不影响其他字

    // 只有带飞白的字才需要笔势方向和笔毛纹理，墨足的字跳过这段最耗时的计算
    let Sxx, Sxy, Syy, lic, mean = 0, sd = 1;
    if (dry > 0) {
      // 笔画走向：结构张量的次方向即笔势方向
      const Jxx = new Float32Array(N), Jxy = new Float32Array(N), Jyy = new Float32Array(N);
      for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) {
        const i = y * S + x, gx = B[i + 1] - B[i - 1], gy = B[i + S] - B[i - S];
        Jxx[i] = gx * gx; Jxy[i] = gx * gy; Jyy[i] = gy * gy;
      }
      const r2 = Math.max(2, Math.round(size * .035));
      Sxx = blur(Jxx, S, S, r2); Sxy = blur(Jxy, S, S, r2); Syy = blur(Jyy, S, S, r2);
      const TX = new Float32Array(N), TY = new Float32Array(N);
      for (let i = 0; i < N; i++) { const th = .5 * Math.atan2(2 * Sxy[i], Sxx[i] - Syy[i]); TX[i] = -Math.sin(th); TY[i] = Math.cos(th); }

      // 笔毛纹理：细噪声沿笔势做线积分卷积（LIC），得到顺着笔画流动的丝缕
      const W0 = new Float32Array(N); for (let i = 0; i < N; i++) W0[i] = lr();
      const G = blur(W0, S, S, 1);
      const L = Math.max(4, Math.round(size * .07));
      lic = new Float32Array(N); let s1 = 0, s2 = 0, cnt = 0;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const i = y * S + x; if (A[i] < .02) continue;
        let s = G[i], n = 1;
        for (let sg = -1; sg <= 1; sg += 2) {
          let px = x, py = y, dx = TX[i] * sg, dy = TY[i] * sg;
          for (let k = 0; k < L; k++) {
            px += dx; py += dy; const ix = Math.round(px), iy = Math.round(py);
            if (ix < 0 || iy < 0 || ix >= S || iy >= S) break;
            const j = iy * S + ix; let tx = TX[j], ty = TY[j];
            if (tx * dx + ty * dy < 0) { tx = -tx; ty = -ty; }
            dx = tx; dy = ty; s += G[j]; n++;
          }
        }
        const v = s / n; lic[i] = v; s1 += v; s2 += v * v; cnt++;
      }
      mean = s1 / Math.max(1, cnt); sd = Math.sqrt(Math.max(1e-8, s2 / Math.max(1, cnt) - mean * mean));
    }

    // 笔画边缘：按纸纤维噪声做不规则阈值，去掉字体轮廓过于光滑的矢量感（落款小字不做，保持端正）
    const rough = opt.rough ?? 1;
    const Be = blur(A, S, S, Math.max(1, Math.round(size * .006))), fe = makeNoise(rnd);
    const fz = makeNoise(rnd), off = rnd() * 50, zs = size * .3;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x, o = i * 4;
      let Ar = A[i];
      if (rough) { const ne = .5 + .3 * (fe(x / (2 * K), y / (2 * K)) - .5); Ar = sstep(ne - .08, ne + .08, Be[i]); }
      if (Ar <= .003) { d[o + 3] = 0; continue; }
      let keep = 1;
      if (dry > 0 && A[i] >= .02) {
        const u = Phi((lic[i] - mean) / sd);
        const edge = 1 - sstep(.45, .9, B[i]);                         // 笔画边缘、细笔
        const zone = sstep(.56, .78, fz(x / zs + off, y / zs + off));    // 只有零星几处行笔快、易枯
        // 笔势一致度：单笔顺畅处接近 1，笔画交叉、转折处方向混乱则接近 0，那里不出飞白
        const tr = Sxx[i] + Syy[i], coh = tr > 1e-9 ? Math.sqrt((Sxx[i] - Syy[i]) ** 2 + 4 * Sxy[i] ** 2) / tr : 0;
        const tail = sstep(.53, .75, y / S);                             // 一个字写到后半、收笔处墨才将尽
        const th = Math.min(.8, dry * zone * (.6 + .8 * edge) * sstep(.55, .85, coh) * tail);
        if (th > 0) keep = sstep(th - .05, th + .05, u);
      }
      d[o] = INK[0]; d[o + 1] = INK[1]; d[o + 2] = INK[2]; d[o + 3] = Ar * keep * 255;
    }
    c.putImageData(img, 0, 0);
    return m;
  }

  // ---- 印章 ----
  function erode(c, rnd, w, h, count) {
    c.globalCompositeOperation = 'destination-out'; c.fillStyle = '#000';
    for (let i = 0; i < count; i++) {
      c.globalAlpha = .6 + rnd() * .4; c.beginPath();
      const edge = rnd() < .65, x = edge ? (rnd() < .5 ? rnd() * w * .1 : w - rnd() * w * .1) : rnd() * w;
      const y = edge && rnd() < .5 ? (rnd() < .5 ? rnd() * h * .1 : h - rnd() * h * .1) : rnd() * h;
      c.arc(x, y, (.4 + rnd() * 1.1) * K, 0, 7); c.fill();
    }
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  }

  // 印泥：着色不匀，带细小漏白
  function sealTexture(c, rnd, w, h) {
    const img = c.getImageData(0, 0, w, h), d = img.data, fn = makeNoise(rnd);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4; if (!d[o + 3]) continue;
      let a = d[o + 3] / 255 * (.76 + .24 * fn(x / (7 * K), y / (7 * K)));
      if (fn(x / (1.6 * K) + 20, y / (1.6 * K) + 20) < .24) a *= .3;
      d[o + 3] = a * 255;
    }
    c.putImageData(img, 0, 0);
  }

  // 把一个篆字按字面框撑满到指定格子
  function fitGlyph(c, ch, cx, cy, w, h, lw) {
    c.save(); c.font = `100px ${FONT.SEAL}`; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    const mt = c.measureText(ch);
    const gw = mt.actualBoundingBoxLeft + mt.actualBoundingBoxRight || 60, gh = mt.actualBoundingBoxAscent + mt.actualBoundingBoxDescent || 90;
    const sy = h / gh, sx = Math.min(w / gw, sy * 1.45);
    c.translate(cx, cy); c.scale(sx, sy); c.lineJoin = 'round'; c.lineWidth = lw / Math.sqrt(sx * sy);
    const x0 = (mt.actualBoundingBoxLeft - mt.actualBoundingBoxRight) / 2, y0 = (mt.actualBoundingBoxAscent - mt.actualBoundingBoxDescent) / 2;
    c.fillText(ch, x0, y0); if (lw > 0) c.strokeText(ch, x0, y0);
    c.restore();
  }

  // 印面做旧：模糊后按噪声阈值重画轮廓，方角变圆钝、边线起伏，边沿偶有印泥没压实
  function roughen(c, rnd, w, h, r, amp, th = .5) {
    const img = c.getImageData(0, 0, w, h), d = img.data, N = w * h, A = new Float32Array(N);
    for (let i = 0; i < N; i++) A[i] = d[i * 4 + 3] / 255;
    const Bs = blur(A, w, h, Math.max(1, Math.round(r))), fn = makeNoise(rnd), fp = makeNoise(rnd), sc = Math.max(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, o = i * 4;
      const ne = th + amp * (fn(x / (sc * .05), y / (sc * .05)) - .5) + amp * .5 * (fn(x / (sc * .012) + 30, y / (sc * .012) + 30) - .5);
      let a = sstep(ne - .06, ne + .06, Bs[i]);
      const band = 1 - sstep(.55, .95, Bs[i]);
      a *= 1 - .5 * band * sstep(.5, .8, fp(x / (sc * .15), y / (sc * .15)));
      d[o] = 184; d[o + 1] = 50; d[o + 2] = 42; d[o + 3] = a * 255;
    }
    c.putImageData(img, 0, 0);
  }

  // 印面：四边带低频起伏，再咬掉几处缺口，最后整体做旧
  function sealBlock(c, rnd, w, h) {
    const m = Math.min(w, h) * .03, Lw = w - 2 * m, Lh = h - 2 * m, fw = makeNoise(rnd), n = 120;
    c.beginPath();
    for (let k = 0; k < 4 * n; k++) {
      const side = k / n | 0, t = (k % n) / n;
      const [x, y, nx, ny] = [[m + t * Lw, m, 0, -1], [w - m, m + t * Lh, 1, 0], [w - m - t * Lw, h - m, 0, 1], [m, h - m - t * Lh, -1, 0]][side];
      const off = Math.min(w, h) * .012 * (fw(k / 40, side * 7) - .5) * 2;
      k ? c.lineTo(x + nx * off, y + ny * off) : c.moveTo(x + nx * off, y + ny * off);
    }
    c.closePath(); c.fill();
    c.globalCompositeOperation = 'destination-out';
    for (let i = 0, k = 3 + (rnd() * 3 | 0); i < k; i++) {
      const side = rnd() * 4 | 0, t = .08 + rnd() * .84, rr = Math.min(w, h) * (.012 + rnd() * .03);
      const [x, y] = [[t * w, m], [w - m, t * h], [t * w, h - m], [m, t * h]][side];
      c.beginPath(); c.arc(x, y, rr, 0, 7); c.fill();
    }
    c.globalCompositeOperation = 'source-over';
    roughen(c, rnd, w, h, Math.min(w, h) * .025, .35);
  }

  // 白文名章：四字分两列（右列先读），两字竖排一列
  function nameSeal(rnd, size, chars) {
    const two = chars.length <= 2, w = Math.round(two ? size * .62 : size), h = size;
    const s = mk(w, h), c = s.getContext('2d', { willReadFrequently: true });
    c.fillStyle = RED; sealBlock(c, rnd, w, h);
    // 先把篆字画在单独一层，再整层从印面上挖掉，即成白文
    const t = mk(w, h), tc = t.getContext('2d'); tc.fillStyle = tc.strokeStyle = '#000';
    const m = size * .1, gp = size * .05;
    if (two) {
      const cw = w - 2 * m, chh = (h - 2 * m - gp) / 2;
      chars.forEach((ch, i) => fitGlyph(tc, ch, w / 2, m + i * (chh + gp) + chh / 2, cw, chh, size * .02));
    } else {
      const cw = (size - 2 * m - gp) / 2;
      chars.slice(0, 4).forEach((ch, i) => {
        const col = i < 2 ? 1 : 0, row = i % 2;
        fitGlyph(tc, ch, m + col * (cw + gp) + cw / 2, m + row * (cw + gp) + cw / 2, cw, cw, size * .02);
      });
    }
    c.globalCompositeOperation = 'destination-out'; c.drawImage(t, 0, 0);
    c.globalCompositeOperation = 'source-over';
    sealTexture(c, rnd, w, h); erode(c, rnd, w, h, 80);
    return s;
  }

  // 朱文椭圆引首章：一到两个字
  function leadSeal(rnd, w, h, chars) {
    const s = mk(w, h), c = s.getContext('2d', { willReadFrequently: true });
    c.strokeStyle = c.fillStyle = RED; c.lineWidth = Math.max(1.5, w * .057);
    const fw = makeNoise(rnd); c.beginPath();
    for (let k = 0; k <= 160; k++) {
      const t = k / 160 * Math.PI * 2, j = 1 + .035 * (fw(Math.cos(t) * 2 + 5, Math.sin(t) * 2 + 5) - .5) * 2;
      const x = w / 2 + Math.cos(t) * (w / 2 - w * .076) * j, y = h / 2 + Math.sin(t) * (h / 2 - w * .076) * j;
      k ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    c.stroke();
    roughen(c, rnd, w, h, w * .017, .25, .4);   // 只做旧外圈，篆字保持清楚
    c.fillStyle = RED;
    if (chars.length === 1) fitGlyph(c, chars[0], w / 2, h / 2, w * .52, h * .42, w * .013);
    else { fitGlyph(c, chars[0], w / 2, h * .32, w * .5, h * .27, w * .013); fitGlyph(c, chars[1], w / 2, h * .68, w * .48, h * .27, w * .013); }
    sealTexture(c, rnd, w, h); erode(c, rnd, w, h, 35);
    return s;
  }

  // ---- 逐字素材 ----
  const charPiece = (cnv, x, y, dur) => ({
    dur, draw(k) {
      const S = cnv.width, X = x - S / 2, Y = y - S / 2;
      if (k >= 1) { g.drawImage(cnv, X, Y); return; }
      const h = S * k; if (h > 0) g.drawImage(cnv, 0, 0, S, h, X, Y, S, h);
    },
  });

  // 字形里真实的笔尖：最下面一笔的收笔（bottom）或最上面一笔的起笔；取端头一小段墨迹的中心，避开毛刺
  function inkTip(cnv, bottom) {
    const S = cnv.width, d = cnv.getContext('2d').getImageData(0, 0, S, S).data, band = Math.max(3, Math.round(S * .025));
    const ink = (x, y) => d[(y * S + x) * 4 + 3] > 160;
    for (let k = 0; k < S - band; k++) {
      const y0 = bottom ? S - 1 - k : k;
      let x0 = -1; for (let x = 0; x < S; x++) if (ink(x, y0)) { x0 = x; break; }
      if (x0 < 0) continue;
      let sx = 0, n = 0;
      for (let j = 0; j < band; j++) {
        const y = bottom ? y0 - j : y0 + j;
        for (let x = Math.max(0, x0 - S * .06 | 0); x < Math.min(S, x0 + S * .06); x++) if (ink(x, y)) { sx += x; n++; }
      }
      if (n >= band * 2) return { x: sx / n, y: bottom ? y0 - band * .6 : y0 + band * .6 };   // 太细的是毛刺，接着往里找
    }
    return null;
  }

  // 牵丝：上字收笔顺势连到下字起笔的一根游丝。整根朝一侧微微弯成弧，不打小弯、不扭成 S；
  // 出锋处粗、中段收细、入笔前略回粗；墨少时断开一两处
  function silkPiece(a, b, w, dry, rnd) {
    const L = b.y - a.y, dx = b.x - a.x, bow = (rnd() - .5) * L * .3;
    const c1 = { x: a.x + dx / 3 + bow, y: a.y + L / 3 }, c2 = { x: a.x + dx * 2 / 3 + bow, y: a.y + L * 2 / 3 };
    const gaps = dry ? Array.from({ length: rnd() < .5 ? 1 : 2 }, () => { const t = .3 + rnd() * .4; return [t, t + .05 + rnd() * .08]; }) : [];
    const n = 48, pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      pts.push({
        x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
        y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
        r: w * (.35 + .65 * Math.pow(u, 1.5) + .3 * Math.pow(t, 4)),
        gap: gaps.some(([t0, t1]) => t > t0 && t < t1),
      });
    }
    pts.forEach((p, i) => {   // 法线方向，用来把中线扩成有粗细的笔画
      const q0 = pts[Math.max(0, i - 1)], q1 = pts[Math.min(n, i + 1)], len = Math.hypot(q1.x - q0.x, q1.y - q0.y) || 1;
      p.nx = -(q1.y - q0.y) / len; p.ny = (q1.x - q0.x) / len;
    });
    return {
      dur: 150, draw(k) {
        const m = Math.floor(pts.length * Math.min(1, k));
        g.fillStyle = `rgb(${INK})`; g.globalAlpha = .9;
        for (let i = 0; i < m;) {   // 每段连续的墨画成一个封闭轮廓，端头补圆
          if (pts[i].gap) { i++; continue; }
          let j = i; while (j + 1 < m && !pts[j + 1].gap) j++;
          const run = pts.slice(i, j + 1);
          g.beginPath();
          run.forEach((p, q) => g[q ? 'lineTo' : 'moveTo'](p.x + p.nx * p.r, p.y + p.ny * p.r));
          for (const p of run.reverse()) g.lineTo(p.x - p.nx * p.r, p.y - p.ny * p.r);
          g.closePath(); g.fill();
          const e = pts[j]; g.beginPath(); g.arc(e.x, e.y, e.r, 0, 7); g.fill();
          i = j + 1;
        }
        g.globalAlpha = 1;
      },
    };
  }

  // ---- 布局与生成 ----
  const rnd = mulberry(seed);
  paper(rnd() * 1e9 | 0);
  const sealSeed = rnd() * 1e9 | 0;
  const seq = [], seen = new Map();
  const total = plan.cols.reduce((a, c) => a + c.chars.length, 0) + plan.insc.cols.reduce((a, c) => a + c.text.length, 0);
  let done = 0;
  const step = async () => { done++; onProgress?.(done, total); if (tick) await tick(); };

  const bottom = H - plan.bottom * K;
  // 蘸一次墨连写数字，墨尽再蘸
  let ink = 1;
  const take = () => { const w = ink; ink *= .68 + rnd() * .14; if (ink < .3) ink = .88 + rnd() * .12; return w; };
  const mc = mk(8, 8).getContext('2d'); mc.textBaseline = 'middle';
  for (const [ci, col] of plan.cols.entries()) {
    const chars = col.chars;
    // 重复出现的字草书、行书交替，避免字形雷同；行书字体本身笔画粗，少加粗一些
    const alt = chars.map(ch => { const n = seen.get(ch) || 0; seen.set(ch, n + 1); return n % 2 === 1; });
    // 按字形实际的上下高度排字：草书字形高矮差别大，按字号等距排会上下相撞
    const ext = chars.map((ch, i) => {
      mc.font = `100px ${alt[i] ? FONT.XING : FONT.CAO}`; const m = mc.measureText(ch);
      const up = m.actualBoundingBoxAscent / 100, dn = m.actualBoundingBoxDescent / 100;
      return up + dn > .2 ? [up, dn] : [.5, .5];
    });
    const gap = .08, span = i => ext[i][0] + ext[i][1] + gap;
    let sizes = chars.map(() => (plan.size[0] + rnd() * plan.size[1]) * K);
    const colH = sizes.reduce((a, s, i) => a + s * span(i), 0);
    let y = plan.center ? (H - colH) / 2 + (rnd() - .5) * plan.size[0] * .1 * K : (col.y + rnd() * plan.size[0] * .1) * K;
    if (y + colH > bottom) { const f = (bottom - y) / colH; sizes = sizes.map(s => s * f); }
    let drift = 0, prev = null;
    for (const [i, ch] of chars.entries()) {
      const s = sizes[i], w = take(), dry = w < .42 ? .3 + rnd() * .2 : 0;   // 墨将尽的字才偶见飞白
      drift = Math.max(-plan.drift, Math.min(plan.drift, drift + (rnd() - .5) * plan.size[0] * .11));
      const x = (col.x + drift + (rnd() - .5) * plan.size[0] * .05) * K, cy = y + s * ext[i][0];   // 字形顶端落在 y
      const cnv = renderChar(ch, s * (.95 + .08 * w), rnd, { font: alt[i] ? FONT.XING : FONT.CAO, weight: alt[i] ? .006 : .02, tilt: plan.tilt, spread: plan.spread, wet: w, dry });
      if (prev && rnd() < .35) {
        // 先取好随机数再判断连不连：笔尖位置按像素找，放大导出时判断可能不同，不能让它打乱后面每个字的随机数
        const silkRnd = mulberry(rnd() * 1e9 | 0), silkW = (1 + rnd() * .8) * (.6 + .7 * prev.w) * s / 120;
        // 端点取两个字的真实笔尖；上下挨得太近或左右错开太远，硬连会成小钩或横线，就不连
        const ta = inkTip(prev.cnv, true), tb = inkTip(cnv, false);
        const a = ta && { x: prev.x - prev.cnv.width / 2 + ta.x, y: prev.cy - prev.cnv.width / 2 + ta.y };
        const b = tb && { x: x - cnv.width / 2 + tb.x, y: cy - cnv.width / 2 + tb.y };
        if (a && b && b.y - a.y > s * .06 && Math.abs(b.x - a.x) < Math.max(s * .12, (b.y - a.y) * 1.2))
          seq.push(silkPiece(a, b, silkW, prev.dry, silkRnd));
      }
      seq.push(charPiece(cnv, x, cy, 300));
      prev = { x, cy, s, w, dry, cnv }; y += s * span(i);
      await step();
    }
  }

  // 落款（毛笔楷书，端正平直）
  const is = plan.insc.size;
  let endY = 0;
  for (const col of plan.insc.cols) {
    let y = col.y * K;
    for (const ch of col.text) {
      if (ch === '　') { y += is * .5 * K; continue; }
      const cnv = renderChar(ch, is * (1 + rnd() * .04) * K, rnd, { font: FONT.KAI, wet: .6, dry: 0, weight: .01, tilt: .03, spread: .04, rough: 0 });
      seq.push(charPiece(cnv, (col.x + (rnd() - .5) * is * .03) * K, y + is * .5 * K, 85));
      y += is * 1.04 * K;
      await step();
    }
    endY = y;
  }

  const scene = { W, H, seq, base: g.getImageData(0, 0, W, H), seals: [] };
  // 印章单独成一步：篆字字体很大、加载较晚，加载完成后可以只重做印章
  scene.makeSeals = () => {
    const r = mulberry(sealSeed);
    scene.seals = [];
    if (plan.seal && plan.seal.chars.length) {
      const ns = nameSeal(r, Math.round(plan.seal.size * K), plan.seal.chars);
      scene.seals.push({ c: ns, x: plan.seal.x * K - ns.width / 2, y: endY + plan.seal.gap * K, rot: (r() - .5) * .05 });
    }
    if (plan.lead && plan.lead.chars.length) {
      const ls = leadSeal(r, Math.round(plan.lead.w * K), Math.round(plan.lead.h * K), plan.lead.chars);
      scene.seals.push({ c: ls, x: plan.lead.x * K, y: plan.lead.y * K, rot: (r() - .5) * .05 });
    }
  };
  scene.makeSeals();
  return scene;
}

/** 把一幅字完整画到画布上。 */
export function finish(g, scene) {
  g.putImageData(scene.base, 0, 0);
  scene.seq.forEach(p => p.draw(1));
  g.globalCompositeOperation = 'multiply'; g.globalAlpha = .92;
  for (const s of scene.seals) {   // 钤印时略有歪斜
    const w = s.c.width, h = s.c.height;
    g.save(); g.translate(s.x + w / 2, s.y + h / 2); g.rotate(s.rot); g.drawImage(s.c, -w / 2, -h / 2); g.restore();
  }
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
}

/** 逐字写出的动画；返回取消函数。raf 由调用方传入（浏览器里是 requestAnimationFrame）。 */
export function animate(g, scene, { raf, caf, now, onDone }) {
  const t0 = now(); let id = 0;
  const frame = t1 => {
    let t = t1 - t0, done = true; g.putImageData(scene.base, 0, 0);
    for (const p of scene.seq) {
      if (t >= p.dur) { p.draw(1); t -= p.dur + 30; continue; }
      const k = Math.max(0, t / p.dur); p.draw(1 - Math.pow(1 - k, 2)); done = false; break;
    }
    if (done) { finish(g, scene); onDone?.(); return; }
    id = raf(frame);
  };
  id = raf(frame);
  return () => caf(id);
}
