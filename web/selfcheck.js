// VaultSnip self-check (Phase 4c): compares each visual of a replica built on the device with its panel in the masked
// image, on the device, and says how alike they look. Each side is reduced to a coarse grid of where its ink lies
// (cells over its own inked area, so padding and scale do not matter) and its main colour; a visual whose grid or colour
// is unlike its panel's is flagged for the user to check. Nothing leaves the page: both images are already here.
(function (global) {
  'use strict';
  const GW = 16, GH = 10;
  const maskGrey = (r, g, b) => Math.abs(r - 0x78) <= 6 && Math.abs(g - 0x7c) <= 6 && Math.abs(b - 0x82) <= 6;

  /** The commonest colour along an image's border: its background. */
  function background(d, w, h) {
    const n = new Map();
    const add = (x, y) => { const i = (y * w + x) * 4, k = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3); n.set(k, (n.get(k) || 0) + 1); };
    for (let x = 0; x < w; x += 2) { add(x, 0); add(x, h - 1); }
    for (let y = 0; y < h; y += 2) { add(0, y); add(w - 1, y); }
    let best = 0, bk = 0; for (const [k, c] of n) if (c > best) { best = c; bk = k; }
    return [((bk >> 10) & 31) * 8 + 4, ((bk >> 5) & 31) * 8 + 4, (bk & 31) * 8 + 4];
  }

  /**
   * The signature of an image (ImageData-like: data, width, height): ink cells on a GW × GH grid laid over its inked
   * area, how much ink, and its main vivid colour. Mask grey counts as ink (text), as the replica's text does.
   */
  function signature(img, words) {
    const d = img.data, w = img.width, h = img.height, bg = background(d, w, h);
    // marks only: text is left out (word boxes here, text elements in the replica), and faint greys (gridlines, axes,
    // card borders) count as background; a colour counts at a smaller difference than a grey
    const text = new Uint8Array(w * h);
    for (const t of words || []) for (let y = Math.max(0, Math.floor(t.y) - 1); y < Math.min(h, Math.ceil(t.y + t.h) + 1); y++) for (let x = Math.max(0, Math.floor(t.x) - 1); x < Math.min(w, Math.ceil(t.x + t.w) + 1); x++) text[y * w + x] = 1;
    const ink = (i) => {
      if (text[i >> 2]) return false;
      const r = d[i], g = d[i + 1], b = d[i + 2], diff = Math.max(Math.abs(r - bg[0]), Math.abs(g - bg[1]), Math.abs(b - bg[2]));
      return !maskGrey(r, g, b) && (Math.max(r, g, b) - Math.min(r, g, b) >= 30 ? diff > 28 : diff > 70);
    };
    let x0 = w, y0 = h, x1 = -1, y1 = -1, total = 0;
    const step = Math.max(1, Math.round(Math.sqrt((w * h) / 40000)));
    const hues = new Map();
    for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4; if (!ink(i)) continue;
      total++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx - mn >= 40 && !maskGrey(r, g, b)) { const hue = Math.round(((mx === r ? (g - b) / (mx - mn) : mx === g ? 2 + (b - r) / (mx - mn) : 4 + (r - g) / (mx - mn)) * 60 + 360) % 360 / 30); hues.set(hue, (hues.get(hue) || 0) + 1); }
    }
    const cells = new Uint8Array(GW * GH);
    if (x1 < 0) return { cells, ink: 0, hue: -1, vivid: 0 };
    const cw = (x1 - x0 + 1) / GW, ch = (y1 - y0 + 1) / GH, count = new Uint16Array(GW * GH), seen = new Uint16Array(GW * GH);
    for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) {
      const c = Math.min(GH - 1, Math.floor((y - y0) / ch)) * GW + Math.min(GW - 1, Math.floor((x - x0) / cw));
      seen[c]++; if (ink((y * w + x) * 4)) count[c]++;
    }
    for (let c = 0; c < cells.length; c++) cells[c] = seen[c] && count[c] / seen[c] >= 0.12 ? 1 : 0;
    // the kind of marks, whatever their layout: how long ink runs across and down (relative to the inked area: columns
    // run down, bars across, lines neither, areas both) and how much of the area is filled
    let hRun = 0, hN = 0, vRun = 0, vN = 0;
    for (let y = y0; y <= y1; y += step) { let r = 0; for (let x = x0; x <= x1 + 1; x++) { if (x <= x1 && ink((y * w + x) * 4)) r++; else if (r) { hRun += r; hN++; r = 0; } } }
    for (let x = x0; x <= x1; x += step) { let r = 0; for (let y = y0; y <= y1 + 1; y++) { if (y <= y1 && ink((y * w + x) * 4)) r++; else if (r) { vRun += r; vN++; r = 0; } } }
    const across = hN ? hRun / hN / (x1 - x0 + 1) : 0, down = vN ? vRun / vN / (y1 - y0 + 1) : 0;
    const filled = total / Math.max(1, ((x1 - x0) / step + 1) * ((y1 - y0) / step + 1));
    let hue = -1, hn = 0; for (const [k, c] of hues) if (c > hn) { hn = c; hue = k; }
    return { cells, ink: total, hue, vivid: hn / Math.max(1, total), across, down, filled };
  }

  /** 0-1: how alike two signatures are (ink cells in common over ink cells in either; less when their colours differ). */
  function similarity(a, b) {
    let both = 0, either = 0;
    for (let i = 0; i < a.cells.length; i++) { if (a.cells[i] && b.cells[i]) both++; if (a.cells[i] || b.cells[i]) either++; }
    const grid = either ? both / either : 1;
    // (the kind of marks: each texture figure compared as a ratio, 1 when equal)
    const ratio = (p, q) => (p + q > 0 ? Math.min(p, q) / Math.max(p, q) : 1);
    const kind = (ratio(a.across, b.across) + ratio(a.down, b.down) + ratio(a.filled, b.filled)) / 3;
    const shape = 0.4 * grid + 0.6 * kind;
    // (a vivid original and a vivid replica of another hue family are less alike; greys say nothing either way)
    const hueOff = a.hue >= 0 && b.hue >= 0 && a.vivid > 0.2 && b.vivid > 0.2 && Math.min(Math.abs(a.hue - b.hue), 12 - Math.abs(a.hue - b.hue)) > 2;
    return Math.round(shape * (hueOff ? 0.85 : 1) * 100) / 100;
  }

  /** An SVG element drawn onto a canvas of the given size, on the given background: a promise of its ImageData. */
  function rasterize(svg, w, h, bg) {
    return new Promise((resolve, reject) => {
      const clone = svg.cloneNode(true);
      clone.querySelectorAll('text').forEach((t) => t.remove());
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('width', w); clone.setAttribute('height', h);
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
      const im = new Image();
      im.onload = () => {
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const x = c.getContext('2d'); x.fillStyle = bg || '#fff'; x.fillRect(0, 0, w, h); x.drawImage(im, 0, 0, w, h);
        URL.revokeObjectURL(url); resolve(x.getImageData(0, 0, w, h));
      };
      im.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      im.src = url;
    });
  }

  /**
   * Compares every visual of a rendered replica (root, with cards carrying data-vid) with its box in the masked image
   * (a canvas): a promise of { vid: similarity }. Visuals without a box or a drawn chart (KPIs, tables, text) are left
   * out: their look depends on the replica's own styling more than on the original.
   */
  async function compare(root, masked, boxes, words) {
    const out = {}, mx = masked.getContext('2d');
    for (const card of root.querySelectorAll('[data-vid]')) {
      const vid = card.dataset.vid, b = boxes[vid], svg = card.querySelector('.rp-chart svg');
      if (!b || !svg) continue;
      const [x0, y0, x1, y1] = b.map(Math.round), w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
      const local = (words || []).filter((t) => t.x + t.w > x0 && t.x < x1 && t.y + t.h > y0 && t.y < y1).map((t) => ({ x: t.x - x0, y: t.y - y0, w: t.w, h: t.h }));
      const orig = signature(mx.getImageData(x0, y0, w, h), local);
      const r = svg.getBoundingClientRect(), bg = getComputedStyle(card).backgroundColor;
      try { out[vid] = similarity(orig, signature(await rasterize(svg, Math.round(r.width), Math.round(r.height), bg))); } catch (e) { /* not comparable: no flag */ }
    }
    return out;
  }

  global.VSSelfCheck = { signature, similarity, rasterize, compare };
})(typeof window !== 'undefined' ? window : globalThis);
