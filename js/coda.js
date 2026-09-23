// Coda locale dei rilievi e sincronizzazione con Supabase.
//
// Il rilievo si salva sempre e comunque sul telefono, foto compresa: in
// autostrada il campo va e viene, e perdere un sopralluogo perché mancava la
// linea non è accettabile. La sincronizzazione è un secondo momento, che
// riparte da sola appena c'è rete.

import { caricaFile, inserisci } from './rete.js';

const DB = 'giunti', VERSIONE = 1, MAGAZZINO = 'coda';

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

function transazione(modo, fn) {
  return apri().then(db => new Promise((ok, no) => {
    const t = db.transaction(MAGAZZINO, modo);
    const risultato = fn(t.objectStore(MAGAZZINO));
    t.oncomplete = () => ok(risultato && risultato.result !== undefined
      ? risultato.result : risultato);
    t.onerror = () => no(t.error);
  }));
}

export async function accoda(rilievo) {
  rilievo.id = rilievo.id || crypto.randomUUID();
  rilievo.creato_il = rilievo.creato_il || new Date().toISOString();
  rilievo.stato = 'in_attesa';
  await transazione('readwrite', m => m.put(rilievo));
  return rilievo.id;
}

export function inCoda() {
  return transazione('readonly', m => m.getAll());
}

export async function daSincronizzare() {
  return (await inCoda()).filter(r => r.stato !== 'inviato');
}

async function segna(id, stato, errore) {
  const tutti = await inCoda();
  const r = tutti.find(x => x.id === id);
  if (!r) return;
  r.stato = stato;
  if (errore) r.errore = errore;
  if (stato === 'inviato') {
    // i file ormai sono sul server: tenerne una seconda copia sul telefono
    // riempirebbe la memoria per niente. Restano i dati per l'elenco.
    delete r.foto;
    delete r.audio;
    delete r.errore;
  }
  await transazione('readwrite', m => m.put(r));
}

export async function dimentica(id) {
  await transazione('readwrite', m => m.delete(id));
}

// ---------------------------------------------------------------- Supabase

// Invia un rilievo: prima i file, poi le righe. Se qualcosa va storto il
// rilievo resta in coda e ci si riprova, senza perdere niente.
async function invia(r) {
  const cartella = `${r.linea_id.replace(/[^\w-]/g, '_')}/${r.id}`;

  let audio_path = null;
  if (r.audio) {
    // Safari registra in mp4, Chrome in webm: l'estensione segue il formato
    // vero, altrimenti il file non si riascolta.
    const estensione = (r.audio.type || '').includes('mp4') ? 'm4a' : 'webm';
    audio_path = await caricaFile('audio', `${cartella}.${estensione}`, r.audio);
  }

  const rilievo = await inserisci('rilievi', {
    id: r.id,
    linea_id: r.linea_id,
    carreggiata: r.carreggiata || null,
    data: r.data,
    colore: r.colore || null,
    stati_corsie: r.stati_corsie || null,
    nota: r.nota || null,
    audio_path,
    lat: r.lat ?? null,
    lon: r.lon ?? null,
    precisione_m: r.precisione_m ?? null,
    autore: r.autore || null,
  });

  for (let i = 0; i < (r.foto || []).length; i++) {
    const path = await caricaFile('foto', `${cartella}-${i + 1}.jpg`, r.foto[i]);
    await inserisci('foto', {
      rilievo_id: rilievo.id, path,
      scattata_il: r.creato_il, lat: r.lat ?? null, lon: r.lon ?? null,
    });
  }
}

// Prova a svuotare la coda. Restituisce quanti ne ha inviati e quanti no.
export async function sincronizza() {
  if (!navigator.onLine) return { inviati: 0, rimasti: (await daSincronizzare()).length };
  let inviati = 0;
  for (const r of await daSincronizzare()) {
    try {
      await invia(r);
      await segna(r.id, 'inviato');
      inviati++;
    } catch (e) {
      await segna(r.id, 'in_attesa', String(e.message || e));
    }
  }
  return { inviati, rimasti: (await daSincronizzare()).length };
}

export function allaRete(fn) {
  window.addEventListener('online', fn);
}
