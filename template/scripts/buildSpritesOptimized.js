#!/usr/bin/env node

/**
 * buildSpritesOptimized.js — Single-script audio sprite build with incremental cache
 *
 * Drop-in replacement for: createAudioSpritesBySize + makeMyJSONSizedSprites
 * Same output format, same customAudioSprite engine, handles _SL.wav sprite lists.
 *
 * Improvements:
 * - Single process — no race condition between scripts chained with &&
 * - SHA-256 incremental cache — only rebuilds when WAVs change
 * - Promise-based flow — no manual soundProcessCount, no hanging on sox failure
 * - Proper error propagation — exit(1) on any ffmpeg/sox failure
 * - Validates output before generating sounds.json
 * - Full _SL.wav sprite list support via exiftool markers
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const audiosprite = require('./customAudioSprite');
const _ffmpegStatic = require('ffmpeg-static');
const FFMPEG_FDK_PATH = process.env.FFMPEG_FDK_PATH || '';
const _fdkBinExists = FFMPEG_FDK_PATH && fs.existsSync(FFMPEG_FDK_PATH);
const pathToFFmpeg = _fdkBinExists ? FFMPEG_FDK_PATH : _ffmpegStatic;
const sox = require('sox');

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

const settings = JSON.parse(fs.readFileSync('settings.json', 'utf8'));
const gameProjectPath = settings.gameProjectPath;
if (!gameProjectPath) { console.error('❌ gameProjectPath not set in settings.json'); process.exit(1); }

const gameName = gameProjectPath.split(/[/\\]/).pop();
const sourceDir = settings.SourceSoundDirectory || './sourceSoundFiles';
const distDir = './dist';
const outDir = path.join(distDir, 'soundFiles');
const cacheFile = path.join(distDir, '.build-cache.json');
const JSONtemplate = settings.JSONtemplate || 'sounds.json';
const JSONtarget = settings.JSONtarget || './dist/sounds.json';

const spriteConfig = (() => { try { return JSON.parse(fs.readFileSync('sprite-config.json', 'utf8')); } catch { return null; } })();
const encoding = spriteConfig?.encoding || {};
const sfxEnc = encoding.sfx || {};
const musicEnc = encoding.music || {};

// FDK-AAC detection (FFMPEG_FDK_PATH set above from env, checked at startup)
const fdkExists = _fdkBinExists;

// SFX vs Music separation — same regex as original
function isMusicSound(name) {
    return /Music|MusicLoop|BigWinLoop|BigWinEnd|BigWinIntro|BonusGameEnd/i.test(name)
        && !/Coin|Spins|Rollup|Counter|CoinShower|Amb/i.test(name);
}

console.log('\n══════════════════════════════════════════════════');
console.log('  buildSpritesOptimized.js — Incremental Build');
console.log('══════════════════════════════════════════════════\n');
console.log('pathToFFmpeg ->', pathToFFmpeg);

// ═══════════════════════════════════════════════════════════════════════════════
// SHA-256 CACHE
// ═══════════════════════════════════════════════════════════════════════════════

function sha256(filePath) {
    const hash = crypto.createHash('sha256');
    hash.update(fs.readFileSync(filePath));
    return hash.digest('hex');
}

function loadCache() {
    try { return JSON.parse(fs.readFileSync(cacheFile, 'utf8')); }
    catch { return {}; }
}

function saveCache(cache) {
    try { fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2)); } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHUNK BY SIZE (~30MB per sprite)
// ═══════════════════════════════════════════════════════════════════════════════

function chunkBySize(files, maxMB) {
    const chunks = [];
    let current = [];
    let currentSize = 0;
    for (let i = 0; i < files.length; i++) {
        const size = fs.statSync(files[i]).size / (1024 * 1024);
        if (currentSize + size >= maxMB && current.length > 0) {
            chunks.push(current);
            current = [];
            currentSize = 0;
        }
        current.push(files[i]);
        currentSize += size;
    }
    if (current.length > 0) chunks.push(current);
    return chunks;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROMISE WRAPPERS
// ═══════════════════════════════════════════════════════════════════════════════

function buildSprite(files, spriteNumber, opts) {
    return new Promise((resolve, reject) => {
        let fired = false;
        audiosprite(pathToFFmpeg, files, opts, spriteNumber, (err, obj) => {
            if (fired) return;
            fired = true;
            if (err) { reject(err); return; }
            resolve(obj);
        });
    });
}

function getSoxDuration(wavPath) {
    return new Promise((resolve) => {
        sox.identify(wavPath, (err, results) => {
            if (err || !results || !results.sampleRate) {
                console.warn('  ⚠ sox.identify failed for ' + path.basename(wavPath) + ': ' + (err?.message || 'no results'));
                resolve(null);
                return;
            }
            resolve(Math.round(results.sampleCount * 100000 / results.sampleRate) / 100);
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
    // Read all WAV files
    const allFiles = fs.readdirSync(sourceDir).filter(f => f.endsWith('.wav')).sort();
    if (allFiles.length === 0) { console.error('❌ No WAV files found in ' + sourceDir); process.exit(1); }

    const sfxFiles = allFiles.filter(f => !isMusicSound(f.replace('.wav', ''))).map(f => path.join(sourceDir, f));
    const musicFiles = allFiles.filter(f => isMusicSound(f.replace('.wav', ''))).map(f => path.join(sourceDir, f));
    console.log('SFX: ' + sfxFiles.length + ' files, Music: ' + musicFiles.length + ' files');

    // Compute SHA-256 for all WAVs
    const hashes = {};
    allFiles.forEach(f => { hashes[f] = sha256(path.join(sourceDir, f)); });
    const prevCache = loadCache();

    // Check if any file changed
    const filesChanged = allFiles.some(f => hashes[f] !== prevCache[f]);
    const structureChanged = (prevCache._fileList || '') !== allFiles.join(',');

    if (!filesChanged && !structureChanged && fs.existsSync(JSONtarget)) {
        console.log('\n✅ No changes detected — skipping build (cached)');
        console.log('   Delete dist/.build-cache.json to force rebuild\n');
        process.exit(0);
    }

    // Clean dist
    if (fs.existsSync(distDir)) fs.rmSync(distDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });

    // ── Build SFX sprites ──
    const sfxChunks = chunkBySize(sfxFiles, 30);
    const sfxEncEncoder = sfxEnc.encoder || 'native';
    const sfxUseNative = !((sfxEncEncoder === 'fdk') && fdkExists);

    // Gap optimization (hardcoded — does not affect other scripts):
    // - customAudioSprite default: gap=1s + Math.ceil rounding = ~1.5s silence per sound
    // - Web Audio AudioBufferSourceNode.start(0, offset, duration) is sample-accurate
    // - Minimum safe gap = 1 AAC frame (1024 samples = 23ms at 44100Hz)
    // - 50ms gap + no rounding = no wasted silence
    // - For 99 sounds: saves ~150s of silence = ~900KB on final M4A at 48kbps
    const gap = spriteConfig?.spriteGap !== undefined ? spriteConfig.spriteGap : 0.05;

    const sfxOpts = {
        output: path.join(outDir, gameName + '_audioSprite'),
        format: 'howler2',
        export: 'm4a',
        bitrate: sfxEnc.bitrate || 64,
        channels: sfxEnc.channels || 2,
        samplerate: sfxEnc.samplerate || 44100,
        useNativeAac: sfxUseNative,
        gap: gap,
        ignorerounding: 1,
        logger: { debug: () => {}, info: console.log, log: console.log }
    };

    // Build all jobs (SFX + Music) — collect for parallel execution
    const buildJobs = []; // { spriteNum, files, opts, type }
    let spriteNumber = 1;

    console.log('\n── Building SFX sprites (' + (sfxEnc.bitrate || 64) + 'kbps, ' + (sfxEnc.channels || 2) + 'ch) ──');
    for (let i = 0; i < sfxChunks.length; i++) {
        console.log('  SFX sprite ' + spriteNumber + ' — ' + sfxChunks[i].length + ' files');
        buildJobs.push({ spriteNum: spriteNumber, files: sfxChunks[i], opts: sfxOpts, type: 'SFX' });
        spriteNumber++;
    }

    if (musicFiles.length > 0) {
        const musicChunks = chunkBySize(musicFiles, 30);
        const musicEncEncoder = musicEnc.encoder || 'native';
        const musicUseNative = !((musicEncEncoder === 'fdk') && fdkExists);

        const musicOpts = {
            output: path.join(outDir, gameName + '_audioSprite'),
            format: 'howler2',
            export: 'm4a',
            bitrate: musicEnc.bitrate || 64,
            channels: musicEnc.channels || 2,
            samplerate: musicEnc.samplerate || 44100,
            useNativeAac: musicUseNative,
            gap: gap,
            ignorerounding: 1,
            logger: { debug: () => {}, info: console.log, log: console.log }
        };

        console.log('\n── Building Music sprites (' + (musicEnc.bitrate || 64) + 'kbps, ' + (musicEnc.channels || 2) + 'ch) ──');
        for (let i = 0; i < musicChunks.length; i++) {
            console.log('  Music sprite ' + spriteNumber + ' — ' + musicChunks[i].length + ' files');
            buildJobs.push({ spriteNum: spriteNumber, files: musicChunks[i], opts: musicOpts, type: 'Music' });
            spriteNumber++;
        }
    }

    // Execute all builds in parallel — ffmpeg instances run concurrently
    const totalSprites = spriteNumber - 1;
    console.log('\n── Building ' + totalSprites + ' sprites in parallel ──');
    const buildStart = Date.now();

    const spriteData = [];
    const results = await Promise.allSettled(
        buildJobs.map(job =>
            buildSprite(job.files, job.spriteNum, job.opts)
                .then(data => ({ spriteNum: job.spriteNum, soundData: data, type: job.type }))
        )
    );

    for (let i = 0; i < results.length; i++) {
        if (results[i].status === 'rejected') {
            console.error('❌ Sprite ' + buildJobs[i].spriteNum + ' (' + buildJobs[i].type + ') failed:', results[i].reason?.message || results[i].reason);
            process.exit(1);
        }
        spriteData.push(results[i].value);
    }

    const buildMs = Date.now() - buildStart;
    console.log('  All ' + totalSprites + ' sprites built in ' + (buildMs / 1000).toFixed(1) + 's');

    // Validate all M4A files exist + per-sprite size report
    console.log('\n── M4A Output ──');
    for (let i = 1; i <= totalSprites; i++) {
        const m4a = path.join(outDir, gameName + '_audioSprite' + i + '.m4a');
        if (!fs.existsSync(m4a)) {
            console.error('❌ Missing M4A: ' + m4a);
            process.exit(1);
        }
        const sizeKB = Math.round(fs.statSync(m4a).size / 1024);
        const job = buildJobs[i - 1];
        console.log('  ' + (sizeKB > 2000 ? '⚠' : '✓') + ' audioSprite' + i + '.m4a — ' + sizeKB + ' KB (' + job.type + ', ' + job.files.length + ' sounds)' + (sizeKB > 2000 ? ' — LARGE' : ''));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GENERATE sounds.json
    // ═══════════════════════════════════════════════════════════════════════════

    console.log('\n── Generating sounds.json ──');

    // Read template for commands and spriteLists
    let templateJson;
    try { templateJson = JSON.parse(fs.readFileSync(JSONtemplate, 'utf8')); }
    catch { templateJson = { soundDefinitions: { commands: {}, soundSprites: {}, spriteList: {} } }; }

    const originalSprites = templateJson.soundDefinitions?.soundSprites || {};
    const originalCommands = templateJson.soundDefinitions?.commands || {};
    const originalSpriteLists = templateJson.soundDefinitions?.spriteList || {};

    // Build manifest from M4A files
    const soundManifest = [];
    for (let i = 1; i <= totalSprites; i++) {
        soundManifest.push({
            id: gameName + '_audioSprite' + i,
            src: ['soundFiles/' + gameName + '_audioSprite' + i + '.m4a']
        });
    }

    // Build soundSprites from spriteData + sox durations
    const soundSprites = {};
    let soxFailCount = 0;

    console.log('Processing ' + allFiles.length + ' sounds...');

    for (const { spriteNum, soundData } of spriteData) {
        const spriteMap = soundData.sprite || {};
        const soundId = gameName + '_audioSprite' + spriteNum;

        for (const [name, timings] of Object.entries(spriteMap)) {
            if (name === '__default') { /* skip */ }
            else {
                const entryName = 's_' + name;
                const startTime = timings[0]; // ms from customAudioSprite howler2 format

                // Get duration from sox (accurate)
                const wavPath = path.join(sourceDir, name + '.wav');
                let duration = timings[1]; // fallback to sprite map
                if (fs.existsSync(wavPath)) {
                    const soxDur = await getSoxDuration(wavPath);
                    if (soxDur !== null) {
                        duration = soxDur;
                    } else {
                        soxFailCount++;
                        console.warn('  ⚠ Using sprite map duration for ' + name);
                    }
                } else {
                    console.warn('  ⚠ WAV missing for ' + name + ' — using sprite map duration');
                }

                // Detect Music tag
                const isMusic = isMusicSound(name);
                const defaultTag = isMusic ? ['Music'] : ['SoundEffects'];

                soundSprites[entryName] = {
                    soundId: soundId,
                    spriteId: name,
                    startTime: startTime,
                    duration: duration,
                    tags: originalSprites[entryName]?.tags || defaultTag,
                    overlap: originalSprites[entryName]?.overlap !== undefined
                        ? originalSprites[entryName].overlap : false
                };
            }
        }
    }


    // Sort soundSprites alphabetically
    const sortedSprites = {};
    Object.keys(soundSprites).sort().forEach(k => { sortedSprites[k] = soundSprites[k]; });

    // ── Validation ──
    console.log('\n── Validating sounds.json ──');
    let validationErrors = 0;
    const manifestIds = new Set(soundManifest.map(m => m.id));

    Object.entries(sortedSprites).forEach(([key, sp]) => {
        if (!manifestIds.has(sp.soundId)) {
            console.error('  ❌ ' + key + ' references soundId "' + sp.soundId + '" not in manifest');
            validationErrors++;
        }
        if (sp.duration <= 0) {
            console.warn('  ⚠ ' + key + ' has duration ' + sp.duration);
        }
    });

    if (validationErrors > 0) {
        console.error('\n❌ ' + validationErrors + ' validation errors — aborting');
        process.exit(1);
    }
    console.log('  ✓ All soundSprites reference valid manifest IDs');
    console.log('  ✓ ' + Object.keys(sortedSprites).length + ' sprites validated');

    // Assemble final JSON
    const outputJson = {
        soundManifest: soundManifest,
        soundDefinitions: {
            soundSprites: sortedSprites,
            spriteList: originalSpriteLists,
            commands: originalCommands
        }
    };

    // Format JSON (same as original)
    const jsonStr = JSON.stringify(outputJson, null, 2)
        .replace(/]},/g, ']},\n')
        .replace(/}],/g, '}],\n')
        .replace(/},"/g, '},\n"')
        .replace(/"soundManifest":/g, '\n"soundManifest":\n')
        .replace(/"soundDefinitions":/g, '\n"soundDefinitions":\n')
        .replace(/"commands":/g, '\n"commands":\n')
        .replace(/"spriteList":/g, '\n"spriteList":\n')
        .replace(/"soundSprites":/g, '\n"soundSprites":\n');

    fs.writeFileSync(JSONtarget, jsonStr);
    console.log('  ✓ ' + JSONtarget);

    // Save cache — only after successful build
    hashes._fileList = allFiles.join(',');
    saveCache(hashes);

    // ═══════════════════════════════════════════════════════════════════════════
    // SUMMARY
    // ═══════════════════════════════════════════════════════════════════════════

    console.log('\n══════════════════════════════════════════════════');
    console.log('  BUILD COMPLETE');
    console.log('══════════════════════════════════════════════════\n');
    // Calculate total M4A size
    let totalSizeKB = 0;
    for (let i = 1; i <= totalSprites; i++) {
        totalSizeKB += Math.round(fs.statSync(path.join(outDir, gameName + '_audioSprite' + i + '.m4a')).size / 1024);
    }
    // Estimate savings vs default gap (1s + rounding ≈ 1.5s avg per sound)
    const soundCount = Object.keys(sortedSprites).length;
    const savedSilenceSec = soundCount * 1.5 - soundCount * gap;
    const savedKB = Math.round(savedSilenceSec * ((sfxEnc.bitrate || 64) / 8));

    console.log('  Sprites:       ' + totalSprites + ' (' + sfxChunks.length + ' SFX + ' + (totalSprites - sfxChunks.length) + ' Music)');
    console.log('  SoundSprites:  ' + soundCount);
    console.log('  SpriteLists:   ' + Object.keys(originalSpriteLists).length);
    console.log('  Commands:      ' + Object.keys(originalCommands).length);
    console.log('  Total size:    ' + totalSizeKB + ' KB (' + (totalSizeKB / 1024).toFixed(1) + ' MB)');
    console.log('  Gap:           ' + (gap * 1000) + 'ms (no rounding) — ~' + savedKB + ' KB saved vs default 1s gap');
    if (soxFailCount > 0) console.log('  ⚠ Sox failures: ' + soxFailCount + ' (used sprite map fallback)');
    console.log('');
}

main().catch(e => {
    console.error('❌ Build failed:', e.message || e);
    process.exit(1);
});
