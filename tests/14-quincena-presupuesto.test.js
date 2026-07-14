/* "Para gastar hoy" mejorado:
   (1) suma la quincena confiable (ingreso fijo que aún no vence, con gracia);
       si vence sin registrarse, deja de contarla → la alarma puede saltar.
   (2) con Presupuestos activo, aparta el saldo restante (modelo de sobres) y
       no dispara "Mes apretado". */
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = require('path').join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, s) => {
  let p = q.url.split('?')[0]; if (p === '/') p = '/index.html';
  if (p === '/sw.js') { s.writeHead(404); s.end(); return; }
  fs.readFile(path.join(ROOT, p), (e, d) => { if (e) { s.writeHead(404); s.end(); } else { s.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'text/plain' }); s.end(d); } });
});
const now = new Date(), Y = now.getFullYear(), M = now.getMonth();
// Congela el mes en uno con día 15 y 25 válidos y ≥ 26 días. Usamos el mes actual.

function seedScript(day, store) {
  return function ({ Y, M, day, store }) {
    const RD = Date; const fx = new RD(Y, M, day, 12, 0, 0).getTime();
    function FD(...a) { if (!(this instanceof FD)) return new RD(fx).toString(); return a.length ? new RD(...a) : new RD(fx); }
    FD.prototype = RD.prototype; FD.now = () => fx; FD.parse = RD.parse; FD.UTC = RD.UTC; window.Date = FD;
    localStorage.setItem(store.key, JSON.stringify(store.db));
  };
}

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const base = (over) => Object.assign({
    settings: { currency: 'CRC', decimals: 'auto', locale: 'es-CR', gate: false, features: {} },
    accounts: [{ id: 'a1', name: 'BAC', kind: 'banco', opening: 30000 }],
    transactions: [], budgets: {}, goals: [],
    recurring: [], debts: [], categories: { expense: ['Comida', 'Servicios'], income: ['Salario'] }
  }, over);

  async function run(day, db, tag) {
    const p = await b.newPage();
    p.on('pageerror', e => errs.push(tag + ' ' + e.message));
    await p.addInitScript(seedScript(day), { Y, M, day, store: { key: 'mi_norte_esencial', db } });
    await p.goto(`http://localhost:${port}/index.html`);
    await p.waitForFunction(() => document.querySelector('#screen') && document.querySelector('#screen').children.length > 0);
    const out = await p.evaluate(() => {
      const st = safeToday();
      const heroSub = (document.querySelector('.mo-hero-s') || {}).textContent || '';
      return { income: st.income, committed: st.committed, reserved: st.reserved, baseV: st.base, pool: st.pool, amount: st.amount, crisis: st.crisis, heroSub };
    });
    await p.close();
    return out;
  }

  // ---- A: quincena aún por entrar (día 10, quincena día 15) → se cuenta, sin crisis
  const dbA = base({
    recurring: [
      { id: 'inc', type: 'income', amount: 200000, category: 'Salario', note: 'Quincena', day: 15, account: 'a1' },
      { id: 'luz', type: 'expense', amount: 50000, category: 'Servicios', note: 'Luz', day: 25, account: 'a1' }
    ]
  });
  const A = await run(10, dbA, 'A');
  console.log('A (día 10, quincena viene):', JSON.stringify(A));

  // ---- B: quincena venció sin registrarse (día 20, quincena día 15, gracia 2) → NO se cuenta → crisis
  const B = await run(20, dbA, 'B');
  console.log('B (día 20, quincena venció):', JSON.stringify(B));

  // ---- Bg: dentro de la gracia (día 16, quincena día 15) → sí se cuenta
  const Bg = await run(16, dbA, 'Bg');
  console.log('Bg (día 16, gracia):', JSON.stringify(Bg));

  // ---- C: presupuesto activo aparta saldo restante (día 10)
  const dbC = base({
    accounts: [{ id: 'a1', name: 'BAC', kind: 'banco', opening: 200000 }],
    settings: { currency: 'CRC', decimals: 'auto', locale: 'es-CR', gate: false, features: { presupuestos: true, categorias: true } },
    budgets: { Comida: 120000 },
    transactions: [{ id: 't1', type: 'expense', amount: 20000, category: 'Comida', account: 'a1', date: new Date(Y, M, 5, 12).toISOString() }]
  });
  const C = await run(10, dbC, 'C');
  console.log('C (presupuesto activo):', JSON.stringify(C));

  // ---- C2: mismo caso pero sin la función → no aparta nada
  const dbC2 = JSON.parse(JSON.stringify(dbC));
  dbC2.settings.features = {};
  const C2 = await run(10, dbC2, 'C2');
  console.log('C2 (presupuesto inactivo):', JSON.stringify(C2));

  const dim = new Date(Y, M + 1, 0).getDate();
  const ok = errs.length === 0 &&
    // A: income 200k contado; base 30k+200k−50k=180k; sin crisis; subtítulo "comida"
    A.income === 200000 && A.committed === 50000 && A.baseV === 180000 && A.crisis === false &&
    A.reserved === 0 && /comida/i.test(A.heroSub) &&
    // B: income 0 (venció); base 30k−50k=−20k; crisis
    B.income === 0 && B.baseV === -20000 && B.crisis === true &&
    // Bg: gracia → income 200k, sin crisis
    Bg.income === 200000 && Bg.crisis === false &&
    // C: reserved = 120k−20k gastado = 100k; pool = (200k−20k) − 100k = 80k; sin crisis; subtítulo "presupuestaste"
    C.reserved === 100000 && C.pool === 80000 && C.crisis === false && /presupuest/i.test(C.heroSub) &&
    C.amount === Math.floor(80000 / (dim - 10 + 1)) &&
    // C2: sin función, reserved 0 y pool = 180k (200k−20k gastado)
    C2.reserved === 0 && C2.pool === 180000 && /comida/i.test(C2.heroSub);
  console.log('\nERRORS:', errs.length ? errs : 'none');
  console.log(ok ? '\n✅ ALL PASS' : '\n❌ FAIL');
  await b.close(); server.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
