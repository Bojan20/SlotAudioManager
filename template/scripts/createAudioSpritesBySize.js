const audiosprite = require('./customAudioSprite');
const fs = require('fs');
const path = require('path');
const pathToFFmpeg = require('ffmpeg-static');

console.log("pathToFFmpeg ->", pathToFFmpeg);

const settings = JSON.parse(fs.readFileSync("settings.json"));
const audioSettings = new Map(Object.entries(settings || {}));
const gameProjectPath = audioSettings.get('gameProjectPath');

const distDir = '././dist';
const sourceSndFiles = '././sourceSoundFiles/';
const outDir = '././dist/soundFiles/';

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// Read sprite-config for encoding and standalone
const spriteConfig = (() => { try { return JSON.parse(fs.readFileSync('sprite-config.json', 'utf8')); } catch { return null; } })();
const sfxEnc = spriteConfig?.encoding?.sfx || {};
const musicEnc = spriteConfig?.encoding?.music || {};
const standaloneSounds = new Set(spriteConfig?.standalone?.sounds || []);

// Separate files: standalone music vs sprite SFX
const allFiles = fs.readdirSync(sourceSndFiles).filter(f => f.endsWith('.wav')).sort();
const spriteFiles = [];
const musicFiles = [];

for (const f of allFiles) {
    const name = f.replace('.wav', '');
    if (standaloneSounds.has(name)) {
        musicFiles.push(f);
    } else {
        spriteFiles.push(f);
    }
}

if (standaloneSounds.size > 0) {
    console.log(`\nSprite: ${spriteFiles.length} sounds (${sfxEnc.channels === 1 ? 'mono' : 'stereo'} ${sfxEnc.bitrate || 64}kbps ${sfxEnc.samplerate || 44100}Hz)`);
    console.log(`Standalone: ${musicFiles.length} sounds (${musicEnc.channels === 1 ? 'mono' : 'stereo'} ${musicEnc.bitrate || 128}kbps ${musicEnc.samplerate || 44100}Hz)\n`);
} else {
    console.log(`\nAll ${spriteFiles.length} sounds in sprites (${sfxEnc.channels === 1 ? 'mono' : 'stereo'} ${sfxEnc.bitrate || 64}kbps ${sfxEnc.samplerate || 44100}Hz)\n`);
}

// === SPRITE FILES — chunked by size ===
const spritePaths = spriteFiles.map(f => sourceSndFiles + f);
const audioArrays = [];

let count = 0;
let totalFileSize = 0;
const remaining = [...spritePaths];
while (remaining.length > 0 && remaining[count] !== undefined) {
    let fileSize = fs.statSync(remaining[count]).size / (1024 * 1024);
    totalFileSize += fileSize;
    console.log(" file names => " + remaining[count] + " file sizes =>  " + fileSize + " totalFileSize =>  " + totalFileSize);
    if (totalFileSize >= 30) {
        if (count === 0) count = 1;
        audioArrays.push(remaining.splice(0, count));
        count = 0;
        totalFileSize = 0;
    } else {
        count++;
        if (remaining[count] === undefined) {
            audioArrays.push(remaining.splice(0, count));
            break;
        }
    }
}

const pathArray = gameProjectPath.split(/[/\\]/);
const gameName = pathArray[pathArray.length - 1];

var opts = {
    output: outDir + gameName + "_audioSprite",
    format: 'howler2',
    export: 'm4a',
    bitrate: sfxEnc.bitrate || 64,
    channels: sfxEnc.channels || 2,
    samplerate: sfxEnc.samplerate || 44100,
    logger: { debug: console.log, info: console.log, log: console.log }
};

for (let i = 0; i < audioArrays.length; i++) {
    console.log(audioArrays[i] + " audio file creation" + (i + 1));
    createAudioSprite(audioArrays[i], i + 1, opts);
}

// === STANDALONE MUSIC — individual M4A files ===
if (musicFiles.length > 0) {
    console.log('\n── Building standalone music ──');
    const musicOpts = {
        format: 'howler2',
        export: 'm4a',
        bitrate: musicEnc.bitrate || 128,
        channels: musicEnc.channels || 2,
        samplerate: musicEnc.samplerate || 44100,
        logger: { debug: console.log, info: console.log, log: console.log }
    };
    for (const f of musicFiles) {
        const name = f.replace('.wav', '');
        console.log(`  ${name} → ${outDir}${name}.m4a`);
        audiosprite(pathToFFmpeg, [sourceSndFiles + f], { ...musicOpts, output: outDir + name }, undefined, function(err, obj) {
            if (err) return console.error(err);
            fs.writeFileSync(outDir + "soundData_" + name + ".json", JSON.stringify(obj, null, 2));
            console.log(`  ✔ ${name}.m4a complete`);
        });
    }
}

function getFileSizeInMegaBytes(filename) {
    const stats = fs.statSync(filename);
    return stats.size / (1024 * 1024);
}

function createAudioSprite(audioFiles, fileNumber, opts) {
    audiosprite(pathToFFmpeg, audioFiles, opts, fileNumber, function(err, obj) {
        if (err) return console.error(err);
        const dataText = JSON.stringify(obj, null, 2);
        if (fileNumber !== undefined) {
            fs.writeFile(outDir + "soundData" + fileNumber + ".json", dataText, function(err) {
                if (err) throw err;
                console.log('complete');
            });
        } else {
            fs.writeFile(outDir + "soundData.json", dataText, function(err) {
                if (err) throw err;
                console.log('complete');
            });
        }
    });
}
