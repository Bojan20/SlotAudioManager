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
const standaloneSounds = spriteConfig?.standalone?.sounds || [];
const standaloneSubLoaderId = spriteConfig?.standalone?.subLoaderId || null;
const standaloneSet = new Set(standaloneSounds);

// Read sounds.json for Music tags
const soundsJson = (() => { try { return JSON.parse(fs.readFileSync('sounds.json', 'utf8')); } catch { return null; } })();
const musicTagSet = new Set();
if (soundsJson?.soundDefinitions?.soundSprites) {
    for (const [key, sp] of Object.entries(soundsJson.soundDefinitions.soundSprites)) {
        if (sp.tags && sp.tags.some(t => /music/i.test(t))) {
            musicTagSet.add(sp.spriteId || key.replace(/^s_/, ''));
        }
    }
}

// Separate SFX from standalone music
const allFiles = fs.readdirSync(sourceSndFiles).filter(f => f.endsWith('.wav')).sort();
const sfxFiles = [];
const musicFiles = [];

for (const f of allFiles) {
    const name = f.replace('.wav', '');
    if (standaloneSet.has(name)) {
        musicFiles.push(f);
    } else {
        sfxFiles.push(f);
    }
}

console.log(`\nSFX files: ${sfxFiles.length} (mono: ${sfxEnc.channels || 1}ch, ${sfxEnc.bitrate || 64}kbps)`);
console.log(`Standalone music: ${musicFiles.length} (stereo: ${musicEnc.channels || 2}ch, ${musicEnc.bitrate || 128}kbps)`);
if (standaloneSubLoaderId) console.log(`Standalone loadType: "${standaloneSubLoaderId}" (lazy auto-trigger)`);
console.log('');

// === BUILD SFX SPRITES (size-chunked, mono) ===
const sfxPaths = sfxFiles.map(f => sourceSndFiles + f);
const audioArrays = [];

// Chunk SFX by size (30MB WAV → ~1.5MB M4A at 64kbps mono)
let count = 0;
let totalFileSize = 0;
const remaining = [...sfxPaths];
while (remaining.length > 0 && remaining[count] !== undefined) {
    let fileSize = fs.statSync(remaining[count]).size / (1024 * 1024);
    totalFileSize += fileSize;
    console.log(` ${remaining[count]} => ${fileSize.toFixed(1)}MB, total: ${totalFileSize.toFixed(1)}MB`);
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

const sfxOpts = {
    output: outDir + gameName + "_audioSprite",
    format: 'howler2',
    export: 'm4a',
    bitrate: sfxEnc.bitrate || 64,
    channels: sfxEnc.channels || 1,
    samplerate: sfxEnc.samplerate || 44100,
    logger: { debug: console.log, info: console.log, log: console.log }
};

for (let i = 0; i < audioArrays.length; i++) {
    createAudioSprite(audioArrays[i], i + 1, sfxOpts);
}

// === BUILD STANDALONE MUSIC (individual M4A, stereo) ===
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
        const inputPath = sourceSndFiles + f;
        const outputPath = outDir + name;
        console.log(`  ${name} → ${outputPath}.m4a (stereo ${musicOpts.bitrate}kbps)`);
        audiosprite(pathToFFmpeg, [inputPath], { ...musicOpts, output: outputPath }, undefined, function(err, obj) {
            if (err) return console.error(err);
            // Write soundData for this standalone file
            fs.writeFileSync(outDir + "soundData_" + name + ".json", JSON.stringify(obj, null, 2));
            console.log(`  ✔ ${name}.m4a complete`);
        });
    }
}

function createAudioSprite(audioFiles, fileNumber, opts) {
    console.log(audioFiles.length + " files → sprite " + fileNumber);
    audiosprite(pathToFFmpeg, audioFiles, opts, fileNumber, function(err, obj) {
        if (err) return console.error(err);
        const dataText = JSON.stringify(obj, null, 2);
        if (fileNumber !== undefined) {
            fs.writeFile(outDir + "soundData" + fileNumber + ".json", dataText, function(err) {
                if (err) throw err;
                console.log('✔ sprite ' + fileNumber + ' complete');
            });
        } else {
            fs.writeFile(outDir + "soundData.json", dataText, function(err) {
                if (err) throw err;
                console.log('complete');
            });
        }
    });
}
