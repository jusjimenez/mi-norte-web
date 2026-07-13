const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = require('path').join(__dirname, '..');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.webmanifest':'application/manifest+json','.png':'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (e, d) => { if (e) { res.writeHead(404); res.end(); } else { res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'text/plain' }); res.end(d); } });
});

// Freeze "today" to the 3rd of the current month so we test early-month behavior.
const now = new Date();
const y = now.getFullYear(), m = now.getMonth();
const dim = new Date(y, m + 1, 0).getDate();

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await b.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.addInitScript(({ y, m }) => {
    // Freeze "now" to the 3rd at noon, but only for new Date() with no args,
    // so daysInMonth (new Date(y,m+1,0)) still works correctly.
    const RealDate = Date;
    const fixed = new RealDate(y, m, 3, 12, 0, 0).getTime();
    function FakeDate(...args) {
      if (!(this instanceof FakeDate)) return new RealDate(fixed).toString();
      return args.length === 0 ? new RealDate(fixed) : new RealDate(...args);
    }
    FakeDate.prototype = RealDate.prototype;
    FakeDate.now = () => fixed;
    FakeDate.parse = RealDate.parse; FakeDate.UTC = RealDate.UTC;
    window.Date = FakeDate;
    const iso = (mo, d) => new RealDate(y, mo, d, 12).toISOString();
    // History: 3 prior months averaging ~150k expense/month
    const tx = [];
    for (let k = 1; k <= 3; k++) {
      tx.push({ id: 'h' + k, date: iso(m - k, 10), type: 'expense', amount: 150000, category: 'Varios', account: 'a1' });
    }
    // This month: a big early expense (rent 200k) on day 1
    tx.push({ id: 'rent', date: iso(m, 1), type: 'expense', amount: 200000, category: 'Alquiler', account: 'a1' });
    localStorage.setItem('mi_norte_data_v2', JSON.stringify({
      settings: { currency: 'CRC', decimals: 'auto', locale: 'es-CR' },
      accounts: [{ id: 'a1', name: 'BAC', kind: 'banco', opening: 1000000 }],
      transactions: tx, budgets: [], recurring: [], goals: [], debts: [], categories: {}
    }));
  }, { y, m });
  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForFunction(() => document.querySelector('#screen') && document.querySelector('#screen').children.length > 0);

  const r = await page.evaluate((dim) => {
    const mk = monthKeyOf(new Date());
    const spent = monthTotals(mk).expense;
    const oldLinear = Math.round(spent / 3 * dim);   // what the old formula gave
    const nu = projectionForMonth(mk);               // new blended
    return { spent, dim, oldLinear, nu, histAvg: avgOf('expense') };
  }, dim);
  console.log('días del mes:', r.dim, '· hoy: día 3');
  console.log('gastado este mes (alquiler):', r.spent);
  console.log('promedio histórico mensual:', Math.round(r.histAvg));
  console.log('proyección LINEAL vieja:', r.oldLinear);
  console.log('proyección NUEVA (mezcla):', r.nu);

  // The new projection should be far below the absurd linear one, and in a
  // sane range around history+rent, not millions.
  const ok = errs.length === 0 &&
    r.oldLinear > 1900000 &&            // old formula explodes (~2M+)
    r.nu < r.oldLinear / 3 &&           // new one is far below the linear blow-up
    r.nu > 200000;                      // and at least the rent already spent
  console.log('\nERRORS:', errs.length ? errs : 'none');
  console.log(ok ? '\n✅ ALL PASS' : '\n❌ FAIL');
  await b.close(); server.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
