#!/usr/bin/env node

const audioProcess = { process: process.argv[2] };
console.log("audioProcess type - ", audioProcess.process);
const fs = require("fs");
const path = require("path");
const util = require("util");
const exec = require("child_process").exec;
var sox = require('sox');
const exiftool = require('node-exiftool');
const { version } = require("os");
const ep = new exiftool.ExiftoolProcess();
const settings = JSON.parse(fs.readFileSync("settings.json"));
const audioSettings = new Map(Object.entries(settings || {}));
let sndDataEntries;
let sndSpriteEntries;
const JSONtemplate = audioSettings.get('JSONtemplate');
const JSONtarget = audioSettings.get('JSONtarget');

if (audioProcess.process === "audioSprite") {
    const sndData = JSON.parse(fs.readFileSync("dist/soundFiles/soundData.json"));
    sndDataEntries = new Map(Object.entries(sndData || {}));
    sndSpriteEntries = sndDataEntries.get("sprite");

} else if (audioProcess.process === "audio") {
    //fs.rmSync("././dist/soundFiles/", { recursive: true });
    //fs.rmSync("././dist/sounds.json", { recursive: true })
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
        fs.rmSync("././dist/soundFiles/soundData.json", { recursive: true }) // uncomment to not delete soundData.json from export dist folder
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
            let src = [];
            let entry = {};
            src.push(exportSoundsDirectoryName + "/" + id + ".m4a");
            entry.id = id;
            entry.src = src;
            myNewSoundManifest.push(entry);
            console.log("Processcing manifest entry " + entry.src + " File: " + entry.id);
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
    fs.readdirSync(SourceSoundDirectory).forEach(element => {
        if (element.endsWith("_SL.wav")) {
            processSpriteList(element);
        } else if (element.endsWith(".wav")) {
            let soundId;
            let entryName;
            let spriteId
            if (audioProcess.process === "audio") {
                soundId = element.substring(0, element.length - 4);
                entryName = "s_" + soundId;
            } else if (audioProcess.process === "audioSprite") {
                spriteId = element.substring(0, element.length - 4);
                let srcPath = sndDataEntries.get("src")[0];
                let srcWords = srcPath.split("/");
                soundId = srcWords[4].substring(0, srcWords[4].length - 4);
                entryName = "s_" + spriteId;
            }
            let myNewEntry = (originalSprites[entryName] || {});
            let duration = 0;
            let startTime = 0;
            soundProcessCount++;
            console.log("Processing Sprite " + soundProcessCount + " File: " + element);
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
                duration = Math.round(results.sampleCount * 100000 / results.sampleRate) / 100;
                myNewEntry.soundId = soundId;                
                if (audioProcess.process === "audio") {
                    myNewEntry.spriteId = "s_"+ soundId;
                    myNewEntry.startTime = startTime;
                } else {            
                    myNewEntry.spriteId = spriteId;        
                    myNewEntry.startTime = sndSpriteEntries[spriteId][0];
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