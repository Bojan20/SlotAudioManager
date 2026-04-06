# playa-core IGT Sound System — Kompletna dokumentacija

> Izvorni kod: `/c/IGT/playa-core/src/ts/sound/`
> Poslednje ažurirano: 2026-04-02

---

## Sadržaj

1. [Pregled arhitekture](#1-pregled-arhitekture)
2. [Fajlovi i struktura](#2-fajlovi-i-struktura)
3. [SoundService — Ulazna tačka](#3-soundservice--ulazna-tačka)
4. [SoundLoader — Učitavanje zvuka](#4-soundloader--učitavanje-zvuka)
5. [SubLoader — Odloženo učitavanje](#5-subloader--odloženo-učitavanje)
6. [SoundManager — Singleton fasada](#6-soundmanager--singleton-fasada)
7. [SoundPlayer — Reprodukcija i komande](#7-soundplayer--reprodukcija-i-komande)
8. [SoundSprite — Pojedinačni zvuk](#8-soundsprite--pojedinačni-zvuk)
9. [SoundSpriteList — Lista zvukova](#9-soundspritelist--lista-zvukova)
10. [Interfejsi i tipovi](#10-interfejsi-i-tipovi)
11. [sounds.json — Manifest šema](#11-soundsjson--manifest-šema)
12. [Tok učitavanja (Loading Flow)](#12-tok-učitavanja-loading-flow)
13. [Tok izvršavanja komandi (Command Execution Flow)](#13-tok-izvršavanja-komandi-command-execution-flow)
14. [State mašina sprite-ova](#14-state-mašina-sprite-ova)
15. [Browser kompatibilnost](#15-browser-kompatibilnost)
16. [Konstante i konfiguracija](#16-konstante-i-konfiguracija)
17. [Error handling i logovanje](#17-error-handling-i-logovanje)
18. [SoundTool — Debug alat](#18-soundtool--debug-alat)
19. [ResourceManager integracija](#19-resourcemanager-integracija)
20. [Custom Sounds](#20-custom-sounds)
21. [Integracija sa igrom — SubLoader pozivi](#21-integracija-sa-igrom--subloader-pozivi)

---

## 1. Pregled arhitekture

playa-core sound sistem je izgrađen na **Howler.js** biblioteci i koristi višeslojnu arhitekturu:

```
┌──────────────────────────────────────────────────────────┐
│                     Game Code                            │
│         soundManager.execute("commandId")                │
│         startSubLoader("A") / unloadSubLoader("B")       │
└───────────────────────┬──────────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────────┐
│              SoundManager (Singleton)                     │
│  Fasada — delegira SVE pozive na trenutni SoundPlayer    │
└───────────────────────┬──────────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────────┐
│                   SoundPlayer                            │
│  Parsira sounds.json → kreira SoundSprite/SpriteList     │
│  Izvršava komande sa gsap delay/tween sistemom           │
└──────┬────────────────┬──────────────────┬───────────────┘
       │                │                  │
┌──────▼──────┐  ┌──────▼──────┐  ┌───────▼──────┐
│ SoundSprite │  │SoundSprite  │  │  Commands     │
│ (pojedinačni│  │List (lista  │  │  (nizovi      │
│  zvuk)      │  │ sa random/  │  │   komandi)    │
│             │  │ sequential) │  │               │
└──────┬──────┘  └──────┬──────┘  └───────────────┘
       │                │
┌──────▼────────────────▼──────────────────────────────────┐
│                    Howler.js                              │
│           Howl instance per audio fajl                    │
│           Sprite definicije [startTime, duration]         │
└──────────────────────────────────────────────────────────┘
```

**Tok podataka:**
1. `SoundService` učitava `sounds.json` i registruje `SoundLoader`
2. `SoundLoader` preuzima M4A fajlove, kreira `Howl` instance
3. `SoundPlayer` parsira manifest i kreira `SoundSprite` / `SoundSpriteList` objekte
4. Igra poziva `soundManager.execute("commandId")` — player izvršava komandu

---

## 2. Fajlovi i struktura

```
/c/IGT/playa-core/src/ts/sound/
├── index.ts                    — Eksporti (ISoundPlayer, SoundPlayer, SoundService, SoundTypes, SoundFormat)
├── ISoundPlayer.ts             — Interfejs za player
├── ISoundSprite.ts             — Interfejs za sprite
├── SoundData.ts                — Mobx data container
├── SoundFormat.ts              — Enum: OGG, MP3, AAC, M4A
├── SoundLoader.ts              — Učitavanje audio fajlova (fetch + Howl)
├── SoundManager.ts             — Singleton fasada
├── SoundPlayer.ts              — Parsiranje manifesta + izvršavanje komandi
├── SoundProps.ts               — Properties wrapper
├── SoundService.ts             — BaseService — entry point za sound sistem
├── SoundSprite.ts              — Pojedinačni sprite sa Howler kontrolom
├── SoundSpriteList.ts          — Lista sprite-ova (random/sequential)
├── SoundTypes.ts               — Enum: HOWLER = 0
└── actions/
    └── SoundServiceActions.ts  — Mobx akcije za SoundData

Povezani fajlovi van sound/ direktorijuma:
├── /loader/SubLoader.ts        — Odloženo učitavanje po loadType
├── /loader/ResourceManager.ts  — Koordinacija svih loadera
├── /loader/LoaderService.ts    — Kreiranje SubLoader-a po ID-u
└── /utils/sound/SoundTool.ts   — Debug alat (Ctrl+Alt+S)
```

---

## 3. SoundService — Ulazna tačka

**Fajl:** `SoundService.ts`
**Klasa:** `SoundService extends BaseService<SystemProps, null, SoundProps>`

### Statička polja
| Polje | Tip | Vrednost |
|-------|-----|----------|
| `soundsConfigName` | `string` | `"sounds.json"` |

### Privatna polja
| Polje | Tip | Opis |
|-------|-----|------|
| `_actions` | `SoundServiceActions` | Mobx akcije |
| `_soundType` | `SoundTypes` | Tip biblioteke (HOWLER) |
| `_soundLoader` | `BaseResourceLoader` | Instanca SoundLoader-a |
| `_isSoundEnable` | `boolean` | Da li je zvuk omogućen |
| `_soundFormat` | `SoundFormat` | Aktivni audio format |

### Konstruktor

```typescript
constructor(
    type: SoundTypes = SoundTypes.HOWLER,
    assetIds: string[] | undefined = undefined,
    hiddenTags: string[] | undefined = undefined,
    soundFormat: SoundFormat = SoundFormat.AAC
)
```

**Šta radi:**
1. Kreira `SoundData` i `SoundProps` instance
2. Instancira `SoundLoader` za HOWLER tip
3. Učitava `sounds.json` (sa varijantama imena i verzija)
4. Dodaje loader u `loaderService`
5. Inicijalizuje event listenere:
   - `window "load"` → pretplata na `consoleChannel`
   - `document "visibilitychange"` → pauza/nastavak zvuka
   - `gameChannel` pretplata → `GAME_CONTROL` eventi

### Metode

#### `protected async init(): Promise<void>`
- Postavlja `soundManager.player` na player indeks 0
- Poziva `player.init()` sa assets-ima ako postoje

#### `private onChangeEvent(data: any): void`
- Obrađuje `GAME_CONTROL` evente sa `SOUND_NAME`
- Parsira parametre za `_isSoundEnable`

#### `private onConsoleChange(data: any): void`
- Obrađuje konzolne promene zvuka
- Parsira JSON vrednost za `SOUND_NAME`

#### `private handleVisibilityChange(evt?: any): void`
- **Tab sakriven** → `pauseAllSounds(true)` — pauzira sve zvukove
- **Tab vidljiv** → nastavlja na osnovu `_isSoundEnable` flaga i korisničke preference

#### `public create(index: number): ISoundPlayer`
- Kreira novi `SoundPlayer` na datom indeksu
- **Baca grešku** ako player već postoji na tom indeksu

#### `public get(index: number): ISoundPlayer`
- Vraća player na indeksu ili ga kreira ako ne postoji

---

## 4. SoundLoader — Učitavanje zvuka

**Fajl:** `SoundLoader.ts`
**Klasa:** `SoundLoader extends BaseResourceLoader`

### Statička polja
| Polje | Tip | Vrednost |
|-------|-----|----------|
| `FILE_TYPES` | `string[]` | `["wav", "mp3", "m4a", "ogg", "aac"]` |

### Privatna polja
| Polje | Tip | Default | Opis |
|-------|-----|---------|------|
| `service` | `SoundService` | — | Referenca na servis |
| `_spriteMap` | `{}` | `{}` | Mapa sprite definicija `[startTime, duration]` |
| `_howlInstances` | `{}` | `{}` | Howl instance po source referenci |
| `_audioLoader` | `{}` | `{}` | Audio loader objekat |
| `_soundFiles` | `string[]` | `[]` | Niz zvučnih fajlova za učitavanje |
| `_subLoaderSounds` | `object` | `{}` | Zvukovi grupisani po subLoaderID |
| `_manifestData` | `any` | — | Kompletni manifest podaci |
| `_soundFormat` | `SoundFormat` | `AAC` | Aktivni format |
| `_resourceManagerRef` | `ResourceManager \| undefined` | — | Referenca na resource manager |
| `_ixfProxy` | `IXFChannelManager` | — | IXF proxy za progres |
| `_concurrency` | `number` | `5` | Max paralelnih učitavanja |
| `_mainLoadStartCount` | `number` | `0` | Brojač započetih učitavanja |
| `_mainLoadCompleteCount` | `number` | `0` | Brojač završenih učitavanja |

### Konstruktor

```typescript
constructor(
    parentProps: LoaderProps,
    parentActions: ResourceLoaderActions,
    service: SoundService,
    soundFormat: SoundFormat = SoundFormat.AAC
)
```

### Metode

#### `public setConcurrency(value: number): void`
Postavlja limit paralelnih učitavanja. Poziva se iz `ResourceManager.addLoader()`.

#### `public getTotal(): number`
Računa ukupan broj main-load fajlova iz manifesta.

**Logika:**
- Iterira kroz `soundManifest`
- Filtrira po `loadType` (`"-"` ili `undefined` = main load)
- Validira da putanje fajlova odgovaraju (bez ekstenzije)
- Detektuje duplikate sa konzolnim upozorenjima

#### `protected async process(resource, id): Promise<string>`
Procesira sound manifest i organizuje po `loadType`.

**Logika:**
1. Učitava `soundManifest` niz
2. Detektuje browser/OS (Firefox detekcija za AAC vs OGG)
3. Za svaki manifest item:
   - Ako je `loadType` `"-"` ili `undefined` → dodaj u `_soundFiles`
   - Ako `loadType` postoji → proveri/kreiraj subLoader, dodaj u `_subLoaderSounds`
4. Loguje duplikate na konzolu

#### `public startLoad(resourceManagerRef: ResourceManager): void`
Započinje učitavanje zvučnih fajlova (poziva se kad su prime-ovi spremni).

**Logika:**
1. Čuva referencu na resource manager
2. Kreira sprite mapu iz `soundDefinitions.soundSprites`
3. Resetuje brojače učitavanja
4. Pokreće paralelno učitavanje do `_concurrency` limita
5. Poziva `loadSoundFile()` za svaki paralelni slot

#### `private createSpriteMap(soundDef: any): any`
Kreira mapu sprite definicija — `spriteId → [startTime, duration]`.

#### `private async loadSoundFile(): Promise<void>`
Učitava pojedinačni zvučni fajl.

**Logika:**
1. Inkrementira `_mainLoadStartCount`
2. Poziva `_downloadAudio()` za fetch i konverziju u Howl
3. Registruje `"loaderror"` event listener (preskače `"Decoding audio data failed"` greške)

#### `private onSoundLoad(): void`
Obrađuje završetak učitavanja jednog zvuka.

**Logika:**
- Inkrementira brojač završenih fajlova
- Ako su svi main zvukovi učitani → `onMainSoundLoadCompletion()`
- Inače → učitava sledeći zvučni fajl

#### `private _downloadAudio(url: string): Promise<any>`
Preuzima audio fajl i konvertuje u Howl instancu.

**Logika:**
1. Koristi `fetch` sa streaming praćenjem progresa
2. Prati brzinu preuzimanja (bps → Mbps konverzija)
3. Objavljuje `"LoadProgress"` event kad je brzina ≥ 4.1 Mbps
4. Konvertuje response blob u Data URL preko `FileReader`
5. Kreira `Howl` instancu sa:
   - `src: soundDataURL`
   - `format: FILE_TYPES`
   - `preload: true`
   - `autoplay: true`
   - `sprite: _spriteMap`

#### `private blobToDataURL(blob: Blob): Promise<string>`
Konvertuje blob u data URL za Howl izvor. Koristi `FileReader` sa `onload/onerror/onabort` handlerima.

#### `private networkSpeed(dur, downloadSize): number`
Računa brzinu preuzimanja: bytes/ms → Mbps (fiksno 2 decimale).

#### `private sendLoadProgress(): void`
Objavljuje progres učitavanja preko IXF proxy-ja:
```
_ixfProxy.kernel.publish("LoadProgress", { id: "game" })
```

#### `private createHowlInstance(srcRef): Howl`
Kreira Howl instancu za subLoader audio (ista konfiguracija kao `_downloadAudio`).

#### `private onMainSoundLoadCompletion(): void`
Obrađuje završetak učitavanja svih main zvukova.

**Logika:**
- Ako je servis inicijalizovan → poziva `setPlayerData()`
- Inače → koristi `MobxUtils.getInstance().addWhen()` da sačeka `service.initialized`

#### `private setPlayerData(): void`
Postavlja podatke playera nakon učitavanja zvukova.

**Pozivi:**
1. `player.setRawUrls(_parent.props.manifest.sounds)`
2. `player.setSoundFormat(_soundFormat)`
3. `player.setHowls(_howlInstances)`
4. `player.setSounds(_manifestData)` — ovo kreira sve sprite-ove i komande

#### `public getSubLoaderSoundList(subLoaderID: string): any[]`
Vraća zvukove povezane sa specifičnim subLoaderom.
- Return: niz `{srcRef: string, id: string}` ili prazan niz

#### `public loadSubLoaderAudio(srcRef: string, id: string, loadedFunc: any): void`
Učitava audio za deferred/lazy subLoader.

**Logika:**
1. Kreira Howl instancu
2. Na `"load"` event:
   - Poziva `player.addHowls(howlInstance, srcRef, id)`
   - Izvršava `loadedFunc` callback

#### `public getLoadData(data, id): object`
Računa doprinos broja fajlova za sound asset.
- Postavlja `data.increments` na `[1]` ako koristi ovaj loader, `[0]` inače

---

## 5. SubLoader — Odloženo učitavanje

**Fajl:** `/c/IGT/playa-core/src/ts/loader/SubLoader.ts`
**Klasa:** `SubLoader`

### Ključna polja
| Polje | Tip | Opis |
|-------|-----|------|
| `_subLoaderID` | `string` | `"A"`-`"F"` (deferred) ili `"Z"` (lazy) |
| `_soundLoader` | `SoundLoader` | Referenca na SoundLoader |
| `_soundList` | `any[]` | Niz `{srcRef, id}` za zvukove |

### Metode

#### `private getSoundLoader(): any`
Izvlači `SoundLoader` referencu iz loadera. Pretražuje loader čije je ime `"SoundLoader"`. Loguje upozorenje ako nije pronađen.

#### `public startSubLoader(): void`
Započinje učitavanje za ovaj subLoader.

**Logika:**
1. Poziva `_soundLoader.getSubLoaderSoundList(subLoaderID)`
2. Dodaje svaki zvuk u stavke za učitavanje
3. Pokreće paralelno učitavanje

#### `private loadItem(srcRef: string, idx: number): void`
Učitava pojedinačnu stavku.

**Logika:**
1. Proverava sufikse fajla prema `SoundLoader.FILE_TYPES`
2. Ako je zvučni fajl → `_soundLoader.loadSubLoaderAudio(srcRef, id, callback)`
3. Na završetak → `itemLoaded()`

### SubLoader ID vrednosti

| ID | Tip | Opis |
|----|-----|------|
| `"-"` ili `undefined` | Main load | Učitava se pre pokretanja igre |
| `"A"` | Deferred | Main pool — symbols, bigwin, anticipation |
| `"B"` | Deferred | Bonus pool — free spins, hold & win, picker |
| `"C"` - `"F"` | Deferred | Dodatni poolovi po potrebi |
| `"Z"` | Lazy | Učitava se on-demand |

### SubLoader queue ponašanje
- Samo jedan SubLoader se učitava istovremeno — **FIFO redosled**
- Ako se A i B triggeruju simultano (scatter na prvom spinu), B čeka u redu dok A ne završi

---

## 6. SoundManager — Singleton fasada

**Fajl:** `SoundManager.ts`
**Klasa:** `SoundManager`

### Privatna polja
| Polje | Tip | Opis |
|-------|-----|------|
| `_soundManagerInstance` | `SoundManager` (static) | Singleton instanca |
| `_logger` | `Logger \| undefined` | Logger |
| `_player` | `ISoundPlayer \| undefined` | Trenutni player |
| `_hiddenTags` | `string[] \| undefined` | Tagovi za skrivanje |
| `_tags` | `string[] \| undefined` | Keširani tagovi |
| `_customSounds` | `Array<any>` | Custom zvukovi |

### Metode

| Metoda | Potpis | Opis |
|--------|--------|------|
| `getInstance` | `static getInstance(): SoundManager` | Vraća singleton |
| `toggleAllSounds` | `(isEnable: boolean): void` | Mute/unmute sve zvukove |
| `pauseAllSounds` | `(isEnable: boolean): void` | Pauza/nastavak svih zvukova |
| `toggleTagSounds` | `(isEnable: boolean, ...tags: string[]): void` | Toggle po tagu |
| `execute` | `(commandId: string): void` | Izvrši komandu |
| `executeBlock` | `(commandId: string, index: number): void` | Izvrši blok komande |
| `setNextBlock` | `(commandId: string, index: number): void` | Postavi sledeći blok |
| `getCurrentBlock` | `(commandId: string): number` | Vrati trenutni blok (ili `0xffffffff`) |
| `addCustomSound` | `(cs: any): void` | Dodaj custom zvuk |

### Getteri/Setteri
- `logEnable` — Get/set logovanje (kreira Logger instancu)
- `player` — Get/set player (takođe postavlja logger i custom zvukove)
- `hiddenTags` — Get/set skrivene tagove
- `tags` — Get sve ne-skrivene tagove iz playera

---

## 7. SoundPlayer — Reprodukcija i komande

**Fajl:** `SoundPlayer.ts`
**Klasa:** `SoundPlayer implements ISoundPlayer`

### Privatna polja
| Polje | Tip | Default | Opis |
|-------|-----|---------|------|
| `_soundManifest` | `{id, src}[]` | `[]` | Sound manifest niz |
| `_soundSprites` | `Map<string, ISoundSprite>` | — | Sprite ID → instanca |
| `_tempFadingSprites` | `Map<string, {...}>` | — | Privremeni fade podaci za pauzu |
| `_commands` | `Map<string, any[]>` | — | Command ID → niz komandi |
| `_timers` | `Map<string, gsap.core.Tween[]>` | — | Sprite ID → timeri |
| `_tags` | `Map<string, {volume, muted, sprites}>` | — | Tag upravljanje |
| `_soundUrl` | `any` | — | Raw URL-ovi iz manifesta |
| `_soundManifestData` | `any` | — | Kompletni manifest podaci |
| `_howlInstances` | `{}` | — | Howl instance po URL-u |
| `_soundFormat` | `SoundFormat` | `AAC` | Trenutni format |
| `_logger` | `ILogger \| undefined` | — | Logger |
| `_customSounds` | `Map<string, Howl>` | — | Custom zvukovi |
| `FILE_TYPES` | `string[]` | `["m4a"]` | Tipovi za custom zvukove |

### Getteri/Setteri
- `soundManifest` — manifest niz
- `soundSprites` — sprite mapa
- `logger` — set logger
- `howlInstances` — howl instance
- `commands` — commands mapa

### Metode

#### `public setRawUrls(soundURL: any): void`
Čuva raw URL-ove zvučnih fajlova iz manifesta.

#### `public setSounds(sounds: any): void`
**Ključna metoda** — procesira manifest i kreira sve sprite/command strukture.

**Logika:**
1. Postavlja `Howler.autoUnlock = true`
2. Procesira `soundDefinitions.soundSprites`:
   - Kreira `SoundSprite` za svaki
   - Dodaje u `_soundSprites` mapu
   - Asocira sa tagovima
3. Procesira `soundDefinitions.spriteList`:
   - Kreira `SoundSpriteList` za svaki
   - Podržava `random` / `sequential` tipove
   - Podržava `pan` / `loop` nizove
4. Procesira `soundDefinitions.commands`:
   - Čuva u `_commands` mapu

#### `public setHowls(howls: {}): void`
Čuva howl instance.

#### `public addHowls(howl: any, srcRef: string, soundId: string): void`
Dodaje howl i kreira sprite-ove za sve odgovarajuće sound ID-jeve.
- Pronalazi sve sprite-ove koji odgovaraju `soundId`
- Poziva `addHowl` za svaki

#### `public addHowl(howl: any, srcRef: string, spriteId: string): void`
Dodaje pojedinačnu howl instancu i kreira sprite.
- Kreira `SoundSprite` sa howl-om
- Dodaje u `_soundSprites`
- Asocira sa tagovima

#### `public getTags(hidden: string[]): string[]`
Vraća sve tagove, opciono filtrira skrivene.

#### `public setSoundFormat(soundFormat: SoundFormat): void`
Postavlja audio format.

#### `public toggleAllSounds(isEnable: boolean): void`
Mute/unmute sve zvukove: `Howler.mute(isEnable)`.

#### `public pauseAllSounds(isEnable: boolean): void`
Pauza/nastavak svih howl instanci.

**Kompleksna logika:**
- Čuva fade stanja tokom pauze
- Pristupa internom Howler `_sounds` nizu
- Individualna pauza/play po sound ID-u
- Restore fade-a na nastavku

#### `public toggleTagSounds(isEnable: boolean, ...tags: string[]): void`
Mute/unmute sprite-ove po tagu.

**Logika:**
1. Postavlja `tag.muted = isEnable`
2. Iterira sprite-ove u svakom tagu
3. Detektuje audiosprite
4. Poziva `sprite.mute()` ili `Howler.mute(isEnable, soundId)`
5. Poziva `toggleCustomSounds()`

#### `public getSoundSprite(spriteId: string): ISoundSprite | undefined | null`
Vraća sprite po ID-u ili `null` ako nije pronađen.

#### `public execute(commandId: string): void`
**Glavna metoda za igru** — izvršava sound komandu.

**Logika:**
1. `clearTimersAndTweens(commandId)` — čisti prethodne timere
2. Dohvata komande iz `_commands` mape
3. Za svaku komandu: kreira `gsap.delayedCall()` ili odmah izvršava
4. `addTimer()` za praćenje
5. Proverava `document.visibilityState` pre izvršavanja

#### `private getSpriteIds(cmd: any, count: number = 0): string[]`
Rekurzivno izvlači sprite ID-jeve iz komande.
- **Max rekurzija:** 10 nivoa
- Podržava: `spriteId`, `spriteListId`, `tag`, `commandId` (rekurzivno)
- Vraća jedinstven niz

#### `private addTimer(cmd: any, timer: gsap.core.Tween): void`
Čuva timer za svaki sprite u komandi.

#### `private clearTimersAndTweens(commandId: string): void`
Ubija sve tween/timer animacije za komandu. Dohvata sve sprite ID-jeve i ubija gsap tween-ove.

#### `private onDelayTimer = (cmd: any, cmdId: string) => {...}`
**Centralni handler** — izvršava komandu nakon delay-a.

**Switch po `cmd.command`:**

| Command | Logika |
|---------|--------|
| `"execute"` | Rekurzivno poziva `execute(cmd.commandId)` |
| `"play"` | Postavlja volume/pan/loop/position/rate/sync, ako `cancelDelay=true` i svira → stop(), proverava custom sounds, poziva `sprite.play(cmd)` |
| `"set"` | Postavlja volume/pan/loop/position/rate property-je |
| `"pause"` | `sprite.pause()` |
| `"resume"` | `sprite.resume()` |
| `"stop"` | `sprite.stop()` |
| `"fade"` | Izvlači volume/rate/pan/duration, čuva temp fade info za pause resume, `sprite.fade(fadeProps)` |
| `"resetspritelist"` | Ako je `SoundSpriteList` → `resetIndex()` |

**Za tag komande:** `"set"` sa volume → menja volume taga

**Provera:** `document.visibilityState` pre izvršavanja

#### `private checkCustomSound(spriteID: string, commandID: string): boolean`
Proverava da li custom zvuk postoji i izvršava komandu na njemu.
- Podržava: `play`, `pause`, `resume`, `stop`
- Vraća `true` ako je custom zvuk pronađen

#### `public getTagVolume(tags: string[]): number`
Računa kombinovani volume za više tagova — **multiplikativno** (množenje svih tag volumena).
- Default return: `1`

#### `public getTagMute(tags: string[]): boolean`
Proverava da li je bilo koji tag mute-ovan.
- Vraća `true` ako je bilo koji `tag.muted === true`

#### `public setCustomSounds(cs: Array<any>): void`
Kreira Howl instance za custom zvukove.
- Iterira niz `{name: string, path: string}`
- Kreira Howl sa `FILE_TYPES`
- Čuva u `_customSounds` mapi

#### `private toggleCustomSounds(isEnable: boolean): void`
Mute/unmute sve custom zvukove: `howl.mute(isEnable)`.

---

## 8. SoundSprite — Pojedinačni zvuk

**Fajl:** `SoundSprite.ts`
**Klasa:** `SoundSprite implements ISoundSprite`

### Privatna polja
| Polje | Tip | Default | Opis |
|-------|-----|---------|------|
| `_spriteId` | `string` | — | Sprite identifikator |
| `_soundId` | `string` | — | Povezani sound ID |
| `_howl` | `Howl` | — | Howler.js instanca |
| `_startTime` | `number` | — | Početno vreme sprite-a u ms |
| `_duration` | `number` | — | Trajanje sprite-a u ms |
| `_overlap` | `boolean` | `false` | Dozvoli preklapanje reprodukcija |
| `_tags` | `string[] \| undefined` | — | Povezani tagovi |
| `_loop` | `number` | `0` | Loop broj (0=bez, -1=beskonačno, >0=broj) |
| `_position` | `number` | `0` | Trenutna pozicija |
| `_volume` | `number` | `1` | Jačina (0-1) |
| `_rate` | `number` | `1` | Brzina reprodukcije |
| `_pan` | `number` | `0` | Pan vrednost (-1 do 1) |
| `_volumeFunc` | `(tags) => number` | — | Funkcija za tag volume |
| `_muteFunc` | `(tags) => boolean` | — | Funkcija za tag mute |
| `_isPlaying` | `boolean` | `false` | Status reprodukcije |
| `_isPaused` | `boolean` | `false` | Status pauze |
| `_isMuted` | `boolean` | `false` | Status mute-a |
| `_howlerIds` | `Map<number, {loopCount}>` | — | Howler ID → loop count |
| `_logger` | `ILogger \| undefined` | — | Logger |

### Play matrica pravila

```
isPlaying │ isPaused │ overlap │ Rezultat
──────────┼──────────┼─────────┼──────────────────────────
FALSE     │ TRUE     │ FALSE   │ play/resume()
FALSE     │ FALSE    │ FALSE   │ play nova instanca
FALSE     │ FALSE    │ TRUE    │ play nova instanca
TRUE      │ FALSE    │ TRUE    │ play nova instanca (overlap)
TRUE      │ TRUE     │ TRUE    │ play nova instanca (overlap)
FALSE     │ TRUE     │ TRUE    │ play/resume SVE instance
TRUE      │ FALSE    │ FALSE   │ NIŠTA (već svira)
TRUE      │ TRUE     │ FALSE   │ NIŠTA (već svira)
```

### Metode

#### `public play(cmd?: any): void`
Reprodukuje sprite na osnovu overlap i pause stanja.

**Logika:**
- Ako ne svira i pauziran sa overlap → resume sve instance
- Ako ne svira i pauziran bez overlap → resume jednu instancu
- Ako overlap ili ne svira → kreiranje nove Howl play instance
- Postavlja `_isPlaying = true`, `_isPaused = false`
- Registruje `"end"` event handler

#### `private onSpritePlayEnd = (howlId: number): void`
Obrađuje završetak reprodukcije sprite-a.

**Logika:**
- Upravlja odbrojavanjem loop-a
- Na loop complete: isključuje `"end"` event i poziva `stop()`
- Beskonačan loop (`-1`): ponovo reprodukuje

#### `public stop(howlerId?: number): void`
Zaustavlja reprodukciju.
- Ako `howlerId` nije definisan → zaustavlja sve instance sa ovim sprite ID-jem
- Postavlja `_isPlaying = false`, `_isPaused = false`

#### `public pause(): void`
Pauzira reprodukciju: `_isPlaying = false`, `_isPaused = true`.

#### `public resume(): void`
Nastavlja iz pauze: ako ne svira i pauziran → poziva `play()`.

#### `public mute(): void`
Mute-uje sprite. Detektuje audiosprite. Poziva `Howler.mute()` sa tag mute funkcijom.

#### `public fade(fadeProps: any): void`
Fade volume/rate/pan.
- Izvlači volume i duration iz `fadeProps`
- Pronalazi sound instancu
- Poziva `Howler.fade()`

#### `public seek(position: number): void`
Postavlja poziciju reprodukcije (stub): `_position = position`.

### Getteri/Setteri
| Property | Get | Set | Opis |
|----------|-----|-----|------|
| `spriteId` | Da | — | Sprite ID |
| `position` | Da | Da | Pozicija reprodukcije |
| `rate` | Da | Da | Brzina reprodukcije |
| `volume` | Da | Da | Jačina |
| `pan` | Da | Da | Pan sa `stereo()` |
| `loop` | Da | Da | Loop count |
| `overlap` | Da | — | Overlap flag |
| `isPlaying` | Da | — | Status reprodukcije |
| `duration` | Da | — | Trajanje |

---

## 9. SoundSpriteList — Lista zvukova

**Fajl:** `SoundSpriteList.ts`
**Klasa:** `SoundSpriteList implements ISoundSprite`

### Privatna polja
| Polje | Tip | Default | Opis |
|-------|-----|---------|------|
| `_howls` | `Map<string, Howl>` | — | Sound ID → Howl instance |
| `_spriteId` | `string` | — | Identifikator liste |
| `_position` | `number` | `0` | Trenutna pozicija |
| `_volume` | `number` | `0` | Jačina |
| `_pan` | `number \| number[]` | `[]` | Pan konfiguracija (single ili niz) |
| `_loop` | `number \| number[]` | `[]` | Loop konfiguracija (single ili niz) |
| `_overlap` | `boolean` | `false` | Overlap flag |
| `_isPlaying` | `boolean` | `false` | Status reprodukcije |
| `_isPaused` | `boolean` | `false` | Status pauze |
| `_type` | `string` | — | `"random"` ili sequential |
| `_tags` | `string[] \| undefined` | — | Tagovi |
| `_soundSpriteDefs` | `any[]` | — | Niz sprite definicija |
| `_currentIndex` | `number` | `0` | Trenutni indeks |
| `_volumeFunc` | `(tags) => number` | — | Tag volume funkcija |
| `_muteFunc` | `(tags) => boolean` | — | Tag mute funkcija |
| `_logger` | `ILogger \| undefined` | — | Logger |
| `_soundIndices` | `number[]` | `[]` | Dostupni random indeksi |
| `_lastSelected` | `number` | `NaN` | Poslednji izabrani indeks |
| `_isMuted` | `boolean` | `false` | Mute status |
| `_duration` | `number[]` | `[]` | Niz trajanja |
| `_rate` | `number` | `1` | Brzina |
| `_howlerIds` | `Map<number, {loopCount, loop, soundId}>` | — | Praćenje instanci |

### Metode

#### `public play(cmd?: any): void`
Reprodukuje sledeći sprite u listi.

**Logika:**
1. `getNextSpriteDef()` — bira sprite
2. Dohvata `soundId` i `spriteId` iz definicije
3. Handluje `"s_"` prefix za sprite ID
4. Postavlja volume/rate/mute
5. Dohvata loop count preko `getSpriteLoopPanCount()`
6. Registruje `"end"` event handler

#### `private getSpriteLoopPanCount(spriteData, spriteId): any`
Izvlači loop ili pan count za specifičan sprite.
- Ako je niz → traži objekat sa ključem `"s_{spriteId}"`

#### `private getNextSpriteDef(): any`
Bira sledeću sprite definiciju.
- Ako `_type === "random"` → `getRandomIndex()`
- Inače → sekvencijalno sa wrap-around

#### `private createIndexedList(lastIndexPreviousList?: number): number[]`
Kreira listu dostupnih indeksa, isključuje poslednji iz prethodne liste.

#### `private getRandomIndex(): number`
Random sprite indeks **bez ponavljanja**.
- Kreira novu listu indeksa ako je prazna
- Uklanja izabrani indeks da spreči ponavljanje

#### `public stop(cmd: any, howlerId?: number): void`
Zaustavlja reprodukciju.
- Ako `spriteToPlay` u cmd → zaustavi specifičan sprite
- Ako `howlerId` → zaustavi specifičnu instancu
- Inače → zaustavi sve instance

#### `public pause(): void`
Pauzira sve instance.

#### `public resume(): void`
Nastavlja iz pauze.

#### `public mute(): void`
Mute-uje sve instance.

#### `public fade(fadeProps: any): void`
Fade sve instance sa volume/duration.

#### `public seek(position: number): void`
Postavlja poziciju prve instance.

#### `public resetIndex(): void`
Resetuje trenutni indeks na 0.

---

## 10. Interfejsi i tipovi

### ISoundPlayer (`ISoundPlayer.ts`)

```typescript
interface ISoundPlayer {
    logger: ILogger | undefined;

    toggleAllSounds(isEnable: boolean): void;
    pauseAllSounds(isEnable: boolean): void;
    toggleTagSounds(isEnable: boolean, ...tags: string[]): void;
    execute(commandId: string): void;
    getTags(hidden?: string[]): string[];

    // Opciono
    executeBlock?(commandId: string, index: number): void;
    setNextBlock?(commandId: string, index: number): void;
    getCurrentBlock?(commandId: string): number;
    setCustomSounds?(cs: Array<any>): void;
    init?(assets: Map<string, any>): void;
}
```

### ISoundSprite (`ISoundSprite.ts`)

```typescript
interface ISoundSprite {
    // Metode
    play(cmd?: any): void;
    pause(): void;
    stop(cmd?: any): void;
    mute(): void;
    resume(): void;
    fade(fadeProps: any): void;
    seek(position: number): void;

    // Getteri/Setteri
    rate: number;
    spriteId: string;
    position: number;
    volume: number;
    pan: number | number[];
    loop: number | number[];
    overlap: boolean;
    isPlaying: boolean;
    duration: number | number[];
}
```

### SoundFormat (`SoundFormat.ts`)

```typescript
enum SoundFormat {
    OGG,
    MP3,
    AAC,
    M4A
}
```

### SoundTypes (`SoundTypes.ts`)

```typescript
enum SoundTypes {
    HOWLER = 0
}
```

### SoundData (`SoundData.ts`)

```typescript
class SoundData {
    @observable sounds: object = {};       // Mobx observable
    @observable soundFiles: any[] = [];    // Mobx observable
    players: ISoundPlayer[] = [];
}
```

### SoundProps (`SoundProps.ts`)

```typescript
class SoundProps {
    get sounds(): object;           // _data.sounds
    get sound(): any;               // computed: trenutni layout
    get soundFiles(): any[];        // _data.soundFiles
    get soundFile(): any;           // computed: trenutni fajl
    get players(): ISoundPlayer[];  // _data.players
}
```

### SoundServiceActions (`actions/SoundServiceActions.ts`)

```typescript
class SoundServiceActions extends BaseAction<SoundData> {
    @action.bound setSounds(soundData): void;
    @action.bound setSoundFiles(soundFiles): void;
}
```

---

## 11. sounds.json — Manifest šema

### Kompletna struktura

```json
{
    "soundManifest": [
        {
            "id": "loading_sprite",
            "src": ["soundFiles/loading.m4a", "soundFiles/loading.ogg"],
            "loadType": "-"
        },
        {
            "id": "main_sprite",
            "src": ["soundFiles/main.m4a"],
            "loadType": "A"
        },
        {
            "id": "bonus_sprite",
            "src": ["soundFiles/bonus.m4a"],
            "loadType": "B",
            "unloadable": true
        }
    ],
    "soundDefinitions": {
        "soundSprites": {
            "s_UiButtonClick": {
                "soundId": "loading_sprite",
                "spriteId": "s_UiButtonClick",
                "startTime": 0,
                "duration": 250,
                "overlap": false,
                "tags": ["SoundEffects"],
                "loop": 0,
                "pan": 0,
                "ismuted": false
            }
        },
        "spriteList": {
            "sl_ReelLands": {
                "items": ["s_ReelLand1", "s_ReelLand2", "s_ReelLand3"],
                "type": "random",
                "overlap": false,
                "tags": ["SoundEffects"],
                "loop": 0,
                "pan": 0,
                "isMuted": false
            },
            "sl_WithPerItemConfig": {
                "items": ["s_Sprite1", "s_Sprite2"],
                "type": "sequential",
                "overlap": false,
                "tags": ["SoundEffects"],
                "loop": [{"s_Sprite1": 2}, {"s_Sprite2": -1}],
                "pan": [{"s_Sprite1": -0.5}, {"s_Sprite2": 0.5}],
                "isMuted": false
            }
        },
        "commands": {
            "UiButtonClick": [
                {
                    "spriteId": "s_UiButtonClick",
                    "command": "play",
                    "delay": 0,
                    "volume": 1,
                    "pan": 0,
                    "loop": 0
                }
            ],
            "BigWinStart": [
                {
                    "spriteId": "s_BigWinMusic",
                    "command": "play",
                    "delay": 0,
                    "volume": 0.8,
                    "loop": -1
                },
                {
                    "spriteId": "s_BigWinCoinShower",
                    "command": "play",
                    "delay": 500,
                    "volume": 1
                }
            ],
            "BigWinStop": [
                {
                    "spriteId": "s_BigWinMusic",
                    "command": "fade",
                    "volume": 0,
                    "duration": 300
                },
                {
                    "spriteId": "s_BigWinCoinShower",
                    "command": "stop",
                    "delay": 300
                }
            ],
            "PlayBonusMusic": [
                {
                    "commandId": "StopBaseMusic",
                    "command": "execute",
                    "delay": 0
                },
                {
                    "spriteId": "s_BonusMusicLoop",
                    "command": "play",
                    "delay": 100,
                    "volume": 0.7,
                    "loop": -1
                }
            ]
        }
    }
}
```

### loadType vrednosti

| Vrednost | Tip | Kada se učitava | Opis |
|----------|-----|-----------------|------|
| `"-"` ili `undefined` | Main | Pre pokretanja igre | Loading sprites, UI zvuci |
| `"A"` | Deferred | Na prvom spinu | Main pool: symbols, bigwin, anticipation |
| `"B"` | Deferred | Kad bonus bude potvrđen | Bonus pool: free spins, hold & win |
| `"C"` - `"F"` | Deferred | Po potrebi | Dodatni poolovi |
| `"Z"` | Lazy | On-demand | Retko korišćeni zvuci |

### Command objekat — sva polja

| Polje | Tip | Opis |
|-------|-----|------|
| `spriteId` | `string` | Ciljni sprite |
| `spriteListId` | `string` | Ciljna sprite lista (alternativa za spriteId) |
| `tag` | `string` | Ciljni tag (alternativa za spriteId/spriteListId) |
| `commandId` | `string` | Pod-komanda za izvršavanje (rekurzivno) |
| `command` | `string` | `"play"`, `"pause"`, `"resume"`, `"stop"`, `"set"`, `"fade"`, `"execute"`, `"resetspritelist"` |
| `delay` | `number` | Milisekunde pre izvršavanja |
| `volume` | `number` | 0-1 |
| `pan` | `number` | -1 do 1 |
| `loop` | `number` | 0=bez, -1=beskonačno, >0=broj ponavljanja |
| `startPosition` | `number` | Početna pozicija reprodukcije |
| `rate` | `number` | Brzina reprodukcije (1 = normalno) |
| `sync` | `string` | Sprite sa kojim se sinhronizuje pozicija |
| `duration` | `number` | Trajanje fade-a u ms (za fade komandu) |
| `cancelDelay` | `boolean` | Prekini ako već svira (za play komandu) |

---

## 12. Tok učitavanja (Loading Flow)

```
SoundService Constructor
    │
    ├── Registruje SoundLoader u loaderService
    ├── Učitava sounds.json (iz manifesta)
    └── SoundServiceActions.setSounds()

        ▼

ResourceManager.doMainLoading("sounds")
    │
    └── SoundLoader.startLoad()
            │
            ├── Kreira sprite mapu iz definicija
            ├── Resetuje load brojače
            │
            ├── Za svaki main-load zvuk (paralelno do _concurrency):
            │       │
            │       ├── _downloadAudio(url)
            │       │       │
            │       │       ├── fetch() sa streaming progress tracking
            │       │       ├── Praćenje brzine (Mbps)
            │       │       ├── Blob → DataURL konverzija (FileReader)
            │       │       └── Kreiranje Howl instance
            │       │           - src: dataURL
            │       │           - format: ["wav","mp3","m4a","ogg","aac"]
            │       │           - preload: true
            │       │           - autoplay: true
            │       │           - sprite: _spriteMap
            │       │
            │       └── onSoundLoad() → učitaj sledeći u redu
            │
            └── Kad su SVI main zvuci učitani:
                    │
                    └── onMainSoundLoadCompletion()
                            │
                            ├── Čeka service.initialized (MobxUtils.addWhen)
                            │
                            └── setPlayerData()
                                    │
                                    ├── player.setRawUrls()
                                    ├── player.setSoundFormat()
                                    ├── player.setHowls()
                                    └── player.setSounds()
                                            │
                                            ├── Kreira SoundSprite za svaki soundSprites entry
                                            ├── Kreira SoundSpriteList za svaki spriteList entry
                                            └── Mapira commands u _commands mapu

        ▼

ResourceManager.doMoreLoading()
    └── Nastavlja sa ostalim asset-ima
```

### Deferred/Lazy SubLoader tok

```
SoundLoader.process() nailazi na loadType != "-"
    │
    ├── Proverava systemProps.loadStatus[loadType]
    ├── Ako ne postoji: loaderService.createSubLoaderById(loadType)
    └── Čuva zvuk u _subLoaderSounds[loadType][]

        ▼ (kad igra pozove startSubLoader)

SubLoader.startSubLoader()
    │
    ├── _soundLoader.getSubLoaderSoundList(subLoaderID)
    ├── Dodaje svaki zvuk u stavke za učitavanje
    │
    └── Za svaki zvuk (paralelno):
            │
            └── loadItem()
                    │
                    ├── Proverava FILE_TYPES sufiks
                    └── _soundLoader.loadSubLoaderAudio(srcRef, id, callback)
                            │
                            ├── Kreira Howl instancu
                            └── Na "load" event:
                                    ├── player.addHowls(howl, srcRef, id)
                                    │       └── Kreira SoundSprite sa novim Howl-om
                                    │       └── Dodaje u player._soundSprites
                                    └── Izvršava loadedFunc callback

        ▼

SubLoader.replaceAssets() — zamena asset-a po završetku
```

---

## 13. Tok izvršavanja komandi (Command Execution Flow)

```
soundManager.execute("BigWinStart")
    │
    └── SoundPlayer.execute("BigWinStart")
            │
            ├── clearTimersAndTweens("BigWinStart")
            │       └── Dohvata sve sprite ID-jeve
            │       └── Ubija gsap tween-ove za svaki
            │
            ├── Dohvata komande iz _commands mape
            │
            └── Za svaku komandu u nizu:
                    │
                    ├── Računa delay (ms → sekunde)
                    │
                    ├── Ako delay > 0:
                    │       └── gsap.delayedCall(delay, onDelayTimer, [cmd, cmdId])
                    │
                    └── Ako delay = 0:
                            └── onDelayTimer(cmd, cmdId)

onDelayTimer(cmd, cmdId)
    │
    ├── Proverava document.visibilityState
    │
    ├── Ako cmd.command === "execute":
    │       └── Rekurzivno: execute(cmd.commandId)
    │
    ├── Ako cmd.tag postoji:
    │       └── "set" → menja volume taga
    │
    └── Dohvata ciljni sprite(s) po:
            ├── cmd.spriteId → _soundSprites.get()
            ├── cmd.spriteListId → _soundSprites.get()
            └── cmd.tag → svi sprite-ovi u tagu

            ▼

    Switch na cmd.command:

    "play"  → Postavi volume/pan/loop/position/rate
              Ako sync: sinhronizuj poziciju
              Ako cancelDelay && isPlaying: stop()
              Ako custom sound: checkCustomSound()
              Inače: sprite.play(cmd)

    "set"   → Postavi volume/pan/loop/position/rate

    "pause" → sprite.pause()

    "resume"→ sprite.resume()

    "stop"  → sprite.stop()

    "fade"  → Izvuci volume/rate/pan/duration
              Sačuvaj temp fade za pause restore
              sprite.fade(fadeProps)

    "resetspritelist" → Ako SoundSpriteList: resetIndex()
```

---

## 14. State mašina sprite-ova

### Stanja

| Stanje | `_isPlaying` | `_isPaused` |
|--------|-------------|-------------|
| STOPPED | `false` | `false` |
| PAUSED | `false` | `true` |
| PLAYING | `true` | `false` |

### Tranzicije

```
STOPPED ──play()──→ PLAYING
PAUSED  ──play()──→ PLAYING (resume)
PLAYING ──pause()─→ PAUSED
PLAYING ──stop()──→ STOPPED
PAUSED  ──stop()──→ STOPPED
```

### Loop ponašanje

```
Na svaki "end" event:
    │
    ├── Ako loop = 0 → stop()
    ├── Ako loop > 0 → decrement counter
    │       ├── Ako counter ≤ 0 → stop()
    │       └── Inače → nastavlja
    └── Ako loop = -1 → beskonačno ponavljanje
```

---

## 15. Browser kompatibilnost

### Bowser detekcija

Koristi se u `SoundLoader.process()` za detekciju:
- Browser name (npr. `"Firefox"`)
- OS name (npr. `"iOS"`)

### Specijalni slučaj: Firefox
- Firefox (ne-iOS) sa AAC formatom → **prebacuje na OGG**
- Sve ostalo → koristi AAC (default)

### Format prioritet po browseru

| Browser | Platforma | Format |
|---------|-----------|--------|
| Chrome | Sve | AAC (M4A) |
| Safari | Sve | AAC (M4A) |
| Firefox | iOS | AAC (M4A) |
| Firefox | Desktop/Android | **OGG** |
| Edge | Sve | AAC (M4A) |

### Howler.autoUnlock
Postavlja se na `true` u `SoundPlayer.setSounds()` — omogućava reprodukciju na Chrome-u bez korisničke interakcije.

### Document Visibility API
- Tab sakriven → pauzira sve zvukove
- Tab vidljiv → nastavlja na osnovu korisničke preference i `_isSoundEnable` flaga
- **Čuva fade stanja** tokom pauze i restore-uje ih na nastavku

### Fetch API
Koristi `ReadableStream` za streaming praćenje progresa preuzimanja.

---

## 16. Konstante i konfiguracija

### Podržani tipovi fajlova

| Kontekst | Tipovi |
|----------|--------|
| `SoundLoader.FILE_TYPES` | `["wav", "mp3", "m4a", "ogg", "aac"]` |
| `SoundPlayer.FILE_TYPES` | `["m4a"]` (za custom zvukove) |

### Opsezi vrednosti

| Property | Min | Max | Specijalno |
|----------|-----|-----|-----------|
| Volume | `0` | `1` | — |
| Pan | `-1` (levo) | `1` (desno) | `0` = centar |
| Rate | >0 | — | `1` = normalna brzina |
| Loop | `-1` | ∞ | `0` = bez, `-1` = beskonačno |

### Concurrency
- Default: **5** paralelnih učitavanja
- Override: `ResourceManager.addLoader()` može promeniti

### Network speed threshold
- `LoadProgress` event se objavljuje kad je brzina ≥ **4.1 Mbps**

### Howl konfiguracija (per instanca)

```javascript
{
    src: soundDataURL,          // Data URL (blob konvertovan)
    format: ["wav", "mp3", "m4a", "ogg", "aac"],
    preload: true,
    autoplay: true,
    sprite: _spriteMap          // { spriteId: [startTime, duration] }
}
```

---

## 17. Error handling i logovanje

### Konzolni prefiksi

| Prefiks | Izvor |
|---------|-------|
| `█LOADER█` | SoundLoader/SubLoader progres |
| `█SUB_LOADER█` | SubLoader specifični eventi |
| `█SOUND_MANAGER█` | SoundPlayer problemi |

### Specifične greške

| Situacija | Ponašanje |
|-----------|-----------|
| `"loaderror"` event sa `"Decoding audio data failed"` | **Preskače** (ne baca grešku) |
| `fetch()` greška | Loguje celu grešku na konzolu |
| Rekurzija > 10 nivoa u `getSpriteIds` | **Baca grešku** |
| Duplikat zvuka u manifestu | Console warning |
| Neusklađena putanja fajla | Console warning |
| SoundLoader nije pronađen u SubLoader-u | Console warning |
| Howl instanca ne postoji za sprite | Rani return (`null` check) — **tihi fail** |
| `document.visibilityState !== "visible"` | Preskače izvršavanje komande |
| Player ne postoji | Komande se tiho ignorišu |

### Tihi failovi (bitno za debugging)

1. **Undefined howl u SoundSprite metodama** — rani return, bez greške
2. **Nevidljiv tab** — komande se preskakavaju bez logovanja
3. **Nepostojeći player** — pozivi se tiho ignorišu

---

## 18. SoundTool — Debug alat

**Fajl:** `/c/IGT/playa-core/src/ts/utils/sound/SoundTool.ts`
**Klasa:** `SoundTool`

### Aktiviranje
- **Tastatura:** `Ctrl+Alt+S` — otvara debug prozor

### Funkcionalnosti
- Lista svih komandi sa pretraživanjem
- Real-time monitoring sprite-ova (pozicija, volume, loop, itd.)
- Stop all sounds dugme
- Opciona iframe integracija za ugrađeni debugger

### Ključne metode
| Metoda | Opis |
|--------|------|
| `open()` | Otvara debug prozor |
| `playCommand(command)` | Izvršava sound komandu |
| `updateDisplay()` | Ažurira real-time info sprite-ova |
| `stopAllSounds()` | Pauzira i čisti sve sprite-ove |

---

## 19. ResourceManager integracija

**Fajl:** `/c/IGT/playa-core/src/ts/loader/ResourceManager.ts`

### Ključne metode za zvuk

#### `public getLoadData(...): number`
Računa doprinos broja fajlova.
- Iterira loadere pozivajući `getLoadData()`
- Ako `loadType !== "-"` → dodaje u subLoader umesto main count-a

#### `public doMainLoading(type: string): void`
Pokreće specijalni loader.
- Ako `type === "sounds"` → `_soundLoader.startLoad(this)`
- Inače → `doMoreLoading()`

#### `public doMoreLoading(): void`
Nastavlja main učitavanje nakon zvukova/fontova.
- Inkrementira `_checkPoints`
- Ako `_checkPoints > 1` → počinje učitavanje preostalih asset-a

### LoaderService

#### `public createSubLoaderById(subLoaderId: string): void`
Kreira subLoader po ID-u. Poziva ga `SoundLoader` kad naiđe na nepoznat `loadType`. Delegira na `ResourceManager.createSubLoaderById()`.

---

## 20. Custom Sounds

### Dodavanje custom zvuka

```typescript
// Pojedinačno
soundManager.addCustomSound({ name: "spriteId", path: "url" });

// Batch
soundManager.player.setCustomSounds([
    { name: "id1", path: "url1" },
    { name: "id2", path: "url2" }
]);
```

### Ponašanje
- Custom zvukovi se kreiraju kao `Howl` instance sa `FILE_TYPES = ["m4a"]`
- Čuvaju se u `_customSounds` mapi (key = name/spriteId)
- **Kad custom zvuk postoji za sprite ID**, `SoundPlayer` ga koristi **umesto** manifest zvuka
- Podržane komande na custom zvukovima: `play`, `pause`, `resume`, `stop`
- `toggleCustomSounds()` mute/unmute sve custom zvukove kad se tag toggle-uje

---

## 21. Integracija sa igrom — SubLoader pozivi

### Tri obavezna poziva u game kodu

```typescript
// 1. Na prvom spinu — učitaj main pool
startSubLoader("A");

// 2. Kad bonus bude POTVRĐEN (3+ scattera evaluirana, NE na scatter land)
startSubLoader("B");

// 3. Na kraju bonusa — oslobodi bonus audio iz RAM-a
unloadSubLoader("B");
```

### Trigger timing — kritično

| Događaj | Trigger za SubLoader? | Razlog |
|---------|----------------------|--------|
| Scatter leti na reel | **NE** | Samo vizuelni efekat |
| Scatter sleće na reel | **NE** | Još uvek se čeka evaluacija |
| Spin rezultat evaluiran, 3+ scattera | **DA → startSubLoader("B")** | Bonus je potvrđen |
| BonusTriggerCommand | **DA** | Posle evaluacije reelova |

### Queue ponašanje
- Samo **jedan SubLoader** se učitava istovremeno
- FIFO redosled — ako se A i B triggeruju simultano, B čeka dok A ne završi
- Bonus intro animacija (2-3 sekunde) kupuje vreme za SubLoader B

### Standalone vs Sprite za muziku

| Tip muzike | Gde ide | Razlog |
|------------|---------|--------|
| Base game muzika (loopuje satima) | **standalone** (zaseban M4A) | Čist Howler loop bez mikro-pauze |
| Bonus muzika (30s-3min) | **bonus sprite** | Prihvatljiv kvalitet, kraća sesija |

### unloadable flag
- `"unloadable": true` u `soundManifest` je **metadata signal** za playa-core tim
- **Runtime unload NIJE implementiran** — playa-core `SoundPlayer` nema `unloadHowl()` metodu
- Plan: playa-core tim treba da implementira `SoundPlayer.unloadHowl()` za oslobađanje bonus audio-a iz memorije

---

## Globalni eksporti

```typescript
// /c/IGT/playa-core/src/ts/sound/index.ts
export * from "./ISoundPlayer";
export * from "./SoundPlayer";
export * from "./SoundService";
export * from "./SoundTypes";
export * from "./SoundFormat";

// Singleton instance (globalno)
export const soundManager = SoundManager.getInstance();
export const loaderService = new LoaderService(...);
```

### IXF/Howler eventi

| Event | Izvor | Trigger |
|-------|-------|---------|
| `"load"` | Howler | Audio fajl učitan |
| `"loaderror"` | Howler | Greška pri učitavanju |
| `"end"` | Howler | Reprodukcija završena |
| `"LoadProgress"` | IXF | Brzina preuzimanja ≥ 4.1 Mbps |
| `"visibilitychange"` | Document | Tab visibility promena |
| `"GAME_CONTROL"` | Game Channel | Promena stanja igre |
| `Ctrl+Alt+S` | Keyboard | Otvaranje SoundTool debug-a |
