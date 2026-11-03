#!/usr/bin/env node
// 命令行出图：和网页用同一个引擎，适合批量生成、给 AI 智能体（dsh、Claude Code）调用。
//
//   node tools/render.mjs --text "长风破浪会有时，直挂云帆济沧海" --src 李白行路难句 \
//        --to 张三 --from 李四 --lead 长风 --format tiaofu --scale 3 --out 李四赠张三.png [--pdf 李四赠张三.pdf]
//
// 参数和网页分享链接里的一一对应；不给 --seed 就随机，输出里会打印种子和分享链接，方便复现。
// 依赖：npm install；字体先运行 tools/build_fonts.py（会把原始 TTF 下载到 tools/.cache/）。
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createScene, finish } from '../src/engine.js';
import { layout } from '../src/layout.js';
import { ganzhiSeason } from '../src/calendar.js';
import { jpegToPdf } from '../src/pdf.js';
import { toQuery } from '../src/share.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cache = path.join(ROOT, 'tools', '.cache');
GlobalFonts.registerFromPath(path.join(cache, 'LiuJianMaoCao-Regular.ttf'), 'Liu Jian Mao Cao');
GlobalFonts.registerFromPath(path.join(cache, 'ZhiMangXing-Regular.ttf'), 'Zhi Mang Xing');
GlobalFonts.registerFromPath(path.join(cache, 'MaShanZheng-Regular.ttf'), 'Ma Shan Zheng');
GlobalFonts.registerFromPath(path.join(ROOT, 'fonts', 'chongxi', 'ChongXiSmallSeal.otf'), 'ChongXi Seal');

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const input = {
  text: args.text || '厚德载物', src: args.src || '', to: args.to || '', from: args.from || '',
  date: args.date ?? ganzhiSeason(), lead: args.lead || '', format: args.format || 'auto',
  wild: args.wild ? +args.wild : .5, seed: args.seed ? +args.seed : (Math.random() * 1e9) | 0,
};
const plan = layout(input);
if (!plan) { console.error('正文里没有汉字'); process.exit(1); }
const K = +(args.scale || 3);
const canvas = createCanvas(Math.round(plan.w * K), Math.round(plan.h * K));
const g = canvas.getContext('2d');
const scene = await createScene(g, plan, { K, seed: input.seed, mk: (w, h) => createCanvas(w, h) });
finish(g, scene);
const out = args.out || 'moji.png';
fs.writeFileSync(out, canvas.toBuffer('image/png'));
if (args.pdf) fs.writeFileSync(args.pdf, jpegToPdf(canvas.toBuffer('image/jpeg', 95), canvas.width, canvas.height));
console.log(JSON.stringify({ out, pdf: args.pdf || null, seed: input.seed, size: [canvas.width, canvas.height],
  share: 'https://jiahe-chen.github.io/moji/?' + toQuery(input) }));
