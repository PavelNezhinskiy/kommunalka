/* ═══════════════════════════════════════════════════════════════
   Прогнозы и наблюдения.
   Зависит от app.js: данные (readings, tariffs, advances, settlements),
   помесячные расчёты и тарифы.
   ═══════════════════════════════════════════════════════════════ */

/* ── Даты ──────────────────────────────────────────────────────── */
function addDaysISO(iso, n)  { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n);     return localISO(d); }
function addYearsISO(iso, n) { const d = new Date(iso + 'T00:00:00'); d.setFullYear(d.getFullYear() + n); return localISO(d); }
function addMonthsKey(key, n) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function daysInMonthKey(key) { const [y, m] = key.split('-').map(Number); return new Date(y, m, 0).getDate(); }
function isHeatingSeason(d = new Date()) { const m = d.getMonth() + 1; return m >= 10 || m <= 4; }

/* ── Кэш помесячных данных ─────────────────────────────────────────
   getAllMonthlyData дорогая (проход по дням между показаниями) и
   вызывается десятки раз за отрисовку. Сбрасывается в refreshAll(). */
let _allCache = null;
const _getAllMonthlyDataRaw = getAllMonthlyData;
getAllMonthlyData = function () { return _allCache || (_allCache = _getAllMonthlyDataRaw()); };
function dropDataCache() { _allCache = null; }

/* ── Категории ─────────────────────────────────────────────────── */
const ZERO = { cons: 0, cost: 0, days: 0 };
const CAT = {
  electricity: { tariff: 'electricity', get: (a, k) => a.elec[k] || ZERO },
  water: {
    tariff: 'water',
    get: (a, k) => ({
      cons: (a.bath[k]?.cons || 0) + (a.kitch[k]?.cons || 0),
      cost: (a.bath[k]?.cost || 0) + (a.kitch[k]?.cost || 0),
      days: Math.max(a.bath[k]?.days || 0, a.kitch[k]?.days || 0),
    }),
  },
  heating: { tariff: 'heating', get: (a, k) => a.heat[k] || ZERO },
};

function getCurrentAdvanceRate(type) {
  const today = localISO();
  const rel = advances.filter(a => a.type === type && a.effective_from <= today)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  return rel[0]?.monthly_amount || 0;
}

/* Месяцы периода с долей, попадающей в период (для неполных крайних) */
function periodMonths(from, to) {
  const out = [];
  const k0 = from.slice(0, 7), k1 = to.slice(0, 7);
  let cur = k0;
  while (cur <= k1) {
    const dim = daysInMonthKey(cur);
    const s = cur === k0 ? +from.slice(8, 10) : 1;
    const e = cur === k1 ? +to.slice(8, 10) : dim;
    out.push({ key: cur, w: Math.max(0, e - s + 1) / dim });
    cur = addMonthsKey(cur, 1);
  }
  return out;
}

/* ═══ Прогноз стоимости по категории за период ═════════════════════
   Факт по закрытым месяцам + остаток текущего + будущие месяцы «как в
   прошлом году × поправка на текущие темпы». Сезонность важна для
   отопления: линейная экстраполяция летом занижает, зимой завышает. */
function forecastCategory(cat, from, to, infl = inflationPct) {
  const all = getAllMonthlyData();
  const c = CAT[cat];
  const f = 1 + (infl || 0) / 100;
  const today = localISO();
  const curKey = today.slice(0, 7);
  const months = periodMonths(from, to);
  const get = k => c.get(all, k);
  const full = (k, v) => v.days >= daysInMonthKey(k) * 0.8;

  // поправка на темпы: уже прошедшие месяцы периода против тех же месяцев год назад
  let sa = 0, sb = 0, n = 0;
  for (const { key } of months) {
    if (key >= curKey) break;
    const cur = get(key), prev = get(addMonthsKey(key, -12));
    if (cur.cons > 0 && prev.cons > 0 && full(key, cur) && full(addMonthsKey(key, -12), prev)) {
      sa += cur.cons; sb += prev.cons; n++;
    }
  }
  const trendUsed = n >= 2 && sb > 0;
  const trend = trendUsed ? Math.min(1.5, Math.max(0.6, sa / sb)) : 1;

  // запасной вариант без прошлого года: средний суточный расход за полные месяцы того же сезона
  const dailyFallback = key => {
    const wantSeason = cat === 'heating' ? isHeatingSeason(new Date(key + '-15')) : null;
    let cons = 0, days = 0;
    for (const k of Object.keys(all.elec).concat(Object.keys(all.heat), Object.keys(all.bath))) {
      if (k >= curKey) continue;
      const v = get(k);
      if (!(v.cons >= 0) || !full(k, v)) continue;
      if (wantSeason !== null && isHeatingSeason(new Date(k + '-15')) !== wantSeason) continue;
      cons += v.cons; days += v.days;
    }
    return days > 0 ? cons / days : 0;
  };
  const _fbSeen = {};
  const seasonalDaily = key => {
    const ly = addMonthsKey(key, -12), v = get(ly);
    if (v.cons > 0 && full(ly, v)) return { perDay: v.cons * trend / daysInMonthKey(key), src: 'ly' };
    // без прошлого года: для отопления в «неотопительный» месяц — ноль
    const k2 = key + cat;
    if (!(k2 in _fbSeen)) _fbSeen[k2] = dailyFallback(key);
    return { perDay: _fbSeen[k2], src: 'avg' };
  };

  let spent = 0, proj = 0, factMonths = 0, estMonths = 0, lyMonths = 0;
  const rows = [];
  for (const { key, w } of months) {
    const dim = daysInMonthKey(key);
    const rate = getTariffAt(c.tariff, key + '-15')?.rate || getTariffAt(c.tariff, today)?.rate || 0;
    const fixed = monthFixed(c.tariff, key);
    const mine = get(key);
    let val, kind;

    if (key < curKey) {
      kind = 'fact';
      const gap = Math.max(0, dim - mine.days);                // дни без данных внутри прошедшего месяца
      const est = gap > 0 ? seasonalDaily(key).perDay * gap * rate * f : 0;
      val = mine.cost + fixed + est;
      spent += (mine.cost + fixed) * w;
      if (full(key, mine)) factMonths++;
    } else if (key === curKey) {
      kind = 'now';
      const gap = Math.max(0, dim - mine.days);                // от последнего показания до конца месяца
      const sd = seasonalDaily(key);
      val = mine.cost + sd.perDay * gap * rate * f + fixed * f;
      spent += (mine.cost + fixed * (+today.slice(8, 10) / dim)) * w;
      estMonths++; if (sd.src === 'ly') lyMonths++;
    } else {
      kind = 'est';
      const sd = seasonalDaily(key);
      val = sd.perDay * dim * rate * f + fixed * f;
      estMonths++; if (sd.src === 'ly') lyMonths++;
    }
    proj += val * w;
    rows.push({ key, kind, value: val, w });
  }

  const lyShare = estMonths ? lyMonths / estMonths : 1;
  const confidence = factMonths >= 6 && lyShare >= 0.6 ? 'high' : factMonths >= 3 ? 'mid' : 'low';
  return { cat, from, to, spent, proj, trend: trendUsed ? trend : null, factMonths, estMonths, lyShare, confidence, months: rows };
}

/* ── Электричество: период расчёта и баланс ────────────────────── */
function elecPeriod() {
  const from = getElecPeriodFrom();
  return { from, to: addDaysISO(addYearsISO(from, 1), -1) };
}

function forecastElectricity() {
  const { from, to } = elecPeriod();
  const today = localISO();
  const f = forecastCategory('electricity', from, to);
  const upTo = today < to ? today : to;
  const rate = getCurrentAdvanceRate('electricity');
  const paidToDate = calcAdvancesPaid('electricity', from, upTo);
  const paidFull = calcAdvancesPaid('electricity', from, to);
  const ended = today > to;
  return {
    ...f, rate, paidToDate, paidFull, ended,
    hasAdvances: paidFull > 0,
    balance: paidFull - f.proj,
    fair: Math.ceil(f.proj / 12),
  };
}

/* ── Коммуналка (NK): календарный год ──────────────────────────── */
function forecastNK(year) {
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const today = localISO();
  const doc = getSettlementForYear('kommunalka', year);
  const paidFull = calcAdvancesPaid('kommunalka', from, to);
  const upTo = today < to ? today : to;
  const paidToDate = year > new Date().getFullYear() ? 0 : calcAdvancesPaid('kommunalka', from, upTo);
  const rate = getCurrentAdvanceRate('kommunalka');

  if (doc) {
    const total = (doc.actual_total || 0) + (doc.grundsteuer || 0);
    return {
      kind: 'doc', year, from, to, doc, rate, paidFull, paidToDate, hasAdvances: paidFull > 0,
      total, water: doc.water_portion || 0, heat: doc.heating_portion || 0,
      other: (doc.other_portion || 0) + (doc.grundsteuer || 0),
      balance: paidFull - total, correction: doc.correction || 0,
    };
  }

  const prop = getLastSettlement('kommunalka');
  const fw = forecastCategory('water', from, to);
  const fh = forecastCategory('heating', from, to);
  const f = 1 + inflationPct / 100;
  const other = prop ? ((prop.other_portion || 0) + (prop.grundsteuer || 0)) * f : null;
  const total = fw.proj + fh.proj + (other || 0);
  const conf = [fw.confidence, fh.confidence];
  return {
    kind: 'forecast', year, from, to, rate, paidFull, paidToDate, hasAdvances: paidFull > 0,
    waterF: fw, heatF: fh, other, propYear: prop?.period_year || null,
    water: fw.proj, heat: fh.proj, total,
    balance: paidFull - total, fair: Math.ceil(total / 12),
    confidence: conf.includes('low') ? 'low' : conf.includes('mid') ? 'mid' : 'high',
    past: year < new Date().getFullYear(),
  };
}

/* ── Ритм снятия показаний ─────────────────────────────────────── */
function readingCadence() {
  const dates = [...new Set(readings.filter(r => r.type === 'electricity').map(r => r.date))].sort();
  const gaps = [];
  for (let i = 1; i < dates.length; i++) gaps.push(daysBetween(dates[i - 1], dates[i]));
  const recent = gaps.slice(-8).filter(g => g > 0);
  if (recent.length < 3) return 14;
  recent.sort((a, b) => a - b);
  return Math.min(45, Math.max(5, Math.round(recent[Math.floor(recent.length / 2)])));
}

function readingStatus() {
  if (!readings.length) return null;
  const today = localISO();
  const cadence = readingCadence();
  const last = readings.reduce((m, r) => (r.date > m ? r.date : m), '');
  const due = addDaysISO(last, cadence);
  const dueIn = Math.round(daysBetween(today, due));
  const season = isHeatingSeason(new Date());
  const stale = [];
  for (const t of Object.keys(TYPES)) {
    const s = getTypeReadings(t);
    if (!s.length) continue;
    const d = Math.round(daysBetween(s[s.length - 1].date, today));
    const lim = TYPES[t].group === 'heating' ? (season ? Math.max(cadence * 2, 30) : Infinity) : Math.max(cadence * 1.6, 10);
    if (d >= lim) stale.push({ type: t, days: d });
  }
  return {
    cadence, last, due, dueIn, stale,
    ago: Math.round(daysBetween(last, today)),
    state: dueIn < 0 ? 'late' : dueIn <= 2 ? 'soon' : 'ok',
  };
}

/* ── Наблюдения: что изменилось ────────────────────────────────── */
function buildInsights() {
  const out = [];
  const all = getAllMonthlyData();
  const curKey = localISO().slice(0, 7);
  const prevKey = addMonthsKey(curKey, -1);
  const lyKey = addMonthsKey(prevKey, -12);
  const [, pm] = prevKey.split('-').map(Number);
  const inMonth = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'][pm - 1];

  for (const r of [
    { cat: 'electricity', name: 'Электричество', unit: 'кВт·ч', dec: 0, color: 'var(--elec)' },
    { cat: 'water',       name: 'Вода',          unit: 'м³',    dec: 1, color: 'var(--bath)' },
    { cat: 'heating',     name: 'Отопление',     unit: 'взв. ед.', dec: 0, color: 'var(--heat)' },
  ]) {
    const a = CAT[r.cat].get(all, prevKey), b = CAT[r.cat].get(all, lyKey);
    if (a.cons > 0 && b.cons > 0 && a.days >= daysInMonthKey(prevKey) * .8 && b.days >= daysInMonthKey(lyKey) * .8) {
      const pct = (a.cons - b.cons) / b.cons * 100;
      if (Math.abs(pct) >= 8) out.push({
        w: Math.abs(pct), tone: pct > 0 ? 'bad' : 'good', color: r.color,
        title: `${r.name}: ${pct > 0 ? '+' : '−'}${Math.abs(Math.round(pct))}% к прошлому году`,
        text: `В ${inMonth} ${fmtN(a.cons, r.dec)} ${r.unit} против ${fmtN(b.cons, r.dec)} год назад`,
      });
    }
  }

  // какая комната съедает больше всего отопления за год
  const since = addMonthsKey(curKey, -12);
  const rooms = HEATING_TYPES.map(t => {
    const m = getMonthlyType(t, 0);
    let units = 0;
    for (const [k, v] of Object.entries(m)) if (k >= since) units += v.cons * TYPES[t].factor;
    return { t, units };
  });
  const sum = rooms.reduce((a, r) => a + r.units, 0);
  if (sum > 0) {
    rooms.sort((a, b) => b.units - a.units);
    const top = rooms[0], share = top.units / sum * 100;
    if (share >= 30) out.push({
      w: share / 3, tone: 'neutral', color: ROOM_COLORS[top.t],
      title: `${TYPES[top.t].room} — ${Math.round(share)}% отопления`,
      text: `За 12 месяцев; коэффициент комнаты ×${TYPES[top.t].factor}`,
    });
  }

  // текущий темп электричества против обычного
  const se = getTypeReadings('electricity');
  if (se.length >= 3) {
    const a = se[se.length - 2], b = se[se.length - 1];
    const days = daysBetween(a.date, b.date);
    const avg = calcAvgDailyRate('electricity');
    if (!b.is_reset && b.value > a.value && days >= 3 && avg > 0) {
      const perDay = (b.value - a.value) / days;
      const pct = (perDay / avg - 1) * 100;
      if (Math.abs(pct) >= 20) out.push({
        w: Math.abs(pct) * .8, tone: pct > 0 ? 'bad' : 'good', color: 'var(--elec)',
        title: `Свет: ${fmtN(perDay, 1)} кВт·ч в день`,
        text: `За последние ${Math.round(days)} дн. — на ${Math.abs(Math.round(pct))}% ${pct > 0 ? 'выше' : 'ниже'} обычного`,
      });
    }
  }
  return out.sort((x, y) => y.w - x.w).slice(0, 3);
}
