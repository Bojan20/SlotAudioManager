#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

let settings;
try {
    settings = JSON.parse(fs.readFileSync("settings.json", "utf8"));
} catch (e) {
    console.error("Failed to read settings.json:", e.message);
    process.exit(1);
}

const gameProjectPath = settings.gameProjectPath;

if (!gameProjectPath) {
    console.error("gameProjectPath not set in settings.json");
    process.exit(1);
}

const distSoundFolder = path.join(".", "dist", "soundFiles");
const distFolder = path.join(".", "dist");
const soundsDest = path.join(gameProjectPath, "assets", "default", "default", "default", "sounds");
const soundFilesDest = path.join(soundsDest, "soundFiles");

function copyDirectory(srcPath) {
    fs.readdirSync(srcPath).forEach(element => {
        const filePath = path.join(srcPath, element);
        if (!element.startsWith(".") && fs.existsSync(filePath) && !fs.lstatSync(filePath).isDirectory()) {
            console.log("process " + element);
            const destFile = path.join(soundFilesDest, element);
            console.log("copy from " + filePath + " to " + destFile);
            if (!fs.existsSync(soundFilesDest)) {
                fs.mkdirSync(soundsDest, { recursive: true });
                fs.mkdirSync(soundFilesDest, { recursive: true });
            }
            fs.copyFileSync(filePath, destFile);
        }
    });
}

function copySoundConfigToGame(srcFolder) {
    console.log("source sound json file path - " + srcFolder);

    const jsonSrc = path.join(srcFolder, "sounds.json");
    const json5Src = path.join(srcFolder, "sounds.json5");
    const jsonDest = path.join(soundsDest, "sounds.json");
    const json5Dest = path.join(soundsDest, "sounds.json5");

    if (fs.existsSync(jsonSrc)) {
        if (fs.existsSync(jsonDest)) fs.rmSync(jsonDest);
        if (fs.existsSync(json5Dest)) fs.rmSync(json5Dest);
        if (!fs.existsSync(soundsDest)) fs.mkdirSync(soundsDest, { recursive: true });
        console.log("copy from " + jsonSrc + " to " + jsonDest);
        fs.copyFileSync(jsonSrc, jsonDest);
    } else {
        console.log(jsonSrc + " is missing from dist folder, skipping");
    }

    if (fs.existsSync(json5Src)) {
        if (fs.existsSync(jsonDest)) fs.rmSync(jsonDest);
        if (fs.existsSync(json5Dest)) fs.rmSync(json5Dest);
        if (!fs.existsSync(soundsDest)) fs.mkdirSync(soundsDest, { recursive: true });
        console.log("copy from " + json5Src + " to " + json5Dest);
        fs.copyFileSync(json5Src, json5Dest);
    } else {
        console.log(json5Src + " is missing from dist folder, skipping");
    }
}

function copySoundsToGame(srcPath) {
    if (!fs.existsSync(srcPath)) {
        console.log("Sounds folder " + srcPath + " missing, skipping...");
    } else {
        copyDirectory(srcPath);
    }
}

console.log("audio files:");
console.log(gameProjectPath);

if (!fs.existsSync(path.join(gameProjectPath, "assets"))) {
    console.log("Game Path " + path.join(gameProjectPath, "assets") + " missing, skipping...");
} else {
    if (fs.existsSync(soundsDest)) {
        fs.rmSync(soundsDest, { recursive: true, force: true });
    }
    copySoundConfigToGame(distFolder);
    copySoundsToGame(distSoundFolder);
}

// Also copy to game's dist/ folder so local playa launch (no VPN) picks up our audio.
// Webpack content-hashes the audio files in dist/; we copy with unhashed names to match
// the paths that sounds.json references (e.g. soundFiles/gameName.m4a, not gameName.abc123.m4a).
const distGameSoundsBase = path.join(gameProjectPath, "dist", "assets", "default", "default", "default", "sounds");
const distGameSoundFiles = path.join(distGameSoundsBase, "soundFiles");

if (fs.existsSync(distGameSoundsBase)) {
    const jsonSrc = path.join(distFolder, "sounds.json");
    if (fs.existsSync(jsonSrc)) {
        const soundsData = JSON.parse(fs.readFileSync(jsonSrc, "utf8"));

        // Overwrite webpack-hashed index json file(s).
        // IndexLoader.load('sounds.json') fetches the hashed file and returns data["sounds.json"],
        // so the file must be wrapped: { "sounds.json": <actual data> }
        fs.readdirSync(distGameSoundsBase)
            .filter(f => f !== "sounds.json" && (f.endsWith(".json") || f.endsWith(".json5")) && !fs.lstatSync(path.join(distGameSoundsBase, f)).isDirectory())
            .forEach(f => {
                const dest = path.join(distGameSoundsBase, f);
                console.log("overwrite dist hashed sounds: " + dest);
                fs.writeFileSync(dest, JSON.stringify({ "sounds.json": soundsData }));
            });
    }

    // Copy audio sprite files — unhashed AND overwrite hashed versions
    if (fs.existsSync(distSoundFolder)) {
        if (!fs.existsSync(distGameSoundFiles)) {
            fs.mkdirSync(distGameSoundFiles, { recursive: true });
        }
        // Build map of existing hashed files in game dist: baseName → [hashedFile1, ...]
        const existingFiles = fs.existsSync(distGameSoundFiles) ? fs.readdirSync(distGameSoundFiles) : [];
        const hashedMap = {};
        for (const f of existingFiles) {
            // Match pattern: name.HASH.ext (e.g. audioSprite1.ed229f.m4a)
            const m = f.match(/^(.+)\.([a-f0-9]{6,})(\.[^.]+)$/);
            if (m) {
                const baseName = m[1] + m[3]; // e.g. audioSprite1.m4a
                if (!hashedMap[baseName]) hashedMap[baseName] = [];
                hashedMap[baseName].push(f);
            }
        }

        fs.readdirSync(distSoundFolder).forEach(element => {
            const filePath = path.join(distSoundFolder, element);
            if (!element.startsWith(".") && fs.existsSync(filePath) && !fs.lstatSync(filePath).isDirectory()) {
                // Copy with original unhashed name
                const destFile = path.join(distGameSoundFiles, element);
                console.log("copy to dist: " + element + " -> " + destFile);
                fs.copyFileSync(filePath, destFile);

                // Also overwrite any hashed versions so webpack-loaded paths get our audio
                if (hashedMap[element]) {
                    for (const hashedName of hashedMap[element]) {
                        const hashedDest = path.join(distGameSoundFiles, hashedName);
                        console.log("overwrite hashed: " + element + " -> " + hashedName);
                        fs.copyFileSync(filePath, hashedDest);
                    }
                }
            }
        });
    }
} else {
    console.log("Game dist/ not found at " + distGameSoundsBase + ", skipping dist copy");
}

// Patch howler in game's node_modules to stream standalone music via html5:true
// This saves ~100-200MB RAM by avoiding Web Audio API decode for large music loops.
// Must run AFTER yarn install and BEFORE yarn build-dev.
const gameHowlerPath = path.join(gameProjectPath, "node_modules", "howler", "dist", "howler.js");
const soundsJsonPath = path.join(distFolder, "sounds.json");
if (fs.existsSync(gameHowlerPath) && fs.existsSync(soundsJsonPath)) {
    const soundsData = JSON.parse(fs.readFileSync(soundsJsonPath, "utf8"));
    const manifest = soundsData.soundManifest || [];
    const sprites = soundsData.soundDefinitions?.soundSprites || {};

    // Find standalone music src paths
    const streamFiles = [];
    for (const entry of manifest) {
        const refsToThis = Object.values(sprites).filter(s => s.soundId === entry.id);
        if (refsToThis.length <= 1) {
            const sprite = refsToThis[0];
            if (sprite && sprite.tags && sprite.tags.some(t => /music/i.test(t))) {
                const src = Array.isArray(entry.src) ? entry.src[0] : entry.src;
                // Extract just the filename without path
                streamFiles.push(src.split("/").pop().replace(/\.[^.]+$/, ""));
            }
        }
    }

    if (streamFiles.length > 0) {
        let howlerSrc = fs.readFileSync(gameHowlerPath, "utf8");
        if (!howlerSrc.includes("__SOUND_PATCH__")) {
            // Inject at the start of Howl.prototype.init — check if src matches music files
            const patchCode = `
    /* __SOUND_PATCH__ streaming music */
    var __streamFiles__ = ${JSON.stringify(streamFiles)};
    var __srcCheck__ = typeof o.src === 'string' ? o.src : (Array.isArray(o.src) ? o.src[0] : '');
    for (var __si__ = 0; __si__ < __streamFiles__.length; __si__++) {
      if (__srcCheck__.indexOf(__streamFiles__[__si__]) !== -1) {
        o.html5 = true;
        console.log('[SoundPatch] Streaming: ' + __srcCheck__);
        break;
      }
    }`;
            // Insert after "Howl.prototype = {" ... "init: function(o) {"
            howlerSrc = howlerSrc.replace(
                /init:\s*function\s*\(\s*o\s*\)\s*\{/,
                'init: function(o) {' + patchCode
            );
            fs.writeFileSync(gameHowlerPath, howlerSrc);
            console.log("Patched howler.js for " + streamFiles.length + " streaming music file(s): " + streamFiles.join(", "));
        } else {
            console.log("howler.js already patched");
        }
    } else {
        console.log("No standalone music found — skipping howler patch");
    }
} else {
    if (!fs.existsSync(gameHowlerPath)) console.log("Game howler.js not found — run yarn install in game repo first");
}
