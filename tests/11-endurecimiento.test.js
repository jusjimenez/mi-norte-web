/* Regresión de la revisión de seguridad/exactitud:
   A1 escape XSS en nextStep · A2 coerción de tipos en normalize ·
   B1 la salud ignora morosos que te deben a ti · B2 dueDate avanza al pagar ·
   A3 neutralización de fórmulas en CSV. */
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = require('path').join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, s) => {
  let p = q.url.split('?')[0]; if (p === '/') p = '/index.html';
  if (p === '/sw.js') { s.writeHead(404); s.end(); return; }
  fs.readFile(path.join(ROOT, p), (e, d) => { if (e) { s.writeHead(404); s.end(); } else { s.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'text/plain' }); s.end(d); } });
});
const now = new Date(), Y = now.getFullYear(), M = now.getMonth();

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await b.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errs.push('c:' + m.text()); });
  await page.addInitScript(({ Y, M }) => {
    Date.prototype.getHours = function () { return 12; };
    const iso = (mo, d) => new Date(Y, mo, d, 12).toISOString();
    localStorage.setItem('mi_norte_data_v2', JSON.stringify({
      settings: { currency: 'CRC', decimals: 'auto', locale: 'es-CR', gate: false },
      accounts: [{ id: 'a1', name: 'BAC', kind: 'banco', opening: 100000 }],
      transactions: [], budgets: {}, recurring: [], goals: [],
      debts: [
        // Deuda MÍA vencida (día 1 del mes pasado) con nombre malicioso (A1) y cuota mensual (B2)
        { id: 'd1', name: '<img src=x onerror=window.__xss=1>', dir: 'owe', principal: 100000, rate: 3, ratePeriod: 'mensual', monthly: 10000, dueDate: iso(M - 1, 28), payments: [] },
        // Deuda que OTRO me debe, también vencida (B1: no debe bajar mi score)
        { id: 'd2', name: 'Me debe Juan', dir: 'owed', principal: 50000, rate: 0, ratePeriod: 'anual', dueDate: iso(M - 1, 1), payments: [] }
      ], categories: {}
    }));
  }, { Y, M });
  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForFunction(() => document.querySelector('#screen') && document.querySelector('#screen').children.length > 0);

  const r = await page.evaluate(async ({ Y, M }) => {
    const out = {};
    // A1: el nombre malicioso no ejecuta ni se inyecta como HTML
    out.xssExecuted = !!window.__xss;
    const step = document.querySelector('.mo-step-txt');
    out.stepHasImgTag = step ? !!step.querySelector('img') : false;
    // B1: solo MI deuda vencida penaliza (1 vencida => alDia 65, no 30)
    out.alDia = healthPillars().alDia;
    // A2: normalize coerciona strings y descarta basura
    const dirty = normalize({
      transactions: [
        { id: 't1', date: new Date().toISOString(), type: 'income', amount: '5000', category: 7 },
        { id: 't2', date: 'no-es-fecha', type: 'raro', amount: 'abc' },
        null, 'basura'
      ],
      accounts: [{ id: 'a9', name: 123, kind: 'x', opening: '250' }],
      budgets: { Comida: '40000', Mala: 'xx' }
    });
    out.coercedAmount = dirty.transactions[0].amount;           // 5000 número
    out.coercedCategory = typeof dirty.transactions[0].category; // "string"
    out.badAmount = dirty.transactions[1].amount;               // 0
    out.badType = dirty.transactions[1].type;                   // "expense"
    out.txCount = dirty.transactions.length;                    // 2 (basura fuera)
    out.accKind = dirty.accounts[0].kind;                       // "otro"
    out.accOpening = dirty.accounts[0].opening;                 // 250 número
    out.budgetOk = dirty.budgets['Comida'];                     // 40000
    out.budgetBad = 'Mala' in dirty.budgets;                    // false
    // La suma con el monto coercionado es numérica, no concatenación
    out.sumType = typeof dirty.transactions.reduce((s, t) => s + t.amount, 0);
    // B2: registrar un pago (por el formulario real) avanza dueDate un mes
    const d1 = DB.debts.find(x => x.id === 'd1');
    const beforeDue = d1.dueDate;
    openDebtPayment('d1');
    document.getElementById('dp-amt').value = 10000;
    if (document.getElementById('dp-int')) { document.getElementById('dp-int').value = 3000; document.getElementById('dp-int').dispatchEvent(new Event('input', { bubbles: true })); }
    document.getElementById('dp-save').click();
    const afterDue = DB.debts.find(x => x.id === 'd1').dueDate;
    out.dueAdvanced = new Date(afterDue) > new Date(beforeDue);
    out.dueMonthDelta = (new Date(afterDue).getMonth() - new Date(beforeDue).getMonth() + 12) % 12;
    // A3: fórmula neutralizada en CSV
    let csvText = null;
    const origDl = downloadBlob;
    downloadBlob = (blob) => {};
    DB.transactions.push({ id: 'evil', date: new Date().toISOString(), type: 'expense', amount: 100, category: 'Otro', note: '=HYPERLINK("http://mal","x")' });
    // capturamos el contenido generando las líneas con exportCSV interceptado
    downloadBlob = async (blob) => { csvText = await blob.text(); };
    exportCSV(DB.transactions, 'x.csv');
    await new Promise(r => setTimeout(r, 50));
    downloadBlob = origDl;
    out.csvNeutralized = csvText != null && csvText.includes(`"'=HYPERLINK`) && !csvText.includes(`"=HYPERLINK`);
    return out;
  }, { Y, M });

  console.log(JSON.stringify(r, null, 2));
  const ok = errs.length === 0 &&
    r.xssExecuted === false && r.stepHasImgTag === false &&
    r.alDia === 65 &&
    r.coercedAmount === 5000 && r.coercedCategory === 'string' &&
    r.badAmount === 0 && r.badType === 'expense' && r.txCount === 2 &&
    r.accKind === 'otro' && r.accOpening === 250 &&
    r.budgetOk === 40000 && r.budgetBad === false && r.sumType === 'number' &&
    r.dueAdvanced === true && r.dueMonthDelta === 1 &&
    r.csvNeutralized === true;
  console.log('\nERRORS:', errs.length ? errs : 'none');
  console.log(ok ? '\n✅ ALL PASS' : '\n❌ FAIL');
  await b.close(); server.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
