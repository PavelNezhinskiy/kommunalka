/* ═══════════════════════════════════════════════════════════════
   Снятие показаний: один экран на все счётчики, подсказка «ожидаем»,
   проверка на ходу, итог с возможностью отмены.
   Плюс: напоминание в календарь и экспорт в CSV.
   ═══════════════════════════════════════════════════════════════ */
const ANOMALY_FACTOR = 2.5;                         // во сколько раз выше обычного считаем подозрительным
const MIN_ABS = { electricity: 25, water: 0.2, heating: 20 };   // ниже этого расхода не ругаемся
const E = { date: localISO(), heatOpen: true, lastIds: [], lastRows: [] };
const ENTRY_GROUPS = () => [
  { key: 'main', title: 'Счётчики', types: ['electricity', 'water_bathroom', 'water_kitchen'] },
  { key: 'heat', title: 'Отопление · распределители', types: HEATING_TYPES, toggle: true },
];
const wid = t => 'w-' + t;

/* ── Ожидаемое значение и «обычный» темп ───────────────────────── */
function recentDailyRate(type, n = 3) {
  const s = getTypeReadings(type), rates = [];
  for (let i = s.length - 1; i > 0 && rates.length < n; i--) {
    const a = s[i - 1], b = s[i];
    if (b.is_reset || b.value < a.value) continue;
    const d = daysBetween(a.date, b.date);
    if (d <= 0) continue;
    rates.push((b.value - a.value) / d);
  }
  return rates.length ? rates.reduce((x, y) => x + y, 0) / rates.length : 0;
}
function expectedValue(type, date) {
  const s = getTypeReadings(type);
  if (!s.length) return null;
  const prev = s[s.length - 1];
  const days = Math.max(0, daysBetween(prev.date, date));
  const v = prev.value + recentDailyRate(type) * days;
  const dec = TYPES[type].dec;
  return +v.toFixed(dec);
}

/* ── Открыть / закрыть ─────────────────────────────────────────── */
function openEntry() {
  E.date = localISO();
  E.heatOpen = isHeatingSeason();
  buildEntry();
  const ov = $('entry');
  ov.classList.remove('closing');
  ov.classList.add('open');
  ov.setAttribute('aria-hidden', 'false');
  $('entry-body').scrollTop = 0;
  buzz(8);
}
function closeEntry() {
  const ov = $('entry');
  if (!ov.classList.contains('open') || ov.classList.contains('closing')) return;
  ov.classList.add('closing');
  setTimeout(() => { ov.classList.remove('open', 'closing'); ov.setAttribute('aria-hidden', 'true'); ov.style.height = ''; ov.style.transform = ''; }, 240);
}
async function clearEntry() {
  const any = ENTRY_GROUPS().some(g => g.types.some(t => $(wid(t)) && $(wid(t)).value));
  if (any && !(await askConfirm({ title: 'Очистить введённое?', ok: 'Очистить', danger: true }))) return;
  for (const g of ENTRY_GROUPS()) for (const t of g.types) { const el = $(wid(t)); if (el) el.value = ''; }
  refreshEntry();
}

/* ── Разметка ──────────────────────────────────────────────────── */
function buildEntry() {
  const ios = plat() === 'ios';
  $('entry-cancel').innerHTML = ios ? 'Отмена' : icon('close');
  $('entry-cancel').setAttribute('aria-label', 'Закрыть');
  $('entry-clear').style.display = '';

  let html = `<div class="datebar" id="datebar"></div>`;
  for (const g of ENTRY_GROUPS()) {
    html += `<div class="egroup" id="eg-${g.key}">
      <div class="egroup-head"><div class="egroup-title">${g.title}</div>
        ${g.toggle ? `<button class="egroup-toggle" onclick="toggleHeat()"><span id="heat-count"></span>${icon('chev-down')}</button>` : ''}</div>
      ${g.toggle ? `<div class="egroup-note">Заполните только то, что сняли — например, одну комнату.</div>` : ''}
      <div class="elist">${g.types.map(entryRow).join('')}</div></div>`;
  }
  $('entry-body').innerHTML = html;
  $('eg-heat').classList.toggle('collapsed', !E.heatOpen);
  renderDatebar();
  refreshEntry();

  // Enter → следующее поле
  $('entry-body').onkeydown = e => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT' || e.target.type === 'date') return;
    e.preventDefault();
    const ins = qa('.erow input', $('entry-body')).filter(i => i.offsetParent !== null);
    const nxt = ins[ins.indexOf(e.target) + 1];
    nxt ? nxt.focus() : e.target.blur();
  };
}
function entryRow(t) {
  const cfg = TYPES[t];
  const name = cfg.room || typeName(t);
  const step = cfg.dec ? '0.001' : '1';
  return `<div class="erow" id="row-${wid(t)}" style="--meter:${typeColor(t)}">
    <span class="dot"></span>
    <div class="erow-info">
      <div class="erow-name">${name}${cfg.room ? `<small>×${cfg.factor}</small>` : ''}</div>
      <div class="erow-prev" id="prev-${wid(t)}"></div>
      <div class="erow-flag" id="flag-${wid(t)}"></div>
    </div>
    <input type="number" id="${wid(t)}" step="${step}" inputmode="decimal" enterkeyhint="next" autocomplete="off"
           aria-label="${esc(typeName(t))}" oninput="refreshEntry()">
  </div>`;
}
function toggleHeat() { E.heatOpen = !E.heatOpen; $('eg-heat').classList.toggle('collapsed', !E.heatOpen); }

function renderDatebar() {
  const today = localISO(), yest = addDaysISO(today, -1);
  const custom = E.date !== today && E.date !== yest;
  $('datebar').innerHTML = `
    <button class="chip ${E.date === today ? 'active' : ''}" onclick="setEntryDate('${today}')">Сегодня</button>
    <button class="chip ${E.date === yest ? 'active' : ''}" onclick="setEntryDate('${yest}')">Вчера</button>
    <label class="chip ${custom ? 'active' : ''}">${icon('cal')}<span>${custom ? dateLabel(E.date, true) : 'Другая дата'}</span>
      <input type="date" id="r-date" value="${E.date}" max="${today}" onchange="setEntryDate(this.value)"></label>`;
  $('datebar').querySelectorAll('svg').forEach(s => { s.style.width = '18px'; s.style.height = '18px'; });
}
function setEntryDate(d) { if (!d) return; E.date = d; renderDatebar(); refreshEntry(); }

/* ── Проверка строки ───────────────────────────────────────────── */
function entryRowState(type) {
  const el = $(wid(type));
  const raw = el ? el.value.trim() : '';
  const val = raw === '' ? null : parseFloat(raw);
  const s = getTypeReadings(type);
  const prev = s.length ? s[s.length - 1] : null;
  return { type, el, prev, val, filled: val !== null && !isNaN(val) };
}
function baselineRate(type) {
  const r = recentDailyRate(type, 6);
  return r > 0 ? r : 0;
}
function entryCheck(type) {
  const { prev, val, filled } = entryRowState(type);
  const date = E.date;
  if (!filled) return { state: 'empty' };
  if (!prev) return { state: 'first' };
  if (date < prev.date) return { state: 'before', prev };
  if (val < prev.value) return { state: 'drop', prev };
  if (val === prev.value) return { state: 'same', prev };
  const delta = +(val - prev.value).toFixed(3);
  const days = Math.round(daysBetween(prev.date, date));
  const perDay = days > 0 ? delta / days : null;
  const base = baselineRate(type);
  const ratio = (perDay && base > 0) ? perDay / base : null;
  const cost = days > 0 ? calcVarCost(type, prev.date, date, delta) : null;
  const min = MIN_ABS[TYPES[type].group] || 0;
  const high = ratio && ratio > ANOMALY_FACTOR && delta >= min;
  return { state: high ? 'high' : 'ok', delta, days, perDay, base, ratio, cost, prev };
}

function refreshEntry() {
  let n = 0, cost = 0, flagged = 0, heatFilled = 0;
  for (const g of ENTRY_GROUPS()) for (const t of g.types) {
    const cfg = TYPES[t], { prev } = entryRowState(t);
    const r = entryCheck(t);
    const row = $('row-' + wid(t)), flag = $('flag-' + wid(t)), pv = $('prev-' + wid(t)), inp = $(wid(t));
    // «было …» и подсказка «ожидаем»
    const ago = prev ? Math.round(daysBetween(prev.date, E.date)) : null;
    pv.innerHTML = prev
      ? `было <b>${fmtN(prev.value, cfg.dec)}</b> ${cfg.unit} · ${ago <= 0 ? 'в этот день' : ago + ' дн. назад'}`
      : 'первое показание';
    const ex = expectedValue(t, E.date);
    inp.placeholder = ex != null ? `≈ ${fmtN(ex, cfg.dec)}` : '—';
    row.classList.toggle('filled', r.state !== 'empty');

    let msg = '';
    switch (r.state) {
      case 'first':  msg = '<span class="ok">первая запись по этому счётчику</span>'; break;
      case 'before': msg = `<span class="bad">дата раньше последнего показания (${fmtDate(r.prev.date)})</span>`; break;
      case 'drop':   msg = '<span class="bad">меньше предыдущего — спросим про замену счётчика</span>'; break;
      case 'same':   msg = '<span>без изменений</span>'; break;
      case 'ok': case 'high': {
        const base = `+${fmtN(r.delta, cfg.dec)} ${cfg.unit}` + (r.days > 0 ? ` за ${r.days} дн.` : '');
        if (r.state === 'high') msg = `<span class="warn">${base} · в ${fmtN(r.ratio, 1)} раза выше обычного — проверьте цифру</span>`;
        else if (r.ratio && r.ratio < 0.4 && r.delta >= (MIN_ABS[cfg.group] || 0) / 2) msg = `<span class="warn">${base} · заметно ниже обычного</span>`;
        else msg = `<span class="ok">${base}${r.cost != null ? ` · ${fmtE(r.cost)}` : ''}</span>`;
      }
    }
    flag.innerHTML = msg;
    if (r.state !== 'empty') { n++; if (cfg.group === 'heating') heatFilled++; }
    if (r.cost) cost += r.cost;
    if (['high', 'drop', 'before'].includes(r.state)) flagged++;
  }
  // заполнили отопление — раскрываем и показываем счётчик
  const hc = $('heat-count');
  if (hc) hc.textContent = heatFilled ? `заполнено ${heatFilled}` : '';
  if (heatFilled && !E.heatOpen) { E.heatOpen = true; $('eg-heat').classList.remove('collapsed'); }

  const btn = $('entry-save');
  btn.textContent = n ? `Сохранить · ${n}` : 'Сохранить';
  btn.disabled = n === 0;
  $('entry-sum').innerHTML = n === 0
    ? '<span>Заполните счётчики, которые сняли</span><span></span>'
    : `<span>${n} ${plural(n, 'показание', 'показания', 'показаний')}${flagged ? ` · <span style="color:var(--warn)">${flagged} под вопросом</span>` : ''}</span><span>${cost > 0 ? `≈ <b>${fmtE(cost)}</b>` : ''}</span>`;
}

/* ── Сохранение ────────────────────────────────────────────────── */
async function saveEntry() {
  const date = E.date;
  if (!date) { toast('Укажите дату', 'err'); return; }
  const picked = [];
  for (const g of ENTRY_GROUPS()) for (const t of g.types) {
    const r = entryRowState(t);
    if (r.filled) picked.push({ ...r, check: entryCheck(t) });
  }
  if (!picked.length) return;

  // дата раньше последнего показания: расход посчитается неверно
  const early = picked.filter(p => p.check.state === 'before');
  if (early.length) {
    const ok = await askConfirm({
      title: 'Дата раньше последнего показания',
      message: early.map(p => `${typeName(p.type)}: последнее ${fmtDate(p.check.prev.date)}`).join('\n') + '\n\nСтатистика по этим счётчикам собьётся. Исправьте дату или сохраните как есть.',
      ok: 'Сохранить как есть', cancel: 'Исправить',
    });
    if (!ok) return;
  }

  // падение показания — почти всегда замена счётчика
  for (const p of picked.filter(p => p.check.state === 'drop')) {
    const ans = await showDialog({
      title: `${typeName(p.type)}: ${fmtN(p.val, TYPES[p.type].dec)} меньше предыдущего ${fmtN(p.prev.value, TYPES[p.type].dec)}`,
      message: 'Это замена счётчика? Период до замены не попадёт в расход.',
      actions: [
        { label: 'Да, замена счётчика', value: 'reset', strong: true },
        { label: 'Сохранить как есть', value: 'keep' },
        { label: 'Исправлю цифру', value: 'fix', cancel: true },
      ],
    });
    if (ans === 'fix' || ans == null) { p.el.focus(); return; }
    p.is_reset = ans === 'reset';
  }

  // подозрительно высокий расход
  const high = picked.filter(p => p.check.state === 'high');
  if (high.length) {
    const ok = await askConfirm({
      title: 'Расход заметно выше обычного',
      message: high.map(p => `${typeName(p.type)}: +${fmtN(p.check.delta, TYPES[p.type].dec)} за ${p.check.days} дн. (в ${fmtN(p.check.ratio, 1)} раза)`).join('\n'),
      ok: 'Сохранить', cancel: 'Проверю',
    });
    if (!ok) return;
  }

  // две записи за одну дату — расход между ними не посчитается
  const dup = picked.filter(p => readings.some(r => r.type === p.type && r.date === date));
  if (dup.length) {
    const ok = await askConfirm({
      title: `За ${dateLabel(date, true)} уже есть показания`,
      message: dup.map(p => typeName(p.type)).join(', ') + '\n\nДве записи за одну дату — расход между ними не посчитается.',
      ok: 'Всё равно сохранить', cancel: 'Отмена',
    });
    if (!ok) return;
  }

  const btn = $('entry-save');
  btn.disabled = true; btn.textContent = 'Сохраняю…';
  const before = safeBalance();
  const rows = picked.map(p => ({ date, type: p.type, value: p.val, is_reset: !!p.is_reset }));
  const { data, error } = await sb.from('readings').insert(rows).select();
  if (error) { toast('Ошибка: ' + error.message, 'err'); refreshEntry(); return; }
  readings.push(...data);
  E.lastIds = data.map(r => r.id);
  syncToSheets(picked.map(p => buildSheetsRow(p.type, date, p.val, p.prev)));
  buzz([12, 40, 12]);

  closeEntry();
  refreshAll();
  setTimeout(() => showEntryResult(picked, date, before, safeBalance()), 260);
}
function safeBalance() { try { const f = forecastElectricity(); return f.hasAdvances ? f.balance : null; } catch (e) { return null; } }

/* ── Итог после сохранения ─────────────────────────────────────── */
function showEntryResult(picked, date, before, after) {
  let total = 0, heatUnits = 0;
  const lines = [];
  for (const p of picked) {
    const c = p.check, cfg = TYPES[p.type];
    if (p.is_reset) { lines.push({ p, sub: 'замена счётчика', cost: null }); continue; }
    if (!(c.delta > 0)) { lines.push({ p, sub: c.state === 'first' ? 'первая запись' : 'без изменений', cost: null }); continue; }
    if (c.cost) total += c.cost;
    if (cfg.group === 'heating') heatUnits += c.delta * cfg.factor;
    let sub = `+${fmtN(c.delta, cfg.dec)} ${cfg.unit}` + (c.days ? ` за ${c.days} дн.` : '');
    if (c.ratio && cfg.group !== 'heating') {
      const pct = Math.round((c.ratio - 1) * 100);
      if (Math.abs(pct) >= 10) sub += ` · ${pct > 0 ? '+' : '−'}${Math.abs(pct)}% к обычному`;
    }
    lines.push({ p, sub, cost: c.cost });
  }
  let balLine = '';
  if (before != null && after != null && Math.abs(after - before) >= 0.5) {
    const d = after - before;
    balLine = `<div class="advice" style="margin-top:14px">${icon('spark')}<div>Итог года по электричеству: <b>${after >= 0 ? 'вернут' : 'доплата'} ≈ ${euro0(Math.abs(after))} €</b> (${d >= 0 ? '+' : '−'}${euro0(Math.abs(d))} € с прошлого раза).</div></div>`;
  }
  openSheet(`<div class="modal-title">Записано · ${dateLabel(date)}</div>
    <div class="list flat">${lines.map(l => `<div class="row">
      <span class="dot" style="background:${typeColor(l.p.type)}"></span>
      <div class="row-main"><div class="row-title" style="font-size:var(--fs-sub)">${typeName(l.p.type)}</div><div class="row-sub">${esc(l.sub)}</div></div>
      <div class="row-end"><b>${fmtN(l.p.val, TYPES[l.p.type].dec)} <small>${TYPES[l.p.type].unit}</small></b>${l.cost ? `<span>${fmtE(l.cost)}</span>` : ''}</div></div>`).join('')}</div>
    ${total > 0 ? `<div class="kv"><div><span>Стоимость расхода</span><b>${fmtE(total)}</b></div></div>` : ''}
    ${balLine}
    <div class="modal-actions"><button class="btn danger" onclick="undoEntry()" style="flex:none;padding:0 18px">Отменить запись</button>
      <button class="btn" onclick="closeSheet()">Готово</button></div>`);
}
async function undoEntry() {
  const ids = E.lastIds;
  if (!ids.length) { closeSheet(); return; }
  const { error } = await sb.from('readings').delete().in('id', ids);
  if (error) { toast('Не удалось отменить: ' + error.message, 'err'); return; }
  readings = readings.filter(r => !ids.includes(r.id));
  E.lastIds = [];
  closeSheet();
  refreshAll();
  toast('Запись отменена', 'ok');
}

/* ═══ Напоминание в календарь (.ics) ═══════════════════════════════ */
function openReminder() {
  const cad = readingCadence();
  const def = cad <= 9 ? 'w1' : cad <= 21 ? 'w2' : 'm1';
  const start = addDaysISO(localISO(), 1);
  openSheet(`<div class="modal-title">Напоминание</div>
    <div class="hint" style="margin:-6px 0 14px">Добавит повторяющееся событие в календарь телефона — оно сработает уведомлением от самого календаря.</div>
    <div class="lbl" style="margin-bottom:8px">Как часто</div>
    <div class="seg" id="rem-seg">
      <button data-v="w1" class="${def === 'w1' ? 'active' : ''}" onclick="remPick(this)">Каждую неделю</button>
      <button data-v="w2" class="${def === 'w2' ? 'active' : ''}" onclick="remPick(this)">Раз в 2 недели</button>
      <button data-v="m1" class="${def === 'm1' ? 'active' : ''}" onclick="remPick(this)">Раз в месяц</button>
    </div>
    <div class="fgrid" style="margin-top:14px">
      <div class="fg"><label for="rem-start">Первый раз</label><input type="date" id="rem-start" value="${start}"></div>
      <div class="fg"><label for="rem-time">Время</label><input type="time" id="rem-time" value="19:00"></div>
    </div>
    <div class="modal-actions"><button class="btn tonal" onclick="closeSheet()">Отмена</button>
      <button class="btn" onclick="downloadReminder()">Добавить в календарь</button></div>`);
}
function remPick(b) { qa('#rem-seg button').forEach(x => x.classList.toggle('active', x === b)); }
function downloadReminder() {
  const v = qa('#rem-seg button').find(b => b.classList.contains('active')).dataset.v;
  const d = ($('rem-start').value || localISO()).replace(/-/g, '');
  const [hh, mm] = ($('rem-time').value || '19:00').split(':');
  const end = `${hh}${String((+mm + 15) % 60).padStart(2, '0')}`;
  const rule = v === 'w1' ? 'FREQ=WEEKLY' : v === 'w2' ? 'FREQ=WEEKLY;INTERVAL=2' : 'FREQ=MONTHLY';
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kommunalka//RU', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', `UID:kommunalka-${Date.now()}@kommunalka`, `DTSTAMP:${stamp}`,
    `DTSTART:${d}T${hh}${mm}00`, `DTEND:${d}T${end}00`, `RRULE:${rule}`,
    'SUMMARY:Снять показания счётчиков', 'DESCRIPTION:Электричество\\, вода\\, отопление — внесите показания в приложение «Коммуналка»',
    'BEGIN:VALARM', 'TRIGGER:PT0S', 'ACTION:DISPLAY', 'DESCRIPTION:Снять показания счётчиков', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  saveBlob(new Blob([ics], { type: 'text/calendar;charset=utf-8' }), 'kommunalka-reminder.ics');
  closeSheet();
  toast('Откройте файл, чтобы добавить событие в календарь', 'ok');
}

/* ═══ Экспорт в CSV ════════════════════════════════════════════════ */
function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function exportCsv() {
  const num = (v, d) => v == null ? '' : String(+(+v).toFixed(d)).replace('.', ',');
  const lines = [['Дата', 'Счётчик', 'Комната', 'Показание', 'Расход', 'Дней', 'Стоимость €', 'Замена счётчика'].join(';')];
  const all = [];
  for (const t of Object.keys(TYPES)) all.push(...enrichReadings(t));
  all.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  for (const r of all) {
    const m = SHEETS_TYPE_MAP[r.type];
    lines.push([fmtDate(r.date), m.type, m.room, num(r.value, 3), num(r.delta, 3), r.days ?? '', num(r.cost, 2), r.is_reset ? 'да' : ''].join(';'));
  }
  saveBlob(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `kommunalka-pokazaniya-${localISO()}.csv`);
  toast(`Выгружено ${all.length} показаний`, 'ok');
}
