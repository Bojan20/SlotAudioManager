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
// SPRITE LIST GROUPING — keep sprite list members in the same Howl object
// ═══════════════════════════════════════════════════════════════════════════════

// Read sprite lists from template sounds.json → map sl_ list members to WAV paths.
// Returns { files: reordered[], groups: [{ startIdx, count, name }] }
// Files within a group are adjacent in the returned array so chunkBySize can
// treat them atomically.
function groupSpriteListFiles(files, parsedTemplate) {
    const spriteLists = parsedTemplate?.soundDefinitions?.spriteList || {};

    // basename (no ext) → full path lookup
    const pathByName = {};
    files.forEach(f => { pathByName[path.basename(f, '.wav')] = f; });

    // Map each WAV basename to its FIRST sprite list (a sound should belong to one list)
    const nameToList = {};       // basename → listName
    const listMembers = {};      // listName → [basenames that exist as WAVs in this file set]

    for (const [listName, list] of Object.entries(spriteLists)) {
        const items = Array.isArray(list) ? list : (list?.items || []);
        if (items.length < 2) continue; // single-item lists don't need grouping
        const members = [];
        for (const item of items) {
            const bn = item.replace(/^s_/, '');
            if (pathByName[bn]) {
                if (nameToList[bn]) {
                    console.warn('  ⚠ ' + bn + ' is in both ' + nameToList[bn] + ' and ' + listName + ' — using ' + nameToList[bn]);
                    continue;
                }
                nameToList[bn] = listName;
                members.push(bn);
            }
        }
        if (members.length >= 2) listMembers[listName] = members;
    }

    if (Object.keys(listMembers).length === 0) return { files, groups: [] };

    // Reorder: when we hit the first member of a group, pull all siblings next to it
    const used = new Set();
    const reordered = [];
    const groups = [];

    for (const f of files) {
        const bn = path.basename(f, '.wav');
        if (used.has(bn)) continue;

        const grp = nameToList[bn];
        if (grp && listMembers[grp]) {
            const startIdx = reordered.length;
            const siblings = listMembers[grp];
            for (const m of siblings) {
                reordered.push(pathByName[m]);
                used.add(m);
            }
            groups.push({ startIdx, count: siblings.length, name: grp });
            // Log once — helpful for debugging sprite assignment
            console.log('  Group: ' + grp + ' (' + siblings.length + ' files kept together)');
        } else {
            reordered.push(f);
            used.add(bn);
        }
    }

    return { files: reordered, groups };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHUNK BY SIZE (~30MB per sprite)
// ═══════════════════════════════════════════════════════════════════════════════

// groups: [{ startIdx, count, name }] — atomic units that must not be split.
function chunkBySize(files, maxMB, groups) {
    // Build index→group lookup
    const groupAt = {};
    for (const g of (groups || [])) groupAt[g.startIdx] = g;

    const chunks = [];
    let current = [];
    let currentSize = 0;
    let i = 0;

    while (i < files.length) {
        const g = groupAt[i];

        if (g) {
            // Atomic group — measure total size
            let groupSize = 0;
            for (let j = i; j < i + g.count; j++) {
                groupSize += fs.statSync(files[j]).size / (1024 * 1024);
            }

            // Start new chunk if group doesn't fit (but always accept into empty chunk)
            if (currentSize + groupSize >= maxMB && current.length > 0) {
                chunks.push(current);
                current = [];
                currentSize = 0;
            }

            // If group alone exceeds maxMB, warn but keep together — splitting is worse
            if (groupSize >= maxMB) {
                console.warn('  ⚠ Group ' + g.name + ' (' + groupSize.toFixed(1) + ' MB) exceeds chunk limit — keeping together');
            }

            for (let j = i; j < i + g.count; j++) current.push(files[j]);
            currentSize += groupSize;
            i += g.count;
        } else {
            const size = fs.statSync(files[i]).size / (1024 * 1024);
            if (currentSize + size >= maxMB && current.length > 0) {
                chunks.push(current);
                current = [];
                currentSize = 0;
            }
            current.push(files[i]);
            currentSize += size;
            i++;
        }
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
// CLEAN SUBLOADER FROM GAME REPO
// ═══════════════════════════════════════════════════════════════════════════════

// This build has NO loadType/SubLoaders — SubLoaderAutoInit would trigger
// non-existent SubLoaders. Remove it so it doesn't interfere.
function cleanGameRepoSubLoaderInit() {
    const gameRepoAbs = path.resolve(gameProjectPath);
    const gameSrcTs = path.join(gameRepoAbs, 'src', 'ts');
    if (!fs.existsSync(gameSrcTs)) return;

    const subLoaderTs = path.join(gameSrcTs, 'utils', 'SubLoaderAutoInit.ts');
    if (fs.existsSync(subLoaderTs)) {
        fs.rmSync(subLoaderTs);
        console.log('  Removed SubLoaderAutoInit.ts from game repo (not needed for this build)');
    }

    const mainTsPath = path.join(gameSrcTs, 'main.ts');
    if (fs.existsSync(mainTsPath)) {
        const mainContent = fs.readFileSync(mainTsPath, 'utf8');
        if (mainContent.includes('SubLoaderAutoInit') || mainContent.includes('SUB_LOADER_AUTO_INIT')) {
            const cleanedLines = mainContent.split('\n').filter(l =>
                !l.includes('SubLoaderAutoInit') && !l.includes('SUB_LOADER_AUTO_INIT')
            ).join('\n');
            fs.writeFileSync(mainTsPath, cleanedLines, 'utf8');
            console.log('  Removed SubLoaderAutoInit import from main.ts');
        }
    }
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

    // Compute SHA-256 for all WAVs + template sounds.json + sprite-config.json
    const hashes = {};
    allFiles.forEach(f => { hashes[f] = sha256(path.join(sourceDir, f)); });
    const templateHash = fs.existsSync(JSONtemplate) ? sha256(JSONtemplate) : '';
    const scHash = fs.existsSync('sprite-config.json') ? sha256('sprite-config.json') : '';
    const prevCache = loadCache();

    // Check if WAVs, template JSON, or sprite-config changed
    const filesChanged = allFiles.some(f => hashes[f] !== prevCache[f]);
    const structureChanged = (prevCache._fileList || '') !== allFiles.join(',');
    const jsonChanged = templateHash !== (prevCache._templateHash || '') || scHash !== (prevCache._scHash || '');

    // Ensure dist/soundFiles/ exists
    fs.mkdirSync(outDir, { recursive: true });

    // Clean stale files from OTHER build systems (e.g. tiered _loading/_main/_bonus from buildTiered.js)
    // Must happen BEFORE cache check — otherwise switching build systems leaves stale files
    const existingFiles = fs.readdirSync(outDir);
    let cleaned = 0;
    existingFiles.forEach(f => {
        if (f.startsWith('.')) return;
        if (f.endsWith('.m4a') || (f.startsWith('soundData') && f.endsWith('.json'))) {
            // Keep only our audioSprite files — remove everything else
            if (!f.match(/_audioSprite\d+\.m4a$/) && !f.match(/^soundData\d+\.json$/)) {
                try { fs.unlinkSync(path.join(outDir, f)); cleaned++; } catch {}
            }
        }
    });
    if (cleaned > 0) {
        console.log('Cleaned ' + cleaned + ' stale file(s) from other build systems');
        // Force rebuild since output files were removed
        if (!filesChanged && !structureChanged && !jsonChanged) {
            console.log('  Forcing rebuild after cleanup');
        }
    }

    if (!filesChanged && !structureChanged && !jsonChanged && cleaned === 0 && fs.existsSync(JSONtarget)) {
        console.log('\n✅ No changes detected — skipping build (cached)');
        console.log('   Delete dist/.build-cache.json to force rebuild\n');
        cleanGameRepoSubLoaderInit();
        process.exit(0);
    }

    // If only JSON changed (not WAVs), skip sprite rebuild — just regenerate sounds.json
    // BUT: only if dist/sounds.json exists and is valid (needed for reuse)
    let onlyJsonChanged = jsonChanged && !filesChanged && !structureChanged && cleaned === 0;
    if (onlyJsonChanged) {
        if (!fs.existsSync(JSONtarget)) {
            console.log('  dist/sounds.json missing — forcing full rebuild');
            onlyJsonChanged = false;
        } else {
            try { JSON.parse(fs.readFileSync(JSONtarget, 'utf8')); }
            catch { console.log('  dist/sounds.json corrupted — forcing full rebuild'); onlyJsonChanged = false; }
        }
    }

    const gap = spriteConfig?.spriteGap !== undefined ? spriteConfig.spriteGap : 0.05;
    let spriteData = [];

    if (onlyJsonChanged) {
        console.log('\n── JSON changed, WAVs unchanged — regenerating sounds.json only ──');
    } else {

    // ── Pre-check: sprite list members must not be split across SFX/Music pools ──
    let templateJsonForGroups;
    try { templateJsonForGroups = JSON.parse(fs.readFileSync(JSONtemplate, 'utf8')); }
    catch { templateJsonForGroups = null; }

    if (templateJsonForGroups) {
        const sl = templateJsonForGroups.soundDefinitions?.spriteList || {};
        const sfxSet = new Set(sfxFiles.map(f => 's_' + path.basename(f, '.wav')));
        const musicSet = new Set(musicFiles.map(f => 's_' + path.basename(f, '.wav')));
        let crossPoolErrors = 0;
        for (const [listName, list] of Object.entries(sl)) {
            const items = Array.isArray(list) ? list : (list?.items || []);
            if (items.length < 2) continue;
            const inSfx = items.filter(id => sfxSet.has(id));
            const inMusic = items.filter(id => musicSet.has(id));
            if (inSfx.length > 0 && inMusic.length > 0) {
                console.error('  ❌ spriteList ' + listName + ' has members in BOTH SFX and Music pools:');
                console.error('     SFX:   ' + inSfx.join(', '));
                console.error('     Music: ' + inMusic.join(', '));
                console.error('     These will end up on different Howl objects — rename files or adjust isMusicSound()');
                crossPoolErrors++;
            }
        }
        if (crossPoolErrors > 0) {
            console.error('\n❌ ' + crossPoolErrors + ' sprite list(s) split across SFX/Music — fix before building');
            process.exit(1);
        }
    }

    // ── Group sprite list members so they stay on the same Howl object ──
    console.log('── Sprite list grouping ──');
    const sfxGrouped = groupSpriteListFiles(sfxFiles, templateJsonForGroups);
    const musicGrouped = groupSpriteListFiles(musicFiles, templateJsonForGroups);
    if (sfxGrouped.groups.length === 0 && musicGrouped.groups.length === 0) {
        console.log('  No multi-member sprite lists found — no grouping needed');
    }

    // ── Build SFX sprites ──
    const sfxChunks = chunkBySize(sfxGrouped.files, 30, sfxGrouped.groups);
    const sfxEncEncoder = sfxEnc.encoder || 'native';
    const sfxUseNative = !((sfxEncEncoder === 'fdk') && fdkExists);

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
        const musicChunks = chunkBySize(musicGrouped.files, 30, musicGrouped.groups);
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

    // Clean stale audioSprite M4A with different sprite count (e.g. had 6, now has 4)
    const existingM4a = fs.readdirSync(outDir).filter(f => f.match(/_audioSprite\d+\.m4a$/));
    existingM4a.forEach(f => {
        try { fs.unlinkSync(path.join(outDir, f)); } catch {}
    });

    // Execute all builds in parallel — ffmpeg instances run concurrently
    const totalSprites = spriteNumber - 1;
    console.log('\n── Building ' + totalSprites + ' sprites in parallel ──');
    const buildStart = Date.now();

    spriteData = [];
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
    } // end sprite build block

    // ═══════════════════════════════════════════════════════════════════════════
    // GENERATE sounds.json — always runs (even when only JSON changed)
    // ═══════════════════════════════════════════════════════════════════════════

    console.log('\n── Generating sounds.json ──');

    // Read template for commands and spriteLists
    let templateJson;
    try { templateJson = JSON.parse(fs.readFileSync(JSONtemplate, 'utf8')); }
    catch { templateJson = { soundDefinitions: { commands: {}, soundSprites: {}, spriteList: {} } }; }

    const originalSprites = templateJson.soundDefinitions?.soundSprites || {};
    const originalCommands = templateJson.soundDefinitions?.commands || {};
    const originalSpriteLists = templateJson.soundDefinitions?.spriteList || {};

    let soundManifest, soundSprites;
    let soxFailCount = 0;

    if (onlyJsonChanged && fs.existsSync(JSONtarget)) {
        // JSON-only rebuild: reuse manifest + soundSprites from previous build
        const prevDist = JSON.parse(fs.readFileSync(JSONtarget, 'utf8'));
        soundManifest = prevDist.soundManifest || [];
        soundSprites = prevDist.soundDefinitions?.soundSprites || {};
        // Update tags/overlap from template + sanitize startTime/duration (fix legacy floats)
        Object.keys(soundSprites).forEach(key => {
            if (originalSprites[key]?.tags) soundSprites[key].tags = originalSprites[key].tags;
            if (originalSprites[key]?.overlap !== undefined) soundSprites[key].overlap = originalSprites[key].overlap;
            soundSprites[key].startTime = Math.round(soundSprites[key].startTime || 0);
            soundSprites[key].duration = Math.round(soundSprites[key].duration || 0);
        });
        console.log('  Reusing ' + soundManifest.length + ' sprites from previous build');
    } else {
        // Full rebuild: generate manifest + soundSprites from spriteData
        soundManifest = [];
        const totalSprites = spriteData.length;
        for (let i = 0; i < totalSprites; i++) {
            const num = spriteData[i].spriteNum;
            soundManifest.push({
                id: gameName + '_audioSprite' + num,
                src: ['soundFiles/' + gameName + '_audioSprite' + num + '.m4a']
            });
        }

        soundSprites = {};
        console.log('Processing ' + allFiles.length + ' sounds...');

        for (const { spriteNum, soundData } of spriteData) {
            const spriteMap = soundData.sprite || {};
            const soundId = gameName + '_audioSprite' + spriteNum;

            for (const [name, timings] of Object.entries(spriteMap)) {
                if (name === '__default') { /* skip */ }
                else {
                    const entryName = 's_' + name;
                    const startTime = Math.round(timings[0]);

                    const wavPath = path.join(sourceDir, name + '.wav');
                    let duration = Math.round(timings[1]);
                    if (fs.existsSync(wavPath)) {
                        const soxDur = await getSoxDuration(wavPath);
                        if (soxDur !== null) {
                            duration = soxDur;
                        } else {
                            soxFailCount++;
                            console.warn('  Using sprite map duration for ' + name);
                        }
                    } else {
                        console.warn('  WAV missing for ' + name + ' — using sprite map duration');
                    }

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

    // ── Validate sprite list cohesion — all members of a list must share the same soundId ──
    let listCohesionErrors = 0;
    Object.entries(originalSpriteLists).forEach(([listName, list]) => {
        const items = Array.isArray(list) ? list : (list?.items || []);
        if (items.length < 2) return;
        const soundIds = new Set();
        const missing = [];
        for (const item of items) {
            const sp = sortedSprites[item];
            if (sp) soundIds.add(sp.soundId);
            else missing.push(item);
        }
        if (soundIds.size > 1) {
            const detail = items.map(id => {
                const sp = sortedSprites[id];
                return sp ? id + '→' + sp.soundId : id + '→MISSING';
            }).join(', ');
            console.error('  ❌ spriteList ' + listName + ' has members on DIFFERENT Howl objects: ' + detail);
            console.error('     This causes playback failures when overlap:false — sounds on the same Howl steal each other\'s playback slot');
            listCohesionErrors++;
        } else if (soundIds.size === 1 && missing.length === 0) {
            console.log('  ✓ ' + listName + ' — all ' + items.length + ' members on ' + [...soundIds][0]);
        }
    });
    if (listCohesionErrors > 0) {
        console.error('\n❌ ' + listCohesionErrors + ' sprite list cohesion error(s) — this is a bug in chunk grouping');
        process.exit(1);
    }

    // ── Clean broken references — remove commands/spriteList items for deleted sounds ──
    const validSpriteIds = new Set(Object.keys(sortedSprites));
    const validListIds = new Set(Object.keys(originalSpriteLists));
    let cleanedCount = 0;

    // Clean spriteList items — remove references to sprites that don't exist
    const cleanedSpriteLists = {};
    Object.entries(originalSpriteLists).forEach(([listName, list]) => {
        if (!list) return;
        const items = Array.isArray(list) ? list : (list.items || []);
        const cleanItems = items.filter(id => {
            if (validSpriteIds.has(id)) return true;
            console.log('  - spriteList ' + listName + ': removed ' + id + ' (deleted)');
            cleanedCount++;
            return false;
        });
        if (cleanItems.length > 0) {
            if (Array.isArray(list)) {
                cleanedSpriteLists[listName] = cleanItems;
            } else {
                cleanedSpriteLists[listName] = { ...list, items: cleanItems };
            }
        } else {
            console.log('  - spriteList ' + listName + ': removed entirely (empty)');
            cleanedCount++;
        }
    });

    // Clean commands — remove steps that reference non-existent sprites/lists
    const cleanedCommands = {};
    Object.entries(originalCommands).forEach(([cmdName, steps]) => {
        if (!Array.isArray(steps)) { cleanedCommands[cmdName] = steps; return; }
        const cleanSteps = steps.filter(s => {
            if (!s) return false;
            if (s.spriteId && !validSpriteIds.has(s.spriteId)) {
                console.log('  - command ' + cmdName + ': removed step -> ' + s.spriteId + ' (deleted)');
                cleanedCount++;
                return false;
            }
            if (s.spriteListId && !cleanedSpriteLists[s.spriteListId]) {
                console.log('  - command ' + cmdName + ': removed step -> ' + s.spriteListId + ' (deleted)');
                cleanedCount++;
                return false;
            }
            return true;
        });
        cleanedCommands[cmdName] = cleanSteps;
    });

    // Second pass — remove Execute steps referencing emptied commands
    const emptiedCmds = new Set(Object.keys(cleanedCommands).filter(k => Array.isArray(cleanedCommands[k]) && cleanedCommands[k].length === 0));
    if (emptiedCmds.size > 0) {
        Object.entries(cleanedCommands).forEach(([cmdName, steps]) => {
            if (!Array.isArray(steps)) return;
            cleanedCommands[cmdName] = steps.filter(s => {
                if (s && s.commandId && emptiedCmds.has(s.commandId)) {
                    console.log('  - command ' + cmdName + ': removed Execute -> ' + s.commandId + ' (emptied)');
                    cleanedCount++;
                    return false;
                }
                return true;
            });
        });
        emptiedCmds.forEach(cmd => { console.log('  - command ' + cmd + ': emptied (all steps removed)'); });
    }

    if (cleanedCount > 0) console.log('  Cleaned ' + cleanedCount + ' broken references');
    else console.log('  * No broken references');

    // Assemble final JSON
    const outputJson = {
        soundManifest: soundManifest,
        soundDefinitions: {
            soundSprites: sortedSprites,
            spriteList: cleanedSpriteLists,
            commands: cleanedCommands
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
    hashes._templateHash = templateHash;
    hashes._scHash = scHash;
    saveCache(hashes);

    // ═══════════════════════════════════════════════════════════════════════════
    // SUMMARY
    // ═══════════════════════════════════════════════════════════════════════════

    console.log('\n══════════════════════════════════════════════════');
    console.log('  BUILD COMPLETE');
    console.log('══════════════════════════════════════════════════\n');
    // Calculate total M4A size
    let totalSizeKB = 0;
    const m4aCount = soundManifest.length;
    for (let i = 0; i < m4aCount; i++) {
        const m4aFile = path.join(outDir, path.basename(soundManifest[i].src[0]));
        if (fs.existsSync(m4aFile)) totalSizeKB += Math.round(fs.statSync(m4aFile).size / 1024);
    }
    // Estimate savings vs default gap (1s + rounding ≈ 1.5s avg per sound)
    const soundCount = Object.keys(sortedSprites).length;
    const savedSilenceSec = soundCount * 1.5 - soundCount * gap;
    const savedKB = Math.round(savedSilenceSec * ((sfxEnc.bitrate || 64) / 8));

    console.log('  Sprites:       ' + m4aCount);
    console.log('  SoundSprites:  ' + soundCount);
    console.log('  SpriteLists:   ' + Object.keys(cleanedSpriteLists).length);
    console.log('  Commands:      ' + Object.keys(cleanedCommands).length);
    console.log('  Total size:    ' + totalSizeKB + ' KB (' + (totalSizeKB / 1024).toFixed(1) + ' MB)');
    console.log('  Mode:          ' + (onlyJsonChanged ? 'JSON-only rebuild' : 'Full rebuild'));
    if (soxFailCount > 0) console.log('  Sox failures:  ' + soxFailCount + ' (used sprite map fallback)');
    console.log('');

    cleanGameRepoSubLoaderInit();
}

main().catch(e => {
    console.error('❌ Build failed:', e.message || e);
    process.exit(1);
});
