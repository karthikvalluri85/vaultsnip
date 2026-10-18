const ALLOW_WORDS = `
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
`.split(/\s+/).filter(Boolean);
const DEFAULT_ALLOW = new Set(ALLOW_WORDS);
function classify(text, p = {}) {
  const allow = p.allow ?? DEFAULT_ALLOW;
  const raw = text.trim();
  const clean = raw.replace(/^[^\w€$£¥₹%#@]+|[^\w€$£¥₹%]+$/g, "");
  if (!clean) return null;
  const low = clean.toLowerCase();
  if ((p.clientNames ?? []).some((n) => n && (low.includes(n) || n.split(/\s+/).includes(low)))) return "Client name";
  if (/\w@\w/.test(raw) || /@/.test(raw) && /\./.test(raw)) return "Email";
  if (/^(19|20)\d{2}$/.test(clean) || /^(q[1-4]|h[12]|fy\d{2,4}|w\d{1,2}|p\d{1,2})$/i.test(clean)) return null;
  if (/[A-Za-z]{2,}[-_]?\d{3,}|\d{3,}[-_][A-Za-z]/.test(clean)) return "Identifier";
  if (/[\d€$£¥₹%]/.test(clean)) return "Number or money";
  if (clean.length <= 1) return null;
  if (allow.has(low)) return null;
  const parts = low.split(/[-/&]/).filter(Boolean);
  if (parts.length > 1 && parts.every((x) => allow.has(x))) return null;
  return "Text not on allowlist";
}
function parseTsv(tsv, scale) {
  const out = [];
  for (const line of tsv.split("\n")) {
    const c = line.split("	");
    if (c.length < 12 || c[0] !== "5") continue;
    const text = c.slice(11).join("	").trim();
    const conf = parseFloat(c[10]);
    if (!text || conf < (/\d/.test(text) ? 12 : 30)) continue;
    out.push({ text, conf, x: +c[6] / scale, y: +c[7] / scale, w: +c[8] / scale, h: +c[9] / scale });
  }
  return out;
}
function maskBoxes(words, types) {
  const boxes = [];
  words.forEach((w, i) => {
    const type = types[i];
    if (!type) return;
    const p = Math.max(3, w.h * 0.18);
    boxes.push({ x: w.x - p, y: w.y - p, w: w.w + 2 * p, h: w.h + 2 * p, type });
  });
  return boxes;
}
function mergePasses(passes) {
  const all = [];
  for (const words of passes) {
    for (const w of words) if (!all.some((v) => overlap(v, w) > 0.3)) all.push(w);
  }
  return all;
}
function overlap(a, b) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const small = Math.min(a.w * a.h, b.w * b.h);
  return small > 0 ? ix * iy / small : 0;
}
let workerP = null;
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
    await w.setParameters({ tessedit_pageseg_mode: "11", preserve_interword_spaces: "1" });
    return w;
  }).catch((e) => {
    workerP = null;
    throw e;
  });
}
const ALLOW = new Set(ALLOW_WORDS);
const scan = (texts) => texts.map((t) => classify(t, { allow: ALLOW }));
function load(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("could not decode canvas image"));
    img.src = dataUrl;
  });
}
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
    const { data } = await w.recognize(prep(img, 2, invert), {}, { tsv: true, text: false, blocks: false, hocr: false });
    passes.push(parseTsv(data.tsv ?? "", 2));
  }
  return mergePasses(passes);
}
async function run(images) {
  const results = [];
  for (const { id, dataUrl } of images) {
    const words = await read(await load(dataUrl));
    results.push({ id, words: words.length, boxes: maskBoxes(words, scan(words.map((w) => w.text))) });
  }
  return results;
}
chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  if (msg?.target !== "offscreen" || msg.type !== "vs-ocr") return;
  run(msg.images).then(
    (results) => send({ ok: true, results }),
    (e) => send({ ok: false, error: e instanceof Error ? e.message : String(e) })
  );
  return true;
});
