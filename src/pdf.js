// 把一张 JPEG 包成单页 PDF。页面尺寸按 dpi 换算，图片原样嵌入（DCTDecode），不需要第三方库。
export function jpegToPdf(jpeg, pxW, pxH, dpi = 300) {
  const w = (pxW / dpi * 72).toFixed(2), h = (pxH / dpi * 72).toFixed(2);
  const enc = new TextEncoder(), parts = [], offsets = [];
  let size = 0;
  const push = b => { parts.push(b); size += b.length; };
  const text = s => push(enc.encode(s));
  const obj = (n, body, stream) => {
    offsets[n] = size;
    text(`${n} 0 obj\n${body}\n`);
    if (stream) { text('stream\n'); push(stream); text('\nendstream\n'); }
    text('endobj\n');
  };
  const content = enc.encode(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`);
  text('%PDF-1.4\n'); push(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  obj(4, `<< /Type /XObject /Subtype /Image /Width ${pxW} /Height ${pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
  obj(5, `<< /Length ${content.length} >>`, content);
  const xref = size;
  text(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`);
  text(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(size); let p = 0;
  for (const b of parts) { out.set(b, p); p += b.length; }
  return out;
}
