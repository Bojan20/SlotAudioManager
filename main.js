const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFileSync, execSync, exec, spawn } = require('child_process');
const { pathToFileURL } = require('url');

// Must be called before app.whenReady()
protocol.registerSchemesAsPrivileged([{
  scheme: 'audio',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false }
}]);

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

// Suppress Git Credential Manager GUI prompts during background fetches.
// Forces cached credential — no account picker popup.
const gitSilentEnv = { ...process.env, GCM_INTERACTIVE: 'never', GIT_TERMINAL_PROMPT: '0' };

let mainWindow;
let projectPath = null;
let gameProcess = null; // currently running game process (for kill support)
let gameBrowserProcess = null; // tracked Chrome/Edge window for game preview
let buildProcess = null; // currently running build/deploy script

// Undo/Redo history — tracks file changes (sounds.json, sprite-config.json)
const undoStack = [];
const redoStack = [];
const MAX_HISTORY = 50;

function pushUndo(filePath, prevContent, nextContent) {
  if (prevContent === nextContent) return; // no change — skip
  undoStack.push({ file: filePath, prev: prevContent, next: nextContent });
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0; // clear redo on new edit
}


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

// Kill all spawned game processes when app quits
app.on('before-quit', () => {
  // Kill tracked game process
  if (gameProcess && !gameProcess.killed) {
    const pid = gameProcess.pid;
    if (isWin) { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }); } catch {} }
    else { try { process.kill(pid, 'SIGTERM'); } catch {} }
    gameProcess = null;
  }
  // Kill anything on port 8080 (GLR server, detached dev server, etc.)
  try {
    if (isWin) {
      const out = execSync('netstat -ano', { timeout: 5000, encoding: 'utf8' });
      const pids = new Set();
      for (const line of out.split('\n')) {
        if (line.includes(':8080') && line.includes('LISTENING')) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && /^\d+$/.test(pid) && pid !== '0') pids.add(pid);
        }
      }
      for (const pid of pids) {
        try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }); } catch {}
      }
    } else {
      try { execSync("lsof -ti:8080 | xargs kill -9", { stdio: 'ignore' }); } catch {}
    }
  } catch {}
  // Restore system Node to the version that was active when app started
  nvmRestore();
});

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
  undoStack.length = 0; redoStack.length = 0;
  // Clear caches for new project
  Object.keys(gameNodeCache).filter(k => k.startsWith('_')).forEach(k => delete gameNodeCache[k]);
  return loadProject(projectPath);
});

function loadProject(dirPath) {
  const data = { path: dirPath, sounds: [], settings: null, spriteConfig: null, soundsJson: null, scripts: {}, distInfo: null, gameRepoAbsPath: null, gameRepoExists: false, gameNodeModulesExists: false };

  data.settings = readJsonSafe(path.join(dirPath, 'settings.json'));
  data.spriteConfig = readJsonSafe(path.join(dirPath, 'sprite-config.json'));
  data.soundsJson = readJsonSafe(path.join(dirPath, 'sounds.json'));

  // Auto-fix: resolve misplaced and broken references in commands
  if (data.soundsJson?.soundDefinitions?.commands) {
    const sprites = data.soundsJson.soundDefinitions.soundSprites || {};
    const lists = data.soundsJson.soundDefinitions.spriteList || {};
    const cmds = data.soundsJson.soundDefinitions.commands;
    const spriteKeys = Object.keys(sprites);
    const listKeys = Object.keys(lists);

    // Fuzzy match: find closest sprite/list by Levenshtein distance (max 3 edits)
    const levenshtein = (a, b) => {
      const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i]);
      for (let j = 1; j <= n; j++) d[0][j] = j;
      for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
        d[i][j] = Math.min(d[i-1][j] + 1, d[i][j-1] + 1, d[i-1][j-1] + (a[i-1] !== b[j-1] ? 1 : 0));
      return d[m][n];
    };
    const findNearest = (id, pool) => {
      let best = null, bestDist = 3; // max 2 edits
      const idLow = id.toLowerCase();
      for (const k of pool) { const d = levenshtein(idLow, k.toLowerCase()); if (d < bestDist) { best = k; bestDist = d; } }
      // Only accept if match is very close AND id length is similar (avoids short→long false positives)
      if (best && Math.abs(id.length - best.length) > 3) return null;
      return best;
    };

    let fixed = false;
    for (const steps of Object.values(cmds)) {
      if (!Array.isArray(steps)) continue;
      for (const s of steps) {
        if (!s) continue;

        // Layer 1: spriteId → actually a sprite list
        if (s.spriteId && !s.spriteListId && !sprites[s.spriteId] && lists[s.spriteId]) {
          s.spriteListId = s.spriteId; delete s.spriteId; fixed = true;
        }
        // Layer 1: spriteListId → actually a sound sprite
        if (s.spriteListId && !s.spriteId && !lists[s.spriteListId] && sprites[s.spriteListId]) {
          s.spriteId = s.spriteListId; delete s.spriteListId; fixed = true;
        }
        // Layer 1: commandId → actually a sprite or list
        if (s.commandId && !cmds[s.commandId] && !s.spriteId && !s.spriteListId) {
          if (sprites[s.commandId]) { s.spriteId = s.commandId; delete s.commandId; fixed = true; }
          else if (lists[s.commandId]) { s.spriteListId = s.commandId; delete s.commandId; fixed = true; }
        }

        // Layer 2: prefix normalization — sl_ ref not in lists, try as s_ sprite or vice versa
        if (s.spriteListId && !s.spriteId && !lists[s.spriteListId]) {
          const asSprite = s.spriteListId.replace(/^sl_/, 's_');
          if (sprites[asSprite]) { s.spriteId = asSprite; delete s.spriteListId; fixed = true; }
        }
        if (s.spriteId && !s.spriteListId && !sprites[s.spriteId]) {
          const asList = s.spriteId.replace(/^s_/, 'sl_');
          if (lists[asList]) { s.spriteListId = asList; delete s.spriteId; fixed = true; }
        }

        // Layer 3: fuzzy match — fix typos (max 3 character difference)
        if (s.spriteId && !sprites[s.spriteId] && !s.spriteListId) {
          const match = findNearest(s.spriteId, spriteKeys);
          if (match) { s.spriteId = match; fixed = true; }
        }
        if (s.spriteListId && !lists[s.spriteListId] && !s.spriteId) {
          const match = findNearest(s.spriteListId, listKeys);
          if (match) { s.spriteListId = match; fixed = true; }
        }
      }
    }
    if (fixed) {
      try { fs.writeFileSync(path.join(dirPath, 'sounds.json'), JSON.stringify(data.soundsJson, null, 2)); } catch {}
    }
  }

  // Ensure .gitattributes exists for consistent line endings
  const gitattrsPath = path.join(dirPath, '.gitattributes');
  if (!fs.existsSync(gitattrsPath)) {
    try { fs.writeFileSync(gitattrsPath, '* text=auto\n*.wav binary\n*.m4a binary\n*.mp3 binary\n*.ogg binary\n'); } catch {}
  }

  // Auto-detect game repo if not configured — convention: {name}-audio[-howler] → {name}-game in same parent
  if (!data.settings?.gameProjectPath) {
    const folderName = path.basename(dirPath);
    const audioMatch = folderName.match(/^(.+)-audio(?:-\w+)?$/);
    if (audioMatch) {
      const gameName = audioMatch[1] + '-game';
      const gameCandidate = path.join(path.dirname(dirPath), gameName);
      if (fs.existsSync(gameCandidate) && fs.existsSync(path.join(gameCandidate, 'package.json'))) {
        const relPath = path.relative(dirPath, gameCandidate);
        // Auto-configure: write to settings.json and update package.json
        if (!data.settings) data.settings = {};
        data.settings.gameProjectPath = relPath;
        try {
          const settingsPath = path.join(dirPath, 'settings.json');
          const existing = readJsonSafe(settingsPath) || {};
          existing.gameProjectPath = relPath;
          fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 4));
        } catch {}
        // Update package.json name/description
        try {
          const pkgPath = path.join(dirPath, 'package.json');
          const audioPkg = readJsonSafe(pkgPath);
          if (audioPkg) {
            const audioSlug = folderName;
            audioPkg.name = audioSlug;
            audioPkg.description = `Audio for ${gameName}`;
            fs.writeFileSync(pkgPath, JSON.stringify(audioPkg, null, 2) + '\n');
          }
        } catch {}
      }
    }
  }

  // Resolve gameProjectPath to absolute for UI display
  if (data.settings?.gameProjectPath) {
    const abs = path.resolve(dirPath, data.settings.gameProjectPath);
    data.gameRepoAbsPath = abs;
    data.gameRepoExists = fs.existsSync(abs);
    data.gameNodeModulesExists = fs.existsSync(path.join(abs, 'node_modules'));
    data.deployTarget = path.join(abs, 'assets', 'default', 'default', 'default', 'sounds');
    data.deployTargetExists = fs.existsSync(data.deployTarget);

    // Detect + cache Node version from game's webpack version (proactive, no build needed)
    const cached = gameNodeCache[abs];
    if (!cached && data.gameRepoExists) {
      try { detectGameNode(abs); } catch {}
    }

    // Surface cached Node version for UI
    const cachedNow = gameNodeCache[abs];
    if (cachedNow === 'system') {
      try { data.gameNodeVersion = execFileSync('node', ['-v'], { timeout: 3000 }).toString().trim(); }
      catch { data.gameNodeVersion = process.version; }
    } else if (cachedNow && typeof cachedNow === 'string' && !cachedNow.startsWith('_')) {
      const dirName = path.basename(cachedNow);
      data.gameNodeVersion = dirName.startsWith('v') ? dirName : 'v' + dirName;
    }

    // Collect branch info for UI — no auto-checkout, user picks branch
    if (data.gameRepoExists) {
      try {
        // Fetch silently so branch list is fresh — once per session per repo
        if (!gameNodeCache['_fetched_' + abs]) {
          try { execFileSync('git', ['fetch', '--all', '--prune'], { cwd: abs, timeout: 10000, stdio: 'ignore', env: gitSilentEnv }); } catch {}
          gameNodeCache['_fetched_' + abs] = true;
        }
        data.gameRepoBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: abs, timeout: 5000 }).toString().trim();
        const remoteBranches = execFileSync('git', ['branch', '-r'], { cwd: abs, timeout: 5000 }).toString();
        data.gameRepoBranches = [...remoteBranches.matchAll(/origin\/([^\s]+)/g)]
          .map(m => m[1])
          .filter(b => b !== 'HEAD' && !b.startsWith('HEAD '))
          .sort((a, b) => {
            // release first, then develop, then rest
            const ra = a.startsWith('release/') ? 0 : a === 'develop' ? 1 : 2;
            const rb = b.startsWith('release/') ? 0 : b === 'develop' ? 1 : 2;
            return ra !== rb ? ra - rb : a.localeCompare(b);
          });
      } catch { data.gameRepoBranch = ''; data.gameRepoBranches = []; }
    }
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
    const filePath = path.join(projectPath, 'sprite-config.json');
    const prev = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
    const next = JSON.stringify(config, null, 2);
    fs.writeFileSync(filePath, next);
    if (prev !== null) pushUndo(filePath, prev, next);
    return { success: true };
  } catch (e) {
    return { error: e.message };
  }
});

// Sanitize command steps — fix known type bugs before writing to disk
function sanitizeCommandStep(step) {
  const s = { ...step };
  // Fix: spriteId pointing to a sprite list (sl_ prefix) → move to spriteListId
  if (s.spriteId && s.spriteId.startsWith('sl_') && !s.spriteListId) {
    s.spriteListId = s.spriteId;
    delete s.spriteId;
  }
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
      const sprites = data.soundDefinitions.soundSprites || {};
      const lists = data.soundDefinitions.spriteList || {};
      const cmds = data.soundDefinitions.commands;
      for (const [cmdName, steps] of Object.entries(cmds)) {
        if (Array.isArray(steps)) {
          cmds[cmdName] = steps.map(s => {
            s = sanitizeCommandStep(s);
            // Resolve misplaced references using actual data (don't overwrite existing fields)
            if (s.spriteId && !s.spriteListId && !sprites[s.spriteId] && lists[s.spriteId]) {
              s.spriteListId = s.spriteId; delete s.spriteId;
            }
            if (s.spriteListId && !s.spriteId && !lists[s.spriteListId] && sprites[s.spriteListId]) {
              s.spriteId = s.spriteListId; delete s.spriteListId;
            }
            return s;
          });
        }
      }
    }
    const filePath = path.join(projectPath, 'sounds.json');
    const prev = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
    const next = JSON.stringify(data, null, 2);
    fs.writeFileSync(filePath, next);
    if (prev !== null) pushUndo(filePath, prev, next);
    return { success: true };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('undo', async () => {
  if (!projectPath || undoStack.length === 0) return { error: 'Nothing to undo' };
  if (buildProcess) return { error: 'Cannot undo while build is running' };
  try {
    const entry = undoStack.pop();
    fs.writeFileSync(entry.file, entry.prev);
    redoStack.push(entry);
    return { success: true, project: loadProject(projectPath), canUndo: undoStack.length > 0, canRedo: true };
  } catch (e) { return { error: e.message }; }
});

ipcMain.handle('redo', async () => {
  if (!projectPath || redoStack.length === 0) return { error: 'Nothing to redo' };
  if (buildProcess) return { error: 'Cannot redo while build is running' };
  try {
    const entry = redoStack.pop();
    fs.writeFileSync(entry.file, entry.next);
    undoStack.push(entry);
    return { success: true, project: loadProject(projectPath), canUndo: true, canRedo: redoStack.length > 0 };
  } catch (e) { return { error: e.message }; }
});

ipcMain.handle('undo-status', async () => {
  return { canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 };
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

// Run npm script in audio repo — with Node version fallback via nvm
function runNpmScript(cwd, scriptName, nodeDir, send) {
  return new Promise((resolve) => {
    const baseEnv = { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' };
    delete baseEnv.NODE_OPTIONS;
    let cmd, args, env, useShell;
    if (nodeDir) {
      const nodeExe = path.join(nodeDir, isWin ? 'node.exe' : 'bin/node');
      // Find npm-cli.js for this node version
      const npmCli = path.join(nodeDir, isWin ? '' : 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
      if (!fs.existsSync(npmCli)) {
        // Fallback: use global npm with this node's PATH prepended
        cmd = isWin ? 'npm.cmd' : 'npm';
        args = ['run', scriptName];
        env = { ...baseEnv, PATH: (isWin ? nodeDir : path.join(nodeDir, 'bin')) + path.delimiter + baseEnv.PATH };
        useShell = isWin;
      } else {
        cmd = nodeExe;
        args = [npmCli, 'run', scriptName];
        env = { ...baseEnv, PATH: (isWin ? nodeDir : path.join(nodeDir, 'bin')) + path.delimiter + baseEnv.PATH };
        useShell = false;
      }
    } else {
      cmd = 'npm';
      args = ['run', scriptName];
      env = baseEnv;
      useShell = true;
    }
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: useShell, env });
    buildProcess = child;
    let output = '';
    const timer = setTimeout(() => { child.kill(); buildProcess = null; send('\n[TIMEOUT — build killed after 5 minutes]\n'); resolve({ success: false, error: 'Timeout', output }); }, 300000);
    child.stdout.on('data', d => { const s = d.toString(); output += s; send(s); });
    child.stderr.on('data', d => { const s = d.toString(); output += s; send(s); });
    child.on('error', (e) => { clearTimeout(timer); buildProcess = null; resolve({ success: false, error: e.message, output }); });
    child.on('close', (code) => { clearTimeout(timer); buildProcess = null; resolve({ success: code === 0, output }); });
  });
}

ipcMain.handle('run-script', async (event, scriptName) => {
  if (!projectPath) return { error: 'No project open' };
  if (buildProcess) return { error: 'A build is already running' };
  if (!scriptName || typeof scriptName !== 'string') return { error: 'Invalid script name' };
  if (!/^[a-zA-Z0-9_-]+$/.test(scriptName)) return { error: 'Invalid script name' };
  const cwd = projectPath; // capture — projectPath can change if user opens another project mid-build
  const send = (line) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('script-output', line); };

  // If cached Node version — verify node.exe still exists, then use
  const cached = gameNodeCache[cwd];
  if (cached && cached !== 'system' && !cached.startsWith('_')) {
    if (fs.existsSync(path.join(cached, isWin ? 'node.exe' : 'bin/node'))) {
      return runNpmScript(cwd, scriptName, cached, send);
    }
    delete gameNodeCache[cwd]; // stale cache — Node was uninstalled
  }

  // Try system Node first
  const result = await runNpmScript(cwd, scriptName, null, send);
  if (result.success) {
    gameNodeCache[cwd] = 'system';
    return result;
  }

  // Check for Node compat errors — try older versions
  const isCompatBug = /ERR_OSSL_EVP_UNSUPPORTED|digital envelope routines|error:0308010C|callback.*already called/.test(result.output || '');
  if (!isCompatBug) return { ...result, error: result.error || 'Script failed' };

  const sysNodeMajor = getSystemNodeMajor();
  const versions = findNvmNodeVersions();
  const fallbacks = versions.filter(v => {
    const major = parseInt(v.version.split('.')[0]);
    return major >= 16 && major < sysNodeMajor;
  });

  for (const fb of fallbacks) {
    send(`\nRetrying with Node ${fb.version}...\n`);
    const fbResult = await runNpmScript(cwd, scriptName, fb.dir, send);
    if (fbResult.success) {
      gameNodeCache[cwd] = fb.dir;
      nvmUse(fb.version);
      send(`\n✔ Switched system Node to v${fb.version} (nvm use)\n`);
      return fbResult;
    }
  }

  return { success: false, error: fallbacks.length === 0 ? 'Build failed — no compatible Node found via nvm' : 'Build failed with all Node versions' };
});

ipcMain.handle('run-deploy', async (event, scriptName) => {
  if (!projectPath) return { error: 'No project open' };
  const name = scriptName || 'deploy';
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return { error: 'Invalid script name' };
  const cwd = projectPath;
  const send = (line) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('script-output', line); };
  // Use cached Node version if available — verify it still exists
  const cached = gameNodeCache[cwd];
  let nodeDir = null;
  if (cached && cached !== 'system' && !cached.startsWith('_')) {
    if (fs.existsSync(path.join(cached, isWin ? 'node.exe' : 'bin/node'))) {
      nodeDir = cached;
    } else {
      delete gameNodeCache[cwd];
    }
  }
  return runNpmScript(cwd, name, nodeDir, send);
});

ipcMain.handle('clean-dist', async () => {
  if (!projectPath) return { error: 'No project open' };
  const distSoundFiles = path.join(projectPath, 'dist', 'soundFiles');
  const distSoundsJson = path.join(projectPath, 'dist', 'sounds.json');
  const buildCache = path.join(projectPath, '.build-cache.json');
  let removed = 0;
  try {
    if (fs.existsSync(distSoundFiles)) {
      const files = fs.readdirSync(distSoundFiles).filter(f => f.endsWith('.m4a') || (f.startsWith('soundData_') && f.endsWith('.json')));
      for (const f of files) { fs.rmSync(path.join(distSoundFiles, f)); removed++; }
    }
    if (fs.existsSync(distSoundsJson)) { fs.rmSync(distSoundsJson); removed++; }
    if (fs.existsSync(buildCache)) { fs.rmSync(buildCache); removed++; }
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
    try { execFileSync('git', ['fetch', 'origin'], { cwd: projectPath, timeout: 15000, env: gitSilentEnv }); } catch {}
    return { success: true };
  } catch (e) {
    return { error: e.message };
  }
});

// ── Game Repo Git Operations ──

ipcMain.handle('game-git-status', async () => {
  if (!projectPath) return { error: 'No project open' };
  const settings = readJsonSafe(path.join(projectPath, 'settings.json'));
  if (!settings?.gameProjectPath) return { error: 'Game repo not configured' };
  const gameRepoPath = path.resolve(projectPath, settings.gameProjectPath);
  if (!fs.existsSync(gameRepoPath)) return { error: 'Game repo folder not found' };
  try {
    const opts = { cwd: gameRepoPath, timeout: 10000 };
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], opts).toString().trim();
    const status = execFileSync('git', ['status', '--porcelain'], opts).toString().trim();
    const files = status ? status.split('\n') : [];
    // List remote branches to find develop/release
    let remoteBranches = [];
    try {
      remoteBranches = execFileSync('git', ['branch', '-r', '--format', '%(refname:short)'], opts)
        .toString().trim().split('\n').filter(Boolean).map(b => b.replace('origin/', '')).filter(b => b !== 'HEAD');
    } catch {}
    const hasDevelop = remoteBranches.includes('develop');
    const releaseBranches = remoteBranches.filter(b => b.startsWith('release'));
    return { branch, files, hasDevelop, releaseBranches, gameRepoPath };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('game-git-create-branch-commit-push', async (event, { targetBranch, branchName, commitMsg }) => {
  if (!projectPath) return { error: 'No project open' };
  const settings = readJsonSafe(path.join(projectPath, 'settings.json'));
  if (!settings?.gameProjectPath) return { error: 'Game repo not configured' };
  const gameRepoPath = path.resolve(projectPath, settings.gameProjectPath);
  if (!fs.existsSync(gameRepoPath)) return { error: 'Game repo folder not found' };
  if (!commitMsg?.trim()) return { error: 'Commit message is required' };
  if (!branchName?.trim()) return { error: 'Branch name is required' };
  if (!/^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/.test(branchName)) return { error: 'Invalid branch name characters' };
  if (!targetBranch || !/^[a-zA-Z0-9/_.-]+$/.test(targetBranch)) return { error: 'Invalid target branch' };
  try {
    const opts = { cwd: gameRepoPath, timeout: 30000 };
    // Fetch latest
    try { execFileSync('git', ['fetch', 'origin'], { cwd: gameRepoPath, timeout: 15000, env: gitSilentEnv }); } catch {}
    // Stash any local changes before switching branches
    try { execFileSync('git', ['stash', '--include-untracked'], opts); } catch {}
    // Checkout target branch and pull latest
    execFileSync('git', ['checkout', targetBranch], opts);
    try { execFileSync('git', ['pull', 'origin', targetBranch], { cwd: gameRepoPath, timeout: 30000 }); } catch {}
    // Create new branch or switch to existing
    try {
      execFileSync('git', ['checkout', '-b', branchName], opts);
    } catch {
      // Branch exists — switch to it and reset to target
      execFileSync('git', ['checkout', branchName], opts);
      execFileSync('git', ['reset', '--hard', targetBranch], opts);
    }
    // Restore stashed changes
    try { execFileSync('git', ['stash', 'pop'], opts); } catch (stashErr) {
      // If stash pop fails with conflict, abort and report
      const stashList = execFileSync('git', ['stash', 'list'], opts).toString().trim();
      if (stashList) {
        try { execFileSync('git', ['stash', 'drop'], opts); } catch {}
        return { error: 'Stash conflict — your deployed files conflict with remote changes. Re-deploy and try again.' };
      }
    }
    // Stage, commit, push
    execFileSync('git', ['add', '-A'], opts);
    execFileSync('git', ['commit', '-m', commitMsg.trim()], opts);
    execFileSync('git', ['push', '-u', 'origin', branchName], { cwd: gameRepoPath, timeout: 60000 });
    try { execFileSync('git', ['fetch', 'origin'], { cwd: gameRepoPath, timeout: 15000, env: gitSilentEnv }); } catch {}
    return { success: true, branch: branchName };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('game-git-create-pr', async (event, { branchName, targetBranch, title }) => {
  if (!projectPath) return { error: 'No project open' };
  if (!branchName || !targetBranch || !title?.trim()) return { error: 'Missing PR parameters' };
  const settings = readJsonSafe(path.join(projectPath, 'settings.json'));
  if (!settings?.gameProjectPath) return { error: 'Game repo not configured' };
  const gameRepoPath = path.resolve(projectPath, settings.gameProjectPath);
  if (!fs.existsSync(gameRepoPath)) return { error: 'Game repo folder not found' };
  try {
    const ghBin = isWin ? 'gh.exe' : 'gh';
    const result = execFileSync(ghBin, ['pr', 'create',
      '--base', targetBranch,
      '--head', branchName,
      '--title', title.trim(),
      '--body', 'Audio update'
    ], { cwd: gameRepoPath, timeout: 30000, encoding: 'utf8' });
    return { success: true, url: result.trim() };
  } catch (e) {
    const msg = e.code === 'ENOENT' ? 'GitHub CLI (gh) not installed — install from https://cli.github.com' : e.message;
    return { error: msg };
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
    // Add app-managed scripts (not in template — template stays untouched)
    if (!projPkg.scripts) projPkg.scripts = {};
    const appScripts = {
      'build': 'node scripts/buildTiered.js && node scripts/buildTieredJSON.js',
      'build-validate': 'node scripts/validateBuild.js',
      'deploy': 'node scripts/copyAudio.js',
    };
    for (const [k, v] of Object.entries(appScripts)) {
      if (projPkg.scripts[k] !== v) {
        const action = projPkg.scripts[k] ? 'Overwritten' : 'Added';
        projPkg.scripts[k] = v;
        log.push(`${action} script: ${k}`);
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

    // 6. Auto-pull removed — user can manually pull sounds.json via "Pull from Game" button

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

    // 4. Detect required Node version from game's webpack major version
    const absGamePath = path.resolve(gameRepoPath);
    delete gameNodeCache[absGamePath]; // force re-detection for newly linked repo
    const detected = detectGameNode(absGamePath);
    if (detected?.msg) log.push(detected.msg);

    return { success: true, log, project: loadProject(projectPath) };
  } catch (e) {
    return { error: e.message, log };
  }
});

// yarn install in game repo — needed once before first game launch
// Uses findYarnJs() + nvm fallback like build-game, cleans NODE_OPTIONS
function runYarnInstall(gameRepoPath, nodeDir) {
  return new Promise((resolve) => {
    const baseEnv = { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' };
    delete baseEnv.NODE_OPTIONS;
    let cmd, args, env, useShell;
    if (nodeDir) {
      const nodeExe = path.join(nodeDir, isWin ? 'node.exe' : 'bin/node');
      const yarnJs = findYarnJs();
      if (!yarnJs) return resolve({ success: false, error: 'yarn not found — install yarn globally (npm i -g yarn)', output: '' });
      cmd = nodeExe;
      args = [yarnJs, 'install', '--network-timeout', '60000'];
      env = { ...baseEnv, PATH: (isWin ? nodeDir : path.join(nodeDir, 'bin')) + path.delimiter + baseEnv.PATH };
      useShell = false;
    } else {
      cmd = 'yarn';
      args = ['install', '--network-timeout', '60000'];
      env = baseEnv;
      useShell = isWin;
    }
    const child = spawn(cmd, args, { cwd: gameRepoPath, stdio: ['ignore', 'pipe', 'pipe'], shell: useShell, env });
    let output = '';
    const timer = setTimeout(() => { child.kill(); resolve({ success: false, error: 'yarn install timeout (5 min)', output }); }, 300000);
    child.stdout.on('data', d => { output += d.toString(); });
    child.stderr.on('data', d => { output += d.toString(); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ success: code === 0, output }); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ success: false, error: e.message, output }); });
  });
}

ipcMain.handle('yarn-install-game', async () => {
  if (!projectPath) return { error: 'No project open' };
  const settings = readJsonSafe(path.join(projectPath, 'settings.json'));
  if (!settings?.gameProjectPath) return { error: 'Game repo not configured' };
  const gameRepoPath = path.resolve(projectPath, settings.gameProjectPath);
  if (!fs.existsSync(gameRepoPath)) return { error: 'Game repo folder not found' };

  // Use cached Node version if available
  const cached = gameNodeCache[gameRepoPath];
  if (cached && cached !== 'system' && !cached.startsWith('_')) {
    const result = await runYarnInstall(gameRepoPath, cached);
    if (result.success) return { ...result, project: loadProject(projectPath) };
  }

  // Try system Node
  const result = await runYarnInstall(gameRepoPath, null);
  if (result.success) {
    if (!cached) gameNodeCache[gameRepoPath] = 'system';
    return { ...result, project: loadProject(projectPath) };
  }

  // Check for Node compat errors — try older versions via nvm
  const isCompatBug = /ERR_OSSL_EVP_UNSUPPORTED|digital envelope routines|error:0308010C|callback.*already called/.test(result.output || '');
  if (isCompatBug) {
    const sysNodeMajor = getSystemNodeMajor();
    const versions = findNvmNodeVersions();
    const fallbacks = versions.filter(v => {
      const major = parseInt(v.version.split('.')[0]);
      return major >= 16 && major < sysNodeMajor;
    });
    for (const fb of fallbacks) {
      const fbResult = await runYarnInstall(gameRepoPath, fb.dir);
      if (fbResult.success) {
        gameNodeCache[gameRepoPath] = fb.dir;
        nvmUse(fb.version);
        return { ...fbResult, output: `Used Node ${fb.version} (nvm use applied)\n` + fbResult.output, project: loadProject(projectPath), detectedNode: fb.version };
      }
    }
  }

  return { success: false, output: result.output, error: result.error || 'yarn install failed' };
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
      const playaEnv = getGameNodeEnv(gameRepoPath);
      delete playaEnv.NODE_OPTIONS;
      child = spawn(playaBin, args, {
        cwd: gameRepoPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: isWin,
        env: playaEnv
      });
    } else {
      const gameEnv = getGameNodeEnv(gameRepoPath);
      delete gameEnv.NODE_OPTIONS;
      const yarnJs = findYarnJs();
      if (yarnJs) {
        const nodeDir = gameNodeCache[gameRepoPath] && gameNodeCache[gameRepoPath] !== 'system' ? gameNodeCache[gameRepoPath] : null;
        const nodeExe = nodeDir ? path.join(nodeDir, isWin ? 'node.exe' : 'bin/node') : process.execPath;
        child = spawn(nodeExe, [yarnJs, scriptName], {
          cwd: gameRepoPath,
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false,
          env: gameEnv
        });
      } else {
        child = spawn('yarn', [scriptName], {
          cwd: gameRepoPath,
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: isWin,
          env: gameEnv
        });
      }
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

// Get actual system Node major version (not Electron's bundled one)
function getSystemNodeMajor() {
  try {
    const sv = execFileSync('node', ['-v'], { timeout: 5000 }).toString().trim();
    return parseInt(sv.replace('v', '').split('.')[0]);
  } catch { return 99; } // Can't detect system Node — try all nvm versions
}

// Detect required Node version from game repo's webpack version and cache + nvm use
// Returns { version, dir, msg } or null
function detectGameNode(gameRepoAbsPath) {
  if (gameNodeCache[gameRepoAbsPath]) return null; // already detected
  const gamePkg = readJsonSafe(path.join(gameRepoAbsPath, 'package.json'));
  const allDeps = { ...gamePkg?.dependencies, ...gamePkg?.devDependencies };
  const wpMajor = parseInt((allDeps?.webpack || '').replace(/^[^0-9]*/, '').split('.')[0]);
  if (!wpMajor) return null;
  if (wpMajor >= 5) return { msg: `webpack ${wpMajor} → system Node OK` };
  // webpack 4 or older — needs Node 16
  const versions = findNvmNodeVersions();
  const match = versions.find(v => parseInt(v.version.split('.')[0]) === 16);
  if (match) {
    gameNodeCache[gameRepoAbsPath] = match.dir;
    return { version: match.version, dir: match.dir, msg: `webpack ${wpMajor} → uses Node v${match.version} for builds` };
  }
  return { msg: `⚠ webpack ${wpMajor} needs Node 16 — not found in nvm. Run: nvm install 16` };
}

// Save the system Node version at app startup — restored on quit
let _originalNodeVersion = null;
try { _originalNodeVersion = execFileSync('node', ['-v'], { timeout: 3000 }).toString().trim().replace(/^v/, ''); } catch {}

function nvmUse(version) {
  if (!version) return;
  const nvmExe = process.env.NVM_HOME ? path.join(process.env.NVM_HOME, 'nvm.exe') : null;
  if (!nvmExe || !fs.existsSync(nvmExe)) return;
  try { execFileSync(nvmExe, ['use', version.replace(/^v/, '')], { timeout: 10000, stdio: 'ignore' }); } catch {}
}

function nvmRestore() {
  if (!_originalNodeVersion) return;
  nvmUse(_originalNodeVersion);
}

// Resolve Node binary for a game repo — checks .nvmrc, engines, nvm versions
// Returns path to node exe or null (use system default)
const gameNodeCache = {}; // gameRepoPath → nodeDir (cached per session)

function findNvmNodeVersions() {
  const nvmHome = process.env.NVM_HOME || process.env.NVM_DIR;
  if (!nvmHome || !fs.existsSync(nvmHome)) return [];
  try {
    return fs.readdirSync(nvmHome)
      .filter(d => /^v?\d+\.\d+/.test(d) && fs.existsSync(path.join(nvmHome, d, isWin ? 'node.exe' : 'bin/node')))
      .map(d => ({ version: d.replace(/^v/, ''), dir: path.join(nvmHome, d) }))
      .sort((a, b) => {
        const pa = a.version.split('.').map(Number), pb = b.version.split('.').map(Number);
        for (let i = 0; i < 3; i++) { if ((pa[i]||0) !== (pb[i]||0)) return (pb[i]||0) - (pa[i]||0); }
        return 0;
      });
  } catch { return []; }
}

function getGameNodeEnv(gameRepoPath) {
  // Check cache
  if (gameNodeCache[gameRepoPath]) {
    const dir = gameNodeCache[gameRepoPath];
    if (dir === 'system') return { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' };
    const nodeBin = isWin ? dir : path.join(dir, 'bin');
    return { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0', PATH: nodeBin + path.delimiter + process.env.PATH };
  }
  return { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' };
}

// Find yarn.js entry point — works across nvm versions
function findYarnJs() {
  const candidates = [
    // npm global
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'yarn', 'bin', 'yarn.js'),
    // Current nvm node's global
    path.join(path.dirname(process.execPath), 'node_modules', 'yarn', 'bin', 'yarn.js'),
  ];
  // Also check all nvm dirs
  const nvmHome = process.env.NVM_HOME || process.env.NVM_DIR;
  if (nvmHome) {
    try {
      for (const d of fs.readdirSync(nvmHome)) {
        candidates.push(path.join(nvmHome, d, 'node_modules', 'yarn', 'bin', 'yarn.js'));
      }
    } catch {}
  }
  return candidates.find(p => { try { return fs.existsSync(p); } catch { return false; } }) || null;
}

function runBuildDev(gameRepoPath, nodeDir, send) {
  return new Promise((resolve) => {
    const baseEnv = { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' };
    delete baseEnv.NODE_OPTIONS;
    let cmd, args, env;
    if (nodeDir) {
      // Use specific Node version: run node directly from nvm dir, execute yarn.js via it
      // This avoids yarn.cmd shim issues in nvm dirs that don't have yarn installed
      const nodeExe = path.join(nodeDir, isWin ? 'node.exe' : 'bin/node');
      const yarnJs = findYarnJs();
      if (!yarnJs) { return resolve({ success: false, error: 'yarn not found', output: '' }); }
      cmd = nodeExe;
      args = [yarnJs, 'build-dev'];
      env = { ...baseEnv, PATH: (isWin ? nodeDir : path.join(nodeDir, 'bin')) + path.delimiter + baseEnv.PATH };
    } else {
      cmd = 'yarn';
      args = ['build-dev'];
      env = baseEnv;
    }
    const child = spawn(cmd, args, {
      cwd: gameRepoPath, stdio: ['ignore', 'pipe', 'pipe'], shell: !nodeDir && isWin, env
    });
    buildProcess = child;
    let output = '';
    const timer = setTimeout(() => { child.kill(); buildProcess = null; resolve({ success: false, error: 'build-dev timeout (5 min)', output }); }, 300000);
    child.stdout.on('data', d => { const s = d.toString(); output += s; send(s); });
    child.stderr.on('data', d => { const s = d.toString(); output += s; send(s); });
    child.on('close', (code) => { clearTimeout(timer); buildProcess = null; resolve({ success: code === 0, output }); });
    child.on('error', (e) => { clearTimeout(timer); buildProcess = null; resolve({ success: false, error: e.message, output }); });
  });
}

// Build game repo (yarn build-dev) — auto-detects compatible Node version
ipcMain.handle('build-game', async () => {
  if (!projectPath) return { error: 'No project open' };
  if (buildProcess) return { error: 'A build is already running' };
  const settings = readJsonSafe(path.join(projectPath, 'settings.json'));
  if (!settings?.gameProjectPath) return { error: 'Game repo not configured' };
  const gameRepoPath = path.resolve(projectPath, settings.gameProjectPath);
  if (!fs.existsSync(gameRepoPath)) return { error: 'Game repo folder not found' };
  const gamePkg = readJsonSafe(path.join(gameRepoPath, 'package.json'));
  if (!gamePkg?.scripts?.['build-dev']) return { error: 'No build-dev script in game package.json' };
  const send = (line) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('script-output', line); };

  // If cached — verify and use
  if (gameNodeCache[gameRepoPath]) {
    const dir = gameNodeCache[gameRepoPath] === 'system' ? null : gameNodeCache[gameRepoPath];
    if (dir && !fs.existsSync(path.join(dir, isWin ? 'node.exe' : 'bin/node'))) {
      delete gameNodeCache[gameRepoPath]; // stale cache — Node version was uninstalled
    } else {
      return runBuildDev(gameRepoPath, dir, send);
    }
  }

  // Try with system Node silently (don't stream output — if it fails, user doesn't see noise)
  const silentSend = () => {};
  const result = await runBuildDev(gameRepoPath, null, silentSend);
  if (result.success) {
    gameNodeCache[gameRepoPath] = 'system';
    // Re-stream the successful output line-by-line so renderer filter works per-line
    for (const line of (result.output || '').split('\n')) send(line + '\n');
    return result;
  }

  // Check if failure is the known Node 22 + old webpack bug
  const isNodeCompatBug = /callback.*already called|ERR_OSSL_EVP_UNSUPPORTED|digital envelope routines::unsupported|error:0308010C/.test(result.output || '');
  if (!isNodeCompatBug) {
    for (const line of (result.output || '').split('\n')) send(line + '\n');
    return { ...result, error: result.error || 'build-dev failed' };
  }

  // Try older Node versions via nvm — stream output for these attempts
  const sysNodeMajor = getSystemNodeMajor();
  const versions = findNvmNodeVersions();
  const fallbacks = versions.filter(v => {
    const major = parseInt(v.version.split('.')[0]);
    return major >= 16 && major < sysNodeMajor;
  });

  let lastError = '';
  for (const fb of fallbacks) {
    send(`Trying Node ${fb.version}...\n`);
    const fbResult = await runBuildDev(gameRepoPath, fb.dir, send);
    if (fbResult.success) {
      gameNodeCache[gameRepoPath] = fb.dir;
      nvmUse(fb.version);
      send(`\n✔ Switched system Node to v${fb.version} (nvm use)\n`);
      return { ...fbResult, detectedNode: fb.version };
    }
    lastError = fbResult.error || '';
  }

  const tried = [`v${sysNodeMajor} (system)`, ...fallbacks.map(f => f.version)].join(', ');
  return { success: false, error: fallbacks.length === 0 ? 'build-dev failed — no compatible Node found via nvm' : `build-dev failed with Node ${tried}${lastError ? ': ' + lastError : ''}` };
});

// Stop everything — build process + game process + browser + port 8080
ipcMain.handle('stop-all', async () => {
  try {
    // Kill build process (npm run build, etc.)
    if (buildProcess && !buildProcess.killed) {
      const pid = buildProcess.pid;
      buildProcess = null;
      if (isWin && pid) { exec(`taskkill /F /T /PID ${pid}`, () => {}); }
      else { try { process.kill(pid, 'SIGTERM'); } catch {} }
    }
    // Kill game process (playa launch, etc.)
    if (gameProcess && !gameProcess.killed) {
      const pid = gameProcess.pid;
      gameProcess = null;
      if (isWin && pid) { exec(`taskkill /F /T /PID ${pid}`, () => {}); }
      else { try { process.kill(pid, 'SIGTERM'); } catch {} }
    }
    // Kill browser window
    if (gameBrowserProcess) {
      const bpid = gameBrowserProcess.pid;
      gameBrowserProcess = null;
      if (isWin && bpid) { exec(`taskkill /F /T /PID ${bpid}`, () => {}); }
      else if (bpid) { try { process.kill(bpid); } catch {} }
    }
    await killPort(8080);
    return { success: true };
  } catch (e) {
    return { error: e.message };
  }
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
    // Also close the browser window showing the game
    if (gameBrowserProcess) {
      const bpid = gameBrowserProcess.pid;
      gameBrowserProcess = null;
      if (isWin && bpid) {
        exec(`taskkill /T /PID ${bpid}`, () => {
          setTimeout(() => { exec(`taskkill /F /T /PID ${bpid}`, () => {}); }, 2000);
        });
      } else if (bpid) { try { process.kill(bpid); } catch {} }
    }
    await killPort(8080);
    return { success: true };
  } catch (e) {
    return { error: e.message };
  }
});

// Checkout a branch in game repo — fetch, switch, hard reset to origin
ipcMain.handle('checkout-game-branch', async (event, branchName) => {
  if (!projectPath) return { error: 'No project open' };
  if (!branchName || typeof branchName !== 'string') return { error: 'Invalid branch name' };
  if (!/^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/.test(branchName)) return { error: 'Invalid branch name characters' };
  const settings = readJsonSafe(path.join(projectPath, 'settings.json'));
  if (!settings?.gameProjectPath) return { error: 'Game repo not configured' };
  const gameRepoPath = path.resolve(projectPath, settings.gameProjectPath);
  if (!fs.existsSync(gameRepoPath)) return { error: 'Game repo folder not found' };
  const send = (d) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('script-output', d); };
  try {
    send(`Fetching origin...\n`);
    try { execFileSync('git', ['fetch', '--all', '--prune'], { cwd: gameRepoPath, timeout: 15000, stdio: 'ignore', env: gitSilentEnv }); }
    catch { send(`⚠ Fetch failed (offline?) — using cached refs\n`); }
    send(`Switching to ${branchName}...\n`);
    // Force checkout — discards local changes (reset --hard follows anyway)
    execFileSync('git', ['checkout', '-f', branchName], { cwd: gameRepoPath, timeout: 10000, stdio: 'ignore' });
    // Hard reset to origin — guarantees local matches remote exactly
    try {
      execFileSync('git', ['reset', '--hard', `origin/${branchName}`], { cwd: gameRepoPath, timeout: 15000, stdio: 'ignore' });
      send(`✔ Reset to origin/${branchName}\n`);
    } catch {
      // Branch might not have remote tracking (local-only) — try pull as fallback
      try {
        const pullOut = execFileSync('git', ['pull', 'origin', branchName], { cwd: gameRepoPath, timeout: 30000 }).toString();
        send(pullOut || `✔ Pulled ${branchName}\n`);
      } catch (pullErr) {
        send(`⚠ Pull failed: ${pullErr.message}\n`);
      }
    }
    // Clean untracked files left by branch switch
    try { execFileSync('git', ['clean', '-fd'], { cwd: gameRepoPath, timeout: 15000, stdio: 'ignore' }); } catch {}
    // Invalidate cached Node version — new branch may have different webpack version
    delete gameNodeCache[gameRepoPath];
    const currentBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: gameRepoPath, timeout: 5000 }).toString().trim();
    send(`✔ On branch ${currentBranch}\n`);
    return { success: true, branch: currentBranch, project: loadProject(projectPath) };
  } catch (e) {
    return { error: `Failed to checkout ${branchName}: ${e.message}` };
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

  // Pull on current branch — don't switch branches
  try {
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: gameRepoPath, timeout: 5000 }).toString().trim();
    send(`Pulling ${branch}...\n`);
    const child = spawn('git', ['pull', 'origin', branch], { cwd: gameRepoPath, shell: false });
    let output = '';
    child.stdout.on('data', d => { const s = d.toString(); output += s; send(s); });
    child.stderr.on('data', d => { const s = d.toString(); output += s; send(s); });
    return new Promise(resolve => {
      const timer = setTimeout(() => { child.kill(); resolve({ success: false, error: 'git pull timeout' }); }, 20000);
      child.on('close', code => { clearTimeout(timer); resolve({ success: code === 0, output, branch }); });
      child.on('error', e => { clearTimeout(timer); resolve({ success: false, error: e.message }); });
    });
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
    if (isWin && pid) {
      // Graceful close first (WM_CLOSE), then force kill after 2s if still alive
      exec(`taskkill /T /PID ${pid}`, () => {
        setTimeout(() => { exec(`taskkill /F /T /PID ${pid}`, () => {}); }, 2000);
      });
    } else { try { proc.kill(); } catch {} }
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
    const oldPid = gameBrowserProcess.pid;
    gameBrowserProcess = null;
    if (isWin && oldPid) {
      exec(`taskkill /F /T /PID ${oldPid}`, () => {});
    } else { try { process.kill(oldPid, 'SIGTERM'); } catch {} }
    await new Promise(r => setTimeout(r, 500));
  }

  // Isolated profile — wiped on every launch for clean game state (no stale localStorage/SW cache)
  const profileDir = path.join(app.getPath('temp'), 'slot-audio-glr');
  for (let attempt = 0; attempt < 3; attempt++) {
    try { if (fs.existsSync(profileDir)) fs.rmSync(profileDir, { recursive: true, force: true }); break; }
    catch { await new Promise(r => setTimeout(r, 500)); }
  }

  const child = spawn(browserPath, [
    '--new-window',
    '--no-first-run',
    '--no-default-browser-check',
    '--test-type',
    '--disable-web-security',
    '--allow-running-insecure-content',
    '--ignore-certificate-errors',
    '--hide-crash-restore-bubble',
    '--disable-session-crashed-bubble',
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
  const directExecuteHooks = new Set(); // hooks found via direct soundManager.execute() only
  const dynamicCalls = []; // files with dynamic execute calls we can't resolve statically
  const validHookRe = /^on[A-Z][a-zA-Z0-9_]*$/;

  // Pattern 1: direct string literal — soundManager.execute("hookName")
  const executeRe = /soundManager\.execute\(["'`]([^"'`]+)["'`]\)/g;
  // Pattern 2: dynamic variable — soundManager.execute(varName)
  const dynamicRe = /soundManager\.execute\(([^"'`)\s][^)]*)\)/g;

  // Phase 0: Scan framework node_modules (playa-core, playa-table) for built-in hook calls.
  // These call soundManager.execute() from compiled .js — game src/ doesn't reference them.
  const frameworkDirs = ['playa-core', 'playa-table', 'playa-slot'].map(
    pkg => path.join(gameRepoPath, 'node_modules', pkg, 'dist')
  ).filter(d => fs.existsSync(d));

  const walkJs = (dir, results = []) => {
    let entries;
    try { entries = fs.readdirSync(dir); } catch { return results; }
    for (const e of entries) {
      const full = path.join(dir, e);
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      if (stat.isDirectory()) walkJs(full, results);
      else if (stat.isFile() && e.endsWith('.js')) results.push(full);
    }
    return results;
  };

  for (const fwDir of frameworkDirs) {
    for (const file of walkJs(fwDir)) {
      let content;
      try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
      const stripped = content.replace(/\/\/.*$/gm, '');
      const rel = path.relative(gameRepoPath, file).replace(/\\/g, '/');
      let m;
      executeRe.lastIndex = 0;
      while ((m = executeRe.exec(stripped)) !== null) {
        const name = m[1];
        if (validHookRe.test(name)) {
          if (!hookMap[name]) hookMap[name] = new Set();
          hookMap[name].add(rel);
          directExecuteHooks.add(name);
        }
      }
    }
  }

  // Phase 1+2 combined: Single pass over game src files.
  // Collects: direct execute calls, dynamic call flags, const/var hook definitions.
  const constHookRe = /(?:export\s+)?(?:const|let|var)\s+(?:SFX_\w+|SOUND_\w+|soundID|soundId|soundName|hookName|hookId|sfxName)\s*(?::\s*string\s*)?=\s*["'`](on[A-Z][^"'`]*)["'`]/g;
  const switchAssignRe = /(?:soundID|soundId|soundName|hookName|hookId|sfxName|sfx)\s*=\s*["'`](on[A-Z][^"'`]*)["'`]/g;
  const globalHookDefs = {}; // hookValue → Set of files that define it

  for (const file of files) {
    let content;
    try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
    // Strip single-line comments to avoid matching commented-out code
    const stripped = content.replace(/\/\/.*$/gm, '');
    const rel = path.relative(gameRepoPath, file).replace(/\\/g, '/');

    let m;
    // Direct string literal calls
    executeRe.lastIndex = 0;
    while ((m = executeRe.exec(stripped)) !== null) {
      const name = m[1];
      if (!hookMap[name]) hookMap[name] = new Set();
      hookMap[name].add(rel);
      directExecuteHooks.add(name);
    }

    // Dynamic calls — flag as unresolvable
    dynamicRe.lastIndex = 0;
    if (dynamicRe.test(stripped)) {
      dynamicCalls.push(rel);
    }

    // Pattern 3: any string literal that looks like a hook name — covers framework wrapper methods
    // (showBonusPlaqueCommand, hideBonusPlaqueCommand, etc. that internally call soundManager.execute)
    const hookStringRe = /["'`](on[A-Z][a-zA-Z0-9_]*)["'`]/g;
    hookStringRe.lastIndex = 0;
    while ((m = hookStringRe.exec(stripped)) !== null) {
      const name = m[1];
      if (validHookRe.test(name)) {
        if (!hookMap[name]) hookMap[name] = new Set();
        hookMap[name].add(rel);
      }
    }

    // Exported/const hook definitions (cross-file resolution)
    constHookRe.lastIndex = 0;
    while ((m = constHookRe.exec(stripped)) !== null) {
      const name = m[1];
      if (!globalHookDefs[name]) globalHookDefs[name] = new Set();
      globalHookDefs[name].add(rel);
    }
    // Switch/case variable assignments
    switchAssignRe.lastIndex = 0;
    while ((m = switchAssignRe.exec(stripped)) !== null) {
      const name = m[1];
      if (!globalHookDefs[name]) globalHookDefs[name] = new Set();
      globalHookDefs[name].add(rel);
    }
  }

  // Phase 3: Merge global hook defs into hookMap (cross-file resolution)
  // Only include clean hook names (no template literal fragments like ${var})
  for (const [name, defFiles] of Object.entries(globalHookDefs)) {
    if (!validHookRe.test(name)) continue;
    if (!hookMap[name]) hookMap[name] = new Set();
    for (const f of defFiles) hookMap[name].add(f);
  }

  // Load current sounds.json commands
  const soundsJson = readJsonSafe(path.join(projectPath, 'sounds.json'));
  const commands = soundsJson?.soundDefinitions?.commands || {};

  // Phase 4: Dynamic hook expansion — match dead commands to dynamic patterns
  // Covers: template literals `onX${var}` and string concatenation "onX" + var
  const templatePatterns = []; // { regex, file }
  const templateLiteralRe = /soundManager\.execute\(`([^`]*\$\{[^`]*)`\)/g;
  // String concat: soundManager.execute(SFX_CONST + var) where SFX_CONST = "onSomething"
  // We already have globalHookDefs with values like "onSymbolWin" — if game concatenates, the base is a prefix
  const allFilesToScan = [...files];
  for (const fwDir of frameworkDirs) { allFilesToScan.push(...walkJs(fwDir)); }
  for (const file of allFilesToScan) {
    let content;
    try { content = fs.readFileSync(file, 'utf8').replace(/\/\/.*$/gm, ''); } catch { continue; }
    const rel = path.relative(gameRepoPath, file).replace(/\\/g, '/');
    let m;
    // Template literals: `onX${var}Y`
    templateLiteralRe.lastIndex = 0;
    while ((m = templateLiteralRe.exec(content)) !== null) {
      const pattern = m[1].replace(/\$\{[^}]*\}/g, '.+');
      try { templatePatterns.push({ re: new RegExp('^' + pattern + '$'), file: rel }); } catch {}
    }
  }
  // String concatenation: SFX_CONST + variable → base prefix from globalHookDefs
  // e.g. SFX_ON_SYMBOL_WIN = "onSymbolWin" used as SFX_ON_SYMBOL_WIN + name → onSymbolWin.+
  for (const hookBase of Object.keys(globalHookDefs)) {
    if (validHookRe.test(hookBase)) {
      templatePatterns.push({ re: new RegExp('^' + hookBase + '.+$'), file: [...globalHookDefs[hookBase]][0] + ' (concat)' });
    }
  }
  // For each command NOT in hookMap, check if any template pattern matches
  for (const cmdName of Object.keys(commands)) {
    if (hookMap[cmdName]) continue;
    for (const { re, file } of templatePatterns) {
      if (re.test(cmdName)) {
        if (!hookMap[cmdName]) hookMap[cmdName] = new Set();
        hookMap[cmdName].add(file);
        break;
      }
    }
  }

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
    const hookDefLine = /(?:soundID|soundId|soundName|hookName|hookId|sfxName|sfx|SFX_\w+|SOUND_\w+)\s*=\s*["'`](on[A-Z][^"'`]*)["'`]/;
    for (const line of gitLog.split('\n')) {
      if (line.startsWith('COMMIT_LINE|')) {
        const parts = line.split('|');
        currentCommit = {
          timestamp: parseInt(parts[1], 10) * 1000,
          relative: parts[2],
          message: parts.slice(3).join('|'),
        };
      } else if (line.startsWith('+') && !line.startsWith('+++') && currentCommit) {
        const m = executeReLine.exec(line) || hookDefLine.exec(line);
        if (m) {
          const hookName = m[1];
          if (hookName && validHookRe.test(hookName)) {
            if (!recentlyAdded[hookName] || currentCommit.timestamp > recentlyAdded[hookName].timestamp) {
              recentlyAdded[hookName] = currentCommit;
            }
          }
        }
      }
    }
  } catch {}

  // Filter out prefix strings that aren't real hooks:
  // A hook is a prefix if a longer hook starts with it (e.g. "onBonus" is prefix of "onBonusGameStart")
  // AND the short name is NOT directly used in soundManager.execute() calls
  const allHookNames = Object.keys(hookMap);
  for (const name of allHookNames) {
    if (directExecuteHooks.has(name)) continue; // directly executed — keep
    if (commands[name]) continue; // already in sounds.json — keep (user defined it)
    const isPrefix = allHookNames.some(other => other !== name && other.startsWith(name) && other.length > name.length);
    if (isPrefix) delete hookMap[name];
  }

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

    const filePath = path.join(projectPath, 'sounds.json');
    const prev = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
    const next = JSON.stringify(soundsJson, null, 2);
    fs.writeFileSync(filePath, next);
    if (prev !== null) pushUndo(filePath, prev, next);

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
  const cwd = projectPath; // capture — projectPath can change if user opens another project mid-install
  const hasYarnLock = fs.existsSync(path.join(cwd, 'yarn.lock'));
  const send = (d) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('script-output', d); };
  const env = { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' };
  delete env.NODE_OPTIONS;

  let cmd, args, useShell;
  if (hasYarnLock) {
    const yarnJs = findYarnJs();
    if (yarnJs) {
      cmd = process.execPath;
      args = [yarnJs, 'install', '--network-timeout', '60000'];
      useShell = false;
    } else {
      cmd = 'yarn';
      args = ['install', '--network-timeout', '60000'];
      useShell = isWin;
    }
  } else {
    cmd = 'npm';
    args = ['install', '--legacy-peer-deps'];
    useShell = isWin;
  }

  return new Promise((resolve) => {
    let output = '';
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: useShell, env });
    const timer = setTimeout(() => { child.kill(); resolve({ success: false, error: 'Install timeout (4 min)', output }); }, 240000);
    child.stdout.on('data', d => { const s = d.toString(); output += s; send(s); });
    child.stderr.on('data', d => { const s = d.toString(); output += s; send(s); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ success: code === 0, output, project: code === 0 ? loadProject(cwd) : null });
    });
    child.on('error', (e) => { clearTimeout(timer); resolve({ success: false, output: output || e.message, error: e.message }); });
  });
});

// Measure pool: run audiosprite on a tier's sounds in temp dir to get actual M4A size
// Standalone mode: builds each sound as a separate M4A (matching buildTiered.js) and sums sizes
ipcMain.handle('measure-pool', async (event, { tierName, sounds, encoding: enc, isStandalone }) => {
  if (!projectPath) return { error: 'No project open' };
  const settings = readJsonSafe(path.join(projectPath, 'settings.json'));
  const srcDir = path.resolve(projectPath, settings?.SourceSoundDirectory || './sourceSoundFiles');
  if (!fs.existsSync(srcDir)) return { error: 'sourceSoundFiles not found' };

  const files = [];
  for (const s of sounds) {
    const base = path.basename(s);
    const f = path.join(srcDir, base + '.wav');
    if (!f.startsWith(srcDir + path.sep)) continue;
    if (fs.existsSync(f)) files.push(f);
  }
  if (files.length === 0) return { sizeKB: 0, sounds: 0 };

  const customAS = path.join(projectPath, 'scripts', 'customAudioSprite.js');
  if (!fs.existsSync(customAS)) return { error: 'Run Sync Template first' };
  if (!fs.existsSync(path.join(projectPath, 'node_modules'))) return { error: 'Run npm install first' };

  const os = require('os');
  const crypto = require('crypto');
  const tmpDir = path.join(os.tmpdir(), 'sam-measure-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(tmpDir, { recursive: true });

  const e = enc || { bitrate: 64, channels: 1, samplerate: 44100 };
  const sc = readJsonSafe(path.join(projectPath, 'sprite-config.json'));
  // Standalone uses gap=0 (each sound = separate file), sprite tiers use spriteGap
  const gap = isStandalone ? 0 : (sc?.spriteGap ?? 0.05);

  const bitrateVal = e.keepOriginal ? 320 : (e.bitrate || 64);
  const channelsLine = !e.keepOriginal ? `opts.channels=${e.channels||1};opts.samplerate=${e.samplerate||44100};` : '';

  const scriptPath = path.join(tmpDir, 'measure.js');

  if (isStandalone) {
    // Build each sound as a separate M4A (matches buildTiered.js standalone behavior)
    const builds = files.map((f, i) => ({ file: f.replace(/\\/g, '/'), outBase: path.join(tmpDir, 'm_' + i).replace(/\\/g, '/') }));
    fs.writeFileSync(scriptPath, `
const as = require(${JSON.stringify(customAS.replace(/\\/g, '/'))});
const ff = require('ffmpeg-static');
const fs = require('fs');
const builds = ${JSON.stringify(builds)};
function buildOne(b) {
  return new Promise((res, rej) => {
    const opts = { output: b.outBase, format: 'howler2', export: 'm4a',
      bitrate: ${bitrateVal}, gap: 0, silence: 0,
      logger: { debug:()=>{}, info:()=>{}, log:()=>{} } };
    ${channelsLine}
    as(ff, [b.file], opts, 0, (err) => { if(err) rej(err); else res(); });
  });
}
Promise.all(builds.map(buildOne)).then(() => {
  let total = 0;
  for (const b of builds) {
    try { total += fs.statSync(b.outBase + '.m4a').size; } catch {}
  }
  process.stdout.write(String(Math.round(total / 1024)));
}).catch(err => { process.stderr.write(String(err.message||err)); process.exit(1); });
`);
  } else {
    // Sprite tier: one audiosprite from all sounds
    const outBase = path.join(tmpDir, 'measure').replace(/\\/g, '/');
    fs.writeFileSync(scriptPath, `
const as = require(${JSON.stringify(customAS.replace(/\\/g, '/'))});
const ff = require('ffmpeg-static');
const fs = require('fs');
const opts = { output: ${JSON.stringify(outBase)}, format: 'howler2', export: 'm4a',
  bitrate: ${bitrateVal}, gap: ${gap}, silence: 0,
  logger: { debug:()=>{}, info:()=>{}, log:()=>{} } };
${channelsLine}
as(ff, ${JSON.stringify(files.map(f => f.replace(/\\/g, '/')))}, opts, 0, (err) => {
  if(err){process.stderr.write(String(err.message||err));process.exit(1);}
  try{process.stdout.write(String(Math.round(fs.statSync(${JSON.stringify(outBase)}+'.m4a').size/1024)));}
  catch{process.stderr.write('M4A not created');process.exit(1);}
});
`);
  }

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
