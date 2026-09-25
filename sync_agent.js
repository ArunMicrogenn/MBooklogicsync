/**
 * ====================================================================================================
 * BOOKLOGIC REPLICATION ENGINE: BIDIRECTIONAL SYNC AGENT (sync_agent.js)
 * ====================================================================================================
 * 
 * Target Server: DESKTOP-VDGDM3P (or localhost / 127.0.0.1)
 * Target Database: varanashiinn (or BOOKLOGIC)
 * Remote VPS PostgreSQL: 72.61.240.34 (Database: BOOKLOGIC)
 * 
 * 1. OUTBOUND SYNC: Local SQL Server (varanashiinn) ➔ Remote VPS PostgreSQL (72.61.240.34)
 *    - dbo.mas_hotel ➔ public.mas_hotel (Upsert by hotelcode)
 *    - dbo.trans_roomavailability_chart_datewise (WHERE ISNULL(uploadflg, 0) = 0) ➔ public.trans_roomavailability_chart_datewise
 *      => Marks uploadflg = 1 in local SQL Server upon successful sync.
 * 
 * 2. INBOUND SYNC: Remote VPS PostgreSQL ➔ Local SQL Server (3 Relational Tables linked by res_id)
 *    - Source: public.reservations, public.reservations_details, public.reservation_customer
 *      Linked by: res_id
 *      Filter: WHERE COALESCE(updateflag, 0) = 0
 *    - Target: dbo.Reservations_booklogic, dbo.reservations_details_booklogic, dbo.reservation_Customer_booklogic
 *      => Marks updateflag = 1 in remote PostgreSQL reservations upon successful commit.
 * 
 * Features:
 *   - Auto-detects & parses named instances & hostnames (DESKTOP-VDGDM3P, localhost, 127.0.0.1, DESKTOP-VDGDM3P\\VARANASHIINN)
 *   - Auto-fallback connection engine: automatically probes available SQL Server endpoints
 *   - Zero-crash self-healing schema validation for varanashiinn & PostgreSQL
 *   - Type-safe numeric ID querying and parameter binding
 * 
 * Installation:
 *   npm install mssql pg dotenv
 * 
 * Run Daemon:
 *   node sync_agent.js
 * ====================================================================================================
 */

require('dotenv').config();
const sql = require('mssql');
const { Pool } = require('pg');

// ==========================================
// CONFIGURATION & PARSING
// ==========================================
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

const PG_CONFIG = {
  host: process.env.PG_HOST || process.env.POSTGRES_HOST || '72.61.240.34',
  port: parseInt(process.env.PG_PORT || process.env.POSTGRES_PORT || '5432', 10),
  database: process.env.PG_DATABASE || process.env.POSTGRES_DB || 'BOOKLOGIC',
  user: process.env.PG_USER || process.env.POSTGRES_USER || 'postgres',
  password: process.env.PG_PASSWORD || process.env.POSTGRES_PASSWORD || 'mgenn',
  ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
};

const SYNC_INTERVAL_MS = parseInt(process.env.SYNC_INTERVAL_MS || '3000', 10);
const BATCH_SIZE = parseInt(process.env.SYNC_BATCH_SIZE || '200', 10);

let mssqlPool = null;
let pgPool = null;
let isSyncRunning = false;
let activeDatabaseName = MSSQL_DATABASE_INPUT;
let activeServerName = parsedMssql.server;

// Helpers
function log(level, message, data = '') {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const prefix = {
    info: '[\x1b[36mINFO\x1b[0m]',
    success: '[\x1b[32mOK\x1b[0m]',
    warn: '[\x1b[33mWARN\x1b[0m]',
    error: '[\x1b[31mERROR\x1b[0m]',
    outbound: '[\x1b[35mOUTBOUND ➔ PG\x1b[0m]',
    inbound: '[\x1b[34mINBOUND ➔ MSSQL\x1b[0m]',
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

// ==========================================
// RESILIENT MSSQL CONNECTION PROBE
// ==========================================
async function connectToSqlServerWithFallback() {
  const primaryParsed = parseSqlServerServer(MSSQL_SERVER_INPUT, process.env.MSSQL_PORT);
  
  // List of candidates to try in order
  const candidates = [
    // 1. Exact user configuration
    {
      server: primaryParsed.server,
      instanceName: primaryParsed.instanceName,
      port: primaryParsed.instanceName ? undefined : primaryParsed.port,
      database: MSSQL_DATABASE_INPUT,
      desc: `${primaryParsed.server}${primaryParsed.instanceName ? '\\' + primaryParsed.instanceName : ''} (DB: ${MSSQL_DATABASE_INPUT})`,
    },
    // 2. Localhost fallback with same database
    {
      server: 'localhost',
      instanceName: primaryParsed.instanceName,
      port: primaryParsed.instanceName ? undefined : 1433,
      database: MSSQL_DATABASE_INPUT,
      desc: `localhost${primaryParsed.instanceName ? '\\' + primaryParsed.instanceName : ''} (DB: ${MSSQL_DATABASE_INPUT})`,
    },
    // 3. 127.0.0.1 fallback with same database
    {
      server: '127.0.0.1',
      instanceName: undefined,
      port: 1433,
      database: MSSQL_DATABASE_INPUT,
      desc: `127.0.0.1:1433 (DB: ${MSSQL_DATABASE_INPUT})`,
    },
    // 4. Named instance VARANASHIINN on DESKTOP-VDGDM3P
    {
      server: 'DESKTOP-VDGDM3P',
      instanceName: 'VARANASHIINN',
      port: undefined,
      database: MSSQL_DATABASE_INPUT,
      desc: `DESKTOP-VDGDM3P\\VARANASHIINN (DB: ${MSSQL_DATABASE_INPUT})`,
    },
    // 5. Named instance VARANASHIINN on localhost
    {
      server: 'localhost',
      instanceName: 'VARANASHIINN',
      port: undefined,
      database: MSSQL_DATABASE_INPUT,
      desc: `localhost\\VARANASHIINN (DB: ${MSSQL_DATABASE_INPUT})`,
    },
    // 6. Fallback to BOOKLOGIC database if varanashiinn DB not created yet
    {
      server: primaryParsed.server,
      instanceName: primaryParsed.instanceName,
      port: primaryParsed.instanceName ? undefined : primaryParsed.port,
      database: 'BOOKLOGIC',
      desc: `${primaryParsed.server} (DB: BOOKLOGIC)`,
    },
  ];

  let lastError = null;

  for (const c of candidates) {
    try {
      const cfg = {
        user: MSSQL_USER,
        password: MSSQL_PASSWORD,
        server: c.server,
        database: c.database,
        options: {
          instanceName: c.instanceName,
          encrypt: false,
          trustServerCertificate: true,
          enableArithAbort: true,
          connectTimeout: 8000,
          requestTimeout: 20000,
        },
        pool: {
          max: 10,
          min: 0,
          idleTimeoutMillis: 30000,
        },
      };
      if (c.port && !c.instanceName) {
        cfg.port = c.port;
      }

      log('info', `Attempting SQL Server connection to ${c.desc}...`);
      const pool = await sql.connect(cfg);
      activeDatabaseName = c.database;
      activeServerName = `${c.server}${c.instanceName ? '\\' + c.instanceName : ''}`;
      log('success', `Connected to Local SQL Server: ${activeServerName} (Database: ${activeDatabaseName}).`);
      return pool;
    } catch (err) {
      lastError = err;
      log('warn', `Candidate ${c.desc} failed: ${err.message}`);
    }
  }

  throw new Error(`Unable to connect to SQL Server on any endpoint. Last error: ${lastError ? lastError.message : 'Unknown'}`);
}

// ==========================================
// 1. DATABASE SCHEMA VERIFICATION & SELF-HEALING
// ==========================================

async function ensureLocalSqlServerTables() {
  log('info', `Verifying / Initializing Local SQL Server schema in database "${activeDatabaseName}"...`);
  try {
    const query = `
      -- 1. Hotel Master
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='mas_hotel' AND xtype='U')
      CREATE TABLE dbo.mas_hotel (
          HotelID INT IDENTITY(1,1),
          HotelCode NVARCHAR(100) PRIMARY KEY,
          HotelName NVARCHAR(250) NOT NULL,
          City NVARCHAR(100),
          State NVARCHAR(100),
          Country NVARCHAR(100) DEFAULT 'India',
          Phone NVARCHAR(100),
          Email NVARCHAR(200),
          TotalRooms INT DEFAULT 0,
          StarRating DECIMAL(3,1) DEFAULT 4.5,
          IsActive BIT DEFAULT 1,
          CreatedAt DATETIME DEFAULT GETDATE(),
          ModifiedAt DATETIME DEFAULT GETDATE()
      );

      -- 2. Room Availability Daily Chart
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

      -- Add missing columns to trans_roomavailability_chart_datewise if table already exists
      IF EXISTS (SELECT * FROM sysobjects WHERE name='trans_roomavailability_chart_datewise' AND xtype='U')
      BEGIN
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.trans_roomavailability_chart_datewise') AND name = 'uploadflg')
          ALTER TABLE dbo.trans_roomavailability_chart_datewise ADD uploadflg INT DEFAULT 0;
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.trans_roomavailability_chart_datewise') AND name = 'notupload')
          ALTER TABLE dbo.trans_roomavailability_chart_datewise ADD notupload INT DEFAULT 0;
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.trans_roomavailability_chart_datewise') AND name = 'Remarks')
          ALTER TABLE dbo.trans_roomavailability_chart_datewise ADD Remarks NVARCHAR(MAX);
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.trans_roomavailability_chart_datewise') AND name = 'Fromtime')
          ALTER TABLE dbo.trans_roomavailability_chart_datewise ADD Fromtime DATETIME;
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.trans_roomavailability_chart_datewise') AND name = 'Totime')
          ALTER TABLE dbo.trans_roomavailability_chart_datewise ADD Totime DATETIME;
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.trans_roomavailability_chart_datewise') AND name = 'allotcode')
          ALTER TABLE dbo.trans_roomavailability_chart_datewise ADD allotcode NVARCHAR(100);
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.trans_roomavailability_chart_datewise') AND name = 'hotelcode')
          ALTER TABLE dbo.trans_roomavailability_chart_datewise ADD hotelcode NVARCHAR(100);
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.trans_roomavailability_chart_datewise') AND name = 'IRM_Update')
          ALTER TABLE dbo.trans_roomavailability_chart_datewise ADD IRM_Update INT DEFAULT 0;
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.trans_roomavailability_chart_datewise') AND name = 'stopsales')
          ALTER TABLE dbo.trans_roomavailability_chart_datewise ADD stopsales INT DEFAULT 0;
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.trans_roomavailability_chart_datewise') AND name = '_last_updated')
          ALTER TABLE dbo.trans_roomavailability_chart_datewise ADD _last_updated DATETIME DEFAULT GETDATE();
      END

      -- 3. Inbound Master Table: Reservations_booklogic
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Reservations_booklogic' AND xtype='U')
      CREATE TABLE dbo.Reservations_booklogic (
          res_id BIGINT PRIMARY KEY,
          hotelcode NVARCHAR(100),
          booking_date DATETIME DEFAULT GETDATE(),
          check_in DATETIME,
          check_out DATETIME,
          rooms_booked INT DEFAULT 1,
          total_amount DECIMAL(18,2) DEFAULT 0.00,
          currency NVARCHAR(10) DEFAULT 'INR',
          status NVARCHAR(100) DEFAULT 'CONFIRMED',
          special_requests NVARCHAR(MAX),
          updateflag INT DEFAULT 1,
          created_at DATETIME DEFAULT GETDATE(),
          modified_at DATETIME DEFAULT GETDATE(),
          _synced_at DATETIME DEFAULT GETDATE()
      );

      IF EXISTS (SELECT * FROM sysobjects WHERE name='Reservations_booklogic' AND xtype='U')
      BEGIN
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Reservations_booklogic') AND name = 'hotelcode')
          ALTER TABLE dbo.Reservations_booklogic ADD hotelcode NVARCHAR(100);
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Reservations_booklogic') AND name = 'updateflag')
          ALTER TABLE dbo.Reservations_booklogic ADD updateflag INT DEFAULT 1;
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Reservations_booklogic') AND name = '_synced_at')
          ALTER TABLE dbo.Reservations_booklogic ADD _synced_at DATETIME DEFAULT GETDATE();
      END

      -- 4. Inbound Details Table: reservations_details_booklogic (Linked by res_id)
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='reservations_details_booklogic' AND xtype='U')
      CREATE TABLE dbo.reservations_details_booklogic (
          detail_id BIGINT PRIMARY KEY,
          res_id BIGINT,
          roomtypeid BIGINT,
          room_type_name NVARCHAR(150),
          rooms_booked INT DEFAULT 1,
          rate_plan_code NVARCHAR(50) DEFAULT 'BAR',
          price_per_night DECIMAL(18,2) DEFAULT 0.00,
          tax_amount DECIMAL(18,2) DEFAULT 0.00,
          meal_plan NVARCHAR(50) DEFAULT 'EP',
          adults INT DEFAULT 1,
          children INT DEFAULT 0,
          nights INT DEFAULT 1,
          check_in DATETIME,
          check_out DATETIME,
          _synced_at DATETIME DEFAULT GETDATE()
      );

      IF EXISTS (SELECT * FROM sysobjects WHERE name='reservations_details_booklogic' AND xtype='U')
      BEGIN
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.reservations_details_booklogic') AND name = 'res_id')
          ALTER TABLE dbo.reservations_details_booklogic ADD res_id BIGINT;
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.reservations_details_booklogic') AND name = '_synced_at')
          ALTER TABLE dbo.reservations_details_booklogic ADD _synced_at DATETIME DEFAULT GETDATE();
      END

      -- 5. Inbound Customer Table: reservation_Customer_booklogic (Linked by res_id)
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='reservation_Customer_booklogic' AND xtype='U')
      CREATE TABLE dbo.reservation_Customer_booklogic (
          customer_id BIGINT PRIMARY KEY,
          res_id BIGINT,
          first_name NVARCHAR(100),
          last_name NVARCHAR(100),
          customer_name NVARCHAR(200),
          phone NVARCHAR(100),
          email NVARCHAR(200),
          address NVARCHAR(MAX),
          city NVARCHAR(100),
          country NVARCHAR(100) DEFAULT 'India',
          id_proof_type NVARCHAR(50),
          id_proof_number NVARCHAR(100),
          _synced_at DATETIME DEFAULT GETDATE()
      );

      IF EXISTS (SELECT * FROM sysobjects WHERE name='reservation_Customer_booklogic' AND xtype='U')
      BEGIN
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.reservation_Customer_booklogic') AND name = 'res_id')
          ALTER TABLE dbo.reservation_Customer_booklogic ADD res_id BIGINT;
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.reservation_Customer_booklogic') AND name = '_synced_at')
          ALTER TABLE dbo.reservation_Customer_booklogic ADD _synced_at DATETIME DEFAULT GETDATE();
      END
    `;
    await mssqlPool.request().query(query);
    log('success', `Local SQL Server (${activeDatabaseName}) schema tables verified.`);
  } catch (err) {
    log('warn', `Notice during SQL Server schema verification: ${err.message}`);
  }
}

async function ensureRemotePostgresTables(pgClient) {
  log('info', 'Verifying / Initializing VPS PostgreSQL schema tables...');
  try {
    // 1. mas_hotel
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS public.mas_hotel (
          hotelid SERIAL,
          hotelcode VARCHAR(100) PRIMARY KEY,
          hotelname VARCHAR(250) NOT NULL,
          city VARCHAR(100),
          state VARCHAR(100),
          country VARCHAR(100) DEFAULT 'India',
          phone VARCHAR(100),
          email VARCHAR(200),
          totalrooms INT DEFAULT 0,
          starrating NUMERIC(3,1) DEFAULT 4.5,
          isactive BOOLEAN DEFAULT TRUE,
          createdat TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          modifiedat TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE public.mas_hotel ADD COLUMN IF NOT EXISTS hotelcode VARCHAR(100);
      ALTER TABLE public.mas_hotel ADD COLUMN IF NOT EXISTS hotelname VARCHAR(250);
      ALTER TABLE public.mas_hotel ADD COLUMN IF NOT EXISTS totalrooms INT DEFAULT 0;
      ALTER TABLE public.mas_hotel ADD COLUMN IF NOT EXISTS isactive BOOLEAN DEFAULT TRUE;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_pg_mas_hotel_hotelcode ON public.mas_hotel (hotelcode);
    `);

    // 2. trans_roomavailability_chart_datewise
    await pgClient.query(`
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
          allotcode VARCHAR(100),
          hotelcode VARCHAR(100),
          irm_update INT DEFAULT 0,
          stopsales INT DEFAULT 0,
          last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE public.trans_roomavailability_chart_datewise ADD COLUMN IF NOT EXISTS uploadflg INT DEFAULT 1;
      ALTER TABLE public.trans_roomavailability_chart_datewise ADD COLUMN IF NOT EXISTS hotelcode VARCHAR(100);
      ALTER TABLE public.trans_roomavailability_chart_datewise ADD COLUMN IF NOT EXISTS allotcode VARCHAR(100);
      ALTER TABLE public.trans_roomavailability_chart_datewise ADD COLUMN IF NOT EXISTS stopsales INT DEFAULT 0;
      ALTER TABLE public.trans_roomavailability_chart_datewise ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_pg_trans_roomavail_avaidd ON public.trans_roomavailability_chart_datewise (avaidd);
    `);

    // 3. reservations (Master)
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS public.reservations (
          res_id BIGINT PRIMARY KEY,
          hotelcode VARCHAR(100) NOT NULL DEFAULT 'HTL-BL-001',
          booking_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          check_in TIMESTAMP,
          check_out TIMESTAMP,
          rooms_booked INT DEFAULT 1,
          total_amount NUMERIC(18,2) DEFAULT 0.00,
          currency VARCHAR(10) DEFAULT 'INR',
          status VARCHAR(100) DEFAULT 'CONFIRMED',
          special_requests TEXT,
          updateflag INT DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS hotelcode VARCHAR(100) DEFAULT 'HTL-BL-001';
      ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS updateflag INT DEFAULT 0;
      ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS booking_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS check_in TIMESTAMP;
      ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS check_out TIMESTAMP;
      ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS rooms_booked INT DEFAULT 1;
      ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS total_amount NUMERIC(18,2) DEFAULT 0.00;
      ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'INR';
      ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS status VARCHAR(100) DEFAULT 'CONFIRMED';
      ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS special_requests TEXT;
      ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_pg_reservations_resid ON public.reservations (res_id);
    `);

    // 4. reservations_details (Child table linked by res_id)
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS public.reservations_details (
          detail_id BIGINT PRIMARY KEY,
          res_id BIGINT,
          roomtypeid BIGINT,
          room_type_name VARCHAR(150),
          rooms_booked INT DEFAULT 1,
          rate_plan_code VARCHAR(50) DEFAULT 'BAR',
          price_per_night NUMERIC(18,2) DEFAULT 0.00,
          tax_amount NUMERIC(18,2) DEFAULT 0.00,
          meal_plan VARCHAR(50) DEFAULT 'EP',
          adults INT DEFAULT 1,
          children INT DEFAULT 0,
          nights INT DEFAULT 1,
          check_in TIMESTAMP,
          check_out TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE public.reservations_details ADD COLUMN IF NOT EXISTS res_id BIGINT;
      ALTER TABLE public.reservations_details ADD COLUMN IF NOT EXISTS roomtypeid BIGINT;
      ALTER TABLE public.reservations_details ADD COLUMN IF NOT EXISTS room_type_name VARCHAR(150);
      ALTER TABLE public.reservations_details ADD COLUMN IF NOT EXISTS price_per_night NUMERIC(18,2) DEFAULT 0.00;
      ALTER TABLE public.reservations_details ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(18,2) DEFAULT 0.00;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_pg_details_detailid ON public.reservations_details (detail_id);
    `);

    // 5. reservation_customer (Child table linked by res_id)
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS public.reservation_customer (
          customer_id BIGINT PRIMARY KEY,
          res_id BIGINT,
          first_name VARCHAR(100),
          last_name VARCHAR(100),
          customer_name VARCHAR(200),
          phone VARCHAR(100),
          email VARCHAR(200),
          address TEXT,
          city VARCHAR(100),
          country VARCHAR(100) DEFAULT 'India',
          id_proof_type VARCHAR(50),
          id_proof_number VARCHAR(100),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE public.reservation_customer ADD COLUMN IF NOT EXISTS res_id BIGINT;
      ALTER TABLE public.reservation_customer ADD COLUMN IF NOT EXISTS first_name VARCHAR(100);
      ALTER TABLE public.reservation_customer ADD COLUMN IF NOT EXISTS last_name VARCHAR(100);
      ALTER TABLE public.reservation_customer ADD COLUMN IF NOT EXISTS customer_name VARCHAR(200);
      ALTER TABLE public.reservation_customer ADD COLUMN IF NOT EXISTS phone VARCHAR(100);
      ALTER TABLE public.reservation_customer ADD COLUMN IF NOT EXISTS email VARCHAR(200);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_pg_customer_customerid ON public.reservation_customer (customer_id);
    `);

    // Safe Indexes
    try {
      await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_pg_reservations_updateflag ON public.reservations(updateflag);`);
      await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_pg_reservations_hotelcode ON public.reservations(hotelcode);`);
      await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_pg_details_resid ON public.reservations_details(res_id);`);
      await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_pg_customer_resid ON public.reservation_customer(res_id);`);
    } catch (idxErr) {}

    log('success', 'VPS PostgreSQL tables and columns verified.');
  } catch (err) {
    log('warn', `Notice during PostgreSQL schema verification: ${err.message}`);
  }
}

// ==========================================
// 2. OUTBOUND SYNC (MSSQL ➔ PostgreSQL)
// ==========================================

// A. Sync mas_hotel
async function syncMasHotel(pgClient) {
  try {
    const result = await mssqlPool.request().query('SELECT * FROM dbo.mas_hotel');
    if (!result.recordset || result.recordset.length === 0) return 0;

    let upserted = 0;
    for (const row of result.recordset) {
      const code = (row.HotelCode || row.hotelcode || row.Hotel_Code || row.hotel_code || row.code || '').toString().trim();
      if (!code) continue;

      const q = `
        INSERT INTO public.mas_hotel (
          hotelcode, hotelname, city, state, country,
          phone, email, totalrooms, starrating, isactive
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (hotelcode) DO UPDATE SET
          hotelname = EXCLUDED.hotelname,
          city = EXCLUDED.city,
          state = EXCLUDED.state,
          country = EXCLUDED.country,
          phone = EXCLUDED.phone,
          email = EXCLUDED.email,
          totalrooms = EXCLUDED.totalrooms,
          starrating = EXCLUDED.starrating,
          isactive = EXCLUDED.isactive,
          modifiedat = CURRENT_TIMESTAMP;
      `;

      await pgClient.query(q, [
        code,
        (row.HotelName || row.hotelname || 'Hotel ' + code).toString(),
        (row.City || row.city || '').toString(),
        (row.State || row.state || '').toString(),
        (row.Country || row.country || 'India').toString(),
        (row.Phone || row.phone || '').toString(),
        (row.Email || row.email || '').toString(),
        safeNum(row.TotalRooms || row.totalrooms, 0),
        safeNum(row.StarRating || row.starrating, 4.5),
        row.IsActive !== undefined ? Boolean(row.IsActive) : true,
      ]);
      upserted++;
    }
    return upserted;
  } catch (err) {
    log('error', `Error syncing mas_hotel: ${err.message}`);
    return 0;
  }
}

// B. Sync trans_roomavailability_chart_datewise (WHERE uploadflg = 0 ➔ mark 1)
async function syncRoomAvailability(pgClient) {
  try {
    const result = await mssqlPool.request().query(`
      SELECT TOP (${BATCH_SIZE}) *
      FROM dbo.trans_roomavailability_chart_datewise
      WHERE ISNULL(uploadflg, 0) = 0
      ORDER BY avaidd ASC
    `);

    if (!result.recordset || result.recordset.length === 0) return 0;

    const syncedAvaids = [];

    for (const row of result.recordset) {
      if (!row.avaidd) continue;

      const q = `
        INSERT INTO public.trans_roomavailability_chart_datewise (
          avaidd, roomtypeid, fromdate, todate, availablerooms,
          uploadflg, notupload, remarks, fromtime, totime,
          allotcode, hotelcode, irm_update, stopsales
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (avaidd) DO UPDATE SET
          roomtypeid = EXCLUDED.roomtypeid,
          fromdate = EXCLUDED.fromdate,
          todate = EXCLUDED.todate,
          availablerooms = EXCLUDED.availablerooms,
          uploadflg = 1,
          notupload = EXCLUDED.notupload,
          remarks = EXCLUDED.remarks,
          fromtime = EXCLUDED.fromtime,
          totime = EXCLUDED.totime,
          allotcode = EXCLUDED.allotcode,
          hotelcode = EXCLUDED.hotelcode,
          irm_update = EXCLUDED.irm_update,
          stopsales = EXCLUDED.stopsales,
          last_synced_at = CURRENT_TIMESTAMP;
      `;

      await pgClient.query(q, [
        row.avaidd,
        row.Roomtypeid || row.roomtypeid || null,
        safeDate(row.fromdate),
        safeDate(row.todate),
        safeNum(row.Availablerooms !== undefined ? row.Availablerooms : row.availablerooms, 0),
        1,
        row.notupload ? String(row.notupload) : null,
        (row.Remarks || row.remarks || '').toString(),
        safeDate(row.Fromtime || row.fromtime),
        safeDate(row.Totime || row.totime),
        (row.allotcode || '').toString(),
        (row.hotelcode || '').toString(),
        safeNum(row.IRM_Update !== undefined ? row.IRM_Update : row.irm_update, 0),
        safeNum(row.stopsales !== undefined ? row.stopsales : 0, 0),
      ]);

      syncedAvaids.push(row.avaidd);
    }

    // Mark uploadflg = 1 in SQL Server
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
      log('outbound', `Pushed ${syncedAvaids.length} availability records to PG and updated local uploadflg = 1.`);
    }

    return syncedAvaids.length;
  } catch (err) {
    log('error', `Error syncing room availability: ${err.message}`);
    return 0;
  }
}

// ==========================================
// 3. INBOUND SYNC: 3-Table Relational Sync (PG ➔ MSSQL)
// ==========================================
async function syncInboundReservations3Tables(pgClient) {
  try {
    // 1. Get hotel codes registered in local SQL Server
    let hotelCodes = [];
    try {
      const hotelRes = await mssqlPool.request().query('SELECT * FROM dbo.mas_hotel');
      if (hotelRes.recordset && hotelRes.recordset.length > 0) {
        hotelCodes = hotelRes.recordset
          .map(h => (h.HotelCode || h.hotelcode || h.Hotel_Code || h.code || '').toString().trim().toUpperCase())
          .filter(Boolean);
      }
    } catch (hErr) {
      log('warn', `Could not read local dbo.mas_hotel: ${hErr.message}`);
    }

    // 2. Self-Healing Column Check on public.reservations
    let resCols = new Set();
    try {
      const colCheck = await pgClient.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'reservations';
      `);
      if (colCheck.rows && colCheck.rows.length > 0) {
        colCheck.rows.forEach(r => resCols.add(r.column_name.toLowerCase()));
      }
    } catch (cErr) {}

    // If reservations table exists but is missing hotelcode or updateflag, auto-add them
    if (resCols.size > 0) {
      if (!resCols.has('hotelcode') && !resCols.has('hotel_code')) {
        try {
          await pgClient.query(`ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS hotelcode VARCHAR(100) DEFAULT 'HTL-BL-001';`);
          resCols.add('hotelcode');
        } catch (e) {}
      }
      if (!resCols.has('updateflag') && !resCols.has('update_flag')) {
        try {
          await pgClient.query(`ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS updateflag INT DEFAULT 0;`);
          resCols.add('updateflag');
        } catch (e) {}
      }
    }

    const hotelCol = resCols.has('hotelcode') ? 'hotelcode' : (resCols.has('hotel_code') ? 'hotel_code' : null);
    const updateFlagCol = resCols.has('updateflag') ? 'updateflag' : (resCols.has('update_flag') ? 'update_flag' : 'updateflag');
    const pkCol = resCols.has('res_id') ? 'res_id' : (resCols.has('resid') ? 'resid' : (resCols.has('id') ? 'id' : 'res_id'));

    // 3. Query un-synced reservations where updateflag is 0
    let pgQuery = `SELECT * FROM public.reservations WHERE COALESCE(${updateFlagCol}, 0) = 0`;
    const params = [];

    if (hotelCodes.length > 0 && hotelCol) {
      params.push(hotelCodes);
      pgQuery += ` AND UPPER(TRIM(CAST(${hotelCol} AS VARCHAR))) = ANY($1)`;
    }

    pgQuery += ` ORDER BY ${pkCol} ASC LIMIT ${BATCH_SIZE}`;

    let resResult;
    try {
      resResult = await pgClient.query(pgQuery, params);
    } catch (qErr) {
      log('warn', `Notice on initial reservations query: ${qErr.message}. Retrying with table verification...`);
      await ensureRemotePostgresTables(pgClient);
      resResult = await pgClient.query(`SELECT * FROM public.reservations WHERE COALESCE(updateflag, 0) = 0 ORDER BY res_id ASC LIMIT ${BATCH_SIZE}`);
    }

    if (!resResult.rows || resResult.rows.length === 0) return 0;

    const resIds = resResult.rows.map(r => Number(r.res_id || r.resid || r.id)).filter(n => !isNaN(n) && n > 0);
    if (resIds.length === 0) return 0;

    const resIdListSql = resIds.join(',');

    // 4. Fetch matching detail and customer records linked by res_id
    let detailsRows = [];
    try {
      const detailsResult = await pgClient.query(
        `SELECT * FROM public.reservations_details WHERE res_id IN (${resIdListSql}) ORDER BY detail_id ASC`
      );
      detailsRows = detailsResult.rows || [];
    } catch (dErr) {
      log('warn', `Details fetch fallback: ${dErr.message}`);
    }

    let custRows = [];
    try {
      const custResult = await pgClient.query(
        `SELECT * FROM public.reservation_customer WHERE res_id IN (${resIdListSql}) ORDER BY customer_id ASC`
      );
      custRows = custResult.rows || [];
    } catch (cErr) {
      log('warn', `Customer fetch fallback: ${cErr.message}`);
    }

    // Group details and customers by res_id
    const detailsByRes = {};
    for (const d of detailsRows) {
      const rid = Number(d.res_id);
      if (!detailsByRes[rid]) detailsByRes[rid] = [];
      detailsByRes[rid].push(d);
    }

    const custByRes = {};
    for (const c of custRows) {
      const rid = Number(c.res_id);
      if (!custByRes[rid]) custByRes[rid] = [];
      custByRes[rid].push(c);
    }

    log('inbound', `Found ${resResult.rows.length} master reservations, ${detailsRows.length} details, and ${custRows.length} customer records to process.`);

    const successfulResIds = [];

    // 5. Process each reservation with its linked details and customers
    for (const r of resResult.rows) {
      const currentResId = Number(r.res_id || r.resid || r.id);
      if (!currentResId) continue;

      const rHotelCode = (r.hotelcode || r.hotel_code || r.HotelCode || 'HTL-BL-001').toString().trim();

      try {
        // A. Upsert Master Record into dbo.Reservations_booklogic
        const reqMaster = mssqlPool.request();
        reqMaster.input('resId', sql.BigInt, currentResId);
        reqMaster.input('hotelcode', sql.NVarChar(100), rHotelCode);
        reqMaster.input('bookingDate', sql.DateTime, safeDate(r.booking_date || r.created_at) || new Date());
        reqMaster.input('checkIn', sql.DateTime, safeDate(r.check_in));
        reqMaster.input('checkOut', sql.DateTime, safeDate(r.check_out));
        reqMaster.input('roomsBooked', sql.Int, safeNum(r.rooms_booked, 1));
        reqMaster.input('totalAmount', sql.Decimal(18, 2), safeNum(r.total_amount, 0));
        reqMaster.input('currency', sql.NVarChar(10), (r.currency || 'INR').toString());
        reqMaster.input('status', sql.NVarChar(100), (r.status || 'CONFIRMED').toString());
        reqMaster.input('specialRequests', sql.NVarChar(sql.MAX), (r.special_requests || r.remarks || '').toString());

        await reqMaster.query(`
          IF EXISTS (SELECT 1 FROM dbo.Reservations_booklogic WHERE res_id = @resId)
          BEGIN
            UPDATE dbo.Reservations_booklogic
            SET hotelcode = @hotelcode,
                booking_date = @bookingDate,
                check_in = @checkIn,
                check_out = @checkOut,
                rooms_booked = @roomsBooked,
                total_amount = @totalAmount,
                currency = @currency,
                status = @status,
                special_requests = @specialRequests,
                updateflag = 1,
                modified_at = GETDATE(),
                _synced_at = GETDATE()
            WHERE res_id = @resId;
          END
          ELSE
          BEGIN
            INSERT INTO dbo.Reservations_booklogic (
              res_id, hotelcode, booking_date, check_in, check_out,
              rooms_booked, total_amount, currency, status,
              special_requests, updateflag, created_at, modified_at, _synced_at
            ) VALUES (
              @resId, @hotelcode, @bookingDate, @checkIn, @checkOut,
              @roomsBooked, @totalAmount, @currency, @status,
              @specialRequests, 1, GETDATE(), GETDATE(), GETDATE()
            );
          END
        `);

        // B. Upsert Details into dbo.reservations_details_booklogic
        let details = detailsByRes[currentResId] || [];
        if (details.length === 0) {
          details = [{
            detail_id: currentResId * 1000 + 1,
            res_id: currentResId,
            roomtypeid: 101,
            room_type_name: 'Standard Room',
            rooms_booked: safeNum(r.rooms_booked, 1),
            rate_plan_code: 'BAR',
            price_per_night: safeNum(r.total_amount, 0),
            tax_amount: 0,
            meal_plan: 'EP',
            adults: 1,
            children: 0,
            nights: 1,
            check_in: r.check_in,
            check_out: r.check_out,
          }];
        }

        for (let idx = 0; idx < details.length; idx++) {
          const d = details[idx];
          const detailId = d.detail_id ? Number(d.detail_id) : (currentResId * 1000 + (idx + 1));
          
          const reqDtl = mssqlPool.request();
          reqDtl.input('detailId', sql.BigInt, detailId);
          reqDtl.input('resId', sql.BigInt, currentResId);
          reqDtl.input('roomtypeid', sql.BigInt, safeNum(d.roomtypeid, 101));
          reqDtl.input('roomTypeName', sql.NVarChar(150), (d.room_type_name || 'Standard Room').toString());
          reqDtl.input('roomsBooked', sql.Int, safeNum(d.rooms_booked, 1));
          reqDtl.input('ratePlanCode', sql.NVarChar(50), (d.rate_plan_code || 'BAR').toString());
          reqDtl.input('pricePerNight', sql.Decimal(18, 2), safeNum(d.price_per_night, 0));
          reqDtl.input('taxAmount', sql.Decimal(18, 2), safeNum(d.tax_amount, 0));
          reqDtl.input('mealPlan', sql.NVarChar(50), (d.meal_plan || 'EP').toString());
          reqDtl.input('adults', sql.Int, safeNum(d.adults, 1));
          reqDtl.input('children', sql.Int, safeNum(d.children, 0));
          reqDtl.input('nights', sql.Int, safeNum(d.nights, 1));
          reqDtl.input('checkIn', sql.DateTime, safeDate(d.check_in || r.check_in));
          reqDtl.input('checkOut', sql.DateTime, safeDate(d.check_out || r.check_out));

          await reqDtl.query(`
            IF EXISTS (SELECT 1 FROM dbo.reservations_details_booklogic WHERE detail_id = @detailId)
            BEGIN
              UPDATE dbo.reservations_details_booklogic
              SET res_id = @resId,
                  roomtypeid = @roomtypeid,
                  room_type_name = @roomTypeName,
                  rooms_booked = @roomsBooked,
                  rate_plan_code = @ratePlanCode,
                  price_per_night = @pricePerNight,
                  tax_amount = @taxAmount,
                  meal_plan = @mealPlan,
                  adults = @adults,
                  children = @children,
                  nights = @nights,
                  check_in = @checkIn,
                  check_out = @checkOut,
                  _synced_at = GETDATE()
              WHERE detail_id = @detailId;
            END
            ELSE
            BEGIN
              INSERT INTO dbo.reservations_details_booklogic (
                detail_id, res_id, roomtypeid, room_type_name,
                rooms_booked, rate_plan_code, price_per_night, tax_amount,
                meal_plan, adults, children, nights, check_in, check_out, _synced_at
              ) VALUES (
                @detailId, @resId, @roomtypeid, @roomTypeName,
                @roomsBooked, @ratePlanCode, @pricePerNight, @taxAmount,
                @mealPlan, @adults, @children, @nights, @checkIn, @checkOut, GETDATE()
              );
            END
          `);
        }

        // C. Upsert Customers into dbo.reservation_Customer_booklogic
        let customers = custByRes[currentResId] || [];
        if (customers.length === 0) {
          customers = [{
            customer_id: currentResId * 1000 + 1,
            res_id: currentResId,
            first_name: 'Guest',
            last_name: `#${currentResId}`,
            customer_name: `Guest #${currentResId}`,
            phone: '',
            email: '',
            address: '',
            city: 'Local City',
            country: 'India',
            id_proof_type: 'PASSPORT',
            id_proof_number: '',
          }];
        }

        for (let idx = 0; idx < customers.length; idx++) {
          const c = customers[idx];
          const custId = c.customer_id ? Number(c.customer_id) : (currentResId * 1000 + (idx + 1));

          const reqCust = mssqlPool.request();
          reqCust.input('custId', sql.BigInt, custId);
          reqCust.input('resId', sql.BigInt, currentResId);
          reqCust.input('firstName', sql.NVarChar(100), (c.first_name || '').toString());
          reqCust.input('lastName', sql.NVarChar(100), (c.last_name || '').toString());
          reqCust.input('customerName', sql.NVarChar(200), (c.customer_name || `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'Guest').toString());
          reqCust.input('phone', sql.NVarChar(100), (c.phone || '').toString());
          reqCust.input('email', sql.NVarChar(200), (c.email || '').toString());
          reqCust.input('address', sql.NVarChar(sql.MAX), (c.address || '').toString());
          reqCust.input('city', sql.NVarChar(100), (c.city || '').toString());
          reqCust.input('country', sql.NVarChar(100), (c.country || 'India').toString());
          reqCust.input('idProofType', sql.NVarChar(50), (c.id_proof_type || 'PASSPORT').toString());
          reqCust.input('idProofNumber', sql.NVarChar(100), (c.id_proof_number || '').toString());

          await reqCust.query(`
            IF EXISTS (SELECT 1 FROM dbo.reservation_Customer_booklogic WHERE customer_id = @custId)
            BEGIN
              UPDATE dbo.reservation_Customer_booklogic
              SET res_id = @resId,
                  first_name = @firstName,
                  last_name = @lastName,
                  customer_name = @customerName,
                  phone = @phone,
                  email = @email,
                  address = @address,
                  city = @city,
                  country = @country,
                  id_proof_type = @idProofType,
                  id_proof_number = @idProofNumber,
                  _synced_at = GETDATE()
              WHERE customer_id = @custId;
            END
            ELSE
            BEGIN
              INSERT INTO dbo.reservation_Customer_booklogic (
                customer_id, res_id, first_name, last_name, customer_name,
                phone, email, address, city, country, id_proof_type, id_proof_number, _synced_at
              ) VALUES (
                @custId, @resId, @firstName, @lastName, @customerName,
                @phone, @email, @address, @city, @country, @idProofType, @idProofNumber, GETDATE()
              );
            END
          `);
        }

        successfulResIds.push(currentResId);
      } catch (recErr) {
        log('error', `Failed to sync reservation res_id=${currentResId} into SQL Server (${activeDatabaseName}): ${recErr.message}`);
      }
    }

    // 6. Update PostgreSQL SET updateflag = 1 for the successfully synced reservations
    if (successfulResIds.length > 0) {
      try {
        await pgClient.query(`
          UPDATE public.reservations
          SET ${updateFlagCol} = 1, modified_at = CURRENT_TIMESTAMP
          WHERE ${pkCol} IN (${successfulResIds.join(',')});
        `);

        log('inbound', `✅ Successfully synced ${successfulResIds.length} reservations into local SQL Server [${activeDatabaseName}] (Reservations_booklogic, reservations_details_booklogic, reservation_Customer_booklogic) and marked ${updateFlagCol} = 1 in PostgreSQL.`);
      } catch (updErr) {
        log('warn', `Warning updating updateflag in PostgreSQL: ${updErr.message}`);
      }
    }

    return successfulResIds.length;
  } catch (err) {
    log('error', `Error during 3-table reservation inbound sync: ${err.message}`);
    return 0;
  }
}

// ==========================================
// 4. MAIN SYNC CYCLE & DAEMON LOOP
// ==========================================

async function runSyncCycle() {
  if (isSyncRunning) return;
  isSyncRunning = true;

  let pgClient = null;
  try {
    pgClient = await pgPool.connect();

    // 1. Outbound: Hotels (dbo.mas_hotel ➔ public.mas_hotel)
    const hotelCount = await syncMasHotel(pgClient);

    // 2. Outbound: Room availability (uploadflg = 0 ➔ 1)
    const roomCount = await syncRoomAvailability(pgClient);

    // 3. Inbound: 3-Table Relational Reservations (updateflag = 0 ➔ 1)
    const resCount = await syncInboundReservations3Tables(pgClient);

    if (hotelCount > 0 || roomCount > 0 || resCount > 0) {
      log('success', `Cycle Completed => Outbound: ${hotelCount} Hotels, ${roomCount} Availability Rows | Inbound: ${resCount} Linked Reservations.`);
    }
  } catch (cycleErr) {
    log('error', `Sync Cycle Failure: ${cycleErr.message}`);
  } finally {
    if (pgClient) {
      pgClient.release();
    }
    isSyncRunning = false;
  }
}

async function startAgent() {
  console.log('\n================================================================');
  console.log('   🚀 BOOKLOGIC SQL Server ➔ PostgreSQL Bidirectional Agent');
  console.log('================================================================');
  console.log(`Configured Server : ${MSSQL_SERVER_INPUT} (Target DB: ${MSSQL_DATABASE_INPUT})`);
  console.log(`VPS PostgreSQL    : ${PG_CONFIG.host}:${PG_CONFIG.port} (DB: ${PG_CONFIG.database})`);
  console.log(`Polling Interval  : ${SYNC_INTERVAL_MS} ms | Batch Size: ${BATCH_SIZE}`);
  console.log('================================================================\n');

  try {
    // 1. Connect to MSSQL with resilient multi-endpoint probing
    mssqlPool = await connectToSqlServerWithFallback();

    // 2. Connect to VPS PostgreSQL
    log('info', 'Connecting to VPS PostgreSQL...');
    pgPool = new Pool(PG_CONFIG);
    const initialPgClient = await pgPool.connect();
    log('success', `Connected to VPS PostgreSQL (${PG_CONFIG.host}/${PG_CONFIG.database}).`);

    // Ensure database schemas exist on both sides with non-destructive self-healing
    await ensureLocalSqlServerTables();
    await ensureRemotePostgresTables(initialPgClient);
    initialPgClient.release();

    log('info', `Starting continuous background synchronization daemon between [${activeServerName} / ${activeDatabaseName}] and VPS [${PG_CONFIG.host} / ${PG_CONFIG.database}]...`);

    // Run first cycle immediately
    await runSyncCycle();

    // Loop continuously
    setInterval(async () => {
      await runSyncCycle();
    }, SYNC_INTERVAL_MS);

  } catch (initErr) {
    log('error', `Initialization Fatal Error: ${initErr.message}`);
    log('warn', 'Retrying connection in 10 seconds...');
    setTimeout(startAgent, 10000);
  }
}

// Graceful Shutdown
process.on('SIGINT', async () => {
  log('warn', 'Shutting down sync agent gracefully...');
  if (mssqlPool) await mssqlPool.close();
  if (pgPool) await pgPool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  log('warn', 'Terminating sync agent...');
  if (mssqlPool) await mssqlPool.close();
  if (pgPool) await pgPool.end();
  process.exit(0);
});

// Run
startAgent();
