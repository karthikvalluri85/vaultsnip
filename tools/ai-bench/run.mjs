// The AI-key path, measured (developer tool): each generated dashboard is reviewed by VaultSnip in headless Chromium
// as a user would, then the approved masked image is sent with the app's own askModel() (same instructions, parsing and
// retry as the app) to the provider, with the developer's own key. The on-device builder reads the same masked image,
// so both paths are scored side by side, by chart type (the AI's answer has no pixel boxes): each annotated visual is
// matched to a visual of the same type (or a close cousin, as in tools/layout-bench), extra visuals count against it.
//
//   ANTHROPIC_API_KEY=… node tools/ai-bench/run.mjs [--dir .bench/synth] [--count 5] [--model claude-sonnet-5-5]
//                       [--yes] [--json result.json] [--rescore] [--closeups]
// --closeups measures Phase 4(b) instead: the page is built on the device, and only the visuals it is unsure of are
// sent, as close-ups cut from the approved masked image (the app's refineSpec); recorded in <dir>/<id>.closeup.json.
//
// Privacy and cost:
// - Only generated, fictional dashboards (tools/synth-bench/gen.mjs, files synth-*) are ever sent. The public dashboards
//   in tools/layout-bench were collected for local evaluation only and are refused.
// - The key is read from the environment, passed to the page in memory and never written or printed.
// - Runs over 5 images need --yes; the estimate is printed first, and the tokens the provider reports are added up.
// - Each answer is recorded in <dir>/<id>.ai.json, so --rescore scores them again with no key and no cost.
import { readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from '../layout-bench/items.mjs';
import { reviewer } from '../layout-bench/review.mjs';
import { same } from '../layout-bench/builder.mjs';
import { validate } from './validate.mjs';

const arg = (name, d) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : d);
const DIR = arg('--dir', join(ROOT, '.bench', 'synth'));
const COUNT = +arg('--count', 5), MODEL = arg('--model', 'claude-sonnet-5-5');
const rescore = process.argv.includes('--rescore');
const CLOSEUPS = process.argv.includes('--closeups');
// per image, measured on the first runs: about 5,000 tokens in (image and instructions) and up to 6,000 out
const PRICE = { 'claude-sonnet-5-5': [2, 10], 'claude-opus-5-5': [4, 20], 'claude-haiku-5-5': [0.1, 0.5] };
const TYPE = { hbar: 'bar' };   // the generator's panel kinds in the builder's words

const files = (await readdir(DIR)).filter((f) => f.endsWith('.truth.json')).sort();
if (files.some((f) => !f.startsWith('synth-'))) { console.error(`${DIR} holds images that are not generated dashboards: only synth-* files may be sent`); process.exit(1); }
const todo = files.slice(0, COUNT);
if (!rescore) {
  if (!process.env.ANTHROPIC_API_KEY) { console.error('Set ANTHROPIC_API_KEY in the environment (never on the command line).'); process.exit(1); }
  const [pin, pout] = PRICE[MODEL] || [4, 20];
  // (close-ups send about half the image tokens a page does, for the few visuals the build is unsure of)
  const est = todo.length * (CLOSEUPS ? 0.5 : 1) * (5000 * pin + 6000 * pout) / 1e6;
  console.log(`${todo.length} generated dashboard(s) to ${MODEL}: about $${est.toFixed(2)}`);
  if (todo.length > 5 && !process.argv.includes('--yes')) { console.error('More than 5 images: add --yes to confirm the cost.'); process.exit(1); }
}
if (arg('--json')) await rm(arg('--json'), { force: true });

// the visuals of a spec, in reading order, as types
const visuals = (spec) => (spec?.rows || []).flatMap((r) => (r.visuals || []).map((v) => v.type));
// greedy type matching: each annotated visual takes an unused found visual of its type, else a close cousin
function score(found, truth) {
  const left = [...found];
  let right = 0;
  for (const strict of [true, false]) for (const t of truth.filter((t) => !t.done)) {
    const i = left.findIndex((g) => same(g, t.type, !strict));
    if (i >= 0) { left.splice(i, 1); t.done = true; right++; }
  }
  truth.forEach((t) => delete t.done);
  return { right, extra: Math.max(0, found.length - truth.length) };
}

const rev = rescore ? null : await reviewer();
const key = process.env.ANTHROPIC_API_KEY;
const rows = [], tot = { ai: { right: 0, extra: 0 }, local: { right: 0, extra: 0 }, visuals: 0, failed: 0, input: 0, output: 0, malformed: 0 };
const problems = {};
try {
  for (const f of todo) {
    const truth = JSON.parse(await readFile(join(DIR, f), 'utf8'));
    const want = truth.panels.map((p) => ({ type: TYPE[p.type] || p.type }));
    const recFile = join(DIR, truth.id + (CLOSEUPS ? '.closeup.json' : '.ai.json'));
    let rec;
    if (rescore) rec = await readFile(recFile, 'utf8').then(JSON.parse, () => null);
    else {
      const out = await rev.read(join(DIR, truth.file), (page) => page.evaluate(async ({ key, model, closeups }) => {
        const S = window.__DSC;
        // the payload the user approves (btn-send), and the same call as Send (btn-confirm), without the dialog
        const payload = S.test.maskedCanvas(1).toDataURL('image/png');
        const built = VSLayout.buildSpec(S.test.layoutInput()), local = built.spec;
        S.key = key; S.provider = 'anthropic'; S.model = model;
        const t0 = Date.now();
        try {
          if (closeups) {
            const byVid = {}, boxes = {};
            (built.panels || []).filter((p) => p.vid).forEach((p) => { byVid[p.vid] = p.confidence; boxes[p.vid] = p.box; });
            const res = await S.test.refineSpec(local, byVid, boxes, S.test.maskedCanvas(1));
            return { spec: S.test.scrubVerbatims(res.spec), local, asked: res.asked.length, fixed: res.fixed.length, ms: Date.now() - t0, usage: { ...VSLLM.usage } };
          }
          const spec = S.test.scrubVerbatims(await S.test.askModel(payload));
          return { spec, local, ms: Date.now() - t0, usage: { ...VSLLM.usage } };
        } catch (e) {
          return { error: String(e && e.message || e), local, ms: Date.now() - t0, usage: { ...VSLLM.usage } };
        } finally { S.key = null; }
      }, { key, model: MODEL, closeups: CLOSEUPS }));
      rec = { id: truth.id, model: MODEL, measured: new Date().toISOString().slice(0, 10), ...out.after };
      await writeFile(recFile, JSON.stringify(rec, null, 1));
    }
    if (!rec) { console.warn(`  ! ${truth.id}: no recorded answer`); continue; }
    const ai = rec.spec ? score(visuals(rec.spec), want) : { right: 0, extra: 0 };
    const local = score(visuals(rec.local), want);
    tot.visuals += want.length; tot.input += rec.usage?.input || 0; tot.output += rec.usage?.output || 0;
    if (!rec.spec) tot.failed++;
    const issues = rec.spec ? validate(rec.spec) : [];
    if (issues.length) tot.malformed++;
    issues.forEach((i) => { problems[i.code] = (problems[i.code] || 0) + 1; });
    for (const [k, s] of [['ai', ai], ['local', local]]) { tot[k].right += s.right; tot[k].extra += s.extra; }
    rows.push({ id: truth.id, visuals: want.length, ai: rec.spec ? `${ai.right} (+${ai.extra})` : 'error', local: `${local.right} (+${local.extra})`, s: Math.round((rec.ms || 0) / 1000) });
    if (issues.length) console.log(`    malformed: ${issues.map((i) => `${i.code} at ${i.where}`).join('; ')}`);
    console.log(`  ✓ ${truth.id}: AI ${rec.spec ? `${ai.right}/${want.length} right, ${ai.extra} extra` : 'failed: ' + rec.error}; on device ${local.right}/${want.length}, ${local.extra} extra`);
  }
} finally {
  if (rev) await rev.close();
}
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const e2e = (k) => pct(tot[k].right, tot.visuals + tot[k].extra);
const [pin, pout] = PRICE[MODEL] || [4, 20];
const result = { aiPath: { model: MODEL, dashboards: rows.length, visuals: tot.visuals, failed: tot.failed, malformed: tot.malformed, problems,
  ai: { typesRight: tot.ai.right, extra: tot.ai.extra, endToEndPct: e2e('ai') },
  onDevice: { typesRight: tot.local.right, extra: tot.local.extra, endToEndPct: e2e('local') },
  tokens: { input: tot.input, output: tot.output }, costUsd: Math.round((tot.input * pin + tot.output * pout) / 1e4) / 100 } };
console.table(rows);
console.log(`AI (${MODEL}): ${tot.ai.right}/${tot.visuals} visuals typed right, ${tot.ai.extra} extra, end to end ${e2e('ai')}%, ${tot.failed} failed`);
console.log(`Answers with structural problems: ${tot.malformed} of ${rows.length - tot.failed}${Object.keys(problems).length ? ': ' + Object.entries(problems).map(([k, v]) => `${k} ${v}`).join(', ') : ''}`);
console.log(`On device:  ${tot.local.right}/${tot.visuals} visuals typed right, ${tot.local.extra} extra, end to end ${e2e('local')}%`);
console.log(`Tokens: ${tot.input} in, ${tot.output} out, about $${result.aiPath.costUsd}`);
if (arg('--json')) await writeFile(arg('--json'), JSON.stringify({ measured: new Date().toISOString().slice(0, 10), ...result }, null, 1) + '\n');
