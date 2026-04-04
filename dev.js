const { spawn, execSync } = require('child_process');
const net = require('net');

function killPort(port) {
  try {
    const result = execSync(`cmd /c "netstat -ano | findstr :${port} | findstr LISTENING"`, { encoding: 'utf8' });
    const pid = result.trim().split(/\s+/).pop();
    if (pid && !isNaN(pid)) execSync(`cmd /c "taskkill /F /PID ${pid}"`, { stdio: 'ignore' });
  } catch (_) {}
}

function waitForPort(port, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const client = net.createConnection(port, '127.0.0.1');
      client.on('connect', () => { client.destroy(); resolve(); });
      client.on('error', () => {
        if (Date.now() - start > timeout) return reject(new Error('Timeout'));
        setTimeout(check, 500);
      });
    };
    check();
  });
}

killPort(5173);
try { execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' }); } catch (_) {}

// Restore Node version if previous session left it switched (nvm use during build)
const path = require('path');
const fs = require('fs');
const nvmExe = process.env.NVM_HOME ? path.join(process.env.NVM_HOME, 'nvm.exe') : null;

// 1. Check restore file from previous crash
const candidates = [
  path.join(process.env.APPDATA || '', 'Electron', '.nvm-restore'),
  path.join(process.env.APPDATA || '', 'slot-audio-manager', '.nvm-restore'),
  path.join(process.env.APPDATA || '', 'SlotAudioManager', '.nvm-restore'),
];
const nvmRestoreFile = candidates.find(f => fs.existsSync(f)) || '';
if (nvmRestoreFile) {
  try {
    const ver = fs.readFileSync(nvmRestoreFile, 'utf8').trim();
    if (ver && nvmExe && fs.existsSync(nvmExe)) {
      execSync('"' + nvmExe + '" use ' + ver, { stdio: 'ignore', timeout: 10000 });
      console.log('Restored Node to v' + ver);
    }
    fs.rmSync(nvmRestoreFile, { force: true });
  } catch (_) {}
}

// 2. Verify nvm symlink is healthy — if npm is missing, re-run nvm use for current node
try { execSync('npm --version', { stdio: 'ignore', timeout: 5000 }); } catch (_) {
  if (nvmExe && fs.existsSync(nvmExe)) {
    const nodeVer = process.version.replace(/^v/, '');
    try {
      execSync('"' + nvmExe + '" use ' + nodeVer, { stdio: 'ignore', timeout: 10000 });
      console.log('Fixed nvm symlink for Node v' + nodeVer);
    } catch (_) {}
  }
}
const vite = spawn('node', ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' });

vite.on('error', (e) => { console.error('Vite error:', e); process.exit(1); });

waitForPort(5173).then(() => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const electron = spawn(require('electron'), ['.'], { stdio: 'inherit', env });
  electron.on('close', () => { vite.kill(); process.exit(); });
}).catch((e) => { console.error(e); vite.kill(); process.exit(1); });

process.on('SIGINT', () => { vite.kill(); process.exit(); });
