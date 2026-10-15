// Foto fatte fuori dall'app, aggiunte dal desktop.
//
// A volte le foto di un ponte si fanno con un altro telefono, o con una
// macchina fotografica. Si scelgono dal computer, si dice a quale linea e a
// quale carreggiata appartengono, e finiscono nell'archivio come quelle
// scattate dall'app: un rilievo con le sue foto, senza giudizio e senza note
// finche non le si aggiungono.
//
// La data e' quella dello scatto, letta dalla foto (EXIF); se la foto non ce
// l'ha — e' passata da un'app di messaggi, per esempio — si usa quella del file,
// e si puo correggere.

import { caricaFile, inserisci, scrivi, leggi } from './rete.js';

// 1600 px sul lato lungo, come le foto scattate dal telefono: bastano a vedere
// lo stato di un giunto e pesano poco.
const LATO_MAX = 1600;
const QUALITA = 0.82;

// ------------------------------------------------------------------ la data
// La data dello scatto sta nei metadati EXIF di una foto JPEG. Si legge dai
// primi byte del file: e' un piccolo formato a etichette, senza una libreria.
async function dataExif(file) {
  try {
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();
    const d = new DataView(buf);
    if (d.getUint16(0) !== 0xFFD8) return null;               // non e' un JPEG
    let o = 2;
    while (o < d.byteLength - 4) {
      const marcatore = d.getUint16(o);
      const lun = d.getUint16(o + 2);
      if (marcatore === 0xFFE1 && d.getUint32(o + 4) === 0x45786966) {   // "Exif"
        const t = o + 10;                                      // inizio dell'intestazione TIFF
        const piccolo = d.getUint16(t) === 0x4949;             // "II": byte in ordine inverso
        const u16 = x => d.getUint16(x, piccolo);
        const u32 = x => d.getUint32(x, piccolo);
        const testo = (x, n) => {
          let r = '';
          for (let k = 0; k < n; k++) { const c = d.getUint8(x + k); if (!c) break; r += String.fromCharCode(c); }
          return r;
        };
        const cerca = (ifd, etichetta) => {
          const n = u16(ifd);
          for (let k = 0; k < n; k++) {
            const voce = ifd + 2 + k * 12;
            if (u16(voce) === etichetta) return voce;
          }
          return null;
        };
        const ifd0 = t + u32(t + 4);
        const exif = cerca(ifd0, 0x8769);                      // puntatore alla parte "Exif"
        if (exif === null) return null;
        const ifdExif = t + u32(exif + 8);
        for (const etichetta of [0x9003, 0x9004]) {            // data originale, poi digitalizzata
          const voce = cerca(ifdExif, etichetta);
          if (voce === null) continue;
          const lunghezza = u32(voce + 4);
          const posto = lunghezza > 4 ? t + u32(voce + 8) : voce + 8;
          const m = testo(posto, lunghezza).match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
          if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
        }
        return null;
      }
      if ((marcatore & 0xFF00) !== 0xFF00) break;
      o += 2 + lun;
    }
  } catch { /* metadati rovinati o assenti: si usa la data del file */ }
  return null;
}

export async function dataDelloScatto(file) {
  return (await dataExif(file)) || new Date(file.lastModified || Date.now());
}

export const aaaammgg = d => {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// -------------------------------------------------------------- le immagini
export function rimpicciolisci(file) {
  return new Promise((ok, no) => {
    const img = new Image();
    img.onload = () => {
      const scala = Math.min(1, LATO_MAX / Math.max(img.width, img.height));
      const tela = document.createElement('canvas');
      tela.width = Math.round(img.width * scala);
      tela.height = Math.round(img.height * scala);
      tela.getContext('2d').drawImage(img, 0, 0, tela.width, tela.height);
      tela.toBlob(b => { URL.revokeObjectURL(img.src); b ? ok(b) : no(new Error('foto non leggibile')); },
        'image/jpeg', QUALITA);
    };
    img.onerror = () => no(new Error(`${file.name}: non e' una foto che il browser sa aprire`));
    img.src = URL.createObjectURL(file);
  });
}

// --------------------------------------------------------------- il caricamento
// Prepara le foto: legge le date e le raggruppa per giorno, una sola volta, cosi
// il pannello puo dire cosa sta per caricare.
export async function preparaFoto(files) {
  const elenco = [];
  for (const f of files) {
    if (!/^image\//.test(f.type) && !/\.(jpe?g|png|heic|webp)$/i.test(f.name)) continue;
    elenco.push({ file: f, data: await dataDelloScatto(f) });
  }
  return elenco.sort((a, b) => a.data - b.data);
}

// Carica le foto di una linea e una carreggiata. Ogni giorno e' un rilievo: le
// foto dello stesso giorno stanno insieme, come se fossero state scattate
// nella stessa uscita.
//
// Si puo ripetere se si interrompe a meta: la riga del rilievo si sovrascrive,
// i file si sovrascrivono, e una foto gia registrata non si registra due volte.
export async function caricaFotoUfficio({ lineaId, carreggiata, foto, dataForzata, nota, autore, avanzamento, ids }) {
  // `ids` tiene lo stesso codice di rilievo per ogni giorno fra un tentativo e
  // l'altro: se si interrompe a meta e si riprova, si completa lo stesso rilievo
  // invece di crearne un secondo con le stesse foto.
  ids = ids || new Map();
  const giorni = new Map();
  for (const f of foto) {
    const giorno = dataForzata || aaaammgg(f.data);
    if (!giorni.has(giorno)) giorni.set(giorno, []);
    giorni.get(giorno).push(f);
  }

  const creati = [];
  let fatte = 0;
  const totale = foto.length;
  for (const [giorno, gruppo] of giorni) {
    if (!ids.has(giorno)) ids.set(giorno, crypto.randomUUID());
    const id = ids.get(giorno);
    const cartella = `${lineaId.replace(/[^\w-]/g, '_')}/${id}`;
    await scrivi('rilievi', {
      id, linea_id: lineaId, carreggiata: carreggiata || null, data: giorno,
      colore: null, nota: (nota || '').trim() || null, autore: autore || null,
    }, 'id');

    const presenti = new Set((await leggi(`foto?rilievo_id=eq.${id}&select=path`)).map(f => f.path));
    const caricate = [];
    for (let n = 0; n < gruppo.length; n++) {
      if (avanzamento) avanzamento(fatte + 1, totale);
      const blob = await rimpicciolisci(gruppo[n].file);
      const path = `${cartella}-${n + 1}.jpg`;
      await caricaFile('foto', path, blob);
      let riga = null;
      if (!presenti.has(path)) {
        riga = await inserisci('foto', {
          rilievo_id: id, path, scattata_il: gruppo[n].data.toISOString(), lat: null, lon: null,
        });
      }
      caricate.push({ id: riga && riga.id, path, scattata_il: gruppo[n].data.toISOString() });
      fatte++;
    }
    creati.push({
      id, linea_id: lineaId, carreggiata: carreggiata || null, data: giorno, colore: null,
      nota: (nota || '').trim() || null, audio_path: null, lat: null, lon: null,
      creato_il: new Date().toISOString(), stati_corsie: null, foto: caricate,
    });
  }
  return creati;
}
