/**
 * Confidence score for the on-device layout builder (Phase 3): how likely the replica matches the original.
 *
 * There is no answer key at runtime, so the score is estimated from signals the builder can measure. It is a small
 * set of interpretable rules rather than a fitted model: on a benchmark of ~100 panels, fitted models were no better
 * than chance across dashboards they had not seen, while these rules track the true accuracy (tools/layout-bench
 * reports both). The page score estimates right / (true visuals + extra panels): junk panels and missed visuals both
 * make a replica less faithful.
 *
 * Self-contained (no imports), so tools/layout-bench can load it directly.
 */

export interface PanelSignals {
  type: string;
  /** 0-1: how clearly the evidence pointed to this type (Reading.certainty). */
  certainty: number;
  /** Share of the page the panel covers, 0-1. */
  area: number;
  /** Whether a readable title was found for it. */
  titled: boolean;
  features?: Record<string, number>;
}

/**
 * How often each type was right when the builder chose it (rounded, a little conservative): set on the generated
 * dashboards (tools/synth-bench/layout.mjs --dump) and checked on the real ones, which the rules never saw.
 */
const PRIOR: Record<string, number> = {
  bar: 0.85, column: 0.85, pie: 0.85, donut: 0.85, treemap: 0.75, map: 0.85, scatter: 0.55, bubble: 0.55, line: 0.7,
  area: 0.45, table: 0.55, pivot: 0.7, kpi: 0.75, text: 0.25, placeholder: 0.05, combo: 0.7, waterfall: 0.7,
};
/** A panel over this share of the page has almost always swallowed several visuals (tables and reports aside). */
const HUGE = 0.55;
const CHARTS = ['bar', 'column', 'line', 'area', 'pie', 'donut', 'scatter', 'bubble', 'treemap', 'combo', 'waterfall'];

/** Probability, 0-1, that a panel is a real visual and its type is right. */
export function panelConfidence(p: PanelSignals): number {
  const f = p.features || {};
  let c = PRIOR[p.type] ?? 0.3;
  // a fragment: a tiny panel (a piece of a tile or a chart cut apart), especially one without a title of its own
  if (p.area < 0.004) c *= p.titled ? 0.6 : 0.25;
  // one panel over most of a dashboard has usually swallowed several visuals (tables and reports are allowed); a large
  // one is often a real map or a wide chart, but less sure
  if (p.type !== 'table' && p.type !== 'pivot') c *= p.area > HUGE ? 0.25 : p.area > 0.3 ? 0.75 : 1;
  // KPI tiles are small: a "KPI" covering a large part of the page is a chart or table misread
  if (p.type === 'kpi' && p.area > 0.15) c *= 0.3;
  // a readable title is good evidence of a real visual
  c *= p.titled ? 1.15 : 0.8;
  // a chart with no coloured marks is a misreading
  if (CHARTS.includes(p.type) && !((f.marks || 0) > 0)) c *= 0.3;
  // how strongly the evidence pointed to this type
  c *= 0.6 + 0.4 * Math.max(0, Math.min(1, p.certainty || 0));
  return Math.max(0.02, Math.min(0.98, c));
}

/**
 * Page score, 0-1: expected right panels over the panels shown plus the visuals the page probably missed (content
 * outside every panel, from `coverage`, the share of the page's words inside a panel, plus `swallowed`: visuals a very
 * large panel probably merged, from swallowedVisuals).
 */
export function pageConfidence(panelScores: number[], coverage: number, swallowed = 0): number {
  if (!panelScores.length) return 0;
  const missed = panelScores.length * Math.max(0, 1 - coverage) * 1.5 + swallowed;
  return panelScores.reduce((a, b) => a + b, 0) / Math.max(1, panelScores.length + missed);
}

/** Visuals a very large panel probably hides (a typical dashboard visual covers about an eighth of the page). */
export function swallowedVisuals(areas: number[], types: string[]): number {
  return areas.reduce((n, a, i) => n + (a > HUGE && types[i] !== 'table' && types[i] !== 'pivot' ? Math.max(0, Math.round(a / 0.125) - 1) : 0), 0);
}

/** The line below which the app offers to fix the layout or use the user's own AI key. */
export const CONFIDENCE_THRESHOLD = 0.9;
