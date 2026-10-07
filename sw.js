// Service worker: tiene in cache l'app e l'elenco dei giunti, perché in
// corsia d'emergenza deve aprirsi anche senza rete.

// Alzare insieme a VERSIONE in js/app.js: e' il numero che l'app mostra in
// fondo, e serve a capire a colpo d'occhio quale versione sta girando.
const CACHE = 'giunti-v8';
const FILE = [
  './', './index.html', './stile.css', './manifest.json',
  './js/app.js', './js/vicini.js', './js/coda.js',
  './js/rete.js', './js/dati.js', './icona.svg', './config.json',
];

self.addEventListener('install', e => {
  // cache: 'reload' = dalla rete, mai dalla copia che il telefono tiene da se.
  // GitHub Pages dice di tenere i file dieci minuti (max-age=600), e senza
  // questo un aggiornamento restava invisibile finche' non scadevano.
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(FILE.map(f => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
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
  // no-cache = si chiede comunque al server se il file e' cambiato (se no, la
  // risposta e' una riga e il file non rientra): cosi un aggiornamento si
  // vede subito e non fra dieci minuti.
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then(r => {
        const copia = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copia));
        return r;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
