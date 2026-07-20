/* Integración con Atajos/Apple Pay:
   (1) "Registrar pago copiado": lee MINORTE|monto|comercio del portapapeles y
       abre el gasto pre-llenado;
   (2) apertura por URL ?monto=…&nota=… pre-llena y limpia la URL. */
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
  const ctx = await b.newContext();
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://localhost:${port}` });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));

  const seed = () => {
    localStorage.setItem('mi_norte_data_v2', JSON.stringify({
      settings: { currency: 'CRC', decimals: 'auto', locale: 'es-CR', gate: false },
      accounts: [{ id: 'a1', name: 'BAC', kind: 'banco', opening: 100000 }],
      transactions: [], budgets: [], recurring: [], goals: [], debts: [], categories: { expense: ['Comida', 'Otro'], income: ['Salario'] }
    }));
  };
  await page.addInitScript(seed);

  // (1) botón "Registrar pago copiado"
  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForFunction(() => document.querySelector('#screen') && document.querySelector('#screen').children.length > 0);
  const hasBtn = await page.evaluate(() => !!document.getElementById('h-paste'));
  await page.evaluate(() => navigator.clipboard.writeText('MINORTE|₡1.500,75|Starbucks'));
  await page.click('#h-paste');
  await page.waitForSelector('#tx-amt');
  const A = await page.evaluate(() => ({ amt: document.getElementById('tx-amt').value, note: document.getElementById('tx-note').value, title: document.querySelector('.sheet h2').textContent }));
  console.log('clipboard:', 'btn?', hasBtn, JSON.stringify(A));
  // guardar y verificar
  await page.evaluate(() => document.getElementById('tx-save').click());
  const Asaved = await page.evaluate(() => { const t = DB.transactions[DB.transactions.length - 1]; return { amount: t.amount, note: t.note, type: t.type }; });
  console.log('guardado:', JSON.stringify(Asaved));

  // parser: formatos inválidos no disparan
  const P = await page.evaluate(() => ({
    bad1: parseSharedPayment('hola mundo'), bad2: parseSharedPayment('MINORTE|abc|x'),
    ok: parseSharedPayment('minorte|2000|Uber'),
    // transacción entera como texto (sin poder separar importe/comercio en Atajos)
    free1: parseSharedPayment('MINORTE|AUTOMERCADO ₡5.200,00'),
    free2: parseSharedPayment('MINORTE|₡1.500,75\nStarbucks San José'),
    free3: parseSharedPayment('MINORTE|AM PM 24 CRC 3.000,00'),
    free4: parseSharedPayment('MINORTE|Uber 2500'),
    // con fecha/hora ISO al final (la fecha no se confunde con el monto)
    fecha1: parseSharedPayment('MINORTE|AUTOMERCADO ₡5.200,00|2026-07-20T16:52:00'),
    fecha2: parseSharedPayment('MINORTE|Uber 2500 2026-07-20 16:52')
  }));
  console.log('parser:', JSON.stringify(P));

  // pre-llenado de fecha/hora en el formulario
  const F = await page.evaluate(() => {
    closeSheet();
    openTx('expense', null, { amount: 5200, note: 'AUTOMERCADO', date: '2026-07-20T16:52:00' });
    return { d: document.getElementById('tx-date').value, t: document.getElementById('tx-time').value };
  });
  console.log('form fecha/hora:', JSON.stringify(F));
  await page.evaluate(() => closeSheet());

  // (2) apertura por URL
  const p2 = await ctx.newPage();
  p2.on('pageerror', e => errs.push('P2 ' + e.message));
  await p2.addInitScript(seed);
  await p2.goto(`http://localhost:${port}/index.html?monto=8500,50&nota=Farmacia`);
  await p2.waitForSelector('#tx-amt', { timeout: 5000 });
  const B = await p2.evaluate(() => ({ amt: document.getElementById('tx-amt').value, note: document.getElementById('tx-note').value, url: location.search }));
  console.log('URL:', JSON.stringify(B));

  const ok = errs.length === 0 && hasBtn &&
    +A.amt === 1500.75 && A.note === 'Starbucks' && /gasto/i.test(A.title) &&
    Asaved.amount === 1500.75 && Asaved.note === 'Starbucks' && Asaved.type === 'expense' &&
    P.bad1 === null && P.bad2 === null && P.ok && P.ok.amount === 2000 && P.ok.note === 'Uber' &&
    P.free1 && P.free1.amount === 5200 && /AUTOMERCADO/.test(P.free1.note) &&
    P.free2 && P.free2.amount === 1500.75 && /Starbucks/.test(P.free2.note) &&
    P.free3 && P.free3.amount === 3000 && /AM PM/.test(P.free3.note) &&
    P.free4 && P.free4.amount === 2500 && /Uber/.test(P.free4.note) &&
    P.fecha1 && P.fecha1.amount === 5200 && /AUTOMERCADO/.test(P.fecha1.note) && P.fecha1.date.startsWith('2026-07-20') &&
    P.fecha2 && P.fecha2.amount === 2500 && /Uber/.test(P.fecha2.note) && P.fecha2.date.startsWith('2026-07-20') &&
    F.d === '2026-07-20' && F.t === '16:52' &&
    +B.amt.replace(',', '.') === 8500.5 && B.note === 'Farmacia' && B.url === '';
  console.log('\nERRORS:', errs.length ? errs : 'none');
  console.log(ok ? '\n✅ ALL PASS' : '\n❌ FAIL');
  await b.close(); server.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
