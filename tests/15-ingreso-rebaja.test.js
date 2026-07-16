/* Ingreso de salario con rebaja/deducción documentada dentro del ingreso:
   el neto (bruto − rebaja) es lo que entra; la rebaja queda detallada, no como
   un gasto aparte. Caso: bruto ₡400.000 − rebaja ₡11.700 = ₡388.300. */
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
    Date.prototype.getHours = function () { return 12; };
    const iso = d => new Date(2026, 6, d, 12).toISOString();
    localStorage.setItem('mi_norte_data_v2', JSON.stringify({
      settings: { currency: 'CRC', decimals: 'auto', locale: 'es-CR', gate: false },
      accounts: [{ id: 'a1', name: 'BAC', kind: 'banco', opening: 0 }],
      // un salario ya registrado sin rebaja, para probar la edición
      transactions: [{ id: 'sal', date: iso(1), type: 'income', amount: 400000, category: 'Salario', account: 'a1' }],
      budgets: [], recurring: [], goals: [], debts: [], categories: { expense: ['Otro'], income: ['Salario'] }
    }));
  });
  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForFunction(() => document.querySelector('#screen') && document.querySelector('#screen').children.length > 0);
  const setV = (id, v) => page.evaluate(({ id, v }) => { const el = document.getElementById(id); el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, { id, v });

  // 1) Nuevo ingreso con rebaja: bruto 400000, rebaja 11700 -> neto 388300
  await page.evaluate(() => openTx('income'));
  await page.waitForSelector('#tx-ded');
  await setV('tx-amt', 400000); await setV('tx-ded', 11700); await setV('tx-ded-note', 'préstamo');
  const info = await page.evaluate(() => document.getElementById('tx-ded-info').textContent);
  await page.evaluate(() => document.getElementById('tx-save').click());
  const A = await page.evaluate(() => {
    const t = DB.transactions.find(x => x.category === 'Salario' && x.id !== 'sal');
    return { amount: t.amount, deduction: t.deduction, note: t.deductionNote, type: t.type,
      income: monthTotals('2026-07').income, expense: monthTotals('2026-07').expense };
  });
  console.log('nuevo:', JSON.stringify(A), '| info:', info);

  // 2) Editar el salario existente (400000 sin rebaja): el form muestra bruto y al poner rebaja baja el neto
  const grossShown = await page.evaluate(() => { openTx('income', 'sal'); return +document.getElementById('tx-amt').value; });
  await page.waitForSelector('#tx-ded');
  await setV('tx-ded', 20000);
  await page.evaluate(() => document.getElementById('tx-save').click());
  const B = await page.evaluate(() => { const t = DB.transactions.find(x => x.id === 'sal'); return { amount: t.amount, deduction: t.deduction }; });
  console.log('editado: grossShown', grossShown, '| ', JSON.stringify(B));

  // 3) La fila del movimiento muestra la rebaja
  const rowHasRebaja = await page.evaluate(() => { currentTab = 'money'; render(); return /rebaja/i.test(document.querySelector('#screen').innerText); });
  console.log('fila muestra rebaja:', rowHasRebaja);

  // 4) Quitar la rebaja al editar limpia los campos
  await page.evaluate(() => openTx('income', 'sal'));
  await page.waitForSelector('#tx-ded');
  await setV('tx-ded', 0);
  await page.evaluate(() => document.getElementById('tx-save').click());
  const C = await page.evaluate(() => { const t = DB.transactions.find(x => x.id === 'sal'); return { amount: t.amount, hasDed: 'deduction' in t }; });
  console.log('rebaja quitada:', JSON.stringify(C));

  const ok = errs.length === 0 &&
    A.amount === 388300 && A.deduction === 11700 && A.note === 'préstamo' && A.type === 'income' &&
    A.income === 400000 + 388300 && A.expense === 0 && /388\s?300/.test(info) &&
    grossShown === 400000 && B.amount === 380000 && B.deduction === 20000 &&
    rowHasRebaja === true &&
    C.amount === 400000 && C.hasDed === false;
  console.log('\nERRORS:', errs.length ? errs : 'none');
  console.log(ok ? '\n✅ ALL PASS' : '\n❌ FAIL');
  await b.close(); server.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
