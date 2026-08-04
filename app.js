/* =========================================================
   Casa — contas do mês  (v2)
   Vanilla JS, sem dependências. Local + sincronização Supabase.
   ========================================================= */

const CFG = window.CASA_CONFIG || {};
const PUBKEY = CFG.SUPABASE_ANON_KEY || CFG.SUPABASE_PUBLISHABLE_KEY || '';
const CLOUD = !!(CFG.SUPABASE_URL && PUBKEY);
const DOC_ID = CFG.DOC_ID || 'casa';
const LS_DATA = 'casa.data.v1';
const LS_SESSION = 'casa.session.v1';

/* ---------- constantes ---------- */
const CATS = {
  out: ['Casa', 'Alimentação', 'Transportes', 'Contas', 'Saúde', 'Lazer', 'Compras', 'Casamento', 'Outros'],
  in:  ['Salário', 'Extra', 'Reembolso', 'Prenda', 'Juros', 'Outros']
};
const WHO = ['Fred', 'Bea', 'Casa'];
const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DOW = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
const APP_VERSION = '2.0';
const MAXDAYS = 20000;   // limite do cálculo diário de juros

/* ---------- helpers ---------- */
const $ = (s) => document.querySelector(s);
const pad = (n) => String(n).padStart(2, '0');
const ymOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ymParts = (ym) => ({ y: +ym.slice(0, 4), m: +ym.slice(5, 7) });
const daysInMonth = (ym) => { const { y, m } = ymParts(ym); return new Date(y, m, 0).getDate(); };
const firstDowMon = (ym) => { const { y, m } = ymParts(ym); return (new Date(y, m - 1, 1).getDay() + 6) % 7; };
const ymAdd = (ym, d) => { const { y, m } = ymParts(ym); return ymOf(new Date(y, m - 1 + d, 1)); };
const ymLabel = (ym) => { const { y, m } = ymParts(ym); return `${MESES[m - 1]} ${y}`; };
const parseISO = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const eur = (n) => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(n || 0);
const short = (n) => { const a = Math.abs(n); return a >= 1000 ? (n / 1000).toFixed(a >= 10000 ? 0 : 1).replace('.', ',') + 'k' : String(Math.round(n)); };
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => Math.abs(parseFloat(String(v).replace(',', '.')) || 0);
const rate = (v) => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : 0; };

/* ---------- estado ---------- */
const NOW = new Date();
const S = {
  data: { v: 2, txs: [], skips: {}, accounts: [], settings: { justifyOver: 20 } },
  ym: ymOf(NOW),
  todayYm: ymOf(NOW),
  todayDay: NOW.getDate(),
  todayISO: isoOf(NOW),
  tab: 'cal',
  selDay: null,
  layer: null,
  form: null, acct: null, confirm: null,
  filter: { cat: null, acc: null, who: null },
  showFilters: false,
  session: null,
  sync: CLOUD ? 'off' : 'local',
  syncMsg: ''
};

/* =========================================================
   Migração e modelo
   ========================================================= */

function migrate(d) {
  d = d || {};
  const doc = {
    v: 2,
    txs: Array.isArray(d.txs) ? d.txs : [],
    skips: d.skips || {},
    accounts: Array.isArray(d.accounts) ? d.accounts : [],
    settings: Object.assign({ justifyOver: 20 }, d.settings || {})
  };
  if (!doc.accounts.length) {
    doc.accounts.push({
      id: 'acc_default', name: 'Conta corrente', type: 'corrente',
      initial: 0, initialDate: isoOf(NOW), annual: 0, tax: 0,
      deleted: false, updatedAt: Date.now()
    });
  }
  const first = doc.accounts.find((a) => !a.deleted) || doc.accounts[0];
  for (const t of doc.txs) {
    if (!t.acc) t.acc = first.id;
    if (t.note === undefined) t.note = '';
    if (t.kind !== 'in' && t.kind !== 'out' && t.kind !== 'transfer') t.kind = 'out';
  }
  return doc;
}

const accounts = () => S.data.accounts.filter((a) => !a.deleted);
const accById = (id) => S.data.accounts.find((a) => a.id === id);
const accName = (id) => { const a = accById(id); return a ? a.name : 'conta apagada'; };
const activeTxs = () => S.data.txs.filter((t) => !t.deleted);

function occurrences(ym) {
  const dim = daysInMonth(ym);
  const list = [];
  for (const t of activeTxs()) {
    if (t.mode === 'once') {
      if (t.ym === ym) list.push({ t, day: Math.min(t.day, dim), occId: t.id, fixo: false });
    } else if (t.ym <= ym && (!t.endYm || ym <= t.endYm) && !S.data.skips[t.id + '|' + ym]) {
      list.push({ t, day: Math.min(t.day, dim), occId: t.id + '|' + ym, fixo: true });
    }
  }
  return list.sort((a, b) => a.day - b.day || b.t.amount - a.t.amount);
}

function applyFilter(list) {
  const f = S.filter;
  return list.filter((o) =>
    (!f.cat || o.t.cat === f.cat) &&
    (!f.acc || o.t.acc === f.acc || o.t.accTo === f.acc) &&
    (!f.who || o.t.who === f.who));
}
const filterOn = () => !!(S.filter.cat || S.filter.acc || S.filter.who);

function totals(occs) {
  let inc = 0, exp = 0, fixIn = 0, fixOut = 0;
  for (const o of occs) {
    if (o.t.kind === 'in') { inc += o.t.amount; if (o.fixo) fixIn += o.t.amount; }
    else if (o.t.kind === 'out') { exp += o.t.amount; if (o.fixo) fixOut += o.t.amount; }
  }
  return { inc, exp, net: inc - exp, fixIn, fixOut };
}

function merge(a, b) {
  const pick = (xa, xb) => {
    const m = new Map();
    for (const it of [...(xa || []), ...(xb || [])]) {
      const cur = m.get(it.id);
      if (!cur || (it.updatedAt || 0) > (cur.updatedAt || 0)) m.set(it.id, it);
    }
    return [...m.values()];
  };
  const sa = a.settings || {}, sb = b.settings || {};
  return {
    v: 2,
    txs: pick(a.txs, b.txs),
    accounts: pick(a.accounts, b.accounts),
    skips: Object.assign({}, a.skips || {}, b.skips || {}),
    settings: (sb.updatedAt || 0) >= (sa.updatedAt || 0) ? sb : sa
  };
}

/* ---------- movimentos por conta e por data ---------- */

function ledgerIndex() {
  const all = activeTxs();
  if (!all.length) return {};
  let minYm = all.reduce((a, x) => (x.ym < a ? x.ym : a), all[0].ym);
  for (const a of accounts()) { const ym = (a.initialDate || S.todayISO).slice(0, 7); if (ym < minYm) minYm = ym; }
  const idx = {};
  const put = (acc, iso, v) => { (idx[acc] || (idx[acc] = {}))[iso] = (idx[acc][iso] || 0) + v; };
  let cur = minYm, guard = 0;
  while (cur <= S.todayYm && guard++ < 600) {
    for (const o of occurrences(cur)) {
      const iso = `${cur}-${pad(o.day)}`;
      if (iso > S.todayISO) continue;                 // futuro não conta para o saldo
      const t = o.t;
      if (t.kind === 'in') put(t.acc, iso, t.amount);
      else if (t.kind === 'out') put(t.acc, iso, -t.amount);
      else { put(t.acc, iso, -t.amount); if (t.accTo) put(t.accTo, iso, t.amount); }
    }
    cur = ymAdd(cur, 1);
  }
  return idx;
}

/* saldo e juros de uma conta até hoje.
   Os movimentos anteriores à data do saldo inicial são ignorados: presume-se
   que já estão refletidos no valor introduzido. */
function accountState(acc, idx) {
  const moves = idx[acc.id] || {};
  const from = acc.initialDate || S.todayISO;
  let bal = acc.initial || 0, interest = 0, interestYear = 0;

  if (acc.type !== 'poupanca' || !(acc.annual > 0)) {
    for (const k in moves) if (k >= from) bal += moves[k];
    return { bal, interest: 0, interestYear: 0 };
  }

  const daily = (acc.annual / 100) / 365;
  const net = 1 - (acc.tax || 0) / 100;
  const yearStart = NOW.getFullYear() + '-01-01';
  const end = parseISO(S.todayISO);
  const d = parseISO(from);
  let n = 0, first = true;

  while (d <= end && n++ < MAXDAYS) {
    const k = isoOf(d);
    if (!first) {
      const j = bal * daily * net;
      bal += j; interest += j;
      if (k >= yearStart) interestYear += j;
    }
    if (moves[k]) bal += moves[k];
    first = false;
    d.setDate(d.getDate() + 1);
  }
  return { bal, interest, interestYear };
}

const effectiveRate = (a) => (Math.pow(1 + (a.annual / 100) / 365 * (1 - (a.tax || 0) / 100), 365) - 1) * 100;

/* =========================================================
   Persistência
   ========================================================= */

function loadLocal() {
  try { const raw = localStorage.getItem(LS_DATA); if (raw) S.data = migrate(JSON.parse(raw)); }
  catch (e) { S.data = migrate(null); }
  if (!S.data.accounts) S.data = migrate(S.data);
  try { const s = localStorage.getItem(LS_SESSION); if (s) S.session = JSON.parse(s); } catch (e) {}
}
function saveLocal() {
  try { localStorage.setItem(LS_DATA, JSON.stringify(S.data)); }
  catch (e) { toast('sem espaço para gravar'); }
}
function meName() {
  const em = ((S.session && S.session.email) || '').toLowerCase();
  const map = CFG.USERS || {};
  for (const k in map) if (k.toLowerCase() === em) return map[k];
  return 'Casa';
}
function saveSession(s) {
  S.session = s;
  if (s) localStorage.setItem(LS_SESSION, JSON.stringify(s));
  else localStorage.removeItem(LS_SESSION);
}

async function sbAuth(grant, body) {
  const r = await fetch(`${CFG.SUPABASE_URL}/auth/v1/token?grant_type=${grant}`, {
    method: 'POST',
    headers: { apikey: PUBKEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.msg || j.message || 'Falha na autenticação');
  return { access_token: j.access_token, refresh_token: j.refresh_token, email: (j.user && j.user.email) || '' };
}
async function login(email, password) {
  saveSession(await sbAuth('password', { email: email.trim(), password }));
  await sync(true);
}
async function sbRest(path, opts = {}, retry = true) {
  const headers = Object.assign({
    apikey: PUBKEY, Authorization: 'Bearer ' + S.session.access_token, 'Content-Type': 'application/json'
  }, opts.headers || {});
  const r = await fetch(CFG.SUPABASE_URL + path, Object.assign({}, opts, { headers }));
  if (r.status === 401 && retry && S.session && S.session.refresh_token) {
    saveSession(await sbAuth('refresh_token', { refresh_token: S.session.refresh_token }));
    return sbRest(path, opts, false);
  }
  return r;
}

let syncing = false;
async function sync(force) {
  if (!CLOUD || !S.session) { S.sync = CLOUD ? 'off' : 'local'; paint(); return; }
  if (syncing && !force) return;
  syncing = true; S.sync = 'busy'; paintBanner();
  try {
    const r = await sbRest(`/rest/v1/ledger_doc?id=eq.${encodeURIComponent(DOC_ID)}&select=data`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const rows = await r.json();
    const remote = migrate(rows[0] && rows[0].data ? rows[0].data : null);
    const merged = merge(remote, S.data);
    const changed = JSON.stringify(merged) !== JSON.stringify(remote);
    S.data = merged; saveLocal();
    if (changed) {
      const p = await sbRest('/rest/v1/ledger_doc', {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ id: DOC_ID, data: merged, updated_at: new Date().toISOString() })
      });
      if (!p.ok) throw new Error('HTTP ' + p.status);
    }
    S.sync = 'ok'; S.syncMsg = new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    S.sync = 'err'; S.syncMsg = navigator.onLine ? (e.message || 'erro') : 'sem rede';
  } finally { syncing = false; paint(); }
}

let syncTimer = null;
function mutate(fn) {
  fn(); saveLocal(); paint();
  if (CLOUD && S.session) { clearTimeout(syncTimer); syncTimer = setTimeout(() => sync(true), 600); }
}
const stamp = (o) => { o.updatedAt = Date.now(); return o; };

/* =========================================================
   Ações
   ========================================================= */

function needsNote(f) {
  return f.kind === 'out' && num(f.amount) >= (S.data.settings.justifyOver || 0);
}

function saveTx(f) {
  const amount = num(f.amount);
  if (!amount) return;
  if (needsNote(f) && !(f.note || '').trim()) { toast('falta a justificação'); return; }
  if (f.kind === 'transfer' && (!f.accTo || f.accTo === f.acc)) { toast('escolhe a conta de destino'); return; }

  mutate(() => {
    if (f.editId) {
      const t = S.data.txs.find((x) => x.id === f.editId);
      if (!t) return;
      Object.assign(t, {
        kind: f.kind, mode: f.mode, amount, label: (f.label || '').trim() || f.cat,
        cat: f.cat, who: f.who, day: Math.min(31, Math.max(1, +f.day || 1)),
        ym: f.ym, acc: f.acc, accTo: f.kind === 'transfer' ? f.accTo : null, note: (f.note || '').trim()
      });
      stamp(t);
    } else {
      S.data.txs.push(stamp({
        id: uid(), kind: f.kind, mode: f.mode, amount,
        label: (f.label || '').trim() || f.cat, cat: f.cat, who: f.who,
        day: Math.min(31, Math.max(1, +f.day || 1)), ym: f.ym, endYm: null,
        acc: f.acc, accTo: f.kind === 'transfer' ? f.accTo : null,
        note: (f.note || '').trim(), deleted: false
      }));
    }
  });
  S.layer = S.selDay != null ? 'sheet' : null; S.form = null;
  toast(f.editId ? 'guardado' : 'registado');
}

function removeOcc(o, scope) {
  mutate(() => {
    if (scope === 'one') S.data.skips[o.t.id + '|' + S.ym] = true;
    else {
      const t = S.data.txs.find((x) => x.id === o.t.id);
      if (!t) return;
      if (scope === 'future') stamp(t).endYm = ymAdd(S.ym, -1);
      else stamp(t).deleted = true;
    }
  });
  S.layer = S.selDay != null ? 'sheet' : null; S.confirm = null;
  toast('removido');
}

function saveAccount(a) {
  const name = (a.name || '').trim();
  if (!name) { toast('falta o nome'); return; }
  mutate(() => {
    if (a.id) {
      const x = accById(a.id); if (!x) return;
      Object.assign(x, { name, type: a.type, initial: rate(a.initial), initialDate: a.initialDate,
        annual: rate(a.annual), tax: rate(a.tax) });
      stamp(x);
    } else {
      S.data.accounts.push(stamp({
        id: 'acc_' + uid(), name, type: a.type, initial: rate(a.initial),
        initialDate: a.initialDate || S.todayISO, annual: rate(a.annual), tax: rate(a.tax), deleted: false
      }));
    }
  });
  S.layer = null; S.acct = null; toast('conta guardada');
}

function deleteAccount(id) {
  const used = activeTxs().some((t) => t.acc === id || t.accTo === id);
  if (used) { toast('conta com movimentos: não dá'); return; }
  if (accounts().length <= 1) { toast('tem de sobrar uma conta'); return; }
  mutate(() => { const a = accById(id); if (a) stamp(a).deleted = true; });
  S.layer = null; S.acct = null;
}

/* =========================================================
   Render
   ========================================================= */

function paint() { paintHead(); paintBanner(); paintView(); paintLayer(); }

function paintHead() {
  const { y, m } = ymParts(S.ym);
  $('#mName').textContent = MESES[m - 1];
  $('#mYear').innerHTML = y + (S.ym !== S.todayYm ? ' <button class="hoje" data-act="today">voltar a hoje</button>' : '');

  const t = totals(applyFilter(occurrences(S.ym)));
  $('#sIn').textContent = eur(t.inc);
  $('#sOut').textContent = eur(t.exp);
  const net = $('#sNet');
  net.textContent = eur(t.net);
  net.className = 'val ' + (t.net >= 0 ? 'in' : 'out');

  const dim = daysInMonth(S.ym);
  let r = '';
  for (let i = 1; i <= dim; i++)
    r += `<span class="tick${i % 5 === 0 ? ' tall' : ''}${S.ym === S.todayYm && i === S.todayDay ? ' now' : ''}"></span>`;
  $('#ruler').innerHTML = r;

  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
}

function paintBanner() {
  const b = $('#banner');
  if (!CLOUD) { b.innerHTML = `<div class="warn info">Modo local. Os dados ficam só neste telemóvel.</div>`; return; }
  if (!S.session) {
    b.innerHTML = `<div class="warn info"><span>Não estás ligado. Os dados ficam só neste aparelho.</span><button data-act="login">entrar</button></div>`;
    return;
  }
  const map = { ok: ['ok', 'sincronizado ' + S.syncMsg], busy: ['', 'a sincronizar…'], err: ['err', 'falhou: ' + S.syncMsg], off: ['off', 'offline'] };
  const [cls, txt] = map[S.sync] || ['', ''];
  const me = meName();
  b.innerHTML = `<div class="syncbar"><span><i class="led ${cls}"></i>${esc(txt)}${me !== 'Casa' ? ' · ' + esc(me) : ''}</span>
    <span><button data-act="sync">atualizar</button> · <button data-act="logout">sair</button></span></div>`;
}

function paintView() {
  $('#view').innerHTML = S.tab === 'cal' ? viewCal() : S.tab === 'acc' ? viewAcc() : viewRep();
}

/* ---------- filtros ---------- */
function filterBar() {
  const f = S.filter;
  if (!S.showFilters) {
    return `<div class="fbar"><button data-act="filters">filtros${filterOn() ? ' ativos' : ''}</button>
      ${filterOn() ? `<button data-act="fclear">limpar</button>` : ''}</div>`;
  }
  const chip = (kind, val, txt) => `<button class="chip sm ${f[kind] === val ? 'on' : ''}" data-act="f-set" data-k="${kind}" data-v="${esc(val)}">${esc(txt)}</button>`;
  const cats = [...new Set(activeTxs().map((t) => t.cat))].sort();
  return `<div class="fpanel">
    <div class="frow"><span class="lab">Categoria</span><div class="chips">${cats.map((c) => chip('cat', c, c)).join('')}</div></div>
    <div class="frow"><span class="lab">Conta</span><div class="chips">${accounts().map((a) => chip('acc', a.id, a.name)).join('')}</div></div>
    <div class="frow"><span class="lab">Quem</span><div class="chips">${WHO.map((w) => chip('who', w, w)).join('')}</div></div>
    <div class="fbar"><button data-act="filters">fechar</button>${filterOn() ? `<button data-act="fclear">limpar tudo</button>` : ''}</div>
  </div>`;
}

/* ---------- calendário ---------- */
function viewCal() {
  const dim = daysInMonth(S.ym), lead = firstDowMon(S.ym);
  const occs = applyFilter(occurrences(S.ym));
  const byDay = {};
  for (const o of occs) {
    const d = byDay[o.day] || (byDay[o.day] = { inc: 0, exp: 0, tr: 0 });
    if (o.t.kind === 'in') d.inc += o.t.amount;
    else if (o.t.kind === 'out') d.exp += o.t.amount;
    else d.tr += o.t.amount;
  }
  const maxExp = Math.max(1, ...Object.values(byDay).map((d) => d.exp));

  let cells = '';
  for (let i = 0; i < lead; i++) cells += `<div class="cell empty"></div>`;
  for (let d = 1; d <= dim; d++) {
    const info = byDay[d];
    const h = info ? Math.round((info.exp / maxExp) * 100) : 0;
    cells += `<button class="cell${S.ym === S.todayYm && d === S.todayDay ? ' today' : ''}${S.selDay === d ? ' sel' : ''}" data-act="day" data-day="${d}">
      ${h ? `<span class="fill" style="height:${h}%"></span>` : ''}
      ${info && info.inc > 0 ? `<span class="inbar"></span>` : ''}
      ${info && info.tr > 0 ? `<span class="trdot"></span>` : ''}
      <span class="num">${d}</span>
      ${info ? `<span class="amt">${info.exp > 0 ? `<b class="o">−${short(info.exp)}</b>` : ''}${info.inc > 0 ? `<b class="i">+${short(info.inc)}</b>` : ''}</span>` : ''}
    </button>`;
  }
  const tail = (7 - ((lead + dim) % 7)) % 7;
  for (let i = 0; i < tail; i++) cells += `<div class="cell empty"></div>`;

  return `${filterBar()}
    <div class="dow">${DOW.map((d) => `<span>${d}</span>`).join('')}</div>
    <div class="grid">${cells}</div>
    <div class="legend"><span><i class="sq o"></i> saída</span><span><i class="sq i"></i> entrada</span>
      <span><i class="sq t"></i> transferência</span></div>`;
}

/* ---------- contas ---------- */
function viewAcc() {
  const idx = ledgerIndex();
  const list = accounts().map((a) => ({ a, st: accountState(a, idx) }));
  const total = list.reduce((s, x) => s + x.st.bal, 0);
  const poup = list.filter((x) => x.a.type === 'poupanca').reduce((s, x) => s + x.st.bal, 0);

  return `<div class="bignet">
      <span class="lab">Património total</span>
      <strong class="${total >= 0 ? 'in' : 'out'}">${eur(total)}</strong>
      <span class="sub">${eur(poup)} em poupanças · ${eur(total - poup)} em contas correntes</span>
    </div>

    <h4>Contas</h4>
    <div class="acclist">${list.map(({ a, st }) => `
      <div class="acccard">
        <div class="acctop">
          <div><b>${esc(a.name)}</b><span class="rowmeta">${a.type === 'poupanca' ? 'poupança' : 'conta corrente'} · desde ${esc(a.initialDate)}</span></div>
          <span class="accbal ${st.bal >= 0 ? 'in' : 'out'}">${eur(st.bal)}</span>
        </div>
        ${a.type === 'poupanca' && a.annual > 0 ? `
          <div class="accjuros">
            <span><i class="lab">taxa anual</i>${String(a.annual).replace('.', ',')}%${a.tax > 0 ? ` · imposto ${String(a.tax).replace('.', ',')}%` : ''}</span>
            <span><i class="lab">rende ao ano</i>${effectiveRate(a).toFixed(2).replace('.', ',')}% líquido</span>
            <span><i class="lab">juros ${NOW.getFullYear()}</i>${eur(st.interestYear)}</span>
            <span><i class="lab">juros desde o início</i>${eur(st.interest)}</span>
          </div>` : ''}
        <div class="fixbtns">
          <button data-act="acc-edit" data-id="${a.id}">editar</button>
          <button data-act="acc-tr" data-id="${a.id}">transferir</button>
        </div>
      </div>`).join('')}</div>
    <button class="add" data-act="acc-new">Nova conta</button>

    <h4>Regras</h4>
    <div class="acccard">
      <label class="field" style="margin:0">
        <span>Justificação obrigatória em despesas a partir de</span>
        <input id="justifyOver" inputmode="decimal" value="${esc(String(S.data.settings.justifyOver).replace('.', ','))}">
      </label>
      <p class="hint">Abaixo deste valor a justificação é opcional. Põe 0 para exigir sempre.</p>
      <button class="btn" data-act="save-settings">Guardar</button>
    </div>

    <div class="verbar">
      <span>versão ${APP_VERSION}</span>
      <button data-act="hard-reload">forçar atualização</button>
    </div>`;
}

/* ---------- relatório ---------- */
function viewRep() {
  const occs = applyFilter(occurrences(S.ym));
  const t = totals(occs);
  const prev = totals(applyFilter(occurrences(ymAdd(S.ym, -1))));

  const cat = {}, who = {}, acc = {};
  for (const o of occs) if (o.t.kind === 'out') {
    cat[o.t.cat] = (cat[o.t.cat] || 0) + o.t.amount;
    who[o.t.who] = (who[o.t.who] || 0) + o.t.amount;
    acc[o.t.acc] = (acc[o.t.acc] || 0) + o.t.amount;
  }
  const catList = Object.entries(cat).sort((a, b) => b[1] - a[1]);
  const whoList = Object.entries(who).sort((a, b) => b[1] - a[1]);
  const accList = Object.entries(acc).sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(1, ...catList.map((c) => c[1]));
  const delta = prev.exp ? ((t.exp - prev.exp) / prev.exp) * 100 : null;
  const taxa = t.inc ? (t.net / t.inc) * 100 : null;

  let acc12 = 0;
  const all = activeTxs();
  if (all.length) {
    let cur = all.reduce((a, x) => (x.ym < a ? x.ym : a), all[0].ym), guard = 0;
    while (cur <= S.ym && guard++ < 600) { acc12 += totals(applyFilter(occurrences(cur))).net; cur = ymAdd(cur, 1); }
  }
  const fixos = all.filter((x) => x.mode === 'monthly' && x.ym <= S.ym && (!x.endYm || S.ym <= x.endYm));
  const semNota = occs.filter((o) => o.t.kind === 'out' && !o.t.note);

  return `${filterBar()}
    <div class="bignet">
      <span class="lab">Saldo de ${ymLabel(S.ym).toLowerCase()}${filterOn() ? ' (filtrado)' : ''}</span>
      <strong class="${t.net >= 0 ? 'in' : 'out'}">${eur(t.net)}</strong>
      ${taxa != null ? `<span class="sub">${taxa >= 0 ? 'sobrou' : 'gastaste a mais'} ${Math.abs(taxa).toFixed(0)}% do que entrou</span>` : ''}
    </div>

    <div class="kpis">
      <div class="kpi"><span class="lab">Saídas fixas</span><b class="out">${eur(t.fixOut)}</b></div>
      <div class="kpi"><span class="lab">Saídas pontuais</span><b class="out">${eur(t.exp - t.fixOut)}</b></div>
      <div class="kpi"><span class="lab">Vs. mês anterior</span><b>${delta == null ? '—' : (delta > 0 ? '+' : '') + delta.toFixed(0) + '%'}</b></div>
      <div class="kpi"><span class="lab">Acumulado</span><b class="${acc12 >= 0 ? 'in' : 'out'}">${eur(acc12)}</b></div>
    </div>

    <h4>Onde foi o dinheiro</h4>
    ${catList.length ? `<div class="bars">${catList.map(([c, v]) => `
      <div><div class="barhead"><span>${esc(c)}</span><b>${eur(v)}</b></div>
        <div class="track"><span style="width:${(v / maxCat) * 100}%"></span></div>
        <span class="pct">${((v / (t.exp || 1)) * 100).toFixed(0)}% das saídas</span></div>`).join('')}</div>`
      : `<p class="none">Sem saídas neste mês.</p>`}

    ${accList.length ? `<h4>Por conta</h4><div class="whorow">${accList.map(([id, v]) =>
      `<div class="whocard"><span>${esc(accName(id))}</span><b>${eur(v)}</b></div>`).join('')}</div>` : ''}

    ${whoList.length ? `<h4>Por pessoa</h4><div class="whorow">${whoList.map(([w, v]) =>
      `<div class="whocard"><span>${esc(w)}</span><b>${eur(v)}</b></div>`).join('')}</div>` : ''}

    ${semNota.length ? `<h4>Despesas sem justificação</h4>
      <p class="hint">${semNota.length} movimento(s), ${eur(semNota.reduce((s, o) => s + o.t.amount, 0))} no total.</p>
      <div class="rows">${semNota.map(rowHTML).join('')}</div>` : ''}

    ${fixos.length ? `<h4>Movimentos fixos ativos</h4><div class="fixlist">${fixos.map((f) => `
      <div class="fixrow">
        <div><b>${esc(f.label)}</b><span class="rowmeta">dia ${f.day} · ${esc(f.cat)} · ${esc(accName(f.acc))}</span></div>
        <span class="rowamt ${f.kind === 'in' ? 'i' : f.kind === 'out' ? 'o' : ''}">${f.kind === 'in' ? '+' : f.kind === 'out' ? '−' : '⇄'}${eur(f.amount)}</span>
        <div class="fixbtns">
          <button data-act="endfix" data-id="${f.id}">parar aqui</button>
          <button class="danger" data-act="killfix" data-id="${f.id}">apagar</button>
        </div></div>`).join('')}</div>` : ''}

    <h4>Todos os movimentos</h4>
    ${occs.length ? `<div class="rows">${occs.map((o) => rowHTML(o, true)).join('')}</div>` : `<p class="none">Nada registado neste mês.</p>`}`;
}

function rowHTML(o, withDay) {
  const k = o.t.kind;
  const sign = k === 'in' ? '+' : k === 'out' ? '−' : '⇄';
  const cls = k === 'in' ? 'i' : k === 'out' ? 'o' : 't';
  return `<div class="row" data-act="open" data-occ="${o.occId}">
    ${withDay ? `<span class="rowday">${pad(o.day)}</span>` : `<span class="dot ${cls}"></span>`}
    <div class="rowmain">
      <div class="rowtop"><span class="rowlab">${esc(o.t.label)}</span>
        <span class="rowamt ${cls}">${sign}${eur(o.t.amount)}</span></div>
      <div class="rowmeta">${k === 'transfer' ? esc(accName(o.t.acc)) + ' → ' + esc(accName(o.t.accTo)) : esc(o.t.cat) + ' · ' + esc(accName(o.t.acc)) + ' · ' + esc(o.t.who)}${o.fixo ? '<span class="tagfix">fixo</span>' : ''}</div>
      ${o.t.note ? `<div class="note">“${esc(o.t.note)}”</div>` : ''}
    </div></div>`;
}

/* =========================================================
   Camadas
   ========================================================= */

function paintLayer() {
  const l = $('#layer');
  const body = S.layer === 'sheet' ? sheetHTML()
    : S.layer === 'form' ? formHTML()
    : S.layer === 'confirm' ? confirmHTML()
    : S.layer === 'acct' ? acctHTML()
    : S.layer === 'login' ? loginHTML() : null;
  l.innerHTML = body ? `<div class="scrim" data-act="close"></div>` + body : '';
}

function sheetHTML() {
  const items = applyFilter(occurrences(S.ym)).filter((o) => o.day === S.selDay);
  const net = items.reduce((a, o) => a + (o.t.kind === 'in' ? o.t.amount : o.t.kind === 'out' ? -o.t.amount : 0), 0);
  return `<div class="sheet">
    <div class="sheethead">
      <div><div class="sheetday">${pad(S.selDay)} ${MESES[ymParts(S.ym).m - 1].toLowerCase()}</div>
        <div class="sheetsub">${items.length ? eur(net) + ' no dia' : 'Sem movimentos'}</div></div>
      <button class="x" data-act="close">fechar</button>
    </div>
    ${items.length ? `<div class="rows">${items.map((o) => rowHTML(o)).join('')}</div>
      <p class="hint">Toca num movimento para editar.</p>` : `<p class="none">Ainda não há nada neste dia.</p>`}
    <button class="add" data-act="new-day">Adicionar neste dia</button>
  </div>`;
}

function formHTML() {
  const f = S.form;
  const dim = f.mode === 'monthly' ? 31 : daysInMonth(f.ym);
  let days = '';
  for (let d = 1; d <= dim; d++) days += `<button class="day ${f.day === d ? 'on' : ''}" data-act="f-day" data-v="${d}">${d}</button>`;
  const tr = f.kind === 'transfer';
  const must = needsNote(f);

  return `<div class="modal">
    <div class="mhead"><h3>${f.editId ? 'Editar movimento' : 'Novo movimento'}</h3><button class="x" data-act="close">fechar</button></div>

    <div class="seg three">
      <button class="segb ${f.kind === 'out' ? 'on out' : ''}" data-act="f-kind" data-v="out">Pagamento</button>
      <button class="segb ${f.kind === 'in' ? 'on in' : ''}" data-act="f-kind" data-v="in">Recebimento</button>
      <button class="segb ${tr ? 'on' : ''}" data-act="f-kind" data-v="transfer">Transferir</button>
    </div>
    <div class="seg">
      <button class="segb ${f.mode === 'once' ? 'on' : ''}" data-act="f-mode" data-v="once">Pontual</button>
      <button class="segb ${f.mode === 'monthly' ? 'on' : ''}" data-act="f-mode" data-v="monthly">Mensal</button>
    </div>

    <label class="field"><span>Valor</span>
      <input class="money" id="fAmount" inputmode="decimal" placeholder="0,00" value="${esc(f.amount)}"></label>
    <label class="field"><span>Descrição</span>
      <input id="fLabel" placeholder="${esc(tr ? 'Transferência' : f.cat)}" value="${esc(f.label)}"></label>

    ${tr ? '' : `<div class="field"><span>Categoria</span><div class="chips">
      ${CATS[f.kind].map((c) => `<button class="chip ${f.cat === c ? 'on' : ''}" data-act="f-cat" data-v="${esc(c)}">${esc(c)}</button>`).join('')}
    </div></div>`}

    <div class="field"><span>${tr ? 'De que conta' : 'Conta'}</span><div class="chips">
      ${accounts().map((a) => `<button class="chip ${f.acc === a.id ? 'on' : ''}" data-act="f-acc" data-v="${a.id}">${esc(a.name)}</button>`).join('')}
    </div></div>

    ${tr ? `<div class="field"><span>Para que conta</span><div class="chips">
      ${accounts().filter((a) => a.id !== f.acc).map((a) => `<button class="chip ${f.accTo === a.id ? 'on' : ''}" data-act="f-accto" data-v="${a.id}">${esc(a.name)}</button>`).join('')}
    </div></div>` : ''}

    ${tr ? '' : `<div class="field"><span>Quem</span><div class="chips">
      ${WHO.map((w) => `<button class="chip ${f.who === w ? 'on' : ''}" data-act="f-who" data-v="${w}">${w}</button>`).join('')}
    </div></div>`}

    ${f.kind === 'out' ? `<label class="field"><span>Justificação${must ? ' — obrigatória' : ' (opcional)'}</span>
      <textarea id="fNote" rows="2" placeholder="Porquê esta despesa?">${esc(f.note)}</textarea></label>` : ''}

    <div class="field"><span>${f.mode === 'monthly' ? 'Repete todos os meses no dia' : 'Dia'}</span>
      <div class="days">${days}</div></div>

    <div class="field"><span>${f.mode === 'monthly' ? 'A partir de' : 'Mês'}</span>
      <div class="monthpick">
        <button class="nav sm" data-act="f-mon" data-v="-1">&lsaquo;</button><b>${ymLabel(f.ym)}</b>
        <button class="nav sm" data-act="f-mon" data-v="1">&rsaquo;</button></div></div>

    ${f.editId && f.mode === 'monthly' ? `<p class="hint">É um movimento fixo: a alteração aplica-se a todos os meses.</p>` : ''}

    <button class="btn primary" data-act="f-save" ${num(f.amount) ? '' : 'disabled'}>
      ${f.editId ? 'Guardar alterações' : f.kind === 'in' ? 'Registar entrada' : f.kind === 'out' ? 'Registar saída' : 'Registar transferência'} ${num(f.amount) ? eur(num(f.amount)) : ''}
    </button>
    ${f.editId ? `<button class="btn danger" data-act="f-del">Apagar movimento</button>` : ''}
  </div>`;
}

function acctHTML() {
  const a = S.acct;
  return `<div class="modal">
    <div class="mhead"><h3>${a.id ? 'Editar conta' : 'Nova conta'}</h3><button class="x" data-act="close">fechar</button></div>
    <div class="seg">
      <button class="segb ${a.type === 'corrente' ? 'on' : ''}" data-act="a-type" data-v="corrente">Corrente</button>
      <button class="segb ${a.type === 'poupanca' ? 'on' : ''}" data-act="a-type" data-v="poupanca">Poupança</button>
    </div>
    <label class="field"><span>Nome</span><input id="aName" value="${esc(a.name)}" placeholder="Conta ordenado"></label>
    <label class="field"><span>Saldo atual</span><input id="aInitial" class="money" inputmode="decimal" value="${esc(a.initial)}"></label>
    <label class="field"><span>A partir de que dia conta este saldo</span><input id="aDate" type="date" value="${esc(a.initialDate)}"></label>
    ${a.type === 'poupanca' ? `
      <label class="field"><span>Taxa anual bruta (%)</span><input id="aAnnual" inputmode="decimal" value="${esc(a.annual)}" placeholder="2,5"></label>
      <label class="field"><span>Imposto sobre juros (%)</span><input id="aTax" inputmode="decimal" value="${esc(a.tax)}" placeholder="0"></label>
      <p class="hint">Os juros são calculados dia a dia sobre o saldo, a partir da data acima. Livret A e LDDS são isentos: deixa o imposto a 0.</p>` : ''}
    <button class="btn primary" data-act="a-save">Guardar conta</button>
    ${a.id ? `<button class="btn danger" data-act="a-del" data-id="${a.id}">Apagar conta</button>` : ''}
  </div>`;
}

function confirmHTML() {
  const o = S.confirm;
  return `<div class="modal">
    <div class="mhead"><h3>Remover “${esc(o.t.label)}”</h3><button class="x" data-act="close">fechar</button></div>
    ${o.fixo ? `<p class="hint">É um movimento fixo. Escolhe o alcance.</p>
      <button class="btn" data-act="del" data-scope="one">Só neste mês</button>
      <button class="btn" data-act="del" data-scope="future">Parar a partir deste mês</button>
      <button class="btn danger" data-act="del" data-scope="all">Apagar de todos os meses</button>`
      : `<button class="btn danger" data-act="del" data-scope="all">Apagar movimento</button>`}
    <button class="btn ghost" data-act="close">Cancelar</button>
  </div>`;
}

function loginHTML() {
  return `<div class="modal">
    <div class="mhead"><h3>Entrar</h3><button class="x" data-act="close">fechar</button></div>
    <p class="hint">Usa a conta criada no Supabase. Fica ligada neste aparelho.</p>
    <label class="field"><span>Email</span><input id="lEmail" type="email" autocomplete="username"></label>
    <label class="field"><span>Palavra-passe</span><input id="lPass" type="password" autocomplete="current-password"></label>
    <p class="hint" id="lErr" style="color:var(--out)"></p>
    <button class="btn primary" data-act="do-login">Entrar</button>
  </div>`;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(t._t); t._t = setTimeout(() => { t.hidden = true; }, 1800);
}

/* =========================================================
   Eventos
   ========================================================= */

function keepForm() {
  if (!S.form) return;
  const a = $('#fAmount'), l = $('#fLabel'), n = $('#fNote');
  if (a) S.form.amount = a.value;
  if (l) S.form.label = l.value;
  if (n) S.form.note = n.value;
}
function keepAcct() {
  if (!S.acct) return;
  const g = (id) => { const e = $(id); return e ? e.value : undefined; };
  const o = { name: g('#aName'), initial: g('#aInitial'), initialDate: g('#aDate'), annual: g('#aAnnual'), tax: g('#aTax') };
  for (const k in o) if (o[k] !== undefined) S.acct[k] = o[k];
}
function newForm(day, over) {
  const first = accounts()[0];
  return Object.assign({
    editId: null, kind: 'out', mode: 'once', amount: '', label: '', cat: CATS.out[0],
    who: meName(), day, ym: S.ym, acc: first ? first.id : null, accTo: null, note: ''
  }, over || {});
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act, v = el.dataset.v;

  switch (act) {
    case 'prev': S.ym = ymAdd(S.ym, -1); S.selDay = null; S.layer = null; paint(); break;
    case 'next': S.ym = ymAdd(S.ym, 1); S.selDay = null; S.layer = null; paint(); break;
    case 'today': S.ym = S.todayYm; paint(); break;
    case 'tab': S.tab = el.dataset.tab; S.layer = null; S.selDay = null; paint(); break;
    case 'day': S.selDay = +el.dataset.day; S.layer = 'sheet'; paintLayer(); paintView(); break;

    case 'close':
      if (S.layer === 'confirm' && S.selDay != null) { S.layer = 'sheet'; S.confirm = null; }
      else { S.layer = null; S.selDay = null; S.form = null; S.acct = null; S.confirm = null; paintView(); }
      paintLayer(); break;

    case 'filters': S.showFilters = !S.showFilters; paintView(); break;
    case 'fclear': S.filter = { cat: null, acc: null, who: null }; paint(); break;
    case 'f-set': { const k = el.dataset.k; S.filter[k] = S.filter[k] === v ? null : v; paint(); break; }

    case 'new': S.form = newForm(S.ym === S.todayYm ? S.todayDay : 1); S.layer = 'form'; paintLayer(); break;
    case 'new-day': S.form = newForm(S.selDay); S.layer = 'form'; paintLayer(); break;

    case 'open': {
      const o = applyFilter(occurrences(S.ym)).find((x) => x.occId === el.dataset.occ);
      if (!o) break;
      S.form = newForm(o.day, {
        editId: o.t.id, kind: o.t.kind, mode: o.t.mode, amount: String(o.t.amount).replace('.', ','),
        label: o.t.label, cat: o.t.cat, who: o.t.who, ym: o.t.ym, acc: o.t.acc, accTo: o.t.accTo || null, note: o.t.note || ''
      });
      S.confirm = o; S.layer = 'form'; paintLayer(); break;
    }

    case 'f-kind': keepForm(); S.form.kind = v; if (v !== 'transfer') S.form.cat = CATS[v][0]; paintLayer(); break;
    case 'f-mode': keepForm(); S.form.mode = v; paintLayer(); break;
    case 'f-cat': keepForm(); S.form.cat = v; paintLayer(); break;
    case 'f-who': keepForm(); S.form.who = v; paintLayer(); break;
    case 'f-acc': keepForm(); S.form.acc = v; if (S.form.accTo === v) S.form.accTo = null; paintLayer(); break;
    case 'f-accto': keepForm(); S.form.accTo = v; paintLayer(); break;
    case 'f-day': keepForm(); S.form.day = +v; paintLayer(); break;
    case 'f-mon': keepForm(); S.form.ym = ymAdd(S.form.ym, +v); S.form.day = Math.min(S.form.day, daysInMonth(S.form.ym)); paintLayer(); break;
    case 'f-save': keepForm(); saveTx(S.form); paint(); break;
    case 'f-del': S.layer = 'confirm'; paintLayer(); break;
    case 'del': removeOcc(S.confirm, el.dataset.scope); paint(); break;

    case 'endfix': mutate(() => { const t = S.data.txs.find((x) => x.id === el.dataset.id); if (t) stamp(t).endYm = ymAdd(S.ym, -1); }); break;
    case 'killfix': mutate(() => { const t = S.data.txs.find((x) => x.id === el.dataset.id); if (t) stamp(t).deleted = true; }); break;

    case 'acc-new': S.acct = { id: null, name: '', type: 'corrente', initial: '0', initialDate: S.todayISO, annual: '', tax: '0' }; S.layer = 'acct'; paintLayer(); break;
    case 'acc-edit': { const a = accById(el.dataset.id); if (!a) break;
      S.acct = { id: a.id, name: a.name, type: a.type, initial: String(a.initial).replace('.', ','), initialDate: a.initialDate, annual: String(a.annual || '').replace('.', ','), tax: String(a.tax || 0).replace('.', ',') };
      S.layer = 'acct'; paintLayer(); break; }
    case 'a-type': keepAcct(); S.acct.type = v; paintLayer(); break;
    case 'a-save': keepAcct(); saveAccount(S.acct); paint(); break;
    case 'a-del': deleteAccount(el.dataset.id); paint(); break;
    case 'acc-tr': S.form = newForm(S.ym === S.todayYm ? S.todayDay : 1, { kind: 'transfer', acc: el.dataset.id }); S.layer = 'form'; paintLayer(); break;

    case 'save-settings': {
      const v2 = rate($('#justifyOver').value);
      mutate(() => { S.data.settings = { justifyOver: v2, updatedAt: Date.now() }; });
      toast('regra guardada'); break;
    }

    case 'login': S.layer = 'login'; paintLayer(); break;
    case 'do-login': {
      const em = $('#lEmail').value, pw = $('#lPass').value;
      $('#lErr').textContent = 'a entrar…';
      try { await login(em, pw); S.layer = null; paint(); startPoll(); toast('ligado'); }
      catch (err) { $('#lErr').textContent = err.message; }
      break;
    }
    case 'logout': saveSession(null); S.sync = 'off'; stopPoll(); paint(); break;
    case 'sync': sync(true); break;

    case 'hard-reload': {
      toast('a repor…');
      try {
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister()));
        }
        if (window.caches) { const ks = await caches.keys(); await Promise.all(ks.map((k) => caches.delete(k))); }
      } catch (err) { /* segue na mesma */ }
      location.reload(true);
      break;
    }
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'fAmount' && S.form) {
    e.target.value = e.target.value.replace(/[^\d.,]/g, '');
    S.form.amount = e.target.value;
    const b = document.querySelector('[data-act="f-save"]');
    if (b) {
      b.disabled = !num(S.form.amount);
      const k = S.form.kind;
      b.textContent = `${S.form.editId ? 'Guardar alterações' : k === 'in' ? 'Registar entrada' : k === 'out' ? 'Registar saída' : 'Registar transferência'} ${num(S.form.amount) ? eur(num(S.form.amount)) : ''}`;
    }
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { sync(); startPoll(); } else stopPoll();
});
window.addEventListener('online', () => sync(true));

let poll = null;
function startPoll() {
  stopPoll();
  if (!CLOUD || !S.session) return;
  poll = setInterval(() => {
    if (document.visibilityState === 'visible' && S.layer !== 'form' && S.layer !== 'acct') sync();
  }, 25000);
}
function stopPoll() { if (poll) { clearInterval(poll); poll = null; } }

/* ---------- arranque ---------- */
loadLocal();
paint();
if (CLOUD && S.session) { sync(true); startPoll(); }
/* ---------- service worker: procura versões novas e recarrega sozinho ---------- */
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloading) { reloading = true; location.reload(); }
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.update();
      setInterval(() => reg.update(), 30 * 60 * 1000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update();
      });
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (sw) sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) sw.postMessage('skip-waiting');
        });
      });
    }).catch(() => {});
  });
}
