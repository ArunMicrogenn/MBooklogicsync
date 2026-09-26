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

require('dotenv').config();
const sql = require('mssql');
const { Pool, Client } = require('pg');

// --------------------------------------------------------------------------------------
// CONFIGURATION & PARSING
// --------------------------------------------------------------------------------------
function parseSqlServerServer(rawServer, rawPort) {
  let serverStr = (rawServer || 'DESKTOP-VDGDM3P').trim();
  let instanceName = undefined;
  let port = rawPort ? parseInt(rawPort, 10) : 1433;

  if (serverStr.includes('\\')) {
    const parts = serverStr.split('\\');
    serverStr = parts[0] || 'DESKTOP-VDGDM3P';
    instanceName = parts[1];
    port = rawPort ? parseInt(rawPort, 10) : undefined;
  }
  return { server: serverStr, instanceName, port };
}

const MSSQL_USER = process.env.MSSQL_USER || 'sa';
const MSSQL_PASSWORD = process.env.MSSQL_PASSWORD || 'mgenn@123';
const MSSQL_SERVER_INPUT = process.env.MSSQL_SERVER || process.env.MSSQL_HOST || 'DESKTOP-VDGDM3P';
const MSSQL_DATABASE_INPUT = process.env.MSSQL_DATABASE || 'varanashiinn';

const parsedMssql = parseSqlServerServer(MSSQL_SERVER_INPUT, process.env.MSSQL_PORT);

const PG_HOST = process.env.PG_HOST || process.env.POSTGRES_HOST || '72.61.240.34';
const PG_PORT = parseInt(process.env.PG_PORT || process.env.POSTGRES_PORT || '5432', 10);
const PG_USER = process.env.PG_USER || process.env.POSTGRES_USER || 'postgres';
const PG_PASSWORD = process.env.PG_PASSWORD || process.env.POSTGRES_PASSWORD || 'mgenn';
const PG_DATABASE = process.env.PG_DATABASE || process.env.POSTGRES_DB || 'BOOKLOGIC';

const SYNC_INTERVAL_MS = parseInt(process.env.SYNC_INTERVAL_MS || '3000', 10);

let mssqlPool = null;
let pgPool = null;

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

// --------------------------------------------------------------------------------------
// LOCAL SQL SERVER INITIALIZATION & COLUMN DISCOVERY
// --------------------------------------------------------------------------------------
async function connectToSqlServer() {
  const cfg = {
    user: MSSQL_USER,
    password: MSSQL_PASSWORD,
    server: parsedMssql.server,
    database: MSSQL_DATABASE_INPUT,
    options: {
      instanceName: parsedMssql.instanceName,
      encrypt: false,
      trustServerCertificate: true,
      enableArithAbort: true,
      connectTimeout: 8000,
      requestTimeout: 25000,
    },
  };
  if (parsedMssql.port && !parsedMssql.instanceName) cfg.port = parsedMssql.port;

  log('info', `Connecting to Local SQL Server (${parsedMssql.server} / Database: ${MSSQL_DATABASE_INPUT})...`);
  const pool = await sql.connect(cfg);
  log('success', `Connected to Local SQL Server: ${parsedMssql.server} (Database: ${MSSQL_DATABASE_INPUT}).`);

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
// INBOUND SYNC: VPS PostgreSQL (BOOKLOGIC) ➔ Local SQL Server (varanashiinn)
// --------------------------------------------------------------------------------------
async function syncInboundReservations() {
  let pgClient = null;
  try {
    pgClient = await pgPool.connect();

    // Query reservations from PostgreSQL BOOKLOGIC database where updateflag / Updateflag is 0
    let qRes = null;
    try {
      qRes = await pgClient.query(`
        SELECT * FROM ${pgTables.reservations}
        WHERE COALESCE("Updateflag", updateflag, 0) = 0
        ORDER BY "Res_id" ASC LIMIT 200
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

    const pgRows = qRes ? qRes.rows || [] : [];

    if (pgRows.length === 0) {
      if (cycleCount === 1 || cycleCount % 10 === 0) {
        try {
          const totalRes = await pgClient.query(`SELECT COUNT(*) as count FROM ${pgTables.reservations}`);
          log('diag', `PostgreSQL [${PG_DATABASE}].${pgTables.reservations}: ${totalRes.rows[0].count} total rows in table (0 pending sync).`);
        } catch (e) {}
      }
      return 0;
    }

    log('inbound', `Found ${pgRows.length} reservation(s) in VPS [${PG_DATABASE}] pending sync into local SQL Server...`);

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
      const updateDate = safeDate(getVal(r, 'updatedate', 'update_date')) || new Date();
      const modifyDate = safeDate(getVal(r, 'modifydate', 'modify_date'));
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

        // ==============================================================================
        // 2. CHILD TABLE 1: dbo.reservations_details_booklogic
        // ==============================================================================
        let fetchedDetails = [];
        if (pgTables.details) {
          try {
            const dRes = await pgClient.query(`
              SELECT * FROM ${pgTables.details} 
              WHERE res_id::text = $1 OR resid::text = $1 OR reservation_id::text = $1
            `, [String(resId)]);
            fetchedDetails = dRes.rows || [];
          } catch (e) {
            try {
              const dRes2 = await pgClient.query(`SELECT * FROM ${pgTables.details} WHERE res_id = $1`, [resId]);
              fetchedDetails = dRes2.rows || [];
            } catch (e2) {}
          }
        }

        if (fetchedDetails.length > 0) {
          for (let i = 0; i < fetchedDetails.length; i++) {
            const d = fetchedDetails[i];
            const detailId = safeNum(getVal(d, 'detail_id', 'id', 'detailid'), resId * 1000 + (i + 1));
            const detailPayload = {
              detail_id: detailId,
              Res_id: resId,
              resbkid: resbkidVal,
              Roomtypeid: safeNum(getVal(d, 'roomtypeid', 'room_type_id'), 101),
              Room_Type_Name: (getVal(d, 'room_type_name', 'roomtypename') || 'Standard Deluxe').toString(),
              Rooms_Booked: safeNum(getVal(d, 'rooms_booked', 'roomsbooked', 'qty'), 1),
              Rate_Plan_Code: (getVal(d, 'rate_plan_code', 'rateplancode', 'rate_plan') || 'BAR').toString(),
              Price_Per_Night: safeNum(getVal(d, 'price_per_night', 'pricepernight', 'rate', 'price'), totalAmount || 150.00),
              Tax_Amount: safeNum(getVal(d, 'tax_amount', 'taxamount', 'tax'), 0.00),
              Meal_Plan: (getVal(d, 'meal_plan', 'mealplan') || 'EP').toString(),
              Adult: safeNum(getVal(d, 'adult', 'adults'), adult),
              Child: safeNum(getVal(d, 'child', 'children'), childA + childB),
              Nights: safeNum(getVal(d, 'nights', 'night_count'), 1),
              Check_In: safeDate(getVal(d, 'check_in', 'checkin', 'fromdate')) || checkInDate,
              Check_Out: safeDate(getVal(d, 'check_out', 'checkout', 'todate')) || checkOutDate,
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
            Room_Type_Name: 'Standard Room',
            Rooms_Booked: 1,
            Rate_Plan_Code: 'BAR',
            Price_Per_Night: totalAmount || 150.00,
            Tax_Amount: 0.00,
            Meal_Plan: 'EP',
            Adult: adult,
            Child: childA + childB,
            Nights: 1,
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
              WHERE res_id::text = $1 OR resid::text = $1 OR reservation_id::text = $1
            `, [String(resId)]);
            fetchedPerDay = pRes.rows || [];
          } catch (e) {
            try {
              const pRes2 = await pgClient.query(`SELECT * FROM ${pgTables.perday} WHERE res_id = $1`, [resId]);
              fetchedPerDay = pRes2.rows || [];
            } catch (e2) {}
          }
        }

        if (fetchedPerDay.length > 0) {
          for (let i = 0; i < fetchedPerDay.length; i++) {
            const p = fetchedPerDay[i];
            const perdayId = safeNum(getVal(p, 'perday_id', 'id', 'perdayid'), resId * 1000 + (i + 1));
            const roomRate = safeNum(getVal(p, 'room_rate', 'roomrate', 'rate', 'price'), 120.00);
            const taxAmt = safeNum(getVal(p, 'tax_amount', 'taxamount', 'tax'), 0.00);

            const perDayPayload = {
              perday_id: perdayId,
              Res_id: resId,
              resbkid: resbkidVal,
              detail_id: safeNum(getVal(p, 'detail_id', 'detailid'), resId * 1000 + 1),
              Rate_Date: safeDate(getVal(p, 'rate_date', 'ratedate', 'date')) || checkInDate,
              Roomtypeid: safeNum(getVal(p, 'roomtypeid', 'room_type_id'), 101),
              Room_Rate: roomRate,
              Tax_Amount: taxAmt,
              Total_Amount: safeNum(getVal(p, 'total_amount', 'totalamount', 'total'), roomRate + taxAmt),
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
            Rate_Date: checkInDate,
            Roomtypeid: 101,
            Room_Rate: totalAmount || 150.00,
            Tax_Amount: 0.00,
            Total_Amount: totalAmount || 150.00,
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
              WHERE res_id::text = $1 OR resid::text = $1 OR reservation_id::text = $1
            `, [String(resId)]);
            fetchedCustomer = cRes.rows || [];
          } catch (e) {
            try {
              const cRes2 = await pgClient.query(`SELECT * FROM ${pgTables.customer} WHERE res_id = $1`, [resId]);
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

    // Set Updateflag = 1, updateflag = 1, and synced_at = CURRENT_TIMESTAMP in VPS PostgreSQL BOOKLOGIC
    if (committedResIds.length > 0) {
      try {
        await pgClient.query(`
          UPDATE ${pgTables.reservations}
          SET "Updateflag" = 1,
              "updateflag" = 1,
              "synced_at" = CURRENT_TIMESTAMP
          WHERE "Res_id" = ANY($1::bigint[]) OR res_id = ANY($1::bigint[]) OR "Res_id" = ANY($1::int[]) OR res_id = ANY($1::int[])
        `, [committedResIds]);
        log('success', `[INBOUND] 🔄 Successfully marked Updateflag = 1 and synced_at in VPS BOOKLOGIC for Res_ids: [${committedResIds.join(', ')}]`);
      } catch (flagErr) {
        try {
          await pgClient.query(`
            UPDATE ${pgTables.reservations}
            SET updateflag = 1, synced_at = CURRENT_TIMESTAMP
            WHERE res_id = ANY($1::bigint[]) OR res_id = ANY($1::int[])
          `, [committedResIds]);
          log('success', `[INBOUND] 🔄 Successfully marked updateflag = 1 in VPS BOOKLOGIC for Res_ids: [${committedResIds.join(', ')}]`);
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
    const result = await mssqlPool.request().query(`
      SELECT TOP 500 *
      FROM dbo.trans_roomavailability_chart_datewise
      WHERE ISNULL(uploadflg, 0) = 0
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
      const hotelcode = getVal(row, 'hotelcode', 'hotel_code') ? String(getVal(row, 'hotelcode', 'hotel_code')) : 'IZM2366';
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
      log('outbound', `Pushed ${syncedAvaids.length} Room Availability records to VPS BOOKLOGIC and marked uploadflg = 1 in SQL Server.`);
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

    const result = await mssqlPool.request().query(`
      SELECT TOP 500 *
      FROM dbo.trans_roomrateupdates_datewise
      WHERE ISNULL(uploadflg, 0) = 0
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
      const hotelcode = getVal(row, 'hotelcode', 'hotel_code') ? String(getVal(row, 'hotelcode', 'hotel_code')) : 'IZM2366';
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
      log('outbound', `Pushed ${syncedRateIds.length} Room Rate Updates to VPS BOOKLOGIC and marked uploadflg = 1 in SQL Server.`);
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
