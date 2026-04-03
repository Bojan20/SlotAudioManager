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

// Copy BGMStreamingInit.ts to game project if it exists
function copyBGMModule() {
    const bgmSrc = path.join(".", "dist", "BGMStreamingInit.ts");
    if (!fs.existsSync(bgmSrc)) return;

    const utilsDest = path.join(gameProjectPath, "src", "ts", "utils");
    if (!fs.existsSync(path.join(gameProjectPath, "src", "ts"))) {
        console.log("Game src/ts/ not found — skipping BGMStreamingInit.ts copy (copy manually)");
        return;
    }
    if (!fs.existsSync(utilsDest)) fs.mkdirSync(utilsDest, { recursive: true });

    const destFile = path.join(utilsDest, "BGMStreamingInit.ts");
    fs.copyFileSync(bgmSrc, destFile);
    console.log("BGMStreamingInit.ts → " + destFile);

    // Auto-add import to main.ts if not already there
    const mainTsPath = path.join(gameProjectPath, "src", "ts", "main.ts");
    if (fs.existsSync(mainTsPath)) {
        const mainTs = fs.readFileSync(mainTsPath, "utf8");
        if (!mainTs.includes("BGMStreamingInit")) {
            // Insert after the last import line
            const lines = mainTs.split("\n");
            let lastImportIdx = -1;
            for (let i = 0; i < lines.length; i++) {
                if (/^import\s/.test(lines[i])) lastImportIdx = i;
            }
            if (lastImportIdx >= 0) {
                lines.splice(lastImportIdx + 1, 0, 'import "./utils/BGMStreamingInit";');
                fs.writeFileSync(mainTsPath, lines.join("\n"), "utf8");
                console.log("Added BGMStreamingInit import to main.ts (line " + (lastImportIdx + 2) + ")");
            }
        } else {
            console.log("BGMStreamingInit import already in main.ts");
        }
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
    copyBGMModule();
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
