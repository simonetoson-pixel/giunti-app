// L'archivio da scrivania.
//
// Si apre sulla mappa reale, perché è così che si guarda una rete: dove sono
// i giunti messi peggio. Da lì si entra nel ponte, e dal ponte in tutto il
// resto. Le altre linguette sono modi diversi di guardare le stesse cose:
// lo schema come nei fogli Excel, i rilievi in ordine di tempo, l'elenco
// filtrabile e i numeri d'insieme.

import { autenticato, entra, esci, urlFirmato } from './rete.js';
import {
  dati, carica, STATI, NOMI_STATO, COLORE, statoLinea, statoGiunto,
} from './dati-ufficio.js';
import * as mappa from './mappa-ufficio.js';
import * as schema from './schema-ufficio.js';
import { apriPonte, chiudi as chiudiScheda, quandoCambia } from './scheda-ufficio.js';

const $ = id => document.getElementById(id);

// ------------------------------------------------------------------ utili
function quandoScritto(data) {
  const giorni = Math.round((Date.now() - new Date(data)) / 86400000);
  if (giorni === 0) return 'oggi';
  if (giorni === 1) return 'ieri';
  if (giorni < 30) return `${giorni} giorni fa`;
  return new Date(data).toLocaleDateString('it-IT',
    { day: 'numeric', month: 'short', year: 'numeric' });
}

function pallino(stato) {
  return `<span class="pallino" style="background:${COLORE(stato)}"></span>`;
}

function fuga(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

let timerAvviso;
function avvisa(testo, tipo = '') {
  const a = $('avviso');
  a.textContent = testo;
  a.className = `avviso visibile ${tipo}`;
  clearTimeout(timerAvviso);
  timerAvviso = setTimeout(() => a.classList.remove('visibile'), 3500);
}

// ---------------------------------------------------------------- rilievi
async function disegnaRilievi() {
  $('rilievi-vuoto').hidden = dati.rilievi.length > 0;
  $('rilievi').innerHTML = dati.rilievi.map(r => {
    const l = r.linea;
    return `<article class="scheda-rilievo" data-id="${fuga(r.id)}">
      <div class="foto" data-foto="${r.foto[0] ? fuga(r.foto[0].path) : ''}">
        ${r.foto.length ? '' : 'nessuna foto'}
        ${r.foto.length > 1 ? `<span class="altre">${r.foto.length} foto</span>` : ''}
      </div>
      <div class="corpo">
        <div class="opera">${l ? fuga(l.opera || 'Opera non indicata') : 'Linea non trovata'}</div>
        <div class="dove">${l ? `${fuga(l.strada)} · km ${l.km}` : fuga(r.linea_id)}${
  r.carreggiata ? ` · ${fuga(r.carreggiata)}` : ''}</div>
        <div class="riga-stato">${pallino(r.colore)}
          ${NOMI_STATO[r.colore] || 'senza giudizio'}
          <span class="quando">${quandoScritto(r.data)}</span></div>
        ${r.nota ? `<div class="nota">${fuga(r.nota)}</div>` : ''}
      </div>
    </article>`;
  }).join('');

  // le anteprime arrivano dopo: ogni foto ha bisogno del suo collegamento firmato
  for (const riquadro of document.querySelectorAll('#rilievi .foto[data-foto]')) {
    const percorso = riquadro.dataset.foto;
    if (!percorso) continue;
    try {
      riquadro.style.backgroundImage = `url("${await urlFirmato('foto', percorso)}")`;
    } catch { /* se una foto non si carica, resta il riquadro scuro */ }
  }
}

// ----------------------------------------------------------------- giunti
function disegnaGiunti() {
  const strada = $('f-strada').value;
  const stato = $('f-stato').value;
  const rilevati = $('f-rilevati').value;
  const cerca = $('f-cerca').value.trim().toLowerCase();

  const quanti = {};
  dati.rilievi.forEach(r => { quanti[r.linea_id] = (quanti[r.linea_id] || 0) + 1; });

  const filtrate = dati.linee.filter(l => {
    if (strada && l.strada !== strada) return false;
    if (cerca && !`${l.opera} ${l.strada} ${l.km}`.toLowerCase().includes(cerca)) return false;
    if (rilevati === 'si' && !quanti[l.id]) return false;
    if (rilevati === 'no' && quanti[l.id]) return false;
    if (stato && statoLinea(l) !== stato) return false;
    return true;
  });

  $('conta-giunti').textContent = `${filtrate.length} linee su ${dati.linee.length}`;
  $('giunti').innerHTML = filtrate.map(l => `
    <div class="riga-giunto" data-id="${fuga(l.id)}">
      <span class="km">${l.km}</span>
      <span class="testo">
        <span class="opera">${fuga(l.opera || 'Opera non indicata')}</span>
        <span class="strada">${fuga(l.strada)}</span>
      </span>
      <span class="carreggiate">${l.carreggiate.map(g => `
        <span class="tacche" title="${fuga(g.carreggiata)}">
          <span class="quale">${fuga(g.carreggiata[0])}</span>${g.corsie.map(c =>
    `<span class="tacca" style="background:${COLORE(c.stato)}"></span>`).join('')}</span>`).join('')}
      </span>
      <span class="quanti">${quanti[l.id] ? `${quanti[l.id]} rilievi` : 'mai rilevato'}</span>
    </div>`).join('');
}

// ----------------------------------------------------------- statistiche
// Si contano i giunti, non i tratti di corsia: il numero di corsie non è un
// dato significativo — in A4 sono tre più l'emergenza, altrove due — mentre
// un giunto è la cosa che si sostituisce. Ogni giunto vale quanto la sua
// corsia peggiore.
function disegnaStatistiche() {
  const giunti = dati.linee.flatMap(l => l.carreggiate);
  const stati = giunti.map(statoGiunto);
  const conta = s => stati.filter(x => x === s).length;
  const totale = giunti.length;
  const conRilievo = new Set(dati.rilievi.map(r => r.linea_id)).size;
  const foto = dati.rilievi.reduce((n, r) => n + r.foto.length, 0);

  // per strada, non per foglio: l'A31 nel censimento sta su due fogli ma è
  // un'autostrada sola
  const perTratta = {};
  dati.linee.forEach(l => {
    const t = perTratta[l.strada] || (perTratta[l.strada] = {
      linee: 0, giunti: 0, critici: 0, rilevate: 0, opere: new Set(),
    });
    t.linee++;
    t.opere.add(l.opera || '—');
    l.carreggiate.forEach(g => {
      t.giunti++;
      const s = statoGiunto(g);
      if (s === 'cattive' || s === 'attenzionare') t.critici++;
    });
  });
  dati.rilievi.forEach(r => {
    if (r.linea && perTratta[r.linea.strada]) perTratta[r.linea.strada].rilevate++;
  });

  // quanto è vecchio il parco giunti
  const anni = {};
  giunti.forEach(g => { if (g.anno) anni[g.anno] = (anni[g.anno] || 0) + 1; });
  const elencoAnni = Object.keys(anni).map(Number).sort((a, b) => a - b);
  const massimo = Math.max(1, ...Object.values(anni));

  // i modelli, ora che i nomi sono uniformati
  const modelli = {};
  giunti.forEach(g => {
    if (g.modello) modelli[g.modello] = (modelli[g.modello] || 0) + 1;
  });
  const piuDiffusi = Object.entries(modelli).sort((a, b) => b[1] - a[1]).slice(0, 12);

  $('statistiche').innerHTML = `
    <div class="tessere">
      ${[['linee di giunto', dati.linee.length],
    ['giunti (linea × carreggiata)', totale],
    ['già rilevate sul campo', conRilievo],
    ['rilievi fatti', dati.rilievi.length],
    ['foto in archivio', foto]]
    .map(([e, n]) => `<div class="tessera"><div class="n">${n}</div><div class="e">${e}</div></div>`)
    .join('')}
    </div>

    <h3>Stato di conservazione</h3>
    <div class="barra">${STATI.map(s => {
    const n = conta(s);
    return n ? `<span style="width:${n / totale * 100}%;background:${COLORE(s)}"
                      title="${NOMI_STATO[s]}: ${n}"></span>` : '';
  }).join('')}</div>
    <table class="statistiche"><tbody>
      ${STATI.map(s => `<tr><td>${pallino(s)} ${NOMI_STATO[s]}</td>
        <td class="num">${conta(s)}</td>
        <td class="num">${(conta(s) / totale * 100).toFixed(1)}%</td></tr>`).join('')}
      ${conta(null) ? `<tr><td>${pallino(null)} nessun dato</td>
        <td class="num">${conta(null)}</td>
        <td class="num">${(conta(null) / totale * 100).toFixed(1)}%</td></tr>` : ''}
    </tbody></table>
    <p class="tenue" style="font-size:12.5px">Ogni giunto vale quanto la sua corsia
      peggiore: una corsia in cattive condizioni fa cattivo tutto il giunto.</p>

    <h3>Per tratta</h3>
    <table class="statistiche">
      <thead><tr><th>tratta</th><th class="num">opere</th><th class="num">linee</th>
        <th class="num">giunti</th><th class="num">da sostituire</th>
        <th class="num">rilievi</th></tr></thead>
      <tbody>${Object.entries(perTratta).sort((a, b) => b[1].linee - a[1].linee)
    .map(([nome, t]) => `<tr><td>${fuga(nome)}</td>
          <td class="num">${t.opere.size}</td><td class="num">${t.linee}</td>
          <td class="num">${t.giunti}</td><td class="num">${t.critici}</td>
          <td class="num">${t.rilevate}</td></tr>`).join('')}
      </tbody>
    </table>

    <h3>Anno di posa</h3>
    ${elencoAnni.length ? `<div class="istogramma">${elencoAnni.map(a => `
      <div class="col" title="${a}: ${anni[a]} giunti">
        <span class="v">${anni[a]}</span>
        <span class="b" style="height:${anni[a] / massimo * 110}px"></span>
        <span class="a">${String(a).slice(2)}</span>
      </div>`).join('')}</div>` : '<p class="tenue">Nessun anno indicato.</p>'}

    <h3>Modelli più diffusi</h3>
    <table class="statistiche"><tbody>
      ${piuDiffusi.map(([nome, n]) =>
    `<tr><td>${fuga(nome)}</td><td class="num">${n}</td></tr>`).join('')}
    </tbody></table>`;
}

// -------------------------------------------------------------- l'insieme
function mostraSezione(nome) {
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('attiva', t.dataset.sezione === nome));
  document.querySelectorAll('.sezione').forEach(s =>
    s.classList.toggle('attiva', s.id === `sez-${nome}`));
  // la mappa prende tutta l'altezza e non vuole margini attorno
  document.querySelector('main').classList.toggle('senza-margini', nome === 'mappa');
  if (nome === 'mappa') mappa.risveglia();
}

function ridisegnaTutto() {
  disegnaGiunti();
  disegnaStatistiche();
  schema.prepara();
}

async function apriArchivio() {
  document.querySelectorAll('.schermata').forEach(s =>
    s.classList.toggle('attiva', s.id === 's-archivio'));
  try {
    await carica();
  } catch (e) {
    avvisa('Non riesco a leggere l\'archivio: ' + String(e.message || e), 'male');
    return;
  }
  [...new Set(dati.linee.map(l => l.strada))].sort()
    .forEach(s => $('f-strada').add(new Option(s, s)));
  $('sottotitolo').textContent =
    `${dati.linee.length} linee di giunto · ${dati.rilievi.length} rilievi`;

  if (!dati.conCorrezioni) {
    avvisa('Le tabelle dell\'ufficio non ci sono ancora: lancia scripts/ufficio.sql '
      + 'su Supabase per poter correggere lo schema e scrivere commenti');
  }

  disegnaRilievi();
  ridisegnaTutto();
  mappa.prepara();
  quandoCambia(ridisegnaTutto);
}

function collega() {
  document.querySelectorAll('.tab').forEach(t =>
    t.addEventListener('click', () => mostraSezione(t.dataset.sezione)));
  ['f-strada', 'f-stato', 'f-rilevati'].forEach(id =>
    $(id).addEventListener('change', disegnaGiunti));
  $('f-cerca').addEventListener('input', disegnaGiunti);

  $('giunti').addEventListener('click', e => {
    const r = e.target.closest('.riga-giunto');
    if (r) apriPonte(r.dataset.id);
  });
  $('rilievi').addEventListener('click', e => {
    const s = e.target.closest('.scheda-rilievo');
    if (!s) return;
    const r = dati.rilievi.find(x => x.id === s.dataset.id);
    if (r) apriPonte(r.linea_id);
  });
  $('b-chiudi-scheda').addEventListener('click', chiudiScheda);
  $('scheda').addEventListener('click', e => {
    if (e.target === $('scheda')) chiudiScheda();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('scheda').hidden
        && !document.querySelector('.ingrandita')) chiudiScheda();
  });

  $('modulo-accesso').addEventListener('submit', async e => {
    e.preventDefault();
    $('b-entra').disabled = true;
    $('errore-accesso').hidden = true;
    try {
      await entra($('email').value.trim(), $('password').value);
      $('password').value = '';
      await apriArchivio();
    } catch (err) {
      $('errore-accesso').textContent = String(err.message || err);
      $('errore-accesso').hidden = false;
    } finally { $('b-entra').disabled = false; }
  });
  $('b-esci').addEventListener('click', () => {
    esci();
    location.reload();
  });
}

collega();
if (autenticato()) apriArchivio();

// per saltare dallo schema al puntino sulla mappa
window.vaiSullaMappa = id => { mostraSezione('mappa'); mappa.vaiA(id); };
