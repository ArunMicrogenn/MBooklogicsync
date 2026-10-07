/**
 * ====================================================================================================
 * BOOKLOGIC REPLICATION ENGINE: DEDICATED VPS (BOOKLOGIC) ⇄ LOCAL MSSQL (varanashiinn)
 * ====================================================================================================
 * Remote VPS: 72.61.240.34 | Target Database: BOOKLOGIC (Strictly Dedicated)
 * Local Host: DESKTOP-VDGDM3P | Target Database: varanashiinn
 *
 * Inbound Sync (VPS PostgreSQL BOOKLOGIC ➔ Local SQL Server varanashiinn):
 *   1. dbo.reservations_booklogic (Master Reservation)
 *   2. dbo.reservations_details_booklogic (Room & Rate Breakdown linked by Res_id)
 *   3. dbo.Reservation_PerDay_details_Booklogic (Per-Day Rate/Date details linked by Res_id)
 *   4. dbo.reservation_Customer_booklogic (Guest / Customer details linked by Res_id)
 *
 * Outbound Sync (Local SQL Server varanashiinn ➔ VPS PostgreSQL BOOKLOGIC):
 *   1. dbo.trans_roomavailability_chart_datewise ➔ public.trans_roomavailability_chart_datewise
 *   2. dbo.trans_roomrateupdates_datewise ➔ public.trans_roomrateupdates_datewise
 * ====================================================================================================
 */

// Compatibility polyfill for Node.js < 14.18 (Windows 7 / legacy environments)
// Resolves 'node:events', 'node:stream', 'node:fs', etc. to core modules 'events', 'stream', 'fs'
const Module = require('module');
if (Module && Module.prototype) {
  const originalRequire = Module.prototype.require;
  Module.prototype.require = function (moduleName) {
    if (typeof moduleName === 'string' && moduleName.startsWith('node:')) {
      return originalRequire.call(this, moduleName.slice(5));
    }
    return originalRequire.apply(this, arguments);
  };
}

require('dotenv').config();
const sql = require('mssql');
const { Pool, Client } = require('pg');

// --------------------------------------------------------------------------------------
// CONFIGURATION & PARSING
// --------------------------------------------------------------------------------------
function parseCliArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--hotelcode=') || arg.startsWith('--hotel=') || arg.startsWith('--hotel_code=')) {
      parsed.hotelCode = arg.split('=')[1];
    } else if (arg === '--hotelcode' || arg === '--hotel' || arg === '-h') {
      parsed.hotelCode = args[i + 1];
    } else if (arg.startsWith('--database=') || arg.startsWith('--db=')) {
      parsed.database = arg.split('=')[1];
    } else if (arg === '--database' || arg === '--db' || arg === '-d') {
      parsed.database = args[i + 1];
    } else if (arg.startsWith('--server=') || arg.startsWith('--host=')) {
      parsed.server = arg.split('=')[1];
    } else if (arg === '--server' || arg === '--host' || arg === '-s') {
      parsed.server = args[i + 1];
    } else if (arg.startsWith('--user=') || arg.startsWith('--username=')) {
      parsed.user = arg.split('=')[1];
    } else if (arg === '--user' || arg === '-u') {
      parsed.user = args[i + 1];
    } else if (arg.startsWith('--password=') || arg.startsWith('--pass=')) {
      parsed.password = arg.split('=')[1];
    } else if (arg === '--password' || arg === '-p') {
      parsed.password = args[i + 1];
    } else if (arg.startsWith('--port=') || arg.startsWith('-P=')) {
      parsed.port = arg.split('=')[1];
    } else if (arg === '--port' || arg === '-P') {
      parsed.port = args[i + 1];
    } else if (arg.startsWith('--repush=') || arg.startsWith('--res_id=') || arg.startsWith('--booking_id=')) {
      parsed.repush = arg.split('=')[1];
    } else if (arg === '--repush' || arg === '--res_id' || arg === '-r') {
      parsed.repush = args[i + 1] || 'all';
    }
  }
  return parsed;
}

const cliArgs = parseCliArgs();
let CONFIGURED_HOTEL_CODE = (cliArgs.hotelCode || process.env.HOTEL_CODE || process.env.HOTELCODE || process.env.HOTEL_ID || '').trim();
let REPUSH_BOOKING_TARGET = (cliArgs.repush || '').trim();
let cachedDiscoveredHotelCodes = null;

function parseSqlServerServer(rawServer, rawPort) {
  let serverStr = (rawServer || process.env.MSSQL_SERVER || 'NEWSERVER\\SQLEXPRESS').trim();
  let instanceName = undefined;
  let port = rawPort ? parseInt(rawPort, 10) : undefined;

  if (serverStr.includes('\\')) {
    const parts = serverStr.split('\\');
    serverStr = parts[0] || 'NEWSERVER';
    instanceName = parts[1] || 'SQLEXPRESS';
  }
  return { server: serverStr, instanceName, port };
}

const MSSQL_USER = cliArgs.user || process.env.MSSQL_USER || 'sa';
const MSSQL_PASSWORD = cliArgs.password || process.env.MSSQL_PASSWORD || 'mgenn@123';
const MSSQL_SERVER_INPUT = cliArgs.server || process.env.MSSQL_SERVER || process.env.MSSQL_HOST || 'NEWSERVER\\SQLEXPRESS';
const MSSQL_DATABASE_INPUT = cliArgs.database || process.env.MSSQL_DATABASE || 'gowtham';

const parsedMssql = parseSqlServerServer(MSSQL_SERVER_INPUT, cliArgs.port || process.env.MSSQL_PORT);

const PG_HOST = process.env.PG_HOST || process.env.POSTGRES_HOST || '72.61.240.34';
const PG_PORT = parseInt(process.env.PG_PORT || process.env.POSTGRES_PORT || '5432', 10);
const PG_USER = process.env.PG_USER || process.env.POSTGRES_USER || 'postgres';
const PG_PASSWORD = process.env.PG_PASSWORD || process.env.POSTGRES_PASSWORD || 'mgenn';
const PG_DATABASE = process.env.PG_DATABASE || process.env.POSTGRES_DB || 'BOOKLOGIC';

const SYNC_INTERVAL_MS = parseInt(process.env.SYNC_INTERVAL_MS || '3000', 10);

let mssqlPool = null;
let pgPool = null;

let pgReservationHotelCol = '"Hotel_Code"';
let pgReservationUpdateFlagCol = '"Updateflag"';
let pgReservationIdCol = '"Res_id"';

// Discovered remote table identifiers in PostgreSQL BOOKLOGIC database
let pgTables = {
  reservations: '"public"."Reservations"',
  details: '"public"."Reservations_details"',
  perday: '"public"."Reservation_PerDay_details"',
  customer: '"public"."Reservation_Customer"',
  availability: '"public"."trans_roomavailability_chart_datewise"',
  rateupdates: '"public"."trans_roomrateupdates_datewise"'
};

// Cached SQL Server column dictionaries to ensure ZERO "Invalid Column" errors
const mssqlColumns = {
  master: new Map(),
  details: new Map(),
  perday: new Map(),
  customer: new Map(),
  availability: new Map(),
  rateupdates: new Map()
};

let isSyncRunning = false;
let cycleCount = 0;

// --------------------------------------------------------------------------------------
// HELPER LOGGING & UTILS
// --------------------------------------------------------------------------------------
function log(level, message, data = '') {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const prefix = {
    info: '[\x1b[36mINFO\x1b[0m]',
    success: '[\x1b[32mOK\x1b[0m]',
    warn: '[\x1b[33mWARN\x1b[0m]',
    error: '[\x1b[31mERROR\x1b[0m]',
    outbound: '[\x1b[35mOUTBOUND ➔ PG\x1b[0m]',
    inbound: '[\x1b[34mINBOUND ➔ MSSQL\x1b[0m]',
    diag: '[\x1b[33mDIAGNOSTIC\x1b[0m]',
  }[level] || `[${level.toUpperCase()}]`;

  console.log(`[${timestamp}] ${prefix} ${message}`, data ? data : '');
}

function safeDate(val) {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === 'string') {
    const s = val.trim();
    if (!s) return null;
    // Check for DD/MM/YYYY or DD-MM-YYYY
    const ddmmyyyy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(.*)$/);
    if (ddmmyyyy) {
      const day = parseInt(ddmmyyyy[1], 10);
      const month = parseInt(ddmmyyyy[2], 10) - 1;
      const year = parseInt(ddmmyyyy[3], 10);
      const rest = (ddmmyyyy[4] || '').trim();
      if (rest) {
        const timeParts = rest.split(':');
        const hour = parseInt(timeParts[0] || '0', 10);
        const min = parseInt(timeParts[1] || '0', 10);
        const sec = parseInt(timeParts[2] || '0', 10);
        return new Date(Date.UTC(year, month, day, hour, min, sec));
      }
      return new Date(Date.UTC(year, month, day, 0, 0, 0));
    }
  }
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function safeNum(val, defaultVal = 0) {
  if (val === null || val === undefined || val === '') return defaultVal;
  const n = Number(val);
  return isNaN(n) ? defaultVal : n;
}

function getVal(row, ...keys) {
  if (!row) return null;
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null) return row[k];
    const lk = k.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const rk of Object.keys(row)) {
      if (rk.toLowerCase().replace(/[^a-z0-9]/g, '') === lk && row[rk] !== undefined && row[rk] !== null) {
        return row[rk];
      }
    }
  }
  return null;
}

const os = require('os');
const net = require('net');

function probePort(host, port, timeoutMs = 300) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let settled = false;
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(true);
      }
    });
    socket.on('timeout', () => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(false);
      }
    });
    socket.on('error', () => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(false);
      }
    });
    try {
      socket.connect(port, host);
    } catch (e) {
      resolve(false);
    }
  });
}

// --------------------------------------------------------------------------------------
// LOCAL SQL SERVER INITIALIZATION & COLUMN DISCOVERY
// --------------------------------------------------------------------------------------
async function connectToSqlServer() {
  const attempts = [];
  const localHostName = os.hostname();
  const instName = parsedMssql.instanceName || 'SQLEXPRESS';

  // Attempt 1: Direct configured server & instance
  attempts.push({
    label: parsedMssql.instanceName ? `'${parsedMssql.server}\\${parsedMssql.instanceName}'` : `'${parsedMssql.server}' (port: ${parsedMssql.port || 1433})`,
    cfg: {
      user: MSSQL_USER,
      password: MSSQL_PASSWORD,
      server: parsedMssql.server,
      database: MSSQL_DATABASE_INPUT,
      port: parsedMssql.port,
      options: {
        instanceName: parsedMssql.instanceName,
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true,
        connectTimeout: 4000,
        requestTimeout: 25000,
      },
    }
  });

  // Attempt 2: Local hostname dynamically detected (e.g. ADMIN-PC\SQLEXPRESS)
  if (localHostName && localHostName.toLowerCase() !== parsedMssql.server.toLowerCase()) {
    attempts.push({
      label: `'${localHostName}\\${instName}'`,
      cfg: {
        user: MSSQL_USER,
        password: MSSQL_PASSWORD,
        server: localHostName,
        database: MSSQL_DATABASE_INPUT,
        options: {
          instanceName: instName,
          encrypt: false,
          trustServerCertificate: true,
          enableArithAbort: true,
          connectTimeout: 4000,
          requestTimeout: 25000,
        },
      }
    });
  }

  // Attempt 3: localhost\SQLEXPRESS & 127.0.0.1\SQLEXPRESS
  attempts.push({
    label: `'localhost\\${instName}'`,
    cfg: {
      user: MSSQL_USER,
      password: MSSQL_PASSWORD,
      server: 'localhost',
      database: MSSQL_DATABASE_INPUT,
      options: {
        instanceName: instName,
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true,
        connectTimeout: 4000,
        requestTimeout: 25000,
      },
    }
  });

  attempts.push({
    label: `'127.0.0.1\\${instName}'`,
    cfg: {
      user: MSSQL_USER,
      password: MSSQL_PASSWORD,
      server: '127.0.0.1',
      database: MSSQL_DATABASE_INPUT,
      options: {
        instanceName: instName,
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true,
        connectTimeout: 4000,
        requestTimeout: 25000,
      },
    }
  });

  // Attempt 4: Standard Port 1433 fallback (127.0.0.1, localhost, localHostName)
  attempts.push({
    label: `'127.0.0.1' on standard port 1433`,
    cfg: {
      user: MSSQL_USER,
      password: MSSQL_PASSWORD,
      server: '127.0.0.1',
      database: MSSQL_DATABASE_INPUT,
      port: 1433,
      options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true,
        connectTimeout: 4000,
        requestTimeout: 25000,
      },
    }
  });

  attempts.push({
    label: `'localhost' on standard port 1433`,
    cfg: {
      user: MSSQL_USER,
      password: MSSQL_PASSWORD,
      server: 'localhost',
      database: MSSQL_DATABASE_INPUT,
      port: 1433,
      options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true,
        connectTimeout: 4000,
        requestTimeout: 25000,
      },
    }
  });

  if (parsedMssql.server.toLowerCase() !== '127.0.0.1' && parsedMssql.server.toLowerCase() !== 'localhost') {
    attempts.push({
      label: `'${parsedMssql.server}' on port 1433`,
      cfg: {
        user: MSSQL_USER,
        password: MSSQL_PASSWORD,
        server: parsedMssql.server,
        database: MSSQL_DATABASE_INPUT,
        port: 1433,
        options: {
          encrypt: false,
          trustServerCertificate: true,
          enableArithAbort: true,
          connectTimeout: 4000,
          requestTimeout: 25000,
        },
      }
    });
  }

  let pool = null;
  let lastErr = null;

  for (const attempt of attempts) {
    try {
      log('info', `Connecting to SQL Server via ${attempt.label} (Database: ${MSSQL_DATABASE_INPUT})...`);
      pool = await sql.connect(attempt.cfg);
      log('success', `✅ Connected successfully to SQL Server via ${attempt.label}!`);
      break;
    } catch (err) {
      lastErr = err;
      log('warn', `Could not connect via ${attempt.label}: ${err.message}`);
    }
  }

  // Attempt 5: Auto-probe listening ports if SQL Server Express dynamic port is active
  if (!pool) {
    log('info', `Scanning active local ports for SQL Server dynamic instance...`);
    const candidatePorts = [1433, 1434, 14333, 49152, 49153, 49154, 49155, 49156, 49157, 49158, 49159, 49160, 49161, 49162, 49163, 49164, 49165, 50000, 50001, 51234, 52345, 53456, 54321, 55555];
    const openPorts = [];

    for (const p of candidatePorts) {
      const isOpen = await probePort('127.0.0.1', p, 150);
      if (isOpen) openPorts.push(p);
    }

    if (openPorts.length > 0) {
      log('info', `Discovered open local ports: [${openPorts.join(', ')}]. Testing SQL Server handshake...`);
      for (const p of openPorts) {
        try {
          const cfg = {
            user: MSSQL_USER,
            password: MSSQL_PASSWORD,
            server: '127.0.0.1',
            database: MSSQL_DATABASE_INPUT,
            port: p,
            options: {
              encrypt: false,
              trustServerCertificate: true,
              enableArithAbort: true,
              connectTimeout: 3000,
              requestTimeout: 25000,
            },
          };
          pool = await sql.connect(cfg);
          log('success', `✅ Connected successfully to SQL Server on discovered port ${p}!`);
          break;
        } catch (portErr) {
          log('warn', `Port ${p} responded but SQL login failed: ${portErr.message}`);
        }
      }
    }
  }

  if (!pool) {
    log('error', `❌ All connection attempts to SQL Server [${MSSQL_SERVER_INPUT}] failed.`);
    log('diag', `Troubleshooting checklist for "${MSSQL_SERVER_INPUT}":`);
    log('diag', `1. Start SQL Server Browser Service:`);
    log('diag', `   - Press Win+R -> services.msc -> find "SQL Server Browser" -> Start it & set Startup Type to Automatic.`);
    log('diag', `2. Enable TCP/IP in SQL Server:`);
    log('diag', `   - Open "SQL Server Configuration Manager"`);
    log('diag', `   - Go to "SQL Server Network Configuration" -> "Protocols for SQLEXPRESS"`);
    log('diag', `   - Right-click "TCP/IP" -> Select "Enable"`);
    log('diag', `   - Double-click "TCP/IP" -> Go to "IP Addresses" tab -> Scroll to bottom "IPAll" -> Set "TCP Port" to 1433 and clear "TCP Dynamic Ports"`);
    log('diag', `   - Go to "SQL Server Services" -> Right-click "SQL Server (SQLEXPRESS)" -> Restart.`);
    log('diag', `3. Verify SQL Server Auth:`);
    log('diag', `   - Make sure SQL Server is in "SQL Server and Windows Authentication mode" in SSMS Properties -> Security.`);
    log('diag', `   - Verify user '${MSSQL_USER}' password.`);
    throw lastErr;
  }

  // Ensure local child tables and outbound tables exist if missing
  try {
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='reservations_booklogic' AND xtype='U')
      CREATE TABLE dbo.reservations_booklogic (
          resbkid BIGINT IDENTITY(1,1) PRIMARY KEY,
          Res_id BIGINT UNIQUE,
          Hotel_Code NVARCHAR(100),
          Booking_Id NVARCHAR(150),
          syncType NVARCHAR(50),
          PnrID NVARCHAR(100),
          ExternalReference NVARCHAR(150),
          ExternalReservationRoomId NVARCHAR(150),
          ExternalReservationId NVARCHAR(150),
          Service NVARCHAR(100),
          TravelagentName NVARCHAR(150),
          UpdateDate DATETIME,
          modifyDate DATETIME,
          cancelDate DATETIME,
          Currency NVARCHAR(10),
          Status NVARCHAR(50),
          Adult INT,
          ChildB INT,
          ChildA INT,
          Infant INT,
          Remarks NVARCHAR(MAX),
          Insertdate DATETIME,
          MarkSend INT DEFAULT 1,
          Updateflag INT DEFAULT 1,
          synced_at DATETIME DEFAULT GETDATE()
      );

      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='reservations_details_booklogic' AND xtype='U')
      CREATE TABLE dbo.reservations_details_booklogic (
          detail_id BIGINT PRIMARY KEY,
          Res_id BIGINT,
          Roomtypeid BIGINT,
          Room_Type_Name NVARCHAR(150),
          Rooms_Booked INT DEFAULT 1,
          Rate_Plan_Code NVARCHAR(50) DEFAULT 'BAR',
          Price_Per_Night DECIMAL(18,2) DEFAULT 0.00,
          Tax_Amount DECIMAL(18,2) DEFAULT 0.00,
          Meal_Plan NVARCHAR(50) DEFAULT 'EP',
          Adult INT DEFAULT 1,
          Child INT DEFAULT 0,
          Nights INT DEFAULT 1,
          Check_In DATETIME,
          Check_Out DATETIME,
          synced_at DATETIME DEFAULT GETDATE()
      );

      IF NOT EXISTS (SELECT * FROM sysobjects WHERE (name='Reservation_PerDay_details_Booklogic' OR name='reservation_perday_details_booklogic') AND xtype='U')
      CREATE TABLE dbo.Reservation_PerDay_details_Booklogic (
          perday_id BIGINT PRIMARY KEY,
          Res_id BIGINT,
          detail_id BIGINT,
          Rate_Date DATETIME,
          Roomtypeid BIGINT,
          Room_Rate DECIMAL(18,2) DEFAULT 0.00,
          Tax_Amount DECIMAL(18,2) DEFAULT 0.00,
          Total_Amount DECIMAL(18,2) DEFAULT 0.00,
          synced_at DATETIME DEFAULT GETDATE()
      );

      IF NOT EXISTS (SELECT * FROM sysobjects WHERE (name='reservation_Customer_booklogic' OR name='reservation_customer_booklogic') AND xtype='U')
      CREATE TABLE dbo.reservation_Customer_booklogic (
          customer_id BIGINT PRIMARY KEY,
          Res_id BIGINT,
          First_Name NVARCHAR(100),
          Last_Name NVARCHAR(100),
          Customer_Name NVARCHAR(200),
          Phone NVARCHAR(100),
          Email NVARCHAR(200),
          Address NVARCHAR(MAX),
          City NVARCHAR(100),
          Country NVARCHAR(100) DEFAULT 'India',
          Id_Proof_Type NVARCHAR(50) DEFAULT 'PASSPORT',
          Id_Proof_Number NVARCHAR(100),
          synced_at DATETIME DEFAULT GETDATE()
      );

      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='trans_roomavailability_chart_datewise' AND xtype='U')
      CREATE TABLE dbo.trans_roomavailability_chart_datewise (
          avaidd BIGINT PRIMARY KEY,
          Roomtypeid BIGINT,
          fromdate DATETIME,
          todate DATETIME,
          Availablerooms INT DEFAULT 0,
          uploadflg INT DEFAULT 0,
          notupload INT DEFAULT 0,
          Remarks NVARCHAR(MAX),
          Fromtime DATETIME,
          Totime DATETIME,
          allotcode NVARCHAR(100),
          hotelcode NVARCHAR(100),
          IRM_Update INT DEFAULT 0,
          stopsales INT DEFAULT 0,
          _last_updated DATETIME DEFAULT GETDATE()
      );
    `);
  } catch (e) {
    log('warn', `Table structure check note: ${e.message}`);
  }

  // Load exact table column names and identity flags from SQL Server
  await loadSqlServerTableMetadata(pool);

  return pool;
}

async function loadSqlServerTableMetadata(pool) {
  try {
    const colRes = await pool.request().query(`
      SELECT 
        c.TABLE_NAME, 
        c.COLUMN_NAME, 
        c.DATA_TYPE,
        c.CHARACTER_MAXIMUM_LENGTH,
        COLUMNPROPERTY(OBJECT_ID(c.TABLE_SCHEMA + '.' + c.TABLE_NAME), c.COLUMN_NAME, 'IsIdentity') AS is_identity
      FROM INFORMATION_SCHEMA.COLUMNS c
      WHERE c.TABLE_NAME IN (
        'reservations_booklogic',
        'reservations_details_booklogic', 'reservations_details',
        'Reservation_PerDay_details_Booklogic', 'Reservation_PerDay_details_booklogic', 'reservation_perday_details_booklogic', 'reservation_perday_details',
        'reservation_Customer_booklogic', 'reservation_customer_booklogic', 'reservation_customer',
        'trans_roomavailability_chart_datewise',
        'trans_roomrateupdates_datewise'
      )
    `);

    mssqlColumns.master.clear();
    mssqlColumns.details.clear();
    mssqlColumns.perday.clear();
    mssqlColumns.customer.clear();
    mssqlColumns.availability.clear();
    mssqlColumns.rateupdates.clear();

    for (const r of colRes.recordset) {
      const tbl = r.TABLE_NAME.toLowerCase();
      const colName = r.COLUMN_NAME;
      const isIdent = r.is_identity === 1;
      const dataType = r.DATA_TYPE.toLowerCase();
      const maxLen = r.CHARACTER_MAXIMUM_LENGTH !== null && r.CHARACTER_MAXIMUM_LENGTH !== undefined ? Number(r.CHARACTER_MAXIMUM_LENGTH) : null;
      const info = { name: colName, isIdentity: isIdent, dataType, maxLength: maxLen };

      if (tbl.includes('detail') && tbl.includes('perday')) {
        mssqlColumns.perday.set(colName.toLowerCase(), info);
      } else if (tbl.includes('detail')) {
        mssqlColumns.details.set(colName.toLowerCase(), info);
      } else if (tbl.includes('customer')) {
        mssqlColumns.customer.set(colName.toLowerCase(), info);
      } else if (tbl.includes('reservation') && !tbl.includes('detail') && !tbl.includes('customer') && !tbl.includes('perday')) {
        mssqlColumns.master.set(colName.toLowerCase(), info);
      } else if (tbl.includes('roomavailability')) {
        mssqlColumns.availability.set(colName.toLowerCase(), info);
      } else if (tbl.includes('roomrate')) {
        mssqlColumns.rateupdates.set(colName.toLowerCase(), info);
      }
    }

    log('info', `Discovered Local SQL Server Schema: Master (${mssqlColumns.master.size} cols), Details (${mssqlColumns.details.size} cols), PerDay (${mssqlColumns.perday.size} cols), Customer (${mssqlColumns.customer.size} cols).`);
  } catch (err) {
    log('warn', `Metadata inspection note: ${err.message}`);
  }
}

// --------------------------------------------------------------------------------------
// VPS POSTGRESQL (STRICTLY BOOKLOGIC DATABASE) INITIALIZATION
// --------------------------------------------------------------------------------------
async function connectToPostgresBooklogic() {
  log('info', `Connecting strictly to VPS PostgreSQL Database "${PG_DATABASE}" at ${PG_HOST}:${PG_PORT}...`);

  if (pgPool) {
    try { await pgPool.end(); } catch (e) {}
  }

  pgPool = new Pool({
    host: PG_HOST,
    port: PG_PORT,
    database: PG_DATABASE, // Strictly BOOKLOGIC
    user: PG_USER,
    password: PG_PASSWORD,
    ssl: false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  let client = null;
  try {
    client = await pgPool.connect();
    log('success', `Connected strictly to VPS PostgreSQL Database: "${PG_DATABASE}" (${PG_HOST}:${PG_PORT}).`);

    // Introspect tables inside BOOKLOGIC database
    const tRes = await client.query(`
      SELECT table_name, table_schema
      FROM information_schema.tables 
      WHERE table_schema IN ('public')
      ORDER BY table_name;
    `);

    const tableList = tRes.rows.map(r => r.table_name);
    log('diag', `Tables found in VPS BOOKLOGIC: [${tableList.join(', ')}]`);

    // Strictly filter out log / audit tables
    const nonLogTables = tRes.rows.filter(t => {
      const lower = t.table_name.toLowerCase();
      return !lower.includes('log') && !lower.endsWith('_log') && !lower.startsWith('log_');
    });

    log('info', `Operational Tables (excluding _log): [${nonLogTables.map(r => r.table_name).join(', ')}]`);

    // Helper to pick best table between candidates by row count / presence
    async function resolveBestTable(candidates, defaultFallback) {
      if (!candidates || candidates.length === 0) return defaultFallback;
      if (candidates.length === 1) return `"${candidates[0].table_schema}"."${candidates[0].table_name}"`;

      let best = `"${candidates[0].table_schema}"."${candidates[0].table_name}"`;
      let maxCount = -1;
      for (const c of candidates) {
        const full = `"${c.table_schema}"."${c.table_name}"`;
        try {
          const r = await client.query(`SELECT COUNT(*) as count FROM ${full}`);
          const count = parseInt(r.rows[0].count, 10);
          if (count > maxCount) {
            maxCount = count;
            best = full;
          }
        } catch (e) {}
      }
      return best;
    }

    const resCandidates = nonLogTables.filter(t => {
      const lower = t.table_name.toLowerCase();
      return lower === 'reservations' || lower === 'reservations_booklogic' || 
        (lower.includes('reservation') && !lower.includes('detail') && !lower.includes('customer') && !lower.includes('perday'));
    });
    pgTables.reservations = await resolveBestTable(resCandidates, '"public"."Reservations"');

    const detailCandidates = nonLogTables.filter(t => {
      const lower = t.table_name.toLowerCase();
      return (lower.includes('detail') || lower.includes('resevation_detail')) && !lower.includes('perday') && !lower.includes('per_day');
    });
    pgTables.details = await resolveBestTable(detailCandidates, '"public"."Reservations_details"');

    const perdayCandidates = nonLogTables.filter(t => {
      const lower = t.table_name.toLowerCase();
      return lower.includes('perday') || lower.includes('per_day');
    });
    pgTables.perday = await resolveBestTable(perdayCandidates, '"public"."Reservation_PerDay_details"');

    const custCandidates = nonLogTables.filter(t => {
      const lower = t.table_name.toLowerCase();
      return lower.includes('customer') || lower.includes('guest');
    });
    pgTables.customer = await resolveBestTable(custCandidates, '"public"."Reservation_Customer"');

    const availCandidates = nonLogTables.filter(t => t.table_name.toLowerCase().includes('roomavailability'));
    pgTables.availability = await resolveBestTable(availCandidates, '"public"."trans_roomavailability_chart_datewise"');

    const rateCandidates = nonLogTables.filter(t => t.table_name.toLowerCase().includes('roomrate'));
    pgTables.rateupdates = await resolveBestTable(rateCandidates, '"public"."trans_roomrateupdates_datewise"');

    log('info', `Target PostgreSQL [${PG_DATABASE}] Table Mapping:`);
    log('info', ` - Master Reservations : ${pgTables.reservations}`);
    log('info', ` - Details Table       : ${pgTables.details}`);
    log('info', ` - PerDay Table        : ${pgTables.perday}`);
    log('info', ` - Customer Table      : ${pgTables.customer}`);
    log('info', ` - Room Availability   : ${pgTables.availability}`);
    log('info', ` - Room Rate Updates   : ${pgTables.rateupdates}`);

    // Discover column names in Master Reservations table
    try {
      const cleanTblName = pgTables.reservations.replace(/"/g, '').replace('public.', '');
      const rawCols = await client.query(`
        SELECT column_name
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = $1
      `, [cleanTblName]);
      const colNames = rawCols.rows.map(r => r.column_name);

      const hotelCol = colNames.find(c => c.toLowerCase().replace(/[^a-z0-9]/g, '') === 'hotelcode');
      if (hotelCol) pgReservationHotelCol = `"${hotelCol}"`;

      const flagCol = colNames.find(c => c.toLowerCase().replace(/[^a-z0-9]/g, '') === 'updateflag');
      if (flagCol) pgReservationUpdateFlagCol = `"${flagCol}"`;

      const idCol = colNames.find(c => c.toLowerCase().replace(/[^a-z0-9]/g, '') === 'resid' || c.toLowerCase() === 'id');
      if (idCol) pgReservationIdCol = `"${idCol}"`;

      log('info', `Target Master Reservation Schema: ID=${pgReservationIdCol}, Hotel=${pgReservationHotelCol}, UpdateFlag=${pgReservationUpdateFlagCol}`);
    } catch (e) {
      log('warn', `Column introspection note: ${e.message}`);
    }

    // Ensure outbound tables exist in PostgreSQL
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.trans_roomavailability_chart_datewise (
        avaidd BIGINT PRIMARY KEY,
        roomtypeid BIGINT,
        fromdate TIMESTAMP,
        todate TIMESTAMP,
        availablerooms INT DEFAULT 0,
        uploadflg INT DEFAULT 1,
        notupload VARCHAR(50),
        remarks TEXT,
        fromtime TIMESTAMP,
        totime TIMESTAMP,
        allotcode VARCHAR(50),
        hotelcode VARCHAR(50),
        irm_update INT DEFAULT 0,
        stopsales INT DEFAULT 0,
        last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS public.trans_roomrateupdates_datewise (
        id BIGSERIAL PRIMARY KEY,
        rateid BIGINT,
        roomtypeid BIGINT,
        fromdate TIMESTAMP,
        todate TIMESTAMP,
        singlerate DECIMAL(18,2) DEFAULT 0.00,
        doublerate DECIMAL(18,2) DEFAULT 0.00,
        triplerate DECIMAL(18,2) DEFAULT 0.00,
        quadrate DECIMAL(18,2) DEFAULT 0.00,
        extrabed DECIMAL(18,2) DEFAULT 0.00,
        childrate DECIMAL(18,2) DEFAULT 0.00,
        hotelcode VARCHAR(50),
        rateplancode VARCHAR(50),
        uploadflg INT DEFAULT 1,
        last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

  } catch (err) {
    log('error', `VPS PostgreSQL BOOKLOGIC error: ${err.message}`);
    throw err;
  } finally {
    if (client) client.release();
  }
}

// --------------------------------------------------------------------------------------
// DYNAMIC SQL SERVER UPSERT HELPER (METADATA-DRIVEN, ZERO INVALID COLUMN ERRORS)
// --------------------------------------------------------------------------------------
/**
 * Dynamically upserts a record into a local SQL Server table using only columns discovered in INFORMATION_SCHEMA.
 * Automatically respects IDENTITY columns, matches field names case-insensitively,
 * and sets audit/sync timestamps only when available in local schema.
 */
async function upsertMssqlRecord(tableName, colMap, pkCandidates, data) {
  if (!colMap || colMap.size === 0) {
    throw new Error(`Table ${tableName} has no discovered columns in local SQL Server metadata.`);
  }

  // 1. Identify primary key column
  let actualPkCol = null;
  let pkValue = null;
  for (const pk of pkCandidates) {
    const pkLower = pk.toLowerCase();
    if (colMap.has(pkLower)) {
      actualPkCol = colMap.get(pkLower).name;
      pkValue = getVal(data, pk, pkLower);
      if (pkValue !== null && pkValue !== undefined) break;
    }
  }

  const req = mssqlPool.request();
  const insertCols = [];
  const insertParams = [];
  const updateSets = [];

  let paramIndex = 0;
  for (const [colLower, colInfo] of colMap.entries()) {
    const colName = colInfo.name;
    const isIdent = colInfo.isIdentity;
    const dataType = (colInfo.dataType || '').toLowerCase();

    // Skip identity column for INSERT and UPDATE
    if (isIdent) continue;

    // Get value from data
    let val = getVal(data, colName, colLower);

    // Dynamic timestamp and flag mapping (only populated if column actually exists!)
    if (colLower === 'synced_at' || colLower === '_synced_at' || colLower === 'last_synced_at' || colLower === 'modified_at' || colLower === '_last_updated') {
      val = new Date();
    } else if (colLower === 'created_at' || colLower === 'insertdate') {
      if (!val) val = new Date();
    } else if (colLower === 'updateflag' || colLower === 'update_flag' || colLower === 'uploadflg') {
      if (val === null || val === undefined) val = 1;
    } else if (colLower === 'marksend') {
      if (val === null || val === undefined) val = 1;
    }

    // Default value if null/undefined for non-nullable/common fields
    if (val === undefined || val === null) {
      if (dataType.includes('int') || dataType.includes('numeric') || dataType.includes('decimal') || dataType.includes('float') || dataType.includes('money')) {
        val = 0;
      } else if (dataType.includes('date') || dataType.includes('time')) {
        val = null;
      } else if (dataType.includes('bit')) {
        val = 0;
      } else {
        val = '';
      }
    }

    // Assign appropriate SQL type and truncate strings if length exceeds column size
    let sqlType = sql.NVarChar(sql.MAX);
    if (dataType.includes('bigint')) {
      sqlType = sql.BigInt;
      val = safeNum(val, 0);
    } else if (dataType.includes('int') || dataType.includes('smallint') || dataType.includes('tinyint')) {
      sqlType = sql.Int;
      val = safeNum(val, 0);
    } else if (dataType.includes('decimal') || dataType.includes('numeric') || dataType.includes('money')) {
      sqlType = sql.Decimal(18, 2);
      val = safeNum(val, 0.0);
    } else if (dataType.includes('date') || dataType.includes('time')) {
      sqlType = sql.DateTime;
      val = safeDate(val);
    } else if (dataType.includes('bit')) {
      sqlType = sql.Bit;
      val = val ? 1 : 0;
    } else {
      // String / VARCHAR / NVARCHAR types
      if (val instanceof Date) {
        val = val.toISOString().replace('T', ' ').substring(0, 19);
      } else {
        val = String(val);
      }

      // STRICT AUTO-TRUNCATION: Prevents "String or binary data would be truncated"
      const maxLen = colInfo.maxLength;
      if (maxLen && maxLen > 0 && val.length > maxLen) {
        val = val.substring(0, maxLen);
      }

      if (maxLen && maxLen > 0 && maxLen <= 4000) {
        sqlType = sql.NVarChar(maxLen);
      } else {
        sqlType = sql.NVarChar(sql.MAX);
      }
    }

    const paramName = `p_${paramIndex++}`;
    req.input(paramName, sqlType, val);

    insertCols.push(`[${colName}]`);
    insertParams.push(`@${paramName}`);

    if (!actualPkCol || colName.toLowerCase() !== actualPkCol.toLowerCase()) {
      updateSets.push(`[${colName}] = @${paramName}`);
    }
  }

  if (actualPkCol && pkValue !== null && pkValue !== undefined) {
    const pkParam = `pk_${paramIndex++}`;
    req.input(pkParam, sql.BigInt, safeNum(pkValue, 0));

    const sqlQuery = `
      IF EXISTS (SELECT 1 FROM ${tableName} WHERE [${actualPkCol}] = @${pkParam})
      BEGIN
        ${updateSets.length > 0 ? `UPDATE ${tableName} SET ${updateSets.join(', ')} WHERE [${actualPkCol}] = @${pkParam};` : '-- nothing to update'}
      END
      ELSE
      BEGIN
        INSERT INTO ${tableName} (${insertCols.join(', ')})
        VALUES (${insertParams.join(', ')});
      END
    `;
    await req.query(sqlQuery);
  } else {
    const sqlQuery = `INSERT INTO ${tableName} (${insertCols.join(', ')}) VALUES (${insertParams.join(', ')});`;
    await req.query(sqlQuery);
  }
}

// --------------------------------------------------------------------------------------
// HOTEL CODE DISCOVERY & FILTERING
// --------------------------------------------------------------------------------------
async function getActiveHotelCodes() {
  if (CONFIGURED_HOTEL_CODE && CONFIGURED_HOTEL_CODE.toUpperCase() !== 'ALL' && CONFIGURED_HOTEL_CODE !== '*') {
    return CONFIGURED_HOTEL_CODE.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  }

  if (cachedDiscoveredHotelCodes !== null) {
    return cachedDiscoveredHotelCodes;
  }

  const detected = new Set();

  // 1. PRIMARY: Query booklogichotelcode from dbo.mas_hotel in Local SQL Server
  try {
    const res = await mssqlPool.request().query(`
      SELECT booklogichotelcode 
      FROM dbo.mas_hotel 
      WHERE booklogichotelcode IS NOT NULL 
        AND LTRIM(RTRIM(CAST(booklogichotelcode AS VARCHAR(100)))) <> ''
    `);
    if (res.recordset && res.recordset.length > 0) {
      for (const row of res.recordset) {
        const val = getVal(row, 'booklogichotelcode', 'booklogic_hotelcode', 'booklogic_hotel_code', 'hotelcode');
        if (val) detected.add(String(val).trim().toUpperCase());
      }
      if (detected.size > 0) {
        log('info', `[HOTEL CONFIG] Discovered booklogichotelcode from dbo.mas_hotel: [${Array.from(detected).join(', ')}]`);
      }
    }
  } catch (e) {
    // If column name has slight variation or dynamic discovery in dbo.mas_hotel
    try {
      const res2 = await mssqlPool.request().query(`SELECT TOP 5 * FROM dbo.mas_hotel`);
      if (res2.recordset && res2.recordset.length > 0) {
        for (const row of res2.recordset) {
          const val = getVal(row, 'booklogichotelcode', 'booklogic_hotelcode', 'booklogic_hotel_code', 'hotelcode', 'hotel_code');
          if (val) detected.add(String(val).trim().toUpperCase());
        }
        if (detected.size > 0) {
          log('info', `[HOTEL CONFIG] Discovered hotel code from dbo.mas_hotel: [${Array.from(detected).join(', ')}]`);
        }
      }
    } catch (e2) {}
  }

  // 2. Fallback: Try checking trans_roomavailability_chart_datewise
  if (detected.size === 0) {
    try {
      const res = await mssqlPool.request().query(`
        SELECT DISTINCT TOP 10 hotelcode 
        FROM dbo.trans_roomavailability_chart_datewise 
        WHERE hotelcode IS NOT NULL AND LTRIM(RTRIM(hotelcode)) <> ''
      `);
      if (res.recordset) {
        for (const row of res.recordset) {
          if (row.hotelcode) detected.add(row.hotelcode.trim().toUpperCase());
        }
      }
    } catch (e) {}
  }

  // 3. Fallback: Try checking trans_roomrateupdates_datewise
  if (detected.size === 0) {
    try {
      const res = await mssqlPool.request().query(`
        SELECT DISTINCT TOP 10 hotelcode 
        FROM dbo.trans_roomrateupdates_datewise 
        WHERE hotelcode IS NOT NULL AND LTRIM(RTRIM(hotelcode)) <> ''
      `);
      if (res.recordset) {
        for (const row of res.recordset) {
          if (row.hotelcode) detected.add(row.hotelcode.trim().toUpperCase());
        }
      }
    } catch (e) {}
  }

  // 4. Fallback: Try checking reservations_booklogic
  if (detected.size === 0) {
    try {
      const res = await mssqlPool.request().query(`
        SELECT DISTINCT TOP 10 Hotel_Code 
        FROM dbo.reservations_booklogic 
        WHERE Hotel_Code IS NOT NULL AND LTRIM(RTRIM(Hotel_Code)) <> ''
      `);
      if (res.recordset) {
        for (const row of res.recordset) {
          if (row.Hotel_Code) detected.add(row.Hotel_Code.trim().toUpperCase());
        }
      }
    } catch (e) {}
  }

  cachedDiscoveredHotelCodes = Array.from(detected);
  return cachedDiscoveredHotelCodes;
}

// --------------------------------------------------------------------------------------
// INBOUND SYNC: VPS PostgreSQL (BOOKLOGIC) ➔ Local SQL Server (varanashiinn)
// --------------------------------------------------------------------------------------
async function syncInboundReservations() {
  let pgClient = null;
  try {
    pgClient = await pgPool.connect();

    // Handle repush target if specified
    if (REPUSH_BOOKING_TARGET) {
      try {
        if (REPUSH_BOOKING_TARGET.toLowerCase() === 'all' || REPUSH_BOOKING_TARGET === '*') {
          await pgClient.query(`UPDATE ${pgTables.reservations} SET ${pgReservationUpdateFlagCol} = 0`);
          log('info', `[REPUSH] 🔄 Reset ${pgReservationUpdateFlagCol} = 0 for ALL bookings on VPS!`);
        } else {
          await pgClient.query(`
            UPDATE ${pgTables.reservations} 
            SET ${pgReservationUpdateFlagCol} = 0 
            WHERE ${pgReservationIdCol}::text = $1 OR "Booking_Id" ILIKE $2 OR booking_id ILIKE $2
          `, [REPUSH_BOOKING_TARGET, `%${REPUSH_BOOKING_TARGET}%`]);
          log('info', `[REPUSH] 🔄 Reset ${pgReservationUpdateFlagCol} = 0 for booking '${REPUSH_BOOKING_TARGET}' on VPS!`);
        }
        // Reset so it only resets once on startup
        REPUSH_BOOKING_TARGET = '';
      } catch (reErr) {
        log('warn', `Notice during repush reset on VPS: ${reErr.message}`);
      }
    }

    const activeHotelCodes = await getActiveHotelCodes();
    let qRes = null;

    if (activeHotelCodes && activeHotelCodes.length > 0) {
      try {
        qRes = await pgClient.query(`
          SELECT * FROM ${pgTables.reservations}
          WHERE COALESCE(${pgReservationUpdateFlagCol}, 0) = 0
            AND UPPER(${pgReservationHotelCol}::text) = ANY($1::text[])
          ORDER BY ${pgReservationIdCol} ASC LIMIT 200
        `, [activeHotelCodes]);
      } catch (e) {
        try {
          qRes = await pgClient.query(`
            SELECT * FROM ${pgTables.reservations}
            WHERE COALESCE(${pgReservationUpdateFlagCol}, 0) = 0
            ORDER BY ${pgReservationIdCol} ASC LIMIT 200
          `);
        } catch (e2) {
          qRes = await pgClient.query(`SELECT * FROM ${pgTables.reservations} ORDER BY 1 ASC LIMIT 200`);
        }
      }
    } else {
      // Query reservations from PostgreSQL BOOKLOGIC database where updateflag / Updateflag is 0
      try {
        qRes = await pgClient.query(`
          SELECT * FROM ${pgTables.reservations}
          WHERE COALESCE(${pgReservationUpdateFlagCol}, 0) = 0
          ORDER BY ${pgReservationIdCol} ASC LIMIT 200
        `);
      } catch (e) {
        try {
          qRes = await pgClient.query(`
            SELECT * FROM ${pgTables.reservations}
            WHERE COALESCE(updateflag, 0) = 0
            ORDER BY 1 ASC LIMIT 200
          `);
        } catch (e2) {
          qRes = await pgClient.query(`SELECT * FROM ${pgTables.reservations} ORDER BY 1 ASC LIMIT 200`);
        }
      }
    }

    const pgRows = qRes ? qRes.rows || [] : [];

    if (pgRows.length === 0) {
      if (cycleCount === 1 || cycleCount % 10 === 0) {
        try {
          const totalRes = await pgClient.query(`SELECT COUNT(*) as count FROM ${pgTables.reservations}`);
          const filterStr = activeHotelCodes.length > 0 ? ` (filtered by HotelCode [${activeHotelCodes.join(', ')}])` : '';
          log('diag', `PostgreSQL [${PG_DATABASE}].${pgTables.reservations}: ${totalRes.rows[0].count} total rows in table (0 pending sync${filterStr}).`);
        } catch (e) {}
      }
      return 0;
    }

    const filterMsg = activeHotelCodes.length > 0 ? ` for Hotel Code(s) [${activeHotelCodes.join(', ')}]` : '';
    log('inbound', `Found ${pgRows.length} reservation(s)${filterMsg} in VPS [${PG_DATABASE}] pending sync into local SQL Server...`);

    const committedResIds = [];

    for (const r of pgRows) {
      const resId = Number(getVal(r, 'res_id', 'id', 'resid', 'booking_id', 'resbkid'));
      if (!resId) {
        log('warn', `Skipping row with missing reservation ID:`, JSON.stringify(r));
        continue;
      }

      const hotelCode = (getVal(r, 'hotel_code', 'hotelcode', 'hotel_id') || 'IZM2366').toString();
      const bookingId = (getVal(r, 'booking_id', 'bookingid', 'reservation_no') || `BK-${resId}`).toString();
      const syncType = (getVal(r, 'synctype', 'sync_type') || 'NEW').toString();
      const pnrId = (getVal(r, 'pnrid', 'pnr_id') || '').toString();
      const extRef = (getVal(r, 'externalreference', 'external_reference') || '').toString();
      const extRoomId = (getVal(r, 'externalreservationroomid', 'external_room_id') || '').toString();
      const extResId = (getVal(r, 'externalreservationid', 'external_res_id') || '').toString();
      const service = (getVal(r, 'service') || '1').toString();
      const travelAgent = (getVal(r, 'travelagentname', 'travel_agent', 'agent_name') || 'BookLogic').toString();
      const updateDate = safeDate(getVal(r, 'updatedate', 'update_date')) || insertDate;
      const rawModifyDate = getVal(r, 'modifydate', 'modify_date', 'modified_at');
      const modifyDate = safeDate(rawModifyDate) || updateDate || insertDate;
      const cancelDate = safeDate(getVal(r, 'canceldate', 'cancel_date'));
      const currency = (getVal(r, 'currency') || 'EUR').toString();
      const status = (getVal(r, 'status') || 'CF').toString();
      const adult = safeNum(getVal(r, 'adult', 'adults', 'adult_count'), 2);
      const childB = safeNum(getVal(r, 'childb', 'child_b'), 0);
      const childA = safeNum(getVal(r, 'childa', 'child_a'), 0);
      const infant = safeNum(getVal(r, 'infant'), 0);
      const remarks = (getVal(r, 'remarks', 'remark', 'special_requests') || '').toString();
      const insertDate = safeDate(getVal(r, 'insertdate', 'insert_date', 'booking_date', 'created_at')) || new Date();
      const markSend = safeNum(getVal(r, 'marksend', 'mark_send'), 1);

      const checkInDate = safeDate(getVal(r, 'check_in', 'checkin', 'arrival_date', 'fromdate')) || new Date();
      const checkOutDate = safeDate(getVal(r, 'check_out', 'checkout', 'departure_date', 'todate')) || new Date(Date.now() + 86400000);
      const totalAmount = safeNum(getVal(r, 'total_amount', 'amount', 'total_price', 'price'), 0.0);

      try {
        // ==============================================================================
        // 1. MASTER TABLE: dbo.reservations_booklogic
        // ==============================================================================
        const masterPayload = {
          resbkid: resId,
          Res_id: resId,
          Hotel_Code: hotelCode,
          Booking_Id: bookingId,
          syncType: syncType,
          PnrID: pnrId,
          ExternalReference: extRef,
          ExternalReservationRoomId: extRoomId,
          ExternalReservationId: extResId,
          Service: service,
          TravelagentName: travelAgent,
          UpdateDate: updateDate,
          modifyDate: modifyDate,
          cancelDate: cancelDate,
          Currency: currency,
          Status: status,
          Adult: adult,
          ChildB: childB,
          ChildA: childA,
          Infant: infant,
          Remarks: remarks,
          Insertdate: insertDate,
          MarkSend: markSend,
          Updateflag: 1,
          updateflag: 1,
          synced_at: new Date(),
          _synced_at: new Date()
        };

        await upsertMssqlRecord(
          'dbo.reservations_booklogic',
          mssqlColumns.master,
          ['Res_id', 'res_id', 'Booking_Id', 'booking_id', 'resbkid'],
          masterPayload
        );

        // Fetch auto-generated resbkid from dbo.reservations_booklogic for this Res_id
        let resbkidVal = resId;
        try {
          const bkIdRes = await mssqlPool.request()
            .input('Res_id', sql.BigInt, resId)
            .query('SELECT resbkid FROM dbo.reservations_booklogic WHERE Res_id = @Res_id');
          if (bkIdRes.recordset && bkIdRes.recordset.length > 0 && bkIdRes.recordset[0].resbkid !== undefined) {
            resbkidVal = bkIdRes.recordset[0].resbkid;
          }
        } catch (e) {}

        // CLEAN UP ANY STALE / DUPLICATE CHILD ROWS FOR THIS RESBKID BEFORE RE-INSERTING
        try {
          const cleanReq = new sql.Request(mssqlPool);
          cleanReq.input('resbkid', sql.BigInt, resbkidVal);
          cleanReq.input('resId', sql.BigInt, resId);
          await cleanReq.query(`
            IF OBJECT_ID('dbo.Reservation_PerDay_details_Booklogic', 'U') IS NOT NULL
              DELETE FROM dbo.Reservation_PerDay_details_Booklogic WHERE resbkid = @resbkid OR Resper_id = @resId;
            IF OBJECT_ID('dbo.reservations_details_booklogic', 'U') IS NOT NULL
              DELETE FROM dbo.reservations_details_booklogic WHERE resbkid = @resbkid OR Res_id = @resId;
            IF OBJECT_ID('dbo.reservation_Customer_booklogic', 'U') IS NOT NULL
              DELETE FROM dbo.reservation_Customer_booklogic WHERE resbkid = @resbkid OR Res_id = @resId;
          `);
        } catch (eClean) {
          try {
            const cleanReq2 = new sql.Request(mssqlPool);
            cleanReq2.input('resbkid', sql.BigInt, resbkidVal);
            await cleanReq2.query(`
              DELETE FROM dbo.Reservation_PerDay_details_Booklogic WHERE resbkid = @resbkid;
              DELETE FROM dbo.reservations_details_booklogic WHERE resbkid = @resbkid;
              DELETE FROM dbo.reservation_Customer_booklogic WHERE resbkid = @resbkid;
            `);
          } catch (eClean2) {}
        }

        // ==============================================================================
        // 2. CHILD TABLE 1: dbo.reservations_details_booklogic
        // ==============================================================================
        let fetchedDetails = [];
        if (pgTables.details) {
          try {
            const dRes = await pgClient.query(`
              SELECT * FROM ${pgTables.details} 
              WHERE ${pgReservationIdCol}::text = $1
            `, [String(resId)]);
            fetchedDetails = dRes.rows || [];
          } catch (e) {
            try {
              const dRes2 = await pgClient.query(`SELECT * FROM ${pgTables.details} WHERE "Res_id" = $1`, [resId]);
              fetchedDetails = dRes2.rows || [];
            } catch (e2) {}
          }
        }

        if (fetchedDetails.length > 0) {
          for (let i = 0; i < fetchedDetails.length; i++) {
            const d = fetchedDetails[i];
            const detailId = safeNum(getVal(d, 'detail_id', 'id', 'detailid'), resId * 1000 + (i + 1));
            const netPriceVal = safeNum(getVal(d, 'netprice', 'net_price', 'total', 'roomtotal', 'price', 'price_per_night'), totalAmount || 0);
            const roomTotalVal = safeNum(getVal(d, 'roomtotal', 'room_total', 'netprice', 'total'), netPriceVal);
            const taxIncludedVal = safeNum(getVal(d, 'taxincluded', 'tax_included', 'tax_amount', 'taxamount'), 0);
            const taxExcludedVal = safeNum(getVal(d, 'taxexcluded', 'tax_excluded'), 0);
            const totalPriceVal = safeNum(getVal(d, 'total', 'netprice', 'roomtotal'), netPriceVal);
            const rateNameVal = (getVal(d, 'rate_name', 'ratename', 'rate_plan_code', 'rateplancode') || 'BAR').toString();
            const roomTypeVal = (getVal(d, 'roomtype', 'room_type', 'room_type_name', 'roomtypename') || 'ST').toString();
            const noofRoomsVal = safeNum(getVal(d, 'noofrooms', 'no_of_rooms', 'rooms_booked', 'roomsbooked', 'qty'), 1);
            const checkinDateVal = safeDate(getVal(d, 'checkindate', 'check_in_date', 'check_in', 'checkin', 'fromdate')) || checkInDate;
            const checkoutDateVal = safeDate(getVal(d, 'checkoutdate', 'check_out_date', 'check_out', 'checkout', 'todate')) || checkOutDate;

            const detailPayload = {
              ...d,
              detail_id: detailId,
              Res_id: resId,
              resbkid: resbkidVal,
              Roomtypeid: safeNum(getVal(d, 'roomtypeid', 'room_type_id'), 101),
              RoomType: roomTypeVal,
              roomtype: roomTypeVal,
              Room_Type: roomTypeVal,
              Room_Type_Name: roomTypeVal,
              NoofRooms: noofRoomsVal,
              noofrooms: noofRoomsVal,
              Rooms_Booked: noofRoomsVal,
              rooms_booked: noofRoomsVal,
              Checkindate: checkinDateVal,
              checkindate: checkinDateVal,
              Check_In: checkinDateVal,
              Checkoutdate: checkoutDateVal,
              checkoutdate: checkoutDateVal,
              Check_Out: checkoutDateVal,
              Netprice: netPriceVal,
              netprice: netPriceVal,
              RoomTotal: roomTotalVal,
              roomtotal: roomTotalVal,
              Total: totalPriceVal,
              total: totalPriceVal,
              Price: netPriceVal,
              price: netPriceVal,
              Price_Per_Night: netPriceVal,
              price_per_night: netPriceVal,
              Room_Rate: roomTotalVal,
              room_rate: roomTotalVal,
              TaxIncluded: taxIncludedVal,
              taxincluded: taxIncludedVal,
              TaxExcluded: taxExcludedVal,
              taxexcluded: taxExcludedVal,
              Tax_Amount: taxIncludedVal + taxExcludedVal,
              tax_amount: taxIncludedVal + taxExcludedVal,
              rate_name: rateNameVal,
              Rate_Plan_Code: rateNameVal,
              rate_plan_code: rateNameVal,
              Meal_Plan: (getVal(d, 'meal_plan', 'mealplan', 'mealtotal') || 'EP').toString(),
              Adult: safeNum(getVal(d, 'adult', 'adults'), adult),
              Child: safeNum(getVal(d, 'child', 'children'), childA + childB),
              Nights: safeNum(getVal(d, 'nights', 'night_count'), 1),
              synced_at: new Date(),
              _synced_at: new Date()
            };

            await upsertMssqlRecord(
              'dbo.reservations_details_booklogic',
              mssqlColumns.details,
              ['detail_id', 'detailid', 'Res_id'],
              detailPayload
            );
          }
        } else {
          // Generate default detail record linked by Res_id
          const detailPayload = {
            detail_id: resId * 1000 + 1,
            Res_id: resId,
            resbkid: resbkidVal,
            Roomtypeid: 101,
            RoomType: 'ST',
            roomtype: 'ST',
            Room_Type_Name: 'Standard Room',
            NoofRooms: 1,
            Rooms_Booked: 1,
            Rate_Plan_Code: 'BAR',
            rate_name: 'BAR',
            Netprice: totalAmount || 0,
            netprice: totalAmount || 0,
            RoomTotal: totalAmount || 0,
            roomtotal: totalAmount || 0,
            Total: totalAmount || 0,
            total: totalAmount || 0,
            Price: totalAmount || 0,
            Price_Per_Night: totalAmount || 0,
            Tax_Amount: 0.00,
            Meal_Plan: 'EP',
            Adult: adult,
            Child: childA + childB,
            Nights: 1,
            Checkindate: checkInDate,
            Checkoutdate: checkOutDate,
            Check_In: checkInDate,
            Check_Out: checkOutDate,
            synced_at: new Date(),
            _synced_at: new Date()
          };

          await upsertMssqlRecord(
            'dbo.reservations_details_booklogic',
            mssqlColumns.details,
            ['detail_id', 'detailid', 'Res_id'],
            detailPayload
          );
        }

        // ==============================================================================
        // 3. CHILD TABLE 2: dbo.Reservation_PerDay_details_Booklogic
        // ==============================================================================
        let fetchedPerDay = [];
        if (pgTables.perday) {
          try {
            const pRes = await pgClient.query(`
              SELECT * FROM ${pgTables.perday} 
              WHERE ${pgReservationIdCol}::text = $1
            `, [String(resId)]);
            fetchedPerDay = pRes.rows || [];
          } catch (e) {
            try {
              const pRes2 = await pgClient.query(`SELECT * FROM ${pgTables.perday} WHERE "Res_id" = $1`, [resId]);
              fetchedPerDay = pRes2.rows || [];
            } catch (e2) {}
          }
        }

        if (fetchedPerDay.length > 0) {
          for (let i = 0; i < fetchedPerDay.length; i++) {
            const p = fetchedPerDay[i];
            const perdayId = safeNum(getVal(p, 'perday_id', 'id', 'perdayid'), resId * 1000 + (i + 1));
            const priceVal = safeNum(getVal(p, 'price', 'room_rate', 'roomrate', 'rate', 'total_amount', 'totalamount', 'total', 'netprice'), 0);
            const dateVal = safeDate(getVal(p, 'date', 'rate_date', 'ratedate', 'checkindate', 'fromdate')) || checkInDate;
            const rmNoVal = safeNum(getVal(p, 'rm_no', 'rmno', 'room_no', 'roomno', 'rooms_booked'), 1);
            const hotelCodeVal = (getVal(p, 'hotel_code', 'hotelcode', 'hotel_id') || hotelCode).toString();
            const bookingIdVal = (getVal(p, 'booking_id', 'bookingid', 'reservation_no') || bookingId).toString();
            const taxVal = safeNum(getVal(p, 'tax_amount', 'taxamount', 'tax', 'taxincluded', 'taxexcluded'), 0);

            const perDayPayload = {
              ...p,
              perday_id: perdayId,
              resbkpdid: perdayId,
              Res_id: resId,
              Resper_id: resId,
              resper_id: resId,
              resbkid: resbkidVal,
              detail_id: safeNum(getVal(p, 'detail_id', 'detailid'), resId * 1000 + 1),
              Hotel_Code: hotelCodeVal,
              hotel_code: hotelCodeVal,
              HotelCode: hotelCodeVal,
              hotelcode: hotelCodeVal,
              Booking_Id: bookingIdVal,
              booking_id: bookingIdVal,
              BookingId: bookingIdVal,
              bookingid: bookingIdVal,
              Date: dateVal,
              date: dateVal,
              Rate_Date: dateVal,
              rate_date: dateVal,
              ratedate: dateVal,
              rm_no: rmNoVal,
              rmno: rmNoVal,
              RoomNo: rmNoVal,
              room_no: rmNoVal,
              Price: priceVal,
              price: priceVal,
              Room_Rate: priceVal,
              room_rate: priceVal,
              roomrate: priceVal,
              Total_Amount: priceVal,
              total_amount: priceVal,
              totalamount: priceVal,
              Tax_Amount: taxVal,
              tax_amount: taxVal,
              Roomtypeid: safeNum(getVal(p, 'roomtypeid', 'room_type_id'), 101),
              synced_at: new Date(),
              _synced_at: new Date()
            };

            await upsertMssqlRecord(
              'dbo.Reservation_PerDay_details_Booklogic',
              mssqlColumns.perday,
              ['perday_id', 'perdayid', 'Res_id'],
              perDayPayload
            );
          }
        } else {
          // Generate default per-day row linked by Res_id
          const perDayPayload = {
            perday_id: resId * 1000 + 1,
            Res_id: resId,
            resbkid: resbkidVal,
            detail_id: resId * 1000 + 1,
            Hotel_Code: hotelCode,
            Booking_Id: bookingId,
            Date: checkInDate,
            Rate_Date: checkInDate,
            rm_no: 1,
            Roomtypeid: 101,
            Price: totalAmount || 0,
            price: totalAmount || 0,
            Room_Rate: totalAmount || 0,
            Total_Amount: totalAmount || 0,
            Tax_Amount: 0.00,
            synced_at: new Date(),
            _synced_at: new Date()
          };

          await upsertMssqlRecord(
            'dbo.Reservation_PerDay_details_Booklogic',
            mssqlColumns.perday,
            ['perday_id', 'perdayid', 'Res_id'],
            perDayPayload
          );
        }

        // ==============================================================================
        // 4. CHILD TABLE 3: dbo.reservation_Customer_booklogic
        // ==============================================================================
        let fetchedCustomer = [];
        if (pgTables.customer) {
          try {
            const cRes = await pgClient.query(`
              SELECT * FROM ${pgTables.customer} 
              WHERE ${pgReservationIdCol}::text = $1
            `, [String(resId)]);
            fetchedCustomer = cRes.rows || [];
          } catch (e) {
            try {
              const cRes2 = await pgClient.query(`SELECT * FROM ${pgTables.customer} WHERE "Res_id" = $1`, [resId]);
              fetchedCustomer = cRes2.rows || [];
            } catch (e2) {}
          }
        }

        if (fetchedCustomer.length > 0) {
          for (let i = 0; i < fetchedCustomer.length; i++) {
            const c = fetchedCustomer[i];
            const custId = safeNum(getVal(c, 'customer_id', 'id', 'customerid'), resId * 1000 + (i + 1));
            const fName = (getVal(c, 'first_name', 'firstname', 'fname') || 'Guest').toString();
            const lName = (getVal(c, 'last_name', 'lastname', 'lname') || String(resId)).toString();
            const cName = (getVal(c, 'customer_name', 'name') || `${fName} ${lName}`).toString();

            const custPayload = {
              customer_id: custId,
              Res_id: resId,
              resbkid: resbkidVal,
              First_Name: fName,
              Last_Name: lName,
              Customer_Name: cName,
              Phone: (getVal(c, 'phone', 'mobile', 'telephone') || '+91 9876543210').toString(),
              Email: (getVal(c, 'email', 'mail') || `guest${resId}@booklogic.net`).toString(),
              Address: (getVal(c, 'address', 'addr') || 'BookLogic Channel').toString(),
              City: (getVal(c, 'city') || 'Varanasi').toString(),
              Country: (getVal(c, 'country') || 'India').toString(),
              Id_Proof_Type: (getVal(c, 'id_proof_type', 'proof_type') || 'Passport').toString(),
              Id_Proof_Number: (getVal(c, 'id_proof_number', 'proof_no') || `BL-${resId}`).toString(),
              synced_at: new Date(),
              _synced_at: new Date()
            };

            await upsertMssqlRecord(
              'dbo.reservation_Customer_booklogic',
              mssqlColumns.customer,
              ['customer_id', 'customerid', 'Res_id'],
              custPayload
            );
          }
        } else {
          // Generate default customer row linked by Res_id
          const custPayload = {
            customer_id: resId * 1000 + 1,
            Res_id: resId,
            resbkid: resbkidVal,
            First_Name: 'Guest',
            Last_Name: String(resId),
            Customer_Name: `Guest ${resId}`,
            Phone: '+91 9876543210',
            Email: `guest${resId}@booklogic.net`,
            Address: 'BookLogic Channel',
            City: 'Varanasi',
            Country: 'India',
            Id_Proof_Type: 'Passport',
            Id_Proof_Number: `BL-REG-${resId}`,
            synced_at: new Date(),
            _synced_at: new Date()
          };

          await upsertMssqlRecord(
            'dbo.reservation_Customer_booklogic',
            mssqlColumns.customer,
            ['customer_id', 'customerid', 'Res_id'],
            custPayload
          );
        }

        committedResIds.push(resId);
        log('success', `[INBOUND] ✅ Synced Res_id = ${resId} (${bookingId}) into local SQL Server [reservations_booklogic, reservations_details_booklogic, Reservation_PerDay_details_Booklogic, reservation_Customer_booklogic]!`);
      } catch (err) {
        log('error', `SQL Server write error for Res_id ${resId}: ${err.message}`);
      }
    }

    // Set Updateflag = 1 and synced_at in VPS PostgreSQL BOOKLOGIC
    if (committedResIds.length > 0) {
      try {
        await pgClient.query(`
          UPDATE ${pgTables.reservations}
          SET ${pgReservationUpdateFlagCol} = 1,
              "synced_at" = CURRENT_TIMESTAMP
          WHERE ${pgReservationIdCol} = ANY($1::bigint[]) OR ${pgReservationIdCol} = ANY($1::int[])
        `, [committedResIds]);
        log('success', `[INBOUND] 🔄 Successfully marked ${pgReservationUpdateFlagCol} = 1 and synced_at in VPS BOOKLOGIC for Res_ids: [${committedResIds.join(', ')}]`);
      } catch (flagErr) {
        try {
          await pgClient.query(`
            UPDATE ${pgTables.reservations}
            SET ${pgReservationUpdateFlagCol} = 1
            WHERE ${pgReservationIdCol} = ANY($1::bigint[]) OR ${pgReservationIdCol} = ANY($1::int[])
          `, [committedResIds]);
          log('success', `[INBOUND] 🔄 Successfully marked ${pgReservationUpdateFlagCol} = 1 in VPS BOOKLOGIC for Res_ids: [${committedResIds.join(', ')}]`);
        } catch (fErr2) {
          log('warn', `Notice setting updateflag in PG BOOKLOGIC: ${fErr2.message}`);
        }
      }
    }

    return committedResIds.length;
  } catch (err) {
    log('error', `Inbound reservation sync error: ${err.message}`);
    return 0;
  } finally {
    if (pgClient) pgClient.release();
  }
}

// --------------------------------------------------------------------------------------
// OUTBOUND 1: Availability (Local SQL Server ➔ VPS PostgreSQL BOOKLOGIC)
// --------------------------------------------------------------------------------------
async function syncOutboundRoomAvailability() {
  let pgClient = null;
  try {
    const activeHotelCodes = await getActiveHotelCodes();
    const primaryHotelCode = activeHotelCodes.length > 0 ? activeHotelCodes[0] : 'IZM2366';

    // Only filter by hotelcode in SQL Server if the local table actually has that column!
    let hotelFilterSql = '';
    const hasHotelColInLocal = mssqlColumns.availability.has('hotelcode') || mssqlColumns.availability.has('hotel_code');
    if (hasHotelColInLocal && activeHotelCodes.length > 0) {
      const colObj = mssqlColumns.availability.get('hotelcode') || mssqlColumns.availability.get('hotel_code');
      const localColName = colObj ? colObj.name : 'hotelcode';
      hotelFilterSql = `AND (${localColName} IS NULL OR LTRIM(RTRIM(${localColName})) = '' OR UPPER(${localColName}) IN (${activeHotelCodes.map(h => `'${h}'`).join(',')}))`;
    }

    const result = await mssqlPool.request().query(`
      SELECT TOP 500 *
      FROM dbo.trans_roomavailability_chart_datewise
      WHERE ISNULL(uploadflg, 0) = 0 ${hotelFilterSql}
      ORDER BY avaidd ASC
    `);

    if (!result.recordset || result.recordset.length === 0) return 0;

    pgClient = await pgPool.connect();
    const syncedAvaids = [];

    for (const row of result.recordset) {
      const avaidd = safeNum(getVal(row, 'avaidd', 'ava_id', 'id'), 0);
      if (!avaidd) continue;

      const roomtypeid = safeNum(getVal(row, 'roomtypeid', 'room_type_id', 'room_id'), 0);
      const fromdate = safeDate(getVal(row, 'fromdate', 'from_date', 'start_date'));
      const todate = safeDate(getVal(row, 'todate', 'to_date', 'end_date'));
      const availablerooms = safeNum(getVal(row, 'availablerooms', 'available_rooms', 'rooms'), 0);
      const notupload = safeNum(getVal(row, 'notupload', 'not_upload'), 0);
      const remarks = getVal(row, 'remarks', 'remark') ? String(getVal(row, 'remarks', 'remark')) : '';
      const fromtime = safeDate(getVal(row, 'fromtime', 'from_time'));
      const totime = safeDate(getVal(row, 'totime', 'to_time'));
      const allotcode = getVal(row, 'allotcode', 'allot_code') ? String(getVal(row, 'allotcode', 'allot_code')) : '';
      const hotelcode = (getVal(row, 'hotelcode', 'hotel_code') || primaryHotelCode).toString();
      const irm_update = safeNum(getVal(row, 'irm_update', 'irmupdate'), 0);
      const stopsales = safeNum(getVal(row, 'stopsales', 'stop_sales'), 0);

      // Try update existing record matching roomtypeid, fromdate, todate, hotelcode
      const updateRes = await pgClient.query(`
        UPDATE ${pgTables.availability}
        SET availablerooms = $1::int,
            uploadflg = 1,
            notupload = $2::int,
            remarks = $3::text,
            fromtime = $4::timestamp,
            totime = $5::timestamp,
            allotcode = $6::text,
            irm_update = $7::int,
            stopsales = $8::int,
            last_synced_at = CURRENT_TIMESTAMP
        WHERE roomtypeid = $9::bigint
          AND fromdate = $10::timestamp
          AND todate = $11::timestamp
          AND hotelcode = $12::text
      `, [
        availablerooms,
        notupload,
        remarks,
        fromtime,
        totime,
        allotcode,
        irm_update,
        stopsales,
        roomtypeid || null,
        fromdate,
        todate,
        hotelcode
      ]);

      if (updateRes.rowCount === 0) {
        // Insert new record without specifying avaidd (auto-generated by PostgreSQL identity/serial)
        await pgClient.query(`
          INSERT INTO ${pgTables.availability} (
            roomtypeid, fromdate, todate, availablerooms,
            uploadflg, notupload, remarks, fromtime, totime,
            allotcode, hotelcode, irm_update, stopsales, last_synced_at
          ) VALUES ($1::bigint, $2::timestamp, $3::timestamp, $4::int, $5::int, $6::int, $7::text, $8::timestamp, $9::timestamp, $10::text, $11::text, $12::int, $13::int, CURRENT_TIMESTAMP)
        `, [
          roomtypeid || null,
          fromdate,
          todate,
          availablerooms,
          1,
          notupload,
          remarks,
          fromtime,
          totime,
          allotcode,
          hotelcode,
          irm_update,
          stopsales
        ]);
      }

      syncedAvaids.push(avaidd);
    }

    if (syncedAvaids.length > 0) {
      const chunkSize = 200;
      for (let i = 0; i < syncedAvaids.length; i += chunkSize) {
        const chunk = syncedAvaids.slice(i, i + chunkSize);
        await mssqlPool.request().query(`
          UPDATE dbo.trans_roomavailability_chart_datewise
          SET uploadflg = 1, _last_updated = GETDATE()
          WHERE avaidd IN (${chunk.join(',')})
        `);
      }
      log('outbound', `Pushed ${syncedAvaids.length} Room Availability records for Hotel [${primaryHotelCode}] to VPS BOOKLOGIC and marked uploadflg = 1 in SQL Server.`);
    }

    return syncedAvaids.length;
  } catch (err) {
    log('error', `Outbound Room Availability error: ${err.message}`);
    return 0;
  } finally {
    if (pgClient) pgClient.release();
  }
}

// --------------------------------------------------------------------------------------
// OUTBOUND 2: Rate Updates (Local SQL Server ➔ VPS PostgreSQL BOOKLOGIC)
// --------------------------------------------------------------------------------------
async function syncOutboundRoomRates() {
  let pgClient = null;
  try {
    const tableCheck = await mssqlPool.request().query(`
      SELECT 1 FROM sysobjects WHERE name='trans_roomrateupdates_datewise' AND xtype='U'
    `);
    if (!tableCheck.recordset || tableCheck.recordset.length === 0) return 0;

    const activeHotelCodes = await getActiveHotelCodes();
    const primaryHotelCode = activeHotelCodes.length > 0 ? activeHotelCodes[0] : 'IZM2366';

    // Only filter by hotelcode in SQL Server if the local table actually has that column!
    let hotelFilterSql = '';
    const hasHotelColInLocal = mssqlColumns.rateupdates.has('hotelcode') || mssqlColumns.rateupdates.has('hotel_code');
    if (hasHotelColInLocal && activeHotelCodes.length > 0) {
      const colObj = mssqlColumns.rateupdates.get('hotelcode') || mssqlColumns.rateupdates.get('hotel_code');
      const localColName = colObj ? colObj.name : 'hotelcode';
      hotelFilterSql = `AND (${localColName} IS NULL OR LTRIM(RTRIM(${localColName})) = '' OR UPPER(${localColName}) IN (${activeHotelCodes.map(h => `'${h}'`).join(',')}))`;
    }

    const result = await mssqlPool.request().query(`
      SELECT TOP 500 *
      FROM dbo.trans_roomrateupdates_datewise
      WHERE ISNULL(uploadflg, 0) = 0 ${hotelFilterSql}
      ORDER BY rateid ASC
    `);

    if (!result.recordset || result.recordset.length === 0) return 0;

    pgClient = await pgPool.connect();
    const syncedRateIds = [];

    for (const row of result.recordset) {
      const rateid = safeNum(getVal(row, 'rateid', 'rate_id', 'id'), 0);
      if (!rateid) continue;

      const roomtypeid = safeNum(getVal(row, 'roomtypeid', 'room_type_id'), 0);
      const fromdate = safeDate(getVal(row, 'fromdate', 'from_date'));
      const todate = safeDate(getVal(row, 'todate', 'to_date'));
      const singlerate = safeNum(getVal(row, 'singlerate', 'single_rate'), 0);
      const doublerate = safeNum(getVal(row, 'doublerate', 'double_rate'), 0);
      const triplerate = safeNum(getVal(row, 'triplerate', 'triple_rate'), 0);
      const quadrate = safeNum(getVal(row, 'quadrate', 'quad_rate'), 0);
      const extrabed = safeNum(getVal(row, 'extrabed', 'extra_bed'), 0);
      const childrate = safeNum(getVal(row, 'childrate', 'child_rate'), 0);
      const hotelcode = (getVal(row, 'hotelcode', 'hotel_code') || primaryHotelCode).toString();
      const rateplancode = getVal(row, 'rateplancode', 'rate_plan_code', 'rateplan') ? String(getVal(row, 'rateplancode', 'rate_plan_code', 'rateplan')) : 'BAR';

      await pgClient.query(`
        INSERT INTO ${pgTables.rateupdates} (
          rateid, roomtypeid, fromdate, todate,
          singlerate, doublerate, triplerate, quadrate, extrabed, childrate,
          hotelcode, rateplancode, uploadflg, last_synced_at
        ) VALUES ($1::bigint, $2::bigint, $3::timestamp, $4::timestamp, $5::decimal, $6::decimal, $7::decimal, $8::decimal, $9::decimal, $10::decimal, $11::text, $12::text, $13::int, CURRENT_TIMESTAMP)
        ON CONFLICT (rateid) DO UPDATE SET
          roomtypeid = EXCLUDED.roomtypeid,
          fromdate = EXCLUDED.fromdate,
          todate = EXCLUDED.todate,
          singlerate = EXCLUDED.singlerate,
          doublerate = EXCLUDED.doublerate,
          triplerate = EXCLUDED.triplerate,
          quadrate = EXCLUDED.quadrate,
          extrabed = EXCLUDED.extrabed,
          childrate = EXCLUDED.childrate,
          hotelcode = EXCLUDED.hotelcode,
          rateplancode = EXCLUDED.rateplancode,
          uploadflg = 1,
          last_synced_at = CURRENT_TIMESTAMP;
      `, [
        rateid,
        roomtypeid || null,
        fromdate,
        todate,
        singlerate,
        doublerate,
        triplerate,
        quadrate,
        extrabed,
        childrate,
        hotelcode,
        rateplancode,
        1
      ]);

      syncedRateIds.push(rateid);
    }

    if (syncedRateIds.length > 0) {
      const chunkSize = 200;
      for (let i = 0; i < syncedRateIds.length; i += chunkSize) {
        const chunk = syncedRateIds.slice(i, i + chunkSize);
        await mssqlPool.request().query(`
          UPDATE dbo.trans_roomrateupdates_datewise
          SET uploadflg = 1, _last_updated = GETDATE()
          WHERE rateid IN (${chunk.join(',')})
        `);
      }
      log('outbound', `Pushed ${syncedRateIds.length} Room Rate Updates for Hotel [${primaryHotelCode}] to VPS BOOKLOGIC and marked uploadflg = 1 in SQL Server.`);
    }

    return syncedRateIds.length;
  } catch (err) {
    log('error', `Outbound Room Rate Updates error: ${err.message}`);
    return 0;
  } finally {
    if (pgClient) pgClient.release();
  }
}

// --------------------------------------------------------------------------------------
// MAIN CONTINUOUS REPLICATION LOOP
// --------------------------------------------------------------------------------------
async function runReplicationCycle() {
  if (isSyncRunning) return;
  isSyncRunning = true;
  cycleCount++;

  try {
    // 1. Inbound Sync: VPS PostgreSQL BOOKLOGIC ➔ Local SQL Server varanashiinn
    const inCount = await syncInboundReservations();

    // 2. Outbound Sync: Local SQL Server varanashiinn ➔ VPS PostgreSQL BOOKLOGIC
    const outAvail = await syncOutboundRoomAvailability();
    const outRates = await syncOutboundRoomRates();

    if (inCount > 0 || outAvail > 0 || outRates > 0) {
      log('info', `Cycle #${cycleCount} complete: 📥 ${inCount} Inbound Reservation(s) (4 tables) | 📤 ${outAvail} Availability + ${outRates} Rates.`);
    }
  } catch (err) {
    log('error', `Replication cycle error: ${err.message}`);
  } finally {
    isSyncRunning = false;
  }
}

async function startReplicationAgent() {
  console.log('================================================================');
  console.log('  🚀 BOOKLOGIC Dedicated Bidirectional Replication Agent');
  console.log('================================================================');
  console.log(`Local SQL Server  : ${parsedMssql.server} (DB: ${MSSQL_DATABASE_INPUT})`);
  console.log(`VPS PostgreSQL    : ${PG_HOST}:${PG_PORT} (DB: ${PG_DATABASE})`);
  console.log(`Polling Interval  : ${SYNC_INTERVAL_MS} ms`);
  console.log('================================================================\n');

  try {
    mssqlPool = await connectToSqlServer();
    await connectToPostgresBooklogic();

    log('info', `Replication Daemon ACTIVE: VPS "${PG_DATABASE}" ⇄ Local SQL Server "${MSSQL_DATABASE_INPUT}"`);

    const activeHotels = await getActiveHotelCodes();
    if (activeHotels && activeHotels.length > 0) {
      log('info', `Hotel Code Filter : [${activeHotels.join(', ')}] (Filtering VPS bookings for this hotel)`);
    } else {
      log('info', `Hotel Code Filter : ALL (Unfiltered / Syncing all pending bookings)`);
    }

    // Run first cycle immediately
    await runReplicationCycle();

    // Loop
    setInterval(runReplicationCycle, SYNC_INTERVAL_MS);

  } catch (err) {
    log('error', `Fatal Agent Initialization Failure: ${err.message}`);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  log('warn', 'Shutting down sync agent gracefully...');
  if (mssqlPool) try { await mssqlPool.close(); } catch (e) {}
  if (pgPool) try { await pgPool.end(); } catch (e) {}
  process.exit(0);
});

startReplicationAgent();
