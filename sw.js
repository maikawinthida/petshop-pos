// Offline shell: the app opens even without internet. Firestore keeps its own offline data.
const VERSION = 'pos-v42';
const SHELL = ['./', 'index.html', 'css/app.css?v=42', 'js/app.js?v=42', 'js/db.js?v=42', 'js/config.js?v=42', 'js/brands.js?v=42', 'js/costs-pet8.js?v=42', 'js/seeds.js?v=42', 'fonts/GoogleSans.woff2', 'manifest.webmanifest', 'icons/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // never cache Firebase API traffic
  if (/googleapis\.com|firebaseio|identitytoolkit|securetoken/.test(url.host) && !url.pathname.includes('/firebasejs/')) return;
  if (url.pathname.endsWith('version.txt')) return;
  const sameOrigin = url.origin === location.origin;
  const isLib = /gstatic\.com|cdnjs\.cloudflare\.com/.test(url.host);
  if (!sameOrigin && !isLib) return;
  // app files: network first (get updates), fall back to cache offline. libraries: cache first.
  if (sameOrigin) {
    e.respondWith(fetch(req, { cache: 'no-cache' }).then(r => { const c = r.clone(); caches.open(VERSION).then(x => x.put(req, c)); return r; }).catch(() => caches.match(req).then(r => r || caches.match('index.html'))));
  } else {
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => { const c = res.clone(); caches.open(VERSION).then(x => x.put(req, c)); return res; })));
  }
});
