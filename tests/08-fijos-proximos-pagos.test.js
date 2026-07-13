const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = require('path').join(__dirname, '..');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.webmanifest':'application/manifest+json','.png':'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (e, d) => { if (e) { res.writeHead(404); res.end(); } else { res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'text/plain' }); res.end(d); } });
});
const now = new Date(), Y = now.getFullYear(), M = now.getMonth();

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await b.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type()==='error') errs.push('c:'+m.text()); });
  await page.addInitScript(({ Y, M }) => {
    const RealDate = Date;
    const fixed = new RealDate(Y, M, 15, 12, 0, 0).getTime();  // hoy = día 15
    function FakeDate(...a){ if(!(this instanceof FakeDate)) return new RealDate(fixed).toString(); return a.length? new RealDate(...a): new RealDate(fixed); }
    FakeDate.prototype = RealDate.prototype; FakeDate.now=()=>fixed; FakeDate.parse=RealDate.parse; FakeDate.UTC=RealDate.UTC;
    window.Date = FakeDate;
    localStorage.setItem('mi_norte_data_v2', JSON.stringify({
      settings:{currency:'CRC',decimals:'auto',locale:'es-CR',gate:false},
      accounts:[{id:'a1',name:'BAC',kind:'banco',opening:200000}],
      transactions:[],budgets:[],
      recurring:[
        {id:'r1',type:'expense',amount:120000,category:'Alquiler',note:'Alquiler',day:1,account:'a1',auto:false},   // vencido -> pending
        {id:'r2',type:'income',amount:340000,category:'Salario',note:'Salario',day:1,account:'a1',auto:true},        // auto -> se aplica al cargar
        {id:'r3',type:'expense',amount:15000,category:'Gimnasio',note:'Gimnasio',day:28,account:'a1',auto:false}     // futuro
      ],
      goals:[],debts:[{id:'d1',name:'Don William',dir:'owe',principal:441000,rate:3,ratePeriod:'mensual',monthly:30000,dueDate:new RealDate(Y,M,20,12).toISOString(),payments:[]}],categories:{}
    }));
  }, { Y, M });
  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForFunction(() => document.querySelector('#screen') && document.querySelector('#screen').children.length > 0);

  // Post-carga: el auto (r2) ya debió aplicarse
  const s0 = await page.evaluate(() => ({
    txCount: DB.transactions.length,
    autoTx: DB.transactions.find(t => t.category === 'Salario') || null,
    r2posted: DB.recurring.find(r=>r.id==='r2').lastPosted,
    pendR1: recurringPending(DB.recurring.find(r=>r.id==='r1')),
    pendR2: recurringPending(DB.recurring.find(r=>r.id==='r2')),
    pendR3: recurringPending(DB.recurring.find(r=>r.id==='r3')),
    pendings: recurringPendings().map(r=>r.id),
    upcoming: upcomingItems(45).map(i=>({kind:i.kind,name:i.name,da:i.daysAway,pending:i.pending})),
    pendRemOnHome: !!document.querySelector('#pend-rem')
  }));
  console.log('after load: txCount', s0.txCount, '| autoTx?', !!s0.autoTx, '| r2posted', s0.r2posted);
  console.log('pending r1/r2/r3:', s0.pendR1, s0.pendR2, s0.pendR3, '| pendings', JSON.stringify(s0.pendings));
  console.log('upcoming:', JSON.stringify(s0.upcoming));
  console.log('pend reminder on home:', s0.pendRemOnHome);

  // Confirmar r1 (postRecurring), luego saltar r3
  const s1 = await page.evaluate(() => {
    const before = DB.transactions.length;
    postRecurring(DB.recurring.find(r=>r.id==='r1')); save();
    const afterPost = DB.transactions.length;
    const r1pend = recurringPending(DB.recurring.find(r=>r.id==='r1'));
    skipRecurring(DB.recurring.find(r=>r.id==='r3')); save();
    const afterSkip = DB.transactions.length;
    const r3pend = recurringPending(DB.recurring.find(r=>r.id==='r3'));
    return { before, afterPost, r1pend, afterSkip, r3pend };
  });
  console.log('confirm r1: tx', s1.before, '->', s1.afterPost, '| r1 pending now', s1.r1pend);
  console.log('skip r3: tx', s1.afterPost, '->', s1.afterSkip, '| r3 pending now', s1.r3pend);

  // Render openUpcoming sin errores
  const upOk = await page.evaluate(() => { openUpcoming(); return !!document.querySelector('#sheet-root .sheet'); });

  const debtItem = s0.upcoming.find(i=>i.kind==='debt');
  const ok = errs.length === 0 &&
    s0.txCount === 1 && s0.autoTx && s0.autoTx.amount === 340000 && s0.r2posted &&
    s0.pendR1 === true && s0.pendR2 === false && s0.pendR3 === false &&
    JSON.stringify(s0.pendings) === JSON.stringify(['r1']) &&
    s0.upcoming.length === 3 && debtItem && debtItem.da === 5 &&
    s0.upcoming[0].name === 'Alquiler' && s0.upcoming[0].pending === true &&  // vencido primero
    s0.pendRemOnHome &&
    s1.afterPost === s1.before + 1 && s1.r1pend === false &&
    s1.afterSkip === s1.afterPost && s1.r3pend === false &&
    upOk;
  console.log('\nERRORS:', errs.length ? errs : 'none');
  console.log(ok ? '\n✅ ALL PASS' : '\n❌ FAIL');
  await b.close(); server.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
