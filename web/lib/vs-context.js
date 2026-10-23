var VSContext = (function(exports) {
  "use strict";var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  function detectorSize(width, height, limit) {
    const k = Math.min(1, limit / Math.max(width, height));
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
  exports.moduleWorker = moduleWorker;
  exports.unreadParts = unreadParts;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
  return exports;
})({});
