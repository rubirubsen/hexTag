import sql from 'mssql';
import dotenv from 'dotenv';

dotenv.config();

const config = {
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || '',
  server: process.env.DB_SERVER || 'localhost',
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_DATABASE || 'hexTagDB',
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_CERT !== 'false',
    connectTimeout: 8000
  }
};

let pool = null;
let isConnected = false;

export async function initDatabase() {
  if (!process.env.DB_PASSWORD && !process.env.DB_SERVER) {
    console.log('[Database] Keine MSSQL-Zugangsdaten in .env hinterlegt. Nutze In-Memory Fallback.');
    return false;
  }

  try {
    pool = await sql.connect(config);
    isConnected = true;
    console.log(`[Database] Erfolgreich mit Microsoft SQL Server verbunden: ${config.server}:${config.port}/${config.database}`);

    await createTables();
    return true;
  } catch (err) {
    console.warn(`[Database] Verbindung zu MSSQL (${config.server}) fehlgeschlagen:`, err.message);
    console.log('[Database] Wechsle in In-Memory / Offline Modus.');
    isConnected = false;
    return false;
  }
}

async function createTables() {
  if (!pool) return;

  const createQuery = `
    -- Users Table
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Users' and xtype='U')
    CREATE TABLE Users (
      id NVARCHAR(64) PRIMARY KEY,
      username NVARCHAR(64) NOT NULL,
      email NVARCHAR(128),
      avatar_url NVARCHAR(256),
      sso_provider NVARCHAR(32),
      sso_id NVARCHAR(128),
      color NVARCHAR(16) DEFAULT '#ff8000',
      xp INT DEFAULT 0,
      level INT DEFAULT 1,
      created_at BIGINT
    );

    -- Captured Hex Zones Table
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='HexZones' and xtype='U')
    CREATE TABLE HexZones (
      hex_id NVARCHAR(32) PRIMARY KEY,
      owner_id NVARCHAR(64),
      owner_name NVARCHAR(64),
      color NVARCHAR(16),
      captured_at BIGINT,
      total_held_seconds INT DEFAULT 0
    );

    -- Graffiti Tags Table
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='GraffitiTags' and xtype='U')
    CREATE TABLE GraffitiTags (
      id NVARCHAR(64) PRIMARY KEY,
      hex_id NVARCHAR(32),
      user_id NVARCHAR(64),
      author NVARCHAR(64),
      color NVARCHAR(16),
      lat FLOAT,
      lng FLOAT,
      image_data NVARCHAR(MAX),
      created_at BIGINT
    );

    -- Player HQs Table
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='PlayerHQs' and xtype='U')
    CREATE TABLE PlayerHQs (
      id NVARCHAR(64) PRIMARY KEY,
      user_id NVARCHAR(64),
      hex_id NVARCHAR(32),
      lat FLOAT,
      lng FLOAT,
      name NVARCHAR(64),
      color NVARCHAR(16),
      created_at BIGINT
    );
  `;

  try {
    await pool.request().query(createQuery);
    console.log('[Database] MSSQL Tabellen (Users, HexZones, GraffitiTags, PlayerHQs) verifiziert / angelegt.');
  } catch (err) {
    console.error('[Database] Fehler beim Anlegen der Tabellen:', err.message);
  }
}

export function getPool() {
  return pool;
}

export function isDbConnected() {
  return isConnected;
}
