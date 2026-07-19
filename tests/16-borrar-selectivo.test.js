/* Borrar datos con opciones: "solo movimientos" limpia el historial pero
   conserva saldos (opening = saldo actual), deudas/préstamos, metas y
   presupuestos; "todo" deja la app como recién instalada. */
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
  page.on('dialog', d => d.accept()); // aceptar los confirm()

  await page.addInitScript(() => {
    Date.prototype.getHours = function () { return 12; };
    const iso = d => new Date(2026, 6, d, 12).toISOString();
    localStorage.setItem('mi_norte_data_v2', JSON.stringify({
      settings: { currency: 'CRC', decimals: 'auto', locale: 'es-CR', gate: false },
      accounts: [{ id: 'a1', name: 'BAC', kind: 'banco', opening: 100000 }],
      transactions: [
        { id: 'i1', date: iso(1), type: 'income', amount: 50000, category: 'Salario', account: 'a1' },
        { id: 'e1', date: iso(3), type: 'expense', amount: 20000, category: 'Comida', account: 'a1' }
      ],
      budgets: { Comida: 60000 },
      goals: [{ id: 'g1', name: 'Meta', target: 100000, saved: 30000 }],
      recurring: [],
      debts: [{ id: 'd1', name: 'Préstamo', dir: 'owe', principal: 200000, rate: 0, ratePeriod: 'anual', monthly: 20000, dueDate: '', payments: [{ id: 'p1', date: iso(5), amount: 30000, interest: 0, capital: 30000, txId: 'i1' }] }],
      categories: { expense: ['Comida'], income: ['Salario'] }
    }));
  });
  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForFunction(() => document.querySelector('#screen') && document.querySelector('#screen').children.length > 0);

  const before = await page.evaluate(() => ({ nw: netWorth(), tx: DB.transactions.length }));
  console.log('antes: netWorth', before.nw, '| tx', before.tx);

  // Borrar solo los movimientos
  const A = await page.evaluate(() => {
    openResetOptions();
    document.getElementById('rs-mov').click();
    return {
      nw: netWorth(), tx: DB.transactions.length, opening: DB.accounts[0].opening,
      debts: DB.debts.length, payKept: DB.debts[0].payments.length, payTxId: DB.debts[0].payments[0].txId,
      goals: DB.goals.length, goalSaved: DB.goals[0].saved, budget: DB.budgets.Comida
    };
  });
  console.log('tras borrar movimientos:', JSON.stringify(A));

  // Ahora borrar todo
  const B = await page.evaluate(() => {
    openResetOptions();
    document.getElementById('rs-all').click();
    return { tx: DB.transactions.length, debts: DB.debts.length, goals: DB.goals.length, accounts: DB.accounts.length, budgetKeys: Object.keys(DB.budgets).length };
  });
  console.log('tras borrar todo:', JSON.stringify(B));

  const ok = errs.length === 0 &&
    before.nw === 130000 && before.tx === 2 &&
    // solo movimientos: saldo conservado (opening = 130000), sin tx, deuda y pago intactos (txId suelto), metas y presupuesto intactos
    A.nw === 130000 && A.tx === 0 && A.opening === 130000 &&
    A.debts === 1 && A.payKept === 1 && A.payTxId === undefined &&
    A.goals === 1 && A.goalSaved === 30000 && A.budget === 60000 &&
    // todo: nada queda
    B.tx === 0 && B.debts === 0 && B.goals === 0 && B.accounts === 0 && B.budgetKeys === 0;
  console.log('\nERRORS:', errs.length ? errs : 'none');
  console.log(ok ? '\n✅ ALL PASS' : '\n❌ FAIL');
  await b.close(); server.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
