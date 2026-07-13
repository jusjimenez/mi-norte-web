/* Corre toda la suite en orden y resume. Uso: node tests/run-all.js */
const { spawnSync } = require("child_process");
const fs = require("fs"), path = require("path");

const files = fs.readdirSync(__dirname).filter(f => f.endsWith(".test.js")).sort();
let failed = 0;
for (const f of files) {
  process.stdout.write(`▶ ${f} … `);
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: "utf8", timeout: 120000 });
  const pass = r.status === 0;
  console.log(pass ? "✅" : "❌");
  if (!pass) { failed++; console.log(r.stdout.slice(-2000)); console.log(r.stderr.slice(-800)); }
}
console.log(`\n${files.length - failed}/${files.length} en verde`);
process.exit(failed ? 1 : 0);
