# Jumanji Next Level — Streaming Music Integration

## Za game developera — copy-paste rešenje

---

## Problem

Svih 7 muzičkih loop-ova dekodirani kroz Web Audio API zauzimaju **~151 MB RAM-a**.
Mobilni Safari limit je ~128 MB. **Igra puca.**

Rešenje: muzika se pušta kroz HTML5 Audio (`<audio>` element) koji **strimuje sa diska** i koristi **~3 MB po traci umesto 15-43 MB**.

---

## Korak 1: Dodaj fajl `BGMStreaming.ts`

Kreiraj novi fajl u game projektu:

**`src/ts/utils/BGMStreaming.ts`**

```typescript
import { Howl, Howler } from "howler";

/**
 * BGM Streaming Manager
 * 
 * Pušta muziku kroz HTML5 Audio umesto Web Audio API.
 * HTML5 Audio strimuje sa diska — ~3 MB RAM umesto ~40 MB.
 * 
 * Howler.mute() i Howler.volume() automatski utiču i na HTML5 instance.
 */

const SOUNDS_PATH = "sounds/soundFiles/";
const GAME_PREFIX = "jumanji-next-level-game_";

// ─── Muzički fajlovi (isto što build pipeline pravi kao standalone M4A) ───
export const BGMTrack = {
    BASE_GAME:       `${SOUNDS_PATH}${GAME_PREFIX}BaseGameMusicLoop.m4a`,
    FREE_SPIN:       `${SOUNDS_PATH}${GAME_PREFIX}FreeSpinMusic.m4a`,
    JUMANJI:         `${SOUNDS_PATH}${GAME_PREFIX}JumanjiMusicLoop.m4a`,
    JUMANJI_BOOST:   `${SOUNDS_PATH}${GAME_PREFIX}JumanjiMusicLoopBoost.m4a`,
    JUMANJI_ROLL:    `${SOUNDS_PATH}${GAME_PREFIX}JumanjiMusicLoopRoll.m4a`,
    PICKER:          `${SOUNDS_PATH}${GAME_PREFIX}PickerMusicLoop.m4a`,
    WHEEL:           `${SOUNDS_PATH}${GAME_PREFIX}WheelBonusMusicLoop.m4a`,
} as const;

type TrackPath = typeof BGMTrack[keyof typeof BGMTrack];

let _current: Howl | null = null;
let _currentTrack: string = "";
let _masterVolume: number = 0.7;
let _isPaused: boolean = false;

/**
 * Pokreni muzičku traku. Ako već svira ista traka — ne radi ništa.
 * Ako svira druga traka — crossfade na novu.
 */
export function playBGM(track: TrackPath, volume?: number, fadeDuration: number = 1500): void {
    if (volume !== undefined) _masterVolume = volume;

    // Ako već svira ista traka, samo vrati volume
    if (_current && _currentTrack === track && !_isPaused) {
        _current.volume(_masterVolume);
        return;
    }

    // Fade out staru traku
    const old = _current;
    if (old) {
        old.fade(old.volume(), 0, fadeDuration);
        old.once("fade", () => {
            old.unload();
        });
    }

    // Kreiraj novu HTML5 instancu
    _current = new Howl({
        src: [track],
        html5: true,      // KLJUČNO: strimuje, ne dekoduje ceo fajl u RAM
        loop: true,
        volume: 0,
        preload: true,
    });

    _currentTrack = track;
    _isPaused = false;

    _current.once("load", () => {
        if (_current) {
            _current.play();
            _current.fade(0, _masterVolume, fadeDuration);
        }
    });
}

/**
 * Zaustavi muziku sa fade-out.
 */
export function stopBGM(fadeDuration: number = 1500): void {
    if (!_current) return;

    const howl = _current;
    _current = null;
    _currentTrack = "";
    _isPaused = false;

    if (fadeDuration === 0) {
        howl.unload();
        return;
    }

    howl.fade(howl.volume(), 0, fadeDuration);
    howl.once("fade", () => {
        howl.unload();
    });
}

/**
 * Smanji volume (za big win, rollup, itd.)
 */
export function duckBGM(volume: number = 0.15, fadeDuration: number = 500): void {
    if (_current) _current.fade(_current.volume(), volume, fadeDuration);
}

/**
 * Vrati volume na master nivo.
 */
export function unduckBGM(fadeDuration: number = 800): void {
    if (_current) _current.fade(_current.volume(), _masterVolume, fadeDuration);
}

/**
 * Pauziraj (za tab switch — pozovi iz visibilitychange handlera).
 */
export function pauseBGM(): void {
    if (_current && !_isPaused) {
        _current.pause();
        _isPaused = true;
    }
}

/**
 * Nastavi posle pauze.
 */
export function resumeBGM(): void {
    if (_current && _isPaused) {
        _current.play();
        _isPaused = false;
    }
}

/**
 * Postavi master volume za buduće playBGM pozive.
 */
export function setBGMVolume(volume: number): void {
    _masterVolume = volume;
    if (_current) _current.volume(volume);
}
```

---

## Korak 2: Integriši u postojeći kod

### 2a. Import na vrhu svakog fajla gde je potreban

```typescript
import { playBGM, stopBGM, duckBGM, unduckBGM, pauseBGM, resumeBGM, BGMTrack } from "../utils/BGMStreaming";
```

### 2b. Base Game muzika

**Fajl:** `src/ts/flows/generatorFlows/BaseGameGeneratorFlow.ts`

Pronađi mesto gde base game počinje (obično u `onEnterStage` ili početku flow-a) i dodaj:

```typescript
playBGM(BGMTrack.BASE_GAME);
```

### 2c. Bonus Intro (prelazak iz base u bonus)

**Fajl:** `src/ts/commands/preShow/reelSetCommands/commands/BonusIntroCommand.ts`

Na liniji gde se poziva `soundManager.execute("onBonusGameStart")` (linija 40), dodaj ISPRED:

```typescript
stopBGM(1500); // Zaustavi base game muziku
```

### 2d. Free Spin muzika

**Fajl:** `src/ts/flows/generatorFlows/FreeSpinGeneratorFlow.ts`

Na početku free spin flow-a:
```typescript
playBGM(BGMTrack.FREE_SPIN);
```

### 2e. Jumanji bonus muzika (3 varijante)

**Fajl:** `src/ts/flows/generatorFlows/LNRGeneratorFlow.ts`

Jumanji bonus ima 3 režima. Na početku svakog:
```typescript
// Za Grow režim:
playBGM(BGMTrack.JUMANJI);

// Za Roll režim:
playBGM(BGMTrack.JUMANJI_ROLL);

// Za Boost režim:
playBGM(BGMTrack.JUMANJI_BOOST);
```

Crossfade između režima je automatski — `playBGM` detektuje da već svira druga traka i radi crossfade.

### 2f. Wheel bonus muzika

**Fajl:** `src/ts/components/bonusWheel/impl/BWCompImpl.ts`

Na liniji 73 gde je `soundManager.execute("onWheelBonusStart")`:
```typescript
playBGM(BGMTrack.WHEEL);
```

### 2g. Picker muzika

Pronađi gde picker počinje:
```typescript
playBGM(BGMTrack.PICKER);
```

### 2h. Povratak u base game (kraj bonusa)

Na svakom mestu gde se iz bonusa vraća u base game:
```typescript
playBGM(BGMTrack.BASE_GAME); // Crossfade nazad na base muziku
```

### 2i. Big Win duck

**Fajl:** `src/ts/components/bigWin/impl/BigWinCompImpl.ts`

Na početku big win animacije:
```typescript
duckBGM(0.15, 500); // Smanji muziku za vreme big win-a
```

Na kraju (linija 138, gde je `soundManager.execute("onBigWinEnd")`):
```typescript
unduckBGM(800); // Vrati muziku
```

### 2j. Tab visibility (opciono ali preporučeno)

U `main.ts` ili gde se registruju globalni eventi:
```typescript
import { pauseBGM, resumeBGM } from "./utils/BGMStreaming";

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
        pauseBGM();
    } else {
        resumeBGM();
    }
});
```

---

## Korak 3: Muziku NEMOJ stavljati u sounds.json manifest

Muzički fajlovi se **NE smeju** pojaviti u `soundManifest` nizu. Ako se pojave, SoundLoader će ih dekodirati kroz Web Audio API i pojesti RAM.

Muzički M4A fajlovi treba da budu deploy-ovani u `sounds/soundFiles/` folder ali **bez manifest entry-ja**. Howl sa `html5: true` ih čita direktno sa URL-a.

Muzičke komande u `commands` sekciji ostaviti **prazne** (kao što su sad):
```json
"onBaseGameStart": [],
"onBonusGameStart": [],
"onPickerStart": [],
"onWheelBonusStart": [],
"onJumanjiGameStart": []
```

Muzika se kontroliše isključivo kroz `BGMStreaming.ts`, ne kroz sounds.json command sistem.

---

## Korak 4: SFX koji OSTAJU u sprite sistemu (bez promena)

BigWinLoop (1.59s) je previše kratak za streaming — ostaje u sprite-u kao SFX.
Svi ostali zvuci (UI, reels, coins, effects) ostaju u sprite sistemu — to su kratki SFX i rade savršeno kroz Web Audio API.

Postojeće komande u sounds.json (`onBigWinStart`, `onReel1Land`, itd.) se NE menjaju.

---

## RAM ušteda

```
PRE (sve kroz Web Audio):
  SFX sprites (3 fajla):     ~30 MB
  BaseGameMusicLoop:          43 MB
  JumanjiMusicLoop:           25 MB
  JumanjiMusicLoopBoost:      23 MB
  JumanjiMusicLoopRoll:       22 MB
  FreeSpinMusic:              16 MB
  PickerMusicLoop:            11 MB
  WheelBonusMusicLoop:        11 MB
  ────────────────────────────────
  UKUPNO:                    ~181 MB  ← PUCA na mobilnom (limit ~128 MB)

POSLE (muzika kroz HTML5 Audio):
  SFX sprites (3 fajla):     ~30 MB
  Aktivna muzika (streaming):  ~3 MB  (samo 1 traka istovremeno)
  ────────────────────────────────
  UKUPNO:                     ~33 MB  ← 75% manje, daleko ispod limita
```

---

## Šta Howler.mute() / Howler.volume() radi

Globalni Howler kontroli **UTIČU** na HTML5 Audio instance:
- `Howler.mute(true)` → mute-uje i SFX i streaming muziku ✓
- `Howler.volume(0.5)` → smanjuje globalni volume za sve ✓
- `soundManager.toggleAllSounds()` → poziva `Howler.mute()` → radi ✓

Šta **NE** radi automatski:
- `soundManager.toggleTagSounds(true, "Music")` → NE utiče na streaming (nije u tag sistemu)
- `soundManager.pauseAllSounds()` → NE pauzira HTML5 (zato dodajemo `pauseBGM/resumeBGM`)

---

## Deploy checklist

- [ ] `BGMStreaming.ts` dodat u `src/ts/utils/`
- [ ] Svih 7 muzičkih M4A fajlova deploy-ovani u `assets/default/default/default/sounds/soundFiles/`:
  - `jumanji-next-level-game_BaseGameMusicLoop.m4a`
  - `jumanji-next-level-game_FreeSpinMusic.m4a`
  - `jumanji-next-level-game_JumanjiMusicLoop.m4a`
  - `jumanji-next-level-game_JumanjiMusicLoopBoost.m4a`
  - `jumanji-next-level-game_JumanjiMusicLoopRoll.m4a`
  - `jumanji-next-level-game_PickerMusicLoop.m4a`
  - `jumanji-next-level-game_WheelBonusMusicLoop.m4a`
- [ ] Muzički fajlovi **NISU** u `soundManifest` nizu u sounds.json
- [ ] `playBGM()` pozivi dodati na svim game state tranzicijama
- [ ] `duckBGM()` / `unduckBGM()` na big win
- [ ] `pauseBGM()` / `resumeBGM()` na visibility change
- [ ] Testirano na mobilnom Safari (proveri RAM u Safari Web Inspector)
