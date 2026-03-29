const audiosprite = require('./customAudioSprite');
const fs = require('fs');
const pathToFFmpeg = require('ffmpeg-static');
const { forEach } = require('underscore');
const { count } = require('console');

console.log("pathToFFmpeg ->", pathToFFmpeg);

const settings = JSON.parse(fs.readFileSync("settings.json"));
const audioSettings = new Map(Object.entries(settings || {}));
const gameProjectPath = audioSettings.get('gameProjectPath');

const distDir = '././dist';

const sourceSndFiles = '././sourceSoundFiles/';
const outDir = '././dist/soundFiles/';

fs.rmSync(distDir, { recursive: true, force: true })

fs.mkdirSync(outDir, { recursive: true });

const audioFiles = fs.readdirSync(sourceSndFiles).map(dir => sourceSndFiles + dir);

//console.log("audioFiles-->",  audioFiles);

const audioArrays = [];

createFileChunks();
function createFileChunks() {
    let count = 0;
    let totalFileSize = 0;
    while(audioFiles.length > 0 && audioFiles[count] !== undefined) {
        //console.log("audioFiles.length == " + audioFiles.length + " audioFiles[count] ==> " + audioFiles[count]);
        let fileSize = getFileSizeInMegaBytes(audioFiles[count]);
        totalFileSize = totalFileSize + fileSize;
        console.log(" file names => " + audioFiles[count] + " file sizes =>  " + fileSize + " totalFileSize =>  "+ totalFileSize);
        if(totalFileSize >= 30) {
            if(count === 0) {
                count = 1;
            }
            audioArrays.push(audioFiles.splice(0, count));
            //console.log (" Audio Array =>  " + audioArrays + "audioArrays.length =>" + audioArrays.length);
            count = 0;
            totalFileSize = 0;
        } else {
            count++;
            if(audioFiles[count] === undefined) {
                audioArrays.push(audioFiles.splice(0, count));
                break;
            }
        }    
    }   
}


const pathArray = gameProjectPath.split("/");
const gameName = pathArray[pathArray.length - 1];


// Read encoding from sprite-config.json if available, otherwise use defaults
const spriteConfig = (() => { try { return JSON.parse(fs.readFileSync('sprite-config.json', 'utf8')); } catch { return null; } })();
const enc = spriteConfig?.encoding?.sfx || {};

var opts = {
    output: outDir + gameName + "_audioSprite",
    format: 'howler2',
    export: 'm4a',
    bitrate: enc.bitrate || 64,
    channels: enc.channels || 2,
    samplerate: enc.samplerate || 44100,
    logger: {
        debug: console.log,
        info: console.log,
        log: console.log,
    }
}

for(let i = 0; i< audioArrays.length ; i++) {
    //console.log(" Audio Array" + i + "  ==>  " + audioArrays[i]);
    createAudioSprite(audioArrays[i], i+1, opts);
}

function getFileSizeInMegaBytes(filename) {
    //console.log(filename);
    const stats = fs.statSync(filename);
    const fileSizeInBytes = stats.size;
    const fileSizeInMegaBytes = fileSizeInBytes/(1024*1024);
    return fileSizeInMegaBytes;

}

function createAudioSprite(audioFiles, fileNumber) {
    console.log(audioFiles+" audio file creation" + fileNumber);
    audiosprite(pathToFFmpeg, audioFiles, opts, fileNumber,function(err, obj) {
        if (err) return console.error(err)
    
        const dataText = JSON.stringify(obj, null, 2);
        if(fileNumber !== undefined) {
            fs.writeFile(outDir + "soundData" +fileNumber+".json", dataText, function(err) {
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