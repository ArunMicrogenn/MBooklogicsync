/**
 * ====================================================================================================
 * BOOKLOGIC REPLICATION ENGINE: BIDIRECTIONAL SYNC AGENT (sync_agent.js)
 * ====================================================================================================
 * 
 * 1. OUTBOUND SYNC: Local SQL Server (BOOKLOGIC) ➔ Remote VPS PostgreSQL (BOOKLOGIC)
 *    - dbo.mas_hotel ➔ public.mas_hotel
 *    - dbo.trans_roomavailability_chart_datewise (WHERE ISNULL(uploadflg, 0) = 0) ➔ public.trans_roomavailability_chart_datewise
 *      => Marks uploadflg = 1 in local SQL Server upon successful sync.
 * 
 * 2. INBOUND SYNC: Remote VPS PostgreSQL ➔ Local SQL Server (3 Relational Tables)
 *    - Query: public.reservations, public.reservations_details, public.reservation_customer
 *      Linked by: res_id
 *      Filter: WHERE COALESCE(updateflag, 0) = 0 AND hotelcode IN (SELECT hotelcode FROM dbo.mas_hotel)
 *    - Target: dbo.Reservations_booklogic, dbo.reservations_details_booklogic, dbo.reservation_Customer_booklogic
 *      => Marks updateflag = 1 in remote PostgreSQL reservations upon successful commit.
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
// CONFIGURATION (Environment / Defaults)
// ==========================================
const MSSQL_CONFIG = {
  user: process.env.MSSQL_USER || 'sa',
  password: process.env.MSSQL_PASSWORD || 'mgenn@123',
  server: process.env.MSSQL_SERVER || '127.0.0.1', // e.g., 'DESKTOP-VDGDM3P' or 'localhost'
  port: parseInt(process.env.MSSQL_PORT || '1433', 10),
  database: process.env.MSSQL_DATABASE || 'BOOKLOGIC',
  options: {
    encrypt: process.env.MSSQL_ENCRYPT === 'true',
    trustServerCertificate: true,
    enableArithAbort: true,
    connectTimeout: 15000,
    requestTimeout: 30000,
  },
  pool: {
    max: 10,
    min: 1,
    idleTimeoutMillis: 30000,
  },
};

const PG_CONFIG = {
  host: process.env.PG_HOST || '72.61.240.34',
  port: parseInt(process.env.PG_PORT || '5432', 10),
  database: process.env.PG_DATABASE || 'BOOKLOGIC',
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'YourPostgresPassword',
  ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
};

const SYNC_INTERVAL_MS = parseInt(process.env.SYNC_INTERVAL_MS || '3000', 10);
const BATCH_SIZE = parseInt(process.env.SYNC_BATCH_SIZE || '500', 10);

let mssqlPool = null;
let pgPool = null;
let isSyncRunning = false;

// Helper: Formatted Logger
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

// ==========================================
// 1. DATABASE SCHEMA INITIALIZATION
// ==========================================

async function ensureLocalSqlServerTables() {
  log('info', 'Verifying / Initializing Local SQL Server schema tables...');
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

    -- 4. Inbound Details Table: reservations_details_booklogic (Linked by res_id)
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='reservations_details_booklogic' AND xtype='U')
    CREATE TABLE dbo.reservations_details_booklogic (
        detail_id BIGINT PRIMARY KEY,
        res_id BIGINT FOREIGN KEY REFERENCES dbo.Reservations_booklogic(res_id) ON DELETE CASCADE,
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

    -- 5. Inbound Customer Table: reservation_Customer_booklogic (Linked by res_id)
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='reservation_Customer_booklogic' AND xtype='U')
    CREATE TABLE dbo.reservation_Customer_booklogic (
        customer_id BIGINT PRIMARY KEY,
        res_id BIGINT FOREIGN KEY REFERENCES dbo.Reservations_booklogic(res_id) ON DELETE CASCADE,
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

    -- Indexes for high-speed synchronization
    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='idx_trans_avail_uploadflg')
      CREATE INDEX idx_trans_avail_uploadflg ON dbo.trans_roomavailability_chart_datewise(uploadflg);

    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='idx_res_bklogic_hotel')
      CREATE INDEX idx_res_bklogic_hotel ON dbo.Reservations_booklogic(hotelcode, check_in);

    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='idx_res_dtl_resid')
      CREATE INDEX idx_res_dtl_resid ON dbo.reservations_details_booklogic(res_id);

    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='idx_res_cust_resid')
      CREATE INDEX idx_res_cust_resid ON dbo.reservation_Customer_booklogic(res_id);
  `;
  await mssqlPool.request().query(query);
  log('success', 'Local SQL Server tables and indexes verified.');
}

async function ensureRemotePostgresTables(pgClient) {
  log('info', 'Verifying / Initializing VPS PostgreSQL schema tables...');
  const query = `
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

    CREATE TABLE IF NOT EXISTS public.reservations (
        res_id BIGINT PRIMARY KEY,
        hotelcode VARCHAR(100) NOT NULL,
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

    CREATE TABLE IF NOT EXISTS public.reservations_details (
        detail_id BIGINT PRIMARY KEY,
        res_id BIGINT REFERENCES public.reservations(res_id) ON DELETE CASCADE,
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

    CREATE TABLE IF NOT EXISTS public.reservation_customer (
        customer_id BIGINT PRIMARY KEY,
        res_id BIGINT REFERENCES public.reservations(res_id) ON DELETE CASCADE,
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

    CREATE INDEX IF NOT EXISTS idx_pg_reservations_updateflag ON public.reservations(updateflag);
    CREATE INDEX IF NOT EXISTS idx_pg_reservations_hotelcode ON public.reservations(hotelcode);
    CREATE INDEX IF NOT EXISTS idx_pg_res_dtl_resid ON public.reservations_details(res_id);
    CREATE INDEX IF NOT EXISTS idx_pg_res_cust_resid ON public.reservation_customer(res_id);
  `;
  await pgClient.query(query);
  log('success', 'VPS PostgreSQL tables and indexes verified.');
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
      const code = row.HotelCode || row.hotelcode;
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
        row.HotelName || row.hotelname || 'Unknown Hotel',
        row.City || row.city || '',
        row.State || row.state || '',
        row.Country || row.country || 'India',
        row.Phone || row.phone || '',
        row.Email || row.email || '',
        row.TotalRooms || row.totalrooms || 0,
        row.StarRating || row.starrating || 4.5,
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
        ) OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
        row.fromdate || null,
        row.todate || null,
        row.Availablerooms !== undefined ? row.Availablerooms : (row.availablerooms || 0),
        1,
        row.notupload ? String(row.notupload) : null,
        row.Remarks || row.remarks || '',
        row.Fromtime || row.fromtime || null,
        row.Totime || row.totime || null,
        row.allotcode || '',
        row.hotelcode || '',
        row.IRM_Update !== undefined ? row.IRM_Update : 0,
        row.stopsales !== undefined ? row.stopsales : 0,
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
// Tables linked by common field: res_id
// Condition: WHERE COALESCE(updateflag, 0) = 0 AND hotelcode IN (SELECT hotelcode FROM dbo.mas_hotel)
// Target local tables: Reservations_booklogic, reservations_details_booklogic, reservation_Customer_booklogic
// Post-action: UPDATE public.reservations SET updateflag = 1 WHERE res_id = ANY(...)

async function syncInboundReservations3Tables(pgClient) {
  try {
    // 1. Get valid hotel codes registered in local SQL Server
    const hotelRes = await mssqlPool.request().query('SELECT HotelCode FROM dbo.mas_hotel');
    const hotelCodes = hotelRes.recordset ? hotelRes.recordset.map(h => h.HotelCode || h.hotelcode).filter(Boolean) : [];

    // 2. Fetch un-synced reservations where updateflag is 0 and Hotelcode in active hotels
    let pgQuery = 'SELECT * FROM public.reservations WHERE COALESCE(updateflag, 0) = 0';
    const params = [];

    if (hotelCodes.length > 0) {
      params.push(hotelCodes);
      pgQuery += ' AND hotelcode = ANY($1)';
    }

    pgQuery += ` ORDER BY res_id ASC LIMIT ${BATCH_SIZE}`;

    const resResult = await pgClient.query(pgQuery, params);
    if (!resResult.rows || resResult.rows.length === 0) return 0;

    const resIds = resResult.rows.map(r => Number(r.res_id));

    // 3. Fetch matching detail and customer records linked by res_id
    const detailsResult = await pgClient.query(
      'SELECT * FROM public.reservations_details WHERE res_id = ANY($1::bigint[]) ORDER BY detail_id ASC',
      [resIds]
    );

    const custResult = await pgClient.query(
      'SELECT * FROM public.reservation_customer WHERE res_id = ANY($1::bigint[]) ORDER BY customer_id ASC',
      [resIds]
    );

    log('inbound', `Found ${resResult.rows.length} master reservations, ${detailsResult.rows.length} details, and ${custResult.rows.length} customer records to sync into local SQL Server.`);

    // 4. Upsert Master records into dbo.Reservations_booklogic
    for (const r of resResult.rows) {
      const req = mssqlPool.request();
      req.input('resId', sql.BigInt, r.res_id);
      req.input('hotelcode', sql.NVarChar(100), r.hotelcode || 'HTL-BL-001');
      req.input('bookingDate', sql.DateTime, r.booking_date ? new Date(r.booking_date) : new Date());
      req.input('checkIn', sql.DateTime, r.check_in ? new Date(r.check_in) : null);
      req.input('checkOut', sql.DateTime, r.check_out ? new Date(r.check_out) : null);
      req.input('roomsBooked', sql.Int, r.rooms_booked || 1);
      req.input('totalAmount', sql.Decimal(18, 2), r.total_amount || 0);
      req.input('currency', sql.NVarChar(10), r.currency || 'INR');
      req.input('status', sql.NVarChar(100), r.status || 'CONFIRMED');
      req.input('specialRequests', sql.NVarChar(sql.MAX), r.special_requests || '');

      await req.query(`
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
    }

    // 5. Upsert Detail records into dbo.reservations_details_booklogic (Linked by res_id)
    for (const d of detailsResult.rows) {
      const req = mssqlPool.request();
      req.input('detailId', sql.BigInt, d.detail_id);
      req.input('resId', sql.BigInt, d.res_id);
      req.input('roomtypeid', sql.BigInt, d.roomtypeid || 101);
      req.input('roomTypeName', sql.NVarChar(150), d.room_type_name || 'Standard');
      req.input('roomsBooked', sql.Int, d.rooms_booked || 1);
      req.input('ratePlanCode', sql.NVarChar(50), d.rate_plan_code || 'BAR');
      req.input('pricePerNight', sql.Decimal(18, 2), d.price_per_night || 0);
      req.input('taxAmount', sql.Decimal(18, 2), d.tax_amount || 0);
      req.input('mealPlan', sql.NVarChar(50), d.meal_plan || 'EP');
      req.input('adults', sql.Int, d.adults || 1);
      req.input('children', sql.Int, d.children || 0);
      req.input('nights', sql.Int, d.nights || 1);
      req.input('checkIn', sql.DateTime, d.check_in ? new Date(d.check_in) : null);
      req.input('checkOut', sql.DateTime, d.check_out ? new Date(d.check_out) : null);

      await req.query(`
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

    // 6. Upsert Customer records into dbo.reservation_Customer_booklogic (Linked by res_id)
    for (const c of custResult.rows) {
      const req = mssqlPool.request();
      req.input('custId', sql.BigInt, c.customer_id);
      req.input('resId', sql.BigInt, c.res_id);
      req.input('firstName', sql.NVarChar(100), c.first_name || '');
      req.input('lastName', sql.NVarChar(100), c.last_name || '');
      req.input('customerName', sql.NVarChar(200), c.customer_name || `${c.first_name || ''} ${c.last_name || ''}`.trim());
      req.input('phone', sql.NVarChar(100), c.phone || '');
      req.input('email', sql.NVarChar(200), c.email || '');
      req.input('address', sql.NVarChar(sql.MAX), c.address || '');
      req.input('city', sql.NVarChar(100), c.city || '');
      req.input('country', sql.NVarChar(100), c.country || 'India');
      req.input('idProofType', sql.NVarChar(50), c.id_proof_type || 'PASSPORT');
      req.input('idProofNumber', sql.NVarChar(100), c.id_proof_number || '');

      await req.query(`
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

    // 7. Update PostgreSQL SET updateflag = 1 for the synced reservations
    if (resIds.length > 0) {
      await pgClient.query(`
        UPDATE public.reservations
        SET updateflag = 1, modified_at = CURRENT_TIMESTAMP
        WHERE res_id = ANY($1::bigint[]);
      `, [resIds]);

      log('inbound', `✅ Successfully synced ${resIds.length} reservations into local SQL Server (Reservations_booklogic, reservations_details_booklogic, reservation_Customer_booklogic) and marked updateflag = 1 in PostgreSQL.`);
    }

    return resResult.rows.length;
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

    // 1. Outbound: Hotels
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
  console.log(`Local SQL Server : ${MSSQL_CONFIG.server}:${MSSQL_CONFIG.port} (DB: ${MSSQL_CONFIG.database})`);
  console.log(`VPS PostgreSQL   : ${PG_CONFIG.host}:${PG_CONFIG.port} (DB: ${PG_CONFIG.database})`);
  console.log(`Polling Interval : ${SYNC_INTERVAL_MS} ms | Batch Size: ${BATCH_SIZE}`);
  console.log('================================================================\n');

  try {
    log('info', 'Connecting to Local SQL Server...');
    mssqlPool = await sql.connect(MSSQL_CONFIG);
    log('success', 'Connected to Local SQL Server.');

    log('info', 'Connecting to VPS PostgreSQL...');
    pgPool = new Pool(PG_CONFIG);
    const initialPgClient = await pgPool.connect();
    log('success', 'Connected to VPS PostgreSQL.');

    // Ensure database schemas exist on both sides
    await ensureLocalSqlServerTables();
    await ensureRemotePostgresTables(initialPgClient);
    initialPgClient.release();

    log('info', 'Starting continuous background synchronization daemon...');

    // Run first cycle immediately
    await runSyncCycle();

    // Loop
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
