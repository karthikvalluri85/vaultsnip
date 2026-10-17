var VSReact=(function(u){"use strict";function R(e){return(String(e||"").normalize("NFKD").replace(/[^\w\s]/g," ").trim().split(/\s+/).filter(Boolean).slice(0,5).map(r=>r[0].toUpperCase()+r.slice(1).toLowerCase()).join("").replace(/^[^A-Za-z]+/,"")||"Dashboard")+"Replica"}const V=(()=>{const e=new Uint32Array(256);for(let t=0;t<256;t++){let n=t;for(let r=0;r<8;r++)n=n&1?3988292384^n>>>1:n>>>1;e[t]=n>>>0}return e})();function $(e){let t=4294967295;for(let n=0;n<e.length;n++)t=V[(t^e[n])&255]^t>>>8;return(t^4294967295)>>>0}function E(e,t=new Date){const n=new TextEncoder,r=t.getHours()<<11|t.getMinutes()<<5|t.getSeconds()>>1,a=Math.max(1980,t.getFullYear())-1980<<9|t.getMonth()+1<<5|t.getDate(),i=(l,c)=>{const d=new DataView(new ArrayBuffer(l));return c.forEach(([f,N,O])=>O===4?d.setUint32(f,N>>>0,!0):d.setUint16(f,N,!0)),new Uint8Array(d.buffer)},o=[],m=[];let p=0;for(const l of e){const c=n.encode(l.name),d=n.encode(l.text),f=$(d);o.push(i(30,[[0,67324752,4],[4,20,2],[6,2048,2],[8,0,2],[10,r,2],[12,a,2],[14,f,4],[18,d.length,4],[22,d.length,4],[26,c.length,2],[28,0,2]]),c,d),m.push(i(46,[[0,33639248,4],[4,20,2],[6,20,2],[8,2048,2],[10,0,2],[12,r,2],[14,a,2],[16,f,4],[20,d.length,4],[24,d.length,4],[28,c.length,2],[30,0,2],[32,0,2],[34,0,2],[36,0,2],[38,0,4],[42,p,4]]),c),p+=30+c.length+d.length}const s=m.reduce((l,c)=>l+c.length,0),b=i(22,[[0,101010256,4],[4,0,2],[6,0,2],[8,e.length,2],[10,e.length,2],[12,s,4],[16,p,4],[20,0,2]]),C=[...o,...m,b],T=new Uint8Array(C.reduce((l,c)=>l+c.length,0));let M=0;for(const l of C)T.set(l,M),M+=l.length;return T}const h={kpi:"KpiCard",chart:"ChartCard",table:"TableCard",feed:"FeedCard",text:"TextCard",placeholder:"PlaceholderCard"},F=e=>!!e&&e in h,g=e=>String(e??"").replace(/\s+/g," ").trim();function y(e){const t=r=>{const a=parseFloat(r);return Number.isFinite(a)?Math.round(a):0},n=[];return e.querySelectorAll(".rp-grid > .rp-card").forEach((r,a)=>{const i=r.getAttribute("data-component");if(!F(i))return;const o=getComputedStyle(r),m=t(o.getPropertyValue("--span")||r.style.getPropertyValue("--span"))||t((/span\s+(\d+)/.exec(o.gridColumnEnd||o.gridColumn||"")||[])[1]||"")||6,p=r.querySelector(".rp-chart, .rp-ph"),s=p?t(p.style.getPropertyValue("--h"))||t(getComputedStyle(p).height):t(o.height),b=g((r.querySelector("h3")||r.querySelector(".k"))?.textContent);n.push({vid:r.getAttribute("data-vid")||"v"+(a+1),component:i,span:Math.max(1,Math.min(12,m)),height:s,title:b})}),{title:g(e.querySelector(".rp-head h2")?.textContent),filters:!!e.querySelector(".rp-filters"),cards:n}}const v=e=>g(e).replace(/\*\//g,"* /").replace(/[{}]/g,"").slice(0,80)||"untitled";function k(e,t){const n=[...new Set(e.cards.map(a=>h[a.component]))],r=e.cards.map(a=>{const i=`r.visual(${JSON.stringify(a.vid)}, ${JSON.stringify(a.component)})`,o=a.component==="chart"?` height={${a.height||260}} onToggle={r.toggle}`:a.component==="table"?" onToggle={r.toggle}":a.component==="placeholder"?` height={${a.height||200}}`:"";return`        {/* ${v(a.title||h[a.component])} */}
        <${h[a.component]} v={${i}} span={${a.span}}${o} />`}).join(`
`);return`'use client';
/*
 * ${v(e.title)}: a live synthetic replica, exported from VaultSnip (https://vaultsnip.pages.dev).
 * Edit the JSX freely: reorder, remove or restyle cards, change spans (out of 12). Values, labels, table rows and charts
 * are generated at runtime by the VaultSnip engine from spec.json and the props, and follow the filters the user clicks.
 * No source data, screenshot or OCR text is included. Keep the "SYNTHETIC DATA" ribbon and watermark when you reuse it.
 */
import { useReplica } from './useReplica';
import type { Mode } from './types';
import { Replica, Header, Ribbon, FilterBar, Grid, Footer, ${n.join(", ")} } from './components';

export interface ${t.name}Props {
  /** Any whole number; a new seed generates new values. */
  seed?: number;
  /** Exported as ${JSON.stringify(t.mode)}; a less private mode falls back to it. */
  mode?: Mode;
  /** Made-up names, companies and IDs that fit each column (false: neutral placeholders). */
  realistic?: boolean;
}

export default function ${t.name}({ seed = ${t.seed}, mode = ${JSON.stringify(t.mode)}, realistic = ${t.realistic} }: ${t.name}Props) {
  const r = useReplica({ seed, mode, realistic });
  return (
    <Replica model={r.model} onToggle={r.toggle}>
      <Header model={r.model} />
      <Ribbon model={r.model} />
${e.filters?`      <FilterBar model={r.model} onToggle={r.toggle} onClear={r.clear} />
`:""}      <Grid>
${r}
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
export interface TableModel extends VisualBase { kind: 'table'; columns: string[]; rowLabel: string; rows: { filter: Pair | null; cells: Cell[] }[] }
export interface FeedModel extends VisualBase { kind: 'feed'; items: { meta: string[]; quotes: string[][]; badges: { text: string; tone: string }[] }[] }
export interface TextModel extends VisualBase { kind: 'text'; text: string }
export interface PlaceholderModel extends VisualBase { kind: 'placeholder'; text: string }
export type VisualModel = KpiModel | ChartModel | TableModel | FeedModel | TextModel | PlaceholderModel;
export type VisualOf<K extends VisualModel['kind']> = Extract<VisualModel, { kind: K }>;

export interface ReplicaModel {
  title: string; subtitle: string; mode: Mode; modeName: string; seed: number; footNote: string; filtered: string; active: boolean;
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
  VSSearch?: { attach(root: HTMLElement, opts: { echarts: unknown }): unknown };
}
`;function x(e){return`/* Runs the VaultSnip engine: the replica model for the props and the filters the user has clicked. */
import { useCallback, useMemo, useState } from 'react';
import * as echarts from 'echarts';
${e.faker?`import './vaultsnip-faker.js';
`:""}${e.search?`import './vaultsnip-search.js';
`:""}import './vaultsnip-replica.js';
import spec from './spec.json';
import maps from './maps.json';
import type { Filters, Mode, Pair, ReplicaModel, VaultSnipWindow, VisualModel, VisualOf } from './types';

const LEVELS: Mode[] = ['shape', 'structure', 'generic'];
/** The privacy level this replica was exported at; it cannot show more than that. */
export const EXPORTED: Mode = ${JSON.stringify(e.mode)};
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
  const model = useMemo<ReplicaModel>(() => vs().DSCReplica.model(spec, { mode: level, seed, realistic: ${e.faker?"realistic":"false"}, filters }), [level, seed, realistic, filters]);
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
`}const S=`/* The replica's building blocks. They draw what the model says; styles come from the engine (classes rp-*). */
import { Fragment, useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import * as echarts from 'echarts';
import type { ChartModel, FeedModel, KpiModel, Pair, PlaceholderModel, ReplicaModel, TableModel, TextModel, VaultSnipWindow } from './types';

type Toggle = (pairs: Pair[]) => void;
const vars = (o: Record<string, string | number>) => o as CSSProperties;

/** The page. Also hosts "Search this dashboard", which indexes what is on screen and is rebuilt when the page changes. */
export function Replica({ model, onToggle, children }: { model: ReplicaModel; onToggle: Toggle; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current as (HTMLDivElement & { _toggle?: Toggle }) | null;
    const search = (window as unknown as VaultSnipWindow).VSSearch;
    if (!el || !search) return;
    el._toggle = onToggle;
    el.querySelectorAll('.rp-search').forEach((n) => n.remove());
    search.attach(el, { echarts });
  }, [model, onToggle]);
  return <div ref={ref} className="rp" data-synthetic="true">{children}</div>;
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
                <tr key={i} className={f ? 'rp-row' : undefined} data-dim={f ? f[0] : undefined} data-raw={f ? f[1] : undefined}
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
`;function j(e){const t=R(e.title||""),n=y(e.root),r=!!e.faker&&e.realistic!==!1,a={};Object.keys(e.maps||{}).forEach(s=>{a[s]=JSON.parse(e.maps[s])});const i=s=>`
if (typeof window !== 'undefined' && typeof ${s} !== 'undefined') window.${s} = ${s};
`,o=[...new Set(n.cards.map(s=>h[s.component]))],m=`# ${t}

A live, synthetic replica of "${v(n.title)}", exported from [VaultSnip](https://vaultsnip.pages.dev) as editable TypeScript React.

## Use it

Needs React 18+, TypeScript, and a bundler that imports JSON (Vite, Next.js, Create React App):

    npm install react react-dom echarts

Copy this folder into your project (in tsconfig, "resolveJsonModule": true), then:

    import ${t} from './${t}/${t}';

    <${t} />              // the values you saw in VaultSnip
    <${t} seed={2024} />  // new generated values

## Edit it

- ${t}.tsx is the page: ${n.cards.length} cards in order (${o.join(", ")}), each with its span out of 12.
  Reorder, remove or wrap them, or change a span, as ordinary JSX.
- components.tsx holds the building blocks; restyle or replace any of them.
- useReplica.ts runs the engine; types.ts describes everything it returns.

## What is dynamic

Nothing is frozen into the code. Every value, label, table row and chart option comes at runtime from the VaultSnip engine
(vaultsnip-replica.js) for spec.json, the seed and the filters the user clicks. Filter chips, table rows and chart segments
filter the whole page, "Download data (CSV)" saves the values on screen${e.search?', and "Search this dashboard" finds any title, label or value shown':""}.${r?" Names, companies and IDs are made up at runtime to fit each column (realistic={false} for neutral placeholders); emails use only example.com/.net/.org.":""}

## Privacy

Exported at the "${e.mode}" privacy level. spec.json holds only what that level shows, and the component cannot show more.
There is no source data, screenshot or OCR text in this folder, and nothing in it makes network calls.

## Licence

vaultsnip-replica.js is part of VaultSnip, Apache-2.0 (https://github.com/karthikvalluri85/vaultsnip). The map outlines in maps.json
come from Natural Earth (public domain).${e.faker?" vaultsnip-faker.js bundles Faker (MIT, Copyright (c) 2022-present Faker).":""}${e.search?" vaultsnip-search.js bundles MiniSearch (MIT, Copyright 2022 Luca Ongaro).":""}
`,p=[{name:`${t}/${t}.tsx`,text:k(n,{name:t,mode:e.mode,seed:Math.trunc(e.seed)||4127,realistic:r})},{name:`${t}/components.tsx`,text:S},{name:`${t}/useReplica.ts`,text:x({mode:e.mode,faker:!!e.faker,search:!!e.search})},{name:`${t}/types.ts`,text:w},{name:`${t}/vaultsnip-replica.js`,text:`/* VaultSnip replica engine. Apache-2.0, https://github.com/karthikvalluri85/vaultsnip. Defines window.DSCReplica; uses window.echarts. */
`+e.replica},...e.faker?[{name:`${t}/vaultsnip-faker.js`,text:`/* VaultSnip realistic-names injector, Apache-2.0, with Faker (MIT, Copyright (c) 2022-present Faker). Defines window.VSFaker. */
`+e.faker+i("VSFaker")}]:[],...e.search?[{name:`${t}/vaultsnip-search.js`,text:`/* VaultSnip replica search, Apache-2.0, with MiniSearch (MIT, Copyright 2022 Luca Ongaro). Defines window.VSSearch. */
`+e.search+i("VSSearch")}]:[],{name:`${t}/spec.json`,text:JSON.stringify(e.spec,null,2)+`
`},{name:`${t}/maps.json`,text:JSON.stringify(a)+`
`},{name:`${t}/README.md`,text:m}];return{name:t,files:p,zip:E(p)}}return u.COMPONENTS_TSX=S,u.TYPES_TS=w,u.pageTsx=k,u.readLayout=y,u.tsxPackage=j,u.useReplicaTs=x,Object.defineProperty(u,Symbol.toStringTag,{value:"Module"}),u})({});
