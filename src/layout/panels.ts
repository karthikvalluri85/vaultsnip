/**
 * Panel finding: where each visual sits on the page.
 *
 * 1. An edge map marks pixels that differ sharply from a neighbour. Flat, gradient and card-filled backgrounds have no
 *    edges, so the gutters between visuals are empty whatever the design.
 * 2. Recursive XY-cuts split the page along the widest empty gutter until none is left. A card's own border lines are
 *    trimmed first, so a cut inside a card only needs the inside to be empty.
 * 3. The cut tree is read back into panels: a framed card is one visual unless it holds two sizeable parts, and a thin
 *    strip peeled off the top or bottom (a title, legend or axis) stays with its visual.
 * 4. Text-only strips join the panel below or above them; panels nested inside others are dropped.
 */
import { area, center, inside, isBigBox, isMaskGrey, labelStacks, medianHeight, wordsIn, type Box, type Img, type Word } from './image';
import { looksLikeTable } from './charts';

export function edges(img: Img, T = 12) {
  const { data, width: W, height: H, channels: C } = img, e = new Uint8Array(W * H);
  for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
    const i = (y * W + x) * C, r = i + C, d = i + W * C;
    const dx = Math.max(Math.abs(data[i] - data[r]), Math.abs(data[i + 1] - data[r + 1]), Math.abs(data[i + 2] - data[r + 2]));
    const dy = Math.max(Math.abs(data[i] - data[d]), Math.abs(data[i + 1] - data[d + 1]), Math.abs(data[i + 2] - data[d + 2]));
    if (dx > T || dy > T) e[y * W + x] = 1;
  }
  // isolated specks (compression noise) are not content; lines and text strokes always have a neighbour
  const out = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (e[i] && (e[i - 1] | e[i + 1] | e[i - W] | e[i + W] | e[i - W - 1] | e[i - W + 1] | e[i + W - 1] | e[i + W + 1])) out[i] = 1;
  }
  return out;
}

interface Node { b: Box; inner: Box; framed: boolean; kids: Node[] | null; axis: 'x' | 'y' | null }

/** Segmentation settings (measured on tools/layout-bench; exposed so the benchmark can compare alternatives). */
export const PANEL_OPTS = {
  threshold: 12,       // edge contrast
  gapFrac: 0.011,      // smallest gutter, as a share of the page's short side
  cross: false,        // a line running across an empty band blocks a cut there (measured: worse on real pages)
  trimTol: 0,          // ink allowed in a margin row next to a border line (rounded frame corners; measured: 0 is best)
  band: false,         // children keep the full band across a cut (measured: worse on real pages)
  filled: false,       // a gutter row is one colour, so a row through a solid bar is not one (measured: worse on real pages)
};

/** Raw regions from the cut tree, as boxes. */
export function findRegions(img: Img, o: Partial<typeof PANEL_OPTS> = {}, within?: Box): Box[] {
  const opts = { ...PANEL_OPTS, ...o };
  const W = img.width, H = img.height, e = edges(img, opts.threshold);
  const minGap = Math.max(5, Math.round(Math.min(W, H) * opts.gapFrac));
  const out: Box[] = [];
  const rowInk = (x0: number, x1: number, y: number) => { let n = 0; const o = y * W; for (let x = x0; x < x1; x++) n += e[o + x]; return n; };
  const colInk = (y0: number, y1: number, x: number) => { let n = 0; for (let y = y0; y < y1; y++) n += e[y * W + x]; return n; };
  // ink that runs across a gutter: part of a vertical run (for a horizontal gutter) or a horizontal run (vertical gutter).
  // A card's side border crossing an empty band blocks a cut there; stray specks and horizontal rules do not.
  const ev = new Uint8Array(W * H), eh = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; if (e[i]) { ev[i] = e[i - W] & e[i + W]; eh[i] = e[i - 1] & e[i + 1]; } }
  const rowCross = (x0: number, x1: number, y: number) => { let n = 0; const o = y * W; for (let x = x0; x < x1; x++) n += ev[o + x]; return n; };
  const colCross = (y0: number, y1: number, x: number) => { let n = 0; for (let y = y0; y < y1; y++) n += eh[y * W + x]; return n; };
  // a straight line across most of the region (a card border or a rule) is a frame, not content
  const isRule = (n: number, len: number) => n > len * 0.85;
  function trim(x0: number, y0: number, x1: number, y1: number): Box {
    const w = x1 - x0, h = y1 - y0;
    // a sliver of ink (antialiased rounded corners of a frame) still counts as empty margin
    // a sliver of ink just outside a border line (antialiased rounded corners of a frame) is margin too
    const ruleRow = (y: number) => y >= 0 && y < H && isRule(rowInk(x0, x1, y), w), ruleCol = (x: number) => x >= 0 && x < W && isRule(colInk(y0, y1, x), h);
    const emptyRow = (y: number, d: number) => { const n = rowInk(x0, x1, y); return n <= 1 || isRule(n, w) || (n <= w * opts.trimTol && (ruleRow(y + d) || ruleRow(y + 2 * d))); };
    const emptyCol = (x: number, d: number) => { const n = colInk(y0, y1, x); return n <= 1 || isRule(n, h) || (n <= h * opts.trimTol && (ruleCol(x + d) || ruleCol(x + 2 * d))); };
    while (y0 < y1 - 1 && emptyRow(y0, 1)) y0++;
    while (y1 - 1 > y0 && emptyRow(y1 - 1, -1)) y1--;
    while (x0 < x1 - 1 && emptyCol(x0, 1)) x0++;
    while (x1 - 1 > x0 && emptyCol(x1 - 1, -1)) x1--;
    return [x0, y0, x1, y1];
  }
  // pixels unlike the line's own commonest colour (a gradient line is still one colour; a line through a bar is not)
  const { data, channels: C } = img;
  const offLine = (n: number, at: (k: number) => number) => {
    const m = new Map<number, number>(); const ks = new Int32Array(n);
    for (let k = 0; k < n; k++) { const i = at(k); const q = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4); ks[k] = q; m.set(q, (m.get(q) || 0) + 1); }
    let bk = 0, bn = -1; for (const [q, c] of m) if (c > bn) { bn = c; bk = q; }
    let off = 0; for (let k = 0; k < n; k++) { const q = ks[k]; if (Math.abs((q >> 8) - (bk >> 8)) > 1 || Math.abs(((q >> 4) & 15) - ((bk >> 4) & 15)) > 1 || Math.abs((q & 15) - (bk & 15)) > 1) off++; }
    return off;
  };
  const rowOff = (x0: number, x1: number, y: number) => offLine(x1 - x0, (k) => (y * W + x0 + k) * C);
  const colOff = (y0: number, y1: number, x: number) => offLine(y1 - y0, (k) => ((y0 + k) * W + x) * C);
  function bestGap(prof: number[], cross: number[], len: number, off?: number[]): [number, number] | null {
    let best: [number, number] | null = null, s = -1;
    for (let i = 0; i <= prof.length; i++) {
      // nothing runs across a gutter (a card's side border does), and it holds at most a few stray pixels or a rule
      const empty = i < prof.length && ((opts.cross ? cross[i] === 0 && prof[i] <= Math.max(2, len * 0.02) : prof[i] <= 2) && (!off || off[i] <= Math.max(2, len * 0.03)) || isRule(prof[i], len));
      if (empty && s < 0) s = i;
      if (!empty && s >= 0) {
        if (s > 0 && i < prof.length && i - s >= minGap && (!best || i - s > best[1] - best[0])) best = [s, i];
        s = -1;
      }
    }
    return best;
  }
  function cut(x0: number, y0: number, x1: number, y1: number, depth: number): Node | null {
    const raw: Box = [x0, y0, x1, y1];
    [x0, y0, x1, y1] = trim(x0, y0, x1, y1);
    const w = x1 - x0, h = y1 - y0;
    if (w < 12 || h < 8) return null;
    // framed: border lines were trimmed on two opposite sides, anywhere between the region edge and the content (a card
    // has padding inside its border); the panel is then the border box
    let top = -1, bottom = -1, left = -1, right = -1;
    for (let y = raw[1]; y < y0 && top < 0; y++) if (isRule(rowInk(x0, x1, y), w)) top = y;
    for (let y = raw[3] - 1; y >= y1 && bottom < 0; y--) if (isRule(rowInk(x0, x1, y), w)) bottom = y;
    for (let x = raw[0]; x < x0 && left < 0; x++) if (isRule(colInk(y0, y1, x), h)) left = x;
    for (let x = raw[2] - 1; x >= x1 && right < 0; x--) if (isRule(colInk(y0, y1, x), h)) right = x;
    const framed = (top >= 0 && bottom >= 0) || (left >= 0 && right >= 0);
    const frame: Box = [left >= 0 ? left : x0, top >= 0 ? top : y0, right >= 0 ? right + 1 : x1, bottom >= 0 ? bottom + 1 : y1];
    const node: Node = { b: framed ? frame : [x0, y0, x1, y1], inner: [x0, y0, x1, y1], framed, kids: null, axis: null };
    if (depth > 14) return node;
    const py = Array.from({ length: h }, (_, i) => rowInk(x0, x1, y0 + i)), px = Array.from({ length: w }, (_, i) => colInk(y0, y1, x0 + i));
    const cy = Array.from({ length: h }, (_, i) => rowCross(x0, x1, y0 + i)), cx = Array.from({ length: w }, (_, i) => colCross(y0, y1, x0 + i));
    // (only lines that pass the edge test need the colour test)
    const oy = opts.filled ? py.map((n, i) => (n <= 2 ? rowOff(x0, x1, y0 + i) : 0)) : undefined, ox = opts.filled ? px.map((n, i) => (n <= 2 ? colOff(y0, y1, x0 + i) : 0)) : undefined;
    const gy = bestGap(py, cy, w, oy), gx = bestGap(px, cx, h, ox);
    if (!gy && !gx) return node;
    if (gy && (!gx || gy[1] - gy[0] >= gx[1] - gx[0])) {
      const m = y0 + Math.round((gy[0] + gy[1]) / 2); node.axis = 'y';
      // children keep the full band across the cut, so each one still sees its own card frame
      node.kids = [cut(opts.band ? raw[0] : x0, y0, opts.band ? raw[2] : x1, m, depth + 1), cut(opts.band ? raw[0] : x0, m, opts.band ? raw[2] : x1, y1, depth + 1)].filter((k): k is Node => !!k);
    } else {
      const m = x0 + Math.round((gx![0] + gx![1]) / 2); node.axis = 'x';
      node.kids = [cut(x0, opts.band ? raw[1] : y0, m, opts.band ? raw[3] : y1, depth + 1), cut(m, opts.band ? raw[1] : y0, x1, opts.band ? raw[3] : y1, depth + 1)].filter((k): k is Node => !!k);
    }
    if (!node.kids.length) node.kids = null;
    return node;
  }
  const page = within ? area(within) : W * H;
  const leaves = (n: Node): Node[] => (n.kids ? n.kids.flatMap(leaves) : [n]);
  const sizeableParts = (n: Node, frac: number) => (n.kids || []).filter((k) => area(k.b) >= area(n.inner) * frac).length;
  function select(n: Node) {
    const a = area(n.b);
    if (!n.kids) { out.push(n.b); return; }
    // a card is one visual unless it holds at least two sizeable parts (each >= 20% of the card)
    if (n.framed && a < page * 0.5 && sizeableParts(n, 0.2) < 2) { out.push(n.b); return; }
    // a moderate region whose top or bottom cut only peels off a thin strip (title, legend, axis labels) is one visual;
    // side-by-side cuts never count, so a row of tiles is not mistaken for one visual with a sliver
    const hgt = (b: Box) => b[3] - b[1];
    const thin = n.axis === 'y' && n.kids.length === 2 && Math.min(...n.kids.map((k) => hgt(k.b))) < hgt(n.b) * 0.25;
    if (a <= page * 0.4 && thin && leaves(n).length <= 12) { out.push(n.b); return; }
    n.kids.forEach(select);
  }
  const root = within ? cut(Math.max(0, Math.floor(within[0])), Math.max(0, Math.floor(within[1])), Math.min(W, Math.ceil(within[2])), Math.min(H, Math.ceil(within[3])), 0) : cut(0, 0, W, H, 0);
  if (root) select(root);
  return out;
}

/**
 * Cards: most dashboards (Power BI's white cards on a light grey page, Tableau containers) put each visual on a panel
 * of uniform fill. Card borders can be too faint for the edge map, but the fill itself is easy to see: the most common
 * colour that is not the page background, in large connected areas. Returns card boxes, or [] when the page has none.
 */
export function findCards(img: Img): Box[] {
  const W = img.width, H = img.height, step = Math.max(1, Math.round(Math.min(W, H) / 400));
  const gw = Math.floor(W / step), gh = Math.floor(H / step);
  if (gw < 20 || gh < 20) return [];
  const { data, channels: C } = img;
  const px = (gx: number, gy: number): [number, number, number] => { const i = (gy * step * W + gx * step) * C; return [data[i], data[i + 1], data[i + 2]]; };
  const dist = (a: number[], b: number[]) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
  const mode = (cells: [number, number, number][]) => {
    const m = new Map<number, { n: number; c: [number, number, number] }>();
    for (const c of cells) { const k = (c[0] << 16) | (c[1] << 8) | c[2], e = m.get(k); if (e) e.n++; else m.set(k, { n: 1, c }); }
    let best = { n: 0, c: [255, 255, 255] as [number, number, number] };
    for (const e of m.values()) if (e.n > best.n) best = e;
    return best;
  };
  // the page is the commonest exact colour along the image border; the card fill is the commonest colour clearly unlike it
  const edge: [number, number, number][] = [];
  for (let gx = 0; gx < gw; gx++) edge.push(px(gx, 0), px(gx, gh - 1));
  for (let gy = 0; gy < gh; gy++) edge.push(px(0, gy), px(gw - 1, gy));
  const page = mode(edge).c;
  const all: [number, number, number][] = [];
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) { const c = px(gx, gy); if (dist(c, page) > 6) all.push(c); }
  const fill = mode(all);
  if (fill.n < gw * gh * 0.06) return [];
  const on = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) on[gy * gw + gx] = dist(px(gx, gy), fill.c) <= 3 ? 1 : 0;
  const seen = new Uint8Array(gw * gh), cards: Box[] = [], stack: number[] = [];
  for (let s = 0; s < on.length; s++) {
    if (!on[s] || seen[s]) continue;
    let n = 0, x0 = gw, y0 = gh, x1 = 0, y1 = 0;
    stack.push(s); seen[s] = 1;
    while (stack.length) {
      const p = stack.pop()!, x = p % gw, y = (p - x) / gw; n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && on[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
      if (x < gw - 1 && on[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && on[p - gw] && !seen[p - gw]) { seen[p - gw] = 1; stack.push(p - gw); }
      if (y < gh - 1 && on[p + gw] && !seen[p + gw]) { seen[p + gw] = 1; stack.push(p + gw); }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    // a card: a sizeable, mostly filled rectangle (content leaves holes), not the whole page
    if (bw * bh >= gw * gh * 0.01 && n >= bw * bh * 0.45 && bw * bh < gw * gh * 0.9 && bw >= gw * 0.05 && bh >= gh * 0.05)
      cards.push([x0 * step, y0 * step, Math.min(W, (x1 + 1) * step), Math.min(H, (y1 + 1) * step)]);
  }
  const covered = cards.reduce((a, b) => a + area(b), 0);
  return cards.length >= 2 && covered >= W * H * 0.1 ? cards : [];
}

/**
 * Outlined cards: the same colour as the page, set apart only by a thin border (Tableau and Looker tiles, light
 * themes). Long thin straight lines of one quiet colour are paired into rectangles: a top and a bottom edge spanning
 * the same width, closed by a left and a right edge (rounded corners leave short gaps, which are allowed). Only the
 * outermost rectangles count, so a chart's own plot frame inside a card is not a card. Returns [] when there are fewer
 * than two.
 */
export function findOutlinedCards(img: Img): Box[] {
  const { data, channels: C, width: W, height: H } = img;
  const minH = Math.max(40, W * 0.06), minV = Math.max(30, H * 0.05), R = Math.max(14, Math.round(Math.min(W, H) * 0.02));
  const rgb = (x: number, y: number): [number, number, number] => { const i = (y * W + x) * C; return [data[i], data[i + 1], data[i + 2]]; };
  // the page: the commonest colour over the whole image (not along its edge, which may be a frame drawn around it)
  const page = (() => {
    const m = new Map<number, number>(), step = Math.max(1, Math.round(Math.min(W, H) / 200));
    for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) { const [r, g, b] = rgb(x, y), k = (r << 16) | (g << 8) | b; m.set(k, (m.get(k) || 0) + 1); }
    const k = [...m].sort((a, b) => b[1] - a[1])[0][0];
    return [(k >> 16) & 255, (k >> 8) & 255, k & 255];
  })();
  const differs = (c: number[]) => Math.max(Math.abs(c[0] - page[0]), Math.abs(c[1] - page[1]), Math.abs(c[2] - page[2])) > 12;
  const quiet = (c: number[]) => Math.max(...c) - Math.min(...c) <= 24 && !isMaskGrey(c[0], c[1], c[2]);   // border greys, not series colours or masks
  const line = (x: number, y: number) => { const c = rgb(x, y); return differs(c) && quiet(c); };
  // thin: the pixels a few rows (columns) away on both sides are the page, so a bar or a filled shape is not a line
  const hSegs: [number, number, number][] = [], vSegs: [number, number, number][] = [];
  for (let y = 3; y < H - 3; y++) {
    for (let x = 0, s = -1; x <= W; x++) {
      const on = x < W && line(x, y) && !differs(rgb(x, y - 3)) && !differs(rgb(x, y + 3));
      if (on && s < 0) s = x;
      if (!on && s >= 0) { if (x - s >= minH) hSegs.push([y, s, x]); s = -1; }
    }
  }
  for (let x = 3; x < W - 3; x++) {
    for (let y = 0, s = -1; y <= H; y++) {
      const on = y < H && line(x, y) && !differs(rgb(x - 3, y)) && !differs(rgb(x + 3, y));
      if (on && s < 0) s = y;
      if (!on && s >= 0) { if (y - s >= minV) vSegs.push([x, s, y]); s = -1; }
    }
  }
  const rects: Box[] = [];
  for (const [ty, tx0, tx1] of hSegs) {
    for (const [by, bx0, bx1] of hSegs) {
      if (by - ty < minV || Math.abs(bx0 - tx0) > R || Math.abs(bx1 - tx1) > R) continue;
      const x0 = Math.min(tx0, bx0) - R, x1 = Math.max(tx1, bx1) + R;
      const side = (x: number) => vSegs.some(([vx, vy0, vy1]) => Math.abs(vx - x) <= R && vy0 <= ty + R && vy1 >= by - R && vy1 - vy0 >= (by - ty) * 0.6);
      const left = vSegs.filter(([vx]) => vx >= x0 && vx <= tx0 + R), right = vSegs.filter(([vx]) => vx <= x1 && vx >= tx1 - R);
      if (!left.some(([vx]) => side(vx)) || !right.some(([vx]) => side(vx))) continue;
      // the nearest edge on each side (with a narrow gutter, the next card's border is within reach too)
      const nearest = (xs: number[], to: number) => xs.reduce((a, b) => (Math.abs(b - to) < Math.abs(a - to) ? b : a));
      const lx = nearest(left.filter(([vx]) => side(vx)).map(([vx]) => vx), tx0), rx = nearest(right.filter(([vx]) => side(vx)).map(([vx]) => vx), tx1);
      rects.push([lx, ty, rx + 1, by + 1]);
      break;   // the nearest bottom edge closes this card
    }
  }
  const inner = (a: Box, b: Box) => a !== b && a[0] >= b[0] - 2 && a[1] >= b[1] - 2 && a[2] <= b[2] + 2 && a[3] <= b[3] + 2;
  const cards = rects.filter((r, i) => area(r) < W * H * 0.9 && !rects.some((o, j) => j !== i && inner(r, o) && !(inner(o, r) && j > i)));
  return cards.length >= 2 ? cards : [];
}

export interface Panel { b: Box; words: Word[]; med: number }

/**
 * Regions to panels: text-only strips (titles, legends, axis labels) join the region below or above them; a region with
 * a big number stays on its own (a KPI); tiny specks and remains nested inside a larger panel are dropped.
 */
export function assemblePanels(regions: Box[], words: Word[], W: number, H: number, medH?: number): Panel[] {
  const med = medH ?? medianHeight(words);
  const stacked = labelStacks(words, med);
  const big = (p: { words: Word[] }) => p.words.some((w) => isBigBox(w, med) && !stacked.has(w));
  let ps = regions.filter((b) => area(b) > W * H * 0.0008 && b[2] - b[0] > 6 && b[3] - b[1] > 6).map((b) => ({ b: [...b] as Box, words: wordsIn(words, b) }));
  const textOnly = (p: { b: Box; words: Word[] }) => {
    if (!p.words.length) return false;
    const cover = p.words.reduce((a, w) => a + w.w * w.h, 0) / Math.max(1, area(p.b));
    return !big(p) && (p.b[3] - p.b[1] < med * 4.5 || cover > 0.35);
  };
  // a strip of labels running under two charts (axis labels of both) is split at its wide gaps first, so each part
  // joins the chart above or below it
  ps = ps.flatMap((p) => {
    if (!textOnly(p) || p.words.length < 2) return [p];
    const ws = [...p.words].sort((a, b) => a.x - b.x), parts: Word[][] = [[ws[0]]];
    for (const w of ws.slice(1)) { const last = parts[parts.length - 1], prev = last[last.length - 1]; if (w.x - (prev.x + prev.w) > med * 4) parts.push([w]); else last.push(w); }
    if (parts.length < 2) return [p];
    return parts.map((g) => ({ b: [Math.min(...g.map((w) => w.x)), p.b[1], Math.max(...g.map((w) => w.x + w.w)), p.b[3]] as Box, words: g }));
  });
  for (let pass = 0; pass < 3; pass++) {
    for (const s of ps.filter(textOnly)) {
      if (!ps.includes(s)) continue;
      const overlapX = (p: { b: Box }) => Math.max(0, Math.min(p.b[2], s.b[2]) - Math.max(p.b[0], s.b[0])) / Math.max(1, Math.min(p.b[2] - p.b[0], s.b[2] - s.b[0]));
      // (never onto a KPI tile: text above a row of tiles is a page or section heading)
      const cand = ps.filter((p) => p !== s && overlapX(p) > 0.5 && !textOnly(p) && !big(p))
        // titles sit above their visual, so joining upward costs more, except for labels hugging the panel above (axis labels)
        .map((p) => ({ p, gap: p.b[1] >= s.b[3] ? p.b[1] - s.b[3] : s.b[1] >= p.b[3] ? (s.b[1] - p.b[3] < med * 1.5 ? (s.b[1] - p.b[3]) * 0.5 : (s.b[1] - p.b[3]) * 1.5) : Infinity }))
        .filter((c) => c.gap < Math.max(med * 6, H * 0.06)).sort((a, b) => a.gap - b.gap);
      if (!cand.length) continue;
      const t = cand[0].p;
      t.b = [Math.min(t.b[0], s.b[0]), Math.min(t.b[1], s.b[1]), Math.max(t.b[2], s.b[2]), Math.max(t.b[3], s.b[3])];
      t.words = wordsIn(words, t.b);
      ps = ps.filter((p) => p !== s);
    }
  }
  // a borderless chart can be cut between its marks (bars far apart, no frame): wordless pieces side by side that share a
  // baseline, or stacked pieces that share a left edge, are one visual
  const near = (a: Box, b: Box, axis: 'x' | 'y') => {
    const gap = axis === 'x' ? Math.max(a[0], b[0]) - Math.min(a[2], b[2]) : Math.max(a[1], b[1]) - Math.min(a[3], b[3]);
    const ov = axis === 'x' ? Math.min(a[3], b[3]) - Math.max(a[1], b[1]) : Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
    const span = axis === 'x' ? Math.min(a[3] - a[1], b[3] - b[1]) : Math.min(a[2] - a[0], b[2] - b[0]);
    return gap >= 0 && gap <= Math.max(med * 6, W * 0.05) && ov >= span * 0.3;
  };
  const untitled = (p: { b: Box; words: Word[] }) => p.words.filter((w) => w.kept && w.text).every((w) => w.y > p.b[1] + (p.b[3] - p.b[1]) * 0.7);
  for (let merged = true; merged;) {
    merged = false;
    for (const p of ps) {
      // (stacked pieces only when one has no words: two charts one above the other, each with its axis labels, are two
      // visuals even when the upper one's title is masked)
      const q = ps.find((q) => q !== p && !big(p) && !big(q)
        && ((near(p.b, q.b, 'x') && Math.abs(p.b[3] - q.b[3]) <= Math.max(4, med * 0.6) && (!p.words.length || !q.words.length || untitled(p)))
          || (near(p.b, q.b, 'y') && Math.abs(p.b[0] - q.b[0]) <= 4 && (!p.words.length || !q.words.length))));
      if (!q) continue;
      q.b = [Math.min(p.b[0], q.b[0]), Math.min(p.b[1], q.b[1]), Math.max(p.b[2], q.b[2]), Math.max(p.b[3], q.b[3])];
      q.words = wordsIn(words, q.b); ps = ps.filter((x) => x !== p); merged = true; break;
    }
  }
  ps = ps.filter((p) => !ps.some((q) => q !== p && area(q.b) > area(p.b) && inside(center(p.b), q.b) && area(p.b) < area(q.b) * 0.25 && (!big(p) || looksLikeTable(q.words, med))));
  return ps.filter((p) => area(p.b) > W * H * 0.004 || big(p)).map((p) => ({ ...p, med }));
}

export function findPanels(img: Img, words: Word[], med?: number): Panel[] {
  // filled cards first; on a page whose cards are its own colour, their outlines
  let cards = findCards(img);
  if (!cards.length) cards = findOutlinedCards(img);
  if (!cards.length) return assemblePanels(findRegions(img), words, img.width, img.height, med);
  // one visual per card, unless the card clearly holds several (each part at least a fifth of the card)
  const regions: Box[] = [];
  for (const c of cards) {
    const parts = findRegions(img, {}, c).filter((r) => area(r) >= area(c) * 0.2);
    if (parts.length >= 2) regions.push(...parts); else regions.push(c);
  }
  // and whatever sits outside the cards (a page title, a filter strip)
  const overlap = (r: Box, c: Box) => Math.max(0, Math.min(r[2], c[2]) - Math.max(r[0], c[0])) * Math.max(0, Math.min(r[3], c[3]) - Math.max(r[1], c[1]));
  findRegions(img).forEach((r) => { if (!cards.some((c) => overlap(r, c) > area(r) * 0.2)) regions.push(r); });
  return assemblePanels(regions, words, img.width, img.height, med);
}
