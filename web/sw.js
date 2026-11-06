/* VaultSnip service worker: the second visit is instant and works offline.
   Keeps this site's own files in the browser's cache, nothing else. Same site only: a request to any other site is
   left to the browser untouched. No data of the user's is ever stored here: only the app's files.
   - lib/, ml/, icons/, samples/: the reader's program and WASM cores, the on-device AI runtime, pictures: served from
     the cache when there, and fetched again in the background so a new release is picked up on the next visit (these
     files are not named by their contents, so "cache for ever" would keep an old reader after an update). The language
     file (lang/) and the AI models (models/) are not kept here: the reader and the AI keep their own copies in the
     browser's storage already, and a second copy would double the space they take.
   - everything else (the page, app.js and the other scripts): fetched from the site when online, so a new release
     shows at once; the cached copy is used only when offline (network first) */
const CACHE = 'vaultsnip-files-v1';
const KEEP = /\/(lib|ml|icons|samples)\//;
const SKIP = /\/(lang|models)\//;   // kept by the reader and the AI themselves; never a second copy here

self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || SKIP.test(url.pathname)) return;
  if (KEEP.test(url.pathname)) e.respondWith(cacheFirst(req));
  else e.respondWith(networkFirst(req));
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  // revalidate in the background: the next visit gets the new file; if the site is unreachable, the copy stays
  const fresh = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()).catch(() => {}); return res; });
  if (hit) { fresh.catch(() => {}); return hit; }
  return fresh;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw e;
  }
}
