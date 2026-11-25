require('./dns-config');

// Ejecuta la colección con Newman y guarda un resumen en MongoDB.
// Solo se guarda lo relevante: sin cuerpos de petición/respuesta, sin headers, sin tokens.
// Uso: node scripts/run.js [environment]   (por defecto "local")
const path = require('node:path');
const fs = require('node:fs');
const newman = require('newman');
const { MongoClient } = require('mongodb');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const ROOT = path.resolve(__dirname, '..');
const envName = process.argv[2] || 'local';

function runNewman() {
  return new Promise((resolve, reject) => {
    newman.run(
      {
        collection: path.join(ROOT, 'collections/liferpg.postman_collection.json'),
        environment: path.join(ROOT, `environments/${envName}.postman_environment.json`),
        envVar: process.env.QA_BASE_URL ? [{ key: 'baseUrl', value: process.env.QA_BASE_URL }] : [],
        reporters: ['cli'],
        timeoutRequest: 10000,
      },
      (err, summary) => (err ? reject(err) : resolve(summary)),
    );
  });
}

function readApiVersion(executions) {
  const estado = executions.find((e) => e.item.name.startsWith('Estado · GET /estado'));
  try {
    return JSON.parse(estado.response.stream.toString()).version ?? null;
  } catch {
    return null;
  }
}

function buildLog(summary, startedAt) {
  const { stats, timings, executions } = summary.run;

  const results = executions.map((e) => {
    const assertions = e.assertions || [];
    const failed = assertions.filter((a) => a.error);
    const requestError = e.requestError ? e.requestError.message : null;
    return {
      request: e.item.name,
      method: e.request.method,
      path: '/' + e.request.url.getPath().split('/').filter(Boolean).join('/'),
      statusCode: e.response ? e.response.code : null,
      responseTimeMs: e.response ? e.response.responseTime : null,
      passed: !requestError && failed.length === 0,
      assertionsTotal: assertions.length,
      failures: [
        ...(requestError ? [{ name: 'request', message: requestError }] : []),
        ...failed.map((a) => ({ name: a.assertion, message: a.error.message })),
      ],
    };
  });

  const times = results.map((r) => r.responseTimeMs).filter((t) => t != null);
  const run = {
    startedAt,
    finishedAt: new Date(),
    durationMs: timings.completed - timings.started,
    environment: envName,
    baseUrl: process.env.QA_BASE_URL || null,
    apiVersion: readApiVersion(executions),
    passed: results.every((r) => r.passed),
    requests: { total: stats.requests.total, failed: results.filter((r) => !r.passed).length },
    assertions: { total: stats.assertions.total, failed: stats.assertions.failed },
    avgResponseMs: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null,
    maxResponseMs: times.length ? Math.max(...times) : null,
  };
  return { run, results };
}

// Copia local del último resultado, por si MongoDB no responde.
function writeLocalLog(log) {
  fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'reports/last-run.json'), JSON.stringify(log, null, 2));
}

async function saveToMongo({ run, results }) {
  const uri = process.env.QA_MONGODB_URI;
  if (!uri) throw new Error('Falta QA_MONGODB_URI en .env');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  try {
    await client.connect();
    const db = client.db(process.env.QA_DB_NAME || 'liferpg_qa');
    const { insertedId } = await db.collection('test_runs').insertOne(run);
    await db.collection('test_results').insertMany(
      results.map((r) => ({ ...r, runId: insertedId, environment: run.environment, createdAt: run.startedAt })),
    );
    return insertedId;
  } finally {
    await client.close();
  }
}

async function main() {
  const startedAt = new Date();
  const summary = await runNewman();
  const log = buildLog(summary, startedAt);
  writeLocalLog(log);

  try {
    const id = await saveToMongo(log);
    console.log(`\nCorrida ${id} guardada en MongoDB · ${log.run.passed ? 'OK' : 'CON FALLAS'}`);
  } catch (err) {
    console.error(`\nNo se pudo guardar en MongoDB: ${err.message}. Resultado en reports/last-run.json`);
    process.exitCode = 2;
    return;
  }
  process.exitCode = log.run.passed ? 0 : 1;
}

main().catch((err) => {
  console.error('Falló la corrida de QA:', err.message);
  process.exitCode = 1;
});
