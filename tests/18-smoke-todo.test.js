/* Smoke test: recorre TODAS las pestañas y abre TODAS las hojas con datos ricos,
   detectando cualquier error de runtime (pageerror / console.error) o hoja que
   no abra. Es la red de seguridad de "el sistema está sano". */
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
  const ctx = await b.newContext({ hasTouch: true, viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errs.push('CONSOLE ' + m.text()); });

  await page.addInitScript(() => {
    Date.prototype.getHours = function () { return 12; };
    const iso = d => new Date(2026, 6, d, 12).toISOString();
    localStorage.setItem('mi_norte_data_v2', JSON.stringify({
      settings: { currency: 'CRC', decimals: 'auto', locale: 'es-CR', gate: false, savingsGoal: 20, payCycle: { freq: 'quincenal', anchor: '2026-07-01' } },
      accounts: [{ id: 'a1', name: 'BAC', kind: 'banco', opening: 23500.67 }, { id: 'a2', name: 'Efectivo', kind: 'efectivo', opening: 5000 }, { id: 'a3', name: 'Tarjeta', kind: 'tarjeta', opening: 0 }],
      transactions: [
        { id: 'i1', date: iso(1), type: 'income', amount: 388300, category: 'Salario', account: 'a1', deduction: 11700, deductionNote: 'préstamo' },
        { id: 'e1', date: iso(3), type: 'expense', amount: 12500.50, category: 'Comida', account: 'a1' },
        { id: 'e2', date: iso(9), type: 'expense', amount: 8000, category: 'Transporte', account: 'a2' },
        { id: 'tr', date: iso(5), type: 'transfer', amount: 10000, from: 'a1', to: 'a2' }
      ],
      budgets: { Comida: 60000, Transporte: 20000 },
      goals: [{ id: 'g1', name: 'Fondo', target: 300000, saved: 90000, freq: 'quincenal', createdAt: iso(1), targetDate: new Date(2026, 11, 1, 12).toISOString() }],
      recurring: [{ id: 'r1', type: 'expense', amount: 35000, category: 'Luz', day: 20, account: 'a1' }, { id: 'r2', type: 'income', amount: 388300, category: 'Salario', day: 1, account: 'a1' }],
      debts: [{ id: 'd1', name: 'Tarjeta BAC', dir: 'owe', principal: 400000, rate: 40, ratePeriod: 'anual', monthly: 30000, dueDate: iso(25), payments: [{ id: 'p1', date: iso(2), amount: 30000, interest: 13000, capital: 17000, txId: null }] }, { id: 'd2', name: 'Me deben', dir: 'owed', principal: 50000, rate: 0, ratePeriod: 'anual', monthly: 0, dueDate: '', payments: [] }],
      categories: { expense: ['Comida', 'Transporte', 'Luz'], income: ['Salario'] }
    }));
  });
  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForFunction(() => document.querySelector('#screen') && document.querySelector('#screen').children.length > 0);

  // 1) Todas las pestañas renderizan
  const tabResults = {};
  for (const tab of ['home', 'money', 'reports', 'more', 'settings', 'home']) {
    await page.click(`[data-tab="${tab}"]`); await new Promise(r => setTimeout(r, 120));
    tabResults[tab] = await page.evaluate(() => document.querySelector('#screen').children.length > 0);
  }
  console.log('Pestañas OK:', JSON.stringify(tabResults));

  // 2) Cada hoja abre sin error (se llama y se verifica que .sheet exista, luego se cierra)
  const openers = [
    "openAccounts()", "openTx('income')", "openTx('expense')", "openTx('income','i1')",
    "openTransfer()", "openDebts()", "openDebtForm()", "openDebtForm('d1')",
    "openDebtPayment('d1')", "openDebtHistory('d1')", "openGoals()", "openGoalForm('g1')",
    "openGoalContribution('g1')", "openBudgets()", "openRecurring()", "openCategories('expense')",
    "openCategories('income')", "openReconcile()", "openHealth()", "openSimulator()",
    "openResetOptions()", "openUpcoming()", "openEncryptedExport()", "openHelp('patrimonio')"
  ];
  const failed = [];
  for (const call of openers) {
    const ok = await page.evaluate((c) => {
      try { closeSheet(); eval(c); return !!document.querySelector('.sheet') || !!document.querySelector('#sheet-root').children.length; }
      catch (e) { return 'ERR: ' + e.message; }
    }, call);
    if (ok !== true) failed.push(`${call} -> ${ok}`);
    await page.evaluate(() => closeSheet());
  }
  console.log('Hojas que fallaron:', failed.length ? failed : 'ninguna');

  // 3) Informe PDF (buildReportHTML) y CSV no lanzan
  const reportOk = await page.evaluate(() => {
    try { const h = buildReportHTML(reportContext()); return typeof h === 'string' && h.length > 100; }
    catch (e) { return 'ERR: ' + e.message; }
  });
  console.log('buildReportHTML:', reportOk);

  const ok = errs.length === 0 && Object.values(tabResults).every(Boolean) && failed.length === 0 && reportOk === true;
  console.log('\nERRORS:', errs.length ? errs : 'none');
  console.log(ok ? '\n✅ ALL PASS' : '\n❌ FAIL');
  await b.close(); server.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
