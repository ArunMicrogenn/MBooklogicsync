export const nodeBackgroundServiceScript = `/**
 * Auto-Sync Service Daemon: Local SQL Server (BOOKLOGIC) -> VPS PostgreSQL (72.61.240.34)
 * ------------------------------------------------------------------------------------------
 * Tables Synchronized:
 *  - dbo.mas_hotel -> public.mas_hotel
 *  - dbo.trans_roomavailability_chart_datewise -> public.trans_roomavailability_chart_datewise
 * 
 * Setup:
 *  1. Put in folder E:\\AutoSync
 *  2. Run: npm install mssql pg dotenv
 *  3. Run: node sync-daemon.js (or install as Windows Background Service)
 */

const sql = require('mssql');
const { Pool } = require('pg');
require('dotenv').config();

// 1. Source: Local MSSQL Config
const mssqlConfig = {
  user: process.env.MSSQL_USER || 'sa',
  password: process.env.MSSQL_PASSWORD || 'Password123!', // <-- Your local SQL Server password
  server: process.env.MSSQL_HOST || '127.0.0.1',
  port: parseInt(process.env.MSSQL_PORT || '1433'),
  database: process.env.MSSQL_DATABASE || 'BOOKLOGIC',
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

// 2. Target: VPS PostgreSQL Config (72.61.240.34)
const pgPool = new Pool({
  host: process.env.POSTGRES_HOST || '72.61.240.34',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'BOOKLOGIC', // or 'postgres'
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'Password123!', // <-- Your VPS Postgres password
  ssl: false,
  max: 10,
  idleTimeoutMillis: 30000,
});

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '3000'); // Check every 3 seconds
let isRunning = true;
let sqlPool = null;

async function syncMasHotel(pgClient) {
  const result = await sqlPool.request().query('SELECT * FROM dbo.mas_hotel');
  if (!result.recordset || result.recordset.length === 0) return 0;

  for (const row of result.recordset) {
    const query = \`
      INSERT INTO public.mas_hotel (
        hotel_id, hotelname, hotelcode, inactive, 
        sql_servername, sql_username, sql_password, sql_database, 
        iscloudfo, irm_only
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (hotelcode) DO UPDATE SET
        hotelname = EXCLUDED.hotelname,
        inactive = EXCLUDED.inactive,
        sql_servername = EXCLUDED.sql_servername,
        sql_username = EXCLUDED.sql_username,
        sql_database = EXCLUDED.sql_database,
        iscloudfo = EXCLUDED.iscloudfo,
        irm_only = EXCLUDED.irm_only;
    \`;
    await pgClient.query(query, [
      row.hotel_id || 1,
      row.hotelname || '',
      row.hotelcode || '',
      row.inactive !== undefined ? row.inactive : 0,
      row.sql_servername || '127.0.0.1',
      row.sql_username || 'sa',
      row.sql_password || '',
      row.sql_database || 'BOOKLOGIC',
      row.iscloudfo !== undefined ? row.iscloudfo : 1,
      row.irm_only !== undefined ? row.irm_only : 1,
    ]);
  }
  return result.recordset.length;
}

async function syncRoomAvailability(pgClient) {
  const result = await sqlPool.request().query(\`
    SELECT TOP 1000 * FROM dbo.trans_roomavailability_chart_datewise 
    ORDER BY avaidd DESC
  \`);
  if (!result.recordset || result.recordset.length === 0) return 0;

  for (const row of result.recordset) {
    const query = \`
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
        uploadflg = EXCLUDED.uploadflg,
        notupload = EXCLUDED.notupload,
        remarks = EXCLUDED.remarks,
        fromtime = EXCLUDED.fromtime,
        totime = EXCLUDED.totime,
        allotcode = EXCLUDED.allotcode,
        hotelcode = EXCLUDED.hotelcode,
        irm_update = EXCLUDED.irm_update,
        stopsales = EXCLUDED.stopsales;
    \`;
    await pgClient.query(query, [
      row.avaidd,
      row.Roomtypeid || null,
      row.fromdate || null,
      row.todate || null,
      row.Availablerooms || 0,
      row.uploadflg || 0,
      row.notupload || 0,
      row.Remarks || '',
      row.Fromtime || null,
      row.Totime || null,
      row.allotcode || '',
      row.hotelcode || '',
      row.IRM_Update || 0,
      row.stopsales || 0,
    ]);
  }
  return result.recordset.length;
}

async function startAutoSync() {
  console.log('========================================================');
  console.log('🚀 BOOKLOGIC Auto-Sync Service Daemon Starting...');
  console.log('   Source: MSSQL [127.0.0.1 / BOOKLOGIC]');
  console.log('   Target: VPS PostgreSQL [72.61.240.34 / BOOKLOGIC]');
  console.log('========================================================');

  try {
    sqlPool = await sql.connect(mssqlConfig);
    console.log('✅ [OK] Connected to Local SQL Server (BOOKLOGIC)');
  } catch (err) {
    console.error('❌ [ERROR] Failed connecting to Local SQL Server:', err.message);
    process.exit(1);
  }

  while (isRunning) {
    let pgClient = null;
    try {
      pgClient = await pgPool.connect();
      const hotelCount = await syncMasHotel(pgClient);
      const roomCount = await syncRoomAvailability(pgClient);

      const timestamp = new Date().toLocaleTimeString();
      console.log(\`[\${timestamp}] 🔄 Auto-Sync Completed: \${hotelCount} hotels | \${roomCount} room availability records verified.\`);
    } catch (err) {
      console.error(\`[SYNC LOOP ERROR]: \${err.message}\`);
    } finally {
      if (pgClient) pgClient.release();
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

// Graceful Exit
process.on('SIGINT', async () => {
  console.log('\\nStopping Auto-Sync Daemon...');
  isRunning = false;
  if (sqlPool) await sqlPool.close();
  await pgPool.end();
  process.exit(0);
});

startAutoSync();
`;

export const pythonBackgroundWorkerScript = `"""
Real-Time SQL Server to PostgreSQL Background Worker Daemon
Requirements: pip install pyodbc psycopg2-binary python-dotenv
Usage: python sync_worker.py
"""

import os
import time
import signal
import sys
import psycopg2
from psycopg2.extras import execute_batch
import pyodbc
from dotenv import load_dotenv

load_dotenv()

MSSQL_CONN_STR = (
    f"DRIVER={{ODBC Driver 18 for SQL Server}};"
    f"SERVER={os.getenv('MSSQL_HOST', 'localhost,1433')};"
    f"DATABASE={os.getenv('MSSQL_DATABASE', 'ProductionERP')};"
    f"UID={os.getenv('MSSQL_USER', 'sa')};"
    f"PWD={os.getenv('MSSQL_PASSWORD', 'YourStrong@Password123')};"
    f"TrustServerCertificate=yes;"
)

POSTGRES_URL = os.getenv("POSTGRES_URL", "postgresql://postgres:password@72.61.240.34:5432/BOOKLOGIC")
POLL_INTERVAL = float(os.getenv("POLL_INTERVAL_SEC", "1.0"))

running = True

def handle_signal(sig, frame):
    global running
    print("[SYNC WORKER] Stopping background daemon...")
    running = False

signal.signal(signal.SIGINT, handle_signal)
signal.signal(signal.SIGTERM, handle_signal)

def run_sync_service():
    print("[SYNC WORKER] Connecting to Local SQL Server and Virtual PostgreSQL...")
    mssql_conn = pyodbc.connect(MSSQL_CONN_STR)
    pg_conn = psycopg2.connect(POSTGRES_URL)
    pg_conn.autocommit = False

    print("[SYNC WORKER] Pipeline online. Synchronizing in real-time...")

    while running:
        try:
            with mssql_conn.cursor() as ms_cur, pg_conn.cursor() as pg_cur:
                # 1. Fetch uncommitted changes from SQL Server Change Tracking or CDC
                ms_cur.execute("""
                    SELECT c.CustomerID, c.FirstName, c.LastName, c.Email, c.Phone, c.CreditLimit, c.IsActive, c.ModifiedAt
                    FROM dbo.Customers c
                    WHERE c.ModifiedAt > (
                        SELECT COALESCE(MAX(last_sync_timestamp), '1970-01-01') 
                        FROM public._sync_metadata WHERE source_table = 'Customers'
                    )
                """)
                rows = ms_cur.fetchall()

                if rows:
                    upsert_sql = """
                        INSERT INTO public.customers (customer_id, first_name, last_name, email, phone, credit_limit, is_active, modified_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (customer_id) DO UPDATE SET
                            first_name = EXCLUDED.first_name,
                            last_name = EXCLUDED.last_name,
                            email = EXCLUDED.email,
                            phone = EXCLUDED.phone,
                            credit_limit = EXCLUDED.credit_limit,
                            is_active = EXCLUDED.is_active,
                            modified_at = EXCLUDED.modified_at;
                    """
                    execute_batch(pg_cur, upsert_sql, rows, page_size=200)
                    pg_cur.execute("""
                        INSERT INTO public._sync_metadata (source_table, last_processed_lsn, last_sync_timestamp, synced_records_count)
                        VALUES ('Customers', 'auto', NOW(), %s)
                        ON CONFLICT (source_table) DO UPDATE SET
                            last_sync_timestamp = NOW(),
                            synced_records_count = public._sync_metadata.synced_records_count + EXCLUDED.synced_records_count;
                    """, (len(rows),))
                    pg_conn.commit()
                    print(f"[SYNC WORKER] Synchronized {len(rows)} customer records to Virtual Server.")

        except Exception as e:
            pg_conn.rollback()
            print(f"[SYNC WORKER ERROR] {e}")

        time.sleep(POLL_INTERVAL)

    mssql_conn.close()
    pg_conn.close()
    print("[SYNC WORKER] Graceful shutdown completed.")

if __name__ == '__main__':
    run_sync_service()
`;

export const windowsServiceScript = `# PowerShell: Install and Run Sync as a Windows Background Service
# Run in Administrator PowerShell on Local SQL Server machine

$ServiceName = "SqlToPostgresSyncDaemon"
$NodePath = (Get-Command node).Source
$ScriptPath = "$PSScriptRoot\\sync-daemon.js"

Write-Host "Installing Windows Background Service for SQL Server -> PostgreSQL Sync..." -ForegroundColor Cyan

# Option 1: Using NSSM (Non-Sucking Service Manager)
if (Get-Command nssm -ErrorAction SilentlyContinue) {
    nssm install $ServiceName $NodePath $ScriptPath
    nssm set $ServiceName AppDirectory $PSScriptRoot
    nssm set $ServiceName Start SERVICE_AUTO_START
    nssm start $ServiceName
    Write-Host "Windows Service $ServiceName successfully started with NSSM!" -ForegroundColor Green
} else {
    # Option 2: Fallback to Scheduled Task with AtStartup trigger (runs non-interactively in background)
    $Action = New-ScheduledTaskAction -Execute $NodePath -Argument $ScriptPath -WorkingDirectory $PSScriptRoot
    $Trigger = New-ScheduledTaskTrigger -AtStartup
    $Principal = New-ScheduledTaskPrincipal -UserId "NT AUTHORITY\\SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    $Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName $ServiceName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Force
    Start-ScheduledTask -TaskName $ServiceName
    Write-Host "Windows Background Task registered and running as SYSTEM background worker!" -ForegroundColor Green
}
`;

export const linuxSystemdServiceScript = `[Unit]
Description=Real-Time SQL Server to PostgreSQL Background Sync Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/sql-pg-sync
ExecStart=/usr/bin/node /opt/sql-pg-sync/sync-daemon.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=MSSQL_HOST=127.0.0.1
Environment=POSTGRES_URL=postgresql://postgres:password@72.61.240.34:5432/BOOKLOGIC
StandardOutput=journal
StandardError=journal
SyslogIdentifier=sql-pg-sync

[Install]
WantedBy=multi-user.target
`;

export const dockerComposeScript = `version: '3.8'

services:
  sync-daemon:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: mssql-to-postgres-sync-worker
    restart: always
    environment:
      - MSSQL_HOST=host.docker.internal
      - MSSQL_PORT=1433
      - MSSQL_DATABASE=ProductionERP
      - MSSQL_USER=sa
      - MSSQL_PASSWORD=YourStrong@Password123
      - POSTGRES_URL=postgresql://postgres:password@72.61.240.34:5432/BOOKLOGIC
      - POLL_INTERVAL_MS=1000
      - BATCH_SIZE=500
    extra_hosts:
      - "host.docker.internal:host-gateway"
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "5"
`;
