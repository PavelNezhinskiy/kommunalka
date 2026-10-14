/* ═══════════════════════════════════════════════════════════════
   Каркас интерфейса: платформа и тема, навигация, шапка, слои
   (листы, диалоги), уведомления, жесты.
   ═══════════════════════════════════════════════════════════════ */
const APP_VERSION = '3.0';
const $ = id => document.getElementById(id);
const qa = (sel, el = document) => [...el.querySelectorAll(sel)];
const root = document.documentElement;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* приватный режим */ } };
const icon = (name, cls = '') => `<svg class="i ${cls}"><use href="#i-${name}"/></svg>`;
const plat = () => root.dataset.platform;
const euro0 = x => fmtN(Math.round(x), 0);
const sgn = x => (x >= 0 ? '+' : '−');
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
function buzz(p = 8) { if (plat() === 'android') try { navigator.vibrate && navigator.vibrate(p); } catch (e) { /* нет вибро */ } }

/* ── Платформа и тема ──────────────────────────────────────────── */
function detectPlatform() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios ? 'ios' : 'android';
}
function applyLook() {
  const style = lsGet('uiStyle') || 'auto', theme = lsGet('uiTheme') || 'auto';
  root.dataset.platform = style === 'auto' ? detectPlatform() : style;
  const dark = theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.scheme = dark ? 'dark' : 'light';
  qa('#seg-style button').forEach(b => b.classList.toggle('active', b.dataset.v === style));
  qa('#seg-theme button').forEach(b => b.classList.toggle('active', b.dataset.v === theme));
  // цвет системной полосы
  requestAnimationFrame(() => {
    const bg = getComputedStyle(document.body).backgroundColor;
    const m = bg.match(/\d+/g);
    if (m) $('meta-theme').content = '#' + m.slice(0, 3).map(n => (+n).toString(16).padStart(2, '0')).join('');
  });
  if (window.Chart) Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
}
function setUiStyle(v) { lsSet('uiStyle', v); applyLook(); setBar(curPage); renderCurrent(); }
function setUiTheme(v) { lsSet('uiTheme', v); applyLook(); renderCurrent(); }
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if ((lsGet('uiTheme') || 'auto') === 'auto') { applyLook(); renderCurrent(); } });

function chartTheme() {
  const cs = getComputedStyle(root);
  return {
    text: cs.getPropertyValue('--chart-text').trim() || '#888',
    grid: cs.getPropertyValue('--chart-grid').trim() || 'rgba(128,128,128,.2)',
  };
}

/* ── Шапка ─────────────────────────────────────────────────────── */
function longDate() {
  const s = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const PAGES = {
  home:      { title: 'Коммуналка', sub: longDate, add: true },
  history:   { title: 'История', add: true },
  analytics: { title: 'Аналитика' },
  pay:       { title: 'Платежи' },
  more:      { title: 'Ещё' },
};
let curPage = 'home';

function setBar(name) {
  const p = PAGES[name];
  $('bar-title').textContent = p.title;
  $('bar-small').textContent = p.title;
  const sub = p.sub ? p.sub() : '';
  $('bar-sub').textContent = sub;
  $('bar-sub').style.display = sub ? '' : 'none';
  let acts = '';
  if (p.add && plat() === 'ios') acts += `<button class="icon-btn" onclick="openEntry()" aria-label="Снять показания">${icon('plus')}</button>`;
  if (name === 'home' && plat() === 'android') acts += `<button class="icon-btn" onclick="reloadData()" aria-label="Обновить">${icon('refresh')}</button>`;
  $('bar-actions').innerHTML = acts;
  $('fab').classList.toggle('gone', !p.add);
}

function onScroll() {
  const y = window.scrollY;
  const bar = $('bar');
  bar.classList.toggle('scrolled', y > 4);
  const lg = $('bar-large');
  bar.classList.toggle('collapsed', y > (lg.offsetHeight ? lg.offsetHeight - 14 : 34));
}
addEventListener('scroll', onScroll, { passive: true });

/* ── Навигация ─────────────────────────────────────────────────── */
function go(name, opts = {}) {
  if (!PAGES[name]) name = 'home';
  if (name === curPage && opts.fromPop) return;
  // «Назад» из вкладки — на главную через историю браузера
  if (!opts.fromPop && name === 'home' && curPage !== 'home' && history.state && history.state.tab) { history.back(); return; }
  const prev = curPage;
  curPage = name;
  if (!opts.fromPop && !opts.silent) {
    if (name !== 'home' && prev === 'home') history.pushState({ tab: name }, '');
    else if (name !== 'home') history.replaceState({ tab: name }, '');
  }
  qa('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + name));
  qa('#nav button').forEach(b => b.classList.toggle('active', b.dataset.page === name));
  setBar(name);
  if (prev !== name) { window.scrollTo(0, 0); buzz(5); }
  onScroll();
  renderCurrent();
}
const showPage = go;   // прежнее имя

function renderCurrent() {
  try {
    if (curPage === 'home') renderHome();
    else if (curPage === 'history') renderHistory();
    else if (curPage === 'analytics') renderAnalytics();
    else if (curPage === 'pay') renderPay();
    else if (curPage === 'more') renderMore();
  } catch (e) { console.error(e); toast('Ошибка отрисовки: ' + e.message, 'err'); }
}
function refreshAll() { dropDataCache(); renderCurrent(); }

async function reloadData(silent) {
  try {
    await loadAll();
    refreshAll();
    if (silent !== true) toast('Данные обновлены', 'ok');
  } catch (e) {
    if (isAuthError(e)) { await sb.auth.signOut().catch(() => {}); showAuth('Сессия истекла — войдите заново'); return; }
    toast('Не удалось обновить: ' + e.message, 'err');
  }
}

function startApp(p) {
  applyLook();
  if (window.Chart) Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  history.replaceState(null, '');
  curPage = 'home';
  go(p && PAGES[p] ? p : 'home', { silent: true });
  if (p === 'entry' || p === 'readings') openEntry();
}

/* ── Слои: листы и модалки + кнопка «Назад» на Android ─────────── */
const LAYERS = {
  'entry': () => closeEntry(),
  'sheet-modal': () => closeSheet(),
  'reading-modal': () => closeReadingModal(),
  'tariff-modal': () => closeTariffModal(),
  'advance-modal': () => closeAdvanceModal(),
  'settlement-modal': () => closeSettlementModal(),
  'import-modal': () => closeImportModal(),
  'tariff-import-modal': () => closeTariffImportModal(),
  'advance-import-modal': () => closeAdvanceImportModal(),
};
const openLayers = [];
let popping = false;

function watchLayers() {
  const mo = new MutationObserver(muts => {
    for (const m of muts) {
      const el = m.target, id = el.id;
      if (!LAYERS[id]) continue;
      const isOpen = el.classList.contains('open');
      const idx = openLayers.indexOf(id);
      if (isOpen && idx < 0) {
        openLayers.push(id);
        history.pushState({ layer: id }, '');
      } else if (!isOpen && idx >= 0) {
        openLayers.splice(idx, 1);
        if (!popping && history.state && history.state.layer === id) history.back();
      }
    }
    root.classList.toggle('locked', openLayers.length > 0);
  });
  Object.keys(LAYERS).forEach(id => { const el = $(id); if (el) mo.observe(el, { attributes: true, attributeFilter: ['class'] }); });
}
addEventListener('popstate', e => {
  const dlg = document.querySelector('.dialog-bg');
  if (dlg && dlg._cancel) {
    // «Назад» закрывает диалог, а слой под ним остаётся
    if (openLayers.length) history.pushState({ layer: openLayers[openLayers.length - 1] }, '');
    dlg._cancel();
    return;
  }
  if (openLayers.length) {
    popping = true;
    try { LAYERS[openLayers[openLayers.length - 1]](); } finally { setTimeout(() => { popping = false; }, 600); }
    // слой закрылся — не уходим со страницы
    return;
  }
  const tab = e.state && e.state.tab;
  go(tab || 'home', { fromPop: true });
});
addEventListener('keydown', e => {
  if (e.key === 'Escape' && openLayers.length) LAYERS[openLayers[openLayers.length - 1]]();
});

/* ── Листы ─────────────────────────────────────────────────────── */
function openSheet(html) { $('sheet-body').innerHTML = html; $('sheet-modal').classList.add('open'); }
function closeSheet() { $('sheet-modal').classList.remove('open'); }

/* ── Диалоги ───────────────────────────────────────────────────── */
function showDialog({ title, message = '', actions }) {
  return new Promise(resolve => {
    const bg = document.createElement('div');
    bg.className = 'dialog-bg';
    bg.innerHTML = `<div class="dialog" role="alertdialog" aria-modal="true">
      <div class="dialog-body"><div class="dialog-title">${esc(title)}</div>${message ? `<div class="dialog-msg">${esc(message)}</div>` : ''}</div>
      <div class="dialog-btns"></div></div>`;
    const wrap = bg.querySelector('.dialog-btns');
    const cancelAct = actions.find(a => a.cancel);
    const done = v => { bg.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') done(cancelAct ? cancelAct.value : null); };
    // на Android порядок слева направо: отмена → основное; на iOS — основное сверху
    const ordered = plat() === 'android' ? [...actions].sort((a, b) => (b.cancel ? 1 : 0) - (a.cancel ? 1 : 0)) : actions;
    for (const a of ordered) {
      const b = document.createElement('button');
      b.textContent = a.label;
      if (a.danger) b.classList.add('danger');
      if (a.strong) b.classList.add('strong');
      b.onclick = () => done(a.value);
      wrap.appendChild(b);
    }
    bg._cancel = () => done(cancelAct ? cancelAct.value : null);
    bg.addEventListener('click', e => { if (e.target === bg) done(cancelAct ? cancelAct.value : null); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(bg);
  });
}
function askConfirm({ title, message = '', ok = 'OK', cancel = 'Отмена', danger = false }) {
  return showDialog({
    title, message,
    actions: [
      { label: ok, value: true, strong: true, danger },
      { label: cancel, value: false, cancel: true },
    ],
  });
}

/* ── Уведомления ───────────────────────────────────────────────── */
function toast(msg, kind = '', opts = {}) {
  const wrap = $('toasts');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = `<span>${esc(msg)}</span>`;
  const close = () => { el.classList.add('leaving'); setTimeout(() => el.remove(), 220); };
  if (opts.action) {
    const b = document.createElement('button');
    b.className = 't-act'; b.textContent = opts.action.label;
    b.onclick = () => { opts.action.fn(); close(); };
    el.appendChild(b);
  }
  wrap.appendChild(el);
  if (kind === 'err') buzz([30, 40, 30]);
  setTimeout(close, opts.ms || (kind === 'err' ? 5200 : 3200));
}

/* ── Удаление показания с отменой ──────────────────────────────── */
const pendingDeletes = new Map();
function deleteReadingUndo(id) {
  const r = readings.find(x => x.id === id);
  if (!r) return;
  readings = readings.filter(x => x.id !== id);
  refreshAll();
  buzz(12);
  const timer = setTimeout(() => commitDelete(id), 6000);
  pendingDeletes.set(id, { row: r, timer });
  toast('Показание удалено', '', { ms: 6000, action: { label: 'Отменить', fn: () => undoDelete(id) } });
}
async function commitDelete(id) {
  const p = pendingDeletes.get(id);
  if (!p) return;
  pendingDeletes.delete(id);
  clearTimeout(p.timer);
  const { error } = await sb.from('readings').delete().eq('id', id);
  if (error) { readings.push(p.row); refreshAll(); toast('Не удалось удалить: ' + error.message, 'err'); }
}
function undoDelete(id) {
  const p = pendingDeletes.get(id);
  if (!p) return;
  clearTimeout(p.timer);
  pendingDeletes.delete(id);
  readings.push(p.row);
  refreshAll();
}
document.addEventListener('visibilitychange', () => { if (document.hidden) [...pendingDeletes.keys()].forEach(commitDelete); });
addEventListener('pagehide', () => { [...pendingDeletes.keys()].forEach(commitDelete); });

function deleteFromReadingModal() {
  const id = editingReadingId;
  closeReadingModal();
  if (id != null) deleteReadingUndo(id);
}
async function deleteFromModal(kind) {
  if (kind === 'tariff')      { const id = editingTariffId;     await deleteTariff(id);     if (!tariffs.some(t => t.id === id)) closeTariffModal(); }
  if (kind === 'advance')     { const id = editingAdvanceId;    await deleteAdvance(id);    if (!advances.some(a => a.id === id)) closeAdvanceModal(); }
  if (kind === 'settlement')  { const id = editingSettlementId; await deleteSettlement(id); if (!settlements.some(s => s.id === id)) closeSettlementModal(); }
}

/* ── Свайп строки истории ──────────────────────────────────────── */
(function swipe() {
  let el = null, x0 = 0, y0 = 0, dx = 0, lock = null, openEl = null;
  const W = 96;
  const setX = (row, x) => { row.querySelector('.swipe-fg').style.transform = x ? `translateX(${x}px)` : ''; if (x) row.classList.add('rev'); else setTimeout(() => { if (!row.querySelector('.swipe-fg').style.transform) row.classList.remove('rev'); }, 260); };
  document.addEventListener('touchstart', e => {
    const fg = e.target.closest('.swipe-fg');
    if (openEl && (!fg || fg.parentElement !== openEl)) { setX(openEl, 0); openEl = null; }
    if (!fg) { el = null; return; }
    el = fg.parentElement; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; lock = null;
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!el) return;
    const t = e.touches[0], mx = t.clientX - x0, my = t.clientY - y0;
    if (lock === null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) lock = Math.abs(mx) > Math.abs(my) * 1.4 ? 'x' : 'y';
    if (lock !== 'x') return;
    el.classList.add('dragging');
    const base = el === openEl ? -W : 0;
    dx = Math.max(-W - 24, Math.min(0, base + mx));
    setX(el, dx);
  }, { passive: true });
  document.addEventListener('touchend', () => {
    if (!el) return;
    el.classList.remove('dragging');
    if (lock === 'x') {
      const open = dx < -W / 2;
      setX(el, open ? -W : 0);
      openEl = open ? el : null;
      el.dataset.moved = '1';
      setTimeout(() => { if (el) delete el.dataset.moved; }, 50);
    }
    el = null;
  });
  // тап по строке после свайпа не должен открывать редактирование
  document.addEventListener('click', e => {
    const sw = e.target.closest('.swipe');
    if (sw && (sw.dataset.moved || sw === openEl)) { if (!e.target.closest('.swipe-act')) { e.stopPropagation(); e.preventDefault(); if (sw === openEl) { setX(sw, 0); openEl = null; } } }
  }, true);
})();

/* ── Потянуть для обновления ───────────────────────────────────── */
(function ptr() {
  const el = $('ptr');
  let y0 = null, dist = 0, busy = false;
  const reset = () => { el.style.transition = 'transform .25s,opacity .25s'; el.style.opacity = 0; el.style.transform = 'translateY(-60px)'; };
  addEventListener('touchstart', e => {
    y0 = (!busy && window.scrollY <= 0 && !openLayers.length && (curPage === 'home' || curPage === 'history') && !e.target.closest('.swipe-fg')) ? e.touches[0].clientY : null;
    dist = 0; el.style.transition = 'none';
  }, { passive: true });
  addEventListener('touchmove', e => {
    if (y0 === null) return;
    dist = e.touches[0].clientY - y0;
    if (dist > 6) {
      const k = Math.min(dist, 110);
      el.style.opacity = Math.min(1, k / 70);
      el.style.transform = `translateY(${k * .6 - 50}px) rotate(${k * 3}deg)`;
    }
  }, { passive: true });
  addEventListener('touchend', async () => {
    if (y0 === null) return;
    const go_ = dist > 90;
    y0 = null;
    if (go_) {
      busy = true; el.classList.add('spin'); el.style.transition = 'transform .2s'; el.style.transform = 'translateY(30px)';
      await reloadData(true);
      el.classList.remove('spin'); busy = false;
    }
    reset();
  });
})();

/* ── Клавиатура на iOS: подгоняем лист под видимую область ─────── */
(function vv() {
  if (!window.visualViewport) return;
  const upd = () => {
    const ov = $('entry');
    if (!ov || !ov.classList.contains('open') || plat() !== 'ios') { if (ov) { ov.style.height = ''; ov.style.transform = ''; } return; }
    ov.style.height = visualViewport.height + 'px';
    ov.style.transform = `translateY(${visualViewport.offsetTop}px)`;
  };
  visualViewport.addEventListener('resize', upd);
  visualViewport.addEventListener('scroll', upd);
})();

watchLayers();
applyLook();
