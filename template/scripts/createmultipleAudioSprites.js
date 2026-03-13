const audiosprite = require('./customAudioSprite');
const files = { process: process.argv[2] };
const fs = require('fs');
const pathToFFmpeg = require('ffmpeg-static');
const { forEach } = require('underscore');

console.log("pathToFFmpeg ->", pathToFFmpeg);

const settings = JSON.parse(fs.readFileSync("settings.json"));
const audioSettings = new Map(Object.entries(settings || {}));
const gameProjectPath = audioSettings.get('gameProjectPath');

const distDir = '././dist';

const sourceSndFiles = '././sourceSoundFiles/';
const outDir = '././dist/soundFiles/';

fs.rmSync(distDir, { recursive: true, force: true })

fs.mkdirSync(outDir, { recursive: true });

const audioSpritesNeeded = files.process;   //audio dev need to decide how many audiosprites he would need.

const audioFiles = fs.readdirSync(sourceSndFiles).map(dir => sourceSndFiles + dir);

console.log("audioFiles-->", audioFiles);

const audioArrays = [], size =  Math.round((audioFiles.length/audioSpritesNeeded) + audioFiles.length%audioSpritesNeeded);

console.log("declare audioFiles Arrays "+ audioArrays);

while(audioFiles.length > 0) {
    audioArrays.push(audioFiles.splice(0, size));
}

console.log(" Check defaults 1 " + audiosprite.defaults);
console.log(" Check defaults " + audiosprite);

const pathArray = gameProjectPath.split("/");
const gameName = pathArray[pathArray.length - 1];


var opts = {
    output: outDir + gameName + "_audioSprite",
    format: 'howler2',
    export: 'm4a',
    logger: {
        debug: console.log,
        info: console.log,
        log: console.log,
    }
}

for(let i = 0; i< audioArrays.length ; i++) {
    //console.log(" Audio Array  = " + i);
    createAudioSprite(audioArrays[i], i+1, opts);
}




function createAudioSprite(audioFiles, fileNumber) {
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

