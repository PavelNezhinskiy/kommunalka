const SUPABASE_URL = 'https://acsulelspgoauttyrhdd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_vfuvG6DNkM0qDRcKmeA1Uw_viuiyKZK';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── TYPE CONFIG ───────────────────────────────────────────────
const TYPES = {
  electricity:      {label:'Электричество',  unit:'кВт·ч', tariff:'electricity', factor:1,     tag:'tag-elec',    group:'electricity', dec:0},
  water_bathroom:   {label:'Вода (ванная)',   unit:'м³',    tariff:'water',       factor:1,     tag:'tag-bath',    group:'water',       dec:3},
  water_kitchen:    {label:'Вода (кухня)',    unit:'м³',    tariff:'water',       factor:1,     tag:'tag-kitchen', group:'water',       dec:3},
  heating_bathroom: {label:'Отопл. Ванная',          unit:'ед',    tariff:'heating',     factor:0.942, tag:'tag-heat',    group:'heating',     dec:0, room:'Ванная'},
  heating_kitchen:  {label:'Отопл. Кухня',           unit:'ед',    tariff:'heating',     factor:1.314, tag:'tag-heat',    group:'heating',     dec:0, room:'Кухня'},
  heating_bedroom:  {label:'Отопл. Спальная',        unit:'ед',    tariff:'heating',     factor:2.052, tag:'tag-heat',    group:'heating',     dec:0, room:'Спальная'},
  heating_kids:     {label:'Отопл. Детская',         unit:'ед',    tariff:'heating',     factor:1.314, tag:'tag-heat',    group:'heating',     dec:0, room:'Детская'},
  heating_living:   {label:'Отопл. Зал',             unit:'ед',    tariff:'heating',     factor:3.502, tag:'tag-heat',    group:'heating',     dec:0, room:'Зал'},
};
const HEATING_TYPES = ['heating_bathroom','heating_kitchen','heating_bedroom','heating_kids','heating_living'];
const HEAT_IDS     = ['h-bath','h-kitchen','h-bedroom','h-kids','h-living'];
const ROOM_COLORS  = {
  heating_bathroom:'#60a5fa', heating_kitchen:'#34d399', heating_bedroom:'#a78bfa',
  heating_kids:'var(--warn)',     heating_living:'#f87171',
};
const TARIFF_UNITS = {electricity:'кВт·ч', water:'м³', heating:'взв.ед'};

// ─── STATE ────────────────────────────────────────────────────
let readings = [], tariffs = [], advances = [], settlements = [];
let editingTariffId = null, editingReadingId = null;
let analyticsPeriod = 6, charts = {};

// ─── SUPABASE ─────────────────────────────────────────────────
async function loadAll() {
  const [r,t,s,adv,sett] = await Promise.all([
    sb.from('readings').select('*').order('date',{ascending:true}).order('id',{ascending:true}),
    sb.from('tariffs').select('*').order('effective_from',{ascending:true}),
    sb.from('settings').select('*'),
    sb.from('advances').select('*').order('effective_from',{ascending:true}),
    sb.from('settlements').select('*').order('period_year',{ascending:true}),
  ]);
  // ошибку нельзя глотать: при протухшей сессии RLS вернёт отказ,
  // и приложение выглядело бы просто пустым вместо просьбы войти
  const failed = [r,t,s,adv,sett].find(x => x.error);
  if (failed) { const e = new Error(failed.error.message); e.code = failed.error.code; throw e; }

  readings    = r.data    || [];
  tariffs     = t.data    || [];
  advances    = adv.data  || [];
  settlements = sett.data || [];
  for (const row of (s.data || [])) localStorage.setItem(row.key, row.value);
}

function isAuthError(e) {
  const m = (e && e.message || '').toLowerCase();
  return m.includes('jwt') || m.includes('token') || m.includes('unauthorized')
      || m.includes('permission denied') || e?.code === 'PGRST301' || e?.code === '42501';
}

// ─── АВТОРИЗАЦИЯ ──────────────────────────────────────────────
// Доступ к базе только для вошедшего пользователя (RLS: authenticated).
async function boot() {
  let session = null;
  try {
    const { data } = await sb.auth.getSession();
    session = data.session;
  } catch(e) { /* нет сети — покажем экран входа */ }
  if (!session) { showAuth(); return; }
  await init();
}

function showAuth(message) {
  document.getElementById('loader').style.display = 'none';
  document.body.classList.remove('ready');
  document.getElementById('auth-screen').classList.add('show');
  const err = document.getElementById('auth-error');
  if (err) err.textContent = message || '';
  const email = document.getElementById('auth-email');
  if (email && !email.value) setTimeout(()=>email.focus(), 250);
}

async function signIn() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-pass').value;
  const btn = document.getElementById('auth-btn');
  const err = document.getElementById('auth-error');
  err.textContent = '';
  if (!email || !password) { err.textContent = 'Введите email и пароль'; return; }

  btn.disabled = true; btn.textContent = 'Вхожу…';
  const { error } = await sb.auth.signInWithPassword({ email, password });
  btn.disabled = false; btn.textContent = 'Войти';

  if (error) {
    err.textContent = /invalid login/i.test(error.message)
      ? 'Неверный email или пароль'
      : 'Ошибка входа: ' + error.message;
    return;
  }
  document.getElementById('auth-pass').value = '';
  document.getElementById('auth-screen').classList.remove('show');
  document.getElementById('loader').style.display = 'flex';
  await init();
}

// Задать или сменить пароль. Нужно тем, кто вошёл по ссылке-приглашению:
// у такой учётки пароля нет, и после истечения сессии войти будет нечем.
async function setPassword() {
  const el   = document.getElementById('s-newpass');
  const hint = document.getElementById('s-pass-hint');
  const btn  = document.getElementById('setpass-btn');
  const pass = el.value;

  if (pass.length < 8) {
    hint.innerHTML = '<span style="color:var(--danger)">Пароль должен быть не короче 8 символов</span>';
    return;
  }
  btn.disabled = true; btn.textContent = 'Сохраняю…';
  const { error } = await sb.auth.updateUser({ password: pass });
  btn.disabled = false; btn.textContent = 'Сохранить';

  if (error) {
    hint.innerHTML = `<span style="color:var(--danger)">${error.message}</span>`;
    return;
  }
  el.value = '';
  hint.innerHTML = '<span style="color:var(--success)">Пароль сохранён — теперь можно входить по email и паролю</span>';
  toast('Пароль сохранён', 'ok');
}

async function signOut() {
  if (!await askConfirm({title:'Выйти из приложения?', ok:'Выйти', danger:true})) return;
  await sb.auth.signOut();
  location.reload();
}

// Сессия протухла или выход из другой вкладки
sb.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') {
    const open = document.getElementById('auth-screen').classList.contains('show');
    if (!open) location.reload();
  }
});

async function init() {
  try {
    await loadAll();
    document.getElementById('loader').style.display = 'none';
    document.body.classList.add('ready');
    const p = new URLSearchParams(location.search).get('p');
    startApp(p);
    autoBackup();   // раз в неделю, молча, не блокирует загрузку
  } catch(e) {
    if (isAuthError(e)) {           // сессия истекла или доступ закрыт
      await sb.auth.signOut().catch(()=>{});
      showAuth('Сессия истекла — войдите заново');
      return;
    }
    document.getElementById('loader').style.display = 'flex';
    document.getElementById('loader').innerHTML =
      `<div style="color:var(--heat);font-size:14px;text-align:center;padding:24px;max-width:300px">
        Нет связи с базой.<br>${e.message}<br><br>
        <small style="color:var(--muted)">Проверьте интернет и повторите</small><br><br>
        <button class="btn btn-secondary btn-sm" onclick="location.reload()">Повторить</button>
      </div>`;
  }
}

// ─── PWA ──────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(()=>{});
  });
}
window.addEventListener('online',  ()=>toast('Связь восстановлена','ok'));
window.addEventListener('offline', ()=>toast('Нет сети — данные не сохранятся','err'));

// ─── SEED DATA ────────────────────────────────────────────────
const SEED_TARIFFS = [
  {effective_from:'2022-01-01',type:'electricity',fixed_cost:82.56, rate:0.424},
  {effective_from:'2022-12-01',type:'electricity',fixed_cost:154.83,rate:0.43},
  {effective_from:'2023-04-18',type:'electricity',fixed_cost:82.56, rate:0.34},
  {effective_from:'2025-01-01',type:'electricity',fixed_cost:92.52, rate:0.3228},
  {effective_from:'2022-01-01',type:'water',      fixed_cost:126.85,rate:18.05},
  {effective_from:'2024-01-01',type:'water',      fixed_cost:98.63, rate:11.35},
  {effective_from:'2022-01-01',type:'heating',    fixed_cost:165.67,rate:0.1232},
  {effective_from:'2024-01-01',type:'heating',    fixed_cost:192.66,rate:0.12},
];

function buildSeedReadings() {
  const R = [];
  const e  = (d,v)       => R.push({date:d,type:'electricity',    value:v,is_reset:false});
  const wb = (d,v,r=false)=> R.push({date:d,type:'water_bathroom', value:v,is_reset:r});
  const wk = (d,v,r=false)=> R.push({date:d,type:'water_kitchen',  value:v,is_reset:r});
  const h  = (d,b,k,r,ch,l)=>{
    R.push({date:d,type:'heating_bathroom',value:b, is_reset:false});
    R.push({date:d,type:'heating_kitchen', value:k, is_reset:false});
    R.push({date:d,type:'heating_bedroom', value:r, is_reset:false});
    R.push({date:d,type:'heating_kids',    value:ch,is_reset:false});
    R.push({date:d,type:'heating_living',  value:l, is_reset:false});
  };

  // ── Электричество ─────────────────────────────────────────
  e('2022-12-01',7701);  e('2023-11-27',8675);  e('2023-12-09',8708);  e('2023-12-31',8804);
  e('2024-04-16',9147);  e('2024-11-24',9833);  e('2024-11-30',9863);  e('2024-12-07',9918);
  e('2024-12-14',9974);  e('2024-12-21',10043); e('2024-12-28',10084); e('2025-01-05',10162);
  e('2025-01-11',10219); e('2025-01-18',10270); e('2025-01-25',10323); e('2025-02-01',10372);
  e('2025-02-08',10421); e('2025-02-16',10480); e('2025-02-22',10516); e('2025-03-01',10551);
  e('2025-03-10',10606); e('2025-03-15',10636); e('2025-03-22',10674); e('2025-03-29',10709);
  e('2025-04-05',10743); e('2025-04-14',10789); e('2025-04-16',10790); e('2025-04-24',10811);
  e('2025-05-03',10845); e('2025-05-10',10874); e('2025-05-18',10906); e('2025-06-11',11017);
  e('2025-07-20',11145); e('2025-08-03',11183); e('2025-09-14',11310); e('2025-10-04',11390);
  e('2025-11-01',11527); e('2025-11-16',11633); e('2025-11-23',11666); e('2025-11-30',11760);
  e('2025-12-07',11774); e('2025-12-19',11860); e('2025-12-30',11949); e('2026-01-03',11965);
  e('2026-01-10',12029); e('2026-01-18',12088); e('2026-01-25',12151); e('2026-02-01',12212);
  e('2026-02-07',12264); e('2026-02-14',12306); e('2026-02-21',12367); e('2026-02-28',12407);
  e('2026-03-08',12442); e('2026-03-15',12480); e('2026-03-22',12520); e('2026-04-04',12580);
  e('2026-04-12',12636);

  // ── Вода ванная ───────────────────────────────────────────
  wb('2022-12-01',3);    wb('2023-11-27',24);   wb('2023-12-09',25);   wb('2023-12-31',28.5);
  wb('2024-11-24',18,true); // замена счётчика
  wb('2024-11-30',18.25);wb('2024-12-07',18.67);wb('2024-12-14',19.19);wb('2024-12-21',19.86);
  wb('2024-12-28',20.19);wb('2025-01-05',21.01);wb('2025-01-11',21.44);wb('2025-01-18',21.89);
  wb('2025-01-25',22.72);wb('2025-02-01',23.29);wb('2025-02-08',23.81);wb('2025-02-16',24.55);
  wb('2025-02-22',25.12);wb('2025-03-01',25.6); wb('2025-03-10',26.8); wb('2025-03-15',27.19);
  wb('2025-03-22',28.03);wb('2025-03-29',28.82);wb('2025-04-05',29.48);wb('2025-04-16',30.47);
  wb('2025-04-24',31.4); wb('2025-05-03',32.35);wb('2025-05-10',32.98);wb('2025-05-18',33.67);
  wb('2025-06-11',35.52);wb('2025-07-20',38.48);wb('2025-08-03',39.46);wb('2025-09-14',42.68);
  wb('2025-10-04',44.7); wb('2025-11-01',47.24);wb('2025-11-16',48.4); wb('2025-11-23',49.1);
  wb('2025-11-30',49.6); wb('2025-12-07',50.57);wb('2025-12-19',51.75);wb('2025-12-30',52.84);
  wb('2026-01-03',52.95);wb('2026-01-10',53.69);wb('2026-01-18',54.61);wb('2026-01-25',55.3);
  wb('2026-02-01',56);   wb('2026-02-07',56.58);wb('2026-02-14',57.24);wb('2026-02-21',57.89);
  wb('2026-02-28',58.6); wb('2026-03-08',59);   wb('2026-03-15',59.64);wb('2026-03-22',60.28);
  wb('2026-04-04',61.64);wb('2026-04-12',62.2);

  // ── Вода кухня (с заменой счётчика 10.01.2026) ───────────
  wk('2022-12-01',1);    wk('2023-11-27',7);    wk('2023-12-09',7);    wk('2023-12-31',9);
  wk('2024-11-24',17);   wk('2024-11-30',17);   wk('2024-12-07',17.25);wk('2024-12-14',17.49);
  wk('2024-12-21',17.71);wk('2024-12-28',17.85);wk('2025-01-05',18.2); wk('2025-01-11',18.47);
  wk('2025-01-18',18.69);wk('2025-01-25',18.95);wk('2025-02-01',19.18);wk('2025-02-08',19.4);
  wk('2025-02-16',19.66);wk('2025-02-22',19.91);wk('2025-03-01',20.13);wk('2025-03-10',20.51);
  wk('2025-03-15',20.74);wk('2025-03-22',21);   wk('2025-03-29',21.27);wk('2025-04-05',21.64);
  wk('2025-04-16',22);   wk('2025-04-24',22.16);wk('2025-05-03',22.5); wk('2025-05-10',22.65);
  wk('2025-05-18',22.93);wk('2025-06-11',23.82);wk('2025-07-20',24.79);wk('2025-08-03',25.11);
  wk('2025-09-14',26.25);wk('2025-10-04',26.74);wk('2025-11-01',27.71);wk('2025-11-16',28.17);
  wk('2025-11-23',28.42);wk('2025-11-30',28.57);wk('2025-12-07',28.92);wk('2025-12-19',29.29);
  wk('2025-12-30',29.94);wk('2026-01-03',30);
  wk('2026-01-10',0.39,true); // замена счётчика
  wk('2026-01-18',0.788);wk('2026-01-25',1.3);  wk('2026-02-01',1.46); wk('2026-02-07',1.79);
  wk('2026-02-14',2.16); wk('2026-02-21',2.44); wk('2026-02-28',2.83); wk('2026-03-08',3.108);
  wk('2026-03-15',3.42); wk('2026-03-22',3.69); wk('2026-04-04',4.4);  wk('2026-04-12',4.65);

  // ── Отопление (bath, kitchen, bedroom, kids, living) ──────
  //           date         bath  kitch  bedrm  kids  living
  h('2024-11-01',             0,    0,    0,    0,    0);
  h('2024-11-24',             0,    3,   18,   23,   47);
  h('2024-11-30',             0,    3,   18,   25,   55);
  h('2024-12-07',             4,   12,   22,   30,   74);
  h('2024-12-14',            14,   16,   33,   54,   81);
  h('2024-12-21',            15,   18,   37,   61,   94);
  h('2024-12-28',            28,   19,   41,   83,  105);
  h('2024-12-31',            32,   19,   48,   93,  120);
  h('2025-01-05',            36,   23,   48,   94,  137);
  h('2025-01-11',            37,   23,   58,   95,  139);
  h('2025-01-18',            43,   26,   76,  108,  171);
  h('2025-01-25',            46,   26,   86,  129,  203);
  h('2025-02-01',            47,   26,   89,  129,  205);
  h('2025-02-08',            53,   30,  122,  129,  232);
  h('2025-02-16',            57,   51,  130,  129,  269);
  h('2025-02-22',            63,   81,  152,  129,  324);
  h('2025-03-01',            67,   92,  162,  129,  332);
  h('2025-03-10',            77,  111,  172,  129,  360);
  h('2025-03-15',            80,  112,  173,  129,  365);
  h('2025-03-22',            88,  113,  185,  129,  382);
  h('2025-03-29',            88,  113,  188,  129,  382);
  h('2025-10-26',            88,  113,  188,  129,  382);
  h('2025-11-01',            88,  113,  189,  129,  382);
  h('2025-11-16',            88,  114,  199,  129,  485);
  h('2025-11-23',            94,  126,  216,  135,  519);
  h('2025-11-30',           116,  130,  247,  154,  539);
  h('2025-12-07',           133,  133,  256,  172,  540);
  h('2025-12-19',           155,  133,  260,  175,  543);
  h('2025-12-31',           173,  164,  289,  207,  564);
  h('2026-01-03',           175,  177,  298,  219,  574);
  h('2026-01-10',           179,  204,  315,  245,  617);
  h('2026-01-18',           186,  240,  326,  261,  635);
  h('2026-01-25',           186,  254,  339,  261,  667);
  h('2026-02-01',           186,  263,  343,  261,  687);
  h('2026-02-07',           186,  264,  350,  261,  724);
  h('2026-02-14',           186,  264,  351,  261,  758);
  h('2026-02-21',           186,  268,  357,  261,  776);
  h('2026-02-28',           187,  268,  361,  261,  778);
  h('2026-03-08',           188,  268,  361,  261,  783);
  h('2026-03-15',           192,  268,  361,  261,  783);
  h('2026-03-22',           194,  269,  364,  261,  790);
  h('2026-04-04',           208,  275,  369,  261,  790);

  return R;
}

async function importHistoricalData() {
  const btn = document.getElementById('import-btn');
  btn.disabled = true; btn.textContent = 'Загружаю…';
  try {
    const CHUNK = 50;
    const allR = buildSeedReadings();
    for (let i = 0; i < allR.length; i += CHUNK) {
      const {error} = await sb.from('readings').insert(allR.slice(i, i+CHUNK));
      if (error) throw error;
      btn.textContent = `Загружаю… ${Math.min(i+CHUNK, allR.length)}/${allR.length}`;
    }
    const {error:te} = await sb.from('tariffs').insert(SEED_TARIFFS);
    if (te) throw te;
    await loadAll();
    refreshAll();
    toast(`Загружено ${allR.length} показаний + ${SEED_TARIFFS.length} тарифов`,'ok');
  } catch(e) {
    toast('Ошибка импорта: '+e.message,'err');
    btn.disabled = false; btn.textContent = 'Загрузить данные';
  }
}

// ─── HELPERS ──────────────────────────────────────────────────
function localISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function daysBetween(d1,d2){ return (new Date(d2)-new Date(d1))/86400000; }
function fmtDate(d){ const[y,m,dd]=d.split('-'); return `${dd}.${m}.${y}`; }
function fmtN(n,dec=0){ return n==null?'—':n.toLocaleString('ru-RU',{minimumFractionDigits:dec,maximumFractionDigits:dec}); }
function fmtE(c){ return c==null?'—':c.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' €'; }
function fmtMKey(k){ const[y,m]=k.split('-');const n=['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];return`${n[+m-1]} ${y.slice(2)}`; }
function typeTag(type){ const c=TYPES[type];return`<span class="tag ${c.tag}">${c.label}</span>`; }

// ─── TARIFF LOOKUP ────────────────────────────────────────────
function getTariffAt(tariffType, date) {
  return tariffs
    .filter(t => t.type===tariffType && t.effective_from<=date)
    .sort((a,b) => b.effective_from.localeCompare(a.effective_from))[0] || null;
}

// ─── COST CALCULATION ─────────────────────────────────────────
// Variable cost: delta × factor × rate, prorated across tariff changes
function calcVarCost(type, date1, date2, rawDelta) {
  if (rawDelta <= 0) return 0;
  const tariffType = TYPES[type].tariff;
  const factor = TYPES[type].factor;
  const amount = rawDelta * factor;
  const changes = tariffs
    .filter(t => t.type===tariffType && t.effective_from>date1 && t.effective_from<=date2)
    .sort((a,b) => a.effective_from.localeCompare(b.effective_from));
  const st = getTariffAt(tariffType, date1);
  if (!st) return null;
  const total = daysBetween(date1, date2);
  if (total <= 0) return 0;
  let cost=0, seg=date1, rate=st.rate;
  for(const tc of changes){
    cost += (daysBetween(seg,tc.effective_from)/total)*amount*rate;
    seg=tc.effective_from; rate=tc.rate;
  }
  cost += (daysBetween(seg,date2)/total)*amount*rate;
  return +cost.toFixed(4);
}

// Fixed cost prorated for a period (annual basis)
function calcFixedProrated(tariffType, date1, date2) {
  const changes = tariffs
    .filter(t => t.type===tariffType && t.effective_from>date1 && t.effective_from<=date2)
    .sort((a,b) => a.effective_from.localeCompare(b.effective_from));
  const st = getTariffAt(tariffType, date1);
  if (!st || !st.fixed_cost) return 0;
  let cost=0, seg=date1, fc=st.fixed_cost;
  for(const tc of changes){
    cost += (daysBetween(seg,tc.effective_from)/365)*fc;
    seg=tc.effective_from; fc=(tc.fixed_cost||0);
  }
  cost += (daysBetween(seg,date2)/365)*fc;
  return +cost.toFixed(4);
}

// ─── PER-TYPE READINGS ────────────────────────────────────────
function getTypeReadings(type) {
  return readings.filter(r=>r.type===type).sort((a,b)=>a.date.localeCompare(b.date)||a.id-b.id);
}

function enrichReadings(type) {
  const sorted = getTypeReadings(type);
  return sorted.map((r,i)=>{
    const prev = i>0 ? sorted[i-1] : null;
    let delta=null, cost=null, days=null;
    if(prev){
      days = Math.round(daysBetween(prev.date,r.date));
      if(!r.is_reset && r.value>=prev.value){
        delta = +(r.value-prev.value).toFixed(3);
        cost = calcVarCost(type, prev.date, r.date, delta);
      }
    }
    return {...r, delta, cost, days};
  }).reverse();
}

// ─── MONTHLY DATA ─────────────────────────────────────────────
function getMonthlyType(type, monthsBack) {
  const sorted = getTypeReadings(type);
  if(sorted.length<2) return {};
  const now = new Date();
  const months = {};
  for(let i=1;i<sorted.length;i++){
    const prev=sorted[i-1], curr=sorted[i];
    if(curr.is_reset || curr.value<prev.value) continue;
    const delta = curr.value-prev.value;
    const d1=new Date(prev.date), d2=new Date(curr.date);
    const totalDays = (d2-d1)/86400000;
    if(totalDays<=0) continue;
    let day=new Date(d1);
    while(day<d2){
      const next=new Date(day); next.setDate(next.getDate()+1);
      if(next>d2) break;
      const frac = 1/totalDays;
      const key = `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}`;
      if(!months[key]) months[key]={cons:0, cost:0, days:0};
      months[key].cons += delta*frac;
      months[key].days += 1;
      const ds = day.toISOString().split('T')[0];
      const t = getTariffAt(TYPES[type].tariff, ds);
      if(t) months[key].cost += delta*frac*TYPES[type].factor*t.rate;
      day=next;
    }
  }
  return months;
}

function getMonthlyHeating(monthsBack) {
  // Merge all 5 heating room types, applying factors
  const combined = {};
  for(const type of HEATING_TYPES){
    const m = getMonthlyType(type, monthsBack);
    for(const [key,v] of Object.entries(m)){
      if(!combined[key]) combined[key]={cons:0,cost:0,days:0};
      combined[key].cons += v.cons * TYPES[type].factor; // weighted units
      combined[key].cost += v.cost;
      if((v.days||0) > combined[key].days) combined[key].days = v.days||0;
    }
  }
  return combined;
}

function filterMonths(monthsObj, monthsBack) {
  let keys = Object.keys(monthsObj).sort();
  if(monthsBack>0){
    const now=new Date();
    const cutoff=new Date(now.getFullYear(), now.getMonth()-monthsBack, 1);
    const ck=`${cutoff.getFullYear()}-${String(cutoff.getMonth()+1).padStart(2,'0')}`;
    keys=keys.filter(k=>k>=ck);
  }
  return keys;
}

// Границы месяца для пропорции фиксированной платы.
// Конец — первое число СЛЕДУЮЩЕГО месяца: daysBetween считает разность дат,
// поэтому с последним числом месяца терялся один день (в октябре 30 вместо 31).
function monthBounds(y, m) {          // m — 1..12
  const start = `${y}-${String(m).padStart(2,'0')}-01`;
  const ny = m === 12 ? y+1 : y;
  const nm = m === 12 ? 1 : m+1;
  const end = `${ny}-${String(nm).padStart(2,'0')}-01`;
  return { start, end, days: new Date(y, m, 0).getDate() };
}

function addFixedToMonthly(monthsObj, tariffType) {
  // Add prorated fixed cost to each month in the object
  for(const key of Object.keys(monthsObj)){
    const [y,m] = key.split('-').map(Number);
    const { start, end } = monthBounds(y, m);
    monthsObj[key].fixed = calcFixedProrated(tariffType, start, end);
    monthsObj[key].total = (monthsObj[key].cost||0) + monthsObj[key].fixed;
  }
  return monthsObj;
}

function openEditReading(id) {
  const r = readings.find(x=>x.id===id);
  if(!r) return;
  editingReadingId = id;
  document.getElementById('e-date').value = r.date;
  document.getElementById('e-type').value = r.type;
  document.getElementById('e-value').value = r.value;
  document.getElementById('e-reset').checked = r.is_reset||false;
  document.getElementById('reading-modal').classList.add('open');
}

async function saveEditReading() {
  const date=document.getElementById('e-date').value;
  const type=document.getElementById('e-type').value;
  const value=parseFloat(document.getElementById('e-value').value);
  const is_reset=document.getElementById('e-reset').checked;
  if(!date||isNaN(value)){ toast('Заполните все поля','err'); return; }
  const btn=document.getElementById('save-reading-btn');
  btn.disabled=true;
  const {data,error}=await sb.from('readings').update({date,type,value,is_reset}).eq('id',editingReadingId).select().single();
  btn.disabled=false;
  if(error){ toast('Ошибка: '+error.message,'err'); return; }
  const idx=readings.findIndex(r=>r.id===editingReadingId);
  if(idx>=0) readings[idx]=data;
  closeReadingModal();
  refreshAll();
}

function closeReadingModal(){ document.getElementById('reading-modal').classList.remove('open'); editingReadingId=null; }

function openTariffModal(id) {
  editingTariffId = id||null;
  if(id){
    const t=tariffs.find(x=>x.id===id);
    if(!t) return;
    document.getElementById('t-modal-title').textContent='Редактировать тариф';
    document.getElementById('t-date').value=t.effective_from;
    document.getElementById('t-type').value=t.type;
    document.getElementById('t-fixed').value=t.fixed_cost||0;
    document.getElementById('t-rate').value=t.rate;
  } else {
    document.getElementById('t-modal-title').textContent='Новый тариф';
    document.getElementById('t-date').value=localISO();
    document.getElementById('t-type').value='electricity';
    document.getElementById('t-fixed').value='';
    document.getElementById('t-rate').value='';
  }
  document.getElementById('del-tariff-btn').hidden = !id;
  document.getElementById('tariff-modal').classList.add('open');
}

function closeTariffModal(){ document.getElementById('tariff-modal').classList.remove('open'); editingTariffId=null; }

async function saveTariff() {
  const effective_from=document.getElementById('t-date').value;
  const type=document.getElementById('t-type').value;
  const fixed_cost=parseFloat(document.getElementById('t-fixed').value)||0;
  const rate=parseFloat(document.getElementById('t-rate').value);
  if(!effective_from||isNaN(rate)||rate<0){ toast('Заполните все поля','err'); return; }
  const btn=document.getElementById('save-tariff-btn');
  btn.disabled=true;
  let data,error;
  if(editingTariffId){
    ({data,error}=await sb.from('tariffs').update({effective_from,type,fixed_cost,rate}).eq('id',editingTariffId).select().single());
    if(!error){ const idx=tariffs.findIndex(t=>t.id===editingTariffId); if(idx>=0) tariffs[idx]=data; }
  } else {
    ({data,error}=await sb.from('tariffs').insert({effective_from,type,fixed_cost,rate}).select().single());
    if(!error) tariffs.push(data);
  }
  btn.disabled=false;
  if(error){ toast('Ошибка: '+error.message,'err'); return; }
  syncTariffToSheets(data, editingTariffId ? 'изменён' : 'добавлен');
  closeTariffModal();
  refreshAll();
}

async function deleteTariff(id) {
  if(!await askConfirm({title:'Удалить тариф?', ok:'Удалить', danger:true})) return;
  const tariff = tariffs.find(t=>t.id===id);
  const {error}=await sb.from('tariffs').delete().eq('id',id);
  if(error){ toast('Ошибка: '+error.message,'err'); return; }
  tariffs=tariffs.filter(t=>t.id!==id);
  if(tariff) syncTariffToSheets(tariff, 'удалён');
  refreshAll();
}

// ─── SETTINGS & GOOGLE SHEETS SYNC ───────────────────────────
// ─── ПРОВЕРКА РАЗВЁРНУТОГО СКРИПТА ────────────────────────────
// Apps Script обслуживает зафиксированную версию: сохранение кода в
// редакторе её не меняет. GET-ответ прочитать можно (в отличие от POST),
// поэтому версию проверяем через ?ping=1.
const SCRIPT_VERSION = 'v2';

async function pingScript(url) {
  if (!url) return { state:'empty' };
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec/.test(url)) {
    return { state:'badurl' };
  }
  try {
    const res  = await fetch(url + (url.includes('?') ? '&' : '?') + 'ping=1', { redirect:'follow' });
    const text = (await res.text()).trim();
    if (text === SCRIPT_VERSION) return { state:'ok', text };
    return { state:'old', text: text.slice(0, 60) };
  } catch (e) {
    return { state:'unreachable', text: e.message };   // CORS или нет сети
  }
}

async function checkScript() {
  const url  = document.getElementById('s-gsheets-url').value.trim();
  const out  = document.getElementById('script-check');
  const btn  = document.getElementById('check-script-btn');
  btn.disabled = true; out.innerHTML = '<span style="color:var(--muted)">Проверяю…</span>';
  const r = await pingScript(url);
  btn.disabled = false;

  const msg = {
    empty:       ['var(--muted)',  'Укажите URL скрипта'],
    badurl:      ['var(--danger)',       'Не похоже на адрес Apps Script — нужен …/macros/s/…/exec'],
    ok:          ['var(--success)',`Развёрнута актуальная версия (${SCRIPT_VERSION})`],
    old:         ['var(--warn)',       'Отвечает старая версия — разверните новую (Управление развертываниями → Версия: Новая)'],
    unreachable: ['var(--muted)',  'Ответ прочитать не удалось — проверьте вручную, открыв URL с ?ping=1'],
  }[r.state];
  out.innerHTML = `<span style="color:${msg[0]}">${msg[1]}</span>`;
  return r;
}

// ─── РЕЗЕРВНАЯ КОПИЯ ──────────────────────────────────────────
const BACKUP_TABLES = ['readings','tariffs','advances','settlements','settings','expenses'];
const BACKUP_EVERY_DAYS = 7;

async function fetchAllTables() {
  const out = {};
  for (const t of BACKUP_TABLES) {
    const { data, error } = await sb.from(t).select('*');
    if (error) {
      if (error.code === '42P01') continue;        // таблицы нет — пропускаем
      throw new Error(`${t}: ${error.message}`);
    }
    out[t] = data || [];
  }
  return out;
}

// Копия в Google Sheets через Apps Script. Ответ прочитать нельзя
// (no-cors), поэтому подтверждаем только отправку.
async function backupToSheets(silent) {
  const url = localStorage.getItem('gsheetsUrl');
  if (!url) {
    if (!silent) toast('Сначала укажите URL Google-скрипта в настройках', 'err');
    return;
  }
  const btn = document.getElementById('gbackup-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Проверяю скрипт…'; }
  try {
    // сначала убеждаемся, что по адресу живёт нужная версия —
    // иначе POST уйдёт в никуда, а мы отрапортуем об успехе
    const ping = await pingScript(url);
    if (ping.state === 'old' || ping.state === 'badurl') {
      if (btn) { btn.disabled = false; btn.textContent = 'Отправить копию в Google Sheets'; }
      if (!silent) toast(ping.state === 'old'
        ? 'По этому адресу старая версия скрипта — разверните новую'
        : 'Адрес не похож на Apps Script', 'err');
      return;
    }

    if (btn) btn.textContent = 'Отправляю…';
    const tables = await fetchAllTables();
    const total = Object.values(tables).reduce((a, v) => a + v.length, 0);
    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ kind: 'backup', tables }),
    });
    localStorage.setItem('lastSheetsBackup', new Date().toISOString());
    renderBackupStatus();
    if (!silent) toast(ping.state === 'ok'
      ? `Отправлено в Google Sheets · ${total} строк`
      : `Отправлено · ${total} строк (ответ скрипта прочитать нельзя — проверьте таблицу)`, 'ok');
  } catch (e) {
    if (!silent) toast('Не удалось отправить: ' + e.message, 'err');
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Отправить копию в Google Sheets'; }
}

// Раз в неделю при открытии приложения — молча
async function autoBackup() {
  if (!localStorage.getItem('gsheetsUrl')) return;
  const last = localStorage.getItem('lastSheetsBackup');
  if (last) {
    const days = (Date.now() - new Date(last)) / 86400000;
    if (days < BACKUP_EVERY_DAYS) return;
  }
  await backupToSheets(true);
}

function renderBackupStatus() {
  const el = document.getElementById('backup-status');
  if (!el) return;
  const last = localStorage.getItem('lastSheetsBackup');
  if (!localStorage.getItem('gsheetsUrl')) {
    el.innerHTML = '<span style="color:var(--warn)">Google-скрипт не настроен — копии не уходят</span>';
    return;
  }
  if (!last) { el.textContent = 'Копия в Google ещё не отправлялась'; return; }
  const days = Math.floor((Date.now() - new Date(last)) / 86400000);
  el.textContent = `Последняя копия в Google: ${fmtDate(last.split('T')[0])}`
    + (days > 0 ? ` · ${days} дн. назад` : ' · сегодня');
}

// Выгружает всё из базы в JSON-файл на устройство.
async function exportBackup() {
  const btn = document.getElementById('backup-btn');
  btn.disabled = true; btn.textContent = 'Собираю…';
  try {
    const dump = { app:'kommunalka', exported_at:new Date().toISOString(), tables: await fetchAllTables() };

    const counts = Object.entries(dump.tables)
      .map(([k,v]) => `${k} ${v.length}`).join(' · ');

    const blob = new Blob([JSON.stringify(dump, null, 1)], {type:'application/json'});
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `kommunalka-backup-${localISO()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 10000);

    localStorage.setItem('lastBackup', new Date().toISOString());
    toast(`Копия сохранена · ${counts}`, 'ok');
  } catch(e) {
    toast('Не удалось выгрузить: ' + e.message, 'err');
  }
  btn.disabled = false; btn.textContent = 'Скачать JSON-файл';
}

async function saveSettings() {
  const url = document.getElementById('s-gsheets-url').value.trim();
  try {
    if (url) {
      localStorage.setItem('gsheetsUrl', url);
      await sb.from('settings').upsert({key:'gsheetsUrl', value:url, updated_at:new Date().toISOString()});
    } else {
      localStorage.removeItem('gsheetsUrl');
      await sb.from('settings').delete().eq('key','gsheetsUrl');
    }
  } catch(e) { console.warn('Settings save error:', e); }
  updateSyncStatus();
  renderBackupStatus();
  toast(url ? 'Адрес скрипта сохранён' : 'Адрес скрипта удалён', 'ok');
}

function updateSyncStatus() {
  const el = document.getElementById('sync-status');
  if (!el) return;
  const url = localStorage.getItem('gsheetsUrl') || document.getElementById('s-gsheets-url')?.value || '';
  if (url) {
    el.innerHTML = '<span class="pill ok">включено</span>';
  } else {
    el.innerHTML = '<span class="pill">не настроено</span>';
  }
}

function copyScriptCode(btn) {
  const code = document.querySelector('.code-block').textContent;
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent = 'Скопировано';
    setTimeout(() => btn.textContent = 'Скопировать код', 2000);
  });
}

// Map internal type to Google Sheets format
const SHEETS_TYPE_MAP = {
  electricity:      {type:'Электричество', room:''},
  water_bathroom:   {type:'Вода',          room:'Ванная'},
  water_kitchen:    {type:'Вода',          room:'Кухня'},
  heating_bathroom: {type:'Отопление',     room:'Ванная'},
  heating_kitchen:  {type:'Отопление',     room:'Кухня'},
  heating_bedroom:  {type:'Отопление',     room:'Спальная'},
  heating_kids:     {type:'Отопление',     room:'Детская'},
  heating_living:   {type:'Отопление',     room:'Зал'},
};

async function syncToSheets(rows) {
  const url = localStorage.getItem('gsheetsUrl');
  if (!url || !rows.length) return;
  try {
    const data = encodeURIComponent(JSON.stringify(rows));
    fetch(`${url}?data=${data}`, { mode: 'no-cors' });
  } catch(e) { /* silent */ }
}

const TARIFF_TYPE_LABELS = {electricity:'Электричество', water:'Вода', heating:'Отопление'};

async function syncTariffToSheets(tariff, action) {
  const url = localStorage.getItem('gsheetsUrl');
  if (!url || !tariff) return;
  try {
    const row = {
      effective_from: tariff.effective_from,
      type: TARIFF_TYPE_LABELS[tariff.type] || tariff.type,
      fixed_cost: tariff.fixed_cost,
      rate: tariff.rate,
      action
    };
    const data = encodeURIComponent(JSON.stringify([row]));
    fetch(`${url}?sheet=tariffs&data=${data}`, { mode: 'no-cors' });
  } catch(e) { /* silent */ }
}

function buildSheetsRow(type, date, value, prevReading) {
  const m = SHEETS_TYPE_MAP[type] || {type, room:''};
  let delta = '', cost = '';
  if (prevReading && !prevReading.is_reset && value > prevReading.value) {
    delta = +(value - prevReading.value).toFixed(3);
    cost  = calcVarCost(type, prevReading.date, date, delta) ?? '';
  }
  return { date, type: m.type, room: m.room, value, delta, cost };
}

// ─── CONSUMPTION FEEDBACK ─────────────────────────────────────
// Average consumption per day across all reading pairs for a type
function calcAvgDailyRate(type) {
  const sorted = getTypeReadings(type);
  let tCons = 0, tDays = 0;
  for (let i = 1; i < sorted.length - 1; i++) { // exclude last (just saved)
    const prev = sorted[i-1], curr = sorted[i];
    if (curr.is_reset || curr.value < prev.value) continue;
    const d = Math.round(daysBetween(prev.date, curr.date));
    if (d > 0) { tCons += curr.value - prev.value; tDays += d; }
  }
  return tDays > 0 ? tCons / tDays : 0;
}

// ─── ANALYTICS ────────────────────────────────────────────────
let analyticsView = 'monthly';
let yoyMode = 'full';       // 'full' | 'ytd'
let dailyPeriod = 6;        // months for daily view

function setYoyMode(mode, btn) {
  yoyMode = mode;
  document.querySelectorAll('.ym').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderAnalytics();
}

function setDailyPeriod(months, btn) {
  dailyPeriod = months;
  document.querySelectorAll('.dp').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderDailyView();
}

function setAnalyticsView(view, btn) {
  analyticsView = view;
  document.querySelectorAll('.vt').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('view-monthly').style.display = view==='monthly'?'':'none';
  document.getElementById('view-yoy').style.display     = view==='yoy'?'':'none';
  document.getElementById('view-daily').style.display   = view==='daily'?'':'none';
  renderAnalytics();
}

function setPeriod(months, btn) {
  analyticsPeriod=months;
  document.querySelectorAll('.pp').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderAnalytics();
}

// ── Chart helpers ─────────────────────────────────────────────
function makeChart(id, labels, datasets, yLabel, opts={}) {
  if(charts[id]){ charts[id].destroy(); delete charts[id]; }
  const el = document.getElementById(id);
  if(!el) return;
  const ctx = el.getContext('2d');
  charts[id] = new Chart(ctx,{
    type: opts.type||'bar',
    data:{labels, datasets},
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{labels:{color:chartTheme().text,font:{size:11},boxWidth:10,usePointStyle:true}},
        tooltip:{mode:'index', intersect:false,
          callbacks: opts.tooltipCb ? {label: opts.tooltipCb} : undefined}
      },
      scales:{
        x:{grid:{color:chartTheme().grid},ticks:{color:chartTheme().text,font:{size:10}},stacked:opts.stacked!==false},
        y:{grid:{color:chartTheme().grid},ticks:{color:chartTheme().text,font:{size:10}},
           title:{display:!!yLabel,text:yLabel,color:chartTheme().text},
           stacked:opts.stacked!==false}
      }
    }
  });
}

// avgLine dataset (type: line, dashed)
function avgDataset(label, values, color) {
  const nonZero = values.filter(v=>v>0);
  const avg = nonZero.length ? nonZero.reduce((a,b)=>a+b,0)/nonZero.length : 0;
  return {
    type:'line', label:`Среднее (${fmtN(avg,1)})`,
    data: values.map(()=>+avg.toFixed(2)),
    borderColor: color, borderWidth:1.5, borderDash:[5,4],
    pointRadius:0, fill:false, tension:0, order:-1,
    stack: undefined
  };
}

// ── Monthly consumption data (all time, no filter) ────────────
function getAllMonthlyData() {
  return {
    elec:  getMonthlyType('electricity',0),
    bath:  getMonthlyType('water_bathroom',0),
    kitch: getMonthlyType('water_kitchen',0),
    heat:  getMonthlyHeating(0),
  };
}

// ── Monthly fixed cost helper ─────────────────────────────────
function monthFixed(tariffType, key) {
  const [y,m]=key.split('-').map(Number);
  const { start, end } = monthBounds(y, m);   // конец — 1-е число след. месяца
  return +calcFixedProrated(tariffType, start, end).toFixed(2);
}

function monthTotalCost(key, all) {
  return +(
    (all.elec[key]?.cost||0) + monthFixed('electricity',key) +
    (all.bath[key]?.cost||0) + (all.kitch[key]?.cost||0) + monthFixed('water',key) +
    (all.heat[key]?.cost||0) + monthFixed('heating',key)
  ).toFixed(2);
}

// ── Summary stat cards ────────────────────────────────────────
function renderSummaryStats(all) {
  const now = new Date();
  const curKey  = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const prevKey = `${now.getFullYear()-1}-${String(now.getMonth()+1).padStart(2,'0')}`;

  // Per-day rate: total consumption / total covered days (all historical months excl. current)
  const dailyRate = (obj, excludeKey) => {
    let tCons = 0, tDays = 0;
    for (const [k, v] of Object.entries(obj)) {
      if (k === excludeKey || !(v.cons > 0) || !(v.days > 0)) continue;
      tCons += v.cons; tDays += v.days;
    }
    return tDays > 0 ? tCons / tDays : 0;
  };

  const pctHtml = (curRate, refRate) => {
    if (!refRate || !curRate) return '<span class="delta-neutral">—</span>';
    const pct = (curRate - refRate) / refRate * 100;
    const cls = pct > 10 ? 'delta-up' : pct < -10 ? 'delta-down' : 'delta-neutral';
    return `<span class="${cls}">${pct>=0?'+':''}${pct.toFixed(0)}%</span>`;
  };

  // Electricity
  const eCur  = all.elec[curKey]?.cons||0;
  const eDays = all.elec[curKey]?.days||1;
  const eCurR = eCur/eDays;
  const eAvgR = dailyRate(all.elec, curKey);
  const ePrevR = (all.elec[prevKey]?.cons||0) / (all.elec[prevKey]?.days||30);

  // Water combined
  const wCur  = (all.bath[curKey]?.cons||0)+(all.kitch[curKey]?.cons||0);
  const wDays = Math.max(all.bath[curKey]?.days||0, all.kitch[curKey]?.days||0)||1;
  const wCurR = wCur/wDays;
  const wAllKeys = new Set([...Object.keys(all.bath),...Object.keys(all.kitch)]);
  let wTC=0, wTD=0;
  for(const k of wAllKeys){
    if(k===curKey) continue;
    const c=(all.bath[k]?.cons||0)+(all.kitch[k]?.cons||0);
    const d=Math.max(all.bath[k]?.days||0, all.kitch[k]?.days||0);
    if(c>0&&d>0){wTC+=c; wTD+=d;}
  }
  const wAvgR  = wTD>0 ? wTC/wTD : 0;
  const wPrevR = ((all.bath[prevKey]?.cons||0)+(all.kitch[prevKey]?.cons||0)) /
                 (Math.max(all.bath[prevKey]?.days||0, all.kitch[prevKey]?.days||0)||30);

  // Heating
  const hCur  = all.heat[curKey]?.cons||0;
  const hDays = all.heat[curKey]?.days||1;
  const hCurR = hCur/hDays;
  const hAvgR = dailyRate(all.heat, curKey);
  const hPrevR = (all.heat[prevKey]?.cons||0) / (all.heat[prevKey]?.days||30);

  // Cost (proxy: use elec days as period length for current month)
  const cCur   = monthTotalCost(curKey, all);
  const cCurR  = cCur / eDays;
  const cPrevCost = monthTotalCost(prevKey, all);
  const cPrevR = cPrevCost / (all.elec[prevKey]?.days||30);
  const allCostKeys = [...new Set([...Object.keys(all.elec),...Object.keys(all.bath),...Object.keys(all.heat)])].filter(k=>k!==curKey);
  let cTC=0, cTD=0;
  for(const k of allCostKeys){
    const d=all.elec[k]?.days||0; const c=monthTotalCost(k,all);
    if(c>0&&d>0){cTC+=c; cTD+=d;}
  }
  const cAvgR = cTD>0 ? cTC/cTD : 0;

  const mn=['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
  const prevMonthName = mn[now.getMonth()]+' '+(now.getFullYear()-1);

  document.getElementById('analytics-summary').innerHTML = [
    {icon:'var(--elec)', label:'Электричество', cur:eCur,  unit:'кВт·ч',  curR:eCurR,  avgR:eAvgR,  prevR:ePrevR,  dec:0},
    {icon:'var(--bath)', label:'Вода',          cur:wCur,  unit:'м³',     curR:wCurR,  avgR:wAvgR,  prevR:wPrevR,  dec:2},
    {icon:'var(--heat)', label:'Отопление',     cur:hCur,  unit:'взв.ед', curR:hCurR,  avgR:hAvgR,  prevR:hPrevR,  dec:1},
    {icon:'var(--text2)', label:'Расходы',        cur:cCur,  unit:'€',      curR:cCurR,  avgR:cAvgR,  prevR:cPrevR,  dec:2},
  ].map(c=>`
    <div class="stat-card">
      <div class="stat-card-label"><span class="card-dot" style="background:${c.icon};margin-right:6px"></span>${c.label}</div>
      <div class="stat-card-main">${c.cur>0?fmtN(c.cur,c.dec):'—'} <span class="stat-card-unit">${c.unit}</span></div>
      <div class="stat-rows">
        <div class="stat-row">
          <span class="stat-row-label">vs среднее</span>
          ${c.avgR>0&&c.curR>0 ? pctHtml(c.curR,c.avgR) : '<span class="delta-neutral">—</span>'}
        </div>
        <div class="stat-row">
          <span class="stat-row-label">vs ${prevMonthName}</span>
          ${c.prevR>0&&c.curR>0 ? pctHtml(c.curR,c.prevR) : '<span class="delta-neutral">—</span>'}
        </div>
        ${c.avgR>0 ? `<div class="stat-row"><span class="stat-row-label">средн./день</span><span style="color:var(--muted);font-size:11px">${fmtN(c.avgR,c.dec+1)} ${c.unit}</span></div>` : ''}
      </div>
    </div>`).join('');
}

// ── Year selectors ────────────────────────────────────────────
function initYearSelectors(allKeys) {
  const years = [...new Set(allKeys.map(k=>k.split('-')[0]))].sort().reverse();
  ['yoy-year1','yoy-year2'].forEach((id,i)=>{
    const sel = document.getElementById(id);
    if(!sel) return;
    const current = sel.value;
    sel.innerHTML = years.map(y=>`<option value="${y}"${y===(current||(i===0?String(new Date().getFullYear()):String(new Date().getFullYear()-1)))?'selected':''}>${y}</option>`).join('');
    if(!current && years[i]) sel.value = years[i] || years[0];
  });
}

// ── YoY Charts ────────────────────────────────────────────────
function renderYoY(all) {
  const y1 = document.getElementById('yoy-year1')?.value;
  const y2 = document.getElementById('yoy-year2')?.value;
  if(!y1||!y2) return;

  const MONTHS = ['01','02','03','04','05','06','07','08','09','10','11','12'];
  const MLABELS = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
  const gm = (obj, year, mo, f) => obj[`${year}-${mo}`]?.[f]||0;
  // YTD: limit months to current month index
  const curMoIdx = yoyMode==='ytd' ? new Date().getMonth() : 11; // 0-based
  const activeMos = MONTHS.slice(0, curMoIdx+1);

  const chartLabels = MLABELS.slice(0, curMoIdx+1);

  // Electricity
  makeChart('yoy-elec', chartLabels, [
    {label:y1, data:activeMos.map(m=>+gm(all.elec,y1,m,'cons').toFixed(0)), backgroundColor:'rgba(245,158,11,.8)', borderColor:'#e0a82e', borderWidth:1, borderRadius:3},
    {label:y2, data:activeMos.map(m=>+gm(all.elec,y2,m,'cons').toFixed(0)), backgroundColor:'rgba(245,158,11,.25)',borderColor:'#e0a82e', borderWidth:1, borderRadius:3},
  ],'кВт·ч',{stacked:false});

  // Water
  const w1 = activeMos.map(m=>+(gm(all.bath,y1,m,'cons')+gm(all.kitch,y1,m,'cons')).toFixed(2));
  const w2 = activeMos.map(m=>+(gm(all.bath,y2,m,'cons')+gm(all.kitch,y2,m,'cons')).toFixed(2));
  makeChart('yoy-water', chartLabels, [
    {label:y1, data:w1, backgroundColor:'rgba(59,130,246,.8)', borderColor:'#4a9fd8', borderWidth:1, borderRadius:3},
    {label:y2, data:w2, backgroundColor:'rgba(59,130,246,.25)',borderColor:'#4a9fd8', borderWidth:1, borderRadius:3},
  ],'м³',{stacked:false});

  // Heating
  makeChart('yoy-heat', chartLabels, [
    {label:y1, data:activeMos.map(m=>+gm(all.heat,y1,m,'cons').toFixed(1)), backgroundColor:'rgba(239,68,68,.8)', borderColor:'#d4553f', borderWidth:1, borderRadius:3},
    {label:y2, data:activeMos.map(m=>+gm(all.heat,y2,m,'cons').toFixed(1)), backgroundColor:'rgba(239,68,68,.25)',borderColor:'#d4553f', borderWidth:1, borderRadius:3},
  ],'взв.ед',{stacked:false});

  // Cost
  const cost1 = activeMos.map(m=>{ const k=`${y1}-${m}`; return monthTotalCost(k,all); });
  const cost2 = activeMos.map(m=>{ const k=`${y2}-${m}`; return monthTotalCost(k,all); });
  makeChart('yoy-cost', chartLabels, [
    {label:y1, data:cost1, backgroundColor:'rgba(34,197,94,.8)', borderColor:'#22c55e', borderWidth:1, borderRadius:3},
    {label:y2, data:cost2, backgroundColor:'rgba(34,197,94,.25)',borderColor:'#22c55e', borderWidth:1, borderRadius:3},
  ],'€',{stacked:false});

  // YoY Table
  const tableEl = document.getElementById('yoy-table');
  const totalCons1 = {e:0,w:0,h:0,c:0};
  const totalCons2 = {e:0,w:0,h:0,c:0};
  let rowsHtml = `<thead>
    <tr>
      <th class="yoy-th" style="text-align:left">Месяц</th>
      <th class="yoy-th">${y1}</th><th class="yoy-th">${y2}</th><th class="yoy-th">Δ</th>
      <th class="yoy-th">${y1}</th><th class="yoy-th">${y2}</th><th class="yoy-th">Δ</th>
      <th class="yoy-th">${y1}</th><th class="yoy-th">${y2}</th><th class="yoy-th">Δ</th>
      <th class="yoy-th">€ ${y1}</th><th class="yoy-th">€ ${y2}</th><th class="yoy-th">Δ</th>
    </tr></thead><tbody>`;

  const modeLabel = yoyMode==='ytd' ? ` (YTD ${MLABELS[curMoIdx]})` : '';
  rowsHtml = rowsHtml.replace('Таблица', `Таблица${modeLabel}`);

  activeMos.forEach((mo,i)=>{
    const e1=gm(all.elec,y1,mo,'cons'), e2=gm(all.elec,y2,mo,'cons');
    const ww1=gm(all.bath,y1,mo,'cons')+gm(all.kitch,y1,mo,'cons');
    const ww2=gm(all.bath,y2,mo,'cons')+gm(all.kitch,y2,mo,'cons');
    const h1=gm(all.heat,y1,mo,'cons'), h2=gm(all.heat,y2,mo,'cons');
    const c1=cost1[i], c2=cost2[i];
    totalCons1.e+=e1; totalCons2.e+=e2;
    totalCons1.w+=ww1; totalCons2.w+=ww2;
    totalCons1.h+=h1; totalCons2.h+=h2;
    totalCons1.c+=c1; totalCons2.c+=c2;
    const skipRow = !e1&&!e2&&!ww1&&!ww2&&!h1&&!h2;
    if(skipRow) return;
    const dCls = (a,b) => !a||!b?'':'yoy-delta-'+(a>b?'pos':'neg');
    const dStr = (a,b) => (!a&&!b)?'—':!a||!b?'—':`${a>b?'+':''}${fmtN(a-b,1)}`;
    rowsHtml += `<tr>
      <td class="yoy-td">${MLABELS[i]}</td>
      <td class="yoy-td">${e1?fmtN(e1,0):'—'}</td><td class="yoy-td">${e2?fmtN(e2,0):'—'}</td>
      <td class="yoy-td ${dCls(e1,e2)}">${dStr(e1,e2)}</td>
      <td class="yoy-td">${ww1?fmtN(ww1,2):'—'}</td><td class="yoy-td">${ww2?fmtN(ww2,2):'—'}</td>
      <td class="yoy-td ${dCls(ww1,ww2)}">${dStr(ww1,ww2)}</td>
      <td class="yoy-td">${h1?fmtN(h1,1):'—'}</td><td class="yoy-td">${h2?fmtN(h2,1):'—'}</td>
      <td class="yoy-td ${dCls(h1,h2)}">${dStr(h1,h2)}</td>
      <td class="yoy-td">${c1?fmtE(c1):'—'}</td><td class="yoy-td">${c2?fmtE(c2):'—'}</td>
      <td class="yoy-td ${dCls(c1,c2)}">${dStr(c1,c2)}</td>
    </tr>`;
  });
  // Totals row
  const dCls=(a,b)=>!a||!b?'':'yoy-delta-'+(a>b?'pos':'neg');
  const dStr=(a,b)=>(!a&&!b)?'—':!a||!b?'—':`${a>b?'+':''}${fmtN(a-b,1)}`;
  rowsHtml+=`<tr style="font-weight:700;background:var(--bg3)">
    <td class="yoy-td">Итого</td>
    <td class="yoy-td">${fmtN(totalCons1.e,0)}</td><td class="yoy-td">${fmtN(totalCons2.e,0)}</td>
    <td class="yoy-td ${dCls(totalCons1.e,totalCons2.e)}">${dStr(totalCons1.e,totalCons2.e)}</td>
    <td class="yoy-td">${fmtN(totalCons1.w,2)}</td><td class="yoy-td">${fmtN(totalCons2.w,2)}</td>
    <td class="yoy-td ${dCls(totalCons1.w,totalCons2.w)}">${dStr(totalCons1.w,totalCons2.w)}</td>
    <td class="yoy-td">${fmtN(totalCons1.h,1)}</td><td class="yoy-td">${fmtN(totalCons2.h,1)}</td>
    <td class="yoy-td ${dCls(totalCons1.h,totalCons2.h)}">${dStr(totalCons1.h,totalCons2.h)}</td>
    <td class="yoy-td">${fmtE(totalCons1.c)}</td><td class="yoy-td">${fmtE(totalCons2.c)}</td>
    <td class="yoy-td ${dCls(totalCons1.c,totalCons2.c)}">${dStr(totalCons1.c,totalCons2.c)}</td>
  </tr>`;
  tableEl.innerHTML = rowsHtml + '</tbody>';
}

// ── Main render ───────────────────────────────────────────────
function renderAnalytics() {
  const all = getAllMonthlyData();

  // Always render summary stats (current month)
  renderSummaryStats(all);

  // Init year selectors
  const allKeys=[...new Set([...Object.keys(all.elec),...Object.keys(all.bath),...Object.keys(all.heat)])].sort();
  initYearSelectors(allKeys);

  if(analyticsView==='yoy') { renderYoY(all); return; }
  if(analyticsView==='daily') { renderDailyView(); return; }

  // ── Monthly view ──────────────────────────────────────────
  const P = analyticsPeriod;
  const gv = (obj,k,f)=>{ const e=obj[k]; return e?(e[f]||0):0; };
  let keys = allKeys;
  if(P>0){
    const now=new Date();
    const cutoff=new Date(now.getFullYear(), now.getMonth()-P, 1);
    const ck=`${cutoff.getFullYear()}-${String(cutoff.getMonth()+1).padStart(2,'0')}`;
    keys=keys.filter(k=>k>=ck);
  }
  const labels = keys.map(fmtMKey);

  const eVals = keys.map(k=>+gv(all.elec,k,'cons').toFixed(0));
  const bVals = keys.map(k=>+gv(all.bath,k,'cons').toFixed(2));
  const kVals = keys.map(k=>+gv(all.kitch,k,'cons').toFixed(2));
  const hVals = keys.map(k=>+gv(all.heat,k,'cons').toFixed(1));
  const wVals = keys.map((k,i)=>+(bVals[i]+kVals[i]).toFixed(2));

  makeChart('chart-elec', labels, [
    {label:'кВт·ч', data:eVals, backgroundColor:'rgba(224,168,46,.8)',borderColor:'#e0a82e',borderWidth:1,borderRadius:3},
    avgDataset('', eVals, chartTheme().text),
  ],'кВт·ч');

  makeChart('chart-water', labels, [
    {label:'Ванная', data:bVals,  backgroundColor:'rgba(74,159,216,.8)',borderColor:'#4a9fd8',borderWidth:1,borderRadius:3},
    {label:'Кухня',  data:kVals,  backgroundColor:'rgba(63,169,138,.8)',borderColor:'#3fa98a',borderWidth:1,borderRadius:3},
    avgDataset('', wVals, chartTheme().text),
  ],'м³');

  // Отопление — с разбивкой по комнатам: видно, какая комната съедает больше.
  // Счётчики поставили в ноябре 2024, поэтому пустые месяцы до первого
  // показания отрезаем — иначе график на 80% состоит из пустоты.
  const roomMonthly = {};
  for (const t of HEATING_TYPES) roomMonthly[t] = getMonthlyType(t, 0);
  let hStart = keys.findIndex(k => hVals[keys.indexOf(k)] > 0);
  if (hStart < 0) hStart = 0;
  const hKeys   = keys.slice(hStart);
  const hLabels = labels.slice(hStart);

  const roomDatasets = HEATING_TYPES.map(t => ({
    label: TYPES[t].room,
    data: hKeys.map(k => +(((roomMonthly[t][k]?.cons) || 0) * TYPES[t].factor).toFixed(1)),
    backgroundColor: ROOM_COLORS[t] + 'cc',
    borderColor: ROOM_COLORS[t], borderWidth:1, borderRadius:2, stack:'h',
  }));
  makeChart('chart-heat', hLabels,
    [...roomDatasets, avgDataset('', hVals.slice(hStart), chartTheme().text)], 'взв.ед');

  renderHeatingRooms(hKeys, roomMonthly);

  const eFixed=keys.map(k=>monthFixed('electricity',k));
  const wFixed=keys.map(k=>monthFixed('water',k));
  const hFixed=keys.map(k=>monthFixed('heating',k));
  const costTotals = keys.map(k=>monthTotalCost(k,all));

  makeChart('chart-cost', labels, [
    {label:'Свет',  data:keys.map(k=>+gv(all.elec,k,'cost').toFixed(2)),  backgroundColor:'rgba(224,168,46,.8)',borderColor:'#e0a82e',borderWidth:1,stack:'s'},
    {label:'Свет · фикс.', data:eFixed,  backgroundColor:'rgba(224,168,46,.28)', borderColor:'#e0a82e',borderWidth:1,stack:'s'},
    {label:'Вода',  data:keys.map(k=>{return +((all.bath[k]?.cost||0)+(all.kitch[k]?.cost||0)).toFixed(2);}), backgroundColor:'rgba(74,159,216,.8)',borderColor:'#4a9fd8',borderWidth:1,stack:'s'},
    {label:'Вода · фикс.', data:wFixed,  backgroundColor:'rgba(74,159,216,.28)', borderColor:'#4a9fd8',borderWidth:1,stack:'s'},
    {label:'Отопление',  data:keys.map(k=>+gv(all.heat,k,'cost').toFixed(2)), backgroundColor:'rgba(212,85,63,.8)',borderColor:'#d4553f',borderWidth:1,stack:'s'},
    {label:'Отопление · фикс.', data:hFixed,  backgroundColor:'rgba(212,85,63,.28)',  borderColor:'#d4553f',borderWidth:1,stack:'s'},
    avgDataset('', costTotals, chartTheme().text),
  ],'€');

  renderDataIssues();
}

// ── Отопление по комнатам за выбранный период ─────────────────
function renderHeatingRooms(keys, roomMonthly) {
  const el = document.getElementById('heat-rooms-breakdown');
  if (!el) return;

  const rows = HEATING_TYPES.map(t => {
    let raw = 0, cost = 0;
    for (const k of keys) {
      const v = roomMonthly[t][k];
      if (!v) continue;
      raw  += v.cons || 0;
      cost += v.cost || 0;
    }
    return { type:t, room:TYPES[t].room, factor:TYPES[t].factor, raw, units: raw*TYPES[t].factor, cost };
  });

  const totalUnits = rows.reduce((a,r)=>a+r.units,0);
  const totalCost  = rows.reduce((a,r)=>a+r.cost,0);
  if (totalUnits <= 0) {
    el.innerHTML = `<div class="chart-card"><div class="chart-title">Отопление по комнатам</div>
      <div class="empty">За выбранный период расхода не было</div></div>`;
    return;
  }

  rows.sort((a,b)=>b.units-a.units);
  const max = rows[0].units || 1;

  const body = rows.map(r => {
    const share = totalUnits>0 ? r.units/totalUnits*100 : 0;
    return `<div class="row">
      <span class="dot" style="background:${ROOM_COLORS[r.type]}"></span>
      <div class="row-main">
        <div class="row-title">${r.room} <span class="row-k">×${r.factor}</span></div>
        <div class="bar-track"><span style="width:${(r.units/max*100).toFixed(0)}%;background:${ROOM_COLORS[r.type]}"></span></div>
        <div class="row-sub">снято ${fmtN(r.raw,0)} ед · ${fmtN(r.units,0)} взв.ед</div>
      </div>
      <div class="row-end"><b>${fmtE(r.cost)}</b><span>${share.toFixed(0)}%</span></div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="chart-card">
      <div class="chart-title" style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <span>Отопление по комнатам</span>
        <span class="muted">${fmtN(totalUnits,0)} взв.ед · ${fmtE(totalCost)}</span>
      </div>
      <div class="list flat">${body}</div>
      <div class="hint" style="margin-top:10px">
        «Снято» — показание распределителя. «Взвешенные» — после умножения на коэффициент комнаты,
        именно по ним считается счёт.
      </div>
    </div>`;
}

// ── Проверка качества данных ──────────────────────────────────
// Периоды с падением показания или с нулевой длиной выпадают из
// расчётов молча — здесь они показаны явно.
function findDataIssues() {
  const issues = [];
  for (const type of Object.keys(TYPES)) {
    const s = getTypeReadings(type);
    for (let i = 1; i < s.length; i++) {
      const prev = s[i-1], curr = s[i];
      if (prev.date === curr.date) {
        issues.push({ kind:'dup', type, id:curr.id,
          text:`${TYPES[type].label}: две записи за ${fmtDate(curr.date)} (${fmtN(prev.value,TYPES[type].dec)} и ${fmtN(curr.value,TYPES[type].dec)}) — расход между ними не учитывается` });
      } else if (curr.value < prev.value && !curr.is_reset) {
        issues.push({ kind:'drop', type, id:curr.id,
          text:`${TYPES[type].label}: ${fmtDate(curr.date)} показание упало с ${fmtN(prev.value,TYPES[type].dec)} до ${fmtN(curr.value,TYPES[type].dec)} без отметки о замене счётчика — период выпал из статистики` });
      }
    }
  }
  return issues;
}

function renderDataIssues() {
  const el = document.getElementById('data-issues');
  if (!el) return;
  const issues = findDataIssues();
  if (!issues.length) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="chart-card warn">
      <div class="chart-title">Проверка данных · ${issues.length}</div>
      <div class="list flat">
        ${issues.map(i => `
          <div class="row">
            <div class="row-main"><div class="row-sub" style="color:var(--text)">${i.text}</div></div>
            <button class="btn tonal sm" onclick="openEditReading(${i.id})">Исправить</button>
          </div>`).join('')}
      </div>
      <div class="hint" style="margin-top:10px">
        Замену счётчика отмечайте переключателем в карточке показания, двойную запись — исправьте дату или удалите лишнюю.
      </div>
    </div>`;
}

// ── Daily rate view ───────────────────────────────────────────
function renderDailyView() {
  const selType = document.getElementById('daily-type')?.value || 'electricity';
  const isHeat  = selType === 'heating';

  // Build point series: one point per reading interval = avg units/day
  function buildSeries(type) {
    const sorted = getTypeReadings(type);
    const pts = [];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i-1], curr = sorted[i];
      if (curr.is_reset || curr.value < prev.value) continue;
      const days = Math.round(daysBetween(prev.date, curr.date));
      if (days <= 0) continue;
      const rate = (curr.value - prev.value) / days;
      pts.push({ x: curr.date, y: +rate.toFixed(4) });
    }
    return pts;
  }

  // Period filter
  let cutoffDate = null;
  if (dailyPeriod > 0) {
    const d = new Date(); d.setMonth(d.getMonth() - dailyPeriod);
    cutoffDate = d.toISOString().slice(0,10);
  }
  function filterPts(pts) { return cutoffDate ? pts.filter(p => p.x >= cutoffDate) : pts; }

  const COLORS = {
    electricity:      '#f59e0b',
    water_bathroom:   '#3b82f6',
    water_kitchen:    '#10b981',
    heating_bathroom: '#ef4444',
    heating_kitchen:  '#f97316',
    heating_bedroom:  '#a855f7',
    heating_kids:     '#ec4899',
    heating_living:   '#06b6d4',
  };
  const ROOM_LABELS = {
    heating_bathroom:'Ванная', heating_kitchen:'Кухня',
    heating_bedroom:'Спальная', heating_kids:'Детская', heating_living:'Зал'
  };

  const dailyCard = document.getElementById('daily-rooms-card');

  if (!isHeat) {
    // Single-type line chart
    const pts = filterPts(buildSeries(selType));
    const labels = pts.map(p => fmtDate(p.x));
    const data   = pts.map(p => p.y);
    const unit   = TYPES[selType].unit;
    const color  = COLORS[selType] || '#7d869c';
    const titleEl = document.getElementById('daily-chart-title');
    if (titleEl) titleEl.textContent = `${TYPES[selType].label} — потребление ${unit}/день между показаниями`;
    makeChart('chart-daily', labels, [{
      type: 'line', label: unit+'/день', data,
      borderColor: color, backgroundColor: color+'33',
      borderWidth: 2, pointRadius: 3, fill: true, tension: 0.3,
    }], unit+'/день', {stacked: false, type:'line'});
    if (dailyCard) dailyCard.style.display = 'none';
  } else {
    // Heating: total weighted units/day chart
    const heatPts = [];
    {
      const allByDate = {};
      for (const type of HEATING_TYPES) {
        const sorted = getTypeReadings(type);
        for (let i = 1; i < sorted.length; i++) {
          const prev = sorted[i-1], curr = sorted[i];
          if (curr.is_reset || curr.value < prev.value) continue;
          const days = Math.round(daysBetween(prev.date, curr.date));
          if (days <= 0) continue;
          const rate = (curr.value - prev.value) / days * TYPES[type].factor;
          if (!allByDate[curr.date]) allByDate[curr.date] = 0;
          allByDate[curr.date] += rate;
        }
      }
      const sorted = Object.entries(allByDate).sort((a,b)=>a[0].localeCompare(b[0]));
      for (const [x, y] of sorted) {
        if (cutoffDate && x < cutoffDate) continue;
        heatPts.push({ x, y: +y.toFixed(3) });
      }
    }
    const titleEl = document.getElementById('daily-chart-title');
    if (titleEl) titleEl.textContent = 'Отопление суммарно (взв.ед/день)';
    makeChart('chart-daily', heatPts.map(p=>fmtDate(p.x)), [{
      type:'line', label:'взв.ед/день', data: heatPts.map(p=>p.y),
      borderColor:'#d4553f', backgroundColor:'#ef444433',
      borderWidth:2, pointRadius:3, fill:true, tension:0.3,
    }], 'взв.ед/день', {stacked:false, type:'line'});

    // Rooms chart
    if (dailyCard) dailyCard.style.display = '';
    const roomDatasets = HEATING_TYPES.map(type => {
      const pts = filterPts(buildSeries(type));
      return {
        type:'line', label: ROOM_LABELS[type]||type,
        data: pts.map(p=>p.y),
        borderColor: COLORS[type], backgroundColor: COLORS[type]+'22',
        borderWidth:1.5, pointRadius:2, fill:false, tension:0.3,
        // Align with all dates union — use sparse approach
        // Actually build a dict
        _pts: pts
      };
    });
    // Collect all dates from all rooms
    const allDates = [...new Set(HEATING_TYPES.flatMap(type => filterPts(buildSeries(type)).map(p=>p.x)))].sort();
    const roomDs = HEATING_TYPES.map((type, i) => {
      const ptMap = Object.fromEntries(filterPts(buildSeries(type)).map(p=>[p.x, p.y]));
      return {
        type:'line', label: ROOM_LABELS[type]||type,
        data: allDates.map(d => ptMap[d] ?? null),
        borderColor: COLORS[type], backgroundColor: COLORS[type]+'22',
        borderWidth:1.5, pointRadius:2, fill:false, tension:0.3,
        spanGaps: false
      };
    });
    makeChart('chart-daily-rooms', allDates.map(fmtDate), roomDs, 'ед/день', {stacked:false, type:'line'});
  }
}

// ─── IMPORT TARIFFS FROM SHEET ───────────────────────────────
const TARIFF_TYPE_MAP = {
  'электр': 'electricity',
  'вода':   'water',
  'отопл':  'heating',
};

function mapTariffType(raw) {
  const t = raw.trim().toLowerCase();
  for(const [key, val] of Object.entries(TARIFF_TYPE_MAP)) {
    if(t.includes(key)) return val;
  }
  return null;
}

let parsedTariffRows = [];

function previewTariffImport() {
  const text = document.getElementById('tariff-import-text').value;
  const lines = text.split('\n').map(l=>l.trim()).filter(l=>l);
  parsedTariffRows = [];
  const errors = [], skipped = [];

  // Detect header
  let startIdx = 0;
  if(lines.length && /дат|date|тип|type/i.test(lines[0])) startIdx = 1;

  // Detect column indices
  let colDate=0, colType=1, colFixed=2, colRate=3;
  if(startIdx===1) {
    const hcols = lines[0].split('\t').map(c=>c.trim().toLowerCase());
    const di = hcols.findIndex(c=>c.includes('дат')||c.includes('date'));
    const ti = hcols.findIndex(c=>c==='тип'||c==='type'||c.includes('тип'));
    const fi = hcols.findIndex(c=>c.includes('фикс')||c.includes('fixed'));
    const ri = hcols.findIndex(c=>c.includes('цен')||c.includes('unit')||c.includes('price'));
    if(di>=0) colDate=di;
    if(ti>=0) colType=ti;
    if(fi>=0) colFixed=fi;
    if(ri>=0) colRate=ri;
  }

  for(let i=startIdx; i<lines.length; i++) {
    const parts = lines[i].split('\t');
    const needed = Math.max(colDate, colType, colFixed, colRate) + 1;
    if(parts.length < needed) {
      // Try with just 4 columns if colRate < parts.length
      if(parts.length < 3) { errors.push(`Стр.${i+1}: мало колонок`); continue; }
    }

    const dateStr  = (parts[colDate]||'').trim();
    const typeStr  = (parts[colType]||'').trim();
    const fixedStr = (parts[colFixed]||'0').trim();
    const rateStr  = (parts[Math.min(colRate, parts.length-1)]||'').trim();

    const date = parseSheetDate(dateStr);
    if(!date) { errors.push(`Стр.${i+1}: дата "${dateStr}"`); continue; }

    const type = mapTariffType(typeStr);
    if(!type) { errors.push(`Стр.${i+1}: тип "${typeStr}"`); continue; }

    const fixed_cost = parseSheetValue(fixedStr);
    const rate = parseSheetValue(rateStr);
    if(isNaN(rate)) { errors.push(`Стр.${i+1}: цена "${rateStr}"`); continue; }

    // Check duplicate
    const exists = tariffs.some(t=>t.type===type && t.effective_from===date);
    if(exists) { skipped.push(`${date} ${type}`); continue; }

    parsedTariffRows.push({effective_from: date, type, fixed_cost: isNaN(fixed_cost)?0:fixed_cost, rate});
  }

  // Stats
  const statsEl = document.getElementById('tariff-import-stats');
  const parts2 = [];
  if(parsedTariffRows.length) parts2.push(`<span style="color:var(--success)">${parsedTariffRows.length} тарифов готово</span>`);
  if(skipped.length) parts2.push(`<span style="color:var(--muted)">⏭ ${skipped.length} уже есть</span>`);
  if(errors.length) parts2.push(`<span style="color:var(--heat)">${errors.length} ошибок</span>`);
  statsEl.innerHTML = parts2.join(' · ');

  const errEl = document.getElementById('tariff-import-errors');
  if(errors.length) { errEl.style.display='block'; errEl.innerHTML=errors.join('<br>'); }
  else errEl.style.display='none';

  const wrap = document.getElementById('tariff-import-preview-wrap');
  const typeLabels = {electricity:'Электричество', water:'Вода', heating:'Отопление'};
  if(parsedTariffRows.length) {
    wrap.style.display='block';
    document.getElementById('tariff-import-preview-body').innerHTML = parsedTariffRows.map(r=>`
      <tr style="border-top:1px solid var(--border)">
        <td style="padding:5px 10px">${fmtDate(r.effective_from)}</td>
        <td style="padding:5px 10px">${typeLabels[r.type]||r.type}</td>
        <td style="padding:5px 10px">${r.fixed_cost}</td>
        <td style="padding:5px 10px">${r.rate}</td>
        <td style="padding:5px 10px;color:var(--success);font-size:11px">добавить</td>
      </tr>`).join('');
  } else {
    wrap.style.display='none';
  }

  const btn = document.getElementById('do-tariff-import-btn');
  btn.disabled = parsedTariffRows.length===0;
  btn.textContent = parsedTariffRows.length ? `Загрузить ${parsedTariffRows.length}` : 'Загрузить';
}

async function doTariffImport() {
  if(!parsedTariffRows.length) return;
  const btn = document.getElementById('do-tariff-import-btn');
  btn.disabled = true; btn.textContent = 'Загружаю…';
  try {
    const {data, error} = await sb.from('tariffs').insert(parsedTariffRows).select();
    if(error) throw error;
    tariffs.push(...data);
    closeTariffImportModal();
    refreshAll();
    toast(`Загружено ${data.length} тарифов`,'ok');
  } catch(e) {
    toast('Ошибка: '+e.message,'err');
    btn.disabled=false;
    btn.textContent=`Загрузить ${parsedTariffRows.length}`;
  }
}

function openTariffImportModal() {
  document.getElementById('tariff-import-text').value='';
  document.getElementById('tariff-import-stats').innerHTML='';
  document.getElementById('tariff-import-errors').style.display='none';
  document.getElementById('tariff-import-preview-wrap').style.display='none';
  document.getElementById('do-tariff-import-btn').disabled=true;
  document.getElementById('do-tariff-import-btn').textContent='Загрузить';
  parsedTariffRows=[];
  document.getElementById('tariff-import-modal').classList.add('open');
}
function closeTariffImportModal() { document.getElementById('tariff-import-modal').classList.remove('open'); }

// ─── IMPORT FROM SHEET ────────────────────────────────────────
const TYPE_MAP = {
  'электричество': {fn:(room)=>'electricity'},
  'вода':          {fn:(room)=> room.includes('кухн')?'water_kitchen':'water_bathroom'},
  'отопление':     {fn:(room)=>{
    if(room.includes('ванн'))   return 'heating_bathroom';
    if(room.includes('кухн'))   return 'heating_kitchen';
    if(room.includes('спальн')) return 'heating_bedroom';
    if(room.includes('детск'))  return 'heating_kids';
    if(room.includes('зал')||room.includes('гостин')) return 'heating_living';
    return null;
  }},
};

function parseSheetDate(s) {
  const m = s.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if(!m) return null;
  return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
}

function parseSheetValue(s) {
  return parseFloat(s.replace(/\s/g,'').replace(',','.'));
}

function mapType(typeRaw, roomRaw) {
  const t = typeRaw.trim().toLowerCase();
  const r = (roomRaw||'').trim().toLowerCase();
  for(const [key, cfg] of Object.entries(TYPE_MAP)) {
    if(t.includes(key)) return cfg.fn(r);
  }
  return null;
}

let parsedImportRows = [];

function previewImport() {
  const text = document.getElementById('import-text').value;
  const lines = text.split('\n').map(l=>l.trim()).filter(l=>l);
  parsedImportRows = [];
  const errors = [];
  const skipped = [];

  // Detect header
  let startIdx = 0;
  if(lines.length && /дат|date|тип|type/i.test(lines[0])) startIdx = 1;

  // Detect column indices from header or assume default
  let colDate=0, colType=1, colRoom=2, colValue=3;
  if(startIdx===1) {
    const hcols = lines[0].split('\t').map(c=>c.trim().toLowerCase());
    const di = hcols.findIndex(c=>c.includes('дат')||c==='date');
    const ti = hcols.findIndex(c=>c==='type'||c.includes('тип'));
    const ri = hcols.findIndex(c=>c==='room'||c.includes('ком'));
    const vi = hcols.findIndex(c=>c.includes('показ')||c.includes('value')||c.includes('знач'));
    if(di>=0) colDate=di;
    if(ti>=0) colType=ti;
    if(ri>=0) colRoom=ri;
    if(vi>=0) colValue=vi;
  }

  for(let i=startIdx; i<lines.length; i++) {
    const parts = lines[i].split('\t');
    if(parts.length < Math.max(colDate,colType,colValue)+1) {
      errors.push(`Стр.${i+1}: мало колонок (${parts.length})`); continue;
    }
    const dateStr  = parts[colDate]||'';
    const typeStr  = parts[colType]||'';
    const roomStr  = colRoom < parts.length ? (parts[colRoom]||'') : '';
    const valueStr = parts[colValue]||'';

    const date = parseSheetDate(dateStr);
    if(!date){ errors.push(`Стр.${i+1}: дата "${dateStr}"`); continue; }

    const value = parseSheetValue(valueStr);
    if(isNaN(value)){ errors.push(`Стр.${i+1}: значение "${valueStr}"`); continue; }

    const type = mapType(typeStr, roomStr);
    if(!type){ errors.push(`Стр.${i+1}: тип "${typeStr}" комната "${roomStr}"`); continue; }

    // Detect reset: value < last reading of this type
    const sorted = getTypeReadings(type);
    const last = sorted.length ? sorted[sorted.length-1] : null;
    const is_reset = !!(last && value < last.value);

    // Check duplicate
    const exists = readings.some(r=>r.date===date&&r.type===type&&r.value===value);
    if(exists){ skipped.push(`${date} ${type}`); continue; }

    parsedImportRows.push({date, type, value, is_reset});
  }

  // Stats
  const statsEl = document.getElementById('import-stats');
  const parts2 = [];
  if(parsedImportRows.length) parts2.push(`<span style="color:var(--success)">${parsedImportRows.length} строк готово</span>`);
  if(skipped.length) parts2.push(`<span style="color:var(--muted)">⏭ ${skipped.length} уже есть</span>`);
  if(errors.length) parts2.push(`<span style="color:var(--heat)">${errors.length} ошибок</span>`);
  statsEl.innerHTML = parts2.join(' · ');

  // Errors
  const errEl = document.getElementById('import-errors');
  if(errors.length){ errEl.style.display='block'; errEl.innerHTML=errors.join('<br>'); }
  else errEl.style.display='none';

  // Preview
  const wrap = document.getElementById('import-preview-wrap');
  if(parsedImportRows.length) {
    wrap.style.display='block';
    const tbody = document.getElementById('import-preview-body');
    tbody.innerHTML = parsedImportRows.slice(0,200).map(r=>{
      const cfg = TYPES[r.type];
      const resetBadge = r.is_reset ? ' <span style="color:#f87171;font-size:10px">замена?</span>' : '';
      return `<tr style="border-top:1px solid var(--border)">
        <td style="padding:5px 10px">${fmtDate(r.date)}</td>
        <td style="padding:5px 10px"><span class="tag ${cfg.tag}">${cfg.label}</span></td>
        <td style="padding:5px 10px">${r.value} ${cfg.unit}${resetBadge}</td>
        <td style="padding:5px 10px;color:var(--success);font-size:11px">добавить</td>
      </tr>`;
    }).join('');
    if(parsedImportRows.length>200) {
      document.getElementById('import-preview-body').innerHTML += `<tr><td colspan="4" style="padding:8px 10px;color:var(--muted);text-align:center">…ещё ${parsedImportRows.length-200} строк</td></tr>`;
    }
  } else {
    wrap.style.display='none';
  }

  document.getElementById('do-import-btn').disabled = parsedImportRows.length===0;
  document.getElementById('do-import-btn').textContent = parsedImportRows.length ? `Загрузить ${parsedImportRows.length}` : 'Загрузить';
}

async function doImport() {
  if(!parsedImportRows.length) return;
  const btn = document.getElementById('do-import-btn');
  btn.disabled = true;

  // Ask about resets
  const resets = parsedImportRows.filter(r=>r.is_reset);
  if(resets.length) {
    const ok = await askConfirm({title:'Замена счётчика?', message:`Записей, где значение меньше предыдущего: ${resets.length}. Отметить их как замену счётчика?`, ok:'Отметить', cancel:'Нет'});
    if(!ok) parsedImportRows.forEach(r=>{ if(r.is_reset) r.is_reset=false; });
  }

  try {
    const CHUNK = 50;
    for(let i=0; i<parsedImportRows.length; i+=CHUNK) {
      btn.textContent = `Загружаю… ${Math.min(i+CHUNK,parsedImportRows.length)}/${parsedImportRows.length}`;
      const {error} = await sb.from('readings').insert(parsedImportRows.slice(i,i+CHUNK));
      if(error) throw error;
    }
    await loadAll();
    closeImportModal();
    refreshAll();
    toast(`Загружено ${parsedImportRows.length} показаний`,'ok');
  } catch(e) {
    toast('Ошибка: '+e.message,'err');
    btn.disabled=false;
    btn.textContent=`Загрузить ${parsedImportRows.length}`;
  }
}

function openImportModal() {
  document.getElementById('import-text').value='';
  document.getElementById('import-stats').innerHTML='';
  document.getElementById('import-errors').style.display='none';
  document.getElementById('import-preview-wrap').style.display='none';
  document.getElementById('do-import-btn').disabled=true;
  document.getElementById('do-import-btn').textContent='Загрузить';
  parsedImportRows=[];
  document.getElementById('import-modal').classList.add('open');
}
function closeImportModal(){ document.getElementById('import-modal').classList.remove('open'); }

// ═══════════════════════════════════════════════════════════════
// BUDGET / ADVANCES PAGE
// ═══════════════════════════════════════════════════════════════

let editingAdvanceId = null, editingSettlementId = null;
let budgetYear = new Date().getFullYear();
let inflationPct = 0;
let elecPeriodFrom = localStorage.getItem('elecPeriodFrom') || null;

// ── Helpers ────────────────────────────────────────────────────
function getLastSettlement(type) {
  const s = settlements.filter(x => x.type === type);
  if (!s.length) return null;
  return s.reduce((a, b) => b.period_year > a.period_year ? b : a);
}

function getSettlementForYear(type, year) {
  return settlements.find(s => s.type === type && s.period_year === year) || null;
}

function isLeapYear(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }

// Return {fromDate, toDate, isCurrent, isPast}
function getBudgetPeriod() {
  const curYear = new Date().getFullYear();
  const fromDate = `${budgetYear}-01-01`;
  const toDate   = budgetYear < curYear
    ? `${budgetYear}-12-31`
    : localISO();
  return { fromDate, toDate, isCurrent: budgetYear === curYear, isPast: budgetYear < curYear };
}

function getBudgetYears() {
  const s = new Set([new Date().getFullYear(), new Date().getFullYear() - 1]);
  for (const a of advances)    s.add(parseInt(a.effective_from.slice(0,4)));
  for (const x of settlements) { s.add(x.period_year); s.add(x.period_year + 1); }
  return [...s].sort();
}

// ── Electricity period helpers ────────────────────────────────
function getElecPeriodFrom() {
  if (elecPeriodFrom) return elecPeriodFrom;
  // Default: day after last electricity settlement coverage, or Jan 1 of current year
  const lastE = getLastSettlement('electricity');
  if (lastE) return `${lastE.period_year + 1}-01-01`;
  return `${new Date().getFullYear()}-01-01`;
}

function setElecPeriodFrom(val) {
  elecPeriodFrom = val || null;
  if (val) localStorage.setItem('elecPeriodFrom', val);
  else localStorage.removeItem('elecPeriodFrom');
  refreshAll();
}

function calcMonthProrated(monthlyAmount, start, end) {
  let total = 0;
  let cur = new Date(start.getFullYear(), start.getMonth(), 1);
  const endTime = end.getTime();
  while (cur.getTime() <= endTime) {
    const mEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
    const dInMonth = mEnd.getDate();
    const overlapStart = new Date(Math.max(start.getTime(), cur.getTime()));
    const overlapEnd   = new Date(Math.min(endTime, mEnd.getTime()));
    if (overlapEnd >= overlapStart) {
      const days = Math.round((overlapEnd - overlapStart) / 86400000) + 1;
      total += monthlyAmount * days / dInMonth;
    }
    cur.setMonth(cur.getMonth() + 1);
  }
  return total;
}

// Sum advances paid for a given type from fromDate through toDate (inclusive).
// Uses exact calendar-month counting so 12 full months = exactly 12 × rate.
function calcAdvancesPaid(type, fromDate, toDate) {
  const relevant = advances.filter(a => a.type === type)
    .sort((a,b) => a.effective_from.localeCompare(b.effective_from));
  if (!relevant.length) return 0;
  const from = new Date(fromDate), to = new Date(toDate);
  if (to < from) return 0;
  let total = 0;
  for (let i = 0; i < relevant.length; i++) {
    const adv = relevant[i], next = relevant[i+1];
    const segStart = new Date(Math.max(new Date(adv.effective_from).getTime(), from.getTime()));
    const segEnd   = next
      ? new Date(Math.min(new Date(next.effective_from).getTime()-1, to.getTime()))
      : to;
    if (segEnd < segStart) continue;
    total += calcMonthProrated(adv.monthly_amount, segStart, segEnd);
  }
  return total;
}

// Sum actual costs (variable+fixed) for category between fromDate and toDate.
function sumCostBetween(category, fromDate, toDate) {
  const fromKey = fromDate.slice(0,7);
  const toKey   = toDate.slice(0,7);
  const all = getAllMonthlyData();
  let total = 0;
  if (category === 'electricity') {
    for (const [k,v] of Object.entries(all.elec))  if (k>=fromKey&&k<=toKey) total += (v.cost||0);
  } else if (category === 'water') {
    for (const [k,v] of Object.entries(all.bath))  if (k>=fromKey&&k<=toKey) total += (v.cost||0);
    for (const [k,v] of Object.entries(all.kitch)) if (k>=fromKey&&k<=toKey) total += (v.cost||0);
  } else if (category === 'heating') {
    for (const [k,v] of Object.entries(all.heat))  if (k>=fromKey&&k<=toKey) total += (v.cost||0);
  }
  // Fixed costs per month (ключи 'ГГГГ-ММ', без Date: нет сдвигов часового пояса)
  for (let key = fromKey; key <= toKey; key = addMonthsKey(key, 1)) total += monthFixed(category, key);
  return total;
}

// Legacy alias (used by other code)
function sumCostSince(category, fromDate) {
  return sumCostBetween(category, fromDate, localISO());
}

// ── Year selector & inflation ─────────────────────────────────
let parsedAdvanceRows = [];

function openAdvanceImportModal() {
  parsedAdvanceRows=[];
  document.getElementById('adv-import-text').value='';
  document.getElementById('adv-import-stats').innerHTML='';
  document.getElementById('adv-import-errors').style.display='none';
  document.getElementById('adv-import-preview-wrap').style.display='none';
  document.getElementById('do-adv-import-btn').disabled=true;
  document.getElementById('advance-import-modal').classList.add('open');
}
function closeAdvanceImportModal() { document.getElementById('advance-import-modal').classList.remove('open'); }

function previewAdvanceImport() {
  const lines=document.getElementById('adv-import-text').value.split('\n').map(l=>l.trim()).filter(l=>l);
  parsedAdvanceRows=[]; const errors=[],skipped=[];
  const sep=lines[0]?.includes('\t')?'\t':';';
  let start=0; if(lines.length&&/дат|date|тип|type/i.test(lines[0]))start=1;
  for(let i=start;i<lines.length;i++){
    const parts=lines[i].split(sep).map(p=>p.trim());
    if(parts.length<3){errors.push(`Стр.${i+1}: мало колонок`);continue;}
    const [dateStr,typeStr,amtStr]=parts;
    let date=null;
    const m1=dateStr.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/),m2=dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(m1) date=`${m1[3]}-${m1[2].padStart(2,'0')}-${m1[1].padStart(2,'0')}`;
    else if(m2) date=dateStr;
    else{errors.push(`Стр.${i+1}: дата "${dateStr}"`);continue;}
    const t=typeStr.toLowerCase();
    let type=null;
    if(t.includes('electr')||t.includes('электр'))type='electricity';
    else if(t.includes('komm')||t.includes('комм')||t.includes('nk'))type='kommunalka';
    else{errors.push(`Стр.${i+1}: тип "${typeStr}"`);continue;}
    const amount=parseFloat(amtStr.replace(',','.'));
    if(isNaN(amount)||amount<=0){errors.push(`Стр.${i+1}: сумма "${amtStr}"`);continue;}
    if(advances.some(a=>a.effective_from===date&&a.type===type)){skipped.push(`${date} ${type}`);continue;}
    parsedAdvanceRows.push({effective_from:date,type,monthly_amount:amount});
  }
  const typeLabels={electricity:'Электричество',kommunalka:'Коммуналка'};
  const stats=[];
  if(parsedAdvanceRows.length)stats.push(`<span style="color:var(--success)">${parsedAdvanceRows.length} готово</span>`);
  if(skipped.length)stats.push(`<span style="color:var(--muted)">⏭ ${skipped.length} уже есть</span>`);
  if(errors.length)stats.push(`<span style="color:var(--heat)">${errors.length} ошибок</span>`);
  document.getElementById('adv-import-stats').innerHTML=stats.join(' · ');
  const errEl=document.getElementById('adv-import-errors');
  if(errors.length){errEl.style.display='block';errEl.innerHTML=errors.join('<br>');}else errEl.style.display='none';
  const wrap=document.getElementById('adv-import-preview-wrap');
  if(parsedAdvanceRows.length){
    wrap.style.display='block';
    document.getElementById('adv-import-preview-body').innerHTML=parsedAdvanceRows.map(r=>`
      <tr style="border-top:1px solid var(--border)">
        <td style="padding:5px 8px">${fmtDate(r.effective_from)}</td>
        <td style="padding:5px 8px">${typeLabels[r.type]}</td>
        <td style="padding:5px 8px">${fmtE(r.monthly_amount)}</td>
        <td style="padding:5px 8px;color:var(--success);font-size:11px">добавить</td>
      </tr>`).join('');
  } else wrap.style.display='none';
  const btn=document.getElementById('do-adv-import-btn');
  btn.disabled=!parsedAdvanceRows.length;
  btn.textContent=parsedAdvanceRows.length?`Загрузить ${parsedAdvanceRows.length}`:'Загрузить';
}

async function doAdvanceImport() {
  if(!parsedAdvanceRows.length)return;
  const btn=document.getElementById('do-adv-import-btn');
  btn.disabled=true;btn.textContent='Загружаю…';
  try{
    const{data,error}=await sb.from('advances').insert(parsedAdvanceRows).select();
    if(error)throw error;
    advances.push(...data);closeAdvanceImportModal();refreshAll();
    toast(`Загружено ${data.length} авансов`,'ok');
  }catch(e){
    toast('Ошибка: '+e.message,'err');btn.disabled=false;
    btn.textContent=`Загрузить ${parsedAdvanceRows.length}`;
  }
}

// ── Advance Modal ──────────────────────────────────────────────
function openAdvanceModal(id) {
  editingAdvanceId = id || null;
  const modal = document.getElementById('advance-modal');
  document.getElementById('del-adv-btn').hidden = !id;
  modal.classList.add('open');
  document.querySelector('#advance-modal .modal-title').textContent = id ? 'Редактировать аванс' : 'Новый аванс';
  document.getElementById('adv-date').value   = localISO();
  document.getElementById('adv-type').value   = 'electricity';
  document.getElementById('adv-amount').value = '';
  if (id) {
    const a = advances.find(x => x.id === id);
    if (a) {
      document.getElementById('adv-date').value   = a.effective_from;
      document.getElementById('adv-type').value   = a.type;
      document.getElementById('adv-amount').value = a.monthly_amount;
    }
  }
}

function closeAdvanceModal() {
  document.getElementById('advance-modal').classList.remove('open');
  editingAdvanceId = null;
}

async function saveAdvance() {
  const date   = document.getElementById('adv-date').value;
  const type   = document.getElementById('adv-type').value;
  const amount = parseFloat(document.getElementById('adv-amount').value);
  if (!date || !type || isNaN(amount) || amount <= 0) { toast('Заполните все поля','err'); return; }
  const btn = document.getElementById('save-adv-btn');
  btn.disabled = true;
  try {
    const row = { effective_from: date, type, monthly_amount: amount };
    if (editingAdvanceId) {
      const { data, error } = await sb.from('advances').update(row).eq('id', editingAdvanceId).select().single();
      if (error) throw error;
      const idx = advances.findIndex(a => a.id === editingAdvanceId);
      if (idx >= 0) advances[idx] = data;
    } else {
      const { data, error } = await sb.from('advances').insert(row).select().single();
      if (error) throw error;
      advances.push(data);
    }
    closeAdvanceModal();
    refreshAll();
  } catch(e) { toast('Ошибка: '+e.message,'err'); }
  finally { btn.disabled = false; }
}

async function deleteAdvance(id) {
  if (!await askConfirm({title:'Удалить запись аванса?', ok:'Удалить', danger:true})) return;
  const { error } = await sb.from('advances').delete().eq('id', id);
  if (error) { toast('Ошибка: '+error.message,'err'); return; }
  advances = advances.filter(a => a.id !== id);
  refreshAll();
}

// ── Settlement Modal ───────────────────────────────────────────
function _settVal(id) { return parseFloat(document.getElementById(id)?.value) || 0; }
function _settSet(id, v) { const el=document.getElementById(id); if(el) el.value = v!=null&&!isNaN(v) ? v : ''; }

// Auto-calculate totals when any field changes
function onSettCalc() {
  const hFixed = _settVal('sett-heat-fixed');
  const hVar   = _settVal('sett-heat-var');
  const wFixed = _settVal('sett-water-fixed');
  const wVar   = _settVal('sett-water-var');

  // Update total fields if we have both components
  if (hFixed || hVar) { const sum=+(hFixed+hVar).toFixed(2); _settSet('sett-heat', sum); }
  if (wFixed || wVar) { const sum=+(wFixed+wVar).toFixed(2); _settSet('sett-water', sum); }

  const total = _settVal('sett-total');
  const water = _settVal('sett-water');
  const heat  = _settVal('sett-heat');
  const other = total>0 && water>0 && heat>0 ? +(total-water-heat).toFixed(2) : null;

  const otherEl = document.getElementById('sett-other-display');
  const pctEl   = document.getElementById('sett-pct-display');
  const hintEl  = document.getElementById('sett-calc-hint');
  if (otherEl) otherEl.textContent = other!=null ? fmtE(other) : '—';
  if (pctEl && total>0) {
    const wp=water/total*100, hp=heat/total*100, op=other!=null?other/total*100:null;
    pctEl.textContent = `Вода ${fmtN(wp,0)}% · Отопл. ${fmtN(hp,0)}%${op!=null?' · Прочее '+fmtN(op,0)+'%':''}`;
  }
  // Show app-calculated hint for reference
  if (hintEl) {
    const yr = parseInt(document.getElementById('sett-year')?.value);
    if (yr && document.getElementById('sett-type')?.value === 'kommunalka') {
      const f = `${yr}-01-01`, t = `${yr}-12-31`;
      const calcW = sumCostBetween('water',   f, t);
      const calcH = sumCostBetween('heating', f, t);
      if (calcW>0 || calcH>0) {
        hintEl.style.display='block';
        hintEl.textContent = `Приложение рассчитало за ${yr}: вода ≈${fmtE(calcW)}, отопление ≈${fmtE(calcH)}`;
      } else hintEl.style.display='none';
    } else hintEl.style.display='none';
  }
}

function onSettTotalChange() { onSettCalc(); }
function onSettYearChange()  { onSettCalc(); }

function openSettlementModal(id) {
  editingSettlementId = id || null;
  document.getElementById('del-sett-btn').hidden = !id;
  document.getElementById('settlement-modal').classList.add('open');
  document.querySelector('#settlement-modal .modal-title').textContent = id ? 'Редактировать расчёт' : 'Годовой расчёт';
  // Clear all
  ['sett-year','sett-total','sett-grundsteuer','sett-heat-fixed','sett-heat-var','sett-heat',
   'sett-water-fixed','sett-water-var','sett-water','sett-correction']
    .forEach(i=>{ const el=document.getElementById(i); if(el) el.value=''; });
  document.getElementById('sett-date').value = localISO();
  document.getElementById('sett-type').value = 'kommunalka';
  const otherEl = document.getElementById('sett-other-display');
  if(otherEl) otherEl.textContent='—';
  updateSettlementFields();

  if (id) {
    const s = settlements.find(x => x.id === id);
    if (s) {
      _settSet('sett-year',        s.period_year);
      _settSet('sett-total',       s.actual_total);
      _settSet('sett-grundsteuer', s.grundsteuer);
      _settSet('sett-heat-fixed',  s.heating_fixed);
      _settSet('sett-heat-var',    s.heating_variable);
      _settSet('sett-heat',        s.heating_portion);
      _settSet('sett-water-fixed', s.water_fixed);
      _settSet('sett-water-var',   s.water_variable);
      _settSet('sett-water',       s.water_portion);
      _settSet('sett-correction',  s.correction);
      document.getElementById('sett-date').value = s.settlement_date;
      document.getElementById('sett-type').value = s.type;
      updateSettlementFields();
      onSettCalc();
    }
  }
}

function closeSettlementModal() {
  document.getElementById('settlement-modal').classList.remove('open');
  editingSettlementId = null;
}

function updateSettlementFields() {
  const isKomm = document.getElementById('sett-type').value === 'kommunalka';
  document.getElementById('sett-komm-fields').style.display = isKomm ? 'block' : 'none';
  const gsWrap = document.getElementById('sett-grundsteuer-wrap');
  if (gsWrap) gsWrap.style.display = isKomm ? '' : 'none';
  if (isKomm) onSettCalc();
}

async function saveSettlement() {
  const year   = parseInt(document.getElementById('sett-year').value);
  const date   = document.getElementById('sett-date').value;
  const type   = document.getElementById('sett-type').value;
  const total  = parseFloat(document.getElementById('sett-total').value);
  const corr   = parseFloat(document.getElementById('sett-correction').value) || 0;
  if (!year || !date || !type || isNaN(total)) { toast('Заполните год, дату и итого','err'); return; }

  let water_portion=null, heating_portion=null, other_portion=null;
  let water_fixed=null, water_variable=null, heating_fixed=null, heating_variable=null;
  if (type === 'kommunalka') {
    const wf=_settVal('sett-water-fixed')||null, wv=_settVal('sett-water-var')||null;
    const hf=_settVal('sett-heat-fixed') ||null, hv=_settVal('sett-heat-var')  ||null;
    water_fixed=wf; water_variable=wv;
    heating_fixed=hf; heating_variable=hv;
    // Use explicit total field, or sum of components
    const w=_settVal('sett-water'), h=_settVal('sett-heat');
    water_portion    = w>0 ? w : (wf&&wv ? +(wf+wv).toFixed(2) : null);
    heating_portion  = h>0 ? h : (hf&&hv ? +(hf+hv).toFixed(2) : null);
    if (water_portion && heating_portion) other_portion = +(total-water_portion-heating_portion).toFixed(2);
  }

  const grundsteuer = type === 'kommunalka' ? (parseFloat(document.getElementById('sett-grundsteuer')?.value) || null) : null;

  const btn = document.getElementById('save-sett-btn');
  btn.disabled = true;
  try {
    const row = { period_year: year, settlement_date: date, type, actual_total: total,
                  water_portion, heating_portion, other_portion, grundsteuer,
                  water_fixed, water_variable, heating_fixed, heating_variable,
                  correction: corr };
    if (editingSettlementId) {
      const { data, error } = await sb.from('settlements').update(row).eq('id', editingSettlementId).select().single();
      if (error) throw error;
      const idx = settlements.findIndex(s => s.id === editingSettlementId);
      if (idx >= 0) settlements[idx] = data;
    } else {
      const { data, error } = await sb.from('settlements').insert(row).select().single();
      if (error) throw error;
      settlements.push(data);
    }
    closeSettlementModal();
    refreshAll();
  } catch(e) { toast('Ошибка: '+e.message,'err'); }
  finally { btn.disabled = false; }
}

async function deleteSettlement(id) {
  if (!await askConfirm({title:'Удалить годовой расчёт?', ok:'Удалить', danger:true})) return;
  const { error } = await sb.from('settlements').delete().eq('id', id);
  if (error) { toast('Ошибка: '+error.message,'err'); return; }
  settlements = settlements.filter(s => s.id !== id);
  refreshAll();
}

// ─── MODAL CLOSE ON BACKDROP ──────────────────────────────────
document.getElementById('tariff-modal').addEventListener('click',function(e){if(e.target===this)closeTariffModal()});
document.getElementById('reading-modal').addEventListener('click',function(e){if(e.target===this)closeReadingModal()});
document.getElementById('import-modal').addEventListener('click',function(e){if(e.target===this)closeImportModal()});
document.getElementById('tariff-import-modal').addEventListener('click',function(e){if(e.target===this)closeTariffImportModal()});
document.getElementById('advance-modal').addEventListener('click',function(e){if(e.target===this)closeAdvanceModal()});
document.getElementById('settlement-modal').addEventListener('click',function(e){if(e.target===this)closeSettlementModal()});
document.getElementById('advance-import-modal').addEventListener('click',function(e){if(e.target===this)closeAdvanceImportModal()});

// ─── START ────────────────────────────────────────────────────
