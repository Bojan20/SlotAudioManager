# Pseudo-Streaming BGM System for IGT Slot Games

> **Architecture Document — Production-Ready**
> Designed for playa-core framework (Howler.js, sounds.json manifest, SubLoader system)
> No framework modifications required. Fully controllable from audio design side.

---

## Table of Contents

1. [Concept Overview](#1-concept-overview)
2. [Core Technique](#2-core-technique)
3. [Audio Preparation Pipeline](#3-audio-preparation-pipeline)
4. [Runtime Behavior](#4-runtime-behavior)
5. [Howler Implementation Strategy](#5-howler-implementation-strategy)
6. [Memory & Performance Strategy](#6-memory--performance-strategy)
7. [Edge Case Handling](#7-edge-case-handling)
8. [Why This Is Superior to Standard Looping](#8-why-this-is-superior-to-standard-looping)
9. [Limitations](#9-limitations-honest)
10. [Final System Summary](#10-final-system-summary)
11. [Appendix A: Command Generator Script](#appendix-a-command-generator-script)
12. [Appendix B: Full sounds.json Example](#appendix-b-full-soundsjson-example)

---

## 1. Concept Overview

### The Problem

Standard slot BGM is a single 30-60 second M4A loop. After 4 hours of play, that loop has repeated ~240-480 times. This creates auditory fatigue, player irritation, and a cheap feel that undermines premium game experiences.

True audio streaming (fetching chunks from a server) is impossible in regulated slot environments:
- All assets must be packaged and uploaded with the game build
- No runtime network requests for content
- No external streaming services
- No engine/framework modifications

### The Solution

**Segmented Dual-Pool Crossfade Chain** — a system that achieves pseudo-streaming behavior using ONLY:
- The existing `sounds.json` manifest and command system
- The existing sprite/spriteList/Howler architecture
- The existing build pipeline (buildTiered.js + buildTieredJSON.js)
- Pre-composed audio segments with musical crossfade compatibility

The system creates the ILLUSION of continuous, non-repetitive streaming by:
1. Splitting background music into 6-8 interchangeable segments
2. Distributing segments across two playback pools
3. Using the command system's delay + fade to crossfade between pools
4. Using spriteLists with random selection for variety

**Result:** 3-5 minutes of unique content that cycles with randomized order, smooth crossfades, and no perceptible loop point. A 4-hour session hears the same segment roughly once every 3+ minutes in unpredictable order — a massive improvement over hearing the same 30-second loop 480 times.

### Why It Works Within Constraints

| Constraint | How It's Met |
|-----------|--------------|
| No framework changes | Pure sounds.json configuration — commands, spriteLists, sprites |
| No engine changes | Uses existing Howler sprite playback + gsap delay system |
| No external streaming | All segments bundled as M4A sprite in game assets |
| Deterministic | Pre-baked command chain with fixed timing — no runtime randomness beyond spriteList selection |
| Audio-design controlled | Audio designer manages sprite-config.json, sounds.json template, and WAV files |
| Production-ready | Uses proven playa-core subsystems already shipping in production |
| Regulated markets | All audio packaged, no runtime network, no non-deterministic behavior |

---

## 2. Core Technique

### The "Streaming Illusion" — Dual-Pool Alternating Crossfade

The system uses **two spriteList pools** (A and B) that alternate playback with crossfade overlap, driven by a **single master command chain** with pre-computed timing.

```
Time ─────────────────────────────────────────────────────────────►

Pool A:  ┌──fade in──┬────── playing ──────┬──fade out──┐
         │  segment  │                     │            │
         │   A[r]    │                     │            │
         └───────────┴─────────────────────┴────────────┘
                                           ┌──fade in──┬────── playing ──────┬──fade out──┐
Pool B:                                    │  segment  │                     │            │
                                           │   B[r]    │                     │            │
                                           └───────────┴─────────────────────┴────────────┘
                                                                             ┌──fade in──┬──...
Pool A:                                                                      │  segment  │
                                                                             │   A[r+1]  │
                                                                             └───────────┴──...

         ├──── SEGMENT_DURATION (30s) ─────┤
                        ├─ XFADE (3s) ─┤
         ├─── INTERVAL (27s) ──────────┤
```

- `[r]` = random selection from the pool's spriteList (no-repeat within pool)
- Crossfade window: both pools play simultaneously, one fading out, one fading in
- Zero silence gaps — there is ALWAYS at least one pool with audio

### Why Two Pools Are Required

This is not a stylistic choice. It's an architectural requirement dictated by playa-core's `clearTimersAndTweens()` behavior.

**The timer system works as follows (verified from SoundPlayer.ts source):**

1. `_timers` is a `Map<string, gsap.core.Tween[]>` — keyed by **sprite ID**, not command ID
2. `clearTimersAndTweens(commandId)` resolves ALL sprite IDs from the command via recursive `getSpriteIds()`, then kills ALL stored tweens for those sprite IDs
3. If a "fade out" tween for Pool A and a "play" tween for Pool A exist in the same timer key, clearing one clears BOTH

**With a single pool**, the fade-out tween and the next play tween would share the same timer key. Clearing would destroy both. Crossfade is impossible.

**With two pools**, each pool's timers are stored under different sprite IDs (`sl_BGM_A` vs `sl_BGM_B`). The fade-out on Pool A does NOT interfere with the play on Pool B.

### The Master Chain

Instead of recursive `execute` commands (which would cause `getSpriteIds` to recursively expand across both pools, defeating the isolation), the master command uses **direct sprite references**:

```json
"StartBGM": [
    // ─── Segment 1: Pool A ───
    {"spriteListId": "sl_BGM_A", "command": "play",  "delay": 0,     "volume": 0.01, "loop": 0},
    {"spriteListId": "sl_BGM_A", "command": "fade",  "delay": 50,    "volume": 0.7,  "duration": 3000},
    {"spriteListId": "sl_BGM_A", "command": "fade",  "delay": 27000, "volume": 0,    "duration": 3000},

    // ─── Segment 2: Pool B ───
    {"spriteListId": "sl_BGM_B", "command": "play",  "delay": 27000, "volume": 0.01, "loop": 0},
    {"spriteListId": "sl_BGM_B", "command": "fade",  "delay": 27050, "volume": 0.7,  "duration": 3000},
    {"spriteListId": "sl_BGM_B", "command": "fade",  "delay": 54000, "volume": 0,    "duration": 3000},

    // ─── Segment 3: Pool A ───
    {"spriteListId": "sl_BGM_A", "command": "play",  "delay": 54000, "volume": 0.01, "loop": 0},
    // ... continues for 4 hours ...
]
```

**Why no `execute` sub-commands?**

Verified from `getSpriteIds()` source code (SoundPlayer.ts lines 417-442):

```typescript
} else if (cmd.commandId !== null) {
    const subCmnds = this._commands.get(cmd.commandId);
    if (subCmnds !== undefined) {
        for (const subCmd of subCmnds) {
            spriteIds = spriteIds.concat(this.getSpriteIds(subCmd, count)); // RECURSIVE
        }
    }
}
```

If `StartBGM` contained `{"commandId": "_BGM_A", "command": "execute"}`, then `clearTimersAndTweens("StartBGM")` would recursively expand `_BGM_A` to get `sl_BGM_A` sprites, AND `_BGM_B` to get `sl_BGM_B` sprites. When the internal `execute("_BGM_A")` fires, `clearTimersAndTweens("_BGM_A")` would kill `sl_BGM_A` timers — including future chain entries stored under that key.

Direct references avoid this. Each command entry directly targets its pool. The timers are stored per-pool. `clearTimersAndTweens("StartBGM")` only runs once (at initial call), killing stale timers from a previous chain and starting fresh.

---

## 3. Audio Preparation Pipeline

### 3.1 Composition Rules

The single most important rule: **ANY segment must sound natural following ANY other segment.**

This is a compositional constraint, not a technical one. The segments must be written as interchangeable modules that share musical DNA but offer textural variety.

**Required characteristics:**

| Property | Requirement | Reason |
|----------|-------------|--------|
| Key/Mode | SAME across all segments | Harmonic clash on crossfade |
| BPM | SAME or no strong pulse | Rhythmic clash on crossfade |
| First 3 seconds | Gentle entry (ambient texture, pad swell) | Crossfade in — hard attacks create a "double hit" |
| Last 3 seconds | Gentle resolution (sustain, reverb tail, fade) | Crossfade out — abrupt endings create a "cut" feel |
| Melodic content | Minimal or pentatonic/modal | Strong melodies create expectation of continuation |
| Harmonic rhythm | Slow (1-2 changes per segment) | Fast changes feel "wrong" when crossfaded |
| Dynamic range | Consistent RMS across segments | Volume jumps between segments |
| Texture | Varies per segment | THIS is where variety lives |

**Musical styles that work PERFECTLY:**

- Ambient pads with subtle harmonic movement and evolving textures
- Generative-style layered soundscapes (different layers per segment)
- Pentatonic melodies over drone bass with varying instrumentation
- Cinematic underscore without thematic development
- Lo-fi atmospheric with texture variation (different percussion, different synth patches)

**Musical styles that DO NOT work:**

- Strong melodic hooks or memorable themes (feel "cut" on crossfade)
- Progressive builds toward a climax (segments expect specific ordering)
- Songs with verse/chorus structure
- Rhythmically complex patterns (crossfade creates polyrhythm)

### 3.2 Segment Length Rules

| Parameter | Recommended | Minimum | Maximum |
|-----------|-------------|---------|---------|
| Segment duration | **30 seconds** | 20 seconds | 60 seconds |
| Crossfade duration | **3 seconds** | 2 seconds | 5 seconds |
| Play interval | **27 seconds** | 18 seconds | 55 seconds |
| Segments per pool | **3** | 2 | 5 |
| Total segments | **6** | 4 | 10 |
| Total unique content | **180 seconds** | 80 seconds | 600 seconds |

**Why 30 seconds:**
- Long enough for musical development within a segment
- Short enough for reasonable memory footprint
- Divisible timing that creates clean crossfade math
- 6 × 30s = 3 minutes of unique content → pattern repeats every ~3+ minutes with random ordering

### 3.3 File Structure

```
sourceSoundFiles/
├── BGM_SegA1.wav      ← Pool A, segment 1
├── BGM_SegA2.wav      ← Pool A, segment 2
├── BGM_SegA3.wav      ← Pool A, segment 3
├── BGM_SegB1.wav      ← Pool B, segment 1
├── BGM_SegB2.wav      ← Pool B, segment 2
├── BGM_SegB3.wav      ← Pool B, segment 3
├── BaseGameMusicLoop.wav  ← Existing: simple loop for loading phase
└── ... (other game sounds)
```

### 3.4 Naming Convention

```
BGM_Seg{Pool}{Number}.wav

Pool:   A or B (which crossfade pool)
Number: 1-based index within pool
```

**Why split into A/B pools at the WAV level?**

The audio designer controls which segments go in which pool. This matters for musical continuity — you want to ensure that segments that sound best AFTER each other end up in OPPOSITE pools (since pools always alternate).

**Example pairing strategy:**

| If this plays (Pool A) | Then this follows (Pool B) | Musical reason |
|------------------------|---------------------------|----------------|
| Warm pad, low register | Bright texture, high shimmer | Register contrast |
| Active rhythmic element | Sparse ambient wash | Energy contrast |
| Evolving filter sweep | Static drone with subtle modulation | Movement contrast |

### 3.5 WAV Specifications

| Property | Value | Notes |
|----------|-------|-------|
| Format | 16-bit PCM WAV | Standard input for build pipeline |
| Sample rate | 44100 Hz | Required by encoding config |
| Channels | Mono | Recommended for memory. Stereo if budget allows |
| Duration | EXACTLY 30.000 seconds | Consistent timing is critical for command chain |
| Normalization | -14 LUFS | Consistent loudness across segments |
| Head/Tail | 3s ambient entry/exit zones | For crossfade compatibility |

**CRITICAL:** All segments MUST be the exact same duration. The master command chain is pre-computed with fixed timing. A segment that's 30.5s instead of 30.0s would cause the crossfade to misalign.

### 3.6 Transition Design (The Crossfade Zones)

Each segment has three zones:

```
├── Head (3s) ──┤──── Body (24s) ────┤── Tail (3s) ──┤
│  Ambient      │  Main musical      │  Resolve /    │
│  entry /      │  content /         │  sustain /    │
│  pad swell /  │  texture /         │  reverb tail /│
│  gentle fade  │  the "character"   │  gentle fade  │
│  from silence │                    │  to ambient   │
```

**During crossfade, two zones overlap:**

```
Outgoing segment:  ──── Body ────┤── Tail (3s) ──┤
                                 │  fading out   │
                                 ├───────────────┤
Incoming segment:                ├── Head (3s) ──┤──── Body ────
                                 │  fading in    │
```

The Tail of the outgoing segment and the Head of the incoming segment play simultaneously during the 3-second crossfade window. Since both are ambient/sparse, they blend naturally.

### 3.7 Variation Strategy

**Level 1 — Minimum viable (4 segments):**
- 2 segments per pool
- Same harmonic content, different texture layers
- ~2.5 minute cycle

**Level 2 — Recommended (6 segments):**
- 3 segments per pool
- Each segment has unique texture (different instruments, effects, rhythmic elements)
- ~3 minute cycle, 6 possible transitions per full cycle

**Level 3 — Premium (8 segments):**
- 4 segments per pool
- Full textural variety with seasonal/thematic variations
- ~4 minute cycle, significantly reduced repetition perception

**Level 4 — Cinematic (10+ segments):**
- 5+ segments per pool
- Day/night variants, mood shifts, dynamic arcs
- ~5+ minute cycle, approaches "real" streaming feel
- Memory budget: ~50+ MB decoded — only for desktop-focused games

---

## 4. Runtime Behavior (No Framework Change)

### 4.1 Two-Phase Playback

The system operates in two phases, using EXISTING game triggers:

#### Phase 1: Loading (Simple Loop)

```
Game loads → Loading tier available
           → BaseGameMusicLoop (standalone) plays with loop: -1
           → Simple, familiar base game loop
           → SubLoader "A" begins loading in background
```

This is the EXISTING behavior. No changes needed. The simple loop plays during initial load and the first few spins while SubLoader A loads the BGM segments.

#### Phase 2: Pseudo-Streaming (Segmented Chain)

```
SubLoader "A" completes → BGM segments now available in Howler
Game triggers transition → execute("TransitionToBGM")
                         → Fades out BaseGameMusicLoop
                         → Starts BGM chain
                         → Seamless crossfading begins
```

### 4.2 Event Trigger Mapping

The system uses the SAME command names the game already calls. The audio designer changes WHAT those commands DO internally through sounds.json. Zero game code changes.

| Game Event | Command Called | What Happens |
|-----------|---------------|--------------|
| Game ready + SubLoader A done | `StartBaseMusic` or `TransitionToBGM` | Fade out loop → Start chain |
| Bonus confirmed (3+ scatters) | `StopBaseMusic` | Fade + stop both pools, kill chain |
| Bonus ends | `StartBaseMusic` | Restart chain from new random segment |
| Big Win | `MuteMusic` or tag toggle | Lower volume via tag, chain continues |
| Big Win ends | `UnmuteMusic` or tag toggle | Restore volume, chain already running |

### 4.3 How Commands Are Configured

**TransitionToBGM (one-time transition from loop to chain):**
```json
"TransitionToBGM": [
    {"spriteId": "s_BaseGameMusicLoop", "command": "fade", "delay": 0, "volume": 0, "duration": 2000},
    {"spriteId": "s_BaseGameMusicLoop", "command": "stop", "delay": 2100},
    {"commandId": "StartBGM", "command": "execute", "delay": 2000}
]
```

**StopBGM (kill chain + fade out):**
```json
"StopBGM": [
    {"spriteListId": "sl_BGM_A", "command": "fade", "delay": 0, "volume": 0, "duration": 1500},
    {"spriteListId": "sl_BGM_B", "command": "fade", "delay": 0, "volume": 0, "duration": 1500},
    {"spriteListId": "sl_BGM_A", "command": "stop", "delay": 1600},
    {"spriteListId": "sl_BGM_B", "command": "stop", "delay": 1600}
]
```

**Why StopBGM kills the entire chain:**

Verified from SoundPlayer.ts source — `clearTimersAndTweens("StopBGM")`:
1. Gets sprite IDs from StopBGM's commands → `sl_BGM_A`, `sl_BGM_B`
2. Looks up `_timers.get("sl_BGM_A")` and `_timers.get("sl_BGM_B")`
3. These arrays contain ALL pending tweens from StartBGM (play/fade delayed calls)
4. `timer.kill()` on every one → entire chain is cancelled
5. Then StopBGM's own fade/stop commands execute

This works because `_timers` is keyed by sprite ID, not command ID. StartBGM's timers for `sl_BGM_A` and `sl_BGM_B` are shared with StopBGM's timer lookups.

### 4.4 Continuity Maintenance

**Between segments:** The crossfade ensures no silence gap. At the crossfade point, both pools have audio — one fading out, one fading in. Total perceived volume remains constant.

**Between sessions (restart after bonus):** `execute("StartBGM")` calls `clearTimersAndTweens("StartBGM")` first, killing any stale timers. Then sets up a fresh chain starting from the current position in each pool's random sequence. Music continues from where the spriteList left off in its random cycle (the `_currentIndex` persists on the SoundSpriteList instance).

**Across page navigation:** Not applicable — Electron app with always-mounted pages. Sound system is never unmounted.

---

## 5. Howler Implementation Strategy

### 5.1 Architecture: Single Sprite File, Dual SpriteLists

All BGM segments are built into a **single M4A sprite file** (one tier in sprite-config.json). Two `spriteList` definitions reference different segments within the same file.

```
bgm.m4a (single Howl instance)
├── [0ms - 30000ms]      BGM_SegA1
├── [30050ms - 60050ms]  BGM_SegA2  (50ms gap = spriteGap)
├── [60100ms - 90100ms]  BGM_SegA3
├── [90150ms - 120150ms] BGM_SegB1
├── [120200ms - 150200ms] BGM_SegB2
└── [150250ms - 180250ms] BGM_SegB3
         │
         ▼
sl_BGM_A → references: s_BGM_SegA1, s_BGM_SegA2, s_BGM_SegA3  (random)
sl_BGM_B → references: s_BGM_SegB1, s_BGM_SegB2, s_BGM_SegB3  (random)
```

**Why single sprite file (not standalone per segment):**
- ONE HTTP request instead of 6
- ONE AudioBuffer decode instead of 6
- ONE Howl instance to manage
- Howler natively supports concurrent sprite playback from the same AudioBuffer (each `howl.play(spriteId)` creates a new `AudioBufferSourceNode`)
- The 50ms spriteGap between segments prevents audio bleed

**Why two spriteLists (not one):**
- Each spriteList maintains its own `_currentIndex` and random state
- Two independent random sequences create unpredictable ordering
- Crossfade requires TWO sprites playing simultaneously — impossible with one list (overlap=false blocks concurrent plays on the same list)

### 5.2 sprite-config.json Configuration

```json
{
    "spriteGap": 0.05,
    "sprites": {
        "loading": {
            "maxSizeKB": 700,
            "priority": 1,
            "sounds": ["UiButtonClick", "ReelLand1", "..."],
            "description": "Minimum for first spin"
        },
        "main": {
            "maxSizeKB": 3000,
            "priority": 2,
            "subLoaderId": "A",
            "sounds": ["BigWin", "Anticipation", "..."],
            "description": "Base game SFX"
        },
        "bgm": {
            "maxSizeKB": 3000,
            "priority": 3,
            "subLoaderId": "A",
            "sounds": [
                "BGM_SegA1", "BGM_SegA2", "BGM_SegA3",
                "BGM_SegB1", "BGM_SegB2", "BGM_SegB3"
            ],
            "description": "BGM pseudo-streaming segments"
        },
        "bonus": {
            "maxSizeKB": 3000,
            "priority": 4,
            "subLoaderId": "B",
            "unloadable": true,
            "sounds": ["BonusStart", "FreeSpinMusic", "..."],
            "description": "Bonus content"
        }
    },
    "standalone": {
        "sounds": ["BaseGameMusicLoop"]
    },
    "encoding": {
        "sfx": { "bitrate": 64, "channels": 1, "samplerate": 44100 },
        "music": { "bitrate": 96, "channels": 2, "samplerate": 44100 }
    },
    "musicTags": ["Music"],
    "sfxTags": ["SoundEffects"]
}
```

**Encoding note:** Sprite tiers use `sfx` encoding (64kbps). For BGM, this is acceptable — 64kbps AAC mono sounds good for ambient background music through phone speakers. If higher quality is needed, increase `sfx.bitrate` (affects all sprite tiers) or modify the build script to support per-tier encoding overrides.

### 5.3 sounds.json Template Additions

The audio designer adds these to the template sounds.json. The build pipeline preserves `spriteList` and `commands` sections.

**SpriteLists:**
```json
"spriteList": {
    "sl_BGM_A": {
        "items": ["s_BGM_SegA1", "s_BGM_SegA2", "s_BGM_SegA3"],
        "type": "random",
        "tags": ["Music"],
        "overlap": false,
        "isMuted": false
    },
    "sl_BGM_B": {
        "items": ["s_BGM_SegB1", "s_BGM_SegB2", "s_BGM_SegB3"],
        "type": "random",
        "tags": ["Music"],
        "overlap": false,
        "isMuted": false
    }
}
```

**Key settings:**
- `type: "random"` — no-repeat random selection (verified: `getRandomIndex()` creates indexed list, removes selected to prevent consecutive repeats)
- `overlap: false` — ensures only ONE segment plays per pool at a time
- `tags: ["Music"]` — allows game to mute BGM via Music tag toggle

### 5.4 The Master Command Chain

The `StartBGM` command contains pre-computed entries for the entire session duration:

```json
"StartBGM": [
    // ─── T=0: Pool A, Segment [random] ───
    {"spriteListId": "sl_BGM_A", "command": "play", "delay": 0,     "volume": 0.01, "loop": 0},
    {"spriteListId": "sl_BGM_A", "command": "fade", "delay": 50,    "volume": 0.7,  "duration": 3000},
    {"spriteListId": "sl_BGM_A", "command": "fade", "delay": 27000, "volume": 0,    "duration": 3000},

    // ─── T=27s: Pool B, Segment [random] ───
    {"spriteListId": "sl_BGM_B", "command": "play", "delay": 27000, "volume": 0.01, "loop": 0},
    {"spriteListId": "sl_BGM_B", "command": "fade", "delay": 27050, "volume": 0.7,  "duration": 3000},
    {"spriteListId": "sl_BGM_B", "command": "fade", "delay": 54000, "volume": 0,    "duration": 3000},

    // ─── T=54s: Pool A, Segment [random] ───
    {"spriteListId": "sl_BGM_A", "command": "play", "delay": 54000, "volume": 0.01, "loop": 0},
    {"spriteListId": "sl_BGM_A", "command": "fade", "delay": 54050, "volume": 0.7,  "duration": 3000},
    {"spriteListId": "sl_BGM_A", "command": "fade", "delay": 81000, "volume": 0,    "duration": 3000},

    // ... pattern repeats every 27000ms, alternating A and B ...
    // ... for 4 hours: ~533 cycles × 3 entries = ~1600 entries ...
]
```

**Why this works (verified from source code):**

1. `execute("StartBGM")` → `clearTimersAndTweens("StartBGM")` kills stale timers
2. All 1600 entries are processed in a loop
3. Each entry creates a `gsap.delayedCall(delay/1000, onDelayTimer, [cmd, "StartBGM"])`
4. Timer is stored via `addTimer(cmd, timer)` under `sl_BGM_A` or `sl_BGM_B` key
5. gsap manages all 1600 timers efficiently (~300 bytes each ≈ ~480KB total — negligible)

**Timing breakdown per cycle (27 seconds):**

```
T+0ms:     play Pool X (volume 0.01, loop 0)
T+50ms:    fade Pool X to 0.7 over 3000ms
           → Audible from ~T+50ms, full volume at T+3050ms

T+27000ms: fade Pool X to 0 over 3000ms
           → Begins fading, reaches silence at T+30000ms
           → Segment ends naturally at T+30000ms (duration = 30s)

T+27000ms: play Pool Y (volume 0.01, loop 0)  ← SIMULTANEOUS with fade-out
T+27050ms: fade Pool Y to 0.7 over 3000ms
           → Crossfade window: T+27000 to T+30000 (3 seconds)
```

### 5.5 Gapless Playback Workaround

True gapless is impossible with Howler sprites (there's always a processing delay between "end" event and next play). The crossfade sidesteps this entirely:

- Segments OVERLAP by 3 seconds — there is never a moment with zero audio
- The outgoing segment fades to 0 while the incoming fades to full
- The 50ms spriteGap in the M4A file is irrelevant — we never play adjacent sprites sequentially without crossfade
- Volume math: during crossfade, total perceived volume = outgoing + incoming ≈ constant (linear crossfade)

### 5.6 Why play with volume 0.01 (not 0)

Howler.js on some browsers (particularly mobile Safari) may not properly start audio playback at volume 0. Starting at 0.01 (inaudible through speakers) ensures:
- The audio context is engaged
- The AudioBufferSourceNode starts immediately
- The fade command has a valid "from" volume to work with

The 50ms delay before the fade-in command (`delay: 50`) gives the play command time to initialize the Howler sound instance before the fade reads its current volume.

---

## 6. Memory & Performance Strategy

### 6.1 Memory Budget

#### Default Configuration (6 segments × 30s, mono)

| Component | Compressed (M4A) | Decoded (AudioBuffer) |
|-----------|-------------------|-----------------------|
| BGM sprite file | ~1.4 MB | ~31.8 MB |
| Per-segment | ~230 KB | ~5.3 MB |

**Decoded memory calculation:**
```
30 seconds × 44100 Hz × 1 channel × 4 bytes (Float32) = 5,292,000 bytes ≈ 5.04 MB
6 segments × 5.04 MB = 30.24 MB
+ spriteGaps (5 × 50ms) = negligible
Total ≈ 31.8 MB decoded
```

#### Budget Variants

| Configuration | Segments | Duration | M4A Size | Decoded RAM | Quality |
|---------------|----------|----------|----------|-------------|---------|
| **Minimal** | 4 × 20s | 80s | ~620 KB | ~14 MB | Good |
| **Standard** | 6 × 30s | 180s | ~1.4 MB | ~32 MB | Great |
| **Premium** | 8 × 30s | 240s | ~1.9 MB | ~42 MB | Excellent |
| **Cinematic** | 10 × 45s | 450s | ~3.5 MB | ~79 MB | Exceptional |

#### Total Game Audio Budget (Typical Mobile)

```
Loading tier:     ~5-10 MB decoded
Main tier:        ~20-30 MB decoded
BGM tier:         ~32 MB decoded (NEW)
Bonus tier:       ~20-30 MB decoded (loaded on demand, unloadable)
Standalone loop:  ~5-10 MB decoded
─────────────────────────────────
Total:            ~82-112 MB decoded

Mobile Safari limit: ~128 MB per web view
Budget remaining:    ~16-46 MB headroom
```

### 6.2 Mobile Optimization

**Mono vs Stereo:**

| | Mono | Stereo |
|--|------|--------|
| Decoded RAM | 31.8 MB | 63.5 MB |
| Quality on phone speaker | Identical | Identical |
| Quality on earbuds | Slightly less spatial | Full spatial |
| Recommendation | **Mobile-first games** | Desktop-only games |

Most slot players use phone speakers or cheap earbuds. Mono BGM at 64kbps AAC is indistinguishable from stereo in this context. The 50% memory savings is significant.

**If stereo is required:** Use the "Minimal" configuration (4 × 20s stereo = ~28 MB) instead of the standard (6 × 30s).

### 6.3 Load Time Optimization

| Strategy | Implementation |
|----------|---------------|
| Deferred loading | BGM tier has `subLoaderId: "A"` — loads after first spin, not at game start |
| Single HTTP request | All segments in one M4A sprite = one fetch() call |
| Parallel with SFX | BGM tier loads alongside main tier (both SubLoader A), utilizing available bandwidth |
| Simple loop fallback | `BaseGameMusicLoop` standalone plays during loading — player hears music immediately |
| No decode overhead | Single Howl instance = single `decodeAudioData()` call |

**Load sequence:**
```
T=0:    Game starts, loading tier available
        → BaseGameMusicLoop plays (standalone, main load)

T=5-10: SubLoader "A" triggered on first spin
        → main.m4a + bgm.m4a start loading in parallel

T=15-30: SubLoader "A" complete
         → BGM segments available
         → Game can transition to pseudo-streaming BGM
```

### 6.4 CPU Impact

| Resource | Impact | Why |
|----------|--------|-----|
| gsap timers | Negligible | ~1600 pending DelayedCall objects (~480KB RAM, <0.1% CPU) |
| Concurrent Howler plays | Minimal | During crossfade: 2 AudioBufferSourceNodes for 3 seconds |
| Fade processing | Zero JS CPU | Howler.fade() uses Web Audio API's `linearRampToValueAtTime()` — native, off-main-thread |
| Command JSON | ~130 KB | Parsed once at sounds.json load, stored in _commands Map |

---

## 7. Edge Case Handling

### 7.1 Tab Switching (Visibility Change)

**What happens (verified from SoundService.ts):**
1. Tab hidden → `handleVisibilityChange()` → `pauseAllSounds(true)` → all Howler instances paused
2. gsap uses `requestAnimationFrame` internally → completely paused by browser when tab is hidden
3. Tab visible → `handleVisibilityChange()` → `pauseAllSounds(false)` → Howler resumes
4. gsap catches up — all past-due delayed calls fire rapidly

**The catch-up problem:**
When the player returns after 5 minutes away, ~10+ delayed calls fire simultaneously. Multiple play/fade commands on both pools execute in rapid succession.

**Why it's not catastrophic:**
- SoundSpriteList.play() with `overlap: false` and `_isPlaying = true` → does nothing (verified: enters `else if (this._overlap || ...)` branch, but `_isPlaying` is true and overlap is false → skipped, only `_isPlaying = true` is set again)
- The LAST play command in the catch-up sequence becomes the active segment
- Previous fade-to-zero commands may override the latest fade-to-0.7
- Worst case: both pools end up at volume 0 momentarily, then the next scheduled play/fade pair restores audio within one cycle (27 seconds)

**Practical impact by absence duration:**

| Away Duration | Catch-up Calls | User Experience |
|---------------|----------------|-----------------|
| < 10 seconds | 0-1 | Seamless — music continues as if never paused |
| 10-60 seconds | 1-3 | Brief volume fluctuation, stabilizes in < 3 seconds |
| 1-5 minutes | 3-10 | Short audio glitch on return, stabilizes within one cycle |
| 5+ minutes | 10+ | 1-2 seconds of silence/noise, then music resumes |

**Mitigation (requires ONE line of game code — optional):**

If the game's `visibilitychange` handler can call `soundManager.execute("StartBGM")` on tab return, the chain restarts cleanly. This kills all stale timers and begins a fresh chain.

```typescript
// In game's base controller (optional enhancement)
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isBGMActive) {
        soundManager.execute("StartBGM"); // Restart chain cleanly
    }
});
```

### 7.2 Interruption — Bonus Entry

```
Game: execute("StopBGM")
  → clearTimersAndTweens("StopBGM") kills ALL chain timers
  → Fade out both pools (1.5s)
  → Stop both pools
  → Silence — bonus music takes over

Bonus music plays via separate commands (standard system)

Game: execute("StartBGM")
  → clearTimersAndTweens("StartBGM") kills any residual timers
  → Fresh chain starts from current random position
  → Crossfade begins anew
```

**Key detail:** The spriteList's random state (`_currentIndex`, `_soundIndices`, `_lastSelected`) persists on the SoundSpriteList instance. After bonus, the random sequence CONTINUES where it left off — no repeat of the last-played segment.

### 7.3 Interruption — Big Win

Big wins should NOT stop the BGM chain — they should duck it.

**Option A: Volume duck via fade command**
```json
"BigWinDuckBGM": [
    {"spriteListId": "sl_BGM_A", "command": "fade", "delay": 0, "volume": 0.15, "duration": 500},
    {"spriteListId": "sl_BGM_B", "command": "fade", "delay": 0, "volume": 0.15, "duration": 500}
],
"BigWinRestoreBGM": [
    {"spriteListId": "sl_BGM_A", "command": "fade", "delay": 0, "volume": 0.7, "duration": 1000},
    {"spriteListId": "sl_BGM_B", "command": "fade", "delay": 0, "volume": 0.7, "duration": 1000}
]
```

**CAUTION:** `clearTimersAndTweens("BigWinDuckBGM")` resolves sl_BGM_A and sl_BGM_B sprite IDs → kills ALL pending StartBGM timers! The chain would be destroyed.

**Option B (RECOMMENDED): Tag volume**

```json
"BigWinDuckBGM": [
    {"tag": "Music", "command": "set", "volume": 0.2, "delay": 0}
],
"BigWinRestoreBGM": [
    {"tag": "Music", "command": "set", "volume": 1.0, "delay": 0}
]
```

Tag commands do NOT resolve sprite IDs the same way — the tag name itself is the key, not individual sprite IDs. The chain remains intact.

**Verified from onDelayTimer source:**
```typescript
if (this._tags.has(cmd.tag)) {
    const tag = this._tags.get(cmd.tag) as any;
    switch (cmd.command.toLowerCase()) {
        case "set":
            if (cmd.volume != null) {
                tag.volume = cmd.volume;
                tag.sprites.forEach((sp) => (sp.volume = sp.volume));
            }
            break;
    }
}
```

The tag "set" changes the tag's volume multiplier. All sprites with that tag have their effective volume recalculated. The chain's timers are untouched because `clearTimersAndTweens("BigWinDuckBGM")` resolves getSpriteIds for `{tag: "Music"}` → returns `"Music"` → looks up `_timers.get("Music")` → likely empty (no timers stored under tag keys for chain commands).

### 7.4 Segment Load Failure

If one BGM segment fails to load (corrupt file, network error during SubLoader):

- The SoundLoader logs `"loaderror"` but continues loading other files
- The failed segment's sprite definition exists in sounds.json but has no Howl instance
- When the spriteList tries to play it, `SoundSprite.play()` early-returns (`if (this._howl === undefined) return`)
- The segment is silently skipped — next scheduled play fires 27 seconds later with the other pool
- Worst case: 3 seconds of silence where the failed segment should have been, then normal playback resumes

**Mitigation:** Test all segments during development. Build validation (`validateBuild.js`) checks M4A existence and size.

### 7.5 Resume After Long Pause

If the game is paused (phone call, app backgrounded on mobile):

- Same behavior as tab switching — gsap catches up on resume
- The browser may garbage-collect audio contexts during long background periods
- Howler handles AudioContext recreation on resume (`autoUnlock: true`)
- Chain resumes from catch-up point

### 7.6 StopBGM When Nothing Is Playing

If `StopBGM` is called when the chain isn't active:
- `clearTimersAndTweens("StopBGM")` finds no timers → no-op
- Fade commands target sl_BGM_A/sl_BGM_B → sprites exist but nothing is playing → fade is a no-op
- Stop commands → no-op (nothing to stop)
- Safe — no errors, no state corruption

---

## 8. Why This Is Superior to Standard Looping

### vs. Single Loop BGM

| Aspect | Single Loop | Pseudo-Streaming |
|--------|-------------|------------------|
| Content duration | 30-60 seconds | 180+ seconds |
| Repetition cycle | 30-60 seconds | 3+ minutes with random order |
| Loop point audibility | Yes — always the same point | No — crossfade masks all transitions |
| Player fatigue (4h session) | Severe (480+ identical repeats) | Minimal (80 repeats, random order) |
| Memory overhead | ~10-20 MB | ~32 MB (+12-22 MB) |
| Implementation complexity | Zero | Medium (one-time setup) |
| **Verdict** | Cheap, dated feel | Premium, modern feel |

### vs. Standard Sprite Looping

| Aspect | Sprite Loop (loop: -1) | Pseudo-Streaming |
|--------|------------------------|------------------|
| Loop behavior | Same sprite loops forever | Different segments crossfade |
| Audible seam | Yes — Howler has micro-gap on sprite loop | No — crossfade overlaps the transition |
| Variety | None | 6+ segments with random selection |
| Dynamic response | None | Can duck, pause, transition seamlessly |
| **Verdict** | Functional but repetitive | Professional broadcast quality |

### vs. Naive Random Playback

| Aspect | Random Play on End | Dual-Pool Crossfade |
|--------|-------------------|---------------------|
| Gap between segments | 5-50ms (Howler callback latency) | Zero (overlap crossfade) |
| Transition quality | Audible click/gap | Smooth 3s crossfade |
| Timing control | Non-deterministic (end event delay varies) | Deterministic (pre-computed delays) |
| State management | Complex (need "on end" callback orchestration) | Simple (gsap handles everything) |
| Framework changes needed | Yes (need access to Howler end events) | No (pure sounds.json) |
| **Verdict** | Hacky, unreliable | Production-grade |

### vs. Multiple Long Loops

| Aspect | 3× Long Loops (3 min each) | Segmented Pseudo-Streaming |
|--------|---------------------------|---------------------------|
| Total audio content | 9 minutes | 3 minutes |
| Memory (stereo) | ~190 MB decoded | ~64 MB decoded |
| Memory (mono) | ~95 MB decoded | ~32 MB decoded |
| Transition between loops | Hard switch or manual crossfade | Automatic crossfade |
| Variety per cycle | 3 fixed sequences | 6+ segments × random order |
| File size (M4A) | ~6.5 MB | ~1.4 MB |
| Load time | 3 HTTP requests | 1 HTTP request |
| **Verdict** | Memory-expensive, limited variety | Memory-efficient, more variety |

---

## 9. Limitations (Honest)

### Hard Limitations

1. **Not true streaming.** Total unique content is limited by decoded memory budget. A 32 MB budget gives ~3 minutes. True streaming gives unlimited content. But true streaming is impossible in this environment.

2. **Fixed segment duration.** All segments MUST be the same length (±10ms). The command chain is pre-computed. Variable-length segments would require runtime orchestration (framework change).

3. **Tab-return audio glitch.** When a player returns after 5+ minutes away, there may be 1-2 seconds of audio artifact as gsap catches up. Not fixable without game code involvement.

4. **Crossfade constrains composition.** Every segment must start and end with ambient/sparse material. This limits the musical vocabulary — no dramatic openings or hard stops.

5. **Command array size.** A 4-hour chain generates ~1600 JSON entries (~130 KB). Not a problem for parsing, but the sounds.json file gets larger. Generated by script, not hand-authored.

6. **SFX encoding quality.** Sprite tiers use the `sfx` encoding profile. BGM segments get the same bitrate as sound effects. 64kbps mono AAC is adequate for ambient music but won't impress audiophiles.

7. **No runtime dynamic changes.** The segment order is determined by the spriteList's random selection at play time. You can't influence which segment plays based on game state (e.g., "play tense segment during anticipation"). This would require game code.

### Soft Limitations (Manageable)

8. **Memory trade-off.** Adding 32 MB decoded audio tightens the mobile memory budget. Mitigated by using mono and choosing the "Minimal" configuration for memory-constrained games.

9. **Build pipeline compatibility.** Requires the BGM tier in sprite-config.json and manual spriteList/command entries in the template sounds.json. Not auto-generated by the current build pipeline (but the command generator script automates this).

10. **No cross-pool musical awareness.** Pool A doesn't "know" what Pool B just played. The system relies on compositional compatibility, not runtime logic. Mitigated by careful segment design.

---

## 10. Final System Summary

### What It Is

A production-ready pseudo-streaming background music system for IGT slot games that:
- Creates seamless, long-form background music from short interchangeable segments
- Uses dual-pool crossfade to eliminate all gaps and loop points
- Runs entirely within the existing playa-core framework with zero engine modifications
- Is fully controllable by the audio designer through sounds.json configuration

### How It Works

1. **6 audio segments** (30 seconds each) are composed as musically interchangeable modules
2. **Built into one M4A sprite** via the existing buildTiered.js pipeline
3. **Two spriteLists** (Pool A and Pool B, 3 segments each) provide random selection
4. **One master command** (StartBGM) pre-computes a 4-hour chain of alternating play/fade instructions
5. **gsap timers** fire at precise intervals, creating smooth 3-second crossfades between pools
6. **StopBGM** kills the entire chain by exploiting shared timer keys in `_timers` Map

### What The Audio Designer Does

1. Compose 6 segments following the crossfade-compatible rules
2. Export as WAVs to `sourceSoundFiles/`
3. Add `bgm` tier to `sprite-config.json`
4. Run the command generator script (Appendix A)
5. Paste generated spriteList + commands into template `sounds.json`
6. Build and test

### What The Game Developer Does

**Nothing beyond existing requirements.** The game already calls:
- `soundManager.execute("StartBaseMusic")` — audio designer maps this to start the chain
- `soundManager.execute("StopBaseMusic")` — audio designer maps this to stop the chain
- `startSubLoader("A")` — already loads main SFX, now also loads BGM segments

### Numbers

| Metric | Value |
|--------|-------|
| Unique content | 180 seconds (3 minutes) |
| Repetition cycle | ~3-4 minutes (random order) |
| Memory (mono) | ~32 MB decoded |
| File size (M4A) | ~1.4 MB |
| HTTP requests | 1 (single sprite file) |
| Commands in chain | ~1600 entries (~130 KB JSON) |
| Framework changes | Zero |
| Game code changes | Zero |
| Crossfade duration | 3 seconds |
| Segment duration | 30 seconds |
| Max session coverage | 4 hours continuous |

---

## Appendix A: Command Generator Script

Save as `scripts/generateBGMChain.js` in the audio project. Run with `node scripts/generateBGMChain.js`.

```javascript
#!/usr/bin/env node
/**
 * BGM Pseudo-Streaming Command Generator
 *
 * Generates the StartBGM command chain for sounds.json template.
 * Run this after deciding segment duration and session length.
 * Paste the output into your template sounds.json commands section.
 */

// ─── CONFIGURATION ───────────────────────────────────────────────
const SEGMENT_DURATION = 30000;   // ms — must match WAV length exactly
const CROSSFADE_DURATION = 3000;  // ms — head/tail ambient zone length
const TARGET_VOLUME = 0.7;        // peak volume during playback
const SESSION_HOURS = 4;          // max session length to cover
const FADE_IN_DELAY = 50;         // ms — delay before fade-in (let play() initialize)

const POOL_A_ID = 'sl_BGM_A';
const POOL_B_ID = 'sl_BGM_B';
// ─────────────────────────────────────────────────────────────────

const INTERVAL = SEGMENT_DURATION - CROSSFADE_DURATION;
const SESSION_MS = SESSION_HOURS * 3600 * 1000;
const TOTAL_SEGMENTS = Math.ceil(SESSION_MS / INTERVAL);

const chain = [];

for (let i = 0; i < TOTAL_SEGMENTS; i++) {
    const pool = i % 2 === 0 ? POOL_A_ID : POOL_B_ID;
    const baseDelay = i * INTERVAL;

    // Play (near-silent, then fade in)
    chain.push({
        spriteListId: pool,
        command: 'play',
        delay: baseDelay,
        volume: 0.01,
        loop: 0
    });

    // Fade in
    chain.push({
        spriteListId: pool,
        command: 'fade',
        delay: baseDelay + FADE_IN_DELAY,
        volume: TARGET_VOLUME,
        duration: CROSSFADE_DURATION
    });

    // Fade out (starts INTERVAL ms after play, overlaps with next segment's fade in)
    chain.push({
        spriteListId: pool,
        command: 'fade',
        delay: baseDelay + INTERVAL,
        volume: 0,
        duration: CROSSFADE_DURATION
    });
}

// ─── Generate StopBGM and supporting commands ───
const stopBGM = [
    { spriteListId: POOL_A_ID, command: 'fade', delay: 0, volume: 0, duration: 1500 },
    { spriteListId: POOL_B_ID, command: 'fade', delay: 0, volume: 0, duration: 1500 },
    { spriteListId: POOL_A_ID, command: 'stop', delay: 1600 },
    { spriteListId: POOL_B_ID, command: 'stop', delay: 1600 }
];

// ─── Generate spriteList definitions ───
const spriteLists = {
    sl_BGM_A: {
        items: ['s_BGM_SegA1', 's_BGM_SegA2', 's_BGM_SegA3'],
        type: 'random',
        tags: ['Music'],
        overlap: false,
        isMuted: false
    },
    sl_BGM_B: {
        items: ['s_BGM_SegB1', 's_BGM_SegB2', 's_BGM_SegB3'],
        type: 'random',
        tags: ['Music'],
        overlap: false,
        isMuted: false
    }
};

// ─── Output ───
const output = {
    _README: `Generated BGM chain: ${TOTAL_SEGMENTS} segments, ${INTERVAL}ms interval, ${SESSION_HOURS}h coverage`,
    spriteListsToMerge: spriteLists,
    commandsToMerge: {
        StartBGM: chain,
        StopBGM: stopBGM
    }
};

const json = JSON.stringify(output, null, 2);
const fs = require('fs');
const outPath = './bgm-chain-generated.json';
fs.writeFileSync(outPath, json, 'utf8');

console.log(`\n✅ BGM chain generated: ${outPath}`);
console.log(`   Segments: ${TOTAL_SEGMENTS}`);
console.log(`   Command entries: ${chain.length}`);
console.log(`   JSON size: ${(Buffer.byteLength(json) / 1024).toFixed(1)} KB`);
console.log(`   Session coverage: ${SESSION_HOURS} hours`);
console.log(`   Interval: ${INTERVAL}ms (${(INTERVAL/1000).toFixed(1)}s)`);
console.log(`   Crossfade: ${CROSSFADE_DURATION}ms`);
console.log(`\n📋 Merge spriteListsToMerge into your template sounds.json spriteList section`);
console.log(`📋 Merge commandsToMerge into your template sounds.json commands section\n`);
```

**Usage:**
```bash
cd /path/to/audio-project
node scripts/generateBGMChain.js
# Output: bgm-chain-generated.json
# Copy spriteListsToMerge → template sounds.json spriteList
# Copy commandsToMerge → template sounds.json commands
```

**Output stats for default config:**
```
Segments: 534
Command entries: 1602
JSON size: ~130 KB
Session coverage: 4 hours
Interval: 27000ms (27.0s)
Crossfade: 3000ms
```

---

## Appendix B: Full sounds.json Example

Relevant sections for a game called "gold-fortune":

```json
{
    "soundManifest": [
        {
            "id": "gold-fortune_loading",
            "src": ["soundFiles/gold-fortune_loading.m4a"]
        },
        {
            "id": "gold-fortune_main",
            "src": ["soundFiles/gold-fortune_main.m4a"],
            "loadType": "A"
        },
        {
            "id": "gold-fortune_bgm",
            "src": ["soundFiles/gold-fortune_bgm.m4a"],
            "loadType": "A"
        },
        {
            "id": "gold-fortune_bonus",
            "src": ["soundFiles/gold-fortune_bonus.m4a"],
            "loadType": "B",
            "unloadable": true
        },
        {
            "id": "gold-fortune_BaseGameMusicLoop",
            "src": ["soundFiles/gold-fortune_BaseGameMusicLoop.m4a"]
        }
    ],
    "soundDefinitions": {
        "soundSprites": {
            "s_BGM_SegA1": {
                "soundId": "gold-fortune_bgm",
                "spriteId": "BGM_SegA1",
                "startTime": 0,
                "duration": 30000,
                "tags": ["Music"]
            },
            "s_BGM_SegA2": {
                "soundId": "gold-fortune_bgm",
                "spriteId": "BGM_SegA2",
                "startTime": 30050,
                "duration": 30000,
                "tags": ["Music"]
            },
            "s_BGM_SegA3": {
                "soundId": "gold-fortune_bgm",
                "spriteId": "BGM_SegA3",
                "startTime": 60100,
                "duration": 30000,
                "tags": ["Music"]
            },
            "s_BGM_SegB1": {
                "soundId": "gold-fortune_bgm",
                "spriteId": "BGM_SegB1",
                "startTime": 90150,
                "duration": 30000,
                "tags": ["Music"]
            },
            "s_BGM_SegB2": {
                "soundId": "gold-fortune_bgm",
                "spriteId": "BGM_SegB2",
                "startTime": 120200,
                "duration": 30000,
                "tags": ["Music"]
            },
            "s_BGM_SegB3": {
                "soundId": "gold-fortune_bgm",
                "spriteId": "BGM_SegB3",
                "startTime": 150250,
                "duration": 30000,
                "tags": ["Music"]
            },
            "s_BaseGameMusicLoop": {
                "soundId": "gold-fortune_BaseGameMusicLoop",
                "spriteId": "BaseGameMusicLoop",
                "startTime": 0,
                "duration": 45000,
                "tags": ["Music"]
            }
        },
        "spriteList": {
            "sl_BGM_A": {
                "items": ["s_BGM_SegA1", "s_BGM_SegA2", "s_BGM_SegA3"],
                "type": "random",
                "tags": ["Music"],
                "overlap": false,
                "isMuted": false
            },
            "sl_BGM_B": {
                "items": ["s_BGM_SegB1", "s_BGM_SegB2", "s_BGM_SegB3"],
                "type": "random",
                "tags": ["Music"],
                "overlap": false,
                "isMuted": false
            }
        },
        "commands": {
            "StartBaseMusic": [
                {"spriteId": "s_BaseGameMusicLoop", "command": "play", "delay": 0, "volume": 0.6, "loop": -1}
            ],
            "StopBaseMusic": [
                {"spriteId": "s_BaseGameMusicLoop", "command": "fade", "delay": 0, "volume": 0, "duration": 2000},
                {"spriteId": "s_BaseGameMusicLoop", "command": "stop", "delay": 2100}
            ],
            "TransitionToBGM": [
                {"spriteId": "s_BaseGameMusicLoop", "command": "fade", "delay": 0, "volume": 0, "duration": 2000},
                {"spriteId": "s_BaseGameMusicLoop", "command": "stop", "delay": 2100},
                {"commandId": "StartBGM", "command": "execute", "delay": 2000}
            ],
            "StartBGM": [
                {"spriteListId": "sl_BGM_A", "command": "play",  "delay": 0,     "volume": 0.01, "loop": 0},
                {"spriteListId": "sl_BGM_A", "command": "fade",  "delay": 50,    "volume": 0.7,  "duration": 3000},
                {"spriteListId": "sl_BGM_A", "command": "fade",  "delay": 27000, "volume": 0,    "duration": 3000},
                {"spriteListId": "sl_BGM_B", "command": "play",  "delay": 27000, "volume": 0.01, "loop": 0},
                {"spriteListId": "sl_BGM_B", "command": "fade",  "delay": 27050, "volume": 0.7,  "duration": 3000},
                {"spriteListId": "sl_BGM_B", "command": "fade",  "delay": 54000, "volume": 0,    "duration": 3000},
                {"spriteListId": "sl_BGM_A", "command": "play",  "delay": 54000, "volume": 0.01, "loop": 0},
                {"spriteListId": "sl_BGM_A", "command": "fade",  "delay": 54050, "volume": 0.7,  "duration": 3000},
                {"spriteListId": "sl_BGM_A", "command": "fade",  "delay": 81000, "volume": 0,    "duration": 3000}
            ],
            "StopBGM": [
                {"spriteListId": "sl_BGM_A", "command": "fade", "delay": 0, "volume": 0, "duration": 1500},
                {"spriteListId": "sl_BGM_B", "command": "fade", "delay": 0, "volume": 0, "duration": 1500},
                {"spriteListId": "sl_BGM_A", "command": "stop", "delay": 1600},
                {"spriteListId": "sl_BGM_B", "command": "stop", "delay": 1600}
            ],
            "DuckBGM": [
                {"tag": "Music", "command": "set", "volume": 0.2, "delay": 0}
            ],
            "RestoreBGM": [
                {"tag": "Music", "command": "set", "volume": 1.0, "delay": 0}
            ]
        }
    }
}
```

> **Note:** The `StartBGM` command above is truncated to 3 cycles for readability. The production version contains ~1600 entries generated by the script in Appendix A.
