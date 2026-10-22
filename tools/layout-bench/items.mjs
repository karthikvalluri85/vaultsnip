// The benchmark's images, read from truth.json: where each one lives in a bench folder, shared by fetch, ocr and run.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..', '..');
export const DEFAULT_BENCH = join(ROOT, '.bench');
const FOLDERS = { 'Power BI': 'powerbi', Tableau: 'tableau', Looker: 'looker', VaultSnip: 'reports' };

export const truth = JSON.parse(await readFile(join(here, 'truth.json'), 'utf8'));
/** Every annotated image: dashboards, then paginated reports, each with its folder and file in a bench dir. */
export const items = (bench) => [
  ...truth.dashboards.map((d) => ({ ...d, kind: 'dashboard', folder: FOLDERS[d.tool] })),
  ...(truth.reports || []).map((r) => ({ ...r, kind: 'report', folder: 'reports' })),
].map((it) => ({ ...it, file: join(bench, it.folder, it.id + '.png'), ocr: join(bench, 'run', it.id + '.ocr.json') }));
