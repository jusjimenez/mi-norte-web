const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = require('path').join(__dirname, '..');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.webmanifest':'application/manifest+json','.png':'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (e, d) => { if (e) { res.writeHead(404); res.end(); } else { res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'text/plain' }); res.end(d); } });
});

async function seedAndLoad(page, port, seedFn) {
  await page.addInitScript(seedFn);
  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForFunction(() => document.querySelector('#screen') && document.querySelector('#screen').children.length > 0);
}

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];

  // Scenario 1: persona con deuda vencida (mismo seed que la captura)
  const p1 = await b.newPage();
  p1.on('pageerror', e => errs.push('P1 ' + e.message));
  p1.on('console', m => { if (m.type() === 'error') errs.push('P1c ' + m.text()); });
  await seedAndLoad(p1, port, () => {
    Date.prototype.getHours = function(){ return 10; };
    const now = new Date(), y = now.getFullYear(), m = now.getMonth();
    const iso = (mo, d) => new Date(y, mo, d, 12).toISOString();
    const tx = [];
    for (let k=1;k<=3;k++){ tx.push({id:'hi'+k,date:iso(m-k,5),type:'income',amount:340000,category:'Salario',account:'a1'});
      tx.push({id:'he'+k,date:iso(m-k,12),type:'expense',amount:330000,category:'Varios',account:'a1'});}
    tx.push({id:'i0',date:iso(m,2),type:'income',amount:340000,category:'Salario',account:'a1'});
    tx.push({id:'e1',date:iso(m,3),type:'expense',amount:120000,category:'Alquiler',account:'a1'});
    tx.push({id:'e2',date:iso(m,6),type:'expense',amount:48000,category:'Comida',account:'a1'});
    tx.push({id:'e3',date:iso(m,8),type:'expense',amount:22000,category:'Transporte',account:'a2'});
    localStorage.setItem('mi_norte_data_v2', JSON.stringify({
      settings:{currency:'CRC',decimals:'auto',locale:'es-CR',savingsGoal:10,gate:false},
      accounts:[{id:'a1',name:'BAC',kind:'banco',opening:15000},{id:'a2',name:'Efectivo',kind:'efectivo',opening:8000}],
      transactions:tx,budgets:[],recurring:[{id:'r1',type:'expense',amount:35000,category:'Servicios',note:'Luz',day:20,account:'a1'}],
      goals:[],debts:[{id:'d1',name:'Don William',dir:'owe',principal:441000,rate:3,ratePeriod:'mensual',monthly:30000,dueDate:iso(m,Math.max(1,now.getDate()-2)),payments:[]}],categories:{}
    }));
  });
  const r1 = await p1.evaluate(() => ({
    score: healthScore(), pillars: healthPillars(), step: nextStep(),
    days: Math.round(cushion().days), due: nextDue(),
    tnw: trueNetWorth(), nw: netWorth(), owe: totalOwe(),
    hasMomento: !!document.querySelector('.momento .mo-due.urgent'),
    hasDebtRem: !!document.querySelector('#debt-rem')
  }));
  console.log('S1 score', r1.score, 'pillars', JSON.stringify(r1.pillars));
  console.log('S1 step.act', r1.step.act, '| days', r1.days, '| due', r1.due && r1.due.daysAway);
  console.log('S1 trueNetWorth', r1.tnw, '= nw', r1.nw, '- owe', r1.owe);

  // Scenario 2: sin vencidos, colchón muy delgado -> paso "save"
  const p2 = await b.newPage();
  p2.on('pageerror', e => errs.push('P2 ' + e.message));
  await seedAndLoad(p2, port, () => {
    Date.prototype.getHours = function(){ return 10; };
    const now = new Date(), y=now.getFullYear(), m=now.getMonth();
    const iso=(mo,d)=>new Date(y,mo,d,12).toISOString();
    const tx=[];
    for(let k=1;k<=3;k++){tx.push({id:'i'+k,date:iso(m-k,5),type:'income',amount:300000,category:'S',account:'a1'});
      tx.push({id:'e'+k,date:iso(m-k,12),type:'expense',amount:270000,category:'V',account:'a1'});}
    tx.push({id:'now',date:iso(m,Math.min(now.getDate(),28)),type:'expense',amount:1000,category:'V',account:'a1'});
    localStorage.setItem('mi_norte_data_v2', JSON.stringify({
      settings:{currency:'CRC',decimals:'auto',locale:'es-CR',gate:false},
      accounts:[{id:'a1',name:'BAC',kind:'banco',opening:0}],
      transactions:tx,budgets:[],recurring:[],goals:[],debts:[],categories:{}
    }));
  });
  const r2 = await p2.evaluate(() => ({ score: healthScore(), step: nextStep(), days: Math.round(cushion().days) }));
  console.log('S2 score', r2.score, '| step.act', r2.step.act, '| days', r2.days);

  // Scenario 3: sin datos -> score null, momento vacío
  const p3 = await b.newPage();
  await seedAndLoad(p3, port, () => { Date.prototype.getHours=function(){return 10;};
    localStorage.setItem('mi_norte_data_v2', JSON.stringify({settings:{currency:'CRC',gate:false},accounts:[],transactions:[],budgets:[],recurring:[],goals:[],debts:[],categories:{}})); });
  const r3 = await p3.evaluate(() => ({ score: healthScore(), welcome: !!document.querySelector('.welcome') }));
  console.log('S3 score', r3.score, '| welcome', r3.welcome);

  const ok = errs.length === 0 &&
    r1.score === 59 && r1.pillars.alDia === 65 && r1.pillars.deuda === 87 && r1.pillars.colchon === 47 &&
    r1.step.act === 'debts' && r1.due.daysAway < 0 &&
    r1.tnw === r1.nw - r1.owe && !r1.hasDebtRem && r1.hasMomento &&
    r2.step.act === 'save' &&
    r3.score === null && r3.welcome;
  console.log('\nERRORS:', errs.length ? errs : 'none');
  console.log(ok ? '\n✅ ALL PASS' : '\n❌ FAIL');
  await b.close(); server.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
