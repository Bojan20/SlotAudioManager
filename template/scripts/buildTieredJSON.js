#!/usr/bin/env node

/**
 * buildTieredJSON.js — Generates sounds.json from tiered sprite build output
 *
 * Reads soundData_*.json files from dist/soundFiles/ and the template sounds.json
 * to produce the final dist/sounds.json with correct soundId mappings, startTimes,
 * and durations for each tier-based sprite.
 */

const fs = require('fs');
const path = require('path');
const sox = require('sox');
const exiftool = require('node-exiftool');
const ep = new exiftool.ExiftoolProcess();

let settings, spriteConfig;
try { settings = JSON.parse(fs.readFileSync("settings.json", "utf8")); }
catch (e) { console.error("Failed to read settings.json:", e.message); process.exit(1); }
try { spriteConfig = JSON.parse(fs.readFileSync("sprite-config.json", "utf8")); }
catch (e) { console.error("Failed to read sprite-config.json:", e.message); process.exit(1); }
const audioSettings = new Map(Object.entries(settings || {}));

const JSONtemplate = audioSettings.get('JSONtemplate');
const JSONtarget = audioSettings.get('JSONtarget');
const gameProjectPath = audioSettings.get('gameProjectPath');
const SourceSoundDirectory = audioSettings.get('SourceSoundDirectory');

if (!gameProjectPath) { console.error("gameProjectPath not set in settings.json"); process.exit(1); }
const pathArray = gameProjectPath.split(/[/\\]/);
const gameName = pathArray[pathArray.length - 1];

const outDir = './dist/soundFiles/';

// Read template sounds.json for commands, tags, spriteList, overlap etc.
if (!JSONtemplate || !fs.existsSync(JSONtemplate)) { console.error(`Template JSON not found: ${JSONtemplate}`); process.exit(1); }
let originalFile;
try { originalFile = JSON.parse(fs.readFileSync(JSONtemplate)); }
catch (e) { console.error(`Failed to parse template JSON: ${e.message}`); process.exit(1); }
const originalSprites = originalFile.soundDefinitions.soundSprites || {};
const originalCommands = originalFile.soundDefinitions.commands || {};
const originalSpriteLists = originalFile.soundDefinitions.spriteList || {};

if (!fs.existsSync(outDir)) {
    console.error(`Output directory not found: ${outDir}\nRun 'npm run build' first to generate sprite files.`);
    process.exit(1);
}

// Read all soundData_*.json files
const soundDataFiles = fs.readdirSync(outDir).filter(f => f.startsWith('soundData_') && f.endsWith('.json'));
console.log(`Found ${soundDataFiles.length} sprite data files`);

if (soundDataFiles.length === 0) {
    console.error('No soundData files found in ' + outDir + ' — run build first to generate sprite data.');
    process.exit(1);
}

// Build a map: spriteId -> { soundId, startTime } from soundData files
const spriteDataMap = {};
const manifestEntries = [];
const standaloneSounds = spriteConfig.standalone?.sounds || [];

for (const dataFile of soundDataFiles) {
    const tierName = dataFile.replace('soundData_', '').replace('.json', '');
    let data;
    try { data = JSON.parse(fs.readFileSync(outDir + dataFile, 'utf8')); }
    catch (e) { console.error(`Failed to parse ${dataFile}: ${e.message}, skipping`); continue; }
    const spriteMap = data.sprite || {};
    const srcArray = data.src || [];

    // Determine M4A filename from src
    let m4aFile = null;
    for (const src of srcArray) {
        if (src.endsWith('.m4a')) {
            m4aFile = path.basename(src);
            break;
        }
    }

    if (!m4aFile) {
        console.log(`WARNING: No .m4a source found in ${dataFile}, skipping`);
        continue;
    }

    const soundId = m4aFile.replace('.m4a', '');

    // Build manifest entry — add loadType (SubLoader ID) if tier has subLoaderId defined
    // Standalone sounds (music) never get loadType — they're always part of main load
    const tierConfig = spriteConfig.sprites[tierName];
    const subLoaderId = tierConfig?.subLoaderId;
    const isStandaloneTier = standaloneSounds.includes(tierName);

    const manifestEntry = { id: soundId, src: ["soundFiles/" + m4aFile] };
    if (subLoaderId && !isStandaloneTier) {
        manifestEntry.loadType = subLoaderId;
        const unloadable = tierConfig?.unloadable === true;
        if (unloadable) manifestEntry.unloadable = true;
        console.log(`  [SubLoader "${subLoaderId}"] ${soundId} — deferred${unloadable ? ', unloadable after use' : ''}`);
    }
    manifestEntries.push(manifestEntry);

    // Map each sound in this sprite
    for (const [spriteName, spriteInfo] of Object.entries(spriteMap)) {
        spriteDataMap[spriteName] = {
            soundId: soundId,
            startTime: spriteInfo[0],
            duration: spriteInfo[1]
        };
    }
}

// Sort manifest by sprite config priority
const spriteOrder = Object.keys(spriteConfig.sprites);
const standaloneNames = spriteConfig.standalone.sounds || [];

manifestEntries.sort((a, b) => {
    const aIdx = spriteOrder.findIndex(tier => a.id.endsWith('_' + tier));
    const bIdx = spriteOrder.findIndex(tier => b.id.endsWith('_' + tier));
    const aStandalone = standaloneNames.some(s => a.id.includes(s));
    const bStandalone = standaloneNames.some(s => b.id.includes(s));

    // Sprite tiers first (by priority), then standalone
    if (!aStandalone && !bStandalone) return aIdx - bIdx;
    if (aStandalone && bStandalone) return 0;
    if (aStandalone) return 1;
    return -1;
});

// Build soundSprites
const newSoundSprites = {};

if (!fs.existsSync(SourceSoundDirectory)) {
    console.error(`Source sound directory not found: ${SourceSoundDirectory}`);
    process.exit(1);
}

// Get all WAV files to process
const wavFiles = fs.readdirSync(SourceSoundDirectory).filter(f => f.endsWith('.wav'));
const spriteListFiles = wavFiles.filter(f => f.endsWith('_SL.wav'));
const normalFiles = wavFiles.filter(f => !f.endsWith('_SL.wav'));

console.log(`Processing ${normalFiles.length + spriteListFiles.length} sound entries...`);

// Process normal sounds
for (const file of normalFiles) {
    const soundName = file.replace('.wav', '');
    const entryName = 's_' + soundName;

    // Get data from sprite build
    const spriteData = spriteDataMap[soundName];
    if (!spriteData) {
        console.log(`WARNING: ${soundName} not found in any sprite data, skipping`);
        continue;
    }

    // Get properties from original template
    const origEntry = originalSprites[entryName] || {};

    const newEntry = {
        soundId: spriteData.soundId,
        spriteId: soundName,
        startTime: spriteData.startTime,
        duration: spriteData.duration
    };

    // Preserve tags from template; standalone sounds get Music tag, everything else gets SFX tag
    const isStandaloneSound = standaloneSounds.includes(soundName);
    newEntry.tags = origEntry.tags || (isStandaloneSound ? spriteConfig.musicTags || ["Music"] : spriteConfig.sfxTags || ["SoundEffects"]);

    // Preserve overlap from template
    if (origEntry.overlap !== undefined) {
        newEntry.overlap = origEntry.overlap;
    }

    newSoundSprites[entryName] = newEntry;
}

// Process sprite list files (_SL.wav)
async function processSpriteListFile(file) {
    const soundName = file.replace('_SL.wav', '');
    const entryName = 's_' + file.replace('.wav', '');

    return new Promise((resolve, reject) => {
        sox.identify(SourceSoundDirectory + '/' + file, async function(err, results) {
            if (err) {
                console.log(`WARNING: Could not identify ${file}, skipping`);
                resolve();
                return;
            }

            const totalDuration = Math.round(results.sampleCount * 100000 / results.sampleRate) / 100;

            try {
                const mySpriteListData = await extractSpriteListData(SourceSoundDirectory + '/' + file);

                if (mySpriteListData.TracksMarkersName) {
                    const spriteNames = [];
                    const startTimes = [];
                    const durations = [];

                    for (let i = 0; i < mySpriteListData.TracksMarkersName.length; i++) {
                        if (!mySpriteListData.TracksMarkersName[i].startsWith('Tempo:')) {
                            spriteNames.push(mySpriteListData.TracksMarkersName[i]);
                            startTimes.push(Math.round(mySpriteListData.TracksMarkersStartTime[i] * 100000 / results.sampleRate) / 100);
                        }
                    }

                    for (let i = 0; i < spriteNames.length; i++) {
                        if (i < spriteNames.length - 1) {
                            durations.push(Math.round((startTimes[i + 1] - startTimes[i]) * 100) / 100);
                        } else {
                            durations.push(Math.round((totalDuration - startTimes[i]) * 100) / 100);
                        }
                    }

                    // Find which sprite this _SL file belongs to
                    const spriteData = spriteDataMap[file.replace('.wav', '')];
                    const soundId = spriteData ? spriteData.soundId : soundName;

                    for (let i = 0; i < spriteNames.length; i++) {
                        const spriteEntryName = 's_' + spriteNames[i];
                        const origEntry = originalSprites[spriteEntryName] || {};

                        newSoundSprites[spriteEntryName] = {
                            soundId: soundId,
                            spriteId: spriteNames[i],
                            startTime: startTimes[i],
                            duration: durations[i],
                            tags: origEntry.tags || ["SoundEffects"]
                        };

                        if (origEntry.overlap !== undefined) {
                            newSoundSprites[spriteEntryName].overlap = origEntry.overlap;
                        }
                    }
                }
            } catch (e) {
                console.log(`WARNING: Error processing sprite list ${file}:`, e.message);
            }

            resolve();
        });
    });
}

async function extractSpriteListData(element) {
    let mySpriteListData = {};
    await ep
        .open()
        .then(() => ep.readMetadata(element, ['-s3']))
        .then((x) => {
            if (x.data && x.data[0]) {
                mySpriteListData.TracksMarkersName = x.data[0].TracksMarkersName;
                mySpriteListData.TracksMarkersStartTime = x.data[0].TracksMarkersStartTime;
            }
        }, console.error)
        .then(() => {
            if (ep.isOpen) ep.close();
        })
        .catch(console.error);
    return mySpriteListData;
}

async function buildFinalJSON() {
    // Process sprite list files
    for (const file of spriteListFiles) {
        await processSpriteListFile(file);
    }

    // Sort soundSprites alphabetically
    const sortedSoundSprites = Object.keys(newSoundSprites).sort().reduce((obj, key) => {
        obj[key] = newSoundSprites[key];
        return obj;
    }, {});

    // Strip broken references — commands/spriteList referencing sounds that no longer exist
    // (happens when sounds are deleted from sourceSoundFiles without updating sounds.json)
    const validSpriteKeys = new Set(Object.keys(sortedSoundSprites));
    const validSoundIds = new Set(manifestEntries.map(m => m.id));

    let removedSteps = 0, removedCmds = 0, removedListEntries = 0;

    const cleanedCommands = {};
    for (const [cmdName, steps] of Object.entries(originalCommands)) {
        const arr = Array.isArray(steps) ? steps : [steps];
        const clean = arr.filter(step => {
            if (!step) return false;
            if (step.spriteId && !validSpriteKeys.has(step.spriteId)) { removedSteps++; return false; }
            if (step.soundId && !validSoundIds.has(step.soundId)) { removedSteps++; return false; }
            return true;
        }).map(step => {
            const s = { ...step };
            // Normalize cancelDelay — SoundPlayer uses === true, string "true" breaks playback
            if (s.cancelDelay === 'true') s.cancelDelay = true;
            else if (s.cancelDelay !== true) delete s.cancelDelay;
            // overlap does NOT belong in commands — only in soundSprites
            delete s.overlap;
            return s;
        });
        cleanedCommands[cmdName] = clean;
    }

    const cleanedSpriteLists = {};
    for (const [k, val] of Object.entries(originalSpriteLists)) {
        // Support both array format ["id1","id2"] and object format {items:["id1","id2"], type, overlap}
        const isObj = val && !Array.isArray(val) && Array.isArray(val.items);
        const arr = isObj ? val.items : (Array.isArray(val) ? val : []);
        const clean = arr.filter(id => { if (!validSpriteKeys.has(id)) { removedListEntries++; return false; } return true; });
        if (clean.length > 0) cleanedSpriteLists[k] = isObj ? { ...val, items: clean } : clean;
        else removedListEntries++;
    }

    if (removedSteps > 0 || removedCmds > 0 || removedListEntries > 0) {
        console.log(`\nAuto-cleaned broken references (sounds deleted from project):`);
        if (removedSteps) console.log(`  Removed ${removedSteps} command step(s) referencing missing sounds`);
        if (removedCmds) console.log(`  Removed ${removedCmds} empty command(s)`);
        if (removedListEntries) console.log(`  Removed ${removedListEntries} broken spriteList entry/entries`);
    }

    // Build final JSON
    const finalJson = {
        soundManifest: manifestEntries,
        soundDefinitions: {
            soundSprites: sortedSoundSprites,
            spriteList: cleanedSpriteLists,
            commands: cleanedCommands
        }
    };

    // Write output
    const formatted = formatJson(JSON.stringify(finalJson));
    const targetDir = path.dirname(JSONtarget);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(JSONtarget, formatted);
    console.log(`\nWritten: ${JSONtarget}`);
    console.log(`  Manifest entries: ${manifestEntries.length}`);
    console.log(`  Sound sprites: ${Object.keys(sortedSoundSprites).length}`);
    console.log(`  Commands: ${Object.keys(cleanedCommands).length}`);

    // Keep soundData files — needed for incremental builds (cached tiers skip audiosprite,
    // so these files are the only source of sprite timing for buildTieredJSON.js)
}

function formatJson(input) {
    return input
        .replace(/]},/g, ']},\n')
        .replace(/}],/g, '}],\n')
        .replace(/},"/g, '},\n"')
        .replace(/"soundManifest":/g, '\n"soundManifest":\n')
        .replace(/"soundDefinitions":/g, '\n"soundDefinitions":\n')
        .replace(/"commands":/g, '\n"commands":\n')
        .replace(/"spriteList":/g, '\n"spriteList":\n')
        .replace(/"soundSprites":/g, '\n"soundSprites":\n');
}

buildFinalJSON();
