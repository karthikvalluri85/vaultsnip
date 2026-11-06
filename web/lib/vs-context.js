var VSContext = (function(exports) {
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	// \0@oxc-project+runtime@0.155.0/helpers/esm/typeof.js
	function _typeof(o) {
		"@babel/helpers - typeof";
		return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o) {
			return typeof o;
		} : function(o) {
			return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
		}, _typeof(o);
	}
	// \0@oxc-project+runtime@0.155.0/helpers/esm/toPrimitive.js
	function toPrimitive(t, r) {
		if ("object" != _typeof(t) || !t) return t;
		var e = t[Symbol.toPrimitive];
		if (void 0 !== e) {
			var i = e.call(t, r || "default");
			if ("object" != _typeof(i)) return i;
			throw new TypeError("@@toPrimitive must return a primitive value.");
		}
		return ("string" === r ? String : Number)(t);
	}
	// \0@oxc-project+runtime@0.155.0/helpers/esm/toPropertyKey.js
	function toPropertyKey(t) {
		var i = toPrimitive(t, "string");
		return "symbol" == _typeof(i) ? i : i + "";
	}
	// \0@oxc-project+runtime@0.155.0/helpers/esm/defineProperty.js
	function _defineProperty(e, r, t) {
		return (r = toPropertyKey(r)) in e ? Object.defineProperty(e, r, {
			value: t,
			enumerable: !0,
			configurable: !0,
			writable: !0
		}) : e[r] = t, e;
	}
	// src/shared/text-regions.ts
	/**
	* The input size for the detector: at most as many pixels as a `limit` x `limit` square (and no side over 4 x `limit`),
	* both sides multiples of 32, never upscaled. A budget of pixels, not a longest side: a tall full-page capture scaled
	* by its height left its text too small for the detector to find.
	*/
	function detectorSize(width, height, limit) {
		const k = Math.min(1, limit / Math.sqrt(width * height), 4 * limit / Math.max(width, height));
		return {
			width: Math.max(32, Math.round(width * k / 32) * 32),
			height: Math.max(32, Math.round(height * k / 32) * 32)
		};
	}
	var UNREAD_DEFAULTS = {
		minGap: .6,
		pad: .35,
		maxUncovered: .25
	};
	/**
	* The parts of each text region that nothing accounts for. `cover` holds the masks and the boxes of words the reader
	* read confidently and kept; anything else inside a region is text the reader missed or could not read.
	* Coverage is judged on each region's core (the text itself), and what is masked spans the grown box.
	* A line of text (a core at least twice as wide as tall) is checked along its length, so a kept title next to an
	* unread name masks only the name; any other region is masked whole when too much of its core is uncovered.
	*/
	function unreadParts(regions, cover, opts = {}) {
		const o = {
			...UNREAD_DEFAULTS,
			...opts
		};
		const out = [];
		for (const r of regions) {
			const k = r.core ?? r;
			const near = cover.filter((c) => c.x < k.x + k.w && c.x + c.w > k.x && c.y < k.y + k.h && c.y + c.h > k.y);
			if (k.w >= 2 * k.h) {
				const pad = o.pad * k.h;
				const spans = near.filter((c) => Math.min(c.y + c.h, k.y + k.h) - Math.max(c.y, k.y) >= .5 * Math.min(c.h, k.h)).map((c) => [Math.max(k.x, c.x - pad), Math.min(k.x + k.w, c.x + c.w + pad)]).sort((a, b) => a[0] - b[0]);
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
					out.push({
						x: x0,
						y: r.y,
						w: x1 - x0,
						h: r.h
					});
				}
			} else if (uncovered(k, near) > o.maxUncovered) out.push({
				x: r.x,
				y: r.y,
				w: r.w,
				h: r.h
			});
		}
		return out;
	}
	/** Share of box b not covered by any of the boxes, from a grid of sample points. */
	function uncovered(b, boxes) {
		if (!boxes.length) return 1;
		const nx = 12, ny = 12;
		let miss = 0;
		for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
			const px = b.x + (i + .5) / nx * b.w, py = b.y + (j + .5) / ny * b.h;
			if (!boxes.some((m) => px >= m.x && px <= m.x + m.w && py >= m.y && py <= m.y + m.h)) miss++;
		}
		return miss / 144;
	}
	/**
	* Whether an unread patch holds no text at all, only flat marks: a chart's bar beside its label, a legend chip, a
	* gridline or a tick. The detector often joins a label and the bar beside it into one line, and masking the bar's
	* part as unread text hides the chart. The patch passes only when every piece of ink in it is
	*  - a solid block of one colour, at least a text height long and 3 pixels thick, filling its box, with no hole in it
	*    (text drawn inside a bar is either a different colour or a hole in it, and fails),
	*  - a straight line at most 2 pixels thick (gridlines, ticks, axis lines), or
	*  - a speck of at most 4 pixels (JPEG noise, a full stop).
	* Glyphs are thin strokes that fill little of their box, so any letter or digit fails it and the patch is masked as
	* before. The background is the commonest colour on the patch's edge.
	*/
	function flatMarksOnly(px, textH) {
		return solidBlocks(px, textH) >= 0;
	}
	/** The number of solid blocks in a patch that holds flat marks only (see flatMarksOnly), or -1 when it may hold text. */
	function solidBlocks(px, textH) {
		const { data, width: w, height: h } = px;
		if (w < 1 || h < 1) return 0;
		let blocks = 0;
		const at = (i) => [
			data[i * 4],
			data[i * 4 + 1],
			data[i * 4 + 2]
		];
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
				for (const q of [
					x > 0 ? p - 1 : -1,
					x < w - 1 ? p + 1 : -1,
					y > 0 ? p - w : -1,
					y < h - 1 ? p + w : -1
				]) if (q >= 0 && ink[q] && !seen[q]) {
					seen[q] = 1;
					stack[top++] = q;
				}
			}
			const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
			if (members.length <= 4 || Math.min(bw, bh) <= 2) continue;
			if (Math.max(bw, bh) < textH || Math.min(bw, bh) < 3 || members.length < .85 * bw * bh) return -1;
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
				for (const r of [
					xx > 0 ? q - 1 : -1,
					xx < bw - 1 ? q + 1 : -1,
					yy > 0 ? q - bw : -1,
					yy < bh - 1 ? q + bw : -1
				]) if (r >= 0 && !inBox[r]) {
					inBox[r] = 2;
					reach[rt++] = r;
				}
			}
			if (holes > 2) return -1;
			blocks++;
		}
		return blocks;
	}
	/**
	* Whether a box the reader took for a word is a chart's bar: most of it (at least half) is one colour, and the pixels of
	* that colour make a solid rectangle at least a text height long and 3 pixels thick, with no hole in it. Letters never
	* fill their box as one solid rectangle, and a word printed on a coloured chip or inside a bar is a set of holes in it,
	* so neither passes. What is left around the rectangle (an axis line, a tick, background) does not matter.
	*/
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
		if (topN < .5 * w * h) return false;
		let ref = 0;
		while (key(ref) !== topKey) ref++;
		const c = [
			data[ref * 4],
			data[ref * 4 + 1],
			data[ref * 4 + 2]
		];
		const near = (i) => Math.hypot(data[i * 4] - c[0], data[i * 4 + 1] - c[1], data[i * 4 + 2] - c[2]) <= 40;
		const rows = [], cols = [];
		for (let y = 0; y < h; y++) {
			let n = 0;
			for (let x = 0; x < w; x++) if (near(y * w + x)) n++;
			if (n >= .5 * w) rows.push(y);
		}
		if (!rows.length) return false;
		const y0 = rows[0], y1 = rows[rows.length - 1];
		for (let x = 0; x < w; x++) {
			let n = 0;
			for (let y = y0; y <= y1; y++) if (near(y * w + x)) n++;
			if (n >= .5 * (y1 - y0 + 1)) cols.push(x);
		}
		if (!cols.length) return false;
		const x0 = cols[0], x1 = cols[cols.length - 1], bw = x1 - x0 + 1, bh = y1 - y0 + 1;
		if (Math.max(bw, bh) < textH || Math.min(bw, bh) < 3) return false;
		let off = 0;
		for (let y = y0 + 1; y < y1; y++) for (let x = x0 + 1; x < x1; x++) if (!near(y * w + x)) off++;
		return off <= 2;
	}
	/**
	* Whether a box the reader took for a word is a piece of a chart's shapes (a pie's slices, a map's regions) rather than
	* text. It passes only when the box is taller than one and a half lines of text and is made of at least two large
	* regions of one colour each (slices, the background), every one of them thick: it holds a square of at least
	* \`textH\` x 0.8 and of 0.3 of the box's smaller side, which no letter's stroke does. A thin region of one colour is
	* allowed only as a straight 1-2 px line (a gridline) or a small sliver at the box's edge (a slice the box cuts off).
	* Every other pixel must lie on the seam between two regions (the
	* anti-aliased edge between slices): a value printed inside a slice is a set of pixels with one region around them,
	* and fails, as does any letter.
	*/
	function isShapes(px, textH) {
		const { data, width: w, height: h } = px;
		if (h < 1.5 * textH || w < 3) return false;
		const n = w * h;
		const q = (i) => data[i * 4] >> 4 << 8 | data[i * 4 + 1] >> 4 << 4 | data[i * 4 + 2] >> 4;
		const counts = /* @__PURE__ */ new Map();
		for (let i = 0; i < n; i++) counts.set(q(i), (counts.get(q(i)) || 0) + 1);
		const palette = [...counts.entries()].filter(([, c]) => c >= n * .03).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => {
			let i = 0;
			while (q(i) !== k) i++;
			return [
				data[i * 4],
				data[i * 4 + 1],
				data[i * 4 + 2]
			];
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
			const seen = /* @__PURE__ */ new Set();
			for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
				const xx = x + dx, yy = y + dy;
				if (xx >= 0 && yy >= 0 && xx < w && yy < h && label[yy * w + xx] >= 0) seen.add(label[yy * w + xx]);
			}
			if (seen.size < 2 && ++foreign > 3) return false;
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
		const need = Math.max(.8 * textH, .3 * Math.min(w, h));
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
				for (const nb of [
					x > 0 ? p - 1 : -1,
					x < w - 1 ? p + 1 : -1,
					y > 0 ? p - w : -1,
					y < h - 1 ? p + w : -1
				]) if (nb >= 0 && !seen[nb] && label[nb] === l) {
					seen[nb] = 1;
					stack[top++] = nb;
				}
			}
			if (2 * r + 1 >= need) thick++;
			else if (count > 4 && Math.min(x1 - x0 + 1, y1 - y0 + 1) > 2 && !((x0 === 0 || y0 === 0 || x1 === w - 1 || y1 === h - 1) && count <= n * .3)) return false;
		}
		return thick >= 2;
	}
	// src/content/context-classifier.ts
	var CONTEXT_TYPE = "Name in context";
	var UNREAD_TYPE = "Unread text";
	/**
	* Many callers may score at once; responses are matched to requests by id, so the worker may answer
	* in any order. A hung or crashed worker is terminated, every waiting request is rejected, and the
	* next request starts a fresh worker.
	*/
	var ContextClassifier = class {
		constructor(spawn, opts = {}) {
			_defineProperty(this, "spawn", void 0);
			_defineProperty(this, "worker", null);
			_defineProperty(this, "pending", /* @__PURE__ */ new Map());
			_defineProperty(this, "nextId", 1);
			_defineProperty(this, "timeoutMs", void 0);
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
			const { scores } = await this.request({
				type: "score",
				lines
			}, signal);
			if (!scores || scores.length !== lines.length || scores.some((s, i) => s.length !== lines[i].length)) throw new Error("ML worker returned scores that do not match the lines sent");
			return scores;
		}
		/**
		* Boxes around the text in an image, in its pixels. The image must already be at the detector's input size
		* (detectorSize); its pixels are transferred to the worker, so the caller must not use them afterwards.
		*/
		async detect(image, signal) {
			const { regions } = await this.request({
				type: "detect",
				image
			}, signal, [image.data.buffer]);
			if (!Array.isArray(regions)) throw new Error("ML worker returned no text regions");
			return regions;
		}
		/** One straightened line of text read by the second-look reader. Its pixels are transferred to the worker. */
		async read(image, signal) {
			const { reading } = await this.request({
				type: "read",
				image
			}, signal, [image.data.buffer]);
			if (!reading) throw new Error("ML worker returned no reading");
			return reading;
		}
		dispose() {
			this.reset(/* @__PURE__ */ new Error("Contextual scanner was closed"));
		}
		request(body, signal, transfer = []) {
			if (signal?.aborted) return Promise.reject(abortError());
			const worker = this.ensureWorker();
			const id = this.nextId++;
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => this.reset(/* @__PURE__ */ new Error(`ML worker did not answer within ${this.timeoutMs} ms`)), this.timeoutMs);
				this.pending.set(id, {
					resolve,
					reject,
					timer
				});
				signal?.addEventListener("abort", () => this.settle(id, (p) => p.reject(abortError())), { once: true });
				worker.postMessage({
					...body,
					id
				}, transfer);
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
	};
	function abortError() {
		const e = /* @__PURE__ */ new Error("Contextual scan was cancelled");
		e.name = "AbortError";
		return e;
	}
	/** Default worker for the app page: the bundle that `npm run build:ml` writes to public/ml/. */
	var moduleWorker = (url) => () => new Worker(url, { type: "module" });
	/**
	* Picked on dashboard-style lines with the 14.5 MB TinyBERT model: 0.8 catches "May Chen" (0.93),
	* "Max Weber" (0.97), "Target Corporation" (0.87) and "Delta Airlines" (0.95), while "Delta vs last year"
	* (0.74) and "Max latency p95" (0.65) stay readable.
	*/
	var DEFAULT_THRESHOLDS = {
		strong: .8,
		weak: .5
	};
	var core = (t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
	var hasLetter = (t) => /\p{L}/u.test(t);
	/** "EMEA", "APAC", "KPI": the model reads these as organisations, but on a dashboard they are labels. */
	var isAcronym = (c) => c.length >= 2 && /^\p{Lu}[\p{Lu}\d&.]*$/u.test(c);
	/**
	* Indexes of words in one line that the model says are a person or organisation and the rules kept.
	* Only capitalised, non-acronym words qualify, and only on lines with at least two words: a lone "Max"
	* in a table cell gives the model no context to tell a name from a column label.
	*/
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
	return exports;
})({});
