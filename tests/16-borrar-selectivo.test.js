/* Borrado personalizado: marcas qué reiniciar. Independiente:
   - solo movimientos -> conserva saldo (opening=saldo), deudas, metas, presupuestos
   - solo deudas -> conserva movimientos y saldos
   - cuentas -> fuerza movimientos y borra cuentas */
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
  const errs = [];

  const seed = () => {
    Date.prototype.getHours = function () { return 12; };
    const iso = d => new Date(2026, 6, d, 12).toISOString();
    localStorage.setItem('mi_norte_data_v2', JSON.stringify({
      settings: { currency: 'CRC', decimals: 'auto', locale: 'es-CR', gate: false },
      accounts: [{ id: 'a1', name: 'BAC', kind: 'banco', opening: 100000 }],
      transactions: [
        { id: 'i1', date: iso(1), type: 'income', amount: 50000, category: 'Salario', account: 'a1' },
        { id: 'e1', date: iso(3), type: 'expense', amount: 20000, category: 'Comida', account: 'a1' }
      ],
      budgets: { Comida: 60000 },
      goals: [{ id: 'g1', name: 'Meta', target: 100000, saved: 30000 }],
      recurring: [],
      debts: [{ id: 'd1', name: 'Préstamo', dir: 'owe', principal: 200000, rate: 0, ratePeriod: 'anual', monthly: 20000, dueDate: '', payments: [{ id: 'p1', date: iso(5), amount: 30000, interest: 0, capital: 30000, txId: 'i1' }] }],
      categories: { expense: ['Comida'], income: ['Salario'] }
    }));
  };

  async function run(config, label) {
    const page = await b.newPage();
    page.on('pageerror', e => errs.push(label + ' ' + e.message));
    page.on('dialog', d => d.accept());
    await page.addInitScript(seed);
    await page.goto(`http://localhost:${port}/index.html`);
    await page.waitForFunction(() => document.querySelector('#screen') && document.querySelector('#screen').children.length > 0);
    const out = await page.evaluate((cfg) => {
      openResetOptions();
      // ajustar casillas a la config exacta
      ['mov', 'saldos', 'debts', 'goals', 'budgets', 'recurring', 'accounts'].forEach(k => {
        const el = document.getElementById('rs-' + k); if (!el) return;
        const want = !!cfg[k];
        if (el.checked !== want) { el.checked = want; el.dispatchEvent(new Event('change', { bubbles: true })); }
      });
      document.getElementById('rs-apply').click();
      return {
        tx: DB.transactions.length, accounts: DB.accounts.length, opening: DB.accounts[0] ? DB.accounts[0].opening : null,
        nw: netWorth(), debts: DB.debts.length, payTxId: DB.debts[0] ? DB.debts[0].payments[0].txId : 'n/a',
        goals: DB.goals.length, budgets: Object.keys(DB.budgets).length
      };
    }, config);
    await page.close();
    return out;
  }

  const A = await run({ mov: true }, 'A');
  console.log('A solo movimientos:', JSON.stringify(A));
  const B = await run({ debts: true }, 'B');
  console.log('B solo deudas:', JSON.stringify(B));
  const C = await run({ accounts: true }, 'C');
  console.log('C cuentas (fuerza mov):', JSON.stringify(C));
  const D = await run({ mov: true, saldos: true }, 'D');
  console.log('D movimientos + saldos:', JSON.stringify(D));
  const E = await run({ saldos: true }, 'E');
  console.log('E solo saldos (conserva movimientos):', JSON.stringify(E));

  const ok = errs.length === 0 &&
    // A: sin tx, saldo conservado (opening=130000, nw=130000), deuda intacta (txId suelto), metas/presupuesto intactos
    A.tx === 0 && A.accounts === 1 && A.opening === 130000 && A.nw === 130000 && A.debts === 1 && A.payTxId === undefined && A.goals === 1 && A.budgets === 1 &&
    // B: deudas fuera; movimientos, saldos, metas y presupuesto intactos
    B.debts === 0 && B.tx === 2 && B.accounts === 1 && B.nw === 130000 && B.goals === 1 && B.budgets === 1 &&
    // C: cuentas fuera + movimientos fuera; deudas y metas se conservan
    C.accounts === 0 && C.tx === 0 && C.nw === 0 && C.debts === 1 && C.goals === 1 &&
    // D: movimientos + saldos -> cuenta conservada con saldo 0, sin tx
    D.accounts === 1 && D.tx === 0 && D.opening === 0 && D.nw === 0 && D.debts === 1 &&
    // E: solo saldos -> opening 0 pero movimientos intactos (nw = suma de movimientos = 30000)
    E.accounts === 1 && E.tx === 2 && E.opening === 0 && E.nw === 30000 && E.debts === 1;
  console.log('\nERRORS:', errs.length ? errs : 'none');
  console.log(ok ? '\n✅ ALL PASS' : '\n❌ FAIL');
  await b.close(); server.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
