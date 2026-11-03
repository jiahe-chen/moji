// AI 选句代理的地址。部署 server/ 之后把线上地址填在这里；留空则网页不显示 AI 选句面板。
// 本地开发时（localhost）自动连本机的 node server/server.mjs。
const ONLINE = 'https://noji-ai-yvndopgaqo.cn-hangzhou.fcapp.run/api/suggest';
export const AI_ENDPOINT = ['localhost', '127.0.0.1'].includes(location.hostname)
  ? 'http://localhost:8787/api/suggest'
  : ONLINE;
