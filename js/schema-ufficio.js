// Le mappe schematiche, una linguetta per tratta, come i fogli dell'Excel.
//
// Differenza dai fogli: qui i ponti sono separati davvero, ogni riga è
// cliccabile e porta alla scheda del ponte, e accanto alle corsie si vede
// subito se su quella linea c'è una foto o un commento.

import {
  dati, COLORE, NOMI_STATO, rilieviDi, commentiDi,
} from './dati-ufficio.js';
import { apriPonte } from './scheda-ufficio.js';

const $ = id => document.getElementById(id);
let tratta = null;

function fuga(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export function prepara() {
  const tratte = [...new Set(dati.linee.map(l => l.strada))].sort();
  tratta = tratta && tratte.includes(tratta) ? tratta : tratte[0];

  $('schema-linguette').innerHTML = tratte.map(t => {
    const n = dati.linee.filter(l => l.strada === t).length;
    return `<button class="sotto-tab${t === tratta ? ' attiva' : ''}"
      data-tratta="${fuga(t)}" type="button">${fuga(t)}<span>${n}</span></button>`;
  }).join('');

  $('schema-linguette').onclick = e => {
    const b = e.target.closest('.sotto-tab');
    if (!b) return;
    tratta = b.dataset.tratta;
    prepara();
  };

  disegna();
}

function disegna() {
  const linee = dati.linee.filter(l => l.strada === tratta);
  if (!linee.length) { $('schema-corpo').innerHTML = ''; return; }

  // le colonne sono le carreggiate della tratta, nell'ordine in cui stanno
  // sul terreno: ovest e sud a sinistra, est e nord a destra
  const carreggiate = [...new Map(linee.flatMap(l => l.carreggiate)
    .map(g => [g.carreggiata, g.ordine])).entries()]
    .sort((a, b) => a[1] - b[1]).map(([nome]) => nome);

  // un blocco per ponte, separati: è la cosa che nei fogli mancava
  const blocchi = [];
  let corrente = null;
  for (const l of linee) {
    const nome = l.opera || 'Opera non indicata';
    if (!corrente || corrente.opera !== nome) {
      corrente = { opera: nome, linee: [] };
      blocchi.push(corrente);
    }
    corrente.linee.push(l);
  }

  $('schema-corpo').innerHTML = blocchi.map(b => `
    <div class="blocco-opera">
      <h3>${fuga(b.opera)}
        <span>${b.linee.length} ${b.linee.length === 1 ? 'linea' : 'linee'} ·
          km ${b.linee[0].km}${b.linee.length > 1
    ? ` &ndash; ${b.linee[b.linee.length - 1].km}` : ''}</span></h3>
      <table class="schema">
        <thead><tr><th class="km">km</th>
          ${carreggiate.map(c => `<th>${fuga(c)}</th>`).join('')}
          <th class="segni"></th></tr></thead>
        <tbody>${b.linee.map(l => riga(l, carreggiate)).join('')}</tbody>
      </table>
    </div>`).join('');

  $('schema-corpo').onclick = e => {
    const tr = e.target.closest('tr[data-linea]');
    if (tr) apriPonte(tr.dataset.linea);
  };
}

function riga(l, carreggiate) {
  const foto = rilieviDi(l.id).reduce((n, r) => n + (r.foto || []).length, 0);
  const commenti = commentiDi(l.id).length;
  const rilievi = rilieviDi(l.id).length;

  const celle = carreggiate.map(nome => {
    const g = l.carreggiate.find(x => x.carreggiata === nome);
    if (!g) return '<td class="assente"></td>';
    const meta = [g.modello, g.anno].filter(Boolean).join(' · ');
    return `<td>
      <div class="strisce">${g.corsie.map(c => `
        <span class="corsia" style="background:${COLORE(c.stato)}"
              title="${fuga(c.corsia)}: ${NOMI_STATO[c.stato] || 'nessun dato'}">
          ${fuga(c.corsia)}</span>`).join('')}</div>
      <div class="meta">${fuga(meta)}${g.corretto ? ' <i title="corretto in ufficio">✎</i>' : ''}</div>
    </td>`;
  }).join('');

  return `<tr data-linea="${fuga(l.id)}">
    <td class="km mono">${l.km}</td>
    ${celle}
    <td class="segni">
      ${foto ? `<span class="segno foto" title="${foto} foto">▣ ${foto}</span>` : ''}
      ${rilievi ? `<span class="segno rilievi" title="${rilievi} rilievi">✓ ${rilievi}</span>` : ''}
      ${commenti ? `<span class="segno commenti" title="${commenti} commenti">✎ ${commenti}</span>` : ''}
    </td>
  </tr>`;
}
