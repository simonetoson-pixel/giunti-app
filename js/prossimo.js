// Il ponte successivo, e l'avviso a voce.
//
// Dopo aver fotografato l'ultima linea di un ponte, la fascia in alto deve dire
// subito quale e' il prossimo, non la linea piu vicina — che e' ancora quella
// appena fatta. Per saperlo serve la direzione di marcia: si guida in un verso
// solo, e il "prossimo" e' quello che sta davanti.

import { carreggiataDallaRotta } from './vicini.js';

const MS_RECENTE = 10 * 60 * 1000;      // una rotta presa a velocita' di marcia vale dieci minuti

// scarto fra due direzioni, da 0 a 180 gradi
export function scartoGradi(a, b) {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180);
}

// In che verso cresce la chilometrica rispetto a come si sta andando:
//   +1  si va verso i km crescenti, -1 verso i decrescenti, null non si sa.
//
// Primo indizio, la carreggiata: la linea porta la direzione in cui cresce la
// chilometrica (`rotta`), e si sa quale carreggiata viaggia in quel verso — est
// se la rotta e' verso est, nord se e' verso nord. Se si sta su quella si va a
// km crescenti, sull'altra a decrescenti. E' l'indizio buono: funziona anche da
// fermi in corsia d'emergenza.
//
// Secondo indizio, la rotta tenuta poco prima di fermarsi.
export function direzioneDi(linea, carreggiata, nomiStrada, rottaGps) {
  if (!linea || linea.rotta == null) return null;
  if (carreggiata) {
    const chiViaggiaAvanti = carreggiataDallaRotta(linea.rotta, nomiStrada);
    if (chiViaggiaAvanti) return carreggiata === chiViaggiaAvanti ? 1 : -1;
  }
  if (rottaGps && rottaGps.valore != null && Date.now() - rottaGps.quando <= MS_RECENTE) {
    return scartoGradi(rottaGps.valore, linea.rotta) < 90 ? 1 : -1;
  }
  return null;
}

// La linea successiva a quella data, nel verso di marcia: sulla stessa strada,
// quella con la chilometrica piu vicina fra quelle che stanno davanti. Se si sa
// la carreggiata si contano solo le linee che ce l'hanno: un ponte che in est
// non ha giunti non e' "il prossimo" per chi guida in est.
export function lineaDopo(linee, linea, direzione, carreggiata) {
  if (!direzione) return null;
  let migliore = null;
  for (const l of linee) {
    if (l.strada !== linea.strada) continue;
    const salto = (l.km_m - linea.km_m) * direzione;
    if (salto <= 0) continue;                              // dietro, o alla stessa km
    if (carreggiata && !l.carreggiate.some(c => c.nome === carreggiata)) continue;
    if (!migliore || salto < migliore.salto) migliore = { linea: l, salto };
  }
  return migliore ? migliore.linea : null;
}

// ------------------------------------------------------------------- la voce
// Le sigle dei nomi non si leggono bene da sole: "F.S." diventerebbe "effe
// esse". Si scrivono per esteso.
const SIGLE = [
  // prima i nomi composti, che contengono lettere che sembrerebbero sigle
  [/\bVI\s?-\s?SCHIO\b/gi, 'Vicenza Schio'],
  [/\bVI\s?_?-?\s?TREVISO\b/gi, 'Vicenza Treviso'],
  [/\bMI\s?-\s?VE\b/gi, 'Milano Venezia'],
  [/\bF\.\s?S\.|\bFS\b/gi, 'ferrovia'],
  [/\bS\.\s?S\.?\s?(?=\d)|\bSS\s?(?=\d)/gi, 'strada statale '],
  [/\bS\.\s?R\.?\s?(?=\d)|\bSR\s?(?=\d)/gi, 'strada regionale '],
  [/\bS\.\s?P\.|\bSP\s?(?=\d)/gi, 'strada provinciale'],
  [/\bVI\s?-\s?(?=MAROLA|NORD)/gi, 'Vicenza '],
  [/\bS\.\s?(?=AGOSTINO)/gi, "Sant'"],
  [/\bSOTT\./gi, 'sottopasso'],
  [/\bVIC\./gi, 'vicinale'],
  [/\bDEV\./gi, 'deviazione'],
  [/\bPOD\./gi, 'poderale'],
  [/\bS\.\s?C\./gi, 'strada comunale'],
  [/\bCAV\b\.?/gi, 'cavalcavia'],
  [/\bTG\b\.?/gi, 'tangenziale'],
];

export function nomeParlato(opera) {
  let t = String(opera || '').split(' / ')[0];
  for (const [re, sost] of SIGLE) t = t.replace(re, sost);
  t = t.replace(/[-_]/g, ' ').replace(/\+/g, ' e ').replace(/\s+/g, ' ').replace(/[°]/g, '').toLowerCase().trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// "Tra 300 metri, fiume Tesina": la distanza si arrotonda a 50, perche una cifra
// precisa al metro, detta a voce, e' solo rumore. Se e' vicinissimo, "tra poco".
export function fraseAvviso(opera, metri) {
  const nome = nomeParlato(opera);
  if (metri < 170) return `Tra poco, ${nome}`;
  const m = Math.round(metri / 50) * 50;
  return `Tra ${m} metri, ${nome}`;
}

// La sintesi vocale e' quella del telefono: gratuita, funziona senza rete e non
// pesa niente. Su iPhone parte solo dopo che si e' toccato qualcosa nell'app,
// quindi la prima volta la si "scalda" con un tocco.
let pronta = false;
export function preparaVoce() {
  if (pronta || !('speechSynthesis' in window)) return;
  pronta = true;
  try {
    const u = new SpeechSynthesisUtterance('');
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch { /* niente voce: l'avviso resta solo scritto */ }
}

export function parla(testo) {
  if (!('speechSynthesis' in window)) return false;
  try {
    window.speechSynthesis.cancel();                       // mai due avvisi sovrapposti
    const u = new SpeechSynthesisUtterance(testo);
    u.lang = 'it-IT';
    u.rate = 0.95;
    const voci = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : [];
    const italiana = voci.find(v => /^it[-_]/i.test(v.lang));
    if (italiana) u.voice = italiana;
    window.speechSynthesis.speak(u);
    return true;
  } catch { return false; }
}

// Perche' l'avviso arrivi, l'app deve restare aperta e lo schermo acceso: un
// telefono bloccato ferma il GPS e il codice. Si chiede al sistema di non
// spegnere lo schermo, finche' l'avviso e' attivo.
let blocco = null;
export async function schermoAcceso(acceso) {
  try {
    if (acceso && 'wakeLock' in navigator && !blocco) {
      blocco = await navigator.wakeLock.request('screen');
      blocco.addEventListener('release', () => { blocco = null; });
    } else if (!acceso && blocco) {
      await blocco.release();
      blocco = null;
    }
  } catch { /* non disponibile, o negato: si va avanti senza */ }
}
