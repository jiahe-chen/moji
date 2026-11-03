// AI 选句助手：DeepSeek V4.1（deepseek-flash）+ DeepSeek 官方搜索。
// 协议与 DeepSeek Harness（dsh）一致：对话走 Messages 接口，搜索走 /v1/tools/search。
// 只开放一个工具 web_search，不能读写文件、不能执行命令，适合放在公网代理后面。

const BASE = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');   // 测试时可指向本地模拟服务
const MESSAGES_URL = `${BASE}/anthropic/v1/messages`;
const SEARCH_URL = `${BASE}/v1/tools/search`;
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-flash';
const MAX_ROUNDS = 6;

const SYSTEM = `你是“墨迹 moji”书法生成器的选句助手。用户会描述想把字送给谁、什么场合、什么风格，你推荐适合写成书法的古典诗词或名句。

要求：
1. 推荐 3 条，内容各不相同，按合适程度排序。每条 4 到 28 个汉字为宜，最长不超过 40 字；可以是整首短诗，也可以是名句节选。
2. 每条都必须先用 web_search 核对原文、作者和篇名，以权威来源（古诗文网、维基文库、百度百科等）为准，不要凭记忆。核对不了的不要推荐。
3. 落款出处写成“作者+篇名+句”的简写，如“李白行路难句”“苏轼定风波句”；整首诗写“李白静夜思”。
4. 引首章给两个字，从同一首作品里挑，最好有点巧思或彩蛋。
5. 理解网络用语：用户说“抽象”通常是“搞笑、有梗”，不是哲学上的抽象。
6. 最后只输出一个 JSON 对象，不要任何其他文字，格式：
{"suggestions":[{"text":"正文（保留原文标点）","author":"作者","work":"篇名","src":"落款出处","lead":"两字","reason":"为什么适合，一两句","sources":["核对用的网址"]}]}`;

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

function parseJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('模型没有返回 JSON');
  const data = JSON.parse(m[0]);
  if (!Array.isArray(data.suggestions)) throw new Error('返回格式不对');
  return data.suggestions.slice(0, 5).map(s => ({
    text: String(s.text || ''), author: String(s.author || ''), work: String(s.work || ''),
    src: String(s.src || ''), lead: String(s.lead || '').slice(0, 2), reason: String(s.reason || ''),
    sources: (Array.isArray(s.sources) ? s.sources : []).filter(u => /^https?:\/\//.test(u)).slice(0, 3),
  })).filter(s => s.text);
}

/** 跑一轮选句。返回 { suggestions, searches, usage }。 */
export async function suggest({ apiKey, request }) {
  const messages = [{ role: 'user', content: request }];
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
      return { suggestions: parseJson(text), searches, usage };
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
