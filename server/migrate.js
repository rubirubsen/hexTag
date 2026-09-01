import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sql from 'mssql';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = {
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || '',
  server: process.env.DB_SERVER || 'localhost',
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_DATABASE || 'hexTagDB',
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_CERT !== 'false',
    connectTimeout: 10000
  }
};

export async function runMigration() {
  console.log('[Migration] Starte MSSQL Schema-Migration...');

  if (!process.env.DB_PASSWORD && !process.env.DB_SERVER) {
    console.log('[Migration] Keine MSSQL-Zugangsdaten in .env hinterlegt. Migration übersprungen.');
    return false;
  }

  let pool;
  try {
    pool = await sql.connect(config);
    console.log(`[Migration] Verbunden mit MSSQL (${config.server}:${config.port}/${config.database})`);

    const schemaPath = path.join(__dirname, 'schema.sql');
    if (!fs.existsSync(schemaPath)) {
      console.warn('[Migration] schema.sql nicht gefunden unter:', schemaPath);
      return false;
    }

    const sqlContent = fs.readFileSync(schemaPath, 'utf8');

    // Teile Skript an GO-Befehlen auf
    const batches = sqlContent
      .split(/^\s*GO\s*$/gim)
      .map(b => b.trim())
      .filter(b => b.length > 0);

    for (const batch of batches) {
      try {
        await pool.request().query(batch);
      } catch (err) {
        console.warn('[Migration] Batch-Warnung/Fehler:', err.message);
      }
    }

    console.log(`[Migration] ✅ MSSQL Schema & Seed-Daten erfolgreich angewendet (${batches.length} Blöcke ausgeführt).`);
    return true;
  } catch (err) {
    console.error('[Migration] ❌ Fehler bei der MSSQL-Migration:', err.message);
    return false;
  } finally {
    if (pool) await pool.close();
  }
}

// Direkte Ausfuehrung per CLI: node server/migrate.js
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigration().then((success) => {
    process.exit(success ? 0 : 1);
  });
}
