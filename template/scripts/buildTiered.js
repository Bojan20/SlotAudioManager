#!/usr/bin/env node

/**
 * buildTiered.js — Tier-based audio sprite builder
 *
 * Reads sprite-config.json and builds audio sprites grouped by game state priority.
 * Music files are exported as standalone M4A files (not in sprites).
 * Supports incremental builds via SHA256 hash cache (.build-cache.json).
 * Sprite tiers are built in parallel for faster builds.
 */

const audiosprite = require('./customAudioSprite');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
// Read configs
let settings, spriteConfig;
try { settings = JSON.parse(fs.readFileSync("settings.json", "utf8")); }
catch (e) { console.error("Failed to read settings.json:", e.message); process.exit(1); }
try { spriteConfig = JSON.parse(fs.readFileSync("sprite-config.json", "utf8")); }
catch (e) { console.error("Failed to read sprite-config.json:", e.message); process.exit(1); }

// ── Select FFmpeg binary ─────────────────────────────────────────────────────
// Per-category encoder: each encoding entry has its own "encoder" field.
// If ANY category uses 'fdk', we need the FDK binary. Native categories
// get useNativeAac=true to force native codec even from the FDK binary.
const _fdkPath = process.env.FFMPEG_FDK_PATH;
const _fdkExists = _fdkPath && fs.existsSync(_fdkPath);
const _anyFdk = _fdkExists && Object.values(spriteConfig.encoding || {}).some(e => (e.encoder || spriteConfig.encoder) === 'fdk');
const pathToFFmpeg = _anyFdk ? _fdkPath : require('ffmpeg-static');

console.log("pathToFFmpeg ->", pathToFFmpeg);
if (_anyFdk) console.log("(FDK binary — per-category encoder selection)");

// ── Detect AAC encoder ───────────────────────────────────────────────────────
let encoderName = 'aac (native)';
try {
    const out = require('child_process').execFileSync(pathToFFmpeg, ['-encoders'], {
        timeout: 5000, maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe']
    }).toString();
    if (out.includes('libfdk_aac')) encoderName = 'libfdk_aac (Fraunhofer)';
} catch (e) {
    const fallback = (e.stderr ? e.stderr.toString() : '') + (e.stdout ? e.stdout.toString() : '');
    if (fallback.includes('libfdk_aac')) encoderName = 'libfdk_aac (Fraunhofer)';
}
console.log(`AAC encoder available: ${encoderName}`);

const gameProjectPath = settings.gameProjectPath;
if (!gameProjectPath) { console.error("gameProjectPath not set in settings.json"); process.exit(1); }
const pathArray = gameProjectPath.split(/[/\\]/);
const gameName = pathArray[pathArray.length - 1];

const sourceSndFiles = './sourceSoundFiles/';
const distDir = './dist';
const outDir = './dist/soundFiles/';
const cacheFile = '.build-cache.json';

// ── Hash helpers ──────────────────────────────────────────────────────────────
function fileHash(filePath) {
    try {
        return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').slice(0, 16);
    } catch { return null; }
}

function loadCache() {
    try { return JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { return {}; }
}

function saveCache(cache) {
    fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
}

// ── Source files ──────────────────────────────────────────────────────────────
if (!fs.existsSync(sourceSndFiles)) { console.error(`Source sound directory not found: ${sourceSndFiles}`); process.exit(1); }
const allWavFiles = fs.readdirSync(sourceSndFiles)
    .filter(f => f.endsWith('.wav') && !f.startsWith('.'))
    .map(f => f.replace('.wav', ''));

console.log(`Found ${allWavFiles.length} WAV files in source directory`);

const standaloneSounds = spriteConfig.standalone.sounds || [];
const streamingSounds = spriteConfig.streaming?.sounds || [];
const spriteGroups = spriteConfig.sprites;
const encoding = spriteConfig.encoding || {};
const _defaultEnc = { bitrate: 64, channels: 2, samplerate: 44100, encoder: 'native' };
if (!encoding.sfx) encoding.sfx = { ..._defaultEnc };
if (!encoding.music) encoding.music = { ..._defaultEnc };

// Log encoding settings so user can verify bitrate + encoder per category
if (encoding) {
  for (const [key, enc] of Object.entries(encoding)) {
    const encType = (enc.encoder || spriteConfig.encoder || 'native');
    const wantsFdk = encType === 'fdk';
    const encLabel = (wantsFdk && _fdkExists) ? 'FDK' : 'native';
    console.log(`Encoding ${key}: ${enc.keepOriginal ? '320 (keep original)' : enc.bitrate + 'kbps'} ${enc.channels}ch ${enc.samplerate}Hz [${encLabel}]`);
    if (wantsFdk && !_fdkExists) console.log(`  ⚠ ${key}: FDK requested but binary not found — falling back to native`);
  }
}

// Collect assigned sounds
const assignedSounds = new Set();
for (const tierConfig of Object.values(spriteGroups)) tierConfig.sounds.forEach(s => assignedSounds.add(s));
standaloneSounds.forEach(s => assignedSounds.add(s));
streamingSounds.forEach(s => assignedSounds.add(s));

// Auto-add unassigned to last tier
const unassigned = allWavFiles.filter(f => !assignedSounds.has(f));
if (unassigned.length > 0) {
    console.log(`\nWARNING: ${unassigned.length} sounds not assigned to any tier — adding to last tier:`);
    unassigned.forEach(s => console.log(`  - ${s}`));
    const lastTier = Object.keys(spriteGroups).at(-1);
    spriteGroups[lastTier].sounds.push(...unassigned);
}

// Warn missing files
for (const [tierName, tierConfig] of Object.entries(spriteGroups)) {
    const missing = tierConfig.sounds.filter(s => !allWavFiles.includes(s));
    if (missing.length > 0) {
        console.log(`NOTE: Tier '${tierName}' references ${missing.length} missing WAV files (skipped):`);
        missing.forEach(s => console.log(`  - ${s}`));
        tierConfig.sounds = tierConfig.sounds.filter(s => allWavFiles.includes(s));
    }
}
const missingStandalone = standaloneSounds.filter(s => !allWavFiles.includes(s));
if (missingStandalone.length > 0) {
    console.log(`NOTE: Standalone references ${missingStandalone.length} missing WAV files (skipped)`);
}
const missingStreaming = streamingSounds.filter(s => !allWavFiles.includes(s));
if (missingStreaming.length > 0) {
    console.log(`NOTE: Streaming references ${missingStreaming.length} missing WAV files (skipped)`);
}

// ── Incremental check ─────────────────────────────────────────────────────────
const cache = loadCache();
const newCache = {};

// Hash sprite-config.json so tier membership changes invalidate cache
const spriteConfigHash = fileHash('sprite-config.json') || 'none';
// Lightweight fingerprint: size+mtime (avoid hashing 130MB binary on every build)
let ffmpegHash = 'none';
try { const st = fs.statSync(pathToFFmpeg); ffmpegHash = `${st.size}_${st.mtimeMs}`; } catch {}
// Track encoder + binary so switching ffmpeg (native → FDK or version change) forces rebuild
const cacheHasEntries = Object.keys(cache).some(k => !k.startsWith('_'));
const encoderChanged = cacheHasEntries && (cache._encoderName !== encoderName || cache._ffmpegHash !== ffmpegHash);
const configChanged = cache._spriteConfigHash !== spriteConfigHash || encoderChanged;
if (encoderChanged) {
    console.log(`AAC encoder changed (${cache._encoderName || 'unknown'} -> ${encoderName}) — forcing full rebuild`);
} else if (configChanged && cache._spriteConfigHash) {
    console.log('sprite-config.json changed — forcing full rebuild');
}

function tierCacheKey(sounds) {
    return sounds.map(s => {
        const p = sourceSndFiles + s + '.wav';
        const h = fileHash(p);
        newCache[s] = h;
        return h;
    }).join('|');
}

function tierNeedsRebuild(tierName, sounds) {
    const key = tierCacheKey(sounds); // Always compute — populates newCache for save
    if (configChanged) return true;
    const outputPath = outDir + `${gameName}_${tierName}.m4a`;
    if (!fs.existsSync(outputPath)) return true;
    const cachedKey = sounds.map(s => cache[s]).join('|');
    return key !== cachedKey;
}

function standaloneNeedsRebuild(soundName) {
    const p = sourceSndFiles + soundName + '.wav';
    const h = fileHash(p);
    newCache[soundName] = h; // Always compute — populates newCache for save
    if (configChanged) return true;
    const outputPath = outDir + `${gameName}_${soundName}.m4a`;
    if (!fs.existsSync(outputPath)) return true;
    return cache[soundName] !== h;
}

function streamingNeedsRebuild(soundName) {
    const p = sourceSndFiles + soundName + '.wav';
    const h = fileHash(p);
    newCache[soundName] = h;
    if (configChanged) return true;
    const outputPath = outDir + `${soundName}.m4a`; // No gameName prefix for streaming
    if (!fs.existsSync(outputPath)) return true;
    return cache[soundName] !== h;
}

// ── Ensure output dirs ────────────────────────────────────────────────────────
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

// ── Build queue ───────────────────────────────────────────────────────────────
const buildQueue = [];

for (const [tierName, tierConfig] of Object.entries(spriteGroups)) {
    const sounds = tierConfig.sounds.filter(s => allWavFiles.includes(s));
    if (sounds.length === 0) { console.log(`Skipping tier '${tierName}' — no WAV files found`); continue; }

    let sortedSounds = sounds;
    if (tierConfig.sortOrder?.length > 0) {
        const ordered = tierConfig.sortOrder.filter(s => sounds.includes(s));
        const remaining = sounds.filter(s => !tierConfig.sortOrder.includes(s));
        sortedSounds = [...ordered, ...remaining];
    }

    if (!tierNeedsRebuild(tierName, sortedSounds)) {
        console.log(`[SKIP] Tier '${tierName}' — no changes detected`);
        continue;
    }

    buildQueue.push({
        type: 'sprite',
        name: tierName,
        tierConfig,
        files: sortedSounds.map(s => sourceSndFiles + s + '.wav'),
        outputName: `${gameName}_${tierName}`
    });
}

const existingStandalone = standaloneSounds.filter(s => allWavFiles.includes(s));
for (const soundName of existingStandalone) {
    if (!standaloneNeedsRebuild(soundName)) {
        console.log(`[SKIP] Standalone '${soundName}' — no changes detected`);
        continue;
    }
    buildQueue.push({
        type: 'standalone',
        name: soundName,
        files: [sourceSndFiles + soundName + '.wav'],
        outputName: `${gameName}_${soundName}`
    });
}

// Streaming music — builds individual M4A like standalone, manifest entry with loadType "S"
const existingStreaming = streamingSounds.filter(s => allWavFiles.includes(s));
if (existingStreaming.length > 0) {
    console.log(`\nStreaming: ${existingStreaming.length} music files (HTML5 Audio, loadType S)`);
}
for (const soundName of existingStreaming) {
    if (!streamingNeedsRebuild(soundName)) {
        console.log(`[SKIP] Streaming '${soundName}' — no changes detected`);
        continue;
    }
    buildQueue.push({
        type: 'streaming',
        name: soundName,
        files: [sourceSndFiles + soundName + '.wav'],
        outputName: soundName
    });
}

if (buildQueue.length === 0) {
    console.log('\nAll outputs up to date — nothing to rebuild.');
    saveCache({ ...cache, ...newCache, _spriteConfigHash: spriteConfigHash, _encoderName: encoderName, _ffmpegHash: ffmpegHash });
    process.exit(0);
}

console.log(`\nBuilding ${buildQueue.length} audio file(s) in parallel...`);
console.log("=".repeat(50));

// ── Parallel build ────────────────────────────────────────────────────────────
function buildOne(build, index, total) {
    return new Promise((resolve) => {
        const isStandalone = build.type === 'standalone' || build.type === 'streaming';
        const enc = isStandalone ? encoding.music : encoding.sfx;
        const gap = isStandalone ? 0 : spriteConfig.spriteGap;
        const typeLabel = build.type === 'streaming' ? 'Streaming' : build.type === 'standalone' ? 'Standalone' : 'Sprite';

        const encEncoder = enc.encoder || spriteConfig.encoder || 'native';
        const usesFdkForThis = (encEncoder === 'fdk') && _fdkExists;
        const encLabel = usesFdkForThis ? 'FDK' : 'native';
        console.log(`\n[${index + 1}/${total}] ${typeLabel}: ${build.name} (${build.files.length} file(s), ${enc.bitrate}kbps, ${encLabel})`);

        const opts = {
            output: outDir + build.outputName,
            format: 'howler2',
            export: 'm4a',
            bitrate: enc.keepOriginal ? 320 : enc.bitrate,
            gap,
            silence: 0,
            useNativeAac: !usesFdkForThis,
            logger: { debug: () => {}, info: console.log, log: console.log }
        };
        if (!enc.keepOriginal) {
            opts.channels = enc.channels;
            opts.samplerate = enc.samplerate;
        }

        audiosprite(pathToFFmpeg, build.files, opts, 0, (err, obj) => {
            if (err) {
                console.error(`ERROR building ${build.name}:`, err);
                return resolve(false);
            }

            // Write soundData for all types (streaming needs it for sprite definitions in sounds.json)
            fs.writeFileSync(outDir + "soundData_" + build.name + ".json", JSON.stringify(obj, null, 2));

            if (!isStandalone) {
                const m4aPath = outDir + build.outputName + ".m4a";
                if (fs.existsSync(m4aPath)) {
                    const sizeKB = Math.round(fs.statSync(m4aPath).size / 1024);
                    const maxKB = build.tierConfig.maxSizeKB;
                    const overLimit = sizeKB > maxKB;
                    console.log(`  -> ${build.outputName}.m4a (${sizeKB}KB / ${maxKB}KB limit) ${overLimit ? '⚠️  OVER LIMIT — consider moving some sounds to a lower-priority tier' : '✓ OK'}`);
                }
            } else {
                console.log(`  -> ${build.outputName}.m4a`);
            }

            resolve(true);
        });
    });
}

async function runAll() {
    const results = await Promise.all(buildQueue.map((b, i) => buildOne(b, i, buildQueue.length)));
    const failed = results.filter(r => !r).length;

    console.log("\n" + "=".repeat(50));
    console.log(`Build complete: ${results.filter(Boolean).length} succeeded, ${failed} failed`);

    // Only save cache for sounds that belong to successfully built tiers.
    // If a tier failed, do NOT update its hashes — next build must retry it.
    const failedTierNames = new Set(
        buildQueue.filter((_, i) => !results[i]).map(b => b.files.map(f => path.basename(f, '.wav'))).flat()
    );
    const safeNewCache = Object.fromEntries(
        Object.entries(newCache).filter(([sound]) => !failedTierNames.has(sound))
    );
    saveCache({ ...cache, ...safeNewCache, _spriteConfigHash: spriteConfigHash, _encoderName: encoderName, _ffmpegHash: ffmpegHash });
}

runAll();
