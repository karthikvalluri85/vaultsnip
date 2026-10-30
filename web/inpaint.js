/* VaultSnip: in-place fidelity engine.
   The original screenshot stays the picture. Each sensitive text box is wiped with the background sampled around it and
   synthetic text is drawn back in the same place, size and colour; everything else (charts, maps, gridlines, legends,
   proprietary visuals) keeps its original pixels. A DOM layer over the picture gives each patched box a tooltip.
   clearBox is the flat (or gradient) fill for callers without pixel access; patch() clears pixel by pixel.
   Pure canvas and DOM, no network calls. Works in a page (window.VSInpaint) and in Node for the unit tests (module.exports). */
(function (global) {
  'use strict';

  const RING = 8;                       // px of background sampled around each box
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  const css = c => `rgb(${c.map(v => Math.round(v)).join(',')})`;
  const clampBox = (b, W, H) => {
    const x0 = Math.max(0, Math.floor(b.x)), y0 = Math.max(0, Math.floor(b.y));
    const x1 = Math.min(W, Math.ceil(b.x + b.w)), y1 = Math.min(H, Math.ceil(b.y + b.h));
    return { x0, y0, x1, y1 };
  };
  const px = (data, W, x, y) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };

  // The colour most of the pixels share (quantised histogram, then the mean of the winning bin): a gridline or a chart
  // mark crossing the ring is outvoted by the background instead of being averaged into a muddy grey.
  function dominant(pixels) {
    if (!pixels.length) return null;
    const bins = new Map();
    for (const p of pixels) {
      const k = (p[0] >> 3) << 10 | (p[1] >> 3) << 5 | (p[2] >> 3);
      const b = bins.get(k) || bins.set(k, { n: 0, r: 0, g: 0, b: 0 }).get(k);
      b.n++; b.r += p[0]; b.g += p[1]; b.b += p[2];
    }
    let best = null;
    for (const b of bins.values()) if (!best || b.n > best.n) best = b;
    return { color: [best.r / best.n, best.g / best.n, best.b / best.n], share: best.n / pixels.length };
  }

  // Samples a ring of `ring` px around the box (outside it, clipped to the image) on each side.
  // Returns the dominant colour of the whole ring, and of each side, so a vertical or horizontal gradient can be kept.
  function sampleBackground(data, W, H, box, ring = RING) {
    const { x0, y0, x1, y1 } = clampBox(box, W, H);
    const side = { top: [], bottom: [], left: [], right: [] }, all = [];
    for (let y = Math.max(0, y0 - ring); y < Math.min(H, y1 + ring); y++) {
      for (let x = Math.max(0, x0 - ring); x < Math.min(W, x1 + ring); x++) {
        if (x >= x0 && x < x1 && y >= y0 && y < y1) continue;
        const p = px(data, W, x, y);
        all.push(p);
        if (y < y0) side.top.push(p); else if (y >= y1) side.bottom.push(p);
        else if (x < x0) side.left.push(p); else side.right.push(p);
      }
    }
    // a box that fills the whole image has no ring: use its own edge
    if (!all.length) for (let x = x0; x < x1; x++) { all.push(px(data, W, x, y0)); all.push(px(data, W, x, y1 - 1)); }
    const d = dominant(all) || { color: [255, 255, 255], share: 1 };
    const s = k => (dominant(side[k]) || d).color;
    const out = { color: d.color, share: d.share, gradient: null };
    const top = s('top'), bottom = s('bottom'), left = s('left'), right = s('right');
    // a gradient only when both ends are clean and clearly differ (a flat card has the same colour all round)
    if (side.top.length && side.bottom.length && dist(top, bottom) > 18 && dist(left, right) <= 18) out.gradient = { dir: 'v', from: top, to: bottom };
    else if (side.left.length && side.right.length && dist(left, right) > 18 && dist(top, bottom) <= 18) out.gradient = { dir: 'h', from: left, to: right };
    return out;
  }

  // The text's own colour and weight, read from the pixels inside the box before they are cleared: the pixels furthest
  // from the background are the ink. When there is no clear ink, the inverse of the background's luminance.
  function sampleInk(data, W, H, box, bg) {
    const { x0, y0, x1, y1 } = clampBox(box, W, H);
    const inside = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) inside.push([x, y, px(data, W, x, y)]);
    const far = inside.map(q => dist(q[2], bg)).sort((a, b) => b - a);
    const max = far[0] || 0;
    if (max < 60) return { color: lum(bg) > 128 ? [32, 33, 36] : [240, 241, 243], weight: 400, ink: null };
    const cut = Math.max(60, max * 0.6), sum = [0, 0, 0];
    let n = 0, ix0 = Infinity, iy0 = Infinity, ix1 = -1, iy1 = -1, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (const [x, y, p] of inside) {
      if (dist(p, bg) < cut) continue;
      sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2]; n++;
      sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      if (x < ix0) ix0 = x; if (x > ix1) ix1 = x; if (y < iy0) iy0 = y; if (y > iy1) iy1 = y;
    }
    const ink = n ? { x: ix0, y: iy0, w: ix1 - ix0 + 1, h: iy1 - iy0 + 1 } : null;
    // ink coverage of the glyphs' own box: bold strokes fill more of it
    const cover = ink ? n / (ink.w * ink.h) : 0;
    // the line the text runs along: the main axis of its ink. A slanted or vertical axis label runs at an angle; its
    // size comes from the ink's spread across that axis (with ascenders and descenders, about 0.27 of the size)
    let slant = null;
    if (n > 20) {
      const mx = sx / n, my = sy / n, cxx = sxx / n - mx * mx, cyy = syy / n - my * my, cxy = sxy / n - mx * my;
      const tr = cxx + cyy, det = cxx * cyy - cxy * cxy, gap = Math.sqrt(Math.max(0, tr * tr / 4 - det));
      const major = tr / 2 + gap, minor = Math.max(0.01, tr / 2 - gap), angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
      if (major / minor > 6 && Math.abs(angle) > 0.35 && Math.abs(angle) < Math.PI / 2 + 0.01)
        slant = { angle, cx: mx, cy: my, length: 2 * Math.sqrt(3 * major), size: Math.sqrt(minor) / 0.27 };
    }
    // the height of the glyphs' main band: rows holding under a fifth of the busiest row's ink (a comma's tail, the
    // dot of a decimal point below the line) do not count
    let band = null;
    if (ink) {
      const rows = new Array(ink.h).fill(0);
      for (const [, y, p] of inside) if (dist(p, bg) >= cut) rows[y - ink.y]++;
      const top = Math.max(...rows), keep = rows.map((c, i) => (c >= top * 0.2 ? i : -1)).filter(i => i >= 0);
      band = keep.length ? keep[keep.length - 1] - keep[0] + 1 : ink.h;
    }
    return { color: n ? sum.map(v => v / n) : [32, 33, 36], weight: cover > 0.38 ? 700 : cover > 0.3 ? 600 : 400, ink, slant, band };
  }

  // Font size from the box height (Tier 2 rule: 75% of the box); when the glyphs' own height is known it is used instead,
  // as boxes are often padded.
  const fontSize = (box, ink) => Math.max(7, ink && ink.h >= 5 ? Math.round(ink.h / 0.72) : Math.round(box.h * 0.75));

  // Where the original text sat in its box: left, right or centred (from the gaps either side of the ink).
  function alignOf(box, ink) {
    if (!ink) return 'center';
    const l = ink.x - box.x, r = box.x + box.w - (ink.x + ink.w);
    if (Math.abs(l - r) <= Math.max(2, box.w * 0.08)) return 'center';
    return l < r ? 'left' : 'right';
  }

  // Everything a patch needs, read from the original pixels (never from a canvas already patched next door).
  // numeric: the box holds a number, whose glyphs all stand on the line at full height (so its main band is its height)
  function styleFor(data, W, H, box, numeric) {
    const bg = sampleBackground(data, W, H, box);
    const ink = sampleInk(data, W, H, box, bg.color);
    const glyphs = numeric && ink.ink && ink.band ? Object.assign({}, ink.ink, { h: ink.band }) : ink.ink;
    return { bg, ink: ink.color, weight: ink.weight, size: ink.slant ? Math.max(7, Math.round(ink.slant.size)) : fontSize(box, glyphs), align: alignOf(box, ink.ink), inkBox: ink.ink, slant: ink.slant };
  }

  function clearBox(ctx, box, bg) {
    if (bg.gradient) {
      const g = bg.gradient.dir === 'v'
        ? ctx.createLinearGradient(0, box.y, 0, box.y + box.h)
        : ctx.createLinearGradient(box.x, 0, box.x + box.w, 0);
      g.addColorStop(0, css(bg.gradient.from)); g.addColorStop(1, css(bg.gradient.to));
      ctx.fillStyle = g;
    } else ctx.fillStyle = css(bg.color);
    ctx.fillRect(box.x, box.y, box.w, box.h);
  }

  // Surgical clear: only the text's pixels are rewritten. In each column of the box, a pixel close to the colour just above
  // or just below the box at that column is background and stays (so a bar's top edge or a coloured cell border running
  // through the box survives); any other pixel is text, grown by one pixel for its anti-aliasing, and takes the colour of
  // the background beside it in its row, or else above or below it in its column. src: the original RGBA; dst: the RGBA written to.
  function inpaintRegion(src, dst, W, H, box, tol = 40) {
    const { x0, y0, x1, y1 } = clampBox(box, W, H), w = x1 - x0, h = y1 - y0;
    if (w < 1 || h < 1) return;
    const ink = new Uint8Array(w * h);
    for (let x = x0; x < x1; x++) {
      const top = px(src, W, x, Math.max(0, y0 - 1)), bot = px(src, W, x, Math.min(H - 1, y1));
      for (let y = y0; y < y1; y++) {
        const p = px(src, W, x, y);
        if (dist(p, top) > tol && dist(p, bot) > tol) ink[(y - y0) * w + (x - x0)] = 1;
      }
    }
    const grown = ink.slice();
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      if (!ink[j * w + i]) continue;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii >= 0 && jj >= 0 && ii < w && jj < h) grown[jj * w + ii] = 1;
      }
    }
    for (let i = 0; i < w; i++) {
      const x = x0 + i;
      for (let j = 0; j < h; j++) {
        if (!grown[j * w + i]) continue;
        const o = ((y0 + j) * W + x) * 4;
        // nearest background left and right in the same row: strokes are thin across, so this is the local background;
        // used when both sides agree (a horizontal edge through the text is then kept at its row)
        let l = i - 1; while (l >= 0 && grown[j * w + l]) l--;
        let r = i + 1; while (r < w && grown[j * w + r]) r++;
        const cl = px(src, W, Math.max(0, x0 + l), y0 + j), cr = px(src, W, Math.min(W - 1, x0 + r), y0 + j);
        if (dist(cl, cr) <= tol) {
          const k = (i - l) / (r - l);
          for (let c = 0; c < 3; c++) dst[o + c] = Math.round(cl[c] * (1 - k) + cr[c] * k);
          dst[o + 3] = 255;
          continue;
        }
        // otherwise the nearest background above and below (outside the box when the whole column is text)
        let a = j - 1; while (a >= 0 && grown[a * w + i]) a--;
        let b = j + 1; while (b < h && grown[b * w + i]) b++;
        const ya = Math.max(0, y0 + a), yb = Math.min(H - 1, y0 + b);
        const ca = px(src, W, x, ya), cb = px(src, W, x, yb), da = j - a, db = b - j;
        // across an edge (the two sides differ) the nearer side wins outright, so the edge stays sharp
        const k = dist(ca, cb) > tol ? (da <= db ? 0 : 1) : da / (da + db);
        for (let c = 0; c < 3; c++) dst[o + c] = Math.round(ca[c] * (1 - k) + cb[c] * k);
        dst[o + 3] = 255;
      }
    }
  }

  function drawText(ctx, box, text, st) {
    if (!text) return;
    let size = st.size;
    ctx.save();
    ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
    const font = () => `${st.weight} ${size}px ${FONT}`;
    ctx.font = font();
    ctx.fillStyle = css(st.ink); ctx.textBaseline = 'middle';
    // text a little too wide is narrowed (down to 75%) before it is made smaller, so it keeps the original's height
    const fit = room => {
      const wide = ctx.measureText(text).width;
      if (wide <= room) return 1;
      const k = room / wide;
      if (k >= 0.75) return k;
      size = Math.max(6, size * k / 0.75); ctx.font = font();
      return Math.min(1, room / ctx.measureText(text).width);
    };
    if (st.slant) {
      // slanted or vertical text: drawn along the same line, centred where the original was
      ctx.translate(st.slant.cx, st.slant.cy); ctx.rotate(st.slant.angle);
      const k = fit(Math.max(4, st.slant.length * 1.05));
      ctx.scale(k, 1); ctx.textAlign = 'center';
      ctx.fillText(text, 0, size * 0.04);
      ctx.restore();
      return;
    }
    const hk = fit(Math.max(4, box.w - 2));
    const mid = st.inkBox ? st.inkBox.y + st.inkBox.h / 2 : box.y + box.h / 2;
    let x;
    if (st.align === 'left') { ctx.textAlign = 'left'; x = st.inkBox ? st.inkBox.x : box.x + 1; }
    else if (st.align === 'right') { ctx.textAlign = 'right'; x = st.inkBox ? st.inkBox.x + st.inkBox.w : box.x + box.w - 1; }
    else { ctx.textAlign = 'center'; x = st.inkBox ? st.inkBox.x + st.inkBox.w / 2 : box.x + box.w / 2; }
    // narrowed about the anchor, so left, right and centred text keep their edge
    ctx.translate(x, 0); ctx.scale(hk, 1);
    ctx.fillText(text, 0, mid + size * 0.04);
    ctx.restore();
  }

  // OCR sometimes reads a chart shape (a bar, a map region) as a large "2" or "4 8". Such a box is left as it is: clearing
  // it would erase part of the chart, and drawing a number would add a large stray digit. A box is taken for a shape when
  // it is much taller than the page's text and either is mostly ink (text covers well under half of its box) or holds a
  // short, low-confidence reading on a background that is not plain (a large KPI value sits on a plain tile).
  // medH: the median height of the words read on the page; minConf: the lowest confidence of the words in the box.
  // A short reading (a legend's colour swatch read as "BM") whose box is mostly ink is a shape at any size.
  function looksLikeShape(data, W, H, box, medH, minConf, text) {
    const short = String(text || '').replace(/\s/g, '').length <= 3, tall = box.h > medH * 2.2;
    if (!tall && !short) return false;
    const bg = sampleBackground(data, W, H, box);
    const { x0, y0, x1, y1 } = clampBox(box, W, H);
    let n = 0, far = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { n++; if (dist(px(data, W, x, y), bg.color) > 60) far++; }
    if (n && far / n > (tall ? 0.45 : 0.4)) return true;     // boxes are padded: text fills well under 0.35 of one
    return tall && short && minConf < 75 && bg.share < 0.95;
  }

  // source: canvas or image of the original. patches: [{x,y,w,h,synthetic,...}] in source pixels.
  // Returns the patched canvas (same size as the source) and the patches with the style each one used.
  function patch(source, patches, opts) {
    const W = source.width, H = source.height;
    const doc = (opts && opts.document) || global.document;
    const out = (opts && opts.canvas) || doc.createElement('canvas');
    out.width = W; out.height = H;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0);
    const data = ctx.getImageData(0, 0, W, H).data;     // the original pixels: every patch samples from these
    // a patch marked keep (a chart shape read as text) is left exactly as it is
    const styled = patches.map(p => Object.assign({}, p, { style: styleFor(data, W, H, p, p.kind === 'number') }));
    // Slanted labels (names along an axis at 45°) are mostly found by the text detector, not read: such a region gets a
    // made-up label of about its length, drawn along its slant (opts.slantText(chars, patch)), and the few fragments the
    // reader did pick out inside it are cleared without text of their own.
    if (opts && opts.slantText) {
      // diagonal only (20-70°): a column of axis ticks also runs vertically, and is not one label
      const diag = a => Math.abs(a) > 0.35 && Math.abs(a) < 1.22;
      const slanted = styled.filter(p => p.kind === 'unread' && p.original !== '(table column)' && !p.keep && p.style.slant && diag(p.style.slant.angle));
      slanted.forEach(p => { p.synthetic = opts.slantText(Math.max(2, Math.round(p.style.slant.length / (p.style.size * 0.55))), p); });
      styled.forEach(p => {
        if (p.kind === 'unread' || !p.synthetic) return;
        const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
        if (slanted.some(s => cx > s.x && cx < s.x + s.w && cy > s.y && cy < s.y + s.h)) p.synthetic = '';
      });
    }
    const work = styled.filter(p => !p.keep);
    // clear all first, so no new text is wiped by a neighbour; every clear reads the original pixels
    const img = ctx.getImageData(0, 0, W, H);
    work.forEach(p => inpaintRegion(data, img.data, W, H, p));
    ctx.putImageData(img, 0, 0);
    work.forEach(p => drawText(ctx, p, p.synthetic, p.style));
    return { canvas: out, patches: styled };
  }

  /* ---------- Tier 3: the interactive layer ---------- */
  // host gets the patched picture at its own aspect ratio (it scales with the page, never distorts) and one focusable,
  // invisible hotspot per patch, positioned in percentages of the image so it stays on its pixels at every size.
  // describe(patch) returns the tooltip's lines: [title, ...details].
  function mount(host, canvas, patches, opts) {
    opts = opts || {};
    const doc = host.ownerDocument;
    host.innerHTML = '';
    host.classList.add('ip-stage');
    const frame = doc.createElement('div');
    frame.className = 'ip-frame';
    frame.style.aspectRatio = canvas.width + ' / ' + canvas.height;
    frame.style.maxWidth = canvas.width + 'px';
    canvas.classList.add('ip-canvas');
    canvas.setAttribute('role', 'img');
    if (opts.label) canvas.setAttribute('aria-label', opts.label);
    frame.appendChild(canvas);
    const layer = doc.createElement('div');
    layer.className = 'ip-layer';
    const tip = doc.createElement('div');
    tip.className = 'ip-tip'; tip.setAttribute('role', 'tooltip'); tip.id = 'ip-tip-' + Math.random().toString(36).slice(2, 8); tip.hidden = true;
    const pct = (v, of) => (100 * v / of).toFixed(4) + '%';
    const show = (el, p) => {
      const lines = (opts.describe ? opts.describe(p) : [p.synthetic || 'Hidden']) || [];
      tip.replaceChildren(...lines.map((t, i) => { const d = doc.createElement(i ? 'div' : 'strong'); d.textContent = t; return d; }));
      tip.hidden = false;
      const fr = frame.getBoundingClientRect(), r = el.getBoundingClientRect();
      const left = Math.min(Math.max(0, r.left - fr.left), Math.max(0, fr.width - tip.offsetWidth));
      const below = r.bottom - fr.top + 6, above = r.top - fr.top - tip.offsetHeight - 6;
      tip.style.left = left + 'px';
      tip.style.top = (above >= 0 && below + tip.offsetHeight > fr.height ? above : below) + 'px';
      el.setAttribute('aria-describedby', tip.id);
    };
    const hide = el => { if (el.classList.contains('is-active')) return; tip.hidden = true; el.removeAttribute('aria-describedby'); };
    patches.forEach((p, i) => {
      const el = doc.createElement('button');
      el.type = 'button';
      el.className = 'ip-spot';
      el.dataset.i = String(i);
      el.dataset.kind = p.kind || '';
      el.setAttribute('aria-label', (p.synthetic ? 'Synthetic: ' + p.synthetic : 'Hidden text') + (p.kind ? ' (' + p.kind + ')' : ''));
      Object.assign(el.style, { left: pct(p.x, canvas.width), top: pct(p.y, canvas.height), width: pct(p.w, canvas.width), height: pct(p.h, canvas.height) });
      el.addEventListener('mouseenter', () => show(el, p));
      el.addEventListener('focus', () => show(el, p));
      el.addEventListener('mouseleave', () => hide(el));
      el.addEventListener('blur', () => hide(el));
      el.addEventListener('click', () => {
        const on = !el.classList.contains('is-active');
        layer.querySelectorAll('.ip-spot.is-active').forEach(s => s.classList.remove('is-active'));
        el.classList.toggle('is-active', on);
        if (on) show(el, p); else hide(el);
        if (opts.onSelect) opts.onSelect(on ? p : null, i);
      });
      layer.appendChild(el);
    });
    frame.appendChild(layer);
    frame.appendChild(tip);
    host.appendChild(frame);
    return { frame, layer, tip, outline(on) { frame.classList.toggle('ip-outline', !!on); } };
  }

  const api = { RING, looksLikeShape, sampleBackground, sampleInk, fontSize, alignOf, styleFor, clearBox, inpaintRegion, drawText, patch, mount, dominant };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else global.VSInpaint = api;
})(typeof window !== 'undefined' ? window : globalThis);
