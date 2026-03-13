# SlotAudioManager

Cross-platform Electron desktop app for IGT slot game audio workflow management.
Build, configure, deploy, and validate audio sprites for slot games.

## Stack
- **Electron 28** — main process (`main.js`), preload (`preload.js`)
- **React 19** + **Tailwind CSS v4** + **Vite 8** — renderer (`src/`)
- CommonJS in main/preload, ESM in renderer
- No TypeScript — pure JSX

## Architecture

```
main.js              — ALL IPC handlers, file ops, git, npm, template logic
preload.js           — contextBridge.exposeInMainWorld('api', {...})
src/App.jsx          — sidebar nav (7 pages), page routing, toast system
src/pages/           — ProjectPage, SetupPage, SoundsPage, SpriteConfigPage,
                       CommandsPage, BuildPage, GitPage
src/index.css        — dark theme, custom properties, component classes, animations
src/main.jsx         — React entry point
template/            — bundled template (scripts, configs) — app is source of truth
index.html           — Vite entry
vite.config.js       — output to dist-renderer/, port 5173 strict
```

## IPC Channels (main.js ↔ preload.js)

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `open-project` | renderer→main | Dialog to pick project folder, returns loaded project data |
| `reload-project` | renderer→main | Reload current project from disk |
| `save-sprite-config` | renderer→main | Write sprite-config.json |
| `save-sounds-json` | renderer→main | Write sounds.json |
| `save-settings` | renderer→main | Write settings.json |
| `import-sounds` | renderer→main | Multi-select WAV dialog, copies to sourceSoundFiles/ |
| `delete-sound` | renderer→main | Delete WAV from sourceSoundFiles/ (path traversal protected) |
| `run-script` | renderer→main | Execute npm script (name validated, 300s timeout) |
| `run-deploy` | renderer→main | Execute deploy script (120s timeout) |
| `git-status` | renderer→main | Returns porcelain status, branch, last 10 commits |
| `git-commit-push` | renderer→main | git add -A → commit -m → push (execFileSync, no shell) |
| `health-check` | renderer→main | Validate project structure (configs, scripts, deps, dirs) |
| `init-from-template` | renderer→main | Overwrite scripts/configs/deps from built-in template |
| `npm-install` | renderer→main | Run `npm install --legacy-peer-deps` (240s timeout) |
| `pick-game-repo` | renderer→main | Directory picker for game repo |
| `configure-game` | renderer→main | Link game repo: relative path, update pkg name/desc |

## Pages — Props & API Calls

| Page | Props | API Calls |
|------|-------|-----------|
| ProjectPage | `project, onOpen, onReload, showToast` | None (display only) |
| SetupPage | `project, setProject, showToast` | `healthCheck`, `initFromTemplate`, `npmInstall`, `pickGameRepo`, `configureGame` |
| SoundsPage | `project, setProject, showToast` | `importSounds`, `deleteSound` |
| SpriteConfigPage | `project, showToast` | `saveSpriteConfig` |
| CommandsPage | `project, showToast` | None (reads from project.soundsJson) |
| BuildPage | `project, showToast` | `runScript`, `runDeploy` |
| GitPage | `project, showToast` | `gitStatus`, `gitCommitPush` |

## Project JSON Schemas

**settings.json:**
```json
{
  "gameProjectPath": "../relative/path/to/game-repo",
  "JSONtemplate": "./sounds.json",
  "JSONtarget": "./dist/sounds.json",
  "SourceSoundDirectory": "./sourceSoundFiles",
  "DestinationSoundDirectory": "./dist",
  "DestinationAudioSpriteDirectory": "./dist/soundFiles"
}
```

**sprite-config.json:**
```json
{
  "spriteGap": 0.05,
  "sprites": {
    "tierName": { "maxSizeKB": 1500, "priority": 1, "sounds": [], "sortOrder": [], "description": "" }
  },
  "standalone": { "sounds": ["MusicLoop1"] },
  "encoding": {
    "sfx": { "bitrate": 64, "channels": 1, "samplerate": 44100 },
    "music": { "bitrate": 96, "channels": 2, "samplerate": 44100 }
  }
}
```

**sounds.json:**
```json
{
  "soundManifest": [{ "id": "spriteFileId", "src": ["soundFiles/sprite.m4a"] }],
  "soundDefinitions": {
    "soundSprites": { "s_Name": { "soundId": "", "spriteId": "", "startTime": 0, "duration": 0, "tags": [], "overlap": false } },
    "commands": { "cmdName": [{ "command": "play", "spriteId": "", "volume": 1.0, "delay": 0 }] },
    "spriteList": { "listName": ["spriteId1", "spriteId2"] }
  }
}
```

## Template Scripts (template/scripts/)

| Script | Purpose |
|--------|---------|
| `buildTiered.js` | Main build: groups sounds by tier from sprite-config, creates M4A sprites |
| `buildTieredJSON.js` | Generates sounds.json from sprite metadata (uses exiftool for durations) |
| `validateBuild.js` | QA: sprite sizes, reference integrity, orphan detection, boot <500KB |
| `customAudioSprite.js` | Modified audiosprite with custom encoding/bitrate |
| `copyAudio.js` | Deploy: copies sprites + sounds.json to game repo sounds/ folder |
| `convertAudio.js` | Single audio conversion (ffmpeg wrapper) |
| `createAudioSprite.js` | Single sprite creation |
| `createAudioSpritesBySize.js` | Size-based sprite grouping |
| `createmultipleAudioSprites.js` | Creates multiple sprites from all sounds |
| `makeMyJSON.js` | Simple single-sprite JSON generation |
| `makeMyJSONMultipleSounds.js` | Multi-sprite JSON generation |
| `makeMyJSONSizedSprites.js` | Size-based sprite JSON generation |

## Template Project Dependencies
- `node-exiftool` — audio metadata (duration extraction)
- `sox` — audio processing
- `audiosprite` — sprite file creation
- `ffmpeg-static` — bundled FFmpeg binary

## Health Check Validates
- 4 config files: package.json, settings.json, sounds.json, sprite-config.json
- scripts/ directory + 12 core scripts
- sourceSoundFiles/ directory
- node_modules/ directory
- 3 npm scripts: build, build-validate, deploy
- 4 dependencies: node-exiftool, sox, audiosprite, ffmpeg-static

## Key Flows

### Init from Template
1. Overwrite all scripts from template/scripts/ → project/scripts/
2. Overwrite sprite-config.json, sounds.json from template
3. Merge package.json: overwrite scripts + deps from template
4. Update settings.json: overwrite with template defaults, **preserve gameProjectPath**
5. Create sourceSoundFiles/ if missing

### Configure Game
1. Derive audio slug from audio repo folder name
2. Set `settings.json → gameProjectPath` = `path.relative(audioRepo, gameRepo)`
3. Set `package.json → name` = audioSlug, `description` = "Audio for {gameRepoName}"
4. Verify game repo has assets/ folder

### Deploy Target
`{gameRepo}/assets/default/default/default/sounds/`

## Cross-Platform Rules
- MUST work on macOS AND Windows
- `titleBarStyle`: `hiddenInset` on Mac, `hidden` + `titleBarOverlay` on Windows
- `exec()` for npm commands (uses shell by default — works on both platforms)
- `execFileSync` for git commands (array args, prevents shell injection)
- Never use `env -u` or other unix-only shell commands
- Always use `path.join()`, `path.sep`, `path.resolve()` — never hardcode separators
- `gameName` split uses `/[/\\]/` regex for cross-platform path display
- `-webkit-app-region: drag` works in Electron on both platforms (Chromium feature)
- Custom scrollbar styles (Chromium/WebKit, works on both)

## Security
- `contextIsolation: true`, `nodeIntegration: false` — no Node in renderer
- Script names validated: `/^[a-zA-Z0-9_-]+$/` (prevents shell injection via npm run)
- `path.basename()` + `.wav` check + `startsWith(sourceDir + path.sep)` for file operations
- `execFileSync` with array args for git (no shell parsing)
- `exec()` with `timeout` and `maxBuffer: 5MB` for all subprocess calls
- API exposed only via `contextBridge` — renderer cannot access Node directly

## State Management Rules
- Use `structuredClone()` for deep state updates (NOT `{...spread}` — causes stale nested refs)
- Every page resets state on `project?.path` change via `useEffect`
- Every page has `if (!project)` early return guard (except ProjectPage which shows welcome)
- All async handlers wrapped in try-catch with toast error feedback
- Boolean flags (`running`, `pushing`, `installing`, etc.) prevent concurrent operations
- `useRef` for toast timer cleanup (prevents stale closures)

## CSS Theme System
- Dark theme: `#08080d` primary bg, `#7c6aef` accent (purple)
- Color tokens: cyan, purple, green, orange + dim variants (rgba 15% opacity)
- Component classes: `.card`, `.card-glow`, `.badge`, `.input-base`, `.btn-primary`, `.btn-ghost`, `.section-label`
- Disabled states: `.btn-primary:disabled`, `.btn-ghost:disabled` with opacity + cursor
- Animations: `.anim-fade-up` (page transitions), `.anim-fade-in`, `.anim-pulse-dot` (loading)
- `.drag-region` for window dragging, interactive elements have `no-drag`

## Electron Builder
- **macOS:** DMG target, icon at `assets/icon.icns`
- **Windows:** NSIS installer, icon at `assets/icon.ico`
- **Output:** `release/` directory
- **Bundled files:** main.js, preload.js, dist-renderer/**, template/**

## Dev Commands
- `npm run dev` — Vite dev server + Electron (concurrent, waits for :5173)
- `npm run build-renderer` — Vite production build → dist-renderer/
- `npm run build-mac` — build-renderer + electron-builder --mac
- `npm run build-win` — build-renderer + electron-builder --win
- `npm run build-all` — build-renderer + electron-builder --win --mac

## Do NOT
- Add TypeScript
- Add unnecessary abstractions, utilities, or wrapper functions
- Change IPC channel names (renderer depends on them)
- Use `shell: true` with `execFileSync`
- Import Node modules in renderer code
- Use shallow spread `{...obj}` for nested state — always `structuredClone()`
- Use unix-only commands in scripts or package.json
- Add docstrings/comments to code that wasn't changed
- Create new files unless absolutely necessary

## QA Review Roles

When performing QA or analysis, apply these expert perspectives:

### Security Auditor
- Verify all IPC inputs are validated before file/process operations
- Check for path traversal, shell injection, prototype pollution
- Ensure no Node APIs leak to renderer
- Validate timeout and maxBuffer on all subprocess calls
- Check that contextIsolation is true and nodeIntegration is false

### UX Reviewer
- Every async action must show loading state and disable repeated clicks
- All errors must surface via toast with actionable message
- State must reset cleanly on project switch (no stale data from previous project)
- Disabled buttons must be visually distinct (opacity, cursor)
- Search/filter must be case-insensitive

### Performance Analyst
- No synchronous file I/O in renderer process
- Subprocess calls must have timeouts (no hang states)
- maxBuffer prevents stdout overflow crashes
- useMemo for derived data that depends on large objects
- Auto-scroll logs with useRef (not re-render based)

### Cross-Platform Tester
- All path operations use path.join/resolve/sep
- No platform-specific shell commands in scripts
- Window chrome adapts to macOS vs Windows
- exec() vs execFileSync usage is intentional (shell vs no-shell)
- Test: folder picker, file import, git operations, npm install

### Edge Case Hunter
- File deleted between readdir and stat (race condition) — handled via try-catch in reduce
- JSON parse failure — readJsonSafe returns null
- No project open — every IPC handler and page checks first
- Empty commit message — validated before git commit
- Concurrent button clicks — boolean flags prevent overlap
- Settings overwrite — gameProjectPath preserved during template init
