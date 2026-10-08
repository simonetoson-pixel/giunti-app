// Rimettere i giunti al loro posto sull'ortofoto.
//
// Le coordinate del censimento nascono interpolando la chilometrica sul grafo
// CAV, che è una linea sola: cadono sull'asse della strada, non sulla
// carreggiata. Qui si trascina il punto dove il giunto sta davvero, e la
// correzione viene salvata a parte — così un ricaricamento del censimento non
// la porta via.

import { autenticato, entra, leggi, chiama, leggiTutto } from './rete.js';

const $ = id => document.getElementById(id);
let linee = [];            // censimento, con la posizione calcolata
let corrette = {};         // linea_id -> {lat, lon, scarto_m}
let scostiCarr = {};       // linea_id -> [{carreggiata, dlat, dlon}]: dove stanno le carreggiate rispetto all'asse
let mappa, marcatori = {}, scelto = null, fantasmi = null;

// ------------------------------------------------------------------ utili
function metri(lat1, lon1, lat2, lon2) {
  const dy = (lat2 - lat1) * 110574;
  const dx = (lon2 - lon1) * 111320 * Math.cos((lat1 + lat2) / 2 * Math.PI / 180);
  return Math.hypot(dx, dy);
}

let timerAvviso;
function avvisa(testo, tipo = '') {
  const a = $('avviso');
  a.textContent = testo;
  a.className = `avviso visibile ${tipo}`;
  clearTimeout(timerAvviso);
  timerAvviso = setTimeout(() => a.classList.remove('visibile'), 3000);
}

// ------------------------------------------------------------------ mappa
function preparaMappa() {
  mappa = L.map('mappa').setView([45.45, 11.3], 9);

  const esri = s => L.tileLayer(
    `https://server.arcgisonline.com/ArcGIS/rest/services/${s}/MapServer/tile/{z}/{y}/{x}`,
    { maxZoom: 19, attribution: 'Tiles &copy; Esri' });

  // L'ortofoto regionale è quella che serve davvero qui: una ventina di
  // centimetri di risoluzione, e georeferenziata da chi l'ha prodotta.
  const veneto = L.tileLayer.wms(
    'https://idt2-geoserver.regione.veneto.it/geoserver/wms',
    { layers: 'rv:ortofoto_agea_2024', format: 'image/jpeg', version: '1.3.0',
      maxZoom: 21, attribution: 'Ortofoto AGEA 2024 &mdash; Regione del Veneto' });

  const sfondi = {
    'Ortofoto Veneto 2024': veneto,
    'Satellite': esri('World_Imagery'),
    'Stradale': esri('World_Street_Map'),
  };
  veneto.addTo(mappa);
  L.control.layers(sfondi, null, { position: 'topright' }).addTo(mappa);
}

function posizione(l) {
  const c = corrette[l.id];
  return c ? [c.lat, c.lon] : [l.lat, l.lon];
}

// Il pallino che si vede e' lo stesso che si trascina. Prima il pallino era un
// cerchio e sopra c'era un segnaposto invisibile con la sua forma da spillo,
// ancorato in basso: la zona in cui si poteva afferrare stava sopra il pallino,
// non su di lui, e prenderlo nella metà inferiore trascinava la mappa.
function icona(corretta, scelta) {
  return L.divIcon({
    className: 'punto-giunto' + (corretta ? ' corretta' : '') + (scelta ? ' scelto' : ''),
    iconSize: [26, 26], iconAnchor: [13, 13],
  });
}

function disegnaMarcatori() {
  Object.values(marcatori).forEach(m => {
    mappa.removeLayer(m.punto);
    if (m.calcolato) mappa.removeLayer(m.calcolato);
  });
  marcatori = {};

  const strada = $('f-strada').value;
  for (const l of linee.filter(x => !strada || x.strada === strada)) {
    const [lat, lon] = posizione(l);
    const corretta = !!corrette[l.id];

    const punto = L.marker([lat, lon], {
      draggable: true, icon: icona(corretta, l.id === scelto),
      title: `${l.opera || ''} · km ${l.km}`.trim(),
    }).addTo(mappa);
    punto.on('click', () => scegli(l.id));
    punto.on('dragstart', () => scegli(l.id));
    punto.on('drag', e => mostraFantasmi(l, e.target.getLatLng()));
    punto.on('dragend', e => salva(l, e.target.getLatLng()));

    // dove cadeva il calcolo, per vedere di quanto ci si è spostati
    let calcolato = null;
    if (corretta) {
      calcolato = L.circleMarker([l.lat, l.lon], {
        radius: 4, weight: 1, color: '#fff', fillColor: '#8a8f94',
        fillOpacity: .8, className: 'calcolato', interactive: false,
      }).addTo(mappa);
    }
    marcatori[l.id] = { punto, calcolato };
  }
  if (scelto) mostraFantasmi(linee.find(x => x.id === scelto));
}

// Le due carreggiate, dove l'app le considera: il punto della linea piu lo
// scostamento che il censimento da a ciascuna. Si vedono per la linea scelta e
// si muovono insieme al punto: cosi si controlla che cadano sulla carreggiata
// giusta, che e' cio' su cui l'app si basa per capire da che lato ci si trova.
function mostraFantasmi(l, centro) {
  if (fantasmi) { mappa.removeLayer(fantasmi); fantasmi = null; }
  if (!l) return;
  const [lat0, lon0] = centro ? [centro.lat, centro.lng] : posizione(l);
  fantasmi = L.layerGroup().addTo(mappa);
  for (const c of scostiCarr[l.id] || []) {
    if (!c.dlat && !c.dlon) continue;
    L.circleMarker([lat0 + c.dlat, lon0 + c.dlon], {
      radius: 6, weight: 2, color: '#fff', fillColor: '#1B4B6B', fillOpacity: .95,
      interactive: false,
    }).bindTooltip(c.carreggiata, { permanent: true, direction: 'top', offset: [0, -6],
      className: 'etichetta-carr' }).addTo(fantasmi);
  }
}

// ------------------------------------------------------------- salvataggio
async function salva(l, latlng) {
  const scarto = metri(l.lat, l.lon, latlng.lat, latlng.lng);
  try {
    await chiama('/rest/v1/posizioni?on_conflict=linea_id', {
      method: 'POST',
      body: JSON.stringify({
        linea_id: l.id, lat: latlng.lat, lon: latlng.lng,
        scarto_m: Math.round(scarto * 10) / 10,
      }),
      headers: { 'Content-Type': 'application/json',
                 Prefer: 'resolution=merge-duplicates,return=minimal' },
    });
    corrette[l.id] = { lat: latlng.lat, lon: latlng.lng, scarto_m: scarto };
    avvisa(`Spostato di ${Math.round(scarto)} m`, 'buono');
    disegnaMarcatori();
    disegnaElenco();
    aggiornaStato();
    scegli(l.id);
  } catch (e) {
    avvisa('Non riesco a salvare: ' + String(e.message || e), 'male');
    disegnaMarcatori();
  }
}

// Il punto scelto va dove sta il mirino, cioe' al centro della mappa. Si
// sposta la mappa finche' il mirino e' sul giunto, e si preme. Con un trackpad e'
// molto piu facile che trascinare un pallino piccolo con la precisione che serve.
function portaQui() {
  const l = linee.find(x => x.id === scelto);
  if (!l) return;
  salva(l, mappa.getCenter());
}

async function rimetti(id) {
  try {
    await chiama(`/rest/v1/posizioni?linea_id=eq.${encodeURIComponent(id)}`,
                 { method: 'DELETE' });
    delete corrette[id];
    avvisa('Tornato alla posizione calcolata');
    disegnaMarcatori();
    disegnaElenco();
    aggiornaStato();
    scegli(id);
  } catch (e) {
    avvisa('Non riesco ad annullare: ' + String(e.message || e), 'male');
  }
}

// -------------------------------------------------------------- selezione
function scegli(id) {
  const prima = scelto;
  scelto = id;
  const l = linee.find(x => x.id === id);
  if (!l) return;
  const c = corrette[id];
  // evidenzia il punto scelto senza ridisegnare tutto (ridisegnare durante un
  // trascinamento lo interromperebbe)
  [prima, id].forEach(k => {
    const m = marcatori[k];
    const el = m && m.punto.getElement();
    if (el) el.classList.toggle('scelto', k === id);
  });
  mostraFantasmi(l);
  $('mirino').hidden = false;
  $('barra').hidden = false;
  $('sel-opera').textContent = l.opera || 'Opera non indicata';
  $('sel-dove').textContent = `${l.strada} · km ${l.km}`;
  $('sel-scarto').textContent = c && c.scarto_m ? `spostato di ${Math.round(c.scarto_m)} m` : '';
  $('b-annulla').hidden = !c;
  disegnaElenco();
}

function disegnaElenco() {
  const strada = $('f-strada').value;
  $('elenco').innerHTML = linee
    .filter(l => !strada || l.strada === strada)
    .map(l => `<div class="voce-linea${corrette[l.id] ? ' corretta' : ''}${l.id === scelto ? ' scelta' : ''}"
                    data-id="${l.id}">
      <span class="segno"></span>
      <span class="km">${l.km}</span>
      <span class="nome">${l.opera || 'Opera non indicata'}</span>
    </div>`).join('');
}

function aggiornaStato() {
  const n = Object.keys(corrette).length;
  const scarti = Object.values(corrette).map(c => c.scarto_m).filter(Boolean);
  const medio = scarti.length
    ? Math.round(scarti.reduce((a, b) => a + b, 0) / scarti.length) : 0;
  $('stato').innerHTML = `<b>${n}</b> posizioni corrette su ${linee.length}`
    + (scarti.length ? `<br>spostamento medio <b>${medio} m</b>` : '');
}

function vaiA(id) {
  const l = linee.find(x => x.id === id);
  if (!l) return;
  mappa.setView(posizione(l), Math.max(mappa.getZoom(), 19));
  scegli(id);
}

// ----------------------------------------------------------------- avvio
async function apri() {
  document.querySelectorAll('.schermata').forEach(s =>
    s.classList.toggle('attiva', s.id === 's-lavoro'));
  preparaMappa();

  linee = await leggiTutto('linee?select=id,strada,km,km_m,opera,lat,lon&order=strada,km_m,id');
  const righe = await leggiTutto('posizioni?select=linea_id,lat,lon,scarto_m&order=linea_id');
  corrette = Object.fromEntries(righe.map(r => [r.linea_id, r]));

  // dove sta ogni carreggiata rispetto al punto calcolato della sua linea
  const perId = Object.fromEntries(linee.map(l => [l.id, l]));
  try {
    const giunti = await leggiTutto('giunti?select=linea_id,carreggiata,lat,lon&order=linea_id,carreggiata');
    for (const g of giunti) {
      const l = perId[g.linea_id];
      if (!l || g.lat == null) continue;
      (scostiCarr[g.linea_id] ||= []).push(
        { carreggiata: g.carreggiata, dlat: g.lat - l.lat, dlon: g.lon - l.lon });
    }
  } catch { /* senza, si vedono solo i punti delle linee */ }

  const strade = [...new Set(linee.map(l => l.strada))].sort();
  $('f-strada').innerHTML = '<option value="">Tutte le tratte</option>'
    + strade.map(s => `<option value="${s}">${s}</option>`).join('');

  disegnaMarcatori();
  disegnaElenco();
  aggiornaStato();
  mappa.fitBounds(linee.map(posizione), { padding: [30, 30] });
}

function collega() {
  $('f-strada').addEventListener('change', () => {
    disegnaMarcatori();
    disegnaElenco();
    const visibili = linee.filter(l => !$('f-strada').value || l.strada === $('f-strada').value);
    if (visibili.length) mappa.fitBounds(visibili.map(posizione), { padding: [30, 30] });
  });
  $('elenco').addEventListener('click', e => {
    const v = e.target.closest('.voce-linea');
    if (v) vaiA(v.dataset.id);
  });
  $('b-annulla').addEventListener('click', () => scelto && rimetti(scelto));
  $('b-qui').addEventListener('click', portaQui);
  // Invio fa lo stesso, a meno di non essere dentro a un campo di testo
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && scelto && !/INPUT|SELECT|TEXTAREA|BUTTON/.test(document.activeElement.tagName)) portaQui();
  });

  $('modulo-accesso').addEventListener('submit', async e => {
    e.preventDefault();
    $('b-entra').disabled = true;
    $('errore-accesso').hidden = true;
    try {
      await entra($('email').value.trim(), $('password').value);
      $('password').value = '';
      await apri();
    } catch (err) {
      $('errore-accesso').textContent = String(err.message || err);
      $('errore-accesso').hidden = false;
    } finally { $('b-entra').disabled = false; }
  });
}

collega();
if (autenticato()) apri();
