/* ═══════════════════════════════════════════════════════════════
   Экраны: Главная, История, Платежи, Ещё
   ═══════════════════════════════════════════════════════════════ */

/* ── Общие мелочи ──────────────────────────────────────────────── */
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const WD_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const CONF_LABEL = { high: 'надёжный прогноз', mid: 'приблизительный прогноз', low: 'ориентировочный прогноз' };
const RES_COLOR = { electricity: 'var(--elec)', water: 'var(--bath)', heating: 'var(--heat)' };

function dateLabel(iso, withYear) {
  const [y, m, d] = iso.split('-').map(Number);
  const yr = new Date().getFullYear();
  return `${d} ${MONTHS_GEN[m - 1]}` + ((withYear || y !== yr) ? ` ${y}` : '');
}
function agoText(iso) {
  const n = Math.round(daysBetween(iso, localISO()));
  return n <= 0 ? 'сегодня' : n === 1 ? 'вчера' : `${n} дн. назад`;
}
function typeName(t) {
  const c = TYPES[t];
  if (t === 'electricity') return 'Электричество';
  if (t === 'water_bathroom') return 'Вода · ванная';
  if (t === 'water_kitchen') return 'Вода · кухня';
  return `Отопление · ${c.room}`;
}
function typeColor(t) {
  if (t === 'electricity') return 'var(--elec)';
  if (t === 'water_bathroom') return 'var(--bath)';
  if (t === 'water_kitchen') return 'var(--kitchen)';
  return ROOM_COLORS[t];
}
const fmtSigned = x => `${sgn(x)}${euro0(Math.abs(x))}`;

/* ═══════════════════════ ГЛАВНАЯ ═══════════════════════════════ */
function renderHome() {
  const el = $('home-body');
  if (!readings.length) {
    el.innerHTML = `<div class="card" style="text-align:center;padding:32px 20px">
      <div class="prompt-ico" style="margin:0 auto 14px;width:56px;height:56px">${icon('gauge')}</div>
      <div class="prompt-title" style="font-size:20px">Показаний пока нет</div>
      <div class="prompt-sub" style="margin:6px 0 20px;font-size:var(--fs-sub)">Снимите первые показания или загрузите историю 2022–2026.</div>
      <button class="btn big block" onclick="openEntry()">Снять показания</button>
      <button class="btn tonal block" id="import-btn" style="margin-top:10px" onclick="importHistoricalData()">Загрузить историю</button>
    </div>`;
    return;
  }

  const st = readingStatus();
  const parts = [];
  const prompt = promptCard(st);
  if (st && st.state === 'late') parts.push(prompt);
  parts.push(balanceTiles());
  parts.push(monthCard());
  if (!st || st.state !== 'late') parts.push(prompt);

  const issues = findDataIssues();
  if (issues.length) {
    parts.push(`<div class="card warn">
      <div class="row-title" style="display:flex;gap:8px;align-items:center;color:var(--warn)">${icon('alert')} Нужно проверить данные${issues.length > 1 ? ` · ${issues.length}` : ''}</div>
      <div class="list flat" style="margin-top:6px">
        ${issues.slice(0, 2).map(i => `<div class="row"><div class="row-main"><div class="row-sub" style="color:var(--text)">${esc(i.text)}</div></div>
          <button class="btn tonal sm" onclick="openEditReading(${i.id})">Исправить</button></div>`).join('')}
      </div></div>`);
  }

  const ins = buildInsights();
  if (ins.length) {
    parts.push(`<div><div class="sec-head"><div class="sec-title">Что изменилось</div></div>
      <div class="list">${ins.map(i => `<div class="row">
        <span class="dot" style="background:${i.color}"></span>
        <div class="row-main"><div class="row-title" style="font-size:var(--fs-sub)">${esc(i.title)}</div><div class="row-sub">${esc(i.text)}</div></div>
        ${i.tone === 'bad' ? `<span class="pill bad">выше</span>` : i.tone === 'good' ? `<span class="pill ok">ниже</span>` : ''}
      </div>`).join('')}</div></div>`);
  }

  parts.push(metersBlock());
  el.innerHTML = `<div class="stack">${parts.join('')}</div>`;
}

/* ── Итог года: две плитки ─────────────────────────────────────── */
function balanceTiles() {
  const fe = forecastElectricity();
  const nk = forecastNK(new Date().getFullYear());
  return `<div><div class="sec-head"><div class="sec-title">Итог года по авансам</div><button class="sec-action" onclick="go('pay')">Подробнее</button></div>
    <div class="tiles">${tile('Электричество', 'var(--elec)', fe, fe.hasAdvances, null)}${tile('Коммуналка', 'var(--bath)', nk, nk.hasAdvances, nk)}</div></div>`;
}
function tile(label, color, f, has, nk) {
  const isDoc = nk && nk.kind === 'doc';
  let bal = f.balance;
  let cap, foot;
  if (isDoc) {
    bal = -(nk.correction || 0) || f.balance;
    cap = bal >= 0 ? 'вернули по расчёту' : 'доплатили по расчёту';
    foot = `Расчёт за ${nk.year} получен`;
  } else if (!has) {
    const proj = f.proj != null ? f.proj : f.total;
    return `<button class="tile" onclick="go('pay')">
      <div class="tile-label"><span class="dot" style="background:${color}"></span>${label}</div>
      <div class="tile-val">≈ ${euro0(proj)}<small>€</small></div>
      <div class="tile-cap">прогноз расходов за год</div>
      <div class="tile-foot">Авансы не заданы</div></button>`;
  } else {
    cap = bal >= 0 ? 'вернут по итогам' : 'доплата по итогам';
    foot = CONF_LABEL[f.confidence] || '';
  }
  const paid = f.paidFull || 1;
  const spent = isDoc ? f.total : (nk ? (f.waterF ? f.waterF.spent + f.heatF.spent : 0) : f.spent);
  const fillPct = Math.min(100, spent / paid * 100);
  const markPct = Math.min(100, (f.paidToDate || 0) / paid * 100);
  return `<button class="tile ${bal >= 0 ? 'pos' : 'neg'}" onclick="go('pay')">
    <div class="tile-label"><span class="dot" style="background:${color}"></span>${label}</div>
    <div class="tile-val">${fmtSigned(bal)}<small>€</small></div>
    <div class="tile-cap">${cap}</div>
    <div class="meter-line" title="Потрачено и уплачено авансами"><i style="width:${fillPct.toFixed(1)}%;background:${bal >= 0 ? 'var(--success)' : 'var(--danger)'}"></i><b style="left:calc(${markPct.toFixed(1)}% - 1px)"></b></div>
    <div class="tile-foot">${foot}</div></button>`;
}

/* ── Текущий месяц ─────────────────────────────────────────────── */
function monthEstimate(cat) {
  const y = new Date().getFullYear(), key = localISO().slice(0, 7);
  const f = forecastCategory(cat, `${y}-01-01`, `${y}-12-31`);
  const row = f.months.find(m => m.key === key);
  return row ? row.value : 0;
}
function monthCard() {
  const now = new Date(), key = localISO().slice(0, 7);
  const dim = daysInMonthKey(key), dayNow = now.getDate();
  const all = getAllMonthlyData();
  const lines = [
    { cat: 'electricity', name: 'Электричество', unit: 'кВт·ч', dec: 0 },
    { cat: 'water', name: 'Вода', unit: 'м³', dec: 2 },
    { cat: 'heating', name: 'Отопление', unit: 'взв. ед.', dec: 0 },
  ].map(l => {
    const m = CAT[l.cat].get(all, key);
    const fixed = monthFixed(CAT[l.cat].tariff, key) * dayNow / dim;
    return { ...l, cons: m.cons, so: (m.cost || 0) + fixed, est: monthEstimate(l.cat) };
  });
  const total = lines.reduce((a, l) => a + l.so, 0);
  const est = lines.reduce((a, l) => a + l.est, 0);
  const bar = total > 0 ? lines.map(l => `<span style="flex:${Math.max(l.so, 0.0001)};background:${RES_COLOR[l.cat]}"></span>`).join('') : '';
  return `<div class="card month">
    <div class="month-top"><div class="month-name">${MONTHS_NOM[now.getMonth()]} ${now.getFullYear()}</div><div class="month-days">${dayNow} из ${dim} дн.</div></div>
    <div class="month-total">${total > 0 ? fmtE(total) : '—'}</div>
    ${est > 0 ? `<div class="month-fc">к концу месяца <b>≈ ${fmtE(est)}</b></div>` : ''}
    ${bar ? `<div class="stackbar">${bar}</div>` : '<div style="height:12px"></div>'}
    <div class="legend">${lines.map(l => `<div class="row">
      <span class="dot" style="background:${RES_COLOR[l.cat]}"></span>
      <div class="row-main"><div class="row-title">${l.name}</div></div>
      <div class="row-end"><b style="font-weight:500">${fmtE(l.so)}</b>${l.cons > 0 ? `<span>${fmtN(l.cons, l.dec)} ${l.unit}</span>` : ''}</div>
    </div>`).join('')}</div></div>`;
}

/* ── Когда снимать ─────────────────────────────────────────────── */
function promptCard(st) {
  if (!st) return '';
  let title, cls = '';
  if (st.state === 'late') { title = `Показания просрочены на ${-st.dueIn} ${plural(-st.dueIn, 'день', 'дня', 'дней')}`; cls = 'late'; }
  else if (st.dueIn === 0) title = 'Пора снимать показания — сегодня';
  else if (st.state === 'soon') title = `Пора снимать показания — ${st.dueIn === 1 ? 'завтра' : 'через ' + st.dueIn + ' дн.'}`;
  else title = `Следующее снятие — через ${st.dueIn} ${plural(st.dueIn, 'день', 'дня', 'дней')}`;

  let sub = `Последний раз ${agoText(st.last)} · обычно раз в ${st.cadence} дн.`;
  if (st.stale.length) {
    const names = st.stale.slice(0, 3).map(s => `${TYPES[s.type].room ? 'Отопл. ' + TYPES[s.type].room : TYPES[s.type].label.split(' (')[0]} ${s.days} дн.`);
    sub += `. Давно не снимали: ${names.join(', ')}${st.stale.length > 3 ? '…' : ''}`;
  }
  return `<div class="card prompt ${cls}">
    <div class="prompt-ico">${icon(st.state === 'late' ? 'alert' : 'cal')}</div>
    <div class="prompt-text"><div class="prompt-title">${title}</div><div class="prompt-sub">${esc(sub)}</div></div>
    <button class="btn sm" onclick="openEntry()">Снять</button></div>`;
}

/* ── Счётчики ──────────────────────────────────────────────────── */
function metersBlock() {
  const row = t => {
    const s = getTypeReadings(t);
    if (!s.length) return '';
    const last = s[s.length - 1], prev = s.length > 1 ? s[s.length - 2] : null, cfg = TYPES[t];
    let rate = '';
    if (prev && !last.is_reset && last.value >= prev.value) {
      const d = daysBetween(prev.date, last.date);
      if (d > 0 && last.value > prev.value) rate = ` · ${fmtN((last.value - prev.value) / d, cfg.dec + 1)} ${cfg.unit}/дн.`;
    }
    return `<div class="row"><span class="dot" style="background:${typeColor(t)}"></span>
      <div class="row-main"><div class="row-title" style="font-size:var(--fs-sub)">${cfg.room ? cfg.room : typeName(t)}${cfg.room ? ` <span class="row-k">×${cfg.factor}</span>` : ''}</div>
        <div class="row-sub">${agoText(last.date)}${rate}</div></div>
      <div class="row-end"><b>${fmtN(last.value, cfg.dec)} <small>${cfg.unit}</small></b></div></div>`;
  };
  const main = ['electricity', 'water_bathroom', 'water_kitchen'].map(row).join('');
  const heat = HEATING_TYPES.map(row).join('');
  return `<div><div class="sec-head"><div class="sec-title">Счётчики</div></div><div class="list">${main}</div>
    ${heat ? `<div class="sec-head" style="margin-top:18px"><div class="sec-title">Отопление · распределители</div></div><div class="list">${heat}</div>` : ''}</div>`;
}

/* ═══════════════════════ ИСТОРИЯ ═══════════════════════════════ */
const H = { filter: 'all', room: null, limit: 30 };
const H_TYPES = {
  all: () => Object.keys(TYPES),
  electricity: () => ['electricity'],
  water: () => ['water_bathroom', 'water_kitchen'],
  heating: () => (H.room ? [H.room] : HEATING_TYPES),
};
function setHistoryFilter(f) { H.filter = f; H.room = null; H.limit = 30; renderHistory(); }
function setHistoryRoom(r) { H.room = r || null; H.limit = 30; renderHistory(); }
function moreHistory() { H.limit += 30; renderHistory(); }

function renderHistory() {
  const el = $('history-body');
  const order = Object.keys(TYPES);
  const rows = [];
  for (const t of H_TYPES[H.filter]()) rows.push(...enrichReadings(t));
  const groups = new Map();
  for (const r of rows) { if (!groups.has(r.date)) groups.set(r.date, []); groups.get(r.date).push(r); }
  const dates = [...groups.keys()].sort().reverse();
  const shown = dates.slice(0, H.limit);

  const chip = (v, label, dot) => `<button class="chip ${H.filter === v ? 'active' : ''}" onclick="setHistoryFilter('${v}')">${dot ? `<span class="dot" style="background:${dot}"></span>` : ''}${label}</button>`;
  let html = `<div class="chips">${chip('all', 'Все')}${chip('electricity', 'Свет', 'var(--elec)')}${chip('water', 'Вода', 'var(--bath)')}${chip('heating', 'Отопление', 'var(--heat)')}</div>`;
  if (H.filter === 'heating') {
    html += `<div class="chips" style="margin-top:8px"><button class="chip ${!H.room ? 'active' : ''}" onclick="setHistoryRoom(null)">Все комнаты</button>${
      HEATING_TYPES.map(t => `<button class="chip ${H.room === t ? 'active' : ''}" onclick="setHistoryRoom('${t}')"><span class="dot" style="background:${ROOM_COLORS[t]}"></span>${TYPES[t].room}</button>`).join('')}</div>`;
  }

  if (!shown.length) {
    el.innerHTML = html + '<div class="empty">Показаний нет</div>';
    return;
  }

  for (const date of shown) {
    const g = groups.get(date).sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.id - b.id);
    const cost = g.reduce((a, r) => a + (r.cost || 0), 0);
    const d = new Date(date + 'T00:00:00');
    const rel = Math.round(daysBetween(date, localISO()));
    const when = rel === 0 ? 'сегодня' : rel === 1 ? 'вчера' : WD_SHORT[d.getDay()];
    html += `<div class="dayhead"><b>${dateLabel(date, true)}</b><span>${when}${cost > 0 ? ` · ≈ ${fmtE(cost)}` : ''}</span></div>
      <div class="list">${g.map(historyRow).join('')}</div>`;
  }
  if (dates.length > shown.length) html += `<button class="btn tonal more-btn" onclick="moreHistory()">Показать ещё · ${dates.length - shown.length}</button>`;
  el.innerHTML = html;
}

function historyRow(r) {
  const cfg = TYPES[r.type], dec = cfg.dec;
  let sub, pill = '';
  if (r.is_reset) sub = 'замена счётчика';
  else if (r.delta !== null) sub = `+${fmtN(r.delta, dec)} ${cfg.unit}` + (r.days ? ` · ${r.days} дн.` : '');
  else if (r.days === null) sub = 'первое показание';
  else { sub = r.days === 0 ? 'вторая запись за дату' : 'значение упало'; pill = '<span class="pill warn">проверить</span>'; }
  return `<div class="swipe" data-id="${r.id}">
    <div class="swipe-act" onclick="deleteReadingUndo(${r.id})">Удалить</div>
    <div class="swipe-fg"><button class="row" onclick="openEditReading(${r.id})">
      <span class="dot" style="background:${typeColor(r.type)}"></span>
      <div class="row-main"><div class="row-title" style="font-size:var(--fs-sub)">${typeName(r.type)}</div><div class="row-sub">${sub} ${pill}</div></div>
      <div class="row-end"><b>${fmtN(r.value, dec)} <small>${cfg.unit}</small></b>${r.cost != null && r.cost > 0 ? `<span>${fmtE(r.cost)}</span>` : ''}</div>
    </button></div></div>`;
}

/* ═══════════════════════ ПЛАТЕЖИ ═══════════════════════════════ */
const P = { seg: 'forecast' };
function setPaySeg(s) { P.seg = s; renderPay(); }

function renderPay() {
  const segs = [['forecast', 'Итоги'], ['adv', 'Авансы'], ['tariffs', 'Тарифы']];
  let html = `<div class="seg">${segs.map(([k, l]) => `<button class="${P.seg === k ? 'active' : ''}" onclick="setPaySeg('${k}')">${l}</button>`).join('')}</div><div style="margin-top:18px">`;
  html += P.seg === 'forecast' ? payForecast() : P.seg === 'adv' ? payAdvances() : payTariffs();
  $('pay-body').innerHTML = html + '</div>';
}

/* ── Итоги ─────────────────────────────────────────────────────── */
function balBlock({ title, color, period, f, isDoc, rows, advice, note, editPeriod }) {
  const has = f.hasAdvances;
  const bal = f.balance;
  const cls = has ? (bal >= 0 ? 'pos' : 'neg') : '';
  let big = '', cap = '';
  if (isDoc) {
    const res = -(f.correction || 0) || bal;
    big = `${fmtSigned(res)}<small> €</small>`; cap = res >= 0 ? 'вернули по расчёту' : 'доплатили по расчёту';
  } else if (has) {
    big = `${fmtSigned(bal)}<small> €</small>`; cap = bal >= 0 ? 'вернут по итогам периода (переплата авансами)' : 'доплата по итогам периода';
  } else { big = `≈ ${euro0(f.total != null ? f.total : f.proj)}<small> €</small>`; cap = 'прогноз расходов за период — авансы не заданы'; }
  const paid = f.paidFull || 1;
  const spent = f.spent != null ? f.spent : 0;
  const fillPct = Math.min(100, spent / paid * 100), markPct = Math.min(100, (f.paidToDate || 0) / paid * 100);
  return `<div class="card bal ${isDoc ? (( -(f.correction || 0) || bal) >= 0 ? 'pos' : 'neg') : cls}">
    <div class="bal-head"><div><div class="bal-title"><span class="dot" style="background:${color}"></span>${title}</div><div class="bal-period">${period}</div></div>
      ${editPeriod ? `<button class="btn tonal sm" onclick="openPeriodSheet()">Период</button>` : ''}</div>
    <div class="bal-val">${big}</div><div class="bal-cap">${cap}</div>
    ${has && !isDoc ? `<div class="meter-line"><i style="width:${fillPct.toFixed(1)}%;background:${bal >= 0 ? 'var(--success)' : 'var(--danger)'}"></i><b style="left:calc(${markPct.toFixed(1)}% - 1px)"></b></div>
      <div class="note" style="margin-top:8px">Заливка — потрачено, метка — уплачено авансами на сегодня</div>` : ''}
    <div class="kv">${rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>
    ${advice || ''}${note ? `<div class="note">${note}</div>` : ''}
  </div>`;
}
function adviceBox(f, kind) {
  if (!f.hasAdvances || !f.rate) return '';
  const diff = f.balance;
  if (Math.abs(diff) <= 5) return `<div class="advice">${icon('check')}<div>Аванс подобран точно: ${euro0(f.rate)} €/мес почти равен расходу.</div></div>`;
  if (diff < 0) return `<div class="advice">${icon('spark')}<div>Чтобы не доплачивать, поднимите аванс до <b>${euro0(f.fair)} €/мес</b> (сейчас ${euro0(f.rate)} €).</div></div>`;
  return `<div class="advice">${icon('spark')}<div>Аванс можно снизить до <b>${euro0(f.fair)} €/мес</b> — сейчас вы переплачиваете около ${euro0(diff / 12)} € в месяц.</div></div>`;
}
function basisNote(f) {
  let t = `Факт по ${f.factMonths} ${plural(f.factMonths, 'месяцу', 'месяцам', 'месяцам')} + сезонность прошлого года`;
  if (f.trend) t += `, с поправкой на текущие темпы (${f.trend >= 1 ? '+' : '−'}${Math.abs(Math.round((f.trend - 1) * 100))}%)`;
  if (inflationPct) t += `, рост цен ${inflationPct}%`;
  return t + '. Авансы не индексируются.';
}

function payForecast() {
  const fe = forecastElectricity();
  const per = `${fmtDate(fe.from)} — ${fmtDate(fe.to)}`;
  let html = '<div class="stack">';

  html += balBlock({
    title: 'Электричество', color: 'var(--elec)', period: per, f: fe, editPeriod: true,
    rows: [
      ['Авансы за период', fmtE(fe.paidFull)],
      ['Уплачено на сегодня', fmtE(fe.paidToDate)],
      ['Расход на сегодня', fmtE(fe.spent)],
      ['Прогноз за период', fmtE(fe.proj)],
      ['Аванс сейчас', fe.rate ? `${fmtE(fe.rate)} / мес` : '—'],
    ],
    advice: adviceBox(fe), note: fe.ended ? 'Период закончился — ждите годовой расчёт или сдвиньте начало периода.' : basisNote(fe),
  });

  // Коммуналка: выбор года
  const years = getBudgetYears().filter(y => y <= new Date().getFullYear() + 0).slice(-4);
  if (!years.includes(budgetYear)) budgetYear = new Date().getFullYear();
  html += `<div><div class="chips" style="margin-bottom:12px">${years.map(y => `<button class="chip ${y === budgetYear ? 'active' : ''}" onclick="setPayYear(${y})">${y}</button>`).join('')}</div>`;
  const nk = forecastNK(budgetYear);
  if (nk.kind === 'doc') {
    html += balBlock({
      title: `Коммуналка ${nk.year}`, color: 'var(--bath)', period: `по годовому расчёту от ${fmtDate(nk.doc.settlement_date)}`, f: nk, isDoc: true,
      rows: [
        ['Расход по расчёту', fmtE(nk.total)],
        ['Вода', fmtE(nk.water)], ['Отопление', fmtE(nk.heat)], ['Прочее и Grundsteuer', fmtE(nk.other)],
        ['Авансы за год', fmtE(nk.paidFull)],
        ['Разница авансы − расход', `${sgn(nk.balance)}${fmtE(Math.abs(nk.balance))}`],
      ],
      note: nk.correction ? `Корректировка по документу: ${fmtE(nk.correction)} (минус — вам вернули).` : '',
    });
  } else {
    const rows = [
      ['Авансы за год', fmtE(nk.paidFull)], ['Уплачено на сегодня', fmtE(nk.paidToDate)],
      ['Вода · прогноз', fmtE(nk.water)], ['Отопление · прогноз', fmtE(nk.heat)],
      ['Прочее · ' + (nk.propYear ? `по расчёту ${nk.propYear}` : 'не учтено'), nk.other != null ? fmtE(nk.other) : '—'],
      ['Итого за год', fmtE(nk.total)],
      ['Аванс сейчас', nk.rate ? `${fmtE(nk.rate)} / мес` : '—'],
    ];
    nk.spent = nk.waterF.spent + nk.heatF.spent;
    nk.proj = nk.total;
    nk.factMonths = Math.min(nk.waterF.factMonths, nk.heatF.factMonths);
    nk.trend = null;
    html += balBlock({
      title: `Коммуналка ${nk.year}`, color: 'var(--bath)', period: nk.past ? 'год закончился, расчёт ещё не внесён' : `1 января — 31 декабря ${nk.year}`, f: nk, rows,
      advice: adviceBox(nk),
      note: nk.past ? 'Внесите годовой расчёт на вкладке «Авансы», когда получите его.' :
        `${basisNote({ factMonths: nk.factMonths, trend: null })} «Прочее» (уборка, страховка, Grundsteuer) берётся из последнего расчёта.`,
    });
  }
  html += '</div>';

  html += `<div class="card" style="margin-top:14px"><div class="row" style="padding:0;min-height:0">
      <div class="row-main"><div class="row-title">Рост цен в прогнозе</div><div class="row-sub">Применяется к будущим месяцам</div></div>
      <div class="stepper"><button onclick="stepInflation(-1)" aria-label="Меньше">−</button>
        <input type="number" id="inflation-input" inputmode="decimal" value="${inflationPct}" onchange="setInflation(this.value)"><span class="muted">%</span>
        <button onclick="stepInflation(1)" aria-label="Больше">+</button></div></div></div>`;
  return html;
}
function setPayYear(y) { budgetYear = y; renderPay(); }
function setInflation(v) { inflationPct = parseFloat(v) || 0; dropDataCache(); renderPay(); }
function stepInflation(d) { setInflation(inflationPct + d); }

function openPeriodSheet() {
  const { from } = elecPeriod();
  openSheet(`<div class="modal-title">Период электричества</div>
    <div class="hint" style="margin:-6px 0 14px">Дата, с которой считается ваш годовой период по электричеству. Обычно — день после прошлого расчёта.</div>
    <div class="fg"><label for="per-from">Начало периода</label><input type="date" id="per-from" value="${from}"></div>
    <div class="modal-actions"><button class="btn tonal" onclick="closeSheet()">Отмена</button>
      <button class="btn" onclick="setElecPeriodFrom($('per-from').value);closeSheet()">Сохранить</button></div>`);
}

/* ── Авансы и расчёты ──────────────────────────────────────────── */
function payAdvances() {
  const labels = { electricity: 'Электричество', kommunalka: 'Коммуналка (Nebenkosten)' };
  let html = '<div class="stack">';
  for (const type of ['electricity', 'kommunalka']) {
    const list = advances.filter(a => a.type === type).sort((a, b) => b.effective_from.localeCompare(a.effective_from));
    html += `<div><div class="sec-head"><div class="sec-title">Аванс · ${labels[type]}</div>${type === 'electricity' ? `<button class="sec-action" onclick="openAdvanceModal()">+ Добавить</button>` : ''}</div>
      <div class="list">${list.length ? list.map((a, i) => `<button class="row" onclick="openAdvanceModal(${a.id})">
        <div class="row-main"><div class="row-title" style="font-size:var(--fs-sub)">с ${fmtDate(a.effective_from)}</div>${i === 0 ? '<div class="row-sub">действует сейчас</div>' : ''}</div>
        <div class="row-end"><b>${fmtE(a.monthly_amount)}</b><span>в месяц</span></div></button>`).join('') : '<div class="empty">Не задан</div>'}</div></div>`;
  }
  html += `<div><div class="sec-head"><div class="sec-title">Годовые расчёты</div><button class="sec-action" onclick="openSettlementModal()">+ Добавить</button></div>
    <div class="list">`;
  const sorted = [...settlements].sort((a, b) => b.period_year - a.period_year || b.type.localeCompare(a.type));
  html += sorted.length ? sorted.map(s => {
    const isK = s.type === 'kommunalka', corr = s.correction || 0;
    const total = (s.actual_total || 0) + (s.grundsteuer || 0);
    const sub = isK ? [s.water_portion != null ? `вода ${euro0(s.water_portion)}` : '', s.heating_portion != null ? `отопл. ${euro0(s.heating_portion)}` : '', s.other_portion != null ? `прочее ${euro0((s.other_portion || 0) + (s.grundsteuer || 0))}` : ''].filter(Boolean).join(' · ') : `получен ${fmtDate(s.settlement_date)}`;
    return `<button class="row" onclick="openSettlementModal(${s.id})">
      <div class="row-main"><div class="row-title" style="font-size:var(--fs-sub)">${isK ? 'Коммуналка' : 'Электричество'} ${s.period_year}</div><div class="row-sub">${sub}</div></div>
      <div class="row-end"><b>${fmtE(total)}</b>${corr ? `<span class="pill ${corr < 0 ? 'ok' : 'bad'}">${corr < 0 ? 'вернули' : 'доплата'} ${euro0(Math.abs(corr))} €</span>` : '<span>без корректировки</span>'}</div></button>`;
  }).join('') : '<div class="empty">Расчётов нет</div>';
  return html + '</div></div></div>';
}

/* ── Тарифы ────────────────────────────────────────────────────── */
function payTariffs() {
  const names = { electricity: 'Электричество', water: 'Вода', heating: 'Отопление' };
  let html = `<div class="stack"><div class="card" style="font-size:var(--fs-sub);color:var(--text2)">Тарифы действуют с указанной даты. Изменение задним числом пересчитывает все показания автоматически.</div>`;
  html += `<div style="display:flex;justify-content:flex-end"><button class="btn tonal sm" onclick="openTariffModal()">+ Новый тариф</button></div>`;
  for (const type of ['electricity', 'water', 'heating']) {
    const list = tariffs.filter(t => t.type === type).sort((a, b) => b.effective_from.localeCompare(a.effective_from));
    html += `<div><div class="sec-head"><div class="sec-title">${names[type]}</div></div><div class="list">${list.length ? list.map((t, i) => `<button class="row" onclick="openTariffModal(${t.id})">
      <div class="row-main"><div class="row-title" style="font-size:var(--fs-sub)">с ${fmtDate(t.effective_from)}</div><div class="row-sub">${t.fixed_cost != null ? `фикс. ${fmtE(t.fixed_cost)} в год` : 'без фикс. платы'}${i === 0 ? ' · действует' : ''}</div></div>
      <div class="row-end"><b>${t.rate} €</b><span>за ${TARIFF_UNITS[type]}</span></div></button>`).join('') : '<div class="empty">Нет тарифов</div>'}</div></div>`;
  }
  return html + '</div>';
}

/* ═══════════════════════ ЕЩЁ ═══════════════════════════════════ */
function renderMore() {
  $('s-gsheets-url').value = lsGet('gsheetsUrl') || '';
  updateSyncStatus();
  renderBackupStatus();
  sb.auth.getUser().then(({ data }) => { const el = $('s-user-email'); if (el) el.textContent = data?.user?.email || '—'; }).catch(() => {});
  $('app-version').textContent = `Коммуналка ${APP_VERSION} · стиль: ${plat() === 'ios' ? 'iPhone' : 'Android'}`;
  applyLook();
}
