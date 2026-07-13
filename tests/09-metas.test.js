const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim()+'/playwright');
const http=require('http'),fs=require('fs'),path=require('path');const ROOT=require('path').join(__dirname, '..');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json'};
const srv=http.createServer((q,s)=>{let p=q.url.split('?')[0];if(p==='/')p='/index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){s.writeHead(404);s.end();}else{s.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'text/plain'});s.end(d);}});});
const Y=new Date().getFullYear(),M=new Date().getMonth();
(async()=>{await new Promise(r=>srv.listen(0,r));const port=srv.address().port;
const b=await chromium.launch({executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});const page=await b.newPage();
const errs=[];page.on('pageerror',e=>errs.push(e.message));page.on('console',m=>{if(m.type()==='error')errs.push('c:'+m.text());});
await page.addInitScript(({Y,M})=>{
  Date.prototype.getHours=function(){return 12;};
  const iso=(mo,d)=>new Date(Y,mo,d,12).toISOString();
  // meta: objetivo 300000, lleva 60000, creada hace ~2 meses, fecha objetivo +4 meses
  localStorage.setItem('mi_norte_data_v2',JSON.stringify({
    settings:{currency:'CRC',decimals:'auto',locale:'es-CR',gate:false},
    accounts:[{id:'a1',name:'BAC',kind:'banco',opening:100000}],transactions:[],budgets:[],recurring:[],
    goals:[
      {id:'g1',name:'Vacaciones',kind:'ahorro',target:300000,saved:60000,createdAt:iso(M-2,1),targetDate:iso(M+4,1)},
      {id:'g2',name:'Cumplida',kind:'ahorro',target:50000,saved:50000,createdAt:iso(M-1,1),targetDate:iso(M+2,1)},
      {id:'g3',name:'Sin fecha',kind:'ahorro',target:100000,saved:20000}
    ],debts:[],categories:{}
  }));
},{Y,M});
await page.goto(`http://localhost:${port}/index.html`);
await page.waitForFunction(()=>document.querySelector('#screen')&&document.querySelector('#screen').children.length>0);
const r=await page.evaluate(()=>{
  const g1=DB.goals[0],g2=DB.goals[1],g3=DB.goals[2];
  // simular aporte a g1
  const needed=goalMonthlyNeeded(g1);
  return {
    g1needed:needed, g1pace:goalPace(g1), g1rem:goalRemaining(g1),
    g2pace:goalPace(g2), g3pace:goalPace(g3), g3needed:goalMonthlyNeeded(g3)
  };
});
console.log('g1 (300k, lleva 60k, +4m): falta',r.g1rem,'· aparta/mes',r.g1needed,'· pace',JSON.stringify(r.g1pace));
console.log('g2 (cumplida):',JSON.stringify(r.g2pace));
console.log('g3 (sin fecha): pace',JSON.stringify(r.g3pace),'needed',r.g3needed);
// render goals sheet content
const txt=await page.evaluate(()=>{openGoals();return document.querySelector('#sheet-root .sheet').innerText;});
console.log('\n--- GOALS SHEET (extracto) ---\n'+txt.split('\n').slice(0,14).join('\n'));

// g1: remaining 240000 over 4 months -> 60000/mes. pace: created -2m, target +4m => total 6m, elapsed 2m => frac .333, expected 300k*.333=100k, saved 60k < 100k => atrasado
const ok = errs.length===0 &&
  r.g1rem===240000 && r.g1needed>60000 && r.g1needed<70000 &&
  r.g1pace && r.g1pace.ahead===false && r.g1pace.label==='Vas atrasado' &&
  r.g2pace && r.g2pace.done===true &&
  r.g3pace===null && r.g3needed===0;
console.log('\nERRORS:',errs.length?errs:'none');
console.log(ok?'\n✅ ALL PASS':'\n❌ FAIL');
await b.close();srv.close();process.exit(ok?0:1);
})().catch(e=>{console.error(e);process.exit(1);});
