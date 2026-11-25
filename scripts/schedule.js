require('./dns-config');

// Ejecuta las pruebas cada cierto tiempo. Uso: npm run watch [environment]
const path = require('node:path');
const { spawn } = require('node:child_process');
const cron = require('node-cron');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const expr = process.env.QA_CRON || '*/30 * * * *';
const envName = process.argv[2] || 'local';
if (!cron.validate(expr)) {
  console.error(`QA_CRON no es una expresión válida: "${expr}"`);
  process.exit(1);
}

let running = false;
function runOnce() {
  if (running) return console.log('Corrida anterior sigue en curso, se omite.');
  running = true;
  spawn(process.execPath, [path.join(__dirname, 'run.js'), envName], { stdio: 'inherit' })
    .on('exit', () => { running = false; });
}

cron.schedule(expr, runOnce);
console.log(`QA programado (${expr}) contra "${envName}". Primera corrida ahora.`);
runOnce();
