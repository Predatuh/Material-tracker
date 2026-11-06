/* Material Tracker v2 — client
   One state object from /api/state. Views are template strings; clicks route through data-act.
   Field actions (material moves, progress) queue offline and sync when signal returns. */
'use strict';

// ── constants ─────────────────────────────────────────────────────────
const ICON = {
  overview: '<path d="M2 19h20"/><path d="M5.5 19a6.5 6.5 0 0 1 13 0"/><path d="M12 6.5V4M5.2 9.8 3.7 8.3M18.8 9.8l1.5-1.5"/>',
  materials: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="m3 7.5 9 4.5 9-4.5M12 12v9"/>',
  trackers: '<rect x="3" y="4" width="18" height="16"/><path d="M3 9.5h18M3 15h18M9 4v16"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  drawings: '<path d="M5 3h10l4 4v14H5z"/><path d="M15 3v4h4M8 12h8M8 16h5"/>',
  setup: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
};
const svgI = (k, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${ICON[k]}</svg>`;
const LOGO = `<svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true"><defs><linearGradient id="lg" x1="0" x2="1"><stop offset="0" stop-color="#FF7A2F"/><stop offset="1" stop-color="#FFD27A"/></linearGradient></defs>
  <path d="M4 21a11 11 0 0 1 22 0z" fill="url(#lg)"/><path d="M2 21h26" stroke="#E8EEF8" stroke-width="1.6"/><path d="M6 25h18M9 28h12" stroke="#5CC8FF" stroke-width="1.6"/></svg>`;
const VIEWS = [
  { id: 'overview', name: 'Overview' }, { id: 'materials', name: 'Materials' }, { id: 'trackers', name: 'Trackers' },
  { id: 'map', name: 'Map' }, { id: 'drawings', name: 'Drawings' }, { id: 'setup', name: 'Setup' },
];
const PALETTE = ['#FFB224', '#FF7A2F', '#E5484D', '#FF5D8F', '#B07CFF', '#5C7CFF', '#5CC8FF', '#2DD4BF', '#36D399', '#A3E635', '#E8EEF8', '#8A98B3'];
const DEFAULT_STATUSES = [
  { key: 'todo', label: 'To do', color: '#3B4B68', done: false, problem: false },
  { key: 'doing', label: 'Working', color: '#FFB224', done: false, problem: false },
  { key: 'done', label: 'Done', color: '#36D399', done: true, problem: false },
  { key: 'blocked', label: 'Problem', color: '#FF5D4A', done: false, problem: true },
];
const PRESETS = [
  { key: 'strings', title: 'DC strings', sub: 'Steps on every row', type: 'row', mode: 'steps', name: 'DC string wiring', color: '#E5484D', steps: ['Pull wire', 'Terminate', 'Megger', 'Label'], fields: [{ label: 'Megger (MΩ)', type: 'number' }] },
  { key: 'trans', title: 'Transitions', sub: 'Where cable comes up', type: 'transition', mode: 'steps', name: 'Transitions', color: '#5CC8FF', steps: ['Conduit set', 'Cable pulled', 'Terminated', 'Sealed'] },
  { key: 'lbd', title: 'PB terminations', sub: 'LBD-style columns', type: 'power block', mode: 'steps', name: 'LBD', color: '#FFB224', steps: ['Stuff', 'Term', 'Stickers', 'Ground / brackets', 'Quality check', 'Quality docs'] },
  { key: 'ft', title: 'Cable footage', sub: 'Quantity against a target', type: 'power block', mode: 'qty', name: 'Homerun pull', unit: 'ft', target: 1200, color: '#B07CFF' },
  { key: 'check', title: 'Inspection', sub: 'One status each', type: 'power block', mode: 'status', name: 'Inspection', color: '#2DD4BF',
    statuses: [{ label: 'Not inspected', color: '#3B4B68' }, { label: 'Ready', color: '#5CC8FF' }, { label: 'Passed', color: '#36D399', done: true }, { label: 'Failed', color: '#FF5D4A', problem: true }] },
  { key: 'blank', title: 'Blank', sub: 'Build your own' },
];
const KIND = {
  grab:    { label: 'Grab',     verb: 'Log grab',      sub: 'from the conex', people: true, loc: true },
  used:    { label: 'Used',     verb: 'Log installed', sub: 'installed',      people: true, loc: true },
  return:  { label: 'Return',   verb: 'Log return',    sub: 'back to stock',  people: true },
  receive: { label: 'Received', verb: 'Log delivery',  sub: 'a delivery' },
  order:   { label: 'Order',    verb: 'Log order',     sub: 'on the way',     manage: true, expected: true },
  count:   { label: 'Count',    verb: 'Save count',    sub: 'set on hand',    manage: true },
};

// ── helpers ───────────────────────────────────────────────────────────
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const q = (n) => (Math.round((+n || 0) * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const byId = (arr) => Object.fromEntries(arr.map((x) => [x.id, x]));
const time = (iso) => iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
function dayLabel(iso) {
  const d = new Date(iso), t = new Date(), y = new Date(); y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}
const due = (d) => { if (!d) return ''; const x = new Date(d + 'T12:00'); return isNaN(x) ? d : x.toLocaleDateString([], { month: 'short', day: 'numeric' }); };
const pressed = (b) => `aria-pressed="${b ? 'true' : 'false'}"`;
const sw = (c) => `<span class="swatch" style="background:${esc(c)}"></span>`;
const tok = () => encodeURIComponent(local.token);

// ── state ─────────────────────────────────────────────────────────────
let S = null;
let installEvt = null;
const ui = {
  view: VIEWS.some((v) => v.id === location.hash.slice(1)) ? location.hash.slice(1) : 'overview',
  matFilter: 'all', matSearch: '',
  trId: null, trParent: '', trFilter: 'all', trSearch: '', selMode: false, sel: new Set(),
  setupType: null,
  map: { id: null, s: 1, tx: 0, ty: 0, fitted: false, editing: false, tool: 'move', poly: [], draft: null, auto: true, assignType: null, trId: '', stepId: '', dark: true, picked: null },
  panel: null,
};
const local = {
  get token() { return localStorage.getItem('mt.token') || ''; },
  set token(v) { v ? localStorage.setItem('mt.token', v) : localStorage.removeItem('mt.token'); },
  get outbox() { try { return JSON.parse(localStorage.getItem('mt.outbox') || '[]'); } catch { return []; } },
  set outbox(v) { localStorage.setItem('mt.outbox', JSON.stringify(v)); },
};

// ── network ───────────────────────────────────────────────────────────
class NetErr extends Error {}
async function api(method, url, body, { queue = false } = {}) {
  const opts = { method, headers: {} };
  if (local.token) opts.headers.Authorization = 'Bearer ' + local.token;
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let r;
  try {
    if (queue && !navigator.onLine) throw new TypeError('offline');
    r = await fetch(url, opts);
  } catch {
    if (queue) { local.outbox = [...local.outbox, { method, url, body, at: Date.now() }]; paintSync(); return { queued: true }; }
    throw new NetErr('No connection. Try again when you have signal.');
  }
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && local.token) { signOut(); throw new Error(data.error || 'Sign in again.'); }
  if (!r.ok) throw new Error(data.error || `Something went wrong (${r.status}).`);
  return data;
}
let flushing = false;
async function flushOutbox() {
  if (flushing || !local.token || !local.outbox.length || !navigator.onLine) return;
  flushing = true; let sent = 0;
  try {
    while (local.outbox.length) {
      const [item, ...rest] = local.outbox;
      try { await api(item.method, item.url, item.body); }
      catch (e) { if (e instanceof NetErr) break; toast(`A saved entry was rejected: ${e.message}`, { bad: true }); }
      local.outbox = rest; sent++;
    }
  } finally { flushing = false; }
  if (sent) { toast(`Synced ${sent} saved ${sent === 1 ? 'entry' : 'entries'}`); await refresh(); }
  paintSync();
}
async function refresh() {
  try {
    S = await api('GET', '/api/state'); S.syncedAt = Date.now(); S.offline = false; derive();
  } catch (e) {
    if (e instanceof NetErr && S) { S.offline = true; paintSync(); return; }
    if (e instanceof NetErr) { S = null; render(); return; }
    throw e;
  }
  render();
  if (ui.panel?.live) ui.panel.live();
}
async function mutate(method, url, body, { optimistic, queue = false, ok } = {}) {
  if (optimistic) { optimistic(); derive(); render(); if (ui.panel?.live) ui.panel.live(); }
  try {
    const r = await api(method, url, body, { queue });
    if (r.queued) { toast('Saved on this device. It will sync when you have signal.'); return r; }
    if (ok) toast(ok);
    await refresh();
    return r;
  } catch (e) { toast(e.message, { bad: true }); refresh().catch(() => {}); throw e; }
}

// ── derived data ──────────────────────────────────────────────────────
function derive() {
  S.TY = byId(S.types); S.L = byId(S.locations); S.TR = byId(S.trackers); S.M = byId(S.materials); S.D = byId(S.drawings);
  S.kids = {};
  for (const l of S.locations) if (l.parent_id && S.L[l.parent_id]) (S.kids[l.parent_id] ||= []).push(l.id);
  S.anc = {};
  for (const l of S.locations) { const a = []; let p = S.L[l.parent_id]; const seen = new Set(); while (p && !seen.has(p.id)) { seen.add(p.id); a.push(p.id); p = S.L[p.parent_id]; } S.anc[l.id] = a; }
  S.E = {};
  for (const e of S.entries) S.E[`${e.t}:${e.l}:${e.s}`] = e;
  S.scope = {}; S.inScope = {};
  for (const t of S.trackers) { S.scope[t.id] = scopeLocs(t); S.inScope[t.id] = new Set(S.scope[t.id].map((l) => l.id)); }
  S.roll = {};
  S.mapFor = {};
  for (const m of S.maps) if (m.location_id && !S.mapFor[m.location_id]) S.mapFor[m.location_id] = m;
  S.need = computeNeeds();
  S.manage = ['foreman', 'lead'].includes(S.me.role);
  S.crew = [...new Set([...S.users.filter((u) => u.active).map((u) => u.name), ...S.job.crew_names])].sort((a, b) => a.localeCompare(b));
  if (!S.TR[ui.trId]) ui.trId = S.trackers.find((t) => t.status !== 'done')?.id || S.trackers[0]?.id || null;
  if (!S.maps.find((m) => m.id === ui.map.id)) { ui.map.id = (S.maps.find((m) => !m.location_id) || S.maps[0])?.id || null; ui.map.fitted = false; }
  if (!S.TY[ui.setupType]) ui.setupType = S.types[0]?.id || null;
}
const typeOf = (l) => S.TY[l?.type_id] || { name: 'Location', plural: 'Locations', short: '' };
const lname = (id) => S.L[id]?.name || '—';
function scopeLocs(t) {
  const sc = t.scope || {}; const ids = new Set(sc.ids || []); const zones = new Set(sc.zones || []);
  return S.locations.filter((l) => {
    if (l.type_id !== t.type_id) return false;
    if (sc.mode === 'pick') return ids.has(l.id);
    if (sc.mode === 'parents') return S.anc[l.id].some((a) => ids.has(a));
    if (sc.mode === 'zones') { const z = l.zone || S.anc[l.id].map((a) => S.L[a].zone).find(Boolean) || ''; return zones.has(z); }
    return true;
  });
}
const statusOf = (t, key) => t.statuses.find((s) => s.key === key) || t.statuses[0];
const ent = (t, lid, sid = 0) => S.E[`${t.id}:${lid}:${sid}`];
const entStatus = (t, lid, sid = 0) => statusOf(t, ent(t, lid, sid)?.status);
const partialColor = (t) => (t.statuses.find((s, i) => i > 0 && !s.done && !s.problem) || { color: '#FFB224' }).color;
const targetOf = (t, lid) => { const e = ent(t, lid, 0); return (e && e.target != null ? e.target : t.default_target) || 0; };
function locState(t, lid, sid) {
  if (t.mode === 'steps' && !sid) {
    const sts = t.steps.map((s) => entStatus(t, lid, s.id));
    if (!sts.length) return { ...t.statuses[0], started: false };
    const prob = sts.find((s) => s.problem); if (prob) return { ...prob, started: true };
    if (sts.every((s) => s.done)) return { ...sts.find((s) => s.done), started: true };
    if (sts.some((s) => s.key !== t.statuses[0].key)) return { label: 'In progress', color: partialColor(t), done: false, problem: false, started: true, partial: true };
    return { ...t.statuses[0], started: false };
  }
  const st = entStatus(t, lid, sid || 0);
  return { ...st, started: st.key !== t.statuses[0].key };
}
function rollState(t, ancId) {
  const key = t.id + ':' + ancId; if (key in S.roll) return S.roll[key];
  const locs = S.scope[t.id].filter((l) => S.anc[l.id].includes(ancId));
  let r = null;
  if (locs.length) {
    const st = locs.map((l) => locState(t, l.id, ui.map.stepId && S.TR[ui.map.trId] === t ? +ui.map.stepId : 0));
    const done = st.filter((s) => s.done).length;
    const prob = st.find((s) => s.problem);
    if (prob) r = { ...prob, started: true, label: `${done}/${locs.length} done, problem` };
    else if (done === locs.length) r = { ...st.find((s) => s.done), started: true, label: 'All done' };
    else if (st.some((s) => s.started)) r = { color: partialColor(t), started: true, partial: true, label: `${done}/${locs.length} done` };
    else r = { ...t.statuses[0], started: false, label: `0/${locs.length}` };
    r.count = { done, total: locs.length };
  }
  return (S.roll[key] = r);
}
function mapState(t, lid, sid) {
  if (!t) return null;
  if (S.inScope[t.id].has(lid)) return locState(t, lid, sid);
  return rollState(t, lid);
}
function progress(t) {
  const locs = S.scope[t.id]; const n = locs.length;
  let pct = 0, doneLocs = 0, problems = 0;
  if (!n) return { pct: 0, doneLocs: 0, total: 0, problems: 0 };
  if (t.mode === 'qty') {
    let got = 0, tot = 0;
    for (const l of locs) { const tg = targetOf(t, l.id); const e = ent(t, l.id); got += Math.min(e?.qty || 0, tg || e?.qty || 0); tot += tg; if (locState(t, l.id).done) doneLocs++; if (locState(t, l.id).problem) problems++; }
    pct = tot ? (got / tot) * 100 : 0;
  } else if (t.mode === 'status') {
    for (const l of locs) { const s = locState(t, l.id); if (s.done) doneLocs++; if (s.problem) problems++; }
    pct = (doneLocs / n) * 100;
  } else {
    let cells = 0;
    for (const l of locs) {
      let all = true;
      for (const s of t.steps) { const st = entStatus(t, l.id, s.id); if (st.done) cells++; else all = false; if (st.problem) problems++; }
      if (all && t.steps.length) doneLocs++;
    }
    pct = t.steps.length ? (cells / (n * t.steps.length)) * 100 : 0;
  }
  return { pct: Math.round(pct), exact: pct, doneLocs, total: n, problems };
}
function computeNeeds() {
  const need = {};
  for (const t of S.trackers) {
    if (t.status === 'done' || !t.materials.length) continue;
    const locs = S.scope[t.id];
    for (const tm of t.materials) {
      let rem = 0;
      if (t.mode === 'qty') rem = locs.reduce((a, l) => a + Math.max(0, targetOf(t, l.id) - (ent(t, l.id)?.qty || 0)), 0);
      else if (t.mode === 'status') rem = locs.filter((l) => !entStatus(t, l.id).done).length;
      else if (tm.step_id) rem = locs.filter((l) => !entStatus(t, l.id, tm.step_id).done).length;
      else rem = locs.filter((l) => !t.steps.length || t.steps.some((s) => !entStatus(t, l.id, s.id).done)).length;
      need[tm.material_id] = (need[tm.material_id] || 0) + rem * tm.qty;
    }
  }
  for (const m of S.materials) need[m.id] = (need[m.id] || 0) + (m.extra_need || 0);
  return need;
}
function matInfo(m) {
  const need = S.need[m.id] || 0, avail = m.on_hand + m.out_qty + m.on_order, short = Math.max(0, need - avail);
  const low = m.reorder_point > 0 && m.on_hand < m.reorder_point;
  return { need, avail, short, low, order: Math.max(short, Math.max(0, m.reorder_point - m.on_hand - m.on_order)) };
}
function applyTxnLocal(m, kind, qty, source) {
  if (kind === 'receive') { m.on_hand += qty; if (m.on_order > 0) m.on_order = Math.max(0, m.on_order - qty); }
  else if (kind === 'grab') { m.on_hand -= qty; m.out_qty += qty; }
  else if (kind === 'return') { m.out_qty = Math.max(0, m.out_qty - qty); m.on_hand += qty; }
  else if (kind === 'used') { if (source === 'stock') m.on_hand -= qty; else m.out_qty = Math.max(0, m.out_qty - qty); m.installed += qty; }
  else if (kind === 'order') m.on_order += qty;
  else if (kind === 'count') m.on_hand = qty;
}
// drawings relevant to a location: its own, its parents', and those of trackers that cover it
function docsFor(lid, trackerIds = []) {
  const out = []; const seen = new Set();
  const add = (lk, why) => { const k = lk.drawing_id + ':' + lk.page; if (seen.has(k) || !S.D[lk.drawing_id]) return; seen.add(k); out.push({ ...lk, why }); };
  if (lid) {
    S.links.filter((lk) => lk.location_id === lid).forEach((lk) => add(lk, ''));
    for (const a of S.anc[lid] || []) S.links.filter((lk) => lk.location_id === a).forEach((lk) => add(lk, lname(a)));
  }
  for (const tid of trackerIds) S.links.filter((lk) => lk.tracker_id === tid && !lk.location_id).forEach((lk) => add(lk, S.TR[tid]?.name || ''));
  return out;
}
function docChip(lk, idx, group) {
  const d = S.D[lk.drawing_id];
  return `<button class="doc-chip" data-act="view-docs" data-g="${group}" data-i="${idx}">${svgI('drawings')}${esc(d.sheet || d.name)}${lk.page ? ` p${lk.page}` : ''}${lk.label ? ` <small>${esc(lk.label)}</small>` : ''}${lk.why ? ` <small>${esc(lk.why)}</small>` : ''}</button>`;
}
const docGroups = {}; // stash lists so chips can open the viewer with siblings as tabs

// ── shell ─────────────────────────────────────────────────────────────
function render() {
  const app = $('#app');
  if (!local.token) return renderGate();
  if (!S) { app.innerHTML = `<div class="gate"><div class="gate-card mod">${LOGO}<h1>Loading job…</h1><p class="sub">Pulling the latest from the server.</p></div></div>`; return; }
  const keep = { x: $('.matrix-wrap')?.scrollLeft, y: $('.matrix-wrap')?.scrollTop };
  const view = { overview: vOverview, materials: vMaterials, trackers: vTrackers, map: vMap, drawings: vDrawings, setup: vSetup }[ui.view] || vOverview;
  const tabs = VIEWS.map((v) => `<button class="tab" data-act="go" data-v="${v.id}" ${ui.view === v.id ? 'aria-current="page"' : ''}>${svgI(v.id)}<span>${v.name}</span></button>`).join('');
  app.innerHTML = `<header class="topbar"><div class="brand">${LOGO}<b>${esc(S.job.name || 'Material Tracker')}</b></div>
      <nav class="tabs" aria-label="Main">${tabs}</nav>
      <div class="who"><span class="sync" id="sync">${syncText()}</span><button class="me" data-act="go" data-v="setup">${esc(S.me.name)}</button></div></header>
    <main class="view">${view()}</main><nav class="dock" aria-label="Main">${tabs}</nav>`;
  if (ui.view === 'map') mountMap();
  if (ui.view === 'materials') paintBom();
  const mw = $('.matrix-wrap'); if (mw && keep.x != null) { mw.scrollLeft = keep.x; mw.scrollTop = keep.y; }
  document.title = `${VIEWS.find((v) => v.id === ui.view).name} · ${S.job.name || 'Material Tracker'}`;
}
function syncText() {
  const n = local.outbox.length;
  if (n) return `<span class="led pending"></span>${n} waiting`;
  if (S?.offline || !navigator.onLine) return `<span class="led off"></span>Offline`;
  return `<span class="led"></span>${S?.syncedAt ? new Date(S.syncedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'}`;
}
function paintSync() { const el = $('#sync'); if (el) el.innerHTML = syncText(); }
const head = (title, sub = '', tools = '') => `<div class="head"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div>${tools ? `<div class="tools">${tools}</div>` : ''}</div>`;
const emptyBox = (title, text, actions = '') => `<div class="empty mod"><b>${title}</b><p>${text}</p>${actions ? `<div class="row">${actions}</div>` : ''}</div>`;

// ── Overview ──────────────────────────────────────────────────────────
function vOverview() {
  const active = S.trackers.filter((t) => t.status !== 'done');
  let wsum = 0, psum = 0, problems = 0;
  const prog = {};
  for (const t of active) { const p = progress(t); prog[t.id] = p; wsum += p.total; psum += p.exact * p.total; problems += p.problems; }
  const overall = wsum ? psum / wsum : 0;
  const orders = S.materials.map((m) => ({ m, i: matInfo(m) })).filter((x) => x.i.order > 0).sort((a, b) => (b.i.short > 0) - (a.i.short > 0));
  const outN = Object.keys(S.out_by_person).length;
  const today = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  const arrays = active.length ? active.map((t) => {
    const p = prog[t.id]; const ty = S.TY[t.type_id];
    const groups = {};
    for (const l of S.scope[t.id]) { const g = l.parent_id && ty?.parent_type_id ? l.parent_id : 0; (groups[g] ||= []).push(l); }
    const cells = Object.entries(groups).map(([g, locs]) => `<div class="cgroup">${+g ? `<span class="gl">${esc(lname(+g))}</span>` : ''}${locs.map((l) => {
      const s = locState(t, l.id); return `<button class="pv ${locs.length < 40 ? 'big' : ''}" style="background:${s.started || s.done ? s.color : ''}" data-act="open-loc" data-id="${l.id}" data-t="${t.id}" title="${esc(l.name)}: ${esc(s.label)}" aria-label="${esc(l.name)}: ${esc(s.label)}"></button>`; }).join('')}</div>`).join('');
    return `<div class="array-t" data-act="open-tracker" data-id="${t.id}">
      <div class="array-head"><span class="stripe" style="background:${esc(t.color)}"></span>
        <div><div class="nm">${esc(t.name)}</div><div class="meta">${p.doneLocs} of ${p.total} ${esc((ty?.plural || '').toLowerCase())} done${t.due_date ? `, due ${due(t.due_date)}` : ''}${p.problems ? `, <span style="color:var(--arc)">${p.problems} problem${p.problems > 1 ? 's' : ''}</span>` : ''}${t.status === 'hold' ? ', on hold' : ''}</div></div>
        <div class="pc">${p.pct}%</div></div>
      <div class="cells">${cells || '<span class="hint">Nothing in scope yet.</span>'}</div></div>`;
  }).join('') : emptyBox('No trackers yet', 'A tracker is anything you need to follow across the site: string wiring by row, transitions, PB terminations, cable footage. Pick a starting point and adjust it.', S.manage ? '<button class="btn sun" data-act="tracker-edit">Create a tracker</button>' : '');

  const orderHtml = orders.length ? orders.slice(0, 10).map(({ m, i }) => `<div class="order-row" data-act="open-mat" data-id="${m.id}">
      <div><b>${esc(m.name)}</b></div><div class="q">${q(i.order)} ${esc(m.unit)}</div>
      <div class="sub">${i.short > 0 ? `Short ${q(i.short)} for remaining work` : `Below reorder point of ${q(m.reorder_point)}`}. ${q(m.on_hand)} on hand${m.on_order ? `, ${q(m.on_order)} on order` : ''}.</div></div>`).join('')
    : `<p class="hint">Nothing to order. Stock covers the remaining work.</p>`;
  const outHtml = outN ? Object.entries(S.out_by_person).map(([p, mats]) => `<div class="person"><div class="nm">${esc(p)}</div><div></div><div class="has chips">${Object.entries(mats).map(([mid, n]) => S.M[mid] ? `<button class="chip" data-act="open-mat" data-id="${mid}">${q(n)} ${esc(S.M[mid].unit)} <small>${esc(S.M[mid].name)}</small></button>` : '').join('')}</div></div>`).join('')
    : `<p class="hint">Nobody has material checked out.</p>`;

  return `${head(esc(S.job.name || 'Overview'), today, `${installEvt ? '<button class="btn sm" data-act="install">Install app</button>' : ''}${S.manage ? '<button class="btn sm sun" data-act="tracker-edit">New tracker</button>' : ''}`)}
  <section class="hero mod">${sunPath(overall)}
    <div class="stats">
      <div class="stat"><div class="v">${active.length}</div><div class="k">Active trackers</div></div>
      <div class="stat live"><div class="v">${S.locations.length}</div><div class="k">Locations on site</div></div>
      <div class="stat ${problems ? 'arc' : ''}"><div class="v">${problems}</div><div class="k">Open problems</div></div>
      <div class="stat ${orders.length ? 'sun' : ''}"><div class="v">${orders.length}</div><div class="k">Items to order</div></div>
      <div class="stat"><div class="v">${outN}</div><div class="k">People with material out</div></div>
      <div class="stat"><div class="v">${S.drawings.length}</div><div class="k">Drawings on file</div></div>
    </div></section>
  <div class="ov"><div>
      <section class="panel-box mod"><h2 class="sec-h">The array <small>One cell per location. Tap one to update it.</small></h2>${arrays}</section>
      <section class="panel-box mod"><h2 class="sec-h">Out with the crew</h2>${outHtml}</section>
    </div><div>
      <section class="panel-box mod"><h2 class="sec-h">Order list ${orders.length ? `<a class="btn sm" href="/api/export/order.csv?t=${tok()}">Download</a>` : ''}</h2>${orderHtml}</section>
      <section class="panel-box mod"><h2 class="sec-h">Daily log</h2>${logList(S.activity.slice(0, 40))}</section>
    </div></div>`;
}
function sunPath(pct) {
  const p = clamp(pct / 100, 0, 1), cx = 200, cy = 196, r = 168;
  const x = cx - r * Math.cos(Math.PI * p), y = cy - r * Math.sin(Math.PI * p);
  return `<svg class="sunpath" viewBox="0 0 400 230" role="img" aria-label="${Math.round(pct)}% of tracked work done">
    <defs><linearGradient id="sunGrad" x1="0" x2="1"><stop offset="0" stop-color="#FF7A2F"/><stop offset=".6" stop-color="#FFB224"/><stop offset="1" stop-color="#FFE08A"/></linearGradient>
      <radialGradient id="sunGlow"><stop offset="0" stop-color="#FFE08A"/><stop offset=".35" stop-color="#FFB224"/><stop offset="1" stop-color="#FFB224" stop-opacity="0"/></radialGradient></defs>
    <path class="arc-bg" d="M${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx + r} ${cy}"/>
    ${p > 0.002 ? `<path class="arc-fg" d="M${cx - r} ${cy} A${r} ${r} 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}"/>` : ''}
    <line class="horizon" x1="10" y1="${cy}" x2="390" y2="${cy}"/>
    <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="34" fill="url(#sunGlow)" opacity=".55"/>
    <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="10" fill="#FFD27A"/>
    <text class="pct" x="${cx}" y="${cy - 52}">${Math.round(pct)}%</text>
    <text class="cap" x="${cx}" y="${cy - 22}">of tracked work done</text>
    <text class="cap" x="${cx - r}" y="${cy + 22}" style="font-size:11px">Start</text><text class="cap" x="${cx + r}" y="${cy + 22}" style="font-size:11px">Energized</text>
  </svg>`;
}
function logList(items) {
  if (!items.length) return `<p class="hint">Nothing logged yet.</p>`;
  let last = '';
  return `<ul class="log">${items.map((a) => { const k = new Date(a.at).toDateString(); const dh = k !== last ? `<li class="day">${dayLabel(a.at)}</li>` : ''; last = k;
    return `${dh}<li><time>${time(a.at)}</time><span>${esc(a.text)}${a.by ? ` <span class="by">· ${esc(a.by)}</span>` : ''}</span></li>`; }).join('')}</ul>`;
}

// ── Materials ─────────────────────────────────────────────────────────
function vMaterials() {
  const tools = `${S.manage ? '<button class="btn sm sun" data-act="mat-edit">Add material</button><button class="btn sm" data-act="mat-import">Import CSV</button>' : ''}<a class="btn sm" href="/api/export/materials.csv?t=${tok()}">Export</a>`;
  if (!S.materials.length) return head('Materials', '', tools) + emptyBox('No materials yet', "Add what's in the conex and laydown yard, or paste a CSV from your takeoff to add everything at once.", S.manage ? '<button class="btn sun" data-act="mat-edit">Add material</button><button class="btn" data-act="mat-import">Import CSV</button>' : '');
  const c = { all: S.materials.length, short: 0, low: 0, out: 0 };
  for (const m of S.materials) { const i = matInfo(m); if (i.short > 0) c.short++; if (i.low) c.low++; if (m.out_qty > 0) c.out++; }
  const f = (k, l) => `<button data-act="mat-filter" data-f="${k}" ${pressed(ui.matFilter === k)}>${l}<span class="ct">${c[k]}</span></button>`;
  return head('Materials', `${q(Object.values(S.need).reduce((a, b) => a + (b > 0 ? 1 : 0), 0))} items needed by remaining work`, tools) + `
  <div class="toolbar"><input type="search" id="mat-search" placeholder="Search material or part number" value="${esc(ui.matSearch)}" aria-label="Search materials">
    <div class="seg" role="group" aria-label="Filter">${f('all', 'All')}${f('short', 'Short')}${f('low', 'Low')}${f('out', 'Out')}</div></div>
  <div class="tbl-wrap mod"><table class="bom"><thead><tr><th class="l">Material</th><th class="l gcol">Stock against need</th><th>On hand</th><th>Out</th><th>On order</th><th>Still need</th><th>Short</th></tr></thead><tbody id="bom"></tbody></table></div>
  <div class="legend"><span><i style="background:linear-gradient(90deg,#2E7BA8,var(--sky))"></i>On hand</span><span><i style="background:repeating-linear-gradient(135deg,var(--sky) 0 2px,transparent 2px 5px)"></i>Out with crew</span><span><i style="border:1px dashed var(--dim)"></i>On order</span><span><i style="background:repeating-linear-gradient(135deg,var(--arc) 0 3px,rgba(255,93,74,.25) 3px 6px)"></i>Short</span><span><i style="width:2px;background:var(--sun)"></i>Still needed</span></div>`;
}
function paintBom() {
  const body = $('#bom'); if (!body) return;
  const s = ui.matSearch.trim().toLowerCase();
  const rows = S.materials.filter((m) => {
    if (s && !`${m.name} ${m.part_no} ${m.category} ${m.location}`.toLowerCase().includes(s)) return false;
    const i = matInfo(m);
    return ui.matFilter === 'short' ? i.short > 0 : ui.matFilter === 'low' ? i.low : ui.matFilter === 'out' ? m.out_qty > 0 : true;
  });
  if (!rows.length) { body.innerHTML = `<tr><td class="l" colspan="7"><p class="hint">No materials match.</p></td></tr>`; return; }
  let cat = null;
  body.innerHTML = rows.map((m) => {
    const i = matInfo(m); const cc = m.category || 'Uncategorized'; const ch = cc !== cat ? `<tr class="cat"><td colspan="7">${esc(cc)}</td></tr>` : ''; cat = cc;
    const n = (v) => `<span class="n ${v ? '' : 'zero'}">${q(v)}</span><span class="u">${esc(m.unit)}</span>`;
    return `${ch}<tr class="r" data-act="open-mat" data-id="${m.id}"><td class="l"><div class="nm">${esc(m.name)}</div><div class="pn">${esc([m.part_no, m.location].filter(Boolean).join(' · '))}</div></td>
      <td class="l gcol">${gauge(m, i)}</td><td class="m-hand">${n(m.on_hand)}</td><td>${n(m.out_qty)}</td><td>${n(m.on_order)}</td><td>${n(i.need)}</td>
      <td>${i.short ? `<span class="short">${q(i.short)}</span>` : '<span class="zero">0</span>'}</td>
      <td class="m-sub">${q(m.out_qty)} out · ${q(m.on_order)} on order · ${q(i.need)} still needed${i.short ? ` · <b style="color:var(--arc)">short ${q(i.short)}</b>` : ''}</td></tr>`;
  }).join('');
}
function gauge(m, i) {
  const total = Math.max(i.need, i.avail, m.reorder_point, 1); const w = (v) => clamp((v / total) * 100, 0, 100).toFixed(2);
  return `<div class="gauge" title="${q(m.on_hand)} on hand, ${q(m.out_qty)} out, ${q(m.on_order)} on order, ${q(i.need)} still needed">
    <i class="g-hand" style="width:${w(Math.max(0, m.on_hand))}%"></i><i class="g-out" style="width:${w(m.out_qty)}%"></i><i class="g-order" style="width:${w(m.on_order)}%"></i><i class="g-short" style="width:${w(i.short)}%"></i>
    ${i.need > 0 ? `<span class="need" style="left:calc(${w(i.need)}% - 1px)"></span>` : ''}${m.reorder_point > 0 ? `<span class="rp" style="left:${w(m.reorder_point)}%"></span>` : ''}</div>`;
}

// ── Trackers ──────────────────────────────────────────────────────────
function vTrackers() {
  const tools = S.manage ? `<button class="btn sm sun" data-act="tracker-edit">New tracker</button><a class="btn sm" href="/api/export/progress.csv?t=${tok()}">Export</a>` : '';
  if (!S.locations.length) return head('Trackers', '', tools) + emptyBox('Add your locations first', 'Trackers follow work across power blocks, rows, transitions or whatever you set up. Add them in Setup.', '<button class="btn sun" data-act="go" data-v="setup">Open setup</button>');
  if (!S.trackers.length) return head('Trackers', '', tools) + emptyBox('No trackers yet', 'Start from DC strings by row, transitions, PB terminations, cable footage or an inspection checklist, then change anything.', S.manage ? '<button class="btn sun" data-act="tracker-edit">Create a tracker</button>' : '');
  const t = S.TR[ui.trId]; const ty = S.TY[t.type_id] || {}; const p = progress(t);
  const pills = S.trackers.map((x) => { const px = progress(x); return `<button class="tr-pill" data-act="pick-tracker" data-id="${x.id}" ${x.id === t.id ? 'aria-current="true"' : ''}>
    <span class="nm">${esc(x.name)}</span><span class="pc">${px.pct}%</span><span class="by">by ${esc((S.TY[x.type_id]?.name || '').toLowerCase())}${x.status !== 'active' ? ` · ${x.status === 'hold' ? 'on hold' : 'done'}` : ''}</span>
    <span class="bar"><i style="width:${px.pct}%;background:${esc(x.color)}"></i></span></button>`; }).join('');
  const docs = S.links.filter((lk) => lk.tracker_id === t.id && !lk.location_id && S.D[lk.drawing_id]);
  docGroups.tracker = docs;
  // rows
  const parentType = S.TY[ty.parent_type_id];
  let locs = S.scope[t.id];
  if (ui.trParent) locs = locs.filter((l) => S.anc[l.id].includes(+ui.trParent));
  if (ui.trSearch) { const s = ui.trSearch.toLowerCase(); locs = locs.filter((l) => l.name.toLowerCase().includes(s)); }
  if (ui.trFilter === 'open') locs = locs.filter((l) => !locState(t, l.id).done);
  if (ui.trFilter === 'problem') locs = locs.filter((l) => locState(t, l.id).problem || (t.mode === 'steps' && t.steps.some((s) => entStatus(t, l.id, s.id).problem)));
  const parentsInScope = parentType ? [...new Set(S.scope[t.id].map((l) => l.parent_id).filter(Boolean))].map((id) => S.L[id]).filter(Boolean) : [];
  const cols = t.mode === 'steps' ? t.steps.map((s, i) => ({ k: 's' + s.id, step: s, label: `<span class="ord">${i + 1}</span>${esc(s.name)}` }))
    : t.mode === 'status' ? [{ k: 'st', label: 'Status' }] : [{ k: 'qty', label: `Qty${t.unit ? ` (${esc(t.unit)})` : ''}` }];
  const fcols = (t.fields || []).map((f) => ({ k: 'f' + f.key, field: f, label: esc(f.label) }));
  const groups = []; let cur = null;
  for (const l of locs) { const g = parentType ? l.parent_id || 0 : 0; if (!cur || cur.g !== g) { cur = { g, locs: [] }; groups.push(cur); } cur.locs.push(l); }
  const ncol = cols.length + fcols.length + 1;
  const body = groups.map((gr) => `${gr.g ? `<tr class="grp"><th colspan="${ncol}"><button data-act="${ui.selMode ? 'sel-group' : 'open-loc'}" data-id="${gr.g}" data-ids="${gr.locs.map((l) => l.id).join(',')}">${esc(lname(gr.g))}</button> <small style="color:var(--faint);font-weight:500">${gr.locs.length}</small></th></tr>` : ''}
    ${gr.locs.map((l) => `<tr><th class="loc"><button data-act="${ui.selMode ? 'sel-row' : 'open-loc'}" data-id="${l.id}" data-t="${t.id}">${esc(l.name)}</button></th>
      ${cols.map((c) => cellHtml(t, l, c)).join('')}
      ${fcols.map((c) => { const v = ent(t, l.id, 0)?.values?.[c.field.key]; return `<td><button class="cell val" data-act="open-loc" data-id="${l.id}" data-t="${t.id}">${v === true ? '✓' : esc(v ?? '')}</button></td>`; }).join('')}</tr>`).join('')}`).join('');
  const selbar = ui.selMode ? `<div class="selbar"><b>${ui.sel.size} selected</b>${t.statuses.map((s) => `<button class="btn sm" data-act="bulk-status" data-s="${esc(s.key)}" ${ui.sel.size ? '' : 'disabled'}>${sw(s.color)}${esc(s.label)}</button>`).join('')}<button class="btn sm ghost" data-act="sel-off">Cancel</button></div>` : '';
  const rf = (k, l) => `<button data-act="tr-filter" data-f="${k}" ${pressed(ui.trFilter === k)}>${l}</button>`;
  return head('Trackers', '', tools) + `<div class="tr-list">${pills}</div>
  <div class="tr-head mod"><div><h2>${sw(t.color)}${esc(t.name)}</h2>
      <p>${p.pct}% done. ${p.doneLocs} of ${p.total} ${esc((ty.plural || '').toLowerCase())} finished${p.problems ? `, ${p.problems} problem${p.problems > 1 ? 's' : ''}` : ''}${t.due_date ? `, due ${due(t.due_date)}` : ''}.${t.description ? ' ' + esc(t.description) : ''}</p></div>
    <div class="row">${S.manage ? `<button class="btn sm" data-act="tracker-edit" data-id="${t.id}">Edit tracker</button>` : ''}${t.mode !== 'qty' ? `<button class="btn sm ${ui.selMode ? 'sun' : ''}" data-act="sel-toggle">${ui.selMode ? 'Selecting' : 'Select several'}</button>` : ''}</div>
    ${docs.length ? `<div class="docs doc-chips">${docs.map((lk, i) => docChip(lk, i, 'tracker')).join('')}</div>` : ''}</div>
  <div class="toolbar">${parentsInScope.length > 1 ? `<select data-act="tr-parent" aria-label="Filter by ${esc(parentType.name)}"><option value="">All ${esc(parentType.plural.toLowerCase())}</option>${parentsInScope.map((pl) => `<option value="${pl.id}" ${String(pl.id) === String(ui.trParent) ? 'selected' : ''}>${esc(pl.name)}</option>`).join('')}</select>` : ''}
    <input type="search" id="tr-search" placeholder="Find ${esc((ty.name || '').toLowerCase())}" value="${esc(ui.trSearch)}">
    <div class="seg" role="group">${rf('all', 'All')}${rf('open', 'Not done')}${rf('problem', 'Problems')}</div></div>
  ${locs.length ? `<div class="matrix-wrap"><table class="matrix"><thead><tr><th class="loc">${esc(ty.name || '')}</th>
    ${cols.map((c) => `<th><button data-act="sel-col" data-k="${c.k}">${c.label}</button></th>`).join('')}${fcols.map((c) => `<th>${c.label}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`
    : `<p class="hint">No ${esc((ty.plural || '').toLowerCase())} match.${!S.scope[t.id].length ? ` This tracker has nothing in scope. Add ${esc((ty.plural || '').toLowerCase())} in Setup or widen the scope.` : ''}</p>`}
  ${selbar}`;
}
function cellHtml(t, l, c) {
  if (c.step || c.k === 'st') {
    const sid = c.step ? c.step.id : 0; const e = ent(t, l.id, sid); const st = statusOf(t, e?.status); const k = `${l.id}:${sid}`;
    const first = st.key === t.statuses[0].key;
    return `<td><button class="cell ${ui.sel.has(k) ? 'sel' : ''}" data-act="cell" data-l="${l.id}" data-s="${sid}" title="${esc(st.label)}">
      <span class="sq ${first ? '' : 'on'}" style="${first ? '' : `background:${esc(st.color)}`}"></span>${c.k === 'st' ? `<span>${esc(st.label)}</span>` : ''}${e?.crew?.length && t.claims ? `<span class="who">${esc(e.crew.join(', '))}</span>` : ''}</button></td>`;
  }
  const e = ent(t, l.id, 0); const tg = targetOf(t, l.id); const v = e?.qty || 0; const st = locState(t, l.id);
  return `<td><button class="cell" data-act="open-loc" data-id="${l.id}" data-t="${t.id}"><span class="qty">${q(v)}${tg ? `<span style="color:var(--faint)"> / ${q(tg)}</span>` : ''}</span>
    <span class="mini"><i style="width:${tg ? clamp((v / tg) * 100, 0, 100) : 0}%;background:${esc(st.color)}"></i></span></button></td>`;
}

// ── Map ───────────────────────────────────────────────────────────────
function vMap() {
  const m = S.maps.find((x) => x.id === ui.map.id);
  const upload = S.manage ? `<button class="btn sm" data-act="map-upload">Add plan</button>` : '';
  if (!m) return head('Map', '', upload) + emptyBox('No plans yet', 'Upload the site plan as a PDF or image, then outline power blocks on it. Each PB can have its own plan too, with rows outlined and transitions pinned. You can also turn any drawing page into a plan from Drawings.', S.manage ? '<button class="btn sun" data-act="map-upload">Upload site plan</button>' : '');
  const mp = ui.map; const shown = S.trackers.filter((t) => t.show_map);
  if (mp.trId && !S.TR[mp.trId]) mp.trId = '';
  if (mp.trFor !== m.id) {
    // pick a tracker that colors something on this plan, unless the user picked one here
    const here = S.areas.filter((a) => a.map_id === m.id && a.location_id);
    const covers = (t) => here.some((a) => mapState(t, a.location_id));
    const cur = S.TR[mp.trId];
    if (!cur || !covers(cur)) { const pick = shown.find((t) => t.id === ui.trId && covers(t)) || shown.find(covers) || shown[0]; mp.trId = pick ? String(pick.id) : ''; mp.stepId = ''; }
    mp.trFor = m.id;
  }
  const t = S.TR[mp.trId];
  const crumbs = [];
  if (m.location_id) { const chain = [m.location_id, ...(S.anc[m.location_id] || [])].reverse(); const site = S.maps.find((x) => !x.location_id);
    if (site) crumbs.push(`<button data-act="map-go" data-id="${site.id}">${esc(site.name)}</button>`);
    for (const lid of chain) { const mm = S.mapFor[lid]; crumbs.push(mm && mm.id !== m.id ? `<button data-act="map-go" data-id="${mm.id}">${esc(lname(lid))}</button>` : `<b>${esc(lname(lid))}</b>`); } }
  else crumbs.push(`<b>${esc(m.name)}</b>`);
  const mapsSorted = [...S.maps].sort((a, b) => (!!a.location_id - !!b.location_id) || a.name.localeCompare(b.name));
  const onMap = new Set(S.areas.filter((a) => a.map_id === m.id && a.location_id).map((a) => a.location_id));
  const tools = `${upload}${S.manage && !mp.editing ? `<button class="btn sm sun" data-act="map-edit">Outline &amp; pin</button>` : ''}${S.manage ? `<button class="btn sm danger" data-act="map-delete">Remove plan</button>` : ''}`;
  if (!mp.assignType || !S.TY[mp.assignType]) mp.assignType = defaultAssignType(m);
  const cands = assignCandidates(m, mp.assignType, onMap);
  const tool = (k, l) => `<button data-act="map-tool" data-t="${k}" ${pressed(mp.tool === k)}>${l}</button>`;
  const edit = mp.editing ? `<div class="edit-strip">
      <div class="seg" role="group" aria-label="Tool">${tool('move', 'Move')}${tool('box', 'Box')}${tool('poly', 'Outline')}${tool('pin', 'Pin')}${tool('pick', 'Pick')}</div>
      <select data-act="map-assign" aria-label="Assign to">${S.types.map((ty) => `<option value="${ty.id}" ${ty.id === mp.assignType ? 'selected' : ''}>${esc(ty.plural)}${ty.shape === 'pin' ? ' (pins)' : ''}</option>`).join('')}</select>
      <label class="check" style="margin:0"><input type="checkbox" data-act="map-auto" ${mp.auto ? 'checked' : ''}> Next in order</label>
      <span class="msg">${mapMsg(cands)}</span>
      ${mp.poly.length ? `<button class="btn sm" data-act="poly-undo">Undo point</button><button class="btn sm" data-act="poly-close" ${mp.poly.length < 3 ? 'disabled' : ''}>Close</button>` : ''}
      <button class="btn sm sun" data-act="map-edit-done">Done</button></div>` : '';
  const legend = t ? (t.mode === 'steps' && !mp.stepId ? [{ color: t.statuses.find((s) => s.done)?.color, label: 'Done' }, { color: partialColor(t), label: 'In progress' }, ...t.statuses.filter((s) => s.problem)] : t.statuses) : [];
  return head('Map', `<span class="crumbs">${crumbs.join('<span>/</span>')}</span>`, tools) + `
  <div class="map-bar">
    <select data-act="map-pick" aria-label="Plan">${mapsSorted.map((x) => `<option value="${x.id}" ${x.id === m.id ? 'selected' : ''}>${x.location_id && !x.name.includes(lname(x.location_id)) ? `${esc(lname(x.location_id))}: ` : ''}${esc(x.name)}</option>`).join('')}</select>
    <select data-act="map-tracker" aria-label="Color by tracker">${shown.length ? shown.map((x) => `<option value="${x.id}" ${String(x.id) === String(mp.trId) ? 'selected' : ''}>${esc(x.name)}</option>`).join('') : '<option value="">No trackers</option>'}</select>
    ${t?.mode === 'steps' ? `<select data-act="map-step" aria-label="Step"><option value="">All steps</option>${t.steps.map((s) => `<option value="${s.id}" ${String(s.id) === String(mp.stepId) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>` : ''}
    <div class="seg" role="group" aria-label="Plan colors"><button data-act="map-dark" data-v="1" ${pressed(mp.dark)}>Night plan</button><button data-act="map-dark" data-v="0" ${pressed(!mp.dark)}>Original</button></div>
  </div>${edit}
  <div class="mapview ${mp.editing && ['box', 'poly', 'pin'].includes(mp.tool) ? 'drawing' : ''}" id="mapview"><svg id="mapsvg" xmlns="http://www.w3.org/2000/svg"></svg>
    <div class="map-zoom"><button data-act="zoom" data-z="1.4" aria-label="Zoom in">+</button><button data-act="zoom" data-z="0.7" aria-label="Zoom out">−</button><button data-act="zoom-fit">Fit</button></div>
    ${legend.length ? `<div class="map-legend">${legend.map((s) => `<span>${sw(s.color)}${esc(s.label)}</span>`).join('')}</div>` : ''}</div>`;
}
function defaultAssignType(m) {
  if (m.location_id) { const lt = S.L[m.location_id]?.type_id; return (S.types.find((ty) => ty.parent_type_id === lt) || S.types[0])?.id; }
  return (S.types.find((ty) => !ty.parent_type_id) || S.types[0])?.id;
}
function assignCandidates(m, typeId, onMap) {
  return S.locations.filter((l) => l.type_id === typeId && !onMap.has(l.id) && (!m.location_id || S.anc[l.id].includes(m.location_id) || l.id === m.location_id));
}
function mapMsg(cands) {
  const mp = ui.map; const nxt = mp.auto ? cands[0] : null; const ty = S.TY[mp.assignType];
  if (mp.tool === 'box') return nxt ? `Drag a box over ${esc(nxt.name)}` : `Drag a box over a ${esc((ty?.name || '').toLowerCase())}`;
  if (mp.tool === 'poly') return mp.poly.length ? 'Tap the first point to close' : nxt ? `Tap the corners of ${esc(nxt.name)}` : 'Tap each corner';
  if (mp.tool === 'pin') return nxt ? `Tap where ${esc(nxt.name)} is` : `Tap to drop a pin`;
  if (mp.tool === 'pick') return 'Tap an outline or pin to reassign or remove it';
  return mp.auto && !cands.length ? `Every ${esc((ty?.name || '').toLowerCase())} here is placed` : 'Drag to move, pinch or scroll to zoom';
}
function mapGeom() {
  const m = S.maps.find((x) => x.id === ui.map.id);
  const W = m.width || 2000, H = m.height || 1400, M = Math.round(Math.max(W, H) * 0.035), cols = 8, rows = Math.max(4, Math.round((cols * H) / W));
  return { m, W, H, M, cols, rows };
}
const gridRef = (x, y, g) => `${String.fromCharCode(65 + clamp(Math.floor((x / g.W) * g.cols), 0, g.cols - 1))}${clamp(Math.floor((y / g.H) * g.rows), 0, g.rows - 1) + 1}`;
function areaCenter(a, g) {
  const xs = a.points.map((p) => (p[0] * g.W) / 100), ys = a.points.map((p) => (p[1] * g.H) / 100);
  return { x: xs.reduce((s, v) => s + v, 0) / xs.length, y: ys.reduce((s, v) => s + v, 0) / ys.length, bw: Math.max(...xs) - Math.min(...xs), bh: Math.max(...ys) - Math.min(...ys) };
}
function svgContent() {
  const g = mapGeom(); const { m, W, H, M, cols, rows } = g; const mp = ui.map; const t = S.TR[mp.trId]; const fs = M * 0.45;
  let frame = `<rect class="frame" x="${-M * 0.92}" y="${-M * 0.92}" width="${W + M * 1.84}" height="${H + M * 1.84}" stroke-width="1.2"/>`;
  for (let i = 0; i < cols; i++) { const cx = (W / cols) * (i + 0.5), L = String.fromCharCode(65 + i);
    if (i) frame += `<line class="frame" x1="${(W / cols) * i}" y1="${-M * 0.92}" x2="${(W / cols) * i}" y2="${-M * 0.35}"/><line class="frame" x1="${(W / cols) * i}" y1="${H + M * 0.35}" x2="${(W / cols) * i}" y2="${H + M * 0.92}"/>`;
    frame += `<text class="gref" x="${cx}" y="${-M * 0.48}" font-size="${fs}">${L}</text><text class="gref" x="${cx}" y="${H + M * 0.48}" font-size="${fs}">${L}</text>`; }
  for (let j = 0; j < rows; j++) { const cy = (H / rows) * (j + 0.5);
    if (j) frame += `<line class="frame" x1="${-M * 0.92}" y1="${(H / rows) * j}" x2="${-M * 0.35}" y2="${(H / rows) * j}"/><line class="frame" x1="${W + M * 0.35}" y1="${(H / rows) * j}" x2="${W + M * 0.92}" y2="${(H / rows) * j}"/>`;
    frame += `<text class="gref" x="${-M * 0.48}" y="${cy}" font-size="${fs}">${j + 1}</text><text class="gref" x="${W + M * 0.48}" y="${cy}" font-size="${fs}">${j + 1}</text>`; }
  const areas = S.areas.filter((a) => a.map_id === m.id);
  const shapes = []; const labels = [];
  const pinR = Math.max(W, H) / 95;
  for (const a of areas) {
    const l = S.L[a.location_id]; let st = l ? mapState(t, l.id, +mp.stepId || 0) : null;
    if (l && !st) { const ot = S.trackers.find((x) => x.show_map && x.status !== 'done' && S.inScope[x.id].has(l.id)); if (ot) st = locState(ot, l.id); }
    const lit = st && (st.started || st.done);
    if (a.points.length === 1) {
      const [x, y] = [(a.points[0][0] * W) / 100, (a.points[0][1] * H) / 100];
      shapes.push(`<circle class="pin" data-area="${a.id}" cx="${x}" cy="${y}" r="${pinR}" fill="${l ? (lit ? st.color : '#8A98B3') : '#FF5D4A'}" ${mp.picked === a.id ? 'stroke="#5CC8FF" stroke-width="4"' : ''}/>`);
      if (l) labels.push(`<text class="mlbl pinl" x="${x + pinR * 1.4}" y="${y}" font-size="${pinR * 1.15}" style="stroke-width:${pinR * 0.3}px">${esc(l.name)}</text>`);
      continue;
    }
    const pts = a.points.map((p) => `${(p[0] * W) / 100},${(p[1] * H) / 100}`).join(' ');
    const cls = !l ? 'unassigned' : !lit ? 'todo' : '';
    shapes.push(`<polygon class="area ${cls} ${mp.picked === a.id ? 'picked' : ''} ${l && S.mapFor[l.id] ? 'hasmap' : ''}" data-area="${a.id}" points="${pts}" ${lit ? `style="fill:${st.color};fill-opacity:.5"` : ''}/>`);
    if (l) { const c = areaCenter(a, g); const size = clamp(Math.min(c.bw / Math.max(l.name.length * 0.62, 1), c.bh * 0.5), W / 450, W / 45);
      labels.push(`<text class="mlbl" x="${c.x}" y="${c.y}" font-size="${size}" style="stroke-width:${size * 0.22}px">${esc(l.name)}</text>`); }
  }
  let draft = '';
  if (mp.draft) { const d = mp.draft; draft = `<rect class="draft" x="${Math.min(d.x0, d.x1)}" y="${Math.min(d.y0, d.y1)}" width="${Math.abs(d.x1 - d.x0)}" height="${Math.abs(d.y1 - d.y0)}"/>`; }
  if (mp.poly.length) { const r = (M * 0.18) / Math.max(mp.s * 3, 0.4);
    draft += `<polyline class="draft" points="${mp.poly.map((p) => p.join(',')).join(' ')}"/>` + mp.poly.map((p, i) => `<circle class="vtx" cx="${p[0]}" cy="${p[1]}" r="${i === 0 ? r * 1.6 : r}"/>`).join(''); }
  return `<rect x="0" y="0" width="${W}" height="${H}" fill="${mp.dark ? '#0B111D' : '#fff'}"/><image class="plan ${mp.dark ? 'dark' : ''}" href="${m.url}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none"/>${frame}${shapes.join('')}${labels.join('')}${draft}`;
}

// generic pan/zoom engine (used by the map and the drawing viewer)
function panZoom(host, st, { onTap, onDraw, onDrawMove, onDrawEnd, drawing } = {}) {
  const ptr = new Map(); let gst = null;
  const apply = () => { const el = host.firstElementChild; if (el) el.style.transform = `translate(${st.tx}px,${st.ty}px) scale(${st.s})`; };
  const zoomAt = (f, cx, cy) => { const ns = clamp(st.s * f, st.min || 0.05, st.max || 14); const k = ns / st.s; st.tx = cx - (cx - st.tx) * k; st.ty = cy - (cy - st.ty) * k; st.s = ns; apply(); };
  host.onpointerdown = (e) => {
    if (e.target.closest('button')) return;
    host.setPointerCapture(e.pointerId); ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptr.size === 2) { const [a, b] = [...ptr.values()]; gst = { pinch: true, d0: Math.hypot(a.x - b.x, a.y - b.y), s0: st.s, tx0: st.tx, ty0: st.ty, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; onDrawEnd?.(true); return; }
    gst = { x: e.clientX, y: e.clientY, t: Date.now(), tx0: st.tx, ty0: st.ty, moved: false, target: e.target };
    if (drawing?.()) onDraw?.(e);
  };
  host.onpointermove = (e) => {
    if (!ptr.has(e.pointerId) || !gst) return; ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gst.pinch && ptr.size === 2) { const [a, b] = [...ptr.values()]; const r = host.getBoundingClientRect();
      st.s = gst.s0; st.tx = gst.tx0 + ((a.x + b.x) / 2 - gst.mx); st.ty = gst.ty0 + ((a.y + b.y) / 2 - gst.my); zoomAt(Math.hypot(a.x - b.x, a.y - b.y) / gst.d0, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top); return; }
    if (gst.pinch) return;
    if (Math.hypot(e.clientX - gst.x, e.clientY - gst.y) > 6) gst.moved = true;
    if (drawing?.()) { onDrawMove?.(e); return; }
    if (gst.moved) { st.tx = gst.tx0 + (e.clientX - gst.x); st.ty = gst.ty0 + (e.clientY - gst.y); apply(); }
  };
  host.onpointerup = host.onpointercancel = (e) => {
    if (!ptr.has(e.pointerId)) return; ptr.delete(e.pointerId);
    const g0 = gst; if (!g0) return;
    if (g0.pinch) { if (!ptr.size) gst = null; return; }
    gst = null;
    if (drawing?.() && onDrawEnd?.(false, e)) return;
    if (!g0.moved && Date.now() - g0.t < 600) onTap?.(e, g0.target);
  };
  host.onwheel = (e) => { e.preventDefault(); const r = host.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX - r.left, e.clientY - r.top); };
  return { apply, zoomAt };
}

let mapPZ = null;
function mountMap() {
  const view = $('#mapview'), svg = $('#mapsvg'); if (!view || !svg) return;
  const g = mapGeom(); const mp = ui.map;
  if (!g.m.width) { const img = new Image(); img.onload = () => api('PUT', `/api/map/${g.m.id}`, { width: img.naturalWidth, height: img.naturalHeight }).then(refresh).catch(() => {}); img.src = g.m.url; }
  svg.setAttribute('viewBox', `${-g.M} ${-g.M} ${g.W + 2 * g.M} ${g.H + 2 * g.M}`); svg.setAttribute('width', g.W + 2 * g.M); svg.setAttribute('height', g.H + 2 * g.M);
  svg.innerHTML = svgContent();
  mp.min = Math.min(view.clientWidth / (g.W + 2 * g.M), view.clientHeight / (g.H + 2 * g.M)) * 0.5; mp.max = 14;
  if (!mp.fitted) fitMap();
  mapPZ = panZoom(view, mp, {
    drawing: () => mp.editing && (mp.tool === 'box' || mp.tool === 'poly' || mp.tool === 'pin'),
    onDraw: (e) => { if (mp.tool === 'box') { const [x, y] = toImg(e.clientX, e.clientY); mp.draft = { x0: x, y0: y, x1: x, y1: y }; } },
    onDrawMove: (e) => { if (mp.tool === 'box' && mp.draft) { const [x, y] = toImg(e.clientX, e.clientY); mp.draft.x1 = x; mp.draft.y1 = y; repaintMap(); } },
    onDrawEnd: (cancel, e) => {
      if (cancel) { mp.draft = null; return false; }
      if (mp.tool === 'box' && mp.draft) {
        const d = mp.draft; mp.draft = null;
        const x0 = clamp(Math.min(d.x0, d.x1), 0, g.W), x1 = clamp(Math.max(d.x0, d.x1), 0, g.W), y0 = clamp(Math.min(d.y0, d.y1), 0, g.H), y1 = clamp(Math.max(d.y0, d.y1), 0, g.H);
        if (x1 - x0 > g.W * 0.002 && y1 - y0 > g.H * 0.002) finishShape([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]); else repaintMap();
        return true;
      }
      if (mp.tool === 'pin') { const [x, y] = toImg(e.clientX, e.clientY); if (x >= 0 && y >= 0 && x <= g.W && y <= g.H) finishShape([[x, y]]); return true; }
      if (mp.tool === 'poly') {
        const [x, y] = toImg(e.clientX, e.clientY);
        if (mp.poly.length >= 3) { const [fx, fy] = mp.poly[0]; const r = view.getBoundingClientRect();
          if (Math.hypot((fx + g.M) * mp.s + mp.tx + r.left - e.clientX, (fy + g.M) * mp.s + mp.ty + r.top - e.clientY) < 22) { closePoly(); return true; } }
        mp.poly.push([clamp(x, 0, g.W), clamp(y, 0, g.H)]); render(); return true;
      }
      return false;
    },
    onTap: (e, target) => {
      const el = target?.closest?.('[data-area]'); if (!el) return;
      const a = S.areas.find((x) => x.id === +el.dataset.area); if (!a) return;
      if (mp.editing) { openAreaEdit(a); return; }
      if (a.location_id && S.L[a.location_id]) openLoc(a.location_id, { trackerId: +mp.trId || null });
      else if (S.manage) openAreaEdit(a);
    },
  });
  mapPZ.apply();
}
function repaintMap() { const svg = $('#mapsvg'); if (svg) svg.innerHTML = svgContent(); }
function fitMap() {
  const view = $('#mapview'); if (!view) return; const g = mapGeom(); const w = g.W + 2 * g.M, h = g.H + 2 * g.M;
  const s = Math.min(view.clientWidth / w, view.clientHeight / h); Object.assign(ui.map, { s, tx: (view.clientWidth - w * s) / 2, ty: (view.clientHeight - h * s) / 2, fitted: true });
}
function toImg(cx, cy) { const r = $('#mapview').getBoundingClientRect(); const g = mapGeom(); return [(cx - r.left - ui.map.tx) / ui.map.s - g.M, (cy - r.top - ui.map.ty) / ui.map.s - g.M]; }
function closePoly() { const pts = ui.map.poly; ui.map.poly = []; if (pts.length >= 3) finishShape(pts); else render(); }
async function finishShape(px) {
  const g = mapGeom(); const points = px.map(([x, y]) => [(x / g.W) * 100, (y / g.H) * 100]);
  const onMap = new Set(S.areas.filter((a) => a.map_id === g.m.id && a.location_id).map((a) => a.location_id));
  const next = ui.map.auto ? assignCandidates(g.m, ui.map.assignType, onMap)[0] : null;
  if (next) { await mutate('POST', '/api/areas', { map_id: g.m.id, location_id: next.id, points }, { ok: `Placed ${next.name}` }); return; }
  const r = await mutate('POST', '/api/areas', { map_id: g.m.id, location_id: null, points });
  const a = S.areas.find((x) => x.id === r.id); if (a) openAreaEdit(a);
}

// ── Drawings ──────────────────────────────────────────────────────────
function vDrawings() {
  const tools = S.manage ? '<button class="btn sm sun" data-act="dwg-upload">Upload drawings</button>' : '';
  if (!S.drawings.length) return head('Drawings', '', tools) + emptyBox('No drawings yet', 'Upload IFC sets and PB sheets as PDFs. The app can read each page and attach it to the matching power block, so tapping PB-07 anywhere pulls up its sheets. You can also attach a drawing to a tracker so it opens with that work.', S.manage ? '<button class="btn sun" data-act="dwg-upload">Upload drawings</button>' : '');
  return head('Drawings', `${S.drawings.length} file${S.drawings.length > 1 ? 's' : ''}, ${S.links.length} links to locations and trackers`, tools) + `<div class="dwg-list">${S.drawings.map((d) => {
    const n = S.links.filter((lk) => lk.drawing_id === d.id).length;
    return `<div class="dwg mod" data-act="open-dwg" data-id="${d.id}" role="button" tabindex="0"><div class="thumb" style="background-image:url('/api/drawings/${d.id}/page/1?w=600&t=${tok()}')"></div>
      <div class="body"><div class="sheet">${esc(d.sheet || 'Drawing')}${d.rev ? ` · Rev ${esc(d.rev)}` : ''}</div><div class="nm">${esc(d.name)}</div>
      <div class="meta">${d.pages} page${d.pages > 1 ? 's' : ''} · ${n} link${n === 1 ? '' : 's'}</div></div></div>`; }).join('')}</div>`;
}

// ── Setup ─────────────────────────────────────────────────────────────
function vSetup() {
  const types = S.types.map((ty) => { const n = S.locations.filter((l) => l.type_id === ty.id).length; const par = S.TY[ty.parent_type_id];
    return `<div class="type-row"><span class="tag">${esc(ty.short || ty.name.slice(0, 2).toUpperCase())}</span><div><div class="nm">${esc(ty.plural)}</div><div class="meta">${n} on site${par ? `, inside ${esc(par.plural.toLowerCase())}` : ''}, ${ty.shape === 'pin' ? 'shown as pins' : 'outlined on plans'}</div></div>
      ${S.manage ? `<button class="btn sm" data-act="type-edit" data-id="${ty.id}">Edit</button>` : ''}</div>`; }).join('');
  const st = S.TY[ui.setupType];
  const people = S.crew.map((name) => { const u = S.users.find((x) => x.name === name); const out = S.out_by_person[name] || {};
    return `<div class="person ${u && !u.active ? 'off' : ''}"><div class="nm">${esc(name)} <span class="role">${u ? ({ foreman: 'Foreman', lead: 'Lead', crew: 'Crew' }[u.role]) + (u.active ? ' · can sign in' : ' · turned off') : 'Crew · no sign-in'}</span></div>
      <div>${S.manage ? `<button class="btn sm" data-act="person-edit" data-name="${esc(name)}">Edit</button>` : ''}</div>
      ${Object.keys(out).length ? `<div class="has chips">${Object.entries(out).map(([mid, n]) => S.M[mid] ? `<span class="chip static">${q(n)} ${esc(S.M[mid].unit)} <small>${esc(S.M[mid].name)}</small></span>` : '').join('')}</div>` : ''}</div>`; }).join('');
  return head('Setup', 'How your site is broken down, who is on it, and exports') + `<div class="setup-grid"><div>
    ${S.manage ? `<section class="panel-box mod"><h2 class="sec-h">Job</h2><form data-form="job" class="row" style="align-items:flex-end"><label class="f" style="flex:1 1 220px;margin:0"><span>Job name</span><input name="job_name" value="${esc(S.job.name)}"></label><button class="btn sun">Save</button></form></section>` : ''}
    <section class="panel-box mod"><h2 class="sec-h">Location types <small>What work is tracked against</small></h2>${types}
      ${S.manage ? '<div class="row" style="margin-top:12px"><button class="btn sm" data-act="type-edit">Add a type</button></div>' : ''}
      <p class="hint" style="margin-top:12px">Examples: Power block, Row inside a power block, Transition (pin) where cable comes up, Inverter, Combiner, Trench segment.</p></section>
    <section class="panel-box mod"><h2 class="sec-h">People ${S.manage ? '<button class="btn sm" data-act="person-edit">Add person</button>' : ''}</h2>${people || '<p class="hint">Add your crew so you can track who grabbed what.</p>'}
      ${S.users.filter((u) => !u.active && !S.crew.includes(u.name)).map((u) => `<div class="person off"><div class="nm">${esc(u.name)} <span class="role">turned off</span></div><div>${S.manage ? `<button class="btn sm" data-act="person-edit" data-name="${esc(u.name)}">Edit</button>` : ''}</div></div>`).join('')}</section>
    <section class="panel-box mod"><h2 class="sec-h">Exports</h2><div class="row">
      <a class="btn sm" href="/api/export/materials.csv?t=${tok()}">Materials</a><a class="btn sm" href="/api/export/order.csv?t=${tok()}">Order list</a>
      <a class="btn sm" href="/api/export/progress.csv?t=${tok()}">Tracker progress</a><a class="btn sm" href="/api/export/txns.csv?t=${tok()}">Material log</a></div></section>
    <section class="panel-box mod"><h2 class="sec-h">This device</h2><p class="hint">Signed in as ${esc(S.me.name)}. ${installEvt ? '' : 'iPhone: Share, then Add to Home Screen. Android: browser menu, then Install app.'}</p>
      <div class="row">${installEvt ? '<button class="btn sm sun" data-act="install">Install app</button>' : ''}<button class="btn sm" data-act="signout">Sign out</button></div></section>
  </div><div>
    <section class="panel-box mod"><h2 class="sec-h">Locations</h2>
      ${S.types.length ? `<div class="seg" role="group" style="margin-bottom:14px">${S.types.map((ty) => `<button data-act="setup-type" data-id="${ty.id}" ${pressed(ty.id === ui.setupType)}>${esc(ty.plural)}<span class="ct">${S.locations.filter((l) => l.type_id === ty.id).length}</span></button>`).join('')}</div>` : '<p class="hint">Add a location type first.</p>'}
      ${st && S.manage ? genForm(st) : ''}
      ${st ? locTree(st) : ''}</section>
  </div></div>`;
}
function genForm(ty) {
  const par = S.TY[ty.parent_type_id]; const parents = par ? S.locations.filter((l) => l.type_id === par.id) : [];
  const short = ty.short || ty.name.slice(0, 1).toUpperCase();
  return `<form data-form="gen" data-type="${ty.id}" class="fieldset">
    <div class="lbl" style="margin-bottom:10px">Add ${esc(ty.plural.toLowerCase())} as a numbered run. <b>{n}</b> is the number${par ? `, <b>{parent}</b> is the ${esc(par.name.toLowerCase())} name` : ''}.</div>
    <div class="grid2"><label class="f"><span>Name pattern</span><input name="pattern" value="${par ? `{parent}-${esc(short)}{n}` : `${esc(short)}-{n}`}"></label>
      <label class="f"><span>From</span><input name="start" type="number" value="1"></label><label class="f"><span>To</span><input name="end" type="number" placeholder="40"></label>
      <label class="f"><span>Digits</span><input name="pad" type="number" value="${par ? 0 : 2}" min="0" max="5"></label></div>
    ${par ? `<label class="f"><span>Inside which ${esc(par.plural.toLowerCase())}</span><select name="parents"><option value="all">Every ${esc(par.name.toLowerCase())} (${parents.length})</option>${parents.map((p) => `<option value="${p.id}">${esc(p.name)} only</option>`).join('')}</select></label>` : `<label class="f"><span>Zone (optional)</span><input name="zone" placeholder="North array"></label>`}
    <label class="f"><span>Or type names, one per line</span><textarea name="names" placeholder="${par ? 'Uses the same parents as above' : 'INV-1\nINV-2'}" style="min-height:60px"></textarea></label>
    <button class="btn sun sm">Add ${esc(ty.plural.toLowerCase())}</button></form>`;
}
function locTree(ty) {
  const locs = S.locations.filter((l) => l.type_id === ty.id);
  if (!locs.length) return `<p class="hint">No ${esc(ty.plural.toLowerCase())} yet.</p>`;
  const par = S.TY[ty.parent_type_id]; let last = null;
  return `<div class="loc-tree">${locs.map((l) => { const gh = par && l.parent_id !== last ? `<div class="lr" style="color:var(--sun);font-family:var(--disp);font-weight:700"><span></span><span>${esc(lname(l.parent_id))}</span><span></span></div>` : ''; last = l.parent_id;
    const k = (S.kids[l.id] || []).length;
    return `${gh}<div class="lr ${par ? 'child' : ''}"><span>${S.mapFor[l.id] ? '<span class="tag live">plan</span>' : ''}</span><button class="nm" data-act="open-loc" data-id="${l.id}">${esc(l.name)} ${l.zone && !par ? `<span class="kids">${esc(l.zone)}</span>` : ''} ${k ? `<span class="kids">${k} inside</span>` : ''}</button>
      ${S.manage ? `<button class="btn sm ghost" data-act="loc-edit" data-id="${l.id}">Edit</button>` : '<span></span>'}</div>`; }).join('')}</div>
    ${S.manage ? `<div class="row" style="margin-top:10px"><button class="btn sm danger" data-act="loc-del-all" data-id="${ty.id}">Remove all ${esc(ty.plural.toLowerCase())}</button></div>` : ''}`;
}

// ── panel infrastructure ──────────────────────────────────────────────
function openPanel(title, sub, body, state = {}) {
  ui.panel = state; const p = $('#panel');
  p.innerHTML = `<div class="p-head"><h2>${title}${sub ? `<small>${sub}</small>` : ''}</h2><button class="x" data-act="close" aria-label="Close">×</button></div><div class="p-body">${body}</div>`;
  p.hidden = false; $('#scrim').hidden = false;
  setTimeout(() => (p.querySelector('[autofocus]') || p.querySelector('.x')).focus({ preventScroll: true }), 30);
}
function setBody(html) { const b = $('#panel .p-body'); if (b) { const y = b.scrollTop; b.innerHTML = html; b.scrollTop = y; } }
function closePanel() { $('#panel').hidden = true; $('#scrim').hidden = true; ui.panel = null; if (ui.map.picked) { ui.map.picked = null; if (ui.view === 'map') repaintMap(); } }

// Location hub: progress on every tracker, drawings, child plan, material
function openLoc(lid, { trackerId } = {}) {
  const l = S.L[lid]; if (!l) return;
  const st = { kind: 'loc', lid, trackerId, crew: null, book: true };
  const last = S.entries.filter((e) => e.l === lid && e.crew?.length).sort((a, b) => (b.at || '').localeCompare(a.at || ''))[0];
  st.crew = new Set(last?.crew || []);
  st.live = () => { if (S.L[lid]) setBody(locBody(st)); else closePanel(); };
  const ty = typeOf(l); const par = S.anc[lid].map(lname).reverse().join(' / ');
  let ref = ''; const site = S.maps.find((m) => m.id === ui.map.id) || S.maps.find((m) => !m.location_id);
  const a = site && S.areas.find((x) => x.map_id === site.id && (x.location_id === lid || S.anc[lid].includes(x.location_id)));
  if (a) { const g = { W: site.width || 2000, H: site.height || 1400, cols: 8 }; g.rows = Math.max(4, Math.round((8 * g.H) / g.W)); const c = areaCenter(a, g); ref = `grid ${gridRef(c.x, c.y, g)}`; }
  openPanel(esc(l.name), esc([ty.name, par && `in ${par}`, l.zone, ref].filter(Boolean).join(' · ')), locBody(st), st);
}
function locBody(st) {
  const l = S.L[st.lid]; const lid = l.id;
  const trs = S.trackers.filter((t) => S.inScope[t.id].has(lid)).sort((a, b) => (b.id === st.trackerId) - (a.id === st.trackerId));
  const childTrs = S.trackers.filter((t) => !S.inScope[t.id].has(lid) && S.scope[t.id].some((x) => S.anc[x.id].includes(lid)));
  const docs = docsFor(lid, trs.map((t) => t.id)); docGroups.loc = docs;
  const plan = S.mapFor[lid];
  const kids = S.kids[lid] || [];
  const anyClaims = trs.some((t) => t.claims);
  const hasMats = trs.some((t) => t.materials.length && t.mode !== 'qty');
  const txns = S.txns.filter((t) => t.location_id === lid).slice(0, 12);
  const top = `<div class="row" style="margin-bottom:6px">${plan ? `<button class="btn sm sun" data-act="map-go" data-id="${plan.id}">Open ${esc(l.name)} plan</button>` : ''}
    ${S.manage && !plan && typeOf(l).shape !== 'pin' && S.types.some((ty) => ty.parent_type_id === l.type_id) ? `<button class="btn sm" data-act="map-upload" data-loc="${lid}">Add a plan for ${esc(l.name)}</button>` : ''}
    ${S.manage ? `<button class="btn sm" data-act="dwg-link-loc" data-id="${lid}">Attach drawing</button>` : ''}</div>`;
  const docHtml = docs.length ? `<h3>Drawings <small style="color:var(--faint);font-weight:500">${docs.length}</small></h3><div class="doc-chips">${docs.map((lk, i) => docChip(lk, i, 'loc')).join('')}</div>` : '';
  const childHtml = childTrs.length ? `<h3>Inside ${esc(l.name)}</h3>${childTrs.map((t) => { const locs = S.scope[t.id].filter((x) => S.anc[x.id].includes(lid)); const r = rollState(t, lid);
      return `<div class="tk mod"><div class="tk-h">${sw(t.color)}${esc(t.name)}<span class="pc">${r?.count ? `${r.count.done}/${r.count.total} ${esc(typeOf(locs[0]).plural.toLowerCase())}` : ''}</span></div>
        <div class="cgroup">${locs.map((x) => { const s = locState(t, x.id); return `<button class="pv big" style="background:${s.started || s.done ? s.color : ''}" data-act="open-loc" data-id="${x.id}" data-t="${t.id}" title="${esc(x.name)}: ${esc(s.label)}" aria-label="${esc(x.name)}"></button>`; }).join('')}</div>
        <div class="row" style="margin-top:8px"><button class="btn sm ghost" data-act="tracker-filter" data-t="${t.id}" data-p="${lid}">Open on check sheet</button></div></div>`; }).join('')}`
    : kids.length ? `<h3>Inside ${esc(l.name)}</h3><div class="chips">${kids.map((k) => `<button class="chip" data-act="open-loc" data-id="${k}">${esc(lname(k))}</button>`).join('')}</div>` : '';
  const crewHtml = anyClaims ? `<h3>Who's on it</h3><div class="chips">${S.crew.map((n) => `<button class="chip" data-act="loc-crew" data-n="${esc(n)}" ${pressed(st.crew.has(n))}>${esc(n)}</button>`).join('') || '<span class="hint">Add people in Setup.</span>'}</div>
    ${hasMats ? `<label class="check"><input type="checkbox" data-act="loc-book" ${st.book ? 'checked' : ''}> When something is marked done, log its material as installed</label>` : ''}` : '';
  const trHtml = trs.map((t) => trackerControls(t, lid)).join('');
  return `${top}${docHtml}${crewHtml}${trs.length ? `<h3>Progress</h3>${trHtml}` : ''}${childHtml}
    ${!trs.length && !childTrs.length ? `<p class="hint">No trackers cover this ${esc(typeOf(l).name.toLowerCase())} yet.</p>` : ''}
    <h3>Material here <button class="btn sm r" data-act="loc-mat">Log material</button></h3>
    ${txns.length ? `<ul class="hist">${txns.map((t) => { const m = S.M[t.material_id]; return m ? `<li><div><b>${esc(m.name)}</b>, ${t.kind === 'used' ? 'installed' : t.kind === 'grab' ? 'grabbed' : t.kind}${t.person ? ` by ${esc(t.person)}` : ''}<div class="when">${dayLabel(t.at)} ${time(t.at)}</div></div><span class="q">${q(t.qty)} ${esc(m.unit)}</span></li>` : ''; }).join('')}</ul>` : '<p class="hint">Nothing logged here yet.</p>'}
    ${S.manage ? `<h3>Notes</h3><textarea data-act="loc-notes" placeholder="Anything the crew should know here">${esc(l.notes)}</textarea>` : l.notes ? `<h3>Notes</h3><p>${esc(l.notes)}</p>` : ''}`;
}
function statusButtons(t, lid, sid) {
  const cur = ent(t, lid, sid)?.status || t.statuses[0].key;
  return `<div class="status-sw" role="group">${t.statuses.map((s) => `<button data-act="loc-status" data-t="${t.id}" data-s="${sid}" data-k="${esc(s.key)}" ${pressed(cur === s.key)} style="${cur === s.key ? `background:${esc(s.color)}` : ''}">${esc(s.label)}</button>`).join('')}</div>`;
}
function trackerControls(t, lid) {
  const s = locState(t, lid); const e0 = ent(t, lid, 0);
  let inner = '';
  if (t.mode === 'steps') inner = t.steps.map((s2, i) => { const e = ent(t, lid, s2.id);
    return `<div class="step-row"><div class="nm"><span>${i + 1}. ${esc(s2.name)}</span><small>${e?.by ? `${esc(e.crew?.join(', ') || e.by)}, ${dayLabel(e.at).toLowerCase()} ${time(e.at)}` : ''}</small></div>${statusButtons(t, lid, s2.id)}</div>`; }).join('') || '<p class="hint">This tracker has no steps.</p>';
  else if (t.mode === 'status') inner = statusButtons(t, lid, 0) + (e0?.by ? `<p class="hint" style="margin-top:6px">${esc(e0.by)}, ${dayLabel(e0.at).toLowerCase()} ${time(e0.at)}</p>` : '');
  else {
    const tg = targetOf(t, lid); const v = e0?.qty || 0;
    inner = `<div class="stock-strip" style="grid-template-columns:repeat(3,1fr)"><div><div class="k">Done</div><div class="v">${q(v)}</div></div><div><div class="k">Target</div><div class="v">${q(tg)}</div></div><div><div class="k">Left</div><div class="v">${q(Math.max(0, tg - v))}</div></div></div>
      <form data-form="qty" data-t="${t.id}" data-l="${lid}" class="row"><input name="add" type="number" step="any" inputmode="decimal" placeholder="Add ${esc(t.unit || 'qty')}" style="flex:1 1 120px;width:auto"><button class="btn sun">Add</button>
        ${S.manage ? `<input name="target" type="number" step="any" placeholder="Target" value="${e0?.target ?? ''}" title="Target for this location" style="flex:0 1 110px;width:auto"><button class="btn" name="set" value="target">Set target</button>` : ''}</form>
      <div style="margin-top:8px">${statusButtons(t, lid, 0)}</div>`;
  }
  const fields = (t.fields || []).length ? `<div class="grid2" style="margin-top:10px">${t.fields.map((f) => { const v = e0?.values?.[f.key];
    const attrs = `data-act="loc-field" data-t="${t.id}" data-l="${lid}" data-f="${esc(f.key)}"`;
    const input = f.type === 'check' ? `<label class="check"><input type="checkbox" ${attrs} ${v ? 'checked' : ''}> ${esc(f.label)}</label>`
      : f.type === 'select' ? `<select ${attrs}><option value=""></option>${f.options.map((o) => `<option ${v === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`
      : `<input ${attrs} type="${f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}" step="any" value="${esc(v ?? '')}">`;
    return f.type === 'check' ? `<div>${input}</div>` : `<label class="f"><span>${esc(f.label)}</span>${input}</label>`; }).join('')}</div>` : '';
  const docs = S.links.filter((lk) => lk.tracker_id === t.id && (lk.location_id === lid || !lk.location_id)).length;
  return `<div class="tk mod"><div class="tk-h">${sw(t.color)}${esc(t.name)}<span class="pc" style="color:${s.started || s.done ? esc(s.color) : 'var(--dim)'}">${esc(s.label)}</span></div>${inner}${fields}</div>`;
}

// Material panel
function openMaterial(id, preset = {}) {
  const m = S.M[id]; if (!m) return;
  const st = { kind: 'mat', mat: id, act: preset.kind || 'grab', qty: '', person: S.me.name, loc: preset.location_id || '', note: '', expected: '' };
  st.live = () => { if (S.M[id]) { readTxn(st); setBody(matBody(st)); } else closePanel(); };
  openPanel(esc(m.name), esc([m.part_no, m.category, m.location].filter(Boolean).join(' · ')), matBody(st), st);
}
const kindsAllowed = () => Object.keys(KIND).filter((k) => !KIND[k].manage || S.manage);
function locOptions(sel) {
  return S.types.map((ty) => { const ls = S.locations.filter((l) => l.type_id === ty.id); return ls.length ? `<optgroup label="${esc(ty.plural)}">${ls.map((l) => `<option value="${l.id}" ${String(sel) === String(l.id) ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</optgroup>` : ''; }).join('');
}
function matBody(st) {
  const m = S.M[st.mat]; const i = matInfo(m); const k = KIND[st.act];
  const big = ['ft', 'lf', 'm', "'"].includes((m.unit || '').toLowerCase()); const quick = big ? [50, 100, 250, 500, 1000] : [1, 5, 10, 25, 100];
  const hist = S.txns.filter((t) => t.material_id === m.id).slice(0, 25);
  const outP = Object.entries(S.out_by_person).filter(([, mm]) => mm[m.id]).map(([p, mm]) => `<span class="chip static">${esc(p)} <small>${q(mm[m.id])} ${esc(m.unit)}</small></span>`).join('');
  const label = { receive: 'Received', grab: 'Grabbed', return: 'Returned', used: 'Installed', order: 'Ordered', count: 'Count adjusted', scrap: 'Scrapped' };
  return `<div class="stock-strip"><div><div class="k">On hand</div><div class="v">${q(m.on_hand)}</div></div><div><div class="k">Out</div><div class="v">${q(m.out_qty)}</div></div>
    <div><div class="k">On order</div><div class="v">${q(m.on_order)}</div></div><div><div class="k">${i.short ? 'Short' : 'Still need'}</div><div class="v ${i.short ? 'bad' : ''}">${q(i.short || i.need)}</div></div></div>
  ${gauge(m, i)}
  <h3 style="margin-top:20px">What happened</h3>
  <div class="acts">${kindsAllowed().map((kk) => `<button data-act="mat-kind" data-k="${kk}" ${pressed(st.act === kk)}>${KIND[kk].label}<small>${KIND[kk].sub}</small></button>`).join('')}</div>
  <form data-form="txn" style="margin-top:14px">
    <span class="lbl">${st.act === 'count' ? `Counted on hand (${esc(m.unit)})` : `Quantity (${esc(m.unit)})`}</span>
    <div class="qty"><button type="button" data-act="qty-step" data-d="-1" aria-label="Less">−</button><input name="qty" type="number" inputmode="decimal" step="any" min="0" value="${esc(st.qty)}" placeholder="0" autofocus required><button type="button" data-act="qty-step" data-d="1" aria-label="More">+</button></div>
    ${st.act !== 'count' ? `<div class="qty-quick">${quick.map((n) => `<button type="button" data-act="qty-add" data-n="${n}">+${n}</button>`).join('')}${st.act === 'return' || st.act === 'used' ? `<button type="button" data-act="qty-all">All ${esc(st.person)} has</button>` : ''}</div>` : '<div style="height:10px"></div>'}
    ${k.people ? `<span class="lbl">${st.act === 'grab' ? 'Who grabbed it' : st.act === 'return' ? 'Who brought it back' : 'Who installed it'}</span><div class="chips" style="margin-bottom:14px">${S.crew.map((n) => `<button type="button" class="chip" data-act="mat-person" data-n="${esc(n)}" ${pressed(st.person === n)}>${esc(n)}</button>`).join('')}</div>` : ''}
    ${k.loc && S.locations.length ? `<label class="f"><span>Where (optional)</span><select name="loc"><option value="">Not tied to one</option>${locOptions(st.loc)}</select></label>` : ''}
    ${k.expected ? `<label class="f"><span>Expected delivery</span><input name="expected" type="date" value="${esc(st.expected)}"></label>` : ''}
    <label class="f"><span>Note (optional)</span><input name="note" value="${esc(st.note)}" placeholder="${st.act === 'receive' ? 'Ticket or PO number' : ''}"></label>
    <button class="btn sun" style="width:100%;min-height:50px">${k.verb}</button></form>
  ${outP ? `<h3>Out with the crew</h3><div class="chips">${outP}</div>` : ''}
  <h3>History ${S.manage ? `<button class="btn sm r" data-act="mat-edit" data-id="${m.id}">Edit details</button>` : ''}</h3>
  ${hist.length ? `<ul class="hist">${hist.map((t) => { const canUndo = typeof t.id === 'number' && (S.manage || (t.by === S.me.name && Date.now() - new Date(t.at) < 30 * 60e3)); const neg = t.kind === 'grab' || (t.kind === 'count' && t.qty < 0);
    return `<li><div><b>${label[t.kind]}</b>${t.person ? ` by ${esc(t.person)}` : ''}${t.location_id && S.L[t.location_id] ? ` at ${esc(lname(t.location_id))}` : ''}${t.note ? `, ${esc(t.note)}` : ''}<div class="when">${dayLabel(t.at)} ${time(t.at)}${t.by && t.by !== t.person ? ` · entered by ${esc(t.by)}` : ''}${t.expected ? ` · expected ${esc(t.expected)}` : ''}</div></div>
      <div class="row"><span class="q ${neg ? 'neg' : ''}">${neg ? '−' : ['receive', 'return', 'order'].includes(t.kind) || t.kind === 'count' ? '+' : ''}${q(Math.abs(t.qty))}</span>${canUndo ? `<button class="btn sm ghost" data-act="txn-undo" data-id="${t.id}">Undo</button>` : ''}</div></li>`; }).join('')}</ul>` : '<p class="hint">No movements yet.</p>'}`;
}
function readTxn(st) { const f = $('#panel form[data-form="txn"]'); if (!f) return; st.qty = f.qty.value; st.note = f.note.value; if (f.loc) st.loc = f.loc.value; if (f.expected) st.expected = f.expected.value; }

// Tracker builder
function openTrackerEdit(id) {
  const t = id ? S.TR[id] : null;
  const st = t ? {
    kind: 'tr', id, preset: null, name: t.name, color: t.color, type_id: t.type_id, mode: t.mode, unit: t.unit, default_target: t.default_target,
    statuses: t.statuses.map((s) => ({ ...s })), fields: t.fields.map((f) => ({ ...f, options: [...(f.options || [])] })),
    steps: t.steps.map((s) => ({ id: s.id, name: s.name })),
    mats: t.materials.map((tm) => ({ material_id: tm.material_id, step_index: tm.step_id ? t.steps.findIndex((s) => s.id === tm.step_id) : -1, qty: tm.qty })),
    scope: { mode: t.scope.mode || 'all', ids: new Set(t.scope.ids || []), zones: new Set(t.scope.zones || []) },
    claims: t.claims, show_map: t.show_map, status: t.status, due_date: t.due_date, description: t.description, linkPage: '', linkDwg: '',
  } : { kind: 'tr', id: null, preset: null };
  if (!t) applyPreset(st, PRESETS[0]);
  st.paint = () => setBody(trackerBody(st));
  openPanel(t ? 'Edit tracker' : 'New tracker', t ? esc(t.name) : 'Pick a starting point, then change anything', trackerBody(st), st);
}
function applyPreset(st, p) {
  const findType = (n) => S.types.find((ty) => ty.name.toLowerCase() === n) || S.types.find((ty) => ty.name.toLowerCase().includes(n?.split(' ')[0] || '~')) || S.types[0];
  Object.assign(st, {
    preset: p.key, name: p.name || '', color: p.color || PALETTE[0], type_id: findType(p.type)?.id, mode: p.mode || 'steps', unit: p.unit || '', default_target: p.target || 0,
    statuses: (p.statuses || DEFAULT_STATUSES).map((s) => ({ key: s.key || '', label: s.label, color: s.color, done: !!s.done, problem: !!s.problem })),
    fields: (p.fields || []).map((f) => ({ label: f.label, type: f.type, options: f.options || [] })),
    steps: (p.steps || (p.mode === 'steps' || !p.mode ? [''] : [])).map((n) => ({ name: n })), mats: [],
    scope: { mode: 'all', ids: new Set(), zones: new Set() }, claims: true, show_map: true, status: 'active', due_date: '', description: '',
  });
}
function trackerBody(st) {
  const ty = S.TY[st.type_id]; const par = ty && S.TY[ty.parent_type_id];
  const zones = [...new Set(S.locations.map((l) => l.zone).filter(Boolean))];
  const pickPool = st.scope.mode === 'parents' ? S.locations.filter((l) => par && l.type_id === par.id) : S.locations.filter((l) => l.type_id === st.type_id);
  const inScope = (() => { const fake = { type_id: st.type_id, scope: { mode: st.scope.mode, ids: [...st.scope.ids], zones: [...st.scope.zones] } }; return scopeLocs(fake).length; })();
  const myLinks = st.id ? S.links.filter((lk) => lk.tracker_id === st.id) : [];
  return `<form data-form="tracker">
  ${!st.id ? `<div class="presets">${PRESETS.map((p) => `<button type="button" data-act="tr-preset" data-k="${p.key}" ${pressed(st.preset === p.key)}><b>${p.title}</b><small>${p.sub}</small></button>`).join('')}</div>` : ''}
  <label class="f"><span>Tracker name</span><input data-k="name" value="${esc(st.name)}" placeholder="DC string wiring" required></label>
  <span class="lbl">Color</span><div class="colors" style="margin-bottom:14px">${PALETTE.map((c) => `<button type="button" data-act="tr-color" data-c="${c}" style="background:${c}" ${pressed(st.color === c)} aria-label="${c}"></button>`).join('')}</div>
  <div class="grid2"><label class="f"><span>Tracked by</span><select data-k="type_id">${S.types.map((x) => `<option value="${x.id}" ${x.id === st.type_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
    <label class="f"><span>Status</span><select data-k="status">${[['active', 'Active'], ['hold', 'On hold'], ['done', 'Done']].map(([v, l]) => `<option value="${v}" ${st.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
  <span class="lbl">How it's tracked</span>
  <div class="seg" role="group" style="margin-bottom:6px">${[['steps', 'Steps'], ['status', 'One status'], ['qty', 'Quantity']].map(([v, l]) => `<button type="button" data-act="tr-mode" data-v="${v}" ${pressed(st.mode === v)}>${l}</button>`).join('')}</div>
  <p class="hint">${st.mode === 'steps' ? `Each ${esc((ty?.name || 'location').toLowerCase())} works through the steps below, each with its own status.` : st.mode === 'status' ? `Each ${esc((ty?.name || 'location').toLowerCase())} gets one status.` : `Count up a quantity on each ${esc((ty?.name || 'location').toLowerCase())} against a target, like feet pulled or strings landed.`}</p>
  ${st.mode === 'qty' ? `<div class="grid2"><label class="f"><span>Unit</span><input data-k="unit" value="${esc(st.unit)}" placeholder="ft"></label><label class="f"><span>Target per ${esc((ty?.name || 'location').toLowerCase())}</span><input data-k="default_target" type="number" step="any" value="${esc(st.default_target)}"></label></div>` : ''}

  ${st.mode === 'steps' ? `<h3>Steps, in order</h3><ul class="ed-list steps">${st.steps.map((s, i) => `<li><span class="o">${i + 1}</span><input data-step="${i}" value="${esc(s.name)}" placeholder="Step" aria-label="Step ${i + 1}">
      <button type="button" class="ic" data-act="tr-step-up" data-i="${i}" ${i ? '' : 'disabled'} aria-label="Up">↑</button><button type="button" class="ic" data-act="tr-step-down" data-i="${i}" ${i < st.steps.length - 1 ? '' : 'disabled'} aria-label="Down">↓</button><button type="button" class="ic" data-act="tr-step-del" data-i="${i}" aria-label="Remove">×</button></li>`).join('')}</ul>
    <button type="button" class="btn sm" data-act="tr-step-add">Add step</button>` : ''}

  <h3>Statuses <small style="color:var(--faint);font-weight:500">first one is the starting state</small></h3>
  <ul class="ed-list stat">${st.statuses.map((s, i) => `<li><input type="color" data-sti="${i}" data-f="color" value="${esc(s.color)}" aria-label="Color"><input data-sti="${i}" data-f="label" value="${esc(s.label)}" aria-label="Status name">
      <span class="flags"><label><input type="checkbox" data-sti="${i}" data-f="done" ${s.done ? 'checked' : ''}> Counts as done</label><label><input type="checkbox" data-sti="${i}" data-f="problem" ${s.problem ? 'checked' : ''}> Problem</label></span><span></span>
      <button type="button" class="ic" data-act="tr-st-del" data-i="${i}" ${st.statuses.length > 2 ? '' : 'disabled'} aria-label="Remove">×</button></li>`).join('')}</ul>
  <button type="button" class="btn sm" data-act="tr-st-add">Add status</button>

  <h3>Extra fields <small style="color:var(--faint);font-weight:500">recorded on each ${esc((ty?.name || 'location').toLowerCase())}</small></h3>
  <ul class="ed-list fld">${st.fields.map((f, i) => `<li><input data-fdi="${i}" data-f="label" value="${esc(f.label)}" placeholder="Megger reading, Date landed, Torqued…">
      <select data-fdi="${i}" data-f="type">${[['text', 'Text'], ['number', 'Number'], ['date', 'Date'], ['check', 'Checkbox'], ['select', 'Pick list']].map(([v, l]) => `<option value="${v}" ${f.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button type="button" class="ic" data-act="tr-fd-del" data-i="${i}" aria-label="Remove">×</button>
      ${f.type === 'select' ? `<input class="opts" data-fdi="${i}" data-f="options" value="${esc((f.options || []).join(', '))}" placeholder="Choices, separated by commas">` : ''}</li>`).join('')}</ul>
  <button type="button" class="btn sm" data-act="tr-fd-add">Add field</button>

  <h3>Which ${esc((ty?.plural || 'locations').toLowerCase())} <small style="color:var(--faint);font-weight:500">${inScope} in scope</small></h3>
  <div class="seg" role="group" style="margin-bottom:10px">${[['all', 'All'], ...(par ? [['parents', `Inside some ${par.plural.toLowerCase()}`]] : []), ...(zones.length ? [['zones', 'By zone']] : []), ['pick', 'Pick']].map(([v, l]) => `<button type="button" data-act="tr-scope" data-v="${v}" ${pressed(st.scope.mode === v)}>${esc(l)}</button>`).join('')}</div>
  ${st.scope.mode === 'zones' ? `<div class="chips">${zones.map((z) => `<button type="button" class="chip" data-act="tr-zone" data-z="${esc(z)}" ${pressed(st.scope.zones.has(z))}>${esc(z)}</button>`).join('')}</div>` : ''}
  ${st.scope.mode === 'parents' || st.scope.mode === 'pick' ? `<div class="chips" style="max-height:220px;overflow:auto">${pickPool.map((l) => `<button type="button" class="chip" data-act="tr-pickloc" data-id="${l.id}" ${pressed(st.scope.ids.has(l.id))}>${esc(l.name)}</button>`).join('') || '<span class="hint">None added yet.</span>'}</div>` : ''}

  <h3>Material per ${st.mode === 'qty' ? esc(st.unit || 'unit') : esc((ty?.name || 'location').toLowerCase())}</h3>
  <p class="hint">Drives "still need" on the materials list.${st.mode !== 'qty' ? ' When something is marked done, its material stops counting as needed.' : ''}</p>
  ${S.materials.length ? `<ul class="ed-list mats">${st.mats.map((r, i) => `<li><select data-mi="${i}" data-f="material_id" aria-label="Material"><option value="">Material…</option>${S.materials.map((m) => `<option value="${m.id}" ${+r.material_id === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
      ${st.mode === 'steps' ? `<select class="st" data-mi="${i}" data-f="step_index" aria-label="Step"><option value="-1">Whole tracker</option>${st.steps.map((s, j) => `<option value="${j}" ${+r.step_index === j ? 'selected' : ''}>${j + 1}. ${esc(s.name || 'Step')}</option>`).join('')}</select>` : '<span class="st"></span>'}
      <input data-mi="${i}" data-f="qty" type="number" step="any" min="0" value="${esc(r.qty)}" placeholder="Qty" aria-label="Quantity"><button type="button" class="ic" data-act="tr-mat-del" data-i="${i}" aria-label="Remove">×</button></li>`).join('')}</ul>
    <button type="button" class="btn sm" data-act="tr-mat-add">Add material</button>` : '<p class="hint">Add materials first, then link them here.</p>'}

  <h3>Drawings for this tracker</h3>
  ${st.id ? `${myLinks.length ? `<ul class="hist">${myLinks.map((lk) => `<li><div><b>${esc(S.D[lk.drawing_id]?.sheet || '')} ${esc(S.D[lk.drawing_id]?.name || '')}</b>${lk.page ? `, page ${lk.page}` : ''}${lk.location_id ? ` <small>for ${esc(lname(lk.location_id))}</small>` : ''}</div><button type="button" class="btn sm ghost" data-act="link-del" data-id="${lk.id}">Remove</button></li>`).join('')}</ul>` : ''}
    ${S.drawings.length ? `<div class="row" style="margin-top:8px"><select data-k="linkDwg" style="flex:1 1 200px;width:auto"><option value="">Pick a drawing…</option>${S.drawings.map((d) => `<option value="${d.id}" ${String(st.linkDwg) === String(d.id) ? 'selected' : ''}>${esc(d.sheet ? d.sheet + ' ' : '')}${esc(d.name)}</option>`).join('')}</select>
      <input data-k="linkPage" type="number" min="0" placeholder="Page (blank = all)" value="${esc(st.linkPage)}" style="flex:0 1 150px;width:auto"><button type="button" class="btn sm" data-act="tr-link-add">Attach</button></div>` : '<p class="hint">Upload drawings on the Drawings tab first.</p>'}`
    : '<p class="hint">Save the tracker first, then attach drawings.</p>'}

  <h3>Options</h3>
  <label class="check"><input type="checkbox" data-k="claims" ${st.claims ? 'checked' : ''}> Track who's on it</label>
  <label class="check"><input type="checkbox" data-k="show_map" ${st.show_map ? 'checked' : ''}> Show on the map</label>
  <div class="grid2" style="margin-top:10px"><label class="f"><span>Due</span><input data-k="due_date" type="date" value="${esc(st.due_date)}"></label></div>
  <label class="f"><span>Notes</span><textarea data-k="description" placeholder="Scope, sheet references, anything the crew should know">${esc(st.description)}</textarea></label>
  <div class="row" style="margin-top:18px"><button class="btn sun">${st.id ? 'Save tracker' : 'Create tracker'}</button>${st.id ? `<button type="button" class="btn danger" data-act="tracker-del" data-id="${st.id}">Delete tracker</button>` : ''}</div>
  ${st.id ? '<p class="hint" style="margin-top:10px">Changing "Tracked by" clears this tracker\'s progress.</p>' : ''}</form>`;
}
function readTracker(st) {
  const f = $('#panel form[data-form="tracker"]'); if (!f) return;
  $$('[data-k]', f).forEach((el) => { const k = el.dataset.k; st[k] = el.type === 'checkbox' ? el.checked : k === 'type_id' ? +el.value : el.value; });
  $$('[data-step]', f).forEach((el) => { st.steps[+el.dataset.step].name = el.value; });
  $$('[data-sti]', f).forEach((el) => { const s = st.statuses[+el.dataset.sti]; s[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value; });
  $$('[data-fdi]', f).forEach((el) => { const fd = st.fields[+el.dataset.fdi]; fd[el.dataset.f] = el.dataset.f === 'options' ? el.value.split(',').map((x) => x.trim()).filter(Boolean) : el.value; });
  $$('[data-mi]', f).forEach((el) => { st.mats[+el.dataset.mi][el.dataset.f] = el.value; });
}
const trEdit = (fn) => () => { const st = ui.panel; readTracker(st); fn(st); st.paint(); };

// Drawing detail panel
function openDrawing(id) {
  const st = { kind: 'dwg', id, autoType: S.types[0]?.id };
  st.live = () => { if (S.D[id]) setBody(dwgBody(st)); else closePanel(); };
  const d = S.D[id];
  openPanel(esc(d.name), esc([d.sheet, d.rev && `Rev ${d.rev}`, `${d.pages} page${d.pages > 1 ? 's' : ''}`].filter(Boolean).join(' · ')), dwgBody(st), st);
}
function dwgBody(st) {
  const d = S.D[st.id]; const links = S.links.filter((lk) => lk.drawing_id === d.id);
  const pages = Array.from({ length: Math.min(d.pages, 400) }, (_, i) => i + 1);
  const linkChips = (pg) => links.filter((lk) => lk.page === pg).map((lk) => `<span class="chip static">${lk.location_id ? esc(lname(lk.location_id)) : ''}${lk.tracker_id ? `${lk.location_id ? ' · ' : ''}${esc(S.TR[lk.tracker_id]?.name || '')}` : ''}${S.manage ? ` <button class="btn sm ghost" style="min-height:20px;padding:0 2px" data-act="link-del" data-id="${lk.id}" aria-label="Remove link">×</button>` : ''}</span>`).join('');
  docGroups.dwg = pages.map((p) => ({ drawing_id: d.id, page: d.is_pdf ? p : 0, label: `Page ${p}` }));
  return `<div class="row" style="margin-bottom:12px"><button class="btn sun sm" data-act="view-docs" data-g="dwg" data-i="0">Open viewer</button><a class="btn sm" href="/api/drawings/${d.id}/file?t=${tok()}" target="_blank" rel="noopener">Original file</a></div>
  ${S.manage ? `<form data-form="dwg-meta" class="grid2"><label class="f"><span>Sheet</span><input name="sheet" value="${esc(d.sheet)}" placeholder="E-301"></label><label class="f"><span>Name</span><input name="name" value="${esc(d.name)}"></label><label class="f"><span>Rev</span><input name="rev" value="${esc(d.rev)}"></label><div style="align-self:end;margin-bottom:14px"><button class="btn sm">Save</button></div></form>` : ''}
  ${S.manage && d.is_pdf ? `<div class="fieldset"><span class="lbl">Match pages to names automatically</span><p class="hint">Reads the text on each page and links it to the ${esc('location')} named there. Pages that mention more than 3 (like key plans) are skipped. Scanned PDFs with no text can't be matched; link those by hand.</p>
    <div class="row"><select data-act="dwg-auto-type" style="width:auto">${S.types.map((ty) => `<option value="${ty.id}" ${ty.id === st.autoType ? 'selected' : ''}>${esc(ty.plural)}</option>`).join('')}</select><button class="btn sm" data-act="dwg-auto">Match pages</button></div></div>` : ''}
  ${links.filter((lk) => !lk.page).length ? `<h3>Whole file is linked to</h3><div class="chips">${linkChips(0)}</div>` : ''}
  ${S.manage ? `<div class="row" style="margin-top:12px"><button class="btn sm" data-act="link-page" data-p="0">Link whole file</button></div>` : ''}
  <h3>Pages</h3><ul class="pg-list">${pages.map((p) => `<li><span class="pg">${d.is_pdf ? `p${p}` : 'Image'}</span><div class="chips">${linkChips(d.is_pdf ? p : 0) || '<span class="hint" style="margin:0">Not linked</span>'}</div>
    <div class="row"><button class="btn sm ghost" data-act="view-docs" data-g="dwg" data-i="${p - 1}">View</button>${S.manage ? `<button class="btn sm" data-act="link-page" data-p="${d.is_pdf ? p : 0}">Link</button><button class="btn sm" data-act="page-map" data-p="${p}">Use as plan</button>` : ''}</div></li>`).join('')}</ul>
  ${S.manage ? `<div class="row" style="margin-top:18px"><button class="btn danger sm" data-act="dwg-del" data-id="${d.id}">Delete drawing</button></div>` : ''}`;
}
function openLinkPage(drawingId, page, presetLoc) {
  const st = { kind: 'link', drawingId, page, locs: new Set(presetLoc ? [presetLoc] : []), filter: '', type: presetLoc ? S.L[presetLoc]?.type_id : S.types[0]?.id, tracker: '' };
  st.paint = () => setBody(linkBody(st));
  const d = S.D[drawingId];
  openPanel('Link drawing', esc(`${d.sheet ? d.sheet + ' ' : ''}${d.name}${page ? `, page ${page}` : ''}`), linkBody(st), st);
}
function linkBody(st) {
  const pool = S.locations.filter((l) => l.type_id === st.type && (!st.filter || l.name.toLowerCase().includes(st.filter.toLowerCase())));
  return `<span class="lbl">Show it on these locations</span>
  <div class="row" style="margin-bottom:8px"><select data-act="lk-type" style="width:auto">${S.types.map((ty) => `<option value="${ty.id}" ${ty.id === st.type ? 'selected' : ''}>${esc(ty.plural)}</option>`).join('')}</select><input type="search" data-act="lk-filter" value="${esc(st.filter)}" placeholder="Filter" style="flex:1 1 140px;width:auto"></div>
  <div class="chips" style="max-height:260px;overflow:auto;margin-bottom:16px">${pool.map((l) => `<button class="chip" data-act="lk-loc" data-id="${l.id}" ${pressed(st.locs.has(l.id))}>${esc(l.name)}</button>`).join('') || '<span class="hint">None.</span>'}</div>
  <label class="f"><span>And/or with this tracker</span><select data-act="lk-tracker"><option value="">No tracker</option>${S.trackers.map((t) => `<option value="${t.id}" ${String(st.tracker) === String(t.id) ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
  <p class="hint">A drawing linked to a location shows up whenever someone taps that location, and on everything inside it. A drawing linked to only a tracker opens from that tracker's header.</p>
  <button class="btn sun" data-act="lk-save">Link ${st.locs.size ? `to ${st.locs.size} location${st.locs.size > 1 ? 's' : ''}` : ''}</button>`;
}

// Drawing viewer (full screen, pan/zoom, tabs for related sheets)
const vw = { items: [], i: 0, page: 1, s: 1, tx: 0, ty: 0, dark: true };
function openViewer(items, i = 0) {
  if (!items?.length) return;
  vw.items = items; vw.i = clamp(i, 0, items.length - 1); vw.page = items[vw.i].page || 1;
  $('#viewer').hidden = false; paintViewer();
}
function paintViewer() {
  const it = vw.items[vw.i]; const d = S.D[it.drawing_id]; const v = $('#viewer');
  const w = Math.min(3200, Math.round(Math.max(window.innerWidth, 900) * (window.devicePixelRatio || 1) * 1.2));
  const multi = d.is_pdf && !it.page && d.pages > 1;
  v.innerHTML = `<div class="vbar"><h2>${esc(d.sheet || '')} ${esc(d.name)}<small>${d.is_pdf ? `page ${vw.page} of ${d.pages}` : ''}${it.why ? ` · ${esc(it.why)}` : ''}</small></h2>
    ${multi ? `<button class="btn sm" data-act="vw-page" data-d="-1" ${vw.page > 1 ? '' : 'disabled'}>Prev page</button><button class="btn sm" data-act="vw-page" data-d="1" ${vw.page < d.pages ? '' : 'disabled'}>Next page</button>` : ''}
    <div class="seg"><button data-act="vw-dark" data-v="1" ${pressed(vw.dark)}>Night</button><button data-act="vw-dark" data-v="0" ${pressed(!vw.dark)}>Original</button></div>
    <a class="btn sm" href="/api/drawings/${d.id}/file?t=${tok()}" target="_blank" rel="noopener">File</a><button class="btn sm sun" data-act="vw-close">Close</button></div>
  <div class="stage" id="vstage"><img alt="${esc(d.name)} page ${vw.page}" class="${vw.dark ? 'dark' : ''}" src="/api/drawings/${d.id}/page/${vw.page}?w=${w}&t=${tok()}"><div class="loading" id="vload">Loading sheet…</div>
    <div class="map-zoom"><button data-act="vw-zoom" data-z="1.4" aria-label="Zoom in">+</button><button data-act="vw-zoom" data-z="0.7" aria-label="Zoom out">−</button><button data-act="vw-fit">Fit</button></div></div>
  ${vw.items.length > 1 ? `<div class="vtabs">${vw.items.map((x, i) => { const dd = S.D[x.drawing_id]; return `<button class="chip" data-act="vw-go" data-i="${i}" ${pressed(i === vw.i)}>${esc(dd.sheet || dd.name)}${x.page ? ` p${x.page}` : ''}${x.why ? ` <small>${esc(x.why)}</small>` : x.label ? ` <small>${esc(x.label)}</small>` : ''}</button>`; }).join('')}</div>` : '<div></div>'}`;
  const stage = $('#vstage'), img = stage.querySelector('img');
  vw.pz = panZoom(stage, vw, {});
  // the zoom buttons live in the stage; keep the image as first child for the transform
  img.onload = () => { $('#vload')?.remove(); vwFit(); };
  img.onerror = () => { const l = $('#vload'); if (l) l.textContent = "This sheet couldn't be loaded."; };
}
function vwFit() { const stage = $('#vstage'), img = stage?.querySelector('img'); if (!img?.naturalWidth) return; const s = Math.min(stage.clientWidth / img.naturalWidth, stage.clientHeight / img.naturalHeight); Object.assign(vw, { s, min: s * 0.5, max: s * 12, tx: (stage.clientWidth - img.naturalWidth * s) / 2, ty: (stage.clientHeight - img.naturalHeight * s) / 2 }); vw.pz.apply(); }
function closeViewer() { $('#viewer').hidden = true; $('#viewer').innerHTML = ''; }

// small editors
function openMatEdit(id) {
  const m = id ? S.M[id] : null; const cats = [...new Set(S.materials.map((x) => x.category).filter(Boolean))];
  openPanel(m ? 'Edit material' : 'New material', m ? esc(m.name) : '', `<form data-form="mat" data-id="${id || ''}">
    <label class="f"><span>Name</span><input name="name" value="${esc(m?.name)}" placeholder="10 AWG PV wire, red" required ${m ? '' : 'autofocus'}></label>
    <div class="grid2"><label class="f"><span>Part number</span><input name="part_no" value="${esc(m?.part_no)}"></label><label class="f"><span>Unit</span><input name="unit" value="${esc(m?.unit || 'ea')}" list="units"></label>
      <label class="f"><span>Category</span><input name="category" value="${esc(m?.category)}" list="cats" placeholder="Wire"></label><label class="f"><span>Where it's kept</span><input name="location" value="${esc(m?.location)}" placeholder="Conex 2"></label></div>
    <datalist id="units"><option>ea</option><option>ft</option><option>box</option><option>roll</option><option>spool</option></datalist><datalist id="cats">${cats.map((c) => `<option>${esc(c)}</option>`).join('')}</datalist>
    ${m ? '' : `<div class="grid2"><label class="f"><span>On hand now</span><input name="on_hand" type="number" step="any" min="0" value="0"></label><label class="f"><span>Already on order</span><input name="on_order" type="number" step="any" min="0" value="0"></label></div>`}
    <div class="grid2"><label class="f"><span>Reorder below</span><input name="reorder_point" type="number" step="any" min="0" value="${esc(m?.reorder_point || 0)}"></label><label class="f"><span>Extra need, not from a tracker</span><input name="extra_need" type="number" step="any" min="0" value="${esc(m?.extra_need || 0)}"></label></div>
    <label class="f"><span>Notes</span><textarea name="notes">${esc(m?.notes)}</textarea></label>
    ${m ? '<p class="hint">To change on hand, use Count on the material so the history stays right.</p>' : ''}
    <div class="row"><button class="btn sun">${m ? 'Save material' : 'Add material'}</button>${m ? `<button type="button" class="btn danger" data-act="mat-del" data-id="${m.id}">Delete</button>` : ''}</div></form>`);
}
function openImport() {
  openPanel('Import materials', 'From a takeoff or spreadsheet', `<form data-form="import"><p class="hint">Paste CSV with a header row. Columns it reads: name, part_no, category, unit, on_hand, on_order, reorder_point, extra_need, location. Matching names get updated.</p>
    <label class="f"><span>Or pick a .csv file</span><input type="file" accept=".csv,text/csv" data-act="import-file"></label>
    <label class="f"><span>CSV</span><textarea name="csv" style="min-height:220px" placeholder="name,part_no,category,unit,on_hand,reorder_point&#10;10 AWG PV wire red,PV10R,Wire,ft,5000,2000"></textarea></label><button class="btn sun">Import</button></form>`);
}
function openMapUpload(locId) {
  openPanel('Add plan', 'PDF, PNG or JPG', `<form data-form="map-upload"><label class="f"><span>File</span><input type="file" name="file" accept=".pdf,image/png,image/jpeg" required></label>
    <div class="grid2"><label class="f"><span>PDF page</span><input type="number" name="page" value="1" min="1"></label><label class="f"><span>Name</span><input name="name" placeholder="Site plan"></label></div>
    <label class="f"><span>This plan is for</span><select name="location_id"><option value="">The whole site</option>${locOptions(locId || '')}</select></label>
    <p class="hint">A plan for one location (like a PB) opens when someone taps that PB, so they can outline rows and pin transitions on it. You can also make plans from pages on the Drawings tab.</p><button class="btn sun">Upload</button></form>`);
}
function openDwgUpload(presetTracker) {
  openPanel('Upload drawings', 'IFC sets, PB sheets, details', `<form data-form="dwg-upload"><label class="f"><span>File (PDF or image)</span><input type="file" name="file" accept=".pdf,image/png,image/jpeg" required></label>
    <div class="grid2"><label class="f"><span>Sheet</span><input name="sheet" placeholder="E-301"></label><label class="f"><span>Rev</span><input name="rev" placeholder="IFC / 2"></label></div>
    <label class="f"><span>Name</span><input name="name" placeholder="Uses the file name if blank"></label>
    <label class="f"><span>Match pages to</span><select name="auto_type_id"><option value="">Don't match automatically</option>${S.types.map((ty) => `<option value="${ty.id}" ${ty.id === S.types[0]?.id ? 'selected' : ''}>${esc(ty.plural)} named on each page</option>`).join('')}</select></label>
    <label class="f"><span>Also attach to tracker</span><select name="tracker_id"><option value="">None</option>${S.trackers.map((t) => `<option value="${t.id}" ${String(presetTracker) === String(t.id) ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
    <p class="hint">Big IFC sets can take a minute to upload and read.</p><button class="btn sun">Upload</button></form>`);
}
function openAreaEdit(a) {
  ui.map.picked = a.id; repaintMap();
  const m = S.maps.find((x) => x.id === a.map_id); const onMap = new Set(S.areas.filter((x) => x.map_id === a.map_id && x.location_id && x.id !== a.id).map((x) => x.location_id));
  const st = { kind: 'area', filter: '', type: S.L[a.location_id]?.type_id || ui.map.assignType };
  st.list = () => { const pool = S.locations.filter((l) => l.type_id === st.type && (!m.location_id || S.anc[l.id].includes(m.location_id)) && (!st.filter || l.name.toLowerCase().includes(st.filter.toLowerCase()))).sort((x, y) => onMap.has(x.id) - onMap.has(y.id));
    return `<div class="row" style="margin-bottom:8px"><select data-act="area-type" style="width:auto">${S.types.map((ty) => `<option value="${ty.id}" ${ty.id === st.type ? 'selected' : ''}>${esc(ty.plural)}</option>`).join('')}</select><input type="search" data-act="area-filter" value="${esc(st.filter)}" placeholder="Search" style="flex:1 1 140px;width:auto"></div>
    <ul class="picklist">${pool.map((l) => `<li><button data-act="area-assign" data-a="${a.id}" data-id="${l.id}"><span>${esc(l.name)}</span><small>${l.id === a.location_id ? 'this one' : onMap.has(l.id) ? 'already placed' : ''}</small></button></li>`).join('') || '<li class="hint" style="padding:12px">None match.</li>'}</ul>
    <div class="row" style="margin-top:14px"><button class="btn danger" data-act="area-del" data-id="${a.id}">Remove ${a.points.length === 1 ? 'pin' : 'outline'}</button></div>`; };
  openPanel(a.location_id && S.L[a.location_id] ? `${a.points.length === 1 ? 'Pin' : 'Outline'} for ${esc(lname(a.location_id))}` : 'Which one is this?', 'Pick the location this belongs to', st.list(), st);
}
function openPerson(name) {
  const u = name ? S.users.find((x) => x.name === name) : null; const nameOnly = name && !u;
  openPanel(name ? esc(name) : 'Add person', u ? 'Can sign in' : name ? 'Crew, no sign-in' : '', `<form data-form="person" data-name="${esc(name || '')}" data-user="${u?.id || ''}">
    ${!name ? '<label class="f"><span>Name</span><input name="name" required autofocus></label>' : ''}
    ${u ? '' : `<p class="hint">${nameOnly ? 'Give them a PIN to let them sign in on their own phone.' : 'Leave the PIN blank if they only need to appear in the crew list.'}</p>`}
    <label class="f"><span>${u ? 'New PIN (blank keeps it)' : 'PIN, 4 to 8 digits'}</span><input name="pin" inputmode="numeric" pattern="\\d{4,8}" autocomplete="off"></label>
    <label class="f"><span>Role</span><select name="role">${[['crew', 'Crew: log material, update progress'], ['lead', 'Lead: also manage materials, trackers, plans, drawings'], ['foreman', 'Foreman: everything, including roles']].filter(([v]) => v !== 'foreman' || S.me.role === 'foreman').map(([v, l]) => `<option value="${v}" ${(u?.role || 'crew') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <div class="row"><button class="btn sun">${name ? 'Save' : 'Add person'}</button>
      ${u && u.id !== S.me.id ? `<button type="button" class="btn ${u.active ? 'danger' : ''}" data-act="user-active" data-id="${u.id}" data-v="${u.active ? 0 : 1}">${u.active ? 'Turn off sign-in' : 'Turn sign-in back on'}</button>` : ''}
      ${nameOnly ? `<button type="button" class="btn danger" data-act="crew-remove" data-name="${esc(name)}">Remove</button>` : ''}</div></form>`);
}
function openTypeEdit(id) {
  const t = id ? S.TY[id] : null;
  openPanel(t ? `Edit ${esc(t.name)}` : 'New location type', 'Something work is tracked against', `<form data-form="type" data-id="${id || ''}">
    <div class="grid2"><label class="f"><span>Name</span><input name="name" value="${esc(t?.name)}" placeholder="Inverter" required ${t ? '' : 'autofocus'}></label><label class="f"><span>Plural</span><input name="plural" value="${esc(t?.plural)}" placeholder="Inverters"></label>
      <label class="f"><span>Short label</span><input name="short" value="${esc(t?.short)}" placeholder="INV" maxlength="12"></label>
      <label class="f"><span>Lives inside</span><select name="parent_type_id"><option value="">Nothing (top level)</option>${S.types.filter((x) => x.id !== id).map((x) => `<option value="${x.id}" ${t?.parent_type_id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label></div>
    <span class="lbl">On plans, show it as</span><div class="seg" role="group" style="margin-bottom:16px"><label class="check" style="margin:6px 12px"><input type="radio" name="shape" value="area" ${t?.shape !== 'pin' ? 'checked' : ''}> An outlined area</label><label class="check" style="margin:6px 12px"><input type="radio" name="shape" value="pin" ${t?.shape === 'pin' ? 'checked' : ''}> A pin (a point, like a transition)</label></div>
    <div class="row"><button class="btn sun">${t ? 'Save' : 'Add type'}</button>${t ? `<button type="button" class="btn danger" data-act="type-del" data-id="${t.id}">Delete type</button>` : ''}</div></form>`);
}
function openLocEdit(id) {
  const l = S.L[id]; const ty = typeOf(l); const par = S.TY[ty.parent_type_id];
  openPanel(`Edit ${esc(l.name)}`, esc(ty.name), `<form data-form="loc" data-id="${id}"><div class="grid2"><label class="f"><span>Name</span><input name="name" value="${esc(l.name)}" required></label><label class="f"><span>Zone</span><input name="zone" value="${esc(l.zone)}"></label></div>
    ${par ? `<label class="f"><span>Inside</span><select name="parent_id"><option value="">None</option>${S.locations.filter((x) => x.type_id === par.id).map((x) => `<option value="${x.id}" ${x.id === l.parent_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>` : ''}
    <label class="f"><span>Notes</span><textarea name="notes">${esc(l.notes)}</textarea></label>
    <div class="row"><button class="btn sun">Save</button><button type="button" class="btn danger" data-act="loc-del" data-id="${id}">Remove${(S.kids[id] || []).length ? ` with ${(S.kids[id] || []).length} inside` : ''}</button></div></form>`);
}
function pickMaterialAt(lid) {
  const st = { kind: 'pick', filter: '' };
  st.list = () => `<input type="search" data-act="pick-filter" placeholder="Search materials" value="${esc(st.filter)}" autofocus style="margin-bottom:8px">
    <ul class="picklist">${S.materials.filter((m) => !st.filter || m.name.toLowerCase().includes(st.filter.toLowerCase())).map((m) => `<li><button data-act="pick-mat" data-id="${m.id}" data-l="${lid}"><span>${esc(m.name)}</span><small>${q(m.on_hand)} ${esc(m.unit)} on hand</small></button></li>`).join('') || '<li class="hint" style="padding:12px">No materials.</li>'}</ul>`;
  openPanel('Log material', `at ${esc(lname(lid))}`, st.list(), st);
}

// ── sign-in ───────────────────────────────────────────────────────────
let gate = { status: null, name: '', pin: '', err: '' };
async function renderGate() {
  const app = $('#app');
  if (!gate.status) {
    app.innerHTML = `<div class="gate"><div class="gate-card mod">${LOGO}<h1>Material Tracker</h1><p class="sub">Connecting…</p></div></div>`;
    try { gate.status = await api('GET', '/api/status'); }
    catch (e) { app.innerHTML = `<div class="gate"><div class="gate-card mod">${LOGO}<h1>Can't reach the server</h1><p class="sub">${esc(e.message)}</p><button class="btn sun" onclick="location.reload()">Try again</button></div></div>`; return; }
  }
  const s = gate.status;
  if (s.setup_needed) {
    app.innerHTML = `<div class="gate"><div class="gate-card mod">${LOGO}<h1>Set up the job</h1><p class="sub">You'll be the foreman. Power blocks, rows and transitions are set up as starting location types. Change them anytime.</p>
      <form data-form="setup"><label class="f"><span>Job name</span><input name="job_name" placeholder="Sunflower Solar, Phase 2" required autofocus></label>
        <label class="f"><span>Your name</span><input name="name" required></label><label class="f"><span>Your PIN, 4 to 8 digits</span><input name="pin" inputmode="numeric" pattern="\\d{4,8}" required autocomplete="new-password"></label>
        <p class="err">${esc(gate.err)}</p><button class="btn sun" style="width:100%">Start tracking</button></form></div></div>`;
    return;
  }
  app.innerHTML = `<div class="gate"><div class="gate-card mod">${LOGO}<h1>${esc(s.job_name || 'Material Tracker')}</h1><p class="sub">${gate.name ? `Enter your PIN, ${esc(gate.name)}.` : 'Who are you?'}</p>
    ${!gate.name ? `<div class="chips">${s.users.map((n) => `<button class="chip" style="min-height:46px;font-size:16px" data-act="gate-name" data-n="${esc(n)}">${esc(n)}</button>`).join('')}</div>`
    : `<div class="pin-dots">${Array.from({ length: Math.max(4, gate.pin.length) }, (_, i) => `<i class="${i < gate.pin.length ? 'on' : ''}"></i>`).join('')}</div><p class="err">${esc(gate.err)}</p>
      <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-act="pin" data-n="${n}">${n}</button>`).join('')}<button data-act="pin-back" aria-label="Delete">⌫</button><button data-act="pin" data-n="0">0</button><button class="go" data-act="pin-go">Go</button></div>
      <div class="row" style="margin-top:14px"><button class="btn ghost" data-act="gate-name" data-n="">Not ${esc(gate.name)}?</button></div>`}</div></div>`;
}
async function tryLogin() {
  if (gate.pin.length < 4) { gate.err = 'PINs are at least 4 digits.'; return renderGate(); }
  try { const r = await api('POST', '/api/login', { name: gate.name, pin: gate.pin }); local.token = r.token; gate = { status: null, name: '', pin: '', err: '' }; render(); await refresh(); }
  catch (e) { gate.err = e.message; gate.pin = ''; renderGate(); }
}
function signOut() { local.token = ''; S = null; gate = { status: null, name: '', pin: '', err: '' }; closePanel(); render(); }

let toastTimer;
function toast(msg, { bad = false } = {}) {
  const t = $('#toast'); t.innerHTML = `<span>${esc(msg)}</span>`; t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = ''), 3400);
}

// ── actions ───────────────────────────────────────────────────────────
function go(v) { ui.view = v; location.hash = v; ui.selMode = false; ui.sel.clear(); closePanel(); render(); window.scrollTo(0, 0); }
async function setEntries(t, locIds, stepIds, body) {
  await mutate('POST', '/api/entries', { tracker_id: t.id, location_ids: locIds, step_ids: stepIds, ...body }, {
    queue: true,
    optimistic: () => { for (const l of locIds) for (const s of (t.mode === 'steps' ? stepIds : [0])) {
      const key = `${t.id}:${l}:${s}`; let e = S.E[key];
      if (!e) { e = { t: t.id, l, s, status: t.statuses[0].key, qty: 0, target: null, values: {}, crew: [] }; S.entries.push(e); }
      if (body.status) e.status = body.status; if (body.crew) e.crew = body.crew; if (body.values) e.values = { ...e.values, ...body.values };
      if (body.qty_add != null) e.qty = Math.max(0, (e.qty || 0) + body.qty_add);
      e.by = S.me.name; e.at = new Date().toISOString(); } },
  });
}
const ACT = {
  go: (el) => go(el.dataset.v), close: closePanel,
  install: async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; render(); },
  signout: () => { if (confirm('Sign out on this device?')) signOut(); },
  'gate-name': (el) => { gate.name = el.dataset.n; gate.pin = ''; gate.err = ''; renderGate(); },
  pin: (el) => { if (gate.pin.length < 8) gate.pin += el.dataset.n; gate.err = ''; renderGate(); },
  'pin-back': () => { gate.pin = gate.pin.slice(0, -1); renderGate(); }, 'pin-go': tryLogin,

  // overview / materials
  'open-tracker': (el, e) => { if (e.target.closest('.pv')) return; ui.trId = +el.dataset.id; go('trackers'); },
  'open-loc': (el) => openLoc(+el.dataset.id, { trackerId: +el.dataset.t || null }),
  'open-mat': (el) => openMaterial(+el.dataset.id),
  'mat-filter': (el) => { ui.matFilter = el.dataset.f; render(); },
  'mat-edit': (el) => openMatEdit(el.dataset.id ? +el.dataset.id : null), 'mat-import': openImport,
  'mat-kind': (el) => { const st = ui.panel; readTxn(st); st.act = el.dataset.k; if (st.act === 'count') st.qty = String(S.M[st.mat].on_hand); setBody(matBody(st)); },
  'mat-person': (el) => { const st = ui.panel; readTxn(st); st.person = el.dataset.n; setBody(matBody(st)); },
  'qty-step': (el) => { const i = $('#panel input[name=qty]'); i.value = Math.max(0, (+i.value || 0) + +el.dataset.d); },
  'qty-add': (el) => { const i = $('#panel input[name=qty]'); i.value = (+i.value || 0) + +el.dataset.n; },
  'qty-all': () => { const st = ui.panel; const has = S.out_by_person[st.person]?.[st.mat] || 0; $('#panel input[name=qty]').value = has || ''; if (!has) toast(`${st.person} has none of this out.`, { bad: true }); },
  'txn-undo': (el) => mutate('DELETE', `/api/txns/${el.dataset.id}`, undefined, { ok: 'Entry undone' }),
  'mat-del': async (el) => { if (!confirm('Delete this material and its history?')) return; await mutate('DELETE', `/api/materials/${el.dataset.id}`, undefined, { ok: 'Material deleted' }); closePanel(); },

  // trackers
  'pick-tracker': (el) => { ui.trId = +el.dataset.id; ui.trParent = ''; ui.sel.clear(); render(); },
  'tr-filter': (el) => { ui.trFilter = el.dataset.f; render(); },
  'tracker-filter': (el) => { ui.trId = +el.dataset.t; ui.trParent = el.dataset.p; go('trackers'); },
  'sel-toggle': () => { ui.selMode = !ui.selMode; ui.sel.clear(); render(); },
  'sel-off': () => { ui.selMode = false; ui.sel.clear(); render(); },
  'sel-col': (el) => {
    const t = S.TR[ui.trId]; if (t.mode === 'qty') return; ui.selMode = true; const sid = el.dataset.k.startsWith('s') ? +el.dataset.k.slice(1) : 0;
    const keys = $$('.matrix .cell[data-l]').filter((c) => +c.dataset.s === sid).map((c) => `${c.dataset.l}:${sid}`); const all = keys.every((k) => ui.sel.has(k));
    keys.forEach((k) => (all ? ui.sel.delete(k) : ui.sel.add(k))); render();
  },
  'sel-row': (el) => { const keys = $$(`.matrix .cell[data-l="${el.dataset.id}"]`).map((c) => `${c.dataset.l}:${c.dataset.s}`); const all = keys.every((k) => ui.sel.has(k)); keys.forEach((k) => (all ? ui.sel.delete(k) : ui.sel.add(k))); render(); },
  'sel-group': (el) => { const ids = el.dataset.ids.split(','); const keys = $$('.matrix .cell[data-l]').filter((c) => ids.includes(c.dataset.l)).map((c) => `${c.dataset.l}:${c.dataset.s}`); const all = keys.every((k) => ui.sel.has(k)); keys.forEach((k) => (all ? ui.sel.delete(k) : ui.sel.add(k))); render(); },
  cell: (el) => {
    const k = `${el.dataset.l}:${el.dataset.s}`;
    if (ui.selMode) { ui.sel.has(k) ? ui.sel.delete(k) : ui.sel.add(k); el.classList.toggle('sel'); const b = $('.selbar b'); if (b) b.textContent = `${ui.sel.size} selected`; $$('.selbar [data-act=bulk-status]').forEach((x) => (x.disabled = !ui.sel.size)); return; }
    openLoc(+el.dataset.l, { trackerId: ui.trId });
  },
  'bulk-status': async (el) => {
    const t = S.TR[ui.trId]; const groups = {}; for (const k of ui.sel) { const [l, s] = k.split(':').map(Number); (groups[s] ||= []).push(l); }
    const n = ui.sel.size; ui.sel.clear(); ui.selMode = false;
    for (const [s, ls] of Object.entries(groups)) await setEntries(t, ls, [+s], { status: el.dataset.s });
    toast(`Updated ${n} ${n === 1 ? 'cell' : 'cells'} to ${statusOf(t, el.dataset.s).label}`);
  },
  'tracker-edit': (el) => openTrackerEdit(el.dataset.id ? +el.dataset.id : null),
  'tracker-del': async (el) => { if (!confirm('Delete this tracker and all of its progress?')) return; await mutate('DELETE', `/api/trackers/${el.dataset.id}`, undefined, { ok: 'Tracker deleted' }); closePanel(); },
  'tr-preset': (el) => { const st = ui.panel; applyPreset(st, PRESETS.find((p) => p.key === el.dataset.k)); st.paint(); },
  'tr-color': (el) => trEdit((st) => (st.color = el.dataset.c))(),
  'tr-mode': (el) => trEdit((st) => { st.mode = el.dataset.v; if (st.mode === 'steps' && !st.steps.length) st.steps = [{ name: '' }]; })(),
  'tr-step-add': () => { trEdit((st) => st.steps.push({ name: '' }))(); $$('#panel [data-step]').pop()?.focus(); },
  'tr-step-del': (el) => trEdit((st) => { const i = +el.dataset.i; st.steps.splice(i, 1); st.mats = st.mats.filter((r) => +r.step_index !== i).map((r) => ({ ...r, step_index: +r.step_index > i ? +r.step_index - 1 : r.step_index })); })(),
  'tr-step-up': (el) => trEdit((st) => moveStep(st, +el.dataset.i, -1))(),
  'tr-step-down': (el) => trEdit((st) => moveStep(st, +el.dataset.i, 1))(),
  'tr-st-add': () => trEdit((st) => st.statuses.splice(Math.max(1, st.statuses.length - 1), 0, { key: '', label: '', color: PALETTE[st.statuses.length % PALETTE.length], done: false, problem: false }))(),
  'tr-st-del': (el) => trEdit((st) => st.statuses.splice(+el.dataset.i, 1))(),
  'tr-fd-add': () => trEdit((st) => st.fields.push({ label: '', type: 'text', options: [] }))(),
  'tr-fd-del': (el) => trEdit((st) => st.fields.splice(+el.dataset.i, 1))(),
  'tr-mat-add': () => trEdit((st) => st.mats.push({ material_id: '', step_index: st.mode === 'steps' && st.steps.length ? 0 : -1, qty: '' }))(),
  'tr-mat-del': (el) => trEdit((st) => st.mats.splice(+el.dataset.i, 1))(),
  'tr-scope': (el) => trEdit((st) => { st.scope.mode = el.dataset.v; st.scope.ids = new Set(); })(),
  'tr-zone': (el) => trEdit((st) => { const z = el.dataset.z; st.scope.zones.has(z) ? st.scope.zones.delete(z) : st.scope.zones.add(z); })(),
  'tr-pickloc': (el) => trEdit((st) => { const id = +el.dataset.id; st.scope.ids.has(id) ? st.scope.ids.delete(id) : st.scope.ids.add(id); })(),
  'tr-link-add': async () => { const st = ui.panel; readTracker(st); if (!st.linkDwg) return toast('Pick a drawing.', { bad: true });
    await mutate('POST', '/api/drawing-links', { drawing_id: +st.linkDwg, page: +st.linkPage || 0, tracker_id: st.id }, { ok: 'Drawing attached' }); st.linkDwg = ''; st.linkPage = ''; st.paint(); },
  'link-del': async (el) => { const st = ui.panel; if (st?.kind === 'tr') readTracker(st); await mutate('DELETE', `/api/drawing-links/${el.dataset.id}`, undefined, { ok: 'Link removed' }); if (st?.paint) st.paint(); },

  // location hub
  'loc-crew': (el) => { const st = ui.panel; const n = el.dataset.n; st.crew.has(n) ? st.crew.delete(n) : st.crew.add(n); el.setAttribute('aria-pressed', st.crew.has(n)); },
  'loc-book': (el) => { ui.panel.book = el.checked; },
  'loc-status': async (el) => {
    const st = ui.panel; const t = S.TR[+el.dataset.t]; const status = el.dataset.k;
    await setEntries(t, [st.lid], [+el.dataset.s], { status, crew: t.claims ? [...st.crew] : undefined, log_materials: statusOf(t, status).done && st.book });
  },
  'loc-mat': () => pickMaterialAt(ui.panel.lid),
  'pick-mat': (el) => openMaterial(+el.dataset.id, { kind: 'used', location_id: +el.dataset.l }),
  'loc-edit': (el) => openLocEdit(+el.dataset.id),
  'loc-del': async (el) => { const l = S.L[+el.dataset.id]; if (!confirm(`Remove ${l.name}${(S.kids[l.id] || []).length ? ' and everything inside it' : ''}? Its progress and plan placements go too.`)) return; await mutate('DELETE', `/api/locations/${l.id}`, undefined, { ok: `Removed ${l.name}` }); closePanel(); },
  'loc-del-all': async (el) => { const ty = S.TY[+el.dataset.id]; const ids = S.locations.filter((l) => l.type_id === ty.id).map((l) => l.id); if (!confirm(`Remove all ${ids.length} ${ty.plural.toLowerCase()} and everything inside them?`)) return; await mutate('POST', '/api/locations/delete', { ids }, { ok: `Removed ${ty.plural.toLowerCase()}` }); },
  'setup-type': (el) => { ui.setupType = +el.dataset.id; render(); },
  'type-edit': (el) => openTypeEdit(el.dataset.id ? +el.dataset.id : null),
  'type-del': async (el) => { if (!confirm('Delete this location type?')) return; await mutate('DELETE', `/api/types/${el.dataset.id}`, undefined, { ok: 'Type deleted' }); closePanel(); },

  // drawings
  'dwg-upload': () => openDwgUpload(),
  'open-dwg': (el) => openDrawing(+el.dataset.id),
  'view-docs': (el) => openViewer(docGroups[el.dataset.g], +el.dataset.i),
  'dwg-auto': async () => { const st = ui.panel; const r = await mutate('PUT', `/api/drawings/${st.id}`, { auto_type_id: st.autoType }); toast(r.linked ? `Matched ${r.linked} page${r.linked > 1 ? 's' : ''}` : 'No pages matched. Link them by hand.', { bad: !r.linked }); },
  'dwg-del': async (el) => { if (!confirm('Delete this drawing and its links?')) return; await mutate('DELETE', `/api/drawings/${el.dataset.id}`, undefined, { ok: 'Drawing deleted' }); closePanel(); },
  'link-page': (el) => openLinkPage(ui.panel.id, +el.dataset.p),
  'dwg-link-loc': (el) => {
    const lid = +el.dataset.id; if (!S.drawings.length) { openDwgUpload(); return; }
    const st = { kind: 'pickdwg' }; openPanel('Attach drawing', `to ${esc(lname(lid))}`, `<ul class="picklist">${S.drawings.map((d) => `<li><button data-act="dwg-pick-for" data-id="${d.id}" data-l="${lid}"><span>${esc(d.sheet ? d.sheet + ' ' : '')}${esc(d.name)}</span><small>${d.pages} p</small></button></li>`).join('')}</ul><div class="row" style="margin-top:12px"><button class="btn sm" data-act="dwg-upload">Upload a new drawing</button></div>`, st);
  },
  'dwg-pick-for': (el) => { const d = S.D[+el.dataset.id]; const lid = +el.dataset.l;
    if (!d.is_pdf || d.pages === 1) { mutate('POST', '/api/drawing-links', { drawing_id: d.id, page: 0, location_ids: [lid] }, { ok: 'Drawing attached' }).then(() => openLoc(lid)); return; }
    const page = prompt(`Which page of ${d.name}? (1–${d.pages}, blank for the whole file)`, ''); if (page === null) return;
    mutate('POST', '/api/drawing-links', { drawing_id: d.id, page: +page || 0, location_ids: [lid] }, { ok: 'Drawing attached' }).then(() => openLoc(lid)); },
  'page-map': (el) => { const st = ui.panel; const d = S.D[st.id]; const p = +el.dataset.p;
    openPanel('Use as plan', esc(`${d.name}, page ${p}`), `<form data-form="page-map" data-d="${d.id}" data-p="${p}"><label class="f"><span>Plan for</span><select name="location_id"><option value="">The whole site</option>${locOptions('')}</select></label><label class="f"><span>Name</span><input name="name" placeholder="Uses the location name if blank"></label><button class="btn sun">Make plan</button></form>`, { kind: 'pm' }); },
  'lk-loc': (el) => { const st = ui.panel; const id = +el.dataset.id; st.locs.has(id) ? st.locs.delete(id) : st.locs.add(id); st.paint(); },
  'lk-save': async () => { const st = ui.panel; if (!st.locs.size && !st.tracker) return toast('Pick a location or a tracker.', { bad: true });
    const did = st.drawingId; await mutate('POST', '/api/drawing-links', { drawing_id: did, page: st.page, location_ids: [...st.locs], tracker_id: st.tracker ? +st.tracker : null }, { ok: 'Linked' }); openDrawing(did); },
  'vw-close': closeViewer,
  'vw-go': (el) => { vw.i = +el.dataset.i; vw.page = vw.items[vw.i].page || 1; paintViewer(); },
  'vw-page': (el) => { vw.page += +el.dataset.d; paintViewer(); },
  'vw-dark': (el) => { vw.dark = el.dataset.v === '1'; $('#vstage img')?.classList.toggle('dark', vw.dark); $$('#viewer [data-act=vw-dark]').forEach((b) => b.setAttribute('aria-pressed', b === el)); },
  'vw-zoom': (el) => { const s = $('#vstage'); vw.pz.zoomAt(+el.dataset.z, s.clientWidth / 2, s.clientHeight / 2); },
  'vw-fit': vwFit,

  // map
  'map-upload': (el) => openMapUpload(el.dataset.loc ? +el.dataset.loc : null),
  'map-go': (el) => { ui.map.id = +el.dataset.id; ui.map.fitted = false; ui.map.editing = false; ui.map.poly = []; ui.map.assignType = null; if (ui.view !== 'map') go('map'); else { closePanel(); render(); } },
  'map-edit': () => { Object.assign(ui.map, { editing: true, tool: S.TY[ui.map.assignType]?.shape === 'pin' ? 'pin' : 'box', poly: [] }); render(); },
  'map-edit-done': () => { Object.assign(ui.map, { editing: false, tool: 'move', poly: [], draft: null }); render(); },
  'map-tool': (el) => { ui.map.tool = el.dataset.t; ui.map.poly = []; render(); },
  'map-dark': (el) => { ui.map.dark = el.dataset.v === '1'; render(); },
  'poly-undo': () => { ui.map.poly.pop(); render(); }, 'poly-close': closePoly,
  zoom: (el) => { const v = $('#mapview'); mapPZ.zoomAt(+el.dataset.z, v.clientWidth / 2, v.clientHeight / 2); },
  'zoom-fit': () => { fitMap(); mapPZ.apply(); },
  'map-delete': async () => { if (!confirm('Remove this plan and everything placed on it?')) return; await mutate('DELETE', `/api/map/${ui.map.id}`, undefined, { ok: 'Plan removed' }); },
  'area-assign': async (el) => { await mutate('PUT', `/api/areas/${el.dataset.a}`, { location_id: +el.dataset.id }, { ok: `Set to ${lname(+el.dataset.id)}` }); closePanel(); },
  'area-del': async (el) => { await mutate('DELETE', `/api/areas/${el.dataset.id}`, undefined, { ok: 'Removed' }); closePanel(); },

  // people
  'person-edit': (el) => openPerson(el.dataset.name || null),
  'user-active': async (el) => { await mutate('PUT', `/api/users/${el.dataset.id}`, { active: el.dataset.v === '1' }, { ok: 'Saved' }); closePanel(); },
  'crew-remove': async (el) => { await mutate('PUT', '/api/settings', { crew_names: S.job.crew_names.filter((n) => n !== el.dataset.name) }, { ok: 'Removed' }); closePanel(); },
};
function moveStep(st, i, d) { const j = i + d; if (j < 0 || j >= st.steps.length) return; [st.steps[i], st.steps[j]] = [st.steps[j], st.steps[i]]; st.mats.forEach((r) => { if (+r.step_index === i) r.step_index = j; else if (+r.step_index === j) r.step_index = i; }); }

// ── forms ─────────────────────────────────────────────────────────────
const FORMS = {
  async setup(f) {
    try { const r = await api('POST', '/api/setup', Object.fromEntries(new FormData(f))); local.token = r.token; gate = { status: null, name: '', pin: '', err: '' }; ui.view = 'setup'; location.hash = 'setup'; render(); await refresh(); toast('Job set up. Add your power blocks next.'); }
    catch (e) { gate.err = e.message; renderGate(); }
  },
  async txn() {
    const st = ui.panel; readTxn(st); const qty = parseFloat(st.qty);
    if (!(qty > 0) && !(st.act === 'count' && qty >= 0)) return toast('Enter a quantity above zero.', { bad: true });
    const m = S.M[st.mat]; const source = st.act === 'used' ? (m.out_qty >= qty ? 'out' : 'stock') : '';
    const body = { material_id: st.mat, kind: st.act, qty, person: KIND[st.act].people ? st.person : '', location_id: st.loc ? +st.loc : null, note: st.note, expected: st.expected, source };
    const words = { grab: 'grabbed', used: 'installed', return: 'returned', receive: 'received', order: 'ordered', count: 'counted' }[st.act];
    await mutate('POST', '/api/txns', body, { queue: ['grab', 'used', 'return', 'receive'].includes(st.act), ok: `${q(qty)} ${m.unit} ${m.name} ${words}`,
      optimistic: () => { applyTxnLocal(m, st.act, qty, source); S.txns.unshift({ id: 'tmp' + Date.now(), material_id: m.id, kind: st.act, qty, person: body.person, location_id: body.location_id, note: st.note, by: S.me.name, at: new Date().toISOString() });
        if (body.person && ['grab', 'return', 'used'].includes(st.act) && source !== 'stock') { const o = (S.out_by_person[body.person] ||= {}); o[m.id] = Math.max(0, (o[m.id] || 0) + (st.act === 'grab' ? qty : -qty)); } } }).catch(() => {});
    st.qty = ''; st.note = ''; if (ui.panel === st) setBody(matBody(st));
  },
  async qty(f, e) {
    const t = S.TR[+f.dataset.t]; const lid = +f.dataset.l; const st = ui.panel;
    if (e?.submitter?.name === 'set') { await mutate('POST', '/api/entries', { tracker_id: t.id, location_ids: [lid], target: f.target.value }, { ok: 'Target saved' }); return; }
    const add = parseFloat(f.add.value); if (!add) return toast('Enter an amount to add.', { bad: true });
    await setEntries(t, [lid], [], { qty_add: add, crew: t.claims ? [...st.crew] : undefined });
    toast(`Added ${q(add)} ${t.unit} to ${lname(lid)}`);
  },
  async mat(f) { const d = Object.fromEntries(new FormData(f)); if (f.dataset.id) await mutate('PUT', `/api/materials/${f.dataset.id}`, d, { ok: 'Material saved' }); else await mutate('POST', '/api/materials', d, { ok: `${d.name} added` }); closePanel(); },
  async import(f) { const r = await mutate('POST', '/api/materials/import', { csv: f.csv.value }); toast(`Imported: ${r.added} new, ${r.updated} updated`); closePanel(); },
  async tracker() {
    const st = ui.panel; readTracker(st);
    if (!st.name.trim()) return toast('Give the tracker a name.', { bad: true });
    if (st.id && S.TR[st.id].type_id !== st.type_id && !confirm('Changing what it is tracked by clears its progress. Continue?')) return;
    const idx = {}; let n = 0; st.steps.forEach((s, i) => { if (s.name.trim()) idx[i] = n++; });
    const body = { name: st.name, color: st.color, type_id: st.type_id, mode: st.mode, unit: st.unit, default_target: st.default_target, status: st.status, due_date: st.due_date, description: st.description, claims: st.claims, show_map: st.show_map,
      statuses: st.statuses.filter((s) => s.label.trim()), fields: st.fields.filter((f) => f.label.trim()), steps: st.mode === 'steps' ? st.steps.filter((s) => s.name.trim()) : [],
      scope: { mode: st.scope.mode, ids: [...st.scope.ids], zones: [...st.scope.zones] },
      materials: st.mats.filter((r) => r.material_id && +r.qty > 0).map((r) => ({ material_id: +r.material_id, qty: +r.qty, step_index: st.mode === 'steps' && +r.step_index >= 0 ? idx[+r.step_index] ?? null : null })) };
    if (st.id) await mutate('PUT', `/api/trackers/${st.id}`, body, { ok: 'Tracker saved' });
    else { const r = await mutate('POST', '/api/trackers', body, { ok: `${st.name} created` }); ui.trId = r.id; }
    closePanel(); if (ui.view !== 'trackers') go('trackers');
  },
  async 'map-upload'(f) {
    const fd = new FormData(f); const file = fd.get('file');
    if (file?.type?.startsWith('image/')) { const dims = await new Promise((res) => { const img = new Image(); img.onload = () => res([img.naturalWidth, img.naturalHeight]); img.onerror = () => res([0, 0]); img.src = URL.createObjectURL(file); }); fd.set('width', dims[0]); fd.set('height', dims[1]); }
    const b = f.querySelector('button'); b.disabled = true; b.textContent = 'Uploading…';
    try { const r = await mutate('POST', '/api/map', fd, { ok: 'Plan added' }); ui.map.id = r.id; ui.map.fitted = false; ui.map.assignType = null; closePanel(); if (ui.view !== 'map') go('map'); else render(); }
    catch { b.disabled = false; b.textContent = 'Upload'; }
  },
  async 'dwg-upload'(f) {
    const b = f.querySelector('button'); b.disabled = true; b.textContent = 'Uploading and reading pages…';
    try { const r = await mutate('POST', '/api/drawings', new FormData(f)); toast(r.linked ? `Uploaded. Matched ${r.linked} page${r.linked > 1 ? 's' : ''} to locations.` : 'Uploaded.'); openDrawing(r.id); if (ui.view !== 'drawings') { ui.view = 'drawings'; location.hash = 'drawings'; render(); } }
    catch { b.disabled = false; b.textContent = 'Upload'; }
  },
  async 'dwg-meta'(f) { await mutate('PUT', `/api/drawings/${ui.panel.id}`, Object.fromEntries(new FormData(f)), { ok: 'Saved' }); },
  async 'page-map'(f) { const d = Object.fromEntries(new FormData(f)); const r = await mutate('POST', '/api/map/from-drawing', { drawing_id: +f.dataset.d, page: +f.dataset.p, location_id: d.location_id ? +d.location_id : null, name: d.name }, { ok: 'Plan made' }); ui.map.id = r.id; ui.map.fitted = false; ui.map.assignType = null; closePanel(); go('map'); },
  async person(f) {
    const d = Object.fromEntries(new FormData(f)); const uid = f.dataset.user; const existing = f.dataset.name;
    if (uid) { const body = {}; if (d.pin) body.pin = d.pin; if (d.role) body.role = d.role; await mutate('PUT', `/api/users/${uid}`, body, { ok: 'Saved' }); }
    else { const name = (existing || d.name || '').trim(); if (!name) return;
      if (d.pin) { await mutate('POST', '/api/users', { name, pin: d.pin, role: d.role }, { ok: `${name} can sign in now` }); if (S.job.crew_names.includes(name)) await mutate('PUT', '/api/settings', { crew_names: S.job.crew_names.filter((n) => n !== name) }); }
      else if (!existing) await mutate('PUT', '/api/settings', { crew_names: [...S.job.crew_names, name] }, { ok: `${name} added` }); }
    closePanel();
  },
  async job(f) { await mutate('PUT', '/api/settings', Object.fromEntries(new FormData(f)), { ok: 'Job saved' }); },
  async type(f) { const d = Object.fromEntries(new FormData(f)); d.parent_type_id = d.parent_type_id ? +d.parent_type_id : null;
    if (f.dataset.id) await mutate('PUT', `/api/types/${f.dataset.id}`, d, { ok: 'Saved' }); else { const r = await mutate('POST', '/api/types', d, { ok: `${d.name} added` }); ui.setupType = r.id; } closePanel(); },
  async loc(f) { const d = Object.fromEntries(new FormData(f)); if ('parent_id' in d) d.parent_id = d.parent_id ? +d.parent_id : null; await mutate('PUT', `/api/locations/${f.dataset.id}`, d, { ok: 'Saved' }); closePanel(); },
  async gen(f) {
    const d = Object.fromEntries(new FormData(f)); const names = (d.names || '').split('\n').map((s) => s.trim()).filter(Boolean);
    if (!names.length && !d.end) return toast('Fill in the "To" number or type names.', { bad: true });
    const body = { type_id: +f.dataset.type, zone: d.zone || '' };
    if (d.parents) { if (d.parents === 'all') body.all_parents = true; else body.parent_ids = [+d.parents]; }
    Object.assign(body, names.length ? { names } : { pattern: d.pattern, start: +d.start, end: +d.end, pad: +d.pad });
    const r = await mutate('POST', '/api/locations', body); toast(`Added ${r.ids.length}`); f.reset();
  },
};

// ── wiring ────────────────────────────────────────────────────────────
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || ['SELECT', 'INPUT', 'TEXTAREA'].includes(el.tagName)) return;
  const fn = ACT[el.dataset.act]; if (fn) { e.preventDefault(); Promise.resolve(fn(el, e)).catch((err) => console.error(err)); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('[role=button][data-act]')) { e.target.click(); return; }
  if (e.key === 'Escape') { if (!$('#viewer').hidden) closeViewer(); else if (!$('#panel').hidden) closePanel(); else if (ui.map.poly.length) { ui.map.poly = []; render(); } }
  if (!local.token && gate.name && !e.target.closest('input')) {
    if (/^\d$/.test(e.key) && gate.pin.length < 8) { gate.pin += e.key; renderGate(); }
    if (e.key === 'Backspace') { gate.pin = gate.pin.slice(0, -1); renderGate(); }
    if (e.key === 'Enter') tryLogin();
  }
});
document.addEventListener('submit', (e) => { const f = e.target.closest('form[data-form]'); if (!f) return; e.preventDefault(); Promise.resolve(FORMS[f.dataset.form]?.(f, e)).catch((err) => console.error(err)); });
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.id === 'mat-search') { ui.matSearch = el.value; paintBom(); }
  if (el.id === 'tr-search') { ui.trSearch = el.value; clearTimeout(el._t); el._t = setTimeout(() => { render(); const i = $('#tr-search'); i.focus(); i.setSelectionRange(99, 99); }, 250); }
  const refocus = (sel) => { const i = $(sel); i.focus(); i.setSelectionRange(99, 99); };
  if (el.dataset.act === 'pick-filter') { ui.panel.filter = el.value; setBody(ui.panel.list()); refocus('#panel [data-act=pick-filter]'); }
  if (el.dataset.act === 'area-filter') { ui.panel.filter = el.value; setBody(ui.panel.list()); refocus('#panel [data-act=area-filter]'); }
  if (el.dataset.act === 'lk-filter') { ui.panel.filter = el.value; ui.panel.paint(); refocus('#panel [data-act=lk-filter]'); }
});
document.addEventListener('change', async (e) => {
  const el = e.target; const a = el.dataset.act;
  if (a === 'tr-parent') { ui.trParent = el.value; render(); }
  if (a === 'map-tracker') { ui.map.trId = el.value; ui.map.stepId = ''; ui.map.trFor = ui.map.id; S.roll = {}; render(); }
  if (a === 'map-step') { ui.map.stepId = el.value; S.roll = {}; repaintMap(); }
  if (a === 'map-pick') { ui.map.id = +el.value; ui.map.fitted = false; ui.map.assignType = null; render(); }
  if (a === 'map-assign') { ui.map.assignType = +el.value; ui.map.tool = S.TY[ui.map.assignType]?.shape === 'pin' ? 'pin' : (ui.map.tool === 'pin' ? 'box' : ui.map.tool); render(); }
  if (a === 'map-auto') { ui.map.auto = el.checked; render(); }
  if (a === 'loc-book') ui.panel.book = el.checked;
  if (a === 'loc-notes') await mutate('PUT', `/api/locations/${ui.panel.lid}`, { notes: el.value }, { ok: 'Note saved' }).catch(() => {});
  if (a === 'loc-field') { const t = S.TR[+el.dataset.t]; await setEntries(t, [+el.dataset.l], [], { values: { [el.dataset.f]: el.type === 'checkbox' ? el.checked : el.value } }).catch(() => {}); }
  if (a === 'import-file' && el.files[0]) $('#panel textarea[name=csv]').value = await el.files[0].text();
  if (a === 'dwg-auto-type') ui.panel.autoType = +el.value;
  if (a === 'area-type') { ui.panel.type = +el.value; setBody(ui.panel.list()); }
  if (a === 'lk-type') { ui.panel.type = +el.value; ui.panel.paint(); }
  if (a === 'lk-tracker') ui.panel.tracker = el.value;
  if (el.closest('#panel form[data-form="tracker"]') && el.dataset.k === 'type_id') { const st = ui.panel; readTracker(st); st.scope = { mode: 'all', ids: new Set(), zones: new Set() }; st.paint(); }
  if (el.closest('#panel form[data-form="tracker"]') && el.dataset.f === 'type') { readTracker(ui.panel); ui.panel.paint(); }
});
$('#scrim').addEventListener('click', closePanel);
window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (h && h !== ui.view && VIEWS.some((v) => v.id === h)) { ui.view = h; render(); } });
window.addEventListener('online', () => { paintSync(); flushOutbox(); refresh(); });
window.addEventListener('offline', paintSync);
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (S) render(); });
setInterval(async () => {
  if (!local.token || !S || document.hidden) return;
  flushOutbox();
  try { const r = await api('GET', '/api/rev'); S.offline = false;
    const editing = $('#panel form[data-form="tracker"], #panel form[data-form="mat"], #panel form[data-form="person"], #panel form[data-form="type"], #panel form[data-form="txn"] input[name=qty]:focus');
    if (r.rev !== S.rev && !editing && ui.map.poly.length === 0 && !ui.map.draft) await refresh(); else { S.syncedAt = Date.now(); paintSync(); } }
  catch { if (S) { S.offline = true; paintSync(); } }
}, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && S) refresh(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
render();
if (local.token) refresh().then(flushOutbox);
