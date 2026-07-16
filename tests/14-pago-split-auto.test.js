/* El pago de una deuda reparte interés/capital:
   (1) con tasa pero SIN cuota mensual, el interés se sugiere al escribir el monto;
   (2) SIN tasa, los campos aparecen igual para repartir a mano.
   Caso real del usuario: ₡20.000 => ₡8.300 interés + ₡11.700 capital. */
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
    localStorage.setItem('mi_norte_data_v2', JSON.stringify({
      settings: { currency: 'CRC', decimals: 'auto', locale: 'es-CR', gate: false },
      accounts: [], transactions: [], budgets: [], recurring: [], goals: [],
      debts: [
        // tasa 40% anual, SIN cuota mensual -> saldo 249000, interés mensual ~8300
        { id: 'card', name: 'Tarjeta', dir: 'owe', principal: 249000, rate: 40, ratePeriod: 'anual', dueDate: '', payments: [] },
        // SIN tasa
        { id: 'plain', name: 'Préstamo simple', dir: 'owe', principal: 100000, rate: 0, ratePeriod: 'anual', dueDate: '', payments: [] }
      ], categories: {}
    }));
  });
  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForFunction(() => document.querySelector('#screen') && document.querySelector('#screen').children.length > 0);

  const type = (id, val) => page.evaluate(({ id, val }) => {
    const el = document.getElementById(id); el.value = String(val); el.dispatchEvent(new Event('input', { bubbles: true }));
  }, { id, val });

  // (1) tasa sin cuota: abrir, escribir 20000 => interés auto 8300, capital 11700
  await page.evaluate(() => openDebtPayment('card'));
  await page.waitForSelector('#dp-amt');
  await type('dp-amt', 20000);
  const A = await page.evaluate(() => ({ int: +document.getElementById('dp-int').value, cap: +document.getElementById('dp-cap').value }));
  await page.evaluate(() => document.getElementById('dp-save').click());
  const Asaved = await page.evaluate(() => { const d = DB.debts.find(x => x.id === 'card'); const p = d.payments[0]; return { interest: p.interest, capital: p.capital, balance: debtBalance(d) }; });
  console.log('(1) tasa sin cuota:', JSON.stringify(A), '| guardado', JSON.stringify(Asaved));

  // (2) sin tasa: el campo interés existe; repartir a mano 8300/11700
  const hasIntField = await page.evaluate(() => { openDebtPayment('plain'); return !!document.getElementById('dp-int'); });
  await page.waitForSelector('#dp-amt');
  await type('dp-amt', 20000);
  await type('dp-int', 8300);
  const B = await page.evaluate(() => ({ cap: +document.getElementById('dp-cap').value }));
  await page.evaluate(() => document.getElementById('dp-save').click());
  const Bsaved = await page.evaluate(() => { const d = DB.debts.find(x => x.id === 'plain'); const p = d.payments[0]; return { interest: p.interest, capital: p.capital, balance: debtBalance(d) }; });
  console.log('(2) sin tasa:', 'campo?', hasIntField, '| cap', B.cap, '| guardado', JSON.stringify(Bsaved));

  const ok = errs.length === 0 &&
    A.int === 8300 && A.cap === 11700 && Asaved.interest === 8300 && Asaved.capital === 11700 && Asaved.balance === 249000 - 11700 &&
    hasIntField === true && B.cap === 11700 && Bsaved.interest === 8300 && Bsaved.capital === 11700 && Bsaved.balance === 100000 - 11700;
  console.log('\nERRORS:', errs.length ? errs : 'none');
  console.log(ok ? '\n✅ ALL PASS' : '\n❌ FAIL');
  await b.close(); server.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
