/* Corre toda la suite en orden y resume. Uso: node tests/run-all.js */
const { spawnSync } = require("child_process");
const fs = require("fs"), path = require("path");

const files = fs.readdirSync(__dirname).filter(f => f.endsWith(".test.js")).sort();
const runOnce = (f) => spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: "utf8", timeout: 120000 });
let failed = 0;
for (const f of files) {
  process.stdout.write(`▶ ${f} … `);
  // Reintento: el navegador headless a veces se cae por presión de recursos
  // del contenedor (contexto destruido a mitad de evaluate). Eso es
  // infraestructura, no lógica; hasta 2 reintentos lo distinguen de un fallo real.
  let r = runOnce(f);
  for (let t = 0; t < 2 && r.status !== 0; t++) { process.stdout.write("↻ "); r = runOnce(f); }
  const pass = r.status === 0;
  console.log(pass ? "✅" : "❌");
  if (!pass) { failed++; console.log(r.stdout.slice(-2000)); console.log(r.stderr.slice(-800)); }
}
console.log(`\n${files.length - failed}/${files.length} en verde`);
process.exit(failed ? 1 : 0);
