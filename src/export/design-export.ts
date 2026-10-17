/**
 * Design export (Feature 5), built as web/lib/vs-design.js (window.VSDesign).
 * Turns a replica into files designers and developers can pick up:
 *   - toSvg:        one layered SVG (rectangles, real text, chart vectors) that Figma, Penpot and Illustrator open as editable
 *                   layers. A design file is a picture, so it is drawn from the replica as rendered.
 *   - reactPackage: a zip with a React component that runs the VaultSnip replica engine itself. Values, chart sizes, labels,
 *                   tooltips, cross-filtering and the CSV download are all computed at runtime from the spec and a seed;
 *                   nothing is frozen into the code.
 * Both run on the device and make no network calls. The caller passes the replica or spec for the current privacy mode,
 * so nothing outside the mode leaves. The "SYNTHETIC DATA" watermark and ribbon are part of every file.
 */

/* ---------- pure helpers (unit tested) ---------- */

export interface Paint { color: string; opacity: number }

/** Parses a computed CSS colour (rgb/rgba/#hex) into an SVG colour and opacity; null for transparent. */
export function paint(css: string | null | undefined): Paint | null {
  const s = String(css || '').trim();
  if (!s || s === 'transparent' || s === 'none') return null;
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(s);
  if (m) {
    const a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    if (!(a > 0)) return null;
    const hex = [m[1], m[2], m[3]].map((x) => Math.max(0, Math.min(255, Math.round(+x))).toString(16).padStart(2, '0')).join('');
    return { color: '#' + hex, opacity: Math.min(1, a) };
  }
  if (/^#[0-9a-f]{3,8}$/i.test(s)) return { color: s.toLowerCase(), opacity: 1 };
  return null;
}

// XML 1.0 forbids most control characters; text from an AI-read screenshot may contain them.
const BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
export const escXml = (s: unknown): string =>
  String(s ?? '').replace(BAD_XML, '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] as string);

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Collapses whitespace the way HTML layout does, and applies text-transform. */
export function layoutText(raw: string, whiteSpace = 'normal', transform = 'none'): string {
  let t = /^pre/.test(whiteSpace) ? raw : raw.replace(/\s+/g, ' ');
  if (transform === 'uppercase') t = t.toUpperCase();
  else if (transform === 'lowercase') t = t.toLowerCase();
  return t;
}

/** How far (in em) to move a text's y so an alphabetic baseline lands where a dominant-baseline value put it. */
export function baselineShift(dominantBaseline: string): number {
  const d = dominantBaseline.toLowerCase();
  if (d === 'central' || d === 'middle') return 0.35;
  if (d === 'hanging' || d === 'text-before-edge') return 0.8;
  if (d === 'text-after-edge' || d === 'ideographic') return -0.2;
  return 0;
}

/** A safe React component name from a dashboard title. */
export function componentName(title: string): string {
  const words = String(title || '').normalize('NFKD').replace(/[^\w\s]/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 5);
  const name = words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('').replace(/^[^A-Za-z]+/, '');
  return (name || 'Dashboard') + 'Replica';
}

// The CSV download button needs a live page; a design file is a picture, so the button is left out of the SVG.
const isAppOnly = (el: Element) => !!el.classList && el.classList.contains('rp-csv');

/* ---------- SVG for Figma ---------- */

export interface SvgOptions { title?: string }

interface Box { x: number; y: number; w: number; h: number }

/** The replica as one SVG with real text and vector charts. `root` must be laid out (visible or positioned off-screen). */
export function toSvg(root: HTMLElement, opts: SvgOptions = {}): string {
  const origin = root.getBoundingClientRect();
  const W = Math.ceil(origin.width), H = Math.ceil(root.scrollHeight || origin.height);
  const box = (r: DOMRect): Box => ({ x: r2(r.left - origin.left), y: r2(r.top - origin.top), w: r2(r.width), h: r2(r.height) });
  const defs: string[] = [];
  let clipN = 0;
  const out: string[] = [];

  const fillAttr = (p: Paint | null) => (p ? `fill="${p.color}"${p.opacity < 1 ? ` fill-opacity="${r2(p.opacity)}"` : ''}` : 'fill="none"');

  function walk(el: Element) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || isAppOnly(el)) return;
    const b = box(el.getBoundingClientRect());
    const op = parseFloat(cs.opacity);
    const opened: string[] = [];
    if (op < 1) { out.push(`<g opacity="${r2(op)}">`); opened.push('</g>'); }

    // ECharts and sparklines are already SVG: nest them as they are.
    if (el instanceof SVGSVGElement || el.localName === 'svg') {
      if (b.w > 0 && b.h > 0) out.push(nestSvg(el as SVGSVGElement, b));
      out.push(...opened.reverse());
      return;
    }

    if (b.w > 0 && b.h > 0) out.push(...boxShapes(cs, b));

    const clips = cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible';
    if (clips && b.w > 0 && b.h > 0) {
      const id = 'vs-clip-' + ++clipN;
      const rx = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, b.w / 2, b.h / 2);
      defs.push(`<clipPath id="${id}"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"${rx ? ` rx="${r2(rx)}"` : ''}/></clipPath>`);
      out.push(`<g clip-path="url(#${id})">`); opened.push('</g>');
    }
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === 1) walk(n as Element);
      else if (n.nodeType === 3) text(n as Text, cs);
    }
    out.push(...opened.reverse());
  }

  function boxShapes(cs: CSSStyleDeclaration, b: Box): string[] {
    const shapes: string[] = [];
    const bg = paint(cs.backgroundColor);
    const rx = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, b.w / 2, b.h / 2);
    const side = (s: 'Top' | 'Right' | 'Bottom' | 'Left') => ({ w: parseFloat(cs.getPropertyValue(`border-${s.toLowerCase()}-width`)) || 0, p: cs.getPropertyValue(`border-${s.toLowerCase()}-style`) === 'none' ? null : paint(cs.getPropertyValue(`border-${s.toLowerCase()}-color`)) });
    const sides = { t: side('Top'), r: side('Right'), b: side('Bottom'), l: side('Left') };
    const all = [sides.t, sides.r, sides.b, sides.l];
    const uniform = all.every((s) => s.w === sides.t.w && s.p && sides.t.p && s.p.color === sides.t.p.color);
    const rxA = rx ? ` rx="${r2(rx)}"` : '';
    if (uniform && sides.t.w > 0 && sides.t.p) {
      const w = sides.t.w;
      shapes.push(`<rect x="${r2(b.x + w / 2)}" y="${r2(b.y + w / 2)}" width="${r2(Math.max(0, b.w - w))}" height="${r2(Math.max(0, b.h - w))}"${rxA} ${fillAttr(bg)} stroke="${sides.t.p.color}"${sides.t.p.opacity < 1 ? ` stroke-opacity="${r2(sides.t.p.opacity)}"` : ''} stroke-width="${r2(w)}"/>`);
      return shapes;
    }
    if (bg) shapes.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"${rxA} ${fillAttr(bg)}/>`);
    const line = (x: number, y: number, w: number, h: number, p: Paint | null) => { if (p && w > 0 && h > 0) shapes.push(`<rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" ${fillAttr(p)}/>`); };
    line(b.x, b.y, b.w, sides.t.w, sides.t.p);
    line(b.x, b.y + b.h - sides.b.w, b.w, sides.b.w, sides.b.p);
    line(b.x, b.y, sides.l.w, b.h, sides.l.p);
    line(b.x + b.w - sides.r.w, b.y, sides.r.w, b.h, sides.r.p);
    return shapes;
  }

  function text(node: Text, cs: CSSStyleDeclaration) {
    const raw = node.textContent || '';
    if (!raw.trim()) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
    if (!rects.length) return;
    // one <text> per rendered line: find where the browser wrapped by measuring characters
    const lines: { x: number; top: number; h: number; s: string }[] = [];
    if (rects.length === 1) lines.push({ x: rects[0].left, top: rects[0].top, h: rects[0].height, s: raw });
    else {
      let cur: { x: number; top: number; h: number; s: string } | null = null;
      for (let i = 0; i < raw.length; i++) {
        range.setStart(node, i); range.setEnd(node, i + 1);
        const r = range.getClientRects()[0];
        if (!r || (!r.width && /\s/.test(raw[i]))) { if (cur) cur.s += raw[i]; continue; }
        if (!cur || Math.abs(r.top - cur.top) > r.height / 2) { cur = { x: r.left, top: r.top, h: r.height, s: '' }; lines.push(cur); }
        cur.s += raw[i];
      }
    }
    const size = parseFloat(cs.fontSize) || 14;
    const fill = paint(cs.color) || { color: '#000000', opacity: 1 };
    const family = escXml(cs.fontFamily.replace(/"/g, "'"));
    const weight = cs.fontWeight && cs.fontWeight !== '400' && cs.fontWeight !== 'normal' ? ` font-weight="${escXml(cs.fontWeight)}"` : '';
    const italic = cs.fontStyle === 'italic' ? ' font-style="italic"' : '';
    for (const l of lines) {
      const s = layoutText(l.s, cs.whiteSpace, cs.textTransform).trim();
      if (!s) continue;
      const baseline = l.top - origin.top + l.h / 2 + size * 0.35;
      out.push(`<text x="${r2(l.x - origin.left)}" y="${r2(baseline)}" font-family="${family}" font-size="${r2(size)}"${weight}${italic} ${fillAttr(fill)} xml:space="preserve">${escXml(s)}</text>`);
    }
  }

  function nestSvg(svg: SVGSVGElement, b: Box): string {
    const c = svg.cloneNode(true) as SVGSVGElement;
    if (!c.getAttribute('viewBox')) c.setAttribute('viewBox', `0 0 ${b.w} ${b.h}`);
    c.setAttribute('x', String(b.x)); c.setAttribute('y', String(b.y));
    c.setAttribute('width', String(b.w)); c.setAttribute('height', String(b.h));
    c.removeAttribute('style'); c.removeAttribute('class');
    // ECharts text inherits the page font and centres on dominant-baseline; design tools honour neither, so both are made explicit
    const family = getComputedStyle(svg).fontFamily.replace(/"/g, "'");
    c.querySelectorAll('text').forEach((t) => {
      const st = t.getAttribute('style') || '';
      if (/font-family:\s*inherit/.test(st)) t.setAttribute('style', st.replace(/font-family:\s*inherit/, 'font-family: ' + family));
      else if (!/font-family/.test(st) && !t.getAttribute('font-family')) t.setAttribute('font-family', family);
      const db = t.getAttribute('dominant-baseline');
      if (!db) return;
      const size = parseFloat((/font-size:\s*([\d.]+)px/.exec(st) || [])[1] || t.getAttribute('font-size') || '12');
      t.removeAttribute('dominant-baseline');
      t.setAttribute('y', String(r2((parseFloat(t.getAttribute('y') || '0') || 0) + baselineShift(db) * size)));
    });
    // nested ids must stay unique across charts
    const n = ++clipN;
    const xml = new XMLSerializer().serializeToString(c);
    return xml.replace(/\bid="([^"]+)"/g, `id="$1-v${n}"`).replace(/url\(#([^)]+)\)/g, `url(#$1-v${n})`).replace(/href="#([^"]+)"/g, `href="#$1-v${n}"`);
  }

  walk(root);

  // The watermark is a CSS ::after layer in the page, so it is drawn here explicitly. It is not optional.
  const ink = paint(getComputedStyle(root).color) || { color: '#14181e', opacity: 1 };
  const marks: string[] = [];
  for (let ty = 0; ty < H; ty += 200) for (let tx = 0; tx < W; tx += 340) {
    marks.push(`<text x="${tx + 170}" y="${ty + 108}" transform="rotate(-22 ${tx + 170} ${ty + 100})" text-anchor="middle">SYNTHETIC DATA</text>`);
  }
  const title = escXml((opts.title || 'Dashboard replica') + ' (synthetic data)');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" data-synthetic="true">
<title>${title}</title>
<desc>Generated with VaultSnip. Every value is synthetic; this file contains no source data.</desc>
<defs><clipPath id="vs-page"><rect width="${W}" height="${H}" rx="10"/></clipPath>${defs.join('')}</defs>
<g id="replica" clip-path="url(#vs-page)">
${out.join('\n')}
</g>
<g id="watermark" fill="${ink.color}" fill-opacity="0.07" font-family="Arial, sans-serif" font-size="24" font-weight="700" letter-spacing="3" clip-path="url(#vs-page)">${marks.join('')}</g>
</svg>
`;
}


/* ---------- React package (dynamic) ---------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry { name: string; text: string }

/** A plain (stored, uncompressed) zip archive with UTF-8 names. Small text files only; no dependency needed. */
export function zip(entries: ZipEntry[], when = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const time = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1);
  const date = ((Math.max(1980, when.getFullYear()) - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  const put = (size: number, fields: [number, number, 2 | 4][]) => {
    const v = new DataView(new ArrayBuffer(size));
    fields.forEach(([o, x, n]) => (n === 4 ? v.setUint32(o, x >>> 0, true) : v.setUint16(o, x, true)));
    return new Uint8Array(v.buffer);
  };
  const locals: Uint8Array[] = [], centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name), data = enc.encode(e.text), crc = crc32(data);
    locals.push(put(30, [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, time, 2], [12, date, 2], [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, name.length, 2], [28, 0, 2]]), name, data);
    centrals.push(put(46, [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, time, 2], [14, date, 2], [16, crc, 4], [20, data.length, 4], [24, data.length, 4], [28, name.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, offset, 4]]), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = centrals.reduce((a, b) => a + b.length, 0);
  const end = put(22, [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, entries.length, 2], [10, entries.length, 2], [12, cdSize, 4], [16, offset, 4], [20, 0, 2]]);
  const parts = [...locals, ...centrals, end];
  const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
  let p = 0;
  for (const b of parts) { out.set(b, p); p += b.length; }
  return out;
}

const LEVELS = ['shape', 'structure', 'generic'] as const;
export type Level = (typeof LEVELS)[number];

export interface ReactPackageOptions {
  /** Spec already reduced to the privacy level (VSShare.forLevel), so the package never holds more than that level shows. */
  spec: unknown;
  mode: Level;
  seed: number;
  title?: string;
  /** Source of web/replica.js, the engine the component runs. */
  replica: string;
  /** Map outlines the spec uses, as JSON text keyed by map name (as the HTML export embeds them). */
  maps: Record<string, string>;
}

export interface ReactPackage { name: string; files: ZipEntry[]; zip: Uint8Array }

/** A React component package that renders the replica live: every value is generated at runtime from spec + seed. */
export function reactPackage(o: ReactPackageOptions): ReactPackage {
  const name = componentName(o.title || '');
  const mode: Level = (LEVELS as readonly string[]).includes(o.mode) ? o.mode : 'generic';
  const seed = Number.isFinite(o.seed) ? Math.trunc(o.seed) : 4127;
  const maps: Record<string, unknown> = {};
  Object.keys(o.maps || {}).forEach((k) => { maps[k] = JSON.parse(o.maps[k]); });
  const title = (o.title || 'Dashboard').replace(/[\r\n*/`]/g, ' ');
  const allowed = LEVELS.filter((l) => LEVELS.indexOf(l) >= LEVELS.indexOf(mode));

  const component = `'use client';
/*
 * ${title}: a live synthetic replica, generated by VaultSnip (https://vaultsnip.pages.dev).
 * The component runs the VaultSnip replica engine (./vaultsnip-replica.js): every number, chart size, label and tooltip is
 * generated at runtime from ./spec.json and the seed. Cross-filtering and "Download data (CSV)" work as in the app.
 * No source data, screenshot or OCR text is included. Keep the "SYNTHETIC DATA" ribbon and watermark when you reuse it.
 *
 * Props:  seed  any whole number; a new seed generates new values (default ${seed})
 *         mode  ${allowed.map((l) => JSON.stringify(l)).join(' | ')}; exported as ${JSON.stringify(mode)}, so it cannot show more than that
 */
import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import './vaultsnip-replica.js';
import spec from './spec.json';
import maps from './maps.json';

const LEVELS = ['shape', 'structure', 'generic'];
const EXPORTED = ${JSON.stringify(mode)};

let ready = false;
function setup() {
  if (ready) return;
  ready = true;
  if (!window.echarts) window.echarts = echarts;
  Object.keys(maps).forEach((name) => window.DSCReplica.addMap(name, maps[name]));
}

export default function ${name}({ seed = ${seed}, mode = EXPORTED }) {
  const ref = useRef(null);
  // a mode less private than the exported one falls back to the exported one
  const level = LEVELS[Math.max(LEVELS.indexOf(mode), LEVELS.indexOf(EXPORTED))];
  useEffect(() => {
    setup();
    const el = ref.current;
    window.DSCReplica.render(el, spec, { mode: level, seed, resetSelection: true });
    return () => {
      (el._charts || []).forEach((c) => c.dispose());
      if (el._ro) { el._ro.disconnect(); el._ro = null; }
      el._charts = [];
      el.innerHTML = '';
    };
  }, [seed, level]);
  return <div ref={ref} />;
}
`;
  const fence = '```';
  const readme = `# ${name}

A live, synthetic replica of "${title}", exported from [VaultSnip](https://vaultsnip.pages.dev).

## Use it

${fence}bash
npm install react echarts
${fence}

Copy this folder into your project, then:

${fence}jsx
import ${name} from './${name}/${name}';

<${name} />              // the values you saw in VaultSnip
<${name} seed={2024} />  // new generated values
${fence}

Works with Vite, Create React App, Next.js (as a client component) and any bundler that imports JSON.

## What is dynamic

Nothing is frozen into the code. The component runs the VaultSnip replica engine (vaultsnip-replica.js), which generates every
value, bubble size, label and tooltip at runtime from spec.json and the seed. Clicking a filter chip, a table row or a chart
segment filters the whole page, and "Download data (CSV)" saves the values on screen.

To change titles, labels, chart types or the layout, edit spec.json (rows of visuals; "span" is the width out of 12).

## Privacy

Exported at the "${mode}" privacy level. spec.json holds only what that level shows, and the component cannot show more.
There is no source data, screenshot or OCR text in this folder, and the component makes no network calls.

## Licence

vaultsnip-replica.js is part of VaultSnip, Apache-2.0 (https://github.com/karthikvalluri85/vaultsnip). The map outlines in
maps.json come from Natural Earth (public domain).
`;
  const engine = `/* VaultSnip replica engine. Apache-2.0, https://github.com/karthikvalluri85/vaultsnip
   Exported with ${name}.jsx; defines window.DSCReplica and uses window.echarts. */
${o.replica}`;
  const files: ZipEntry[] = [
    { name: `${name}/${name}.jsx`, text: component },
    { name: `${name}/vaultsnip-replica.js`, text: engine },
    { name: `${name}/spec.json`, text: JSON.stringify(o.spec, null, 2) + '\n' },
    { name: `${name}/maps.json`, text: JSON.stringify(maps) + '\n' },
    { name: `${name}/README.md`, text: readme },
  ];
  return { name, files, zip: zip(files) };
}
