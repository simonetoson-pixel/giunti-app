// La scheda di un ponte.
//
// Cliccando un puntino sulla mappa o una riga dello schema non si apre la
// singola linea di giunto ma tutto il ponte, con la linea da cui si è partiti
// evidenziata: un giunto non si guarda mai da solo, si guarda rispetto agli
// altri della stessa opera.
//
// Su ogni linea stanno insieme le tre cose che servono per decidere: com'è a
// censimento, cosa si è visto sul campo (foto, note scritte, note vocali) e
// cosa si è aggiunto in ufficio. Lo schema è modificabile, ma solo dopo aver
// acceso l'interruttore: in ufficio si legge molto più spesso di quanto si
// corregga, e un clic per sbaglio non deve cambiare un dato.

import { urlFirmato, emailUtente } from './rete.js';
import {
  dati, NOMI_STATO, COLORE, STATI, statoGiunto, rilieviDi, commentiDi,
  operaDi, correggiCorsia, correggiGiunto, aggiungiCommento, cancellaCommento,
  trovaLinea,
} from './dati-ufficio.js';

const $ = id => document.getElementById(id);

// le stesse misure che stanno in archivio.css per .carr-scheda .corsia
const LARGHEZZA_CORSIA = 42;
const DISTANZA_CORSIE = 3;

let opera = null;
let evidenziata = null;   // la linea da cui si è arrivati
let modifica = false;
let alCambio = null;      // da avvisare quando un dato cambia, per ridisegnare

export function quandoCambia(fn) { alCambio = fn; }

function data(s) {
  return new Date(s).toLocaleDateString('it-IT',
    { day: 'numeric', month: 'short', year: 'numeric' });
}

function fuga(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---------------------------------------------------- strati e tasto indietro
// La scheda del ponte e le foto ingrandite sono sopra la pagina, ma per il
// browser sono sempre la stessa pagina: il tasto "indietro" (e il gesto del
// trackpad) usciva dall'archivio invece di chiudere la foto. Ogni strato che si
// apre mette una voce nella cronologia, e "indietro" chiude lo strato in cima,
// uno alla volta. Chiudere col pulsante fa la stessa cosa: torna indietro, e
// la chiusura vera la fa l'evento della cronologia.
const strati = [];

function apriStrato(chiusura) {
  history.pushState({ strato: strati.length + 1 }, '');
  strati.push(chiusura);
}

function chiudiStrato() {
  if (strati.length) history.back();
}

window.addEventListener('popstate', () => {
  const chiusura = strati.pop();
  if (chiusura) chiusura();
});

// --------------------------------------------------------------- apertura
function nascondiScheda() {
  $('scheda').hidden = true;
  opera = null;
}

export function apriPonte(lineaId) {
  const linea = trovaLinea(lineaId);
  if (!linea) return;
  opera = operaDi(linea);
  evidenziata = lineaId;
  modifica = false;
  disegna();
  if ($('scheda').hidden) apriStrato(nascondiScheda);
  $('scheda').hidden = false;
  const riga = document.querySelector('.riga-linea.evidenziata');
  if (riga) riga.scrollIntoView({ block: 'center' });
}

export function chiudi() {
  if (strati.length) history.back();
  else nascondiScheda();
}

// ---------------------------------------------------------------- disegno
function disegna() {
  if (!opera) return;
  const tipologia = opera.linee[0].carreggiate[0] && opera.linee[0].carreggiate[0].tipologia;
  $('scheda-corpo').innerHTML = `
    <div class="scheda-testa">
      <h2>${fuga(opera.opera)}</h2>
      <div class="dove">${fuga(opera.strada)} · km ${opera.km_da}
        ${opera.km_da !== opera.km_a ? ` &ndash; ${opera.km_a}` : ''}
        · ${opera.linee.length} ${opera.linee.length === 1 ? 'linea' : 'linee di giunto'}
        ${tipologia ? ` · ${fuga(tipologia)}` : ''}</div>
      <label class="interruttore">
        <input type="checkbox" id="b-modifica" ${modifica ? 'checked' : ''}>
        <span>Modifica lo schema</span>
      </label>
    </div>
    <div class="scheda-corpo${modifica ? ' in-modifica' : ''}">
      ${opera.linee.map(l => disegnaLinea(l, colonne())).join('')}
    </div>`;

  collegaEventi();
  caricaMedia();
}

// Le colonne del ponte: tutte le carreggiate che compaiono su almeno una
// delle sue linee, nell'ordine in cui stanno sul terreno.
//
// Vanno fissate per tutto il ponte, non prese linea per linea. Sull'Adige
// certe linee hanno il giunto solo in est: disegnando solo le carreggiate
// presenti, quella finiva nella prima posizione — sotto la colonna dell'ovest
// di tutte le altre righe — e sembrava una linea in ovest.
function colonne() {
  const viste = new Map();
  for (const l of opera.linee) {
    for (const g of l.carreggiate) {
      const c = viste.get(g.carreggiata);
      // quante corsie tiene la colonna: serve a far combaciare la larghezza
      // del posto vuoto con quella delle righe che il giunto ce l'hanno
      if (!c) viste.set(g.carreggiata, { ordine: g.ordine, corsie: g.corsie.length });
      else c.corsie = Math.max(c.corsie, g.corsie.length);
    }
  }
  return [...viste.entries()]
    .sort((a, b) => a[1].ordine - b[1].ordine)
    .map(([nome, c]) => ({
      nome,
      corsie: c.corsie,
      // La larghezza della colonna la decidono le corsie, ed e' la stessa per
      // tutte le righe del ponte. Lasciandola al contenuto, un blocco col
      // titolo lungo ("OVEST FIP GPE 300 · 2011") si allargava piu delle sue
      // corsie e spostava a destra la carreggiata accanto: le righe con il
      // giunto in una sola carreggiata restavano disallineate dalle altre.
      larghezza: c.corsie * LARGHEZZA_CORSIA + (c.corsie - 1) * DISTANZA_CORSIE,
    }));
}


// Da che parte dello schema sta una carreggiata: ovest e sud a sinistra, est e
// nord a destra, come nello schema. Si guarda l'ordine che la linea stessa le
// da; se la linea non ha quella carreggiata (si fotografa dall'altra parte di
// un giunto che c'e' solo da un lato) si va a nome.
function latoDi(linea, nome) {
  if (!nome) return null;
  const g = linea.carreggiate.find(x => x.carreggiata === nome);
  const ordine = g ? g.ordine : (/^(OVEST|SUD)$/i.test(nome) ? 0 : 1);
  return ordine === 0 ? 'sx' : 'dx';
}

function dataBreve(s) {
  return new Date(s).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}

// Le foto di un lato, ognuna con sotto scritto di quale carreggiata e'.
function gruppoFoto(elenco) {
  return elenco.map(f => {
    const carr = f.rilievo.carreggiata;
    const nome = carr ? `Linea ${carr}` : 'Carreggiata non indicata';
    return `<figure class="foto-scheda">
      <img data-foto="${fuga(f.path)}" alt="${fuga(nome)} — ${data(f.rilievo.data)}" loading="lazy">
      <figcaption>${fuga(nome)} <span>· ${dataBreve(f.rilievo.data)}</span></figcaption>
    </figure>`;
  }).join('');
}

function disegnaLinea(l, nomi) {
  const suoi = rilieviDi(l.id);
  const commenti = commentiDi(l.id);
  const foto = suoi.flatMap(r => (r.foto || []).map(f => ({ ...f, rilievo: r })));

  // Le foto stanno dalla parte della loro carreggiata: a sinistra quelle della
  // carreggiata di sinistra, a destra quelle di destra, con lo schema in mezzo.
  // Prima stavano tutte in un blocco a destra, e non si capiva a cosa si
  // riferissero. Quelle fatte senza dire la carreggiata (prima che l'app la
  // registrasse) non si possono assegnare: stanno sotto, a parte.
  const gruppi = { sx: [], dx: [], altre: [] };
  foto.forEach(f => gruppi[latoDi(l, f.rilievo.carreggiata) || 'altre'].push(f));

  return `<section class="riga-linea${l.id === evidenziata ? ' evidenziata' : ''}"
                   data-linea="${fuga(l.id)}">
    <div class="intestazione-linea">
      <span class="km mono">km ${l.km}</span>
      ${l.posizione_corretta ? '<span class="segno" title="posizione corretta a mano">◎</span>' : ''}
      <span class="conta">${foto.length ? `${foto.length} foto` : 'nessuna foto'}${
        suoi.length ? ` · ${suoi.length} rilievi` : ''}</span>
    </div>

    <div class="corpo-linea">
      <div class="foto-lato sx">${gruppoFoto(gruppi.sx)}</div>
      <div class="schema-linea">
        ${nomi.map(col => {
    const g = l.carreggiate.find(x => x.carreggiata === col.nome);
    if (g) return disegnaCarreggiata(g, col.larghezza);
    // Solo lo spazio, senza disegnarci niente: le due carreggiate sono ponti
    // strutturalmente diversi, e qui il giunto non manca — non ci va. Una
    // cella tratteggiata o la scritta "nessun giunto" direbbero il contrario.
    return `<div class="carr-scheda vuota" aria-hidden="true"
      style="width:${col.larghezza}px"></div>`;
  }).join('')}
      </div>

      <div class="foto-lato dx">${gruppoFoto(gruppi.dx)}</div>
    </div>
    ${gruppi.altre.length
    ? `<div class="foto-lato altre">${gruppoFoto(gruppi.altre)}</div>` : ''}

    <div class="voci">
      ${disegnaVociCampo(suoi)}
      ${disegnaCommenti(l, commenti)}
    </div>
  </section>`;
}

function disegnaCarreggiata(g, larghezza) {
  const meta = [g.modello, g.anno].filter(Boolean).join(' · ');
  return `<div class="carr-scheda${g.corretto ? ' corretta' : ''}"
       style="width:${larghezza}px" data-giunto="${fuga(g.id)}">
    <div class="titolo">
      <b>${fuga(g.carreggiata)}</b>${g.doppio_senso ? ' <i>doppio senso</i>' : ''}
      <span class="meta" data-campo="meta">${fuga(meta) || '&mdash;'}</span>
      ${g.corretto ? '<span class="segno" title="corretto in ufficio">✎</span>' : ''}
    </div>
    <div class="strisce">${g.corsie.map(c => `
      <button class="corsia" type="button" data-giunto="${fuga(g.id)}" data-pos="${c.posizione}"
              style="background:${COLORE(c.stato)}"
              title="${NOMI_STATO[c.stato] || 'nessun dato'}${
  c.corretto ? ` (a censimento: ${NOMI_STATO[c.stato_censimento] || 'nessun dato'})` : ''}">
        ${fuga(c.corsia)}${c.corretto ? '<i class="corretta"></i>' : ''}
      </button>`).join('')}</div>
  </div>`;
}

function disegnaVociCampo(rilievi) {
  const voci = rilievi.filter(r => r.nota || r.audio_path || r.colore);
  if (!voci.length) return '';
  return `<div class="voce-gruppo">
    <h4>Dal campo</h4>
    ${voci.map(r => `<div class="voce" data-rilievo="${fuga(r.id)}">
      <div class="quando">${data(r.data)}${r.carreggiata ? ` · ${fuga(r.carreggiata)}` : ''}
        ${r.colore ? `<span class="pallino" style="background:${COLORE(r.colore)}"></span>
          ${NOMI_STATO[r.colore]}` : ''}</div>
      ${r.nota ? `<p class="testo">${fuga(r.nota)}</p>` : ''}
      ${r.audio_path ? '<audio controls preload="none"></audio>' : ''}
    </div>`).join('')}
  </div>`;
}

function disegnaCommenti(l, commenti) {
  return `<div class="voce-gruppo">
    <h4>Dall'ufficio</h4>
    ${commenti.map(c => `<div class="voce commento" data-commento="${fuga(c.id)}">
      <div class="quando">${data(c.creato_il)}${c.autore ? ` · ${fuga(c.autore)}` : ''}
        <button class="togli-commento" type="button" title="Cancella">&times;</button></div>
      <p class="testo">${fuga(c.testo)}</p>
    </div>`).join('')}
    <form class="nuovo-commento" data-linea="${fuga(l.id)}">
      <textarea rows="2" placeholder="Aggiungi un commento…"></textarea>
      <button type="submit">Aggiungi</button>
    </form>
  </div>`;
}

// ------------------------------------------------------------------ media
// Foto e audio stanno in contenitori privati: per mostrarli serve un
// collegamento firmato, che vale un'ora e solo per chi ha fatto l'accesso.
async function caricaMedia() {
  for (const img of $('scheda-corpo').querySelectorAll('img[data-foto]')) {
    try { img.src = await urlFirmato('foto', img.dataset.foto); } catch { /* resta vuota */ }
  }
  for (const blocco of $('scheda-corpo').querySelectorAll('.voce[data-rilievo]')) {
    const r = dati.rilievi.find(x => x.id === blocco.dataset.rilievo);
    const audio = blocco.querySelector('audio');
    if (audio && r && r.audio_path) {
      try { audio.src = await urlFirmato('audio', r.audio_path); } catch { /* niente */ }
    }
  }
}

// ---------------------------------------------------------------- modifica
function menuStati(bottone, giuntoId, posizione) {
  document.querySelectorAll('.menu-stati').forEach(m => m.remove());
  const m = document.createElement('div');
  m.className = 'menu-stati';
  m.innerHTML = STATI.map(s => `
    <button type="button" data-stato="${s}">
      <span class="macchia" style="background:${COLORE(s)}"></span>${NOMI_STATO[s]}
    </button>`).join('')
    + '<button type="button" data-stato="">Come da censimento</button>';
  document.body.appendChild(m);

  // sotto al bottone se ci sta, altrimenti sopra; e comunque dentro la
  // finestra, perche' un menu che esce dallo schermo non si puo cliccare
  const r = bottone.getBoundingClientRect();
  const h = m.offsetHeight;
  let y = r.bottom + 4;
  if (y + h + 12 > window.innerHeight) y = r.top - h - 4;
  y = Math.max(8, Math.min(y, window.innerHeight - h - 12));
  const x = Math.max(8, Math.min(r.left, window.innerWidth - m.offsetWidth - 12));
  m.style.left = `${x}px`;
  m.style.top = `${y}px`;

  m.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    m.remove();
    try {
      await correggiCorsia(giuntoId, posizione, b.dataset.stato || null, emailUtente());
      disegna();
      if (alCambio) alCambio();
    } catch (err) {
      alert('Non riesco a salvare la correzione: ' + String(err.message || err));
    }
  });
  setTimeout(() => document.addEventListener('click', function via(e) {
    if (!m.contains(e.target)) { m.remove(); document.removeEventListener('click', via); }
  }), 0);
}

async function cambiaMeta(span, giuntoId) {
  const g = dati.linee.flatMap(l => l.carreggiate).find(x => x.id === giuntoId);
  if (!g) return;
  const modello = prompt('Modello del giunto', g.modello || '');
  if (modello === null) return;
  const anno = prompt('Anno di posa (vuoto se non si sa)', g.anno || '');
  if (anno === null) return;
  try {
    await correggiGiunto(giuntoId, {
      modello: modello.trim() || null,
      anno: anno.trim() ? parseInt(anno, 10) : null,
    }, emailUtente());
    disegna();
    if (alCambio) alCambio();
  } catch (err) {
    alert('Non riesco a salvare: ' + String(err.message || err));
  }
}

// ----------------------------------------------------------------- eventi
function collegaEventi() {
  $('b-modifica').addEventListener('change', e => {
    modifica = e.target.checked;
    disegna();
  });

  $('scheda-corpo').addEventListener('click', async e => {
    const corsia = e.target.closest('.corsia');
    if (corsia && modifica) {
      return menuStati(corsia, corsia.dataset.giunto, +corsia.dataset.pos);
    }

    const meta = e.target.closest('[data-campo="meta"]');
    if (meta && modifica) {
      return cambiaMeta(meta, meta.closest('.carr-scheda').dataset.giunto);
    }

    const togli = e.target.closest('.togli-commento');
    if (togli) {
      const id = togli.closest('[data-commento]').dataset.commento;
      if (!confirm('Cancello questo commento?')) return;
      try { await cancellaCommento(id); disegna(); } catch { /* niente */ }
      return;
    }

    const img = e.target.closest('.foto-scheda img');
    if (img && img.src) ingrandisci(img);
  });

  $('scheda-corpo').addEventListener('submit', async e => {
    const form = e.target.closest('.nuovo-commento');
    if (!form) return;
    e.preventDefault();
    const area = form.querySelector('textarea');
    const testo = area.value.trim();
    if (!testo) return;
    form.querySelector('button').disabled = true;
    try {
      await aggiungiCommento(form.dataset.linea, null, testo, emailUtente());
      disegna();
    } catch (err) {
      alert('Non riesco a salvare il commento: ' + String(err.message || err));
      form.querySelector('button').disabled = false;
    }
  });
}

// La foto si guarda grande: è per questo che si scatta. Con le frecce si passa
// alle altre della stessa linea, nell'ordine in cui stanno sullo schermo
// (prima quelle di sinistra, poi quelle di destra).
//
// Si chiude col pulsante in alto a destra, con Esc, cliccando sullo sfondo o
// con "indietro" del browser. Prima c'erano solo Esc e lo sfondo, e chi usava
// "indietro" usciva dall'archivio.
function ingrandisci(img) {
  const riga = img.closest('.riga-linea');
  const tutte = [...riga.querySelectorAll('.foto-scheda img')].filter(i => i.src);
  let i = Math.max(0, tutte.indexOf(img));

  const v = document.createElement('div');
  v.className = 'ingrandita';
  v.innerHTML = `<img src="" alt=""><div class="didascalia"></div>
    <button class="chiudi-foto" type="button" aria-label="Chiudi la foto">&times;</button>
    <button class="prec" type="button" aria-label="Precedente">&lsaquo;</button>
    <button class="succ" type="button" aria-label="Successiva">&rsaquo;</button>`;
  const mostra = () => {
    v.querySelector('img').src = tutte[i].src;
    v.querySelector('.didascalia').textContent =
      tutte.length > 1 ? `${tutte[i].alt} — ${i + 1} di ${tutte.length}` : tutte[i].alt;
  };
  const vai = passo => { i = (i + passo + tutte.length) % tutte.length; mostra(); };

  v.querySelector('.prec').addEventListener('click', e => { e.stopPropagation(); vai(-1); });
  v.querySelector('.succ').addEventListener('click', e => { e.stopPropagation(); vai(1); });
  v.querySelector('.chiudi-foto').addEventListener('click', e => {
    e.stopPropagation(); chiudiStrato();
  });
  v.addEventListener('click', e => { if (e.target === v) chiudiStrato(); });

  const tasti = e => {
    if (e.key === 'Escape') { e.stopPropagation(); chiudiStrato(); }
    if (e.key === 'ArrowLeft') vai(-1);
    if (e.key === 'ArrowRight') vai(1);
  };
  document.addEventListener('keydown', tasti, true);
  document.body.appendChild(v);
  apriStrato(() => {
    v.remove();
    document.removeEventListener('keydown', tasti, true);
  });
  mostra();
}
