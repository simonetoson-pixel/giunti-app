// Service worker: tiene in cache l'app e l'elenco dei giunti, perché in
// corsia d'emergenza deve aprirsi anche senza rete.

const CACHE = 'giunti-v2';
const FILE = [
  './', './index.html', './stile.css', './manifest.json',
  './js/app.js', './js/vicini.js', './js/coda.js',
  './js/rete.js', './js/dati.js', './icona.svg', './config.json',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(chiavi => Promise.all(chiavi.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // le chiamate a Supabase non si cachano mai: o passano o vanno in coda
  if (e.request.method !== 'GET' || url.hostname.endsWith('supabase.co')) return;

  // Prima la rete, così un aggiornamento del censimento arriva subito; se non
  // c'è, si usa la copia in cache.
  e.respondWith(
    fetch(e.request)
      .then(r => {
        const copia = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copia));
        return r;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
