#!/usr/bin/env node

/**
 * validateBuild.js — QA validation for audio build output
 *
 * Checks:
 * 1. All sprite files exist and are within size limits
 * 2. All spriteIds referenced in commands exist in soundSprites
 * 3. All spriteListIds referenced in commands exist in spriteList
 * 4. All soundSprites reference valid soundManifest entries
 * 5. No orphan sounds (in soundSprites but not in any command)
 * 6. Boot sprite is under 500KB
 * 7. All sprites under 1.5MB
 */

const fs = require('fs');
const path = require('path');

const distDir = './dist';

let errors = 0;
let warnings = 0;

function error(msg) {
    console.log(`  ERROR: ${msg}`);
    errors++;
}

function warn(msg) {
    console.log(`  WARNING: ${msg}`);
    warnings++;
}

function ok(msg) {
    console.log(`  OK: ${msg}`);
}

// Check sounds.json exists
const soundsJsonPath = distDir + '/sounds.json';
if (!fs.existsSync(soundsJsonPath)) {
    console.log("FATAL: dist/sounds.json does not exist. Run build first.");
    process.exit(1);
}

const soundsJson = JSON.parse(fs.readFileSync(soundsJsonPath));
const manifest = soundsJson.soundManifest || [];
const soundSprites = soundsJson.soundDefinitions.soundSprites || {};
const spriteLists = soundsJson.soundDefinitions.spriteList || {};
const commands = soundsJson.soundDefinitions.commands || {};

// Load sprite-config if available
let spriteConfig = null;
if (fs.existsSync('sprite-config.json')) {
    spriteConfig = JSON.parse(fs.readFileSync('sprite-config.json'));
}

console.log("\n=== AUDIO BUILD VALIDATION ===\n");

// 1. Check M4A files exist and sizes
console.log("1. FILE SIZE CHECK");
const manifestIds = new Set();
for (const entry of manifest) {
    manifestIds.add(entry.id);
    for (const src of entry.src) {
        const filePath = distDir + '/' + src;
        if (!fs.existsSync(filePath)) {
            error(`Missing file: ${src}`);
        } else {
            const sizeKB = Math.round(fs.statSync(filePath).size / 1024);

            // Check size limits
            let maxKB = 1500; // default 1.5MB
            if (spriteConfig) {
                for (const [tierName, tierConfig] of Object.entries(spriteConfig.sprites)) {
                    if (entry.id.includes(tierName)) {
                        maxKB = tierConfig.maxSizeKB;
                        break;
                    }
                }
            }

            if (sizeKB > maxKB) {
                error(`${src}: ${sizeKB}KB exceeds ${maxKB}KB limit`);
            } else {
                ok(`${src}: ${sizeKB}KB (limit: ${maxKB}KB)`);
            }
        }
    }
}

// 2. Check all spriteIds in commands exist in soundSprites
console.log("\n2. COMMAND REFERENCE CHECK");
const referencedSprites = new Set();
const referencedSpriteLists = new Set();
let commandErrors = 0;

for (const [cmdName, cmdActions] of Object.entries(commands)) {
    for (const action of cmdActions) {
        if (action.spriteId) {
            referencedSprites.add(action.spriteId);
            if (!soundSprites[action.spriteId]) {
                error(`Command '${cmdName}' references missing spriteId '${action.spriteId}'`);
                commandErrors++;
            }
        }
        if (action.spriteListId) {
            referencedSpriteLists.add(action.spriteListId);
            if (!spriteLists[action.spriteListId]) {
                error(`Command '${cmdName}' references missing spriteListId '${action.spriteListId}'`);
                commandErrors++;
            }
        }
    }
}

if (commandErrors === 0) {
    ok(`All command references valid (${Object.keys(commands).length} commands checked)`);
}

// 3. Check spriteList items exist in soundSprites
console.log("\n3. SPRITE LIST CHECK");
let spriteListErrors = 0;
for (const [listName, listConfig] of Object.entries(spriteLists)) {
    if (listConfig.items) {
        for (const item of listConfig.items) {
            if (!soundSprites[item]) {
                error(`SpriteList '${listName}' references missing sprite '${item}'`);
                spriteListErrors++;
            }
        }
    }
}
if (spriteListErrors === 0) {
    ok(`All spriteList references valid (${Object.keys(spriteLists).length} lists checked)`);
}

// 4. Check all soundSprites reference valid manifest entries
console.log("\n4. MANIFEST REFERENCE CHECK");
let manifestErrors = 0;
for (const [spriteName, spriteData] of Object.entries(soundSprites)) {
    if (!manifestIds.has(spriteData.soundId)) {
        error(`Sprite '${spriteName}' references missing manifest entry '${spriteData.soundId}'`);
        manifestErrors++;
    }
}
if (manifestErrors === 0) {
    ok(`All soundSprites reference valid manifest entries (${Object.keys(soundSprites).length} sprites checked)`);
}

// 5. Check for orphan sounds (not referenced by any command or spriteList)
console.log("\n5. ORPHAN CHECK");
const allReferencedSprites = new Set([...referencedSprites]);

// Also add sprites referenced from sprite lists
for (const [listName, listConfig] of Object.entries(spriteLists)) {
    if (listConfig.items) {
        listConfig.items.forEach(item => allReferencedSprites.add(item));
    }
}

// Also check if sprites are referenced by commands via spriteList
for (const [listName] of Object.entries(spriteLists)) {
    if (referencedSpriteLists.has(listName)) {
        const listConfig = spriteLists[listName];
        if (listConfig.items) {
            listConfig.items.forEach(item => allReferencedSprites.add(item));
        }
    }
}

const orphans = Object.keys(soundSprites).filter(s => !allReferencedSprites.has(s));
if (orphans.length > 0) {
    warn(`${orphans.length} orphan sprites (defined but not used in any command):`);
    orphans.forEach(s => console.log(`    - ${s}`));
} else {
    ok(`No orphan sprites`);
}

// 6. Summary
console.log("\n=== SUMMARY ===");
console.log(`  Manifest entries: ${manifest.length}`);
console.log(`  Sound sprites: ${Object.keys(soundSprites).length}`);
console.log(`  Sprite lists: ${Object.keys(spriteLists).length}`);
console.log(`  Commands: ${Object.keys(commands).length}`);
console.log(`  Errors: ${errors}`);
console.log(`  Warnings: ${warnings}`);

if (errors > 0) {
    console.log(`\nBUILD VALIDATION FAILED with ${errors} error(s)\n`);
    process.exit(1);
} else {
    console.log(`\nBUILD VALIDATION PASSED\n`);
    process.exit(0);
}
