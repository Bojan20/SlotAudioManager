#!/usr/bin/env node

/**
 * generateBGMModule.js — Auto-generates BGMStreamingInit.ts for game developer
 *
 * Reads sprite-config.json streaming sounds and settings.json game name.
 * Produces a TypeScript module that creates HTML5 Audio Howl instances for each
 * streaming music track and injects them into the playa-core SoundPlayer via addHowls().
 *
 * This allows sounds.json commands (play, fade, stop, loop, etc.) to work normally
 * while music streams from disk (~3 MB RAM instead of ~40 MB per track).
 *
 * Developer adds ONE line to main.ts:  import "./utils/BGMStreamingInit";
 *
 * Output: dist/BGMStreamingInit.ts
 */

const fs = require('fs');
const path = require('path');

let settings, spriteConfig;
try { settings = JSON.parse(fs.readFileSync('settings.json', 'utf8')); }
catch (e) { console.error('Failed to read settings.json:', e.message); process.exit(1); }
try { spriteConfig = JSON.parse(fs.readFileSync('sprite-config.json', 'utf8')); }
catch (e) { console.error('Failed to read sprite-config.json:', e.message); process.exit(1); }

const streamingSounds = spriteConfig.streaming?.sounds || [];
if (streamingSounds.length === 0) {
    console.log('No streaming sounds configured — skipping BGMStreamingInit.ts generation');
    process.exit(0);
}

// Read sounds.json to find play command parameters for each streaming sprite
let soundsJson = {};
try { soundsJson = JSON.parse(fs.readFileSync('sounds.json', 'utf8')); }
catch (e) { /* sounds.json might not exist yet on first build */ }
const commands = soundsJson.soundDefinitions?.commands || {};

// For each streaming sound, find the first "play" command that targets it
// so we can replicate volume/loop when auto-playing after injection
const playParams = {};
for (const name of streamingSounds) {
    const spriteId = 's_' + name;
    for (const [, steps] of Object.entries(commands)) {
        const arr = Array.isArray(steps) ? steps : [steps];
        for (const step of arr) {
            if (step && step.spriteId === spriteId && step.command === 'play') {
                playParams[name] = {
                    volume: step.volume !== undefined ? step.volume : 0.7,
                    loop: step.loop !== undefined ? step.loop : -1
                };
                break;
            }
        }
        if (playParams[name]) break;
    }
    if (!playParams[name]) playParams[name] = { volume: 0.7, loop: -1 };
}

// M4A filenames match soundId (no gameName prefix for streaming)
const tracks = streamingSounds.map(name => ({
    name,
    soundId: name,
    file: `${name}.m4a`,
    volume: playParams[name].volume,
    loop: playParams[name].loop
}));

// TRACKS: [soundId, src, volume, loop]
const output = `/**
 * Samo ubaci ovo u main.ts uz ostale importe i to je to:
 *
 *   import "./utils/BGMStreamingInit";
 *
 * Kod ispod ne diras — pokrece se sam na import i ucitava muziku preko
 * HTML5 Audio (streaming) umesto Web Audio (full decode u RAM).
 * Sve komande iz sounds.json rade isto kao pre — play, fade, stop, loop.
 *
 * KAKO RADI:
 * loadType "S" u manifestu znaci da playa-core NECE ucitati ovaj fajl tokom
 * main load-a (SubLoader "S" se nikad ne triggeruje). setSounds() kreira
 * SoundSprite sa _howl = undefined — komande propadnu cutljivo.
 * Ovaj modul kreira HTML5 Howl, zameni stale sprite kroz addHowl(),
 * i AUTOMATSKI pokrene reprodukciju jer je originalna play komanda vec
 * okinula i propala pre nego sto je Howl bio spreman.
 */
import { soundManager } from "playa-core";
import { Howl } from "howler";

const TRACKS: [string, string, number, number][] = [
${tracks.map(t => `    ["${t.soundId}", "sounds/soundFiles/${t.file}", ${t.volume}, ${t.loop}]`).join(',\n')}
];

// Wait for player to be ready (setSounds done), then inject HTML5 Howls
(function inject() {
    const player = soundManager.player as any;
    if (!player || !player._soundSprites) { setTimeout(inject, 100); return; }

    TRACKS.forEach(([id, src, vol, loop]) => {
        const spriteId = "s_" + id;
        const h = new Howl({
            src: [src],
            html5: true,
            preload: true,
            sprite: { [spriteId]: [0, 600000] }
        });
        h.once("load", () => {
            const dur = Math.round(h.duration() * 1000);
            if (dur > 0) (h as any)._sprite[spriteId] = [0, dur];

            // Register howl so addHowl guard passes
            player._howlInstances[src] = h;

            // Clean stale sprite from tags (setSounds created it with wrong howl)
            const stale = player._soundSprites.get(spriteId);
            if (stale) {
                player._tags?.forEach((tag: any) => {
                    tag.sprites = tag.sprites.filter((s: any) => s !== stale);
                });
            }

            // Replace sprite — use addHowl directly (not addHowls which searches by soundId)
            player.addHowl(h, src, spriteId);

            // AUTO-PLAY: Game's play command already fired on a sprite with undefined _howl
            // (silent fail). Now that we have a real HTML5 Howl, start playback with the
            // same parameters the original command would have used.
            // If the game hasn't fired the command yet (unlikely — setSounds completes
            // before this), the command will see isPlaying=true and skip (no double-play).
            const sp = player._soundSprites.get(spriteId);
            if (sp && !sp._isPlaying) {
                sp._volume = vol;
                sp._loop = loop;
                sp.play();
            }
        });
    });
})();
`;

// Write to dist/
const distDir = './dist';
if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
const outPath = path.join(distDir, 'BGMStreamingInit.ts');
fs.writeFileSync(outPath, output, 'utf8');

console.log(`\n✅ BGMStreamingInit.ts generated: ${outPath}`);
console.log(`   Tracks: ${tracks.length}`);
tracks.forEach(t => console.log(`     ${t.soundId} → ${t.file}`));
console.log(`\n   Developer: add to main.ts:  import "./utils/BGMStreamingInit";\n`);
