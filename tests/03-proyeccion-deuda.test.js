const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = require('path').join(__dirname, '..');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.webmanifest':'application/manifest+json','.png':'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (e, d) => { if (e) { res.writeHead(404); res.end(); } else { res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'text/plain' }); res.end(d); } });
});

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await b.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  await page.addInitScript(() => {
    Date.prototype.getHours = function(){ return 12; };
    localStorage.setItem('mi_norte_data_v2', JSON.stringify({
      settings: { currency: 'CRC', decimals: 'auto', locale: 'es-CR', theme: 'aurora' },
      accounts: [], transactions: [], budgets: [], recurring: [], goals: [],
      debts: [
        { id: 'd1', name: 'Préstamo carro', dir: 'owe', principal: 100000, rate: 12, ratePeriod: 'anual', monthly: 10000, dueDate: '', payments: [] },
        { id: 'd2', name: 'Sin interés', dir: 'owe', principal: 60000, rate: 0, ratePeriod: 'anual', monthly: 20000, dueDate: '', payments: [{ id:'p', amount: 20000 }] },
        { id: 'd3', name: 'Cuota muy baja', dir: 'owe', principal: 100000, rate: 24, ratePeriod: 'anual', monthly: 500, dueDate: '', payments: [] }
      ],
      categories: {}
    }));
  });
  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForFunction(() => document.querySelector('#screen') && document.querySelector('#screen').children.length > 0);

  const proj = await page.evaluate(() => ({
    d1: debtProjection(DB.debts[0]),   // 100000 @12% anual, 10000/mo
    d2: debtProjection(DB.debts[1]),   // 60000, paid 20000 -> bal 40000, 0%, 20000/mo => 2 months, total 40000
    d3: debtProjection(DB.debts[2]),   // cuota 500 < interes mensual -> never
    fmt5: fmtMonths(5), fmt12: fmtMonths(12), fmt14: fmtMonths(14), fmt1: fmtMonths(1)
  }));
  console.log('d1 (100k@12%,10k/mo):', JSON.stringify(proj.d1));
  console.log('d2 (bal40k,0%,20k/mo):', JSON.stringify(proj.d2));
  console.log('d3 (never):', JSON.stringify(proj.d3));
  console.log('fmtMonths:', proj.fmt1, '|', proj.fmt5, '|', proj.fmt12, '|', proj.fmt14);

  // Render debts sheet, verify projection appears and no errors
  const sheet = await page.evaluate(() => {
    openDebts();
    const el = document.getElementById('sheet-root');
    return { projRows: el.querySelectorAll('.proj-row').length, warns: el.querySelectorAll('.proj-warn').length };
  });
  const projRows = sheet.projRows, warnShown = sheet.warns;
  console.log('proj-rows in sheet:', projRows, 'warnings:', warnShown);

  // Open form, verify live projection recalculates on input
  const formProj = await page.evaluate(() => { closeSheet(); openDebtForm('d1'); return document.getElementById('d-proj').textContent.trim().length > 0; });
  console.log('form live projection non-empty:', formProj);

  const ok = errs.length === 0 &&
    proj.d1.months === 11 &&                        // ~10.6 -> 11 months
    Math.round(proj.d1.totalPay) >= 105000 && Math.round(proj.d1.totalPay) <= 106500 &&
    proj.d1.totalInterest > 5000 && proj.d1.totalInterest < 7000 &&
    proj.d2.months === 2 && Math.round(proj.d2.totalPay) === 40000 && Math.round(proj.d2.totalInterest) === 0 &&
    proj.d3.never === true &&
    proj.fmt14 === '1 año y 2 meses' && proj.fmt12 === '1 año' && proj.fmt1 === '1 mes' &&
    projRows >= 2 && warnShown === 1 && formProj === true;
  console.log('\nERRORS:', errs.length ? errs : 'none');
  console.log(ok ? '\n✅ ALL PASS' : '\n❌ FAIL');
  await b.close(); server.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
