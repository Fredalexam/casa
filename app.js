/* =========================================================
   Casa — contas do mês
   Vanilla JS, sem dependências. Dados locais + sync Supabase.
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
  in:  ['Salário', 'Extra', 'Reembolso', 'Prenda', 'Outros']
};
const WHO = ['Fred', 'Bea', 'Casa'];
const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DOW = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];

/* ---------- helpers ---------- */
const $ = (s) => document.querySelector(s);
const pad = (n) => String(n).padStart(2, '0');
const ymOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const ymParts = (ym) => ({ y: +ym.slice(0, 4), m: +ym.slice(5, 7) });
const daysInMonth = (ym) => { const { y, m } = ymParts(ym); return new Date(y, m, 0).getDate(); };
const firstDowMon = (ym) => { const { y, m } = ymParts(ym); return (new Date(y, m - 1, 1).getDay() + 6) % 7; };
const ymAdd = (ym, d) => { const { y, m } = ymParts(ym); return ymOf(new Date(y, m - 1 + d, 1)); };
const ymLabel = (ym) => { const { y, m } = ymParts(ym); return `${MESES[m - 1]} ${y}`; };
const eur = (n) => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(n || 0);
const short = (n) => { const a = Math.abs(n); return a >= 1000 ? (n / 1000).toFixed(a >= 10000 ? 0 : 1).replace('.', ',') + 'k' : String(Math.round(n)); };
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => Math.abs(parseFloat(String(v).replace(',', '.')) || 0);

/* ---------- estado ---------- */
const now = new Date();
const S = {
  data: { txs: [], skips: {} },
  ym: ymOf(now),
  todayYm: ymOf(now),
  todayDay: now.getDate(),
  tab: 'cal',
  selDay: null,
  layer: null,          // {type:'sheet'|'form'|'confirm'|'login'}
  form: null,
  confirm: null,
  session: null,
  sync: CLOUD ? 'off' : 'local',   // local | off | ok | busy | err
  syncMsg: ''
};

/* =========================================================
   Modelo de dados
   ========================================================= */

function activeTxs() { return S.data.txs.filter((t) => !t.deleted); }

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

function totals(occs) {
  let inc = 0, exp = 0, fixIn = 0, fixOut = 0;
  for (const o of occs) {
    if (o.t.kind === 'in') { inc += o.t.amount; if (o.fixo) fixIn += o.t.amount; }
    else { exp += o.t.amount; if (o.fixo) fixOut += o.t.amount; }
  }
  return { inc, exp, net: inc - exp, fixIn, fixOut };
}

function merge(a, b) {
  const map = new Map();
  for (const t of [...(a.txs || []), ...(b.txs || [])]) {
    const cur = map.get(t.id);
    if (!cur || (t.updatedAt || 0) > (cur.updatedAt || 0)) map.set(t.id, t);
  }
  return { txs: [...map.values()], skips: Object.assign({}, a.skips || {}, b.skips || {}) };
}

/* =========================================================
   Persistência: local + Supabase
   ========================================================= */

function loadLocal() {
  try {
    const raw = localStorage.getItem(LS_DATA);
    if (raw) { const v = JSON.parse(raw); if (v && Array.isArray(v.txs)) S.data = { txs: v.txs, skips: v.skips || {} }; }
  } catch (e) { /* dados corrompidos: começa vazio */ }
  try { const s = localStorage.getItem(LS_SESSION); if (s) S.session = JSON.parse(s); } catch (e) {}
}
function saveLocal() {
  try { localStorage.setItem(LS_DATA, JSON.stringify(S.data)); }
  catch (e) { toast('sem espaço para gravar'); }
}
function meName() {
  const em = (S.session && S.session.email || '').toLowerCase();
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
  const s = await sbAuth('password', { email: email.trim(), password });
  saveSession(s);
  await sync(true);
}

async function sbRest(path, opts = {}, retry = true) {
  const headers = Object.assign({
    apikey: PUBKEY,
    Authorization: 'Bearer ' + S.session.access_token,
    'Content-Type': 'application/json'
  }, opts.headers || {});
  const r = await fetch(CFG.SUPABASE_URL + path, Object.assign({}, opts, { headers }));
  if (r.status === 401 && retry && S.session && S.session.refresh_token) {
    const s = await sbAuth('refresh_token', { refresh_token: S.session.refresh_token });
    saveSession(s);
    return sbRest(path, opts, false);
  }
  return r;
}

let syncing = false;
async function sync(force) {
  if (!CLOUD || !S.session) { S.sync = CLOUD ? 'off' : 'local'; paint(); return; }
  if (syncing && !force) return;
  syncing = true;
  S.sync = 'busy'; paintBanner();
  try {
    const r = await sbRest(`/rest/v1/ledger_doc?id=eq.${encodeURIComponent(DOC_ID)}&select=data`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const rows = await r.json();
    const remote = rows[0] && rows[0].data ? rows[0].data : { txs: [], skips: {} };
    const merged = merge(remote, S.data);
    const changed = JSON.stringify(merged) !== JSON.stringify(remote);
    S.data = merged;
    saveLocal();
    if (changed) {
      const p = await sbRest('/rest/v1/ledger_doc', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ id: DOC_ID, data: merged, updated_at: new Date().toISOString() })
      });
      if (!p.ok) throw new Error('HTTP ' + p.status);
    }
    S.sync = 'ok'; S.syncMsg = new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    S.sync = 'err'; S.syncMsg = navigator.onLine ? (e.message || 'erro') : 'sem rede';
  } finally {
    syncing = false;
    paint();
  }
}

let syncTimer = null;
function mutate(fn) {
  fn();
  saveLocal();
  paint();
  if (CLOUD && S.session) { clearTimeout(syncTimer); syncTimer = setTimeout(() => sync(true), 600); }
}

function stamp(t) { t.updatedAt = Date.now(); return t; }

/* =========================================================
   Ações
   ========================================================= */

function addTx(f) {
  const amount = num(f.amount);
  if (!amount) return;
  const tx = stamp({
    id: uid(), kind: f.kind, mode: f.mode, amount,
    label: (f.label || '').trim() || f.cat, cat: f.cat, who: f.who,
    day: Math.min(31, Math.max(1, +f.day || 1)), ym: f.ym, endYm: null, deleted: false
  });
  mutate(() => { S.data.txs.push(tx); });
  S.layer = null; S.form = null;
  toast('registado');
}

function removeOcc(o, scope) {
  mutate(() => {
    if (scope === 'one') {
      S.data.skips[o.t.id + '|' + S.ym] = true;
    } else if (scope === 'future') {
      const t = S.data.txs.find((x) => x.id === o.t.id);
      if (t) stamp(t).endYm = ymAdd(S.ym, -1);
    } else {
      const t = S.data.txs.find((x) => x.id === o.t.id);
      if (t) { stamp(t).deleted = true; }
    }
  });
  S.layer = S.selDay != null ? 'sheet' : null;
  S.confirm = null;
  toast('removido');
}

function endFixo(id) {
  mutate(() => { const t = S.data.txs.find((x) => x.id === id); if (t) stamp(t).endYm = ymAdd(S.ym, -1); });
}
function killFixo(id) {
  mutate(() => { const t = S.data.txs.find((x) => x.id === id); if (t) stamp(t).deleted = true; });
}

/* =========================================================
   Render
   ========================================================= */

function paint() { paintHead(); paintBanner(); paintView(); paintLayer(); }

function paintHead() {
  const { y, m } = ymParts(S.ym);
  $('#mName').textContent = MESES[m - 1];
  $('#mYear').innerHTML = y + (S.ym !== S.todayYm ? ' <button class="hoje" data-act="today">voltar a hoje</button>' : '');

  const t = totals(occurrences(S.ym));
  $('#sIn').textContent = eur(t.inc);
  $('#sOut').textContent = eur(t.exp);
  const net = $('#sNet');
  net.textContent = eur(t.net);
  net.className = 'val ' + (t.net >= 0 ? 'in' : 'out');

  const dim = daysInMonth(S.ym);
  let r = '';
  for (let i = 1; i <= dim; i++) {
    const cls = 'tick' + (i % 5 === 0 ? ' tall' : '') + (S.ym === S.todayYm && i === S.todayDay ? ' now' : '');
    r += `<span class="${cls}"></span>`;
  }
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
  $('#view').innerHTML = S.tab === 'cal' ? viewCal() : viewRep();
}

function viewCal() {
  const dim = daysInMonth(S.ym), lead = firstDowMon(S.ym);
  const occs = occurrences(S.ym);
  const byDay = {};
  for (const o of occs) {
    const d = byDay[o.day] || (byDay[o.day] = { inc: 0, exp: 0 });
    if (o.t.kind === 'in') d.inc += o.t.amount; else d.exp += o.t.amount;
  }
  const maxExp = Math.max(1, ...Object.values(byDay).map((d) => d.exp));

  let cells = '';
  for (let i = 0; i < lead; i++) cells += `<div class="cell empty"></div>`;
  for (let d = 1; d <= dim; d++) {
    const info = byDay[d];
    const h = info ? Math.round((info.exp / maxExp) * 100) : 0;
    const cls = 'cell' + (S.ym === S.todayYm && d === S.todayDay ? ' today' : '') + (S.selDay === d ? ' sel' : '');
    cells += `<button class="${cls}" data-act="day" data-day="${d}">
      ${h ? `<span class="fill" style="height:${h}%"></span>` : ''}
      ${info && info.inc > 0 ? `<span class="inbar"></span>` : ''}
      <span class="num">${d}</span>
      ${info ? `<span class="amt">
        ${info.exp > 0 ? `<b class="o">−${short(info.exp)}</b>` : ''}
        ${info.inc > 0 ? `<b class="i">+${short(info.inc)}</b>` : ''}
      </span>` : ''}
    </button>`;
  }
  const tail = (7 - ((lead + dim) % 7)) % 7;
  for (let i = 0; i < tail; i++) cells += `<div class="cell empty"></div>`;

  return `<section>
    <div class="dow">${DOW.map((d) => `<span>${d}</span>`).join('')}</div>
    <div class="grid">${cells}</div>
    <div class="legend">
      <span><i class="sq o"></i> saída</span>
      <span><i class="sq i"></i> entrada</span>
      <span>altura da barra = peso do gasto no mês</span>
    </div>
  </section>`;
}

function viewRep() {
  const occs = occurrences(S.ym);
  const t = totals(occs);
  const prev = totals(occurrences(ymAdd(S.ym, -1)));

  const cat = {}, who = {};
  for (const o of occs) if (o.t.kind === 'out') {
    cat[o.t.cat] = (cat[o.t.cat] || 0) + o.t.amount;
    who[o.t.who] = (who[o.t.who] || 0) + o.t.amount;
  }
  const catList = Object.entries(cat).sort((a, b) => b[1] - a[1]);
  const whoList = Object.entries(who).sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(1, ...catList.map((c) => c[1]));
  const delta = prev.exp ? ((t.exp - prev.exp) / prev.exp) * 100 : null;
  const taxa = t.inc ? (t.net / t.inc) * 100 : null;

  // acumulado desde o primeiro registo
  let acc = 0;
  const all = activeTxs();
  if (all.length) {
    let cur = all.reduce((a, x) => (x.ym < a ? x.ym : a), all[0].ym), guard = 0;
    while (cur <= S.ym && guard++ < 400) { acc += totals(occurrences(cur)).net; cur = ymAdd(cur, 1); }
  }

  const fixos = all.filter((x) => x.mode === 'monthly' && x.ym <= S.ym && (!x.endYm || S.ym <= x.endYm));

  return `<section>
    <div class="bignet">
      <span class="lab">Saldo de ${ymLabel(S.ym).toLowerCase()}</span>
      <strong class="${t.net >= 0 ? 'in' : 'out'}">${eur(t.net)}</strong>
      ${taxa != null ? `<span class="sub">${taxa >= 0 ? 'sobrou' : 'gastaste a mais'} ${Math.abs(taxa).toFixed(0)}% do que entrou</span>` : ''}
    </div>

    <div class="kpis">
      <div class="kpi"><span class="lab">Saídas fixas</span><b class="out">${eur(t.fixOut)}</b></div>
      <div class="kpi"><span class="lab">Saídas pontuais</span><b class="out">${eur(t.exp - t.fixOut)}</b></div>
      <div class="kpi"><span class="lab">Vs. mês anterior</span><b>${delta == null ? '—' : (delta > 0 ? '+' : '') + delta.toFixed(0) + '%'}</b></div>
      <div class="kpi"><span class="lab">Acumulado</span><b class="${acc >= 0 ? 'in' : 'out'}">${eur(acc)}</b></div>
    </div>

    <h4>Onde foi o dinheiro</h4>
    ${catList.length ? `<div class="bars">${catList.map(([c, v]) => `
      <div>
        <div class="barhead"><span>${esc(c)}</span><b>${eur(v)}</b></div>
        <div class="track"><span style="width:${(v / maxCat) * 100}%"></span></div>
        <span class="pct">${((v / (t.exp || 1)) * 100).toFixed(0)}% das saídas</span>
      </div>`).join('')}</div>` : `<p class="none">Sem saídas neste mês.</p>`}

    ${whoList.length ? `<h4>Por pessoa</h4><div class="whorow">${whoList.map(([w, v]) =>
      `<div class="whocard"><span>${esc(w)}</span><b>${eur(v)}</b></div>`).join('')}</div>` : ''}

    ${fixos.length ? `<h4>Movimentos fixos ativos</h4><div class="fixlist">${fixos.map((f) => `
      <div class="fixrow">
        <div><b>${esc(f.label)}</b><span class="rowmeta">dia ${f.day} · ${esc(f.cat)} · ${esc(f.who)}</span></div>
        <span class="rowamt ${f.kind === 'in' ? 'i' : 'o'}">${f.kind === 'in' ? '+' : '−'}${eur(f.amount)}</span>
        <div class="fixbtns">
          <button data-act="endfix" data-id="${f.id}">parar aqui</button>
          <button class="danger" data-act="killfix" data-id="${f.id}">apagar</button>
        </div>
      </div>`).join('')}</div>` : ''}

    <h4>Todos os movimentos</h4>
    ${occs.length ? `<div class="rows">${occs.map((o) => `
      <div class="row">
        <span class="rowday">${pad(o.day)}</span>
        <div class="rowmain">
          <div class="rowtop"><span class="rowlab">${esc(o.t.label)}</span>
            <span class="rowamt ${o.t.kind === 'in' ? 'i' : 'o'}">${o.t.kind === 'in' ? '+' : '−'}${eur(o.t.amount)}</span></div>
          <div class="rowmeta">${esc(o.t.cat)} · ${esc(o.t.who)}${o.fixo ? '<span class="tagfix">fixo</span>' : ''}</div>
        </div>
      </div>`).join('')}</div>` : `<p class="none">Nada registado neste mês.</p>`}
  </section>`;
}

/* ---------- camadas ---------- */

function paintLayer() {
  const l = $('#layer');
  if (!S.layer) { l.innerHTML = ''; return; }
  if (S.layer === 'sheet') l.innerHTML = `<div class="scrim" data-act="close"></div>` + sheetHTML();
  else if (S.layer === 'form') l.innerHTML = `<div class="scrim" data-act="close"></div>` + formHTML();
  else if (S.layer === 'confirm') l.innerHTML = `<div class="scrim" data-act="close"></div>` + confirmHTML();
  else if (S.layer === 'login') l.innerHTML = `<div class="scrim" data-act="close"></div>` + loginHTML();
}

function sheetHTML() {
  const items = occurrences(S.ym).filter((o) => o.day === S.selDay);
  const net = items.reduce((a, o) => a + (o.t.kind === 'in' ? o.t.amount : -o.t.amount), 0);
  return `<div class="sheet">
    <div class="sheethead">
      <div><div class="sheetday">${pad(S.selDay)} ${MESES[ymParts(S.ym).m - 1].toLowerCase()}</div>
      <div class="sheetsub">${items.length ? eur(net) + ' no dia' : 'Sem movimentos'}</div></div>
      <button class="x" data-act="close">fechar</button>
    </div>
    ${items.length ? `<div class="rows">${items.map((o) => `
      <div class="row">
        <span class="dot ${o.t.kind === 'in' ? 'i' : 'o'}"></span>
        <div class="rowmain">
          <div class="rowtop"><span class="rowlab">${esc(o.t.label)}</span>
            <span class="rowamt ${o.t.kind === 'in' ? 'i' : 'o'}">${o.t.kind === 'in' ? '+' : '−'}${eur(o.t.amount)}</span></div>
          <div class="rowmeta">${esc(o.t.cat)} · ${esc(o.t.who)}${o.fixo ? '<span class="tagfix">fixo</span>' : ''}</div>
        </div>
        <button class="del" data-act="ask-del" data-occ="${o.occId}" aria-label="Remover">×</button>
      </div>`).join('')}</div>` : `<p class="none">Toca em adicionar para lançar o primeiro movimento deste dia.</p>`}
    <button class="add" data-act="new-day">Adicionar neste dia</button>
  </div>`;
}

function formHTML() {
  const f = S.form;
  const dim = f.mode === 'monthly' ? 31 : daysInMonth(f.ym);
  let days = '';
  for (let d = 1; d <= dim; d++) days += `<button class="day ${f.day === d ? 'on' : ''}" data-act="f-day" data-v="${d}">${d}</button>`;
  return `<div class="modal">
    <div class="mhead"><h3>Novo movimento</h3><button class="x" data-act="close">fechar</button></div>

    <div class="seg">
      <button class="segb ${f.kind === 'out' ? 'on out' : ''}" data-act="f-kind" data-v="out">Pagamento</button>
      <button class="segb ${f.kind === 'in' ? 'on in' : ''}" data-act="f-kind" data-v="in">Recebimento</button>
    </div>
    <div class="seg">
      <button class="segb ${f.mode === 'once' ? 'on' : ''}" data-act="f-mode" data-v="once">Pontual</button>
      <button class="segb ${f.mode === 'monthly' ? 'on' : ''}" data-act="f-mode" data-v="monthly">Mensal</button>
    </div>

    <label class="field"><span>Valor</span>
      <input class="money" id="fAmount" inputmode="decimal" placeholder="0,00" value="${esc(f.amount)}"></label>
    <label class="field"><span>Descrição</span>
      <input id="fLabel" placeholder="${esc(f.cat)}" value="${esc(f.label)}"></label>

    <div class="field"><span>Categoria</span><div class="chips">
      ${CATS[f.kind].map((c) => `<button class="chip ${f.cat === c ? 'on' : ''}" data-act="f-cat" data-v="${esc(c)}">${esc(c)}</button>`).join('')}
    </div></div>

    <div class="field"><span>Quem</span><div class="chips">
      ${WHO.map((w) => `<button class="chip ${f.who === w ? 'on' : ''}" data-act="f-who" data-v="${w}">${w}</button>`).join('')}
    </div></div>

    <div class="field"><span>${f.mode === 'monthly' ? 'Repete todos os meses no dia' : 'Dia'}</span>
      <div class="days">${days}</div></div>

    <div class="field"><span>${f.mode === 'monthly' ? 'A partir de' : 'Mês'}</span>
      <div class="monthpick">
        <button class="nav sm" data-act="f-mon" data-v="-1">&lsaquo;</button>
        <b>${ymLabel(f.ym)}</b>
        <button class="nav sm" data-act="f-mon" data-v="1">&rsaquo;</button>
      </div></div>

    <button class="btn primary" data-act="f-save" ${num(f.amount) ? '' : 'disabled'}>
      ${f.kind === 'in' ? 'Registar entrada' : 'Registar saída'} ${num(f.amount) ? eur(num(f.amount)) : ''}
    </button>
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
  clearTimeout(t._t); t._t = setTimeout(() => { t.hidden = true; }, 1600);
}

/* =========================================================
   Eventos
   ========================================================= */

function keepForm() {
  const a = $('#fAmount'), l = $('#fLabel');
  if (a) S.form.amount = a.value;
  if (l) S.form.label = l.value;
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act, v = el.dataset.v;

  switch (act) {
    case 'prev': S.ym = ymAdd(S.ym, -1); S.selDay = null; S.layer = null; paint(); break;
    case 'next': S.ym = ymAdd(S.ym, 1); S.selDay = null; S.layer = null; paint(); break;
    case 'today': S.ym = S.todayYm; paint(); break;
    case 'tab': S.tab = el.dataset.tab; S.layer = null; paint(); break;
    case 'day': S.selDay = +el.dataset.day; S.layer = 'sheet'; paint(); break;
    case 'close':
      if (S.layer === 'confirm' && S.selDay != null) { S.layer = 'sheet'; S.confirm = null; }
      else { S.layer = null; S.selDay = null; S.form = null; S.confirm = null; paintView(); }
      paintLayer();
      break;

    case 'new':
    case 'new-day': {
      const day = act === 'new-day' ? S.selDay : (S.ym === S.todayYm ? S.todayDay : 1);
      S.form = { kind: 'out', mode: 'once', amount: '', label: '', cat: CATS.out[0], who: meName(), day, ym: S.ym };
      S.layer = 'form'; paintLayer(); break;
    }
    case 'f-kind': keepForm(); S.form.kind = v; S.form.cat = CATS[v][0]; paintLayer(); break;
    case 'f-mode': keepForm(); S.form.mode = v; paintLayer(); break;
    case 'f-cat': keepForm(); S.form.cat = v; paintLayer(); break;
    case 'f-who': keepForm(); S.form.who = v; paintLayer(); break;
    case 'f-day': keepForm(); S.form.day = +v; paintLayer(); break;
    case 'f-mon': keepForm(); S.form.ym = ymAdd(S.form.ym, +v); S.form.day = Math.min(S.form.day, daysInMonth(S.form.ym)); paintLayer(); break;
    case 'f-save': keepForm(); addTx(S.form); paint(); break;

    case 'ask-del': {
      const occ = occurrences(S.ym).find((o) => o.occId === el.dataset.occ);
      if (occ) { S.confirm = occ; S.layer = 'confirm'; paintLayer(); }
      break;
    }
    case 'del': removeOcc(S.confirm, el.dataset.scope); paint(); break;
    case 'endfix': endFixo(el.dataset.id); break;
    case 'killfix': killFixo(el.dataset.id); break;

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
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'fAmount') {
    e.target.value = e.target.value.replace(/[^\d.,]/g, '');
    S.form.amount = e.target.value;
    const b = document.querySelector('[data-act="f-save"]');
    if (b) {
      b.disabled = !num(S.form.amount);
      b.textContent = `${S.form.kind === 'in' ? 'Registar entrada' : 'Registar saída'} ${num(S.form.amount) ? eur(num(S.form.amount)) : ''}`;
    }
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { sync(); startPoll(); } else stopPoll();
});
window.addEventListener('online', () => sync(true));

/* sondagem: enquanto a app estiver à vista, procura alterações do outro telemóvel */
let poll = null;
function startPoll() {
  stopPoll();
  if (!CLOUD || !S.session) return;
  poll = setInterval(() => {
    if (document.visibilityState === 'visible' && S.layer !== 'form') sync();
  }, 25000);
}
function stopPoll() { if (poll) { clearInterval(poll); poll = null; } }

/* =========================================================
   Arranque
   ========================================================= */

loadLocal();
paint();
if (CLOUD && S.session) { sync(true); startPoll(); }

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
