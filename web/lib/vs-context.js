var VSContext = (function(exports) {
  "use strict";var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  function detectorSize(width, height, limit) {
    const k = Math.min(1, limit / Math.sqrt(width * height), 4 * limit / Math.max(width, height));
    return { width: Math.max(32, Math.round(width * k / 32) * 32), height: Math.max(32, Math.round(height * k / 32) * 32) };
  }
  const UNREAD_DEFAULTS = { minGap: 0.6, pad: 0.35, maxUncovered: 0.25 };
  function unreadParts(regions, cover, opts = {}) {
    const o = { ...UNREAD_DEFAULTS, ...opts };
    const out = [];
    for (const r of regions) {
      const k = r.core ?? r;
      const near = cover.filter((c) => c.x < k.x + k.w && c.x + c.w > k.x && c.y < k.y + k.h && c.y + c.h > k.y);
      if (k.w >= 2 * k.h) {
        const pad = o.pad * k.h;
        const spans = near.filter((c) => Math.min(c.y + c.h, k.y + k.h) - Math.max(c.y, k.y) >= 0.5 * Math.min(c.h, k.h)).map((c) => [Math.max(k.x, c.x - pad), Math.min(k.x + k.w, c.x + c.w + pad)]).sort((a, b) => a[0] - b[0]);
        let at = k.x;
        const gaps = [];
        for (const [a, b] of spans) {
          if (a > at) gaps.push([at, a]);
          at = Math.max(at, b);
        }
        if (at < k.x + k.w) gaps.push([at, k.x + k.w]);
        for (const [a, b] of gaps) {
          if (b - a < o.minGap * k.h) continue;
          const x0 = a <= k.x ? r.x : a, x1 = b >= k.x + k.w ? r.x + r.w : b;
          out.push({ x: x0, y: r.y, w: x1 - x0, h: r.h });
        }
      } else if (uncovered(k, near) > o.maxUncovered) {
        out.push({ x: r.x, y: r.y, w: r.w, h: r.h });
      }
    }
    return out;
  }
  function uncovered(b, boxes) {
    if (!boxes.length) return 1;
    const nx = 12, ny = 12;
    let miss = 0;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const px = b.x + (i + 0.5) / nx * b.w, py = b.y + (j + 0.5) / ny * b.h;
      if (!boxes.some((m) => px >= m.x && px <= m.x + m.w && py >= m.y && py <= m.y + m.h)) miss++;
    }
    return miss / (nx * ny);
  }
  function flatMarksOnly(px, textH) {
    return solidBlocks(px, textH) >= 0;
  }
  function solidBlocks(px, textH) {
    const { data, width: w, height: h } = px;
    if (w < 1 || h < 1) return 0;
    let blocks = 0;
    const at = (i) => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const counts = /* @__PURE__ */ new Map();
    const key = (i) => data[i * 4] >> 4 << 8 | data[i * 4 + 1] >> 4 << 4 | data[i * 4 + 2] >> 4;
    for (let x = 0; x < w; x++) for (const y of [0, h - 1]) {
      const k = key(y * w + x);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    for (let y = 0; y < h; y++) for (const x of [0, w - 1]) {
      const k = key(y * w + x);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    const bgKey = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    let bgPx = -1;
    for (let i = 0; i < w * h && bgPx < 0; i++) if (key(i) === bgKey) bgPx = i;
    const bg = at(bgPx);
    const ink = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) ink[i] = dist(at(i), bg) > 24 ? 1 : 0;
    const seen = new Uint8Array(w * h), stack = new Int32Array(w * h);
    for (let s = 0; s < w * h; s++) {
      if (!ink[s] || seen[s]) continue;
      const members = [];
      let top = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
      stack[top++] = s;
      seen[s] = 1;
      while (top) {
        const p = stack[--top], x = p % w, y = (p - x) / w;
        members.push(p);
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
          if (q >= 0 && ink[q] && !seen[q]) {
            seen[q] = 1;
            stack[top++] = q;
          }
        }
      }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      if (members.length <= 4 || Math.min(bw, bh) <= 2) continue;
      if (Math.max(bw, bh) < textH || Math.min(bw, bh) < 3 || members.length < 0.85 * bw * bh) return -1;
      const inner = members.filter((p) => {
        const x = p % w, y = (p - x) / w;
        return x > x0 + 1 && x < x1 - 1 && y > y0 + 1 && y < y1 - 1;
      });
      if (inner.length) {
        const ref = at(inner[0]);
        let off = 0;
        for (const p of inner) if (dist(at(p), ref) > 40) off++;
        if (off > 2) return -1;
      }
      const inBox = new Uint8Array(bw * bh), reach = new Int32Array(bw * bh);
      for (const p of members) {
        const x = p % w, y = (p - x) / w;
        inBox[(y - y0) * bw + (x - x0)] = 1;
      }
      let rt = 0, holes = bw * bh - members.length;
      for (let yy = 0; yy < bh; yy++) for (let xx = 0; xx < bw; xx++) {
        const q = yy * bw + xx;
        if ((xx === 0 || yy === 0 || xx === bw - 1 || yy === bh - 1) && !inBox[q]) {
          inBox[q] = 2;
          reach[rt++] = q;
        }
      }
      while (rt) {
        const q = reach[--rt];
        holes--;
        const xx = q % bw, yy = (q - xx) / bw;
        for (const r of [xx > 0 ? q - 1 : -1, xx < bw - 1 ? q + 1 : -1, yy > 0 ? q - bw : -1, yy < bh - 1 ? q + bw : -1]) {
          if (r >= 0 && !inBox[r]) {
            inBox[r] = 2;
            reach[rt++] = r;
          }
        }
      }
      if (holes > 2) return -1;
      blocks++;
    }
    return blocks;
  }
  function isBar(px, textH) {
    const { data, width: w, height: h } = px;
    if (w < 3 || h < 3) return false;
    const counts = /* @__PURE__ */ new Map();
    const key = (i) => data[i * 4] >> 4 << 8 | data[i * 4 + 1] >> 4 << 4 | data[i * 4 + 2] >> 4;
    for (let i = 0; i < w * h; i++) {
      const k = key(i);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    const [topKey, topN] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topN < 0.5 * w * h) return false;
    let ref = 0;
    while (key(ref) !== topKey) ref++;
    const c = [data[ref * 4], data[ref * 4 + 1], data[ref * 4 + 2]];
    const near = (i) => Math.hypot(data[i * 4] - c[0], data[i * 4 + 1] - c[1], data[i * 4 + 2] - c[2]) <= 40;
    const rows = [], cols = [];
    for (let y = 0; y < h; y++) {
      let n = 0;
      for (let x = 0; x < w; x++) if (near(y * w + x)) n++;
      if (n >= 0.5 * w) rows.push(y);
    }
    if (!rows.length) return false;
    const y0 = rows[0], y1 = rows[rows.length - 1];
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let y = y0; y <= y1; y++) if (near(y * w + x)) n++;
      if (n >= 0.5 * (y1 - y0 + 1)) cols.push(x);
    }
    if (!cols.length) return false;
    const x0 = cols[0], x1 = cols[cols.length - 1], bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (Math.max(bw, bh) < textH || Math.min(bw, bh) < 3) return false;
    let off = 0;
    for (let y = y0 + 1; y < y1; y++) for (let x = x0 + 1; x < x1; x++) if (!near(y * w + x)) off++;
    return off <= 2;
  }
  function isShapes(px, textH) {
    const { data, width: w, height: h } = px;
    if (h < 1.5 * textH || w < 3) return false;
    const n = w * h;
    const q = (i) => data[i * 4] >> 4 << 8 | data[i * 4 + 1] >> 4 << 4 | data[i * 4 + 2] >> 4;
    const counts = /* @__PURE__ */ new Map();
    for (let i = 0; i < n; i++) counts.set(q(i), (counts.get(q(i)) || 0) + 1);
    const palette = [...counts.entries()].filter(([, c]) => c >= n * 0.03).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => {
      let i = 0;
      while (q(i) !== k) i++;
      return [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
    });
    if (palette.length < 2) return false;
    const label = new Int8Array(n);
    for (let i = 0; i < n; i++) {
      let best = -1, bd = 60;
      palette.forEach((c, k) => {
        const d = Math.hypot(data[i * 4] - c[0], data[i * 4 + 1] - c[1], data[i * 4 + 2] - c[2]);
        if (d <= bd) {
          bd = d;
          best = k;
        }
      });
      label[i] = best;
    }
    let foreign = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (label[y * w + x] >= 0) continue;
      const seen2 = /* @__PURE__ */ new Set();
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && label[yy * w + xx] >= 0) seen2.add(label[yy * w + xx]);
      }
      if (seen2.size < 2 && ++foreign > 3) return false;
    }
    const dist = new Int32Array(n).fill(1 << 20);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, l = label[i];
      if (x > 0 && label[i - 1] !== l || x < w - 1 && label[i + 1] !== l || y > 0 && label[i - w] !== l || y < h - 1 && label[i + w] !== l) dist[i] = 0;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x > 0) dist[i] = Math.min(dist[i], dist[i - 1] + 1);
      if (y > 0) dist[i] = Math.min(dist[i], dist[i - w] + 1, x > 0 ? dist[i - w - 1] + 1 : 1 << 20, x < w - 1 ? dist[i - w + 1] + 1 : 1 << 20);
    }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (x < w - 1) dist[i] = Math.min(dist[i], dist[i + 1] + 1);
      if (y < h - 1) dist[i] = Math.min(dist[i], dist[i + w] + 1, x < w - 1 ? dist[i + w + 1] + 1 : 1 << 20, x > 0 ? dist[i + w - 1] + 1 : 1 << 20);
    }
    const need = Math.max(0.8 * textH, 0.3 * Math.min(w, h));
    const seen = new Uint8Array(n), stack = new Int32Array(n);
    let thick = 0;
    for (let s = 0; s < n; s++) {
      if (seen[s] || label[s] < 0) continue;
      const l = label[s];
      let top = 0, count = 0, r = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
      stack[top++] = s;
      seen[s] = 1;
      while (top) {
        const p = stack[--top], x = p % w, y = (p - x) / w;
        count++;
        r = Math.max(r, dist[p]);
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        for (const nb of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
          if (nb >= 0 && !seen[nb] && label[nb] === l) {
            seen[nb] = 1;
            stack[top++] = nb;
          }
        }
      }
      if (2 * r + 1 >= need) thick++;
      else if (count > 4 && Math.min(x1 - x0 + 1, y1 - y0 + 1) > 2 && !((x0 === 0 || y0 === 0 || x1 === w - 1 || y1 === h - 1) && count <= n * 0.3)) return false;
    }
    return thick >= 2;
  }
  const CONTEXT_TYPE = "Name in context";
  const UNREAD_TYPE = "Unread text";
  class ContextClassifier {
    constructor(spawn, opts = {}) {
      __publicField(this, "spawn");
      __publicField(this, "worker", null);
      __publicField(this, "pending", /* @__PURE__ */ new Map());
      __publicField(this, "nextId", 1);
      __publicField(this, "timeoutMs");
      this.spawn = spawn;
      this.timeoutMs = opts.timeoutMs ?? 3e4;
    }
    /** Loads the model ahead of the first scan. */
    warmup() {
      return this.request({ type: "warmup" }).then(() => void 0);
    }
    /** One [P(person), P(organisation)] pair per word, shaped like `lines`. */
    async score(lines, signal) {
      if (lines.length === 0) return [];
      const { scores } = await this.request({ type: "score", lines }, signal);
      if (!scores || scores.length !== lines.length || scores.some((s, i) => s.length !== lines[i].length)) {
        throw new Error("ML worker returned scores that do not match the lines sent");
      }
      return scores;
    }
    /**
     * Boxes around the text in an image, in its pixels. The image must already be at the detector's input size
     * (detectorSize); its pixels are transferred to the worker, so the caller must not use them afterwards.
     */
    async detect(image, signal) {
      const { regions } = await this.request({ type: "detect", image }, signal, [image.data.buffer]);
      if (!Array.isArray(regions)) throw new Error("ML worker returned no text regions");
      return regions;
    }
    /** One straightened line of text read by the second-look reader. Its pixels are transferred to the worker. */
    async read(image, signal) {
      const { reading } = await this.request({ type: "read", image }, signal, [image.data.buffer]);
      if (!reading) throw new Error("ML worker returned no reading");
      return reading;
    }
    dispose() {
      this.reset(new Error("Contextual scanner was closed"));
    }
    request(body, signal, transfer = []) {
      if (signal?.aborted) return Promise.reject(abortError());
      const worker = this.ensureWorker();
      const id = this.nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => this.reset(new Error(`ML worker did not answer within ${this.timeoutMs} ms`)), this.timeoutMs);
        this.pending.set(id, { resolve, reject, timer });
        signal?.addEventListener("abort", () => this.settle(id, (p) => p.reject(abortError())), { once: true });
        worker.postMessage({ ...body, id }, transfer);
      });
    }
    ensureWorker() {
      if (this.worker) return this.worker;
      const w = this.spawn();
      w.addEventListener("message", (e) => {
        const r = e.data;
        this.settle(r.id, (p) => r.ok ? p.resolve(r) : p.reject(new Error(r.error)));
      });
      const crash = (what) => () => {
        if (this.worker === w) this.reset(new Error(what));
      };
      w.addEventListener("error", crash("ML worker crashed"));
      w.addEventListener("messageerror", crash("ML worker sent an unreadable message"));
      return this.worker = w;
    }
    settle(id, fn) {
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      clearTimeout(p.timer);
      fn(p);
    }
    reset(err) {
      this.worker?.terminate();
      this.worker = null;
      const all = [...this.pending.values()];
      this.pending.clear();
      for (const p of all) {
        clearTimeout(p.timer);
        p.reject(err);
      }
    }
  }
  function abortError() {
    const e = new Error("Contextual scan was cancelled");
    e.name = "AbortError";
    return e;
  }
  const moduleWorker = (url) => () => new Worker(url, { type: "module" });
  const DEFAULT_THRESHOLDS = { strong: 0.8, weak: 0.5 };
  const core = (t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  const hasLetter = (t) => /\p{L}/u.test(t);
  const isAcronym = (c) => c.length >= 2 && /^\p{Lu}[\p{Lu}\d&.]*$/u.test(c);
  function contextualHits(line, scores, t = DEFAULT_THRESHOLDS) {
    if (line.filter((w) => hasLetter(w.text)).length < 2) return [];
    const ent = scores.map(([per, org]) => per + org);
    const hits = [];
    line.forEach((w, i) => {
      if (!w.kept) return;
      const c = core(w.text);
      if (!/^\p{Lu}/u.test(c) || isAcronym(c)) return;
      const neighbour = Math.max(ent[i - 1] ?? 0, ent[i + 1] ?? 0);
      if (ent[i] >= t.strong || ent[i] >= t.weak && neighbour >= t.weak) hits.push(i);
    });
    return hits;
  }
  exports.CONTEXT_TYPE = CONTEXT_TYPE;
  exports.ContextClassifier = ContextClassifier;
  exports.DEFAULT_THRESHOLDS = DEFAULT_THRESHOLDS;
  exports.UNREAD_TYPE = UNREAD_TYPE;
  exports.contextualHits = contextualHits;
  exports.detectorSize = detectorSize;
  exports.flatMarksOnly = flatMarksOnly;
  exports.isBar = isBar;
  exports.isShapes = isShapes;
  exports.moduleWorker = moduleWorker;
  exports.unreadParts = unreadParts;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
  return exports;
})({});
