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

/* Paleta de categorías (misma en claro/oscuro, buen contraste) */
const CAT_COLORS = ["#0f766e", "#2563eb", "#7c3aed", "#db2777", "#ea580c", "#0891b2", "#16a34a", "#ca8a04", "#e11d48", "#475569"];

const CURRENCIES = [
  { code: "CRC", locale: "es-CR", label: "Colón (₡)" },
  { code: "USD", locale: "en-US", label: "Dólar ($)" },
  { code: "MXN", locale: "es-MX", label: "Peso MX ($)" },
  { code: "EUR", locale: "es-ES", label: "Euro (€)" },
  { code: "COP", locale: "es-CO", label: "Peso CO ($)" },
  { code: "PEN", locale: "es-PE", label: "Sol (S/)" },
  { code: "CLP", locale: "es-CL", label: "Peso CL ($)" },
];

/* ---------- Semilla ---------- */
const SEED = {
  transactions: [],   // {id, date(ISO), type:'income'|'expense', amount, category, note}
  categories: structuredClone(DEFAULT_CATEGORIES),
  budgets: {},        // {categoria: limiteMensual}
  recurring: [],      // {id, type, amount, category, note, day}
  settings: { currency: "CRC", locale: "es-CR", savingsGoal: 20, reminders: true, reminderDismissed: "" },
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
function money(n) {
  const s = DB.settings;
  try {
    return new Intl.NumberFormat(s.locale || "es-CR", {
      style: "currency", currency: s.currency || "CRC", maximumFractionDigits: 0,
    }).format(Math.round(n || 0));
  } catch (e) {
    return new Intl.NumberFormat("es-CR", { style: "currency", currency: "CRC", maximumFractionDigits: 0 }).format(Math.round(n || 0));
  }
}
const fmt = (n) => money(n);
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
function categoryBreakdown(mk, type = "expense") {
  const map = {};
  txOfMonth(mk).filter(t => t.type === type).forEach(t => {
    const c = t.category || "Otro";
    map[c] = (map[c] || 0) + t.amount;
  });
  const total = Object.values(map).reduce((s, v) => s + v, 0) || 1;
  return Object.entries(map)
    .map(([name, value]) => ({ name, value, pct: value / total * 100, color: catColor(name, type) }))
    .sort((a, b) => b.value - a.value);
}
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

/* Anillo de dona (SVG) */
function donut(segments, centerTop, centerBottom) {
  const size = 168, stroke = 20, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  let offset = 0;
  const total = segments.reduce((s, x) => s + x.value, 0);
  const arcs = total > 0 ? segments.map(s => {
    const len = s.value / total * c;
    const dash = `${len} ${c - len}`;
    const el = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${stroke}" stroke-dasharray="${dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${size / 2} ${size / 2})" stroke-linecap="butt"/>`;
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
  const prev = monthTotals(shiftMonth(viewMonth, -1));
  const proj = projectionForMonth(viewMonth);
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
    ${monthNav()}

    ${showReminder() ? `
    <div class="reminder" id="reminder">
      <div class="rem-ic">🔔</div>
      <div class="rem-txt"><strong>Aún no registras movimientos hoy</strong><span>Un toque para mantener tus finanzas al día.</span></div>
      <button class="rem-x" id="rem-dismiss" aria-label="Descartar">✕</button>
    </div>` : ""}

    <div class="hero ${balancePos ? "pos" : "neg"}">
      <div class="hero-label">Balance del mes</div>
      <div class="hero-value">${balancePos ? "" : "−"}${fmt(Math.abs(t.balance))}</div>
      <div class="hero-sub">
        <span><i class="dot in"></i>Ingresos ${fmt(t.income)}</span>
        <span><i class="dot out"></i>Gastos ${fmt(t.expense)}</span>
      </div>
    </div>

    <div class="kpis">
      <div class="kpi">
        <div class="kpi-k">Tasa de ahorro</div>
        <div class="kpi-v">${Math.round(t.savingsRate)}%</div>
        <div class="kpi-bar"><i style="width:${Math.max(0, Math.min(100, t.savingsRate))}%;background:${t.savingsRate >= goal ? "var(--green)" : "var(--amber)"}"></i></div>
        <div class="kpi-foot">${goal ? `Meta ${goal}%` : "Sin meta"}</div>
      </div>
      <div class="kpi">
        <div class="kpi-k">${isCurrentMonth(viewMonth) ? "Proyección de gasto" : "Movimientos"}</div>
        <div class="kpi-v">${proj != null ? fmt(proj) : t.count}</div>
        <div class="kpi-foot">${proj != null ? "estimado a fin de mes" : "registrados este mes"}</div>
      </div>
    </div>

    <div class="btn-row">
      <button class="btn" id="h-expense">− Registrar gasto</button>
      <button class="btn ghost" id="h-income">+ Ingreso</button>
    </div>

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

    <div class="card">
      <div class="row"><h2 style="margin:0">Últimos movimientos</h2><button class="linkbtn" id="h-all">Ver todos</button></div>
      <div class="gap"></div>
      ${recent.length ? recent.map(txRow).join("") : `<div class="muted">Aún no hay movimientos. Registra el primero arriba.</div>`}
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
  wireTxRows(root);
};

/* Fila de movimiento */
function txRow(t) {
  const inc = t.type === "income";
  return `
    <div class="list-item">
      <span class="cdot" style="background:${catColor(t.category, t.type)}"></span>
      <div class="grow">
        <div class="t">${esc(t.note || t.category || (inc ? "Ingreso" : "Gasto"))}</div>
        <div class="s">${new Date(t.date).toLocaleDateString(DB.settings.locale || "es-CR", { day: "numeric", month: "short" })} · ${esc(t.category || "Otro")}</div>
      </div>
      <div class="amt ${inc ? "in" : "out"}">${inc ? "+" : "−"}${fmt(t.amount)}</div>
      <button class="btn small soft-danger" data-del-tx="${t.id}" aria-label="Eliminar">×</button>
    </div>`;
}
function wireTxRows(root) {
  $$("[data-del-tx]", root).forEach(b => b.onclick = () => {
    DB.transactions = DB.transactions.filter(t => t.id !== b.dataset.delTx);
    save(); render(); toast("Movimiento eliminado");
  });
}

/* ---------------- MOVIMIENTOS ---------------- */
let moneyFilter = "all"; // all | income | expense
SCREENS.money = () => {
  const t = monthTotals(viewMonth);
  let list = txOfMonth(viewMonth).sort((a, b) => new Date(b.date) - new Date(a.date));
  if (moneyFilter !== "all") list = list.filter(x => x.type === moneyFilter);

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

    <div class="seg" id="m-filter">
      <button data-f="all" class="${moneyFilter === "all" ? "on" : ""}">Todos</button>
      <button data-f="income" class="${moneyFilter === "income" ? "on" : ""}">Ingresos</button>
      <button data-f="expense" class="${moneyFilter === "expense" ? "on" : ""}">Gastos</button>
    </div>
    <div class="gap"></div>

    <div class="card">
      ${list.length ? list.map(txRow).join("") : `<div class="muted">No hay movimientos en este mes con este filtro.</div>`}
    </div>
  `;
};
WIRE.money = (root) => {
  wireMonthNav(root);
  $("#m-expense", root).onclick = () => openTx("expense");
  $("#m-income", root).onclick = () => openTx("income");
  $$("#m-filter button", root).forEach(b => b.onclick = () => { moneyFilter = b.dataset.f; render(); });
  wireTxRows(root);
};

/* ---------------- REPORTES ---------------- */
SCREENS.reports = () => {
  const t = monthTotals(viewMonth);
  const bd = categoryBreakdown(viewMonth, "expense");
  const incomeBd = categoryBreakdown(viewMonth, "income");
  const months = lastMonths(6);
  const series = months.map(mk => ({ mk, ...monthTotals(mk) }));
  const maxBar = Math.max(1, ...series.map(s => Math.max(s.income, s.expense)));
  const budgets = budgetStatus(viewMonth);
  const proj = projectionForMonth(viewMonth);

  const trendBars = series.map(s => `
    <div class="trend-col">
      <div class="trend-bars">
        <div class="tb in" style="height:${Math.round(s.income / maxBar * 100)}%" title="Ingresos ${fmt(s.income)}"></div>
        <div class="tb out" style="height:${Math.round(s.expense / maxBar * 100)}%" title="Gastos ${fmt(s.expense)}"></div>
      </div>
      <div class="trend-x ${s.mk === viewMonth ? "on" : ""}">${esc(shortMonthLabel(s.mk))}</div>
    </div>`).join("");

  const catRows = (rows) => rows.length ? rows.map(r => `
    <div class="catrow">
      <div class="catrow-top"><span><i class="cdot" style="background:${r.color}"></i>${esc(r.name)}</span><span>${fmt(r.value)} · ${Math.round(r.pct)}%</span></div>
      <div class="kpi-bar"><i style="width:${r.pct}%;background:${r.color}"></i></div>
    </div>`).join("") : `<div class="muted">Sin datos este mes.</div>`;

  return `
    <div class="head"><h1>Reportes</h1><p>Entiende a dónde va tu dinero.</p></div>
    ${monthNav()}

    <div class="metrics">
      <div class="metric"><div class="v">${Math.round(t.savingsRate)}%</div><div class="k">Tasa de ahorro</div></div>
      <div class="metric"><div class="v">${fmt(t.balance)}</div><div class="k">Balance del mes</div></div>
      <div class="metric"><div class="v">${fmt(t.expense)}</div><div class="k">Gasto total</div></div>
      <div class="metric"><div class="v">${proj != null ? fmt(proj) : "—"}</div><div class="k">Proyección fin de mes</div></div>
    </div>

    <div class="card">
      <h2>Gasto por categoría</h2>
      ${bd.length ? `
        <div class="donut-row">
          ${donut(bd, `<div class="dc-amt">${fmt(t.expense)}</div>`, `<div class="dc-cap">gastado</div>`)}
          <div class="legend">
            ${bd.slice(0, 6).map(s => `<div class="lg"><i class="cdot" style="background:${s.color}"></i><span>${esc(s.name)}</span><b>${Math.round(s.pct)}%</b></div>`).join("")}
          </div>
        </div>` : `<div class="muted">Aún no registras gastos este mes.</div>`}
    </div>

    <div class="card">
      <h2>Tendencia (6 meses)</h2>
      <div class="trend">${trendBars}</div>
      <div class="trend-legend"><span><i class="dot in"></i>Ingresos</span><span><i class="dot out"></i>Gastos</span></div>
    </div>

    <div class="card">
      <h2>Detalle de gastos</h2>
      ${catRows(bd)}
    </div>

    <div class="card">
      <h2>Ingresos por fuente</h2>
      ${catRows(incomeBd)}
    </div>

    <div class="card">
      <div class="row"><h2 style="margin:0">Presupuestos</h2><button class="linkbtn" id="r-budgets">Editar</button></div>
      <div class="gap"></div>
      ${budgets.length ? budgets.map(b => `
        <div class="bud">
          <div class="bud-top"><span><i class="cdot" style="background:${b.color}"></i>${esc(b.name)}</span>
            <span class="${b.over ? "over" : ""}">${fmt(b.spent)} / ${fmt(b.limit)}</span></div>
          <div class="kpi-bar"><i style="width:${b.pct}%;background:${b.over ? "var(--red)" : b.pct >= 80 ? "var(--amber)" : "var(--green)"}"></i></div>
        </div>`).join("") : `<div class="muted">Sin presupuestos. Defínelos para recibir alertas.</div>`}
    </div>

    <div class="card">
      <h2>Exportar reporte</h2>
      <div class="hint">Descarga los movimientos de ${esc(monthLabel(viewMonth))} como CSV para abrir en Excel/Sheets.</div>
      <div class="gap"></div>
      <button class="btn ghost" id="r-csv-month">Exportar este mes (CSV)</button>
    </div>
  `;
};
WIRE.reports = (root) => {
  wireMonthNav(root);
  $("#r-budgets", root).onclick = openBudgets;
  $("#r-csv-month", root).onclick = () => exportCSV(txOfMonth(viewMonth), `mi-norte-${viewMonth}.csv`);
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
  $("#s-reminders", root).onchange = (e) => {
    DB.settings.reminders = e.target.checked; save(); toast(e.target.checked ? "Recordatorio activado" : "Recordatorio desactivado");
  };
  $("#s-cat-expense", root).onclick = () => openCategories("expense");
  $("#s-cat-income", root).onclick = () => openCategories("income");
  $("#s-budgets", root).onclick = openBudgets;
  $("#s-recurring", root).onclick = openRecurring;
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

/* ---- Registrar movimiento (ingreso o gasto) ---- */
function openTx(type, editId) {
  const editing = editId ? DB.transactions.find(t => t.id === editId) : null;
  const isIncome = editing ? editing.type === "income" : type === "income";
  const cats = DB.categories[isIncome ? "income" : "expense"];
  const sel = { category: editing ? editing.category : cats[0] };

  openSheet(`
    <h2>${editing ? "Editar movimiento" : isIncome ? "Registrar ingreso" : "Registrar gasto"}</h2>
    <label class="field"><span>Monto</span>
      <input type="number" id="tx-amt" inputmode="decimal" placeholder="0" value="${editing ? editing.amount : ""}" /></label>
    <label class="field"><span>Descripción (opcional)</span>
      <input type="text" id="tx-note" placeholder="${isIncome ? "Salario, venta…" : "¿En qué?"}" value="${editing ? esc(editing.note) : ""}" /></label>
    <label class="field"><span>Fecha</span>
      <input type="date" id="tx-date" value="${dateInputValue(editing ? editing.date : todayISO())}" /></label>
    <div class="label">Categoría</div>
    <div class="chips" id="tx-cats">
      ${cats.map(c => `<button data-c="${esc(c)}" class="${c === sel.category ? "on" : ""}">${esc(c)}</button>`).join("")}
    </div>
    <div class="gap"></div>
    <button class="btn" id="tx-save">${editing ? "Guardar cambios" : "Guardar"}</button>
    <div class="gap"></div><button class="btn line" onclick="closeSheet()">Cancelar</button>
  `, { fullscreen: true });

  $$("#tx-cats button").forEach(b => b.onclick = () => {
    sel.category = b.dataset.c;
    $$("#tx-cats button").forEach(x => x.classList.toggle("on", x === b));
  });
  $("#tx-save").onclick = () => {
    const amt = parseFloat(($("#tx-amt").value || "").replace(",", ".")) || 0;
    if (amt <= 0) return toast("Escribe un monto");
    const dv = $("#tx-date").value;
    const date = dv ? new Date(dv + "T12:00:00").toISOString() : todayISO();
    const data = { type: isIncome ? "income" : "expense", amount: amt, category: sel.category, note: $("#tx-note").value.trim() };
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
          <input type="number" data-bud="${esc(c)}" inputmode="numeric" placeholder="0" value="${DB.budgets[c] || ""}" /></label>
      `).join("")}
    </div>
    <button class="btn" id="bud-save">Guardar presupuestos</button>
    <div class="gap"></div><button class="btn line" onclick="closeSheet()">Cerrar</button>
  `, { fullscreen: true });

  $("#bud-save").onclick = () => {
    $$("[data-bud]").forEach(inp => {
      const v = +inp.value || 0;
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
  const head = ["Fecha", "Tipo", "Categoría", "Descripción", "Monto"];
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [head.join(",")];
  rows.forEach(t => {
    lines.push([
      dateInputValue(t.date),
      t.type === "income" ? "Ingreso" : "Gasto",
      t.category || "Otro",
      t.note || "",
      t.amount,
    ].map(cell).join(","));
  });
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, name);
  toast("CSV descargado");
}

/* ===========================================================
   ARRANQUE
   =========================================================== */
$$(".tab").forEach(b => b.onclick = () => { currentTab = b.dataset.tab; render(); });
window.closeSheet = closeSheet; // usado por onclick inline
render();

/* Service worker (offline) */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
