// Coda locale dei rilievi e sincronizzazione con Supabase.
//
// Il rilievo si salva sempre e comunque sul telefono, foto compresa: in
// autostrada il campo va e viene, e perdere un sopralluogo perché mancava la
// linea non è accettabile. La sincronizzazione è un secondo momento, che
// riparte da sola appena c'è rete.
//
// Un rilievo non finisce quando si tocca SALVA: si fotografa il giunto in
// corsia d'emergenza, si riparte, e le note si scrivono all'area di servizio.
// Quindi un rilievo resta modificabile anche dopo essere stato inviato, e le
// modifiche fatte senza rete rientrano in coda come tutto il resto.
//
// Come sono contate le foto: `foto` sono i blob ancora da caricare,
// `foto_caricate` quante stanno già sul server. Così aggiungere una foto a un
// rilievo inviato mesi fa non richiede di sapere cosa era già partito, e non
// si tiene sul telefono una seconda copia di quello che è già al sicuro.

import { caricaFile, inserisci, modifica, cancella, cancellaFile, leggi } from './rete.js';

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
  rilievo.foto_caricate = rilievo.foto_caricate || 0;
  rilievo.stato = 'in_attesa';
  await transazione('readwrite', m => m.put(rilievo));
  return rilievo.id;
}

// Un rilievo ripreso in mano: se era già partito torna in coda come modifica,
// se non era ancora partito parte completo e nessuno si accorge di niente.
export async function aggiorna(rilievo) {
  rilievo.modificato_il = new Date().toISOString();
  rilievo.stato = 'in_attesa';
  await transazione('readwrite', m => m.put(rilievo));
  return rilievo.id;
}

export function inCoda() {
  return transazione('readonly', m => m.getAll());
}

export async function unRilievo(id) {
  return (await inCoda()).find(r => r.id === id) || null;
}

export async function daSincronizzare() {
  return (await inCoda()).filter(r => r.stato !== 'inviato');
}

async function segna(id, stato, errore) {
  const r = await unRilievo(id);
  if (!r) return;
  r.stato = stato;
  if (errore) r.errore = errore;
  if (stato === 'inviato') {
    // i file ormai sono sul server: tenerne una seconda copia sul telefono
    // riempirebbe la memoria per niente. Restano i dati per l'elenco.
    r.foto_caricate = (r.foto_caricate || 0) + (r.foto || []).length;
    delete r.foto;
    delete r.audio;
    delete r.errore;
    r.inviato_il = r.inviato_il || new Date().toISOString();
  }
  await transazione('readwrite', m => m.put(r));
}

export async function dimentica(id) {
  await transazione('readwrite', m => m.delete(id));
}

// Cancellare un rilievo già inviato tocca anche il server: le foto e la riga
// spariscono per tutti, non solo da questo telefono.
export async function elimina(id) {
  const r = await unRilievo(id);
  if (r && r.inviato_il) {
    const foto = await fotoSulServer(id);
    for (const f of foto) {
      try { await cancellaFile('foto', f.path); } catch { /* resta orfano */ }
    }
    if (r.audio_path) {
      try { await cancellaFile('audio', r.audio_path); } catch { /* idem */ }
    }
    await cancella('foto', `rilievo_id=eq.${id}`);
    await cancella('rilievi', `id=eq.${id}`);
  }
  await dimentica(id);
}

async function fotoSulServer(id) {
  try {
    return await leggi(`foto?rilievo_id=eq.${id}&select=path`);
  } catch { return []; }
}

// ---------------------------------------------------------------- Supabase

function riga(r) {
  return {
    linea_id: r.linea_id,
    carreggiata: r.carreggiata || null,
    data: r.data,
    colore: r.colore || null,
    stati_corsie: r.stati_corsie || null,
    nota: r.nota || null,
    lat: r.lat ?? null,
    lon: r.lon ?? null,
    precisione_m: r.precisione_m ?? null,
    autore: r.autore || null,
  };
}

// Invia un rilievo: prima i file, poi le righe. Se qualcosa va storto il
// rilievo resta in coda e ci si riprova, senza perdere niente.
async function invia(r) {
  const cartella = `${r.linea_id.replace(/[^\w-]/g, '_')}/${r.id}`;
  const campi = riga(r);

  if (r.audio) {
    // Safari registra in mp4, Chrome in webm: l'estensione segue il formato
    // vero, altrimenti il file non si riascolta.
    const estensione = (r.audio.type || '').includes('mp4') ? 'm4a' : 'webm';
    campi.audio_path = await caricaFile('audio', `${cartella}.${estensione}`, r.audio);
  }

  if (r.inviato_il) {
    await modifica('rilievi', `id=eq.${r.id}`, campi);
  } else {
    await inserisci('rilievi', { id: r.id, ...campi });
  }

  // le foto già sul server non si ricaricano: si numerano da dove si era
  const partenza = r.foto_caricate || 0;
  for (let i = 0; i < (r.foto || []).length; i++) {
    const path = await caricaFile('foto', `${cartella}-${partenza + i + 1}.jpg`, r.foto[i]);
    await inserisci('foto', {
      rilievo_id: r.id, path,
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
