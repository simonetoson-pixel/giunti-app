// Rimettere i giunti al loro posto sull'ortofoto.
//
// Le coordinate del censimento nascono interpolando la chilometrica sul grafo
// CAV, che è una linea sola: cadono sull'asse della strada, non sulla
// carreggiata. Qui si trascina il punto dove il giunto sta davvero, e la
// correzione viene salvata a parte — così un ricaricamento del censimento non
// la porta via.

import { autenticato, entra, leggi, chiama } from './rete.js';

const $ = id => document.getElementById(id);
let linee = [];            // censimento, con la posizione calcolata
let corrette = {};         // linea_id -> {lat, lon, scarto_m}
let mappa, strato, marcatori = {}, scelto = null;

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

    const punto = L.circleMarker([lat, lon], {
      radius: 7, weight: 2, color: '#fff',
      fillColor: corretta ? '#2E7D4E' : '#d98c00', fillOpacity: 1,
    }).addTo(mappa);
    punto.on('click', () => scegli(l.id));

    // un secondo punto, trascinabile, sopra il primo
    const maniglia = L.marker([lat, lon], { draggable: true, opacity: 0 }).addTo(mappa);
    maniglia.on('dragstart', () => scegli(l.id));
    maniglia.on('drag', e => punto.setLatLng(e.target.getLatLng()));
    maniglia.on('dragend', e => salva(l, e.target.getLatLng()));

    // dove cadeva il calcolo, per vedere di quanto ci si è spostati
    let calcolato = null;
    if (corretta) {
      calcolato = L.circleMarker([l.lat, l.lon], {
        radius: 4, weight: 1, color: '#fff', fillColor: '#8a8f94',
        fillOpacity: .8, className: 'calcolato', interactive: false,
      }).addTo(mappa);
    }
    marcatori[l.id] = { punto, maniglia, calcolato };
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
  scelto = id;
  const l = linee.find(x => x.id === id);
  if (!l) return;
  const c = corrette[id];
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

  linee = await leggi('linee?select=id,strada,km,km_m,opera,lat,lon&order=strada,km_m');
  const righe = await leggi('posizioni?select=linea_id,lat,lon,scarto_m');
  corrette = Object.fromEntries(righe.map(r => [r.linea_id, r]));

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
