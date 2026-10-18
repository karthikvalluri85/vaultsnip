// Renders PRIVACY.md into web/privacy.html, the policy page the app (and the store listings) link to, so the two never
// drift apart. tools/check.mjs fails when the committed page differs from what this produces.
//   node tools/build-privacy.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'https://github.com/karthikvalluri85/vaultsnip';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The small Markdown subset PRIVACY.md uses: bold, italics, code and links, inside paragraphs and one bullet list. */
function inline(md) {
  const codes = [];
  let s = esc(md).replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
    // repository files resolve on GitHub; the page itself is served by the app
    const href = /^https?:/.test(url) ? url : `${REPO}/blob/main/${url}`;
    return `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>').replace(/(^|[\s(])_([^_\s][^_]*)_/g, '$1<i>$2</i>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
}

export function renderPrivacy(md) {
  const out = [];
  let list = false;
  for (const line of md.split(/\r?\n/)) {
    if (/^- /.test(line)) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(line.slice(2))}</li>`); continue; }
    if (list) { out.push('</ul>'); list = false; }
    if (!line.trim()) continue;
    const h = /^(#{1,3}) (.*)$/.exec(line);
    out.push(h ? `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>` : `<p>${inline(line)}</p>`);
  }
  if (list) out.push('</ul>');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VaultSnip privacy policy</title>
<style>body{margin:0;padding:32px 20px;font:16px/1.6 ui-sans-serif,system-ui,sans-serif;background:#f3f4f6;color:#14181e}main{max-width:68ch;margin:0 auto}a{color:#0b6e4f}@media (prefers-color-scheme:dark){body{background:#0f1215;color:#eef1f4}a{color:#5fd3a5}}code{font-size:.9em}</style></head>
<body><main>
<!-- Generated from PRIVACY.md by tools/build-privacy.mjs. Edit PRIVACY.md, then run the script. -->
${out.join('\n')}
</main></body></html>
`;
}

export const privacyPath = join(root, 'web', 'privacy.html');
export const expectedPrivacy = () => renderPrivacy(readFileSync(join(root, 'PRIVACY.md'), 'utf8'));

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(privacyPath, expectedPrivacy());
  console.log('Built web/privacy.html from PRIVACY.md');
}
