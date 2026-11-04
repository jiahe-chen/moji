// AI 助手：听懂用户的一句话，直接改书法的各个字段，需要新内容时选句并上网核对。
// 模型 DeepSeek V4.1（deepseek-flash），搜索用 DeepSeek 官方 Search 接口。
// 协议与 DeepSeek Harness（dsh）一致：对话走 Messages 接口，搜索走 /v1/tools/search。
// 只开放一个工具 web_search，不能读写文件、不能执行命令，适合放在公网代理后面。

const BASE = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');   // 测试时可指向本地模拟服务
const MESSAGES_URL = `${BASE}/anthropic/v1/messages`;
const SEARCH_URL = `${BASE}/v1/tools/search`;
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-flash';
const MAX_ROUNDS = 6;

const SYSTEM = `你是“墨迹 moji”书法生成器里的 AI 助手。网页上有一幅正在编辑的书法，它的全部字段如下：
- text：正文
- src：落款出处，写成“作者+篇名+句”，如“李白行路难句”“苏轼定风波句”；整首诗不加“句”，如“李白静夜思”
- to：赠给谁（受赠人的名字）
- from：署名（作者自己的名字，也会刻在名章上）
- date：落款日期，如“丙午秋”
- lead：引首章，1 到 2 个字
- format：版式。auto 自动、tiaofu 竖条幅、doufang 斗方、hengpi 横披
- wild：放纵度 0 到 1。0.2 端庄，0.5 适中，0.8 以上狂放欹侧

用户每次说一句话，你根据这句话和当前字段，决定要改哪些字段。

规则：
1. 从用户的话里识别人名和角色：“送给 X”“给 X”“赠 X” → to = X；“我是 Y”“署名 Y”“落款 Y” → from = Y。只填用户明确说出的，不要编造人名。
2. 用户要新内容、要换一句，或者当前正文明显不合适时，推荐 3 条古典诗词或名句，放进 suggestions。每条都必须先用 web_search 核对原文、作者、篇名，以古诗文网、维基文库、百度百科等权威来源为准，不要凭记忆。核对不了的不要推荐。每条 4 到 28 个汉字为宜，最长 40 字。
3. 如果用户只是改字段，比如“署名改成王五”“换成横的”“再狂一点”“不要引首章”，就不要搜索，也不要给 suggestions，只在 set 里放要改的字段。
4. 版式默认交给程序自动排：程序会把条幅、斗方、横披都排一遍，挑字最饱满、断句最自然的。只有用户明确说了横的、竖的、方的，或者点名条幅、斗方、横披，才在 set 里设 format；说“自动排”“随便”就设 auto。只说挂在哪里（办公室、客厅、书房）不算，不要设 format。
5. 风格：庄重、送长辈、送领导 → wild 0.2 到 0.35；一般 0.5；搞笑、有梗、狂放 → 0.75 到 0.9。网络用语里“抽象”通常是搞笑、有梗，不是哲学上的抽象。
6. 引首章从同一首作品里挑两个字，最好有点巧思或彩蛋。
7. 只输出一个 JSON 对象，不要任何其他文字：
{"reply":"一句话告诉用户你做了什么","set":{"只放要改的字段":"新值"},"suggestions":[{"text":"正文，保留原文标点","author":"作者","work":"篇名","src":"落款出处","lead":"两字","wild":0.5,"reason":"为什么适合，一两句","sources":["核对用的网址"]}]}
suggestions 按合适程度排序，第一条会被直接写出来，所以它的 text、src、lead 不要再放进 set。没有新内容时 suggestions 为 []。`;

const TOOLS = [{
  name: 'web_search',
  description: '在网上搜索，用来核对诗词原文、作者和出处。返回标题、网址和摘要。',
  input_schema: {
    type: 'object',
    properties: { queries: { type: 'array', items: { type: 'string' }, description: '1–4 个搜索词，结果合并返回' } },
    required: ['queries'],
  },
}];

async function search(apiKey, queries, question) {
  const results = [];
  for (const query of queries.slice(0, 4)) {
    const res = await fetch(SEARCH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query, count: 5, need_content: false, ori_question: question.slice(0, 128) }),
    });
    if (!res.ok) { results.push({ query, error: `搜索失败 ${res.status}` }); continue; }
    const data = await res.json();
    for (const r of data.results || []) results.push({ query, title: r.title, url: r.url, snippet: (r.summary || r.snippet || '').slice(0, 400) });
  }
  return results;
}

// 只收认识的字段，限制长度，防止模型或用户塞进奇怪的值
const TEXT_FIELDS = { text: 200, src: 40, to: 20, from: 20, date: 12, lead: 2 };
const FORMATS = ['auto', 'tiaofu', 'doufang', 'hengpi'];
export function cleanFields(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, max] of Object.entries(TEXT_FIELDS)) if (typeof obj[k] === 'string') out[k] = [...obj[k].trim()].slice(0, max).join('');
  if (FORMATS.includes(obj.format)) out.format = obj.format;
  const w = Number(obj.wild);
  if (obj.wild !== undefined && obj.wild !== null && obj.wild !== '' && Number.isFinite(w)) out.wild = Math.min(1, Math.max(0, w));
  return out;
}

function parseJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('模型没有返回 JSON');
  const data = JSON.parse(m[0]);
  const suggestions = (Array.isArray(data.suggestions) ? data.suggestions : []).slice(0, 5).map(s => ({
    ...cleanFields({ text: s.text, src: s.src, lead: s.lead, wild: s.wild }),   // 候选句不带版式，版式只听用户的，否则自动
    author: String(s.author || '').slice(0, 20), work: String(s.work || '').slice(0, 40), reason: String(s.reason || '').slice(0, 200),
    sources: (Array.isArray(s.sources) ? s.sources : []).filter(u => typeof u === 'string' && /^https?:\/\//.test(u)).slice(0, 3),
  })).filter(s => s.text);
  return { reply: String(data.reply || '').slice(0, 200), set: cleanFields(data.set), suggestions };
}

/** 根据用户的一句话和当前字段，决定改哪些字段、要不要推荐新句子。返回 { reply, set, suggestions, searches, usage }。 */
export async function suggest({ apiKey, request, current = {} }) {
  const messages = [{ role: 'user', content: `当前字段：${JSON.stringify(cleanFields(current))}\n用户说：${request}` }];
  const searches = [];
  const usage = { input: 0, output: 0 };
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await fetch(MESSAGES_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 4000, stream: false, system: SYSTEM, messages,
        thinking: { type: 'disabled' },
        // 最后一轮不再给工具，逼模型给出结果
        ...(round < MAX_ROUNDS - 1 ? { tools: TOOLS } : {}),
      }),
    });
    if (!res.ok) throw new Error(`DeepSeek 返回 ${res.status}：${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    usage.input += data.usage?.input_tokens || 0; usage.output += data.usage?.output_tokens || 0;
    const content = data.content || [];
    messages.push({ role: 'assistant', content });
    const calls = content.filter(b => b.type === 'tool_use');
    if (!calls.length) {
      const text = content.filter(b => b.type === 'text').map(b => b.text).join('');
      return { ...parseJson(text), searches, usage };
    }
    const results = [];
    for (const call of calls) {
      const queries = Array.isArray(call.input?.queries) ? call.input.queries.map(String) : [];
      searches.push(...queries);
      const found = await search(apiKey, queries, request);
      results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(found) });
    }
    messages.push({ role: 'user', content: results });
  }
  throw new Error('搜索轮数超过上限，没有得到结果');
}
