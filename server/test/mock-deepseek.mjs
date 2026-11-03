// 模拟 DeepSeek 的 Messages 和 Search 接口，用来在没有 Key 的情况下测试 server/ 的完整流程。
// 第一轮返回一个 web_search 工具调用，第二轮返回选句 JSON。
import http from 'node:http';
let calls = 0;
http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  const data = JSON.parse(body || '{}');
  res.setHeader('content-type', 'application/json');
  if (req.url === '/v1/tools/search') {
    if (!req.headers.authorization?.startsWith('Bearer ')) { res.statusCode = 401; return res.end('{}'); }
    return res.end(JSON.stringify({ results: [{ url: 'https://example.org/xinglunan', title: '行路难·其一 李白', snippet: '长风破浪会有时，直挂云帆济沧海。', date: null }] }));
  }
  if (req.url === '/anthropic/v1/messages') {
    if (!req.headers['x-api-key'] || data.model !== 'deepseek-flash') { res.statusCode = 400; return res.end('{}'); }
    calls++;
    const last = data.messages[data.messages.length - 1];
    if (!Array.isArray(last.content)) {
      return res.end(JSON.stringify({ content: [{ type: 'tool_use', id: 'call_1', name: 'web_search', input: { queries: ['长风破浪会有时 原文 出处'] } }], stop_reason: 'tool_use', usage: { input_tokens: 500, output_tokens: 40 } }));
    }
    const found = JSON.parse(last.content[0].content);
    return res.end(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ suggestions: [{ text: '长风破浪会有时，直挂云帆济沧海。', author: '李白', work: '行路难·其一', src: '李白行路难句', lead: '长风', reason: '写事业抱负，适合升职。', sources: [found[0].url] }] }) }], stop_reason: 'end_turn', usage: { input_tokens: 900, output_tokens: 120 } }));
  }
  res.statusCode = 404; res.end('{}');
}).listen(8799, () => console.log('mock on 8799'));
