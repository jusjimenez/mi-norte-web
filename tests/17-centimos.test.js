/* Céntimos/decimales: se pueden escribir (coma o punto), se guardan sin
   redondear, y "Automático" los muestra solo cuando existen. */
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
      accounts: [{ id: 'a1', name: 'BAC', kind: 'banco', opening: 23500.67 }],
      transactions: [], budgets: [], recurring: [], goals: [], debts: [], categories: { expense: ['Otro'], income: ['Salario'] }
    }));
  });
  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForFunction(() => document.querySelector('#screen') && document.querySelector('#screen').children.length > 0);

  // Formato en "auto": céntimos solo cuando existen
  const f = await page.evaluate(() => ({
    conCent: fmt(23500.67), entero: fmt(1000), nw: netWorth(),
    dos: (() => { DB.settings.decimals = 2; const v = fmt(1000); DB.settings.decimals = 'auto'; return v; })(),
    cero: (() => { DB.settings.decimals = 0; const v = fmt(23500.67); DB.settings.decimals = 'auto'; return v; })()
  }));
  console.log('auto conCent:', f.conCent, '| auto entero:', f.entero, '| nw:', f.nw);
  console.log('2 dec de 1000:', f.dos, '| 0 dec de 23500.67:', f.cero);

  // Entrada con coma decimal: se guarda sin redondear
  const saved = await page.evaluate(() => {
    openTx('income');
    const a = document.getElementById('tx-amt'); a.value = '100,67'; a.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('tx-save').click();
    const t = DB.transactions[DB.transactions.length - 1];
    return { amount: t.amount, nw: netWorth() };
  });
  console.log('ingreso 100,67 guardado:', JSON.stringify(saved));

  // parseAmount tolerante a formatos locales
  const pa = await page.evaluate(() => ({
    a: parseAmount('23.500,67'), b: parseAmount('23500,67'), c: parseAmount('23500.67'),
    d: parseAmount('1.000'), e: parseAmount('1,000.50'), f: parseAmount('23,5'), g: parseAmount('₡ 1.234.567')
  }));
  console.log('parseAmount:', JSON.stringify(pa));

  // el separador de miles varía por plataforma (punto o espacio): usamos "." sin escapar
  const ok = errs.length === 0 &&
    /23.500,67/.test(f.conCent) && !/,/.test(f.entero) && /1.000/.test(f.entero) &&
    Math.abs(f.nw - 23500.67) < 0.001 &&
    /1.000,00/.test(f.dos) && /23.50[01]/.test(f.cero) && !/,/.test(f.cero) &&
    saved.amount === 100.67 && Math.abs(saved.nw - (23500.67 + 100.67)) < 0.001 &&
    pa.a === 23500.67 && pa.b === 23500.67 && pa.c === 23500.67 && pa.d === 1000 &&
    pa.e === 1000.5 && pa.f === 23.5 && pa.g === 1234567;
  console.log('\nERRORS:', errs.length ? errs : 'none');
  console.log(ok ? '\n✅ ALL PASS' : '\n❌ FAIL');
  await b.close(); server.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
