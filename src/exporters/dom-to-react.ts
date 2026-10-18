/**
 * DOM to React (Feature 8), built as web/lib/vs-react.js (window.VSReact).
 * Turns a rendered replica into a TypeScript React project folder that a developer can edit:
 *   - the page structure is read from the replica DOM: every card's data-component (kpi, chart, table, feed, text,
 *     placeholder), data-vid, grid span and chart height, in page order;
 *   - each card becomes a typed component in the page JSX (<KpiCard>, <ChartCard>, <TableCard> ...), in that order and
 *     with those spans, so reordering, removing or restyling a card is an ordinary JSX edit;
 *   - nothing is frozen: values, labels, table rows and chart options come at runtime from the VaultSnip engine
 *     (DSCReplica.model) for the spec, seed, privacy mode and the filters the user clicks; the components draw them.
 * Runs on the device and makes no network calls. Mitosis and html-to-react-components were studied for ideas only;
 * no code is taken from them.
 */
import { componentName, zip, type ZipEntry } from '../export/design-export';

export type Component = 'kpi' | 'chart' | 'table' | 'pivot' | 'feed' | 'text' | 'placeholder';

export interface CardLayout { vid: string; component: Component; span: number; height: number; title: string }
export interface PageLayout { title: string; filters: boolean; cards: CardLayout[] }

const COMPONENTS: Record<Component, string> = { kpi: 'KpiCard', chart: 'ChartCard', table: 'TableCard', pivot: 'PivotCard', feed: 'FeedCard', text: 'TextCard', placeholder: 'PlaceholderCard' };
const isComponent = (s: string | null): s is Component => !!s && s in COMPONENTS;
const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();

/* ---------- reading the page ---------- */

/** The page structure from a rendered replica: cards in order with what they are, their span and height. */
export function readLayout(root: HTMLElement): PageLayout {
  const px = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) ? Math.round(n) : 0; };
  const cards: CardLayout[] = [];
  root.querySelectorAll<HTMLElement>('.rp-grid > .rp-card').forEach((card, i) => {
    const component = card.getAttribute('data-component');
    if (!isComponent(component)) return;
    const cs = getComputedStyle(card);
    const span = px(cs.getPropertyValue('--span') || card.style.getPropertyValue('--span')) || px((/span\s+(\d+)/.exec(cs.gridColumnEnd || cs.gridColumn || '') || [])[1] || '') || 6;
    const sized = card.querySelector<HTMLElement>('.rp-chart, .rp-ph');
    const height = sized ? px(sized.style.getPropertyValue('--h')) || px(getComputedStyle(sized).height) : px(cs.height);
    const title = clean((card.querySelector('h3') || card.querySelector('.k'))?.textContent);
    cards.push({ vid: card.getAttribute('data-vid') || 'v' + (i + 1), component, span: Math.max(1, Math.min(12, span)), height, title });
  });
  return { title: clean(root.querySelector('.rp-head h2')?.textContent), filters: !!root.querySelector('.rp-filters'), cards };
}

/* ---------- writing the code ---------- */

// Text from the page goes into JSX comments: it must not be able to end the comment or the expression.
const comment = (s: string) => clean(s).replace(/\*\//g, '* /').replace(/[{}]/g, '').slice(0, 80) || 'untitled';

/** The page component: the cards in page order, each a typed component with its span. */
export function pageTsx(layout: PageLayout, o: { name: string; mode: string; seed: number; realistic: boolean }): string {
  const used = [...new Set(layout.cards.map((c) => COMPONENTS[c.component]))];
  const cards = layout.cards.map((c) => {
    const v = `r.visual(${JSON.stringify(c.vid)}, ${JSON.stringify(c.component)})`;
    const props = c.component === 'chart' ? ` height={${c.height || 260}} onToggle={r.toggle}`
      : c.component === 'table' || c.component === 'pivot' ? ' onToggle={r.toggle}'
      : c.component === 'placeholder' ? ` height={${c.height || 200}}` : '';
    return `        {/* ${comment(c.title || COMPONENTS[c.component])} */}\n        <${COMPONENTS[c.component]} v={${v}} span={${c.span}}${props} />`;
  }).join('\n');
  return `'use client';
/*
 * ${comment(layout.title)}: a live synthetic replica, exported from VaultSnip (https://vaultsnip.pages.dev).
 * Edit the JSX freely: reorder, remove or restyle cards, change spans (out of 12). Values, labels, table rows and charts
 * are generated at runtime by the VaultSnip engine from spec.json and the props, and follow the filters the user clicks.
 * No source data, screenshot or OCR text is included. Keep the "SYNTHETIC DATA" ribbon and watermark when you reuse it.
 */
import { useReplica } from './useReplica';
import type { Mode } from './types';
import { Replica, Header, Ribbon, ParameterBar, FilterBar, Grid, Footer, ${used.join(', ')} } from './components';

export interface ${o.name}Props {
  /** Any whole number; a new seed generates new values. */
  seed?: number;
  /** Exported as ${JSON.stringify(o.mode)}; a less private mode falls back to it. */
  mode?: Mode;
  /** Made-up names, companies and IDs that fit each column (false: neutral placeholders). */
  realistic?: boolean;
}

export default function ${o.name}({ seed = ${o.seed}, mode = ${JSON.stringify(o.mode)}, realistic = ${o.realistic} }: ${o.name}Props) {
  const r = useReplica({ seed, mode, realistic });
  return (
    <Replica>
      <Header model={r.model} />
      <Ribbon model={r.model} />
      <ParameterBar model={r.model} />
${layout.filters ? '      <FilterBar model={r.model} onToggle={r.toggle} onClear={r.clear} />\n' : ''}      <Grid>
${cards}
      </Grid>
      <Footer model={r.model} onDownload={r.downloadCsv} />
    </Replica>
  );
}
`;
}

export const TYPES_TS = `/* Types for the VaultSnip replica model (what DSCReplica.model returns) and the engine on window. */
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
`;

export function useReplicaTs(o: { mode: string; faker: boolean }): string {
  return `/* Runs the VaultSnip engine: the replica model for the props and the filters the user has clicked. */
import { useCallback, useMemo, useState } from 'react';
import * as echarts from 'echarts';
${o.faker ? "import './vaultsnip-faker.js';\n" : ''}import './vaultsnip-replica.js';
import spec from './spec.json';
import maps from './maps.json';
import type { Filters, Mode, Pair, ReplicaModel, VaultSnipWindow, VisualModel, VisualOf } from './types';

const LEVELS: Mode[] = ['shape', 'structure', 'generic'];
/** The privacy level this replica was exported at; it cannot show more than that. */
export const EXPORTED: Mode = ${JSON.stringify(o.mode)};
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
  const model = useMemo<ReplicaModel>(() => vs().DSCReplica.model(spec, { mode: level, seed, realistic: ${o.faker ? 'realistic' : 'false'}, filters }), [level, seed, realistic, filters]);
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
`;
}

export const COMPONENTS_TSX = `/* The replica's building blocks. They draw what the model says; styles come from the engine (classes rp-*). */
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
`;

/* ---------- the package ---------- */

export interface TsxPackageOptions {
  /** The replica, rendered from `spec`, whose structure the page follows. */
  root: HTMLElement;
  /** Spec already reduced to the privacy level (VSShare.forLevel). */
  spec: unknown;
  mode: 'shape' | 'structure' | 'generic';
  seed: number;
  realistic?: boolean;
  title?: string;
  replica: string;
  faker?: string;
  maps: Record<string, string>;
}

/** A TypeScript React project folder as a zip: page, components, hook, types, engine, spec, maps, README. */
export function tsxPackage(o: TsxPackageOptions): { name: string; files: ZipEntry[]; zip: Uint8Array } {
  const name = componentName(o.title || '');
  const layout = readLayout(o.root);
  const realistic = !!o.faker && o.realistic !== false;
  const maps: Record<string, unknown> = {};
  Object.keys(o.maps || {}).forEach((k) => { maps[k] = JSON.parse(o.maps[k]); });
  // the build declares `var VSFaker`, which a bundler keeps module-local, so it is published on window
  const publish = (global: string) => `\nif (typeof window !== 'undefined' && typeof ${global} !== 'undefined') window.${global} = ${global};\n`;
  const used = [...new Set(layout.cards.map((c) => COMPONENTS[c.component]))];
  const readme = `# ${name}

A live, synthetic replica of "${comment(layout.title)}", exported from [VaultSnip](https://vaultsnip.pages.dev) as editable TypeScript React.

## Use it

Needs React 18+, TypeScript, and a bundler that imports JSON (Vite, Next.js, Create React App):

    npm install react react-dom echarts

Copy this folder into your project (in tsconfig, "resolveJsonModule": true), then:

    import ${name} from './${name}/${name}';

    <${name} />              // the values you saw in VaultSnip
    <${name} seed={2024} />  // new generated values

## Edit it

- ${name}.tsx is the page: ${layout.cards.length} cards in order (${used.join(', ')}), each with its span out of 12.
  Reorder, remove or wrap them, or change a span, as ordinary JSX.
- components.tsx holds the building blocks; restyle or replace any of them.
- useReplica.ts runs the engine; types.ts describes everything it returns.

## What is dynamic

Nothing is frozen into the code. Every value, label, table row and chart option comes at runtime from the VaultSnip engine
(vaultsnip-replica.js) for spec.json, the seed and the filters the user clicks. Filter chips, table rows and chart segments
filter the whole page, "Download data (CSV)" saves the values on screen.${realistic ? ' Names, companies and IDs are made up at runtime to fit each column (realistic={false} for neutral placeholders); emails use only example.com/.net/.org.' : ''}

## Privacy

Exported at the "${o.mode}" privacy level. spec.json holds only what that level shows, and the component cannot show more.
There is no source data, screenshot or OCR text in this folder, and nothing in it makes network calls.

## Licence

vaultsnip-replica.js is part of VaultSnip, Apache-2.0 (https://github.com/karthikvalluri85/vaultsnip). The map outlines in maps.json
come from Natural Earth (public domain).${o.faker ? ' vaultsnip-faker.js bundles Faker (MIT, Copyright (c) 2022-present Faker).' : ''}
`;
  const files: ZipEntry[] = [
    { name: `${name}/${name}.tsx`, text: pageTsx(layout, { name, mode: o.mode, seed: Math.trunc(o.seed) || 4127, realistic }) },
    { name: `${name}/components.tsx`, text: COMPONENTS_TSX },
    { name: `${name}/useReplica.ts`, text: useReplicaTs({ mode: o.mode, faker: !!o.faker }) },
    { name: `${name}/types.ts`, text: TYPES_TS },
    { name: `${name}/vaultsnip-replica.js`, text: '/* VaultSnip replica engine. Apache-2.0, https://github.com/karthikvalluri85/vaultsnip. Defines window.DSCReplica; uses window.echarts. */\n' + o.replica },
    ...(o.faker ? [{ name: `${name}/vaultsnip-faker.js`, text: '/* VaultSnip realistic-names injector, Apache-2.0, with Faker (MIT, Copyright (c) 2022-present Faker). Defines window.VSFaker. */\n' + o.faker + publish('VSFaker') }] : []),
    { name: `${name}/spec.json`, text: JSON.stringify(o.spec, null, 2) + '\n' },
    { name: `${name}/maps.json`, text: JSON.stringify(maps) + '\n' },
    { name: `${name}/README.md`, text: readme },
  ];
  return { name, files, zip: zip(files) };
}
