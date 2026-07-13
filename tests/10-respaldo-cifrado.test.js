const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim()+'/playwright');
const http=require('http'),fs=require('fs'),path=require('path');const ROOT=require('path').join(__dirname, '..');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json'};
const srv=http.createServer((q,s)=>{let p=q.url.split('?')[0];if(p==='/')p='/index.html';if(p==='/sw.js'){s.writeHead(404);s.end();return;}fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){s.writeHead(404);s.end();}else{s.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'text/plain'});s.end(d);}});});
const Y=new Date().getFullYear(),M=new Date().getMonth();
(async()=>{await new Promise(r=>srv.listen(0,r));const port=srv.address().port;
const b=await chromium.launch({executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});const page=await b.newPage();
const errs=[];page.on('pageerror',e=>errs.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('404'))errs.push('c:'+m.text());});
await page.addInitScript(({Y,M})=>{Date.prototype.getHours=function(){return 12;};const iso=(mo,d)=>new Date(Y,mo,d,12).toISOString();
localStorage.setItem('mi_norte_data_v2',JSON.stringify({settings:{currency:'CRC',decimals:'auto',locale:'es-CR',gate:false},accounts:[{id:'a1',name:'BAC',kind:'banco',opening:150000}],transactions:[{id:'t1',date:iso(M,3),type:'expense',amount:32500,category:'Comida',account:'a1'}],budgets:{},recurring:[],goals:[],debts:[],categories:{}}));},{Y,M});
await page.goto(`http://localhost:${port}/index.html`);
await page.waitForFunction(()=>document.querySelector('#screen')&&document.querySelector('#screen').children.length>0);

const r=await page.evaluate(async()=>{
  const out={};
  // round trip
  const payload=await encryptBackup(DB, 'clave1234');
  out.hasWrapper = payload.minorte_encrypted===1 && !!payload.salt && !!payload.iv && !!payload.data;
  out.ciphertextNotPlain = !JSON.stringify(payload).includes('Comida'); // no filtra datos
  const back=await decryptBackup(payload,'clave1234');
  out.roundtrip = JSON.stringify(back.transactions)===JSON.stringify(DB.transactions) && back.accounts[0].name==='BAC';
  // wrong password
  try{ await decryptBackup(payload,'malaclave'); out.wrongPwThrew=false; }catch{ out.wrongPwThrew=true; }
  // backupDue: sin lastBackup y con datos -> true
  out.dueNoBackup = backupDue();
  // simular respaldo hoy -> false
  DB.settings.lastBackup=todayISO(); out.dueAfterBackup = backupDue();
  // 20 días atrás -> true
  DB.settings.lastBackup=new Date(Date.now()-20*86400000).toISOString(); out.dueOld = backupDue();
  return out;
});
console.log(JSON.stringify(r,null,2));
// import encrypted opens password sheet
const encFlow=await page.evaluate(async()=>{
  const payload=await encryptBackup(DB,'x1234');
  importBackupData(JSON.stringify(payload));
  return !!document.querySelector('#pp-ok');
});
console.log('encrypted import shows password prompt:', encFlow);
// home shows backup reminder (reset lastBackup)
const remShown=await page.evaluate(()=>{ DB.settings.lastBackup=''; save(); currentTab='home'; render(); return !!document.querySelector('#backup-rem'); });
console.log('home backup reminder:', remShown);

const ok = errs.length===0 && r.hasWrapper && r.ciphertextNotPlain && r.roundtrip && r.wrongPwThrew &&
  r.dueNoBackup===true && r.dueAfterBackup===false && r.dueOld===true && encFlow && remShown;
console.log('\nERRORS:',errs.length?errs:'none');
console.log(ok?'\n✅ ALL PASS':'\n❌ FAIL');
await b.close();srv.close();process.exit(ok?0:1);
})().catch(e=>{console.error(e);process.exit(1);});
