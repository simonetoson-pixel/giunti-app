// La mappa reale: è la pagina con cui si apre l'archivio.
//
// Ogni puntino è una linea di giunto, col colore del suo stato peggiore —
// l'ultimo giudizio dato sul campo se c'è, altrimenti quello del censimento.
// Cliccandolo non si apre la singola linea ma tutto il ponte, con quella
// evidenziata.

import { dati, COLORE, NOMI_STATO, statoLinea, ultimoGiudizio } from './dati-ufficio.js';
import { apriPonte } from './scheda-ufficio.js';

const COLORI = {
  ottime: '#92D050', buone_datate: '#00B050',
  attenzionare: '#FFC000', cattive: '#FF5050', null: '#C9C6BA',
};

let mappa = null;
let strato = null;
const marcatori = new Map();   // linea_id -> cerchio

// Lo sfondo: le tile di OpenStreetMap vengono respinte fuori dal loro
// dominio e quelle di CARTO ora vogliono una chiave. Esri funziona senza
// registrazione. L'ortofoto regionale del Veneto (AGEA 2024, una ventina di
// centimetri) è la più precisa che si possa avere qui e copre tutto tranne
// il tratto bresciano, che è in Lombardia.
function sfondi() {
  const esri = servizio => L.tileLayer(
    `https://server.arcgisonline.com/ArcGIS/rest/services/${servizio}/MapServer/tile/{z}/{y}/{x}`,
    { maxZoom: 19, attribution: 'Tiles &copy; Esri' });
  return {
    'Stradale': esri('World_Street_Map'),
    'Chiara': esri('Canvas/World_Light_Gray_Base'),
    'Satellite': esri('World_Imagery'),
    'Ortofoto Veneto 2024': L.tileLayer.wms(
      'https://idt2-geoserver.regione.veneto.it/geoserver/wms',
      {
        layers: 'rv:ortofoto_agea_2024', format: 'image/jpeg', version: '1.3.0',
        transparent: false, maxZoom: 21,
        attribution: 'Ortofoto AGEA 2024 &mdash; Regione del Veneto',
      }),
  };
}

export function prepara() {
  if (mappa) return;
  mappa = L.map('mappa', { zoomControl: true }).setView([45.45, 11.3], 9);
  const s = sfondi();
  s['Stradale'].addTo(mappa);
  L.control.layers(s, null, { position: 'topright' }).addTo(mappa);
  strato = L.layerGroup().addTo(mappa);

  const sel = document.getElementById('m-strada');
  [...new Set(dati.linee.map(l => l.strada))].sort()
    .forEach(x => sel.add(new Option(x, x)));

  ['m-strada', 'm-stato', 'm-rilevate'].forEach(id =>
    document.getElementById(id).addEventListener('change', disegna));

  disegna();

  // Leaflet misura il contenitore una volta sola, quando lo si crea: se in
  // quel momento il layout non e' ancora assestato — o la sezione e'
  // nascosta — le tile coprono solo un rettangolo al centro. Va rimisurato.
  risveglia();
  new ResizeObserver(() => mappa.invalidateSize())
    .observe(document.getElementById('mappa'));
}

// La mappa si accorge di essere stata disegnata mentre era nascosta solo se
// glielo si dice: senza questo, cambiando linguetta, resta un quadrato grigio.
export function risveglia() {
  if (!mappa) return;
  requestAnimationFrame(() => mappa.invalidateSize());
  setTimeout(() => mappa.invalidateSize(), 120);
}

function filtrate() {
  const strada = document.getElementById('m-strada').value;
  const stato = document.getElementById('m-stato').value;
  const rilevate = document.getElementById('m-rilevate').value;
  return dati.linee.filter(l => {
    if (!l.lat || !l.lon) return false;
    if (strada && l.strada !== strada) return false;
    if (stato && colore(l) !== stato) return false;
    const giudizio = ultimoGiudizio(l.id);
    if (rilevate === 'si' && !giudizio) return false;
    if (rilevate === 'no' && giudizio) return false;
    return true;
  });
}

// Il colore del puntino: l'ultimo giudizio dal campo vince sul censimento,
// perché è più recente e l'ha dato un occhio umano davanti al giunto.
function colore(l) {
  const giudizio = ultimoGiudizio(l.id);
  return giudizio ? giudizio.colore : statoLinea(l);
}

function disegna() {
  strato.clearLayers();
  marcatori.clear();
  const elenco = filtrate();

  for (const l of elenco) {
    const st = colore(l);
    const c = L.circleMarker([l.lat, l.lon], {
      radius: 6, weight: 2, color: '#fff',
      fillColor: COLORI[st] || COLORI.null, fillOpacity: 1,
    });
    c.bindTooltip(
      `<b>${l.opera || 'Opera non indicata'}</b><br>${l.strada} · km ${l.km}`
      + `<br>${NOMI_STATO[st] || 'nessun dato'}`,
      { direction: 'top' });
    c.on('click', () => apriPonte(l.id));
    c.addTo(strato);
    marcatori.set(l.id, c);
  }

  document.getElementById('m-conta').textContent =
    `${elenco.length} linee su ${dati.linee.length}`;

  if (elenco.length && elenco.length < dati.linee.length) {
    mappa.fitBounds(L.latLngBounds(elenco.map(l => [l.lat, l.lon])).pad(0.15));
  }
}

// Serve allo schema: "fammi vedere dov'è questa linea".
export function vaiA(lineaId) {
  const l = dati.linee.find(x => x.id === lineaId);
  if (!l || !l.lat) return;
  mappa.setView([l.lat, l.lon], 17);
  const c = marcatori.get(lineaId);
  if (c) c.openTooltip();
}
