# Slot Audio Pool Architecture

## Pregled: Pravila za raspodelu zvukova po pool-ovima

Bazira se na industry standardu (IGT, Aristocrat, SG Gaming, Everi) — princip:
> **Učitaj samo ono što ti treba, tačno kad ti treba. Nikad ne troši bandwidth na zvukove koje igrač možda neće čuti.**

---

## Pool struktura i redosled učitavanja

```
T=0ms        BOOT učitava    → sinhrono, pre prvog rendera
T=0ms        BASE učitava    → paralelno sa boot, mora biti gotovo pre prvog spina
T+gotovo     BIGWIN učitava  → background, odmah posle BASE-a (unutar ~5 spinova)
T+30s        BONUS učitava   → background, deferred (statistički nemoguć prvih 30s)
```

---

## BOOT — kritični zvuci, priority 1

**Kada se učitava:** Odmah, pre prvog rendera.

**Pravilo:** Mora biti dostupan PRE nego što igrač ikad pritisne spin.

| Zvuk | Zašto ovde |
|---|---|
| `UiSpin`, `UiSpinSlam` | Svira na svakom pritisku dugmeta — mora biti spreman odmah |
| `ReelLand` | Svira na kraju svakog spina |
| `UiClick`, `UiOpen`, `UiClose`, `UiSelect`, `UiSkip` | UI feedback, svira na svakom kliku |
| `UiBetUp`, `UiBetDown`, `UiBetMax` | UI, svira pre prvog spina |
| `Payline`, `RollupLow` | Potrebni za mali win — čest, svira od prvog spina |
| `BaseGameStart` | Svira odmah kad se base game inicijalizuje |

---

## BASE (reel_win) — base game gameplay, priority 2

**Kada se učitava:** Paralelno sa BOOT, mora biti gotovo pre prvog spina.

**Pravilo:** Zvuci koji se čuju na svakom spinu — ne smeju se deferred-ovati.

| Zvukovi | Zašto ovde |
|---|---|
| `SymbolS01–S15` | Symbol win zvuci — svira na svakom dobitnom spinu |
| `SymbolW01`, `SymbolW01Transform` | Wild symbol eventi u base game-u |
| `SymbolF01` | Feature symbol win u base game-u |
| `SymbolB01` | Bonus scatter win zvuk u base game-u |
| `Rollup1`, `Rollup1End`, `Rollup2Start`, `Rollup2End` | Win counter animacija |
| `ScreenShake` | Visual efekt pri velikim win-ovima u base game-u |
| `SymbolPreshow1–5` | Pre-show zvuci pri laganom zaustavljanju rilova |
| `IntroStart` | Intro zvuk pri pokretanju/povratku u igru |

---

## BIGWIN — win momenti + scatter anticipation, priority 3

**Kada se učitava:** Deferred, odmah u pozadini posle BASE pool-a.
Mora biti gotov pre statistički verovatnog big win-a (~prvih 5–10 spinova).

**Pravilo:** Isključivo WIN momenti i scatter anticipation koji se dešavaju **u base game-u**.
NEMA tranzicija ka bonus game-u ovde.

| Zvukovi | Zašto ovde |
|---|---|
| `BigWinStart`, `BigWinEnd`, `BigWinTier` | Sami big win momenti — WIN sekvenca |
| `SymbolB01Land1–5` | Scatter landing zvuci — dešavaju se u BASE game-u |
| `SymbolB01Anticipation`, `SymbolB01AnticipationEnd` | Scatter anticipation u BASE game-u |
| `SymbolF01Anticipation`, `SymbolF01AnticipationEnd`, `AnticipationF01End` | Feature anticipation u BASE game-u |
| `PreBonusLoop` | Svira dok rilov 4 i 5 još vrti nakon 3 scatter-a — BASE game suspense |

**Napomena:** `PreBonusLoop` ostaje u BIGWIN jer svira u base game kontekstu (pre potvrde bonus-a).

---

## BONUS — bonus game sesija + tranzicije, priority 4

**Kada se učitava:** Deferred, u pozadini ~30s posle pocetka igre.
Može i ranije: pri prvom scatter padu (daje ~2–3s za load tokom animacije).

**Pravilo:** Sve što svira TOKOM bonus game-a + oba prelaza (ulaz I izlaz iz bonus-a).
Tranzicije idu OVDE, ne u bigwin — bigwin je samo za WIN.

| Zvukovi | Zašto ovde |
|---|---|
| `BaseToBonusStart` | Tranzicija BASE → BONUS — svira pri ulasku u bonus sesiju |
| `BonusToBaseStart` | Tranzicija BONUS → BASE — svira pri izlasku, kraj bonus sesije |
| `BonusSpinStart/End` | Spin zvuci u bonus game-u |
| `BonusGameSpinStart/End` | Bonus game spin varijanta |
| `BonusRetrigger` | Re-trigger bonus-a unutar bonus-a |
| `BonusRollupStart/End`, `BonusRollup2Start/End` | Win counter u bonus game-u |
| `BonusSymbolS01–S15`, `BonusSymbolW01`, `BonusSymbolWin` | Symbol win zvuci u bonus game-u |
| `PickerMusicLoop`, `PickerSelect`, `PickerStart` | Picker mini-igra unutar bonus-a |
| `BonusMusicLoopEnd` | Završetak bonus muzike |

---

## STANDALONE — muzičke petlje (posebni fajlovi)

Muzički fajlovi su predugi za sprite — exportuju se kao individualni M4A fajlovi.

| Zvuk | Napomena |
|---|---|
| `BaseMusicLoop` | Base game pozadinska muzika — streamed, ne sprite |
| `BonusMusicLoop` | Bonus game pozadinska muzika — streamed, ne sprite |

---

## Sumarni flow po game stanjima

```
GAME INIT
  └─► BOOT + BASE učitavaju se odmah
  └─► BaseGameStart zvira
  └─► BaseMusicLoop počinje (standalone)
  └─► BIGWIN pool počinje da se učitava u pozadini

BASE GAME (svaki spin)
  └─► UiSpin → reel spin
  └─► ReelLand × 5 (sa pan-om po rilovima)
  └─► SymbolS01–S15 (win zvuci)
  └─► Rollup1 / Rollup2 (win counter)

SCATTER ANTICIPATION (2+ scatter-a)
  └─► SymbolB01Anticipation (loop) — BIGWIN pool
  └─► SymbolB01Land1, Land2, Land3 — BIGWIN pool
  └─► PreBonusLoop (loop) — BIGWIN pool (čeka na 4. i 5. rilu)

BONUS TRIGGER (5 scatter-a)
  └─► BaseToBonusStart — BONUS pool (tranzicija)
  └─► BonusMusicLoop počinje — standalone
  └─► BonusGameSpinStart/End — BONUS pool
  └─► BonusSymbolS01–S15 — BONUS pool

BONUS END
  └─► BonusMusicLoopEnd — BONUS pool
  └─► BonusToBaseStart — BONUS pool (tranzicija nazad)
  └─► BaseMusicLoop se nastavlja

BIG WIN (u bilo kojoj fazi)
  └─► BigWinStart (loop) — BIGWIN pool
  └─► BigWinTier (po tier-u) — BIGWIN pool
  └─► BigWinEnd — BIGWIN pool
```

---

## SubLoader sistem (playa-core deferred loading)

Pool-ovi sa `subLoaderId` u `sprite-config.json` se NE učitavaju u main load.
playa-core ih stavlja u SubLoader red i čeka da game developer okine učitavanje.

### SubLoader ID mapiranje

| Pool | `subLoaderId` | Kada game developer okida |
|---|---|---|
| `boot` | *(nema)* | Main load — automatski |
| `reel_win` | *(nema)* | Main load — automatski |
| `bigwin` | `"A"` | `slotProps.startSubLoader("A")` na prvom spinu |
| `bonus` | `"B"` | `slotProps.startSubLoader("B")` na prvom scatter padu |

### Unload/Reload lifecycle

Pool-ovi sa `unloadable: true` treba da se oslobode iz RAM-a posle upotrebe.
`bonus` pool (~1.6MB) se može unloadovati posle završetka bonus game-a, i ponovo učitati pri sledećem bonus triggeru.

**`bigwin` — `unloadable: false`:** Big win se može triggerovati više puta po sesiji.
Unload + reload između spinova bi stvarao rizik od missing audio.

**`bonus` — `unloadable: true`:** Bonus game je kompletna sekvenca sa jasnim krajem (`onBonusGameEnd`).
Posle završetka, RAM se može osloboditi. Ako igrač triggere bonus ponovo, SubLoader "B" se ponovo pokreće.

### Implementacija u game kodu (zahteva playa-core izmenu)

```typescript
// SoundPlayer.ts — predlog za playa-core tim
public unloadHowl(soundId: string): void {
    const srcRef = this._soundUrl[soundId];
    const howl = this._howlInstances[srcRef];
    if (!howl) return;
    howl.unload();                           // Howler oslobađa Web Audio buffer
    delete this._howlInstances[srcRef];      // čisti Howl referencu
    for (const [id, sprite] of this._soundSprites) {
        if ((sprite as any)._soundId === soundId) this._soundSprites.delete(id);
    }
}

// Game kod — bonus lifecycle
onBonusGameEnd() {
    // Oslobodi ~1.6MB RAM-a
    loaderService.soundLoader.unloadSubLoader("B");
}
onScatterLand_5() {
    // Ponovo učitaj ako je bonus opet triggereovan
    slotProps.startSubLoader("B");
}
```

### soundManifest output (generisan od buildTieredJSON.js)

```json
{"id": "game_boot",     "src": ["soundFiles/game_boot.m4a"]},
{"id": "game_reel_win", "src": ["soundFiles/game_reel_win.m4a"]},
{"id": "game_bigwin",   "src": ["soundFiles/game_bigwin.m4a"],  "loadType": "A"},
{"id": "game_bonus",    "src": ["soundFiles/game_bonus.m4a"],   "loadType": "B", "unloadable": true}
```

---

## Ključna pravila za nove zvukove

| Naziv zvuka | Pool |
|---|---|
| `Ui*` | boot |
| `ReelLand`, `Payline`, `RollupLow`, `BaseGameStart` | boot |
| `Symbol[S/W/F/B][0-9]+` (plain win) | base |
| `Rollup[1-9]*`, `ScreenShake`, `*Preshow*`, `IntroStart` | base |
| `BigWin*`, `*Anticipation*`, `*Land[1-5]`, `PreBonus*` | bigwin |
| `BaseToBonusStart`, `BonusToBaseStart` | bonus |
| `Bonus*`, `Picker*` | bonus |
| `*MusicLoop` | standalone |
