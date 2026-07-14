const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = require('path').join(__dirname, '..');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.webmanifest':'application/manifest+json','.png':'image/png' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  fs.readFile(fp, (e, d) => { if (e) { res.writeHead(404); res.end(); } else { res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'text/plain' }); res.end(d); } });
});

const BAC_CSV = `Reporte BAC para el cliente JEAUSTI M,,,,
Cuenta,CR12345678901234567890,,,
Periodo,01/06/2026 - 30/06/2026,,,
,,,,
Fecha,Referencia,Descripción,Débito,Crédito,Saldo
01/06/2026,000123,PAGO SERVICIOS,15000.00,,485000.00
03/06/2026,000124,DEPOSITO SALARIO,,500000.00,985000.00
05/06/2026,000125,SUPERMERCADO XYZ,32500.50,,952499.50`;

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await b.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

  await page.addInitScript(() => {
    const h = Date.prototype.getHours; Date.prototype.getHours = function(){ return 12; };
    localStorage.setItem('mi_norte_data_v2', JSON.stringify({
      settings: { currency: 'CRC', decimals: 'auto', locale: 'es-CR', theme: 'aurora' },
      accounts: [{ id: 'a1', name: 'Cuenta BAC', balance: 500000, type: 'bank' }],
      transactions: [], budgets: [], recurring: [], goals: [],
      debts: [{ id: 'd1', name: 'Préstamo carro', party: 'Banco', dir: 'owe', principal: 100000, rate: 0, ratePeriod: 'anual', dueDate: '', note: '', payments: [{ id: 'p1', date: new Date().toISOString(), amount: 20000, account: 'a1', txId: null }] }],
      categories: {}
    }));
  });

  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForFunction(() => document.querySelector('#screen') && document.querySelector('#screen').children.length > 0);

  // 1) Más tab navigation (esperamos el selector específico del hub de Más,
  //    porque el inicio también usa .hub-row en "Cómo vas"). Reintentamos el
  //    click por si cae durante un re-render/layout (evita flaky de timing).
  for (let i = 0; i < 5; i++) {
    await page.click('[data-tab="more"]');
    try { await page.waitForSelector('#hub-deudas', { timeout: 2000 }); break; }
    catch (e) { if (i === 4) throw e; }
  }
  const hubCount = await page.$$eval('.hub-row', els => els.length);
  const hubRowStyled = await page.$eval('.hub', el => getComputedStyle(el).borderRadius);
  console.log('MORE tab hub-rows:', hubCount, 'radius:', hubRowStyled);

  // open Deudas from hub
  await page.click('#hub-deudas');
  await page.waitForSelector('[data-d-hist]');
  await page.click('[data-d-hist]');
  await page.waitForSelector('[data-p-del]');
  const payShown = await page.$$eval('[data-p-del]', e => e.length);
  console.log('Payment history entries:', payShown);
  await page.evaluate(() => closeSheet());

  // 2) CSV parser: BAC preamble
  const parseResult = await page.evaluate((csv) => {
    const parsed = parseCSV(csv);
    const hi = detectHeaderRow(parsed);
    const headers = parsed[hi];
    const rows = parsed.slice(hi + 1);
    return { totalRows: parsed.length, headerIndex: hi, headers, firstDataRow: rows[0], dataRows: rows.length };
  }, BAC_CSV);
  console.log('CSV headerIndex:', parseResult.headerIndex);
  console.log('CSV headers:', JSON.stringify(parseResult.headers));
  console.log('CSV firstDataRow:', JSON.stringify(parseResult.firstDataRow));
  console.log('CSV dataRows:', parseResult.dataRows);

  // 3) money/date parse on BAC values
  const mp = await page.evaluate(() => ({
    m1: parseMoneyLoose('15000.00'),
    m2: parseMoneyLoose('500000.00'),
    d1: parseDateLoose('01/06/2026', 'dmy')
  }));
  console.log('money/date:', JSON.stringify(mp));

  const ok = errs.length === 0 && hubCount >= 2 && payShown === 1 &&
    parseResult.headers[0] === 'Fecha' && parseResult.headers.length === 6 && parseResult.dataRows === 3;
  console.log('ERRORS:', errs.length ? errs : 'none');
  console.log(ok ? '\n✅ ALL PASS' : '\n❌ FAIL');
  await b.close(); server.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
