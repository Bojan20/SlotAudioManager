const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFileSync, exec, spawn } = require('child_process');
const { pathToFileURL } = require('url');

// Must be called before app.whenReady()
protocol.registerSchemesAsPrivileged([{
  scheme: 'audio',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false }
}]);

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

let mainWindow;
let projectPath = null;
let gameProcess = null; // currently running game process (for kill support)
let gameBrowserProcess = null; // tracked Chrome/Edge window for game preview

// Accept self-signed certs from localhost (playa GLR uses HTTPS with self-signed cert)
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  if (/^https:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url)) {
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});

function createWindow() {
  const winOpts = {
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  };

  if (isMac) {
    winOpts.titleBarStyle = 'hiddenInset';
  } else if (isWin) {
    winOpts.titleBarStyle = 'hidden';
    winOpts.titleBarOverlay = {
      color: '#0e0e16',
      symbolColor: '#8585a8',
      height: 36
    };
  }

  mainWindow = new BrowserWindow(winOpts);

  const isDev = process.env.NODE_ENV !== 'production' && !app.isPackaged;

  function loadApp() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (isDev) {
      mainWindow.loadURL('http://127.0.0.1:5173');
    } else {
      mainWindow.loadFile(path.join(__dirname, 'dist-renderer', 'index.html'));
    }
  }

  loadApp();

  // Auto-reload if VPN or network change causes connection drop (dev only)
  if (isDev) {
    mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
      // Ignore user-initiated navigations (-3 = aborted)
      if (code === -3) return;
      console.log(`[dev] Load failed (${code} ${desc}), retrying in 2s...`);
      setTimeout(loadApp, 2000);
    });
  }

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.log(`[main] Renderer gone (${details.reason}), recreating window...`);
    if (!mainWindow.isDestroyed()) mainWindow.destroy();
    createWindow();
  });
}

app.whenReady().then(() => {
  // audio:// custom protocol — serves WAV files from sourceSoundFiles/ without CORS issues
  protocol.handle('audio', (req) => {
    const url = new URL(req.url);
    const filename = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    if (!filename || !filename.endsWith('.wav') || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      return new Response('Forbidden', { status: 403 });
    }
    if (!projectPath) return new Response('No project open', { status: 503 });
    const sourceDir = path.join(projectPath, 'sourceSoundFiles');
    const filePath = path.join(sourceDir, filename);
    if (!filePath.startsWith(sourceDir + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(filePath).toString());
  });
  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// Safe JSON reader
// Check if a port is free (ECONNREFUSED = free, anything else = still in use)
function isPortFree(port) {
  return new Promise(resolve => {
    const net = require('net');
    const sock = new net.Socket();
    sock.setTimeout(200);
    sock.on('connect', () => { sock.destroy(); resolve(false); });
    sock.on('error', e => { sock.destroy(); resolve(e.code === 'ECONNREFUSED'); });
    sock.on('timeout', () => { sock.destroy(); resolve(true); });
    sock.connect(port, '127.0.0.1');
  });
}

// Wait until port is free, max maxMs milliseconds
function waitPortFree(port, maxMs = 5000) {
  return new Promise(resolve => {
    const start = Date.now();
    const check = async () => {
      if (await isPortFree(port)) return resolve();
      if (Date.now() - start >= maxMs) return resolve(); // timeout — proceed anyway
      setTimeout(check, 200);
    };
    check();
  });
}

// Kill all processes listening on a given port, then wait for OS to release it
async function killPort(port) {
  await new Promise(resolve => {
    if (isWin) {
      exec('netstat -ano', { timeout: 8000 }, (err, stdout) => {
        if (err || !stdout) return resolve();
        const pids = new Set();
        for (const line of stdout.split('\n')) {
          if (line.includes(`:${port}`) && line.includes('LISTENING')) {
            const parts = line.trim().split(/\s+/);
            const pid = parts[parts.length - 1];
            if (pid && /^\d+$/.test(pid) && pid !== '0') pids.add(pid);
          }
        }
        if (pids.size === 0) return resolve();
        let pending = pids.size;
        for (const pid of pids) {
          exec(`taskkill /F /PID ${pid}`, () => { if (--pending === 0) resolve(); });
        }
      });
    } else {
      exec(`lsof -ti :${port} | xargs kill -9 2>/dev/null; true`, () => resolve());
    }
  });
  // Aktivno čeka dok OS ne oslobodi port (max 5s)
  await waitPortFree(port, 5000);
}

function readJsonSafe(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {
    console.error(`Failed to parse ${filePath}:`, e.message);
  }
  return null;
}

// ===== IPC HANDLERS =====

ipcMain.handle('open-project', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Open Audio Project Folder'
  });
  if (result.canceled || !result.filePaths.length) return null;
  projectPath = result.filePaths[0];
  return loadProject(projectPath);
});

function loadProject(dirPath) {
  const data = { path: dirPath, sounds: [], settings: null, spriteConfig: null, soundsJson: null, scripts: {}, distInfo: null, gameRepoAbsPath: null, gameRepoExists: false, gameNodeModulesExists: false };

  data.settings = readJsonSafe(path.join(dirPath, 'settings.json'));
  data.spriteConfig = readJsonSafe(path.join(dirPath, 'sprite-config.json'));
  data.soundsJson = readJsonSafe(path.join(dirPath, 'sounds.json'));

  // Resolve gameProjectPath to absolute for UI display
  if (data.settings?.gameProjectPath) {
    const abs = path.resolve(dirPath, data.settings.gameProjectPath);
    data.gameRepoAbsPath = abs;
    data.gameRepoExists = fs.existsSync(abs);
    data.gameNodeModulesExists = fs.existsSync(path.join(abs, 'node_modules'));
    data.deployTarget = path.join(abs, 'assets', 'default', 'default', 'default', 'sounds');
    data.deployTargetExists = fs.existsSync(data.deployTarget);
  }

  // Detect available npm scripts
  const pkg = readJsonSafe(path.join(dirPath, 'package.json'));
  if (pkg && pkg.scripts) {
    data.scripts = pkg.scripts;
  }

  // Source WAV files
  const sourceDir = path.join(dirPath, 'sourceSoundFiles');
  if (fs.existsSync(sourceDir)) {
    data.sounds = fs.readdirSync(sourceDir)
      .filter(f => f.endsWith('.wav'))
      .sort((a, b) => a.localeCompare(b))
      .reduce((arr, f) => {
        try {
          const stats = fs.statSync(path.join(sourceDir, f));
          arr.push({
            name: f.slice(0, -4),
            filename: f,
            sizeKB: Math.round(stats.size / 1024),
            sizeMB: (stats.size / (1024 * 1024)).toFixed(2)
          });
        } catch (e) { /* file deleted between readdir and stat — skip */ }
        return arr;
      }, []);
  }

  // Game repo existence check
  if (data.gameRepoAbsPath) {
    data.gameRepoExists = fs.existsSync(data.gameRepoAbsPath);
  }

  // Dist info — detect all audio formats, not just .m4a
  const distSoundFiles = path.join(dirPath, 'dist', 'soundFiles');
  const distSoundsJson = path.join(dirPath, 'dist', 'sounds.json');
  const audioExts = new Set(['.m4a', '.ogg', '.aac', '.mp3']);
  if (fs.existsSync(distSoundFiles)) {
    const allAudio = fs.readdirSync(distSoundFiles).filter(f => {
      const ext = f.slice(f.lastIndexOf('.'));
      return audioExts.has(ext);
    });
    const sprites = allAudio.filter(f => f.endsWith('.m4a'));
    let totalSize = 0;
    const spriteSizes = {};
    for (const f of allAudio) {
      try {
        const sz = fs.statSync(path.join(distSoundFiles, f)).size;
        totalSize += sz;
        spriteSizes[f] = Math.round(sz / 1024);
      } catch {}
    }
    data.distInfo = {
      hasDist: allAudio.length > 0,
      sprites,
      spriteSizes,
      spriteCount: sprites.length,
      totalSizeMB: (totalSize / (1024 * 1024)).toFixed(1),
      hasSoundsJson: fs.existsSync(distSoundsJson),
    };
  } else {
    data.distInfo = {
      hasDist: false,
      sprites: [],
      spriteCount: 0,
      totalSizeMB: '0.0',
      hasSoundsJson: fs.existsSync(distSoundsJson),
    };
  }

  return data;
}

ipcMain.handle('save-sprite-config', async (event, config) => {
  if (!projectPath) return { error: 'No project open' };
  try {
    fs.writeFileSync(path.join(projectPath, 'sprite-config.json'), JSON.stringify(config, null, 2));
    return { success: true };
  } catch (e) {
    return { error: e.message };
  }
});

// Sanitize command steps — fix known type bugs before writing to disk
function sanitizeCommandStep(step) {
  const s = { ...step };
  // cancelDelay MUST be boolean true, not string "true" (SoundPlayer uses === true)
  if (s.cancelDelay !== undefined) s.cancelDelay = s.cancelDelay === true || s.cancelDelay === 'true';
  // loop: keep -1 for loop, remove if 0/false/undefined
  if (s.loop === false || s.loop === 0 || s.loop === undefined) delete s.loop;
  // numeric fields: enforce correct types (guard against strings from old JSON)
  if (s.volume !== undefined) { const v = parseFloat(s.volume); s.volume = isNaN(v) ? 1 : v; }
  if (s.delay !== undefined)  { const v = parseInt(s.delay);    s.delay  = isNaN(v) ? 0 : v; }
  if (s.rate  !== undefined)  { const v = parseFloat(s.rate);   s.rate   = isNaN(v) ? 1 : v; }
  if (s.pan   !== undefined)  { const v = parseFloat(s.pan);    s.pan    = isNaN(v) ? 0 : v; }
  if (s.duration !== undefined) { const v = parseInt(s.duration); s.duration = isNaN(v) ? 0 : v; }
  // delay: remove if 0 (no-op, reduces noise)
  if (s.delay === 0 || s.delay === null || s.delay === undefined) delete s.delay;
  // rate: remove if 1 (default)
  if (s.rate === 1 || s.rate === null || s.rate === undefined) delete s.rate;
  // pan: remove if 0 (default)
  if (s.pan === 0 || s.pan === null || s.pan === undefined) delete s.pan;
  return s;
}

ipcMain.handle('save-sounds-json', async (event, data) => {
  if (!projectPath) return { error: 'No project open' };
  try {
    // Sanitize all command steps on every save
    if (data?.soundDefinitions?.commands) {
      for (const [cmdName, steps] of Object.entries(data.soundDefinitions.commands)) {
        if (Array.isArray(steps)) {
          data.soundDefinitions.commands[cmdName] = steps.map(sanitizeCommandStep);
        }
      }
    }
    fs.writeFileSync(path.join(projectPath, 'sounds.json'), JSON.stringify(data, null, 2));
    return { success: true };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('save-settings', async (event, data) => {
  if (!projectPath) return { error: 'No project open' };
  try {
    fs.writeFileSync(path.join(projectPath, 'settings.json'), JSON.stringify(data, null, 4));
    return { success: true };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('run-script', async (event, scriptName) => {
  if (!projectPath) return { error: 'No project open' };
  if (!scriptName || typeof scriptName !== 'string') return { error: 'Invalid script name' };
  if (!/^[a-zA-Z0-9_-]+$/.test(scriptName)) return { error: 'Invalid script name' };
  return new Promise((resolve) => {
    const child = spawn('npm', ['run', scriptName], { cwd: projectPath, shell: true });
    const send = (line) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('script-output', line); };
    const timer = setTimeout(() => { child.kill(); send('\n[TIMEOUT — build killed after 5 minutes]\n'); resolve({ success: false, error: 'Timeout' }); }, 300000);
    child.stdout.on('data', d => send(d.toString()));
    child.stderr.on('data', d => send(d.toString()));
    child.on('error', (e) => { clearTimeout(timer); send(`ERROR: ${e.message}\n`); resolve({ success: false, error: e.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ success: code === 0 }); });
  });
});

ipcMain.handle('run-deploy', async (event, scriptName) => {
  if (!projectPath) return { error: 'No project open' };
  const name = scriptName || 'deploy';
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return { error: 'Invalid script name' };
  return new Promise((resolve) => {
    const child = spawn('npm', ['run', name], { cwd: projectPath, shell: true });
    const send = (line) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('script-output', line); };
    const timer = setTimeout(() => { child.kill(); send('\n[TIMEOUT — deploy killed after 2 minutes]\n'); resolve({ success: false, error: 'Timeout' }); }, 120000);
    child.stdout.on('data', d => send(d.toString()));
    child.stderr.on('data', d => send(d.toString()));
    child.on('error', (e) => { clearTimeout(timer); send(`ERROR: ${e.message}\n`); resolve({ success: false, error: e.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ success: code === 0 }); });
  });
});

ipcMain.handle('clean-dist', async () => {
  if (!projectPath) return { error: 'No project open' };
  const distSoundFiles = path.join(projectPath, 'dist', 'soundFiles');
  const distSoundsJson = path.join(projectPath, 'dist', 'sounds.json');
  let removed = 0;
  try {
    if (fs.existsSync(distSoundFiles)) {
      const files = fs.readdirSync(distSoundFiles).filter(f => f.endsWith('.m4a'));
      for (const f of files) { fs.rmSync(path.join(distSoundFiles, f)); removed++; }
    }
    if (fs.existsSync(distSoundsJson)) { fs.rmSync(distSoundsJson); removed++; }
    return { success: true, removed };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('git-status', async () => {
  if (!projectPath) return { error: 'No project open' };
  try {
    const opts = { cwd: projectPath, encoding: 'utf8', timeout: 10000 };
    const status = execFileSync('git', ['status', '--porcelain'], opts);
    const branch = execFileSync('git', ['branch', '--show-current'], opts).trim();
    let log = '';
    try { log = execFileSync('git', ['log', '--oneline', '-10'], opts); } catch {} // empty repo has no commits
    return { status, branch, log };
  } catch (e) {
    return { error: e.message };
  }
});

// Secure git commit — execFileSync with array args prevents shell injection
ipcMain.handle('git-commit-push', async (event, message) => {
  if (!projectPath) return { error: 'No project open' };
  if (!message || typeof message !== 'string' || !message.trim()) {
    return { error: 'Commit message is required' };
  }
  try {
    const opts = { cwd: projectPath, timeout: 30000 };
    execFileSync('git', ['add', '-A'], opts);
    execFileSync('git', ['commit', '-m', message.trim()], opts);
    execFileSync('git', ['push'], { cwd: projectPath, timeout: 60000 });
    return { success: true };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('import-sounds', async () => {
  if (!projectPath) return { error: 'No project open' };
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'WAV Audio', extensions: ['wav'] }],
    title: 'Import WAV Files'
  });
  if (result.canceled) return { imported: 0 };

  const destDir = path.join(projectPath, 'sourceSoundFiles');
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  let imported = 0;
  for (const src of result.filePaths) {
    const safeName = path.basename(src);
    if (!safeName.endsWith('.wav')) continue;
    fs.copyFileSync(src, path.join(destDir, safeName));
    imported++;
  }
  return { imported, project: loadProject(projectPath) };
});

ipcMain.handle('read-audio-file', async (event, filename) => {
  if (!projectPath) return { error: 'No project open' };
  if (!filename || typeof filename !== 'string') return { error: 'Invalid filename' };
  const safe = path.basename(filename);
  if (!safe || !safe.endsWith('.wav')) return { error: 'Invalid filename' };
  const sourceDir = path.join(projectPath, 'sourceSoundFiles');
  const filePath = path.join(sourceDir, safe);
  if (!filePath.startsWith(sourceDir + path.sep)) return { error: 'Invalid path' };
  if (!fs.existsSync(filePath)) return { error: 'File not found' };
  return { base64: fs.readFileSync(filePath).toString('base64') };
});

ipcMain.handle('delete-sound', async (event, filename) => {
  if (!projectPath) return { error: 'No project open' };
  if (!filename || typeof filename !== 'string') return { error: 'Invalid filename' };
  const safe = path.basename(filename);
  if (!safe || !safe.endsWith('.wav')) return { error: 'Invalid filename' };
  const sourceDir = path.join(projectPath, 'sourceSoundFiles');
  const trashDir = path.join(sourceDir, '.deleted');
  const filePath = path.join(sourceDir, safe);
  if (!filePath.startsWith(sourceDir + path.sep)) return { error: 'Invalid path' };
  if (!fs.existsSync(filePath)) return { error: 'File not found' };
  if (!fs.existsSync(trashDir)) fs.mkdirSync(trashDir, { recursive: true });
  fs.renameSync(filePath, path.join(trashDir, safe));
  return { success: true, project: loadProject(projectPath) };
});

ipcMain.handle('restore-sound', async (event, filename) => {
  if (!projectPath) return { error: 'No project open' };
  if (!filename || typeof filename !== 'string') return { error: 'Invalid filename' };
  const safe = path.basename(filename);
  if (!safe || !safe.endsWith('.wav')) return { error: 'Invalid filename' };
  const sourceDir = path.join(projectPath, 'sourceSoundFiles');
  const trashDir = path.join(sourceDir, '.deleted');
  const trashPath = path.join(trashDir, safe);
  if (!trashPath.startsWith(trashDir + path.sep)) return { error: 'Invalid path' };
  if (!fs.existsSync(trashPath)) return { error: 'File not found in trash' };
  fs.renameSync(trashPath, path.join(sourceDir, safe));
  return { success: true, project: loadProject(projectPath) };
});

ipcMain.handle('list-deleted-sounds', async () => {
  if (!projectPath) return { files: [] };
  const trashDir = path.join(projectPath, 'sourceSoundFiles', '.deleted');
  if (!fs.existsSync(trashDir)) return { files: [] };
  const files = fs.readdirSync(trashDir).filter(f => f.endsWith('.wav'));
  return { files };
});

ipcMain.handle('reload-project', async () => {
  if (!projectPath) return null;
  return loadProject(projectPath);
});

// ===== BUILT-IN TEMPLATE =====

// Bundled template path (inside the app)
function getTemplatePath() {
  return path.join(__dirname, 'template');
}

// Health check — what's missing in current project
ipcMain.handle('health-check', async () => {
  if (!projectPath) return { error: 'No project open' };
  const checks = [];

  const configFiles = ['package.json', 'settings.json', 'sounds.json', 'sprite-config.json'];
  for (const f of configFiles) {
    checks.push({ name: f, type: 'config', exists: fs.existsSync(path.join(projectPath, f)) });
  }

  const requiredScripts = [
    'buildTiered.js', 'buildTieredJSON.js', 'validateBuild.js',
    'customAudioSprite.js', 'copyAudio.js',
    'convertAudio.js', 'createAudioSprite.js', 'createAudioSpritesBySize.js',
    'createmultipleAudioSprites.js', 'makeMyJSON.js',
    'makeMyJSONMultipleSounds.js', 'makeMyJSONSizedSprites.js'
  ];
  const scriptsDir = path.join(projectPath, 'scripts');
  const hasSDir = fs.existsSync(scriptsDir);
  checks.push({ name: 'scripts/', type: 'directory', exists: hasSDir });
  for (const s of requiredScripts) {
    checks.push({ name: `scripts/${s}`, type: 'script', exists: hasSDir && fs.existsSync(path.join(scriptsDir, s)) });
  }

  checks.push({ name: 'sourceSoundFiles/', type: 'directory', exists: fs.existsSync(path.join(projectPath, 'sourceSoundFiles')) });
  checks.push({ name: 'node_modules/', type: 'dependencies', exists: fs.existsSync(path.join(projectPath, 'node_modules')) });

  const pkg = readJsonSafe(path.join(projectPath, 'package.json'));
  for (const s of ['build', 'build-validate', 'deploy']) {
    checks.push({ name: `npm script: ${s}`, type: 'npm-script', exists: !!(pkg?.scripts?.[s]) });
  }
  for (const d of ['node-exiftool', 'sox', 'audiosprite', 'ffmpeg-static']) {
    checks.push({ name: `dependency: ${d}`, type: 'dependency', exists: !!(pkg?.dependencies?.[d]) });
  }

  const passed = checks.filter(c => c.exists).length;
  const failed = checks.filter(c => !c.exists).length;
  return { checks, passed, failed, total: checks.length };
});

// Initialize from built-in template — one click, OVERWRITES everything from our app
// Our app is the single source of truth for scripts, configs, and dependencies
ipcMain.handle('init-from-template', async (event, { skipConfigs = false } = {}) => {
  if (!projectPath) return { error: 'No project open' };
  const tplPath = getTemplatePath();
  if (!fs.existsSync(tplPath)) return { error: 'Built-in template not found' };

  const log = [];
  try {
    // 1. Scripts — always overwrite all
    const tplScripts = path.join(tplPath, 'scripts');
    const projScripts = path.join(projectPath, 'scripts');
    if (fs.existsSync(tplScripts)) {
      if (!fs.existsSync(projScripts)) fs.mkdirSync(projScripts, { recursive: true });
      for (const f of fs.readdirSync(tplScripts).filter(f => f.endsWith('.js'))) {
        fs.copyFileSync(path.join(tplScripts, f), path.join(projScripts, f));
        log.push(`Overwritten scripts/${f}`);
      }
    }

    // 2. Config files — skip if user chose to preserve existing setup
    if (skipConfigs) {
      log.push('Preskočeno: sprite-config.json i sounds.json nisu izmenjeni');
    } else {
      for (const f of ['sprite-config.json', 'sounds.json']) {
        const dest = path.join(projectPath, f);
        const src = path.join(tplPath, f);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
          log.push(`Overwritten ${f} from template`);
        }
      }
    }

    // 3. package.json — overwrite scripts & dependencies from template (app is master)
    const tplPkg = readJsonSafe(path.join(tplPath, 'package.json'));
    const projPkgPath = path.join(projectPath, 'package.json');
    let projPkg = readJsonSafe(projPkgPath);

    if (!projPkg) {
      projPkg = { ...(tplPkg || {}), name: path.basename(projectPath).toLowerCase().replace(/[^a-z0-9-]/g, '-') };
      log.push('Created package.json');
    } else {
      // Overwrite all template scripts (app is source of truth)
      if (!projPkg.scripts) projPkg.scripts = {};
      if (tplPkg?.scripts) {
        for (const [k, v] of Object.entries(tplPkg.scripts)) {
          const existed = projPkg.scripts[k];
          projPkg.scripts[k] = v;
          log.push(existed ? `Overwritten script: ${k}` : `Added script: ${k}`);
        }
      }
      // Overwrite all template dependencies
      if (!projPkg.dependencies) projPkg.dependencies = {};
      if (tplPkg?.dependencies) {
        for (const [k, v] of Object.entries(tplPkg.dependencies)) {
          const existed = projPkg.dependencies[k];
          projPkg.dependencies[k] = v;
          log.push(existed ? `Overwritten dep: ${k} → ${v}` : `Added dep: ${k} → ${v}`);
        }
      }
    }
    fs.writeFileSync(projPkgPath, JSON.stringify(projPkg, null, 2));

    // 4. Settings — overwrite with template defaults but preserve gameProjectPath
    const settingsPath = path.join(projectPath, 'settings.json');
    const existingSettings = readJsonSafe(settingsPath);
    const savedGamePath = existingSettings?.gameProjectPath || '';
    const tplSettings = readJsonSafe(path.join(tplPath, 'settings.json'));
    if (tplSettings) {
      tplSettings.gameProjectPath = savedGamePath;
      fs.writeFileSync(settingsPath, JSON.stringify(tplSettings, null, 4));
      log.push('Overwritten settings.json (gameProjectPath preserved)');
    } else {
      fs.writeFileSync(settingsPath, JSON.stringify({
        JSONtemplate: './sounds.json',
        JSONtarget: './dist/sounds.json',
        gameProjectPath: savedGamePath,
        SourceSoundDirectory: './sourceSoundFiles',
        DestinationSoundDirectory: './dist',
        DestinationAudioSpriteDirectory: './dist/soundFiles'
      }, null, 4));
      log.push('Created settings.json');
    }

    // 5. sourceSoundFiles/
    const srcDir = path.join(projectPath, 'sourceSoundFiles');
    if (!fs.existsSync(srcDir)) { fs.mkdirSync(srcDir, { recursive: true }); log.push('Created sourceSoundFiles/'); }

    // 6. Pull sounds.json from game repo (if configured) — replaces template sounds.json with game's version
    if (savedGamePath) {
      const gameRepoAbs = path.resolve(projectPath, savedGamePath);
      const gameSoundsJson = path.join(gameRepoAbs, 'assets', 'default', 'default', 'default', 'sounds', 'sounds.json');
      if (fs.existsSync(gameSoundsJson)) {
        const destJson = path.join(projectPath, 'sounds.json');
        fs.copyFileSync(gameSoundsJson, destJson);
        log.push('Pulled sounds.json from game repo (commands updated)');
      } else {
        log.push('Warning: sounds.json not found in game repo deploy path — using template');
      }
    }

    return { success: true, log, project: loadProject(projectPath) };
  } catch (e) {
    return { error: e.message, log };
  }
});

// Pick game repo folder
ipcMain.handle('pick-game-repo', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Game Repository Folder'
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// Configure game — picks game repo, derives everything from folder names
// Audio repo name pattern: {game}-audio or {game}-audio-howler
// Game repo name pattern: {game}-game or playa-slot-{game}-standard-game
ipcMain.handle('configure-game', async (event, { gameRepoPath }) => {
  if (!projectPath) return { error: 'No project open' };
  if (!gameRepoPath || typeof gameRepoPath !== 'string') {
    return { error: 'Game repo path is required' };
  }
  if (path.resolve(gameRepoPath) === path.resolve(projectPath)) {
    return { error: 'Game repo cannot be the same folder as the audio repo' };
  }

  const log = [];
  try {
    // Derive game name from game repo folder name
    const gameRepoName = path.basename(gameRepoPath);
    // Derive audio repo name slug from audio repo folder
    const audioRepoName = path.basename(projectPath);
    const audioSlug = audioRepoName.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    // 1. Update settings.json — set gameProjectPath as relative path
    const settingsPath = path.join(projectPath, 'settings.json');
    let settings = readJsonSafe(settingsPath) || {};
    const rel = path.relative(projectPath, gameRepoPath).split(path.sep).join('/');
    settings.gameProjectPath = rel;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 4));
    log.push(`settings.json → gameProjectPath = "${rel}"`);

    // 2. Update package.json — name from audio folder, description from game repo
    const pkgPath = path.join(projectPath, 'package.json');
    let pkg = readJsonSafe(pkgPath);
    if (pkg) {
      pkg.name = audioSlug;
      pkg.description = `Audio for ${gameRepoName}`;
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
      log.push(`package.json → name = "${audioSlug}"`);
      log.push(`package.json → description = "Audio for ${gameRepoName}"`);
    }

    // 3. Verify game repo has assets folder
    const assetsDir = path.join(gameRepoPath, 'assets');
    if (fs.existsSync(assetsDir)) {
      log.push(`Game repo assets/ folder found`);
      // Check full deploy target path
      const soundsDir = path.join(gameRepoPath, 'assets', 'default', 'default', 'default', 'sounds');
      if (fs.existsSync(soundsDir)) {
        log.push(`Deploy target sounds/ folder exists`);
      } else {
        log.push(`Deploy target will be created on first deploy`);
      }
    } else {
      log.push(`Warning: Game repo assets/ folder not found — deploy may fail`);
    }

    return { success: true, log, project: loadProject(projectPath) };
  } catch (e) {
    return { error: e.message, log };
  }
});

// yarn install in game repo — needed once before first game launch
ipcMain.handle('yarn-install-game', async () => {
  if (!projectPath) return { error: 'No project open' };
  const settings = readJsonSafe(path.join(projectPath, 'settings.json'));
  if (!settings?.gameProjectPath) return { error: 'Game repo not configured' };
  const gameRepoPath = path.resolve(projectPath, settings.gameProjectPath);
  if (!fs.existsSync(gameRepoPath)) return { error: 'Game repo folder not found' };
  return new Promise((resolve) => {
    const child = exec('yarn install', { cwd: gameRepoPath, timeout: 300000, maxBuffer: 5 * 1024 * 1024 });
    let output = '';
    child.stdout?.on('data', d => { output += d; });
    child.stderr?.on('data', d => { output += d; });
    child.on('close', (code) => {
      const project = code === 0 ? loadProject(projectPath) : null;
      resolve({ success: code === 0, output, project });
    });
    child.on('error', (e) => resolve({ success: false, output: output || e.message, error: e.message }));
  });
});

// Game launch scripts — reads game repo package.json and returns launch-related scripts
ipcMain.handle('get-game-scripts', async () => {
  if (!projectPath) return { error: 'No project open' };
  const settings = readJsonSafe(path.join(projectPath, 'settings.json'));
  if (!settings?.gameProjectPath) return { error: 'Game repo not configured' };
  const gameRepoPath = path.resolve(projectPath, settings.gameProjectPath);
  if (!fs.existsSync(gameRepoPath)) return { error: 'Game repo folder not found: ' + gameRepoPath };
  const pkg = readJsonSafe(path.join(gameRepoPath, 'package.json'));
  if (!pkg?.scripts) return { scripts: [], gameRepoPath };
  const scripts = Object.entries(pkg.scripts)
    .filter(([k, v]) => {
      if (typeof v !== 'string') return false;
      return /launch/i.test(k) || /build-dev/i.test(k) || k === 'start' || k === 'deploy-lde' || /^playa\s/.test(v);
    })
    .map(([k, v]) => ({ name: k, cmd: v }));
  return { scripts, gameRepoPath };
});

// Run a script in the game repo — streams output, allows kill
ipcMain.handle('run-game-script', async (event, scriptName) => {
  if (!projectPath) return { error: 'No project open' };
  if (!scriptName || typeof scriptName !== 'string') return { error: 'Invalid script name' };
  if (!/^[a-zA-Z0-9_-]+$/.test(scriptName)) return { error: 'Invalid script name' };
  const settings = readJsonSafe(path.join(projectPath, 'settings.json'));
  if (!settings?.gameProjectPath) return { error: 'Game repo not configured' };
  const gameRepoPath = path.resolve(projectPath, settings.gameProjectPath);
  if (!fs.existsSync(gameRepoPath)) return { error: 'Game repo folder not found' };
  try {
    // Kill any existing tracked game process
    if (gameProcess && !gameProcess.killed) {
      try {
        if (isWin) { exec(`taskkill /F /T /PID ${gameProcess.pid}`, () => {}); }
        else { gameProcess.kill('SIGTERM'); }
      } catch {}
      gameProcess = null;
    }
    // Kill whatever is on port 8080 (handles app restarts / stale processes)
    await killPort(8080);
    const send = (line) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('script-output', line); };

    // Read script command — if it calls playa, resolve binary directly (avoids yarn PATH issues on Windows)
    const gamePkg = readJsonSafe(path.join(gameRepoPath, 'package.json'));
    const scriptCmd = (gamePkg?.scripts?.[scriptName] || '').trim();
    const startsWithPlaya = /^playa\s/.test(scriptCmd);

    let child;
    if (startsWithPlaya) {
      const ext = isWin ? '.cmd' : '';
      const playaBin = path.join(gameRepoPath, 'node_modules', '.bin', `playa${ext}`);
      if (!fs.existsSync(playaBin)) {
        return { error: 'playa not found in game node_modules — run yarn install in game repo' };
      }
      const args = scriptCmd.slice('playa '.length).split(/\s+/).filter(Boolean);
      child = spawn(playaBin, args, {
        cwd: gameRepoPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: isWin
      });
    } else {
      child = spawn('yarn', [scriptName], {
        cwd: gameRepoPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: isWin
      });
    }
    gameProcess = child;
    child.stdout.on('data', d => send(d.toString()));
    child.stderr.on('data', d => send(d.toString()));
    child.on('close', () => { if (gameProcess === child) gameProcess = null; });
    child.on('error', (e) => { send(`ERROR: ${e.message}\n`); });
    return { success: true, pid: child.pid, output: `Started "${scriptName}" (PID ${child.pid})` };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Pull sounds.json from game repo deploy path → audio repo root (JSONtemplate)
ipcMain.handle('pull-game-json', async () => {
  if (!projectPath) return { error: 'No project open' };
  const settings = readJsonSafe(path.join(projectPath, 'settings.json'));
  if (!settings?.gameProjectPath) return { error: 'Game repo not configured' };
  const gameRepoPath = path.resolve(projectPath, settings.gameProjectPath);
  if (!fs.existsSync(gameRepoPath)) return { error: 'Game repo folder not found' };
  const gameSoundsJson = path.join(gameRepoPath, 'assets', 'default', 'default', 'default', 'sounds', 'sounds.json');
  if (!fs.existsSync(gameSoundsJson)) return { error: `sounds.json not found in game repo:\n${gameSoundsJson}` };
  try {
    const dest = path.join(projectPath, settings.JSONtemplate || 'sounds.json');
    fs.copyFileSync(gameSoundsJson, dest);
    return { success: true, source: gameSoundsJson, project: loadProject(projectPath) };
  } catch (e) {
    return { error: e.message };
  }
});

// Build game repo (yarn build-dev) — waits for completion, streams output
ipcMain.handle('build-game', async () => {
  if (!projectPath) return { error: 'No project open' };
  const settings = readJsonSafe(path.join(projectPath, 'settings.json'));
  if (!settings?.gameProjectPath) return { error: 'Game repo not configured' };
  const gameRepoPath = path.resolve(projectPath, settings.gameProjectPath);
  if (!fs.existsSync(gameRepoPath)) return { error: 'Game repo folder not found' };
  const gamePkg = readJsonSafe(path.join(gameRepoPath, 'package.json'));
  if (!gamePkg?.scripts?.['build-dev']) return { error: 'No build-dev script in game package.json' };
  const send = (line) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('script-output', line); };
  return new Promise((resolve) => {
    const child = spawn('yarn', ['build-dev'], {
      cwd: gameRepoPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: isWin
    });
    const timer = setTimeout(() => { child.kill(); resolve({ success: false, error: 'build-dev timeout (5 min)' }); }, 300000);
    child.stdout.on('data', d => send(d.toString()));
    child.stderr.on('data', d => send(d.toString()));
    child.on('close', (code) => { clearTimeout(timer); resolve({ success: code === 0 }); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ success: false, error: e.message }); });
  });
});

// Kill the running game process + anything on port 8080 (includes manually started processes)
ipcMain.handle('kill-game', async () => {
  try {
    if (gameProcess && !gameProcess.killed) {
      const pid = gameProcess.pid;
      gameProcess = null;
      if (isWin) { exec(`taskkill /F /T /PID ${pid}`, () => {}); }
      else { try { process.kill(pid, 'SIGTERM'); } catch {} }
    } else {
      gameProcess = null;
    }
    await killPort(8080);
    return { success: true };
  } catch (e) {
    return { error: e.message };
  }
});

// Git pull in game repo
ipcMain.handle('git-pull-game', async () => {
  if (!projectPath) return { error: 'No project open' };
  const settings = readJsonSafe(path.join(projectPath, 'settings.json'));
  if (!settings?.gameProjectPath) return { error: 'Game repo not configured' };
  const gameRepoPath = path.resolve(projectPath, settings.gameProjectPath);
  if (!fs.existsSync(gameRepoPath)) return { error: 'Game repo folder not found' };

  const send = (d) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('script-output', d); };

  const gitSpawn = (args, timeoutMs = 15000) => new Promise((resolve) => {
    let output = '';
    const child = spawn('git', args, { cwd: gameRepoPath, shell: false });
    child.stdout.on('data', d => { const s = d.toString(); output += s; send(s); });
    child.stderr.on('data', d => { const s = d.toString(); output += s; send(s); });
    const timer = setTimeout(() => { child.kill(); resolve({ code: -1, output, timedOut: true }); }, timeoutMs);
    child.on('close', code => { clearTimeout(timer); resolve({ code, output }); });
    child.on('error', e => { clearTimeout(timer); resolve({ code: -1, output: e.message }); });
  });

  // Step 1: fetch all remote refs
  send('Fetching from origin...\n');
  const fetch = await gitSpawn(['fetch', '--all'], 15000);
  if (fetch.timedOut) return { success: false, error: 'git fetch timeout (no network?)' };

  // Step 2: detect target branch — release > develop > master
  const lsRelease = await gitSpawn(['ls-remote', '--heads', 'origin', 'release'], 10000);
  if (lsRelease.timedOut) return { success: false, error: 'git ls-remote timeout' };
  let targetBranch;
  if (lsRelease.output.trim().length > 0) {
    targetBranch = 'release';
  } else {
    const lsDevelop = await gitSpawn(['ls-remote', '--heads', 'origin', 'develop'], 10000);
    if (lsDevelop.timedOut) return { success: false, error: 'git ls-remote timeout' };
    targetBranch = lsDevelop.output.trim().length > 0 ? 'develop' : 'master';
  }
  send(`\nBranch: ${targetBranch}\n`);

  // Step 3: checkout target branch (local op, fast)
  const checkout = await gitSpawn(['checkout', targetBranch], 8000);
  if (checkout.code !== 0) return { success: false, output: checkout.output, error: `Failed to checkout ${targetBranch}` };

  // Step 4: pull
  send(`Pulling ${targetBranch}...\n`);
  const pull = await gitSpawn(['pull', 'origin', targetBranch], 15000);
  if (pull.code !== 0) return { success: false, output: pull.output, error: pull.timedOut ? 'git pull timeout' : `Pull failed on ${targetBranch}` };
  return { success: true, output: pull.output };
});

// List GLR recordings from game project
ipcMain.handle('list-glr', async () => {
  if (!projectPath) return { error: 'No project open' };
  const settings = readJsonSafe(path.join(projectPath, 'settings.json'));
  if (!settings?.gameProjectPath) return { error: 'Game repo not configured' };
  const gameRepoPath = path.resolve(projectPath, settings.gameProjectPath);
  if (!fs.existsSync(gameRepoPath)) return { error: 'Game repo folder not found' };
  const glrDir = path.join(gameRepoPath, 'GLR');
  if (!fs.existsSync(glrDir)) return { glrList: [], gameRepoPath };
  const glrList = fs.readdirSync(glrDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort();
  const pkg = readJsonSafe(path.join(gameRepoPath, 'package.json'));
  const launchScript = pkg?.scripts?.launch || '';
  const swMatch = launchScript.match(/--softwareid\s+(\S+)/);
  const softwareId = swMatch ? swMatch[1] : null;
  return { glrList, gameRepoPath, softwareId };
});

// Launch game locally via GLR (no VPN required)
ipcMain.handle('launch-local-glr', async (event, { glrName }) => {
  if (!projectPath) return { error: 'No project open' };
  if (!glrName || typeof glrName !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(glrName)) {
    return { error: 'Invalid GLR name' };
  }
  const settings = readJsonSafe(path.join(projectPath, 'settings.json'));
  if (!settings?.gameProjectPath) return { error: 'Game repo not configured' };
  const gameRepoPath = path.resolve(projectPath, settings.gameProjectPath);
  if (!fs.existsSync(gameRepoPath)) return { error: 'Game repo folder not found' };
  const glrPath = path.join(gameRepoPath, 'GLR', glrName);
  if (!fs.existsSync(glrPath)) return { error: `GLR "${glrName}" not found` };
  const pkg = readJsonSafe(path.join(gameRepoPath, 'package.json'));
  const launchScript = pkg?.scripts?.launch || '';
  const swMatch = launchScript.match(/--softwareid\s+(\S+)/);
  const softwareId = swMatch ? swMatch[1] : '200-9017-001';
  const ext = isWin ? '.cmd' : '';
  const playaBin = path.join(gameRepoPath, 'node_modules', '.bin', `playa${ext}`);
  if (!fs.existsSync(playaBin)) return { error: 'playa CLI not found in game node_modules' };
  try {
    // Kill whatever is on port 8080 before launching
    await killPort(8080);
    const child = spawn(playaBin, ['launch', '--glr', glrName, '--softwareid', softwareId, '--port', '8080'], {
      cwd: gameRepoPath,
      detached: true,
      stdio: 'ignore',
      shell: isWin
    });
    child.unref();
    return { success: true, pid: child.pid, glrName, softwareId };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Open URL in system browser
ipcMain.handle('open-url', async (event, url) => {
  if (!url || typeof url !== 'string') return { error: 'Invalid URL' };
  if (!/^https?:\/\//.test(url)) return { error: 'Only http/https URLs allowed' };
  try { await shell.openExternal(url); } catch (e) { return { error: e.message }; }
  return { success: true };
});

// Open game in Chrome/Edge — Electron renderer crashes at 3% (STATUS_ACCESS_VIOLATION)
// on this machine regardless of GPU/sandbox/WebGL flags (native C++ crash, unfixable via JS).
// Chrome/Edge use the same Blink engine and handle the game fine.
// --host-resolver-rules blocks IGT/wagerworks servers at DNS level (fail-fast, no VPN hang).
// clientConfig.js in playa-cli is already patched to skip the VPN-required external call.
ipcMain.handle('open-game-window', async (event, url) => {
  if (!url || typeof url !== 'string') return { error: 'Invalid URL' };
  if (!/^https?:\/\//.test(url)) return { error: 'Only http/https URLs allowed' };

  const lappdata = process.env.LOCALAPPDATA || '';
  const progfiles = process.env.PROGRAMFILES || 'C:\\Program Files';
  const progfiles86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';

  const candidates = [
    path.join(lappdata, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(progfiles, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(progfiles86, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(progfiles, 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(progfiles86, 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(lappdata, 'Microsoft\\Edge\\Application\\msedge.exe'),
  ];

  const browserPath = candidates.find(p => { try { return fs.existsSync(p); } catch { return false; } });

  const killBrowser = (proc) => {
    if (!proc) return;
    const pid = proc.pid;
    if (isWin && pid) { exec(`taskkill /F /T /PID ${pid}`, () => {}); }
    else { try { proc.kill(); } catch {} }
  };

  if (!browserPath) {
    // No Chrome/Edge found — fall back to default browser
    killBrowser(gameBrowserProcess);
    gameBrowserProcess = null;
    await shell.openExternal(url);
    return { success: true, fallback: true };
  }

  // Kill previous game browser window if still alive
  if (gameBrowserProcess) {
    killBrowser(gameBrowserProcess);
    gameBrowserProcess = null;
    // Brief pause so the OS reclaims the window before we open a new one
    await new Promise(r => setTimeout(r, 400));
  }

  // Isolated profile so real browser sessions/auth never interfere
  const profileDir = path.join(app.getPath('temp'), 'slot-audio-glr');

  const child = spawn(browserPath, [
    '--new-window',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-web-security',
    '--allow-running-insecure-content',
    '--ignore-certificate-errors',
    // Block IGT/wagerworks servers — fail fast (NXDOMAIN) instead of hanging without VPN
    '--host-resolver-rules=MAP *.wagerworks.com ~NOTFOUND, MAP *.igt.com ~NOTFOUND',
    `--user-data-dir=${profileDir}`,
    url,
  ], { detached: false, stdio: 'ignore' });

  gameBrowserProcess = child;
  child.once('exit', () => { if (gameBrowserProcess === child) gameBrowserProcess = null; });

  return { success: true };
});

// Poll TCP port until available, then resolve (for waiting on dev servers)
ipcMain.handle('wait-for-port', async (event, { port, timeout = 120000 }) => {
  if (!port || typeof port !== 'number' || port < 1 || port > 65535) return { error: 'Invalid port' };
  const net = require('net');
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const client = net.createConnection(port, '127.0.0.1');
      client.on('connect', () => { client.destroy(); resolve({ ready: true }); });
      client.on('error', () => {
        client.destroy();
        if (Date.now() - start > timeout) return resolve({ ready: false, error: 'Timeout' });
        if (!mainWindow || mainWindow.isDestroyed()) return resolve({ ready: false, error: 'Window closed' });
        setTimeout(check, 1500);
      });
    };
    check();
  });
});

// Scan game repo TypeScript source for all soundManager.execute() calls
ipcMain.handle('scan-game-hooks', async () => {
  if (!projectPath) return { error: 'No project open' };
  const settings = readJsonSafe(path.join(projectPath, 'settings.json'));
  if (!settings?.gameProjectPath) return { error: 'Game repo not configured' };
  const gameRepoPath = path.resolve(projectPath, settings.gameProjectPath);
  if (!fs.existsSync(gameRepoPath)) return { error: 'Game repo folder not found' };

  const srcDir = path.join(gameRepoPath, 'src');
  if (!fs.existsSync(srcDir)) return { error: 'No src/ directory found in game repo' };

  // Walk all .ts/.tsx files recursively
  const walkTs = (dir, results = []) => {
    let entries;
    try { entries = fs.readdirSync(dir); } catch { return results; }
    for (const e of entries) {
      const full = path.join(dir, e);
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      if (stat.isDirectory() && e !== 'node_modules') walkTs(full, results);
      else if (stat.isFile() && (e.endsWith('.ts') || e.endsWith('.tsx'))) results.push(full);
    }
    return results;
  };

  const files = walkTs(srcDir);
  // {commandName -> Set of relative file paths}
  const hookMap = {};
  const dynamicCalls = []; // files with dynamic execute calls we can't resolve statically

  const executeRe = /soundManager\.execute\(["'`]([^"'`]+)["'`]\)/g;
  const dynamicRe = /soundManager\.execute\([^"'`)][^)]*\)/g;

  for (const file of files) {
    let content;
    try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const rel = path.relative(gameRepoPath, file).replace(/\\/g, '/');

    let m;
    executeRe.lastIndex = 0;
    while ((m = executeRe.exec(content)) !== null) {
      const name = m[1];
      if (!hookMap[name]) hookMap[name] = new Set();
      hookMap[name].add(rel);
    }
    dynamicRe.lastIndex = 0;
    if (dynamicRe.test(content)) dynamicCalls.push(rel);
  }

  // Load current sounds.json commands
  const soundsJson = readJsonSafe(path.join(projectPath, 'sounds.json'));
  const commands = soundsJson?.soundDefinitions?.commands || {};

  // Git history: find when each hook was last added (last 90 days)
  const recentlyAdded = {}; // { hookName: { timestamp, relative, message } }
  try {
    const gitLog = await new Promise((resolve) => {
      let output = '';
      const child = spawn('git', [
        'log', '-p',
        '--since=90 days ago',
        '--no-merges',
        '--unified=0',
        '--format=COMMIT_LINE|%at|%ar|%s',
        '--', 'src/'
      ], { cwd: gameRepoPath, shell: false });
      child.stdout.on('data', d => { output += d.toString(); });
      const timer = setTimeout(() => { child.kill(); resolve(''); }, 15000);
      child.on('close', () => { clearTimeout(timer); resolve(output); });
      child.on('error', () => { clearTimeout(timer); resolve(''); });
    });

    let currentCommit = null;
    const executeReLine = /soundManager\.execute\(["'`]([^"'`]+)["'`]\)/;
    for (const line of gitLog.split('\n')) {
      if (line.startsWith('COMMIT_LINE|')) {
        const parts = line.split('|');
        currentCommit = {
          timestamp: parseInt(parts[1], 10) * 1000,
          relative: parts[2],
          message: parts.slice(3).join('|'),
        };
      } else if (line.startsWith('+') && !line.startsWith('+++') && currentCommit) {
        const m = executeReLine.exec(line);
        if (m) {
          const hookName = m[1];
          if (!recentlyAdded[hookName] || currentCommit.timestamp > recentlyAdded[hookName].timestamp) {
            recentlyAdded[hookName] = currentCommit;
          }
        }
      }
    }
  } catch {}

  const hooks = Object.entries(hookMap).map(([name, filesSet]) => ({
    name,
    files: [...filesSet],
    inJson: name in commands,
    isEmpty: !commands[name] || commands[name].length === 0,
    recent: recentlyAdded[name] || null,
  }));

  // Sort: within each group, newest first, then alphabetical
  hooks.sort((a, b) => {
    if (a.recent && b.recent) return b.recent.timestamp - a.recent.timestamp;
    if (a.recent) return -1;
    if (b.recent) return 1;
    return a.name.localeCompare(b.name);
  });

  // Commands in sounds.json not called from game source
  const gameHookNames = new Set(Object.keys(hookMap));
  const deadCommands = Object.keys(commands).filter(n => !gameHookNames.has(n)).sort();

  return { hooks, deadCommands, dynamicCalls, totalFiles: files.length };
});

ipcMain.handle('analyze-orphans', async () => {
  if (!projectPath) return { error: 'No project open' };
  try {
    const settings = readJsonSafe(path.join(projectPath, 'settings.json'));
    const soundsJson = readJsonSafe(path.join(projectPath, 'sounds.json'));
    if (!settings || !soundsJson) return { error: 'Missing settings.json or sounds.json' };

    const srcDir = path.resolve(projectPath, settings.SourceSoundDirectory || './sourceSoundFiles');
    if (!srcDir.startsWith(projectPath + path.sep) && srcDir !== projectPath) {
      return { error: 'SourceSoundDirectory points outside project folder' };
    }
    const wavNames = new Set(
      fs.readdirSync(srcDir)
        .filter(f => f.toLowerCase().endsWith('.wav'))
        .map(f => f.replace(/\.wav$/i, ''))
    );

    const soundSprites = soundsJson.soundDefinitions?.soundSprites || {};
    const commands = soundsJson.soundDefinitions?.commands || {};
    const spriteLists = soundsJson.soundDefinitions?.spriteList || {};

    // Step 1: orphaned sprite keys
    const orphanSet = new Set(
      Object.entries(soundSprites)
        .filter(([key, val]) => !wavNames.has(val.spriteId || key.replace(/^s_/, '')))
        .map(([key]) => key)
    );

    // Step 2: which spriteLists will be emptied or partially cleaned
    const removedSpriteLists = new Set();
    const affectedSpriteLists = {};
    for (const [k, val] of Object.entries(spriteLists)) {
      const arr = Array.isArray(val) ? val : (val?.items || []);
      const bad = arr.filter(id => orphanSet.has(id));
      if (bad.length > 0) {
        affectedSpriteLists[k] = bad;
        if (bad.length === arr.length) removedSpriteLists.add(k);
      }
    }

    // Step 3: affected commands — only steps are removed, commands always kept
    const affectedCommands = {};
    for (const [cmdName, steps] of Object.entries(commands)) {
      const arr = Array.isArray(steps) ? steps : [steps];
      const bad = arr.filter(s => s && (orphanSet.has(s.spriteId) || removedSpriteLists.has(s.spriteListId)));
      if (bad.length > 0) {
        affectedCommands[cmdName] = bad.map(s => s.spriteId || ('list:' + s.spriteListId));
      }
    }

    return {
      orphanedSprites: [...orphanSet],
      affectedSpriteLists,
      removedSpriteLists: [...removedSpriteLists],
      affectedCommands
    };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('clean-orphans', async () => {
  if (!projectPath) return { error: 'No project open' };
  try {
    const settings = readJsonSafe(path.join(projectPath, 'settings.json'));
    const soundsJson = readJsonSafe(path.join(projectPath, 'sounds.json'));
    if (!settings || !soundsJson) return { error: 'Missing settings.json or sounds.json' };

    const srcDir = path.resolve(projectPath, settings.SourceSoundDirectory || './sourceSoundFiles');
    if (!srcDir.startsWith(projectPath + path.sep) && srcDir !== projectPath) {
      return { error: 'SourceSoundDirectory points outside project folder' };
    }
    const wavNames = new Set(
      fs.readdirSync(srcDir)
        .filter(f => f.toLowerCase().endsWith('.wav'))
        .map(f => f.replace(/\.wav$/i, ''))
    );

    const soundSprites = soundsJson.soundDefinitions?.soundSprites || {};
    const commands = soundsJson.soundDefinitions?.commands || {};
    const spriteLists = soundsJson.soundDefinitions?.spriteList || {};

    // Step 1: find orphaned sprite keys
    const orphanSet = new Set(
      Object.entries(soundSprites)
        .filter(([key, val]) => !wavNames.has(val.spriteId || key.replace(/^s_/, '')))
        .map(([key]) => key)
    );

    // Step 2: remove orphaned sprites from soundSprites
    for (const key of orphanSet) delete soundSprites[key];

    // Step 3: clean spriteLists — remove orphaned IDs, drop empty lists
    const cleanedSpriteLists = {};
    const removedSpriteLists = new Set();
    for (const [k, val] of Object.entries(spriteLists)) {
      const arr = Array.isArray(val) ? val : (val?.items || []);
      const clean = arr.filter(id => !orphanSet.has(id));
      if (clean.length === 0) {
        removedSpriteLists.add(k); // entire list removed
      } else {
        cleanedSpriteLists[k] = Array.isArray(val) ? clean : { ...val, items: clean };
      }
    }

    // Step 4: clean commands — remove bad steps, always keep the command (even if 0 steps)
    let removedSteps = 0;
    const cleanedCommands = {};
    for (const [cmdName, steps] of Object.entries(commands)) {
      const arr = Array.isArray(steps) ? steps : [steps];
      const clean = arr.filter(s => {
        if (!s) return false;
        if (s.spriteId && orphanSet.has(s.spriteId)) { removedSteps++; return false; }
        if (s.spriteListId && removedSpriteLists.has(s.spriteListId)) { removedSteps++; return false; }
        return true;
      });
      cleanedCommands[cmdName] = clean;
    }

    if (!soundsJson.soundDefinitions) soundsJson.soundDefinitions = {};
    soundsJson.soundDefinitions.soundSprites = soundSprites;
    soundsJson.soundDefinitions.spriteList = cleanedSpriteLists;
    soundsJson.soundDefinitions.commands = cleanedCommands;

    fs.writeFileSync(path.join(projectPath, 'sounds.json'), JSON.stringify(soundsJson, null, 2));

    return {
      success: true,
      removedSprites: orphanSet.size,
      removedSpriteLists: removedSpriteLists.size,
      removedSteps,
      project: loadProject(projectPath)
    };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('npm-install', async () => {
  if (!projectPath) return { error: 'No project open' };
  // Use yarn if yarn.lock exists, otherwise fall back to npm
  const hasYarnLock = fs.existsSync(path.join(projectPath, 'yarn.lock'));
  const cmd = hasYarnLock ? 'yarn' : 'npm install --legacy-peer-deps';
  const send = (d) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('script-output', d); };
  return new Promise((resolve) => {
    let output = '';
    const child = exec(cmd, { cwd: projectPath, timeout: 240000, maxBuffer: 5 * 1024 * 1024 });
    child.stdout?.on('data', d => { const s = d.toString(); output += s; send(s); });
    child.stderr?.on('data', d => { const s = d.toString(); output += s; send(s); });
    child.on('close', (code) => {
      resolve({ success: code === 0, output, project: code === 0 ? loadProject(projectPath) : null });
    });
    child.on('error', (e) => resolve({ success: false, output: output || e.message, error: e.message }));
  });
});

// Measure pool: run audiosprite on a tier's sounds in temp dir to get actual M4A size
ipcMain.handle('measure-pool', async (event, { tierName, sounds, encoding: enc }) => {
  if (!projectPath) return { error: 'No project open' };
  const settings = readJsonSafe(path.join(projectPath, 'settings.json'));
  const srcDir = path.resolve(projectPath, settings?.SourceSoundDirectory || './sourceSoundFiles');
  if (!fs.existsSync(srcDir)) return { error: 'sourceSoundFiles not found' };

  const files = [];
  for (const s of sounds) {
    const f = path.join(srcDir, s + '.wav');
    if (fs.existsSync(f)) files.push(f);
  }
  if (files.length === 0) return { sizeKB: 0, sounds: 0 };

  const customAS = path.join(projectPath, 'scripts', 'customAudioSprite.js');
  if (!fs.existsSync(customAS)) return { error: 'Run Sync Template first' };
  if (!fs.existsSync(path.join(projectPath, 'node_modules'))) return { error: 'Run npm install first' };

  const os = require('os');
  const tmpDir = path.join(os.tmpdir(), 'sam-measure-' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });
  const outBase = path.join(tmpDir, 'measure').replace(/\\/g, '/');

  const e = enc || { bitrate: 64, channels: 1, samplerate: 44100 };
  const sc = readJsonSafe(path.join(projectPath, 'sprite-config.json'));
  const gap = sc?.spriteGap ?? 0.05;

  const scriptPath = path.join(tmpDir, 'measure.js');
  fs.writeFileSync(scriptPath, `
const as = require(${JSON.stringify(customAS.replace(/\\/g, '/'))});
const ff = require('ffmpeg-static');
const fs = require('fs');
const opts = { output: ${JSON.stringify(outBase)}, format: 'howler2', export: 'm4a',
  bitrate: ${e.keepOriginal ? 320 : (e.bitrate || 64)}, gap: ${gap}, silence: 0,
  logger: { debug:()=>{}, info:()=>{}, log:()=>{} } };
${!e.keepOriginal ? `opts.channels=${e.channels||1};opts.samplerate=${e.samplerate||44100};` : ''}
as(ff, ${JSON.stringify(files.map(f => f.replace(/\\/g, '/')))}, opts, 0, (err) => {
  if(err){process.stderr.write(String(err.message||err));process.exit(1);}
  try{process.stdout.write(String(Math.round(fs.statSync(${JSON.stringify(outBase)}+'.m4a').size/1024)));}
  catch{process.stderr.write('M4A not created');process.exit(1);}
});
`);

  return new Promise((resolve) => {
    const child = exec(`node "${scriptPath}"`, {
      cwd: projectPath, timeout: 120000, maxBuffer: 5 * 1024 * 1024,
      env: { ...process.env, NODE_PATH: path.join(projectPath, 'node_modules') },
    });
    let stdout = '', stderr = '';
    child.stdout?.on('data', d => { stdout += d; });
    child.stderr?.on('data', d => { stderr += d; });
    child.on('close', (code) => {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      if (code !== 0) return resolve({ error: stderr.trim() || 'Measure failed' });
      const kb = parseInt(stdout.trim(), 10);
      resolve({ sizeKB: isNaN(kb) ? 0 : kb, sounds: files.length });
    });
    child.on('error', (e) => {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      resolve({ error: e.message });
    });
  });
});
