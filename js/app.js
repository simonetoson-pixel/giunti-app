// Giunti — schermata di rilievo.

import { vicine, distanzaLeggibile, affidabilita, metri } from './vicini.js';
import { accoda, sincronizza, allaRete, inCoda } from './coda.js';
import { autenticato, entra, esci } from './rete.js';
import { censimento } from './dati.js';

const STATI = ['ottime', 'buone_datate', 'attenzionare', 'cattive'];
const NOMI_STATO = {
  ottime: 'Ottime', buone_datate: 'Buone ma datati',
  attenzionare: 'Da attenzionare', cattive: 'Cattive',
};
const COLORE = s => `var(--${s || 'nessuno'})`;

const $ = id => document.getElementById(id);
const schermate = ['s-accesso', 's-scatto', 's-rilievo', 's-scelta'];
const mostra = id => schermate.forEach(s =>
  $(s).classList.toggle('attiva', s === id));

let linee = [];
let posizione = null;         // {lat, lon, precisione}
let proposta = null;          // {linea, distanza}
let rilievo = null;           // quello che si sta compilando

// --------------------------------------------------------------- avvisi
let timerAvviso;
function avvisa(testo, tipo = '') {
  const a = $('avviso');
  a.textContent = testo;
  a.className = `avviso visibile ${tipo}`;
  clearTimeout(timerAvviso);
  timerAvviso = setTimeout(() => a.classList.remove('visibile'), 3200);
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
      aggiornaPosizione();
    },
    e => {
      $('posizione').className = 'posizione incerta';
      $('dove').textContent = 'Posizione non disponibile';
      $('segnale').textContent = e.code === e.PERMISSION_DENIED
        ? 'permesso negato — scegli la linea a mano'
        : 'GPS assente — scegli la linea a mano';
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
}

function aggiornaPosizione() {
  if (!posizione || !linee.length) return;
  const trovate = vicine(linee, posizione.lat, posizione.lon, 1);
  proposta = trovate[0];
  const fiducia = affidabilita(proposta.distanza, posizione.precisione);

  $('posizione').className = 'posizione' + (fiducia === 'incerta' ? ' incerta' : '');
  $('dove').textContent = `${proposta.linea.strada} · km ${proposta.linea.km}`;
  $('opera-vicina').textContent = proposta.linea.opera || '';
  $('segnale').textContent =
    `${distanzaLeggibile(proposta.distanza)} · GPS ±${Math.round(posizione.precisione)} m`;
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
  $('anteprima').src = URL.createObjectURL(rilievo.foto[rilievo.foto.length - 1]);
  $('conta-foto').textContent = `${rilievo.foto.length} foto`;
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
    linea_id: linea ? linea.id : null,
    linea,
    data: new Date().toISOString().slice(0, 10),
    colore: null,
    stati: linea ? statiIniziali(linea) : [],
    nota: '',
    audio: null,
    foto: [primaFoto],
    lat: posizione ? posizione.lat : null,
    lon: posizione ? posizione.lon : null,
    precisione_m: posizione ? posizione.precisione : null,
  };
  disegnaRilievo();
}

// Si parte da com'era al censimento: se non è cambiato niente non c'è niente
// da toccare, e si tocca solo quello che è peggiorato.
function statiIniziali(linea) {
  return linea.carreggiate.map(c => ({
    carreggiata: c.nome,
    corsie: c.corsie.map(([corsia, stato]) => ({ corsia, stato })),
  }));
}

function disegnaRilievo() {
  const l = rilievo.linea;

  // Finché non si sa a quale giunto appartiene, non si può salvare.
  $('b-salva').disabled = !l;
  $('b-salva').textContent = l ? 'SALVA RILIEVO' : 'SCEGLI PRIMA LA LINEA';
  document.querySelector('.linea-scelta').classList.toggle('mancante', !l);

  if (!l) {
    $('r-opera').textContent = 'Nessuna linea scelta';
    $('r-dettaglio').textContent = posizione
      ? 'Nessun giunto abbastanza vicino: scegli tu quale'
      : 'Posizione non disponibile: scegli tu la linea';
    $('colori').innerHTML = '';
    $('corsie').innerHTML = '';
    return;
  }

  $('r-opera').textContent = l.opera || 'Opera non indicata';
  const dist = proposta && proposta.linea.id === l.id
    ? ` · ${distanzaLeggibile(proposta.distanza)}` : '';
  $('r-dettaglio').textContent = `${l.strada} · km ${l.km}${dist}`;

  $('colori').innerHTML = STATI.map(s => `
    <button class="colore${rilievo.colore === s ? ' scelto' : ''}" data-stato="${s}" type="button">
      <span class="macchia" style="background:${COLORE(s)}"></span>${NOMI_STATO[s]}
    </button>`).join('');

  $('corsie').innerHTML = rilievo.stati.map((c, ic) => {
    const info = l.carreggiate[ic];
    const meta = [info.modello, info.anno].filter(Boolean).join(' · ');
    return `<div class="carreggiata">
      <div class="titolo">${info.nome}${info.doppio_senso ? ' (doppio senso)' : ''}
        <span>${meta}</span></div>
      <div class="strisce">${c.corsie.map((x, ix) => `
        <button class="corsia" data-c="${ic}" data-i="${ix}" type="button"
                style="background:${COLORE(x.stato)}">
          ${x.corsia}<small>${x.stato ? NOMI_STATO[x.stato].split(' ')[0].toLowerCase() : '—'}</small>
        </button>`).join('')}</div>
    </div>`;
  }).join('');
}

// ------------------------------------------------------- scelta manuale
function disegnaElenco(filtro = '') {
  const testo = filtro.trim().toLowerCase();
  let elenco;
  if (testo) {
    elenco = linee
      .filter(l => `${l.opera} ${l.strada} ${l.km}`.toLowerCase().includes(testo))
      .slice(0, 60)
      .map(l => ({ linea: l, distanza: posizione ? metri(posizione.lat, posizione.lon, l.lat, l.lon) : null }));
  } else if (posizione) {
    elenco = vicine(linee, posizione.lat, posizione.lon, 25);
  } else {
    elenco = linee.slice(0, 40).map(l => ({ linea: l, distanza: null }));
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
      $('b-vocale').className = 'vocale pronta';
      $('vocale-testo').textContent = 'Nota vocale registrata — tocca per rifarla';
      $('onda').hidden = true;
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

async function salva() {
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
  await accoda({
    linea_id: rilievo.linea_id,
    data: rilievo.data,
    colore: rilievo.colore,
    stati_corsie: rilievo.stati,
    nota: rilievo.nota || null,
    audio: rilievo.audio,
    foto: rilievo.foto,
    lat: rilievo.lat, lon: rilievo.lon, precisione_m: rilievo.precisione_m,
    etichetta: rilievo.linea.opera || rilievo.linea.strada,
  });
  rilievo = null;
  $('nota').value = '';
  $('b-vocale').className = 'vocale';
  $('vocale-testo').textContent = 'Registra nota vocale';
  $('b-salva').disabled = false;
  mostra('s-scatto');
  avvisa('Rilievo salvato', 'buono');
  aggiornaCoda();
  provaSincronizzare();
}

// ------------------------------------------------------------- la coda
async function aggiornaCoda() {
  const tutti = await inCoda();
  const attesa = tutti.filter(r => r.stato !== 'inviato');
  $('coda-testo').innerHTML = attesa.length
    ? `<b>${attesa.length}</b> rilievi da inviare`
    : 'Tutto sincronizzato';
  $('b-sincronizza').hidden = attesa.length === 0;

  const recenti = tutti.sort((a, b) => b.creato_il.localeCompare(a.creato_il)).slice(0, 4);
  $('recenti').innerHTML = recenti.map(r => `
    <div class="recente">
      <span class="pallino" style="background:${COLORE(r.colore)}"></span>
      <span class="nome">${r.etichetta || r.linea_id}</span>
      <span class="quando">${r.stato === 'inviato' ? 'inviato' : 'in attesa'}</span>
    </div>`).join('');
}

async function provaSincronizzare() {
  const { inviati, rimasti } = await sincronizza();
  if (inviati) avvisa(`${inviati} rilievi inviati`, 'buono');
  else if (rimasti && !navigator.onLine) avvisa('Nessuna rete: restano in attesa');
  aggiornaCoda();
}

// --------------------------------------------------------------- avvio
function collega() {
  $('b-scatta').addEventListener('click', () => {
    $('file-foto').dataset.aggiuntiva = '';
    $('file-foto').click();
  });
  $('b-aggiungi').addEventListener('click', () => {
    $('file-foto').dataset.aggiuntiva = '1';
    $('file-foto').click();
  });
  $('file-foto').addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) fotoScattata(f, e.target.dataset.aggiuntiva === '1');
    e.target.value = '';
  });

  $('b-annulla').addEventListener('click', () => {
    rilievo = null;
    mostra('s-scatto');
  });

  $('colori').addEventListener('click', e => {
    const b = e.target.closest('.colore');
    if (!b || !rilievo.linea) return;
    rilievo.colore = rilievo.colore === b.dataset.stato ? null : b.dataset.stato;
    disegnaRilievo();
  });

  $('corsie').addEventListener('click', e => {
    const b = e.target.closest('.corsia');
    if (!b || !rilievo.linea) return;
    const c = rilievo.stati[+b.dataset.c].corsie[+b.dataset.i];
    const i = STATI.indexOf(c.stato);
    c.stato = STATI[(i + 1) % STATI.length];
    disegnaRilievo();
  });

  $('b-cambia').addEventListener('click', () => {
    $('cerca').value = '';
    disegnaElenco();
    mostra('s-scelta');
  });
  $('b-indietro').addEventListener('click', () => mostra('s-rilievo'));
  $('cerca').addEventListener('input', e => disegnaElenco(e.target.value));
  $('elenco').addEventListener('click', e => {
    const b = e.target.closest('.voce');
    if (!b) return;
    const linea = linee.find(l => l.id === b.dataset.id);
    rilievo.linea = linea;
    rilievo.linea_id = linea.id;
    rilievo.stati = statiIniziali(linea);
    disegnaRilievo();
    mostra('s-rilievo');
  });

  $('b-vocale').addEventListener('click', alternaVocale);
  $('b-salva').addEventListener('click', salva);
  $('b-sincronizza').addEventListener('click', provaSincronizzare);
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
  seguiPosizione();
  aggiornaCoda();
  provaSincronizzare();
}

async function avvia() {
  collega();
  $('modulo-accesso').addEventListener('submit', accedi);
  $('b-esci').addEventListener('click', async () => {
    const rimasti = (await inCoda()).filter(r => r.stato !== 'inviato').length;
    if (rimasti && !confirm(
      `Ci sono ${rimasti} rilievi non ancora inviati. Uscendo restano sul telefono `
      + `ma non partiranno finché non rientri. Esci lo stesso?`)) return;
    esci();
    mostra('s-accesso');
  });

  if (autenticato()) await apriApp();
  else mostra('s-accesso');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

avvia();
