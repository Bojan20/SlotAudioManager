const audiosprite = require('./customAudioSprite');
const fs = require('fs');
const pathToFFmpeg = require('ffmpeg-static');

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

console.log("audioFiles-->", audioFiles);

const pathArray = gameProjectPath.split("/");
const gameName = pathArray[pathArray.length - 1];

const spriteConfig = (() => { try { return JSON.parse(fs.readFileSync('sprite-config.json', 'utf8')); } catch { return null; } })();

var opts = {
    output: outDir + gameName + "_audioSprite",
    format: 'howler2',
    export: 'm4a',
    gap: spriteConfig?.spriteGap ?? 0.05,
    logger: {
        debug: console.log,
        info: console.log,
        log: console.log,
    }
}

audiosprite(pathToFFmpeg, audioFiles, opts, fileNumber = 0, function(err, obj) {
    if (err) return console.error(err)

    const dataText = JSON.stringify(obj, null, 2);
        if(fileNumber > 0) {
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