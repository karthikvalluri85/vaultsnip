var VSReact=(function(u){"use strict";function R(t){return(String(t||"").normalize("NFKD").replace(/[^\w\s]/g," ").trim().split(/\s+/).filter(Boolean).slice(0,5).map(n=>n[0].toUpperCase()+n.slice(1).toLowerCase()).join("").replace(/^[^A-Za-z]+/,"")||"Dashboard")+"Replica"}const $=(()=>{const t=new Uint32Array(256);for(let e=0;e<256;e++){let r=e;for(let n=0;n<8;n++)r=r&1?3988292384^r>>>1:r>>>1;t[e]=r>>>0}return t})();function V(t){let e=4294967295;for(let r=0;r<t.length;r++)e=$[(e^t[r])&255]^e>>>8;return(e^4294967295)>>>0}function j(t,e=new Date){const r=new TextEncoder,n=e.getHours()<<11|e.getMinutes()<<5|e.getSeconds()>>1,a=Math.max(1980,e.getFullYear())-1980<<9|e.getMonth()+1<<5|e.getDate(),c=(l,o)=>{const d=new DataView(new ArrayBuffer(l));return o.forEach(([h,M,P])=>P===4?d.setUint32(h,M>>>0,!0):d.setUint16(h,M,!0)),new Uint8Array(d.buffer)},i=[],m=[];let p=0;for(const l of t){const o=r.encode(l.name),d=r.encode(l.text),h=V(d);i.push(c(30,[[0,67324752,4],[4,20,2],[6,2048,2],[8,0,2],[10,n,2],[12,a,2],[14,h,4],[18,d.length,4],[22,d.length,4],[26,o.length,2],[28,0,2]]),o,d),m.push(c(46,[[0,33639248,4],[4,20,2],[6,20,2],[8,2048,2],[10,0,2],[12,n,2],[14,a,2],[16,h,4],[20,d.length,4],[24,d.length,4],[28,o.length,2],[30,0,2],[32,0,2],[34,0,2],[36,0,2],[38,0,4],[42,p,4]]),o),p+=30+o.length+d.length}const s=m.reduce((l,o)=>l+o.length,0),b=c(22,[[0,101010256,4],[4,0,2],[6,0,2],[8,t.length,2],[10,t.length,2],[12,s,4],[16,p,4],[20,0,2]]),S=[...i,...m,b],N=new Uint8Array(S.reduce((l,o)=>l+o.length,0));let T=0;for(const l of S)N.set(l,T),T+=l.length;return N}const f={kpi:"KpiCard",chart:"ChartCard",table:"TableCard",pivot:"PivotCard",feed:"FeedCard",text:"TextCard",placeholder:"PlaceholderCard"},E=t=>!!t&&t in f,g=t=>String(t??"").replace(/\s+/g," ").trim();function y(t){const e=n=>{const a=parseFloat(n);return Number.isFinite(a)?Math.round(a):0},r=[];return t.querySelectorAll(".rp-grid > .rp-card").forEach((n,a)=>{const c=n.getAttribute("data-component");if(!E(c))return;const i=getComputedStyle(n),m=e(i.getPropertyValue("--span")||n.style.getPropertyValue("--span"))||e((/span\s+(\d+)/.exec(i.gridColumnEnd||i.gridColumn||"")||[])[1]||"")||6,p=n.querySelector(".rp-chart, .rp-ph"),s=p?e(p.style.getPropertyValue("--h"))||e(getComputedStyle(p).height):e(i.height),b=g((n.querySelector("h3")||n.querySelector(".k"))?.textContent);r.push({vid:n.getAttribute("data-vid")||"v"+(a+1),component:c,span:Math.max(1,Math.min(12,m)),height:s,title:b})}),{title:g(t.querySelector(".rp-head h2")?.textContent),filters:!!t.querySelector(".rp-filters"),cards:r}}const v=t=>g(t).replace(/\*\//g,"* /").replace(/[{}]/g,"").slice(0,80)||"untitled";function k(t,e){const r=[...new Set(t.cards.map(a=>f[a.component]))],n=t.cards.map(a=>{const c=`r.visual(${JSON.stringify(a.vid)}, ${JSON.stringify(a.component)})`,i=a.component==="chart"?` height={${a.height||260}} onToggle={r.toggle}`:a.component==="table"||a.component==="pivot"?" onToggle={r.toggle}":a.component==="placeholder"?` height={${a.height||200}}`:"";return`        {/* ${v(a.title||f[a.component])} */}
        <${f[a.component]} v={${c}} span={${a.span}}${i} />`}).join(`
`);return`'use client';
/*
 * ${v(t.title)}: a live synthetic replica, exported from VaultSnip (https://vaultsnip.pages.dev).
 * Edit the JSX freely: reorder, remove or restyle cards, change spans (out of 12). Values, labels, table rows and charts
 * are generated at runtime by the VaultSnip engine from spec.json and the props, and follow the filters the user clicks.
 * No source data, screenshot or OCR text is included. Keep the "SYNTHETIC DATA" ribbon and watermark when you reuse it.
 */
import { useReplica } from './useReplica';
import type { Mode } from './types';
import { Replica, Header, Ribbon, ParameterBar, FilterBar, Grid, Footer, ${r.join(", ")} } from './components';

export interface ${e.name}Props {
  /** Any whole number; a new seed generates new values. */
  seed?: number;
  /** Exported as ${JSON.stringify(e.mode)}; a less private mode falls back to it. */
  mode?: Mode;
  /** Made-up names, companies and IDs that fit each column (false: neutral placeholders). */
  realistic?: boolean;
}

export default function ${e.name}({ seed = ${e.seed}, mode = ${JSON.stringify(e.mode)}, realistic = ${e.realistic} }: ${e.name}Props) {
  const r = useReplica({ seed, mode, realistic });
  return (
    <Replica>
      <Header model={r.model} />
      <Ribbon model={r.model} />
      <ParameterBar model={r.model} />
${t.filters?`      <FilterBar model={r.model} onToggle={r.toggle} onClear={r.clear} />
`:""}      <Grid>
${n}
      </Grid>
      <Footer model={r.model} onDownload={r.downloadCsv} />
    </Replica>
  );
}
`}const w=`/* Types for the VaultSnip replica model (what DSCReplica.model returns) and the engine on window. */
export type Mode = 'shape' | 'structure' | 'generic';
/** A filter click: [dimension key, raw member]. */
export type Pair = [string, string];
export type Filters = Record<string, string[]>;

interface VisualBase { id: string; type: string; span: number; height: number; title: string }
export interface KpiModel extends VisualBase {
  kind: 'kpi'; label: string; value: string;
  delta: { up: boolean; good: boolean; text: string } | null;
  spark: { points: string; color: string } | null;
}
export interface ChartModel extends VisualBase {
  kind: 'chart'; option: Record<string, unknown>; note: string;
  /** The filters a click on the chart applies, or null when the chart does not filter. */
  pairs: ((params: unknown) => Pair[]) | null;
}
/** A table cell; a customer comment carries its text in parts, with a hidden passage between two parts. */
export interface Cell { text: string; cls: string; parts?: string[] }
export interface TableModel extends VisualBase { kind: 'table'; columns: string[]; rowLabel: string; grouped?: boolean; rows: { filter: Pair | null; cls?: string; cells: Cell[] }[] }
/** A grid cell of a pivot: spans, a numeric flag, and the dimension member a click on it filters by. */
export interface GridCell { text: string; colspan?: number; rowspan?: number; num?: boolean; filter?: Pair | null; x?: number }
export interface PivotModel extends VisualBase { kind: 'pivot'; head: GridCell[][]; body: { cls: string; cells: GridCell[] }[] }
export interface FeedModel extends VisualBase { kind: 'feed'; items: { meta: string[]; quotes: string[][]; badges: { text: string; tone: string }[] }[] }
export interface TextModel extends VisualBase { kind: 'text'; text: string }
export interface PlaceholderModel extends VisualBase { kind: 'placeholder'; text: string }
export type VisualModel = KpiModel | ChartModel | TableModel | PivotModel | FeedModel | TextModel | PlaceholderModel;
export type VisualOf<K extends VisualModel['kind']> = Extract<VisualModel, { kind: K }>;

export interface ReplicaModel {
  title: string; subtitle: string; mode: Mode; modeName: string; seed: number; footNote: string; filtered: string; active: boolean;
  parameters: { label: string; value: string }[];
  filters: { label: string; key: string; chips: { raw: string; label: string; pressed: boolean }[] }[];
  pills: { key: string; raw: string; label: string }[];
  visuals: VisualModel[];
  csv: string; csvName: string;
}

export interface VaultSnipWindow {
  echarts?: unknown;
  DSCReplica: {
    model(spec: unknown, opts: { mode: Mode; seed: number; realistic: boolean; filters: Filters }): ReplicaModel;
    toggleFilters(filters: Filters, pairs: Pair[]): Filters;
    addMap(name: string, featureCollection: unknown): void;
  };
}
`;function x(t){return`/* Runs the VaultSnip engine: the replica model for the props and the filters the user has clicked. */
import { useCallback, useMemo, useState } from 'react';
import * as echarts from 'echarts';
${t.faker?`import './vaultsnip-faker.js';
`:""}import './vaultsnip-replica.js';
import spec from './spec.json';
import maps from './maps.json';
import type { Filters, Mode, Pair, ReplicaModel, VaultSnipWindow, VisualModel, VisualOf } from './types';

const LEVELS: Mode[] = ['shape', 'structure', 'generic'];
/** The privacy level this replica was exported at; it cannot show more than that. */
export const EXPORTED: Mode = ${JSON.stringify(t.mode)};
const vs = () => window as unknown as VaultSnipWindow;

let ready = false;
function setup() {
  if (ready) return;
  ready = true;
  if (!vs().echarts) vs().echarts = echarts;
  Object.entries(maps as Record<string, unknown>).forEach(([name, fc]) => vs().DSCReplica.addMap(name, fc));
}

export interface ReplicaOptions { seed: number; mode: Mode; realistic: boolean }

export function useReplica({ seed, mode, realistic }: ReplicaOptions) {
  setup();
  const level = LEVELS[Math.max(LEVELS.indexOf(mode), LEVELS.indexOf(EXPORTED))];
  const [filters, setFilters] = useState<Filters>({});
  const model = useMemo<ReplicaModel>(() => vs().DSCReplica.model(spec, { mode: level, seed, realistic: ${t.faker?"realistic":"false"}, filters }), [level, seed, realistic, filters]);
  const toggle = useCallback((pairs: Pair[]) => setFilters((f) => vs().DSCReplica.toggleFilters(f, pairs)), []);
  const clear = useCallback(() => setFilters({}), []);
  /** The model of one visual by id, if the spec still has it with that kind. */
  const visual = useCallback(<K extends VisualModel['kind']>(id: string, kind: K): VisualOf<K> | undefined =>
    model.visuals.find((v): v is VisualOf<K> => v.id === id && v.kind === kind), [model]);
  const downloadCsv = useCallback(() => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\\ufeff' + model.csv], { type: 'text/csv;charset=utf-8' }));
    a.download = model.csvName;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, [model]);
  return { model, filters, toggle, clear, visual, downloadCsv };
}
`}const C=`/* The replica's building blocks. They draw what the model says; styles come from the engine (classes rp-*). */
import { Fragment, useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import * as echarts from 'echarts';
import type { ChartModel, FeedModel, GridCell, KpiModel, Pair, PivotModel, PlaceholderModel, ReplicaModel, TableModel, TextModel } from './types';

type Toggle = (pairs: Pair[]) => void;
const vars = (o: Record<string, string | number>) => o as CSSProperties;

/** The page: the engine's styles (classes rp-*) and the "SYNTHETIC DATA" watermark hang off this element. */
export function Replica({ children }: { children: ReactNode }) {
  return <div className="rp" data-synthetic="true">{children}</div>;
}

export function Header({ model }: { model: ReplicaModel }) {
  return <div className="rp-head"><h2>{model.title}</h2><span>{model.subtitle}</span></div>;
}

export function Ribbon({ model }: { model: ReplicaModel }) {
  return (
    <div className="rp-ribbon">
      <b>SYNTHETIC DATA</b><span>{model.modeName} mode · seed {model.seed}</span><span>Values are generated and are not real figures.</span>
      {model.filtered ? <span>{model.filtered}</span> : null}
    </div>
  );
}

export function FilterBar({ model, onToggle, onClear }: { model: ReplicaModel; onToggle: Toggle; onClear: () => void }) {
  if (!model.filters.length && !model.pills.length && !model.active) return null;
  return (
    <div className="rp-filters">
      {model.filters.map((f) => (
        <Fragment key={f.key}>
          <span className="lbl">{f.label}</span>
          {f.chips.map((c) => (
            <button key={c.raw} type="button" className="rp-chip" data-dim={f.key} data-raw={c.raw} aria-pressed={c.pressed} onClick={() => onToggle([[f.key, c.raw]])}>{c.label}</button>
          ))}
        </Fragment>
      ))}
      {model.pills.map((p) => (
        <button key={p.key + '|' + p.raw} type="button" className="rp-chip rp-pill" data-dim={p.key} data-raw={p.raw} aria-pressed="true" title="Remove this filter" onClick={() => onToggle([[p.key, p.raw]])}>{p.label} ✕</button>
      ))}
      {model.active ? <button type="button" className="rp-chip rp-clear" onClick={onClear}>Clear all filters</button> : null}
    </div>
  );
}

export function Grid({ children }: { children: ReactNode }) {
  return <div className="rp-grid">{children}</div>;
}

function Card({ span, kind, vid, title, className, children }: { span: number; kind: string; vid: string; title?: string; className?: string; children: ReactNode }) {
  return (
    <div className={'rp-card' + (className ? ' ' + className : '')} style={vars({ '--span': span })} data-component={kind} data-vid={vid}>
      {title ? <h3>{title}</h3> : null}
      {children}
    </div>
  );
}

export function KpiCard({ v, span }: { v?: KpiModel; span: number }) {
  if (!v) return null;
  return (
    <Card span={span} kind="kpi" vid={v.id} className="rp-kpi">
      <div className="k">{v.label}</div>
      <div className="v">{v.value}</div>
      {v.delta ? <div className={'d ' + (v.delta.good ? 'good' : 'bad')}>{v.delta.text}</div> : null}
      {v.spark ? <svg viewBox="0 0 120 28" preserveAspectRatio="none"><polyline fill="none" stroke={v.spark.color} strokeWidth={1.5} points={v.spark.points} /></svg> : null}
    </Card>
  );
}

export function ChartCard({ v, span, height, onToggle }: { v?: ChartModel; span: number; height: number; onToggle: Toggle }) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<ReturnType<typeof echarts.init> | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const c = echarts.init(ref.current, null, { renderer: 'svg' });
    chart.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(ref.current);
    return () => { ro.disconnect(); c.dispose(); chart.current = null; };
  }, []);
  useEffect(() => {
    const c = chart.current;
    if (!c || !v) return;
    c.setOption(v.option as echarts.EChartsOption, true);
    c.off('click');
    const pairs = v.pairs;
    if (pairs) c.on('click', (p) => { const x = pairs(p); if (x.length) onToggle(x); });
  }, [v, onToggle]);
  if (!v) return null;
  return (
    <Card span={span} kind="chart" vid={v.id} title={v.title}>
      <div ref={ref} className="rp-chart" style={vars({ '--h': height + 'px' })} />
      {v.note ? <div className="rp-note">{v.note}</div> : null}
    </Card>
  );
}

/** A customer comment; a hidden passage shows as a redaction bar. */
function Quote({ parts }: { parts: string[] }) {
  return <>“{parts.map((p, i) => <Fragment key={i}>{i > 0 ? <span className="rp-redact" role="img" aria-label="hidden" /> : null}{p}</Fragment>)}”</>;
}

export function TableCard({ v, span, onToggle }: { v?: TableModel; span: number; onToggle: Toggle }) {
  if (!v) return null;
  return (
    <Card span={span} kind="table" vid={v.id} title={v.title}>
      <div className="rp-table">
        <table>
          <thead><tr>{v.columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
          <tbody>
            {v.rows.map((row, i) => {
              const f = row.filter;
              return (
                <tr key={i} className={[f && !v.grouped ? 'rp-row' : '', row.cls || ''].join(' ').trim() || undefined} data-dim={f && !v.grouped ? f[0] : undefined} data-raw={f && !v.grouped ? f[1] : undefined}
                  title={f ? 'Filter by this ' + v.rowLabel : undefined} onClick={f ? () => onToggle([f]) : undefined}>
                  {row.cells.map((c, j) => <td key={j} className={c.cls}>{c.parts ? <Quote parts={c.parts} /> : c.text}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** A matrix / cross-tab: grouped column headers, row groups, subtotal and total rows. Clicking a row label filters the page. */
export function PivotCard({ v, span, onToggle }: { v?: PivotModel; span: number; onToggle: Toggle }) {
  if (!v) return null;
  const span2 = (c: GridCell) => ({ colSpan: c.colspan && c.colspan > 1 ? c.colspan : undefined, rowSpan: c.rowspan && c.rowspan > 1 ? c.rowspan : undefined });
  return (
    <Card span={span} kind="pivot" vid={v.id} title={v.title}>
      <div className="rp-table rp-pivot">
        <table>
          <thead>{v.head.map((r, i) => <tr key={i}>{r.map((c, j) => <th key={j} className={c.num ? 'n' : undefined} {...span2(c)}>{c.text}</th>)}</tr>)}</thead>
          <tbody>
            {v.body.map((r, i) => (
              <tr key={i} className={r.cls || undefined}>
                {r.cells.map((c, j) => {
                  const f = c.filter;
                  return <td key={j} className={c.num ? 'n' : f ? 'rp-hd' : undefined} {...span2(c)} data-dim={f ? f[0] : undefined} data-raw={f ? f[1] : undefined} onClick={f ? () => onToggle([f]) : undefined}>{c.text}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Report parameters (prompts above a paginated report), shown as label and value. */
export function ParameterBar({ model }: { model: ReplicaModel }) {
  if (!model.parameters || !model.parameters.length) return null;
  return (
    <div className="rp-params">
      {model.parameters.map((q, i) => <span key={i} className="rp-param"><span className="lbl">{q.label}</span><span className="rp-pv">{q.value}</span></span>)}
    </div>
  );
}

export function FeedCard({ v, span }: { v?: FeedModel; span: number }) {
  if (!v) return null;
  return (
    <Card span={span} kind="feed" vid={v.id} title={v.title}>
      <div className="rp-feed">
        {v.items.map((it, i) => (
          <div key={i} className="rp-fi">
            <div className="m">
              <span>{it.meta.map((m, j) => <Fragment key={j}>{j > 0 ? ' · ' : null}{j === 0 ? <b>{m}</b> : m}</Fragment>)}</span>
              {it.badges.map((b, j) => <span key={j} className={'rp-badge ' + b.tone}>{b.text}</span>)}
            </div>
            {it.quotes.map((q, j) => <p key={j}><Quote parts={q} /></p>)}
          </div>
        ))}
      </div>
    </Card>
  );
}

export function TextCard({ v, span }: { v?: TextModel; span: number }) {
  if (!v) return null;
  return <Card span={span} kind="text" vid={v.id} title={v.title}><p className="rp-text">{v.text}</p></Card>;
}

export function PlaceholderCard({ v, span, height }: { v?: PlaceholderModel; span: number; height: number }) {
  if (!v) return null;
  return <Card span={span} kind="placeholder" vid={v.id} title={v.title}><div className="rp-ph" style={vars({ '--h': height + 'px' })}>{v.text}</div></Card>;
}

export function Footer({ model, onDownload }: { model: ReplicaModel; onDownload: () => void }) {
  return (
    <div className="rp-foot">
      <span>{model.footNote} · <button type="button" className="rp-csv" onClick={onDownload}>Download data (CSV)</button></span>
      <a href="https://vaultsnip.pages.dev?ref=export" target="_blank" rel="noopener">Generated with VaultSnip (Zero-Data BI Replica)</a>
    </div>
  );
}
`;function F(t){const e=R(t.title||""),r=y(t.root),n=!!t.faker&&t.realistic!==!1,a={};Object.keys(t.maps||{}).forEach(s=>{a[s]=JSON.parse(t.maps[s])});const c=s=>`
if (typeof window !== 'undefined' && typeof ${s} !== 'undefined') window.${s} = ${s};
`,i=[...new Set(r.cards.map(s=>f[s.component]))],m=`# ${e}

A live, synthetic replica of "${v(r.title)}", exported from [VaultSnip](https://vaultsnip.pages.dev) as editable TypeScript React.

## Use it

Needs React 18+, TypeScript, and a bundler that imports JSON (Vite, Next.js, Create React App):

    npm install react react-dom echarts

Copy this folder into your project (in tsconfig, "resolveJsonModule": true), then:

    import ${e} from './${e}/${e}';

    <${e} />              // the values you saw in VaultSnip
    <${e} seed={2024} />  // new generated values

## Edit it

- ${e}.tsx is the page: ${r.cards.length} cards in order (${i.join(", ")}), each with its span out of 12.
  Reorder, remove or wrap them, or change a span, as ordinary JSX.
- components.tsx holds the building blocks; restyle or replace any of them.
- useReplica.ts runs the engine; types.ts describes everything it returns.

## What is dynamic

Nothing is frozen into the code. Every value, label, table row and chart option comes at runtime from the VaultSnip engine
(vaultsnip-replica.js) for spec.json, the seed and the filters the user clicks. Filter chips, table rows and chart segments
filter the whole page, "Download data (CSV)" saves the values on screen.${n?" Names, companies and IDs are made up at runtime to fit each column (realistic={false} for neutral placeholders); emails use only example.com/.net/.org.":""}

## Privacy

Exported at the "${t.mode}" privacy level. spec.json holds only what that level shows, and the component cannot show more.
There is no source data, screenshot or OCR text in this folder, and nothing in it makes network calls.

## Licence

vaultsnip-replica.js is part of VaultSnip, Apache-2.0 (https://github.com/karthikvalluri85/vaultsnip). The map outlines in maps.json
come from Natural Earth (public domain).${t.faker?" vaultsnip-faker.js bundles Faker (MIT, Copyright (c) 2022-present Faker).":""}
`,p=[{name:`${e}/${e}.tsx`,text:k(r,{name:e,mode:t.mode,seed:Math.trunc(t.seed)||4127,realistic:n})},{name:`${e}/components.tsx`,text:C},{name:`${e}/useReplica.ts`,text:x({mode:t.mode,faker:!!t.faker})},{name:`${e}/types.ts`,text:w},{name:`${e}/vaultsnip-replica.js`,text:`/* VaultSnip replica engine. Apache-2.0, https://github.com/karthikvalluri85/vaultsnip. Defines window.DSCReplica; uses window.echarts. */
`+t.replica},...t.faker?[{name:`${e}/vaultsnip-faker.js`,text:`/* VaultSnip realistic-names injector, Apache-2.0, with Faker (MIT, Copyright (c) 2022-present Faker). Defines window.VSFaker. */
`+t.faker+c("VSFaker")}]:[],{name:`${e}/spec.json`,text:JSON.stringify(t.spec,null,2)+`
`},{name:`${e}/maps.json`,text:JSON.stringify(a)+`
`},{name:`${e}/README.md`,text:m}];return{name:e,files:p,zip:j(p)}}return u.COMPONENTS_TSX=C,u.TYPES_TS=w,u.pageTsx=k,u.readLayout=y,u.tsxPackage=F,u.useReplicaTs=x,Object.defineProperty(u,Symbol.toStringTag,{value:"Module"}),u})({});
