const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = require('path').join(__dirname, '..');
const FIX = require('path').join(__dirname, 'fixtures');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.webmanifest':'application/manifest+json','.png':'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  fs.readFile(fp, (e, d) => { if (e) { res.writeHead(404); res.end(); } else { res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'text/plain' }); res.end(d); } });
});

const PIPE = fs.readFileSync(FIX + '/estado-bac-pipe.csv', 'utf8');
const TAB = fs.readFileSync(FIX + '/estado-bac-tab.txt', 'utf8');

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await b.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  await page.addInitScript(() => { Date.prototype.getHours = function(){ return 12; }; });
  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForFunction(() => document.querySelector('#screen') && document.querySelector('#screen').children.length > 0);

  const runFile = (label, csv) => page.evaluate(({ label, csv }) => {
    const parsed = parseCSV(csv);
    const hi = detectHeaderRow(parsed);
    const headers = parsed[hi];
    const hcols = headers.length;
    const rows = parsed.slice(hi + 1).filter(r => r.length >= Math.max(2, hcols - 1));
    // emulate autodetect
    const h = headers.map(x => String(x || '').toLowerCase());
    const find = kw => h.findIndex(x => kw.some(k => x.includes(k)));
    const dateC = find(['fecha','date']);
    const deStrong = find(['descrip','concepto','detalle','glosa','movimiento','comercio']);
    const descC = deStrong >= 0 ? deStrong : find(['referencia','transacc']);
    const debC = find(['débito','debito','cargo']);
    const credC = find(['crédito','credito','abono']);
    // sum debits/credits parsed
    let sumDeb = 0, sumCred = 0, badDates = 0;
    rows.forEach(r => {
      sumDeb += parseMoneyLoose(r[debC]) || 0;
      sumCred += parseMoneyLoose(r[credC]) || 0;
      if (!parseDateLoose(r[dateC], 'auto')) badDates++;
    });
    return { label, headerIndex: hi, headers, cols: hcols, dataRows: rows.length,
      map: { dateC, descC, debC, credC }, sumDeb, sumCred, badDates,
      sampleDesc: rows[0] ? rows[0][descC] : null, sampleDate: rows[0] ? parseDateLoose(rows[0][dateC],'auto') : null };
  }, { label, csv });

  const pipe = await runFile('PIPE csv', PIPE);
  const tab = await runFile('TAB txt', TAB);
  for (const r of [pipe, tab]) {
    console.log(`\n== ${r.label} ==`);
    console.log('headerIndex:', r.headerIndex, 'cols:', r.cols, 'dataRows:', r.dataRows);
    console.log('headers:', JSON.stringify(r.headers));
    console.log('map (date,desc,deb,cred):', JSON.stringify(r.map));
    console.log('sumDebit:', r.sumDeb, 'sumCredit:', r.sumCred, 'badDates:', r.badDates);
    console.log('sample desc:', r.sampleDesc, '| sample date:', r.sampleDate);
  }

  // Fixture: 5 filas de datos, créditos 5307 + 10500 = 15807.
  
  const ok = errs.length === 0 &&
    pipe.dataRows === 5 && tab.dataRows === 5 &&
    pipe.map.dateC === 0 && pipe.map.debC === 4 && pipe.map.credC === 5 && pipe.map.descC === 3 &&
    tab.map.dateC === 0 && tab.map.debC === 4 && tab.map.credC === 5 && tab.map.descC === 3 &&
    pipe.badDates === 0 && tab.badDates === 0 &&
    Math.round(pipe.sumCred) === 15807 && Math.round(tab.sumCred) === 15807;
  console.log('\nERRORS:', errs.length ? errs : 'none');
  console.log(ok ? '\n✅ ALL PASS' : '\n❌ FAIL');
  await b.close(); server.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
