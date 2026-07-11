/* ===========================================================
   MI NORTE — Finanzas personales (PWA).
   Datos 100% locales (localStorage) + respaldo JSON/CSV.
   =========================================================== */

const STORE_KEY = "mi_norte_data_v2";
const OLD_KEY   = "mi_norte_data_v1";

/* ---------- Catálogos por defecto ---------- */
const DEFAULT_CATEGORIES = {
  expense: ["Comida", "Hogar", "Servicios", "Transporte", "Salud", "Ocio", "Educación", "Deudas", "Ahorro", "Otro"],
  income:  ["Salario", "Negocio", "Venta", "Inversión", "Regalo", "Otro"],
};

/* Paleta de categorías (dirección Aurora — teal se reserva para el degradado de datos) */
const CAT_COLORS = ["#4ade9e", "#6366f1", "#38bdf8", "#ff8a73", "#a78bfa", "#22d3ee", "#fbbf24", "#f472b6", "#2dd4bf", "#94a3b8"];
const GRAD_CSS = "linear-gradient(90deg, var(--grad-a), var(--grad-b))";

const CURRENCIES = [
  { code: "CRC", locale: "es-CR", label: "Colón (₡)" },
  { code: "USD", locale: "en-US", label: "Dólar ($)" },
  { code: "MXN", locale: "es-MX", label: "Peso MX ($)" },
  { code: "EUR", locale: "es-ES", label: "Euro (€)" },
  { code: "COP", locale: "es-CO", label: "Peso CO ($)" },
  { code: "PEN", locale: "es-PE", label: "Sol (S/)" },
  { code: "CLP", locale: "es-CL", label: "Peso CL ($)" },
];

/* Frases para la pantalla de inicio (rotan por día y franja) */
const GATE_PHRASES = [
  "Registrar cada gasto es un acto de amor por tu futuro.",
  "La claridad de hoy construye la tranquilidad de mañana.",
  "Cada colón que anotas es un colón que controlas.",
  "No se trata de gastar menos, sino de decidir mejor.",
  "Tu constancia vale más que cualquier ingreso extra.",
  "Lo que se mide, se mejora. Anota y avanza.",
  "Un minuto registrando hoy te ahorra un dolor de cabeza mañana.",
  "El orden en tu dinero es paz en tu mente.",
  "Pequeños registros diarios, grandes decisiones.",
  "Saber a dónde va tu dinero es saber a dónde vas tú.",
  "Ahorrar empieza por observar.",
  "Hoy eliges: dirigir tu dinero, o que él te dirija a ti.",
];

/* ---------- Semilla ---------- */
const SEED = {
  transactions: [],   // {id, date(ISO), type:'income'|'expense'|'transfer', amount, category, note, ref, account, from, to}
  categories: structuredClone(DEFAULT_CATEGORIES),
  budgets: {},        // {categoria: limiteMensual}
  recurring: [],      // {id, type, amount, category, note, day}
  accounts: [],       // {id, name, kind:'efectivo'|'banco'|'tarjeta'|'otro', opening}
  goals: [],          // {id, name, kind:'ahorro'|'deuda', target, saved}
  settings: { currency: "CRC", locale: "es-CR", decimals: "auto", savingsGoal: 20, reminders: true, reminderDismissed: "", gate: true, gateAM: "", gatePM: "", pin: "" },
};

const ACCOUNT_KINDS = ["efectivo", "banco", "tarjeta", "otro"];
const ACCOUNT_ICON = { efectivo: "💵", banco: "🏦", tarjeta: "💳", otro: "◆" };

/* Ayudas breves (botón "?") */
const HELP = {
  balance: {
    title: "Balance del mes",
    html: `Es <b>lo que entró menos lo que salió</b> este mes.
      <div class="help-eq">Ingresos − Gastos del mes</div>
      <ul>
        <li>No incluye tus saldos iniciales (dinero que ya tenías).</li>
        <li>Las transferencias entre cuentas no cuentan.</li>
        <li>Cambia según el mes que veas con las flechas ‹ ›.</li>
      </ul>`,
  },
  patrimonio: {
    title: "Dinero disponible",
    html: `Es el <b>dinero que tienes ahora</b>, sumando el saldo de todas tus cuentas.
      <div class="help-eq">Saldo inicial + ingresos − gastos ± transferencias</div>
      <ul>
        <li>Sí incluye tus saldos iniciales.</li>
        <li>No depende del mes: es tu foto actual.</li>
      </ul>`,
  },
  savings: {
    title: "Tasa de ahorro",
    html: `Qué parte de tus ingresos <b>te quedó</b> este mes.
      <div class="help-eq">Balance del mes ÷ Ingresos del mes</div>
      <ul>
        <li>Tu meta la defines en Ajustes.</li>
        <li>Los saldos iniciales no la afectan.</li>
      </ul>`,
  },
};

/* ---------- Estado / persistencia ---------- */
let DB = load();
let currentTab = "home";
let viewMonth = monthKeyOf(new Date());   // "YYYY-MM" en foco

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return normalize(JSON.parse(raw));
    const old = localStorage.getItem(OLD_KEY);
    if (old) return migrateV1(JSON.parse(old));
  } catch (e) {}
  return structuredClone(SEED);
}
function normalize(data) {
  const db = Object.assign(structuredClone(SEED), data || {});
  db.categories = Object.assign(structuredClone(DEFAULT_CATEGORIES), db.categories || {});
  db.settings = Object.assign(structuredClone(SEED.settings), db.settings || {});
  db.transactions = Array.isArray(db.transactions) ? db.transactions : [];
  db.recurring = Array.isArray(db.recurring) ? db.recurring : [];
  db.accounts = Array.isArray(db.accounts) ? db.accounts : [];
  db.goals = Array.isArray(db.goals) ? db.goals : [];
  db.budgets = db.budgets && typeof db.budgets === "object" ? db.budgets : {};
  return db;
}
function migrateV1(old) {
  const db = structuredClone(SEED);
  (old.movements || []).forEach(m => {
    db.transactions.push({
      id: m.id || uid(),
      date: m.date || new Date().toISOString(),
      type: m.isIncome ? "income" : "expense",
      amount: Math.abs(+m.amount || 0),
      category: "Otro",
      note: m.note || "",
    });
  });
  return db;
}
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(DB)); }

/* ---------- Helpers de formato ---------- */
/* Decimales prácticos por moneda para el modo "Automático" */
const CURRENCY_DEC = { CRC: 0, CLP: 0, COP: 0, USD: 2, EUR: 2, MXN: 2, PEN: 2 };
function moneyFractionOpts() {
  const d = DB.settings.decimals;
  let fd;
  if (d === 0 || d === "0") fd = 0;
  else if (d === 2 || d === "2") fd = 2;
  else fd = CURRENCY_DEC[DB.settings.currency] ?? 2; // "auto": convención práctica de la moneda
  return { minimumFractionDigits: fd, maximumFractionDigits: fd };
}
function money(n) {
  const s = DB.settings;
  try {
    return new Intl.NumberFormat(s.locale || "es-CR", { style: "currency", currency: s.currency || "CRC", ...moneyFractionOpts() }).format(n || 0);
  } catch (e) {
    return new Intl.NumberFormat("es-CR", { style: "currency", currency: "CRC" }).format(n || 0);
  }
}
const fmt = (n) => money(n);
function fmtHero(n) {
  const s = DB.settings;
  try {
    const parts = new Intl.NumberFormat(s.locale || "es-CR", { style: "currency", currency: s.currency || "CRC", ...moneyFractionOpts() }).formatToParts(n || 0);
    return parts.map(p => p.type === "currency" ? `<span class="cur">${esc(p.value)}</span>` : esc(p.value)).join("");
  } catch (e) { return esc(fmt(n)); }
}
function parseAmount(v) { return parseFloat(String(v || "").replace(",", ".")) || 0; }
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ---------- Helpers de fecha / mes ---------- */
function monthKeyOf(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(mk) {
  const [y, m] = mk.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(DB.settings.locale || "es-CR", { month: "long", year: "numeric" });
}
function shortMonthLabel(mk) {
  const [y, m] = mk.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(DB.settings.locale || "es-CR", { month: "short" });
}
function shiftMonth(mk, delta) {
  const [y, m] = mk.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return monthKeyOf(d);
}
function todayISO() { return new Date().toISOString(); }
function dateInputValue(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function timeInputValue(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function timeStr(iso) {
  return new Date(iso).toLocaleTimeString(DB.settings.locale || "es-CR", { hour: "numeric", minute: "2-digit" });
}
function combineDateTime(dateStr, timeStr) {
  if (!dateStr) return todayISO();
  return new Date(`${dateStr}T${timeStr || "12:00"}:00`).toISOString();
}
function daysInMonth(mk) { const [y, m] = mk.split("-").map(Number); return new Date(y, m, 0).getDate(); }
function isCurrentMonth(mk) { return mk === monthKeyOf(new Date()); }
function todayKeyStr() { return dateInputValue(new Date().toISOString()); }
function registeredToday() { return DB.transactions.some(t => dateInputValue(t.date) === todayKeyStr()); }
function showReminder() {
  return DB.settings.reminders !== false && isCurrentMonth(viewMonth)
    && !registeredToday() && DB.settings.reminderDismissed !== todayKeyStr();
}

/* ---------- Cálculos ---------- */
function txOfMonth(mk) {
  return DB.transactions.filter(t => monthKeyOf(t.date) === mk);
}
function monthTotals(mk) {
  const tx = txOfMonth(mk);
  const income = tx.filter(t => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const expense = tx.filter(t => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const balance = income - expense;
  const savingsRate = income > 0 ? (balance / income) * 100 : 0;
  return { income, expense, balance, savingsRate, count: tx.length };
}
function totalsOf(list) {
  const income = list.filter(t => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const expense = list.filter(t => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const balance = income - expense;
  const savingsRate = income > 0 ? (balance / income) * 100 : 0;
  return { income, expense, balance, savingsRate, count: list.length };
}
function breakdownOf(list, type = "expense") {
  const map = {};
  list.filter(t => t.type === type).forEach(t => {
    const c = t.category || "Otro";
    map[c] = (map[c] || 0) + t.amount;
  });
  const total = Object.values(map).reduce((s, v) => s + v, 0) || 1;
  return Object.entries(map)
    .map(([name, value]) => ({ name, value, pct: value / total * 100, color: catColor(name, type) }))
    .sort((a, b) => b.value - a.value);
}
function categoryBreakdown(mk, type = "expense") { return breakdownOf(txOfMonth(mk), type); }
function txInRange(fromKey, toKey) {
  return DB.transactions.filter(t => { const d = dateInputValue(t.date); return d >= fromKey && d <= toKey; });
}
function txOfYear(y) { return DB.transactions.filter(t => new Date(t.date).getFullYear() === y); }
function allCategories() { return [...new Set([...DB.categories.expense, ...DB.categories.income])]; }
function catColor(name, type = "expense") {
  const list = DB.categories[type] || [];
  const i = list.indexOf(name);
  return CAT_COLORS[(i < 0 ? Math.abs(hash(name)) : i) % CAT_COLORS.length];
}
function hash(s) { let h = 0; for (let i = 0; i < String(s).length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
function lastMonths(n) {
  const arr = [];
  let mk = monthKeyOf(new Date());
  for (let i = 0; i < n; i++) { arr.unshift(mk); mk = shiftMonth(mk, -1); }
  return arr;
}
function projectionForMonth(mk) {
  if (!isCurrentMonth(mk)) return null;
  const now = new Date();
  const dayOfMonth = now.getDate();
  const dim = daysInMonth(mk);
  const { expense } = monthTotals(mk);
  if (dayOfMonth <= 0) return null;
  return Math.round(expense / dayOfMonth * dim);
}
function budgetStatus(mk) {
  const bd = categoryBreakdown(mk, "expense");
  const spentBy = {}; bd.forEach(b => spentBy[b.name] = b.value);
  return Object.entries(DB.budgets)
    .filter(([, limit]) => limit > 0)
    .map(([name, limit]) => {
      const spent = spentBy[name] || 0;
      return { name, limit, spent, pct: Math.min(100, spent / limit * 100), over: spent > limit, color: catColor(name, "expense") };
    })
    .sort((a, b) => b.pct - a.pct);
}

/* ---- Cuentas ---- */
function accountsExist() { return DB.accounts.length > 0; }
function accountName(id) { const a = DB.accounts.find(x => x.id === id); return a ? a.name : ""; }
function accountBalance(id) {
  const a = DB.accounts.find(x => x.id === id); if (!a) return 0;
  let bal = a.opening || 0;
  DB.transactions.forEach(t => {
    if (t.type === "income" && t.account === id) bal += t.amount;
    else if (t.type === "expense" && t.account === id) bal -= t.amount;
    else if (t.type === "transfer") { if (t.from === id) bal -= t.amount; if (t.to === id) bal += t.amount; }
  });
  return bal;
}
function netWorth() { return DB.accounts.reduce((s, a) => s + accountBalance(a.id), 0); }

/* ---- Perfil financiero (para el simulador de compra) ---- */
function avgOf(field, nBack = 6) {
  const vals = [];
  let mk = shiftMonth(monthKeyOf(new Date()), -1);
  for (let i = 0; i < nBack; i++) { const t = monthTotals(mk); if (t.count > 0) vals.push(t[field]); mk = shiftMonth(mk, -1); }
  if (!vals.length) return monthTotals(monthKeyOf(new Date()))[field];
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}
function financeProfile() {
  const curMk = monthKeyOf(new Date());
  const recExpense = DB.recurring.filter(r => r.type === "expense").reduce((s, r) => s + r.amount, 0);
  const recIncome = DB.recurring.filter(r => r.type === "income").reduce((s, r) => s + r.amount, 0);
  let monthlyIncome = avgOf("income");
  if (monthlyIncome <= 0) monthlyIncome = recIncome || monthTotals(curMk).income;
  let avgExpense = avgOf("expense");
  if (avgExpense <= 0) avgExpense = monthTotals(curMk).expense;
  const dailyAvg = avgExpense > 0 ? avgExpense / 30 : 0;
  return { monthlyIncome, avgExpense, fixedMonthly: recExpense, dailyAvg };
}

/* ---- Metas / deudas ---- */
function goalPct(g) {
  if (!g.target) return 0;
  return Math.max(0, Math.min(100, (g.saved || 0) / g.target * 100));
}

/* ---- Búsqueda ---- */
function txMatches(t, q) {
  if (!q) return true;
  const hay = `${t.note || ""} ${t.category || ""} ${t.ref || ""} ${accountName(t.account)} ${accountName(t.from)} ${accountName(t.to)}`.toLowerCase();
  return hay.includes(q.toLowerCase());
}

/* ---- PIN ---- */
async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1800);
}

/* ===========================================================
   RENDER
   =========================================================== */
function render() {
  const screen = $("#screen");
  screen.innerHTML = SCREENS[currentTab]();
  screen.scrollTop = 0;
  WIRE[currentTab]?.(screen);
  $$(".tab").forEach(b => b.classList.toggle("on", b.dataset.tab === currentTab));
}
const SCREENS = {};
const WIRE = {};

/* Navegador de mes reutilizable */
function monthNav() {
  return `
    <div class="monthnav">
      <button class="mn-btn" data-mn="-1" aria-label="Mes anterior">‹</button>
      <div class="mn-label">${esc(monthLabel(viewMonth))}${isCurrentMonth(viewMonth) ? "" : ""}</div>
      <button class="mn-btn" data-mn="1" aria-label="Mes siguiente" ${isCurrentMonth(viewMonth) ? "disabled" : ""}>›</button>
    </div>`;
}
function wireMonthNav(root) {
  $$("[data-mn]", root).forEach(b => b.onclick = () => {
    const next = shiftMonth(viewMonth, +b.dataset.mn);
    if (+b.dataset.mn > 0 && next > monthKeyOf(new Date())) return;
    viewMonth = next; render();
  });
}

/* Anillo de progreso con degradado (SVG) */
function ring(pct) {
  const p = Math.max(0, Math.min(100, pct || 0));
  const r = 26, c = 2 * Math.PI * r, dash = p / 100 * c;
  return `<svg class="ring" viewBox="0 0 60 60" aria-hidden="true">
    <circle cx="30" cy="30" r="${r}" fill="none" stroke="var(--fill)" stroke-width="7"/>
    <circle cx="30" cy="30" r="${r}" fill="none" stroke="url(#grad-ring)" stroke-width="7" stroke-linecap="round"
      stroke-dasharray="${dash} ${c - dash}" transform="rotate(-90 30 30)"/>
  </svg>`;
}

/* Sparkline con degradado (SVG) */
function sparkline(values) {
  const n = values.length;
  if (n < 2) return `<div class="muted">Aún no hay suficiente historial.</div>`;
  const min = Math.min(...values), max = Math.max(...values), span = (max - min) || 1;
  const W = 300, H = 60, pad = 8;
  const pts = values.map((v, i) => {
    const x = i * (W / (n - 1));
    const y = H - pad - ((v - min) / span) * (H - 2 * pad);
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  });
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;
  const last = pts[n - 1];
  return `<svg class="spark-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${area}" fill="url(#grad-fill)"/>
    <path d="${line}" fill="none" stroke="url(#grad-data)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="3.4" fill="var(--grad-b)"/>
  </svg>`;
}

/* Anillo de dona (SVG) */
function donut(segments, centerTop, centerBottom) {
  const size = 168, stroke = 20, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  let offset = 0;
  const total = segments.reduce((s, x) => s + x.value, 0);
  const top = segments.reduce((m, s) => s.value > m ? s.value : m, 0);
  const arcs = total > 0 ? segments.map(s => {
    const len = s.value / total * c;
    const dash = `${len} ${c - len}`;
    const stroke2 = (s.value === top) ? "url(#grad-data)" : s.color;
    const el = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${stroke2}" stroke-width="${stroke}" stroke-dasharray="${dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${size / 2} ${size / 2})" stroke-linecap="butt"/>`;
    offset += len;
    return el;
  }).join("") : `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--fill)" stroke-width="${stroke}"/>`;
  return `
    <div class="donut-wrap">
      <svg viewBox="0 0 ${size} ${size}" class="donut">${arcs}</svg>
      <div class="donut-center">
        <div class="dc-top">${centerTop}</div>
        <div class="dc-bottom">${centerBottom}</div>
      </div>
    </div>`;
}

/* ---------------- RESUMEN (Inicio) ---------------- */
SCREENS.home = () => {
  const t = monthTotals(viewMonth);
  const prevMk = shiftMonth(viewMonth, -1);
  const prev = monthTotals(prevMk);
  const proj = projectionForMonth(viewMonth);
  const sparkVals = lastMonths(6).map(mk => monthTotals(mk).balance);
  const balDelta = t.balance - prev.balance;
  const hasHistory = DB.transactions.length > 0;
  const budgets = budgetStatus(viewMonth).filter(b => b.over || b.pct >= 80).slice(0, 3);
  const recent = [...DB.transactions].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 4);
  const goal = DB.settings.savingsGoal || 0;
  const balancePos = t.balance >= 0;

  const delta = (cur, old) => {
    if (!old) return "";
    const d = cur - old;
    const sign = d > 0 ? "▲" : d < 0 ? "▼" : "•";
    const cls = d > 0 ? "up" : d < 0 ? "down" : "flat";
    return `<span class="delta ${cls}">${sign} ${fmt(Math.abs(d))}</span>`;
  };

  return `
    <div class="head"><h1>Resumen</h1><p>Tus finanzas de un vistazo.</p></div>
    ${accountsExist() ? networthBannerHTML() : ""}
    ${monthNav()}

    ${showReminder() ? `
    <div class="reminder" id="reminder">
      <div class="rem-ic">🔔</div>
      <div class="rem-txt"><strong>Aún no registras movimientos hoy</strong><span>Un toque para mantener tus finanzas al día.</span></div>
      <button class="rem-x" id="rem-dismiss" aria-label="Descartar">✕</button>
    </div>` : ""}

    <div class="hero">
      <div class="hero-label">Balance del mes ${helpBtn("balance")}</div>
      <div class="hero-value">${balancePos ? "" : "−"}${fmtHero(Math.abs(t.balance))}</div>
      ${(prev.count || hasHistory) ? `<div class="hero-delta ${balDelta > 0 ? "up" : balDelta < 0 ? "down" : "flat"}">${balDelta > 0 ? "▲" : balDelta < 0 ? "▼" : "•"} ${fmt(Math.abs(balDelta))} <span class="muted">vs. ${esc(shortMonthLabel(prevMk))}</span></div>` : ""}
      <div class="hero-sub">
        <span><i class="dot in"></i>Ingresos <span class="v">${fmt(t.income)}</span></span>
        <span><i class="dot out"></i>Gastos <span class="v">${fmt(t.expense)}</span></span>
      </div>
    </div>

    <div class="kpis">
      <div class="kpi">
        <div class="kpi-k">Tasa de ahorro ${helpBtn("savings")}</div>
        <div class="kpi-ring">${ring(t.savingsRate)}<div class="kpi-ringv">${Math.round(t.savingsRate)}%</div></div>
        <div class="kpi-foot">${goal ? (t.savingsRate >= goal ? `Meta ${goal}% · superada` : `Meta ${goal}%`) : "Sin meta"}</div>
      </div>
      <div class="kpi">
        <div class="kpi-k">${isCurrentMonth(viewMonth) ? "Proyección de gasto" : "Movimientos"}</div>
        <div class="kpi-v">${proj != null ? fmt(proj) : t.count}</div>
        <div class="kpi-foot">${proj != null ? "estimado a fin de mes" : "registrados este mes"}</div>
      </div>
    </div>

    ${hasHistory ? `
    <div class="card spark-card">
      <div class="spark-cap"><span class="lbl">Balance · 6 meses</span><span class="v">${fmt(sparkVals[sparkVals.length - 1])}</span></div>
      <div class="gap"></div>
      ${sparkline(sparkVals)}
    </div>` : ""}

    <div class="btn-row">
      <button class="btn" id="h-expense">− Registrar gasto</button>
      <button class="btn ghost" id="h-income">+ Ingreso</button>
    </div>
    <button class="btn line sim-cta" id="h-sim">🧮 ¿Puedo permitirme una compra?</button>

    <div class="card">
      <div class="row"><h2 style="margin:0">Comparado con ${esc(shortMonthLabel(shiftMonth(viewMonth, -1)))}</h2></div>
      <div class="gap"></div>
      <div class="cmp"><span>Ingresos</span><span>${fmt(t.income)} ${delta(t.income, prev.income)}</span></div>
      <div class="cmp"><span>Gastos</span><span>${fmt(t.expense)} ${delta(t.expense, prev.expense)}</span></div>
      <div class="cmp"><span>Balance</span><span>${fmt(t.balance)} ${delta(t.balance, prev.balance)}</span></div>
    </div>

    ${budgets.length ? `
    <div class="card">
      <h2>Alertas de presupuesto</h2>
      ${budgets.map(b => `
        <div class="bud">
          <div class="bud-top"><span><i class="cdot" style="background:${b.color}"></i>${esc(b.name)}</span>
            <span class="${b.over ? "over" : "warn-t"}">${fmt(b.spent)} / ${fmt(b.limit)}</span></div>
          <div class="kpi-bar"><i style="width:${b.pct}%;background:${b.over ? "var(--red)" : "var(--amber)"}"></i></div>
        </div>`).join("")}
    </div>` : ""}

    ${DB.goals.length ? goalsCardHTML() : ""}

    <div class="card">
      <div class="row"><h2 style="margin:0">Últimos movimientos</h2><button class="linkbtn" id="h-all">Ver todos</button></div>
      <div class="gap"></div>
      ${recent.length ? recent.map(t => txRow(t)).join("") : `<div class="muted">Aún no hay movimientos. Registra el primero arriba.</div>`}
    </div>
  `;
};
WIRE.home = (root) => {
  wireMonthNav(root);
  const rem = $("#reminder", root);
  if (rem) {
    rem.onclick = (e) => { if (e.target.id !== "rem-dismiss") openTx("expense"); };
    $("#rem-dismiss", root).onclick = (e) => {
      e.stopPropagation();
      DB.settings.reminderDismissed = todayKeyStr(); save(); render();
    };
  }
  $("#h-expense", root).onclick = () => openTx("expense");
  $("#h-income", root).onclick = () => openTx("income");
  $("#h-all", root).onclick = () => { currentTab = "money"; render(); };
  const hg = $("#h-goals", root); if (hg) hg.onclick = openGoals;
  const nwm = $("#nw-manage", root); if (nwm) nwm.onclick = openAccounts;
  $("#h-sim", root).onclick = openSimulator;
  wireTxRows(root);
};

/* Fila de movimiento (tocar para editar) */
function txRow(t, opts = {}) {
  const isTransfer = t.type === "transfer";
  const inc = t.type === "income";
  const col = isTransfer ? "var(--tint)" : catColor(t.category, t.type);
  const dstr = new Date(t.date).toLocaleDateString(DB.settings.locale || "es-CR", { day: "numeric", month: "short" });
  const when = `${dstr}, ${timeStr(t.date)}`;
  let title, sub;
  if (isTransfer) {
    title = "Transferencia";
    sub = `${when} · ${esc(accountName(t.from))} → ${esc(accountName(t.to))}`;
  } else {
    title = t.note || t.category || (inc ? "Ingreso" : "Gasto");
    const parts = [when, esc(t.category || "Otro")];
    if (accountsExist() && t.account) parts.push(esc(accountName(t.account)));
    if (t.ref) parts.push(`N.° ${esc(t.ref)}`);
    sub = parts.join(" · ");
  }
  const icon = isTransfer ? "⇄" : (inc ? "↑" : "↓");
  const amtCls = isTransfer ? "tr" : (inc ? "in" : "out");
  const amtTxt = isTransfer ? fmt(t.amount) : `${inc ? "+" : "−"}${fmt(t.amount)}`;
  return `
    <div class="list-item">
      <button class="mov-ic" style="color:${col}" data-edit-tx="${t.id}" aria-label="Editar">${icon}</button>
      <div class="grow" data-edit-tx="${t.id}">
        <div class="t">${esc(title)}</div>
        <div class="s">${sub}</div>
      </div>
      <div class="amt ${amtCls}">${amtTxt}</div>
      ${opts.deletable ? `<button class="btn small soft-danger" data-del-tx="${t.id}" aria-label="Eliminar">×</button>` : ""}
    </div>`;
}
function editTx(id) {
  const t = DB.transactions.find(x => x.id === id); if (!t) return;
  if (t.type === "transfer") openTransfer(id); else openTx(t.type, id);
}
function wireTxRows(root) {
  $$("[data-del-tx]", root).forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    DB.transactions = DB.transactions.filter(t => t.id !== b.dataset.delTx);
    save(); render(); toast("Movimiento eliminado");
  });
  $$("[data-edit-tx]", root).forEach(el => el.onclick = () => editTx(el.dataset.editTx));
}

/* ---------------- MOVIMIENTOS ---------------- */
let moneyFilter = "all"; // all | income | expense
let moneySearch = "";
let moneyAccount = "";
let moneyCat = "";
function moneyIsGlobal() { return !!(moneySearch.trim() || moneyAccount || moneyCat); }
function movListHTML() {
  const global = moneyIsGlobal();
  let list = (global ? [...DB.transactions] : txOfMonth(viewMonth)).sort((a, b) => new Date(b.date) - new Date(a.date));
  if (moneyFilter !== "all") list = list.filter(x => x.type === moneyFilter);
  if (moneyAccount) list = list.filter(x => x.type === "transfer" ? (x.from === moneyAccount || x.to === moneyAccount) : x.account === moneyAccount);
  if (moneyCat) list = list.filter(x => x.category === moneyCat);
  if (moneySearch.trim()) list = list.filter(x => txMatches(x, moneySearch.trim()));
  if (!list.length) return `<div class="muted">No hay movimientos con estos filtros.</div>`;
  const note = global ? `<div class="listnote">${list.length} resultado${list.length !== 1 ? "s" : ""} en todo el historial</div>` : "";
  const groups = [];
  list.forEach(t => { const k = dateInputValue(t.date); let g = groups.find(x => x.k === k); if (!g) { g = { k, items: [] }; groups.push(g); } g.items.push(t); });
  const body = groups.map(g => {
    const net = g.items.reduce((s, t) => s + (t.type === "income" ? t.amount : t.type === "expense" ? -t.amount : 0), 0);
    const dlabel = new Date(g.items[0].date).toLocaleDateString(DB.settings.locale || "es-CR", global ? { day: "numeric", month: "short", year: "numeric" } : { weekday: "short", day: "numeric", month: "short" });
    return `<div class="day-h"><span>${esc(dlabel)}</span><span class="${net >= 0 ? "in" : "out"}">${net >= 0 ? "+" : "−"}${fmt(Math.abs(net))}</span></div>${g.items.map(t => txRow(t, { deletable: true })).join("")}`;
  }).join("");
  return note + body;
}
function renderMovList(root) {
  const c = $("#mov-list", root || document); if (!c) return;
  c.innerHTML = movListHTML(); wireTxRows(c);
}
SCREENS.money = () => {
  const t = monthTotals(viewMonth);
  const canTransfer = DB.accounts.length >= 2;
  return `
    <div class="head"><h1>Movimientos</h1><p>Cada ingreso y gasto, registrado.</p></div>
    ${monthNav()}

    <div class="sumbar">
      <div class="sb"><div class="sb-k">Ingresos</div><div class="sb-v in">${fmt(t.income)}</div></div>
      <div class="sb"><div class="sb-k">Gastos</div><div class="sb-v out">${fmt(t.expense)}</div></div>
      <div class="sb"><div class="sb-k">Balance</div><div class="sb-v">${fmt(t.balance)}</div></div>
    </div>

    <div class="btn-row">
      <button class="btn" id="m-expense">− Gasto</button>
      <button class="btn ghost" id="m-income">+ Ingreso</button>
    </div>
    ${canTransfer ? `<button class="btn line" id="m-transfer" style="margin-bottom:16px">⇄ Transferencia entre cuentas</button>` : ""}

    <input type="text" id="m-search" placeholder="Buscar en todo el historial…" />
    <div class="gap"></div>
    <div class="filters">
      ${accountsExist() ? `<select id="m-acc"><option value="">Todas las cuentas</option>${DB.accounts.map(a => `<option value="${a.id}" ${moneyAccount === a.id ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select>` : ""}
      <select id="m-cat"><option value="">Todas las categorías</option>${allCategories().map(c => `<option value="${esc(c)}" ${moneyCat === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
    </div>
    <div class="gap"></div>
    <div class="seg" id="m-filter">
      <button data-f="all" class="${moneyFilter === "all" ? "on" : ""}">Todos</button>
      <button data-f="income" class="${moneyFilter === "income" ? "on" : ""}">Ingresos</button>
      <button data-f="expense" class="${moneyFilter === "expense" ? "on" : ""}">Gastos</button>
    </div>
    <div class="gap"></div>

    ${moneyIsGlobal() ? `<button class="btn line small" id="m-clear" style="margin-bottom:12px">Limpiar filtros</button>` : ""}
    <div class="card"><div id="mov-list"></div></div>
  `;
};
WIRE.money = (root) => {
  wireMonthNav(root);
  $("#m-expense", root).onclick = () => openTx("expense");
  $("#m-income", root).onclick = () => openTx("income");
  const tr = $("#m-transfer", root); if (tr) tr.onclick = () => openTransfer();
  $$("#m-filter button", root).forEach(b => b.onclick = () => {
    moneyFilter = b.dataset.f;
    $$("#m-filter button", root).forEach(x => x.classList.toggle("on", x === b));
    renderMovList(root);
  });
  const acc = $("#m-acc", root); if (acc) acc.onchange = () => { moneyAccount = acc.value; render(); };
  const cat = $("#m-cat", root); cat.onchange = () => { moneyCat = cat.value; render(); };
  const clr = $("#m-clear", root); if (clr) clr.onclick = () => { moneySearch = ""; moneyAccount = ""; moneyCat = ""; moneyFilter = "all"; render(); };
  const s = $("#m-search", root);
  s.value = moneySearch;
  s.oninput = () => { moneySearch = s.value; renderMovList(root); };
  renderMovList(root);
};

/* ---------------- REPORTES ---------------- */
let reportMode = "month"; // month | year | range
let reportYear = new Date().getFullYear();
let reportFrom = `${monthKeyOf(new Date())}-01`;
let reportTo = todayKeyStr();
SCREENS.reports = () => {
  const loc = DB.settings.locale || "es-CR";
  const mode = reportMode;
  const curYear = new Date().getFullYear();
  let list, periodLabel, trendSeries = null, proj = null, showBudgets = false;

  if (mode === "month") {
    list = txOfMonth(viewMonth);
    periodLabel = monthLabel(viewMonth);
    proj = projectionForMonth(viewMonth);
    trendSeries = lastMonths(6).map(mk => ({ label: shortMonthLabel(mk), ...monthTotals(mk), cur: mk === viewMonth }));
    showBudgets = true;
  } else if (mode === "year") {
    list = txOfYear(reportYear);
    periodLabel = String(reportYear);
    trendSeries = Array.from({ length: 12 }, (_, m) => {
      const mk = `${reportYear}-${String(m + 1).padStart(2, "0")}`;
      return { label: new Date(reportYear, m, 1).toLocaleDateString(loc, { month: "short" }), ...monthTotals(mk), cur: false };
    });
  } else {
    list = txInRange(reportFrom, reportTo);
    const f = new Date(reportFrom + "T12:00:00").toLocaleDateString(loc, { day: "numeric", month: "short", year: "numeric" });
    const tt = new Date(reportTo + "T12:00:00").toLocaleDateString(loc, { day: "numeric", month: "short", year: "numeric" });
    periodLabel = `${f} – ${tt}`;
  }

  const t = totalsOf(list);
  const bd = breakdownOf(list, "expense");
  const incomeBd = breakdownOf(list, "income");
  const budgets = budgetStatus(viewMonth);

  const trendBars = trendSeries ? (() => {
    const maxBar = Math.max(1, ...trendSeries.map(s => Math.max(s.income, s.expense)));
    return trendSeries.map(s => `
      <div class="trend-col">
        <div class="trend-bars">
          <div class="tb in" style="height:${Math.round(s.income / maxBar * 100)}%" title="Ingresos ${fmt(s.income)}"></div>
          <div class="tb out" style="height:${Math.round(s.expense / maxBar * 100)}%" title="Gastos ${fmt(s.expense)}"></div>
        </div>
        <div class="trend-x ${s.cur ? "on" : ""}">${esc(s.label)}</div>
      </div>`).join("");
  })() : "";

  const catRows = (rows, gradTop = false) => rows.length ? rows.map((r, i) => {
    const paint = (gradTop && i === 0) ? GRAD_CSS : r.color;
    return `
    <div class="catrow">
      <div class="catrow-top"><span><i class="cdot" style="background:${paint}"></i>${esc(r.name)}</span><span>${fmt(r.value)} · ${Math.round(r.pct)}%</span></div>
      <div class="kpi-bar"><i style="width:${r.pct}%;background:${paint}"></i></div>
    </div>`;
  }).join("") : `<div class="muted">Sin datos en este periodo.</div>`;

  let periodNav;
  if (mode === "month") periodNav = monthNav();
  else if (mode === "year") periodNav = `
    <div class="monthnav">
      <button class="mn-btn" data-yr="-1" aria-label="Año anterior">‹</button>
      <div class="mn-label">${reportYear}</div>
      <button class="mn-btn" data-yr="1" aria-label="Año siguiente" ${reportYear >= curYear ? "disabled" : ""}>›</button>
    </div>`;
  else periodNav = `
    <div class="rangebar">
      <label class="field"><span>Desde</span><input type="date" id="rp-from" value="${reportFrom}" /></label>
      <label class="field"><span>Hasta</span><input type="date" id="rp-to" value="${reportTo}" /></label>
    </div>`;

  return `
    <div class="head"><h1>Reportes</h1><p>Entiende a dónde va tu dinero.</p></div>
    <div class="seg" id="rp-mode">
      <button data-m="month" class="${mode === "month" ? "on" : ""}">Mes</button>
      <button data-m="year" class="${mode === "year" ? "on" : ""}">Año</button>
      <button data-m="range" class="${mode === "range" ? "on" : ""}">Rango</button>
    </div>
    <div class="gap"></div>
    ${periodNav}

    <div class="metrics">
      <div class="metric"><div class="v">${Math.round(t.savingsRate)}%</div><div class="k">Tasa de ahorro</div></div>
      <div class="metric"><div class="v">${fmt(t.balance)}</div><div class="k">Balance</div></div>
      <div class="metric"><div class="v">${fmt(t.expense)}</div><div class="k">Gasto total</div></div>
      <div class="metric"><div class="v">${proj != null ? fmt(proj) : t.count}</div><div class="k">${proj != null ? "Proyección fin de mes" : "Movimientos"}</div></div>
    </div>

    <div class="card">
      <h2>Análisis del periodo</h2>
      ${writtenSummary(list, { periodLabel, mode })}
    </div>

    <div class="card">
      <h2>Gasto por categoría</h2>
      ${bd.length ? `
        <div class="donut-row">
          ${donut(bd, `<div class="dc-amt">${fmt(t.expense)}</div>`, `<div class="dc-cap">gastado</div>`)}
          <div class="legend">
            ${bd.slice(0, 6).map((s, i) => `<div class="lg"><i class="cdot" style="background:${i === 0 ? GRAD_CSS : s.color}"></i><span>${esc(s.name)}</span><b>${Math.round(s.pct)}%</b></div>`).join("")}
          </div>
        </div>` : `<div class="muted">Aún no registras gastos en este periodo.</div>`}
    </div>

    ${trendSeries ? `
    <div class="card">
      <h2>Tendencia (${mode === "year" ? "12 meses" : "6 meses"})</h2>
      <div class="trend">${trendBars}</div>
      <div class="trend-legend"><span><i class="dot in"></i>Ingresos</span><span><i class="dot out"></i>Gastos</span></div>
    </div>` : ""}

    <div class="card">
      <h2>Detalle de gastos</h2>
      ${catRows(bd, true)}
    </div>

    <div class="card">
      <h2>Ingresos por fuente</h2>
      ${catRows(incomeBd)}
    </div>

    ${showBudgets ? `
    <div class="card">
      <div class="row"><h2 style="margin:0">Presupuestos</h2><button class="linkbtn" id="r-budgets">Editar</button></div>
      <div class="gap"></div>
      ${budgets.length ? budgets.map(b => `
        <div class="bud">
          <div class="bud-top"><span><i class="cdot" style="background:${b.color}"></i>${esc(b.name)}</span>
            <span class="${b.over ? "over" : ""}">${fmt(b.spent)} / ${fmt(b.limit)}</span></div>
          <div class="kpi-bar"><i style="width:${b.pct}%;background:${b.over ? "var(--red)" : b.pct >= 80 ? "var(--amber)" : "var(--green)"}"></i></div>
        </div>`).join("") : `<div class="muted">Sin presupuestos. Defínelos para recibir alertas.</div>`}
    </div>` : ""}

    <div class="card">
      <h2>Exportar informe</h2>
      <div class="hint">Informe completo de ${esc(periodLabel)} con gráficas y resúmenes, o los movimientos en CSV.</div>
      <div class="gap"></div>
      <button class="btn" id="r-pdf">📄 Descargar informe (PDF)</button>
      <div class="gap"></div>
      <button class="btn line" id="r-csv">Exportar movimientos (CSV)</button>
    </div>
  `;
};
WIRE.reports = (root) => {
  $$("#rp-mode button", root).forEach(b => b.onclick = () => { reportMode = b.dataset.m; render(); });
  if (reportMode === "month") wireMonthNav(root);
  else if (reportMode === "year") {
    $$("[data-yr]", root).forEach(b => b.onclick = () => {
      const ny = reportYear + (+b.dataset.yr);
      if (ny > new Date().getFullYear()) return;
      reportYear = ny; render();
    });
  } else {
    const f = $("#rp-from", root), tt = $("#rp-to", root);
    f.onchange = () => { reportFrom = f.value; render(); };
    tt.onchange = () => { reportTo = tt.value; render(); };
  }
  const rb = $("#r-budgets", root); if (rb) rb.onclick = openBudgets;
  $("#r-pdf", root).onclick = openReportPreview;
  $("#r-csv", root).onclick = () => {
    let listX, nameX;
    if (reportMode === "month") { listX = txOfMonth(viewMonth); nameX = `mi-norte-${viewMonth}.csv`; }
    else if (reportMode === "year") { listX = txOfYear(reportYear); nameX = `mi-norte-${reportYear}.csv`; }
    else { listX = txInRange(reportFrom, reportTo); nameX = `mi-norte-${reportFrom}_a_${reportTo}.csv`; }
    exportCSV([...listX].sort((a, b) => new Date(a.date) - new Date(b.date)), nameX);
  };
};

/* ---------------- AJUSTES ---------------- */
SCREENS.settings = () => {
  const s = DB.settings;
  return `
    <div class="head"><h1>Ajustes</h1><p>Personaliza y respalda.</p></div>

    <div class="card">
      <h2>Moneda</h2>
      <label class="field"><span>Moneda para mostrar tus montos</span>
        <select id="s-currency">
          ${CURRENCIES.map(c => `<option value="${c.code}" ${c.code === s.currency ? "selected" : ""}>${c.label}</option>`).join("")}
        </select></label>
    </div>

    <div class="card">
      <h2>Decimales</h2>
      <div class="seg" id="s-dec">
        <button data-d="auto" class="${String(s.decimals || "auto") === "auto" ? "on" : ""}">Automático</button>
        <button data-d="0" class="${String(s.decimals) === "0" ? "on" : ""}">Sin decimales</button>
        <button data-d="2" class="${String(s.decimals) === "2" ? "on" : ""}">2 decimales</button>
      </div>
      <div class="hint">Automático usa lo habitual de tu moneda (el colón no suele usar decimales; el dólar y el euro sí, con centavos).</div>
    </div>

    <div class="card">
      <h2>Meta de ahorro</h2>
      <label class="field"><span>Porcentaje de tus ingresos que quieres ahorrar</span>
        <input type="number" id="s-goal" value="${s.savingsGoal || 0}" min="0" max="100" inputmode="numeric" /></label>
      <div class="hint">Se usa en el Resumen para medir tu progreso.</div>
    </div>

    <div class="card">
      <div class="row"><h2 style="margin:0">Recordatorio diario</h2>
        <label class="switch"><input type="checkbox" id="s-reminders" ${s.reminders !== false ? "checked" : ""} /><span class="sl"></span></label>
      </div>
      <div class="hint">Muestra un aviso en el Resumen cuando no has registrado ningún movimiento en el día.</div>
    </div>

    <div class="card">
      <div class="row"><h2 style="margin:0">Pantalla de inicio</h2>
        <label class="switch"><input type="checkbox" id="s-gate" ${s.gate !== false ? "checked" : ""} /><span class="sl"></span></label>
      </div>
      <div class="hint">Una pantalla completa con una frase, en la mañana y en la noche, para invitarte a registrar tus movimientos.</div>
    </div>

    <div class="card">
      <div class="row"><h2 style="margin:0">Categorías</h2></div>
      <div class="hint">Personaliza tus categorías de gastos e ingresos.</div>
      <div class="gap"></div>
      <button class="btn line" id="s-cat-expense">Categorías de gasto (${DB.categories.expense.length})</button>
      <div class="gap"></div>
      <button class="btn line" id="s-cat-income">Categorías de ingreso (${DB.categories.income.length})</button>
    </div>

    <div class="card">
      <div class="row"><h2 style="margin:0">Presupuestos</h2><button class="linkbtn" id="s-budgets">Editar</button></div>
      <div class="hint">Define un límite mensual por categoría para recibir alertas.</div>
    </div>

    <div class="card">
      <div class="row"><h2 style="margin:0">Movimientos fijos</h2><button class="linkbtn" id="s-recurring">Gestionar</button></div>
      <div class="hint">Ingresos o gastos que se repiten cada mes (salario, alquiler, etc.). Regístralos con un toque.</div>
      ${DB.recurring.length ? `<div class="gap"></div>${DB.recurring.map(r => `
        <div class="list-item">
          <span class="cdot" style="background:${catColor(r.category, r.type)}"></span>
          <div class="grow"><div class="t">${esc(r.note || r.category)}</div><div class="s">Día ${r.day} · ${esc(r.category)}</div></div>
          <div class="amt ${r.type === "income" ? "in" : "out"}">${r.type === "income" ? "+" : "−"}${fmt(r.amount)}</div>
          <button class="btn small line" data-add-rec="${r.id}">Registrar</button>
        </div>`).join("")}` : ""}
    </div>

    <div class="card">
      <div class="row"><h2 style="margin:0">Cuentas</h2><button class="linkbtn" id="s-accounts">Gestionar</button></div>
      <div class="hint">Efectivo, banco o tarjeta, con saldo por cuenta y transferencias entre ellas.</div>
      ${accountsExist() ? `<div class="gap"></div>${DB.accounts.map(a => `<div class="list-item"><span class="mov-ic acc-ic">${ACCOUNT_ICON[a.kind] || "◆"}</span><div class="grow"><div class="t">${esc(a.name)}</div><div class="s">${esc(a.kind)}</div></div><div class="amt ${accountBalance(a.id) < 0 ? "out" : ""}">${fmt(accountBalance(a.id))}</div></div>`).join("")}` : ""}
    </div>

    <div class="card">
      <div class="row"><h2 style="margin:0">Metas y deudas</h2><button class="linkbtn" id="s-goals">Gestionar</button></div>
      <div class="hint">Objetivos de ahorro y seguimiento de deudas con progreso.</div>
    </div>

    <div class="card">
      <div class="row"><h2 style="margin:0">Bloqueo con PIN</h2>
        <label class="switch"><input type="checkbox" id="s-pin" ${DB.settings.pin ? "checked" : ""} /><span class="sl"></span></label>
      </div>
      <div class="hint">Pide un PIN de 4 dígitos al abrir la app para proteger tus datos.</div>
    </div>

    <div class="card">
      <h2>Tus datos</h2>
      <div class="hint">Todo se guarda solo en este dispositivo. Haz respaldos con frecuencia.</div>
      <div class="gap"></div>
      <div class="btn-row">
        <button class="btn ghost" id="s-export">Exportar (JSON)</button>
        <button class="btn line" id="s-import">Importar (JSON)</button>
      </div>
      <button class="btn line" id="s-csv-all">Exportar todo (CSV)</button>
      <div class="gap"></div>
      <button class="btn soft-danger" id="s-reset">Borrar todos los datos</button>
      <input type="file" id="s-import-file" accept="application/json" hidden />
    </div>

    <div class="center hint">MI NORTE · Finanzas personales · versión web</div>
  `;
};
WIRE.settings = (root) => {
  $("#s-currency", root).onchange = (e) => {
    const c = CURRENCIES.find(x => x.code === e.target.value);
    DB.settings.currency = c.code; DB.settings.locale = c.locale; save(); render(); toast("Moneda actualizada");
  };
  $("#s-goal", root).onchange = (e) => {
    DB.settings.savingsGoal = Math.max(0, Math.min(100, +e.target.value || 0)); save(); toast("Guardado");
  };
  $$("#s-dec button", root).forEach(b => b.onclick = () => {
    DB.settings.decimals = b.dataset.d === "auto" ? "auto" : +b.dataset.d; save(); render(); toast("Decimales actualizados");
  });
  $("#s-reminders", root).onchange = (e) => {
    DB.settings.reminders = e.target.checked; save(); toast(e.target.checked ? "Recordatorio activado" : "Recordatorio desactivado");
  };
  $("#s-gate", root).onchange = (e) => {
    DB.settings.gate = e.target.checked; save(); toast(e.target.checked ? "Pantalla de inicio activada" : "Pantalla de inicio desactivada");
  };
  $("#s-cat-expense", root).onclick = () => openCategories("expense");
  $("#s-cat-income", root).onclick = () => openCategories("income");
  $("#s-budgets", root).onclick = openBudgets;
  $("#s-recurring", root).onclick = openRecurring;
  $("#s-accounts", root).onclick = openAccounts;
  $("#s-goals", root).onclick = openGoals;
  $("#s-pin", root).onchange = (e) => {
    if (e.target.checked) { openPinSetup(); e.target.checked = !!DB.settings.pin; }
    else {
      if (confirm("¿Quitar el PIN? La app dejará de pedirlo al abrir.")) { DB.settings.pin = ""; save(); toast("PIN desactivado"); }
      else { e.target.checked = true; }
    }
  };
  $$("[data-add-rec]", root).forEach(b => b.onclick = () => {
    const r = DB.recurring.find(x => x.id === b.dataset.addRec); if (!r) return;
    DB.transactions.push({ id: uid(), date: todayISO(), type: r.type, amount: r.amount, category: r.category, note: r.note });
    save(); toast("Registrado"); render();
  });

  $("#s-export", root).onclick = () => {
    const blob = new Blob([JSON.stringify(DB, null, 2)], { type: "application/json" });
    downloadBlob(blob, "mi-norte-respaldo.json");
  };
  $("#s-csv-all", root).onclick = () => exportCSV([...DB.transactions].sort((a, b) => new Date(a.date) - new Date(b.date)), "mi-norte-todo.csv");
  $("#s-import", root).onclick = () => $("#s-import-file", root).click();
  $("#s-import-file", root).onchange = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || typeof data !== "object") throw 0;
        DB = normalize(data); save(); render(); toast("Datos importados");
      } catch (err) { toast("Archivo no válido"); }
    };
    reader.readAsText(file);
  };
  $("#s-reset", root).onclick = () => {
    if (confirm("¿Borrar todos tus datos? Esto no se puede deshacer.")) {
      DB = structuredClone(SEED); save(); render(); toast("Datos borrados");
    }
  };
};

/* ===========================================================
   HOJAS / MODALES
   =========================================================== */
function openSheet(html, { fullscreen = false } = {}) {
  const root = $("#sheet-root");
  root.innerHTML = `<div class="sheet-backdrop ${fullscreen ? "sheet-fullscreen" : ""}"><div class="sheet"><div class="sheet-grip"></div>${html}</div></div>`;
  const bd = $(".sheet-backdrop", root);
  bd.addEventListener("click", (e) => { if (e.target === bd) closeSheet(); });
  return root;
}
function closeSheet() { $("#sheet-root").innerHTML = ""; }

/* Botón "?" y su mini ventana */
function helpBtn(key) { return `<button class="help" data-help="${key}" aria-label="Cómo funciona">?</button>`; }
function openHelp(key) {
  const h = HELP[key]; if (!h) return;
  openSheet(`
    <div class="toolbar"><h2 style="margin:0">${esc(h.title)}</h2><button class="x" onclick="closeSheet()">✕</button></div>
    <div class="help-body">${h.html}</div>
    <div class="gap"></div>
    <button class="btn" onclick="closeSheet()">Entendido</button>
  `);
}

/* ---- Registrar movimiento (ingreso o gasto) ---- */
function openTx(type, editId) {
  const editing = editId ? DB.transactions.find(t => t.id === editId) : null;
  const isIncome = editing ? editing.type === "income" : type === "income";
  const cats = DB.categories[isIncome ? "income" : "expense"];
  const sel = { category: editing ? editing.category : cats[0], account: editing ? editing.account : (DB.accounts[0] && DB.accounts[0].id) };

  openSheet(`
    <h2>${editing ? "Editar movimiento" : isIncome ? "Registrar ingreso" : "Registrar gasto"}</h2>
    <label class="field"><span>Monto</span>
      <input type="number" id="tx-amt" inputmode="decimal" placeholder="0" value="${editing ? editing.amount : ""}" /></label>
    <label class="field"><span>Descripción (opcional)</span>
      <input type="text" id="tx-note" placeholder="${isIncome ? "Salario, venta…" : "¿En qué?"}" value="${editing ? esc(editing.note) : ""}" /></label>
    <div class="rangebar">
      <label class="field"><span>Fecha</span><input type="date" id="tx-date" value="${dateInputValue(editing ? editing.date : todayISO())}" /></label>
      <label class="field"><span>Hora</span><input type="time" id="tx-time" value="${timeInputValue(editing ? editing.date : todayISO())}" /></label>
    </div>
    <label class="field"><span>N.° de comprobante / referencia (opcional)</span>
      <input type="text" id="tx-ref" placeholder="Ej. factura 00123" value="${editing ? esc(editing.ref) : ""}" /></label>
    <div class="label">Categoría</div>
    <div class="chips" id="tx-cats">
      ${cats.map(c => `<button data-c="${esc(c)}" class="${c === sel.category ? "on" : ""}">${esc(c)}</button>`).join("")}
    </div>
    ${accountsExist() ? `<div class="gap"></div><div class="label">Cuenta</div>
    <div class="chips" id="tx-accs">${DB.accounts.map(a => `<button data-a="${a.id}" class="${a.id === sel.account ? "on" : ""}">${esc(a.name)}</button>`).join("")}</div>` : ""}
    <div class="gap"></div>
    <button class="btn" id="tx-save">${editing ? "Guardar cambios" : "Guardar"}</button>
    <div class="gap"></div><button class="btn line" onclick="closeSheet()">Cancelar</button>
  `, { fullscreen: true });

  $$("#tx-cats button").forEach(b => b.onclick = () => {
    sel.category = b.dataset.c;
    $$("#tx-cats button").forEach(x => x.classList.toggle("on", x === b));
  });
  $$("#tx-accs button").forEach(b => b.onclick = () => {
    sel.account = b.dataset.a;
    $$("#tx-accs button").forEach(x => x.classList.toggle("on", x === b));
  });
  $("#tx-save").onclick = () => {
    const amt = parseFloat(($("#tx-amt").value || "").replace(",", ".")) || 0;
    if (amt <= 0) return toast("Escribe un monto");
    const date = combineDateTime($("#tx-date").value, $("#tx-time").value);
    const data = { type: isIncome ? "income" : "expense", amount: amt, category: sel.category, note: $("#tx-note").value.trim(), ref: $("#tx-ref").value.trim(), account: accountsExist() ? sel.account : undefined };
    if (editing) { Object.assign(editing, data, { date }); }
    else { DB.transactions.push({ id: uid(), date, ...data }); }
    save(); closeSheet(); render();
    toast(editing ? "Actualizado" : isIncome ? "Ingreso registrado" : "Gasto registrado");
  };
}

/* ---- Gestionar categorías ---- */
function openCategories(type) {
  const title = type === "income" ? "Categorías de ingreso" : "Categorías de gasto";
  const draw = () => {
    openSheet(`
      <div class="toolbar"><h2 style="margin:0">${title}</h2><button class="x" onclick="closeSheet()">✕</button></div>
      <div class="card">
        <ul class="clean" id="cat-list">
          ${DB.categories[type].map(c => `<li class="row"><span><i class="cdot" style="background:${catColor(c, type)}"></i>${esc(c)}</span>
            <button class="btn small soft-danger" data-del-cat="${esc(c)}">Quitar</button></li>`).join("")}
        </ul>
        <div class="gap"></div>
        <label class="field"><span>Nueva categoría</span><input type="text" id="new-cat" placeholder="Nombre" /></label>
        <button class="btn ghost" id="add-cat">Agregar categoría</button>
      </div>
    `, { fullscreen: true });

    $("#add-cat").onclick = () => {
      const v = $("#new-cat").value.trim();
      if (!v) return;
      if (DB.categories[type].includes(v)) return toast("Ya existe");
      DB.categories[type].push(v); save(); draw();
    };
    $$("[data-del-cat]").forEach(b => b.onclick = () => {
      const c = b.dataset.delCat;
      if (DB.categories[type].length <= 1) return toast("Deja al menos una");
      DB.categories[type] = DB.categories[type].filter(x => x !== c);
      if (type === "expense") delete DB.budgets[c];
      save(); draw();
    });
  };
  draw();
}

/* ---- Presupuestos ---- */
function openBudgets() {
  openSheet(`
    <div class="toolbar"><h2 style="margin:0">Presupuestos</h2><button class="x" onclick="closeSheet()">✕</button></div>
    <p class="hint">Define un límite mensual por categoría de gasto. Deja en 0 para no limitar.</p>
    <div class="card">
      ${DB.categories.expense.map(c => `
        <label class="field bud-field"><span><i class="cdot" style="background:${catColor(c, "expense")}"></i>${esc(c)}</span>
          <input type="number" data-bud="${esc(c)}" inputmode="decimal" placeholder="0" value="${DB.budgets[c] || ""}" /></label>
      `).join("")}
    </div>
    <button class="btn" id="bud-save">Guardar presupuestos</button>
    <div class="gap"></div><button class="btn line" onclick="closeSheet()">Cerrar</button>
  `, { fullscreen: true });

  $("#bud-save").onclick = () => {
    $$("[data-bud]").forEach(inp => {
      const v = parseAmount(inp.value);
      if (v > 0) DB.budgets[inp.dataset.bud] = v; else delete DB.budgets[inp.dataset.bud];
    });
    save(); closeSheet(); render(); toast("Presupuestos guardados");
  };
}

/* ---- Movimientos fijos (recurrentes) ---- */
function openRecurring() {
  const draw = () => {
    openSheet(`
      <div class="toolbar"><h2 style="margin:0">Movimientos fijos</h2><button class="x" onclick="closeSheet()">✕</button></div>
      <p class="hint">Plantillas que se repiten cada mes. Regístralas con un toque desde Ajustes.</p>
      ${DB.recurring.length ? `<div class="card">${DB.recurring.map(r => `
        <div class="list-item">
          <span class="cdot" style="background:${catColor(r.category, r.type)}"></span>
          <div class="grow"><div class="t">${esc(r.note || r.category)}</div><div class="s">Día ${r.day} · ${esc(r.category)} · ${r.type === "income" ? "Ingreso" : "Gasto"}</div></div>
          <div class="amt ${r.type === "income" ? "in" : "out"}">${r.type === "income" ? "+" : "−"}${fmt(r.amount)}</div>
          <button class="btn small soft-danger" data-del-rec="${r.id}">×</button>
        </div>`).join("")}</div>` : `<div class="card muted">Aún no tienes movimientos fijos.</div>`}

      <div class="card">
        <h2>Nuevo fijo</h2>
        <div class="seg" id="rec-type"><button data-t="expense" class="on">Gasto</button><button data-t="income">Ingreso</button></div>
        <div class="gap"></div>
        <label class="field"><span>Monto</span><input type="number" id="rec-amt" inputmode="decimal" placeholder="0" /></label>
        <label class="field"><span>Descripción</span><input type="text" id="rec-note" placeholder="Alquiler, salario…" /></label>
        <label class="field"><span>Día del mes</span><input type="number" id="rec-day" min="1" max="31" value="1" /></label>
        <div class="label">Categoría</div>
        <div class="chips" id="rec-cats"></div>
        <div class="gap"></div>
        <button class="btn" id="rec-add">Agregar fijo</button>
      </div>
    `, { fullscreen: true });

    let recType = "expense";
    let recCat = DB.categories.expense[0];
    const paintCats = () => {
      const cats = DB.categories[recType];
      if (!cats.includes(recCat)) recCat = cats[0];
      $("#rec-cats").innerHTML = cats.map(c => `<button data-c="${esc(c)}" class="${c === recCat ? "on" : ""}">${esc(c)}</button>`).join("");
      $$("#rec-cats button").forEach(b => b.onclick = () => {
        recCat = b.dataset.c; $$("#rec-cats button").forEach(x => x.classList.toggle("on", x === b));
      });
    };
    paintCats();
    $$("#rec-type button").forEach(b => b.onclick = () => {
      recType = b.dataset.t; $$("#rec-type button").forEach(x => x.classList.toggle("on", x === b)); paintCats();
    });
    $("#rec-add").onclick = () => {
      const amt = parseFloat(($("#rec-amt").value || "").replace(",", ".")) || 0;
      if (amt <= 0) return toast("Escribe un monto");
      const day = Math.max(1, Math.min(31, +$("#rec-day").value || 1));
      DB.recurring.push({ id: uid(), type: recType, amount: amt, category: recCat, note: $("#rec-note").value.trim(), day });
      save(); draw();
    };
    $$("[data-del-rec]").forEach(b => b.onclick = () => {
      DB.recurring = DB.recurring.filter(r => r.id !== b.dataset.delRec); save(); draw();
    });
  };
  draw();
}

/* ---- Transferencia entre cuentas ---- */
function openTransfer(editId) {
  if (DB.accounts.length < 2) return toast("Necesitas al menos 2 cuentas");
  const ed = editId ? DB.transactions.find(t => t.id === editId) : null;
  const sel = { from: ed ? ed.from : DB.accounts[0].id, to: ed ? ed.to : DB.accounts[1].id };
  openSheet(`
    <h2>${ed ? "Editar transferencia" : "Transferencia"}</h2>
    <label class="field"><span>Monto</span><input type="number" id="tr-amt" inputmode="decimal" placeholder="0" value="${ed ? ed.amount : ""}" /></label>
    <div class="rangebar">
      <label class="field"><span>Fecha</span><input type="date" id="tr-date" value="${dateInputValue(ed ? ed.date : todayISO())}" /></label>
      <label class="field"><span>Hora</span><input type="time" id="tr-time" value="${timeInputValue(ed ? ed.date : todayISO())}" /></label>
    </div>
    <div class="label">Desde</div>
    <div class="chips" id="tr-from">${DB.accounts.map(a => `<button data-a="${a.id}" class="${a.id === sel.from ? "on" : ""}">${esc(a.name)}</button>`).join("")}</div>
    <div class="gap"></div><div class="label">Hacia</div>
    <div class="chips" id="tr-to">${DB.accounts.map(a => `<button data-a="${a.id}" class="${a.id === sel.to ? "on" : ""}">${esc(a.name)}</button>`).join("")}</div>
    <div class="gap"></div>
    <label class="field"><span>Nota (opcional)</span><input type="text" id="tr-note" value="${ed ? esc(ed.note) : ""}" /></label>
    <button class="btn" id="tr-save">${ed ? "Guardar cambios" : "Registrar transferencia"}</button>
    <div class="gap"></div>
    ${ed ? `<button class="btn soft-danger" id="tr-del">Eliminar</button><div class="gap"></div>` : ""}
    <button class="btn line" onclick="closeSheet()">Cancelar</button>
  `, { fullscreen: true });
  $$("#tr-from button").forEach(b => b.onclick = () => { sel.from = b.dataset.a; $$("#tr-from button").forEach(x => x.classList.toggle("on", x === b)); });
  $$("#tr-to button").forEach(b => b.onclick = () => { sel.to = b.dataset.a; $$("#tr-to button").forEach(x => x.classList.toggle("on", x === b)); });
  $("#tr-save").onclick = () => {
    const amt = parseFloat(($("#tr-amt").value || "").replace(",", ".")) || 0;
    if (amt <= 0) return toast("Escribe un monto");
    if (sel.from === sel.to) return toast("Elige cuentas distintas");
    const date = combineDateTime($("#tr-date").value, $("#tr-time").value);
    const data = { type: "transfer", amount: amt, from: sel.from, to: sel.to, note: $("#tr-note").value.trim() };
    if (ed) Object.assign(ed, data, { date }); else DB.transactions.push({ id: uid(), date, ...data });
    save(); closeSheet(); render(); toast(ed ? "Transferencia actualizada" : "Transferencia registrada");
  };
  if (ed) $("#tr-del").onclick = () => { DB.transactions = DB.transactions.filter(t => t.id !== ed.id); save(); closeSheet(); render(); toast("Eliminada"); };
}

/* ---- Cuentas ---- */
function accountsCardHTML() {
  return `<div class="card">
    <div class="row"><h2 style="margin:0">Cuentas</h2><strong>${fmt(netWorth())}</strong></div>
    <div class="gap"></div>
    ${DB.accounts.map(a => `<div class="list-item">
      <span class="mov-ic acc-ic">${ACCOUNT_ICON[a.kind] || "◆"}</span>
      <div class="grow"><div class="t">${esc(a.name)}</div><div class="s">${esc(a.kind)}</div></div>
      <div class="amt ${accountBalance(a.id) < 0 ? "out" : ""}">${fmt(accountBalance(a.id))}</div>
    </div>`).join("")}
  </div>`;
}
function networthBannerHTML() {
  const nw = netWorth();
  return `<div class="networth">
    <div class="nw-top">
      <div>
        <div class="nw-label">Dinero disponible ${helpBtn("patrimonio")}</div>
        <div class="nw-value">${nw < 0 ? "−" : ""}${fmtHero(Math.abs(nw))}</div>
      </div>
      <button class="linkbtn" id="nw-manage">Cuentas</button>
    </div>
    <div class="nw-accs">
      ${DB.accounts.map(a => { const bal = accountBalance(a.id); return `<div class="nw-chip"><span class="nw-ic">${ACCOUNT_ICON[a.kind] || "◆"}</span><span class="nw-nm">${esc(a.name)}</span><span class="nw-bal ${bal < 0 ? "neg" : ""}">${fmt(bal)}</span></div>`; }).join("")}
    </div>
  </div>`;
}
function openAccounts() {
  const draw = () => {
    openSheet(`
      <div class="toolbar"><h2 style="margin:0">Cuentas</h2><button class="x" onclick="closeSheet()">✕</button></div>
      <p class="hint">Efectivo, banco o tarjeta. El saldo se calcula con tu saldo inicial más tus movimientos.</p>
      ${DB.accounts.length ? `<div class="card">${DB.accounts.map(a => `
        <div class="list-item">
          <span class="mov-ic acc-ic">${ACCOUNT_ICON[a.kind] || "◆"}</span>
          <div class="grow"><div class="t">${esc(a.name)}</div><div class="s">${esc(a.kind)} · saldo ${fmt(accountBalance(a.id))}</div></div>
          <button class="btn small soft-danger" data-del-acc="${a.id}">×</button>
        </div>`).join("")}</div>` : `<div class="card muted">Aún no tienes cuentas.</div>`}
      <div class="card">
        <h2>Nueva cuenta</h2>
        <label class="field"><span>Nombre</span><input type="text" id="acc-name" placeholder="Ej. Banco, Efectivo" /></label>
        <div class="label">Tipo</div>
        <div class="seg" id="acc-kind">${ACCOUNT_KINDS.map((k, i) => `<button data-k="${k}" class="${i === 0 ? "on" : ""}">${k[0].toUpperCase() + k.slice(1)}</button>`).join("")}</div>
        <div class="gap"></div>
        <label class="field"><span>Saldo inicial</span><input type="number" id="acc-open" inputmode="decimal" placeholder="0" /></label>
        <button class="btn" id="acc-add">Agregar cuenta</button>
      </div>
    `, { fullscreen: true });
    let kind = ACCOUNT_KINDS[0];
    $$("#acc-kind button").forEach(b => b.onclick = () => { kind = b.dataset.k; $$("#acc-kind button").forEach(x => x.classList.toggle("on", x === b)); });
    $("#acc-add").onclick = () => {
      const name = $("#acc-name").value.trim(); if (!name) return toast("Ponle un nombre");
      DB.accounts.push({ id: uid(), name, kind, opening: parseAmount($("#acc-open").value) }); save(); draw();
    };
    $$("[data-del-acc]").forEach(b => b.onclick = () => {
      const id = b.dataset.delAcc;
      const used = DB.transactions.some(t => t.account === id || t.from === id || t.to === id);
      if (used && !confirm("Esta cuenta tiene movimientos. Si la borras, esos movimientos quedarán sin cuenta. ¿Continuar?")) return;
      DB.accounts = DB.accounts.filter(a => a.id !== id); save(); draw();
    });
  };
  draw();
}

/* ---- Metas y deudas ---- */
function goalsCardHTML() {
  return `<div class="card">
    <div class="row"><h2 style="margin:0">Metas y deudas</h2><button class="linkbtn" id="h-goals">Gestionar</button></div>
    <div class="gap"></div>
    ${DB.goals.map(g => { const pct = goalPct(g), rem = Math.max(0, (g.target || 0) - (g.saved || 0));
      return `<div class="bud">
        <div class="bud-top"><span>${g.kind === "deuda" ? "🔻" : "🎯"} ${esc(g.name)}</span><span>${fmt(g.saved || 0)} / ${fmt(g.target || 0)}</span></div>
        <div class="kpi-bar"><i style="width:${pct}%"></i></div>
        <div class="hint" style="margin-top:6px">${g.kind === "deuda" ? `Falta pagar ${fmt(rem)}` : `Falta ${fmt(rem)} · ${Math.round(pct)}%`}</div>
      </div>`; }).join("")}
  </div>`;
}
function openGoals() {
  const draw = () => {
    openSheet(`
      <div class="toolbar"><h2 style="margin:0">Metas y deudas</h2><button class="x" onclick="closeSheet()">✕</button></div>
      <p class="hint">Fija un objetivo de ahorro o el total de una deuda, y registra tus aportes o pagos.</p>
      ${DB.goals.length ? `<div class="card">${DB.goals.map(g => { const pct = goalPct(g);
        return `<div class="goal">
          <div class="bud-top"><span>${g.kind === "deuda" ? "🔻" : "🎯"} ${esc(g.name)}</span><span>${fmt(g.saved || 0)} / ${fmt(g.target || 0)}</span></div>
          <div class="kpi-bar"><i style="width:${pct}%"></i></div>
          <div class="btn-row" style="margin:10px 0 0">
            <button class="btn small line" data-add-goal="${g.id}">${g.kind === "deuda" ? "+ Pago" : "+ Aporte"}</button>
            <button class="btn small soft-danger" data-del-goal="${g.id}">Eliminar</button>
          </div>
        </div>`; }).join("")}</div>` : `<div class="card muted">Aún no tienes metas.</div>`}
      <div class="card">
        <h2>Nueva meta</h2>
        <div class="seg" id="goal-kind"><button data-k="ahorro" class="on">Ahorro</button><button data-k="deuda">Deuda</button></div>
        <div class="gap"></div>
        <label class="field"><span>Nombre</span><input type="text" id="goal-name" placeholder="Ej. Fondo de emergencia" /></label>
        <label class="field"><span>Monto objetivo</span><input type="number" id="goal-target" inputmode="decimal" placeholder="0" /></label>
        <label class="field"><span>Ya llevas (opcional)</span><input type="number" id="goal-saved" inputmode="decimal" placeholder="0" /></label>
        <button class="btn" id="goal-add">Crear meta</button>
      </div>
    `, { fullscreen: true });
    let kind = "ahorro";
    $$("#goal-kind button").forEach(b => b.onclick = () => { kind = b.dataset.k; $$("#goal-kind button").forEach(x => x.classList.toggle("on", x === b)); });
    $("#goal-add").onclick = () => {
      const name = $("#goal-name").value.trim(); if (!name) return toast("Ponle un nombre");
      const target = parseAmount($("#goal-target").value); if (target <= 0) return toast("Escribe el objetivo");
      DB.goals.push({ id: uid(), name, kind, target, saved: parseAmount($("#goal-saved").value) }); save(); draw();
    };
    $$("[data-add-goal]").forEach(b => b.onclick = () => {
      const g = DB.goals.find(x => x.id === b.dataset.addGoal); if (!g) return;
      const v = prompt(g.kind === "deuda" ? "¿Cuánto pagaste?" : "¿Cuánto aportaste?");
      const amt = parseFloat((v || "").replace(",", ".")) || 0; if (amt <= 0) return;
      g.saved = (g.saved || 0) + amt; save(); draw();
    });
    $$("[data-del-goal]").forEach(b => b.onclick = () => { DB.goals = DB.goals.filter(g => g.id !== b.dataset.delGoal); save(); draw(); });
  };
  draw();
}

/* ---- Bloqueo con PIN ---- */
function openPinSetup() {
  openSheet(`
    <h2>Crear PIN</h2>
    <p class="hint">Elige un PIN de 4 dígitos; se pedirá al abrir la app. Si lo olvidas, la única forma de recuperar el acceso es borrar los datos, así que anótalo.</p>
    <label class="field"><span>Nuevo PIN</span><input type="password" id="pin-a" inputmode="numeric" maxlength="4" placeholder="••••" /></label>
    <label class="field"><span>Repite el PIN</span><input type="password" id="pin-b" inputmode="numeric" maxlength="4" placeholder="••••" /></label>
    <button class="btn" id="pin-save">Guardar PIN</button>
    <div class="gap"></div><button class="btn line" onclick="closeSheet()">Cancelar</button>
  `);
  $("#pin-save").onclick = async () => {
    const a = $("#pin-a").value.trim(), b = $("#pin-b").value.trim();
    if (!/^\d{4}$/.test(a)) return toast("Deben ser 4 dígitos");
    if (a !== b) return toast("Los PIN no coinciden");
    DB.settings.pin = await sha256(a); save(); closeSheet(); render(); toast("PIN activado");
  };
}
let pinBuffer = "";
function showLock() {
  if (!DB.settings.pin) return;
  if (document.getElementById("lock")) return;
  pinBuffer = "";
  const el = document.createElement("div"); el.className = "lock"; el.id = "lock";
  const dots = () => Array.from({ length: 4 }, (_, i) => `<span class="pd ${i < pinBuffer.length ? "on" : ""}"></span>`).join("");
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];
  el.innerHTML = `
    <div class="lock-inner">
      <div class="lock-title">MI NORTE</div>
      <div class="lock-sub">Ingresa tu PIN</div>
      <div class="pin-dots" id="pin-dots">${dots()}</div>
      <div class="keypad">${keys.map(k => k === "" ? `<span></span>` : `<button class="key" data-k="${k}">${k}</button>`).join("")}</div>
      <button class="lock-forgot" id="lock-forgot">¿Olvidaste tu PIN?</button>
    </div>`;
  document.body.appendChild(el);
  $("#lock-forgot", el).onclick = () => {
    if (confirm("Si olvidaste tu PIN, la única forma de entrar es borrar todos los datos de la app. ¿Borrar y continuar?")) {
      DB = structuredClone(SEED); save(); el.remove(); render();
    }
  };
  const refresh = () => { $("#pin-dots", el).innerHTML = dots(); };
  const check = async () => {
    const h = await sha256(pinBuffer);
    if (h === DB.settings.pin) { el.remove(); }
    else { const inner = $(".lock-inner", el); inner.classList.add("shake"); setTimeout(() => inner.classList.remove("shake"), 420); pinBuffer = ""; refresh(); }
  };
  $$(".key", el).forEach(b => b.onclick = () => {
    const k = b.dataset.k;
    if (k === "⌫") { pinBuffer = pinBuffer.slice(0, -1); refresh(); return; }
    if (pinBuffer.length >= 4) return;
    pinBuffer += k; refresh();
    if (pinBuffer.length === 4) setTimeout(check, 120);
  });
}

/* ---- Simulador de compra ("¿Puedo comprarlo?") ---- */
function simulate(amount, sel) {
  if (!amount || amount <= 0) return `<div class="muted">Escribe un monto para ver el impacto.</div>`;
  const prof = financeProfile();
  const income = prof.monthlyIncome;
  const typicalLeftover = income - prof.avgExpense;   // lo que normalmente te sobra al mes
  const marginAfter = typicalLeftover - amount;
  const savingsTarget = income * (DB.settings.savingsGoal || 0) / 100;

  let verdict, vcls, dot;
  if (income <= 0) { verdict = "Sin datos suficientes"; vcls = "amber"; dot = "🟡"; }
  else if (marginAfter >= savingsTarget && marginAfter >= 0) { verdict = "Cómodo"; vcls = "green"; dot = "🟢"; }
  else if (marginAfter >= 0) { verdict = "Ajustado"; vcls = "amber"; dot = "🟡"; }
  else { verdict = "Riesgoso"; vcls = "red"; dot = "🔴"; }

  const rows = [];
  if (income > 0) rows.push(`Es el <b>${Math.round(amount / income * 100)}%</b> de tu ingreso mensual.`);
  if (prof.dailyAvg > 0) rows.push(`Equivale a <b>${Math.max(1, Math.round(amount / prof.dailyAvg))} días</b> de tu gasto promedio.`);
  rows.push(`Margen típico del mes: <b>${fmt(typicalLeftover)}</b> → después de esta compra: <b>${fmt(marginAfter)}</b>.`);

  const capacity = Math.max(0, typicalLeftover);
  if (capacity > 0) {
    const months = amount / capacity;
    const txt = months < 1 ? `${Math.max(1, Math.round(months * 30))} días` : `${months.toFixed(1)} meses`;
    rows.push(`Retrasaría tus metas de ahorro ~<b>${txt}</b>.`);
  } else {
    rows.push(`Hoy no te sobra al mes, así que saldría de tu colchón${accountsExist() ? ` (${fmt(netWorth())} disponibles)` : ""}.`);
  }

  if (sel.category) {
    const spent = categoryBreakdown(monthKeyOf(new Date()), "expense").find(b => b.name === sel.category)?.value || 0;
    const budget = DB.budgets[sel.category] || 0;
    if (budget > 0) {
      const after = spent + amount;
      rows.push(`En <b>${esc(sel.category)}</b> llevas ${fmt(spent)} de ${fmt(budget)}; con esto irías a <b>${fmt(after)}</b> (${Math.round(after / budget * 100)}%).`);
    }
  }

  const recurringBox = sel.recurring ? `
    <div class="sim-annual">
      <div class="lbl">Costo a futuro (recurrente)</div>
      <div class="row"><span>Al año</span><strong>${fmt(amount * 12)}</strong></div>
      ${income > 0 ? `<div class="row"><span>% de tu ingreso anual</span><strong>${Math.round(amount * 12 / (income * 12) * 100)}%</strong></div>` : ""}
      <div class="row"><span>En 5 años</span><strong>${fmt(amount * 60)}</strong></div>
    </div>` : "";

  return `
    <div class="sim-verdict"><span class="pill ${vcls} big">${dot} ${verdict}</span></div>
    <ul class="sim-list">${rows.map(r => `<li>${r}</li>`).join("")}</ul>
    ${recurringBox}
    ${income <= 0 ? `<div class="hint" style="margin-top:12px">Registra algunos ingresos y gastos para estimaciones más precisas.</div>` : ""}
  `;
}
function openSimulator() {
  const sel = { recurring: false, category: null };
  openSheet(`
    <h2>¿Puedo comprarlo?</h2>
    <p class="hint">Escribe cuánto cuesta y te muestro cómo afecta tu mes y tus metas, usando tu propio historial.</p>
    <label class="field"><span>¿Cuánto cuesta?</span><input type="number" id="sim-amt" inputmode="decimal" placeholder="0" /></label>
    <label class="field"><span>¿Qué es? (opcional)</span><input type="text" id="sim-note" placeholder="Ej. audífonos, suscripción…" /></label>
    <div class="label">Frecuencia</div>
    <div class="seg" id="sim-freq"><button data-f="once" class="on">Una vez</button><button data-f="month">Cada mes</button></div>
    <div class="gap"></div>
    <div class="label">Categoría (opcional)</div>
    <div class="chips" id="sim-cats">${DB.categories.expense.map(c => `<button data-c="${esc(c)}">${esc(c)}</button>`).join("")}</div>
    <div class="gap"></div>
    <div class="card" id="sim-result"></div>
    <div class="gap"></div><button class="btn line" onclick="closeSheet()">Cerrar</button>
  `, { fullscreen: true });

  const paint = () => { $("#sim-result").innerHTML = simulate(parseAmount($("#sim-amt").value), sel); };
  $("#sim-amt").oninput = paint;
  $$("#sim-freq button").forEach(b => b.onclick = () => { sel.recurring = b.dataset.f === "month"; $$("#sim-freq button").forEach(x => x.classList.toggle("on", x === b)); paint(); });
  $$("#sim-cats button").forEach(b => b.onclick = () => {
    sel.category = sel.category === b.dataset.c ? null : b.dataset.c;
    $$("#sim-cats button").forEach(x => x.classList.toggle("on", x.dataset.c === sel.category));
    paint();
  });
  paint();
}

/* ===========================================================
   EXPORTACIÓN
   =========================================================== */
function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function exportCSV(rows, name) {
  if (!rows.length) return toast("No hay datos para exportar");
  const head = ["Fecha", "Hora", "Tipo", "Categoría", "Descripción", "Cuenta", "Comprobante", "Monto"];
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [head.join(",")];
  rows.forEach(t => {
    const tipo = t.type === "income" ? "Ingreso" : t.type === "transfer" ? "Transferencia" : "Gasto";
    const cuenta = t.type === "transfer" ? `${accountName(t.from)} → ${accountName(t.to)}` : accountName(t.account);
    lines.push([
      dateInputValue(t.date),
      timeInputValue(t.date),
      tipo,
      t.type === "transfer" ? "" : (t.category || "Otro"),
      t.note || "",
      cuenta,
      t.ref || "",
      t.amount,
    ].map(cell).join(","));
  });
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, name);
  toast("CSV descargado");
}

/* ===========================================================
   INFORME PDF (vía impresión del sistema → Guardar como PDF)
   =========================================================== */
function reportContext() {
  const loc = DB.settings.locale || "es-CR";
  const mode = reportMode;
  if (mode === "month") {
    return { mode, list: txOfMonth(viewMonth), periodLabel: monthLabel(viewMonth),
      trend: lastMonths(6).map(mk => ({ label: shortMonthLabel(mk), ...monthTotals(mk) })) };
  }
  if (mode === "year") {
    return { mode, list: txOfYear(reportYear), periodLabel: String(reportYear),
      trend: Array.from({ length: 12 }, (_, m) => { const mk = `${reportYear}-${String(m + 1).padStart(2, "0")}`; return { label: new Date(reportYear, m, 1).toLocaleDateString(loc, { month: "short" }), ...monthTotals(mk) }; }) };
  }
  const list = txInRange(reportFrom, reportTo);
  const f = new Date(reportFrom + "T12:00:00").toLocaleDateString(loc, { day: "numeric", month: "short", year: "numeric" });
  const tt = new Date(reportTo + "T12:00:00").toLocaleDateString(loc, { day: "numeric", month: "short", year: "numeric" });
  return { mode, list, periodLabel: `${f} – ${tt}`, trend: null };
}
function reportDonut(segments) {
  const size = 150, stroke = 26, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  let off = 0; const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const arcs = segments.length ? segments.map(s => {
    const len = s.value / total * c;
    const el = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${stroke}" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-off}" transform="rotate(-90 ${size / 2} ${size / 2})"/>`;
    off += len; return el;
  }).join("") : `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#e5e7eb" stroke-width="${stroke}"/>`;
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${arcs}</svg>`;
}
function reportBars(series) {
  if (!series) return "";
  const max = Math.max(1, ...series.map(s => Math.max(s.income, s.expense)));
  return `<div class="rp-trend">${series.map(s => `<div class="rp-tcol"><div class="rp-tbars"><span class="rp-in" style="height:${Math.round(s.income / max * 100)}%"></span><span class="rp-out" style="height:${Math.round(s.expense / max * 100)}%"></span></div><div class="rp-tx">${esc(s.label)}</div></div>`).join("")}</div>`;
}
function writtenSummary(list, ctx) {
  if (!list.length) return `<p class="rp-empty">No hay movimientos en este periodo.</p>`;
  const t = totalsOf(list);
  const bd = breakdownOf(list, "expense");
  const goal = DB.settings.savingsGoal || 0;
  const s = [];

  s.push(`En <b>${esc(ctx.periodLabel)}</b> tus ingresos fueron <b>${fmt(t.income)}</b> y tus gastos <b>${fmt(t.expense)}</b>, con un balance ${t.balance >= 0 ? "positivo" : "negativo"} de <b>${fmt(Math.abs(t.balance))}</b>.`);

  if (t.income > 0) {
    let sav = `Ahorraste el <b>${Math.round(t.savingsRate)}%</b> de tus ingresos`;
    sav += goal > 0 ? (t.savingsRate >= goal ? `, por encima de tu meta del ${goal}% 🎉.` : `, por debajo de tu meta del ${goal}%.`) : ".";
    s.push(sav);
  }
  if (bd.length) s.push(`Tu mayor gasto fue en <b>${esc(bd[0].name)}</b>: ${fmt(bd[0].value)} (${Math.round(bd[0].pct)}% del total)${bd[1] ? `, seguido de ${esc(bd[1].name)} (${fmt(bd[1].value)})` : ""}.`);

  let prevList = null, prevLabel = "";
  if (ctx.mode === "month") { prevList = txOfMonth(shiftMonth(viewMonth, -1)); prevLabel = "el mes anterior"; }
  else if (ctx.mode === "year") { prevList = txOfYear(reportYear - 1); prevLabel = `${reportYear - 1}`; }
  if (prevList && prevList.length) {
    const pt = totalsOf(prevList);
    if (pt.expense > 0) { const d = t.expense - pt.expense; s.push(`Gastaste <b>${d > 0 ? "más" : "menos"}</b> que ${prevLabel} (${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}, ${Math.round(Math.abs(d) / pt.expense * 100)}%).`); }
  }
  const over = ctx.mode === "month" ? budgetStatus(viewMonth).filter(b => b.over) : [];
  if (over.length) s.push(`⚠ Te pasaste del presupuesto en <b>${over.map(o => esc(o.name)).join(", ")}</b>.`);

  if (t.balance < 0) s.push(`Este periodo gastaste más de lo que ingresó; conviene revisar ${bd[0] ? esc(bd[0].name) : "tus gastos"} para recuperar el balance.`);
  else if (t.income > 0 && t.savingsRate < goal) s.push(`Vas bien; para alcanzar tu meta de ahorro, intenta recortar un poco en ${bd[0] ? esc(bd[0].name) : "tus gastos variables"}.`);
  else s.push(`Buen manejo del periodo. Mantén el ritmo. 💪`);

  return `<ul class="rp-summary">${s.map(x => `<li>${x}</li>`).join("")}</ul>`;
}
function buildReportHTML(ctx) {
  const loc = DB.settings.locale || "es-CR";
  const { list, periodLabel, mode, trend } = ctx;
  const t = totalsOf(list);
  const bd = breakdownOf(list, "expense");
  const inc = breakdownOf(list, "income");
  const gen = new Date().toLocaleString(loc, { dateStyle: "long", timeStyle: "short" });

  const kpis = [
    ["Ingresos", fmt(t.income), "#15803d"],
    ["Gastos", fmt(t.expense), "#b91c1c"],
    ["Balance", fmt(t.balance), t.balance < 0 ? "#b91c1c" : "#0f172a"],
    ["Tasa de ahorro", `${Math.round(t.savingsRate)}%`, "#0f172a"],
  ];
  if (accountsExist()) kpis.push(["Patrimonio", fmt(netWorth()), "#0f172a"]);
  if (mode === "month") { const pr = projectionForMonth(viewMonth); if (pr != null) kpis.push(["Proyección fin de mes", fmt(pr), "#0f172a"]); }

  const catTable = (rows) => rows.length ? `<table class="rp-table"><thead><tr><th>Categoría</th><th class="rp-num">Monto</th><th class="rp-num">%</th></tr></thead><tbody>${rows.map(r => `<tr><td><span class="rp-dot" style="background:${r.color}"></span>${esc(r.name)}</td><td class="rp-num">${fmt(r.value)}</td><td class="rp-num">${Math.round(r.pct)}%</td></tr>`).join("")}</tbody></table>` : `<p class="rp-empty">Sin datos en este periodo.</p>`;

  const accountsSection = accountsExist() ? `
    <div class="rp-section">
      <h3>Cuentas</h3>
      <table class="rp-table"><thead><tr><th>Cuenta</th><th>Tipo</th><th class="rp-num">Saldo</th></tr></thead><tbody>
        ${DB.accounts.map(a => `<tr><td>${esc(a.name)}</td><td>${esc(a.kind)}</td><td class="rp-num">${fmt(accountBalance(a.id))}</td></tr>`).join("")}
        <tr class="rp-total"><td colspan="2">Patrimonio total</td><td class="rp-num">${fmt(netWorth())}</td></tr>
      </tbody></table>
    </div>` : "";

  const goalsSection = DB.goals.length ? `
    <div class="rp-section">
      <h3>Metas y deudas</h3>
      <table class="rp-table"><thead><tr><th>Meta</th><th>Tipo</th><th class="rp-num">Progreso</th><th class="rp-num">%</th></tr></thead><tbody>
        ${DB.goals.map(g => `<tr><td>${esc(g.name)}</td><td>${g.kind === "deuda" ? "Deuda" : "Ahorro"}</td><td class="rp-num">${fmt(g.saved || 0)} / ${fmt(g.target || 0)}</td><td class="rp-num">${Math.round(goalPct(g))}%</td></tr>`).join("")}
      </tbody></table>
    </div>` : "";

  const budgets = budgetStatus(viewMonth);
  const budgetSection = (mode === "month" && budgets.length) ? `
    <div class="rp-section">
      <h3>Presupuestos del mes</h3>
      <table class="rp-table"><thead><tr><th>Categoría</th><th class="rp-num">Gastado</th><th class="rp-num">Límite</th><th class="rp-num">%</th></tr></thead><tbody>
        ${budgets.map(b => `<tr><td>${esc(b.name)}</td><td class="rp-num" style="color:${b.over ? "#b91c1c" : "#0f172a"}">${fmt(b.spent)}</td><td class="rp-num">${fmt(b.limit)}</td><td class="rp-num">${Math.round(b.pct)}%${b.over ? " ⚠" : ""}</td></tr>`).join("")}
      </tbody></table>
    </div>` : "";

  const movs = [...list].sort((a, b) => new Date(a.date) - new Date(b.date));
  const movRows = movs.map(m => {
    const tipo = m.type === "income" ? "Ingreso" : m.type === "transfer" ? "Transferencia" : "Gasto";
    const cat = m.type === "transfer" ? `${accountName(m.from)} → ${accountName(m.to)}` : (m.category || "Otro");
    const acc = m.type === "transfer" ? "" : accountName(m.account);
    const sign = m.type === "income" ? "+" : m.type === "expense" ? "−" : "";
    const color = m.type === "income" ? "#15803d" : m.type === "expense" ? "#b91c1c" : "#0f766e";
    return `<tr><td>${dateInputValue(m.date)} <span class="rp-ref">${timeInputValue(m.date)}</span></td><td>${tipo}</td><td>${esc(cat)}</td><td>${esc(acc)}</td><td>${esc(m.note || "")}${m.ref ? ` <span class="rp-ref">N.° ${esc(m.ref)}</span>` : ""}</td><td class="rp-num" style="color:${color}">${sign}${fmt(m.amount)}</td></tr>`;
  }).join("");

  return `
    <div class="rp-head">
      <div class="rp-brand">MI NORTE</div>
      <div class="rp-title">Informe financiero</div>
      <div class="rp-period">${esc(periodLabel)}</div>
      <div class="rp-gen">Generado el ${esc(gen)}</div>
    </div>

    <div class="rp-section">
      <h3>Resumen</h3>
      <div class="rp-kpis">
        ${kpis.map(k => `<div class="rp-kpi"><div class="rp-k">${esc(k[0])}</div><div class="rp-v" style="color:${k[2]}">${k[1]}</div></div>`).join("")}
      </div>
    </div>

    <div class="rp-section">
      <h3>Análisis del periodo</h3>
      ${writtenSummary(list, ctx)}
    </div>

    <div class="rp-section">
      <h3>Gasto por categoría</h3>
      <div class="rp-cat-row">
        <div>${reportDonut(bd)}</div>
        <div style="flex:1;min-width:240px">${catTable(bd)}</div>
      </div>
    </div>

    <div class="rp-section">
      <h3>Ingresos por fuente</h3>
      ${catTable(inc)}
    </div>

    ${trend ? `<div class="rp-section"><h3>Tendencia (${mode === "year" ? "12 meses" : "6 meses"})</h3>${reportBars(trend)}<div class="rp-legend"><span><i style="background:#16a34a"></i>Ingresos</span><span><i style="background:#dc2626"></i>Gastos</span></div></div>` : ""}

    ${accountsSection}
    ${goalsSection}
    ${budgetSection}

    <div class="rp-section">
      <h3>Movimientos del periodo (${movs.length})</h3>
      ${movs.length ? `<table class="rp-table"><thead><tr><th>Fecha / hora</th><th>Tipo</th><th>Categoría</th><th>Cuenta</th><th>Descripción</th><th class="rp-num">Monto</th></tr></thead><tbody>${movRows}</tbody></table>` : `<p class="rp-empty">Sin movimientos en este periodo.</p>`}
    </div>

    <div class="rp-foot">MI NORTE · Informe generado automáticamente · Documento confidencial</div>
  `;
}
function openReportPreview() {
  const ctx = reportContext();
  const el = document.createElement("div");
  el.className = "report-view"; el.id = "report-view";
  el.innerHTML = `
    <div class="report-bar">
      <button class="btn line small" id="rp-close">Cerrar</button>
      <strong>Vista previa del informe</strong>
      <button class="btn small" id="rp-print">Descargar PDF</button>
    </div>
    <div class="report-scroll"><div class="report-sheet">${buildReportHTML(ctx)}</div></div>`;
  document.body.appendChild(el);
  $("#rp-close", el).onclick = () => el.remove();
  $("#rp-print", el).onclick = () => window.print();
}

/* ===========================================================
   PANTALLA DE INICIO (mañana y noche)
   =========================================================== */
function currentGateSlot() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return "am";
  if (h >= 18 && h < 24) return "pm";
  return null;
}
function gatePhrase(slot) {
  const start = new Date(new Date().getFullYear(), 0, 0);
  const day = Math.floor((Date.now() - start) / 86400000);
  const idx = (day * 2 + (slot === "pm" ? 1 : 0)) % GATE_PHRASES.length;
  return GATE_PHRASES[idx];
}
function maybeShowGate() {
  if (DB.settings.gate === false) return;
  if (document.querySelector(".gate")) return;      // ya visible
  const slot = currentGateSlot();
  if (!slot) return;
  const key = todayKeyStr();
  const field = slot === "am" ? "gateAM" : "gatePM";
  if (DB.settings[field] === key) return;           // ya se mostró esta franja hoy
  DB.settings[field] = key; save();
  renderGate(slot);
}
function renderGate(slot) {
  const loc = DB.settings.locale || "es-CR";
  const greeting = slot === "am" ? "Buenos días" : "Buenas noches";
  const dateLabel = new Date().toLocaleDateString(loc, { weekday: "long", day: "numeric", month: "long" });
  const t = monthTotals(monthKeyOf(new Date()));
  const registered = registeredToday();

  const el = document.createElement("div");
  el.className = "gate";
  el.innerHTML = `
    <div class="gate-top">
      <div class="gate-greet">${greeting}</div>
      <div class="gate-date">${esc(dateLabel)}</div>
    </div>
    <div class="gate-mid">
      <div class="gate-quote">“${esc(gatePhrase(slot))}”</div>
      <div class="gate-status">${registered
        ? `✓ Hoy ya registraste movimientos.`
        : `Aún no registras nada hoy.`}</div>
    </div>
    <div class="gate-bottom">
      <div class="gate-prompt">¿Ya registraste tus movimientos de hoy?</div>
      <div class="gate-actions">
        <button class="gbtn expense" id="gate-exp">− Registrar gasto</button>
        <button class="gbtn income" id="gate-inc">+ Registrar ingreso</button>
      </div>
      <button class="gbtn enter" id="gate-enter" disabled>Leer un momento…</button>
    </div>`;
  document.body.appendChild(el);

  $("#gate-exp", el).onclick = () => openTx("expense");
  $("#gate-inc", el).onclick = () => openTx("income");

  const enter = $("#gate-enter", el);
  let n = 3;
  const tick = () => { enter.textContent = `Entrar (${n})`; };
  tick();
  const iv = setInterval(() => {
    n--;
    if (n <= 0) { clearInterval(iv); enter.disabled = false; enter.textContent = "Entrar"; }
    else tick();
  }, 1000);
  enter.onclick = () => { clearInterval(iv); closeGate(); render(); };
}
function closeGate() { const g = document.querySelector(".gate"); if (g) g.remove(); }

/* ===========================================================
   ARRANQUE
   =========================================================== */
/* Degradados de datos (duotono Aurora), disponibles para todos los SVG */
document.body.insertAdjacentHTML("beforeend", `
  <svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
    <linearGradient id="grad-data" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2dd4bf"/><stop offset="1" stop-color="#6366f1"/></linearGradient>
    <linearGradient id="grad-ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2dd4bf"/><stop offset="1" stop-color="#6366f1"/></linearGradient>
    <linearGradient id="grad-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6366f1" stop-opacity=".26"/><stop offset="1" stop-color="#6366f1" stop-opacity="0"/></linearGradient>
  </defs></svg>`);

$$(".tab").forEach(b => b.onclick = () => { currentTab = b.dataset.tab; render(); });
window.closeSheet = closeSheet; // usado por onclick inline

/* Botones "?" (delegado, sobrevive a los re-render) */
document.addEventListener("click", (e) => {
  const h = e.target.closest("[data-help]");
  if (h) { e.stopPropagation(); openHelp(h.dataset.help); }
});
render();
showLock();
maybeShowGate();

/* Al volver a la app (PWA reanudada): pedir PIN y, si toca, mostrar la pantalla de inicio */
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") { showLock(); maybeShowGate(); }
});

/* Service worker (offline) */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
