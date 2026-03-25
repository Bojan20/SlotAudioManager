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
const vite = spawn('node', ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' });

vite.on('error', (e) => { console.error('Vite error:', e); process.exit(1); });

waitForPort(5173).then(() => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const electron = spawn(require('electron'), ['.'], { stdio: 'inherit', env });
  electron.on('close', () => { vite.kill(); process.exit(); });
}).catch((e) => { console.error(e); vite.kill(); process.exit(1); });

process.on('SIGINT', () => { vite.kill(); process.exit(); });
