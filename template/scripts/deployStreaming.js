#!/usr/bin/env node

/**
 * deployStreaming.js — Full SFX build + Direct HTML5 streaming music
 *
 * PIPELINE:
 * 1. Move streaming WAVs out of sourceSoundFiles/ temporarily
 * 2. Run createAudioSpritesBySize.js (SFX sprites only)
 * 3. Run makeMyJSONSizedSprites.js audioSprite (sounds.json for SFX)
 * 4. Restore streaming WAVs
 * 5. Encode streaming WAVs as individual M4A (ffmpeg, music bitrate)
 * 6. Add streaming entries to dist/sounds.json with loadType "M"
 * 7. Generate dist/BGMStreamingInit.ts (DIRECT HTML5 — no SubLoader, no swap)
 * 8. Copy BGMStreamingInit.ts to game repo + patch main.ts
 *
 * ARCHITECTURE:
 * loadType "M" → playa-core resolves URL but does NOT load (deferred to SubLoader M)
 * BGMStreamingInit reads resolved URL from player._soundUrl (set during manifest processing)
 * Creates HTML5 Howl DIRECTLY — never touches Web Audio, never decodes into RAM
 * Registers via addHowl() — playa-core commands work normally
 *
 * RESULT:
 * ~3 MB RAM per track from the start (vs ~40 MB with Web Audio decode)
 * No double loading, no swap, no peak memory spike, no state transfer bugs
 */

const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

// ═══════════════════════════════════════════════════════════════════════════════
// 1. READ CONFIGS
// ═══════════════════════════════════════════════════════════════════════════════

let settings, spriteConfig, templateSoundsJson;

try { settings = JSON.parse(fs.readFileSync('settings.json', 'utf8')); }
catch (e) { console.error('❌ settings.json:', e.message); process.exit(1); }

try { spriteConfig = JSON.parse(fs.readFileSync('sprite-config.json', 'utf8')); }
catch (e) { console.error('❌ sprite-config.json:', e.message); process.exit(1); }

const gameProjectPath = settings.gameProjectPath;
if (!gameProjectPath) { console.error('❌ gameProjectPath not set'); process.exit(1); }
const gameRepoAbs = path.resolve(gameProjectPath);

const streamingSounds = spriteConfig.streaming?.sounds || [];
const autoPlaySounds = new Set(spriteConfig.streaming?.autoPlay || []);
const sourceDir = settings.SourceSoundDirectory || './sourceSoundFiles';
const encoding = spriteConfig.encoding || {};
const musicEnc = encoding.music || {};

console.log('\n══════════════════════════════════════════════════');
console.log('  deployStreaming.js — Full Build + Direct HTML5');
console.log('════════════════════════════════════════════════���═\n');

if (streamingSounds.length === 0) {
    console.log('ℹ️  No streaming sounds. Running standard SFX build only.\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2-4. MOVE STREAMING WAVs → BUILD SFX → RESTORE
// ═══════════════════════════════════════════════════════════════════════════════

const tempDir = path.join('.', '.streaming_temp');
const movedFiles = [];

if (streamingSounds.length > 0) {
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    console.log('── Step 1: Separating streaming WAVs ──');
    for (const name of streamingSounds) {
        const src = path.join(sourceDir, name + '.wav');
        const dst = path.join(tempDir, name + '.wav');
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, dst);
            fs.unlinkSync(src);
            movedFiles.push(name);
        }
    }
    console.log('  Moved ' + movedFiles.length + ' WAVs\n');
}

function restoreWavs() {
    for (const name of movedFiles) {
        const src = path.join(tempDir, name + '.wav');
        const dst = path.join(sourceDir, name + '.wav');
        if (fs.existsSync(src)) { fs.copyFileSync(src, dst); fs.unlinkSync(src); }
    }
    try { if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) { /* */ }
}
process.on('exit', restoreWavs);
process.on('SIGINT', () => { restoreWavs(); process.exit(1); });
process.on('uncaughtException', (err) => { restoreWavs(); console.error(err); process.exit(1); });

console.log('── Step 2: Building SFX sprites ──');
try {
    execSync('node scripts/createAudioSpritesBySize.js', { stdio: 'inherit', timeout: 300000, maxBuffer: 5 * 1024 * 1024 });
} catch (e) { console.error('❌ SFX build failed'); process.exit(1); }

console.log('\n── Step 3: Generating sounds.json ──');
try {
    execSync('node scripts/makeMyJSONSizedSprites.js audioSprite', { stdio: 'inherit', timeout: 300000, maxBuffer: 5 * 1024 * 1024 });
} catch (e) { console.error('❌ JSON generation failed'); process.exit(1); }

if (movedFiles.length > 0) {
    console.log('\n── Step 4: Restoring streaming WAVs ──');
    process.removeAllListeners('exit');
    restoreWavs();
    console.log('  Restored ' + movedFiles.length + ' WAVs');
}

if (streamingSounds.length === 0) {
    console.log('\n✅ SFX build complete (no streaming sounds).');
    process.exit(0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. ENCODE STREAMING WAVs AS INDIVIDUAL M4A
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n── Step 5: Encoding streaming M4A ──');

const pathToFFmpeg = require('ffmpeg-static');
const outDir = path.join('.', 'dist', 'soundFiles');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const bitrate = musicEnc.bitrate || 64;
const channels = musicEnc.channels || 2;
const samplerate = musicEnc.samplerate || 44100;
const sox = require('sox');

function getWavDurationMs(wavPath) {
    return new Promise((resolve) => {
        sox.identify(wavPath, (err, results) => {
            if (err || !results) { resolve(0); return; }
            resolve(Math.round(results.sampleCount * 100000 / results.sampleRate) / 100);
        });
    });
}

async function buildStreamingTracks() {
    const tracks = [];
    for (const name of streamingSounds) {
        const wavPath = path.join(sourceDir, name + '.wav');
        if (!fs.existsSync(wavPath)) { console.log('  ⚠ ' + name + '.wav not found'); continue; }

        const m4aName = name + '.m4a';
        const m4aPath = path.join(outDir, m4aName);
        const durationMs = await getWavDurationMs(wavPath);

        try {
            execFileSync(pathToFFmpeg, [
                '-y', '-i', wavPath,
                '-c:a', 'aac', '-b:a', bitrate + 'k',
                '-ac', String(channels), '-ar', String(samplerate),
                '-movflags', '+faststart',
                m4aPath
            ], { timeout: 60000, maxBuffer: 5 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });

            const sizeKB = Math.round(fs.statSync(m4aPath).size / 1024);
            console.log('  ✓ ' + name + ' (' + sizeKB + 'KB, ' + (durationMs / 1000).toFixed(1) + 's)');
            tracks.push({ name, m4aName, durationMs, sizeKB });
        } catch (e) {
            console.error('  ❌ ' + name + ': ' + e.message);
        }
    }
    return tracks;
}

async function main() {
    const streamingTracks = await buildStreamingTracks();
    if (streamingTracks.length === 0) {
        console.log('\n✅ SFX build complete (no streaming tracks encoded).');
        process.exit(0);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 6. UPDATE dist/sounds.json — streaming entries with loadType "M"
    // ═══════════════════════════════════════════════════════════════════════════

    console.log('\n── Step 6: Updating sounds.json ──');

    const distSoundsPath = path.join('.', 'dist', 'sounds.json');
    let soundsJson;
    try { soundsJson = JSON.parse(fs.readFileSync(distSoundsPath, 'utf8')); }
    catch (e) { console.error('❌ dist/sounds.json not found'); process.exit(1); }

    try { templateSoundsJson = JSON.parse(fs.readFileSync(settings.JSONtemplate || 'sounds.json', 'utf8')); }
    catch (e) { templateSoundsJson = { soundDefinitions: { soundSprites: {}, commands: {} } }; }
    const templateSprites = templateSoundsJson.soundDefinitions?.soundSprites || {};

    if (!soundsJson.soundManifest) soundsJson.soundManifest = [];
    if (!soundsJson.soundDefinitions) soundsJson.soundDefinitions = {};
    if (!soundsJson.soundDefinitions.soundSprites) soundsJson.soundDefinitions.soundSprites = {};

    for (const track of streamingTracks) {
        const spriteKey = 's_' + track.name;
        const orig = templateSprites[spriteKey] || {};

        // loadType "M" — playa-core resolves URL but does NOT load
        // BGMStreamingInit reads URL from player._soundUrl and creates HTML5 Howl directly
        soundsJson.soundManifest.push({
            id: track.name,
            src: ['soundFiles/' + track.m4aName],
            loadType: 'M'
        });

        soundsJson.soundDefinitions.soundSprites[spriteKey] = {
            soundId: track.name,
            spriteId: track.name,
            startTime: 0,
            duration: track.durationMs,
            tags: orig.tags || ['Music'],
            overlap: orig.overlap !== undefined ? orig.overlap : false
        };

        console.log('  + ' + track.name + ' → loadType "M" (direct HTML5, no SubLoader)');
    }

    fs.writeFileSync(distSoundsPath, JSON.stringify(soundsJson, null, 2), 'utf8');

    // ═══════════════════════════════════════════════════════════════════════════
    // 7. GENERATE BGMStreamingInit.ts — DIRECT HTML5, NO SUBLOADER, NO SWAP
    // ═══════════════════════════════════════════════════════════════════════════

    console.log('\n── Step 7: Generating BGMStreamingInit.ts ──');

    // Extract auto-play configs from command definitions
    const allCommands = soundsJson.soundDefinitions?.commands || templateSoundsJson.soundDefinitions?.commands || {};
    const autoPlayConfigs = [];

    for (const track of streamingTracks) {
        if (!autoPlaySounds.has(track.name)) continue;
        const spriteId = 's_' + track.name;
        let playVolume = 0, fadeVolume = 0.7, playLoop = -1, fadeIn = 1500;

        for (const [, steps] of Object.entries(allCommands)) {
            const arr = Array.isArray(steps) ? steps : [steps];
            for (const step of arr) {
                if (!step || step.spriteId !== spriteId) continue;
                const cmd = (step.command || '').toLowerCase();
                if (cmd === 'play' && playVolume === 0) {
                    playVolume = step.volume !== undefined ? step.volume : 0;
                    playLoop = step.loop !== undefined ? step.loop : -1;
                }
                if (cmd === 'fade' && step.volume > 0) {
                    fadeVolume = step.volume;
                    if (step.duration) fadeIn = step.duration;
                }
            }
        }
        autoPlayConfigs.push({ spriteId, volume: playVolume, fadeVolume, loop: playLoop, fadeIn });
    }

    const musicNamesJson = JSON.stringify(streamingTracks.map(t => t.name));
    const autoPlayJson = JSON.stringify(autoPlayConfigs);

    const generatedTs = `/**
 * BGMStreamingInit.ts — Auto-generated by deployStreaming.js
 *
 * DIRECT HTML5 AUDIO — no SubLoader, no Web Audio decode, no swap.
 *
 * How it works:
 * 1. Music entries in sounds.json have loadType "M"
 * 2. playa-core resolves URLs for ALL manifest entries during process() — including "M"
 * 3. playa-core does NOT load "M" entries (deferred to SubLoader that never triggers)
 * 4. This module reads the resolved URL from player._soundUrl
 * 5. Creates HTML5 Howl directly — browser streams from disk, ~3 MB RAM per track
 * 6. Registers via addHowl() — playa-core commands work normally
 *
 * No Web Audio decode ever happens for music. No swap. No state transfer.
 * Commands (play, stop, fade, mute) work through SoundSprite as usual.
 */

import { soundManager } from "playa-core";
import { Howl } from "howler";

const MUSIC: string[] = ${musicNamesJson};

const TAG = "[BGM]";
function log(...a: unknown[]): void { console.log(TAG, ...a); }
function warn(...a: unknown[]): void { console.warn(TAG, ...a); }

// ─── URL Resolution ──────────────────────────────────────────────────────────

/**
 * Get resolved URL for a sound ID from player._soundUrl.
 *
 * _soundUrl = manifest.sounds (webpack-resolved map), set during SoundLoader.setPlayerData().
 * Contains ALL manifest entries — main load AND SubLoader deferred.
 * Key = manifest src path (e.g. "soundFiles/BaseGameMusicLoop.m4a")
 * Value = resolved URL (e.g. "assets/default/.../BaseGameMusicLoop.646a97.m4a")
 */
function getResolvedUrl(player: any, soundId: string): string | null {
    const manifestData = player._soundManifestData;
    if (!manifestData?.soundManifest) return null;

    const entry = manifestData.soundManifest.find((m: any) => m.id === soundId);
    if (!entry?.src?.length) return null;

    const soundUrl = player._soundUrl;
    if (!soundUrl) return null;

    // Direct lookup — key matches manifest src path
    for (const srcPath of entry.src) {
        if (soundUrl[srcPath]) return soundUrl[srcPath];
    }

    // Fallback: search by filename (handles key prefix differences)
    const fileName = entry.src[0].split("/").pop();
    if (fileName) {
        for (const [key, value] of Object.entries(soundUrl)) {
            if (key.includes(fileName) && typeof value === "string") return value;
        }
    }

    return null;
}

// ─── HTML5 Howl Registration ─────────────────────────────────────────────────

/**
 * Create an HTML5 Howl and register it in SoundPlayer.
 *
 * Flow:
 * 1. Read sprite definition from _soundManifestData (startTime, duration, tags)
 * 2. Create Howl with html5: true — browser streams, no Web Audio decode
 * 3. On load: register in _howlInstances, clean stale sprite, call addHowl()
 * 4. Sync tag mute/volume state (Music tag may already be muted by user)
 */
function registerHtml5(name: string, url: string, player: any): Promise<boolean> {
    return new Promise((resolve) => {
        const spriteId = "s_" + name;
        const soundDef = player._soundManifestData?.soundDefinitions?.soundSprites?.[spriteId];
        if (!soundDef) {
            warn(name, "— no soundSprite definition for", spriteId);
            resolve(false);
            return;
        }

        log("loading:", name);

        const howl = new Howl({
            src: [url],
            html5: true,
            preload: true,
            format: ["m4a"],
            sprite: { [spriteId]: [soundDef.startTime || 0, soundDef.duration || 0] }
        });

        howl.once("load", () => {
            // Gate for addHowl: _howlInstances[srcRef] !== undefined
            player._howlInstances[url] = howl;

            // Clean stale SoundSprite created by setSounds() with undefined howl
            const stale = player._soundSprites?.get(spriteId);
            if (stale) {
                player._tags?.forEach((td: any) => {
                    if (td?.sprites) td.sprites = td.sprites.filter((s: any) => s !== stale);
                });
            }

            // Register — creates fresh SoundSprite backed by HTML5 Howl
            player.addHowl(howl, url, spriteId);

            // Sync tag state — if user already muted Music, apply to this sprite
            syncTagState(player, spriteId);

            // Gapless loop — seek before end instead of stop/restart
            setupGaplessLoop(howl, spriteId, soundDef.duration || 0);

            log("\\u2713", name, "— HTML5 ready (gapless loop)");
            resolve(true);
        });

        howl.once("loaderror", (_: any, err: any) => {
            warn(name, "— load failed:", err);
            resolve(false);
        });
    });
}

/**
 * Sync mute/volume state from tags to a freshly registered SoundSprite.
 *
 * When addHowl() creates a SoundSprite, it registers in _tags. But if the Music tag
 * was already muted (user toggled music off before our Howl loaded), the new sprite
 * doesn't know. We read the tag state and apply it.
 */
function syncTagState(player: any, spriteId: string): void {
    const sp = player._soundSprites?.get(spriteId);
    if (!sp) return;

    const tags: string[] | undefined = sp._tags;
    if (!tags) return;

    for (const tag of tags) {
        const td = player._tags?.get(tag);
        if (td?.muted) {
            sp._isMuted = true;
            try { sp.mute(); } catch (_) { /* */ }
        }
    }
}

// ─── Replay Missed Commands ──────────────────────────────────────────────────

/**
 * Scan ALL commands from sounds.json for Play commands targeting streaming sprites.
 * If a sprite is not playing, replay the command — it was missed because the Howl
 * was undefined when the command originally fired.
 *
 * This handles onGameInit, onBaseGameStart, etc. automatically for every game.
 * No manual autoPlay configuration needed.
 */
/**
 * Replay missed boot commands — ONLY onGameInit and onBaseGameStart.
 * These fire before our Howls are registered, so the Play silently fails.
 * Other commands (onBonusGameStart, onWheelBonusStart, etc.) fire later
 * when the Howl is already registered — they don't need replay.
 */
function replayMissedCommands(player: any): void {
    const commands = player._soundManifestData?.soundDefinitions?.commands;
    if (!commands) return;

    const musicSet = new Set(MUSIC.map(n => "s_" + n));
    const bootCommands = ["onGameInit", "onBaseGameStart", "onGameStart"];

    for (const cmdName of bootCommands) {
        const steps = commands[cmdName];
        if (!steps) continue;
        const arr = Array.isArray(steps) ? steps : [steps];

        for (const step of arr) {
            if (!step) continue;
            const cmd = (step.command || "").toLowerCase();
            const sid = step.spriteId || "";
            if (cmd !== "play" || !musicSet.has(sid)) continue;

            const sp = player._soundSprites?.get(sid);
            if (!sp || sp._isPlaying) continue;

            if (step.volume !== undefined) sp._volume = step.volume;
            if (step.loop !== undefined) sp._loop = step.loop;
            sp.play();

            // Look for a matching Fade in the same command
            for (const fadeStep of arr) {
                if (!fadeStep || (fadeStep.command || "").toLowerCase() !== "fade") continue;
                if (fadeStep.spriteId !== sid || !(fadeStep.volume > 0)) continue;
                const fadeDuration = fadeStep.duration || 1500;
                const fadeDelay = fadeStep.delay || 50;
                setTimeout(() => {
                    const cur = player._soundSprites?.get(sid);
                    if (cur?._isPlaying) {
                        cur.fade({ volume: fadeStep.volume, duration: fadeDuration });
                    }
                }, fadeDelay);
                break;
            }

            log("replay:", cmdName, "\\u2192", sid, "vol:", step.volume, "loop:", step.loop);
            musicSet.delete(sid);
        }
    }
}

// ─── Gapless Loop ────────────────────────────────────────────────────────────

/**
 * Howler sprite loop has a gap: sprite expires → stop → seek(0) → play → gap.
 * Fix: monitor position, seek to 0 BEFORE the end so audio never stops.
 * The browser does a seamless seek on the <audio> element — no gap.
 */
function setupGaplessLoop(howl: Howl, spriteId: string, durationMs: number): void {
    const LEAD_MS = 150;  // seek this many ms before end
    const POLL_MS = 30;
    let intervalId: any = null;

    function startMonitor(): void {
        if (intervalId) return;
        intervalId = setInterval(() => {
            const snd = (howl as any)._sounds?.find((x: any) => x._sprite === spriteId);
            if (!snd || snd._paused || !snd._node) {
                stopMonitor();
                return;
            }
            // Get position in ms from the <audio> element directly (more accurate than Howler)
            const posSec: number = snd._node.currentTime || 0;
            const posMs = posSec * 1000;
            if (posMs > 0 && durationMs - posMs <= LEAD_MS) {
                // Seek to beginning before audio reaches end — seamless
                snd._node.currentTime = 0;
            }
        }, POLL_MS);
    }

    function stopMonitor(): void {
        if (intervalId) { clearInterval(intervalId); intervalId = null; }
    }

    howl.on("play", startMonitor);
    howl.on("stop", stopMonitor);
    howl.on("pause", stopMonitor);
    howl.on("end", () => {
        // Safety: if monitor missed the seek, restart immediately
        stopMonitor();
        const sp = ((soundManager as any)?.player as any)?._soundSprites?.get(spriteId);
        if (sp?._loop === -1 && !sp._isPlaying) {
            sp.play();
            startMonitor();
        }
    });
}

// ─── Tab Visibility — Pause/Resume HTML5 Music ──────────────────────────────

/**
 * playa-core pauseAllSounds resume checks x._playStart !== undefined,
 * which can be undefined for HTML5 Howl sounds. So our HTML5 music
 * gets paused but never resumed.
 *
 * Fix: listen for visibilitychange and manually pause/resume our sprites.
 */
function setupVisibilityHandler(player: any): void {
    const musicIds = MUSIC.map(n => "s_" + n);
    const wasPlaying = new Map<string, number>(); // spriteId → volume before pause
    const FADE_MS = 30;
    let fadeTimer: any = null;

    document.addEventListener("visibilitychange", () => {
        // Cancel pending fade/pause from rapid tab switching
        if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = null; }

        if (document.hidden) {
            wasPlaying.clear();
            for (const sid of musicIds) {
                const sp = player._soundSprites?.get(sid);
                if (sp?._isPlaying) {
                    wasPlaying.set(sid, sp._volume);
                    sp.fade({ volume: 0, duration: FADE_MS });
                    fadeTimer = setTimeout(() => { sp.pause(); fadeTimer = null; }, FADE_MS + 10);
                }
            }
        } else {
            for (const [sid, vol] of wasPlaying) {
                const sp = player._soundSprites?.get(sid);
                if (sp && !sp._isPlaying) {
                    sp._volume = 0;
                    sp.resume();
                    sp.fade({ volume: vol, duration: FADE_MS });
                }
            }
            wasPlaying.clear();
        }
    });
}

// ─── Wait Utilities ──────────────────────────────────────────────────────────

/**
 * Wait for SoundPlayer to be ready.
 *
 * Conditions:
 * - soundManager.player exists
 * - _soundSprites has entries (setSounds() completed)
 * - _soundUrl exists (setRawUrls() completed — we need resolved URLs)
 */
function waitForPlayer(): Promise<any> {
    return new Promise((resolve) => {
        let elapsed = 0;
        function check(): void {
            const p = (soundManager as any)?.player;
            if (p?._soundSprites?.size > 0 && p?._soundUrl) {
                resolve(p);
                return;
            }
            elapsed += 50;
            if (elapsed >= 30000) {
                warn("SoundPlayer not ready after 30s");
                resolve(null);
                return;
            }
            setTimeout(check, 50);
        }
        check();
    });
}

// ─── Init ────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
    const player = await waitForPlayer();
    if (!player) return;

    log("init:", MUSIC.length, "music tracks — direct HTML5 (no SubLoader, no Web Audio)");

    // Register all music tracks as HTML5 Howls
    let registered = 0;
    for (const name of MUSIC) {
        const url = getResolvedUrl(player, name);
        if (!url) {
            warn(name, "— URL not found in _soundUrl, skipping");
            continue;
        }

        log(name, "\\u2192", url.slice(-60));  // log last 60 chars of URL
        const ok = await registerHtml5(name, url, player);
        if (ok) registered++;
    }

    if (registered === 0) {
        warn("no tracks registered — music will not play");
        return;
    }

    log(registered + "/" + MUSIC.length, "tracks registered");

    // Replay missed commands (e.g. onGameInit fired before Howl was registered)
    replayMissedCommands(player);

    // Handle tab visibility — pause/resume HTML5 music independently of playa-core
    setupVisibilityHandler(player);

    log("done — ~" + (registered * 3) + " MB RAM (saved ~" + (registered * 37) + " MB vs Web Audio)");
}

init();

export const BGM_STREAMING_ACTIVE = true;
`;

    const distDir = path.join('.', 'dist');
    if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
    const distTsPath = path.join(distDir, 'BGMStreamingInit.ts');
    fs.writeFileSync(distTsPath, generatedTs, 'utf8');
    console.log('  Generated: ' + distTsPath);

    // ═══════════════════════════════════════════════════════════════════════════
    // 8. DEPLOY TO GAME REPO — copy TS + patch main.ts
    // ═══════════════════════════════════════════════════════════════════════════

    console.log('\n── Step 8: Deploying to game repo ──');

    const gameSrcTs = path.join(gameRepoAbs, 'src', 'ts');
    if (!fs.existsSync(gameSrcTs)) {
        console.log('  ⚠ game repo src/ts/ not found — skipping TS deploy');
    } else {
        // Copy BGMStreamingInit.ts
        const utilsDir = path.join(gameSrcTs, 'utils');
        if (!fs.existsSync(utilsDir)) fs.mkdirSync(utilsDir, { recursive: true });
        fs.copyFileSync(distTsPath, path.join(utilsDir, 'BGMStreamingInit.ts'));
        console.log('  ✅ BGMStreamingInit.ts → game repo');

        // Patch main.ts — remove old BGM lines, add import + webpack keep
        const mainTsPath = path.join(gameSrcTs, 'main.ts');
        if (!fs.existsSync(mainTsPath)) {
            console.log('  ⚠ main.ts not found — skipping patch');
        } else {
            let mainLines = fs.readFileSync(mainTsPath, 'utf8').split('\n');

            // Remove any existing BGMStreamingInit references
            mainLines = mainLines.filter(l =>
                !l.includes('BGMStreamingInit') && !l.includes('BGM_STREAMING_ACTIVE')
            );

            // Find last import statement (handles multi-line imports)
            let lastImportLine = -1;
            for (let i = 0; i < mainLines.length; i++) {
                if (/^\s*import\s/.test(mainLines[i])) {
                    lastImportLine = i;
                    if (!mainLines[i].includes(';') && !mainLines[i].includes('from')) {
                        for (let j = i + 1; j < mainLines.length; j++) {
                            if (mainLines[j].includes('from') || mainLines[j].includes(';')) {
                                lastImportLine = j;
                                break;
                            }
                        }
                    }
                }
            }

            if (lastImportLine >= 0) {
                mainLines.splice(lastImportLine + 1, 0,
                    'import { BGM_STREAMING_ACTIVE } from "./utils/BGMStreamingInit";',
                    'if (BGM_STREAMING_ACTIVE) { /* webpack: keep */ }'
                );
                fs.writeFileSync(mainTsPath, mainLines.join('\n'), 'utf8');
                console.log('  ✅ Patched main.ts');
            } else {
                console.log('  ⚠ No import statements found in main.ts — skipping patch');
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SUMMARY
    // ═══════════════════════════════════════════════════════════════════════════

    const sfxCount = soundsJson.soundManifest.filter(m => m.loadType !== 'M').length;

    console.log('\n══════════════════════════════════════════════════');
    console.log('  BUILD COMPLETE — Direct HTML5 Streaming');
    console.log('══════════════════════════════════════════════════\n');
    console.log('  SFX sprites: ' + sfxCount);
    console.log('  Streaming:   ' + streamingTracks.length + ' tracks (direct HTML5, ~' + (streamingTracks.length * 3) + ' MB RAM)');
    console.log('');
    for (const t of streamingTracks) {
        const marker = autoPlaySounds.has(t.name) ? '▶' : '·';
        console.log('  ' + marker + ' ' + t.name + ' — ' + t.sizeKB + 'KB, ' + (t.durationMs / 1000).toFixed(1) + 's');
    }
    console.log('');
    console.log('  Architecture:');
    console.log('    loadType "M" → playa resolves URL → BGMStreamingInit reads URL');
    console.log('    → new Howl({ html5: true }) → addHowl() → commands work normally');
    console.log('');
    console.log('    NO SubLoader trigger. NO Web Audio decode. NO swap.');
    console.log('    Music goes directly to HTML5 Audio — streaming from disk.');
    console.log('');
    console.log('  ✅ Pokreni Deploy u aplikaciji za kopiranje audio fajlova.');
    console.log('');
}

main();
