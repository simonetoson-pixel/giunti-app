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

// Quanto ci si può fidare della proposta: sotto i 60 m siamo certamente sul
// manufatto, oltre i 300 m conviene che sia l'utente a scegliere.
export function affidabilita(distanza, precisioneGps) {
  const margine = Math.max(precisioneGps || 0, 15);
  if (distanza < 60 + margine) return 'certa';
  if (distanza < 300 + margine) return 'probabile';
  return 'incerta';
}
