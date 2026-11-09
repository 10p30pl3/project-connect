// Verifica a sintaxe de todos os arquivos JS do gateway sem iniciar o serviço (não abre portas, não conecta ao FreeSWITCH).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const skip = new Set(['node_modules', 'dist', 'recordings', 'logs']);
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(e.name) || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) files.push(p);
  }
})(root);

let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (err) {
    failed++;
    console.error(`✗ ${path.relative(root, f)}\n${String(err.stderr || err.message)}`);
  }
}
console.log(`${files.length - failed}/${files.length} arquivos JS com sintaxe válida`);
process.exit(failed ? 1 : 0);
