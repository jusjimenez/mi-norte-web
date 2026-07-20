/* ===========================================================
   MI NORTE — Finanzas personales (PWA).
   Datos 100% locales (localStorage) + respaldo JSON/CSV.
   =========================================================== */

const STORE_KEY = "mi_norte_data_v2";
const OLD_KEY   = "mi_norte_data_v1";
const APP_VERSION = "v51"; // debe coincidir con el CACHE del service worker

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
/* ---------- Semilla ---------- */
const SEED = {
  transactions: [],   // {id, date(ISO), type:'income'|'expense'|'transfer', amount, category, note, ref, account, from, to}
  categories: structuredClone(DEFAULT_CATEGORIES),
  budgets: {},        // {categoria: limiteMensual}
  recurring: [],      // {id, type, amount, category, note, day}
  accounts: [],       // {id, name, kind:'efectivo'|'banco'|'tarjeta'|'otro', opening}
  goals: [],          // {id, name, kind:'ahorro', target, saved}
  debts: [],          // {id, name, party, dir:'owe'|'owed', principal, rate, ratePeriod, dueDate, note, createdAt, payments:[{id,date,amount,account}]}
  settings: { currency: "CRC", locale: "es-CR", decimals: "auto", theme: "dark", payCycle: { freq: "mensual", anchor: "" }, savingsGoal: 20, reminders: true, reminderDismissed: "", gate: true, gateAM: "", gatePM: "", pin: "" },
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
  projection: {
    title: "Proyección de gasto",
    html: `Estima <b>cuánto habrás gastado a fin de mes</b>.
      <div class="help-eq">Gastado + ritmo de gasto × días que faltan</div>
      <ul>
        <li>El ritmo mezcla lo que llevas este mes con tu promedio de meses anteriores, así un gasto grande al inicio no la dispara.</li>
        <li>Es aproximada: se afina conforme avanza el mes.</li>
      </ul>`,
  },
};

/* Explicación del simulador (se despliega dentro de su ventana) */
const SIM_HELP_HTML = `Compara el costo con tu <b>historial</b>: tu ingreso mensual promedio, tu gasto promedio y el margen que normalmente te sobra.
  <span class="r">🟢 <b>Cómodo</b>: te queda margen y sigues cumpliendo tu meta de ahorro.</span>
  <span class="r">🟡 <b>Ajustado</b>: cabe, pero reduce tu ahorro del mes.</span>
  <span class="r">🔴 <b>Riesgoso</b>: te dejaría sin margen este mes.</span>
  <span class="r">Mientras más movimientos registres, más precisa es la estimación.</span>`;

/* ---------- Estado / persistencia ---------- */
let DB = load();
let currentTab = "home";
let viewMonth = monthKeyOf(new Date());   // "YYYY-MM" en foco

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function load() {
  const raw = localStorage.getItem(STORE_KEY);
  try {
    if (raw) return normalize(JSON.parse(raw));
    const old = localStorage.getItem(OLD_KEY);
    if (old) return migrateV1(JSON.parse(old));
  } catch (e) {
    // Datos corruptos: se preservan aparte antes de arrancar vacío, para que un
    // save() posterior no pise lo que quizá aún se pueda rescatar a mano.
    try { if (raw) localStorage.setItem(STORE_KEY + "_corrupt", raw); } catch (e2) {}
  }
  return structuredClone(SEED);
}
/* Coerciones defensivas: un respaldo importado (o editado a mano) no debe poder
   corromper los cálculos. Montos → número finito ≥ 0; fechas → ISO válida;
   strings → string. Nada de esto altera datos ya sanos. */
/* Declaradas como function (no const) porque normalize() corre en el arranque,
   antes de que un const de este punto del archivo esté inicializado. */
function num(v) { const n = +v; return Number.isFinite(n) ? n : 0; }
function pos(v) { return Math.max(0, num(v)); }
function str(v) { return v == null ? "" : String(v); }
function isoOr(v, fallback) { const d = new Date(v); return isNaN(d) ? fallback : d.toISOString(); }
function normalize(data) {
  const db = Object.assign(structuredClone(SEED), data || {});
  db.categories = Object.assign(structuredClone(DEFAULT_CATEGORIES), db.categories || {});
  db.categories.expense = (Array.isArray(db.categories.expense) ? db.categories.expense : DEFAULT_CATEGORIES.expense).map(str).filter(Boolean);
  db.categories.income = (Array.isArray(db.categories.income) ? db.categories.income : DEFAULT_CATEGORIES.income).map(str).filter(Boolean);
  if (!db.categories.expense.length) db.categories.expense = [...DEFAULT_CATEGORIES.expense];
  if (!db.categories.income.length) db.categories.income = [...DEFAULT_CATEGORIES.income];
  db.settings = Object.assign(structuredClone(SEED.settings), db.settings || {});
  db.transactions = (Array.isArray(db.transactions) ? db.transactions : [])
    .filter(t => t && typeof t === "object")
    .map(t => ({
      id: str(t.id) || uid(),
      date: isoOr(t.date, new Date().toISOString()),
      type: ["income", "expense", "transfer"].includes(t.type) ? t.type : "expense",
      amount: pos(t.amount),
      category: str(t.category), note: str(t.note), ref: str(t.ref),
      account: t.account ? str(t.account) : undefined,
      from: t.from ? str(t.from) : undefined, to: t.to ? str(t.to) : undefined,
      // Rebaja/deducción documentada dentro de un ingreso (ej. salario): el
      // "amount" es el neto recibido; deduction/deductionNote guardan el detalle.
      ...(pos(t.deduction) > 0 ? { deduction: pos(t.deduction), deductionNote: str(t.deductionNote) } : {}),
    }));
  db.recurring = (Array.isArray(db.recurring) ? db.recurring : [])
    .filter(r => r && typeof r === "object")
    .map(r => ({
      id: str(r.id) || uid(),
      type: r.type === "income" ? "income" : "expense",
      amount: pos(r.amount), category: str(r.category), note: str(r.note),
      day: Math.max(1, Math.min(31, Math.round(num(r.day)) || 1)),
      account: r.account ? str(r.account) : undefined,
      auto: !!r.auto, lastPosted: str(r.lastPosted),
    }));
  db.accounts = (Array.isArray(db.accounts) ? db.accounts : [])
    .filter(a => a && typeof a === "object")
    .map(a => ({ id: str(a.id) || uid(), name: str(a.name) || "Cuenta",
      kind: ACCOUNT_KINDS.includes(a.kind) ? a.kind : "otro", opening: num(a.opening) }));
  db.goals = (Array.isArray(db.goals) ? db.goals : [])
    .filter(g => g && typeof g === "object")
    .map(g => ({ id: str(g.id) || uid(), name: str(g.name) || "Meta", kind: str(g.kind) || "ahorro",
      target: pos(g.target), saved: pos(g.saved),
      freq: g.freq === "quincenal" ? "quincenal" : "mensual",
      targetDate: g.targetDate ? isoOr(g.targetDate, "") : "", createdAt: g.createdAt ? isoOr(g.createdAt, "") : "" }));
  db.debts = (Array.isArray(db.debts) ? db.debts : [])
    .filter(d => d && typeof d === "object")
    .map(d => ({ id: str(d.id) || uid(), name: str(d.name) || "Deuda", party: str(d.party),
      dir: d.dir === "owed" ? "owed" : "owe", principal: pos(d.principal),
      rate: pos(d.rate), ratePeriod: d.ratePeriod === "mensual" ? "mensual" : "anual",
      monthly: pos(d.monthly), dueDate: d.dueDate ? isoOr(d.dueDate, "") : "",
      note: str(d.note), createdAt: d.createdAt ? isoOr(d.createdAt, "") : "",
      payments: (Array.isArray(d.payments) ? d.payments : []).filter(p => p && typeof p === "object")
        .map(p => ({ id: str(p.id) || uid(), date: isoOr(p.date, new Date().toISOString()), amount: pos(p.amount),
          interest: p.interest != null ? pos(p.interest) : undefined,
          capital: p.capital != null ? pos(p.capital) : undefined,
          account: p.account ? str(p.account) : undefined, txId: p.txId ? str(p.txId) : undefined })) }));
  const rawBudgets = db.budgets && typeof db.budgets === "object" ? db.budgets : {};
  db.budgets = {};
  Object.entries(rawBudgets).forEach(([k, v]) => { const n = pos(v); if (n > 0) db.budgets[str(k)] = n; });
  // Migra las metas antiguas de tipo "deuda" al nuevo módulo de deudas
  const deudaGoals = db.goals.filter(g => g.kind === "deuda");
  deudaGoals.forEach(g => db.debts.push({
    id: g.id || uid(), name: g.name || "Deuda", party: "", dir: "owe",
    principal: g.target || 0, rate: 0, ratePeriod: "anual", dueDate: "", note: "",
    createdAt: new Date().toISOString(), payments: g.saved ? [{ id: uid(), date: new Date().toISOString(), amount: g.saved }] : [],
  }));
  if (deudaGoals.length) db.goals = db.goals.filter(g => g.kind !== "deuda");
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
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(DB)); }
  catch (e) { toast("⚠️ No pude guardar: almacenamiento lleno. Exporta un respaldo."); }
}

/* ---------- Helpers de formato ---------- */
/* Decimales prácticos por moneda para el modo "Automático" */
const CURRENCY_DEC = { CRC: 0, CLP: 0, COP: 0, USD: 2, EUR: 2, MXN: 2, PEN: 2 };
function moneyFractionOpts() {
  const d = DB.settings.decimals;
  if (d === 0 || d === "0") return { minimumFractionDigits: 0, maximumFractionDigits: 0 };
  if (d === 2 || d === "2") return { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  // "auto": en monedas sin céntimos habituales (colón, peso) mostramos los
  // céntimos SOLO cuando existen (₡1.000 limpio, ₡23.500,67 completo); en las
  // que sí los usan (dólar, euro), siempre 2.
  const base = CURRENCY_DEC[DB.settings.currency] ?? 2;
  return base === 0 ? { minimumFractionDigits: 0, maximumFractionDigits: 2 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
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
/* Parseo de montos tolerante a la escritura local: acepta coma o punto como
   decimal y separadores de miles (ej. "23.500,67", "23,500.67", "23500,67",
   "1.000"). Elige el decimal por el separador más a la derecha; un separador
   solitario que forma grupos de 3 (ej. "1.000") se trata como miles. */
function parseAmount(v) {
  let s = String(v == null ? "" : v).trim().replace(/[^\d.,-]/g, "");
  if (!s) return 0;
  const c = s.lastIndexOf(","), d = s.lastIndexOf(".");
  let dec = "";
  if (c > -1 && d > -1) dec = c > d ? "," : ".";
  else if (c > -1) dec = /^-?\d{1,3}(,\d{3})+$/.test(s) ? "" : ",";
  else if (d > -1) dec = /^-?\d{1,3}(\.\d{3})+$/.test(s) ? "" : ".";
  if (dec) { s = s.split(dec === "," ? "." : ",").join("").replace(dec, "."); }
  else { s = s.replace(/[.,]/g, ""); }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}
/* Pago copiado por la automatización de Atajos (Apple Pay).
   Formato ideal: "MINORTE|monto|comercio". Pero iOS a veces no deja separar
   el importe y el comercio, así que también aceptamos "MINORTE|<transacción
   entera como texto>": buscamos el primer número con pinta de monto (símbolo
   de moneda o decimales) y el resto queda como comercio. */
function parseSharedPayment(text) {
  const m = String(text || "").trim().match(/^MINORTE\|([\s\S]*)$/i);
  if (!m) return null;
  const payload = m[1].trim();
  if (!payload) return null;
  // 1) monto|comercio
  const parts = payload.split("|");
  if (parts.length >= 2) {
    const amount = parseAmount(parts[0]);
    if (amount > 0) return { amount, note: parts.slice(1).join(" ").trim().slice(0, 60) };
  }
  // 2) texto libre: elegir el mejor candidato a monto (con moneda > con decimales > primero)
  const rx = /(?:₡|\$|CRC|USD)?\s*(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/g;
  let best = null, mt;
  while ((mt = rx.exec(payload))) {
    const cand = { raw: mt[0], num: mt[1], idx: mt.index,
      hasCur: /₡|\$|CRC|USD/.test(mt[0]), hasDec: /[.,]\d{1,2}$/.test(mt[1]) };
    if (!best || (cand.hasCur && !best.hasCur) || (cand.hasCur === best.hasCur && cand.hasDec && !best.hasDec)) best = cand;
    if (best.hasCur && best.hasDec) break;
  }
  if (!best) return null;
  const amount = parseAmount(best.num);
  if (amount <= 0) return null;
  const note = (payload.slice(0, best.idx) + " " + payload.slice(best.idx + best.raw.length))
    .replace(/[|·\n\r]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return { amount, note };
}
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
/* Proyección de gasto a fin de mes.
   La extrapolación lineal simple (gasto/día × días) se dispara al inicio del
   mes cuando cae un gasto grande (alquiler, un préstamo). En su lugar mezclamos
   el ritmo real de este mes con tu promedio histórico: al principio pesa más el
   histórico (estable), y conforme avanza el mes pesa más el ritmo real. */
function projectionForMonth(mk) {
  if (!isCurrentMonth(mk)) return null;
  const day = new Date().getDate();
  const dim = daysInMonth(mk);
  if (day <= 0) return null;
  const spent = monthTotals(mk).expense;
  const remaining = dim - day;
  if (remaining <= 0) return Math.round(spent);           // mes ya terminado
  // ¿Cuántos meses anteriores tienen datos? Sin histórico, los primeros días
  // no son confiables, así que no mostramos nada aún.
  let histCount = 0, mp = shiftMonth(mk, -1);
  for (let i = 0; i < 6; i++) { if (monthTotals(mp).count > 0) histCount++; mp = shiftMonth(mp, -1); }
  if (histCount === 0 && day < 5) return null;
  const histDaily = histCount > 0 ? avgOf("expense") / dim : spent / dim;
  const thisDaily = spent / day;
  const w = day / dim;                                     // peso del ritmo real de este mes
  const daily = w * thisDaily + (1 - w) * histDaily;
  return Math.round(spent + daily * remaining);
}
/* ---------- Ciclo de pago (presupuestos que siguen a la quincena) ----------
   El presupuesto se cuenta desde el inicio del ciclo ACTUAL, no por mes
   calendario. El ciclo avanza solo (red anti-olvido: quien se distrae no
   acumula de más) y se puede reiniciar a mano cuando llega el pago real,
   así el día del cambio calza con la plata y no con el almanaque. */
function cycleAdvance(key, freq) {
  const d = new Date(key + "T12:00:00");
  if (freq === "quincenal") d.setDate(d.getDate() + 15);
  else d.setMonth(d.getMonth() + 1);
  return dateInputValue(d.toISOString());
}
function payCycle() {
  const pc = DB.settings.payCycle || {};
  const freq = pc.freq === "quincenal" ? "quincenal" : "mensual";
  const now = new Date();
  const defAnchor = dateInputValue(new Date(now.getFullYear(), now.getMonth(), 1, 12).toISOString());
  let start = /^\d{4}-\d{2}-\d{2}$/.test(pc.anchor || "") ? pc.anchor : defAnchor;
  const today = todayKeyStr();
  let guard = 0;
  while (cycleAdvance(start, freq) <= today && guard++ < 800) start = cycleAdvance(start, freq);
  return { freq, start, end: cycleAdvance(start, freq) };
}
function cyclesPerMonth() { return payCycle().freq === "quincenal" ? 2 : 1; }
function cycleRangeLabel(pc) {
  const loc = DB.settings.locale || "es-CR";
  const s = new Date(pc.start + "T12:00:00");
  const e = new Date(pc.end + "T12:00:00"); e.setDate(e.getDate() - 1);
  const f = d => d.toLocaleDateString(loc, { day: "numeric", month: "short" });
  return `Del ${f(s)} al ${f(e)}`;
}
/* Estado del CICLO en vivo: gasto desde el inicio del ciclo contra el límite
   por ciclo (el "sobre" que la persona vigila hoy). */
function budgetCycleStatus() {
  const { start } = payCycle(), today = todayKeyStr();
  const spentBy = {};
  breakdownOf(txInRange(start, today), "expense").forEach(b => spentBy[b.name] = b.value);
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

/* ===========================================================
   SALUD FINANCIERA (Fase 1) — pensado para alentar, no juzgar
   =========================================================== */
/* Dinero líquido disponible: efectivo + banco (solo saldos positivos). */
function liquidMoney() {
  return DB.accounts
    .filter(a => a.kind === "efectivo" || a.kind === "banco" || a.kind === "otro")
    .reduce((s, a) => s + Math.max(0, accountBalance(a.id)), 0);
}
/* Patrimonio neto real = cuentas − lo que debes + lo que te deben. */
function trueNetWorth() { return netWorth() - totalOwe() + totalOwed(); }
function avgMonthlyExpense() {
  const a = avgOf("expense");
  if (a > 0) return a;
  const rec = DB.recurring.filter(r => r.type === "expense").reduce((s, r) => s + r.amount, 0);
  return rec > 0 ? rec : monthTotals(monthKeyOf(new Date())).expense;
}
/* Colchón: cuántos días/meses de gasto cubren tus cuentas líquidas. */
function cushion() {
  const liquid = liquidMoney();
  const monthly = avgMonthlyExpense();
  const daily = monthly > 0 ? monthly / 30 : 0;
  const days = daily > 0 ? liquid / daily : (liquid > 0 ? Infinity : 0);
  return { liquid, monthly, daily, days };
}
function daysSinceLastTx() {
  if (!DB.transactions.length) return Infinity;
  const last = DB.transactions.reduce((m, t) => Math.max(m, new Date(t.date).getTime()), 0);
  return Math.floor((Date.now() - last) / 86400000);
}
function trackingStreak() {
  if (!DB.transactions.length) return 0;
  const days = new Set(DB.transactions.map(t => dateInputValue(t.date)));
  let streak = 0, d = new Date();
  for (let i = 0; i < 120; i++) {
    if (days.has(dateInputValue(d.toISOString()))) streak++;
    else if (i > 0) break;            // permite que "hoy" aún no tenga registro
    d.setDate(d.getDate() - 1);
  }
  return streak;
}
function debtAnnualRate(d) { return d.rate ? (d.ratePeriod === "mensual" ? d.rate * 12 : d.rate) : 0; }
/* Obligación mensual aproximada de tus deudas (cuota, o al menos el interés). */
function monthlyDebtLoad() {
  return DB.debts.filter(d => d.dir === "owe" && debtBalance(d) > 0)
    .reduce((s, d) => s + (d.monthly > 0 ? d.monthly : debtMonthlyInterest(d)), 0);
}
function hasFinData() { return DB.accounts.length > 0 || DB.transactions.length > 0 || DB.debts.length > 0; }
/* Cinco pilares, cada uno 0-100, con curvas que premian los primeros pasos. */
function healthPillars() {
  // Al día: penaliza solo TUS pagos vencidos (no lo que otros te deben a ti).
  const vencidas = DB.debts.filter(d => d.dir === "owe" && debtStatus(d) === "vencida").length;
  const alDia = vencidas === 0 ? 100 : Math.max(15, 100 - vencidas * 35);
  // Colchón: curva raíz → 1 semana ya suma, 3 meses = tope.
  const cd = cushion().days;
  const colchon = cd === Infinity ? 100 : Math.min(100, Math.round(100 * Math.sqrt(Math.min(cd, 90) / 90)));
  // Vives con lo tuyo: empatar ya vale ~45; ahorrar 20% = tope.
  const inc = avgOf("income"), exp = avgOf("expense");
  const sr = inc > 0 ? (inc - exp) / inc * 100 : (exp > 0 ? -100 : 0);
  let medios;
  if (sr >= 20) medios = 100;
  else if (sr >= 0) medios = Math.round(45 + sr / 20 * 55);
  else medios = Math.max(5, Math.round(45 + sr / 20 * 40));
  // Peso de la deuda: obligación mensual vs ingreso.
  const load = monthlyDebtLoad();
  let deuda;
  if (load <= 0) deuda = 100;
  else if (inc > 0) deuda = Math.max(10, Math.min(100, Math.round(100 - (load / inc) * 150)));
  else deuda = 40;
  // Constancia: premia aparecer (lo único que sí controla hoy).
  const dsl = daysSinceLastTx();
  const constancia = !DB.transactions.length ? 0 : dsl <= 0 ? 100 : dsl <= 1 ? 85 : dsl <= 3 ? 70 : dsl <= 6 ? 50 : dsl <= 13 ? 30 : 15;
  return { alDia, colchon, medios, deuda, constancia };
}
function healthScore() {
  if (!hasFinData()) return null;
  const p = healthPillars();
  return Math.round(p.alDia * 0.25 + p.colchon * 0.25 + p.medios * 0.20 + p.deuda * 0.15 + p.constancia * 0.15);
}
function healthLevel(score) {
  if (score == null) return { name: "Empecemos", tint: "var(--label-2)" };
  if (score <= 20) return { name: "Arrancando", tint: "var(--red)" };
  if (score <= 40) return { name: "Tomando control", tint: "var(--amber)" };
  if (score <= 60) return { name: "Estabilizando", tint: "var(--amber)" };
  if (score <= 80) return { name: "Con base sólida", tint: "var(--green)" };
  return { name: "Rumbo a la libertad", tint: "var(--green)" };
}
/* ===========================================================
   MOVIMIENTOS FIJOS + PRÓXIMOS PAGOS (Fase 2)
   =========================================================== */
function recurringDueDate(r, y, m) {
  const dim = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(r.day || 1, dim), 12);
}
/* ¿La ocurrencia de ESTE mes ya venció y aún no se registró? */
function recurringPending(r) {
  const now = new Date();
  if (r.lastPosted === monthKeyOf(now)) return false;
  const due = recurringDueDate(r, now.getFullYear(), now.getMonth());
  return dateInputValue(due.toISOString()) <= todayKeyStr();
}
function recurringPendings() { return DB.recurring.filter(recurringPending); }
/* La próxima ocurrencia futura (cuando la de este mes ya se registró o aún no llega). */
function recurringNextDate(r) {
  const now = new Date();
  let due = recurringDueDate(r, now.getFullYear(), now.getMonth());
  if (r.lastPosted === monthKeyOf(now) || dateInputValue(due.toISOString()) < todayKeyStr())
    due = recurringDueDate(r, now.getFullYear(), now.getMonth() + 1);
  return due;
}
function postRecurring(r) {
  const now = new Date();
  const due = recurringDueDate(r, now.getFullYear(), now.getMonth());
  DB.transactions.push({ id: uid(), date: due.toISOString(), type: r.type, amount: r.amount, category: r.category, note: r.note, account: r.account });
  r.lastPosted = monthKeyOf(now);
}
function skipRecurring(r) { r.lastPosted = monthKeyOf(new Date()); }
/* Registra automáticamente los fijos marcados como automáticos que ya vencieron. */
function maybeApplyRecurring() {
  let changed = false;
  DB.recurring.forEach(r => { if (r.auto && recurringPending(r)) { postRecurring(r); changed = true; } });
  if (changed) save();
  return changed;
}
/* Salidas próximas (deudas con fecha + fijos de gasto), ordenadas por fecha. */
function upcomingItems(windowDays = 45) {
  const todayKey = todayKeyStr();
  const daysAwayOf = k => Math.round((new Date(k + "T12:00:00") - new Date(todayKey + "T12:00:00")) / 86400000);
  const items = [];
  DB.debts.filter(d => d.dir === "owe" && debtBalance(d) > 0 && d.dueDate).forEach(d => {
    const key = dateInputValue(d.dueDate);
    items.push({ kind: "debt", id: d.id, name: d.name, amount: d.monthly > 0 ? Math.min(d.monthly, debtBalance(d)) : debtBalance(d), key, daysAway: daysAwayOf(key), pending: false });
  });
  DB.recurring.filter(r => r.type === "expense").forEach(r => {
    const pending = recurringPending(r);
    const now = new Date();
    const key = pending ? dateInputValue(recurringDueDate(r, now.getFullYear(), now.getMonth()).toISOString()) : dateInputValue(recurringNextDate(r).toISOString());
    items.push({ kind: "fixed", id: r.id, name: r.note || r.category, amount: r.amount, key, daysAway: daysAwayOf(key), pending });
  });
  return items.filter(it => it.daysAway <= windowDays).sort((a, b) => a.key < b.key ? -1 : 1);
}
function upcomingTotal(days) { return upcomingItems(days).reduce((s, i) => s + i.amount, 0); }
/* Próximo pago: lo más cercano (incluye vencidos). */
function nextDue() { return upcomingItems(60)[0] || null; }
/* El ÚNICO próximo paso: el más urgente y alcanzable. */
function nextStep() {
  const overdue = DB.debts.filter(d => d.dir === "owe" && debtStatus(d) === "vencida");
  if (overdue.length) return { text: `Ponte al día con ${esc(overdue[0].name)}. Es lo que más te está costando.`, cta: "Ver deuda", act: "debts" };
  const t = monthTotals(viewMonth);
  if (t.income > 0 && t.balance < 0) {
    const top = categoryBreakdown(viewMonth, "expense")[0];
    return { text: `Este mes vas gastando más de lo que entra${top ? `. Mirá tu gasto en ${esc(top.name)}` : ""}.`, cta: "Ver gastos", act: "reports" };
  }
  const cd = cushion();
  if (cd.days < 7) return { text: "Guardá ₡5.000 esta semana. Sería tu primer colchón. 💪", cta: "Crear colchón", act: "save" };
  const pricey = DB.debts.filter(d => d.dir === "owe" && debtBalance(d) > 0 && debtAnnualRate(d) >= 30)
    .sort((a, b) => debtAnnualRate(b) - debtAnnualRate(a))[0];
  if (pricey) return { text: `El préstamo de ${esc(pricey.name)} te cuesta ~${Math.round(debtAnnualRate(pricey))}% al año. Priorizá pagarlo.`, cta: "Ver deuda", act: "debts" };
  if (daysSinceLastTx() > 2) return { text: "Registrá lo de hoy. Son 10 segundos y mantiene todo al día.", cta: "Registrar", act: "expense" };
  if (cd.days < 90) return { text: "Vas bien. Subí un poco más tu colchón cuando puedas.", cta: "Ahorrar", act: "save" };
  return { text: "Excelente manejo. Mantené el ritmo. 🌱", cta: null, act: null };
}
function todayWin() {
  const streak = trackingStreak();
  if (streak >= 2) return `🔥 Llevás ${streak} días registrando seguidos`;
  if (registeredToday()) return "✓ Ya registraste hoy";
  return null;
}

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

/* ---- Metas ---- */
function goalPct(g) {
  if (!g.target) return 0;
  return Math.max(0, Math.min(100, (g.saved || 0) / g.target * 100));
}
function goalRemaining(g) { return Math.max(0, (g.target || 0) - (g.saved || 0)); }
/* Frecuencia de ahorro elegible: muchas personas cobran por quincena, así que
   "aparta X/quincena" cae más natural que forzar todo a "/mes". */
const GOAL_FREQ = {
  mensual:   { label: "Mes",      per: "/mes",      days: 30 },
  quincenal: { label: "Quincena", per: "/quincena", days: 15 },
};
function goalFreq(g) { return GOAL_FREQ[g && g.freq] || GOAL_FREQ.mensual; }
/* Cuánto apartar por período (según la frecuencia elegida) para llegar a la fecha. */
function goalPerPeriod(g) {
  const rem = goalRemaining(g);
  if (rem <= 0 || !g.targetDate) return 0;
  const days = (new Date(g.targetDate) - Date.now()) / 86400000;
  const periods = Math.max(1, days / goalFreq(g).days);
  return Math.ceil(rem / periods);
}
/* Estado de la meta en tono de aliento: cumplida / al día / atrasada. */
function goalPace(g) {
  if (goalRemaining(g) <= 0 && (g.target || 0) > 0) return { done: true, label: "¡Meta cumplida! 🎉", tint: "var(--green)" };
  if (!g.targetDate) return null;
  const now = Date.now(), start = new Date(g.createdAt || now).getTime(), end = new Date(g.targetDate).getTime();
  const needed = goalPerPeriod(g);
  if (end <= now) return { label: "Fecha cumplida", tint: "var(--amber)", needed };
  const frac = start < end ? Math.max(0, Math.min(1, (now - start) / (end - start))) : 0;
  const expected = (g.target || 0) * frac;
  const ahead = (g.saved || 0) >= expected - 0.5;
  return { label: ahead ? "Vas al día ✓" : "Vas atrasado", tint: ahead ? "var(--green)" : "var(--amber)", ahead, needed };
}

/* ---- Deudas y préstamos ---- */
function debtPaid(d) { return (d.payments || []).reduce((s, p) => s + p.amount, 0); }
/* Cada pago se divide en interés y abono a capital. Pagos viejos (sin el
   desglose) cuentan como 100% capital, que era el comportamiento anterior. */
function payCapital(p) { return p.capital != null ? p.capital : p.amount; }
function payInterest(p) { return p.interest != null ? p.interest : 0; }
function debtCapitalPaid(d) { return (d.payments || []).reduce((s, p) => s + payCapital(p), 0); }
function debtInterestPaid(d) { return (d.payments || []).reduce((s, p) => s + payInterest(p), 0); }
function debtBalance(d) { return Math.max(0, (d.principal || 0) - debtCapitalPaid(d)); }
/* Interés sugerido para el próximo pago: tasa mensual sobre el saldo actual. */
function debtSuggestedInterest(d) {
  const bal = debtBalance(d);
  if (!d.rate || bal <= 0) return 0;
  const monthly = d.ratePeriod === "mensual" ? d.rate : d.rate / 12;
  return Math.round(bal * monthly / 100);
}
function debtStatus(d) {
  if (debtBalance(d) <= 0) return "pagada";
  if (!d.dueDate) return "aldia";
  const today = todayKeyStr(), due = dateInputValue(d.dueDate);
  if (due < today) return "vencida";
  const days = (new Date(due + "T12:00:00") - new Date(today + "T12:00:00")) / 86400000;
  return days <= 7 ? "porvencer" : "aldia";
}
function debtMonthlyInterest(d) {
  const bal = debtBalance(d);
  if (!d.rate || bal <= 0) return 0;
  const monthly = d.ratePeriod === "mensual" ? d.rate : d.rate / 12;
  return bal * monthly / 100;
}
/* Proyección de pago: cuántos meses y cuánto se pagará en total, con la cuota
   mensual establecida y el interés. Parte del SALDO actual, así que se recalcula
   sola conforme se abonan pagos al capital. */
function debtProjection(d) {
  const bal = debtBalance(d);
  const pay = d.monthly || 0;
  const r = (d.rate ? (d.ratePeriod === "mensual" ? d.rate : d.rate / 12) : 0) / 100;
  if (bal <= 0) return { done: true, balance: 0, months: 0, totalPay: 0, totalInterest: 0 };
  if (pay <= 0) return { noPay: true, balance: bal };
  // La cuota no cubre ni el interés del mes: nunca se termina de pagar.
  if (r > 0 && pay <= bal * r + 0.0001) return { never: true, balance: bal, monthlyInterest: bal * r };
  let b = bal, months = 0, totalPay = 0;
  // Amortización mes a mes (tope de seguridad de 1200 meses = 100 años).
  while (b > 0.005 && months < 1200) {
    const interest = b * r;
    const principalPart = pay - interest;
    const thisPay = (b + interest <= pay) ? (b + interest) : pay; // último pago ajustado
    b = b + interest - thisPay;
    totalPay += thisPay;
    months++;
  }
  return { months, totalPay, totalInterest: totalPay - bal, balance: bal, monthly: pay };
}
function fmtMonths(n) {
  if (n <= 0) return "0 meses";
  const y = Math.floor(n / 12), m = n % 12, parts = [];
  if (y) parts.push(y + (y === 1 ? " año" : " años"));
  if (m) parts.push(m + (m === 1 ? " mes" : " meses"));
  return parts.join(" y ") || n + " meses";
}
function totalOwe() { return DB.debts.filter(d => d.dir === "owe").reduce((s, d) => s + debtBalance(d), 0); }
function totalOwed() { return DB.debts.filter(d => d.dir === "owed").reduce((s, d) => s + debtBalance(d), 0); }
function upcomingDebts() { return DB.debts.filter(d => { const st = debtStatus(d); return st === "vencida" || st === "porvencer"; }); }
function debtStatusPill(st) {
  return { pagada: `<span class="pill green">Pagada</span>`, vencida: `<span class="pill red">Vencida</span>`,
    porvencer: `<span class="pill amber">Por vencer</span>`, aldia: `<span class="pill teal">Al día</span>` }[st] || "";
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
  const budgets = budgetCycleStatus().filter(b => b.over || b.pct >= 80).slice(0, 3);
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

  if (!DB.transactions.length && !DB.accounts.length && !DB.goals.length) return homeWelcome();
  return `
    <div class="head"><h1>${greeting()} 👋</h1><p>Vamos paso a paso.</p></div>
    ${accountsExist() ? networthBannerHTML() : ""}
    ${momentoHTML()}

    <div class="section-title">Este mes</div>
    ${monthNav()}

    ${recurringPendings().length ? `
    <div class="reminder" id="pend-rem">
      <div class="rem-ic">🧾</div>
      <div class="rem-txt"><strong>${recurringPendings().length} fijo${recurringPendings().length > 1 ? "s" : ""} por confirmar</strong><span>Toca para revisar tus pagos y cobros del mes.</span></div>
    </div>` : ""}

    ${backupDue() ? `
    <div class="reminder" id="backup-rem">
      <div class="rem-ic">💾</div>
      <div class="rem-txt"><strong>Respalda tus datos</strong><span>${DB.settings.lastBackup ? "Hace tiempo que no respaldas." : "Aún no tienes respaldo."} Un toque para protegerlos.</span></div>
    </div>` : ""}

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
        <div class="kpi-k">${isCurrentMonth(viewMonth) ? `Proyección de gasto ${helpBtn("projection")}` : "Movimientos"}</div>
        <div class="kpi-v">${proj != null ? fmt(proj) : t.count}</div>
        <div class="kpi-foot">${proj != null ? "aprox. a fin de mes" : "registrados este mes"}</div>
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
    ${navigator.clipboard && navigator.clipboard.readText ? `<button class="btn line" id="h-paste">📋 Registrar pago copiado</button>` : ""}

    ${(budgets.length || DB.goals.length || DB.debts.length) ? `<div class="section-title">Seguimiento</div>` : ""}
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
    ${DB.debts.length ? debtsCardHTML() : ""}

    <div class="section-title">Actividad</div>
    <div class="card">
      <div class="row"><h2 style="margin:0">Últimos movimientos</h2><button class="linkbtn" id="h-all">Ver todos</button></div>
      <div class="gap"></div>
      ${recent.length ? recent.map(t => txRow(t)).join("") : `<div class="muted">Aún no hay movimientos. Registra el primero arriba.</div>`}
    </div>
  `;
};
function homeWelcome() {
  return `
    <div class="head"><h1>Bienvenido</h1><p>Tus finanzas, con claridad.</p></div>
    <div class="card welcome">
      <div class="welcome-mark">${brandMark(58)}</div>
      <h2>Empieza en 2 pasos</h2>
      <div class="welcome-step"><span class="wn">1</span><div><strong>Agrega una cuenta</strong><div class="hint">Efectivo, banco o tarjeta, con su saldo actual. Así sabrás cuánto tienes.</div></div></div>
      <div class="welcome-step"><span class="wn">2</span><div><strong>Registra un movimiento</strong><div class="hint">Un ingreso o un gasto. Con eso empieza tu resumen del mes.</div></div></div>
      <div class="gap"></div>
      <button class="btn" id="w-account">Agregar mi primera cuenta</button>
      <div class="gap"></div>
      <button class="btn ghost" id="w-expense">Registrar un movimiento</button>
    </div>
    <div class="hint center">También puedes explorar las pestañas de abajo: Movimientos, Reportes y Ajustes.</div>
  `;
}
function greeting() { const h = new Date().getHours(); return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches"; }
function cushionLine(cd) {
  if (cd.days === Infinity) return "Tu colchón cubre tus gastos de sobra.";
  if (cd.days <= 0) return "Aún no tienes colchón. Empieza con poco.";
  if (cd.days >= 60) return `Tu colchón cubre ~${Math.round(cd.days / 30)} meses de gastos.`;
  return `Tu colchón cubre ${Math.round(cd.days)} día${Math.round(cd.days) === 1 ? "" : "s"} de gastos.`;
}
function dueLabel(daysAway) {
  if (daysAway < 0) return `Vencido hace ${Math.abs(daysAway)} día${Math.abs(daysAway) === 1 ? "" : "s"}`;
  if (daysAway === 0) return "Vence hoy";
  if (daysAway === 1) return "Vence mañana";
  return `Vence en ${daysAway} días`;
}
function momentoHTML() {
  if (!hasFinData()) return "";
  const score = healthScore(), lvl = healthLevel(score), cd = cushion();
  const due = nextDue(), step = nextStep(), win = todayWin();
  return `
    <div class="section-title">Tu momento</div>
    <div class="card momento">
      ${due ? `<div class="mo-due ${due.daysAway <= 3 ? "urgent" : ""}">
        <span class="mo-due-ic">${due.daysAway < 0 ? "⚠️" : "⏰"}</span>
        <div class="grow"><div class="mo-due-t">${dueLabel(due.daysAway)}</div><div class="mo-due-s">${esc(due.name)}</div></div>
        <div class="mo-due-amt">${fmt(due.amount)}</div>
      </div>` : `<div class="mo-due ok">
        <span class="mo-due-ic">✓</span>
        <div class="grow"><div class="mo-due-t">Nada vence esta semana</div><div class="mo-due-s">Vas al día con tus pagos</div></div>
      </div>`}
      ${score != null ? `<button class="mo-health" id="mo-health">
        <div class="grow"><div class="mo-h-lvl" style="color:${lvl.tint}">${lvl.name}</div><div class="mo-h-sub">${cushionLine(cd)}</div></div>
        <div class="mo-h-score"><b>${score}</b><span>/100</span></div>
        <span class="mo-h-chev">›</span>
      </button>` : ""}
      ${step ? `<div class="mo-step">
        <div class="mo-step-txt">${step.text}</div>
        ${step.cta ? `<button class="btn small" id="mo-step-cta" data-act="${step.act || ""}">${step.cta}</button>` : ""}
      </div>` : ""}
      ${win ? `<div class="mo-win">${win}</div>` : ""}
    </div>`;
}
function openHealth() {
  const score = healthScore(), lvl = healthLevel(score), p = healthPillars(), cd = cushion(), step = nextStep();
  const bar = (label, val, hint) => `
    <div class="bud">
      <div class="bud-top"><span>${label}</span><span>${val}/100</span></div>
      <div class="kpi-bar"><i style="width:${val}%"></i></div>
      <div class="hint" style="margin-top:5px">${hint}</div>
    </div>`;
  const inc = avgOf("income"), load = monthlyDebtLoad();
  openSheet(`
    <div class="toolbar"><h2 style="margin:0">Tu salud financiera</h2></div>
    <div class="card center">
      <div class="mo-h-score big"><b style="color:${lvl.tint}">${score}</b><span>/100</span></div>
      <div class="mo-h-lvl big" style="color:${lvl.tint}">${lvl.name}</div>
      <div class="hint">No es una nota: es tu punto de partida. Cada paso pequeño la sube.</div>
    </div>
    ${step ? `<div class="card"><div class="section-title" style="margin:0 0 10px">Tu próximo paso</div><div class="mo-step-txt">${step.text}</div></div>` : ""}
    <div class="card">
      <div class="section-title" style="margin:0 0 12px">Qué la compone</div>
      ${bar("Al día con lo que debes", p.alDia, DB.debts.some(d => debtStatus(d) === "vencida") ? "Tienes pagos vencidos. Ponerte al día es lo que más sube." : "No tienes pagos vencidos. 👏")}
      ${bar("Colchón de emergencia", p.colchon, cushionLine(cd))}
      ${bar("Vives con lo tuyo", p.medios, "Gastar menos de lo que entra. Empatar ya cuenta.")}
      ${bar("Peso de la deuda", p.deuda, load > 0 ? `Tus deudas piden ~${fmt(load)}/mes${inc > 0 ? ` (${Math.round(load / inc * 100)}% de tu ingreso)` : ""}.` : "No tienes deudas activas. 🙌")}
      ${bar("Constancia", p.constancia, "Registrar seguido. Es lo que sí controlas hoy.")}
    </div>
    <div class="gap"></div><button class="btn line" onclick="closeSheet()">Cerrar</button>
  `, { fullscreen: true });
}
WIRE.home = (root) => {
  const wa = $("#w-account", root);
  if (wa) { wa.onclick = openAccounts; $("#w-expense", root).onclick = () => openTx("expense"); return; }
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
  const hd = $("#h-debts", root); if (hd) hd.onclick = openDebts;
  const nwm = $("#nw-manage", root); if (nwm) nwm.onclick = openAccounts;
  const moH = $("#mo-health", root); if (moH) moH.onclick = openHealth;
  const moStep = $("#mo-step-cta", root);
  if (moStep) moStep.onclick = () => {
    const act = moStep.dataset.act;
    if (act === "debts") openDebts();
    else if (act === "expense") openTx("expense");
    else if (act === "save") openGoals();
    else if (act === "reports") { currentTab = "reports"; render(); }
  };
  const moDue = $(".mo-due", root);
  if (moDue && !moDue.classList.contains("ok")) moDue.style.cursor = "pointer", moDue.onclick = openUpcoming;
  const pr = $("#pend-rem", root); if (pr) pr.onclick = openUpcoming;
  const br = $("#backup-rem", root); if (br) br.onclick = () => { currentTab = "settings"; render(); };
  $("#h-sim", root).onclick = openSimulator;
  const hp = $("#h-paste", root);
  if (hp) hp.onclick = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const p = parseSharedPayment(text);
      if (p) openTx("expense", null, p);
      else toast("No encontré un pago copiado. Usa la automatización de Atajos.");
    } catch (e) { toast("No pude leer el portapapeles"); }
  };
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
    if (inc && t.deduction > 0) parts.push(`rebaja ${fmt(t.deduction)}${t.deductionNote ? ` (${esc(t.deductionNote)})` : ""}`);
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
  let list, periodLabel, trendSeries = null, proj = null;

  if (mode === "month") {
    list = txOfMonth(viewMonth);
    periodLabel = monthLabel(viewMonth);
    proj = projectionForMonth(viewMonth);
    trendSeries = lastMonths(6).map(mk => ({ label: shortMonthLabel(mk), ...monthTotals(mk), cur: mk === viewMonth }));
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

    <div class="card">
      <h2>Exportar informe</h2>
      <div class="hint">Informe completo de ${esc(periodLabel)} con gráficas y resúmenes, o los movimientos en CSV.</div>
      <div class="gap"></div>
      <button class="btn" id="r-pdf">📄 Descargar informe (PDF)</button>
      <div class="gap"></div>
      <button class="btn line" id="r-csv">Exportar movimientos (CSV)</button>
    </div>

    <div class="card">
      <h2>Conciliación bancaria</h2>
      <div class="hint">Sube el CSV de tu banco y lo comparo con lo registrado: encuentra diferencias, movimientos faltantes y descuadres de saldo.</div>
      <div class="gap"></div>
      <button class="btn ghost" id="r-reconcile">🏦 Conciliar con el banco</button>
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
  $("#r-reconcile", root).onclick = openReconcile;
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

    <div class="section-title">Preferencias</div>

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
      <div class="hint">Automático muestra los céntimos solo cuando existen (₡1.000 se ve limpio; ₡23.500,67 se ve completo). "2 decimales" los muestra siempre; "Sin decimales" los oculta. En cualquier modo puedes escribir céntimos al registrar.</div>
    </div>

    <div class="card">
      <h2>Apariencia</h2>
      <div class="seg" id="s-theme">
        <button data-th="auto" class="${(s.theme || "dark") === "auto" ? "on" : ""}">Automático</button>
        <button data-th="light" class="${s.theme === "light" ? "on" : ""}">Claro</button>
        <button data-th="dark" class="${(s.theme || "dark") === "dark" ? "on" : ""}">Oscuro</button>
      </div>
      <div class="hint">Automático sigue el tema de tu teléfono.</div>
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
      <div class="hint">Un chequeo rápido al abrir (mañana y noche): tu dinero disponible, el próximo pago y qué hacer hoy.</div>
    </div>

    <div class="section-title">Seguridad</div>

    <div class="card">
      <div class="row"><h2 style="margin:0">Bloqueo con PIN</h2>
        <label class="switch"><input type="checkbox" id="s-pin" ${DB.settings.pin ? "checked" : ""} /><span class="sl"></span></label>
      </div>
      <div class="hint">Pide un PIN de 4 dígitos al abrir la app para proteger tus datos.</div>
    </div>

    <div class="section-title">Datos y respaldo</div>

    <div class="card">
      <h2>Tus datos</h2>
      <div class="hint">Todo se guarda solo en este dispositivo. Sin respaldo, si pierdes el teléfono o borras el navegador, se van. ${s.lastBackup ? `Último respaldo: ${new Date(s.lastBackup).toLocaleDateString(s.locale || "es-CR", { day: "numeric", month: "short", year: "numeric" })}.` : "Aún no has respaldado."}</div>
      <div class="gap"></div>
      <div class="btn-row">
        <button class="btn ghost" id="s-export">Exportar (JSON)</button>
        <button class="btn line" id="s-import">Importar</button>
      </div>
      <button class="btn line" id="s-export-enc">🔒 Exportar cifrado (con contraseña)</button>
      <button class="btn line" id="s-csv-all">Exportar todo (CSV)</button>
      <div class="gap"></div>
      <button class="btn soft-danger" id="s-reset">Borrar datos…</button>
      <input type="file" id="s-import-file" accept="application/json,.json" hidden />
    </div>

    <div class="center hint">MI NORTE · Finanzas personales · ${APP_VERSION}</div>
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
  $$("#s-theme button", root).forEach(b => b.onclick = () => {
    DB.settings.theme = b.dataset.th; save(); applyTheme();
    $$("#s-theme button", root).forEach(x => x.classList.toggle("on", x === b));
  });
  $("#s-reminders", root).onchange = (e) => {
    DB.settings.reminders = e.target.checked; save(); toast(e.target.checked ? "Recordatorio activado" : "Recordatorio desactivado");
  };
  $("#s-gate", root).onchange = (e) => {
    DB.settings.gate = e.target.checked; save(); toast(e.target.checked ? "Pantalla de inicio activada" : "Pantalla de inicio desactivada");
  };
  $("#s-pin", root).onchange = (e) => {
    if (e.target.checked) { openPinSetup(); e.target.checked = !!DB.settings.pin; }
    else {
      if (confirm("¿Quitar el PIN? La app dejará de pedirlo al abrir.")) { DB.settings.pin = ""; save(); toast("PIN desactivado"); }
      else { e.target.checked = true; }
    }
  };

  $("#s-export", root).onclick = () => {
    const blob = new Blob([JSON.stringify(DB, null, 2)], { type: "application/json" });
    downloadBlob(blob, "mi-norte-respaldo.json");
    DB.settings.lastBackup = todayISO(); save(); render(); toast("Respaldo descargado");
  };
  $("#s-export-enc", root).onclick = openEncryptedExport;
  $("#s-csv-all", root).onclick = () => exportCSV([...DB.transactions].sort((a, b) => new Date(a.date) - new Date(b.date)), "mi-norte-todo.csv");
  $("#s-import", root).onclick = () => $("#s-import-file", root).click();
  $("#s-import-file", root).onchange = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => importBackupData(reader.result);
    reader.readAsText(file);
  };
  $("#s-reset", root).onclick = openResetOptions;
};
/* Borrado personalizado: marcas qué reiniciar y qué conservar. Cada cosa es
   independiente (ej. reiniciar deudas y conservar movimientos, o al revés). */
const RESET_ITEMS = [
  ["mov", "Movimientos", "Historial de ingresos y gastos"],
  ["saldos", "Saldos de cuentas", "Pone los saldos en cero (conserva las cuentas)"],
  ["debts", "Deudas y préstamos", "Saldos, pagos y recordatorios"],
  ["goals", "Metas de ahorro", ""],
  ["budgets", "Presupuestos", ""],
  ["recurring", "Movimientos fijos", ""],
  ["accounts", "Cuentas", "Elimina las cuentas (y también sus movimientos)"],
];
function openResetOptions() {
  openSheet(`
    <h2>Borrar o reiniciar datos</h2>
    <p class="hint">Marca lo que quieres borrar. Lo que no marques se conserva. No se puede deshacer, así que exporta un respaldo si tienes dudas.</p>
    <div class="card reset-list">
      ${RESET_ITEMS.map(([k, name, desc]) => `
        <div class="switch-row"><div><strong>${name}</strong>${desc ? `<div class="hint" style="margin-top:1px">${desc}</div>` : ""}</div>
          <label class="switch"><input type="checkbox" id="rs-${k}" ${k === "mov" ? "checked" : ""} /><span class="sl"></span></label></div>`).join("")}
    </div>
    <button class="btn soft-danger" id="rs-apply">Borrar lo seleccionado</button>
    <div class="gap"></div><button class="btn line" onclick="closeSheet()">Cancelar</button>
  `);
  // Borrar cuentas implica borrar movimientos (si no, quedarían huérfanos).
  const accEl = $("#rs-accounts"), movEl = $("#rs-mov");
  if (accEl) accEl.onchange = () => { if (accEl.checked) { movEl.checked = true; movEl.disabled = true; } else { movEl.disabled = false; } };
  $("#rs-apply").onclick = () => {
    const on = k => { const el = $(`#rs-${k}`); return !!(el && el.checked); };
    const keys = RESET_ITEMS.map(i => i[0]);
    if (!keys.some(on)) return toast("Marca al menos una cosa");
    if (!confirm("¿Borrar lo seleccionado? Esto no se puede deshacer.")) return;
    const wipeAcc = on("accounts");        // eliminar cuentas
    const zeroBal = on("saldos");          // poner saldos en cero (conserva cuentas)
    const wipeMov = on("mov") || wipeAcc;  // borrar cuentas implica borrar sus movimientos
    // Ajuste del saldo inicial de las cuentas que se conservan (ANTES de borrar los
    // movimientos, porque el saldo actual depende de ellos):
    //  · Saldos en cero  → opening = 0
    //  · Solo movimientos → se conserva el saldo actual (opening = saldo de hoy)
    if (!wipeAcc) {
      if (zeroBal) DB.accounts.forEach(a => { a.opening = 0; });
      else if (wipeMov) DB.accounts.forEach(a => { a.opening = accountBalance(a.id); });
    }
    if (wipeMov) { DB.transactions = []; DB.debts.forEach(d => (d.payments || []).forEach(p => { p.txId = undefined; })); }
    if (wipeAcc) DB.accounts = [];
    if (on("debts")) DB.debts = [];
    if (on("goals")) DB.goals = [];
    if (on("budgets")) DB.budgets = {};
    if (on("recurring")) DB.recurring = [];
    save(); closeSheet(); render(); toast("Listo, datos borrados");
  };
}

/* ---------------- MÁS (hub de herramientas) ---------------- */
SCREENS.more = () => {
  const row = (id, title, sub) => `<button class="hub-row" id="${id}"><div class="hub-txt"><div class="hub-t">${title}</div><div class="hub-s">${sub}</div></div><span class="hub-chev">›</span></button>`;
  return `
    <div class="head"><h1>Más</h1><p>Tus herramientas de dinero.</p></div>

    <div class="section-title">Cuentas y categorías</div>
    <div class="hub">
      ${row("hub-accounts", "Cuentas", "Saldos y transferencias")}
      ${row("hub-cat-exp", "Categorías de gasto", "Personaliza tus gastos")}
      ${row("hub-cat-inc", "Categorías de ingreso", "Personaliza tus ingresos")}
    </div>

    <div class="section-title">Planeación</div>
    <div class="hub">
      ${row("hub-upcoming", "Próximos pagos", "Lo que se te viene este mes")}
      ${row("hub-budgets", "Presupuestos", "Límites por categoría")}
      ${row("hub-recurring", "Movimientos fijos", "Ingresos y gastos que se repiten")}
      ${row("hub-goals", "Metas de ahorro", "Objetivos con progreso")}
      ${row("hub-debts", "Deudas y préstamos", "Lo que debes y lo que te deben")}
      ${row("hub-reconcile", "Conciliación bancaria", "Compara un CSV del banco")}
    </div>
  `;
};
WIRE.more = (root) => {
  $("#hub-accounts", root).onclick = openAccounts;
  $("#hub-cat-exp", root).onclick = () => openCategories("expense");
  $("#hub-cat-inc", root).onclick = () => openCategories("income");
  $("#hub-upcoming", root).onclick = openUpcoming;
  $("#hub-budgets", root).onclick = openBudgets;
  $("#hub-recurring", root).onclick = openRecurring;
  $("#hub-goals", root).onclick = openGoals;
  $("#hub-debts", root).onclick = openDebts;
  $("#hub-reconcile", root).onclick = openReconcile;
};

/* ===========================================================
   HOJAS / MODALES
   =========================================================== */
function openSheet(html, { fullscreen = false } = {}) {
  const root = $("#sheet-root");
  root.innerHTML = `<div class="sheet-backdrop ${fullscreen ? "sheet-fullscreen" : ""}"><div class="sheet"><div class="sheet-grip"></div>${html}</div></div>`;
  const bd = $(".sheet-backdrop", root);
  bd.addEventListener("click", (e) => { if (e.target === bd) closeSheet(); });
  enableSheetDrag(bd, $(".sheet", root));
  return root;
}
function closeSheet() { $("#sheet-root").innerHTML = ""; }
/* Tema claro/oscuro. "auto" sigue al sistema. Guardamos un espejo en
   localStorage (mn_theme) para que el <head> lo aplique antes del primer
   pintado y evitar el parpadeo. */
function resolvedTheme() {
  const t = DB.settings.theme || "dark";
  if (t === "light" || t === "dark") return t;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
function applyTheme() {
  const r = resolvedTheme();
  document.documentElement.setAttribute("data-theme", r);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", r === "light" ? "#f4f6f9" : "#0b0d12");
  try { localStorage.setItem("mn_theme", r); } catch (e) {}
}
/* Cerrar la hoja deslizándola hacia abajo, estilo iPhone. El arrastre de cierre
   solo arranca desde el asa (grip) o con la hoja en su tope, para no pelear con
   el scroll del contenido. Al soltar: si pasó el umbral, se va; si no, regresa. */
function enableSheetDrag(bd, sheet) {
  if (!sheet) return;
  const grip = sheet.querySelector(".sheet-grip");
  let startY = 0, dy = 0, mode = null, onGrip = false, startTop = 0;
  const H = () => sheet.offsetHeight || window.innerHeight;

  sheet.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) { mode = "scroll"; return; }
    startY = e.touches[0].clientY; dy = 0; mode = null; startTop = sheet.scrollTop;
    onGrip = !!grip && (e.target === grip || grip.contains(e.target));
  }, { passive: true });

  sheet.addEventListener("touchmove", (e) => {
    const delta = e.touches[0].clientY - startY;
    if (mode === null) {
      if (delta > 4 && (onGrip || startTop <= 0)) { mode = "dismiss"; sheet.style.transition = "none"; }
      else if (Math.abs(delta) > 4) mode = "scroll";
    }
    if (mode !== "dismiss") return;
    dy = Math.max(0, delta);
    sheet.style.transform = `translateY(${dy}px)`;
    const k = Math.min(1, dy / H());
    bd.style.background = `rgba(0,0,0,${(0.55 * (1 - k)).toFixed(3)})`;
    if (e.cancelable) e.preventDefault();
  }, { passive: false });

  const end = () => {
    if (mode !== "dismiss") { mode = null; return; }
    mode = null;
    sheet.style.transition = "transform .28s cubic-bezier(.32,.72,0,1)";
    bd.style.transition = "background .28s";
    if (dy > Math.min(150, H() * 0.28)) {
      sheet.style.transform = "translateY(100%)";
      bd.style.background = "rgba(0,0,0,0)";
      setTimeout(closeSheet, 240);
    } else {
      sheet.style.transform = "";
      bd.style.background = "";
    }
    dy = 0;
  };
  sheet.addEventListener("touchend", end);
  sheet.addEventListener("touchcancel", end);
}

/* Marca (brújula) para usar dentro de la app */
function brandMark(size) {
  return `<svg class="brandmark" width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="31" fill="none" stroke="#ffffff" stroke-opacity=".18" stroke-width="1.4"/>
    <path d="M50,9 L57,43 L90,50 L57,57 L50,91 L43,57 L10,50 L43,43 Z" fill="url(#grad-ring)"/>
    <circle cx="50" cy="50" r="4.5" fill="#0b0d12"/>
  </svg>`;
}

/* Botón "?" y su mini ventana */
function helpBtn(key) { return `<button class="help" data-help="${key}" aria-label="Cómo funciona">?</button>`; }
function openHelp(key) {
  const h = HELP[key]; if (!h) return;
  openSheet(`
    <div class="toolbar"><h2 style="margin:0">${esc(h.title)}</h2></div>
    <div class="help-body">${h.html}</div>
    <div class="gap"></div>
    <button class="btn" onclick="closeSheet()">Entendido</button>
  `);
}

/* ---- Registrar movimiento (ingreso o gasto) ---- */
/* prefill {amount, note}: pre-llenado desde un pago copiado (Atajos/Apple Pay)
   o desde la URL (?monto=…&nota=…). Solo aplica al crear, no al editar. */
function openTx(type, editId, prefill) {
  const editing = editId ? DB.transactions.find(t => t.id === editId) : null;
  const isIncome = editing ? editing.type === "income" : type === "income";
  const cats = DB.categories[isIncome ? "income" : "expense"];
  const sel = { category: editing ? editing.category : cats[0], account: editing ? editing.account : (DB.accounts[0] && DB.accounts[0].id) };

  const initDed = editing && editing.deduction > 0 ? editing.deduction : 0;
  const initGross = editing ? (editing.amount || 0) + initDed : (prefill && prefill.amount > 0 ? prefill.amount : "");
  const initNote = editing ? editing.note : (prefill && prefill.note ? prefill.note : "");
  openSheet(`
    <h2>${editing ? "Editar movimiento" : isIncome ? "Registrar ingreso" : "Registrar gasto"}</h2>
    <label class="field"><span>Monto${isIncome ? " (bruto)" : ""}</span>
      <input type="text" id="tx-amt" inputmode="decimal" placeholder="0" value="${initGross}" /></label>
    ${isIncome ? `
    <label class="field"><span>Rebaja o deducción (opcional)</span>
      <input type="text" id="tx-ded" inputmode="decimal" placeholder="0" value="${initDed || ""}" /></label>
    <label class="field"><span>Motivo de la rebaja (opcional)</span>
      <input type="text" id="tx-ded-note" placeholder="Ej. préstamo, ausencia, adelanto" value="${editing && editing.deductionNote ? esc(editing.deductionNote) : ""}" /></label>
    <div class="hint" id="tx-ded-info" style="margin:2px 2px 6px"></div>
    ` : ""}
    <label class="field"><span>Descripción (opcional)</span>
      <input type="text" id="tx-note" placeholder="${isIncome ? "Salario, venta…" : "¿En qué?"}" value="${esc(initNote)}" /></label>
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
  const numOf = el => parseAmount(el && el.value);
  if (isIncome) {
    const g = $("#tx-amt"), dd = $("#tx-ded"), info = $("#tx-ded-info");
    const drawDed = () => {
      const gross = numOf(g), ded = numOf(dd);
      if (ded > 0 && gross > 0) {
        const net = Math.round((gross - ded) * 100) / 100;
        info.innerHTML = net <= 0
          ? `<span style="color:#fca5a5">La rebaja no puede ser igual o mayor que el monto.</span>`
          : `Se registra <b>${fmt(net)}</b> como ingreso (bruto ${fmt(gross)} − rebaja ${fmt(ded)}).`;
      } else info.innerHTML = "";
    };
    g.addEventListener("input", drawDed); dd.addEventListener("input", drawDed); drawDed();
  }
  $("#tx-save").onclick = () => {
    const gross = numOf($("#tx-amt"));
    if (gross <= 0) return toast("Escribe un monto");
    let deduction = 0, deductionNote = "";
    if (isIncome) {
      deduction = numOf($("#tx-ded")); if (deduction < 0) deduction = 0;
      if (deduction >= gross) return toast("La rebaja no puede ser igual o mayor que el monto");
      deductionNote = ($("#tx-ded-note").value || "").trim();
    }
    const amt = isIncome ? Math.round((gross - deduction) * 100) / 100 : gross;
    const date = combineDateTime($("#tx-date").value, $("#tx-time").value);
    const data = { type: isIncome ? "income" : "expense", amount: amt, category: sel.category, note: $("#tx-note").value.trim(), ref: $("#tx-ref").value.trim(), account: accountsExist() ? sel.account : undefined };
    if (isIncome && deduction > 0) { data.deduction = deduction; data.deductionNote = deductionNote; }
    if (editing) {
      Object.assign(editing, data, { date });
      if (!(isIncome && deduction > 0)) { delete editing.deduction; delete editing.deductionNote; }
    } else { DB.transactions.push({ id: uid(), date, ...data }); }
    save(); closeSheet(); render();
    toast(editing ? "Actualizado" : isIncome ? "Ingreso registrado" : "Gasto registrado");
  };
}

/* ---- Gestionar categorías ---- */
function openCategories(type) {
  const title = type === "income" ? "Categorías de ingreso" : "Categorías de gasto";
  const draw = () => {
    openSheet(`
      <div class="toolbar"><h2 style="margin:0">${title}</h2></div>
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
/* Sugerencia de límite: promedio mensual gastado en la categoría (últimos meses
   con datos), redondeado a 500 para que quede prolijo. */
function suggestBudget(cat) {
  let sum = 0, months = 0, mk = shiftMonth(monthKeyOf(new Date()), -1);
  for (let i = 0; i < 3; i++) {
    const t = monthTotals(mk);
    if (t.count > 0) { const b = categoryBreakdown(mk, "expense").find(x => x.name === cat); sum += b ? b.value : 0; months++; }
    mk = shiftMonth(mk, -1);
  }
  if (!months) return 0;
  return Math.round(sum / months / 500) * 500;
}
function openBudgets() {
  const hasHist = lastMonths(4).slice(0, -1).some(mk => monthTotals(mk).count > 0);
  const draw = () => {
    const pc = payCycle();
    const per = pc.freq === "quincenal" ? "quincena" : "mes";
    const rows = budgetCycleStatus();
    openSheet(`
    <div class="toolbar"><h2 style="margin:0">Presupuestos</h2></div>

    <div class="card">
      <div class="row"><h2 style="margin:0">Ciclo actual</h2><span class="lbl">${pc.freq === "quincenal" ? "Quincenal" : "Mensual"}</span></div>
      <div class="hint" style="margin-top:2px">${cycleRangeLabel(pc)}</div>
      <div class="gap"></div>
      <div class="seg" id="bud-freq"><button data-f="mensual" class="${pc.freq === "mensual" ? "on" : ""}">Mensual</button><button data-f="quincenal" class="${pc.freq === "quincenal" ? "on" : ""}">Quincenal</button></div>
      <div class="gap"></div>
      <button class="btn line" id="bud-reset">🔄 Reiniciar ciclo ahora</button>
      <div class="hint" style="margin-top:8px">El conteo se reinicia solo cada ${per}. Y podés reiniciarlo a mano cuando te paguen (o cuando quieras), para que calce con el día real del pago.</div>
    </div>

    ${rows.length ? `<div class="card">
      <h2>Lo que va del ciclo</h2>
      ${rows.map(b => `
        <div class="bud">
          <div class="bud-top"><span><i class="cdot" style="background:${b.color}"></i>${esc(b.name)}</span>
            <span class="${b.over ? "over" : ""}">${fmt(b.spent)} / ${fmt(b.limit)}</span></div>
          <div class="kpi-bar"><i style="width:${b.pct}%${b.over ? ";background:var(--red)" : ""}"></i></div>
        </div>`).join("")}
    </div>` : ""}

    <p class="hint">Define un límite por ${per} por categoría de gasto. Deja en 0 para no limitar.</p>
    ${hasHist ? `<button class="btn line" id="bud-suggest" style="margin-bottom:14px">✨ Sugerir según tu histórico</button>` : ""}
    <div class="card">
      ${DB.categories.expense.map(c => `
        <label class="field bud-field"><span><i class="cdot" style="background:${catColor(c, "expense")}"></i>${esc(c)}</span>
          <input type="text" data-bud="${esc(c)}" inputmode="decimal" placeholder="0" value="${DB.budgets[c] || ""}" /></label>
      `).join("")}
    </div>
    <button class="btn" id="bud-save">Guardar presupuestos</button>
    <div class="gap"></div><button class="btn line" onclick="closeSheet()">Cerrar</button>
  `, { fullscreen: true });

    $$("#bud-freq button").forEach(b => b.onclick = () => {
      DB.settings.payCycle = { freq: b.dataset.f, anchor: todayKeyStr() }; save(); draw();
    });
    $("#bud-reset").onclick = () => {
      if (!confirm("¿Reiniciar el ciclo desde hoy? El conteo de gastos de cada presupuesto vuelve a cero.")) return;
      DB.settings.payCycle = { freq: payCycle().freq, anchor: todayKeyStr() }; save(); draw();
      toast("Ciclo reiniciado desde hoy");
    };
    const sug = $("#bud-suggest");
    if (sug) sug.onclick = () => {
      const scale = cyclesPerMonth();
      let filled = 0;
      $$("[data-bud]").forEach(inp => { const s = Math.round(suggestBudget(inp.dataset.bud) / scale / 500) * 500; if (s > 0) { inp.value = s; filled++; } });
      toast(filled ? "Límites sugeridos, ajústalos y guarda" : "Aún no hay historial suficiente");
    };
    $("#bud-save").onclick = () => {
      $$("[data-bud]").forEach(inp => {
        const v = parseAmount(inp.value);
        if (v > 0) DB.budgets[inp.dataset.bud] = v; else delete DB.budgets[inp.dataset.bud];
      });
      save(); draw(); render(); toast("Presupuestos guardados");
    };
  };
  draw();
}

/* ---- Movimientos fijos (recurrentes) ---- */
function recurringDoneThisMonth(r) { return r.lastPosted === monthKeyOf(new Date()); }
function openRecurring() {
  const draw = () => {
    const loc = DB.settings.locale || "es-CR";
    const recRow = (r) => {
      const pending = recurringPending(r), done = recurringDoneThisMonth(r);
      const status = pending ? `<span class="rec-st pend">Pendiente este mes</span>`
        : done ? `<span class="rec-st ok">✓ Registrado este mes</span>`
        : `Próximo: ${recurringNextDate(r).toLocaleDateString(loc, { day: "numeric", month: "short" })}`;
      const actions = pending
        ? `<button class="btn small" data-conf-rec="${r.id}">${r.type === "income" ? "Confirmar ingreso" : "Confirmar pago"}</button><button class="btn small line" data-skip-rec="${r.id}">Saltar</button>`
        : done ? ""
        : `<button class="btn small line" data-add-rec="${r.id}">Registrar ahora</button>`;
      return `<div class="rec-item">
        <div class="list-item" style="padding-bottom:6px">
          <span class="cdot" style="background:${catColor(r.category, r.type)}"></span>
          <div class="grow"><div class="t">${esc(r.note || r.category)}${r.auto ? ` <span class="rec-badge">🔁 Auto</span>` : ""}</div>
            <div class="s">Día ${r.day} · ${r.type === "income" ? "Ingreso" : "Gasto"}${r.account ? " · " + esc(accountName(r.account)) : ""} · ${status}</div></div>
          <div class="amt ${r.type === "income" ? "in" : "out"}">${r.type === "income" ? "+" : "−"}${fmt(r.amount)}</div>
        </div>
        <div class="btn-row" style="margin:0 0 2px 34px">${actions}<button class="btn small soft-danger" data-del-rec="${r.id}">Eliminar</button></div>
      </div>`;
    };
    openSheet(`
      <div class="toolbar"><h2 style="margin:0">Movimientos fijos</h2></div>
      <p class="hint">Ingresos y gastos que se repiten cada mes (alquiler, salario, servicios). Déjalos en automático o confírmalos con un toque cuando toquen.</p>
      ${DB.recurring.length ? `<div class="card">${DB.recurring.map(recRow).join("")}</div>` : `<div class="card muted">Aún no tienes movimientos fijos.</div>`}

      <div class="card">
        <h2>Nuevo fijo</h2>
        <div class="seg" id="rec-type"><button data-t="expense" class="on">Gasto</button><button data-t="income">Ingreso</button></div>
        <div class="gap"></div>
        <label class="field"><span>Monto</span><input type="text" id="rec-amt" inputmode="decimal" placeholder="0" /></label>
        <label class="field"><span>Descripción</span><input type="text" id="rec-note" placeholder="Alquiler, salario…" /></label>
        <label class="field"><span>Día del mes</span><input type="number" id="rec-day" min="1" max="31" value="1" /></label>
        ${accountsExist() ? `<div class="label">Cuenta</div>
        <div class="chips" id="rec-accs">${DB.accounts.map((a, i) => `<button data-a="${a.id}" class="${i === 0 ? "on" : ""}">${esc(a.name)}</button>`).join("")}</div>
        <div class="gap"></div>` : ""}
        <div class="label">Categoría</div>
        <div class="chips" id="rec-cats"></div>
        <div class="gap"></div>
        <div class="switch-row"><span>Registrarlo automáticamente cada mes</span><label class="switch"><input type="checkbox" id="rec-auto" /><span class="sl"></span></label></div>
        <div class="hint">Si lo activas, se anota solo el día indicado. Si no, te aparecerá para confirmarlo.</div>
        <div class="gap"></div>
        <button class="btn" id="rec-add">Agregar fijo</button>
      </div>
    `, { fullscreen: true });

    let recType = "expense";
    let recCat = DB.categories.expense[0];
    let recAcc = DB.accounts[0] && DB.accounts[0].id;
    let recAuto = false;
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
    $$("#rec-accs button").forEach(b => b.onclick = () => {
      recAcc = b.dataset.a; $$("#rec-accs button").forEach(x => x.classList.toggle("on", x === b));
    });
    const autoEl = $("#rec-auto"); if (autoEl) autoEl.onchange = () => recAuto = autoEl.checked;
    $("#rec-add").onclick = () => {
      const amt = parseAmount($("#rec-amt").value);
      if (amt <= 0) return toast("Escribe un monto");
      const day = Math.max(1, Math.min(31, +$("#rec-day").value || 1));
      DB.recurring.push({ id: uid(), type: recType, amount: amt, category: recCat, note: $("#rec-note").value.trim(), day, account: accountsExist() ? recAcc : undefined, auto: recAuto });
      save(); draw();
    };
    $$("[data-del-rec]").forEach(b => b.onclick = () => {
      DB.recurring = DB.recurring.filter(r => r.id !== b.dataset.delRec); save(); draw();
    });
    $$("[data-conf-rec]").forEach(b => b.onclick = () => { const r = DB.recurring.find(x => x.id === b.dataset.confRec); if (r) { postRecurring(r); save(); toast("Registrado"); draw(); } });
    $$("[data-skip-rec]").forEach(b => b.onclick = () => { const r = DB.recurring.find(x => x.id === b.dataset.skipRec); if (r) { skipRecurring(r); save(); toast("Saltado este mes"); draw(); } });
    $$("[data-add-rec]").forEach(b => b.onclick = () => { const r = DB.recurring.find(x => x.id === b.dataset.addRec); if (r) { postRecurring(r); save(); toast("Registrado"); draw(); } });
  };
  draw();
}
/* ---- Próximos pagos (calendario de flujo) ---- */
function openUpcoming() {
  const loc = DB.settings.locale || "es-CR";
  const pend = recurringPendings();
  const items = upcomingItems(45).filter(i => !i.pending);
  const total30 = Math.round(upcomingTotal(30));
  const dl = k => new Date(k + "T12:00:00").toLocaleDateString(loc, { weekday: "short", day: "numeric", month: "short" });
  const when = da => da < 0 ? `Vencido hace ${Math.abs(da)}d` : da === 0 ? "Hoy" : da === 1 ? "Mañana" : `En ${da} días`;
  const row = it => `<div class="list-item ${it.kind === "debt" ? "up-debt" : ""}" ${it.kind === "debt" ? `data-up-debt="${it.id}"` : ""}>
      <span class="mov-ic">${it.kind === "debt" ? "💸" : "🧾"}</span>
      <div class="grow"><div class="t">${esc(it.name)}</div><div class="s ${it.daysAway < 0 ? "over" : ""}">${dl(it.key)} · ${when(it.daysAway)}</div></div>
      <div class="amt out">−${fmt(it.amount)}</div>
    </div>`;
  openSheet(`
    <div class="toolbar"><h2 style="margin:0">Próximos pagos</h2></div>
    <div class="card center">
      <div class="lbl">En los próximos 30 días</div>
      <div class="mo-h-score big"><b>${fmt(total30)}</b></div>
      <div class="hint">Esto es lo que se te viene. Tenlo en el radar.</div>
    </div>
    ${pend.length ? `<div class="card">
      <div class="section-title" style="margin:0 0 8px">Por confirmar</div>
      <div class="hint" style="margin-bottom:10px">Fijos que ya tocaban este mes. Confírmalos si ya pasaron, o sáltalos.</div>
      ${pend.map(r => `<div class="rec-item">
        <div class="list-item" style="padding-bottom:6px">
          <span class="cdot" style="background:${catColor(r.category, r.type)}"></span>
          <div class="grow"><div class="t">${esc(r.note || r.category)}</div><div class="s">Día ${r.day} · ${r.type === "income" ? "Ingreso" : "Gasto"}</div></div>
          <div class="amt ${r.type === "income" ? "in" : "out"}">${r.type === "income" ? "+" : "−"}${fmt(r.amount)}</div>
        </div>
        <div class="btn-row" style="margin:0 0 2px 34px"><button class="btn small" data-conf-rec="${r.id}">${r.type === "income" ? "Confirmar" : "Confirmar pago"}</button><button class="btn small line" data-skip-rec="${r.id}">Saltar</button></div>
      </div>`).join("")}
    </div>` : ""}
    ${items.length ? `<div class="card"><div class="section-title" style="margin:0 0 8px">Se viene</div>${items.map(row).join("")}</div>`
      : (pend.length ? "" : `<div class="card muted">No tienes pagos próximos. Agrega deudas con fecha de pago o movimientos fijos y aparecerán aquí.</div>`)}
    <div class="gap"></div><button class="btn line" onclick="closeSheet()">Cerrar</button>
  `, { fullscreen: true });
  $$("[data-conf-rec]").forEach(b => b.onclick = () => { const r = DB.recurring.find(x => x.id === b.dataset.confRec); if (r) { postRecurring(r); save(); toast("Registrado"); openUpcoming(); } });
  $$("[data-skip-rec]").forEach(b => b.onclick = () => { const r = DB.recurring.find(x => x.id === b.dataset.skipRec); if (r) { skipRecurring(r); save(); toast("Saltado"); openUpcoming(); } });
  $$("[data-up-debt]").forEach(b => b.onclick = () => openDebts());
}

/* ---- Transferencia entre cuentas ---- */
function openTransfer(editId) {
  if (DB.accounts.length < 2) return toast("Necesitas al menos 2 cuentas");
  const ed = editId ? DB.transactions.find(t => t.id === editId) : null;
  const sel = { from: ed ? ed.from : DB.accounts[0].id, to: ed ? ed.to : DB.accounts[1].id };
  openSheet(`
    <h2>${ed ? "Editar transferencia" : "Transferencia"}</h2>
    <label class="field"><span>Monto</span><input type="text" id="tr-amt" inputmode="decimal" placeholder="0" value="${ed ? ed.amount : ""}" /></label>
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
    const amt = parseAmount($("#tr-amt").value);
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
  let editing = null;
  const draw = () => {
    const ekind = editing ? editing.kind : ACCOUNT_KINDS[0];
    openSheet(`
      <div class="toolbar"><h2 style="margin:0">Cuentas</h2></div>
      <p class="hint">Efectivo, banco o tarjeta. El saldo se calcula con tu saldo inicial más tus movimientos.</p>
      ${DB.accounts.length ? `<div class="card">${DB.accounts.map(a => `
        <div class="list-item">
          <span class="mov-ic acc-ic">${ACCOUNT_ICON[a.kind] || "◆"}</span>
          <div class="grow"><div class="t">${esc(a.name)}</div><div class="s">${esc(a.kind)} · saldo ${fmt(accountBalance(a.id))}</div></div>
          <button class="btn small line" data-edit-acc="${a.id}">Editar</button>
          <button class="btn small soft-danger" data-del-acc="${a.id}">×</button>
        </div>`).join("")}</div>` : `<div class="card muted">Aún no tienes cuentas.</div>`}
      <div class="card">
        <h2>${editing ? "Editar cuenta" : "Nueva cuenta"}</h2>
        <label class="field"><span>Nombre</span><input type="text" id="acc-name" placeholder="Ej. Banco, Efectivo" value="${editing ? esc(editing.name) : ""}" /></label>
        <div class="label">Tipo</div>
        <div class="seg" id="acc-kind">${ACCOUNT_KINDS.map(k => `<button data-k="${k}" class="${ekind === k ? "on" : ""}">${k[0].toUpperCase() + k.slice(1)}</button>`).join("")}</div>
        <div class="gap"></div>
        <label class="field"><span>Saldo inicial</span><input type="text" id="acc-open" inputmode="decimal" placeholder="0" value="${editing ? editing.opening : ""}" /></label>
        <button class="btn" id="acc-add">${editing ? "Guardar cambios" : "Agregar cuenta"}</button>
        ${editing ? `<div class="gap"></div><button class="btn line" id="acc-cancel">Cancelar edición</button>` : ""}
      </div>
    `, { fullscreen: true });
    let kind = ekind;
    $$("#acc-kind button").forEach(b => b.onclick = () => { kind = b.dataset.k; $$("#acc-kind button").forEach(x => x.classList.toggle("on", x === b)); });
    $("#acc-add").onclick = () => {
      const name = $("#acc-name").value.trim(); if (!name) return toast("Ponle un nombre");
      const opening = parseAmount($("#acc-open").value);
      if (editing) Object.assign(editing, { name, kind, opening });
      else DB.accounts.push({ id: uid(), name, kind, opening });
      editing = null; save(); draw();
    };
    if (editing) $("#acc-cancel").onclick = () => { editing = null; draw(); };
    $$("[data-edit-acc]").forEach(b => b.onclick = () => { editing = DB.accounts.find(a => a.id === b.dataset.editAcc); draw(); });
    $$("[data-del-acc]").forEach(b => b.onclick = () => {
      const id = b.dataset.delAcc;
      const used = DB.transactions.some(t => t.account === id || t.from === id || t.to === id);
      if (used && !confirm("Esta cuenta tiene movimientos. Al borrarla, sus ingresos y gastos quedarán sin cuenta, y las transferencias que la usen se eliminarán. ¿Continuar?")) return;
      DB.transactions = DB.transactions.filter(t => !(t.type === "transfer" && (t.from === id || t.to === id)));
      DB.transactions.forEach(t => { if (t.account === id) t.account = undefined; });
      DB.accounts = DB.accounts.filter(a => a.id !== id);
      if (editing && editing.id === id) editing = null;
      save(); draw();
    });
  };
  draw();
}

/* ---- Metas y deudas ---- */
function goalLine(g) {
  const pace = goalPace(g), rem = goalRemaining(g);
  if (pace && pace.done) return `<span style="color:var(--green)">${pace.label}</span>`;
  const parts = [`Falta ${fmt(rem)}`];
  if (g.targetDate) {
    parts.push(`aparta ${fmt(goalPerPeriod(g))}${goalFreq(g).per}`);
    if (pace) parts.push(`<span style="color:${pace.tint}">${pace.label}</span>`);
  } else parts.push(`${Math.round(goalPct(g))}%`);
  return parts.join(" · ");
}
function goalsCardHTML() {
  return `<div class="card">
    <div class="row"><h2 style="margin:0">Metas de ahorro</h2><button class="linkbtn" id="h-goals">Gestionar</button></div>
    <div class="gap"></div>
    ${DB.goals.map(g => `<div class="bud">
      <div class="bud-top"><span>🎯 ${esc(g.name)}</span><span>${fmt(g.saved || 0)} / ${fmt(g.target || 0)}</span></div>
      <div class="kpi-bar"><i style="width:${goalPct(g)}%"></i></div>
      <div class="hint" style="margin-top:6px">${goalLine(g)}</div>
    </div>`).join("")}
  </div>`;
}
function openGoals() {
  const loc = DB.settings.locale || "es-CR";
  const draw = () => {
    openSheet(`
      <div class="toolbar"><h2 style="margin:0">Metas de ahorro</h2></div>
      <p class="hint">Fija un objetivo, ponle fecha y elige si guardás por mes o por quincena: te digo cuánto apartar para llegar.</p>
      ${DB.goals.length ? `<div class="card">${DB.goals.map(g => {
        const pace = goalPace(g);
        return `<div class="goal">
          <div class="bud-top"><span>🎯 ${esc(g.name)}</span><span>${fmt(g.saved || 0)} / ${fmt(g.target || 0)}</span></div>
          <div class="kpi-bar"><i style="width:${goalPct(g)}%"></i></div>
          <div class="hint" style="margin-top:6px">${goalLine(g)}${g.targetDate ? ` · para ${new Date(g.targetDate).toLocaleDateString(loc, { month: "short", year: "numeric" })}` : ""}</div>
          <div class="btn-row" style="margin:10px 0 0">
            ${goalRemaining(g) > 0 ? `<button class="btn small" data-add-goal="${g.id}">+ Aporte</button>` : ""}
            <button class="btn small line" data-edit-goal="${g.id}">Editar</button>
            <button class="btn small soft-danger" data-del-goal="${g.id}">×</button>
          </div>
        </div>`; }).join("")}</div>` : `<div class="card muted">Aún no tienes metas de ahorro.</div>`}
      <div class="card">
        <h2>Nueva meta</h2>
        <label class="field"><span>Nombre</span><input type="text" id="goal-name" placeholder="Ej. Fondo de emergencia" /></label>
        ${cushion().monthly > 0 ? `<button class="btn small line" id="goal-cushion" style="margin-bottom:12px">Sugerir colchón de 1 mes (${fmt(Math.round(cushion().monthly))})</button>` : ""}
        <label class="field"><span>Monto objetivo</span><input type="text" id="goal-target" inputmode="decimal" placeholder="0" /></label>
        <label class="field"><span>Fecha objetivo (opcional)</span><input type="date" id="goal-date" /></label>
        <div class="label">Quiero guardar cada</div>
        <div class="seg" id="goal-freq"><button data-v="mensual" class="on">Mes</button><button data-v="quincenal">Quincena</button></div>
        <div class="gap"></div>
        <label class="field"><span>Ya llevas (opcional)</span><input type="text" id="goal-saved" inputmode="decimal" placeholder="0" /></label>
        <button class="btn" id="goal-add">Crear meta</button>
      </div>
    `, { fullscreen: true });
    const cush = $("#goal-cushion");
    if (cush) cush.onclick = () => { $("#goal-target").value = Math.round(cushion().monthly); if (!$("#goal-name").value.trim()) $("#goal-name").value = "Colchón de emergencia"; };
    let freqSel = "mensual";
    $$("#goal-freq button").forEach(b => b.onclick = () => { freqSel = b.dataset.v; $$("#goal-freq button").forEach(x => x.classList.toggle("on", x === b)); });
    $("#goal-add").onclick = () => {
      const name = $("#goal-name").value.trim(); if (!name) return toast("Ponle un nombre");
      const target = parseAmount($("#goal-target").value); if (target <= 0) return toast("Escribe el objetivo");
      const dv = $("#goal-date").value;
      DB.goals.push({ id: uid(), name, kind: "ahorro", target, saved: parseAmount($("#goal-saved").value), freq: freqSel, targetDate: dv ? new Date(dv + "T12:00:00").toISOString() : "", createdAt: todayISO() });
      save(); draw();
    };
    $$("[data-add-goal]").forEach(b => b.onclick = () => openGoalContribution(b.dataset.addGoal, draw));
    $$("[data-edit-goal]").forEach(b => b.onclick = () => openGoalForm(b.dataset.editGoal, draw));
    $$("[data-del-goal]").forEach(b => b.onclick = () => { if (confirm("¿Eliminar esta meta?")) { DB.goals = DB.goals.filter(g => g.id !== b.dataset.delGoal); save(); draw(); } });
  };
  draw();
}
function openGoalContribution(id, after) {
  const g = DB.goals.find(x => x.id === id); if (!g) return;
  openSheet(`
    <h2>Aporte a ${esc(g.name)}</h2>
    <div class="hint">Llevas ${fmt(g.saved || 0)} de ${fmt(g.target)} · falta ${fmt(goalRemaining(g))}.</div>
    <div class="gap"></div>
    <label class="field"><span>¿Cuánto apartaste?</span><input type="text" id="gc-amt" inputmode="decimal" placeholder="0" /></label>
    <button class="btn" id="gc-save">Guardar aporte</button>
    <div class="gap"></div><button class="btn line" onclick="closeSheet()">Cancelar</button>
  `);
  $("#gc-save").onclick = () => {
    const amt = parseAmount($("#gc-amt").value); if (amt <= 0) return toast("Escribe un monto");
    g.saved = (g.saved || 0) + amt; save(); closeSheet();
    if (goalRemaining(g) <= 0) toast("¡Meta cumplida! 🎉"); else toast("Aporte guardado");
    if (after) after();
  };
}
function openGoalForm(id, after) {
  const g = DB.goals.find(x => x.id === id); if (!g) return;
  let freqSel = GOAL_FREQ[g.freq] ? g.freq : "mensual";
  openSheet(`
    <h2>Editar meta</h2>
    <label class="field"><span>Nombre</span><input type="text" id="gf-name" value="${esc(g.name)}" /></label>
    <label class="field"><span>Monto objetivo</span><input type="text" id="gf-target" inputmode="decimal" value="${g.target || ""}" /></label>
    <label class="field"><span>Fecha objetivo (opcional)</span><input type="date" id="gf-date" value="${g.targetDate ? dateInputValue(g.targetDate) : ""}" /></label>
    <div class="label">Quiero guardar cada</div>
    <div class="seg" id="gf-freq">${Object.entries(GOAL_FREQ).map(([k, v]) => `<button data-v="${k}" class="${freqSel === k ? "on" : ""}">${v.label}</button>`).join("")}</div>
    <div class="gap"></div>
    <label class="field"><span>Ahorrado</span><input type="text" id="gf-saved" inputmode="decimal" value="${g.saved || 0}" /></label>
    <button class="btn" id="gf-save">Guardar cambios</button>
    <div class="gap"></div><button class="btn line" onclick="closeSheet()">Cancelar</button>
  `);
  $$("#gf-freq button").forEach(b => b.onclick = () => { freqSel = b.dataset.v; $$("#gf-freq button").forEach(x => x.classList.toggle("on", x === b)); });
  $("#gf-save").onclick = () => {
    const name = $("#gf-name").value.trim(); if (!name) return toast("Ponle un nombre");
    const target = parseAmount($("#gf-target").value); if (target <= 0) return toast("Escribe el objetivo");
    const dv = $("#gf-date").value;
    Object.assign(g, { name, target, saved: parseAmount($("#gf-saved").value), freq: freqSel, targetDate: dv ? new Date(dv + "T12:00:00").toISOString() : "" });
    save(); closeSheet(); if (after) after();
  };
}

/* ---- Deudas y préstamos ---- */
function debtsCardHTML() {
  const owe = totalOwe(), owed = totalOwed();
  const active = DB.debts.filter(d => debtStatus(d) !== "pagada").sort((a, b) => (a.dueDate || "9") < (b.dueDate || "9") ? -1 : 1).slice(0, 4);
  return `<div class="card">
    <div class="row"><h2 style="margin:0">Deudas y préstamos</h2><button class="linkbtn" id="h-debts">Gestionar</button></div>
    <div class="gap"></div>
    <div class="cmp"><span>Yo debo</span><span class="amt out">${fmt(owe)}</span></div>
    <div class="cmp"><span>Me deben</span><span class="amt in">${fmt(owed)}</span></div>
    ${active.length ? `<div class="gap"></div>${active.map(d => `
      <div class="list-item">
        <span class="mov-ic">${d.dir === "owe" ? "💸" : "💰"}</span>
        <div class="grow"><div class="t">${esc(d.name)}</div><div class="s">${d.dueDate ? "Vence " + new Date(d.dueDate).toLocaleDateString(DB.settings.locale || "es-CR", { day: "numeric", month: "short" }) : "Sin fecha"} · Saldo ${fmt(debtBalance(d))}</div></div>
        ${debtStatusPill(debtStatus(d))}
      </div>`).join("")}` : ""}
  </div>`;
}
function openDebts() {
  openSheet(`
    <div class="toolbar"><h2 style="margin:0">Deudas y préstamos</h2></div>
    <div class="sumbar">
      <div class="sb"><div class="sb-k">Yo debo</div><div class="sb-v out">${fmt(totalOwe())}</div></div>
      <div class="sb"><div class="sb-k">Me deben</div><div class="sb-v in">${fmt(totalOwed())}</div></div>
      <div class="sb"><div class="sb-k">Neto</div><div class="sb-v">${fmt(totalOwed() - totalOwe())}</div></div>
    </div>
    ${DB.debts.length ? DB.debts.map(d => {
      const bal = debtBalance(d), cap = debtCapitalPaid(d), pct = d.principal ? Math.min(100, cap / d.principal * 100) : 0, mi = debtMonthlyInterest(d), intPaid = debtInterestPaid(d);
      return `<div class="card">
        <div class="row"><strong>${d.dir === "owe" ? "💸" : "💰"} ${esc(d.name)}</strong>${debtStatusPill(debtStatus(d))}</div>
        ${d.party ? `<div class="hint">${d.dir === "owe" ? "A" : "De"}: ${esc(d.party)}</div>` : ""}
        <div class="gap"></div>
        <div class="bud-top"><span>Saldo ${fmt(bal)}</span><span>Capital ${fmt(cap)} / ${fmt(d.principal)}</span></div>
        <div class="kpi-bar"><i style="width:${pct}%"></i></div>
        <div class="hint" style="margin-top:6px">${d.dueDate ? "Vence " + new Date(d.dueDate).toLocaleDateString(DB.settings.locale || "es-CR", { day: "numeric", month: "short", year: "numeric" }) : "Sin fecha"}${d.rate ? ` · Interés ~${fmt(mi)}/mes (${d.rate}% ${d.ratePeriod})` : ""}${intPaid > 0.5 ? ` · Intereses pagados ${fmt(intPaid)}` : ""}</div>
        ${(() => { if (bal <= 0 || !d.monthly) return ""; const p = debtProjection(d);
          if (p.never) return `<div class="proj"><div class="proj-warn">⚠️ La cuota (${fmt(d.monthly)}) no cubre el interés del mes (${fmt(p.monthlyInterest)}); el saldo no bajaría.</div></div>`;
          return `<div class="proj"><div class="proj-row"><span>Cuota ${fmt(d.monthly)}/mes · faltan</span><b>${fmtMonths(p.months)}</b></div><div class="proj-row"><span>Aún por pagar</span><b>${fmt(p.totalPay)}</b></div>${p.totalInterest > 0.5 ? `<div class="proj-row"><span>Intereses restantes</span><b>${fmt(p.totalInterest)}</b></div>` : ""}</div>`; })()}
        ${(d.payments && d.payments.length) ? `<div class="gap"></div><button class="linkbtn" data-d-hist="${d.id}">Ver historial de pagos (${d.payments.length})</button>` : ""}
        <div class="btn-row" style="margin:12px 0 0">
          ${bal > 0 ? `<button class="btn small" data-d-pay="${d.id}">${d.dir === "owe" ? "+ Pago" : "+ Abono"}</button>` : ""}
          <button class="btn small line" data-d-edit="${d.id}">Editar</button>
          <button class="btn small soft-danger" data-d-del="${d.id}">Eliminar</button>
        </div>
      </div>`;
    }).join("") : `<div class="card muted">Aún no tienes deudas ni préstamos.</div>`}
    <button class="btn" id="d-new">+ Nueva deuda / préstamo</button>
    <div class="gap"></div><button class="btn line" onclick="closeSheet()">Cerrar</button>
  `, { fullscreen: true });
  $("#d-new").onclick = () => openDebtForm();
  $$("[data-d-edit]").forEach(b => b.onclick = () => openDebtForm(b.dataset.dEdit));
  $$("[data-d-pay]").forEach(b => b.onclick = () => openDebtPayment(b.dataset.dPay));
  $$("[data-d-hist]").forEach(b => b.onclick = () => openDebtHistory(b.dataset.dHist));
  $$("[data-d-del]").forEach(b => b.onclick = () => { if (confirm("¿Eliminar esta deuda?")) { DB.debts = DB.debts.filter(x => x.id !== b.dataset.dDel); save(); openDebts(); } });
}
function openDebtHistory(id) {
  const d = DB.debts.find(x => x.id === id); if (!d) return;
  const pays = (d.payments || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  const accName = aid => { const a = DB.accounts.find(x => x.id === aid); return a ? esc(a.name) : ""; };
  const intTotal = debtInterestPaid(d), capTotal = debtCapitalPaid(d);
  openSheet(`
    <div class="toolbar"><h2 style="margin:0">Historial de pagos</h2></div>
    <div class="hint">${d.dir === "owe" ? "💸" : "💰"} ${esc(d.name)} · ${pays.length} ${pays.length === 1 ? "pago" : "pagos"}</div>
    <div class="gap"></div>
    <div class="proj">
      <div class="proj-row"><span>Total pagado</span><b>${fmt(debtPaid(d))}</b></div>
      <div class="proj-row"><span>Abonado a capital</span><b>${fmt(capTotal)}</b></div>
      ${intTotal > 0.5 ? `<div class="proj-row"><span>Intereses pagados</span><b>${fmt(intTotal)}</b></div>` : ""}
    </div>
    <div class="gap"></div>
    ${pays.length ? `<div class="card">${pays.map(p => `
      <div class="list-item">
        <span class="mov-ic">${d.dir === "owe" ? "💸" : "💰"}</span>
        <div class="grow">
          <div class="t">${fmt(p.amount)}</div>
          <div class="s">${new Date(p.date).toLocaleDateString(DB.settings.locale || "es-CR", { day: "numeric", month: "short", year: "numeric" })}${p.account ? " · " + accName(p.account) : ""}${p.txId ? " · en movimientos" : ""}</div>
          ${payInterest(p) > 0.5 ? `<div class="s">Interés ${fmt(payInterest(p))} · Capital ${fmt(payCapital(p))}</div>` : ""}
        </div>
        <button class="btn small line" data-p-edit="${p.id}">Editar</button>
        <button class="btn small soft-danger" data-p-del="${p.id}" aria-label="Eliminar">×</button>
      </div>`).join("")}</div>` : `<div class="card muted">Sin pagos registrados.</div>`}
    <div class="gap"></div><button class="btn line" onclick="closeSheet()">Cerrar</button>
  `, { fullscreen: true });
  $$("[data-p-edit]").forEach(b => b.onclick = () => openDebtPayment(id, b.dataset.pEdit));
  $$("[data-p-del]").forEach(b => b.onclick = () => {
    const pid = b.dataset.pDel;
    const p = (d.payments || []).find(x => x.id === pid); if (!p) return;
    if (!confirm("¿Eliminar este pago?" + (p.txId ? " También se eliminará su movimiento asociado." : ""))) return;
    if (p.txId) DB.transactions = DB.transactions.filter(t => t.id !== p.txId);
    d.payments = d.payments.filter(x => x.id !== pid);
    save();
    if (d.payments.length) openDebtHistory(id); else { closeSheet(); openDebts(); }
  });
}
function openDebtForm(editId) {
  const ed = editId ? DB.debts.find(d => d.id === editId) : null;
  let dir = ed ? ed.dir : "owe";
  let ratePeriod = ed ? ed.ratePeriod : "anual";
  openSheet(`
    <h2>${ed ? "Editar deuda" : "Nueva deuda / préstamo"}</h2>
    <div class="label">Tipo</div>
    <div class="seg" id="d-dir"><button data-v="owe" class="${dir === "owe" ? "on" : ""}">💸 Yo debo</button><button data-v="owed" class="${dir === "owed" ? "on" : ""}">💰 Me deben</button></div>
    <div class="gap"></div>
    <label class="field"><span>Nombre</span><input type="text" id="d-name" placeholder="Ej. Préstamo del carro" value="${ed ? esc(ed.name) : ""}" /></label>
    <label class="field"><span>Persona o entidad (opcional)</span><input type="text" id="d-party" placeholder="Ej. Banco, Juan…" value="${ed ? esc(ed.party) : ""}" /></label>
    <label class="field"><span>Monto</span><input type="text" id="d-principal" inputmode="decimal" placeholder="0" value="${ed ? ed.principal : ""}" /></label>
    <label class="field"><span>Interés % (opcional)</span><input type="text" id="d-rate" inputmode="decimal" placeholder="0" value="${ed && ed.rate ? ed.rate : ""}" /></label>
    <div class="seg" id="d-rperiod"><button data-v="anual" class="${ratePeriod === "anual" ? "on" : ""}">Anual</button><button data-v="mensual" class="${ratePeriod === "mensual" ? "on" : ""}">Mensual</button></div>
    <div class="gap"></div>
    <label class="field"><span>Cuota / pago mensual (opcional)</span><input type="text" id="d-monthly" inputmode="decimal" placeholder="0" value="${ed && ed.monthly ? ed.monthly : ""}" /></label>
    <div id="d-proj" class="proj"></div>
    <div class="gap"></div>
    <label class="field"><span>Fecha de pago (opcional)</span><input type="date" id="d-due" value="${ed && ed.dueDate ? dateInputValue(ed.dueDate) : ""}" /></label>
    <button class="btn" id="d-save">${ed ? "Guardar cambios" : "Crear"}</button>
    <div class="gap"></div><button class="btn line" onclick="closeSheet()">Cancelar</button>
  `, { fullscreen: true });
  $$("#d-dir button").forEach(b => b.onclick = () => { dir = b.dataset.v; $$("#d-dir button").forEach(x => x.classList.toggle("on", x === b)); });
  $$("#d-rperiod button").forEach(b => b.onclick = () => { ratePeriod = b.dataset.v; $$("#d-rperiod button").forEach(x => x.classList.toggle("on", x === b)); drawProj(); });
  const paidSoFar = ed ? debtCapitalPaid(ed) : 0;
  const drawProj = () => {
    const principal = parseAmount($("#d-principal").value);
    const monthly = parseAmount($("#d-monthly").value);
    const box = $("#d-proj"); if (!box) return;
    if (principal <= 0 || monthly <= 0) { box.innerHTML = ""; return; }
    // Proyecta sobre el saldo pendiente (capital menos lo ya abonado).
    const sim = { principal, payments: [{ amount: Math.min(paidSoFar, principal) }], rate: parseAmount($("#d-rate").value), ratePeriod, monthly };
    const p = debtProjection(sim);
    if (p.never) { box.innerHTML = `<div class="proj-warn">⚠️ La cuota (${fmt(monthly)}) no cubre el interés del mes (${fmt(p.monthlyInterest)}). Súbela para poder terminar de pagar.</div>`; return; }
    if (p.noPay || p.done) { box.innerHTML = ""; return; }
    box.innerHTML = `<div class="proj-row"><span>Tiempo estimado</span><b>${fmtMonths(p.months)}</b></div>
      <div class="proj-row"><span>Total a pagar</span><b>${fmt(p.totalPay)}</b></div>
      <div class="proj-row"><span>Intereses</span><b>${fmt(p.totalInterest)}</b></div>`;
  };
  ["#d-principal", "#d-rate", "#d-monthly"].forEach(s => { const el = $(s); if (el) el.oninput = drawProj; });
  drawProj();
  $("#d-save").onclick = () => {
    const name = $("#d-name").value.trim(); if (!name) return toast("Ponle un nombre");
    const principal = parseAmount($("#d-principal").value); if (principal <= 0) return toast("Escribe el monto");
    const dv = $("#d-due").value;
    const data = { name, party: $("#d-party").value.trim(), dir, principal, rate: parseAmount($("#d-rate").value), ratePeriod, monthly: parseAmount($("#d-monthly").value), dueDate: dv ? new Date(dv + "T12:00:00").toISOString() : "" };
    if (ed) Object.assign(ed, data);
    else DB.debts.push({ id: uid(), ...data, note: "", createdAt: todayISO(), payments: [] });
    save(); openDebts();
  };
}
function openDebtPayment(id, payId) {
  const d = DB.debts.find(x => x.id === id); if (!d) return;
  const editing = payId ? (d.payments || []).find(p => p.id === payId) : null;
  const hasRate = d.rate > 0;
  // Saldo base para sugerir el interés: si editas, se le suma de vuelta el capital de ese pago.
  const baseBalance = editing ? debtBalance(d) + payCapital(editing) : debtBalance(d);
  const monthlyRate = hasRate ? (d.ratePeriod === "mensual" ? d.rate : d.rate / 12) / 100 : 0;
  const sel = { link: editing ? !!editing.txId : false, account: (editing && editing.account) || (DB.accounts[0] ? DB.accounts[0].id : null) };
  const initAmt = editing ? editing.amount : (d.monthly || "");
  const initInt = editing ? payInterest(editing) : Math.min(parseAmount(initAmt) || 0, Math.round(baseBalance * monthlyRate));
  openSheet(`
    <h2>${editing ? "Editar pago" : (d.dir === "owe" ? "Registrar pago" : "Registrar abono")}</h2>
    <div class="hint">${esc(d.name)} · saldo ${fmt(baseBalance)}</div>
    <div class="gap"></div>
    <label class="field"><span>Monto${d.dir === "owe" ? " pagado" : ""}</span><input type="text" id="dp-amt" inputmode="decimal" placeholder="0" value="${initAmt}" /></label>
    <label class="field"><span>Interés${hasRate ? ` (${d.rate}% ${d.ratePeriod})` : " (si aplica)"}</span><input type="text" id="dp-int" inputmode="decimal" placeholder="0" value="${initInt || ""}" /></label>
    <label class="field"><span>Abono a capital</span><input type="text" id="dp-cap" inputmode="decimal" placeholder="0" /></label>
    <div class="hint" id="dp-note" style="margin:2px 2px 4px"></div>
    <div class="gap"></div>
    <label class="field"><span>Fecha</span><input type="date" id="dp-date" value="${editing ? dateInputValue(editing.date) : dateInputValue(todayISO())}" /></label>
    ${accountsExist() ? `
      <div class="switch-row"><span>Registrar también como movimiento</span><label class="switch"><input type="checkbox" id="dp-link" ${sel.link ? "checked" : ""} /><span class="sl"></span></label></div>
      <div id="dp-acc-wrap" ${sel.link ? "" : "hidden"}><div class="gap"></div><div class="label">${d.dir === "owe" ? "Sale de la cuenta" : "Entra a la cuenta"}</div><div class="chips" id="dp-acc">${DB.accounts.map(a => `<button data-a="${a.id}" class="${a.id === sel.account ? "on" : ""}">${esc(a.name)}</button>`).join("")}</div></div>
    ` : ""}
    <div class="gap"></div>
    <button class="btn" id="dp-save">${editing ? "Guardar cambios" : "Guardar"}</button>
    <div class="gap"></div><button class="btn line" onclick="closeSheet()">Cancelar</button>
  `, { fullscreen: true });
  const lk = $("#dp-link");
  if (lk) {
    lk.onchange = () => { sel.link = lk.checked; $("#dp-acc-wrap").hidden = !lk.checked; };
    $$("#dp-acc button").forEach(b => b.onclick = () => { sel.account = b.dataset.a; $$("#dp-acc button").forEach(x => x.classList.toggle("on", x === b)); });
  }
  {
    const amtEl = $("#dp-amt"), intEl = $("#dp-int"), capEl = $("#dp-cap"), noteEl = $("#dp-note");
    // Al editar respetamos el interés guardado; en un pago nuevo se sugiere solo.
    let intTouched = !!editing;
    const suggest = () => Math.min(parseAmount(amtEl.value) || 0, Math.round(baseBalance * monthlyRate));
    const drawNote = () => {
      const cap = parseAmount(capEl.value), intr = parseAmount(intEl.value);
      const newBal = Math.max(0, baseBalance - cap);
      noteEl.innerHTML = cap < 0
        ? `<span style="color:#fca5a5">El interés no puede ser mayor que el monto.</span>`
        : `De este pago, ${fmt(intr)} es interés y ${fmt(cap)} baja el capital. Saldo quedaría en <b>${fmt(newBal)}</b>.`;
    };
    const recompute = () => {
      if (!intTouched) intEl.value = suggest() || "";
      capEl.value = Math.round((parseAmount(amtEl.value) - parseAmount(intEl.value)) * 100) / 100;
      drawNote();
    };
    amtEl.oninput = recompute;
    intEl.oninput = () => { intTouched = true; capEl.value = Math.round((parseAmount(amtEl.value) - parseAmount(intEl.value)) * 100) / 100; drawNote(); };
    capEl.oninput = () => { intTouched = true; intEl.value = Math.round((parseAmount(amtEl.value) - parseAmount(capEl.value)) * 100) / 100; drawNote(); };
    recompute();
  }
  $("#dp-save").onclick = () => {
    const amt = parseAmount($("#dp-amt").value); if (amt <= 0) return toast("Escribe un monto");
    let interest = parseAmount($("#dp-int").value);
    if (interest < 0) interest = 0;
    if (interest > amt) return toast("El interés no puede ser mayor que el monto");
    const capital = Math.round((amt - interest) * 100) / 100;
    const dv = $("#dp-date").value;
    const date = dv ? new Date(dv + "T12:00:00").toISOString() : todayISO();
    d.payments = d.payments || [];
    const note = (d.dir === "owe" ? "Pago: " : "Abono: ") + d.name;
    if (editing) {
      Object.assign(editing, { date, amount: amt, interest, capital });
      if (editing.txId) {
        const tx = DB.transactions.find(t => t.id === editing.txId);
        if (sel.link && tx) Object.assign(tx, { date, amount: amt, account: sel.account });
        else if (!sel.link && tx) { DB.transactions = DB.transactions.filter(t => t.id !== editing.txId); editing.txId = undefined; }
      } else if (sel.link && accountsExist()) {
        editing.txId = uid();
        DB.transactions.push({ id: editing.txId, date, type: d.dir === "owe" ? "expense" : "income", amount: amt, category: "Deudas", note, account: sel.account });
      }
      editing.account = sel.link ? sel.account : undefined;
    } else {
      let txId;
      if (sel.link && accountsExist()) {
        txId = uid();
        DB.transactions.push({ id: txId, date, type: d.dir === "owe" ? "expense" : "income", amount: amt, category: "Deudas", note, account: sel.account });
      }
      d.payments.push({ id: uid(), date, amount: amt, interest, capital, account: sel.link ? sel.account : undefined, txId });
      // Con el pago hecho, la fecha de pago avanza al mes siguiente: sin esto la
      // deuda quedaría marcada "vencida" justo después de pagar.
      if (d.dueDate && debtBalance(d) > 0) {
        const due = new Date(d.dueDate);
        const next = new Date(due.getFullYear(), due.getMonth() + 1, Math.min(due.getDate(), new Date(due.getFullYear(), due.getMonth() + 2, 0).getDate()), 12);
        d.dueDate = next.toISOString();
      }
    }
    save(); closeSheet(); openDebts(); toast(editing ? "Pago actualizado" : "Registrado");
  };
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
      <div class="lock-mark">${brandMark(58)}</div>
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
    <h2>¿Puedo comprarlo? <button class="help" id="sim-help-btn" aria-label="Cómo funciona">?</button></h2>
    <p class="hint">Escribe cuánto cuesta y te muestro cómo afecta tu mes y tus metas, usando tu propio historial.</p>
    <div class="help-inline" id="sim-help" hidden>${SIM_HELP_HTML}</div>
    <label class="field"><span>¿Cuánto cuesta?</span><input type="text" id="sim-amt" inputmode="decimal" placeholder="0" /></label>
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
  $("#sim-help-btn").onclick = () => { const h = $("#sim-help"); h.hidden = !h.hidden; };
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
  const cell = (v) => {
    let s = String(v ?? "");
    // Neutraliza inyección de fórmulas: un texto que empiece con = + - @ se
    // ejecutaría como fórmula al abrir el CSV en Excel/Sheets.
    if (typeof v !== "number" && /^[=+\-@]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  };
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
   RESPALDO PROTEGIDO (Fase 4) — cifrado del respaldo, no de los datos vivos
   =========================================================== */
async function pbkdfKey(password, salt) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
const b64e = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function encryptBackup(obj, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await pbkdfKey(password, salt);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { minorte_encrypted: 1, salt: b64e(salt), iv: b64e(iv), data: b64e(ct) };
}
async function decryptBackup(payload, password) {
  const key = await pbkdfKey(password, b64d(payload.salt));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(payload.iv) }, key, b64d(payload.data));
  return JSON.parse(new TextDecoder().decode(pt));
}
function openEncryptedExport() {
  openSheet(`
    <h2>Exportar respaldo cifrado</h2>
    <p class="hint">Protege tu respaldo con una contraseña; la necesitarás para restaurarlo. Anótala en un lugar seguro: si la olvidas, este archivo no se puede abrir.</p>
    <label class="field"><span>Contraseña</span><input type="password" id="ee-a" autocomplete="new-password" /></label>
    <label class="field"><span>Repite la contraseña</span><input type="password" id="ee-b" autocomplete="new-password" /></label>
    <button class="btn" id="ee-save">Exportar cifrado</button>
    <div class="gap"></div><button class="btn line" onclick="closeSheet()">Cancelar</button>
  `);
  $("#ee-save").onclick = async () => {
    const a = $("#ee-a").value, b = $("#ee-b").value;
    if (a.length < 8) return toast("Usa al menos 8 caracteres");
    if (a !== b) return toast("Las contraseñas no coinciden");
    try {
      const payload = await encryptBackup(DB, a);
      downloadBlob(new Blob([JSON.stringify(payload)], { type: "application/json" }), "mi-norte-respaldo-cifrado.json");
      DB.settings.lastBackup = todayISO(); save(); closeSheet(); render(); toast("Respaldo cifrado descargado");
    } catch (e) { toast("No se pudo cifrar el respaldo"); }
  };
}
function finishImport(data) {
  if (!data || typeof data !== "object") return toast("Archivo no válido");
  DB = normalize(data); save(); render(); toast("Datos importados");
}
function importBackupData(text) {
  let data;
  try { data = JSON.parse(text); } catch { return toast("Archivo no válido"); }
  if (data && data.minorte_encrypted) {
    openSheet(`
      <h2>Respaldo cifrado</h2>
      <p class="hint">Escribe la contraseña con la que protegiste este respaldo.</p>
      <label class="field"><span>Contraseña</span><input type="password" id="pp-a" autocomplete="off" /></label>
      <button class="btn" id="pp-ok">Restaurar</button>
      <div class="gap"></div><button class="btn line" onclick="closeSheet()">Cancelar</button>
    `);
    $("#pp-ok").onclick = async () => {
      const v = $("#pp-a").value; if (!v) return;
      try { const obj = await decryptBackup(data, v); closeSheet(); finishImport(obj); }
      catch { toast("Contraseña incorrecta o archivo dañado"); }
    };
    return;
  }
  finishImport(data);
}
function daysSince(iso) { return (Date.now() - new Date(iso).getTime()) / 86400000; }
/* ¿Toca recordar un respaldo? Solo si hay datos y hace >14 días (o nunca). */
function backupDue() {
  if (!hasFinData()) return false;
  return !DB.settings.lastBackup || daysSince(DB.settings.lastBackup) >= 14;
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
   CONCILIACIÓN BANCARIA (CSV)
   =========================================================== */
function tokenizeCSV(text, delim) {
  const rows = []; let row = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== '\r') cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim() !== ""));
}
function parseCSV(text) {
  text = String(text).replace(/^﻿/, "");
  const sample = text.split(/\r?\n/).filter(l => l.trim() !== "").slice(0, 60);
  const cands = [",", ";", "\t", "|"]; let delim = ",", bestScore = -1, bestCols = 1;
  cands.forEach(d => {
    // Cuenta columnas por línea y busca el número de columnas más frecuente (>1).
    // Elegimos el delimitador cuya columna dominante aparece en más filas: así una
    // sola línea de encabezado con tabuladores no gana frente a 20 filas con "|".
    const counts = {};
    sample.forEach(l => { const n = l.split(d).length; if (n > 1) counts[n] = (counts[n] || 0) + 1; });
    let modeCols = 1, modeFreq = 0;
    for (const k in counts) { if (counts[k] > modeFreq || (counts[k] === modeFreq && +k > modeCols)) { modeFreq = counts[k]; modeCols = +k; } }
    if (modeFreq > bestScore || (modeFreq === bestScore && modeCols > bestCols)) { bestScore = modeFreq; bestCols = modeCols; delim = d; }
  });
  return tokenizeCSV(text, delim);
}
/* Encuentra la fila real de encabezados (los bancos suelen poner líneas de título antes) */
function detectHeaderRow(rows) {
  const KW = ["fecha", "date", "dia", "día", "descrip", "concepto", "detalle", "referencia", "transacc", "glosa", "monto", "importe", "amount", "valor", "débito", "debito", "crédito", "credito", "cargo", "abono", "balance", "saldo"];
  const maxCols = Math.max(...rows.map(r => r.length));
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.length < Math.max(3, maxCols - 1)) continue;
    const low = r.map(x => String(x).toLowerCase());
    if (low.some(c => KW.some(k => c.includes(k)))) return i;
  }
  return 0;
}
function parseMoneyLoose(s) {
  if (s == null) return NaN;
  s = String(s).trim(); if (!s) return NaN;
  let neg = /^\(.*\)$/.test(s) || /-\s*$/.test(s) || /^\s*-/.test(s);
  s = s.replace(/[^0-9.,]/g, "");
  const hasDot = s.includes("."), hasComma = s.includes(",");
  if (hasDot && hasComma) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (hasComma) {
    s = /,\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  }
  let n = parseFloat(s); if (isNaN(n)) return NaN;
  return neg ? -Math.abs(n) : n;
}
function parseDateLoose(s, fmt) {
  s = String(s).trim(); let m;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return new Date(+m[1], +m[2] - 1, +m[3], 12).toISOString();
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) {
    let a = +m[1], b = +m[2], y = +m[3]; if (y < 100) y += 2000;
    let dd, mm;
    if (fmt === "mdy") { mm = a; dd = b; }
    else if (fmt === "dmy") { dd = a; mm = b; }
    else { if (a > 12) { dd = a; mm = b; } else if (b > 12) { mm = a; dd = b; } else { dd = a; mm = b; } }
    return new Date(y, mm - 1, dd, 12).toISOString();
  }
  const d = new Date(s); return isNaN(d) ? null : d.toISOString();
}
function appSigned(t, acc) {
  if (t.type === "income") return t.amount;
  if (t.type === "expense") return -t.amount;
  if (t.type === "transfer") { if (t.to === acc) return t.amount; if (t.from === acc) return -t.amount; }
  return 0;
}

let reconState = null;
function openReconcile() {
  reconState = { rows: null, headers: null, result: null,
    map: { date: 0, desc: 1, amount: 2, mode: "single", debit: 2, credit: 3, dfmt: "auto" },
    account: DB.accounts[0] ? DB.accounts[0].id : null };
  drawReconUpload();
}
function autodetectMap(headers) {
  const h = headers.map(x => String(x || "").toLowerCase());
  const find = (kw) => h.findIndex(x => kw.some(k => x.includes(k)));
  const d = find(["fecha", "date", "día", "dia"]);
  const deStrong = find(["descrip", "concepto", "detalle", "glosa", "movimiento", "comercio"]);
  const de = deStrong >= 0 ? deStrong : find(["referencia", "transacc"]);
  const deb = find(["débito", "debito", "cargo", "salida", "retiro", "debe"]);
  const cred = find(["crédito", "credito", "abono", "depósito", "deposito", "entrada", "haber"]);
  const amt = find(["monto", "importe", "amount", "valor"]);
  const bal = find(["saldo", "balance", "disponible"]);
  reconState.map.date = d >= 0 ? d : 0;
  reconState.map.desc = de >= 0 ? de : 1;
  reconState.map.balance = bal;
  if (deb >= 0 && cred >= 0 && deb !== cred) { reconState.map.mode = "split"; reconState.map.debit = deb; reconState.map.credit = cred; }
  else { reconState.map.mode = "single"; reconState.map.amount = amt >= 0 ? amt : 2; }
}
/* Saldo actual según el banco: el balance de la fila con la fecha más reciente. */
function detectBankBalance() {
  const m = reconState.map, rows = reconState.rows || [];
  if (m.balance == null || m.balance < 0 || !rows.length) return null;
  let bestISO = "", bestVal = null;
  rows.forEach(r => {
    const v = parseMoneyLoose(r[m.balance]);
    if (isNaN(v)) return;
    const iso = parseDateLoose(r[m.date], m.dfmt) || "";
    if (bestVal == null || iso >= bestISO) { bestISO = iso; bestVal = v; }
  });
  return bestVal;
}
function drawReconUpload() {
  const rows = reconState.rows;
  const headers = reconState.headers || [];
  const opts = (sel) => headers.map((h, i) => `<option value="${i}" ${sel === i ? "selected" : ""}>${esc(h || ("Columna " + (i + 1)))}</option>`).join("");
  openSheet(`
    <div class="toolbar"><h2 style="margin:0">Conciliación bancaria</h2></div>
    <p class="hint">Sube el CSV de tu banco. Comparo sus movimientos con los que registraste y te muestro las diferencias.</p>
    <button class="btn ghost" id="rc-file-btn">${rows ? "Elegir otro CSV" : "Elegir archivo CSV"}</button>
    <input type="file" id="rc-file" accept=".csv,text/csv,text/plain" hidden />
    ${rows ? `
      <div class="gap"></div>
      <div class="hint">${rows.length} filas leídas. Confirma qué columna es cada cosa:</div>
      <div class="gap"></div>
      ${accountsExist() ? `<div class="label">Cuenta a conciliar</div><div class="chips" id="rc-acc">${DB.accounts.map(a => `<button data-a="${a.id}" class="${a.id === reconState.account ? "on" : ""}">${esc(a.name)}</button>`).join("")}</div><div class="gap"></div>` : ""}
      <label class="field"><span>Columna de fecha</span><select id="rc-date">${opts(reconState.map.date)}</select></label>
      <label class="field"><span>Columna de descripción</span><select id="rc-desc">${opts(reconState.map.desc)}</select></label>
      <div class="label">Monto</div>
      <div class="seg" id="rc-mode"><button data-m="single" class="${reconState.map.mode === "single" ? "on" : ""}">Una columna</button><button data-m="split" class="${reconState.map.mode === "split" ? "on" : ""}">Débito / Crédito</button></div>
      <div class="gap"></div>
      <div id="rc-amt-fields"></div>
      <label class="field"><span>Formato de fecha</span><select id="rc-dfmt">
        <option value="auto" ${reconState.map.dfmt === "auto" ? "selected" : ""}>Automático</option>
        <option value="dmy" ${reconState.map.dfmt === "dmy" ? "selected" : ""}>DD/MM/AAAA</option>
        <option value="mdy" ${reconState.map.dfmt === "mdy" ? "selected" : ""}>MM/DD/AAAA</option>
      </select></label>
      <div class="gap"></div>
      <label class="field"><span>Saldo actual según el banco (opcional)</span><input type="text" id="rc-bal" inputmode="decimal" placeholder="0" value="${reconState.bankBalance != null ? reconState.bankBalance : ""}" /></label>
      <div class="hint">${reconState.bankBalance != null ? "Lo tomé del estado de cuenta. " : ""}Con esto ajusto tu cuenta al final para que calce exacto con el banco.</div>
      <div class="gap"></div>
      <button class="btn" id="rc-run">Conciliar</button>
    ` : `<div class="gap"></div><div class="hint">Consejo: la mayoría de bancos permite descargar los movimientos como CSV o Excel (guárdalo como CSV).</div>`}
    <div class="gap"></div><button class="btn line" onclick="closeSheet()">Cerrar</button>
  `, { fullscreen: true });

  $("#rc-file-btn").onclick = () => $("#rc-file").click();
  $("#rc-file").onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCSV(reader.result);
      if (parsed.length < 2) return toast("El CSV parece vacío o sin filas");
      const hi = detectHeaderRow(parsed);
      reconState.headers = parsed[hi];
      const hcols = reconState.headers.length;
      reconState.rows = parsed.slice(hi + 1).filter(r => r.length >= Math.max(2, hcols - 1));
      autodetectMap(reconState.headers);
      reconState.bankBalance = detectBankBalance();
      drawReconUpload();
    };
    reader.readAsText(f);
  };
  if (rows) {
    if (accountsExist()) $$("#rc-acc button").forEach(b => b.onclick = () => { reconState.account = b.dataset.a; $$("#rc-acc button").forEach(x => x.classList.toggle("on", x === b)); });
    $("#rc-date").onchange = e => reconState.map.date = +e.target.value;
    $("#rc-desc").onchange = e => reconState.map.desc = +e.target.value;
    $("#rc-dfmt").onchange = e => reconState.map.dfmt = e.target.value;
    const balEl = $("#rc-bal"); if (balEl) balEl.oninput = e => reconState.bankBalance = e.target.value === "" ? null : parseAmount(e.target.value);
    const paintAmt = () => {
      const mode = reconState.map.mode;
      $("#rc-amt-fields").innerHTML = mode === "single"
        ? `<label class="field"><span>Columna de monto (con signo: + entra, − sale)</span><select id="rc-amount">${opts(reconState.map.amount)}</select></label>`
        : `<label class="field"><span>Débito (salidas)</span><select id="rc-debit">${opts(reconState.map.debit)}</select></label><label class="field"><span>Crédito (entradas)</span><select id="rc-credit">${opts(reconState.map.credit)}</select></label>`;
      if (mode === "single") $("#rc-amount").onchange = e => reconState.map.amount = +e.target.value;
      else { $("#rc-debit").onchange = e => reconState.map.debit = +e.target.value; $("#rc-credit").onchange = e => reconState.map.credit = +e.target.value; }
    };
    paintAmt();
    $$("#rc-mode button").forEach(b => b.onclick = () => { reconState.map.mode = b.dataset.m; $$("#rc-mode button").forEach(x => x.classList.toggle("on", x === b)); paintAmt(); });
    $("#rc-run").onclick = runReconcile;
  }
}
function runReconcile() {
  const m = reconState.map, rows = reconState.rows || [], bank = [];
  rows.forEach(r => {
    const dISO = parseDateLoose(r[m.date], m.dfmt);
    let amount;
    if (m.mode === "single") amount = parseMoneyLoose(r[m.amount]);
    else {
      const deb = parseMoneyLoose(r[m.debit]), cred = parseMoneyLoose(r[m.credit]);
      amount = (isNaN(cred) ? 0 : Math.abs(cred)) - (isNaN(deb) ? 0 : Math.abs(deb));
    }
    if (!dISO || isNaN(amount) || amount === 0) return;
    bank.push({ date: dISO, note: String(r[m.desc] || "").trim(), amount });
  });
  if (!bank.length) return toast("No pude interpretar montos/fechas. Revisa las columnas.");
  const dts = bank.map(b => dateInputValue(b.date)).sort();
  const from = dts[0], to = dts[dts.length - 1];
  const acc = reconState.account;
  const app = DB.transactions.filter(t => {
    const d = dateInputValue(t.date);
    if (d < from || d > to) return false;
    if (acc) { if (t.type === "transfer") return t.from === acc || t.to === acc; return t.account === acc; }
    return t.type !== "transfer";
  }).map(t => ({ id: t.id, date: t.date, note: t.note || t.category || "", amount: appSigned(t, acc) }));

  const used = new Set(), matched = [], bankOnly = [];
  bank.forEach(bi => {
    let best = -1, bestDiff = Infinity;
    app.forEach((ai, idx) => {
      if (used.has(idx) || Math.abs(ai.amount - bi.amount) > 0.5) return;
      const dd = Math.abs(new Date(ai.date) - new Date(bi.date)) / 86400000;
      if (dd <= 5 && dd < bestDiff) { bestDiff = dd; best = idx; }
    });
    if (best >= 0) { used.add(best); matched.push({ bank: bi, app: app[best] }); }
    else bankOnly.push(bi);
  });
  const appOnly = app.filter((_, idx) => !used.has(idx));
  reconState.result = { matched, bankOnly, appOnly, account: acc,
    bankBalance: reconState.bankBalance != null ? reconState.bankBalance : null,
    bankSum: bank.reduce((s, b) => s + b.amount, 0), appSum: app.reduce((s, a) => s + a.amount, 0), from, to };
  drawReconResults();
}
function addBankItem(bi) {
  DB.transactions.push({ id: uid(), date: bi.date, type: bi.amount > 0 ? "income" : "expense",
    amount: Math.abs(bi.amount), category: "Otro", note: bi.note, account: reconState.account || undefined });
}
function drawReconResults() {
  const R = reconState.result;
  const diff = R.bankSum - R.appSum;
  const canAdjust = R.account && R.bankBalance != null;
  const appBal = canAdjust ? accountBalance(R.account) : 0;
  const balDiff = canAdjust ? (R.bankBalance - appBal) : 0;
  const calza = Math.abs(balDiff) < 0.5;
  const signed = (n) => `${n > 0 ? "+" : "−"}${fmt(Math.abs(n))}`;
  const dl = (iso) => new Date(iso).toLocaleDateString(DB.settings.locale || "es-CR", { day: "numeric", month: "short", year: "numeric" });
  const bankRow = (bi, extra) => `<div class="list-item"><span class="mov-ic" style="color:${bi.amount > 0 ? "var(--green)" : "var(--red)"}">${bi.amount > 0 ? "↑" : "↓"}</span><div class="grow"><div class="t">${esc(bi.note || "(sin descripción)")}</div><div class="s">${dl(bi.date)}</div></div><div class="amt ${bi.amount > 0 ? "in" : "out"}">${signed(bi.amount)}</div>${extra}</div>`;
  openSheet(`
    <div class="toolbar"><h2 style="margin:0">Conciliación</h2></div>
    <div class="metrics">
      <div class="metric"><div class="v" style="color:var(--green)">${R.matched.length}</div><div class="k">Coinciden</div></div>
      <div class="metric"><div class="v" style="color:var(--amber)">${R.bankOnly.length}</div><div class="k">Faltan en la app</div></div>
      <div class="metric"><div class="v" style="color:var(--red)">${R.appOnly.length}</div><div class="k">Solo en la app</div></div>
      <div class="metric"><div class="v">${fmt(Math.abs(diff))}</div><div class="k">Dif. de movimientos</div></div>
    </div>
    ${canAdjust ? `<div class="card">
      <h2 style="margin:0 0 4px">Saldo de la cuenta</h2>
      <div class="proj">
        <div class="proj-row"><span>En la app · ${esc(accountName(R.account))}</span><b>${fmt(appBal)}</b></div>
        <div class="proj-row"><span>Según el banco</span><b>${fmt(R.bankBalance)}</b></div>
        <div class="proj-row"><span>Diferencia</span><b style="color:${calza ? "var(--green)" : "var(--amber)"}">${signed(balDiff)}</b></div>
      </div>
      ${calza
        ? `<div class="hint" style="margin-top:10px">✅ Tu cuenta calza exacto con el banco.</div>`
        : `<div class="gap"></div><button class="btn" id="rc-adjust">Ajustar cuenta para que calce</button>
           <div class="hint" style="margin-top:8px">${R.bankOnly.length ? "Primero agrega abajo los movimientos que falten; luego ajusta. " : ""}Ajusto el saldo inicial de la cuenta, sin crear un ingreso o gasto que distorsione el mes.</div>`}
    </div>` : ""}
    ${(!R.bankOnly.length && !R.appOnly.length) ? `<div class="card center"><div style="font-size:22px">✅</div><strong>Todo cuadra</strong><div class="hint">Tus registros coinciden con el banco en este periodo.</div></div>` : ""}
    ${R.bankOnly.length ? `<div class="card">
      <div class="row"><h2 style="margin:0">En el banco, no en la app</h2><button class="linkbtn" id="rc-add-all">Agregar todos</button></div>
      <div class="hint">Movimientos del banco que no encontré registrados. Agrégalos para emparejar.</div>
      <div class="gap"></div>
      ${R.bankOnly.map((bi, i) => bankRow(bi, `<button class="btn small line" data-rc-add="${i}">Agregar</button>`)).join("")}
    </div>` : ""}
    ${R.appOnly.length ? `<div class="card">
      <h2>Solo en la app</h2>
      <div class="hint">Registrados en la app pero que no aparecen en el banco. Revisa si son un error o si al banco le falta.</div>
      <div class="gap"></div>
      ${R.appOnly.map(ai => bankRow(ai, `<button class="btn small line" data-rc-edit="${ai.id}">Ver</button>`)).join("")}
    </div>` : ""}
    ${R.matched.length ? `<div class="card"><h2>Coinciden (${R.matched.length})</h2><div class="hint">Emparejados correctamente por monto y fecha ✓</div></div>` : ""}
    <button class="btn line" id="rc-back">Subir otro CSV</button>
    <div class="gap"></div><button class="btn" onclick="closeSheet()">Cerrar</button>
  `, { fullscreen: true });

  $$("[data-rc-add]").forEach(b => b.onclick = () => { addBankItem(reconState.result.bankOnly[+b.dataset.rcAdd]); save(); runReconcile(); });
  const all = $("#rc-add-all"); if (all) all.onclick = () => { reconState.result.bankOnly.forEach(addBankItem); save(); toast("Movimientos agregados"); runReconcile(); };
  const adj = $("#rc-adjust"); if (adj) adj.onclick = () => {
    const a = DB.accounts.find(x => x.id === R.account); if (!a) return;
    a.opening = (a.opening || 0) + (R.bankBalance - accountBalance(R.account));
    save(); toast("Cuenta ajustada al saldo del banco"); runReconcile();
  };
  $$("[data-rc-edit]").forEach(b => b.onclick = () => editTx(b.dataset.rcEdit));
  $("#rc-back").onclick = () => { reconState.result = null; reconState.rows = null; reconState.headers = null; drawReconUpload(); };
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
  const dateLabel = new Date().toLocaleDateString(loc, { weekday: "long", day: "numeric", month: "long" });
  const registered = registeredToday();
  const disponible = accountsExist() ? netWorth() : monthTotals(monthKeyOf(new Date())).balance;
  const due = nextDue();
  const step = hasFinData() ? nextStep() : null;
  const dueHTML = due
    ? `<div class="gate-due ${due.daysAway <= 3 ? "urgent" : ""}"><span class="gd-ic">${due.daysAway < 0 ? "⚠️" : "⏰"}</span><span class="gd-txt">${dueLabel(due.daysAway)} · ${esc(due.name)}</span><b class="gd-amt">${fmt(due.amount)}</b></div>`
    : `<div class="gate-due ok"><span class="gd-ic">✓</span><span class="gd-txt">Nada vence esta semana</span></div>`;

  const el = document.createElement("div");
  el.className = "gate";
  el.innerHTML = `
    <div class="gate-top">
      <div class="gate-brand">${brandMark(30)}<span>MI NORTE</span></div>
      <div class="gate-greet">${greeting()} 👋</div>
      <div class="gate-date">${esc(dateLabel)}</div>
    </div>
    <div class="gate-mid">
      <div class="gate-avail-label">Dinero disponible</div>
      <div class="gate-avail">${disponible < 0 ? "−" : ""}${fmtHero(Math.abs(disponible))}</div>
      ${dueHTML}
      ${step ? `<div class="gate-step">👉 ${step.text}</div>` : ""}
    </div>
    <div class="gate-bottom">
      <div class="gate-prompt">${registered ? "Hoy ya registraste ✓ · ¿algo más?" : "¿Registramos lo de hoy?"}</div>
      <div class="gate-actions">
        <button class="gbtn expense" id="gate-exp">− Registrar gasto</button>
        <button class="gbtn income" id="gate-inc">+ Registrar ingreso</button>
      </div>
      <button class="gbtn enter" id="gate-enter" disabled>Un momento…</button>
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
/* Pide al navegador que trate este almacenamiento como persistente (reduce la
   probabilidad de que iOS/Android lo purguen bajo presión de espacio). */
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

applyTheme();
maybeApplyRecurring();
render();
showLock();
maybeShowGate();
/* Apertura con datos en la URL (?monto=…&nota=…): pre-llena un gasto.
   Útil para automatizaciones (Atajos con "Abrir URL"). Limpiamos la URL para
   que un refresco no re-abra el formulario. */
(function () {
  try {
    const q = new URLSearchParams(location.search);
    const monto = q.get("monto") || q.get("amount");
    if (!monto) return;
    const nota = (q.get("nota") || q.get("comercio") || q.get("note") || "").slice(0, 60);
    history.replaceState(null, "", location.pathname);
    const amount = parseAmount(monto);
    if (amount > 0) setTimeout(() => openTx("expense", null, { amount, note: nota }), 80);
  } catch (e) {}
})();
/* Si el tema es "auto", seguir los cambios del sistema en vivo. */
if (window.matchMedia) {
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  const onSys = () => { if ((DB.settings.theme || "dark") === "auto") applyTheme(); };
  mq.addEventListener ? mq.addEventListener("change", onSys) : mq.addListener(onSys);
}

/* Al volver a la app (PWA reanudada): aplicar fijos automáticos, pedir PIN y, si toca, mostrar la pantalla de inicio */
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") { if (maybeApplyRecurring()) render(); showLock(); maybeShowGate(); }
});

/* Service worker (offline) */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  // Cuando un nuevo service worker toma el control (nueva versión publicada),
  // recargamos una sola vez para no quedar con index.html nuevo y app.js viejo.
  let swReloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (swReloaded) return; swReloaded = true; location.reload();
  });
}
