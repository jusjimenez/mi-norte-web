/* Versión Esencial: la app empieza mínima y se abre por relevancia.
   Verifica gating (tabs/hub/home), activar/desactivar, sugerencias y migración. */
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
  const errs = [];

  // --- Fresh Esencial: mínimo, sin features
  const p1 = await b.newPage();
  p1.on('pageerror', e => errs.push('P1 ' + e.message));
  await p1.addInitScript(({ Y, M }) => {
    Date.prototype.getHours = function () { return 12; };
    const iso = d => new Date(Y, M, d, 12).toISOString();
    const tx = []; for (let i = 1; i <= 6; i++) tx.push({ id: 'e' + i, date: iso(i), type: 'expense', amount: 5000, category: '', account: 'a1' });
    localStorage.setItem('mi_norte_esencial', JSON.stringify({
      settings: { currency: 'CRC', decimals: 'auto', locale: 'es-CR', gate: false, features: {} },
      accounts: [{ id: 'a1', name: 'Efectivo', kind: 'efectivo', opening: 100000 }],
      transactions: tx, budgets: {}, goals: [], recurring: [], debts: [], categories: { expense: ['Otro'], income: ['Otro'] }
    }));
  }, { Y, M });
  await p1.goto(`http://localhost:${port}/index.html`);
  await p1.waitForFunction(() => document.querySelector('#screen') && document.querySelector('#screen').children.length > 0);
  const r1 = await p1.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('.tab')).filter(t => t.style.display !== 'none').map(t => t.dataset.tab);
    const sg = suggestFeature();
    return {
      tabs, reportHidden: document.querySelector('.tab[data-tab="reports"]').style.display === 'none',
      hasHealthRow: !!document.querySelector('#cv-health'),
      suggestKey: sg && sg.key, suggestShown: !!document.querySelector('.suggest'),
      // activar categorías y ver que aparece en Más
      before: feat('categorias')
    };
  });
  console.log('S1 tabs', JSON.stringify(r1.tabs), '| reportHidden', r1.reportHidden, '| health', r1.hasHealthRow, '| suggest', r1.suggestKey);

  const r1b = await p1.evaluate(() => {
    activateFeature('categorias', true); applyFeatureTabs();
    activateFeature('reportes', true); applyFeatureTabs();
    const reportNowVisible = document.querySelector('.tab[data-tab="reports"]').style.display !== 'none';
    // desactivar no borra datos
    const txBefore = DB.transactions.length;
    deactivateFeature('categorias');
    return { catOn: true, reportNowVisible, dataIntact: DB.transactions.length === txBefore, catOffNow: !feat('categorias') };
  });
  console.log('S1b reportVisibleTrasActivar', r1b.reportNowVisible, '| dataIntact', r1b.dataIntact);

  // --- Sugerencia de deudas por relevancia (categoría "Deudas" usada)
  const r1c = await p1.evaluate(() => {
    DB.transactions.push({ id: 'd0', date: new Date().toISOString(), type: 'expense', amount: 20000, category: 'Deudas', account: 'a1' });
    const sg = suggestFeature();
    const key = sg && sg.key;
    dismissSuggestion(key);
    const sg2 = suggestFeature();
    return { firstKey: key, afterDismiss: sg2 && sg2.key };
  });
  console.log('S1c sugerencia deudas', r1c.firstKey, '| tras descartar', r1c.afterDismiss);

  // --- Migración: datos de la versión completa (OLD_KEY) infieren features
  const p2 = await b.newPage();
  p2.on('pageerror', e => errs.push('P2 ' + e.message));
  await p2.addInitScript(({ Y, M }) => {
    Date.prototype.getHours = function () { return 12; };
    const iso = d => new Date(Y, M, d, 12).toISOString();
    const tx = []; for (let i = 1; i <= 9; i++) tx.push({ id: 't' + i, date: iso(i), type: 'expense', amount: 3000, category: 'Comida', account: 'a1' });
    // Sembramos SOLO la clave vieja (versión completa), sin la de Esencial
    localStorage.setItem('mi_norte_data_v2', JSON.stringify({
      settings: { currency: 'CRC', decimals: 'auto', locale: 'es-CR', gate: false },
      accounts: [{ id: 'a1', name: 'BAC', kind: 'banco', opening: 100000 }],
      transactions: tx, budgets: { Comida: 50000 }, goals: [{ id: 'g1', name: 'X', target: 1000, saved: 0 }],
      recurring: [{ id: 'r1', type: 'expense', amount: 1000, category: 'Comida', day: 1 }],
      debts: [{ id: 'de1', name: 'Deuda', dir: 'owe', principal: 5000, payments: [] }], categories: {}
    }));
  }, { Y, M });
  await p2.goto(`http://localhost:${port}/index.html`);
  await p2.waitForFunction(() => document.querySelector('#screen') && document.querySelector('#screen').children.length > 0);
  const r2 = await p2.evaluate(() => ({ f: DB.settings.features, migrated: DB.transactions.length }));
  console.log('S2 features inferidas:', JSON.stringify(r2.f));

  const ok = errs.length === 0 &&
    // fresh: solo 4 tabs, reportes oculto, sin salud en home, sugiere categorías
    r1.tabs.length === 4 && r1.reportHidden && !r1.hasHealthRow && r1.suggestKey === 'categorias' && r1.suggestShown &&
    r1b.reportNowVisible && r1b.dataIntact && r1b.catOffNow &&
    // deudas se sugiere cuando se usa esa categoría; al descartar no reaparece
    r1c.firstKey === 'deudas' && r1c.afterDismiss !== 'deudas' &&
    // migración: infiere deudas, metas, fijos, proximos, presupuestos, categorias, reportes, salud
    r2.f.deudas && r2.f.metas && r2.f.fijos && r2.f.proximos && r2.f.presupuestos && r2.f.categorias && r2.f.reportes && r2.f.salud;
  console.log('\nERRORS:', errs.length ? errs : 'none');
  console.log(ok ? '\n✅ ALL PASS' : '\n❌ FAIL');
  await b.close(); server.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
