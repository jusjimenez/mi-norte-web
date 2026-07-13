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
      settings: { currency: 'CRC', decimals: 'auto', locale: 'es-CR' },
      accounts: [], transactions: [], budgets: [], recurring: [], goals: [],
      debts: [
        { id: 'w1', name: 'Préstamo Don William', dir: 'owe', party: 'Don William', principal: 441000, rate: 3, ratePeriod: 'mensual', monthly: 30000, dueDate: '', payments: [] },
        { id: 'old', name: 'Deuda vieja', dir: 'owe', principal: 100000, rate: 0, ratePeriod: 'anual', monthly: 20000, dueDate: '', payments: [{ id: 'op', date: new Date().toISOString(), amount: 30000 }] }
      ],
      categories: {}
    }));
  });
  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForFunction(() => document.querySelector('#screen') && document.querySelector('#screen').children.length > 0);

  // Backward-compat: old payment (amount only) counts as capital
  const compat = await page.evaluate(() => {
    const d = DB.debts.find(x => x.id === 'old');
    return { capPaid: debtCapitalPaid(d), intPaid: debtInterestPaid(d), balance: debtBalance(d) };
  });
  console.log('old debt (compat): capital', compat.capPaid, 'interest', compat.intPaid, 'balance', compat.balance);

  // Register a 30,000 payment on the 441,000 @3% debt via the form
  const afterPay = await page.evaluate(() => {
    openDebtPayment('w1');
    // form auto-fills amount=30000 (monthly), interest = 3% of 441000 = 13230
    const amt = document.getElementById('dp-amt').value;
    const intr = document.getElementById('dp-int').value;
    const cap = document.getElementById('dp-cap').value;
    document.getElementById('dp-save').click();
    const d = DB.debts.find(x => x.id === 'w1');
    return { formAmt: +amt, formInt: +intr, formCap: +cap,
      balance: debtBalance(d), capPaid: debtCapitalPaid(d), intPaid: debtInterestPaid(d),
      payment: d.payments[0] };
  });
  console.log('form autofill: amt', afterPay.formAmt, 'int', afterPay.formInt, 'cap', afterPay.formCap);
  console.log('after pay: balance', afterPay.balance, 'capital', afterPay.capPaid, 'interest', afterPay.intPaid);
  console.log('stored payment:', JSON.stringify(afterPay.payment));

  // Edit that payment: change interest to 9300 (like Don William rounds), keep amount 30000
  const afterEdit = await page.evaluate(() => {
    const d = DB.debts.find(x => x.id === 'w1');
    const pid = d.payments[0].id;
    openDebtPayment('w1', pid);
    const intEl = document.getElementById('dp-int');
    intEl.value = 9300; intEl.dispatchEvent(new Event('input', { bubbles: true }));
    const capShown = document.getElementById('dp-cap').value;
    document.getElementById('dp-save').click();
    const d2 = DB.debts.find(x => x.id === 'w1');
    return { capShown: +capShown, balance: debtBalance(d2), payment: d2.payments[0] };
  });
  console.log('after edit (int=9300): capital shown', afterEdit.capShown, 'balance', afterEdit.balance);
  console.log('edited payment:', JSON.stringify(afterEdit.payment));

  const ok = errs.length === 0 &&
    // backward compat
    compat.capPaid === 30000 && compat.intPaid === 0 && compat.balance === 70000 &&
    // autofill split
    afterPay.formInt === 13230 && afterPay.formCap === 16770 &&
    // balance reduced only by capital 16770 (receipt model), NOT full 30000
    Math.abs(afterPay.balance - 424230) < 0.5 &&
    afterPay.capPaid === 16770 && afterPay.intPaid === 13230 &&
    // manual edit: interest 9300 -> capital 20700 -> balance 420300 (exactly the receipt)
    afterEdit.capShown === 20700 && Math.abs(afterEdit.balance - 420300) < 0.5 &&
    afterEdit.payment.interest === 9300 && afterEdit.payment.capital === 20700;
  console.log('\nERRORS:', errs.length ? errs : 'none');
  console.log(ok ? '\n✅ ALL PASS' : '\n❌ FAIL');
  await b.close(); server.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
