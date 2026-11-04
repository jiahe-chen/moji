#!/usr/bin/env node
// 生成灵感集市的缩略图：按 gallery/works.json 里每幅的参数写出来，存成 gallery/<id>.jpg，并把缩略图尺寸写回 works.json。
// 网页上点「做同款」用的是同样的参数和种子，打开就是同一幅字。
// 用法（在仓库根目录）：node tools/build_gallery.mjs [--seeds 1,2,3 --out 目录]
//   给 --seeds 时不改 gallery/，把每幅用这几个种子各写一张放进 --out，用来挑种子
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createScene, finish } from '../src/engine.js';
import { layout } from '../src/layout.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cache = path.join(ROOT, 'tools', '.cache');
GlobalFonts.registerFromPath(path.join(cache, 'LiuJianMaoCao-Regular.ttf'), 'Liu Jian Mao Cao');
GlobalFonts.registerFromPath(path.join(cache, 'ZhiMangXing-Regular.ttf'), 'Zhi Mang Xing');
GlobalFonts.registerFromPath(path.join(cache, 'MaShanZheng-Regular.ttf'), 'Ma Shan Zheng');
GlobalFonts.registerFromPath(path.join(ROOT, 'fonts', 'chongxi', 'ChongXiSmallSeal.otf'), 'ChongXi Seal');

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const file = path.join(ROOT, 'gallery', 'works.json');
const works = JSON.parse(fs.readFileSync(file, 'utf8'));
const BOX = 520;   // 缩略图最长边，网页上卡片高 260，两倍清晰

async function thumb(work, seed) {
  const plan = layout(work);
  const big = createCanvas(plan.w, plan.h), g = big.getContext('2d');
  finish(g, await createScene(g, plan, { K: 1, seed, mk: (w, h) => createCanvas(w, h) }));
  const f = BOX / Math.max(plan.w, plan.h), small = createCanvas(Math.round(plan.w * f), Math.round(plan.h * f));
  small.getContext('2d').drawImage(big, 0, 0, small.width, small.height);
  return small;
}

if (args.seeds) {
  fs.mkdirSync(args.out, { recursive: true });
  for (const w of works) for (const seed of args.seeds.split(',').map(Number)) {
    fs.writeFileSync(path.join(args.out, `${w.id}_${seed}.jpg`), (await thumb(w, seed)).toBuffer('image/jpeg', 82));
  }
  console.log(`候选图已写到 ${args.out}`);
} else {
  for (const w of works) {
    const c = await thumb(w, w.seed);
    fs.writeFileSync(path.join(ROOT, 'gallery', `${w.id}.jpg`), c.toBuffer('image/jpeg', 82));
    w.thumb = [c.width, c.height];
    console.log(w.id, w.thumb.join('×'));
  }
  fs.writeFileSync(file, '[\n' + works.map(w => '  ' + JSON.stringify(w)).join(',\n') + '\n]\n');
}
