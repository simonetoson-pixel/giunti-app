// I dati dell'ufficio: censimento, correzioni, rilievi e commenti.
//
// Qui si legge tutto dal database a ogni apertura: si usa da scrivania, con
// la rete, e conta vedere il dato aggiornato.
//
// Tre voci diverse dicono com'è un giunto, e vanno tenute distinte:
//   - il censimento, che viene dall'Excel e si ricarica quando l'Excel cambia;
//   - le correzioni dell'ufficio, che stanno in tabelle loro e vincono sul
//     censimento, così una ricarica non le cancella;
//   - i rilievi sul campo, che non correggono niente: raccontano com'era
//     quel giorno, e restano tutti.

import { leggi, leggiTutto, chiama } from './rete.js';

export const STATI = ['cattive', 'attenzionare', 'buone_datate', 'ottime'];
export const NOMI_STATO = {
  ottime: 'Ottime condizioni', buone_datate: 'Buone ma datati',
  attenzionare: 'Da attenzionare', cattive: 'Cattive condizioni',
};
export const COLORE = s => `var(--${s || 'nessuno'})`;

// quanto è grave: serve a dare un colore solo alla linea intera
const GRAVITA = { ottime: 0, buone_datate: 1, attenzionare: 2, cattive: 3 };

export const dati = {
  linee: [],       // 225 linee, ognuna con le sue carreggiate e corsie
  rilievi: [],     // i rilievi sul campo, con le foto
  commenti: [],    // i commenti aggiunti in ufficio
  opere: [],       // le linee raggruppate per ponte
  conCorrezioni: false,   // se le tabelle dell'ufficio esistono già
};

// ------------------------------------------------------------- caricamento
async function forse(percorso, seNo = []) {
  try { return await leggiTutto(percorso); } catch { return seNo; }
}

export async function carica() {
  const [linee, posizioni] = await Promise.all([
    leggiTutto('linee?select=id,strada,km,km_m,opera,lat,lon&order=strada,km_m,id'),
    forse('posizioni?select=linea_id,lat,lon&order=linea_id'),
  ]);

  // le viste esistono solo dopo aver lanciato scripts/ufficio.sql: finché non
  // ci sono si legge il censimento nudo, e l'app funziona lo stesso
  let giunti = await forse('giunti_correnti?select=id,linea_id,carreggiata,ordine,'
    + 'doppio_senso,km,modello,anno,note,corretto&order=id', null);
  dati.conCorrezioni = giunti !== null;
  if (!giunti) {
    giunti = await leggiTutto('giunti?select=id,linea_id,carreggiata,ordine,'
      + 'doppio_senso,km,modello,anno,note&order=id');
    giunti.forEach(g => { g.corretto = false; });
  }

  let corsie = dati.conCorrezioni
    ? await forse('corsie_correnti?select=giunto_id,posizione,corsia,stato,'
      + 'stato_censimento,corretto&order=giunto_id,posizione', null)
    : null;
  if (!corsie) {
    corsie = await leggiTutto('corsie?select=giunto_id,posizione,corsia,stato&order=giunto_id,posizione');
    corsie.forEach(c => { c.stato_censimento = c.stato; c.corretto = false; });
  }

  const [rilievi, commenti] = await Promise.all([
    leggiTutto('rilievi?select=id,linea_id,carreggiata,data,colore,nota,audio_path,'
      + 'lat,lon,creato_il,stati_corsie,foto(id,path,scattata_il)'
      + '&order=data.desc,creato_il.desc,id'),
    forse('commenti?select=id,linea_id,giunto_id,testo,autore,creato_il'
      + '&order=creato_il.desc,id'),
  ]);

  // si rimonta l'albero: linea -> carreggiate -> corsie
  const corsiePerGiunto = {};
  corsie.forEach(c => (corsiePerGiunto[c.giunto_id] ||= []).push(c));
  const giuntiPerLinea = {};
  giunti.forEach(g => {
    g.corsie = (corsiePerGiunto[g.id] || []).sort((a, b) => a.posizione - b.posizione);
    (giuntiPerLinea[g.linea_id] ||= []).push(g);
  });

  const corrette = Object.fromEntries(posizioni.map(p => [p.linea_id, p]));
  linee.forEach(l => {
    l.carreggiate = (giuntiPerLinea[l.id] || []).sort((a, b) => a.ordine - b.ordine);
    if (corrette[l.id]) {
      l.lat = corrette[l.id].lat;
      l.lon = corrette[l.id].lon;
      l.posizione_corretta = true;
    }
  });

  const perLinea = Object.fromEntries(linee.map(l => [l.id, l]));
  rilievi.forEach(r => {
    r.linea = perLinea[r.linea_id];
    (r.foto || []).sort((a, b) => (a.path || '').localeCompare(b.path || ''));
  });

  dati.linee = linee;
  dati.rilievi = rilievi;
  dati.commenti = commenti;
  dati.opere = raggruppaPerOpera(linee);
  return dati;
}

// Un ponte è l'insieme delle linee che portano lo stesso nome sulla stessa
// tratta: è così che si guarda un'opera, non una linea per volta.
function raggruppaPerOpera(linee) {
  const gruppi = new Map();
  for (const l of linee) {
    const chiave = `${l.strada}|${l.opera || '—'}`;
    if (!gruppi.has(chiave)) {
      gruppi.set(chiave, {
        chiave, strada: l.strada, opera: l.opera || 'Opera non indicata', linee: [],
      });
    }
    gruppi.get(chiave).linee.push(l);
  }
  return [...gruppi.values()].map(o => {
    o.linee.sort(perDisegno);
    o.km_da = o.linee[o.linee.length - 1].km;
    o.km_a = o.linee[0].km;
    o.lat = o.linee.reduce((s, l) => s + (l.lat || 0), 0) / o.linee.length;
    o.lon = o.linee.reduce((s, l) => s + (l.lon || 0), 0) / o.linee.length;
    return o;
  });
}

// L'ordine in cui si disegnano le linee di una tratta o di un ponte.
//
// Come nei fogli Excel: la chilometrica piu bassa in fondo e si sale. E' il
// verso in cui si percorre la strada guardando lo schema dal basso, ed e'
// unanime in tutti e undici i fogli del censimento — quindi e' il modo in
// cui questi schemi si leggono da sempre, e cambiarlo confonde.
export function perDisegno(a, b) {
  return b.km_m - a.km_m;
}


export function operaDi(linea) {
  return dati.opere.find(o => o.chiave === `${linea.strada}|${linea.opera || '—'}`);
}

// ------------------------------------------------------------------ stato
// Una linea vale quanto la sua corsia peggiore: è il criterio con cui si
// decide una sostituzione. Il numero di corsie non conta.
export function statoPeggiore(elenco) {
  let peggio = null;
  for (const s of elenco) {
    if (s && (peggio === null || GRAVITA[s] > GRAVITA[peggio])) peggio = s;
  }
  return peggio;
}

export function statoGiunto(g) {
  return statoPeggiore(g.corsie.map(c => c.stato));
}

export function statoLinea(l) {
  return statoPeggiore(l.carreggiate.map(statoGiunto));
}

export function rilieviDi(lineaId) {
  return dati.rilievi.filter(r => r.linea_id === lineaId);
}

export function commentiDi(lineaId) {
  return dati.commenti.filter(c => c.linea_id === lineaId);
}

// L'ultimo rilievo che ha espresso un giudizio: è quello che colora la mappa.
export function ultimoGiudizio(lineaId) {
  return rilieviDi(lineaId).find(r => r.colore) || null;
}

// --------------------------------------------------------------- scritture
// Le correzioni dell'ufficio si scrivono in tabelle loro, mai su `giunti` e
// `corsie`: quelle si ricaricano dall'Excel e cancellerebbero tutto.
async function sovrascrivi(tabella, riga, chiave) {
  await chiama(`/rest/v1/${tabella}?on_conflict=${chiave}`, {
    method: 'POST', body: JSON.stringify(riga),
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
  });
}

export async function correggiCorsia(giuntoId, posizione, stato, autore) {
  await sovrascrivi('modifiche_corsie',
    { giunto_id: giuntoId, posizione, stato, autore, modificato_il: new Date().toISOString() },
    'giunto_id,posizione');
  const g = trovaGiunto(giuntoId);
  const c = g && g.corsie.find(x => x.posizione === posizione);
  if (c) { c.stato = stato; c.corretto = true; }
}

export async function correggiGiunto(giuntoId, campi, autore) {
  await sovrascrivi('modifiche_giunti',
    { giunto_id: giuntoId, ...campi, autore, modificato_il: new Date().toISOString() },
    'giunto_id');
  const g = trovaGiunto(giuntoId);
  if (g) Object.assign(g, campi, { corretto: true });
}

export async function aggiungiCommento(lineaId, giuntoId, testo, autore) {
  const r = await chiama('/rest/v1/commenti', {
    method: 'POST',
    body: JSON.stringify({ linea_id: lineaId, giunto_id: giuntoId || null, testo, autore }),
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
  });
  const nuovo = (await r.json())[0];
  dati.commenti.unshift(nuovo);
  return nuovo;
}

export async function cancellaCommento(id) {
  await chiama(`/rest/v1/commenti?id=eq.${id}`, { method: 'DELETE' });
  dati.commenti = dati.commenti.filter(c => c.id !== id);
}

export function trovaGiunto(giuntoId) {
  for (const l of dati.linee) {
    const g = l.carreggiate.find(x => x.id === giuntoId);
    if (g) return g;
  }
  return null;
}

export function trovaLinea(lineaId) {
  return dati.linee.find(l => l.id === lineaId) || null;
}
