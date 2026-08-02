/* Service worker: app shell em cache, rede para o Supabase.
   Muda CACHE quando editares ficheiros, senão o telemóvel serve a versão antiga. */
const CACHE = 'casa-v2';
const SHELL = [
  './', './index.html', './styles.css', './app.js', './config.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin) return;   // Supabase e fontes vão direto à rede

  e.respondWith(
    caches.match(e.request).then((hit) => {
      const net = fetch(e.request).then((r) => {
        if (r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); }
        return r;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
