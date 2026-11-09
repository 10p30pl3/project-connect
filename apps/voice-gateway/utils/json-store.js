const fs = require('fs');
const path = require('path');

function readJsonList(file) {
  try {
    if (!fs.existsSync(file)) return [];
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error(`[json-store] Erro ao ler ${file}:`, err.message);
    return [];
  }
}

function writeJsonList(file, list) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    console.warn(`[json-store] Não foi possível gravar ${file}:`, err.message);
  }
}

module.exports = { readJsonList, writeJsonList };
