// Archivio dei giunti: rilievi con le foto, elenco dei giunti e statistiche.
//
// Al contrario dell'app da campo, qui si legge tutto dal database ogni volta:
// si usa da scrivania, con la rete, e conta vedere il dato aggiornato.

import { autenticato, entra, esci, leggi, urlFirmato } from './rete.js';

const STATI = ['cattive', 'attenzionare', 'buone_datate', 'ottime'];
const NOMI_STATO = {
  ottime: 'Ottime condizioni', buone_datate: 'Buone ma datati',
  attenzionare: 'Da attenzionare', cattive: 'Cattive condizioni',
};
const COLORE = s => `var(--${s || 'nessuno'})`;
const $ = id => document.getElementById(id);

let linee = [];      // il censimento, con carreggiate e corsie
let rilievi = [];    // i rilievi, con foto

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

function strisceCorsie(carreggiate, classe = 'carreggiata-scheda') {
  return carreggiate.map(c => `
    <div class="${classe}">
      <div class="titolo">${c.nome}
        <span>${[c.modello, c.anno].filter(Boolean).join(' · ')}</span></div>
      <div class="strisce">${c.corsie.map(([nome, stato]) => `
        <div class="corsia" style="background:${COLORE(stato)}"
             title="${NOMI_STATO[stato] || 'nessun dato'}">${nome}</div>`).join('')}</div>
    </div>`).join('');
}

let timerAvviso;
function avvisa(testo, tipo = '') {
  const a = $('avviso');
  a.textContent = testo;
  a.className = `avviso visibile ${tipo}`;
  clearTimeout(timerAvviso);
  timerAvviso = setTimeout(() => a.classList.remove('visibile'), 3500);
}

// ------------------------------------------------------------------- dati
async function caricaTutto() {
  const grezze = await leggi('linee?select=id,strada,km,km_m,opera,lat,lon,'
    + 'giunti(carreggiata,km,modello,anno,ordine,corsie(posizione,corsia,stato))'
    + '&order=strada,km_m');
  linee = grezze.map(l => ({
    ...l,
    carreggiate: (l.giunti || []).sort((a, b) => a.ordine - b.ordine).map(g => ({
      nome: g.carreggiata, km: g.km, modello: g.modello, anno: g.anno,
      corsie: (g.corsie || []).sort((a, b) => a.posizione - b.posizione)
        .map(c => [c.corsia, c.stato]),
    })),
  }));

  rilievi = await leggi('rilievi?select=id,linea_id,data,colore,nota,audio_path,'
    + 'lat,lon,creato_il,stati_corsie,foto(id,path)&order=data.desc,creato_il.desc');
  const perId = Object.fromEntries(linee.map(l => [l.id, l]));
  rilievi.forEach(r => { r.linea = perId[r.linea_id]; });
}

// ---------------------------------------------------------------- rilievi
async function disegnaRilievi() {
  $('rilievi-vuoto').hidden = rilievi.length > 0;
  $('rilievi').innerHTML = rilievi.map(r => {
    const l = r.linea;
    return `<article class="scheda-rilievo" data-id="${r.id}">
      <div class="foto" data-foto="${r.foto[0] ? r.foto[0].path : ''}">
        ${r.foto.length ? '' : 'nessuna foto'}
        ${r.foto.length > 1 ? `<span class="altre">${r.foto.length} foto</span>` : ''}
      </div>
      <div class="corpo">
        <div class="opera">${l ? (l.opera || 'Opera non indicata') : 'Linea non trovata'}</div>
        <div class="dove">${l ? `${l.strada} · km ${l.km}` : r.linea_id}</div>
        <div class="riga-stato">${pallino(r.colore)}
          ${NOMI_STATO[r.colore] || 'senza giudizio'}
          <span class="quando">${quandoScritto(r.data)}</span></div>
        ${r.nota ? `<div class="nota">${r.nota}</div>` : ''}
      </div>
    </article>`;
  }).join('');

  // le anteprime arrivano dopo: ogni foto ha bisogno del suo collegamento firmato
  for (const riquadro of document.querySelectorAll('#rilievi .foto[data-foto]')) {
    const percorso = riquadro.dataset.foto;
    if (!percorso) continue;
    try {
      riquadro.style.backgroundImage = `url("${await urlFirmato('foto', percorso)}")`;
      riquadro.textContent = riquadro.querySelector('.altre') ? '' : '';
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
  rilievi.forEach(r => { quanti[r.linea_id] = (quanti[r.linea_id] || 0) + 1; });

  const filtrate = linee.filter(l => {
    if (strada && l.strada !== strada) return false;
    if (cerca && !`${l.opera} ${l.strada} ${l.km}`.toLowerCase().includes(cerca)) return false;
    if (rilevati === 'si' && !quanti[l.id]) return false;
    if (rilevati === 'no' && quanti[l.id]) return false;
    if (stato && !l.carreggiate.some(c => c.corsie.some(([, s]) => s === stato))) return false;
    return true;
  });

  $('conta-giunti').textContent =
    `${filtrate.length} linee su ${linee.length}`;
  $('giunti').innerHTML = filtrate.map(l => `
    <div class="riga-giunto" data-id="${l.id}">
      <span class="km">${l.km}</span>
      <span class="testo">
        <span class="opera">${l.opera || 'Opera non indicata'}</span>
        <span class="strada">${l.strada}</span>
      </span>
      <span class="carreggiate">${l.carreggiate.map(c => `
        <span class="tacche" title="${c.nome}">${c.corsie.map(([, s]) =>
          `<span class="tacca" style="background:${COLORE(s)}"></span>`).join('')}</span>`).join('')}
      </span>
      <span class="quanti">${quanti[l.id]
        ? `${quanti[l.id]} rilievi` : 'mai rilevato'}</span>
    </div>`).join('');
}

// ----------------------------------------------------------------- scheda
async function apriScheda(lineaId) {
  const l = linee.find(x => x.id === lineaId);
  if (!l) return;
  const suoi = rilievi.filter(r => r.linea_id === lineaId);

  $('scheda-corpo').innerHTML = `
    <div class="scheda-testa">
      <h2>${l.opera || 'Opera non indicata'}</h2>
      <div class="dove">${l.strada} · km ${l.km}</div>
    </div>
    <div class="scheda-corpo">
      <h3>Com'è a censimento</h3>
      ${strisceCorsie(l.carreggiate)}
      <h3>Rilievi sul campo ${suoi.length ? `(${suoi.length})` : ''}</h3>
      ${suoi.length ? suoi.map(r => `
        <div class="rilievo-storico" data-rilievo="${r.id}">
          <div class="intestazione">${pallino(r.colore)}
            <b>${NOMI_STATO[r.colore] || 'senza giudizio'}</b>
            <span class="quando">${new Date(r.data).toLocaleDateString('it-IT')}</span></div>
          ${r.nota ? `<div class="nota">${r.nota}</div>` : ''}
          <div class="foto-storico">${r.foto.map(f =>
            `<img data-foto="${f.path}" alt="Foto del rilievo">`).join('')}</div>
          ${r.audio_path ? '<audio controls preload="none"></audio>' : ''}
        </div>`).join('')
        : '<p class="tenue">Nessun rilievo ancora: questa linea è solo a censimento.</p>'}
    </div>`;
  $('scheda').hidden = false;

  for (const img of $('scheda-corpo').querySelectorAll('img[data-foto]')) {
    try { img.src = await urlFirmato('foto', img.dataset.foto); } catch { /* niente */ }
  }
  for (const blocco of $('scheda-corpo').querySelectorAll('.rilievo-storico')) {
    const r = suoi.find(x => x.id === blocco.dataset.rilievo);
    const audio = blocco.querySelector('audio');
    if (audio && r.audio_path) {
      try { audio.src = await urlFirmato('audio', r.audio_path); } catch { /* niente */ }
    }
  }
}

// ----------------------------------------------------------- statistiche
function disegnaStatistiche() {
  const corsie = linee.flatMap(l => l.carreggiate.flatMap(c => c.corsie.map(([, s]) => s)));
  const conta = s => corsie.filter(x => x === s).length;
  const totale = corsie.length;
  const conRilievo = new Set(rilievi.map(r => r.linea_id)).size;
  const foto = rilievi.reduce((n, r) => n + r.foto.length, 0);

  const perTratta = {};
  linee.forEach(l => {
    const t = perTratta[l.strada] || (perTratta[l.strada] = { linee: 0, critiche: 0, rilevate: 0 });
    t.linee++;
    l.carreggiate.forEach(c => c.corsie.forEach(([, s]) => {
      if (s === 'cattive' || s === 'attenzionare') t.critiche++;
    }));
  });
  rilievi.forEach(r => { if (r.linea && perTratta[r.linea.strada]) perTratta[r.linea.strada].rilevate++; });

  $('statistiche').innerHTML = `
    <div class="tessere">
      ${[['linee di giunto', linee.length], ['già rilevate', conRilievo],
         ['rilievi fatti', rilievi.length], ['foto in archivio', foto],
         ['tratti di corsia', totale]]
        .map(([e, n]) => `<div class="tessera"><div class="n">${n}</div><div class="e">${e}</div></div>`)
        .join('')}
    </div>

    <h3>Stato di conservazione a censimento</h3>
    <div class="barra">${STATI.map(s => {
      const n = conta(s);
      return n ? `<span style="width:${n / totale * 100}%;background:${COLORE(s)}"
                        title="${NOMI_STATO[s]}: ${n}"></span>` : '';
    }).join('')}</div>
    <table class="statistiche"><tbody>
      ${STATI.map(s => `<tr><td>${pallino(s)} ${NOMI_STATO[s]}</td>
        <td class="num">${conta(s)}</td>
        <td class="num">${(conta(s) / totale * 100).toFixed(1)}%</td></tr>`).join('')}
    </tbody></table>

    <h3>Per tratta</h3>
    <table class="statistiche">
      <thead><tr><th>tratta</th><th class="num">linee</th>
        <th class="num">corsie critiche</th><th class="num">rilievi</th></tr></thead>
      <tbody>${Object.entries(perTratta).sort((a, b) => b[1].linee - a[1].linee)
        .map(([nome, t]) => `<tr><td>${nome}</td><td class="num">${t.linee}</td>
          <td class="num">${t.critiche}</td><td class="num">${t.rilevate}</td></tr>`).join('')}
      </tbody>
    </table>`;
}

// -------------------------------------------------------------- l'insieme
function mostraSezione(nome) {
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('attiva', t.dataset.sezione === nome));
  document.querySelectorAll('.sezione').forEach(s =>
    s.classList.toggle('attiva', s.id === `sez-${nome}`));
}

async function apriArchivio() {
  document.querySelectorAll('.schermata').forEach(s =>
    s.classList.toggle('attiva', s.id === 's-archivio'));
  try {
    await caricaTutto();
  } catch (e) {
    avvisa('Non riesco a leggere l\'archivio: ' + String(e.message || e), 'male');
    return;
  }
  [...new Set(linee.map(l => l.strada))].sort()
    .forEach(s => $('f-strada').add(new Option(s, s)));
  $('sottotitolo').textContent =
    `${linee.length} linee di giunto · ${rilievi.length} rilievi`;
  disegnaRilievi();
  disegnaGiunti();
  disegnaStatistiche();
}

function collega() {
  document.querySelectorAll('.tab').forEach(t =>
    t.addEventListener('click', () => mostraSezione(t.dataset.sezione)));
  ['f-strada', 'f-stato', 'f-rilevati'].forEach(id =>
    $(id).addEventListener('change', disegnaGiunti));
  $('f-cerca').addEventListener('input', disegnaGiunti);

  $('giunti').addEventListener('click', e => {
    const r = e.target.closest('.riga-giunto');
    if (r) apriScheda(r.dataset.id);
  });
  $('rilievi').addEventListener('click', e => {
    const s = e.target.closest('.scheda-rilievo');
    if (!s) return;
    const r = rilievi.find(x => x.id === s.dataset.id);
    if (r) apriScheda(r.linea_id);
  });
  $('b-chiudi-scheda').addEventListener('click', () => { $('scheda').hidden = true; });
  $('scheda').addEventListener('click', e => {
    if (e.target === $('scheda')) $('scheda').hidden = true;
  });

  // una foto si apre a piena pagina con un clic
  document.addEventListener('click', e => {
    const img = e.target.closest('.foto-storico img');
    if (!img || !img.src) return;
    const v = document.createElement('div');
    v.className = 'ingrandita';
    v.innerHTML = `<img src="${img.src}" alt="">`;
    v.addEventListener('click', () => v.remove());
    document.body.appendChild(v);
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
