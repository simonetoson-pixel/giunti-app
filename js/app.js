// Giunti — schermata di rilievo.

import {
  vicine, distanzaLeggibile, affidabilita, metri,
  carreggiataDallaRotta, carreggiataDallaPosizione,
} from './vicini.js';
import { accoda, aggiorna, elimina, sincronizza, allaRete, inCoda, unRilievo }
  from './coda.js';
import { autenticato, entra, esci, leggi, urlFirmato } from './rete.js';
import { censimento } from './dati.js';

const STATI = ['ottime', 'buone_datate', 'attenzionare', 'cattive'];
const NOMI_STATO = {
  ottime: 'Ottime', buone_datate: 'Buone ma datati',
  attenzionare: 'Da attenzionare', cattive: 'Cattive',
};
const COLORE = s => `var(--${s || 'nessuno'})`;

const $ = id => document.getElementById(id);

// Collega un ascoltatore solo se l'elemento c'e'.
//
// Serve contro il disallineamento fra pagina e codice: il telefono tiene in
// memoria l'app per funzionare senza campo, e dopo un aggiornamento puo
// ritrovarsi la pagina di ieri con il codice di oggi. Prima, un elemento
// mancante faceva fallire tutto il collegamento — compreso il pulsante
// ENTRA, e l'accesso diventava impossibile senza che si capisse perche.
const mancanti = [];

function su(id, evento, fn) {
  const e = $(id);
  if (e) e.addEventListener(evento, fn);
  else mancanti.push(id);
}

// scrivere in un elemento che potrebbe non esserci
function scrivi(id, testo) {
  const e = $(id);
  if (e) e.textContent = testo;
}

const schermate = ['s-accesso', 's-scatto', 's-rilievo', 's-scelta'];
const mostra = id => {
  schermate.forEach(s => $(s).classList.toggle('attiva', s === id));
  // si apre sempre dall'alto: con lo scorrimento rimasto da prima, la fascia che
  // dice il ponte o il blocco "linea di giunto" restavano fuori schermo
  if (id === 's-scatto') $('s-scatto').scrollTop = 0;
  const corpo = document.querySelector('#s-rilievo .corpo');
  if (id === 's-rilievo' && corpo) corpo.scrollTop = 0;
  // un aggiornamento in attesa si applica quando non si sta compilando niente
  if (id === 's-scatto' || id === 's-accesso') applicaAggiornamento();
};

// Il numero della versione, scritto in fondo alla schermata: se non e' quello
// atteso, il telefono sta ancora usando la copia vecchia. Alzarlo insieme a
// CACHE in sw.js.
const VERSIONE = 8;

// Quando arriva una versione nuova l'app si ricarica da sola, ma solo se non
// si sta compilando un rilievo: in quel caso aspetta che si torni allo scatto,
// altrimenti si perderebbe quello che si sta scrivendo.
let aggiornamentoPronto = false;
function applicaAggiornamento() {
  if (aggiornamentoPronto && !rilievo) location.reload();
}

let linee = [];
let posizione = null;         // {lat, lon, precisione}
let proposta = null;          // {linea, distanza}
let rivale = null;            // il candidato piu vicino su un'altra strada
let rilievo = null;           // quello che si sta compilando

// L'ultima rotta tenuta a velocità di marcia. Fermi in corsia d'emergenza le
// due carreggiate distano meno dell'errore del GPS e non si distinguono; la
// direzione in cui si stava andando un attimo prima, invece, le distingue.
let rotta = null, rottaQuando = 0;
const ROTTA_VALIDA_MS = 3 * 60 * 1000;

// Su quale tratta e su quale carreggiata si sta lavorando. Dove due strade
// corrono affiancate — A4 e tangenziale di Vicenza, per dirne una — la
// distanza non le distingue, e nessun calcolo puo farlo: lo sa solo chi guida.
const TRATTA = 'giunti-tratta';
const CARREGGIATA = 'giunti-carreggiata';
const SCELTA_IL = 'giunti-scelta-il';

// La scelta vale per una giornata di lavoro, non per sempre. Prima restava
// salvata finche' non la si cambiava: la sera sull'A31, la mattina dopo sull'A4
// l'app guardava ancora solo l'A31 — nessuna linea vicina, e anche l'elenco per
// scegliere a mano mostrava solo l'A31 — senza dire perche'.
const VALIDITA_SCELTA_MS = 4 * 60 * 60 * 1000;
const sceltaValida = () => Date.now() - (+localStorage.getItem(SCELTA_IL) || 0) < VALIDITA_SCELTA_MS;
const ricordaScelta = () => localStorage.setItem(SCELTA_IL, String(Date.now()));

let tratta = sceltaValida() ? (localStorage.getItem(TRATTA) || '') : '';
let carreggiata = sceltaValida() ? (localStorage.getItem(CARREGGIATA) || '') : '';
// Se l'ha scelta lui non si tocca piu: chi guida ne sa piu di qualsiasi
// calcolo. Se invece l'ha proposta l'app, ogni nuova posizione la rivede.
let carreggiataScelta = sceltaValida() && localStorage.getItem(CARREGGIATA + '-scelta') === '1';
// Se sulla tratta scelta non c'e niente vicino ma su un'altra si, quale:
// quasi sempre vuol dire che la tratta scelta e' rimasta quella di ieri.
let altraTratta = null;
let carreggiateInDisaccordo = false;

function candidate() {
  return tratta ? linee.filter(l => l.strada === tratta) : linee;
}

function carreggiateDisponibili() {
  const nomi = new Set();
  candidate().forEach(l => l.carreggiate.forEach(c => nomi.add(c.nome)));
  return [...nomi].sort();
}

// --------------------------------------------------------------- avvisi
let timerAvviso;
function avvisa(testo, tipo = '') {
  const a = $('avviso');
  a.textContent = testo;
  a.className = `avviso visibile ${tipo}`;
  clearTimeout(timerAvviso);
  timerAvviso = setTimeout(() => a.classList.remove('visibile'), tipo === 'male' ? 7000 : 3200);
}

// ----------------------------------------------------------------- dati
// Il censimento non sta nel sito ma nel database, e sul telefono resta in
// memoria locale: così l'indirizzo pubblico non espone i dati di CAV e
// l'app funziona lo stesso dove non c'è campo.
async function caricaLinee() {
  linee = await censimento({
    onAggiornato: fresche => { linee = fresche; aggiornaPosizione(); },
  });
}

// ------------------------------------------------------------------ GPS
function seguiPosizione() {
  if (!navigator.geolocation) {
    $('dove').textContent = 'GPS non disponibile';
    return;
  }
  navigator.geolocation.watchPosition(
    p => {
      posizione = {
        lat: p.coords.latitude, lon: p.coords.longitude,
        precisione: p.coords.accuracy,
      };
      // la rotta vale solo se si stava andando: da fermi è rumore
      if (p.coords.heading != null && p.coords.speed != null && p.coords.speed > 4) {
        rotta = p.coords.heading;
        rottaQuando = Date.now();
      }
      aggiornaPosizione();
    },
    e => {
      $('posizione').className = 'posizione incerta';
      $('dove').textContent = 'Posizione non disponibile';
      $('opera-vicina').textContent = '';
      $('segnale').textContent = e.code === e.PERMISSION_DENIED
        ? 'permesso negato — scegli la linea a mano'
        : 'GPS assente — scegli la linea a mano';
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
}

function aggiornaPosizione() {
  if (!posizione || !linee.length) return;
  const insieme = candidate();
  if (!insieme.length) return;
  const trovate = vicine(insieme, posizione.lat, posizione.lon, 12);
  proposta = trovate[0];
  const fiducia = affidabilita(proposta.distanza, posizione.precisione);
  const gps = `GPS ±${Math.round(posizione.precisione)} m`;

  // Fuori dal raggio d'aggancio la linea più vicina non è dove sei: si mostra
  // lo stesso, perché serve a orientarsi, ma detta per quello che è.
  if (fiducia === 'incerta') {
    rivale = null;
    // Sulla tratta scelta non c'e niente, ma su un'altra si? Non si cambia da
    // soli — due strade affiancate sono proprio il caso in cui la posizione non
    // basta — ma lo si dice, con un tocco per passare.
    altraTratta = null;
    if (tratta) {
      const t = vicine(linee, posizione.lat, posizione.lon, 1)[0];
      if (t && t.linea.strada !== tratta
          && affidabilita(t.distanza, posizione.precisione) !== 'incerta') altraTratta = t;
    }
    mostraAltraTratta();
    proponiCarreggiata();
    if ($('posizione')) $('posizione').className = 'posizione lontano';
    scrivi('dove', 'Nessun giunto qui vicino');
    scrivi('opera-vicina', `il più vicino ${distanzaLeggibile(proposta.distanza)}`
      + ` · ${proposta.linea.opera || proposta.linea.strada}, km ${proposta.linea.km}`);
    scrivi('segnale', `${gps} · puoi scattare, la linea la scegli tu`);
    return;
  }

  // se il secondo candidato sta su un'altra strada ed è quasi altrettanto
  // vicino, la posizione da sola non basta a decidere
  rivale = trovate.find(t => t.linea.strada !== proposta.linea.strada
                             && t.distanza < proposta.distanza + 120) || null;
  altraTratta = null;
  mostraAltraTratta();
  proponiCarreggiata();

  if ($('posizione')) $('posizione').className = 'posizione';
  scrivi('dove', proposta.linea.opera || 'Opera non indicata');
  scrivi('opera-vicina', `${proposta.linea.strada} · km ${proposta.linea.km}`);
  scrivi('segnale', `${distanzaLeggibile(proposta.distanza)} · ${gps}`
    + (carreggiateInDisaccordo ? ' · carreggiata da confermare' : ''));
}

// Il pulsante che dice "sei vicino a X: passa a quella tratta". Si crea qui
// invece che nell'HTML: cosi funziona anche se la pagina e quella di ieri.
function mostraAltraTratta() {
  let b = $('b-altra-tratta');
  if (!altraTratta) { if (b) b.remove(); return; }
  const fascia = $('posizione');
  if (!fascia) return;
  if (!b) {
    b = document.createElement('button');
    b.id = 'b-altra-tratta';
    b.type = 'button';
    b.className = 'altra-tratta';
    b.addEventListener('click', passaAllaTratta);
    fascia.insertBefore(b, fascia.querySelector('.scelte'));
  }
  const l = altraTratta.linea;
  b.innerHTML = `Sei vicino a <b>${l.opera || l.strada}</b> (${l.strada}), non all'${tratta}.
    <span>Tocca per passare a ${l.strada}</span>`;
}

function passaAllaTratta() {
  if (!altraTratta) return;
  tratta = altraTratta.linea.strada;
  localStorage.setItem(TRATTA, tratta);
  ricordaScelta();
  if ($('scelta-strada')) $('scelta-strada').value = tratta;
  altraTratta = null;
  mostraAltraTratta();
  riempiCarreggiate();
  aggiornaPosizione();
}

// Su quale carreggiata si sta. Due indizi indipendenti:
//
//   - la posizione. Le due carreggiate distano una quindicina di metri e chi
//     fotografa sta in corsia d'emergenza, sul bordo esterno: dal suo giunto
//     dista una manciata di metri, dall'altro una ventina. È una misura
//     presa adesso, quindi vale più dell'altra;
//   - la rotta tenuta poco prima di accostare, che serve quando la posizione
//     non è abbastanza netta o si è lontani dal giunto.
//
// Se si contraddicono non si sceglie: si dice che non è chiaro. E se la
// carreggiata l'ha scelta lui dal selettore, non si tocca comunque.
function proponiCarreggiata() {
  if (carreggiataScelta) return;

  const nomi = carreggiateDisponibili();
  const daPosizione = proposta && posizione
    ? carreggiataDallaPosizione(proposta.linea, posizione.lat, posizione.lon,
      posizione.precisione)
    : null;
  const daRotta = Date.now() - rottaQuando <= ROTTA_VALIDA_MS
    ? carreggiataDallaRotta(rotta, nomi) : null;

  carreggiateInDisaccordo = !!(daPosizione && daRotta && daPosizione !== daRotta);
  const nome = daPosizione || daRotta;
  if (!nome || !nomi.includes(nome)) return;

  carreggiata = nome;
  const sel = $('scelta-carreggiata');
  if (!sel) return;
  sel.value = nome;
  sel.classList.add('proposta');
}

function riempiCarreggiate() {
  const sel = $('scelta-carreggiata');
  if (!sel) return;
  const nomi = carreggiateDisponibili();
  sel.innerHTML = '<option value="">Carreggiata?</option>'
    + nomi.map(n => `<option value="${n}">${n}</option>`).join('');
  sel.value = nomi.includes(carreggiata) ? carreggiata : '';
  if (!sel.value) { carreggiata = ''; carreggiataScelta = false; }
  sel.classList.toggle('proposta', !!carreggiata && !carreggiataScelta);
}

// ---------------------------------------------------------------- foto
// Le foto si rimpiccioliscono prima di partire: in campo la rete è poca e
// 1600 px bastano abbondantemente a vedere lo stato di un giunto.
function rimpicciolisci(file, latoMax = 1600, qualita = 0.82) {
  return new Promise(ok => {
    const img = new Image();
    img.onload = () => {
      const scala = Math.min(1, latoMax / Math.max(img.width, img.height));
      const tela = document.createElement('canvas');
      tela.width = Math.round(img.width * scala);
      tela.height = Math.round(img.height * scala);
      tela.getContext('2d').drawImage(img, 0, 0, tela.width, tela.height);
      tela.toBlob(b => { URL.revokeObjectURL(img.src); ok(b); }, 'image/jpeg', qualita);
    };
    img.src = URL.createObjectURL(file);
  });
}

async function fotoScattata(file, aggiuntiva) {
  const blob = await rimpicciolisci(file);
  if (aggiuntiva && rilievo) {
    rilievo.foto.push(blob);
  } else {
    nuovoRilievo(blob);
  }
  disegnaFoto();
  mostra('s-rilievo');
}

// ------------------------------------------------------------- rilievo
function nuovoRilievo(primaFoto) {
  // Senza posizione non si tira a indovinare: meglio costringere a scegliere
  // che attribuire la foto a un giunto sbagliato. Vale anche quando il GPS
  // c'è ma la linea più vicina è troppo lontana per essere quella giusta.
  const fidato = proposta &&
    affidabilita(proposta.distanza, posizione && posizione.precisione) !== 'incerta';
  const linea = fidato ? proposta.linea : null;
  rilievo = {
    id: crypto.randomUUID(),
    linea_id: linea ? linea.id : null,
    linea,
    carreggiata: carreggiata || null,
    data: new Date().toISOString().slice(0, 10),
    colore: null,
    stati: linea ? statiIniziali(linea) : [],
    nota: '',
    audio: null,
    foto: [primaFoto],
    foto_caricate: 0,
    urlRemote: [],
    lat: posizione ? posizione.lat : null,
    lon: posizione ? posizione.lon : null,
    precisione_m: posizione ? posizione.precisione : null,
    esistente: false,
  };
  $('nota').value = '';
  azzeraVocale();
  disegnaRilievo();
}

// Riprendere in mano un rilievo già fatto: si fotografa il giunto in corsia
// d'emergenza e si compila all'area di servizio, con calma.
async function apriRilievo(id) {
  const r = await unRilievo(id);
  if (!r) return;
  rilievo = {
    id: r.id,
    linea_id: r.linea_id,
    linea: linee.find(l => l.id === r.linea_id) || null,
    carreggiata: r.carreggiata || null,
    data: r.data,
    colore: r.colore || null,
    stati: [],
    nota: r.nota || '',
    audio: r.audio || null,
    foto: r.foto || [],
    foto_caricate: r.foto_caricate || 0,
    urlRemote: [],
    lat: r.lat, lon: r.lon, precisione_m: r.precisione_m,
    creato_il: r.creato_il,
    inviato_il: r.inviato_il || null,
    esistente: true,
  };
  if (rilievo.linea) rilievo.stati = fondiStati(rilievo.linea, r.stati_corsie);
  $('nota').value = rilievo.nota;
  azzeraVocale(!!rilievo.audio);
  disegnaRilievo();
  disegnaFoto();
  mostra('s-rilievo');
  // le foto già sul server non stanno più sul telefono: si richiamano da lì
  if (rilievo.foto_caricate) recuperaFoto(rilievo.id);
}

async function recuperaFoto(id) {
  try {
    const righe = await leggi(`foto?rilievo_id=eq.${id}&select=path&order=scattata_il`);
    const url = await Promise.all(righe.map(f => urlFirmato('foto', f.path, 3600)));
    if (rilievo && rilievo.id === id) {
      rilievo.urlRemote = url;
      disegnaFoto();
    }
  } catch { /* senza rete restano i segnaposto */ }
}

// Si parte da com'era al censimento: se non è cambiato niente non c'è niente
// da toccare, e si tocca solo quello che è peggiorato.
function statiIniziali(linea) {
  return linea.carreggiate.map(c => ({
    carreggiata: c.nome,
    corsie: c.corsie.map(([corsia, stato]) => ({ corsia, stato })),
  }));
}

// Un rilievo riaperto porta con sé gli stati della sola carreggiata rilevata:
// si ripartiscono dal censimento e si sovrappongono quelli salvati, per nome
// di carreggiata (mai per posizione: l'altra potrebbe non esserci).
function fondiStati(linea, salvati) {
  const base = statiIniziali(linea);
  for (const s of salvati || []) {
    const b = base.find(x => x.carreggiata === s.carreggiata);
    if (b && Array.isArray(s.corsie) && s.corsie.length === b.corsie.length) b.corsie = s.corsie;
  }
  return base;
}

// Su quale carreggiata si sta rilevando, fra quelle che la linea ha davvero.
//
// Dopo lo scatto interessa una carreggiata sola: l'altra, sullo schermo, fa
// solo confusione. Quindi: quella dichiarata, se la linea ce l'ha; altrimenti,
// se la linea ha il giunto in una sola carreggiata (capita, i due lati di un
// ponte possono essere strutture diverse), quella; altrimenti nessuna, e
// bisogna sceglierla — non si tira a indovinare.
function carreggiataAttiva(linea) {
  const nomi = linea.carreggiate.map(c => c.nome);
  if (rilievo.carreggiata && nomi.includes(rilievo.carreggiata)) return rilievo.carreggiata;
  if (nomi.length === 1) return nomi[0];
  return null;
}

// Come si disegnano le corsie sul telefono: l'emergenza sempre a destra.
//
// Si guida a destra, quindi chi rileva si ferma sempre in una corsia di
// emergenza che ha alla propria destra, qualunque carreggiata sia. Nel
// censimento le carreggiate sono disegnate come su una mappa, con l'emergenza
// sul bordo esterno: a destra in est e nord, a sinistra in ovest e sud. Qui
// si rovescia dove serve, riconoscendola dalla corsia E e non dal nome della
// carreggiata. Solo la vista cambia: i dati restano come sono.
function ordineVisivo(corsie) {
  const indici = corsie.map((_, i) => i);
  const n = corsie.length;
  if (n > 1 && corsie[0].corsia === 'E' && corsie[n - 1].corsia !== 'E') indici.reverse();
  return indici;
}

// Gli indirizzi temporanei delle foto vanno restituiti, altrimenti ogni
// ridisegno lascia una copia della foto in memoria.
let urlTemporanei = [];
function indirizzo(blob) {
  const u = URL.createObjectURL(blob);
  urlTemporanei.push(u);
  return u;
}

function disegnaFoto() {
  urlTemporanei.forEach(u => URL.revokeObjectURL(u));
  urlTemporanei = [];
  const locali = rilievo.foto || [];
  const remote = rilievo.urlRemote || [];
  const totale = remote.length + locali.length;

  const ultima = locali.length ? indirizzo(locali[locali.length - 1])
    : (remote.length ? remote[remote.length - 1] : '');
  $('anteprima').src = ultima;
  $('conta-foto').textContent = totale === 1 ? '1 foto' : `${totale} foto`;

  const segnaposto = Math.max(0, (rilievo.foto_caricate || 0) - remote.length);
  $('miniature').innerHTML = [
    ...remote.map(u => `<div class="miniatura"><img src="${u}" alt=""></div>`),
    ...Array(segnaposto).fill('<div class="miniatura gia-inviata">già<br>inviata</div>'),
    ...locali.map((b, i) => `<div class="miniatura">
        <img src="${indirizzo(b)}" alt="">
        <button class="togli" data-foto="${i}" type="button" aria-label="Togli">&times;</button>
      </div>`),
  ].join('');
}

function disegnaRilievo() {
  const l = rilievo.linea;

  // Finché non si sa a quale giunto appartiene, non si può salvare. E se la
  // linea ha due carreggiate, nemmeno finché non si sa quale: guardando la
  // foto in ufficio non si distinguerebbe l'andata dal ritorno.
  const attiva = l ? carreggiataAttiva(l) : null;
  const manca = !l ? 'SCEGLI PRIMA LA LINEA' : (!attiva ? 'SCEGLI LA CARREGGIATA' : null);
  // Non e' spento: un pulsante grigio che dice "scegli la linea" e non fa
  // niente lascia li. Toccandolo si va a sceglierla.
  $('b-salva').disabled = false;
  $('b-salva').classList.toggle('incompleto', !!manca);
  $('b-salva').textContent = manca
    || (rilievo.esistente ? 'SALVA LE MODIFICHE' : 'SALVA RILIEVO');
  $('b-elimina').hidden = !rilievo.esistente;
  document.querySelector('.linea-scelta').classList.toggle('mancante', !l);

  if (!l) {
    $('r-opera').textContent = 'Nessuna linea scelta';
    $('r-dettaglio').textContent = rilievo.esistente
      ? 'La linea di questo rilievo non esiste più (chilometrica corretta): scegli quella giusta'
      : posizione
        ? 'Nessun giunto abbastanza vicino: scegli tu quale'
        : 'Posizione non disponibile: scegli tu la linea';
    $('colori').innerHTML = '';
    $('corsie').innerHTML = '';
    mostraSuggerita();
    return;
  }
  mostraSuggerita();

  $('r-opera').textContent = l.opera || 'Opera non indicata';
  const dist = proposta && proposta.linea.id === l.id && !rilievo.esistente
    ? ` · ${distanzaLeggibile(proposta.distanza)}` : '';
  $('r-dettaglio').textContent = `${l.strada} · km ${l.km}${dist}`;

  const avvisoAmbiguo = document.querySelector('.ambiguo');
  if (avvisoAmbiguo) avvisoAmbiguo.remove();
  if (rivale && proposta && proposta.linea.id === l.id && !rilievo.esistente) {
    const nota = document.createElement('div');
    nota.className = 'ambiguo';
    nota.innerHTML = `Qui corrono due strade affiancate: a ${Math.round(rivale.distanza)} m
      c'è anche <b>${rivale.linea.strada}</b>, km ${rivale.linea.km}.
      Controlla di essere sulla strada giusta, o scegli la tratta qui sopra.`;
    document.querySelector('.linea-scelta').after(nota);
  }

  $('colori').innerHTML = STATI.map(s => `
    <button class="colore${rilievo.colore === s ? ' scelto' : ''}" data-stato="${s}" type="button">
      <span class="macchia" style="background:${COLORE(s)}"></span>${NOMI_STATO[s]}
    </button>`).join('');

  // Una carreggiata sola, quella su cui si sta rilevando. L'altra non si
  // mostra: sul campo serve solo a sbagliare.
  const nomi = l.carreggiate.map(c => c.nome);
  let html = '';

  if (nomi.length > 1) {
    html += `<div class="scelta-carr" role="group" aria-label="Carreggiata">
      ${nomi.map(n => `<button class="carr-btn${n === attiva ? ' attiva' : ''}"
        data-carr="${n}" type="button">${n}</button>`).join('')}</div>`;
  }

  // se la carreggiata dichiarata non esiste su questa linea, si dice perché
  // se ne vede un'altra
  if (rilievo.carreggiata && !nomi.includes(rilievo.carreggiata) && attiva) {
    html += `<p class="avviso-carr">Su questa linea il giunto c'è solo in
      <b>${attiva}</b>: sei in ${rilievo.carreggiata}.</p>`;
  }

  if (!attiva) {
    html += '<p class="scegli-carr">Su quale carreggiata ti trovi? Ti mostro solo quella.</p>';
    $('corsie').innerHTML = html;
    return;
  }

  const ic = rilievo.stati.findIndex(c => c.carreggiata === attiva);
  const c = rilievo.stati[ic];
  const info = l.carreggiate.find(x => x.nome === attiva) || {};
  const meta = [info.modello, info.anno].filter(Boolean).join(' · ');
  html += `<div class="carreggiata scelta">
    <div class="titolo">
      ${nomi.length === 1 ? `<b>${attiva}</b>` : ''}
      ${info.doppio_senso ? '<span>(doppio senso)</span>' : ''}
      <span>${meta}</span></div>
    <div class="strisce">${ordineVisivo(c.corsie).map(ix => {
    const x = c.corsie[ix];
    return `<button class="corsia" data-c="${ic}" data-i="${ix}" type="button"
              style="background:${COLORE(x.stato)}">
        ${x.corsia}<small>${x.stato ? NOMI_STATO[x.stato].split(' ')[0].toLowerCase() : '—'}</small>
      </button>`;
  }).join('')}</div>
  </div>`;
  $('corsie').innerHTML = html;
}

// Nella schermata del rilievo, senza linea: "sei vicino a X su un'altra tratta".
function mostraSuggerita() {
  const vecchia = document.querySelector('.suggerita');
  if (vecchia) vecchia.remove();
  if (rilievo.linea || rilievo.esistente || !altraTratta) return;
  const l = altraTratta.linea;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'suggerita';
  b.innerHTML = `Sei vicino a <b>${l.opera || l.strada}</b> · ${l.strada} km ${l.km}
    <span>Tocca per usare questa linea e passare a ${l.strada}</span>`;
  b.addEventListener('click', () => {
    const linea = altraTratta.linea;
    passaAllaTratta();
    rilievo.linea = linea;
    rilievo.linea_id = linea.id;
    rilievo.stati = statiIniziali(linea);
    disegnaRilievo();
  });
  document.querySelector('.linea-scelta').after(b);
}

// ------------------------------------------------------- scelta manuale
function disegnaElenco(filtro = '') {
  const testo = filtro.trim().toLowerCase();
  let elenco;
  // Tutte le linee, dalla piu vicina: la tratta scelta serve a riconoscere
  // quella giusta fra due strade affiancate, non a nascondere le altre. Prima
  // l'elenco mostrava solo la tratta scelta, e con quella sbagliata la linea
  // che si cercava non c'era.
  const insieme = (!posizione && !testo && tratta) ? candidate() : linee;
  if (testo) {
    elenco = insieme
      .filter(l => `${l.opera} ${l.strada} ${l.km}`.toLowerCase().includes(testo))
      .slice(0, 60)
      .map(l => ({ linea: l, distanza: posizione ? metri(posizione.lat, posizione.lon, l.lat, l.lon) : null }));
  } else if (posizione) {
    elenco = vicine(insieme, posizione.lat, posizione.lon, 25);
  } else {
    elenco = insieme.slice(0, 40).map(l => ({ linea: l, distanza: null }));
  }

  $('elenco').innerHTML = elenco.map(({ linea, distanza }) => `
    <button class="voce" data-id="${linea.id}" type="button">
      <span class="testo">
        <span class="nome">${linea.opera || 'Opera non indicata'}</span>
        <span class="dettaglio">${linea.strada} · km ${linea.km}</span>
      </span>
      <span class="distanza">${distanza == null ? '' : distanzaLeggibile(distanza)}</span>
    </button>`).join('');
}

// -------------------------------------------------------------- vocale
let registratore = null, pezziAudio = [];

function azzeraVocale(gia = false) {
  $('b-vocale').className = gia ? 'vocale pronta' : 'vocale';
  $('vocale-testo').textContent = gia
    ? 'Nota vocale registrata — tocca per rifarla'
    : 'Registra nota vocale';
  $('onda').hidden = true;
}

async function alternaVocale() {
  if (registratore && registratore.state === 'recording') {
    registratore.stop();
    return;
  }
  try {
    const flusso = await navigator.mediaDevices.getUserMedia({ audio: true });
    const tipo = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
    registratore = new MediaRecorder(flusso, { mimeType: tipo });
    pezziAudio = [];
    registratore.ondataavailable = e => pezziAudio.push(e.data);
    registratore.onstop = () => {
      flusso.getTracks().forEach(t => t.stop());
      rilievo.audio = new Blob(pezziAudio, { type: tipo });
      azzeraVocale(true);
    };
    registratore.start();
    $('b-vocale').className = 'vocale registra';
    $('vocale-testo').textContent = 'Registrazione… tocca per fermare';
    $('onda').hidden = false;
  } catch (e) {
    avvisa('Microfono non disponibile', 'male');
  }
}

// ------------------------------------------------------------ salvataggio
// Se al momento dello scatto il GPS non aveva ancora agganciato, si riprova
// ora: meglio una posizione presa un minuto dopo che nessuna posizione.
function posizioneAdesso() {
  return new Promise(ok => {
    if (!navigator.geolocation) return ok(null);
    navigator.geolocation.getCurrentPosition(
      p => ok({ lat: p.coords.latitude, lon: p.coords.longitude, precisione: p.coords.accuracy }),
      () => ok(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 });
  });
}

function apriScelta() {
  $('cerca').value = '';
  disegnaElenco();
  mostra('s-scelta');
}

async function salva() {
  if (!rilievo.linea) return apriScelta();
  if (!carreggiataAttiva(rilievo.linea)) {
    $('corsie').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return avvisa('Scegli su quale carreggiata ti trovi');
  }
  $('b-salva').disabled = true;
  rilievo.nota = $('nota').value.trim();

  if (rilievo.lat == null) {
    const p = posizione || await posizioneAdesso();
    if (p) {
      rilievo.lat = p.lat;
      rilievo.lon = p.lon;
      rilievo.precisione_m = p.precisione;
    }
  }

  // Si salva solo la carreggiata rilevata: gli stati dell'altra sono quelli
  // del censimento, mai toccati, e scriverli come se fossero stati visti
  // sul posto sarebbe dire una cosa che non e' successa.
  const attiva = carreggiataAttiva(rilievo.linea);
  const record = {
    id: rilievo.id,
    linea_id: rilievo.linea_id,
    carreggiata: attiva || rilievo.carreggiata || null,
    data: rilievo.data,
    colore: rilievo.colore,
    stati_corsie: attiva
      ? rilievo.stati.filter(c => c.carreggiata === attiva)
      : rilievo.stati,
    nota: rilievo.nota || null,
    audio: rilievo.audio,
    foto: rilievo.foto,
    foto_caricate: rilievo.foto_caricate || 0,
    lat: rilievo.lat, lon: rilievo.lon, precisione_m: rilievo.precisione_m,
    creato_il: rilievo.creato_il,
    inviato_il: rilievo.inviato_il || null,
    etichetta: rilievo.linea.opera || rilievo.linea.strada,
  };
  if (rilievo.esistente) await aggiorna(record);
  else await accoda(record);

  rilievo = null;
  $('nota').value = '';
  azzeraVocale();
  $('b-salva').disabled = false;
  mostra('s-scatto');
  avvisa(record.inviato_il ? 'Modifiche salvate' : 'Rilievo salvato', 'buono');
  aggiornaCoda();
  provaSincronizzare();
}

async function eliminaRilievo() {
  const dove = rilievo.linea ? `${rilievo.linea.opera || rilievo.linea.strada}, km ${rilievo.linea.km}` : '';
  const inviato = rilievo.inviato_il;
  if (!confirm(inviato
    ? `Il rilievo di ${dove} è già stato inviato: cancellandolo spariscono anche `
      + `le foto e le note dall'archivio, per tutti. Procedo?`
    : `Cancello il rilievo di ${dove}? Non è ancora stato inviato, quindi va perso.`)) return;
  try {
    await elimina(rilievo.id);
    rilievo = null;
    mostra('s-scatto');
    avvisa('Rilievo cancellato', 'buono');
    aggiornaCoda();
  } catch (e) {
    avvisa('Non riesco a cancellarlo: ' + String(e.message || e), 'male');
  }
}

// ------------------------------------------------------------- la coda
// Il giorno in cui si e' lavorato, come lo si dice a voce.
function nomeGiorno(d) {
  const chiave = x => x.toLocaleDateString('sv-SE');          // aaaa-mm-gg, ora locale
  const ieri = new Date(Date.now() - 86400000);
  if (chiave(d) === chiave(new Date())) return 'Oggi';
  if (chiave(d) === chiave(ieri)) return 'Ieri';
  return d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
}

// A che punto e' un rilievo: partito, in attesa, o bloccato (e perche' si
// vede sotto il conteggio).
function stato(r) {
  if (r.stato === 'inviato') return { testo: '✓', classe: 'inviato' };
  if (r.errore) return { testo: '⚠ bloccato', classe: 'bloccato' };
  return { testo: 'da inviare', classe: 'attesa' };
}

async function aggiornaCoda() {
  const tutti = await inCoda();
  const attesa = tutti.filter(r => r.stato !== 'inviato');
  // se qualcuno e' bloccato si dice perche', una volta sola per motivo
  const motivi = [...new Set(attesa.map(r => r.errore).filter(Boolean))];
  $('coda-testo').innerHTML = attesa.length
    ? `<b>${attesa.length}</b> ${attesa.length === 1 ? 'rilievo' : 'rilievi'} da inviare`
      + motivi.map(m => `<small class="errore-coda">${m}</small>`).join('')
    : 'Tutto sincronizzato';
  $('b-sincronizza').hidden = attesa.length === 0;

  // Tutti i rilievi, dal piu recente, raggruppati per giorno: quando si lavora
  // si fanno decine di scatti in successione e serve rivederli uno dopo l'altro,
  // non solo gli ultimi tre.
  const quando = r => new Date(r.modificato_il || r.creato_il);
  const ordinati = tutti.slice().sort((a, b) => quando(b) - quando(a));
  let giornoPrima = null, html = '';
  for (const r of ordinati) {
    const d = quando(r);
    const giorno = nomeGiorno(d);
    if (giorno !== giornoPrima) {
      html += `<div class="giorno">${giorno}</div>`;
      giornoPrima = giorno;
    }
    const foto = (r.foto ? r.foto.length : 0) + (r.foto_caricate || 0);
    const dettaglio = [
      r.carreggiata,
      d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
      foto ? `${foto} foto` : null,
    ].filter(Boolean).join(' · ');
    const st = stato(r);
    html += `<button class="recente" data-id="${r.id}" type="button">
      <span class="pallino" style="background:${COLORE(r.colore)}"></span>
      <span class="testo"><span class="nome">${r.etichetta || r.linea_id}</span>
        <span class="dettaglio">${dettaglio}</span></span>
      <span class="stato ${st.classe}">${st.testo}</span>
      <span class="apri">›</span>
    </button>`;
  }
  $('recenti').innerHTML = html;
}

async function provaSincronizzare() {
  const { inviati, rimasti, errore } = await sincronizza();
  if (inviati && !rimasti) avvisa(`${inviati} rilievi inviati`, 'buono');
  else if (inviati) avvisa(`${inviati} inviati, ${rimasti} no: ${errore}`, 'male');
  else if (rimasti && !navigator.onLine) avvisa('Nessuna rete: restano in attesa');
  // prima non diceva niente: "6 da inviare" e il pulsante che non faceva nulla
  else if (rimasti && errore) avvisa(`Non riesco a inviare: ${errore}`, 'male');
  aggiornaCoda();
}

// --------------------------------------------------------------- avvio
function collega() {
  su('b-scatta', 'click', () => {
    $('file-foto').dataset.aggiuntiva = '';
    $('file-foto').click();
  });
  su('b-aggiungi', 'click', () => {
    $('file-foto').dataset.aggiuntiva = '1';
    $('file-foto').click();
  });
  su('file-foto', 'change', e => {
    const f = e.target.files[0];
    if (f) fotoScattata(f, e.target.dataset.aggiuntiva === '1');
    e.target.value = '';
  });

  su('miniature', 'click', e => {
    const b = e.target.closest('.togli');
    if (!b) return;
    rilievo.foto.splice(+b.dataset.foto, 1);
    if (!rilievo.foto.length && !rilievo.foto_caricate) {
      avvisa('Un rilievo senza foto non ha molto senso: ne serve almeno una');
      return disegnaFoto();
    }
    disegnaFoto();
  });

  su('b-annulla', 'click', () => {
    rilievo = null;
    mostra('s-scatto');
  });

  su('colori', 'click', e => {
    const b = e.target.closest('.colore');
    if (!b || !rilievo.linea) return;
    rilievo.colore = rilievo.colore === b.dataset.stato ? null : b.dataset.stato;
    disegnaRilievo();
  });

  su('corsie', 'click', e => {
    const scelta = e.target.closest('.carr-btn');
    if (scelta) {
      rilievo.carreggiata = scelta.dataset.carr;
      return disegnaRilievo();
    }
    const b = e.target.closest('.corsia');
    if (!b || !rilievo.linea) return;
    const c = rilievo.stati[+b.dataset.c].corsie[+b.dataset.i];
    const i = STATI.indexOf(c.stato);
    c.stato = STATI[(i + 1) % STATI.length];
    disegnaRilievo();
  });

  su('b-cambia', 'click', apriScelta);
  su('b-indietro', 'click', () => mostra('s-rilievo'));
  su('cerca', 'input', e => disegnaElenco(e.target.value));
  su('elenco', 'click', e => {
    const b = e.target.closest('.voce');
    if (!b) return;
    const linea = linee.find(l => l.id === b.dataset.id);
    rilievo.linea = linea;
    rilievo.linea_id = linea.id;
    rilievo.stati = statiIniziali(linea);
    disegnaRilievo();
    mostra('s-rilievo');
  });

  su('recenti', 'click', e => {
    const b = e.target.closest('.recente');
    if (b) apriRilievo(b.dataset.id);
  });

  su('scelta-strada', 'change', e => {
    tratta = e.target.value;
    localStorage.setItem(TRATTA, tratta);
    ricordaScelta();
    riempiCarreggiate();
    aggiornaPosizione();
  });
  su('scelta-carreggiata', 'change', e => {
    carreggiata = e.target.value;
    carreggiataScelta = !!carreggiata;
    carreggiateInDisaccordo = false;
    localStorage.setItem(CARREGGIATA, carreggiata);
    localStorage.setItem(CARREGGIATA + '-scelta', carreggiataScelta ? '1' : '');
    ricordaScelta();
    e.target.classList.remove('proposta');
  });

  su('b-vocale', 'click', alternaVocale);
  su('b-salva', 'click', salva);
  su('b-elimina', 'click', eliminaRilievo);
  su('b-sincronizza', 'click', provaSincronizzare);
  allaRete(provaSincronizzare);
}

// ---------------------------------------------------------------- accesso
async function accedi(e) {
  e.preventDefault();
  const b = $('b-entra');
  b.disabled = true;
  b.textContent = 'ACCESSO…';
  $('errore-accesso').hidden = true;
  try {
    await entra($('email').value.trim(), $('password').value);
    $('password').value = '';
    await apriApp();
  } catch (err) {
    $('errore-accesso').textContent = String(err.message || err);
    $('errore-accesso').hidden = false;
  } finally {
    b.disabled = false;
    b.textContent = 'ENTRA';
  }
}

async function apriApp() {
  mostra('s-scatto');
  try {
    await caricaLinee();
  } catch (err) {
    avvisa('Non riesco a leggere il censimento: ' + String(err.message || err), 'male');
    return;
  }
  const sel = $('scelta-strada');
  if (sel) {
    [...new Set(linee.map(l => l.strada))].sort()
      .forEach(s => sel.add(new Option(s, s)));
    sel.value = tratta;
  }
  riempiCarreggiate();

  try {
    seguiPosizione();
    aggiornaCoda();
    provaSincronizzare();
  } catch (e) {
    avvisa('Avvio incompleto: ' + String(e.message || e), 'male');
  }
}

async function avvia() {
  // L'accesso per primo: se piu avanti qualcosa va storto, almeno si entra.
  $('modulo-accesso').addEventListener('submit', accedi);

  try {
    collega();
  } catch (e) {
    avvisa('Qualcosa non si e collegato: ' + String(e.message || e), 'male');
  }
  if (mancanti.length) {
    // pagina e codice non sono della stessa versione: succede dopo un
    // aggiornamento, e si risolve da solo alla prossima apertura
    avvisa('App aggiornata a meta: chiudila e riaprila');
  }

  su('b-esci', 'click', async () => {
    const rimasti = (await inCoda()).filter(r => r.stato !== 'inviato').length;
    if (rimasti && !confirm(
      `Ci sono ${rimasti} rilievi non ancora inviati. Uscendo restano sul telefono `
      + `ma non partiranno finché non rientri. Esci lo stesso?`)) return;
    esci();
    mostra('s-accesso');
  });

  if (autenticato()) await apriApp();
  else mostra('s-accesso');

  scrivi('versione', `versione ${VERSIONE}`);

  if ('serviceWorker' in navigator) {
    // Alla prima installazione il controllo passa al service worker senza che
    // ci sia niente da aggiornare; solo se ce n'era gia uno e' una versione nuova.
    const avevaControllo = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!avevaControllo) return;
      aggiornamentoPronto = true;
      applicaAggiornamento();
    });
    // a ogni apertura si chiede se c'e' una versione nuova, senza aspettare
    navigator.serviceWorker.register('sw.js').then(r => r.update()).catch(() => {});
  }
}

avvia();
