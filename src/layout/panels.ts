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
  gapFrac: 0.007,      // smallest gutter, as a share of the page's short side (measured on fidelity: 0.011 missed narrow ones)
  cross: false,        // a line running across an empty band blocks a cut there (measured: worse on real pages)
  trimTol: 0,          // ink allowed in a margin row next to a border line (rounded frame corners; measured: 0 is best)
  band: false,         // children keep the full band across a cut (measured: worse on real pages)
  filled: false,       // a gutter row is one colour, so a row through a solid bar is not one (measured: worse on real pages)
  atomArea: 0.005,     // a region this small a share of the page is one visual at most: cutting it only breaks a title
  atomH: 0.06,          // into words and a card into its value and its label (0 for either turns the stop off)
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
  function bestGap(prof: number[], cross: number[], len: number, off?: number[], frame?: boolean[]): [number, number] | null {
    let best: [number, number] | null = null, s = -1, framed = false;
    for (let i = 0; i <= prof.length; i++) {
      // nothing runs across a gutter (a card's side border does), and it holds at most a few stray pixels or a rule
      const rule = i < prof.length && isRule(prof[i], len);
      const empty = i < prof.length && ((opts.cross ? cross[i] === 0 && prof[i] <= Math.max(2, len * 0.02) : prof[i] <= 2) && (!off || off[i] <= Math.max(2, len * 0.03)) || rule);
      if (empty && s < 0) { s = i; framed = false; }
      if (empty && frame && frame[i]) framed = true;
      if (!empty && s >= 0) {
        // (a narrow gutter counts beside a box's edge: a line across the region with a corner at each end, the bottom of a
        // header box over an L of sidebar and content; a chart's gridline has no corners)
        // (only where gutters are normally wide: on a small image the usual minimum is already a few pixels)
        const wide = i - s >= minGap || (framed && minGap >= 8 && i - s >= Math.max(4, Math.round(minGap * 0.6)));
        if (s > 0 && i < prof.length && wide && (!best || i - s > best[1] - best[0])) best = [s, i];
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
    // A region already no bigger than the smallest visual a dashboard uses holds one visual at most. Cutting on it
    // only breaks a title into its words and a card into its value and its label, and those pieces are then too small
    // to be visuals at all. (On a page of cards this never bites: a card is far bigger than this.)
    if (opts.atomArea > 0 && opts.atomH > 0 && w * h < W * H * opts.atomArea && h < H * opts.atomH) return node;
    const py = Array.from({ length: h }, (_, i) => rowInk(x0, x1, y0 + i)), px = Array.from({ length: w }, (_, i) => colInk(y0, y1, x0 + i));
    const cy = Array.from({ length: h }, (_, i) => rowCross(x0, x1, y0 + i)), cx = Array.from({ length: w }, (_, i) => colCross(y0, y1, x0 + i));
    // (only lines that pass the edge test need the colour test)
    const oy = opts.filled ? py.map((n, i) => (n <= 2 ? rowOff(x0, x1, y0 + i) : 0)) : undefined, ox = opts.filled ? px.map((n, i) => (n <= 2 ? colOff(y0, y1, x0 + i) : 0)) : undefined;
    // box edges: a line across the region whose ends turn a corner (ink running off it at both ends, one side)
    // (one way only: a box's edge turns away from the gap, while a table's row line has column lines both above and below;
    // the side line may start a pixel or two in from the end of the edge, past an antialiased corner)
    const runs = (u: number, v: number, along: 'x' | 'y', d: number) => [-2, -1, 0, 1, 2].some((o) => [1, 2, 3, 4].every((k) => { const [x, y] = along === 'x' ? [u + o, v + d * k] : [u + d * k, v + o]; return x >= 0 && y >= 0 && x < W && y < H && e[y * W + x] === 1; }));
    const turns = (u: number, v: number, along: 'x' | 'y') => runs(u, v, along, -1) !== runs(u, v, along, 1);
    const ends = (n: number, at: (k: number) => number) => { let a = -1, z = -1; for (let k = 0; k < n; k++) if (at(k)) { if (a < 0) a = k; z = k; } return [a, z]; };
    // (long: in a strip one line of text tall, a letter's upright spans it and turns at both ends, as an E does)
    const edgeMin = Math.max(40, minGap * 5);
    // (never the edge of a mask: the app's grey boxes over masked words have corners too, and stand in titles and labels)
    const grey = (x: number, y: number) => { const q = (y * W + x) * img.channels, d = img.data; return isMaskGrey(d[q], d[q + 1], d[q + 2]) || [-1, 1].some((k) => y + k >= 0 && y + k < H && isMaskGrey(d[q + k * W * img.channels], d[q + k * W * img.channels + 1], d[q + k * W * img.channels + 2])); };
    const greyX = (x: number, y: number) => { const q = (y * W + x) * img.channels, d = img.data; return isMaskGrey(d[q], d[q + 1], d[q + 2]) || [-1, 1].some((k) => x + k >= 0 && x + k < W && isMaskGrey(d[q + k * img.channels], d[q + k * img.channels + 1], d[q + k * img.channels + 2])); };
    const fy = py.map((n, i) => { if (!isRule(n, w)) return false; const y = y0 + i, [a, z] = ends(w, (k) => e[y * W + x0 + k]); return a >= 0 && z - a >= edgeMin && !grey(x0 + ((a + z) >> 1), y) && turns(x0 + a, y, 'x') && turns(x0 + z, y, 'x'); });
    const fx = px.map((n, i) => { if (!isRule(n, h)) return false; const x = x0 + i, [a, z] = ends(h, (k) => e[(y0 + k) * W + x]); return a >= 0 && z - a >= edgeMin && !greyX(x, y0 + ((a + z) >> 1)) && turns(x, y0 + a, 'y') && turns(x, y0 + z, 'y'); });
    const gy = bestGap(py, cy, w, oy, fy), gx = bestGap(px, cx, h, ox, fx);
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
export function findCards(img: Img, extended = false): Box[] {
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
  // candidate card colours: the commonest exact colour, the commonest colour families (a shaded card spreads its pixels
  // over many close shades, so no single shade of it wins), and the page itself (the screenshot's own frame can share
  // the cards' colour: white cards on a light blue page, inside a white frame); the one whose cards cover most wins
  const families = new Map<number, { n: number; c: [number, number, number] }>();
  for (const c of all) { const k = ((c[0] >> 4) << 8) | ((c[1] >> 4) << 4) | (c[2] >> 4), e = families.get(k); if (e) e.n++; else families.set(k, { n: 1, c }); }
  const tops = [...families.values()].sort((a, b) => b.n - a.n).slice(0, 4).filter((e) => e.n >= gw * gh * 0.04).map((e) => e.c);
  if (fill.n < gw * gh * 0.06 && !tops.length) return [];
  // (the exact colour first, matched strictly as before; a family or the page only when it finds more cards, grown along
  // their shading: one merged area covering many visuals is never preferred over several real cards)
  let best = fill.n >= gw * gh * 0.06 ? cardsOf(fill.c, false) : [];
  if (!extended) return best;
  for (const [c, shaded] of [...tops.map((t) => [t, true] as const), [page, false] as const]) {
    const cs = cardsOf(c, shaded);
    if (cs.length > best.length) best = cs;
  }
  return best;

  function cardsOf(fillC: [number, number, number], shaded: boolean): Box[] {
  // (a card's fill may shade gradually, a translucent card over a gradient page: cells near the fill colour join a card
  // through neighbours that differ only a little, so a card follows its own gradient and stops at its edge, where the
  // page beside it is clearly unlike it; a flat fill is the same as before)
  const on = new Uint8Array(gw * gh), cell: [number, number, number][] = new Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) { const c = px(gx, gy); cell[gy * gw + gx] = c; on[gy * gw + gx] = dist(c, fillC) <= (shaded ? 28 : 3) ? 1 : 0; }
  const seen = new Uint8Array(gw * gh), cards: Box[] = [], stack: number[] = [];
  for (let s = 0; s < on.length; s++) {
    if (!on[s] || seen[s] || dist(cell[s], fillC) > (shaded ? 10 : 3)) continue;   // (seeded only from close to the fill colour)
    let n = 0, x0 = gw, y0 = gh, x1 = 0, y1 = 0;
    const mine: number[] = [];
    stack.push(s); seen[s] = 1;
    const join = (p: number, q: number) => on[q] && !seen[q] && (!shaded || dist(cell[p], cell[q]) <= 4);
    while (stack.length) {
      const p = stack.pop()!, x = p % gw, y = (p - x) / gw; n++; mine.push(p);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && join(p, p - 1)) { seen[p - 1] = 1; stack.push(p - 1); }
      if (x < gw - 1 && join(p, p + 1)) { seen[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && join(p, p - gw)) { seen[p - gw] = 1; stack.push(p - gw); }
      if (y < gh - 1 && join(p, p + gw)) { seen[p + gw] = 1; stack.push(p + gw); }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    // a card: a sizeable, mostly filled rectangle (content leaves holes), not the whole page; or a frame of fill around
    // content that takes most of it (a map or a picture), its fill running round the card's whole edge
    const inC = new Set(mine);
    let edge = 0, onEdge = 0;
    for (let x = x0; x <= x1; x++) for (const y of [y0, y1]) { edge++; if (inC.has(y * gw + x)) onEdge++; }
    for (let y = y0 + 1; y < y1; y++) for (const x of [x0, x1]) { edge++; if (inC.has(y * gw + x)) onEdge++; }
    const framed = n >= bw * bh * 0.2 && onEdge >= edge * 0.8;
    if (bw * bh >= gw * gh * 0.01 && (n >= bw * bh * 0.45 || framed) && bw * bh < gw * gh * 0.9 && bw >= gw * 0.05 && bh >= gh * 0.05)
      cards.push([x0 * step, y0 * step, Math.min(W, (x1 + 1) * step), Math.min(H, (y1 + 1) * step)]);
  }
  const covered = cards.reduce((a, b) => a + area(b), 0);
  return cards.length >= 2 && covered >= W * H * 0.1 ? cards : [];
  }
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
  // border greys, or pale tints (a light blue outline on a light page), not series colours or masks
  const quiet = (c: number[]) => !isMaskGrey(c[0], c[1], c[2]) && (Math.max(...c) - Math.min(...c) <= 24 || (Math.min(...c) >= 140 && Math.max(...c) - Math.min(...c) <= 90));
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
export function assemblePanels(regions: Box[], words: Word[], W: number, H: number, medH?: number, allWords: Word[] = words): Panel[] {
  const med = medH ?? medianHeight(words);
  const stacked = labelStacks(allWords, med);
  // (judged on every word the reader found, masks included: the caller hides the tallest masks from the cutter, and a
  //  KPI card whose value is one of them then looks like a strip of labels and is joined to the chart below it)
  const big = (p: { b: Box }) => wordsIn(allWords, p.b).some((w) => isBigBox(w, med) && !stacked.has(w));
  // (the words the cutter was given, not every word: a chart carries masked data labels that are big too, and a chart
  //  is exactly what a strip of axis labels should be joining)
  const bigCard = (p: { words: Word[] }) => p.words.some((w) => isBigBox(w, med) && !stacked.has(w));
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
      const cand = ps.filter((p) => p !== s && overlapX(p) > 0.5 && !textOnly(p) && !bigCard(p))
        // titles sit above their visual, so joining upward costs more, except for labels hugging the panel above (axis labels)
        .map((p) => ({ p, gap: p.b[1] >= s.b[3] ? p.b[1] - s.b[3] : s.b[1] >= p.b[3] ? (s.b[1] - p.b[3] < med * 1.5 ? (s.b[1] - p.b[3]) * 0.5 : (s.b[1] - p.b[3]) * 1.5) : Infinity }))
        // (a strip joins what it labels, not whatever lies furthest below it: at six line-heights a KPI card's own
        //  label reached past the card and into the chart under it)
        .filter((c) => c.gap < Math.max(med * 4.5, H * 0.045)).sort((a, b) => a.gap - b.gap);
      if (!cand.length) continue;
      const t = cand[0].p;
      t.b = [Math.min(t.b[0], s.b[0]), Math.min(t.b[1], s.b[1]), Math.max(t.b[2], s.b[2]), Math.max(t.b[3], s.b[3])];
      t.words = wordsIn(words, t.b);
      ps = ps.filter((p) => p !== s);
    }
  }
  // a borderless chart can be cut between its marks (bars far apart, no frame): wordless pieces side by side that share a
  // baseline, or stacked pieces that share a left edge or a middle (a funnel's bars), are one visual
  const near = (a: Box, b: Box, axis: 'x' | 'y') => {
    const gap = axis === 'x' ? Math.max(a[0], b[0]) - Math.min(a[2], b[2]) : Math.max(a[1], b[1]) - Math.min(a[3], b[3]);
    const ov = axis === 'x' ? Math.min(a[3], b[3]) - Math.max(a[1], b[1]) : Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
    const span = axis === 'x' ? Math.min(a[3] - a[1], b[3] - b[1]) : Math.min(a[2] - a[0], b[2] - b[0]);
    return gap >= 0 && gap <= Math.max(med * 6, W * 0.05) && ov >= span * 0.3;
  };
  for (let merged = true; merged;) {
    merged = false;
    for (const p of ps) {
      // (stacked pieces only when one has no words: two charts one above the other, each with its axis labels, are two
      // visuals even when the upper one's title is masked)
      const q = ps.find((q) => q !== p && !big(p) && !big(q)
        && ((near(p.b, q.b, 'x') && Math.abs(p.b[3] - q.b[3]) <= Math.max(4, med * 0.6) && (!p.words.length || !q.words.length))
          || (near(p.b, q.b, 'y') && (Math.abs(p.b[0] - q.b[0]) <= 4 || Math.abs(p.b[0] + p.b[2] - q.b[0] - q.b[2]) <= 8) && (!p.words.length || !q.words.length))
          // (centred on one line, one above the other, holding nothing but masked values: a funnel's bars)
          || (Math.abs(p.b[0] + p.b[2] - q.b[0] - q.b[2]) <= 8 && near(p.b, q.b, 'y') && p.words.every((w) => !w.kept) && q.words.every((w) => !w.kept))));
      if (!q) continue;
      q.b = [Math.min(p.b[0], q.b[0]), Math.min(p.b[1], q.b[1]), Math.max(p.b[2], q.b[2]), Math.max(p.b[3], q.b[3])];
      q.words = wordsIn(words, q.b); ps = ps.filter((x) => x !== p); merged = true; break;
    }
  }
  ps = ps.filter((p) => !ps.some((q) => q !== p && area(q.b) > area(p.b) && inside(center(p.b), q.b) && area(p.b) < area(q.b) * 0.25 && (!big(p) || looksLikeTable(q.words, med))));
  return ps.filter((p) => area(p.b) > W * H * 0.004 || big(p)).map((p) => ({ ...p, med }));
}


/**
 * A panel still holding two visuals, split at a clear band. The cutter works on the whole page and its gutter has to be
 * wide enough not to break charts apart; a panel is a smaller question, so a narrower band will do here, as long as
 * each side is big enough to be a visual on its own and has something drawn in it. A band must cross the whole panel
 * without touching a word or any ink: a chart's own gaps are crossed by its axis labels, and a line or a bar chart has
 * ink across every column of its plot.
 */
export function splitClearBands(img: Img, ps: Panel[], words: Word[], med: number, depth = 0): Panel[] {
  if (depth > 2) return ps;
  const e = edges(img);
  let cut = false;
  const out = ps.flatMap((p) => {
    const x0 = Math.max(0, Math.floor(p.b[0])), x1 = Math.min(img.width, Math.ceil(p.b[2]));
    const y0 = Math.max(0, Math.floor(p.b[1])), y1 = Math.min(img.height, Math.ceil(p.b[3]));
    const W = x1 - x0, H = y1 - y0;
    if (W < 20 || H < 20) return [p];
    // (never a table: its own column gaps are clear bands, and each column alone is just words)
    if (looksLikeTable(p.words, med)) return [p];
    if (W * H < img.width * img.height * 0.12) return [p];
    const minBand = Math.max(14, Math.round(med * 2));
    const colInk = (x: number) => { let n = 0; for (let y = y0; y < y1; y++) n += e[y * img.width + x]; return n; };
    const rowInk = (y: number) => { let n = 0; const o = y * img.width; for (let x = x0; x < x1; x++) n += e[o + x]; return n; };
    const clearCol = (x: number) => colInk(x) <= 1 && !p.words.some((w) => w.x <= x && w.x + w.w >= x);
    const clearRow = (y: number) => rowInk(y) <= 1 && !p.words.some((w) => w.y <= y && w.y + w.h >= y);
    /** The widest run of clear lines strictly inside the panel, as [start, end). */
    const widest = (from: number, to: number, clear: (i: number) => boolean) => {
      let best: [number, number] | null = null, s = -1;
      for (let i = from; i <= to; i++) {
        const ok = i < to && clear(i);
        if (ok && s < 0) s = i;
        if (!ok && s >= 0) { if (s > from && i < to && (!best || i - s > best[1] - best[0])) best = [s, i]; s = -1; }
      }
      return best;
    };
    const gx = widest(x0, x1, clearCol), gy = widest(y0, y1, clearRow);
    const pick = (gap: [number, number] | null, axis: 'x' | 'y') => {
      if (!gap || gap[1] - gap[0] < minBand) return null;
      const at = Math.round((gap[0] + gap[1]) / 2);
      const a: Box = axis === 'x' ? [p.b[0], p.b[1], at, p.b[3]] : [p.b[0], p.b[1], p.b[2], at];
      const b: Box = axis === 'x' ? [at, p.b[1], p.b[2], p.b[3]] : [p.b[0], at, p.b[2], p.b[3]];
      const parts = [a, b].map((q) => ({ b: q, words: wordsIn(words, q), med: p.med }));
      if (!parts.every((q) => couldBeVisual(q, img.width, img.height) && q.words.length >= 5)) return null;
      // each side draws something of its own: a panel split off its own white margin is not two visuals
      const drawn = (q: Panel) => {
        let n = 0;
        for (let y = Math.max(0, Math.floor(q.b[1])); y < Math.min(img.height, Math.ceil(q.b[3])); y += 2) {
          for (let x = Math.max(0, Math.floor(q.b[0])); x < Math.min(img.width, Math.ceil(q.b[2])); x += 2) if (e[y * img.width + x]) n++;
        }
        return n >= 40;
      };
      return parts.every(drawn) ? parts : null;
    };
    const best = (gx && gy && gx[1] - gx[0] >= gy[1] - gy[0] ? pick(gx, 'x') || pick(gy, 'y') : pick(gy, 'y') || pick(gx, 'x'));
    if (!best) return [p];
    cut = true;
    return best;
  });
  return cut ? splitClearBands(img, out, words, med, depth + 1) : out;
}

export function findPanels(img: Img, words: Word[], med?: number, gridWords: Word[] = words): Panel[] {
  const ps = findPanelsRaw(img, words, med, gridWords), m = med ?? medianHeight(words);
  // (never on a report: its table's masked numbers are not KPI values)
  // (values judged on the reader's own word boxes: the words given here leave out the tallest masks, which a big value is)
  const split = looksLikeTable(gridWords, m) ? ps
    : splitKpiStacks(img, splitKpiRows(img, ps.map((p) => ({ ...p, words: wordsIn(gridWords, p.b) })), gridWords, m), gridWords, m)
      .map((p) => ({ ...p, words: wordsIn(words, p.b) }));
  const apart = splitClearBands(img, split, gridWords, m).map((q) => ({ ...q, words: wordsIn(words, q.b) }));
  return apart.filter((p) => couldBeVisual(p, img.width, img.height) || apart.length === 1);
}

/**
 * Could this panel hold a visual at all? Toolbars, breadcrumbs, tab strips, page titles and the rails of the tool the
 * dashboard was screenshotted in come out of the region finder as panels, and anything with a word in it then reads as
 * a KPI card, which the user sees at once as a card the original never had. A visual is a block of the page: of 221
 * hand-labelled visuals on real dashboards the smallest is 6.8% of the page tall and 0.51% of its area, so a band under
 * 6.5% of the height, 5.5% of the width or 0.4% of the area is chrome, not a visual. (A page that yields one panel keeps it: that is a single visual snipped on
 * its own, and the page is its own scale.)
 */
export function couldBeVisual(p: { b: Box }, W: number, H: number): boolean {
  const w = p.b[2] - p.b[0], h = p.b[3] - p.b[1];
  // (narrow as well as short: the slimmest hand-labelled visual is 6.7% of the page wide, so a column of words
  //  narrower than that is an axis's labels or a legend standing on its own, not a visual)
  return w * h >= W * H * 0.004 && h >= H * 0.065 && w >= W * 0.055;
}

/**
 * KPI cards found as one panel (no gutter wide or clean enough between them): a panel holding two or more big values side
 * by side is split between them, where a line from top to bottom crosses no word and next to no ink (a faint shadow at
 * most). Each part keeps its own value and the words above and below it.
 */
export function splitKpiRows(img: Img, ps: Panel[], words: Word[], med: number): Panel[] {
  const e = edges(img);
  const stacked = labelStacks(words, med);
  return ps.flatMap((p) => {
    // (not a table: a column of masked numbers is not a row of values)
    if (looksLikeTable(p.words, med)) return [p];
    // (values are numbers, and numbers are masked: a big readable word is a title)
    const value = (w: Word) => !w.kept && isBigBox(w, med) && !stacked.has(w);
    const bigs = p.words.filter(value).sort((a, b) => a.x - b.x);
    if (bigs.length < 2) return [p];
    // big values in one row (their middles at about one height)
    const mid = (w: Word) => w.y + w.h / 2, row = bigs.filter((w) => Math.abs(mid(w) - mid(bigs[0])) <= Math.max(w.h, bigs[0].h));
    if (row.length < 2) return [p];
    const y0 = Math.max(0, Math.floor(p.b[1])), y1 = Math.min(img.height, Math.ceil(p.b[3])), hgt = y1 - y0;
    const cuts: number[] = [];
    for (let i = 1; i < row.length; i++) {
      const a = row[i - 1].x + row[i - 1].w, z = row[i].x;
      if (z - a < med * 3) continue;
      // the cleanest column between the two values: no word across it, the least ink
      let best = -1, bestInk = Infinity;
      for (let x = Math.ceil(a + med); x < Math.floor(z - med); x++) {
        if (p.words.some((w) => w.x <= x && w.x + w.w >= x)) continue;
        let n = 0; for (let y = y0; y < y1; y++) n += e[y * img.width + x];
        if (n < bestInk) { bestInk = n; best = x; }
      }
      if (best >= 0 && bestInk <= hgt * 0.15) cuts.push(best);
    }
    if (!cuts.length || cuts.length > 5) return [p];
    const xs = [p.b[0], ...cuts, p.b[2]];
    const parts = xs.slice(1).map((x, i) => { const b: Box = [xs[i], p.b[1], x, p.b[3]]; return { b, words: wordsIn(words, b), med: p.med }; });
    // (each part a card: its value, a readable label, and few words; a chart's masked data labels sit among axis labels)
    // (or a bare row of values, each part holding its value and nothing else, the labels having been cut into a strip
    //  of their own above or below: a chart's data labels never sit alone like that)
    const labelled = (q: Panel) => q.words.some((w) => w.kept && w.text && !isBigBox(w, med));
    return parts.every((q) => q.words.length <= 8 && q.words.some(value))
      && (parts.every(labelled) || parts.every((q) => q.words.length <= 3)) ? parts : [p];
  });
}

/**
 * A KPI card sitting on top of its own chart, both inside one card (a Tableau favourite: "Conversion" with its big
 * value, and a small column chart of the same measure by month under it). They are two visuals, and a replica that
 * draws one loses the value or the chart. Split where a line from side to side crosses no word and next to no ink,
 * below a big value in the upper part of the panel, with a real chart's ink below it.
 */
export function splitKpiStacks(img: Img, ps: Panel[], words: Word[], med: number): Panel[] {
  const e = edges(img);
  const stacked = labelStacks(words, med);
  return ps.flatMap((p) => {
    if (looksLikeTable(p.words, med)) return [p];
    const hgt = p.b[3] - p.b[1], x0 = Math.max(0, Math.floor(p.b[0])), x1 = Math.min(img.width, Math.ceil(p.b[2])), wide = x1 - x0;
    if (wide < med * 6 || hgt < med * 12) return [p];
    // the card's value: the tallest masked word, and taller than any text a chart labels its marks with
    const masked = p.words.filter((w) => !w.kept && isBigBox(w, med) && !stacked.has(w)).sort((a, b) => b.h - a.h);
    const lead = masked[0];
    if (!lead || lead.h < med * 2.2) return [p];
    // it belongs to a card above the chart, not to the chart: it sits in the upper part of the panel
    if (lead.y + lead.h - p.b[1] > hgt * 0.5) return [p];
    // the widest word-free band below it, which is the gap between the card and the chart (gaps inside a card, between
    // its value and its label, are smaller than a line of text)
    const rowsOf = p.words.filter((w) => w.y + w.h > lead.y + lead.h).map((w) => [w.y, w.y + w.h] as [number, number]).sort((a, b) => a[0] - b[0]);
    let gapTop = lead.y + lead.h, gapBot = p.b[3], at = -1, span = 0;
    let edgeY = gapTop;
    for (const [a, z] of rowsOf.concat([[p.b[3], p.b[3]]])) {
      if (a - edgeY > span) { span = a - edgeY; gapTop = edgeY; gapBot = a; }
      edgeY = Math.max(edgeY, z);
    }
    if (span < med * 0.9) return [p];
    const ink = (y: number) => { let n = 0; for (let x = x0; x < x1; x++) n += e[y * img.width + x]; return n; };
    let bestInk = Infinity;
    for (let y = Math.ceil(gapTop); y <= Math.floor(gapBot); y++) { const n = ink(y); if (n < bestInk) { bestInk = n; at = y; } }
    if (at < 0 || bestInk > wide * 0.12) return [p];
    // below the cut a chart, not more of the card: ink spread down the part, and no text as big as the card's value
    const below = Math.min(img.height, Math.ceil(p.b[3])) - at - 1;
    if (below < hgt * 0.2) return [p];
    let drawn = 0, total = 0;
    for (let y = at + 1; y <= at + below; y++) { const n = ink(y); total += n; if (n > wide * 0.04) drawn++; }
    if (drawn < below * 0.2 || total < wide * below * 0.012) return [p];
    const parts = ([[p.b[0], p.b[1], p.b[2], at], [p.b[0], at, p.b[2], p.b[3]]] as Box[])
      .map((b) => ({ b, words: wordsIn(words, b), med: p.med }));
    return parts[0].words.length <= 10 && !parts[1].words.some((w) => w.h >= lead.h * 0.8)
      && parts.every((q) => couldBeVisual(q, img.width, img.height)) ? parts : [p];
  });
}

function findPanelsRaw(img: Img, words: Word[], med?: number, gridWords: Word[] = words): Panel[] {
  // filled cards first; on a page whose cards are its own colour, their outlines
  // (a page that is one table of words is a report, not cards: the rescue below never applies to it; judged on the
  // reader's own word boxes, as the report check is, since masks over a column of numbers merge into tall blocks)
  const page = img.width * img.height, report = looksLikeTable(gridWords, med ?? medianHeight(gridWords));
  const giant = (rs: Box[]) => !report && rs.some((r) => area(r) > page * 0.45);
  const panelsGiant = (ps: Panel[]) => giant(ps.map((p) => p.b));
  const fromCards = (cs: Box[], rescue = false) => fromCardsOf(img, words, med, cs, rescue, gridWords);
  // (rescued cards hold words, a title or labels, as a dashboard's cards do; a single chart's bars, found as colour
  // areas, hold none: at least three cards, most of them with words)
  const worded = (cs: Box[]) => (cs.length >= 3 && cs.filter((c) => wordsIn(words, c).length >= 2).length >= cs.length * 0.6 ? cs : []);
  let cards = findCards(img), grown = false;
  // A screenshot taken with the tool's own frame around it puts that frame's colour along the image border, so the
  // page colour is read from the frame and the dashboard's own background looks like a card. The wider search knows
  // that case (it tries the colour families and the frame's colour too); it used to run only when the cuts left one
  // giant region, which never happens on a page whose cards the cuts break into fragments.
  if (!cards.length) { const wider = worded(findCards(img, true)); if (wider.length) { cards = wider; grown = true; } }
  if (!cards.length) cards = findOutlinedCards(img);
  if (!cards.length) {
    const regions = findRegions(img);
    // (when the cuts leave one region over about half the page, the gutters between its cards were not found: try cards
    // in shaded fills, other colour families, or the colour of the screenshot's own frame)
    if (!giant(regions)) return assemblePanels(regions, words, img.width, img.height, med, gridWords);
    const rescued = worded(findCards(img, true));
    return rescued.length ? fromCards(rescued, true) : assemblePanels(regions, words, img.width, img.height, med, gridWords);
  }
  const panels = fromCards(cards, grown);
  // (likewise when cards were found but a region over about half the page is left beside them)
  if (!panelsGiant(panels)) return panels;
  const more = worded(findCards(img, true));
  const wider = more.length > cards.length ? fromCards(more, true) : panels;
  if (!panelsGiant(wider)) return wider;
  // Still one block over half the page: this dashboard has no cards at all, only white space between its visuals, and
  // the fill finder has read the page itself as one card. Cut the white space instead.
  const cut = assemblePanels(findRegions(img), words, img.width, img.height, med, gridWords);
  return cut.length > wider.length ? cut : wider;
}

function fromCardsOf(img: Img, words: Word[], med: number | undefined, cards: Box[], rescue: boolean, gridWords: Word[] = words): Panel[] {
  // one visual per card, unless the card clearly holds several (each part at least a fifth of the card)
  const regions: Box[] = [];
  for (const c of cards) {
    const parts = findRegions(img, {}, c).filter((r) => area(r) >= area(c) * 0.2);
    if (parts.length >= 2) regions.push(...parts); else regions.push(c);
  }
  // and whatever sits outside the cards (a page title, a filter strip)
  const overlap = (r: Box, c: Box) => Math.max(0, Math.min(r[2], c[2]) - Math.max(r[0], c[0])) * Math.max(0, Math.min(r[3], c[3]) - Math.max(r[1], c[1]));
  // (no single card covers much of it; in a rescue, the cards together: there, a region around the whole page holds them
  // all and would swallow them, while elsewhere such a region is a report's table, whose bands looked like cards)
  findRegions(img).forEach((r) => { if (rescue ? cards.reduce((a, c) => a + overlap(r, c), 0) <= area(r) * 0.2 : !cards.some((c) => overlap(r, c) > area(r) * 0.2)) regions.push(r); });
  return assemblePanels(regions, words, img.width, img.height, med, gridWords);
}
