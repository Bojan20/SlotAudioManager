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
const { execSync, execFile } = require('child_process');

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

// Use buildSpritesOptimized if available, fallback to original pipeline
const optimizedScript = path.join('.', 'scripts', 'buildSpritesOptimized.js');
const useOptimized = fs.existsSync(optimizedScript);

console.log('── Step 2: Building SFX sprites' + (useOptimized ? ' (optimized)' : '') + ' ──');
try {
    if (useOptimized) {
        execSync('node scripts/buildSpritesOptimized.js', { stdio: 'inherit', timeout: 300000, maxBuffer: 5 * 1024 * 1024 });
    } else {
        execSync('node scripts/createAudioSpritesBySize.js', { stdio: 'inherit', timeout: 300000, maxBuffer: 5 * 1024 * 1024 });
    }
} catch (e) { console.error('❌ SFX build failed'); process.exit(1); }

if (!useOptimized) {
    console.log('\n── Step 3: Generating sounds.json ──');
    try {
        execSync('node scripts/makeMyJSONSizedSprites.js audioSprite', { stdio: 'inherit', timeout: 300000, maxBuffer: 5 * 1024 * 1024 });
    } catch (e) { console.error('❌ JSON generation failed'); process.exit(1); }
} else {
    console.log('\n── Step 3: sounds.json generated by optimized build ──');
}

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

const crypto = require('crypto');
const _ffmpegStatic = require('ffmpeg-static');
const _fdkStreamPath = process.env.FFMPEG_FDK_PATH || '';
const _fdkStreamExists = _fdkStreamPath && fs.existsSync(_fdkStreamPath);
const pathToFFmpeg = _fdkStreamExists ? _fdkStreamPath : _ffmpegStatic;
const outDir = path.join('.', 'dist', 'soundFiles');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const bitrate = musicEnc.bitrate || 64;
const channels = musicEnc.channels || 2;
const samplerate = musicEnc.samplerate || 44100;
const sox = require('sox');

// SHA-256 cache — includes encoding settings so bitrate/channels changes trigger rebuild
const streamCacheFile = path.join('.', 'dist', '.streaming-cache.json');
const encSettingsKey = bitrate + '|' + channels + '|' + samplerate;
function loadStreamCache() {
    try {
        const c = JSON.parse(fs.readFileSync(streamCacheFile, 'utf8'));
        if (c._encSettings !== encSettingsKey) { console.log('  Encoding settings changed — rebuilding all'); return {}; }
        return c;
    } catch { return {}; }
}
function saveStreamCache(c) { c._encSettings = encSettingsKey; try { fs.writeFileSync(streamCacheFile, JSON.stringify(c, null, 2)); } catch {} }
function sha256(fp) { const h = crypto.createHash('sha256'); h.update(fs.readFileSync(fp)); return h.digest('hex'); }

function getWavDurationMs(wavPath) {
    return new Promise((resolve) => {
        sox.identify(wavPath, (err, results) => {
            if (err || !results || !results.sampleRate) {
                console.warn('  ⚠ sox failed for ' + path.basename(wavPath));
                resolve(0);
                return;
            }
            resolve(Math.round(results.sampleCount * 100000 / results.sampleRate) / 100);
        });
    });
}

// True parallel encode — execFile (async callback) not execFileSync
function encodeOne(name, wavPath, m4aPath) {
    return new Promise((resolve) => {
        getWavDurationMs(wavPath).then(durationMs => {
            execFile(pathToFFmpeg, [
                '-y', '-i', wavPath,
                '-c:a', 'aac', '-b:a', bitrate + 'k',
                '-ac', String(channels), '-ar', String(samplerate),
                '-movflags', '+faststart',
                m4aPath
            ], { timeout: 120000, maxBuffer: 5 * 1024 * 1024 }, (error) => {
                if (error) {
                    console.error('  ❌ ' + name + ': ' + error.message);
                    // Clean up partial M4A on failure
                    try { if (fs.existsSync(m4aPath)) fs.unlinkSync(m4aPath); } catch {}
                    resolve(null);
                    return;
                }
                if (!fs.existsSync(m4aPath) || fs.statSync(m4aPath).size === 0) {
                    console.error('  ❌ ' + name + ': M4A empty or missing after encode');
                    try { if (fs.existsSync(m4aPath)) fs.unlinkSync(m4aPath); } catch {}
                    resolve(null);
                    return;
                }
                const sizeKB = Math.round(fs.statSync(m4aPath).size / 1024);
                resolve({ name, m4aName: name + '.m4a', durationMs, sizeKB });
            });
        });
    });
}

async function buildStreamingTracks() {
    const prevCache = loadStreamCache();
    const successCache = {};
    const tracks = [];
    const encodeJobs = [];

    // Check which tracks need rebuild
    for (const name of streamingSounds) {
        const wavPath = path.join(sourceDir, name + '.wav');
        if (!fs.existsSync(wavPath)) { console.log('  ⚠ ' + name + '.wav not found'); continue; }

        const hash = sha256(wavPath);
        const m4aPath = path.join(outDir, name + '.m4a');

        if (prevCache[name] === hash && fs.existsSync(m4aPath) && fs.statSync(m4aPath).size > 0) {
            const durationMs = await getWavDurationMs(wavPath);
            const sizeKB = Math.round(fs.statSync(m4aPath).size / 1024);
            console.log('  · ' + name + ' (cached, ' + sizeKB + 'KB)');
            tracks.push({ name, m4aName: name + '.m4a', durationMs, sizeKB });
            successCache[name] = hash;
        } else {
            encodeJobs.push({ name, wavPath, m4aPath, hash });
        }
    }

    if (encodeJobs.length > 0) {
        console.log('  Encoding ' + encodeJobs.length + ' tracks in parallel...');
        const encodeStart = Date.now();
        const results = await Promise.all(
            encodeJobs.map(j => encodeOne(j.name, j.wavPath, j.m4aPath))
        );
        const encodeMs = Date.now() - encodeStart;
        for (let i = 0; i < results.length; i++) {
            const r = results[i];
            if (r) {
                console.log('  ✓ ' + r.name + ' (' + r.sizeKB + 'KB, ' + (r.durationMs / 1000).toFixed(1) + 's)');
                tracks.push(r);
                successCache[r.name] = encodeJobs[i].hash;
            }
        }
        console.log('  Encoded in ' + (encodeMs / 1000).toFixed(1) + 's');
    }

    // Save cache — only includes successfully encoded/cached tracks
    saveStreamCache(successCache);

    // Validate ALL required tracks exist
    const missing = streamingSounds.filter(name => !tracks.some(t => t.name === name));
    if (missing.length > 0) {
        console.error('❌ Missing streaming tracks: ' + missing.join(', '));
        console.error('   Build will continue with ' + tracks.length + '/' + streamingSounds.length + ' tracks');
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

    const generatedTs = `/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * BGMStreamingInit.ts — Auto-generated by deployStreaming.js
 *
 * DIRECT HTML5 AUDIO — no SubLoader, no Web Audio decode, no swap.
 * Gapless loop via rAF position monitoring + mute-seek-unmute.
 * Tab visibility with position save/restore + fade.
 * ESLint-clean: no for-of, no continue, no restricted syntax.
 * Wrapped in try-catch — never prevents game from loading.
 */

import { soundManager } from "playa-core";
import { Howl, Howler } from "howler";

const MUSIC: string[] = ${musicNamesJson};

const TAG = "[BGM]";
function log(...a: unknown[]): void { console.log(TAG, ...a); }
function warn(...a: unknown[]): void { console.warn(TAG, ...a); }

function findSnd(howl: any, spriteId: string): any {
    return howl?._sounds?.find((x: any) => x._sprite === spriteId) || null;
}

// ─── URL Resolution ──────────────────────────────────────────────────────────

function getResolvedUrl(player: any, soundId: string): string | null {
    const manifestData = player._soundManifestData;
    if (!manifestData?.soundManifest) return null;
    const entry = manifestData.soundManifest.find((m: any) => m.id === soundId);
    if (!entry?.src?.length) return null;
    const soundUrl = player._soundUrl;
    if (!soundUrl) return null;

    let resolved: string | null = null;
    entry.src.some((srcPath: string) => {
        if (soundUrl[srcPath]) { resolved = soundUrl[srcPath]; return true; }
        return false;
    });
    if (resolved) return resolved;

    const fileName = entry.src[0].split("/").pop();
    if (fileName) {
        Object.keys(soundUrl).some((key) => {
            if (key.includes(fileName) && typeof soundUrl[key] === "string") {
                resolved = soundUrl[key];
                return true;
            }
            return false;
        });
    }
    return resolved;
}

// ─── Gapless Loop ────────────────────────────────────────────────────────────

const loopMonitors: Record<string, { active: boolean; duration: number }> = {};

function startLoopMonitor(howl: Howl, spriteId: string, durationSec: number): void {
    if (!loopMonitors[spriteId]) loopMonitors[spriteId] = { active: false, duration: durationSec };
    const state = loopMonitors[spriteId];
    if (state.active) return;
    state.active = true;

    function tick(): void {
        if (!state.active) return;
        const snd = findSnd(howl, spriteId);
        if (!snd || snd._paused || !snd._node) { state.active = false; return; }

        const pos: number = snd._node.currentTime;
        const remaining = state.duration - pos;

        if (pos > 0.1 && remaining > 0 && remaining < 0.05) {
            const vol: number = snd._node.volume;
            snd._node.volume = 0;
            snd._node.currentTime = 0;
            requestAnimationFrame(() => { if (snd._node) snd._node.volume = vol; });
        }

        requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}

function stopLoopMonitor(spriteId: string): void {
    if (loopMonitors[spriteId]) loopMonitors[spriteId].active = false;
}

// ─── HTML5 Howl Registration ─────────────────────────────────────────────────

function registerHtml5(name: string, url: string, player: any): Promise<boolean> {
    return new Promise((resolve) => {
        const spriteId = "s_" + name;
        const soundDef = player._soundManifestData?.soundDefinitions?.soundSprites?.[spriteId];
        if (!soundDef) { warn(name, "— no soundSprite def"); resolve(false); return; }

        const durationSec = (soundDef.duration || 0) / 1000;

        const howl = new Howl({
            src: [url],
            html5: true,
            preload: true,
            format: ["m4a"],
            sprite: { [spriteId]: [0, 86400000] },
        });

        howl.on("play", () => {
            const snd = findSnd(howl, spriteId);
            if (snd) {
                if (snd._playStart === undefined) {
                    snd._playStart = (Howler as any).ctx?.currentTime || 0;
                }
                startLoopMonitor(howl, spriteId, durationSec);
            }
        });
        howl.on("pause", () => stopLoopMonitor(spriteId));
        howl.on("stop", () => stopLoopMonitor(spriteId));

        howl.once("load", () => {
            player._howlInstances[url] = howl;

            const stale = player._soundSprites?.get(spriteId);
            if (stale) {
                player._tags?.forEach((td: any) => {
                    if (td?.sprites) { td.sprites = td.sprites.filter((s: any) => s !== stale); }
                });
            }

            player.addHowl(howl, url, spriteId);
            syncTagState(player, spriteId);

            log("\\u2713", name, "— HTML5 ready");
            resolve(true);
        });

        howl.once("loaderror", (_id: any, err: any) => {
            warn(name, "— load failed:", err);
            resolve(false);
        });
    });
}

function syncTagState(player: any, spriteId: string): void {
    const sp = player._soundSprites?.get(spriteId);
    if (!sp?._tags) return;
    (sp._tags as string[]).forEach((tag: string) => {
        const td = player._tags?.get(tag);
        if (td?.muted) { sp._isMuted = true; try { sp.mute(); } catch (_e) { /* */ } }
    });
}

// ─── Replay Missed Boot Commands ─────────────────────────────────────────────

function replayMissedCommands(player: any): void {
    const commands = player._soundManifestData?.soundDefinitions?.commands;
    if (!commands) return;
    const musicSet = new Set(MUSIC.map((n) => "s_" + n));

    ["onGameInit", "onBaseGameStart", "onGameStart"].forEach((cmdName) => {
        const steps = commands[cmdName];
        if (!steps) return;
        const arr: any[] = Array.isArray(steps) ? steps : [steps];

        arr.forEach((step: any) => {
            if (!step) return;
            const cmd = (step.command || "").toLowerCase();
            const sid: string = step.spriteId || "";
            if (cmd !== "play" || !musicSet.has(sid)) return;
            const sp = player._soundSprites?.get(sid);
            if (!sp || sp._isPlaying) return;

            if (step.volume !== undefined) sp._volume = step.volume;
            if (step.loop !== undefined) sp._loop = step.loop;
            sp.play();

            const fadeStep = arr.find((fs: any) =>
                fs && (fs.command || "").toLowerCase() === "fade" &&
                fs.spriteId === sid && fs.volume > 0
            );
            if (fadeStep) {
                setTimeout(() => {
                    const c = player._soundSprites?.get(sid);
                    if (c?._isPlaying) c.fade({ volume: fadeStep.volume, duration: fadeStep.duration || 1500 });
                }, fadeStep.delay || 50);
            }

            log("replay:", cmdName, "\\u2192", sid);
            musicSet.delete(sid);
        });
    });
}

// ─── Tab Visibility ──────────────────────────────────────────────────────────

function setupVisibilityHandler(player: any): void {
    const musicIds = MUSIC.map((n) => "s_" + n);
    const saved: Record<string, { vol: number; pos: number }> = {};

    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            musicIds.forEach((sid) => {
                delete saved[sid];
                const sp = player._soundSprites?.get(sid);
                if (!sp?._isPlaying) return;
                const snd = findSnd(sp._howl, sid);
                saved[sid] = { vol: sp._volume, pos: snd?._node?.currentTime || 0 };
                if (snd?._node) snd._node.volume = 0;
            });
        } else {
            Object.keys(saved).forEach((sid) => {
                const state = saved[sid];
                const sp = player._soundSprites?.get(sid);
                if (!sp) return;
                const snd = findSnd(sp._howl, sid);

                if (snd?._node) {
                    if (Math.abs(snd._node.currentTime - state.pos) > 0.5) {
                        snd._node.currentTime = state.pos;
                    }
                    snd._node.volume = 0;
                }

                if (!sp._isPlaying && sp._isPaused) sp.resume();

                if (snd?._node) {
                    const node = snd._node;
                    const target = state.vol;
                    let v = 0;
                    const step = target / 8;
                    const iv = setInterval(() => {
                        v += step;
                        if (v >= target) { node.volume = target; clearInterval(iv); return; }
                        node.volume = v;
                    }, 5);
                }

                delete saved[sid];
            });
        }
    });
}

// ─── Wait & Init ─────────────────────────────────────────────────────────────

function waitForPlayer(): Promise<any> {
    return new Promise((resolve) => {
        let elapsed = 0;
        function check(): void {
            const p = (soundManager as any)?.player;
            if (p?._soundSprites?.size > 0 && p?._soundUrl) { resolve(p); return; }
            elapsed += 50;
            if (elapsed >= 30000) { warn("SoundPlayer timeout"); resolve(null); return; }
            setTimeout(check, 50);
        }
        check();
    });
}

async function init(): Promise<void> {
    try {
        const player = await waitForPlayer();
        if (!player) return;

        log("init:", MUSIC.length, "tracks — direct HTML5");

        let ok = 0;
        const results = MUSIC.map((name) => {
            const url = getResolvedUrl(player, name);
            if (!url) { warn(name, "— URL not found"); return Promise.resolve(false); }
            return registerHtml5(name, url, player);
        });

        const outcomes = await Promise.all(results);
        outcomes.forEach((r) => { if (r) ok += 1; });

        if (ok === 0) { warn("no tracks registered"); return; }
        log(ok + "/" + MUSIC.length, "registered");

        replayMissedCommands(player);
        setupVisibilityHandler(player);

        log("done — ~" + (ok * 3) + "MB RAM (saved ~" + (ok * 37) + "MB)");
    } catch (e) {
        warn("init error (game continues):", e);
    }
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
    const totalStreamKB = streamingTracks.reduce((sum, t) => sum + t.sizeKB, 0);

    console.log('\n══════════════════════════════════════════════════');
    console.log('  BUILD COMPLETE — Direct HTML5 Streaming');
    console.log('══════════════════════════════════════════════════\n');
    console.log('  SFX sprites: ' + sfxCount);
    console.log('  Streaming:   ' + streamingTracks.length + ' tracks, ' + totalStreamKB + ' KB (' + (totalStreamKB / 1024).toFixed(1) + ' MB on disk)');
    console.log('  RAM:         ~' + (streamingTracks.length * 3) + ' MB streaming vs ~' + (streamingTracks.length * 40) + ' MB Web Audio');
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
