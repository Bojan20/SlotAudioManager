const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFileSync, exec } = require('child_process');

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

let mainWindow;
let projectPath = null;

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

  if (process.env.NODE_ENV !== 'production' && !app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist-renderer', 'index.html'));
  }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// Safe JSON reader
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
  const data = { path: dirPath, sounds: [], settings: null, spriteConfig: null, soundsJson: null, scripts: {} };

  data.settings = readJsonSafe(path.join(dirPath, 'settings.json'));
  data.spriteConfig = readJsonSafe(path.join(dirPath, 'sprite-config.json'));
  data.soundsJson = readJsonSafe(path.join(dirPath, 'sounds.json'));

  // Resolve gameProjectPath to absolute for UI display
  if (data.settings?.gameProjectPath) {
    data.gameRepoAbsPath = path.resolve(dirPath, data.settings.gameProjectPath);
  }

  // Detect available npm scripts
  const pkg = readJsonSafe(path.join(dirPath, 'package.json'));
  if (pkg && pkg.scripts) {
    data.scripts = pkg.scripts;
  }

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

ipcMain.handle('save-sounds-json', async (event, data) => {
  if (!projectPath) return { error: 'No project open' };
  try {
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
  // Only allow alphanumeric, hyphens, underscores in script name
  if (!/^[a-zA-Z0-9_-]+$/.test(scriptName)) return { error: 'Invalid script name' };
  const useYarn = fs.existsSync(path.join(projectPath, 'yarn.lock'));
  const cmd = useYarn ? `yarn ${scriptName}` : `npm run ${scriptName}`;
  return new Promise((resolve) => {
    exec(cmd, { cwd: projectPath, timeout: 300000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ success: !err, output: stdout + '\n' + stderr, error: err ? err.message : null });
    });
  });
});

ipcMain.handle('run-deploy', async (event, scriptName) => {
  if (!projectPath) return { error: 'No project open' };
  const name = scriptName || 'deploy';
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return { error: 'Invalid script name' };
  const useYarn = fs.existsSync(path.join(projectPath, 'yarn.lock'));
  const cmd = useYarn ? `yarn ${name}` : `npm run ${name}`;
  return new Promise((resolve) => {
    exec(cmd, { cwd: projectPath, timeout: 120000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ success: !err, output: stdout + '\n' + stderr, error: err ? err.message : null });
    });
  });
});

ipcMain.handle('git-status', async () => {
  if (!projectPath) return { error: 'No project open' };
  try {
    const opts = { cwd: projectPath, encoding: 'utf8', timeout: 10000 };
    const status = execFileSync('git', ['status', '--porcelain'], opts);
    const branch = execFileSync('git', ['branch', '--show-current'], opts).trim();
    const log = execFileSync('git', ['log', '--oneline', '-10'], opts);
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

ipcMain.handle('delete-sound', async (event, filename) => {
  if (!projectPath) return { error: 'No project open' };
  if (!filename || typeof filename !== 'string') return { error: 'Invalid filename' };
  const safe = path.basename(filename);
  if (!safe || !safe.endsWith('.wav')) return { error: 'Invalid filename' };
  const sourceDir = path.join(projectPath, 'sourceSoundFiles');
  const filePath = path.join(sourceDir, safe);
  if (!filePath.startsWith(sourceDir + path.sep)) return { error: 'Invalid path' };
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return { success: true, project: loadProject(projectPath) };
  }
  return { error: 'File not found' };
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
ipcMain.handle('init-from-template', async () => {
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

    // 2. Config files — always overwrite
    for (const f of ['sprite-config.json', 'sounds.json']) {
      const src = path.join(tplPath, f);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(projectPath, f));
        log.push(`Overwritten ${f}`);
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
        SourceSoundDirectory: './sourceSoundFiles'
      }, null, 4));
      log.push('Created settings.json');
    }

    // 5. sourceSoundFiles/
    const srcDir = path.join(projectPath, 'sourceSoundFiles');
    if (!fs.existsSync(srcDir)) { fs.mkdirSync(srcDir, { recursive: true }); log.push('Created sourceSoundFiles/'); }

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
    .filter(([k]) => /launch/i.test(k) || k === 'start' || k === 'deploy-lde')
    .map(([k, v]) => ({ name: k, cmd: v }));
  return { scripts, gameRepoPath };
});

// Run a script in the game repo
ipcMain.handle('run-game-script', async (event, scriptName) => {
  if (!projectPath) return { error: 'No project open' };
  if (!scriptName || typeof scriptName !== 'string') return { error: 'Invalid script name' };
  if (!/^[a-zA-Z0-9_-]+$/.test(scriptName)) return { error: 'Invalid script name' };
  const settings = readJsonSafe(path.join(projectPath, 'settings.json'));
  if (!settings?.gameProjectPath) return { error: 'Game repo not configured' };
  const gameRepoPath = path.resolve(projectPath, settings.gameProjectPath);
  if (!fs.existsSync(gameRepoPath)) return { error: 'Game repo folder not found' };
  const useYarn = fs.existsSync(path.join(gameRepoPath, 'yarn.lock'));
  const cmd = useYarn ? `yarn ${scriptName}` : `npm run ${scriptName}`;
  return new Promise((resolve) => {
    exec(cmd, { cwd: gameRepoPath, timeout: 300000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ success: !err, output: stdout + '\n' + stderr, error: err ? err.message : null });
    });
  });
});

// npm/yarn install — auto-detects package manager from yarn.lock
ipcMain.handle('npm-install', async () => {
  if (!projectPath) return { error: 'No project open' };
  const useYarn = fs.existsSync(path.join(projectPath, 'yarn.lock'));
  const cmd = useYarn ? 'yarn install' : 'npm install --legacy-peer-deps';
  return new Promise((resolve) => {
    exec(cmd, { cwd: projectPath, timeout: 240000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        success: !err,
        output: stdout + '\n' + stderr,
        error: err ? err.message : null,
        project: !err ? loadProject(projectPath) : null
      });
    });
  });
});
