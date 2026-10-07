// Connessione a Supabase: sessione, token e chiamate.
//
// L'app è pubblicata su un indirizzo pubblico, quindi la chiave che sta nel
// codice non basta a entrare: l'archivio è aperto solo a chi ha fatto
// l'accesso. Qui dentro sta tutto quello che riguarda quel confine.

const SESSIONE = 'giunti-sessione';
let conf = null;
let sessione = leggiSessione();

async function configurazione() {
  if (!conf) conf = await fetch('config.json').then(r => r.json());
  return conf;
}

function leggiSessione() {
  try {
    return JSON.parse(localStorage.getItem(SESSIONE)) || null;
  } catch { return null; }
}

function scriviSessione(s) {
  sessione = s;
  if (s) localStorage.setItem(SESSIONE, JSON.stringify(s));
  else localStorage.removeItem(SESSIONE);
}

export function autenticato() {
  return !!(sessione && sessione.refresh_token);
}

export function emailUtente() {
  return sessione && sessione.email;
}

function salvaRisposta(d) {
  scriviSessione({
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    scade: Date.now() + (d.expires_in || 3600) * 1000,
    email: d.user ? d.user.email : (sessione && sessione.email),
  });
}

export async function entra(email, password) {
  const { supabase_url, supabase_key } = await configurazione();
  const r = await fetch(`${supabase_url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: supabase_key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error_description || d.msg || 'Accesso non riuscito');
  salvaRisposta(d);
}

export function esci() {
  scriviSessione(null);
}

// Il token dura un'ora: si rinnova da solo, e se non c'è rete si usa quello
// che si ha — tanto le chiamate fallirebbero comunque e il rilievo resta in coda.
async function token() {
  if (!sessione) return null;
  if (Date.now() < sessione.scade - 60000) return sessione.access_token;
  try {
    const { supabase_url, supabase_key } = await configurazione();
    const r = await fetch(`${supabase_url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: supabase_key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: sessione.refresh_token }),
    });
    if (!r.ok) {                    // sessione scaduta davvero: si rifà l'accesso
      if (r.status === 400 || r.status === 401) scriviSessione(null);
      return sessione ? sessione.access_token : null;
    }
    salvaRisposta(await r.json());
    return sessione.access_token;
  } catch {
    return sessione.access_token;   // senza rete si tiene quello vecchio
  }
}

export async function chiama(percorso, opzioni = {}) {
  const { supabase_url, supabase_key } = await configurazione();
  const t = await token();
  const r = await fetch(`${supabase_url}${percorso}`, {
    ...opzioni,
    headers: {
      apikey: supabase_key,
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
      ...(opzioni.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  return r;
}

// x-upsert: se il file c'e' gia lo sovrascrive invece di rifiutarlo. Serve
// perche' l'invio puo interrompersi dopo aver caricato un file: al tentativo
// dopo si ricarica lo stesso, e un "esiste gia" lo bloccherebbe per sempre.
export async function caricaFile(bucket, nome, blob) {
  await chiama(`/storage/v1/object/${bucket}/${nome}`, {
    method: 'POST', body: blob,
    headers: {
      'Content-Type': blob.type || 'application/octet-stream',
      'x-upsert': 'true',
    },
  });
  return nome;
}

// I contenitori di foto e audio sono privati: per mostrarli serve un
// collegamento firmato, valido a tempo e solo per chi ha la sessione.
export async function urlFirmato(bucket, percorso, secondi = 3600) {
  const { supabase_url } = await configurazione();
  const r = await chiama(`/storage/v1/object/sign/${bucket}/${percorso}`, {
    method: 'POST',
    body: JSON.stringify({ expiresIn: secondi }),
    headers: { 'Content-Type': 'application/json' },
  });
  const { signedURL } = await r.json();
  return `${supabase_url}/storage/v1${signedURL}`;
}

export async function leggi(percorso) {
  return (await chiama(`/rest/v1/${percorso}`)).json();
}

// Legge tutte le righe, a pagine.
//
// Il database ne restituisce al massimo 1000 per richiesta, e lo fa in silenzio:
// niente errore, solo meno righe. Le corsie sono 1257, quindi sull'archivio da
// scrivania ogni carreggiata mostrava solo le prime due corsie. Qui si chiede
// a pagine finche' ne arriva meno del pieno.
//
// Il percorso deve avere un ORDER completo (le chiavi che bastano a distinguere
// due righe), altrimenti fra una pagina e l'altra le righe possono ripetersi o
// saltare.
export async function leggiTutto(percorso, pagina = 1000) {
  const tutte = [];
  for (let da = 0; ; da += pagina) {
    const r = await chiama(`/rest/v1/${percorso}`, {
      headers: { Range: `${da}-${da + pagina - 1}`, 'Range-Unit': 'items' },
    });
    const righe = await r.json();
    tutte.push(...righe);
    if (righe.length < pagina) return tutte;
  }
}

export async function inserisci(tabella, riga) {
  const r = await chiama(`/rest/v1/${tabella}`, {
    method: 'POST', body: JSON.stringify(riga),
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
  });
  return (await r.json())[0];
}

// Inserisce la riga, o la aggiorna se c'e' gia (stessa chiave). E' quello che
// rende l'invio ripetibile: un rilievo mandato a meta si puo rimandare.
export async function scrivi(tabella, riga, chiave) {
  const r = await chiama(`/rest/v1/${tabella}?on_conflict=${chiave}`, {
    method: 'POST', body: JSON.stringify(riga),
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
  });
  return (await r.json())[0];
}

// Un rilievo si completa dopo: si fotografa in corsia d'emergenza e si
// scrivono le note all'area di servizio. Quindi le righe già inviate devono
// restare modificabili.
export async function modifica(tabella, filtro, campi) {
  const r = await chiama(`/rest/v1/${tabella}?${filtro}`, {
    method: 'PATCH', body: JSON.stringify(campi),
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
  });
  return (await r.json())[0];
}

export async function cancella(tabella, filtro) {
  await chiama(`/rest/v1/${tabella}?${filtro}`, { method: 'DELETE' });
}

export async function cancellaFile(bucket, percorso) {
  await chiama(`/storage/v1/object/${bucket}/${percorso}`, { method: 'DELETE' });
}
