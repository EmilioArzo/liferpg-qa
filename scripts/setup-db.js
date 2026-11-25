require('./dns-config');

// Crea los índices de liferpg_qa. Se ejecuta una sola vez: npm run setup:db
const path = require('node:path');
const { MongoClient } = require('mongodb');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  if (!process.env.QA_MONGODB_URI) throw new Error('Falta QA_MONGODB_URI en .env');
  const ttlDays = Number(process.env.QA_RESULTS_TTL_DAYS) || 90;
  const client = new MongoClient(process.env.QA_MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(process.env.QA_DB_NAME || 'liferpg_qa');

    await db.collection('test_runs').createIndex({ startedAt: -1 });
    await db.collection('test_runs').createIndex({ environment: 1, startedAt: -1 });

    await db.collection('test_results').createIndex({ runId: 1 });
    await db.collection('test_results').createIndex({ request: 1, createdAt: -1 });
    // El detalle por petición se borra solo pasados N días; el resumen de cada corrida se conserva.
    await db.collection('test_results').createIndex({ createdAt: 1 }, { expireAfterSeconds: ttlDays * 86400 });

    console.log(`Índices listos en "${db.databaseName}" (detalle conservado ${ttlDays} días).`);
  } finally { 
    await client.close();
  }
}

main().catch((err) => {
  console.error('No se pudo preparar la base:', err.message);
  process.exitCode = 1;
});
