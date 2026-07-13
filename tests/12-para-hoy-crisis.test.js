/* "Para hoy" (gasto seguro diario), Modo crisis (plan de pagos) y
   patrón semanal local (tip en el día de decisión). */
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

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];

  // ---- Escenario 1: mes holgado → "Para hoy" con matemática exacta (día congelado al 10)
  const p1 = await b.newPage();
  p1.on('pageerror', e => errs.push('P1 ' + e.message));
  await p1.addInitScript(({ Y, M }) => {
    const RD = Date; const fx = new RD(Y, M, 10, 12, 0, 0).getTime();
    function FD(...a) { if (!(this instanceof FD)) return new RD(fx).toString(); return a.length ? new RD(...a) : new RD(fx); }
    FD.prototype = RD.prototype; FD.now = () => fx; FD.parse = RD.parse; FD.UTC = RD.UTC; window.Date = FD;
    const iso = (d) => new RD(Y, M, d, 12).toISOString();
    localStorage.setItem('mi_norte_data_v2', JSON.stringify({
      settings: { currency: 'CRC', decimals: 'auto', locale: 'es-CR', gate: false },
      accounts: [{ id: 'a1', name: 'BAC', kind: 'banco', opening: 100000 }],
      transactions: [], budgets: {}, goals: [],
      recurring: [{ id: 'r1', type: 'expense', amount: 30000, category: 'Servicios', note: 'Luz', day: 25, account: 'a1', auto: false }],
      debts: [{ id: 'd1', name: 'Préstamo', dir: 'owe', principal: 200000, rate: 0, ratePeriod: 'anual', monthly: 20000, dueDate: iso(20), payments: [] }],
      categories: {}
    }));
  }, { Y, M });
  await p1.goto(`http://localhost:${port}/index.html`);
  await p1.waitForFunction(() => document.querySelector('#screen') && document.querySelector('#screen').children.length > 0);
  const r1 = await p1.evaluate(() => {
    const st = safeToday();
    return { pool: st.pool, committed: st.committed, daysLeft: st.daysLeft, amount: st.amount, crisis: st.crisis,
      shownOnHome: !!document.querySelector('.mo-safe:not(.crisis)'), stepAct: nextStep().act };
  });
  const dim = new Date(Y, M + 1, 0).getDate();
  const expDaysLeft = dim - 10 + 1;
  const expAmount = Math.floor((100000 - 50000) / expDaysLeft);
  console.log('S1:', JSON.stringify(r1), '| esperado amount', expAmount);

  // ---- Escenario 2: crisis (líquido 30k < compromisos 50k) → plan ordenado y brecha
  const p2 = await b.newPage();
  p2.on('pageerror', e => errs.push('P2 ' + e.message));
  await p2.addInitScript(({ Y, M }) => {
    const RD = Date; const fx = new RD(Y, M, 10, 12, 0, 0).getTime();
    function FD(...a) { if (!(this instanceof FD)) return new RD(fx).toString(); return a.length ? new RD(...a) : new RD(fx); }
    FD.prototype = RD.prototype; FD.now = () => fx; FD.parse = RD.parse; FD.UTC = RD.UTC; window.Date = FD;
    const iso = (mo, d) => new RD(Y, mo, d, 12).toISOString();
    localStorage.setItem('mi_norte_data_v2', JSON.stringify({
      settings: { currency: 'CRC', decimals: 'auto', locale: 'es-CR', gate: false },
      accounts: [{ id: 'a1', name: 'BAC', kind: 'banco', opening: 30000 }],
      transactions: [], budgets: {}, goals: [],
      recurring: [{ id: 'r1', type: 'expense', amount: 30000, category: 'Servicios', note: 'Luz', day: 25, account: 'a1', auto: false }],
      debts: [
        { id: 'd1', name: 'Préstamo caro', dir: 'owe', principal: 200000, rate: 4, ratePeriod: 'mensual', monthly: 20000, dueDate: iso(M - 1, 28), payments: [] },
        { id: 'd2', name: 'Cuota normal', dir: 'owe', principal: 100000, rate: 0, ratePeriod: 'anual', monthly: 15000, dueDate: iso(M, 20), payments: [] }
      ], categories: {}
    }));
  }, { Y, M });
  await p2.goto(`http://localhost:${port}/index.html`);
  await p2.waitForFunction(() => document.querySelector('#screen') && document.querySelector('#screen').children.length > 0);
  const r2 = await p2.evaluate(() => {
    const st = safeToday(), plan = crisisPlan();
    openCrisis();
    const sheet = document.querySelector('#sheet-root .sheet');
    return { crisis: st.crisis, amount: st.amount, stepAct: nextStep().act,
      order: plan.rows.map(r => r.name), fits: plan.rows.map(r => r.fits),
      pricey: plan.rows.map(r => r.pricey), gap: plan.gap,
      crisisRowOnHome: !!document.querySelector('#mo-crisis'),
      sheetHasPlan: !!sheet && sheet.innerText.toUpperCase().includes('PAGAR PRIMERO') && sheet.innerText.toUpperCase().includes('HABLAR ANTES DE QUE VENZAN') };
  });
  console.log('S2:', JSON.stringify(r2));

  // ---- Escenario 3: patrón semanal → tip solo el día pico (gastos sembrados en el weekday de HOY)
  const p3 = await b.newPage();
  p3.on('pageerror', e => errs.push('P3 ' + e.message));
  await p3.addInitScript(() => {
    const now = new Date(), tx = [];
    // 8 semanas: gasto fuerte el weekday de hoy + gastos chicos otros días
    for (let k = 0; k < 8; k++) {
      const d = new Date(now.getTime() - k * 7 * 86400000); d.setHours(12, 0, 0, 0);
      tx.push({ id: 'h' + k, date: d.toISOString(), type: 'expense', amount: 20000, category: 'Ocio', account: 'a1' });
      const o = new Date(d.getTime() - 2 * 86400000);
      tx.push({ id: 'o' + k, date: o.toISOString(), type: 'expense', amount: 4000, category: 'Comida', account: 'a1' });
      const o2 = new Date(d.getTime() - 4 * 86400000);
      tx.push({ id: 'q' + k, date: o2.toISOString(), type: 'expense', amount: 4000, category: 'Comida', account: 'a1' });
    }
    localStorage.setItem('mi_norte_data_v2', JSON.stringify({
      settings: { currency: 'CRC', decimals: 'auto', locale: 'es-CR', gate: false },
      accounts: [{ id: 'a1', name: 'BAC', kind: 'banco', opening: 500000 }],
      transactions: tx, budgets: {}, goals: [], recurring: [], debts: [], categories: {}
    }));
  });
  await p3.goto(`http://localhost:${port}/index.html`);
  await p3.waitForFunction(() => document.querySelector('#screen') && document.querySelector('#screen').children.length > 0);
  const r3 = await p3.evaluate(() => {
    const p = weekdayPattern(), tip = weekdayTip();
    return { hasPattern: !!p, day: p && p.day, today: new Date().getDay(), share: p && p.share,
      tipShown: !!tip, tipOnHome: (document.querySelector('.mo-win') || {}).textContent || '' };
  });
  console.log('S3:', JSON.stringify(r3));

  const ok = errs.length === 0 &&
    // S1: 100000 − (20000 cuota + 30000 luz) = 50000 de sobra
    r1.committed === 50000 && r1.pool === 50000 && r1.daysLeft === expDaysLeft &&
    r1.amount === expAmount && r1.crisis === false && r1.shownOnHome && r1.stepAct !== 'crisis' &&
    // S2: crisis, vencido caro primero (🔥), luego cuota, luego luz; brecha 35000
    r2.crisis === true && r2.amount === 0 && r2.stepAct === 'crisis' &&
    r2.order[0] === 'Préstamo caro' && r2.pricey[0] === true &&
    r2.fits[0] === true && r2.fits[2] === false && r2.gap === 35000 &&
    r2.crisisRowOnHome && r2.sheetHasPlan &&
    // S3: patrón detectado hoy → tip visible
    r3.hasPattern && r3.day === r3.today && r3.share >= 30 && r3.tipShown && r3.tipOnHome.includes('💡');
  console.log('\nERRORS:', errs.length ? errs : 'none');
  console.log(ok ? '\n✅ ALL PASS' : '\n❌ FAIL');
  await b.close(); server.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
