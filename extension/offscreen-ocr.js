// src/shared/allowlist.ts
/**
* The built-in allowlist from web/app.js (ALLOW), for code outside the app page: the canvas redactor (Feature 3)
* masks with it (src/shared/classify.ts). tests/unit/canvas-ocr.test.ts fails if this copy and web/app.js drift apart.
*/
var ALLOW_WORDS = `
a an and or of the to in on at by for from with per vs versus via all any each other others total totals subtotal grand
top bottom first last next previous prior current new old high medium low average avg mean median min max sum count share rate ratio index
revenue sales net gross margin profit loss income cost costs expense expenses spend budget forecast actual actuals target targets plan variance
quantity quantities qty subcategory subcategories store stores identifier detail details invoice invoices balance balances tax taxes shipping shipped freight description descriptions group groups subgroup parameter parameters fiscal employee employees line lines code codes number numbers
growth change delta trend trends performance overview summary dashboard report reports scorecard kpi kpis metric metrics measure value values amount amounts
units unit orders order customers customer accounts account clients client users user sessions session visitors visits pageviews views page pages
bounce conversion conversions clicks click impressions ctr cpc cpm roi roas leads lead pipeline opportunities deals bookings quota attainment
region regions country countries city cities state states territory market markets segment segments channel channels category categories product products brand brands
department departments team teams owner manager managers name names id type types status priority stage stages step steps source sources item items
date dates day days week weeks weekly month months monthly quarter quarters quarterly year years yearly annual period periods time hour hours today ytd mtd qtd ly py yoy mom wow fy
jan feb mar apr may jun jul aug sep sept oct nov dec january february march april june july august september october november december
mon tue wed thu fri sat sun monday tuesday wednesday thursday friday saturday sunday
emea apac amer latam na eu uk us usa europe asia africa america americas oceania middle east west north south central global worldwide international domestic
germany france italy spain netherlands belgium switzerland austria sweden norway denmark finland nordics ireland portugal poland greece czechia hungary romania
india china japan korea singapore australia canada mexico brazil argentina chile colombia indonesia thailand vietnam malaysia philippines turkey israel uae saudi arabia egypt nigeria kenya
retail wholesale online offline direct indirect organic paid search social email referral display affiliate partner partners
open closed pending active inactive won lost churn churned returning retention acquisition onboarding support tickets ticket backlog sla
operations ops finance hr legal marketing technology engineering it procurement supply chain logistics inventory stock warehouse delivery shipping
cash flow ebitda ebit opex capex cogs arr mrr ltv cac nps csat headcount fte hiring attrition
filter filters select selected show hide all none more less other others yes no n/a na unknown
as of data source sources updated last refreshed prepared confidential internal only use
crash crashes free install installs uninstalls download downloads rating ratings review reviews release releases version versions build builds device devices
app apps android ios web mobile desktop tablet platform platforms browser health quality issue issues cluster clusters error errors uptime latency usage
daily weekly stickiness adoption feature features cohort cohorts signup signups trial trials paid activation activated retained engagement engaged
flow flows first response responses resolution resolved solved handle handling tier tiers agent agents leaderboard queue queues reason reasons contact contacts volume
score scores distribution promoter promoters passive passives detractor detractors survey surveys theme themes comment comments verbatim verbatims voice feedback
pricing price prices model models seat seats discount discounts scenario scenarios assumption assumptions list scope roadmap
sprint sprints story stories points velocity burndown committed completed carry over bug bugs task tasks spike done blocked progress todo epic epics
experiment experiments variant variants control treatment lift interval significant significance confidence
median p50 p75 p90 p95 percent percentage minutes minute min mins seconds second sec secs ms
sold buy buys bought purchase purchases purchased booked billed paid unpaid received returned refund refunds refunded cancelled canceled
delivered fulfilled backorder backorders pts pt bps basis above below under over within outside prev excl incl excluding including include exclude
existing repeat renewal renewals renewed upsell upsells expansion contraction downgrade downgrades upgrade upgrades
achieved achievement goal goals benchmark benchmarks baseline estimate estimates estimated projected projection projections forecasted
increase increased increases decrease decreased decreases up down flat improved improvement improvements decline declined declines
rank ranking ranked best worst highest lowest leading lagging key main major minor primary secondary overall combined consolidated adjusted
reported normalized normalised constant service services solution solutions offering offerings package packages subscription subscriptions
plans license licenses licence licences contract contracts agreement agreements quote quotes proposal proposals call calls chat chats
meeting meetings demo demos event events campaign campaigns spent each staff staffing capacity utilisation utilization occupancy availability
downtime efficiency productivity output throughput yield defects defect scrap claims claim premium premiums policy policies coverage payout
payouts patients patient admissions discharges beds readmissions encounters students enrollment enrolment courses breakdown split mix
contribution composition generated printed is are was were be been has have had can not this that these those our your their its we they
which what when where how why than then also just about across into out off per year-to-date month-to-date quarter-to-date
people recent hire hires hired base salary salaries start started end ended ending approved approval disputed overdue due proposed qualify qualified
meet note notes return returns vendor vendors billing board close closing deal phone impact exit win wins rep reps
usd eur gbp inr jpy cad aud chf conv operating controller landing logo logos axis bar bars label labels slice slices panel statement statements
payable payables receivable receivables aging business enterprise complaint complaints topic topics twice routing sent answered called changes
capture card cards extract stated forward instead inside wait ever great but me nobody owner owners please thousands rotated lookup lookups
acquire midwest northeast northwest southeast southwest excel sheet sheets workbook fx xlsx csv pdf re fyi cc fictional sample
`.split(/\s+/).filter(Boolean);
// src/shared/classify.ts
/**
* TypeScript port of classify() in web/app.js, used by the extension's chart blur (src/background/offscreen-ocr.ts).
* Same order of checks, same results: tests/unit/classify.test.ts checks it against web/app.js on a fuzzed corpus.
*/
var DEFAULT_ALLOW = new Set(ALLOW_WORDS);
function classify(text, p = {}) {
	const allow = p.allow ?? DEFAULT_ALLOW;
	const raw = text.trim();
	const clean = raw.replace(/^[^\p{L}\p{N}_€$£¥₹%#@]+|[^\p{L}\p{N}_€$£¥₹%]+$/gu, "");
	if (!clean) return null;
	const low = clean.toLowerCase();
	if ((p.clientNames ?? []).some((n) => n && (low.includes(n) || n.split(/\s+/).includes(low)))) return "Client name";
	if (/\w@\w/.test(raw) || /@/.test(raw) && /\./.test(raw)) return "Email";
	if (/^(19|20)\d{2}$/.test(clean) || /^(q[1-4]|h[12]|fy\d{2,4}|w\d{1,2}|p\d{1,2})$/i.test(clean)) return null;
	if (/^[lrtpn]\d{1,3}[dwmqy]$/i.test(clean) || /^q[1-4][-–]q[1-4]$/i.test(clean) || /^fy\d{2}[-–/]\d{2}$/i.test(clean) || /^(19|20)\d{2}[-–/]((19|20)?\d{2})$/.test(clean) || /^#\d{1,2}$/.test(clean)) return null;
	if (/[A-Za-z]{2,}[-_]?\d{3,}|\d{3,}[-_][A-Za-z]/.test(clean)) return "Identifier";
	if (!/[\p{L}\p{N}]/u.test(clean)) return null;
	if (/[\d€$£¥₹%]/.test(clean)) return "Number or money";
	if (clean.length <= 1) return null;
	if (allow.has(low)) return null;
	const parts = low.replace(/’/g, "'").split(/[-/&']/).filter(Boolean);
	if (parts.length > 1 && parts.some((x) => x.length > 1) && parts.every((x) => x.length <= 1 || allow.has(x))) return null;
	return "Text not on allowlist";
}
// src/background/ocr-words.ts
/**
* Word rows (level 5) of Tesseract's TSV, in the coordinates of the image before it was scaled by `scale`.
* Same confidence floors as ocr() in web/app.js: digits are the costliest leak, so unsure ones are kept.
*/
function parseTsv(tsv, scale) {
	const out = [];
	for (const line of tsv.split("\n")) {
		const c = line.split("	");
		if (c.length < 12 || c[0] !== "5") continue;
		const text = c.slice(11).join("	").trim();
		const conf = parseFloat(c[10]);
		if (!text || conf < (/\d/.test(text) ? 12 : 30)) continue;
		out.push({
			text,
			conf,
			x: +c[6] / scale,
			y: +c[7] / scale,
			w: +c[8] / scale,
			h: +c[9] / scale
		});
	}
	return out;
}
/** Words the scanner flags, as padded boxes (padding as in buildMasks() in web/app.js). */
function maskBoxes(words, types) {
	const boxes = [];
	words.forEach((w, i) => {
		const type = types[i];
		if (!type) return;
		const p = Math.max(3, w.h * .18);
		boxes.push({
			x: w.x - p,
			y: w.y - p,
			w: w.w + 2 * p,
			h: w.h + 2 * p,
			type
		});
	});
	return boxes;
}
/** Words found by a later pass are kept only where no earlier pass already found one (as readAll() in web/app.js). */
function mergePasses(passes) {
	const all = [];
	for (const words of passes) for (const w of words) if (!all.some((v) => overlap(v, w) > .3)) all.push(w);
	return all;
}
/** Share of the smaller box covered by the other. */
function overlap(a, b) {
	const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
	const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
	const small = Math.min(a.w * a.h, b.w * b.h);
	return small > 0 ? ix * iy / small : 0;
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
var UNREAD_TYPE = "Unread text";
/**
* Many callers may score at once; responses are matched to requests by id, so the worker may answer
* in any order. A hung or crashed worker is terminated, every waiting request is rejected, and the
* next request starts a fresh worker.
*/
var ContextClassifier = class {
	spawn;
	worker = null;
	pending = /* @__PURE__ */ new Map();
	nextId = 1;
	timeoutMs;
	constructor(spawn, opts = {}) {
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
// src/background/offscreen-ocr.ts
/**
* Offscreen document for canvas redaction (Feature 3): runs Tesseract on canvas images and the app's masking rules
* (src/shared/classify.ts) on the words it reads.
*
* OCR runs here, not in the content script: in a content script, Tesseract's Worker and WASM fall under
* the page's CSP, which strict sites (Power BI, Tableau) use to block them. An offscreen document runs
* under the extension's own CSP. Tesseract and its language data are the app's own copies (app/lib, app/lang).
*/
var workerP = null;
function ocrWorker() {
	const cfg = typeof VAULTSNIP_CONFIG === "undefined" ? {} : VAULTSNIP_CONFIG;
	const lang = cfg.langPath ?? "lang";
	return workerP ??= Tesseract.createWorker("eng", 1, {
		workerPath: "app/lib/worker.min.js",
		corePath: "app/lib/core",
		langPath: /^https?:/.test(lang) ? lang : `app/${lang}`,
		workerBlobURL: false,
		gzip: cfg.langGzip !== false,
		cacheMethod: "write"
	}).then(async (w) => {
		await w.setParameters({
			tessedit_pageseg_mode: "11",
			preserve_interword_spaces: "1"
		});
		return w;
	}).catch((e) => {
		workerP = null;
		throw e;
	});
}
var ALLOW = new Set(ALLOW_WORDS);
var scan = (texts) => texts.map((t) => classify(t, { allow: ALLOW }));
function load(dataUrl) {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(/* @__PURE__ */ new Error("could not decode canvas image"));
		img.src = dataUrl;
	});
}
/** Upscaled copy for OCR; `invert` reads light text on dark dashboards. */
function prep(img, scale, invert) {
	const c = document.createElement("canvas");
	c.width = Math.round(img.naturalWidth * scale);
	c.height = Math.round(img.naturalHeight * scale);
	const ctx = c.getContext("2d");
	ctx.fillStyle = "#fff";
	ctx.fillRect(0, 0, c.width, c.height);
	if (invert) ctx.filter = "invert(1)";
	ctx.drawImage(img, 0, 0, c.width, c.height);
	return c;
}
async function read(img) {
	const w = await ocrWorker();
	const passes = [];
	for (const invert of [false, true]) {
		const { data } = await w.recognize(prep(img, 2, invert), {}, {
			tsv: true,
			text: false,
			blocks: false,
			hocr: false
		});
		passes.push(parseTsv(data.tsv ?? "", 2));
	}
	return mergePasses(passes);
}
/**
* Text the reader missed (Phase 2): the app's text-region detector, in the same ML worker the app uses (app/ml), finds
* every patch of text; any part no flagged word and no confidently read safe word accounts for is blurred too. A
* region far taller than a line of text (labels and chart marks merged into one blob) is left alone: unlike the app,
* this path has no second look to tell what is in it, and blurring it whole would hide the chart. If the detector
* cannot run, the reader's boxes stand.
*/
var ml = null;
function mlWorkerUrl() {
	const cfg = typeof VAULTSNIP_CONFIG === "undefined" ? {} : VAULTSNIP_CONFIG;
	const models = new URL(cfg.mlModels ?? "models/", new URL("app/", location.href)).href;
	return new URL("app/ml/ml-worker.js?" + new URLSearchParams({
		models,
		gz: cfg.mlGzip === false ? "0" : "1"
	}), location.href);
}
var READ_CONF = 60;
/** The RGBA pixels of a box of the image, in whole pixels. */
function pixelsOf(img, b) {
	const x0 = Math.max(0, Math.floor(b.x)), y0 = Math.max(0, Math.floor(b.y));
	const w = Math.max(1, Math.min(img.naturalWidth, Math.ceil(b.x + b.w)) - x0), h = Math.max(1, Math.min(img.naturalHeight, Math.ceil(b.y + b.h)) - y0);
	const c = document.createElement("canvas");
	c.width = w;
	c.height = h;
	const x = c.getContext("2d", { willReadFrequently: true });
	x.drawImage(img, x0, y0, w, h, 0, 0, w, h);
	return x.getImageData(0, 0, w, h);
}
var medianH = (words) => {
	const hs = words.map((w) => w.h).sort((a, b) => a - b);
	return hs.length ? hs[hs.length >> 1] : 12;
};
/** As in the app: a "word" that is a solid rectangle (a bar) or thick regions of one colour each (slices) is a chart shape the reader took for text; blurring it hides the chart. */
function notBars(img, words) {
	const textH = medianH(words);
	return words.filter((w) => {
		if (Math.max(w.w, w.h) < textH) return true;
		const px = pixelsOf(img, w);
		return !(isBar(px, textH) || isShapes(px, textH));
	});
}
async function unreadBoxes(img, words, flagged) {
	try {
		ml ??= new ContextClassifier(moduleWorker(mlWorkerUrl()), { timeoutMs: 6e4 });
		const size = detectorSize(img.naturalWidth, img.naturalHeight, 1536);
		const c = document.createElement("canvas");
		c.width = size.width;
		c.height = size.height;
		const x = c.getContext("2d", { willReadFrequently: true });
		x.fillStyle = "#fff";
		x.fillRect(0, 0, c.width, c.height);
		x.drawImage(img, 0, 0, c.width, c.height);
		const d = x.getImageData(0, 0, c.width, c.height);
		const regions = await ml.detect({
			width: d.width,
			height: d.height,
			data: d.data
		});
		const kx = img.naturalWidth / size.width, ky = img.naturalHeight / size.height;
		const scale = (b) => ({
			x: b.x * kx,
			y: b.y * ky,
			w: b.w * kx,
			h: b.h * ky
		});
		const textH = medianH(words);
		const slanted = (r) => !!r.len && Math.abs(r.angle ?? 0) > 10 && Math.abs(r.angle ?? 0) < 170;
		const lines = regions.filter((r) => (slanted(r) ? (r.thick ?? 0) * ky : (r.core ?? r).h * ky) <= 3 * textH).map((r) => ({
			...scale(r),
			core: scale(r.core ?? r)
		}));
		const inside = (w) => flagged.some((m) => w.x + w.w / 2 >= m.x && w.x + w.w / 2 <= m.x + m.w && w.y + w.h / 2 >= m.y && w.y + w.h / 2 <= m.y + m.h);
		const boxes = unreadParts(lines, [...flagged, ...words.filter((w) => w.conf >= READ_CONF && !inside(w))]).filter((p) => !flatMarksOnly(pixelsOf(img, p), textH)).map((p) => ({
			x: p.x,
			y: p.y,
			w: p.w,
			h: p.h,
			type: UNREAD_TYPE
		}));
		return {
			boxes,
			note: String(boxes.length)
		};
	} catch (e) {
		console.warn("VaultSnip: the text-region check could not run here; the reader's masks stand.", e);
		return {
			boxes: [],
			note: "off: " + (e instanceof Error ? e.message : String(e))
		};
	}
}
async function run(images) {
	const results = [];
	for (const { id, dataUrl } of images) {
		const img = await load(dataUrl);
		const words = notBars(img, await read(img));
		const boxes = maskBoxes(words, scan(words.map((w) => w.text)));
		const unread = await unreadBoxes(img, words, boxes);
		results.push({
			id,
			words: words.length,
			boxes: boxes.concat(unread.boxes),
			unread: unread.note
		});
	}
	return results;
}
chrome.runtime.onMessage.addListener((msg, _sender, send) => {
	if (msg?.target !== "offscreen" || msg.type !== "vs-ocr") return;
	run(msg.images).then((results) => send({
		ok: true,
		results
	}), (e) => send({
		ok: false,
		error: e instanceof Error ? e.message : String(e)
	}));
	return true;
});
