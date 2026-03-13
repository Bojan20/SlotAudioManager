#!/usr/bin/env node

/**
 * buildTiered.js — Tier-based audio sprite builder
 *
 * Reads sprite-config.json and builds audio sprites grouped by game state priority.
 * Music files are exported as standalone M4A files (not in sprites).
 * SFX sprites use mono encoding with 50ms gap for smaller file sizes.
 */

const audiosprite = require('./customAudioSprite');
const fs = require('fs');
const path = require('path');
const pathToFFmpeg = require('ffmpeg-static');

console.log("pathToFFmpeg ->", pathToFFmpeg);

// Read configs
const settings = JSON.parse(fs.readFileSync("settings.json"));
const spriteConfig = JSON.parse(fs.readFileSync("sprite-config.json"));
const audioSettings = new Map(Object.entries(settings || {}));
const gameProjectPath = audioSettings.get('gameProjectPath');

const pathArray = gameProjectPath.split(/[/\\]/);
const gameName = pathArray[pathArray.length - 1];

const sourceSndFiles = './sourceSoundFiles/';
const distDir = './dist';
const outDir = './dist/soundFiles/';

// Clean and create output
if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true });
}
fs.mkdirSync(outDir, { recursive: true });

// Get all WAV files in source directory
const allWavFiles = fs.readdirSync(sourceSndFiles)
    .filter(f => f.endsWith('.wav'))
    .map(f => f.replace('.wav', ''));

console.log(`Found ${allWavFiles.length} WAV files in source directory`);

// Determine which sounds are music (standalone) vs SFX (sprites)
const standaloneSounds = spriteConfig.standalone.sounds || [];
const spriteGroups = spriteConfig.sprites;
const encoding = spriteConfig.encoding;

// Collect all sounds assigned to sprites
const assignedSounds = new Set();
for (const [tierName, tierConfig] of Object.entries(spriteGroups)) {
    tierConfig.sounds.forEach(s => assignedSounds.add(s));
}
standaloneSounds.forEach(s => assignedSounds.add(s));

// Find unassigned sounds
const unassigned = allWavFiles.filter(f => !assignedSounds.has(f));
if (unassigned.length > 0) {
    console.log(`\nWARNING: ${unassigned.length} sounds not assigned to any tier:`);
    unassigned.forEach(s => console.log(`  - ${s}`));
    console.log(`These will be added to the last sprite tier automatically.\n`);

    // Add unassigned to the last (lowest priority) tier
    const tierNames = Object.keys(spriteGroups);
    const lastTier = tierNames[tierNames.length - 1];
    spriteGroups[lastTier].sounds.push(...unassigned);
}

// Find sounds in config but missing from source directory
for (const [tierName, tierConfig] of Object.entries(spriteGroups)) {
    const missing = tierConfig.sounds.filter(s => !allWavFiles.includes(s));
    if (missing.length > 0) {
        console.log(`NOTE: Tier '${tierName}' references ${missing.length} missing WAV files (skipped):`);
        missing.forEach(s => console.log(`  - ${s}`));
        tierConfig.sounds = tierConfig.sounds.filter(s => allWavFiles.includes(s));
    }
}

const missingStandalone = standaloneSounds.filter(s => !allWavFiles.includes(s));
if (missingStandalone.length > 0) {
    console.log(`NOTE: Standalone references ${missingStandalone.length} missing WAV files (skipped):`);
    missingStandalone.forEach(s => console.log(`  - ${s}`));
}

// Build queue
const buildQueue = [];
let completedBuilds = 0;
let totalBuilds = 0;

// Queue sprite builds
for (const [tierName, tierConfig] of Object.entries(spriteGroups)) {
    const sounds = tierConfig.sounds.filter(s => allWavFiles.includes(s));
    if (sounds.length === 0) {
        console.log(`Skipping tier '${tierName}' — no WAV files found`);
        continue;
    }

    // Use sortOrder if provided, otherwise keep config order
    let sortedSounds;
    if (tierConfig.sortOrder && tierConfig.sortOrder.length > 0) {
        const ordered = tierConfig.sortOrder.filter(s => sounds.includes(s));
        const remaining = sounds.filter(s => !tierConfig.sortOrder.includes(s));
        sortedSounds = [...ordered, ...remaining];
    } else {
        sortedSounds = sounds;
    }

    const files = sortedSounds.map(s => sourceSndFiles + s + '.wav');

    buildQueue.push({
        type: 'sprite',
        name: tierName,
        tierConfig: tierConfig,
        files: files,
        outputName: `${gameName}_${tierName}`
    });
}

// Queue standalone music builds
const existingStandalone = standaloneSounds.filter(s => allWavFiles.includes(s));
existingStandalone.forEach(soundName => {
    buildQueue.push({
        type: 'standalone',
        name: soundName,
        files: [sourceSndFiles + soundName + '.wav'],
        outputName: `${gameName}_${soundName}`
    });
});

totalBuilds = buildQueue.length;
console.log(`\nBuilding ${totalBuilds} audio files...`);
console.log("=".repeat(50));

// Process builds sequentially to avoid ffmpeg conflicts
function processNext(index) {
    if (index >= buildQueue.length) {
        console.log("\n" + "=".repeat(50));
        console.log("All builds complete!");
        return;
    }

    const build = buildQueue[index];

    if (build.type === 'standalone') {
        console.log(`\n[${index + 1}/${totalBuilds}] Standalone: ${build.name} (stereo ${encoding.music.bitrate}kbps)`);

        const opts = {
            output: outDir + build.outputName,
            format: 'howler2',
            export: 'm4a',
            bitrate: encoding.music.bitrate,
            channels: encoding.music.channels,
            samplerate: encoding.music.samplerate,
            gap: 0,
            silence: 0,
            logger: {
                debug: function() {},
                info: console.log,
                log: console.log
            }
        };

        audiosprite(pathToFFmpeg, build.files, opts, 0, function(err, obj) {
            if (err) {
                console.error(`ERROR building standalone ${build.name}:`, err);
                return processNext(index + 1);
            }

            const dataText = JSON.stringify(obj, null, 2);
            fs.writeFileSync(outDir + "soundData_" + build.name + ".json", dataText);
            console.log(`  -> ${build.outputName}.m4a`);

            completedBuilds++;
            processNext(index + 1);
        });

    } else {
        console.log(`\n[${index + 1}/${totalBuilds}] Sprite: ${build.name} (${build.files.length} sounds, mono ${encoding.sfx.bitrate}kbps, ${spriteConfig.spriteGap * 1000}ms gap)`);

        const opts = {
            output: outDir + build.outputName,
            format: 'howler2',
            export: 'm4a',
            bitrate: encoding.sfx.bitrate,
            channels: encoding.sfx.channels,
            samplerate: encoding.sfx.samplerate,
            gap: spriteConfig.spriteGap,
            silence: 0,
            logger: {
                debug: function() {},
                info: console.log,
                log: console.log
            }
        };

        audiosprite(pathToFFmpeg, build.files, opts, 0, function(err, obj) {
            if (err) {
                console.error(`ERROR building sprite ${build.name}:`, err);
                return processNext(index + 1);
            }

            const dataText = JSON.stringify(obj, null, 2);
            fs.writeFileSync(outDir + "soundData_" + build.name + ".json", dataText);

            // Check file size
            const m4aPath = outDir + build.outputName + ".m4a";
            if (fs.existsSync(m4aPath)) {
                const sizeKB = Math.round(fs.statSync(m4aPath).size / 1024);
                const maxKB = build.tierConfig.maxSizeKB;
                const status = sizeKB <= maxKB ? "OK" : "WARNING: OVER LIMIT";
                console.log(`  -> ${build.outputName}.m4a (${sizeKB}KB / ${maxKB}KB limit) ${status}`);
            }

            completedBuilds++;
            processNext(index + 1);
        });
    }
}

processNext(0);
