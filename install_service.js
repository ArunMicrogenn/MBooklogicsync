/**
 * ====================================================================================================
 * WINDOWS SERVICE FRESH INSTALLER FOR BOOKLOGIC REPLICATION AGENT
 * ====================================================================================================
 */

const path = require('path');
const { execSync } = require('child_process');
const fs = require('fs');

const SERVICE_NAME = 'BookLogicSyncService';
const DISPLAY_NAME = 'BookLogic SQL Sync Service';
const DESCRIPTION = 'Real-time bidirectional synchronization between Local SQL Server and VPS PostgreSQL BOOKLOGIC database.';

console.log('================================================================');
console.log('  ⚙️  BookLogic Windows Service Fresh Installer');
console.log('================================================================\n');

// 1. Clean up any stale daemon directory
const daemonDir = path.join(__dirname, 'daemon');
if (fs.existsSync(daemonDir)) {
  try {
    fs.rmSync(daemonDir, { recursive: true, force: true });
    console.log('[INFO] Cleaned stale daemon cache.');
  } catch (e) {
    console.log('[WARN] Could not clean daemon cache: ' + e.message);
  }
}

// 2. Load node-windows
let Service;
try {
  Service = require('node-windows').Service;
} catch (e) {
  console.log('[INFO] Installing "node-windows" package...');
  try {
    execSync('npm install node-windows --save', { stdio: 'inherit', cwd: __dirname });
    Service = require('node-windows').Service;
  } catch (npmErr) {
    console.log('[WARN] npm install failed: ' + npmErr.message);
  }
}

if (Service) {
  const svc = new Service({
    name: SERVICE_NAME,
    description: DESCRIPTION,
    script: path.join(__dirname, 'sync_agent.js'),
    nodeOptions: [
      '--harmony',
      '--max_old_space_size=4096'
    ]
  });

  svc.on('install', function () {
    console.log(`\n🎉 [SUCCESS] Service "${DISPLAY_NAME}" (${SERVICE_NAME}) is INSTALLED in services.msc!`);
    console.log(`Starting service...`);
    svc.start();
    console.log(`[OK] Service is now RUNNING!`);
    console.log(`You can find it under letter "B" in services.msc as "${SERVICE_NAME}" or "${DISPLAY_NAME}".\n`);
  });

  svc.on('alreadyinstalled', function () {
    console.log(`[INFO] Re-registering service...`);
    svc.uninstall();
    setTimeout(() => {
      svc.install();
    }, 1500);
  });

  svc.on('start', function () {
    console.log(`\n🚀 [SUCCESS] "${DISPLAY_NAME}" service is ACTIVE and RUNNING!\n`);
  });

  svc.install();
} else {
  console.log('[WARN] Fallback: Registering in Windows Task Scheduler...');
  try {
    const nodeExe = process.execPath;
    const scriptPath = path.join(__dirname, 'sync_agent.js');
    const cmd = `schtasks /create /tn "${SERVICE_NAME}" /tr "\\"${nodeExe}\\" \\"${scriptPath}\\"" /sc onstart /ru SYSTEM /rl HIGHEST /f`;
    execSync(cmd, { stdio: 'inherit' });
    console.log(`[SUCCESS] Background Task "${SERVICE_NAME}" registered to run at startup!`);
    execSync(`schtasks /run /tn "${SERVICE_NAME}"`, { stdio: 'inherit' });
    console.log(`[SUCCESS] Background sync is now RUNNING!`);
  } catch (fallbackErr) {
    console.error(`[ERROR] Administrator privileges required: ${fallbackErr.message}`);
  }
}
