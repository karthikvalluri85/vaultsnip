// VaultSnip "safe to share" receipt: one page that says what was hidden (counts and kinds, never the hidden text), that
// the pre-flight check passed, and that it was made on this device, with the SHA-256 of the masked image file it goes
// with. Drawn on a canvas here and saved as PNG, or as a one-page PDF written by hand: no library, nothing fetched.
(function (global) {
  'use strict';
  const W = 1000, PAD = 40, INK = '#14181e', MUTED = '#5b6470', LINE = '#d9dee4', ACCENT = '#0b6e4f';
  const SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif', MONO = 'ui-monospace, Consolas, Menlo, monospace';

  /** Lines of text no wider than max at the context's current font. */
  function wrap(x, text, max) {
    const out = [];
    String(text).split('\n').forEach((para) => {
      let line = '';
      para.split(/\s+/).filter(Boolean).forEach((word) => {
        const next = line ? line + ' ' + word : word;
        if (line && x.measureText(next).width > max) { out.push(line); line = word; } else line = next;
      });
      out.push(line);
    });
    return out;
  }

  /**
   * The receipt as a canvas. facts: { file, width, height, sha256, made (Date), rows: [[label, value]], note }.
   * image: the masked image (a canvas), drawn small at the top so the receipt shows which picture it describes.
   */
  function draw(facts, image) {
    const meas = document.createElement('canvas').getContext('2d');
    const labelW = 210, valueW = W - 2 * PAD - labelW;
    const thumbK = Math.min((W - 2 * PAD) / image.width, 380 / image.height, 1);
    const tw = Math.round(image.width * thumbK), th = Math.round(image.height * thumbK);
    // measure first: every row wraps to its own height
    const rows = facts.rows.map(([k, v, mono]) => {
      meas.font = (mono ? `14px ${MONO}` : `15px ${SANS}`);
      return { k, lines: wrap(meas, v, valueW), mono };
    });
    meas.font = `13px ${SANS}`;
    const note = wrap(meas, facts.note, W - 2 * PAD);
    const head = 92, rowsH = rows.reduce((h, r) => h + r.lines.length * 22 + 14, 0);
    const H = head + 24 + th + 28 + rowsH + 18 + note.length * 19 + PAD;
    const c = document.createElement('canvas'); c.width = W; c.height = Math.ceil(H);
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, c.height);
    x.fillStyle = INK; x.fillRect(0, 0, W, head);
    x.fillStyle = '#fff'; x.textBaseline = 'alphabetic';
    x.font = `700 26px ${SANS}`; x.fillText('Safe-to-share receipt', PAD, 46);
    x.font = `14px ${SANS}`; x.fillStyle = '#c9ced6'; x.fillText(facts.subtitle, PAD, 72);
    let y = head + 24;
    x.drawImage(image, PAD, y, tw, th);
    x.strokeStyle = LINE; x.lineWidth = 1; x.strokeRect(PAD + 0.5, y + 0.5, tw - 1, th - 1);
    y += th + 28;
    rows.forEach((r, i) => {
      if (i) { x.strokeStyle = LINE; x.beginPath(); x.moveTo(PAD, y - 8); x.lineTo(W - PAD, y - 8); x.stroke(); }
      x.fillStyle = MUTED; x.font = `600 14px ${SANS}`; x.fillText(r.k, PAD, y + 14);
      x.fillStyle = r.k === facts.passKey ? ACCENT : INK; x.font = r.mono ? `14px ${MONO}` : `15px ${SANS}`;
      r.lines.forEach((l, j) => x.fillText(l, PAD + labelW, y + 14 + j * 22));
      y += r.lines.length * 22 + 14;
    });
    y += 10;
    x.fillStyle = MUTED; x.font = `13px ${SANS}`;
    note.forEach((l, j) => x.fillText(l, PAD, y + j * 19));
    return c;
  }

  /** A one-page PDF of a JPEG the size of the canvas (96 dpi), with the receipt's facts in the document properties. */
  function pdf(canvas, info) {
    const bin = atob(canvas.toDataURL('image/jpeg', 0.92).split(',')[1]);
    const jpeg = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) jpeg[i] = bin.charCodeAt(i);
    const enc = new TextEncoder(), parts = [], offsets = [];
    let len = 0;
    const put = (b) => { const u = typeof b === 'string' ? enc.encode(b) : b; parts.push(u); len += u.length; };
    const obj = (n, body) => { offsets[n] = len; put(`${n} 0 obj\n`); body(); put('\nendobj\n'); };
    const text = (t) => '(' + String(t).replace(/[^\x20-\x7e]/g, '').replace(/[\\()]/g, '\\$&') + ')';
    const pw = (canvas.width * 0.75).toFixed(2), ph = (canvas.height * 0.75).toFixed(2);
    const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
    const d = info.made || new Date(), two = (n) => String(n).padStart(2, '0');
    const date = `D:${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
    put('%PDF-1.4\n');
    obj(1, () => put('<< /Type /Catalog /Pages 2 0 R >>'));
    obj(2, () => put('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
    obj(3, () => put(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`));
    obj(4, () => { put(`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`); put(jpeg); put('\nendstream'); });
    obj(5, () => put(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    obj(6, () => put(`<< /Title ${text(info.title)} /Subject ${text(info.subject)} /Creator ${text(info.creator)} /Producer (VaultSnip) /CreationDate (${date}) >>`));
    const xref = len;
    put(`xref\n0 7\n0000000000 65535 f \n${offsets.slice(1).map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(parts, { type: 'application/pdf' });
  }

  /** SHA-256 of a blob as hex, or '' where the browser offers no hashing (pages not served over https). */
  async function sha256(blob) {
    if (!global.crypto || !crypto.subtle) return '';
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
    return Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  const api = { draw, pdf, sha256, wrap };
  global.VSReceipt = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
