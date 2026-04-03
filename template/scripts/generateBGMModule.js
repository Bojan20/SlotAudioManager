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

// M4A filenames match soundId (no gameName prefix for streaming)
const tracks = streamingSounds.map(name => ({
    name,
    soundId: name,
    file: `${name}.m4a`
}));

const trackEntries = tracks.map(t =>
    `    { soundId: "${t.soundId}", src: SOUNDS_PATH + "${t.file}" }`
).join(',\n');

const output = `/**
 * Samo ubaci ovo u main.ts uz ostale importe i to je to:
 *
 *   import "./utils/BGMStreamingInit";
 *
 * Kod ispod ne diras — pokrece se sam na import i ucitava muziku preko
 * HTML5 Audio (streaming) umesto Web Audio (full decode u RAM).
 * Sve komande iz sounds.json rade isto kao pre — play, fade, stop, loop.
 */
import { soundManager } from "playa-core";
import { Howl } from "howler";

const STREAMING_IDS: string[] = [
${tracks.map(t => `    "${t.soundId}"`).join(',\n')}
];

// Wait for player to be ready (sounds.json loaded, sprites created), then inject HTML5 Howls
(function inject() {
    const player = soundManager.player as any;
    if (!player || !player._soundManifestData) { setTimeout(inject, 100); return; }

    // Read actual URLs from the manifest that framework already resolved (handles webpack hashes)
    const manifest = player._soundManifestData.soundManifest || [];
    const soundUrl = player._soundUrl || {};

    const toLoad = STREAMING_IDS.map(id => {
        const entry = manifest.find((e: any) => e.id === id);
        if (!entry) return null;
        // Resolve URL same way framework does — check _soundUrl map first, fallback to raw src
        const rawSrc = entry.src.find((s: string) => s.endsWith(".m4a")) || entry.src[0];
        const resolvedUrl = soundUrl[rawSrc] || rawSrc;
        return { id, src: resolvedUrl };
    }).filter(Boolean) as Array<{ id: string; src: string }>;

    let loadedCount = 0;
    toLoad.forEach(({ id, src }) => {
        const spriteId = "s_" + id;
        const h = new Howl({
            src: [src],
            html5: true,
            preload: true,
            sprite: { [spriteId]: [0, 600000] }
        });
        h.once("load", () => {
            const realDuration = Math.round(h.duration() * 1000);
            if (realDuration > 0) (h as any)._sprite[spriteId] = [0, realDuration];

            player._howlInstances[src] = h;
            const stale = player._soundSprites.get(spriteId);
            if (stale) {
                player._tags?.forEach((tag: any) => {
                    tag.sprites = tag.sprites.filter((s: any) => s !== stale);
                });
            }
            player.addHowls(h, src, id);
            loadedCount++;
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
