/**
 * ====================================================================================================
 * SQL SERVER AUTOMATIC CONNECTION DIAGNOSTIC & INSTANCE DETECTOR
 * ====================================================================================================
 * Run this tool on your PC to automatically detect all SQL Server instances and test credentials:
 *   node test_mssql.js
 * ====================================================================================================
 */

const sql = require('mssql');
const { execSync } = require('child_process');
const os = require('os');
const net = require('net');

const TEST_USERS = ['sa'];
const TEST_PASSWORDS = ['mgenn@123', 'mgenn', 'password', 'sa123', 'admin123', '123456'];
const TEST_DATABASES = ['gowtham', 'varanashiinn', 'nitheeshnew', 'master'];

console.log('================================================================');
console.log('  🔍 SQL Server Automatic Diagnostics & Instance Detector');
console.log('================================================================');
console.log(`Local Hostname : ${os.hostname()}`);
console.log(`OS Platform    : ${os.platform()} ${os.release()}`);
console.log('================================================================\n');

// 1. Discover local installed SQL Server services & instances
let discoveredInstances = new Set(['', 'SQLEXPRESS', 'MSSQLSERVER']);
try {
  const serviceOutput = execSync('powershell "Get-Service *SQL* | Select-Object -Property Name, DisplayName, Status"', { encoding: 'utf8', timeout: 4000 });
  console.log('[1/4] Discovered Windows SQL Services:\n' + serviceOutput.trim() + '\n');
  
  const lines = serviceOutput.split('\n');
  for (const line of lines) {
    const match = line.match(/MSSQL\$([a-zA-Z0-9_-]+)/i);
    if (match && match[1]) {
      discoveredInstances.add(match[1]);
    }
  }
} catch (e) {
  console.log('[1/4] Service detection via PowerShell skipped: ' + e.message);
}

// 2. Discover candidate server hosts
const candidateHosts = [
  '127.0.0.1',
  'localhost',
  os.hostname(),
  'RECEPTION',
  'NEWSERVER',
  '164.52.195.176'
];

console.log('[2/4] Testing Host Candidates: [' + candidateHosts.join(', ') + ']');
console.log('[2/4] Testing Instances      : [' + Array.from(discoveredInstances).join(', ') + ']\n');

function testTcp(host, port, timeoutMs = 500) {
  return new Promise(resolve => {
    const s = new net.Socket();
    let done = false;
    s.setTimeout(timeoutMs);
    s.on('connect', () => { if (!done) { done = true; s.destroy(); resolve(true); } });
    s.on('timeout', () => { if (!done) { done = true; s.destroy(); resolve(false); } });
    s.on('error', () => { if (!done) { done = true; s.destroy(); resolve(false); } });
    try { s.connect(port, host); } catch (e) { resolve(false); }
  });
}

async function runDiagnostics() {
  console.log('[3/4] Testing TCP/IP connectivity & SQL Login across permutations...\n');

  let successConfig = null;

  for (const host of candidateHosts) {
    for (const inst of Array.from(discoveredInstances)) {
      const serverLabel = inst ? `${host}\\${inst}` : host;

      for (const pass of TEST_PASSWORDS) {
        for (const db of TEST_DATABASES) {
          const cfg = {
            user: 'sa',
            password: pass,
            server: host,
            database: db,
            options: {
              instanceName: inst || undefined,
              encrypt: false,
              trustServerCertificate: true,
              enableArithAbort: true,
              connectTimeout: 2000,
              requestTimeout: 5000,
            }
          };

          try {
            process.stdout.write(`Testing ${serverLabel} (DB: ${db}, Pass: ${pass})... `);
            const pool = await sql.connect(cfg);
            const res = await pool.request().query('SELECT @@VERSION AS ver, DB_NAME() AS dbname');
            const version = res.recordset[0].ver.split('\n')[0];
            const currentDb = res.recordset[0].dbname;
            console.log(`\x1b[32m[SUCCESS]\x1b[0m`);
            console.log(`\n🎉 \x1b[32mFOUND WORKING SQL SERVER CONNECTION!\x1b[0m`);
            console.log(` - Server   : ${serverLabel}`);
            console.log(` - Database : ${currentDb}`);
            console.log(` - User     : sa`);
            console.log(` - Password : ${pass}`);
            console.log(` - Version  : ${version}\n`);

            successConfig = { server: serverLabel, db: currentDb, pass };
            await pool.close();
            break;
          } catch (err) {
            console.log(`\x1b[31m[FAILED: ${err.message.substring(0, 50)}]\x1b[0m`);
          }
        }
        if (successConfig) break;
      }
      if (successConfig) break;
    }
    if (successConfig) break;
  }

  // Also test standard ports without instance
  if (!successConfig) {
    const ports = [1433, 1434, 14333, 49152, 49153, 49154, 49155, 51234];
    for (const p of ports) {
      for (const host of ['127.0.0.1', 'localhost']) {
        const isOpen = await testTcp(host, p, 300);
        if (!isOpen) continue;

        console.log(`Port ${p} is OPEN on ${host}. Testing SQL login...`);
        for (const pass of TEST_PASSWORDS) {
          const cfg = {
            user: 'sa',
            password: pass,
            server: host,
            port: p,
            database: 'gowtham',
            options: {
              encrypt: false,
              trustServerCertificate: true,
              enableArithAbort: true,
              connectTimeout: 2000,
              requestTimeout: 5000,
            }
          };
          try {
            const pool = await sql.connect(cfg);
            console.log(`🎉 \x1b[32mFOUND WORKING SQL SERVER ON PORT ${p}!\x1b[0m`);
            successConfig = { server: `${host}`, port: p, db: 'gowtham', pass };
            await pool.close();
            break;
          } catch (e) {}
        }
        if (successConfig) break;
      }
      if (successConfig) break;
    }
  }

  console.log('\n================================================================');
  if (successConfig) {
    console.log('  ✅ RECOMMENDED RUN COMMAND:');
    if (successConfig.port) {
      console.log(`  node sync_agent.js --server="${successConfig.server}" --port=${successConfig.port} --database=${successConfig.db} --password="${successConfig.pass}"`);
    } else {
      console.log(`  node sync_agent.js --server="${successConfig.server}" --database=${successConfig.db} --password="${successConfig.pass}"`);
    }
  } else {
    console.log('  ❌ NO WORKING SQL CONNECTION FOUND AUTOMATICALLY.');
    console.log('  Please check:');
    console.log('  1. In SSMS, what exact "Server name" do you type when connecting?');
    console.log('  2. Is SQL Server running on this PC or a different PC?');
  }
  console.log('================================================================\n');
}

runDiagnostics();
