// 模拟 DeepSeek 的 Messages 和 Search 接口，用来在没有 Key 的情况下测试 server/ 和网页的完整流程。
// - 新需求：第一轮返回 web_search 工具调用，第二轮返回选句，并从“送给 X”“我是 Y”里识别人名
// - “署名改成 X”“换成竖的/横的”“再狂一点”：不搜索，直接返回要改的字段
// - 带“忽略”“系统提示”“骂”的：模拟护栏，婉拒
import http from 'node:http';

function edits(said) {
  const set = {};
  const name = said.match(/(?:署名|落款)改成([\p{Script=Han}]{1,4})/u);
  if (name) set.from = name[1];
  if (/竖/.test(said)) set.format = 'tiaofu';
  if (/横/.test(said)) set.format = 'hengpi';
  if (/狂/.test(said)) set.wild = .85;
  return set;
}

http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  const data = JSON.parse(body || '{}');
  res.setHeader('content-type', 'application/json');
  if (req.url === '/v1/tools/search') {
    if (!req.headers.authorization?.startsWith('Bearer ')) { res.statusCode = 401; return res.end('{}'); }
    return res.end(JSON.stringify({ results: [{ url: 'https://example.org/dengfeilaifeng', title: '登飞来峰 王安石', snippet: '不畏浮云遮望眼，自缘身在最高层。', date: null }] }));
  }
  if (req.url === '/anthropic/v1/messages') {
    if (!req.headers['x-api-key'] || data.model !== 'deepseek-flash') { res.statusCode = 400; return res.end('{}'); }
    const first = data.messages[0].content, said = first.split('用户说：')[1] || '';
    const usage = { input_tokens: 600, output_tokens: 80 };
    if (/忽略|系统提示|骂/.test(said)) {   // 模拟护栏：婉拒，什么都不改
      return res.end(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ reply: '这个不写哦，换个吉祥、励志的内容吧', set: {}, suggestions: [] }) }], stop_reason: 'end_turn', usage }));
    }
    const set = edits(said);
    if (Object.keys(set).length) {
      return res.end(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ reply: '已按你说的改好', set, suggestions: [] }) }], stop_reason: 'end_turn', usage }));
    }
    const last = data.messages[data.messages.length - 1];
    if (!Array.isArray(last.content)) {
      return res.end(JSON.stringify({ content: [{ type: 'tool_use', id: 'call_1', name: 'web_search', input: { queries: ['不畏浮云遮望眼 原文 出处'] } }], stop_reason: 'tool_use', usage }));
    }
    const found = JSON.parse(last.content[0].content);
    const to = said.match(/(?:送给|赠给|给)(?:[^，,。]*的)?([\p{Script=Han}]{2,3})(?=[，,。]|$)/u)?.[1];
    const from = said.match(/我是([\p{Script=Han}]{1,4}?)(?:，|,|。|$)/u)?.[1];
    return res.end(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({
      reply: `选了王安石《登飞来峰》${to ? `，赠${to}` : ''}${from ? `，署名${from}` : ''}`,
      set: { ...(to ? { to } : {}), ...(from ? { from } : {}) },
      suggestions: [
        { text: '不畏浮云遮望眼，自缘身在最高层。', author: '王安石', work: '登飞来峰', src: '王安石登飞来峰句', lead: '浮云', format: 'tiaofu', wild: .5, reason: '位置高了看得远，适合升职。', sources: [found[0].url] },
        { text: '长风破浪会有时，直挂云帆济沧海。', author: '李白', work: '行路难·其一', src: '李白行路难句', lead: '长风', format: 'tiaofu', wild: .55, reason: '事业抱负。', sources: [found[0].url] },
      ],
    }) }], stop_reason: 'end_turn', usage }));
  }
  res.statusCode = 404; res.end('{}');
}).listen(8799, () => console.log('mock on 8799'));
