#!/usr/bin/env node

/**
 * compareEncoders.js — A/B test: native AAC vs FDK-AAC
 *
 * Usage: node scripts/compareEncoders.js [soundName]
 *   soundName = WAV filename without extension (e.g. "UiButtonClick")
 *   If omitted, picks the first WAV in sourceSoundFiles/
 *
 * Output: dist/encoder-test/
 *   native_<name>.m4a  — encoded with FFmpeg native AAC
 *   fdk_<name>.m4a     — encoded with libfdk_aac (if available)
 *
 * Listen to both files to compare quality at the same bitrate.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const pathToFFmpeg = require('ffmpeg-static');

// ── Read config ──────────────────────────────────────────────────────────────
let spriteConfig;
try { spriteConfig = JSON.parse(fs.readFileSync('sprite-config.json', 'utf8')); }
catch { console.error('Cannot read sprite-config.json — run from project root.'); process.exit(1); }

const encoding = spriteConfig.encoding || {};
const sfxEnc = encoding.sfx || { bitrate: 64, channels: 2, samplerate: 44100 };
const musicEnc = encoding.music || { bitrate: 64, channels: 2, samplerate: 44100 };

// ── Pick source file ─────────────────────────────────────────────────────────
const sourceDir = './sourceSoundFiles';
if (!fs.existsSync(sourceDir)) { console.error('sourceSoundFiles/ not found.'); process.exit(1); }

const arg = process.argv[2];
let wavFiles;
if (arg) {
    const safeName = path.basename(arg);
    const p = path.join(sourceDir, safeName + '.wav');
    if (!fs.existsSync(p)) { console.error(`File not found: ${p}`); process.exit(1); }
    wavFiles = [safeName];
} else {
    wavFiles = fs.readdirSync(sourceDir).filter(f => f.endsWith('.wav') && !f.startsWith('.')).map(f => f.replace('.wav', ''));
    if (wavFiles.length === 0) { console.error('No WAV files in sourceSoundFiles/.'); process.exit(1); }
}

// ── Detect FDK ───────────────────────────────────────────────────────────────
let hasFdk = false;
try {
    const out = execFileSync(pathToFFmpeg, ['-encoders'], {
        timeout: 5000, maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe']
    }).toString();
    hasFdk = out.includes('libfdk_aac');
} catch (e) {
    const fallback = (e.stderr ? e.stderr.toString() : '') + (e.stdout ? e.stdout.toString() : '');
    hasFdk = fallback.includes('libfdk_aac');
}

if (!hasFdk) {
    console.log('');
    console.log('==========================================================');
    console.log('  libfdk_aac NOT available in this ffmpeg binary.');
    console.log('');
    console.log('  To test FDK-AAC, replace ffmpeg-static with a build');
    console.log('  that includes libfdk_aac:');
    console.log('    Windows: gyan.dev "full" build');
    console.log('    macOS:   brew install ffmpeg (includes FDK)');
    console.log('');
    console.log('  Building native-only samples for reference...');
    console.log('==========================================================');
    console.log('');
}

// ── Output dir ───────────────────────────────────────────────────────────────
const outDir = path.join('dist', 'encoder-test');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

// ── Encode ───────────────────────────────────────────────────────────────────
function encode(inputWav, outputM4a, encoder, bitrate, channels, samplerate) {
    const args = ['-y', '-i', inputWav];
    if (encoder === 'libfdk_aac') {
        args.push('-c:a', 'libfdk_aac', '-b:a', bitrate + 'k', '-afterburner', '1');
    } else {
        args.push('-ab', bitrate + 'k', '-strict', '-2');
    }
    args.push('-ac', String(channels), '-ar', String(samplerate), outputM4a);

    execFileSync(pathToFFmpeg, args, { timeout: 120000, maxBuffer: 5 * 1024 * 1024 });
}

function fileSize(p) {
    try { return fs.statSync(p).size; } catch { return 0; }
}

function formatKB(bytes) {
    return (bytes / 1024).toFixed(1) + ' KB';
}

console.log(`FFmpeg: ${pathToFFmpeg}`);
console.log(`FDK-AAC: ${hasFdk ? 'YES' : 'NO (native only)'}`);
console.log(`SFX encoding: ${sfxEnc.bitrate}kbps ${sfxEnc.channels}ch ${sfxEnc.samplerate}Hz`);
console.log(`Music encoding: ${musicEnc.bitrate}kbps ${musicEnc.channels}ch ${musicEnc.samplerate}Hz`);
console.log('');

const standaloneSounds = new Set(spriteConfig.standalone?.sounds || []);
const streamingSounds = new Set(spriteConfig.streaming?.sounds || []);

for (const name of wavFiles) {
    const inputPath = path.join(sourceDir, name + '.wav');
    const isMusic = standaloneSounds.has(name) || streamingSounds.has(name);
    const enc = isMusic ? musicEnc : sfxEnc;
    const typeLabel = isMusic ? 'MUSIC' : 'SFX';

    console.log(`── ${name} (${typeLabel}, ${enc.bitrate}kbps ${enc.channels}ch) ──`);

    // Native AAC
    const nativePath = path.join(outDir, `native_${name}.m4a`);
    try {
        encode(inputPath, nativePath, 'aac', enc.bitrate, enc.channels, enc.samplerate);
        console.log(`  native:  ${nativePath}  (${formatKB(fileSize(nativePath))})`);
    } catch (e) {
        console.error(`  native:  FAILED — ${e.message}`);
    }

    // FDK-AAC
    if (hasFdk) {
        const fdkPath = path.join(outDir, `fdk_${name}.m4a`);
        try {
            encode(inputPath, fdkPath, 'libfdk_aac', enc.bitrate, enc.channels, enc.samplerate);
            console.log(`  fdk:     ${fdkPath}  (${formatKB(fileSize(fdkPath))})`);

            const nativeSize = fileSize(nativePath);
            const fdkSize = fileSize(fdkPath);
            if (nativeSize > 0 && fdkSize > 0) {
                const diffNum = (fdkSize - nativeSize) / nativeSize * 100;
                const diffStr = (diffNum >= 0 ? '+' : '') + diffNum.toFixed(1);
                const label = diffNum > 0.1 ? 'FDK larger' : diffNum < -0.1 ? 'FDK smaller' : 'same size';
                console.log(`  size delta: ${diffStr}% (${label})`);
            }
        } catch (e) {
            console.error(`  fdk:     FAILED — ${e.message}`);
        }
    }

    console.log('');
}

console.log(`Output: ${path.resolve(outDir)}`);
console.log('Listen to both files to compare quality.');
