const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = require('path').join(__dirname, '..');
const FIX = require('path').join(__dirname, 'fixtures');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.webmanifest':'application/manifest+json','.png':'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (e, d) => { if (e) { res.writeHead(404); res.end(); } else { res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'text/plain' }); res.end(d); } });
});
const PIPE = fs.readFileSync(FIX + '/estado-bac-pipe.csv', 'utf8');

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
      settings: { currency: 'CRC', decimals: 'auto', locale: 'es-CR' },
      // "Tarjeta" account with a wrong/arbitrary opening (mimics user's situation)
      accounts: [{ id: 'tar', name: 'Tarjeta', kind: 'banco', opening: 34825 }],
      transactions: [], budgets: [], recurring: [], goals: [], debts: [], categories: {}
    }));
  });
  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForFunction(() => document.querySelector('#screen') && document.querySelector('#screen').children.length > 0);

  const result = await page.evaluate((csv) => {
    // Simulate the full reconcile flow programmatically.
    openReconcile();
    reconState.account = 'tar';
    const parsed = parseCSV(csv);
    const hi = detectHeaderRow(parsed);
    reconState.headers = parsed[hi];
    const hcols = reconState.headers.length;
    reconState.rows = parsed.slice(hi + 1).filter(r => r.length >= Math.max(2, hcols - 1));
    autodetectMap(reconState.headers);
    reconState.bankBalance = detectBankBalance();
    const autoBal = reconState.bankBalance;
    runReconcile();
    const before = { bankOnly: reconState.result.bankOnly.length, appBalStart: accountBalance('tar') };
    // Add all bank movements (as the user did)
    reconState.result.bankOnly.forEach(addBankItem);
    save(); runReconcile();
    const afterAdd = accountBalance('tar');
    // Now adjust to bank balance
    const a = DB.accounts.find(x => x.id === 'tar');
    a.opening = (a.opening || 0) + (reconState.result.bankBalance - accountBalance('tar'));
    save(); runReconcile();
    const afterAdjust = accountBalance('tar');
    return { autoBal, before, afterAdd, afterAdjust, bankBalance: reconState.result.bankBalance,
      calzaDiff: reconState.result.bankBalance - afterAdjust, matched: reconState.result.matched.length };
  }, PIPE);

  console.log('auto-detected bank balance:', result.autoBal);
  console.log('bankBalance in result:', result.bankBalance);
  console.log('bankOnly imported:', result.before.bankOnly);
  console.log('account balance after adding all movements:', result.afterAdd);
  console.log('account balance after adjust:', result.afterAdjust);
  console.log('remaining diff vs bank:', result.calzaDiff);

  const ok = errs.length === 0 &&
    Math.round(result.autoBal) === 9181 &&           // 9180.55 -> current bank balance
    Math.abs(result.afterAdjust - 9180.55) < 0.5 &&  // account now equals bank exactly
    Math.abs(result.calzaDiff) < 0.5;
  console.log('\nERRORS:', errs.length ? errs : 'none');
  console.log(ok ? '\n✅ ALL PASS' : '\n❌ FAIL');
  await b.close(); server.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
