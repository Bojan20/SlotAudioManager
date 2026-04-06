#!/usr/bin/env node
const audioProcess = { process: process.argv[2] };
//console.log("audioProcess type - ", audioProcess.process );
const fs = require("fs");
const path = require("path");
const util = require("util");
const exec = require("child_process").exec;
var sox = require('sox');
const exiftool = require('node-exiftool');
const { version } = require("os");
const { exit } = require("process");
const ep = new exiftool.ExiftoolProcess();
const settings = JSON.parse(fs.readFileSync("settings.json"));
const audioSettings = new Map(Object.entries(settings || {}));
let sndDataEntries;
let sndSpriteEntries;
const JSONtemplate = audioSettings.get('JSONtemplate');
const JSONtarget = audioSettings.get('JSONtarget');
const fileType = "json";

// Count only sprite soundData files (soundData1.json, soundData2.json, ...) — NOT standalone ones
const distFiles = fs.readdirSync("././dist/soundFiles/");
const spriteDataFiles = distFiles.filter(f => /^soundData\d+\.json$/.test(f)).sort();
const standaloneDataFiles = distFiles.filter(f => /^soundData_.+\.json$/.test(f));
const audioFileCount = spriteDataFiles.length;
console.log(" Sprite chunks: " + audioFileCount + ", Standalone: " + standaloneDataFiles.length);

if (audioProcess.process === "audioSprite") {
    let sndFilesData;
    if(audioFileCount > 0) {
        sndFilesData = [];
        sndDataEntries = [];
        sndSpriteEntries = [];
        for(let i=0; i<audioFileCount; i++) {
            const dataFile = "dist/soundFiles/soundData"+(i+1) +".json";
            console.log(" path - "+ dataFile);
            sndFilesData[i] = JSON.parse(fs.readFileSync(dataFile));
            sndDataEntries[i] = new Map(Object.entries(sndFilesData[i] || {}));
            sndSpriteEntries[i] = sndDataEntries[i].get("sprite");
        }
    } else {
        try {
            const sndData = JSON.parse(fs.readFileSync("dist/soundFiles/soundData.json"));
            sndDataEntries = new Map(Object.entries(sndData || {}));
            sndSpriteEntries = sndDataEntries.get("sprite");
        } catch {}
    }

} else if (audioProcess.process === "audio") {
    fs.rmSync("././dist/soundFiles/", { recursive: true });
    fs.rmSync("././dist/sounds.json", { recursive: true })
}

const SourceSoundDirectory = audioSettings.get('SourceSoundDirectory');
const DestinationSoundDirectory = audioSettings.get('DestinationSoundDirectory');
const exportSoundsDirectoryName = "soundFiles";
const DestinationAudioSpriteDirectory = audioSettings.get('DestinationAudioSpriteDirectory'); //new

let myNewJson = {};
let myNewSoundDefinitions = {};
let myNewSoundManifest = [];
let myNewSoundSprites = {};
let myNewSpriteLists = {};
let originalCommands;
let originalSprites;
let originalSpriteLists;
let soundProcessCount = 0;

async function processOriginalJson() {
    console.log("Reading template File: " + JSONtemplate);
    const originalFile = JSON.parse(fs.readFileSync(JSONtemplate));
    const originalJson = new Map(Object.entries(originalFile || {}));
    originalCommands = (originalJson.get('soundDefinitions').commands || {});
    originalSprites = (originalJson.get('soundDefinitions').soundSprites || {});
    originalSpriteLists = (originalJson.get('soundDefinitions').spriteList || {});

    myNewSoundDefinitions.soundSprites = {};
    myNewSoundDefinitions.spriteList = {};
    myNewSoundDefinitions.commands = originalCommands;
    processSourceManifest();
    processSourceSprites();
}

function finishProcessOrignalJson() {
    console.log("Writing File and exiting: " + JSONtarget);
    myNewJson.soundManifest = myNewSoundManifest;
    myNewSoundDefinitions.commands = originalCommands; //new
    myNewSoundDefinitions.spriteList = originalSpriteLists; // Allow temp spritelists to be copied over to exported sounds-audioSprite.json.
    /*myNewSoundDefinitions.spriteList = Object.keys(myNewSpriteLists).sort().reduce(
        (obj, key) => {
            obj[key] = myNewSpriteLists[key];
            return obj;
        }, {}
    );*/ //new commented 
    myNewSoundDefinitions.soundSprites = Object.keys(myNewSoundSprites).sort().reduce(
        (obj, key) => {
            obj[key] = myNewSoundSprites[key];
            return obj;
        }, {}
    );
    myNewJson.soundDefinitions = myNewSoundDefinitions;
    fs.writeFileSync(JSONtarget, formatJson(JSON.stringify(myNewJson)));

    if (audioProcess.process === "audioSprite") {
        const allFiles = fs.readdirSync("././dist/soundFiles/");
        for(let i = 0; i < allFiles.length ; i++) {
            //console.log( " all files " + allFiles[i]);
            if(allFiles[i].startsWith("soundData") ) {
                fs.rmSync("././dist/soundFiles/"+allFiles[i], { recursive: true }) // uncomment to not delete soundData.json from export dist folder
            }
        }
    }
    process.exit(0);
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
        .replace(/"soundSprites":/g, '\n"soundSprites":\n')
}

// Read sprite-config for standalone sounds, streaming sounds, and loadType
const spriteConfig = (() => { try { return JSON.parse(fs.readFileSync('sprite-config.json', 'utf8')); } catch { return null; } })();
const standaloneSounds = new Set(spriteConfig?.standalone?.sounds || []);
const streamingSounds = new Set(spriteConfig?.streaming?.sounds || []);
const standaloneSubLoaderId = spriteConfig?.standalone?.subLoaderId || null;

// gameName for stripping prefix from M4A filenames (e.g. "myGame_BaseMusic" → "BaseMusic")
const _gameProjectPath = audioSettings.get('gameProjectPath') || '';
const _gameName = _gameProjectPath.split(/[/\\]/).pop() || '';

function processSourceManifest() {
    console.log("creating manifest");
    let sourceDir;
    if (audioProcess.process === "audio") {
        sourceDir = SourceSoundDirectory;
    } else if (audioProcess.process === "audioSprite") {
        sourceDir = DestinationAudioSpriteDirectory;
    }
    fs.readdirSync(sourceDir).forEach(element => {
        let myNewEntry = {};
        if (element.endsWith(".wav")) {
            let id = element.substring(0, element.length - 4);
            let src = [];
            let entry = {};
            src.push(exportSoundsDirectoryName + "/" + id + ".ogg");
            src.push(exportSoundsDirectoryName + "/" + id + ".aac");
            entry.id = id;
            entry.src = src;
            myNewSoundManifest.push(entry);
            console.log("Processcing manifest entry " + entry.src + " File: " + entry.id);
        } else if (element.endsWith(".m4a")) {
            let id = element.substring(0, element.length - 4);
            const baseName = _gameName && id.startsWith(_gameName + '_') ? id.slice(_gameName.length + 1) : id;
            const isStreaming = streamingSounds.has(baseName) || streamingSounds.has(id);
            let src = [];
            let entry = {};
            src.push(exportSoundsDirectoryName + "/" + id + ".m4a");
            entry.id = id;
            entry.src = src;
            if (isStreaming) {
                entry.loadType = "S";
                console.log("Streaming manifest: " + id + " (loadType S)");
            } else {
                console.log("Processcing manifest entry " + entry.src + " File: " + entry.id);
            }
            myNewSoundManifest.push(entry);
        } else {
            console.log("problem with file " + element + " not ending with .wav");
        }
    });
}

function processSpriteList(element) {
    let soundId;
    if (audioProcess.process === "audio") {
        soundId = element.substring(0, element.length - 7);
    } else if (audioProcess.process === "audioSprite") {
        let srcPath = sndDataEntries.get("src")[0];
        let srcWords = srcPath.split("/");
        soundId = srcWords[3].substring(0, srcWords[3].length - 4);
    }
    //let soundId = element.substring(0, element.length - 7);
    let duration = [];
    let startTime = [];
    let spriteNames = [];
    let totalDuration = 0;
    soundProcessCount++;
    console.log("Processcing spritelist " + soundProcessCount + " File: " + element);
    sox.identify(SourceSoundDirectory + "/" + element, async function(err, results) {
        /* results looks like:
        {
            format: 'wav',
            duration: 1.5,
            sampleCount: 66150,
            channelCount: 1,
            bitRate: 722944,
            sampleRate: 44100,
        }
        */
        totalDuration = Math.round(results.sampleCount * 100000 / results.sampleRate) / 100;
        let mySpriteListData = await extractSpriteListData(SourceSoundDirectory + "/" + element);
        if (mySpriteListData.TracksMarkersName) {
            for (let i = 0; i < mySpriteListData.TracksMarkersName.length; i++) {
                if (mySpriteListData.TracksMarkersName[i].startsWith('Tempo:')) {} else {
                    spriteNames.push(mySpriteListData.TracksMarkersName[i]);
                    startTime.push(Math.round(mySpriteListData.TracksMarkersStartTime[i] * 100000 / results.sampleRate) / 100);
                }
            }
            for (let i = 0; i < spriteNames.length; i++) {
                if (i < (spriteNames.length - 1)) {
                    duration.push(Math.round((startTime[i + 1] - startTime[i]) * 100) / 100);
                } else {
                    duration.push(Math.round((totalDuration - startTime[i]) * 100) / 100);
                }
            }
        }
        //build spritelist
        let spriteListName = 'sl_' + soundId;
        let myNewSpriteList = originalSpriteLists[spriteListName] || {};
        myNewSpriteList.items = [];
        if (!myNewSpriteList.type) {
            myNewSpriteList.type = "random";
        }
        if (!myNewSpriteList.overlap) {
            myNewSpriteList.overlap = "true";
        }
        spriteNames.forEach(element => {
            myNewSpriteList.items.push('s_' + element);
        });
        //add sprites
        for (let i = 0; i < spriteNames.length; i++) {
            let entryName = "s_" + element;
            let myNewEntry = originalSprites[entryName] || {};
            myNewEntry.spriteId = 's_' + spriteNames[i];
            if (audioProcess.process === "audio") {
                myNewEntry.soundId = soundId + '_SL';
            } else {
                myNewEntry.soundId = soundId;
            }
            myNewEntry.startTime = startTime[i];
            myNewEntry.duration = duration[i];
            myNewEntry.tags = originalSprites[myNewEntry.spriteId] ? originalSprites[myNewEntry.spriteId].tags || ["SoundEffects"] : ["SoundEffects"];
            myNewSoundSprites[myNewEntry.spriteId] = myNewEntry;
        }

        myNewSpriteLists[spriteListName] = myNewSpriteList;

        soundProcessCount--;
        if (soundProcessCount <= 0) {
            finishProcessOrignalJson();
        }
    });
}

async function processSourceSprites() {
    fs.readdirSync(SourceSoundDirectory).forEach(async element => {
        // Skip standalone and streaming sounds — they have their own M4A, no sprite timing
        const baseName = element.replace('.wav', '');
        if (streamingSounds.has(baseName)) {
            console.log("Processing streaming sprite: " + baseName + " (HTML5 Audio, loadType S)");
            // Add streaming sprite entry with full duration from soundData
            // soundId points to first non-streaming manifest entry so setSounds() doesn't crash
            const sdFileStr = "dist/soundFiles/soundData_" + baseName + ".json";
            if (fs.existsSync(sdFileStr)) {
                try {
                    const sd = JSON.parse(fs.readFileSync(sdFileStr, 'utf8'));
                    const sprite = sd.sprite || {};
                    const spriteKey = Object.keys(sprite)[0];
                    if (spriteKey) {
                        const entryName = "s_" + baseName;
                        myNewSoundSprites[entryName] = {
                            soundId: baseName,
                            spriteId: baseName,
                            startTime: sprite[spriteKey][0] || 0,
                            duration: sprite[spriteKey][1] || 0,
                            tags: originalSprites[entryName]?.tags || ["Music"],
                            overlap: originalSprites[entryName]?.overlap ?? false,
                        };
                    }
                } catch (e) { console.log("  Warning: could not read " + sdFileStr); }
            }
            return;
        }
        if (standaloneSounds.has(baseName)) {
            console.log("Skipping standalone: " + baseName);
            // Add standalone sprite entry with full duration from soundData
            const sdFile = "dist/soundFiles/soundData_" + baseName + ".json";
            if (fs.existsSync(sdFile)) {
                try {
                    const sd = JSON.parse(fs.readFileSync(sdFile, 'utf8'));
                    const sprite = sd.sprite || {};
                    const spriteKey = Object.keys(sprite)[0];
                    if (spriteKey) {
                        const entryName = "s_" + baseName;
                        myNewSoundSprites[entryName] = {
                            soundId: baseName,
                            spriteId: baseName,
                            startTime: sprite[spriteKey][0] || 0,
                            duration: sprite[spriteKey][1] || 0,
                            tags: originalSprites[entryName]?.tags || ["Music"],
                            overlap: originalSprites[entryName]?.overlap ?? false,
                        };
                    }
                } catch (e) { console.log("  Warning: could not read " + sdFile); }
            }
            return;
        }
        if (element.endsWith("_SL.wav")) {
            processSpriteList(element);
        } else if (element.endsWith(".wav")) {
            let soundId;
            let entryName;
            let spriteId;           
            if (audioProcess.process === "audio") {
                soundId = element.substring(0, element.length - 4);
                entryName = "s_" + soundId;
            } else if (audioProcess.process === "audioSprite") {
                if(audioFileCount > 0 ) {
                    spriteId = element.substring(0, element.length - 4);                    
                    let srcPath;                    
                    const fileNum = await getIncrementValue(spriteId);
                    //console.log(" fileNum =>  " + fileNum + " srcPath =>" + sndDataEntries[fileNum].get("src")[0]);
                    srcPath = sndDataEntries[fileNum].get("src")[0];                    
                    let srcWords = srcPath.split("/");
                    soundId = srcWords[4].substring(0, srcWords[4].length - 4);
                    entryName = "s_" + spriteId;

                } else {
                    spriteId = element.substring(0, element.length - 4);
                    let srcPath = sndDataEntries.get("src")[0];
                    let srcWords = srcPath.split("/");
                    soundId = srcWords[4].substring(0, srcWords[4].length - 4);
                    entryName = "s_" + spriteId;
                }                
            }
            let myNewEntry = (originalSprites[entryName] || {});
            let duration = 0;
            let startTime = 0;
            soundProcessCount++;            
            console.log("Processing Sprite " + soundProcessCount + " File: " + element );
            sox.identify(SourceSoundDirectory + '/' + element, async function(err, results) {
                /* results looks like:
                {
                  format: 'wav',
                  duration: 1.5,
                  sampleCount: 66150,
                  channelCount: 1,
                  bitRate: 722944,
                  sampleRate: 44100,
                }
                */
                duration = Math.round(results.sampleCount * 100000 / results.sampleRate) / 100;                
                let increment1 = 0;
                //console.log("SourceSoundDirectory" + SourceSoundDirectory + "element" + element + " duration - " + duration + " Increment = " + increment1);
                myNewEntry.soundId = soundId;                
                if (audioProcess.process === "audio") {
                    myNewEntry.spriteId = "s_"+ soundId;
                    myNewEntry.startTime = startTime;
                } else {
                    if(audioFileCount > 0) {
                        //Todo - Refactor this part
                        myNewEntry.spriteId = spriteId;
                        const filenumber = await getIncrementValue(spriteId);
                        myNewEntry.startTime = sndSpriteEntries[filenumber][spriteId][0];

                    } else {
                        myNewEntry.spriteId = spriteId;        
                        myNewEntry.startTime = sndSpriteEntries[spriteId][0];
                    }
                }
                myNewEntry.duration = duration;
                myNewEntry.tags = originalSprites[entryName] ? originalSprites[entryName].tags || ["SoundEffects"] : ["SoundEffects"];
                myNewSoundSprites[entryName] = myNewEntry;
                soundProcessCount--;
                if (soundProcessCount <= 0) {
                    finishProcessOrignalJson();
                }
            });


        } else {
            console.log("problem with file " + element + " not ending with .wav, skipping");
        }
    });
}

async function getIncrementValue(spriteId) {
    let count = 0;
    //console.log( "hasOwnProperty " + Object(sndSpriteEntries[count]).hasOwnProperty(spriteId) + " in Count => " + count);
    if(Object(sndSpriteEntries[count]).hasOwnProperty(spriteId) === true) {
        return count;
    }
    while((Object(sndSpriteEntries[count]).hasOwnProperty(spriteId) === false)) {
        count++;
        if((Object(sndSpriteEntries[count]).hasOwnProperty(spriteId) === true)) {
            //console.log( "Find in fileCount=> " + count + " spriteId => " +  sndDataEntries[count].get("src")[0]);
            return count;
        }
    }
}

async function extractSpriteListData(element) {
    let mySpriteListData = {};
    await ep
        .open()
        // display pid
        .then(() => ep.readMetadata(element, ['-s3']))
        .then((x) => {
            mySpriteListData.TracksMarkersName = x.data[0].TracksMarkersName;
            mySpriteListData.TracksMarkersStartTime = x.data[0].TracksMarkersStartTime;
        }, console.error)
        .then(() => console.log('Loaded metadata: ' + element))
        .then(() => {
            if (ep.isOpen)
                ep.close();
        })
        .catch(console.error);
    return mySpriteListData;
}

function processSourceSounds() {
    fs.readdirSync(SourceSoundDirectory).forEach(element => {
        sox.identify(SourceSoundDirectory + '/' + element, function(err, results) {
            /* results looks like:
            {
              format: 'wav',
              duration: 1.5,
              sampleCount: 66150,
              channelCount: 1,
              bitRate: 722944,
              sampleRate: 44100,
            }
            */
            console.log("file: " + element + " " + JSON.stringify(results));
        });
    });
}

processOriginalJson();