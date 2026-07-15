/* Cerrar hojas deslizando hacia abajo (estilo iPhone):
   arrastre grande => se cierra; arrastre corto => regresa. */
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
  page.on('pageerror', e => errs.push(e.message));

  await page.addInitScript(() => {
    Date.prototype.getHours = function () { return 12; };
    localStorage.setItem('mi_norte_data_v2', JSON.stringify({
      settings: { currency: 'CRC', decimals: 'auto', locale: 'es-CR', gate: false },
      accounts: [{ id: 'a1', name: 'BAC', kind: 'banco', opening: 100000 }],
      transactions: [], budgets: [], goals: [], recurring: [], debts: [], categories: {}
    }));
  });
  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForFunction(() => document.querySelector('#screen') && document.querySelector('#screen').children.length > 0);

  // helper de arrastre táctil sobre la hoja
  const drag = (fromY, toY) => page.evaluate(({ fromY, toY }) => {
    const sheet = document.querySelector('.sheet'); if (!sheet) return -1;
    const fire = (type, y) => {
      const t = new Touch({ identifier: 1, target: sheet, clientX: 150, clientY: y });
      sheet.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true }));
    };
    fire('touchstart', fromY);
    const steps = 8;
    for (let i = 1; i <= steps; i++) fire('touchmove', fromY + (toY - fromY) * i / steps);
    fire('touchend', toY);
    return 1;
  }, { fromY, toY });

  // 1) arrastre corto (30px) => la hoja regresa (sigue abierta)
  await page.evaluate(() => openSheet('<h2>Prueba</h2><div class="hint">Contenido</div>'));
  await page.waitForSelector('.sheet');
  await drag(120, 150);
  await new Promise(r => setTimeout(r, 400));
  const afterShort = await page.$$eval('.sheet', els => els.length);
  console.log('Tras arrastre corto (30px): hojas =', afterShort, '(esperado 1, sigue abierta)');

  // 2) arrastre largo (320px) => la hoja se cierra
  await drag(120, 440);
  await new Promise(r => setTimeout(r, 400));
  const afterLong = await page.$$eval('.sheet', els => els.length);
  console.log('Tras arrastre largo (320px): hojas =', afterLong, '(esperado 0, cerrada)');

  const ok = errs.length === 0 && afterShort === 1 && afterLong === 0;
  console.log('\nERRORS:', errs.length ? errs : 'none');
  console.log(ok ? '\n✅ ALL PASS' : '\n❌ FAIL');
  await b.close(); server.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
