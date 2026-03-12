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

const settings = JSON.parse(fs.readFileSync("settings.json"));
const spriteConfig = JSON.parse(fs.readFileSync("sprite-config.json"));
const audioSettings = new Map(Object.entries(settings || {}));

const JSONtemplate = audioSettings.get('JSONtemplate');
const JSONtarget = audioSettings.get('JSONtarget');
const gameProjectPath = audioSettings.get('gameProjectPath');
const SourceSoundDirectory = audioSettings.get('SourceSoundDirectory');

const pathArray = gameProjectPath.split("/");
const gameName = pathArray[pathArray.length - 1];

const outDir = './dist/soundFiles/';

// Read template sounds.json for commands, tags, spriteList, overlap etc.
const originalFile = JSON.parse(fs.readFileSync(JSONtemplate));
const originalSprites = originalFile.soundDefinitions.soundSprites || {};
const originalCommands = originalFile.soundDefinitions.commands || {};
const originalSpriteLists = originalFile.soundDefinitions.spriteList || {};

// Read all soundData_*.json files
const soundDataFiles = fs.readdirSync(outDir).filter(f => f.startsWith('soundData_') && f.endsWith('.json'));
console.log(`Found ${soundDataFiles.length} sprite data files`);

// Build a map: spriteId -> { soundId, startTime } from soundData files
const spriteDataMap = {};
const manifestEntries = [];

for (const dataFile of soundDataFiles) {
    const tierName = dataFile.replace('soundData_', '').replace('.json', '');
    const data = JSON.parse(fs.readFileSync(outDir + dataFile));
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

    // Add manifest entry
    manifestEntries.push({
        id: soundId,
        src: ["soundFiles/" + m4aFile]
    });

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
    const aIdx = spriteOrder.findIndex(tier => a.id.includes(tier));
    const bIdx = spriteOrder.findIndex(tier => b.id.includes(tier));
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
let processCount = 0;
let totalToProcess = 0;

// Get all WAV files to process
const wavFiles = fs.readdirSync(SourceSoundDirectory).filter(f => f.endsWith('.wav'));
const spriteListFiles = wavFiles.filter(f => f.endsWith('_SL.wav'));
const normalFiles = wavFiles.filter(f => !f.endsWith('_SL.wav'));

totalToProcess = normalFiles.length + spriteListFiles.length;
console.log(`Processing ${totalToProcess} sound entries...`);

// Process normal sounds
for (const file of normalFiles) {
    const soundName = file.replace('.wav', '');
    const entryName = 's_' + soundName;

    // Get data from sprite build
    const spriteData = spriteDataMap[soundName];
    if (!spriteData) {
        console.log(`WARNING: ${soundName} not found in any sprite data, skipping`);
        totalToProcess--;
        continue;
    }

    processCount++;

    // Get properties from original template
    const origEntry = originalSprites[entryName] || {};

    const newEntry = {
        soundId: spriteData.soundId,
        spriteId: soundName,
        startTime: spriteData.startTime,
        duration: spriteData.duration
    };

    // Preserve tags from template
    newEntry.tags = origEntry.tags || ["SoundEffects"];

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
            mySpriteListData.TracksMarkersName = x.data[0].TracksMarkersName;
            mySpriteListData.TracksMarkersStartTime = x.data[0].TracksMarkersStartTime;
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

    // Build final JSON
    const finalJson = {
        soundManifest: manifestEntries,
        soundDefinitions: {
            soundSprites: sortedSoundSprites,
            spriteList: originalSpriteLists,
            commands: originalCommands
        }
    };

    // Write output
    const formatted = formatJson(JSON.stringify(finalJson));
    fs.writeFileSync(JSONtarget, formatted);
    console.log(`\nWritten: ${JSONtarget}`);
    console.log(`  Manifest entries: ${manifestEntries.length}`);
    console.log(`  Sound sprites: ${Object.keys(sortedSoundSprites).length}`);
    console.log(`  Commands: ${Object.keys(originalCommands).length}`);

    // Clean up soundData files
    for (const dataFile of soundDataFiles) {
        fs.rmSync(outDir + dataFile);
    }
    console.log(`Cleaned up ${soundDataFiles.length} temporary soundData files`);
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
