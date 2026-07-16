/* Presupuestos por ciclo de pago: el gasto se cuenta desde el inicio del ciclo
   (no por mes calendario), el ciclo avanza solo (anti-olvido) y se reinicia a
   mano ("ya me pagaron"). Reportes usa el límite escalado a mes-equivalente. */
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = require('path').join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, s) => {
  let p = q.url.split('?')[0]; if (p === '/') p = '/index.html';
  if (p === '/sw.js') { s.writeHead(404); s.end(); return; }
  fs.readFile(path.join(ROOT, p), (e, d) => { if (e) { s.writeHead(404); s.end(); } else { s.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'text/plain' }); s.end(d); } });
});

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await b.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));

  await page.addInitScript(() => {
    const RD = Date; const fx = new RD(2026, 5, 20, 12, 0, 0).getTime(); // 20 jun 2026
    function FD(...a){ if(!(this instanceof FD)) return new RD(fx).toString(); return a.length ? new RD(...a) : new RD(fx); }
    FD.prototype = RD.prototype; FD.now = () => fx; FD.parse = RD.parse; FD.UTC = RD.UTC; window.Date = FD;
    const iso = (d) => new RD(2026, 5, d, 12).toISOString();
    localStorage.setItem('mi_norte_data_v2', JSON.stringify({
      settings: { currency: 'CRC', decimals: 'auto', locale: 'es-CR', gate: false },
      accounts: [{ id: 'a1', name: 'BAC', kind: 'banco', opening: 200000 }],
      transactions: [
        { id: 't1', date: iso(5), type: 'expense', amount: 40000, category: 'Comida', account: 'a1' },
        { id: 't2', date: iso(18), type: 'expense', amount: 25000, category: 'Comida', account: 'a1' }
      ],
      budgets: { Comida: 60000 }, goals: [], recurring: [], debts: [], categories: {}
    }));
  });
  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForFunction(() => document.querySelector('#screen') && document.querySelector('#screen').children.length > 0);

  const get = (name, fn) => page.evaluate(fn).then(v => { console.log(name, JSON.stringify(v)); return v; });

  // E) mensual por defecto: cuenta ambos gastos de junio (65k) => excedido
  const E = await get('E mensual(def)', () => { const c = budgetCycleStatus().find(x => x.name === 'Comida'); return { start: payCycle().start, spent: c.spent, over: c.over }; });

  // A) quincenal anclado 16 jun: solo cuenta desde el 16 (el gasto del 18 = 25k)
  const A = await get('A quincenal 16jun', () => { DB.settings.payCycle = { freq: 'quincenal', anchor: '2026-06-16' }; const c = budgetCycleStatus().find(x => x.name === 'Comida'); return { start: payCycle().start, end: payCycle().end, spent: c.spent, over: c.over }; });

  // C) auto-roll: ancla vieja 1 may => rueda sola hasta contener hoy (inicio 15 jun)
  const C = await get('C auto-roll 1may', () => { DB.settings.payCycle = { freq: 'quincenal', anchor: '2026-05-01' }; const c = budgetCycleStatus().find(x => x.name === 'Comida'); return { start: payCycle().start, spent: c.spent }; });

  // D) Reportes: límite escalado a mes-equivalente (quincenal => x2 = 120k) vs gasto del mes (65k)
  const D = await get('D reportes mensual', () => { DB.settings.payCycle = { freq: 'quincenal', anchor: '2026-06-16' }; const c = budgetStatus('2026-06').find(x => x.name === 'Comida'); return { limit: c.limit, spent: c.spent, over: c.over }; });

  // B) reiniciar hoy: el conteo arranca en 0 (el gasto del 18 queda en el ciclo anterior)
  const B = await get('B reset hoy', () => { DB.settings.payCycle = { freq: 'quincenal', anchor: todayKeyStr() }; const c = budgetCycleStatus().find(x => x.name === 'Comida'); return { start: payCycle().start, spent: c ? c.spent : 0 }; });

  const ok = errs.length === 0 &&
    E.start === '2026-06-01' && E.spent === 65000 && E.over === true &&
    A.start === '2026-06-16' && A.end === '2026-07-01' && A.spent === 25000 && A.over === false &&
    C.start === '2026-06-15' && C.spent === 25000 &&
    D.limit === 120000 && D.spent === 65000 && D.over === false &&
    B.start === '2026-06-20' && B.spent === 0;
  console.log('\nERRORS:', errs.length ? errs : 'none');
  console.log(ok ? '\n✅ ALL PASS' : '\n❌ FAIL');
  await b.close(); server.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
