// Il censimento sul telefono.
//
// Non viaggia più come file dentro il sito: il sito è pubblico, mentre questi
// sono dati di CAV. Si scarica da Supabase dopo l'accesso e si tiene in
// memoria locale, così sul campo funziona senza rete e senza che nessuno,
// aprendo l'indirizzo, possa leggerselo.

import { chiama } from './rete.js';

const DB = 'giunti-censimento', VERSIONE = 1, MAGAZZINO = 'linee';

function apri() {
  return new Promise((ok, no) => {
    const r = indexedDB.open(DB, VERSIONE);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(MAGAZZINO)) {
        db.createObjectStore(MAGAZZINO, { keyPath: 'id' });
      }
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
}

function scrivi(linee) {
  return apri().then(db => new Promise((ok, no) => {
    const t = db.transaction(MAGAZZINO, 'readwrite');
    const m = t.objectStore(MAGAZZINO);
    m.clear();
    linee.forEach(l => m.put(l));
    t.oncomplete = ok;
    t.onerror = () => no(t.error);
  }));
}

function leggi() {
  return apri().then(db => new Promise(ok => {
    const q = db.transaction(MAGAZZINO).objectStore(MAGAZZINO).getAll();
    q.onsuccess = () => ok(q.result);
  }));
}

// Una chiamata sola: linee con dentro le carreggiate e le loro corsie.
async function scarica() {
  const r = await chiama('/rest/v1/linee?select=id,strada,km,km_m,opera,lat,lon,'
    + 'giunti(carreggiata,km,modello,anno,doppio_senso,ordine,'
    + 'corsie(posizione,corsia,stato))&order=strada,km_m');
  const grezze = await r.json();

  // Dove la posizione è stata corretta a mano sull'ortofoto, vale quella: è
  // più precisa di quella interpolata, e sul campo serve a riconoscere il
  // giunto giusto quando due sono vicini.
  let corrette = {};
  try {
    const p = await chiama('/rest/v1/posizioni?select=linea_id,lat,lon');
    corrette = Object.fromEntries((await p.json()).map(x => [x.linea_id, x]));
  } catch { /* la tabella può non esserci ancora: si usano quelle calcolate */ }

  return grezze.map(l => ({
    id: l.id, strada: l.strada, km: l.km, km_m: l.km_m, opera: l.opera,
    lat: (corrette[l.id] || l).lat, lon: (corrette[l.id] || l).lon,
    posizione_corretta: !!corrette[l.id],
    carreggiate: (l.giunti || [])
      .sort((a, b) => a.ordine - b.ordine)
      .map(g => ({
        nome: g.carreggiata, km: g.km, modello: g.modello, anno: g.anno,
        doppio_senso: g.doppio_senso,
        corsie: (g.corsie || [])
          .sort((a, b) => a.posizione - b.posizione)
          .map(c => [c.corsia, c.stato]),
      })),
  }));
}

// Prima si mostra quello che c'è già, poi si prova ad aggiornarlo: sul campo
// conta aprire l'app subito, non avere l'ultimissima versione.
export async function censimento({ onAggiornato } = {}) {
  const locali = await leggi();
  if (locali.length) {
    scarica().then(async fresche => {
      if (fresche.length) {
        await scrivi(fresche);
        if (onAggiornato) onAggiornato(fresche);
      }
    }).catch(() => {});
    return locali;
  }
  const fresche = await scarica();
  await scrivi(fresche);
  return fresche;
}

export async function quantiInMemoria() {
  return (await leggi()).length;
}
