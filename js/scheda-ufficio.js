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
import { preparaFoto, caricaFotoUfficio, aaaammgg } from './foto-ufficio.js';
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
      <div class="barra-modifica">
        <button type="button" id="b-modifica" class="bottone-modifica${modifica ? ' attivo' : ''}"
                aria-pressed="${modifica ? 'true' : 'false'}">
          ✎ ${modifica ? 'Fine modifica' : 'Modifica i colori delle corsie'}</button>
        ${modifica ? '<span class="aiuto-modifica">Clicca una corsia per cambiarne il colore; clicca modello e anno per correggerli.</span>' : ''}
      </div>
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

// Il nome con cui una foto si scarica: dice da solo dove e quando e' stata
// fatta, cosi in una cartella di foto scaricate si riconoscono.
function nomeFile(l, f) {
  const n = (f.path.match(/-(\d+)\.jpg$/) || [])[1] || '1';
  const pezzi = [l.strada, `km${String(l.km).replace('+', '-')}`, f.rilievo.carreggiata || 'carr-nd',
    f.rilievo.data, n];
  return pezzi.join('_').replace(/[^\w.-]+/g, '-') + '.jpg';
}

// Le foto di un lato, ognuna con sotto scritto di quale carreggiata e'.
function gruppoFoto(elenco, l) {
  return elenco.map(f => {
    const carr = f.rilievo.carreggiata;
    const nome = carr ? `Linea ${carr}` : 'Carreggiata non indicata';
    return `<figure class="foto-scheda">
      <img data-foto="${fuga(f.path)}" data-nome="${fuga(nomeFile(l, f))}" alt="${fuga(nome)} — ${data(f.rilievo.data)}" loading="lazy">
      <figcaption>${fuga(nome)} <span>· ${dataBreve(f.rilievo.data)}</span></figcaption>
    </figure>`;
  }).join('');
}

// Il pulsante per aggiungere foto fatte fuori dall'app: sta dalla parte della
// carreggiata a cui le foto appartengono, quindi la carreggiata e' gia detta.
function pulsanteAggiungi(l, lato) {
  const g = l.carreggiate.find(x => (lato === 'sx') === (x.ordine === 0));
  if (!g) return '';
  return `<div class="aggiungi-foto-zona">
    <button type="button" class="aggiungi-foto-ufficio" data-linea="${fuga(l.id)}"
            data-carr="${fuga(g.carreggiata)}">＋ Aggiungi foto · ${fuga(g.carreggiata)}</button>
  </div>`;
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
      <div class="foto-lato sx">${gruppoFoto(gruppi.sx, l)}${pulsanteAggiungi(l, 'sx')}</div>
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

      <div class="foto-lato dx">${gruppoFoto(gruppi.dx, l)}${pulsanteAggiungi(l, 'dx')}</div>
    </div>
    ${gruppi.altre.length
    ? `<div class="foto-lato altre">${gruppoFoto(gruppi.altre, l)}</div>` : ''}

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
  $('b-modifica').addEventListener('click', () => {
    modifica = !modifica;
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
    if (img && img.src) return ingrandisci(img);

    const aggiungi = e.target.closest('.aggiungi-foto-ufficio');
    if (aggiungi) return scegliFoto(aggiungi);
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
// Si ingrandisce per vedere i dettagli: rotellina o pizzico del trackpad (verso
// il punto in cui si sta), doppio clic, i pulsanti + e −, e i tasti + − 0. Da
// ingrandita si trascina per spostarsi. "100%" mostra la foto a dimensione
// reale, un pixel suo per ogni pixel CSS.
//
// Si chiude col pulsante in alto a destra, con Esc, cliccando sullo sfondo o
// con "indietro" del browser.
const ZOOM_MAX = 10;

function ingrandisci(img) {
  const riga = img.closest('.riga-linea');
  const tutte = [...riga.querySelectorAll('.foto-scheda img')].filter(i => i.src);
  let i = Math.max(0, tutte.indexOf(img));

  const v = document.createElement('div');
  v.className = 'ingrandita';
  v.innerHTML = `<img src="" alt="" draggable="false"><div class="didascalia"></div>
    <button class="chiudi-foto" type="button" aria-label="Chiudi la foto">&times;</button>
    <button class="prec" type="button" aria-label="Precedente">&lsaquo;</button>
    <button class="succ" type="button" aria-label="Successiva">&rsaquo;</button>
    <div class="barra-zoom" role="group" aria-label="Ingrandimento">
      <button type="button" data-zoom="meno" aria-label="Riduci">&minus;</button>
      <span class="livello" aria-live="polite">adatta</span>
      <button type="button" data-zoom="piu" aria-label="Ingrandisci">+</button>
      <button type="button" data-zoom="adatta">Adatta</button>
      <button type="button" data-zoom="cento">100%</button>
      <span class="separa"></span>
      <button type="button" data-scarica="una">&#8681; Scarica</button>
      <button type="button" data-scarica="tutte" hidden></button>
    </div>`;
  const foto = v.querySelector('img');
  const livello = v.querySelector('.livello');

  // --- ingrandimento: scala e spostamento, con l'origine al centro dello schermo
  let sc = 1, tx = 0, ty = 0;
  const centro = () => { const r = v.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r.width, r.height]; };

  function limita() {
    // la foto non si fa scappare fuori: si puo spostare solo finche copre lo schermo
    const [, , vw, vh] = centro();
    const mx = Math.max(0, (foto.offsetWidth * sc - vw) / 2);
    const my = Math.max(0, (foto.offsetHeight * sc - vh) / 2);
    tx = Math.min(mx, Math.max(-mx, tx));
    ty = Math.min(my, Math.max(-my, ty));
  }
  function applica() {
    limita();
    foto.style.transform = `translate(${tx}px, ${ty}px) scale(${sc})`;
    v.classList.toggle('ingrandita-zoom', sc > 1.001);
    livello.textContent = sc <= 1.001 ? 'adatta' : `${Math.round(sc * 100)}%`;
  }
  // porta l'ingrandimento a `nuova`, tenendo fermo il punto sotto il puntatore
  function zoomA(nuova, cx, cy) {
    nuova = Math.min(ZOOM_MAX, Math.max(1, nuova));
    const [ox, oy] = centro();
    const px = (cx ?? ox) - ox, py = (cy ?? oy) - oy;
    const k = nuova / sc;
    tx = px - k * (px - tx);
    ty = py - k * (py - ty);
    sc = nuova;
    if (sc <= 1.001) { sc = 1; tx = ty = 0; }
    applica();
  }
  // dimensione reale: un pixel della foto per ogni pixel CSS, come "dimensione
  // effettiva" nei browser. Su uno schermo Retina e' gia piu fitto dei pixel veri.
  function aCento() {
    const fit = foto.offsetWidth || 1;
    zoomA(Math.max(1, foto.naturalWidth / fit));
  }
  const azzera = () => { sc = 1; tx = ty = 0; applica(); };

  const mostra = () => {
    azzera();
    foto.src = tutte[i].src;
    v.querySelector('.didascalia').textContent =
      tutte.length > 1 ? `${tutte[i].alt} — ${i + 1} di ${tutte.length}` : tutte[i].alt;
  };
  const vai = passo => { i = (i + passo + tutte.length) % tutte.length; mostra(); };

  // --- scaricare: la foto e' su un altro indirizzo (lo spazio di archiviazione),
  // dove il browser ignora il nome proposto e aprirebbe la foto invece di
  // salvarla. Si scarica il contenuto e lo si salva da qui, con un nome parlante.
  const bScarica = v.querySelector('[data-scarica="una"]');
  const bTutte = v.querySelector('[data-scarica="tutte"]');
  if (tutte.length > 1) { bTutte.hidden = false; bTutte.textContent = `\u21A7 Tutte (${tutte.length})`; }
  async function scarica(im, bottone) {
    const prima = bottone.textContent;
    bottone.disabled = true;
    bottone.textContent = '…';
    try {
      const risposta = await fetch(im.src);
      if (!risposta.ok) throw new Error(risposta.status);
      const url = URL.createObjectURL(await risposta.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = im.dataset.nome || 'foto.jpg';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      alert('Non riesco a scaricare la foto: ' + (e.message || e));
    } finally {
      bottone.disabled = false;
      bottone.textContent = prima;
    }
  }

  v.querySelector('.prec').addEventListener('click', e => { e.stopPropagation(); vai(-1); });
  v.querySelector('.succ').addEventListener('click', e => { e.stopPropagation(); vai(1); });
  v.querySelector('.chiudi-foto').addEventListener('click', e => { e.stopPropagation(); chiudiStrato(); });
  v.addEventListener('click', e => { if (e.target === v) chiudiStrato(); });

  v.querySelector('.barra-zoom').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    e.stopPropagation();
    if (b.dataset.scarica === 'una') return scarica(tutte[i], b);
    if (b.dataset.scarica === 'tutte') {
      (async () => { for (const im of tutte) { await scarica(im, b); await new Promise(r => setTimeout(r, 350)); } })();
      return;
    }
    if (b.dataset.zoom === 'piu') zoomA(sc * 1.5);
    else if (b.dataset.zoom === 'meno') zoomA(sc / 1.5);
    else if (b.dataset.zoom === 'adatta') azzera();
    else if (b.dataset.zoom === 'cento') aCento();
  });

  // rotellina, e pizzico del trackpad (che i browser mandano come rotellina con Ctrl)
  v.addEventListener('wheel', e => {
    e.preventDefault();
    // un pizzico vero manda tanti scatti piccoli; una rotellina con Ctrl, uno
    // solo e grosso: si limita, cosi non salta di cinque volte in un colpo
    const delta = e.ctrlKey ? Math.max(-40, Math.min(40, e.deltaY)) : e.deltaY;
    zoomA(sc * Math.exp(-delta * (e.ctrlKey ? 0.012 : 0.0018)), e.clientX, e.clientY);
  }, { passive: false });

  // Safari sul Mac manda il pizzico come "gesture", non come rotellina
  let baseGesto = 1;
  v.addEventListener('gesturestart', e => { e.preventDefault(); baseGesto = sc; });
  v.addEventListener('gesturechange', e => { e.preventDefault(); zoomA(baseGesto * e.scale, e.clientX, e.clientY); });

  // doppio clic: ingrandisce dove si e', o torna a tutta la foto
  foto.addEventListener('dblclick', e => {
    e.stopPropagation();
    if (sc > 1.001) azzera(); else zoomA(2.5, e.clientX, e.clientY);
  });

  // trascinare per spostarsi, solo se ingrandita
  let presa = null;
  foto.addEventListener('pointerdown', e => {
    if (sc <= 1.001 || e.button !== 0) return;
    presa = { x: e.clientX, y: e.clientY, tx, ty };
    foto.setPointerCapture(e.pointerId);
    v.classList.add('trascinando');
  });
  foto.addEventListener('pointermove', e => {
    if (!presa) return;
    tx = presa.tx + (e.clientX - presa.x);
    ty = presa.ty + (e.clientY - presa.y);
    applica();
  });
  const finePresa = () => { presa = null; v.classList.remove('trascinando'); };
  foto.addEventListener('pointerup', finePresa);
  foto.addEventListener('pointercancel', finePresa);
  foto.addEventListener('click', e => e.stopPropagation());   // un clic sulla foto non la chiude

  const tasti = e => {
    if (e.key === 'Escape') { e.stopPropagation(); chiudiStrato(); }
    else if (e.key === 'ArrowLeft') vai(-1);
    else if (e.key === 'ArrowRight') vai(1);
    else if (e.key === '+' || e.key === '=') zoomA(sc * 1.5);
    else if (e.key === '-' || e.key === '_') zoomA(sc / 1.5);
    else if (e.key === '0') azzera();
  };
  document.addEventListener('keydown', tasti, true);
  window.addEventListener('resize', applica);
  document.body.appendChild(v);
  apriStrato(() => {
    v.remove();
    document.removeEventListener('keydown', tasti, true);
    window.removeEventListener('resize', applica);
  });
  mostra();
}


// ------------------------------------------------- foto aggiunte dal desktop
function scegliFoto(pulsante) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.addEventListener('change', async () => {
    if (!input.files.length) return;
    const foto = await preparaFoto([...input.files]);
    if (!foto.length) { alert('Nessuno dei file scelti è una foto che il browser sa aprire.'); return; }
    pannelloFoto(pulsante, foto);
  });
  input.click();
}

const nomeGiorno = d => new Date(d).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });

// Un piccolo pannello al posto del pulsante: dice cosa sta per caricare, lascia
// correggere la data e scrivere una nota, e carica. Le etichette arrivano dai
// nomi dei file e dal censimento: si scrivono sempre come testo, mai come HTML.
function pannelloFoto(pulsante, foto) {
  const zona = pulsante.closest('.aggiungi-foto-zona');
  const lineaId = pulsante.dataset.linea;
  const carr = pulsante.dataset.carr;
  const linea = trovaLinea(lineaId);
  const ids = new Map();                 // lo stesso rilievo se si riprova dopo un errore

  const giorni = new Map();
  foto.forEach(f => giorni.set(aaaammgg(f.data), (giorni.get(aaaammgg(f.data)) || 0) + 1));
  const riassunto = [...giorni].map(([g, n]) => `${n} foto del ${nomeGiorno(g)}`).join(', ');

  const el = (tag, classe, testo) => {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (testo != null) e.textContent = testo;
    return e;
  };
  const p = el('div', 'pannello-foto');
  p.appendChild(el('div', 'titolo-pannello', `${foto.length} foto · linea ${carr}`));
  p.appendChild(el('div', 'riassunto-pannello', riassunto));

  const rigaData = el('label', 'campo-pannello');
  rigaData.appendChild(el('span', '', 'Data'));
  const data = el('input'); data.type = 'date';
  data.title = 'Lasciala vuota per tenere la data di ogni foto';
  rigaData.appendChild(data);
  rigaData.appendChild(el('small', '', giorni.size > 1 ? 'vuota: ogni foto tiene la sua' : 'vuota: quella della foto'));
  p.appendChild(rigaData);

  const rigaNota = el('label', 'campo-pannello');
  rigaNota.appendChild(el('span', '', 'Nota'));
  const nota = el('input'); nota.type = 'text'; nota.placeholder = 'facoltativa';
  rigaNota.appendChild(nota);
  p.appendChild(rigaNota);

  const esito = el('div', 'esito-pannello');
  const azioni = el('div', 'azioni-pannello');
  const carica = el('button', 'carica-foto', `Carica ${foto.length} foto`);
  carica.type = 'button';
  const annulla = el('button', 'annulla-foto', 'Annulla');
  annulla.type = 'button';
  azioni.append(carica, annulla);
  p.append(azioni, esito);

  annulla.addEventListener('click', () => { p.remove(); pulsante.hidden = false; });
  carica.addEventListener('click', async () => {
    carica.disabled = annulla.disabled = true;
    esito.className = 'esito-pannello';
    try {
      const creati = await caricaFotoUfficio({
        lineaId, carreggiata: carr, foto, dataForzata: data.value || null,
        nota: nota.value, autore: emailUtente(), ids,
        avanzamento: (n, tot) => { esito.textContent = `Carico la foto ${n} di ${tot}…`; },
      });
      creati.forEach(r => { r.linea = linea; dati.rilievi.unshift(r); });
      disegna();
      if (alCambio) alCambio();
    } catch (err) {
      esito.className = 'esito-pannello errore';
      esito.textContent = `Non riesco a caricarle: ${String(err.message || err)}. Si puo riprovare.`;
      carica.disabled = annulla.disabled = false;
    }
  });

  pulsante.hidden = true;
  zona.appendChild(p);
}
