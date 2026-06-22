/* ===========================================================
   MI NORTE — app web (PWA). Datos 100% locales (localStorage).
   =========================================================== */

const STORE_KEY = "mi_norte_data_v1";

/* ---------- Datos por defecto (semilla) ---------- */
const SEED = {
  priorities: [
    "Mi esposa",
    "Mis hijos",
    "Terminar la casa",
    "No generar nuevas deudas",
    "Registrar cada gasto",
  ].map((title, i) => ({ id: uid(), title, order: i, active: true })),
  norte: [
    "¿Por qué estoy haciendo todo esto?",
    "¿Qué vida quiero construir?",
    "¿Qué errores no quiero repetir?",
    "¿Qué tipo de padre quiero ser?",
    "¿Qué tipo de esposo quiero ser?",
    "¿Qué quiero que mis hijos recuerden de mí?",
  ].map((question, i) => ({ id: uid(), question, answer: "", order: i })),
  phrases: [
    "Hoy solo necesito dar el siguiente paso correcto.",
    "La tranquilidad vale más que aparentar.",
    "La casa terminada vale más que un capricho momentáneo.",
    "Mis hijos necesitan constancia más que perfección.",
  ].map((text) => ({ id: uid(), text })),
  movements: [],          // {id,date,note,amount,isIncome,kind,budget,feeling,alignment}
  house: [],              // {id,title,estimatedCost,realCost,status,priority,notes,targetDate}
  reflections: [],        // {id,date,didWell,improve,aligned}
  semaphore: [],          // {id,date,amount,note,continued,avoidedAmount}
  crisis: [],             // {id,startedAt,reason,calmMinutes,completedAt}
  settings: { threshold: 10000, reminderHour: 21, reminderMinute: 0 },
};

const FEELINGS = ["Tranquilo","Ansioso","Frustrado","Triste","Agotado","Enojado","Estresado"];
const CRISIS_REASONS = ["Problemas de dinero","Discusión con mi pareja","Ansiedad","Estrés","Agotamiento","Impulso de comprar algo","Miedo","Frustración"];
const HOUSE_STATUS = ["Pendiente","En proceso","Completado"];
const HOUSE_PRIORITY = ["Alta","Media","Baja"];

/* ---------- Estado / persistencia ---------- */
let DB = load();
let currentTab = "home";

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return Object.assign(structuredClone(SEED), JSON.parse(raw));
  } catch (e) {}
  return structuredClone(SEED);
}
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(DB)); }

/* ---------- Helpers ---------- */
const money = new Intl.NumberFormat("es-CR", { style: "currency", currency: "CRC", maximumFractionDigits: 0 });
const fmt = (n) => money.format(Math.round(n || 0));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x.getTime(); };
const todayKey = () => startOfDay(new Date());
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1800);
}

/* ---------- Cálculos compartidos ---------- */
function totals() {
  const income = DB.movements.filter(m => m.isIncome).reduce((s,m)=>s+m.amount,0);
  const expense = DB.movements.filter(m => !m.isIncome).reduce((s,m)=>s+m.amount,0);
  const today = DB.movements.filter(m => !m.isIncome && startOfDay(m.date)===todayKey()).reduce((s,m)=>s+m.amount,0);
  return { available: income - expense, income, expense, today };
}
function streak() {
  const days = new Set(DB.movements.map(m => startOfDay(m.date)));
  let n = 0, day = todayKey();
  while (days.has(day)) { n++; day -= 86400000; }
  return n;
}
function activeHouseTasks() {
  const rank = { "Alta":0, "Media":1, "Baja":2 };
  return DB.house.filter(t => t.status !== "Completado")
    .sort((a,b) => (rank[a.priority]-rank[b.priority]) || (new Date(a.targetDate)-new Date(b.targetDate)));
}
function houseProgress() {
  if (!DB.house.length) return 0;
  return DB.house.filter(t => t.status === "Completado").length / DB.house.length;
}
function hasActiveCalmTimer() {
  const now = Date.now();
  return DB.crisis.some(s => !s.completedAt && (new Date(s.startedAt).getTime() + s.calmMinutes*60000) > now);
}
function dailyPhrase() {
  if (!DB.phrases.length) return "Hoy solo necesito dar el siguiente paso correcto.";
  const idx = Math.floor(Date.now()/86400000) % DB.phrases.length;
  return DB.phrases[idx].text;
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

/* ---------------- INICIO ---------------- */
SCREENS.home = () => {
  const t = totals();
  const next = activeHouseTasks()[0];
  const prios = DB.priorities.filter(p => p.active).slice(0, 5);
  return `
    <div class="head"><h1>MI NORTE</h1><p>Tu brújula para hoy.</p></div>

    <button class="crisis-cta" id="btn-crisis">🆘  NO ESTOY BIEN</button>
    <div class="spacer"></div>

    <div class="card">
      <div class="label">Dinero disponible</div>
      <div class="row">
        <div class="big">${fmt(t.available)}</div>
        <span class="pill ${t.available > 100000 ? "green" : t.available > 25000 ? "amber" : "red"}">
          ${t.available > 100000 ? "Zona verde" : t.available > 25000 ? "Zona amarilla" : "Zona roja"}
        </span>
      </div>
      <div class="hint">Gastado hoy: ${fmt(t.today)}</div>
    </div>

    <div class="card">
      <h2>Mis prioridades</h2>
      <ul class="clean">${prios.map(p => `<li>📍 ${esc(p.title)}</li>`).join("") || `<li class="muted">Configura tus prioridades.</li>`}</ul>
    </div>

    <div class="card">
      <h2>Siguiente paso</h2>
      ${next
        ? `<div class="row"><div><strong>${esc(next.title)}</strong>${next.estimatedCost ? `<div class="hint">${fmt(next.estimatedCost)}</div>` : ""}</div><span class="pill teal">${esc(next.priority)}</span></div>`
        : `<div class="muted">Sin pendientes. Agrega uno en Casa.</div>`}
    </div>

    <div class="metrics">
      <div class="metric"><div class="v">${streak()} 🔥</div><div class="k">Días seguidos registrando</div></div>
      <div class="metric"><div class="v">${activeHouseTasks().length}</div><div class="k">Pendientes activos</div></div>
    </div>

    <div class="card">
      <div class="label">Frase de hoy</div>
      <div style="font-size:17px;font-weight:600">“${esc(dailyPhrase())}”</div>
    </div>

    <div class="btn-row">
      <button class="btn" id="btn-spend">Voy a gastar</button>
      <button class="btn ghost" id="btn-income">Ingreso rápido</button>
    </div>
  `;
};
WIRE.home = (root) => {
  $("#btn-crisis", root).onclick = openCrisis;
  $("#btn-spend", root).onclick = openExpenseFlow;
  $("#btn-income", root).onclick = openIncome;
};

/* ---------------- MI NORTE ---------------- */
SCREENS.norte = () => `
  <div class="head"><h1>Mi Norte</h1><p>Las respuestas que te sostienen.</p></div>
  ${DB.norte.map(a => `
    <div class="card">
      <div class="label">${esc(a.question)}</div>
      <textarea data-norte="${a.id}" placeholder="Escribe tu respuesta...">${esc(a.answer)}</textarea>
    </div>`).join("")}
  <div class="card">
    <h2>Frases personales</h2>
    <ul class="clean" id="phrase-list">
      ${DB.phrases.map(p => `<li class="row"><span>“${esc(p.text)}”</span><button class="btn small soft-danger" data-del-phrase="${p.id}">Quitar</button></li>`).join("")}
    </ul>
    <div class="gap"></div>
    <label class="field"><span>Agregar frase</span><input type="text" id="new-phrase" placeholder="Una frase que te recuerde tu norte" /></label>
    <button class="btn ghost" id="add-phrase">Agregar frase</button>
  </div>
`;
WIRE.norte = (root) => {
  $$("textarea[data-norte]", root).forEach(ta => {
    ta.onchange = () => { const a = DB.norte.find(x => x.id === ta.dataset.norte); if (a) { a.answer = ta.value; save(); toast("Guardado"); } };
  });
  $("#add-phrase", root).onclick = () => {
    const v = $("#new-phrase", root).value.trim();
    if (!v) return;
    DB.phrases.push({ id: uid(), text: v }); save(); render();
  };
  $$("[data-del-phrase]", root).forEach(b => b.onclick = () => {
    DB.phrases = DB.phrases.filter(p => p.id !== b.dataset.delPhrase); save(); render();
  });
};

/* ---------------- DINERO ---------------- */
SCREENS.money = () => {
  const t = totals();
  const list = [...DB.movements].sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0, 60);
  return `
    <div class="head"><h1>Dinero</h1><p>Cada movimiento, sin juicio.</p></div>
    <div class="card">
      <div class="row">
        <div><div class="label">Disponible</div><div class="big">${fmt(t.available)}</div></div>
        <div class="center"><div class="hint">Hoy</div><div style="font-weight:700">${fmt(t.today)}</div></div>
      </div>
    </div>
    <div class="btn-row">
      <button class="btn" id="m-spend">Registrar gasto</button>
      <button class="btn ghost" id="m-income">Registrar ingreso</button>
    </div>
    <div class="card">
      <h2>Movimientos</h2>
      ${list.length ? list.map(m => `
        <div class="list-item">
          <div>${m.isIncome ? "🟢" : "🔴"}</div>
          <div class="grow">
            <div class="t">${esc(m.note || (m.isIncome ? "Ingreso" : "Gasto"))}</div>
            <div class="s">${new Date(m.date).toLocaleDateString("es-CR")}${m.kind ? " · " + esc(m.kind) : ""}${m.feeling ? " · " + esc(m.feeling) : ""}</div>
          </div>
          <div style="font-weight:700;color:${m.isIncome ? "var(--green)" : "var(--ink)"}">${m.isIncome ? "+" : "−"}${fmt(m.amount)}</div>
          <button class="btn small soft-danger" data-del-mov="${m.id}">×</button>
        </div>`).join("") : `<div class="muted">Aún no hay movimientos.</div>`}
    </div>
  `;
};
WIRE.money = (root) => {
  $("#m-spend", root).onclick = openExpenseFlow;
  $("#m-income", root).onclick = openIncome;
  $$("[data-del-mov]", root).forEach(b => b.onclick = () => {
    DB.movements = DB.movements.filter(m => m.id !== b.dataset.delMov); save(); render();
  });
};

/* ---------------- CASA ---------------- */
SCREENS.house = () => {
  const tasks = [...DB.house].sort((a,b)=> new Date(a.targetDate)-new Date(b.targetDate));
  const p = houseProgress();
  return `
    <div class="head"><h1>Casa Familiar</h1><p>Un paso terminado vale más que diez empezados.</p></div>
    <div class="card">
      <div class="row"><h2 style="margin:0">Avance</h2><strong>${Math.round(p*100)}%</strong></div>
      <div class="gap"></div>
      <div class="progress"><i style="width:${Math.round(p*100)}%"></i></div>
    </div>
    <button class="btn" id="add-task">+ Nuevo pendiente</button>
    <div class="gap"></div>
    ${tasks.length ? tasks.map(t => `
      <div class="card">
        <div class="row">
          <strong>${esc(t.title)}</strong>
          <span class="pill ${t.status==="Completado"?"green":t.status==="En proceso"?"amber":"teal"}">${esc(t.status)}</span>
        </div>
        <div class="hint">${esc(t.priority)} · Estimado ${fmt(t.estimatedCost)}${t.realCost?` · Real ${fmt(t.realCost)}`:""}</div>
        ${t.notes?`<div class="hint">${esc(t.notes)}</div>`:""}
        <div class="gap"></div>
        <div class="seg">
          ${HOUSE_STATUS.map(s => `<button data-status="${t.id}|${s}" class="${t.status===s?"on":""}">${s}</button>`).join("")}
        </div>
        <div class="gap"></div>
        <div class="btn-row">
          <button class="btn line small" data-edit-task="${t.id}">Editar</button>
          <button class="btn soft-danger small" data-del-task="${t.id}">Eliminar</button>
        </div>
      </div>`).join("") : `<div class="card muted">Agrega el primer pendiente de la casa.</div>`}
  `;
};
WIRE.house = (root) => {
  $("#add-task", root).onclick = () => openTaskSheet();
  $$("[data-status]", root).forEach(b => b.onclick = () => {
    const [id, s] = b.dataset.status.split("|");
    const t = DB.house.find(x => x.id === id); if (t) { t.status = s; save(); render(); }
  });
  $$("[data-edit-task]", root).forEach(b => b.onclick = () => openTaskSheet(b.dataset.editTask));
  $$("[data-del-task]", root).forEach(b => b.onclick = () => {
    DB.house = DB.house.filter(x => x.id !== b.dataset.delTask); save(); render();
  });
};

/* ---------------- NOCHE (reflexión) ---------------- */
SCREENS.reflection = () => {
  const hist = [...DB.reflections].sort((a,b)=> new Date(b.date)-new Date(a.date)).slice(0,30);
  return `
    <div class="head"><h1>Reflexión nocturna</h1><p>Cierra el día con calma.</p></div>
    <div class="card">
      <label class="field"><span>¿Qué hice bien hoy?</span><textarea id="r-well"></textarea></label>
      <label class="field"><span>¿Qué quiero mejorar mañana?</span><textarea id="r-improve"></textarea></label>
      <div class="row"><span>¿Me mantuve alineado con mis prioridades?</span></div>
      <div class="gap"></div>
      <div class="seg" id="r-aligned">
        <button data-al="1" class="on">Sí</button>
        <button data-al="0">No del todo</button>
      </div>
      <div class="gap"></div>
      <button class="btn" id="r-save">Guardar reflexión</button>
    </div>
    <div class="card">
      <h2>Historial</h2>
      ${hist.length ? hist.map(r => `
        <div class="list-item">
          <div>${r.aligned ? "🌟" : "🌙"}</div>
          <div class="grow">
            <div class="t">${new Date(r.date).toLocaleDateString("es-CR")}</div>
            <div class="s">${esc(r.didWell || "—")}</div>
          </div>
        </div>`).join("") : `<div class="muted">Tu primera reflexión aparecerá aquí.</div>`}
    </div>
  `;
};
WIRE.reflection = (root) => {
  let aligned = 1;
  $$("#r-aligned button", root).forEach(b => b.onclick = () => {
    aligned = +b.dataset.al;
    $$("#r-aligned button", root).forEach(x => x.classList.toggle("on", x === b));
  });
  $("#r-save", root).onclick = () => {
    DB.reflections.push({
      id: uid(), date: new Date().toISOString(),
      didWell: $("#r-well", root).value.trim(),
      improve: $("#r-improve", root).value.trim(),
      aligned: !!aligned,
    });
    save(); toast("Reflexión guardada"); render();
  };
};

/* ---------------- ANÁLISIS ---------------- */
SCREENS.analysis = () => {
  const expenses = DB.movements.filter(m => !m.isIncome);
  const impulses = expenses.filter(m => m.kind === "Impulso");
  const avoided = DB.semaphore.reduce((s,r)=> s + (r.avoidedAmount||0), 0);
  const stopped = DB.semaphore.filter(r => !r.continued).length;

  const count = (arr) => {
    const map = {};
    arr.forEach(v => { if (v) map[v] = (map[v]||0)+1; });
    return Object.entries(map).map(([name,c])=>({name,c})).sort((a,b)=>b.c-a.c);
  };
  const emotions = count(expenses.map(m => m.feeling));
  const notes = count(expenses.map(m => m.note)).slice(0,5);
  const dayName = (d) => new Date(d).toLocaleDateString("es-CR",{weekday:"long"});
  const days = count(impulses.map(m => dayName(m.date)));
  const maxE = Math.max(1, ...emotions.map(e=>e.c));

  const bars = (rows, max) => rows.length ? `<div class="bars">${rows.map(r=>`
    <div class="bar-row"><span>${esc(r.name)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.round(r.c/max*100)}%"></div></div><span>${r.c}</span></div>
  `).join("")}</div>` : `<div class="muted">Sin datos todavía.</div>`;

  return `
    <div class="head"><h1>Análisis personal</h1><p>Patrones, no culpa.</p></div>
    <div class="metrics">
      <div class="metric"><div class="v">${stopped}</div><div class="k">Impulsos evitados</div></div>
      <div class="metric"><div class="v">${fmt(avoided)}</div><div class="k">Dinero no gastado</div></div>
      <div class="metric"><div class="v">${impulses.length}</div><div class="k">Gastos impulsivos</div></div>
      <div class="metric"><div class="v">${Math.round(houseProgress()*100)}%</div><div class="k">Avance casa</div></div>
    </div>
    <div class="card"><h2>Emociones asociadas a gastos</h2>${bars(emotions, maxE)}</div>
    <div class="card"><h2>Compras más frecuentes</h2>${bars(notes, Math.max(1,...notes.map(n=>n.c)))}</div>
    <div class="card"><h2>Días con mayor riesgo</h2>${bars(days, Math.max(1,...days.map(d=>d.c)))}</div>
  `;
};
WIRE.analysis = () => {};

/* ---------------- AJUSTES ---------------- */
SCREENS.settings = () => `
  <div class="head"><h1>Ajustes</h1><p>Tu app, a tu medida.</p></div>
  <div class="card">
    <label class="field"><span>Monto que activa el semáforo de decisiones</span>
      <input type="number" id="s-threshold" value="${DB.settings.threshold}" inputmode="numeric" /></label>
    <div class="hint">Cualquier gasto igual o mayor te hará pasar por el semáforo.</div>
  </div>
  <div class="card">
    <h2>Recordatorio nocturno</h2>
    <label class="field"><span>Hora</span>
      <input type="number" id="s-hour" value="${DB.settings.reminderHour}" min="0" max="23" /></label>
    <div class="hint">En la versión web el recordatorio es una guía visual; activa las notificaciones del navegador si tu iPhone lo permite.</div>
  </div>
  <div class="card">
    <h2>Tus datos</h2>
    <div class="hint">Todo se guarda solo en este teléfono. Puedes exportarlos como respaldo.</div>
    <div class="gap"></div>
    <div class="btn-row">
      <button class="btn ghost" id="s-export">Exportar respaldo</button>
      <button class="btn soft-danger" id="s-reset">Borrar todo</button>
    </div>
  </div>
  <div class="center hint">MI NORTE · versión web</div>
`;
WIRE.settings = (root) => {
  $("#s-threshold", root).onchange = (e) => { DB.settings.threshold = +e.target.value || 0; save(); toast("Guardado"); };
  $("#s-hour", root).onchange = (e) => { DB.settings.reminderHour = Math.max(0,Math.min(23,+e.target.value||21)); save(); toast("Guardado"); };
  $("#s-export", root).onclick = () => {
    const blob = new Blob([JSON.stringify(DB,null,2)], {type:"application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "mi-norte-respaldo.json"; a.click();
  };
  $("#s-reset", root).onclick = () => {
    if (confirm("¿Borrar todos tus datos? Esto no se puede deshacer.")) {
      DB = structuredClone(SEED); save(); render(); toast("Datos reiniciados");
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

/* ---- Ingreso rápido ---- */
function openIncome() {
  openSheet(`
    <h2>Ingreso rápido</h2>
    <label class="field"><span>Monto</span><input type="number" id="i-amt" inputmode="decimal" placeholder="0" /></label>
    <label class="field"><span>Descripción</span><input type="text" id="i-note" placeholder="Salario, venta, etc." /></label>
    <button class="btn" id="i-save">Guardar ingreso</button>
    <div class="gap"></div><button class="btn line" onclick="closeSheet()">Cancelar</button>
  `);
  $("#i-save").onclick = () => {
    const amt = parseFloat(($("#i-amt").value||"").replace(",",".")) || 0;
    if (amt <= 0) return toast("Escribe un monto");
    DB.movements.push({ id: uid(), date: new Date().toISOString(), note: $("#i-note").value.trim()||"Ingreso", amount: amt, isIncome: true });
    save(); closeSheet(); render(); toast("Ingreso registrado");
  };
}

/* ---- Flujo de gasto guiado ---- */
function openExpenseFlow() {
  const sel = { kind: "Necesidad", budget: "Sí", feeling: "Tranquilo", alignment: "Me acerca" };
  openSheet(`
    <h2>Registrar gasto</h2>
    <label class="field"><span>Paso 1 · Monto</span><input type="number" id="e-amt" inputmode="decimal" placeholder="0" /></label>
    <label class="field"><span>Descripción</span><input type="text" id="e-note" placeholder="¿En qué?" /></label>

    <div class="card">
      <div class="label">Paso 2 · ¿Necesidad o impulso?</div>
      <div class="seg" data-group="kind">
        <button data-v="Necesidad" class="on">Necesidad</button>
        <button data-v="Impulso">Impulso</button>
      </div>
    </div>
    <div class="card">
      <div class="label">Paso 3 · ¿Estaba presupuestado?</div>
      <div class="seg" data-group="budget">
        <button data-v="Sí" class="on">Sí</button>
        <button data-v="No">No</button>
      </div>
    </div>
    <div class="card">
      <div class="label">Paso 4 · ¿Cómo me siento?</div>
      <div class="chips" data-group="feeling">
        ${FEELINGS.map((f,i)=>`<button data-v="${f}" class="${i===0?"on":""}">${f}</button>`).join("")}
      </div>
    </div>
    <div class="card">
      <div class="label">Paso 5 · ¿Este gasto me acerca o me aleja?</div>
      <div class="seg" data-group="alignment">
        <button data-v="Me acerca" class="on">Me acerca</button>
        <button data-v="Me aleja">Me aleja</button>
      </div>
    </div>

    <div id="e-warn"></div>
    <button class="btn" id="e-go">Continuar</button>
    <div class="gap"></div><button class="btn line" onclick="closeSheet()">Cancelar</button>
  `);

  const refreshWarn = () => {
    const blocked = hasActiveCalmTimer() && sel.kind === "Impulso";
    $("#e-warn").innerHTML = blocked ? `<div class="warn">⏳ Durante el temporizador de calma, las compras impulsivas quedan en pausa.</div><div class="gap"></div>` : "";
    $("#e-go").disabled = blocked;
  };
  $$("[data-group]").forEach(g => $$("button", g).forEach(b => b.onclick = () => {
    sel[g.dataset.group] = b.dataset.v;
    $$("button", g).forEach(x => x.classList.toggle("on", x === b));
    refreshWarn();
  }));
  refreshWarn();

  $("#e-go").onclick = () => {
    const amt = parseFloat(($("#e-amt").value||"").replace(",",".")) || 0;
    const note = $("#e-note").value.trim();
    if (amt <= 0) return toast("Escribe un monto");
    if (hasActiveCalmTimer() && sel.kind === "Impulso") return;
    const payload = { amount: amt, note: note || "Gasto", ...sel };
    if (amt >= DB.settings.threshold) {
      openSemaphore(payload);
    } else {
      saveExpense(payload); closeSheet(); render(); toast("Gasto registrado");
    }
  };
}
function saveExpense(p) {
  DB.movements.push({ id: uid(), date: new Date().toISOString(), note: p.note, amount: p.amount, isIncome: false,
    kind: p.kind, budget: p.budget, feeling: p.feeling, alignment: p.alignment });
  save();
}

/* ---- Semáforo de decisiones ---- */
function openSemaphore(p) {
  openSheet(`
    <h2>🚦 Semáforo de decisiones</h2>
    <div class="card center">
      <div class="label">Vas a gastar</div>
      <div class="big">${fmt(p.amount)}</div>
      <div class="hint">${esc(p.note)}</div>
    </div>
    <div class="card" style="border-left:5px solid var(--red)">
      <strong>🔴 Pausa</strong>
      <p class="hint">Este gasto es alto. Respira y responde con honestidad.</p>
      <label class="field"><span>¿Lo necesito realmente hoy?</span>
        <div class="seg" data-q="need"><button data-v="1">Sí</button><button data-v="0" class="on">No estoy seguro</button></div></label>
      <label class="field"><span>¿Puede esperar 24 horas?</span>
        <div class="seg" data-q="wait"><button data-v="1" class="on">Sí</button><button data-v="0">No</button></div></label>
    </div>
    <div class="card" style="border-left:5px solid var(--amber)">
      <strong>🟡 ¿Qué postergo si lo compro?</strong>
      <label class="field"><span>Objetivo que se retrasa</span><input type="text" id="sm-obj" placeholder="Ej: material para la casa" /></label>
      <label class="field"><span>¿Lo seguiría eligiendo mañana?</span>
        <div class="seg" data-q="tomorrow"><button data-v="1">Sí</button><button data-v="0" class="on">No</button></div></label>
    </div>
    <div class="btn-row">
      <button class="btn danger" id="sm-stop">🟢 Mejor espero</button>
      <button class="btn line" id="sm-go">Aún así gastar</button>
    </div>
  `, { fullscreen: true });

  const q = { need: 0, wait: 1, tomorrow: 0 };
  $$("[data-q]").forEach(g => $$("button", g).forEach(b => b.onclick = () => {
    q[g.dataset.q] = +b.dataset.v;
    $$("button", g).forEach(x => x.classList.toggle("on", x === b));
  }));

  const record = (continued) => {
    DB.semaphore.push({ id: uid(), date: new Date().toISOString(), amount: p.amount, note: p.note,
      objective: $("#sm-obj")?.value.trim() || "", continued, avoidedAmount: continued ? 0 : p.amount });
    if (continued) saveExpense(p);
    save(); closeSheet(); render();
    toast(continued ? "Gasto registrado" : `Evitaste ${fmt(p.amount)} 💪`);
  };
  $("#sm-stop").onclick = () => record(false);
  $("#sm-go").onclick = () => record(true);
}

/* ---- Pendiente de la casa (crear/editar) ---- */
function openTaskSheet(id) {
  const t = id ? DB.house.find(x => x.id === id) : null;
  openSheet(`
    <h2>${t ? "Editar pendiente" : "Nuevo pendiente"}</h2>
    <label class="field"><span>Título</span><input type="text" id="t-title" value="${t?esc(t.title):""}" placeholder="Ej: Terminar el baño" /></label>
    <label class="field"><span>Costo estimado</span><input type="number" id="t-est" value="${t?t.estimatedCost:""}" inputmode="numeric" placeholder="0" /></label>
    <label class="field"><span>Costo real (si ya gastaste)</span><input type="number" id="t-real" value="${t?t.realCost:""}" inputmode="numeric" placeholder="0" /></label>
    <label class="field"><span>Prioridad</span>
      <div class="seg" data-group="priority">${HOUSE_PRIORITY.map(p=>`<button data-v="${p}" class="${(t?t.priority:"Media")===p?"on":""}">${p}</button>`).join("")}</div></label>
    <label class="field"><span>Notas</span><textarea id="t-notes" placeholder="Detalles, medidas, etc.">${t?esc(t.notes):""}</textarea></label>
    <button class="btn" id="t-save">${t ? "Guardar cambios" : "Crear pendiente"}</button>
    <div class="gap"></div><button class="btn line" onclick="closeSheet()">Cancelar</button>
  `, { fullscreen: true });

  let priority = t ? t.priority : "Media";
  $$('[data-group="priority"] button').forEach(b => b.onclick = () => {
    priority = b.dataset.v;
    $$('[data-group="priority"] button').forEach(x => x.classList.toggle("on", x === b));
  });
  $("#t-save").onclick = () => {
    const title = $("#t-title").value.trim();
    if (!title) return toast("Ponle un título");
    const data = {
      title,
      estimatedCost: +$("#t-est").value || 0,
      realCost: +$("#t-real").value || 0,
      priority, notes: $("#t-notes").value.trim(),
    };
    if (t) { Object.assign(t, data); }
    else { DB.house.push({ id: uid(), status: "Pendiente", targetDate: new Date().toISOString(), ...data }); }
    save(); closeSheet(); render();
  };
}

/* ---- Modo Crisis ---- */
let crisisInterval = null;
function openCrisis() {
  renderCrisisReasons();
}
function renderCrisisReasons() {
  openSheet(`
    <div class="toolbar"><h2 style="margin:0">No estoy bien</h2><button class="x" onclick="closeSheet()">✕</button></div>
    <p class="hint">Primero bajamos la intensidad. Después decidimos.</p>
    <div class="card">
      <div class="label">¿Qué está pasando?</div>
      <div class="chips grid" data-group="reason">
        ${CRISIS_REASONS.map(r=>`<button data-v="${esc(r)}">${esc(r)}</button>`).join("")}
      </div>
    </div>
    <div class="card">
      <div class="label">Temporizador de calma</div>
      <div class="seg" data-group="minutes">
        <button data-v="5" class="on">5 min</button>
        <button data-v="10">10 min</button>
        <button data-v="15">15 min</button>
      </div>
    </div>
    <button class="btn" id="c-start" disabled>Iniciar calma</button>
  `, { fullscreen: true });

  let reason = null, minutes = 5;
  $$('[data-group="reason"] button').forEach(b => b.onclick = () => {
    reason = b.dataset.v;
    $$('[data-group="reason"] button').forEach(x => x.classList.toggle("on", x === b));
    $("#c-start").disabled = false;
  });
  $$('[data-group="minutes"] button').forEach(b => b.onclick = () => {
    minutes = +b.dataset.v;
    $$('[data-group="minutes"] button').forEach(x => x.classList.toggle("on", x === b));
  });
  $("#c-start").onclick = () => {
    if (!reason) return;
    const session = { id: uid(), startedAt: new Date().toISOString(), reason, calmMinutes: minutes, completedAt: null };
    DB.crisis.push(session); save();
    runCrisis(session);
  };
}
function runCrisis(session) {
  let remaining = session.calmMinutes * 60;
  const items = (title, arr) => `
    <div class="card"><h2>${title}</h2>${arr.length ? `<ul class="clean">${arr.map(x=>`<li>📍 ${esc(x)}</li>`).join("")}</ul>` : `<div class="muted">Sin información todavía.</div>`}</div>`;
  const prios = DB.priorities.filter(p=>p.active).map(p=>p.title);
  const norte = DB.norte.map(a=>a.answer).filter(Boolean).slice(0,3);
  const metas = activeHouseTasks().slice(0,3).map(t=>t.title);
  const frases = DB.phrases.map(p=>p.text).slice(0,3);

  openSheet(`
    <div class="toolbar"><h2 style="margin:0">Respira</h2><button class="x" id="c-close">✕</button></div>
    <div class="timer-big" id="c-timer">--:--</div>
    <div class="card center"><strong>No tienes que resolver todo ahora.</strong><p class="hint">Solo evita decidir desde la presión.</p></div>
    ${items("Mis prioridades", prios)}
    ${items("Mi Norte", norte)}
    ${items("Mis metas", metas)}
    ${items("Frases personales", frases)}
    <button class="btn" id="c-finish">Terminar sesión</button>
  `, { fullscreen: true });

  const paint = () => {
    const m = Math.floor(remaining/60), s = remaining%60;
    $("#c-timer").textContent = `${m}:${String(s).padStart(2,"0")}`;
  };
  paint();
  clearInterval(crisisInterval);
  crisisInterval = setInterval(() => {
    remaining--;
    if (remaining <= 0) { finishCrisis(session); }
    else paint();
  }, 1000);

  $("#c-finish").onclick = () => finishCrisis(session);
  $("#c-close").onclick = () => { clearInterval(crisisInterval); closeSheet(); render(); };
}
function finishCrisis(session) {
  clearInterval(crisisInterval);
  const s = DB.crisis.find(x => x.id === session.id);
  if (s) s.completedAt = new Date().toISOString();
  save(); closeSheet(); render();
  toast("Lo lograste. Un paso a la vez.");
}

/* ===========================================================
   ARRANQUE
   =========================================================== */
$$(".tab").forEach(b => b.onclick = () => { currentTab = b.dataset.tab; render(); });
window.closeSheet = closeSheet; // usado por onclick inline
render();

/* Service worker (offline) */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(()=>{}));
}
