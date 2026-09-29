// Dal punto GPS alle linee di giunto più vicine.
//
// Il calcolo è tutto in locale sui 225 punti del censimento: in corsia
// d'emergenza il segnale è quello che è, e questa è la cosa che deve
// funzionare sempre.

// Distanza in metri. Su poche centinaia di metri la formula piana basta e
// avanza, ed è molto più veloce dell'ortodromica su tutto l'elenco.
export function metri(lat1, lon1, lat2, lon2) {
  const dy = (lat2 - lat1) * 110574;
  const dx = (lon2 - lon1) * 111320 * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  return Math.hypot(dx, dy);
}

// Le linee più vicine, dalla più vicina in poi.
export function vicine(linee, lat, lon, quante = 8) {
  return linee
    .map(l => ({ linea: l, distanza: metri(lat, lon, l.lat, l.lon) }))
    .sort((a, b) => a.distanza - b.distanza)
    .slice(0, quante);
}

// "a 34 m" / "a 1,2 km": la precisione oltre il centinaio di metri non serve.
export function distanzaLeggibile(m) {
  if (m < 1000) return `a ${Math.round(m)} m`;
  return `a ${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

// Oltre questa distanza la linea più vicina non è dove sei: è solo la linea
// più vicina, e mostrarla in cima allo schermo come se ci fossi sopra inganna.
// Dall'ufficio si vedeva la tangenziale sud di Verona a chilometri di
// distanza. Un'opera lunga misura qualche centinaio di metri e le coordinate
// vengono interpolate sul grafo, quindi un margine ci vuole — ma 150 m è
// quanto basta per stare sul manufatto, non per stare in provincia.
export const AGGANCIO_M = 150;

// Quanto ci si può fidare della proposta. Sotto i 60 m siamo certamente sul
// manufatto; oltre l'aggancio non si propone più niente e sceglie l'utente.
export function affidabilita(distanza, precisioneGps) {
  const margine = Math.max(precisioneGps || 0, 15);
  if (distanza < 60 + margine) return 'certa';
  if (distanza < AGGANCIO_M + margine) return 'probabile';
  return 'incerta';
}

// La direzione di marcia dice su quale carreggiata si sta: fermi in corsia
// d'emergenza le due carreggiate distano meno dell'errore del GPS, ma la
// rotta tenuta poco prima di fermarsi no.
export function carreggiataDallaRotta(rotta, nomi) {
  if (rotta == null || isNaN(rotta)) return null;
  const g = ((rotta % 360) + 360) % 360;
  const ha = n => nomi.find(x => x.toUpperCase() === n);
  const est = ha('EST'), ovest = ha('OVEST'), nord = ha('NORD'), sud = ha('SUD');
  if (est && ovest) return g < 180 ? est : ovest;
  if (nord && sud) return (g < 90 || g >= 270) ? nord : sud;
  return null;
}
