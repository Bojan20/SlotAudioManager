const audiosprite = require('./customAudioSprite');
const fs = require('fs');
const pathToFFmpeg = require('ffmpeg-static');

console.log("pathToFFmpeg ->", pathToFFmpeg);

const distDir = '././dist/soundFiles/';

const sourceSndFiles = '././sourceSoundFiles/';
const outDir = '././dist/soundFiles/';

if (fs.existsSync(distDir) === true) {
    fs.rmSync(distDir, { recursive: true, force: true });
}


fs.mkdirSync(outDir, { recursive: true });

const audioFiles = fs.readdirSync(sourceSndFiles).map(dir => sourceSndFiles + dir);



for (let i = 0; i < audioFiles.length; i++) {
    const pathArray = audioFiles[i].split("/");
    const filePath = pathArray[pathArray.length - 1].substring(0, (pathArray[pathArray.length - 1]).length - 4);
    var opts = {
        output: outDir + filePath,
        format: 'howler2',
        logger: {
            debug: console.log,
            info: console.log,
            log: console.log,
        }
    }

    audiosprite(pathToFFmpeg, [audioFiles[i]], opts, 0, function(err, obj) {

    });
}