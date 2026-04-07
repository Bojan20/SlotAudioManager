# Streaming Muzike u IGT Slot Igrama — Implementacija

> **Production Implementation Document**
> playa-core (Howler.js 2.2.3, sounds.json manifest, SubLoader system)
> Datum: 2026-04-07

---

## Sadržaj

1. [Problem](#problem)
2. [Rešenje — Direktan HTML5 Audio](#resenje--direktan-html5-audio)
3. [Zašto NE SubLoader + Swap](#zasto-ne-subloader--swap)
4. [Runtime Flow — korak po korak](#runtime-flow--korak-po-korak)
5. [URL rezolucija — kako dobijamo URL](#url-rezolucija--kako-dobijamo-url)
6. [Registracija HTML5 Howl-a u SoundPlayer](#registracija-html5-howl-a-u-soundplayer)
7. [Build Pipeline — deployStreaming.js](#build-pipeline--deploystreamingjs)
8. [sounds.json — streaming entries](#soundsjson--streaming-entries)
9. [BGMStreamingInit.ts — generisani kod](#bgmstreaminginitts--generisani-kod)
10. [Šta developer radi (ništa)](#sta-developer-radi-nista)
11. [playa-core internali](#playa-core-internali)
12. [Kompatibilnost sa playa-core sistemima](#kompatibilnost-sa-playa-core-sistemima)
13. [Memorijski budžet](#memorijski-budzet)
14. [Poznata ograničenja](#poznata-ogranicenja)
15. [Debugging](#debugging)
16. [Test matrica](#test-matrica)

---

## Problem

playa-core `SoundLoader` konvertuje SVAKI audio fajl u Web Audio buffer kroz `decodeAudioData()`. Za muzičku traku od 60s, stereo, 44100Hz:

```
60s × 44100 × 2ch × 4 bytes = 21.2 MB RAM (od 300KB M4A na disku)
```

7 muzičkih traka = **~150 MB RAM samo za muziku**. Mobile Safari limit je ~128 MB. **Igra puca.**

HTML5 Audio (`<audio>` element) strimuje sa diska — drži ~3 MB buffer umesto celokupnog dekodiranog PCM-a. **10-15x ušteda.**

---

## Rešenje — Direktan HTML5 Audio

**Muzika se NIKAD ne učitava kroz Web Audio. Nikad se ne dekoduje u RAM. Nikad nema swap.**

```
STARI PRISTUP (SubLoader + Swap):
  boot → SubLoader M → Web Audio decode (40MB, 30s) → swap → HTML5 (3MB)
                                                       ↑ pucketanje, bugovi, peak RAM

DIREKTAN HTML5 (sadašnji pristup):
  boot → BGMStreamingInit čita URL iz _soundUrl → new Howl({ html5: true }) → gotovo
         ↑ ~1s, 3MB, nema swap-a, nema Web Audio uopšte
```

### Kako radi

1. Muzički entries u sounds.json imaju `loadType: "M"`
2. playa-core resolve-uje URL-ove za SVE manifest entries tokom `process()` — uključujući "M"
3. playa-core NE učitava "M" entries (registruje za SubLoader koji se nikad ne trigeruje)
4. BGMStreamingInit.ts čita resolved URL iz `player._soundUrl`
5. Kreira HTML5 Howl **direktno** — browser strimuje sa diska, ~3 MB RAM
6. Registruje kroz `addHowl()` — playa-core commands rade normalno

**Zero Web Audio za muziku. Zero swap. Zero state transfer.**

---

## Zašto NE SubLoader + Swap

Prethodni pristup je koristio SubLoader "M" da učita muziku kroz playa-core pipeline, pa je swap-ovao Web Audio Howl na HTML5. Problemi:

| Problem | Uzrok | Posledica |
|---------|-------|-----------|
| **Pucketanje** | Swap menja Howl dok muzika svira | Audio artifact na momentu swap-a |
| **Missing BonusEnd/BigWinEnd** | Swap pravi novi SoundSprite sa pogrešnim stanjem | Komande targetiraju stale referencu |
| **Base muzika u bonusu** | Swap restore-uje `_isPlaying` na traci koja je stop-ovana | Muzika se sama pokrene |
| **30s čekanje** | SubLoader mora da čeka queue (A→B→M) | Muzika kasni |
| **Peak RAM** | Web Audio decode (40MB) + HTML5 (3MB) istovremeno | Viši peak nego bez streaming-a |
| **Duplo učitavanje** | Učitaj kao Web Audio pa zameni na HTML5 | Besmisleno trošenje resursa |

Direktan HTML5 eliminiše SVE ove probleme jer nikad ne postoji stari Howl, nema swap-a, nema state transfer-a.

---

## Runtime Flow — korak po korak

```
BOOT:
  1. playa-core učitava sounds.json
  2. SoundLoader.process() — resolvuje URL-ove za SVE manifest entries
     - "soundFiles/BaseGameMusicLoop.m4a" → "assets/.../BaseGameMusicLoop.646a97.m4a"
     - Čuva u manifest.sounds (= player._soundUrl)
     - loadType "M" entries idu u _subLoaderSounds["M"] — ali SubLoader se NIKAD ne trigeruje
  3. SFX sprite-ovi se učitavaju normalno (Web Audio, immediate)
  4. setSounds() kreira SoundSprite za SVE entries — muzički imaju howl = undefined
     - Komanda za muziku → SoundSprite.play() → if (howl === undefined) return; → tih fail
  5. setRawUrls(manifest.sounds) — player._soundUrl sadrži SVE resolved URL-ove

  BGMStreamingInit.ts (auto-injected u main.ts):
  6. Čeka SoundPlayer (poll: _soundSprites.size > 0 && _soundUrl postoji)
  7. Za svaki muzički track:
     a. Čita manifest entry: soundManifest.find(m => m.id === name)
     b. Čita resolved URL: _soundUrl[manifest.src[0]]
     c. Kreira: new Howl({ src: [url], html5: true, sprite: { [spriteId]: [0, duration] } })
     d. Na "load":
        - _howlInstances[url] = howl (gate za addHowl)
        - Očisti stale SoundSprite iz _tags (onaj sa undefined howl)
        - addHowl(howl, url, spriteId) → kreira fresh SoundSprite
        - Sync tag state (mute/volume ako je Music tag već muted)
  8. Auto-play konfigurisane trackove
  9. Gotovo — muzika svira, komande rade, ~3MB per track

GAMEPLAY:
  SFX: playa-core commands rade normalno (Web Audio sprites)
  Muzika: playa-core commands rade normalno (HTML5 Howl, isti API)
  Razlika je transparentna — SoundSprite API je identičan za oba tipa

TAB HIDDEN/VISIBLE:
  pauseAllSounds() iterira Object.entries(_howlInstances)
  Naš HTML5 Howl je u _howlInstances → pauzira/resume automatski
```

---

## URL rezolucija — kako dobijamo URL

### Potvrđeno iz playa-core koda

`SoundLoader.process()` (poziva se na boot-u) resolvuje URL-ove za **SVE** manifest entries — main load I SubLoader:

```typescript
// SoundLoader.process() — simplified
for (const entry of manifest) {
    const srcRef = this._parent.props.manifest.sounds[
        this.getSoundFilePath(entry.src)    // "soundFiles/BaseGameMusicLoop.m4a"
    ];
    // srcRef = "assets/default/.../BaseGameMusicLoop.646a97.m4a"

    if (loadType === "-" || loadType === undefined) {
        this._soundFiles.push(srcRef);           // main load
    } else {
        this._subLoaderSounds[loadType].push({   // deferred
            srcRef: srcRef,
            id: entry.id
        });
    }
}
```

Posle main load-a:
```typescript
// SoundLoader.setPlayerData()
player.setRawUrls(this._parent.props.manifest.sounds);  // SVE URL-ovi
player.setHowls(this._howlInstances);                    // samo main Howl-ovi
player.setSounds(this._manifestData);                    // SVE sprite definicije
```

### Pristup iz BGMStreamingInit.ts

```typescript
const player = soundManager.player;
const manifest = player._soundManifestData.soundManifest.find(m => m.id === "BaseGameMusicLoop");
const url = player._soundUrl[manifest.src[0]];
// url = "assets/default/default/default/sounds/soundFiles/BaseGameMusicLoop.646a97.m4a"
```

**`_soundUrl` = `manifest.sounds`** — webpack-generisani map svih audio URL-ova. Ključ je originalni path iz sounds.json, vrednost je resolved URL sa hash-om.

### Fallback

Ako direktni lookup ne uspe (razlika u key formatu), BGMStreamingInit pretražuje `_soundUrl` po imenu fajla:

```typescript
const fileName = "BaseGameMusicLoop.m4a";
for (const [key, value] of Object.entries(player._soundUrl)) {
    if (key.includes(fileName)) return value;
}
```

---

## Registracija HTML5 Howl-a u SoundPlayer

```typescript
// 1. Kreiraj HTML5 Howl — browser strimuje sa diska
const howl = new Howl({
    src: [url],                // resolved URL iz _soundUrl
    html5: true,               // streaming, ~3MB RAM
    format: ["m4a"],
    sprite: { "s_BaseGameMusicLoop": [0, 101538] }  // startTime, durationMs
});

// 2. Na "load" — registruj u SoundPlayer
howl.once("load", () => {
    // Gate za addHowl: _howlInstances[srcRef] !== undefined
    player._howlInstances[url] = howl;

    // Očisti stale SoundSprite (kreiran u setSounds sa howl = undefined)
    const stale = player._soundSprites.get("s_BaseGameMusicLoop");
    if (stale) {
        player._tags.forEach((td) => {
            if (td?.sprites) td.sprites = td.sprites.filter(s => s !== stale);
        });
    }

    // Registruj — kreira fresh SoundSprite sa HTML5 Howl
    player.addHowl(howl, url, "s_BaseGameMusicLoop");

    // Sync tag state — ako je Music tag već muted
    const musicTag = player._tags.get("Music");
    if (musicTag?.muted) {
        const sp = player._soundSprites.get("s_BaseGameMusicLoop");
        sp._isMuted = true;
        sp.mute();
    }
});
```

### Zašto addHowl radi

`SoundPlayer.addHowl(howl, srcRef, spriteId)`:
1. Proveri gate: `_howlInstances[srcRef] !== undefined` ✓ (mi smo setovali)
2. Čita `soundDef` iz `_soundManifestData.soundDefinitions.soundSprites[spriteId]` ✓ (u sounds.json)
3. Kreira novi `SoundSprite(spriteId, soundDef.soundId, startTime, duration, ..., howl, ...)`
4. Registruje u `_soundSprites` Map (zamenjuje stale entry)
5. Registruje u `_tags` Map (Music tag)

Posle ovoga, komande (play, stop, fade, mute) rade identično kao za Web Audio SoundSprite — razliku ne pravi SoundPlayer nego Howler interno.

---

## Build Pipeline — deployStreaming.js

```
deployStreaming.js
├── 1. Čita sprite-config.json → streaming.sounds[], streaming.autoPlay[]
├── 2. Pomeri streaming WAV-ove iz sourceSoundFiles/ u temp dir
├── 3. Pokrene createAudioSpritesBySize.js (samo SFX)
├── 4. Pokrene makeMyJSONSizedSprites.js audioSprite (sounds.json za SFX)
├── 5. Vrati streaming WAV-ove u sourceSoundFiles/
├── 6. Enkoduje streaming WAV → M4A (ffmpeg, muzički bitrate iz sprite-config)
│     Duration iz sox (ne ffmpeg stderr)
├── 7. Doda streaming entries u dist/sounds.json sa loadType: "M"
│     soundSprites: KEY = "s_Name", soundId = "Name", startTime = 0, duration = ms
├── 8. Generiše dist/BGMStreamingInit.ts
│     Direktan HTML5 — čita URL iz _soundUrl, kreira Howl, registruje addHowl
├── 9. Kopira BGMStreamingInit.ts u game repo src/ts/utils/
│     Patchuje main.ts: import + webpack keep
└── SUMMARY
```

### Zašto webpack keep

Game repo ima `sideEffects: ["*.css"]` u package.json. Bez `if (BGM_STREAMING_ACTIVE)`, webpack tree-shakes BGMStreamingInit.ts. `if` statement koristi export → webpack ga čuva.

---

## sounds.json — streaming entries

```json
{
  "soundManifest": [
    { "id": "loading_sprite", "src": ["soundFiles/loading.m4a"] },
    { "id": "main_sprite", "src": ["soundFiles/main.m4a"], "loadType": "A" },
    { "id": "BaseGameMusicLoop", "src": ["soundFiles/BaseGameMusicLoop.m4a"], "loadType": "M" },
    { "id": "BonusMusicLoop", "src": ["soundFiles/BonusMusicLoop.m4a"], "loadType": "M" }
  ],
  "soundDefinitions": {
    "soundSprites": {
      "s_BaseGameMusicLoop": {
        "soundId": "BaseGameMusicLoop",
        "spriteId": "BaseGameMusicLoop",
        "startTime": 0,
        "duration": 101538,
        "tags": ["Music"],
        "overlap": false
      }
    },
    "commands": { ... },
    "spriteList": { ... }
  }
}
```

### loadType "M" — šta playa-core radi sa njim

1. `process()`: resolvuje URL, čuva u `_subLoaderSounds["M"]`
2. `setRawUrls()`: prosleđuje `manifest.sounds` (sadrži resolved URL) u `player._soundUrl`
3. `setSounds()`: kreira SoundSprite sa `howl = undefined` (Howl nije učitan)
4. SubLoader "M" se NIKAD ne trigeruje — entries čekaju zauvek
5. BGMStreamingInit čita URL iz `_soundUrl` i kreira HTML5 Howl direktno

---

## BGMStreamingInit.ts — generisani kod

Automatski generisan od deployStreaming.js. Ključne funkcije:

| Funkcija | Opis |
|----------|------|
| `getResolvedUrl(player, soundId)` | Čita resolved URL iz `player._soundUrl` za dati soundId |
| `registerHtml5(name, url, player)` | Kreira HTML5 Howl, registruje u SoundPlayer kroz addHowl() |
| `syncTagState(player, spriteId)` | Sync-uje mute/volume iz tag-ova na novi SoundSprite |
| `autoPlayTracks(player)` | Pokreni muziku sa play/fade params iz sounds.json commands |
| `waitForPlayer()` | Poll dok SoundPlayer ne bude spreman (ima _soundSprites i _soundUrl) |
| `init()` | Orkestracija: wait → register all → auto-play |

Ugrađeni podaci (generisani iz sprite-config.json i sounds.json):
- `MUSIC: string[]` — lista streaming zvukova
- `AUTO_PLAY: Array<{spriteId, volume, fadeVolume, loop, fadeIn}>` — autoPlay config

---

## Šta developer radi (ništa)

**NIŠTA.** Ceo sistem je automatski:

| Korak | Ko | Kako |
|-------|-----|------|
| Stavi muziku u streaming pool | Audio inženjer (u app-u) | Ručno (jednom) |
| Build SFX + streaming M4A | deployStreaming.js | Automatski |
| Generisanje BGMStreamingInit.ts | deployStreaming.js | Automatski |
| Patch main.ts | deployStreaming.js | Automatski |
| Deploy u game repo | copyAudio.js (Deploy dugme) | Automatski |
| Čitanje resolved URL-a | BGMStreamingInit.ts | Automatski |
| Kreiranje HTML5 Howl-a | BGMStreamingInit.ts | Automatski |
| Registracija u SoundPlayer | BGMStreamingInit.ts | Automatski |
| Auto-play muzike | BGMStreamingInit.ts | Automatski |
| Mute/unmute/pause/resume | playa-core commands | Automatski |

**Game developer NE dodaje nijedan poziv.** Sve se dešava kroz auto-generisan i auto-patched modul.

---

## playa-core internali

### SoundLoader.process() — URL rezolucija

```typescript
// Poziva se na boot-u za SVE manifest entries
protected async process(resource, id): Promise<string> {
    for (const entry of manifest) {
        const srcRef = manifest.sounds[getSoundFilePath(entry.src)]; // RESOLVED URL
        if (loadType === "-" || undefined) → _soundFiles[]            // main load
        else → _subLoaderSounds[loadType][]                           // deferred
    }
}
```

### SoundLoader.setPlayerData() — prosleđivanje podataka

```typescript
private setPlayerData(): void {
    player.setRawUrls(this._parent.props.manifest.sounds);  // SVE URL-ovi
    player.setHowls(this._howlInstances);                    // samo main Howl-ovi
    player.setSounds(this._manifestData);                    // SVE definicije
}
```

### SoundPlayer.addHowl() — registracija

```typescript
public addHowl(howl, srcRef, spriteId): void {
    if (this._howlInstances[srcRef] !== undefined) {        // gate check
        const soundDef = this._soundManifestData.soundDefinitions.soundSprites[spriteId];
        const sp = new SoundSprite(spriteId, soundDef.soundId, ..., howl, ...);
        this._soundSprites.set(spriteId, sp);
        // + registracija u _tags
    }
}
```

### SoundSprite — radi isto za HTML5

```typescript
class SoundSprite {
    play():   this._howl.play(this._spriteId)      // Howler radi isto za HTML5
    stop():   howl._sounds.find(x => x._sprite === spriteId) → howl.stop(id)
    fade():   howl._sounds.find(x => x._sprite === spriteId) → howl.fade(...)
    mute():   howl.mute(muteFunc(tags))             // za non-audiosprite: ceo Howl
}
```

---

## Kompatibilnost sa playa-core sistemima

| Sistem | Radi? | Kako |
|--------|-------|------|
| **Commands** (play/stop/fade/set) | ✅ | SoundSprite API isti za oba tipa Howl-a |
| **toggleTagSounds** (Music mute) | ✅ | Else grana: `sp._isMuted = isEnable; sp.mute()` — radi za non-audiosprite |
| **pauseAllSounds** (tab switch) | ✅ | Iterira `Object.entries(_howlInstances)` — naš Howl je tamo |
| **Howler.mute()** (globalni mute) | ✅ | Utiče na SVE Howl instance, uključujući HTML5 |
| **Howler.volume()** (globalni vol) | ✅ | Isto |
| **gsap delayed calls** (fade timing) | ✅ | SoundPlayer koristi gsap za delay — ne zavisi od Howl tipa |
| **Visibility handler** | ✅ | pauseAllSounds pokriva |
| **SpriteList** | N/A | Muzika ne koristi spriteList |

---

## Memorijski budžet

| Scenario | SFX (Web Audio) | Muzika | Ukupno |
|----------|----------------|--------|--------|
| **Direktan HTML5** | ~15-25 MB | ~3 MB × active tracks | **~20-30 MB** |
| **SubLoader + Swap (stari)** | ~15-25 MB | 40 MB peak → 3 MB posle swap | **~55 MB peak** |
| **Bez streaming-a** | ~15-25 MB | ~21 MB × 7 traka = ~150 MB | **~170 MB** ☠️ |

Direktan HTML5: **nikad peak viši od ~30 MB**. Nema duplog učitavanja.

---

## Poznata ograničenja

### Mobile `<audio>` limit
iOS Safari: 2-3 `<audio>` elementa. BGMStreamingInit registruje sekvencijalno. Za igre sa >3 muzičke trake, treba unload neaktivnih.

### HTML5 loop micro-gap
Na nekim starijim uređajima HTML5 `loop` ima mikro-pauzu. Na modernim browser-ima (Chromium, Safari 15+): nečujno.

### Latencija prvog play-a
HTML5 Audio: ~100-300ms (streaming buffer). Za muziku sa fade-in: neprimetno.

### Zavisnost od playa-core internala
Koristi privatna polja: `_howlInstances`, `_soundSprites`, `_tags`, `_soundUrl`, `_soundManifestData`. Howler 2.x API je stabilan godinama. IGT retko menja playa-core. Rizik nizak.

### Nema runtime unload API-ja
playa-core nema `unloadHowl()`. Za unload: `howl.stop(); howl.unload(); delete _howlInstances[url];`. BGMStreamingInit ne radi automatski unload — svi registrovani Howl-ovi ostaju. Za buduću optimizaciju.

---

## Debugging

### DevTools Console

```javascript
// Koliko Howl-ova postoji
Howler._howls.length

// Provera da li su muzički Howl-ovi HTML5
Howler._howls.forEach((h, i) => {
    console.log(i, h._html5 ? "HTML5 ✓" : "WebAudio", String(h._src).slice(0, 80));
});

// Provera _soundUrl za muziku
const p = soundManager.player;
p._soundManifestData.soundManifest
    .filter(m => m.loadType === "M")
    .forEach(m => console.log(m.id, "→", p._soundUrl[m.src[0]]));

// Provera SoundSprite stanja
p._soundSprites.forEach((sp, id) => {
    if (sp._tags?.includes("Music")) {
        console.log(id, {
            playing: sp._isPlaying,
            html5: sp._howl?._html5,
            volume: sp._volume,
            loop: sp._loop,
            muted: sp._isMuted
        });
    }
});

// Memorija (Chrome)
console.log((performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(1), "MB");

// Audio elementi
document.querySelectorAll('audio').length  // = broj HTML5 Howl-ova
```

### Log output

```
[BGM] init: 3 music tracks — direct HTML5 (no SubLoader, no Web Audio)
[BGM] BaseGameMusicLoop → ...BaseGameMusicLoop.646a97.m4a
[BGM] loading: BaseGameMusicLoop
[BGM] ✓ BaseGameMusicLoop — HTML5 ready
[BGM] BonusMusicLoop → ...BonusMusicLoop.a3b2c1.m4a
[BGM] loading: BonusMusicLoop
[BGM] ✓ BonusMusicLoop — HTML5 ready
[BGM] FreeSpinMusic → ...FreeSpinMusic.d4e5f6.m4a
[BGM] loading: FreeSpinMusic
[BGM] ✓ FreeSpinMusic — HTML5 ready
[BGM] 3/3 tracks registered
[BGM] auto-play: s_BaseGameMusicLoop → fade to 0.7 over 1500ms
[BGM] done — ~9 MB RAM (saved ~111 MB vs Web Audio)
```

---

## Test matrica

```
[ ] Base game muzika svira posle boot-a
[ ] Muzika je HTML5 (h._html5 === true u Howler._howls)
[ ] Nema pucketanja (crackling) tokom playback-a
[ ] Mute/unmute radi (Music tag toggle)
[ ] Volume control radi (fade in/out)
[ ] Loop radi bez gap-a
[ ] Tab hidden → muzika pauzira
[ ] Tab visible → muzika nastavlja
[ ] SFX rade normalno (reel land, payline, rollup)
[ ] onBonusStart komanda: base muzika stop, bonus muzika play
[ ] onBonusEnd komanda: bonus muzika stop, base muzika play
[ ] onBigWinStart: base muzika duck
[ ] onBigWinEnd: base muzika unduck
[ ] Base muzika se NE pušta sama u bonusu
[ ] BonusEnd muzika se čuje
[ ] BigWinEnd tranzicija radi
[ ] 30 min continuous — memorija stabilna
[ ] 2h continuous — nema leak
```

### Jumanji test stanje

- Audio repo: `c:\IGT\jumanji-next-level-audio`
- Game repo: `c:\IGT\jumanji-next-level-game` — `release/1.0.0` grana
- Prethodni bugovi (SubLoader + Swap): pucketanje, missing BonusEnd, base muzika u bonusu
- Direktan HTML5 pristup eliminiše sve swap-related bugove
