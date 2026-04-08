# SlotAudioManager

## Jezik / Language
**UVEK** komuniciraj sa korisnikom na **srpskom jeziku sa ekavicom** (ne ijekavica). Bez izuzetka — čak i ako korisnik piše na engleskom.

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
src/App.jsx          — sidebar nav (7 pages), always-mounted pages (display:none), toast system
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
| `pull-game-json` | renderer→main | Copy sounds.json from game repo deploy path to audio repo root |
| `build-game` | renderer→main | Run `yarn build-dev` in game repo (300s timeout, streams output) |
| `yarn-install-game` | renderer→main | Run `yarn install` in game repo (300s timeout) |
| `kill-game` | renderer→main | Kill spawned game dev server process |
| `analyze-orphans` | renderer→main | Find orphan WAVs not referenced in sounds.json |
| `clean-orphans` | renderer→main | Delete orphan WAVs and clean sounds.json references |
| `scan-game-hooks` | renderer→main | Scan game repo TS source for soundManager.execute() calls |
| `run-deploy` | renderer→main | Execute deploy script (120s timeout) |
| `git-status` | renderer→main | Returns porcelain status, branch, last 10 commits |
| `git-commit-push` | renderer→main | git add -A → commit -m → push (execFileSync, no shell) |
| `health-check` | renderer→main | Validate project structure (configs, scripts, deps, dirs) |
| `init-from-template` | renderer→main | Overwrite scripts/configs/deps from template. Accepts `{ skipConfigs }` option |
| `npm-install` | renderer→main | Run `npm install --legacy-peer-deps` (240s timeout) |
| `pick-game-repo` | renderer→main | Directory picker for game repo |
| `configure-game` | renderer→main | Link game repo: relative path, update pkg name/desc |
| `get-game-scripts` | renderer→main | Read launch/start scripts from game repo package.json |
| `run-game-script` | renderer→main | Spawn game dev server detached (playa launch — infinite process) |
| `clean-dist` | renderer→main | Remove .m4a files + sounds.json from dist/ (try-catch, safe) |
| `list-glr` | renderer→main | List GLR subdirs in game/GLR/, extract softwareId from launch script |
| `launch-local-glr` | renderer→main | Spawn `playa launch --glr [name]` detached — no VPN needed |
| `git-pull-game` | renderer→main | git pull in game repo, streams output via script-output event |
| `open-url` | renderer→main | shell.openExternal — validates http/https only |
| `open-folder` | renderer→main | shell.openPath — relative path within project only (no traversal) |
| `wait-for-port` | renderer→main | Poll TCP port until available (1500ms interval) |
| `list-deleted-sounds` | renderer→main | List WAVs in sourceSoundFiles/.deleted/ |
| `restore-sound` | renderer→main | Move WAV from .deleted/ back to sourceSoundFiles/ |
| `script-output` | main→renderer | IPC **event** (not invoke) — live streaming of subprocess stdout/stderr |

## Pages — Props & API Calls

| Page | Props | API Calls |
|------|-------|-----------|
| ProjectPage | `project, onOpen, onReload, showToast` | None (display only) |
| SetupPage | `project, setProject, showToast` | `healthCheck`, `initFromTemplate(opts?)`, `npmInstall`, `pickGameRepo`, `configureGame`, `yarnInstallGame` |
| SoundsPage | `project, setProject, showToast` | `importSounds`, `deleteSound`, `listDeletedSounds`, `restoreSound` — WAV list, import dialog, trash/restore |
| SpriteConfigPage | `project, showToast` | `saveSpriteConfig` — tier editor, auto-assign unassigned sounds, subLoaderId/unloadable flags |
| CommandsPage | `project, setProject, showToast` | `saveSoundsJson` — reads `project.soundsJson`, edits commands/spriteList/soundSprites in-memory |
| BuildPage | `project, setProject, reloadProject, showToast` | `runScript`, `runDeploy`, `cleanDist`, `getGameScripts`, `runGameScript`, `buildGame`, `pullGameJson`, `listGlr`, `launchLocalGlr`, `gitPullGame`, `killGame`, `waitForPort`, `openUrl`, `scanGameHooks`, `analyzeOrphans`, `cleanOrphans` |
| GitPage | `project, showToast` | `gitStatus`, `gitCommitPush` — branch, changed files (NEW/ADD/MOD/DEL/REN badges), commit msg input, commit+push, last 10 commits log |

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
    "loading": { "maxSizeKB": 700,  "priority": 1, "sounds": [...], "description": "Minimum for first spin" },
    "main":    { "maxSizeKB": 3000, "priority": 2, "subLoaderId": "A", "unloadable": false, "sounds": [...] },
    "bonus":   { "maxSizeKB": 3000, "priority": 3, "subLoaderId": "B", "unloadable": true,  "sounds": [...] }
  },
  "standalone": { "sounds": ["BaseMusicLoop", "BonusMusicLoop"] },
  "encoding": {
    "sfx":   { "bitrate": 64, "channels": 2, "samplerate": 44100 },
    "vo":    { "bitrate": 64, "channels": 2, "samplerate": 44100 },
    "music": { "bitrate": 64, "channels": 2, "samplerate": 44100 }
  },
  "musicTags": ["Music"], "sfxTags": ["SoundEffects"]
}
```
- `subLoaderId`: playa-core SubLoader ID (`"A"`-`"F"` = deferred, `"Z"` = lazy). Omit for main-load tiers.
- `unloadable`: if true, `buildTieredJSON.js` adds `"unloadable": true` to soundManifest entries (signal for playa-core team to implement runtime unload after bonus ends).
- `maxSizeKB`: warning only — logged as `⚠️ OVER LIMIT`, does NOT fail the build.

**sounds.json:**
```json
{
  "soundManifest": [
    { "id": "loading_sprite", "src": ["soundFiles/loading.m4a"] },
    { "id": "main_sprite",   "src": ["soundFiles/main.m4a"],   "loadType": "A" },
    { "id": "bonus_sprite",  "src": ["soundFiles/bonus.m4a"],  "loadType": "B", "unloadable": true }
  ],
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
| `validateBuild.js` | QA: 5 checks — (1) M4A exist+sizes vs maxSizeKB (tier matched by `endsWith`), (2) command→spriteId/spriteListId refs, (3) spriteList→sprite refs, (4) soundSprite→manifest refs, (5) orphan sprites. JSON.parse wrapped in try-catch. |
| `customAudioSprite.js` | Modified audiosprite with custom encoding/bitrate |
| `copyAudio.js` | Deploy: copies sprites + sounds.json to game repo sounds/ folder. Cleans both .json and .json5 before copy (no `else if`). |
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
2. Overwrite sprite-config.json, sounds.json from template (skipped if `{ skipConfigs: true }`)
3. Merge package.json: overwrite scripts + deps from template
4. Update settings.json: overwrite with template defaults (includes `DestinationSoundDirectory`, `DestinationAudioSpriteDirectory`), **preserve gameProjectPath**
5. Create sourceSoundFiles/ if missing
6. If game repo configured: auto-pull sounds.json from game repo deploy path → overwrites template sounds.json

### Configure Game
1. Guard: reject if `gameRepoPath === projectPath` (self-reference)
2. Derive audio slug from audio repo folder name
3. Set `settings.json → gameProjectPath` = `path.relative(audioRepo, gameRepo)`
4. Set `package.json → name` = audioSlug, `description` = "Audio for {gameRepoName}"
5. Verify game repo has assets/ folder
6. Returns `gameNodeModulesExists` flag for yarn install UI

### Audio Build Pipeline (buildTiered.js + buildTieredJSON.js)
1. `buildTiered.js` — reads sprite-config.json, groups WAVs by tier, runs parallel FFmpeg builds
   - SHA256 hash cache → incremental build (only rebuilt changed sounds)
   - Outputs: `dist/soundFiles/[tier].m4a` + `dist/soundData_[tier].json`
   - If tier build fails, that tier's hashes are NOT saved (forces rebuild next time)
   - Size warning: logs `⚠️ OVER LIMIT` if `.m4a > maxSizeKB`, sets no exit code
2. `buildTieredJSON.js` — reads soundData_*.json, generates `dist/sounds.json`
   - Adds `loadType` field for tiers with `subLoaderId` (playa-core SubLoader)
   - Adds `unloadable: true` for tiers with `unloadable: true`
   - Preserves spriteList entries (both array and `{items, type, overlap}` formats)
   - Empty commands are kept (not auto-deleted) — user must manually delete
   - JSON.parse wrapped in try-catch for corrupted soundData files
   - Creates output directory if missing before writeFileSync
   - Sorts soundManifest: loading → main → bonus → standalone

### playa-core SubLoader System
- `sounds.json → soundManifest → loadType` field controls loading behavior:
  - `undefined` or `"-"` → loaded with main bundle at game start
  - `"A"` through `"F"` → deferred SubLoader (loaded on demand)
  - `"Z"` → lazy load
- **Game developer must call**:
  - `startSubLoader("A")` on first spin — loads main pool (symbols, bigwin, anticipation)
  - `startSubLoader("B")` when bonus is **confirmed** (3+ scatters evaluated, not on single scatter land) — loads bonus pool (free spins, hold & win, picker, bonus music)
  - `unloadSubLoader("B")` when bonus ends and player returns to base game — frees bonus audio from RAM
- **Trigger timing**: Scatter landing on a reel is NOT the trigger. The trigger is when the spin result is evaluated and the game confirms bonus entry (e.g., 3+ scatters). This happens in `BonusTriggerCommand` or equivalent, AFTER reel evaluation, not in reel land handlers. The bonus intro animation (2-3 seconds) buys time for SubLoader B to complete loading.
- **Runtime unload**: playa-core SoundLoader/SoundPlayer does not yet have `unloadHowl()` — `unloadable: true` is a metadata signal for the playa-core team
- **Queue**: only one SubLoader loads at a time. If A and B are triggered simultaneously (scatter on first spin), B waits in queue until A completes
- **Standalone vs sprite for music**: Base game music (loops for hours) MUST be standalone (separate M4A, clean Howler loop). Bonus music (loops for 30s-3min bonus sessions) CAN go in bonus sprite — Howler loops sprite segments with acceptable micro-gap for short sessions.
- Reference: `/c/IGT/playa-core/src/ts/sound/SoundLoader.ts` and `SubLoader.ts`

### GLR Local Launch (no VPN)
- `playa launch --glr [name]` serves the game using pre-recorded RGS responses
- GLR dir: `{gameRepo}/GLR/` — each subdir is one recorded session
- Common GLRs: `GLR` (full), `bonus`, `bigWin`, `wins`, `bonusNoWin`
- Auto git-pull before every local launch
- If git pull fails (no network), proceeds with local version (non-blocking)
- softwareId extracted from game's `package.json → scripts.launch` via regex

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
- **Always-mounted pages**: App.jsx renders ALL pages simultaneously, hidden via `display:none`. Active page shown by removing `hidden` class. Pages are NEVER unmounted during navigation — state persists across page switches.
- Use `structuredClone()` for deep state updates (NOT `{...spread}` — causes stale nested refs)
- Every page resets state on `project?.path` change via `useEffect`
- Every page has `if (!project)` early return guard (except ProjectPage which shows welcome)
- All async handlers wrapped in try-catch with toast error feedback
- Boolean flags (`running`, `pushing`, `installing`, etc.) prevent concurrent operations
- `useRef` for toast timer cleanup (prevents stale closures)
- **ALL hooks (useState, useEffect, useMemo, useCallback, useRef) MUST be declared BEFORE any early return** — React Rules of Hooks. Variables derived from props (e.g. `const commands = project?.soundsJson?...|| {}`) can go before the early return too, with `|| {}` fallback so they work when project is null.
- `useEffect` with `[project?.path]` deps: guard API calls with `if (project)` — pages are mounted even when project is null
- `script-output` listener in BuildPage is always active (mounted) — log accumulates even when page is hidden, visible on return

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
- **Dependencies:** ALL packages in `devDependencies` — electron-builder excludes devDeps from asar. `dependencies: {}` is empty to prevent bloating the production build.

## Dev Commands
- `npm run dev` — Vite dev server + Electron (concurrent, waits for :5173)
- `npm run build-renderer` — Vite production build → dist-renderer/
- `npm run build-mac` — build-renderer + electron-builder --mac
- `npm run build-win` — build-renderer + electron-builder --win
- `npm run build-all` — build-renderer + electron-builder --win --mac

## SoundsPage WAV Decoder
`decodeWav()` in `SoundsPage.jsx` — custom pure-JS WAV decoder, **never calls `ctx.decodeAudioData()`**.
- Reason: `decodeAudioData` crashes the Electron renderer process for 24-bit and 32-bit int PCM
- Scans RIFF chunks properly (no hardcoded offsets) — handles JUNK/LIST chunks before `fmt`
- Supported formats: PCM 8-bit, 16-bit (Int16Array fast path), 24-bit (manual), 32-bit int, IEEE float 32-bit (Float32Array fast path)
- Unsupported format → throws descriptive error → caught by `handlePlay` → toast shown (no crash)
- `AudioContext.close()` is always called with `.catch(() => {})` — prevent unhandled rejection renderer crash

## SpriteConfigPage — Auto-Assign Logic
`autoAssign()` funkcija — priority-ordered PATTERNS, first match wins:
Patterns are priority-ordered (first match wins), derived from analysis of all IGT audio repos:
- **standalone**: `BaseGameMusicLoop*`, `AmbBg` — ONLY base game music
- **loading**: `Ui*`, `UI_*`, `ReelLand*`, `SpinsLoop*`, `SpinningReels`, `Payline`, `RollupLow*`, `CoinLoop*`, `CoinCounter`, `Bell`, `TotalWin`, `IntroAnim*`, `GameIntro*`, `Tutorial*`, `PanelAppears`, `OptionsRoll`
- **bonus**: `BonusGameMusic*`, `FreeSpinMusic*`, `PickerMusicLoop`, `MultiplierMusicLoop`, `RespinLoop*`, `WheelBonusMusicLoop`, `Bonus*`, `Picker*`, `FreeSpin*`, `HoldAnd*`, `Respin*`, `BaseToBonusStart*`, `TrnBaseToBonus`, `BonusToBase*`, `SymScatter*`, `SymbolFreeSpins*`, `Trigger*`, `Wheel*`, `Jackpot*`, `Progressive*`, `Gem*`, `Pot*`, `Lamp*`, `Genie*`, `Ignite*`, `VO*`, `BonusBuy*`, plus game-specific bonus patterns
- **main** (fallback): `BigWin*`, `CoinShower*`, `Anticipation*`, `PreCog`, `ScreenShake`, `Sym*`, `Wild*`, `Win\d*`, `Rollup*`, everything else
**Redosled prioriteta:** Tags iz soundsJson (Music tag → standalone) → pattern match → fallback (main)
**Pool arhitektura (4 poola):**
- `loading` — minimum za prvi spin: UI, reel land, payline, rollup, spins loop, coin counter (~200-700KB, immediate, no loadType)
- `main` — base game: symbols, big win, anticipation, rollups, wild land, screen effects (~1-3MB, deferred "A", `startSubLoader("A")` na prvom spinu)
- `bonus` — svi bonus modovi + bonus muzika: free spins, hold & win, picker, tranzicije, FreeSpinMusic, PickerMusicLoop (~1-3MB, deferred "B", `startSubLoader("B")` kad bonus bude POTVRĐEN — 3+ scattera evaluirana, ne na scatter land. unloadable — `unloadSubLoader("B")` na kraju bonusa)
- `standalone` — SAMO base game muzika koja svira od prvog frejma i loopuje se satima. Svaki zvuk = zaseban M4A = Howler `loop: true`. Bonus muzika NE ide ovde — ide u bonus pool.
**Zašto standalone samo za base muziku:** Sprite je jedan fajl sa zalepljenim zvucima — muzika koja loopuje satima mora biti zaseban fajl za čist loop bez mikro-pauze. Bonus muzika loopuje 30s-3min (kratka sesija) — prihvatljiv kvalitet iz sprajta.
**Ključna pravila:**
- `BaseToBonusStart` i `BonusToBaseStart` → bonus (tranzicije su deo bonus konteksta)
- `SymbolB01Land1...5`, `SymbolB01Anticipation` → main (base game kontekst)
- `PreBonusLoop` → main (svira pre ulaska u bonus, dok je igra još u base)
- `SpinsLoop`, `CoinLoop`, `CoinLoopEnd` → loading (rollup/reel zvuci, potrebni od prvog spina)
- `FreeSpinMusic`, `PickerMusicLoop` → bonus (NE standalone — učitava se sa bonus poolom)
- `BaseGameMusicLoop1/2/3`, `AmbBg` → standalone (jedine prave base game muzike)
- Fallback tier je `main` (ili poslednji tier u listi ako `main` ne postoji)
- Bonus zvuci uključuju SVE bonus modove (free spins + hold & win) u jednom sprajtu + bonus muziku

## Known Pending Issues
- playa-core tim treba da implementira `SoundPlayer.unloadHowl()` za runtime unload bonus audio-a
- Game developer mora za svaku igru dodati 3 linije: `startSubLoader("A")` na prvom spinu, `startSubLoader("B")` na scatter-u, `unloadSubLoader("B")` na kraju bonusa
- SpriteConfigPage generiše snippet sa Copy dugmetom za svaki deferred pool — developer samo kopira

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
- Use `decodeAudioData` in SoundsPage — it crashes the renderer for certain WAV formats
- Place hooks after conditional early returns — React Rules of Hooks violation ("Rendered more hooks than during previous render")
- Use `new Float32Array(arrayBuffer, offset)` when offset may not be 4-byte aligned — use `arrayBuffer.slice(offset)` instead
- Remove empty commands from sounds.json automatically — user must manually delete via Commands page
- Unmount/remount pages on navigation — all pages are always-mounted with `display:none`
- Put `electron`, `electron-builder`, `react`, `react-dom` in `dependencies` — they belong in `devDependencies`
- **NIKAD ručno menjati fajlove u game repou** (src/ts/, assets/, dist/, package.json) — SVE promene u game repou moraju ići ISKLJUČIVO kroz aplikaciju ili kroz skripte koje aplikacija pokreće. Ako nešto treba da se promeni u igri, napravi to u skripti (npr. deployStreaming.js) pa neka skripta sama uradi promenu. Nikad `sed`, `echo >`, `node -e` direktno na game repo fajlovima.
- **NIKAD menjati fajlove u audio ili game repoima (c:\IGT\*) bez eksplicitnog odobrenja korisnika** — SVE promene idu ISKLJUČIVO kroz template skripte u SlotAudioManager app-u. Korisnik sam sinhronizuje template u repo kroz Init from Template. Ako treba nešto kopirati ili menjati u repou, PITAJ korisnika prvo.
- **NIKAD git commit/push bez eksplicitne komande korisnika** — Ne komituj automatski, ne komituj posle implementacije, ne komituj posle QA. Čekaj da korisnik kaže "komit" ili "komit i push". Bez izuzetka.

## QA Review Roles

When performing QA or analysis, apply ALL of these expert perspectives in sequence:

### 1. Electron Security Auditor
Aktivira se: svaki novi IPC handler, svaka promena preload.js
- Sve IPC inpute validirati pre file/process operacija (`path.basename`, regex, `.wav` check)
- Path traversal: `filePath.startsWith(sourceDir + path.sep)` na svakom file handler-u
- Shell injection: `execFileSync` uvek niz argumenata (ne string), script name regex `/^[a-zA-Z0-9_-]+$/`
- `contextIsolation: true`, `nodeIntegration: false` — nikad menjati
- `shell: true` samo za `.cmd` fajlove na Windows-u, nikad sa `execFileSync`
- Timeout na svakom subprocess pozivu — bez toga može visiti zauvek
- `open-url` handler: validira samo `http://` i `https://` URL-ove

### 2. Audio Pipeline Engineer
Aktivira se: buildTiered.js, buildTieredJSON.js, sprite-config.json, WAV decoder
- SHA256 cache: failed tier ne sme da čuva hash (forces rebuild)
- Paralelni FFmpeg buildovi — race condition na dist/ output direktorijum
- `loadType` generisanje: tačno mapiranje `subLoaderId` → `soundManifest`
- WAV decoder: **nikad `decodeAudioData`** — crashuje renderer za 24-bit/32-bit PCM
- RIFF chunk scanning: ne sme da pretpostavlja fiksne offsets (JUNK/LIST pre `fmt`)
- Over-limit: samo log upozorenje, nikad exit code koji bi srušio build ili CI

### 3. IGT Framework Specialist
Aktivira se: sounds.json schema, SubLoader integracija, GLR, deploy
- `loadType: "A"/"B"` → playa-core SubLoader.ts (deferred), `"Z"` → lazy
- Deploy target: `{gameRepo}/assets/default/default/default/sounds/`
- GLR format: `authenticate.json, initstate.json, play.N.json` — ne kontaktira server
- `playa launch --glr [name] --softwareid [id] --port 8080`
- `softwareId` se čita iz `package.json → scripts.launch` regex-om
- `unloadable: true` = metadata signal za playa-core tim, runtime unload nije implementiran
- SubLoader redosled: main="A" na prvom spinu, bonus="B" na scatter-u, unload "B" na kraju bonusa
- Queue: samo jedan SubLoader se učitava istovremeno — FIFO redosled

### 4. React State Manager
Aktivira se: svaka nova stranica, novi useState, useEffect, async handler
- `structuredClone()` za duboke state update-ove — nikad `{...spread}` za nested objekte
- Reset svih state-ova na `project?.path` promenu — nema stale podataka iz prethodnog projekta
- Boolean flag za svaku async operaciju — sprečava dupli klik (`running`, `cleaning`, itd.)
- `useRef` za AudioContext i timer cleanup — nikad direktno u render funkciji
- Stream handler: `prev => prev + line` (apend) — nikad `setLog(line)` (zamena)
- `offScriptOutput` cleanup u `return` funkciji useEffect — sprečava memory leak i dupli listener
- **SVAKI hook mora biti PRE early return** — proveriti svaki novi page: svi `useState/useEffect/useMemo/useCallback/useRef` moraju biti pre `if (!project) return`
- Promenljive izvedene iz props-a (npr. `const commands = project?.foo || {}`) mogu ići pre early return sa `|| {}` fallback-om

### 5. Cross-Platform Engineer
Aktivira se: path operacije, spawn/exec, window chrome, file URL-ovi
- `path.join/resolve/sep` svuda — nikad hardkodovani `/` ili `\`
- `spawn` sa `shell: true` samo za `.cmd` fajlove na Windows-u
- `titleBarStyle: hiddenInset` Mac, `titleBarOverlay` Windows
- `pathToFileURL(filePath).toString()` za `file://` URL-ove (Windows kompatibilnost)
- `/[/\\]/` regex za split putanja u UI display-u

### 6. UX / Build Feedback Designer
Aktivira se: novi UI element, novi log output, nova greška
- Svaka async akcija: `disabled` dok traje, loading indikator vidljiv
- Live build log: `script-output` IPC event + auto-scroll na dnu
- Greška: uvek toast sa konkretnom porukom, nikad tih fail
- git pull fail → upozorenje u logu + nastavak (ne blokira launch)
- Over-limit → `⚠️ OVER LIMIT` u logu, build prolazi

### 7. Apple-Style UI/UX Designer
Aktivira se: svaki novi UI element, svaka nova stranica, svaka vizuelna promena
Filozofija: manje je više. Svaki element mora da postoji sa razlogom. Ako nema razloga — ne postoji.

**Vizuelni jezik:**
- Tamna tema: `#08080d` pozadina, `#7c6aef` akcent (purple), subtilni border `/20` do `/40` opacity
- Tipografija: sistem font stack, `text-sm` (14px) za body, `text-xs` (12px) za meta/badge, `font-mono` za kod i putanje
- Razmak: `space-y-4` između sekcija, `gap-3` između inline elemenata, `p-5` za kartice
- Boje informacija: cyan = aktivno/live, green = uspeh/no-vpn, orange = lokalno/upozorenje, danger = greška, purple = sekundarno
- Opacity za disabled: `opacity-40` + `cursor-not-allowed` — nikad `display: none`

**Komponente:**
- `.card` — sve grupe sadržaja; `.card-glow` samo za primarni akcent element
- `.badge` — mali labeli; uvek `text-xs`, nikad lowercase sa caps, uvek konkretna boja
- `.btn-primary` — jedna primarna akcija po sekciji; `.btn-ghost` za sekundarne
- `.section-label` — naslov grupe unutar kartice, uvek uppercase + tracked
- `.anim-pulse-dot` — inline dot animacija za live stanja (build running, server loading)
- `.anim-fade-up` — page transition na svakom mount-u

**Interakcija:**
- Hover state na svakom klikabilnom elementu (`hover:border-border-bright`, `hover:text-text-secondary`)
- Focus visible za keyboard navigation
- Cursor: `cursor-pointer` na buttons, `cursor-wait` na loading, `cursor-not-allowed` na disabled
- Nikad skočni modali za potvrdu — inline warning text ili disabled state umesto toga
- Greške se prikazuju inline (crveni tekst) ili toast — nikad alert()

**Gustina informacija:**
- Jedna sekcija = jedan zadatak; ne mešati build i deploy u istu karticu
- Putanje: `font-mono text-xs text-text-dim truncate` — uvek skraćene sa CSS, ne JS-om
- Dugmad: kratki labeli ("Run", "Deploy", "Launch") — ne "Click here to run script"
- Status badge pored naslova sekcije — odmah vidljivo bez skrolovanja
- Log output: `max-h-96 overflow-auto` — nikad full-screen log koji gura ostatak UI-a

**Što NE raditi (Apple princip):**
- Nikad dve primarne akcije iste težine u istom redu
- Nikad ikonografija bez labela (Electron app, ne mobile)
- Nikad border-radius > 12px za kartice (nije igračka, profesionalni alat)
- Nikad animacija duža od 200ms za UI tranzicije
- Nikad više od 3 boje u jednoj sekciji
- Nikad placeholder tekst koji opisuje šta polje radi — koristiti label

### Edge Case Hunter
- File deleted between readdir and stat (race condition) — handled via try-catch in reduce
- JSON parse failure — readJsonSafe returns null
- No project open — every IPC handler and page checks first
- Empty commit message — validated before git commit
- Concurrent button clicks — boolean flags prevent overlap
- Settings overwrite — gameProjectPath preserved during template init
- `loadProject()` initializes `gameRepoExists: false`, `gameNodeModulesExists: false` — never undefined
- `clean-orphans`: guards `soundsJson.soundDefinitions` before assignment (null → `{}`)
- `open-url`: try-catch around `shell.openExternal` — OS errors don't crash IPC
- `wait-for-port`: checks `mainWindow.isDestroyed()` — stops polling if window closes
- `git-pull-game`: tries `release` > `develop` > `master` branch — works for all IGT repos
- `git-status`: git log wrapped in separate try-catch — works for empty repos
- `get-game-scripts`: filters by VALUE (`/^playa\s/.test(v)`) not just key name — catches dev01/dev02/dev03
- `configure-game`: rejects `gameRepoPath === projectPath` (self-reference guard)
- `validateBuild.js`: tier matching uses `endsWith('_' + tierName)` not `includes()` — no false matches
