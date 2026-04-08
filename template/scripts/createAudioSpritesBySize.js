const audiosprite = require('./customAudioSprite');
const fs = require('fs');
const _ffmpegStatic = require('ffmpeg-static');
const _fdkEnvPath = process.env.FFMPEG_FDK_PATH || '';
const pathToFFmpeg = (_fdkEnvPath && require('fs').existsSync(_fdkEnvPath)) ? _fdkEnvPath : _ffmpegStatic;
const { forEach } = require('underscore');
const { count } = require('console');

console.log("pathToFFmpeg ->", pathToFFmpeg);

const settings = JSON.parse(fs.readFileSync("settings.json"));
const audioSettings = new Map(Object.entries(settings || {}));
const gameProjectPath = audioSettings.get('gameProjectPath');

const distDir = '././dist';

const sourceSndFiles = '././sourceSoundFiles/';
const outDir = '././dist/soundFiles/';

fs.rmdirSync(distDir, { recursive: true })

fs.mkdirSync(outDir, { recursive: true });

const allFiles = fs.readdirSync(sourceSndFiles).filter(f => f.endsWith('.wav'));

const pathArray = gameProjectPath.split(/[/\\]/);
const gameName = pathArray[pathArray.length - 1];

// Read encoding settings from sprite-config.json
const spriteConfig = (() => { try { return JSON.parse(fs.readFileSync('sprite-config.json', 'utf8')); } catch { return null; } })();
const encoding = spriteConfig?.encoding || {};
const sfxEnc = encoding.sfx || {};
const musicEnc = encoding.music || {};

// FDK-AAC binary detection
const FFMPEG_FDK_PATH = process.env.FFMPEG_FDK_PATH || '';
const _fdkExists = FFMPEG_FDK_PATH && fs.existsSync(FFMPEG_FDK_PATH);

// Separate files into SFX and Music by name pattern
function isMusicSound(name) {
    return /Music|MusicLoop|BigWinLoop|BigWinEnd|BigWinIntro|BonusGameEnd/i.test(name)
        && !/Coin|Spins|Rollup|Counter|CoinShower|Amb/i.test(name);
}

const sfxFiles = allFiles.filter(f => !isMusicSound(f.replace('.wav', ''))).map(f => sourceSndFiles + f);
const musicFiles = allFiles.filter(f => isMusicSound(f.replace('.wav', ''))).map(f => sourceSndFiles + f);

console.log(`SFX: ${sfxFiles.length} files, Music: ${musicFiles.length} files`);

// Chunk files by size (max ~30MB per sprite)
function chunkBySize(files, maxMB) {
    const chunks = [];
    const remaining = [...files];
    let count = 0;
    let totalFileSize = 0;
    while(remaining.length > 0 && remaining[count] !== undefined) {
        let fileSize = getFileSizeInMegaBytes(remaining[count]);
        totalFileSize = totalFileSize + fileSize;
        if(totalFileSize >= maxMB) {
            if(count === 0) count = 1;
            chunks.push(remaining.splice(0, count));
            count = 0;
            totalFileSize = 0;
        } else {
            count++;
            if(remaining[count] === undefined) {
                chunks.push(remaining.splice(0, count));
                break;
            }
        }
    }
    return chunks;
}

function getFileSizeInMegaBytes(filename) {
    const stats = fs.statSync(filename);
    return stats.size / (1024 * 1024);
}

// ── SFX sprites ──
const sfxChunks = chunkBySize(sfxFiles, 30);
const sfxEncEncoder = sfxEnc.encoder || 'native';
const sfxUseNative = !((sfxEncEncoder === 'fdk') && _fdkExists);

var sfxOpts = {
    output: outDir + gameName + "_audioSprite",
    format: 'howler2',
    export: 'm4a',
    bitrate: sfxEnc.bitrate || 64,
    channels: sfxEnc.channels || 2,
    samplerate: sfxEnc.samplerate || 44100,
    useNativeAac: sfxUseNative,
    logger: {
        debug: console.log,
        info: console.log,
        log: console.log,
    }
}

let spriteNumber = 1;

console.log('\n── Building SFX sprites (' + (sfxEnc.bitrate || 64) + 'kbps, ' + (sfxEnc.channels || 2) + 'ch) ──');
for(let i = 0; i < sfxChunks.length; i++) {
    console.log('SFX sprite ' + spriteNumber + ' — ' + sfxChunks[i].length + ' files');
    createAudioSprite(sfxChunks[i], spriteNumber, sfxOpts);
    spriteNumber++;
}

// ── Music sprites ──
if (musicFiles.length > 0) {
    const musicChunks = chunkBySize(musicFiles, 30);
    const musicEncEncoder = musicEnc.encoder || 'native';
    const musicUseNative = !((musicEncEncoder === 'fdk') && _fdkExists);

    var musicOpts = {
        output: outDir + gameName + "_audioSprite",
        format: 'howler2',
        export: 'm4a',
        bitrate: musicEnc.bitrate || 64,
        channels: musicEnc.channels || 2,
        samplerate: musicEnc.samplerate || 44100,
        useNativeAac: musicUseNative,
        logger: {
            debug: console.log,
            info: console.log,
            log: console.log,
        }
    }

    console.log('\n── Building Music sprites (' + (musicEnc.bitrate || 64) + 'kbps, ' + (musicEnc.channels || 2) + 'ch) ──');
    for(let i = 0; i < musicChunks.length; i++) {
        console.log('Music sprite ' + spriteNumber + ' — ' + musicChunks[i].length + ' files');
        createAudioSprite(musicChunks[i], spriteNumber, musicOpts);
        spriteNumber++;
    }
}

function createAudioSprite(audioFiles, fileNumber, opts) {
    console.log(audioFiles + " audio file creation" + fileNumber);
    audiosprite(pathToFFmpeg, audioFiles, opts, fileNumber, function(err, obj) {
        if (err) return console.error(err)

        const dataText = JSON.stringify(obj, null, 2);
        if(fileNumber !== undefined) {
            fs.writeFile(outDir + "soundData" + fileNumber + ".json", dataText, function(err) {
                if (err) {
                    throw err;
                }
                console.log('complete');
            });
        } else {
            fs.writeFile(outDir + "soundData.json", dataText, function(err) {
                if (err) {
                    throw err;
                }
                console.log('complete');
            });

        }
    });
}
