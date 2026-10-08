// Lo stato di conservazione, tratta per tratta.
//
// Per ogni tratta una barra orizzontale divisa nei quattro stati: e' una
// composizione (quanta parte dei giunti sta in ciascuno stato), e la barra
// impilata e' la forma che la mostra. Sopra tutte c'e' la rete intera, come
// riferimento.
//
// Si contano i giunti — una linea per una carreggiata — e ognuno vale la sua
// corsia peggiore, come nel resto delle statistiche: il numero di corsie non e'
// un dato che interessa.
//
// I colori sono quelli della legenda dell'Excel e non si toccano. Controllati
// con lo strumento dei colori, due cose non reggono da sole: il verde chiaro e
// il verde scuro sono vicini (soprattutto per chi vede male i colori), e verde
// chiaro e giallo hanno poco contrasto sul fondo chiaro. Per questo il colore
// non porta mai l'informazione da solo: ogni segmento ha il numero dentro
// (dove ci sta), c'e' la legenda, il passaggio del mouse dice tutto, e c'e' la
// vista a tabella. Gli stati stanno sempre nello stesso ordine, con i piu
// gravi attaccati al bordo sinistro, che e' dove il confronto fra barre e' piu
// facile.

import { dati, STATI, NOMI_STATO, COLORE, statoGiunto } from './dati-ufficio.js';

const SENZA_DATO = 'nessuno';
const ORDINE = [...STATI, SENZA_DATO];           // dal piu grave al meglio
const NOME = { ...NOMI_STATO, [SENZA_DATO]: 'Nessun dato' };

let modo = 'percentuale';                          // percentuale | numero
let vista = 'grafico';                             // grafico | tabella
let radice = null;

const pc = (n, tot) => tot ? n / tot * 100 : 0;
const formatoPc = x => x === 0 ? '0%' : x < 1 ? '<1%' : `${Math.round(x)}%`;

// ------------------------------------------------------------------ dati
function conteggi() {
  const vuoto = () => ({ totale: 0, n: Object.fromEntries(ORDINE.map(s => [s, 0])) });
  const rete = { nome: 'Tutta la rete', ...vuoto(), rete: true };
  const per = new Map();
  for (const l of dati.linee) {
    if (!per.has(l.strada)) per.set(l.strada, { nome: l.strada, ...vuoto() });
    const t = per.get(l.strada);
    for (const g of l.carreggiate) {
      const s = statoGiunto(g) || SENZA_DATO;
      t.n[s]++; t.totale++;
      rete.n[s]++; rete.totale++;
    }
  }
  // dalla tratta con piu giunti a quella con meno
  const tratte = [...per.values()].sort((a, b) => b.totale - a.totale || a.nome.localeCompare(b.nome));
  return [rete, ...tratte];
}

// --------------------------------------------------------------- disegno
function el(tag, classe, testo) {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (testo != null) e.textContent = testo;
  return e;
}

function controlli() {
  const riga = el('div', 'filtri-grafico');
  const gruppo = (etichetta, valori, corrente, cambia) => {
    const g = el('div', 'segmentato');
    g.setAttribute('role', 'group');
    g.setAttribute('aria-label', etichetta);
    for (const [v, testo] of valori) {
      const b = el('button', corrente === v ? 'attivo' : '', testo);
      b.type = 'button';
      b.setAttribute('aria-pressed', corrente === v ? 'true' : 'false');
      b.addEventListener('click', () => { cambia(v); disegna(); });
      g.appendChild(b);
    }
    return g;
  };
  riga.appendChild(gruppo('Come mostrare le barre',
    [['percentuale', 'Percentuale'], ['numero', 'Numero di giunti']], modo, v => { modo = v; }));
  riga.appendChild(gruppo('Vista',
    [['grafico', 'Grafico'], ['tabella', 'Tabella']], vista, v => { vista = v; }));
  return riga;
}

function legenda(righe) {
  const presenti = ORDINE.filter(s => s !== SENZA_DATO || righe[0].n[s] > 0);
  const l = el('div', 'legenda-grafico');
  for (const s of presenti) {
    const voce = el('span', 'voce-legenda');
    const sw = el('i', 'campione');
    sw.style.background = COLORE(s === SENZA_DATO ? null : s);
    voce.appendChild(sw);
    voce.appendChild(document.createTextNode(NOME[s]));
    l.appendChild(voce);
  }
  return l;
}

// la descrizione al passaggio del mouse: una sola, per tutti i segmenti
let tip = null;
function mostraTip(testi, x, y) {
  if (!tip) { tip = el('div', 'tip-grafico'); tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip); }
  tip.replaceChildren();
  const titolo = el('div', 'tip-titolo', testi.titolo);
  const riga = el('div', 'tip-riga');
  const k = el('i', 'campione'); k.style.background = testi.colore;
  riga.append(k, el('strong', '', testi.valore), el('span', '', ` ${testi.stato}`));
  tip.append(titolo, riga);
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  tip.style.left = `${Math.min(Math.max(8, x + 14), window.innerWidth - r.width - 8)}px`;
  tip.style.top = `${Math.min(y + 16, window.innerHeight - r.height - 8)}px`;
}
function nascondiTip() { if (tip) tip.hidden = true; }

function barra(riga, scala) {
  const traccia = el('div', 'traccia-barra');
  const b = el('div', 'barra-g');
  // in "numero" la lunghezza della barra e' proporzionale ai giunti della tratta
  b.style.width = modo === 'numero' ? `${pc(riga.totale, scala)}%` : '100%';
  for (const s of ORDINE) {
    const n = riga.n[s];
    if (!n) continue;
    const seg = el('div', 'seg');
    seg.style.flexGrow = String(n);
    seg.style.background = COLORE(s === SENZA_DATO ? null : s);
    const quota = pc(n, riga.totale);
    seg.tabIndex = 0;
    seg.setAttribute('role', 'img');
    seg.setAttribute('aria-label', `${riga.nome}, ${NOME[s].toLowerCase()}: ${n} ${n === 1 ? 'giunto' : 'giunti'}, ${formatoPc(quota)}`);
    seg.appendChild(el('span', 'seg-testo', modo === 'numero' ? String(n) : formatoPc(quota)));

    const testi = () => ({
      titolo: riga.nome, colore: COLORE(s === SENZA_DATO ? null : s),
      valore: `${n} ${n === 1 ? 'giunto' : 'giunti'} · ${formatoPc(quota)}`, stato: NOME[s].toLowerCase(),
    });
    seg.addEventListener('pointermove', e => mostraTip(testi(), e.clientX, e.clientY));
    seg.addEventListener('pointerleave', nascondiTip);
    seg.addEventListener('focus', () => {
      const r = seg.getBoundingClientRect();
      mostraTip(testi(), r.left, r.bottom);
    });
    seg.addEventListener('blur', nascondiTip);
    b.appendChild(seg);
  }
  traccia.appendChild(b);
  return traccia;
}

function grafico(righe) {
  const wrap = el('div', 'grafico-tratte');
  const scala = Math.max(...righe.map(r => r.totale));
  righe.forEach((r, i) => {
    const riga = el('div', `riga-g${r.rete ? ' rete' : ''}`);
    riga.appendChild(el('div', 'nome-g', r.nome));
    riga.appendChild(barra(r, scala));
    const tot = el('div', 'tot-g', String(r.totale));
    tot.title = 'giunti in tutto';
    riga.appendChild(tot);
    wrap.appendChild(riga);
    if (i === 0) wrap.appendChild(el('div', 'separa-g'));
  });
  wrap.appendChild(el('p', 'nota-g',
    'Ogni giunto vale quanto la sua corsia peggiore. Il numero a destra sono i giunti della tratta.'));
  return wrap;
}

// La vista a tabella: gli stessi numeri, senza dover passare il mouse su niente.
function tabella(righe) {
  const t = el('table', 'statistiche');
  const testa = el('thead');
  const tr = el('tr');
  tr.appendChild(el('th', '', 'tratta'));
  const colonne = ORDINE.filter(s => s !== SENZA_DATO || righe[0].n[s] > 0);
  for (const s of colonne) {
    const th = el('th', 'num');
    const k = el('i', 'campione'); k.style.background = COLORE(s === SENZA_DATO ? null : s);
    th.append(k, document.createTextNode(` ${NOME[s]}`));
    tr.appendChild(th);
  }
  tr.appendChild(el('th', 'num', 'giunti'));
  testa.appendChild(tr);
  t.appendChild(testa);
  const corpo = el('tbody');
  for (const r of righe) {
    const rr = el('tr', r.rete ? 'rete' : '');
    rr.appendChild(el('td', '', r.nome));
    for (const s of colonne) {
      const td = el('td', 'num');
      td.appendChild(document.createTextNode(String(r.n[s])));
      td.appendChild(el('span', 'quota', ` ${formatoPc(pc(r.n[s], r.totale))}`));
      rr.appendChild(td);
    }
    rr.appendChild(el('td', 'num', String(r.totale)));
    corpo.appendChild(rr);
  }
  t.appendChild(corpo);
  return t;
}

// Un numero dentro un segmento solo se ci sta con il suo respiro: altrimenti si
// toglie, e il valore resta nella descrizione e nella tabella. Mai tagliato.
function adattaEtichette() {
  if (!radice) return;
  radice.querySelectorAll('.seg').forEach(seg => {
    const t = seg.querySelector('.seg-testo');
    t.style.visibility = 'visible';
    if (t.offsetWidth + 10 > seg.clientWidth) t.style.visibility = 'hidden';
  });
}

function disegna() {
  if (!radice) return;
  const righe = conteggi();
  radice.replaceChildren(controlli());
  if (vista === 'grafico') {
    radice.appendChild(legenda(righe));
    radice.appendChild(grafico(righe));
    requestAnimationFrame(adattaEtichette);
  } else {
    radice.appendChild(tabella(righe));
  }
}

export function montaGraficoTratte(contenitore) {
  radice = contenitore;
  disegna();
}

window.addEventListener('resize', () => adattaEtichette());
