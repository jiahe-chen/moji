// 分享链接：一幅字的全部参数都写在网址里，同一个链接打开永远是同一幅。
const KEYS = { text: 't', src: 'src', to: 'to', from: 'from', date: 'date', lead: 'lead', format: 'fmt', wild: 'w', seed: 's' };

export function toQuery(input) {
  const q = new URLSearchParams();
  for (const [k, short] of Object.entries(KEYS)) {
    const v = input[k];
    if (v === undefined || v === '' || v === null) continue;
    q.set(short, k === 'wild' ? Math.round(v * 100) : v);
  }
  return q.toString();
}

export function fromQuery(search, defaults) {
  const q = new URLSearchParams(search), out = { ...defaults };
  for (const [k, short] of Object.entries(KEYS)) {
    if (!q.has(short)) continue;
    const v = q.get(short);
    out[k] = k === 'wild' ? Math.min(1, Math.max(0, +v / 100)) : k === 'seed' ? (+v | 0) : v;
  }
  return out;
}
