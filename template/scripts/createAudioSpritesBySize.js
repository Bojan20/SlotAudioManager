const audiosprite = require('./customAudioSprite');
const fs = require('fs');
const path = require('path');

// Use FDK ffmpeg from app when sprite-config encoder is 'fdk', otherwise fall back to ffmpeg-static
const _fdkPath = process.env.FFMPEG_FDK_PATH;
const spriteConfig = (() => { try { return JSON.parse(fs.readFileSync('sprite-config.json', 'utf8')); } catch { return null; } })();
const _fdkExists = _fdkPath && fs.existsSync(_fdkPath);
const _anyFdk = _fdkExists && Object.values(spriteConfig?.encoding || {}).some(e => (e.encoder || spriteConfig?.encoder) === 'fdk');
const pathToFFmpeg = _anyFdk ? _fdkPath : require('ffmpeg-static');

console.log("pathToFFmpeg ->", pathToFFmpeg);
if (_anyFdk) console.log("(FDK binary — per-category encoder selection)");

const settings = JSON.parse(fs.readFileSync("settings.json"));
const audioSettings = new Map(Object.entries(settings || {}));
const gameProjectPath = audioSettings.get('gameProjectPath');

const distDir = '././dist';
const sourceSndFiles = '././sourceSoundFiles/';
const outDir = '././dist/soundFiles/';

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// Read encoding settings
const sfxEnc = spriteConfig?.encoding?.sfx || {};
const musicEnc = spriteConfig?.encoding?.music || {};
const standaloneSounds = new Set(spriteConfig?.standalone?.sounds || []);
const streamingSounds = new Set(spriteConfig?.streaming?.sounds || []);

// Detect Music-tagged sounds from sounds.json
const _musicTags = new Set(spriteConfig?.musicTags || ['Music']);
const _soundsJson = (() => { try { return JSON.parse(fs.readFileSync(settings.JSONtemplate || 'sounds.json', 'utf8')); } catch { return {}; } })();
const _originalSprites = _soundsJson.soundDefinitions?.soundSprites || {};
const _musicSounds = new Set();
for (const [k, v] of Object.entries(_originalSprites)) {
    if (v?.tags?.some(t => _musicTags.has(t))) _musicSounds.add(k.replace(/^s_/, ''));
}

// Separate files: standalone / streaming / sprite-sfx / sprite-music (by tag)
const allFiles = fs.readdirSync(sourceSndFiles).filter(f => f.endsWith('.wav')).sort();
const spriteSfxFiles = [];
const spriteMusicFiles = [];
const musicFiles = [];
const streamingFiles = [];

for (const f of allFiles) {
    const name = f.replace('.wav', '');
    if (streamingSounds.has(name)) {
        streamingFiles.push(f);
    } else if (standaloneSounds.has(name)) {
        musicFiles.push(f);
    } else if (_musicSounds.has(name)) {
        spriteMusicFiles.push(f);
    } else {
        spriteSfxFiles.push(f);
    }
}

// Encoder labels
const sfxEncLabel = ((sfxEnc.encoder || 'native') === 'fdk' && _fdkExists) ? 'FDK' : 'native';
const musicEncLabel = ((musicEnc.encoder || 'native') === 'fdk' && _fdkExists) ? 'FDK' : 'native';

console.log(`\nSprite SFX: ${spriteSfxFiles.length} sounds (${sfxEnc.bitrate || 64}kbps ${sfxEnc.channels === 1 ? 'mono' : 'stereo'} ${sfxEncLabel})`);
if (spriteMusicFiles.length > 0) console.log(`Sprite Music: ${spriteMusicFiles.length} sounds (${musicEnc.bitrate || 64}kbps ${musicEnc.channels === 1 ? 'mono' : 'stereo'} ${musicEncLabel})`);
if (musicFiles.length > 0) console.log(`Standalone: ${musicFiles.length} sounds (${musicEnc.bitrate || 64}kbps ${musicEncLabel})`);
if (streamingFiles.length > 0) console.log(`Streaming: ${streamingFiles.length} sounds (${musicEnc.bitrate || 64}kbps ${musicEncLabel})`);
console.log('');

// === CHUNK BY SIZE — separate SFX and Music sprites ===
function chunkBySize(files, maxMB) {
    const paths = files.map(f => sourceSndFiles + f);
    const chunks = [];
    let count = 0, totalSize = 0;
    const remaining = [...paths];
    while (remaining.length > 0 && remaining[count] !== undefined) {
        const fileSize = fs.statSync(remaining[count]).size / (1024 * 1024);
        totalSize += fileSize;
        if (totalSize >= maxMB) {
            if (count === 0) count = 1;
            chunks.push(remaining.splice(0, count));
            count = 0; totalSize = 0;
        } else {
            count++;
            if (remaining[count] === undefined) { chunks.push(remaining.splice(0, count)); break; }
        }
    }
    return chunks;
}

const pathArray = gameProjectPath.split(/[/\\]/);
const gameName = pathArray[pathArray.length - 1];

// SFX sprites — sfx encoding
const sfxChunks = chunkBySize(spriteSfxFiles, 30);
const sfxEncEncoder = sfxEnc.encoder || 'native';
const sfxUseNative = !((sfxEncEncoder === 'fdk') && _fdkExists);
const sfxOpts = {
    output: outDir + gameName + "_audioSprite",
    format: 'howler2', export: 'm4a',
    bitrate: sfxEnc.bitrate || 64, channels: sfxEnc.channels || 2, samplerate: sfxEnc.samplerate || 44100,
    useNativeAac: sfxUseNative,
    logger: { debug: console.log, info: console.log, log: console.log }
};

let spriteNumber = 1;
for (let i = 0; i < sfxChunks.length; i++) {
    console.log(`SFX sprite ${spriteNumber} — ${sfxChunks[i].length} files (${sfxEnc.bitrate || 64}kbps ${sfxEncLabel})`);
    createAudioSprite(sfxChunks[i], spriteNumber, sfxOpts);
    spriteNumber++;
}

// Music sprites — music encoding (separate from SFX)
if (spriteMusicFiles.length > 0) {
    const musicChunks = chunkBySize(spriteMusicFiles, 30);
    const musicEncEncoder = musicEnc.encoder || 'native';
    const musicUseNative = !((musicEncEncoder === 'fdk') && _fdkExists);
    const musicOpts = {
        output: outDir + gameName + "_audioSprite",
        format: 'howler2', export: 'm4a',
        bitrate: musicEnc.bitrate || 64, channels: musicEnc.channels || 2, samplerate: musicEnc.samplerate || 44100,
        useNativeAac: musicUseNative,
        logger: { debug: console.log, info: console.log, log: console.log }
    };
    for (let i = 0; i < musicChunks.length; i++) {
        console.log(`Music sprite ${spriteNumber} — ${musicChunks[i].length} files (${musicEnc.bitrate || 64}kbps ${musicEncLabel})`);
        createAudioSprite(musicChunks[i], spriteNumber, musicOpts);
        spriteNumber++;
    }
}

// === STANDALONE MUSIC — individual M4A files (included in manifest) ===
if (musicFiles.length > 0) {
    console.log('\n── Building standalone music ──');
    const musicEncEncoder = musicEnc.encoder || 'native';
    const standaloneUseNative = !((musicEncEncoder === 'fdk') && _fdkExists);
    const musicOpts = {
        format: 'howler2',
        export: 'm4a',
        bitrate: musicEnc.bitrate || 64,
        channels: musicEnc.channels || 2,
        samplerate: musicEnc.samplerate || 44100,
        useNativeAac: standaloneUseNative,
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

// === STREAMING MUSIC — individual M4A files (manifest loadType "S", loaded via HTML5 Audio) ===
if (streamingFiles.length > 0) {
    console.log('\n── Building streaming music (HTML5 Audio, loadType S) ──');
    const streamEncEncoder = musicEnc.encoder || 'native';
    const streamUseNative = !((streamEncEncoder === 'fdk') && _fdkExists);
    const streamOpts = {
        format: 'howler2',
        export: 'm4a',
        bitrate: musicEnc.bitrate || 64,
        channels: musicEnc.channels || 2,
        samplerate: musicEnc.samplerate || 44100,
        useNativeAac: streamUseNative,
        logger: { debug: () => {}, info: console.log, log: console.log }
    };
    for (const f of streamingFiles) {
        const name = f.replace('.wav', '');
        console.log(`  🎵 ${name} → ${outDir}${name}.m4a (streaming)`);
        audiosprite(pathToFFmpeg, [sourceSndFiles + f], { ...streamOpts, output: outDir + name }, undefined, function(err, obj) {
            if (err) return console.error(err);
            // Write soundData so sprite definitions are created in sounds.json (commands need them)
            fs.writeFileSync(outDir + "soundData_" + name + ".json", JSON.stringify(obj, null, 2));
            console.log(`  ✔ ${name}.m4a complete (streaming, loadType S)`);
        });
    }
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
