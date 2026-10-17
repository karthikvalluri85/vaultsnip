var VSContext = (function(exports) {
  "use strict";var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  const CONTEXT_TYPE = "Name in context";
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
      const scores = await this.request({ type: "score", lines }, signal);
      if (!scores || scores.length !== lines.length || scores.some((s, i) => s.length !== lines[i].length)) {
        throw new Error("ML worker returned scores that do not match the lines sent");
      }
      return scores;
    }
    dispose() {
      this.reset(new Error("Contextual scanner was closed"));
    }
    request(body, signal) {
      if (signal?.aborted) return Promise.reject(abortError());
      const worker = this.ensureWorker();
      const id = this.nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => this.reset(new Error(`ML worker did not answer within ${this.timeoutMs} ms`)), this.timeoutMs);
        this.pending.set(id, { resolve, reject, timer });
        signal?.addEventListener("abort", () => this.settle(id, (p) => p.reject(abortError())), { once: true });
        worker.postMessage({ ...body, id });
      });
    }
    ensureWorker() {
      if (this.worker) return this.worker;
      const w = this.spawn();
      w.addEventListener("message", (e) => {
        const r = e.data;
        this.settle(r.id, (p) => r.ok ? p.resolve(r.scores) : p.reject(new Error(r.error)));
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
  exports.contextualHits = contextualHits;
  exports.moduleWorker = moduleWorker;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
  return exports;
})({});
