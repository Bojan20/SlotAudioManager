# Ultimate Web Audio & Howler.js Referenca za Slot Igre

> **Kompletna tehnicka dokumentacija** — Howler.js internali, Web Audio API, HTML5 Audio,
> memory management, SubLoader sistem, unload/reload lifecycle, mobilna ogranicenja,
> AAC encoding, gapless looping, i production obrasci za IGT slot igre.
>
> Datum: 2026-04-09

---

## Sadrzaj

1. [Web Audio API — Kompletni internali](#1-web-audio-api--kompletni-internali)
2. [Howler.js arhitektura (v2.2.4)](#2-howlerjs-arhitektura-v224)
3. [Howl.unload() — Tacno sta se desava](#3-howlunload--tacno-sta-se-desava)
4. [HTML5 Audio mod u Howler-u](#4-html5-audio-mod-u-howler-u)
5. [AudioBuffer memorijski proracun](#5-audiobuffer-memorijski-proracun)
6. [AAC/M4A encoder padding i gapless looping](#6-aacm4a-encoder-padding-i-gapless-looping)
7. [Mobilna ogranicenja (iOS Safari, Android Chrome)](#7-mobilna-ogranicenja-ios-safari-android-chrome)
8. [playa-core SubLoader sistem](#8-playa-core-subloader-sistem)
9. [Pool arhitektura za slot igre](#9-pool-arhitektura-za-slot-igre)
10. [Sound loading — kompletni flow](#10-sound-loading--kompletni-flow)
11. [Sound unloading — kompletni flow](#11-sound-unloading--kompletni-flow)
12. [HTML5 Streaming muzike — DirectHTML5 pattern](#12-html5-streaming-muzike--directhtml5-pattern)
13. [Pseudo-streaming BGM — Dual-Pool Crossfade](#13-pseudo-streaming-bgm--dual-pool-crossfade)
14. [howlUtil.ts — Utility za pristup Howl instancama](#14-howlutilts--utility-za-pristup-howl-instancama)
15. [Memory management best practices](#15-memory-management-best-practices)
16. [Debugging u produkciji](#16-debugging-u-produkciji)
17. [Poznati bagovi i workaround-i](#17-poznati-bagovi-i-workaround-i)
18. [SoundSprite state machine — kompletna pravila](#18-soundsprite-state-machine--kompletna-pravila)
19. [Error handling i recovery obrasci](#19-error-handling-i-recovery-obrasci)
20. [gsap timer integracija sa SoundPlayer](#20-gsap-timer-integracija-sa-soundplayer)
21. [Fade implementacija — Web Audio vs HTML5](#21-fade-implementacija--web-audio-vs-html5)
22. [Codec detekcija i format fallback](#22-codec-detekcija-i-format-fallback)
23. [Rate/Pitch shifting ponasanje](#23-ratepitch-shifting-ponasanje)
24. [SHA256 cache mehanizam (buildTiered.js)](#24-sha256-cache-mehanizam-buildtieredjs)
25. [validateBuild.js — QA validacija](#25-validatebuildjs--qa-validacija)
26. [copyAudio.js — Deploy flow i webpack hashing](#26-copyaudiojs--deploy-flow-i-webpack-hashing)
27. [Audio encoding — FFmpeg flagovi i bitrate](#27-audio-encoding--ffmpeg-flagovi-i-bitrate)
28. [Tag sistem — volume/mute internali](#28-tag-sistem--volumemute-internali)
29. [Command execution — svih 8 tipova komandi](#29-command-execution--svih-8-tipova-komandi)
30. [SoundSpriteList — random selekcija bez ponavljanja](#30-soundspritelist--random-selekcija-bez-ponavljanja)
31. [Legacy vs Tiered manifest format](#31-legacy-vs-tiered-manifest-format)
32. [Howler.js fade internali — source code](#32-howlerjs-fade-internali--source-code)
33. [Network i CDN razmatranja](#33-network-i-cdn-razmatranja)
34. [Nedostajuci detalji iz build pipeline-a](#34-nedostajuci-detalji-iz-build-pipeline-a)
35. [Nedostajuci detalji iz playa-core](#35-nedostajuci-detalji-iz-playa-core)
36. [Segment kompozicione smernice](#36-segment-kompozicione-smernice-za-audio-dizajnere)
37. [Auto-assign obrasci za SpriteConfigPage](#37-auto-assign-obrasci-za-spriteconfigpage)
38. [AUDIO_POOLS.md — status zastarelosti](#38-audio_poolsmd--status-zastarelosti)
39. [replayMissedCommands i gsap catch-up](#39-replaymissedcommands-i-gsap-catch-up)
40. [deployStreaming.js — liniju-po-liniju analiza (735 LOC)](#40-deploystreamingjs--liniju-po-liniju-analiza-735-loc)
41. [Tri build sistema — uporedna analiza](#41-tri-build-sistema--uporedna-analiza)
42. [SubLoader auto-trigger — workaround bez game devova](#42-subloader-auto-trigger--workaround-bez-game-devova)
43. [Oficijalna IGT/GDK dokumentacija — poredjenje i nedostajuci detalji](#43-oficijalna-igtgdk-dokumentacija--poredjenje-i-nedostajuci-detalji)
44. [Strategija "Z" za main pool — eliminacija game dev koda](#44-strategija-z-za-main-pool--eliminacija-game-dev-koda)

---

## 1. Web Audio API — Kompletni internali

### 1.1 AudioContext — jedini ulaz u Web Audio

`AudioContext` je centralni objekat Web Audio API-ja. Sve operacije (dekodiranje, reprodukcija, efekti) prolaze kroz njega.

```javascript
const ctx = new (window.AudioContext || window.webkitAudioContext)();
```

**Interno stanje AudioContext-a:**

| Polje | Tip | Opis |
|-------|-----|------|
| `state` | string | `'suspended'` / `'running'` / `'closed'` / `'interrupted'` (iOS) |
| `sampleRate` | number | Obicno 44100 ili 48000 Hz (odredjuje OS/hardware) |
| `currentTime` | double | Monotono rastuca vrednost u sekundama od kreiranja |
| `destination` | AudioDestinationNode | Hardverski izlaz (zvucnik) |
| `listener` | AudioListener | Za 3D spatialni audio |
| `baseLatency` | double | Minimalna latencija u sekundama |
| `outputLatency` | double | Estimirana latencija do hardverskog izlaza |

### 1.2 AudioContext stanja — tranzicije

```
                ctx.resume()
'suspended'  <─────────────>  'running'  ────>  'closed'
      ^          ctx.suspend()      |         ctx.close()
      |                             |         (nepovratan)
      |                             v
      |                      'interrupted'
      |                       (samo iOS Safari,
      |________________________ eksterni dogadjaj)
```

| Stanje | Opis | Kako se dolazi |
|--------|------|----------------|
| `'suspended'` | Audio engine ne procesira. Nodovi postoje ali ne emituju zvuk. | Inicijalno (pre user gesture-a), ili `ctx.suspend()` |
| `'running'` | Normalan rad. Audio se procesira i emituje. | `ctx.resume()` na user gesture |
| `'closed'` | Permanentno zatvoren. Resursi oslobodjeni. Ne moze se ponovo otvoriti. | `ctx.close()` |
| `'interrupted'` | iOS Safari — eksterni prekid (poziv, zatvaranje laptopa). Browser kontrolise. | Automatski od OS-a |

**Kriticna pravila:**
- `ctx.resume()` vraca `Promise`. Na iOS-u, MORA biti pozvan iz stack-a iniciranog user gesture-om (click/touchend).
- `ctx.close()` je NEPOVRATAN. Posle toga moras kreirati potpuno novi AudioContext.
- `ctx.suspend()` i `ctx.resume()` su IDEMPOTENTNI — pozivanje vise puta ne pravi problem.
- `currentTime` se NE resetuje na 0 posle suspend/resume ciklusa.

### 1.3 AudioContext autoplay politika

**Chrome 71+ autoplay politika:**
1. AudioContext kreiran pre user gesture-a startuje u `'suspended'` stanju
2. `ctx.resume()` MORA biti pozvan iz handler-a za: `click`, `touchend`, `keydown`, `pointerup`
3. Chrome koristi MEI (Media Engagement Index) — sajtovi sa visokim engagement-om mogu auto-resume
4. `touchstart` radi od Chrome 55+ (ali `touchend` je pouzdaniji)

**Firefox:**
- Ista politika od Firefox 66+, ali MEI je drugaciji algoritam

**Safari:**
- Zahteva user gesture za `resume()` od Safari 11+
- Poseban slucaj: `webkitAudioContext` na starijim verzijama

**Event handler primer:**
```javascript
document.addEventListener('click', function unlock() {
    ctx.resume().then(() => {
        document.removeEventListener('click', unlock);
        console.log('AudioContext otkljucan, state:', ctx.state);
    });
}, { once: true });
```

### 1.4 decodeAudioData() — dekodiranje u AudioBuffer

```javascript
// Promise oblik (moderan):
const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

// Callback oblik (legacy, Howler koristi oba):
ctx.decodeAudioData(arrayBuffer, successCallback, errorCallback);
```

**Sta se desava interno:**
1. `arrayBuffer` (kompresovani M4A/OGG/MP3 bajtovi) se predaje audio thread-u
2. Audio thread dekodira ceo fajl u nekompresovane PCM float32 sample
3. Kreira se `AudioBuffer` objekat sa dekodiranim podacima
4. Original `arrayBuffer` se NE oslobadja automatski (mora `arrayBuffer = null`)

**AudioBuffer objekat:**

| Polje | Tip | Opis |
|-------|-----|------|
| `sampleRate` | float | Sample rate dekodiranih podataka (obicno 44100) |
| `length` | unsigned long | Broj sampla po kanalu |
| `duration` | double | Trajanje u sekundama (`length / sampleRate`) |
| `numberOfChannels` | unsigned long | Broj kanala (1=mono, 2=stereo) |

**Metode:**
```javascript
audioBuffer.getChannelData(channel)  // vraca Float32Array — DIREKTNA REFERENCA na interne podatke
audioBuffer.copyFromChannel(destination, channelNumber, startInChannel)
audioBuffer.copyToChannel(source, channelNumber, startInChannel)
```

**KRITICNO**: `getChannelData()` vraca REFERENCU na interni Float32Array, ne kopiju. Modifikacija vracenog niza menja AudioBuffer.

### 1.5 AudioBuffer memorijski footprint

**Formula:**
```
Memorija (bajtovi) = sampleRate × trajanje_sekunde × numberOfChannels × 4

gde je:
  4 = sizeof(Float32)  // IEEE 754 32-bit floating point po samplu
```

**Kompresija faktor:**
- AAC-LC 64kbps stereo: ~44x kompresija (1MB M4A → ~44MB AudioBuffer)
- AAC-LC 128kbps stereo: ~22x kompresija
- OGG Vorbis 96kbps stereo: ~29x kompresija
- MP3 128kbps stereo: ~22x kompresija

**Prakticni primeri za slot igre:**

| Opis | Trajanje | SR | Kanali | M4A na disku | AudioBuffer u RAM-u | Faktor |
|------|----------|-----|--------|-------------|---------------------|--------|
| UI klik | 0.3s | 44100 | 2 | ~2.4 KB | 105.8 KB | 44x |
| Reel land | 1.5s | 44100 | 2 | ~12 KB | 529.2 KB | 44x |
| SFX sprite (loading) | 10s | 44100 | 2 | ~80 KB | 3.53 MB | 44x |
| SFX sprite (main) | 30s | 44100 | 2 | ~240 KB | 10.58 MB | 44x |
| SFX sprite (bonus) | 60s | 44100 | 2 | ~480 KB | 21.17 MB | 44x |
| Muzicka traka | 120s | 44100 | 2 | ~960 KB | 42.34 MB | 44x |
| 7 muzickih traka | 7×60s | 44100 | 2 | ~3.4 MB | ~148.2 MB | 44x |

**Poslednja kolona objasnjava zasto muzika MORA biti HTML5 Audio na mobilnim uredjajima.**

### 1.6 AudioBufferSourceNode — one-shot nodovi

```javascript
const source = ctx.createBufferSource();
source.buffer = audioBuffer;      // referenca na DELJENI AudioBuffer (ne kopira)
source.connect(gainNode);
source.start(when, offset, duration);
```

**Kriticna pravila:**
- `start()` se moze pozvati SAMO JEDNOM. Drugi poziv baca `InvalidStateError`.
- Za novu reprodukciju: kreiraj NOVI `AudioBufferSourceNode` sa istim `audioBuffer`
- Node se automatski GC-uje nakon zavrsetka (fire-and-forget pattern)
- `buffer` property je REFERENCA — vise source nodova deli isti AudioBuffer bez kopiranja

**Svojstva:**
```javascript
source.loop = true;              // default: false
source.loopStart = 0;            // sekunde, default: 0
source.loopEnd = 0;              // sekunde, 0 = kraj buffer-a
source.playbackRate.value = 1.0; // AudioParam, menja i brzinu i pitch
source.detune.value = 0;         // AudioParam, u centima (100 centi = 1 poluton)
```

**Loop mehanizam u Web Audio:**
- Implementiran u audio thread-u (C++/Rust, ne JavaScript)
- Sample-level preciznost — NEMA micro-gap-a
- `loopStart`/`loopEnd` koriste float64 (sub-sample preciznost)
- Loop je GARANOVAN gapless jer radi na dekodiranom AudioBuffer-u (bez encoder padding-a)

### 1.7 GainNode i audio graf

```javascript
const gainNode = ctx.createGain();
gainNode.gain.value = 1.0;                           // inicijalna vrednost
gainNode.gain.setValueAtTime(0.5, ctx.currentTime);  // instant promena
gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + 2);  // fade over 2s
gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 2);  // exp fade
```

**Howler-ov audio graf (Web Audio mod):**
```
AudioBufferSourceNode (kreiran za svaki play())
    │
    ▼
GainNode (sound._node) ── per-sound volume
    │
    ▼
[StereoPannerNode] (opciono, spatial plugin)
    │
    ▼
masterGain (Howler.masterGain) ── globalna volume kontrola
    │
    ▼
ctx.destination ── hardverski izlaz (zvucnik)
```

Svaki `Sound` objekat u Howler-u ima svoj `GainNode`. Novi `AudioBufferSourceNode` se kreira za svaki `play()` i konektuje na postojeci `GainNode`.

### 1.8 Garbage Collection za Web Audio objekte

**Sta GC cisti:**
- `AudioBufferSourceNode` — automatski posle zavrsetka reprodukcije (fire-and-forget)
- `GainNode` — kad nema referenci iz JS koda I nije konektovan na ziv graf
- `AudioBuffer` — kad nema referenci (ni iz JS koda, ni iz aktivnih source nodova)

**Sta GC NE cisti (poznati problemi):**
- Chrome/Chromium: Dekodirani AudioBuffer-i mogu ostati u memoriji cak i bez referenci. Bug u Chrome Web Audio GC-u, poboljsan u Chrome 65+ ali ne potpuno resen.
- `decodeAudioData()` rezultat se interno kesira u nekim browser-ima. Brisanje JS reference ne garantuje oslobadjanje.
- Howler-ov `cache` objekat (`cache[url] = audioBuffer`) drzi dodatnu referencu. Mora se eksplicitno `delete cache[url]`.

**Workaround za potpuno oslobadjanje:**
```javascript
// 1. Zaustavi sve source nodove
source.stop(0);
source.disconnect();

// 2. Obrisi Howl kes
howl.unload();  // brise iz cache i _howls

// 3. Nuliraj sve JS reference
howl = null;
audioBuffer = null;

// 4. Forsiraj GC (samo za debugging, ne u produkciji)
// if (window.gc) window.gc();
```

---

## 2. Howler.js arhitektura (v2.2.4)

### 2.1 Tri sloja apstrakcije

Howler ima tri nivoa objekata koji zajedno upravljaju audio reprodukcijom:

#### HowlerGlobal (singleton `Howler`)

Globalni kontroler za sve zvukove u aplikaciji. Kreira se jednom pri ucitavanju biblioteke.

```javascript
// Interno stanje:
{
    _counter: 1000,              // globalni ID generator (inkrementirano za svaki Sound)
    _html5AudioPool: [],         // pool otkljucanih HTML5 Audio objekata
    html5PoolSize: 10,           // max velicina HTML5 pool-a
    _codecs: {},                 // kesirani rezultati codec detekcije
    _howls: [],                  // niz SVIH aktivnih Howl instanci
    _muted: false,               // globalni mute
    _volume: 1,                  // globalni volume
    _canPlayEvent: 'canplaythrough',
    masterGain: null,            // Web Audio GainNode — master volume
    noAudio: false,              // true ako nema audio podrske
    usingWebAudio: true,         // false ako AudioContext nije dostupan
    autoSuspend: true,           // auto-suspend posle 30s neaktivnosti
    ctx: null,                   // AudioContext instanca (JEDNA za celu aplikaciju)
    autoUnlock: true,            // auto-unlock na prvi user gesture
    _audioUnlocked: false,       // da li je AudioContext otkljucan
    _scratchBuffer: null,        // 1-sample buffer za iOS unlock workaround
    _suspendTimer: null          // setTimeout ID za 30s auto-suspend
}
```

**Kljucne metode:**
- `Howler.volume(val)` — setuje globalni volume, propagira na sve Howl instance
- `Howler.mute(muted)` — globalni mute. Takodje prima drugi parametar: `Howler.mute(isMuted, soundId)` za mute/unmute specificnog Sound ID-a unutar audiosprite Howl-a (koristi se u tag sistemu)
- `Howler.stop()` — zaustavi SVE zvukove u SVIM Howl instancama
- `Howler.unload()` — unload-uj SVE, zatvori AudioContext, kreiraj novi
- `Howler.codecs(ext)` — proveri da li browser podrzava format

#### Howl (grupni kontroler)

Jedna instanca po audio izvoru. Upravlja pool-om Sound objekata.

```javascript
// Konstruktor opcije:
{
    src: ['sound.m4a', 'sound.ogg'],  // niz URL-ova (fallback po redu)
    volume: 1.0,                       // 0.0 - 1.0
    html5: false,                      // true = forsiraj HTML5 Audio
    loop: false,                       // ponavljanje
    preload: true,                     // true | 'metadata' | false
    autoplay: false,                   // automatska reprodukcija
    mute: false,                       // pocetni mute
    sprite: {},                        // sprite definicije: { name: [start_ms, duration_ms, loop?] }
    rate: 1.0,                         // playback speed
    pool: 5,                           // max neaktivnih Sound-ova u pool-u
    format: [],                        // eksplicitni formati (zaobilazi detekciju)
    xhr: { method: 'GET', headers: {}, withCredentials: false }
}
```

```javascript
// Interno stanje posle init():
{
    _autoplay: false,
    _format: [...],
    _html5: false,
    _muted: false,
    _loop: false,
    _pool: 5,
    _preload: true,
    _rate: 1,
    _sprite: { '__default': [0, 0] },   // default sprite = ceo fajl
    _src: ['sound.m4a'],
    _volume: 1,
    _xhr: { method: 'GET', headers: {}, withCredentials: false },

    _duration: 0,                        // trajanje u sekundama (setuje se nakon load)
    _state: 'unloaded',                  // 'unloaded' | 'loading' | 'loaded'
    _sounds: [],                         // niz Sound instanci (pool)
    _endTimers: {},                      // mapa ID -> setTimeout za kraj reprodukcije
    _queue: [],                          // operacije zakazane pre ucitavanja
    _playLock: false,                    // sprecava DOMException race condition

    _webAudio: true,                     // true = Web Audio, false = HTML5

    // Event listeneri (nizovi {fn, id?, once?} objekata):
    _onend: [], _onfade: [], _onload: [], _onloaderror: [],
    _onplayerror: [], _onpause: [], _onplay: [], _onstop: [],
    _onmute: [], _onvolume: [], _onrate: [], _onseek: [],
    _onunlock: [], _onresume: []
}
```

**Odmah u konstruktoru:**
```javascript
Howler._howls.push(self);  // registruje se u globalni niz
```

#### Sound (pojedinacni zvuk)

Jedan playback instance unutar Howl grupe. "Fire and forget" — kreira se za svaki `play()`.

```javascript
// Interno stanje:
{
    _parent: howl,                // referenca na Howl roditelja
    _muted: parent._muted,
    _loop: parent._loop,
    _volume: parent._volume,
    _rate: parent._rate,
    _seek: 0,                    // trenutna pozicija u sekundama
    _paused: true,
    _ended: true,                // true = dostupan za recikliranje
    _sprite: '__default',        // ime sprite-a koji se reprodukuje
    _id: ++Howler._counter,      // unikatan ID (1001, 1002, ...)

    // Web Audio mod:
    _node: GainNode,             // per-sound volume kontrola
    _node.bufferSource: null,    // AudioBufferSourceNode (kreiran za svaki play)

    // HTML5 mod:
    _node: Audio,                // <audio> DOM element

    _panner: null,               // opcioni PannerNode (spatial plugin)
    _rateSeek: 0,                // korekcija pozicije za promenjeni rate
    _playStart: 0,               // ctx.currentTime kad je play poceo
    _start: 0,                   // pocetak sprite-a u sekundama
    _stop: 0,                    // kraj sprite-a u sekundama
    _errorFn: null,              // HTML5: bound event listener za error
    _loadFn: null,               // HTML5: bound event listener za canplaythrough
    _endFn: null                 // HTML5: bound event listener za ended
}
```

### 2.2 Howler._howls niz — pracenje instanci

- **Dodavanje**: `Howler._howls.push(self)` u `Howl.prototype.init()`
- **Uklanjanje**: U `Howl.prototype.unload()`:
  ```javascript
  var index = Howler._howls.indexOf(self);
  if (index >= 0) {
    Howler._howls.splice(index, 1);
  }
  ```
- **Iteracija**: `Howler.stop()`, `Howler.unload()`, `Howler.volume()`, `Howler.mute()` sve iteriraju kroz `_howls`
- Niz **kontinuirano raste** u SPA aplikacijama ako se Howl instance kreiraju bez `unload()`-a

### 2.3 _state lifecycle — tranzicije stanja

```
'unloaded'  ───>  'loading'  ───>  'loaded'
     ▲                                 │
     │_________________________________│  (unload() pozvan)
```

| Stanje | Kako se postavlja | Sta znaci |
|--------|-------------------|-----------|
| `'unloaded'` | Inicijalno + posle `unload()` | Nema audio podataka u memoriji |
| `'loading'` | U `load()` posle nalazenja codec-a | XHR/fetch u toku ili HTML5 buffering |
| `'loaded'` | U `loadSound()` (Web Audio) ili `_loadListener()` (HTML5) | Audio spreman za reprodukciju |

**Queue mehanizam:**
Operacije (`play`, `pause`, `stop`, `volume`, `mute`, `fade`, `rate`, `seek`, `loop`) pozvane pre `'loaded'` stanja se stavljaju u `_queue` niz:
```javascript
if (self._state !== 'loaded') {
    self._queue.push({ event: 'play', action: function() { self.play(id); } });
    return self;
}
```
Kad se state promeni u `'loaded'`, queue se prazni redom.

### 2.4 Sprite sistem u Howler-u

Sprite je tehnika gde se vise kratkih zvukova pakuje u JEDAN audio fajl. Svaki zvuk je definisan sa `[startTime_ms, duration_ms, loop?]`.

```javascript
var sfx = new Howl({
    src: ['sprites.m4a'],
    sprite: {
        blast:  [0, 1500],           // 0ms do 1500ms
        laser:  [2000, 800],         // 2000ms do 2800ms
        winner: [4000, 2200, true]   // 4000ms do 6200ms, loop
    }
});

sfx.play('blast');   // reprodukuje samo 0-1500ms segment
sfx.play('laser');   // reprodukuje samo 2000-2800ms segment, SIMULTANO sa blast
```

**Web Audio implementacija:**
```javascript
// U play():
source.start(0, sprite[0] / 1000, sprite[1] / 1000);
// start(when, offset_seconds, duration_seconds)
```
`AudioBufferSourceNode.start()` nativno podrzava offset i duration — nema seek-ovanja.

**HTML5 implementacija:**
```javascript
// U play():
node.currentTime = sprite[0] / 1000;  // seek na pocetak sprite-a
node.play();

// Emuliran kraj sprite-a preko setTimeout:
setTimeout(function() {
    node.pause();
    node.currentTime = sprite[0] / 1000;  // resetuj na pocetak
}, sprite[1]);  // duration u ms
```
Manje precizno — `setTimeout` moze kasniti 10-50ms.

### 2.5 Ucitavanje audio-a u Howler-u

**Web Audio put:**
1. `load()` — proverava codec podrsku, bira prvi kompatibilan src
2. `loadBuffer()` — pokrece XHR/fetch za download
3. XHR `onload` — dobija `ArrayBuffer` (kompresovani bajtovi)
4. `decodeAudioData(arrayBuffer)` — dekodira u `AudioBuffer`
5. Rezultat se kesira: `cache[url] = audioBuffer`
6. `loadSound()` — postavlja `_state = 'loaded'`, emituje `'load'` event, prazni queue

**HTML5 put:**
1. `load()` — proverava codec
2. Kreira/dobija `Audio` element iz pool-a
3. Postavlja `node.src = url`
4. Browser pocinje buffering
5. Na `canplaythrough` event: `_loadListener()` — `_state = 'loaded'`, emituje `'load'`

**Kes mehanizam:**
```javascript
// Globalni objekat, mapira URL -> AudioBuffer:
var cache = {};

// U loadBuffer():
if (cache[url]) {
    loadSound(self, cache[url]);  // direktno koristi kesirani buffer
    return;
}

// Posle dekodiranja:
cache[url] = buffer;
loadSound(self, buffer);
```
Vise Howl instanci sa istim URL-om DELE isti AudioBuffer. `unload()` brise iz kesa samo ako nijedan drugi Howl ne koristi isti URL.

---

## 3. Howl.unload() — Tacno sta se desava

Kompletna sekvenca operacija, korak po korak:

### Korak 1: Zaustavljanje svih zvukova

```javascript
var sounds = self._sounds;
for (var i = 0; i < sounds.length; i++) {
    if (!sounds[i]._paused) {
        self.stop(sounds[i]._id);
    }
}
```

`stop()` interno radi:
- Postavlja `_seek = _start || 0`
- Postavlja `_paused = true`, `_ended = true`
- Zaustavlja fade (ako je aktivan)
- **Web Audio**: `bufferSource.stop(0)` + `_cleanBuffer()` (diskonektuje bufferSource od GainNode-a)
- **HTML5**: `node.pause()`, `node.currentTime = 0`
- Emituje `'end'` event, zatim `'stop'` event

### Korak 2: Ciscenje HTML5 nodova

Za svaki Sound koji koristi HTML5 Audio:
```javascript
self._clearSound(sounds[i]._node);
// Postavlja src na 0-sekundni silence WAV (data URI) da zaustavi download:
// 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'
```

Uklanja event listenere:
```javascript
sounds[i]._node.removeEventListener('error', sounds[i]._errorFn, false);
sounds[i]._node.removeEventListener(Howler._canPlayEvent, sounds[i]._loadFn, false);
sounds[i]._node.removeEventListener('ended', sounds[i]._endFn, false);
```

Vraca Audio element u pool:
```javascript
Howler._releaseHtml5Audio(sounds[i]._node);  // push u _html5AudioPool ako je otkljucan
```

### Korak 3: Brisanje node referenci

```javascript
delete sounds[i]._node;
```

### Korak 4: Brisanje tajmera

```javascript
self._clearTimer(sounds[i]._id);
// Brise iz _endTimers: clearTimeout + delete _endTimers[id]
```

### Korak 5: Uklanjanje iz globalnog niza

```javascript
var index = Howler._howls.indexOf(self);
if (index >= 0) {
    Howler._howls.splice(index, 1);
}
```

### Korak 6: Brisanje AudioBuffer kesa (uslovno)

```javascript
var remCache = true;
for (i = 0; i < Howler._howls.length; i++) {
    if (Howler._howls[i]._src === self._src ||
        self._src.indexOf(Howler._howls[i]._src) >= 0) {
        remCache = false;
        break;
    }
}
if (cache && remCache) {
    delete cache[self._src];  // brise AudioBuffer iz globalnog kesa
}
```

**KRITICNO**: Kes se brise SAMO ako nijedan drugi Howl ne koristi isti src URL. Ako dva Howl-a dele isti fajl, `unload()` na jednom NE brise kes.

### Korak 7: Resetovanje stanja

```javascript
Howler.noAudio = false;
self._state = 'unloaded';
self._sounds = [];
self = null;  // SAMO lokalna promenljiva, NE oslobadja objekat
return null;
```

### Sta unload() NE radi

| Ocekivanje | Realnost |
|------------|----------|
| Postavlja `AudioBuffer = null` | NE — samo `delete cache[url]`. Ako postoje druge reference, AudioBuffer ostaje. |
| Zatvara AudioContext | NE — samo `Howler.unload()` (globalni) zatvara ctx i kreira novi. |
| Cisti event listener nizove | NE — `_onend`, `_onplay` itd. ostaju u memoriji jer `self = null` je lokalna promenljiva. |
| Diskonektuje GainNode-ove | NE eksplicitno u unload sekvenci. `_cleanBuffer` diskonektuje bufferSource, ali GainNode (`sound._node`) ne dobija `disconnect()`. |
| Omogucava re-load | NE — posle unload-a, Howl instanca je neupotrebljiva. Moras kreirati NOVU. |

### Da li moze da se ponovo ucita posle unload-a?

**NE.** Razlozi:
1. `_sounds` je ispraznjeno na `[]` — nema Sound objekata
2. `_state` je `'unloaded'` — ali nema mehanizma za ponovni load
3. Howl je uklonjen iz `Howler._howls` — globalni sistem ga ne poznaje
4. Cache je potencijalno obrisan — mora se ponovo dekodirati
5. Pozivanje `load()` na unload-ovanom Howl-u ne radi ispravno jer su interni nizovi resetovani

**Ispravan pattern:**
```javascript
howl.unload();
howl = null;
howl = new Howl({ src: ['sound.m4a'], sprite: {...} });  // novi objekat
```

---

## 4. HTML5 Audio mod u Howler-u

### 4.1 Kada se aktivira

| Uslov | Opis |
|-------|------|
| `html5: true` | Eksplicitno forsirano u konstruktoru |
| `Howler.usingWebAudio = false` | AudioContext nije dostupan (stariji browseri) |
| HTTPS/HTTP mixed content | Stranica HTTPS, src HTTP — XHR ne radi, fallback na HTML5 |
| XHR greska | Web Audio download propadne — automatski retry sa HTML5 |

### 4.2 Razlike u implementaciji

| Aspekt | Web Audio | HTML5 Audio |
|--------|-----------|-------------|
| **Izvor** | `AudioBufferSourceNode` + dekodiran `AudioBuffer` | `<audio>` DOM element |
| **Ucitavanje** | XHR → `decodeAudioData()` → ceo fajl u RAM | Browser streaming, buffered chunks |
| **Memorija** | Ceo fajl dekodiran u Float32 (~44x M4A) | Browser bufferi samo aktivni deo (~3-5MB) |
| **Sprite podrska** | Nativna: `source.start(0, offset, duration)` | Emulirana: `currentTime = seek` + setTimeout za stop |
| **Volume** | `GainNode.gain.setValueAtTime()` — sample-level | `node.volume = val` — step-wise, manje glatko |
| **Loop** | `source.loop = true` — gapless, audio-thread | `stop().play()` u ended handler — ima micro-gap |
| **Latencija** | ~10ms (vec dekodiran u RAM-u) | ~50-300ms (browser mora buffer-ovati) |
| **Simultani zvuci** | Neograniceno (svaki je nov AudioBufferSourceNode) | Ograniceno pool velicinom (default 10) |
| **Fade** | `linearRampToValueAtTime()` — nativna, glatka | `setInterval` sa koracima — emulirana, manje glatka |
| **Mute** | `gain.setValueAtTime(0, ...)` | `node.muted = true` |
| **Preciznost** | Sub-sample (float64 sekunde) | Browser-zavisna (~10-100ms) |
| **Offline rendering** | Da (OfflineAudioContext) | Ne |

### 4.3 HTML5 Audio pool

Howler odrzava globalni pool od otkljucanih `Audio` objekata (default: 10):

```javascript
Howler.html5PoolSize = 10;  // konfiguabilno

_obtainHtml5Audio()  // pop iz pool-a ili kreiraj novi + warning
_releaseHtml5Audio() // push nazad u pool (samo ako je _unlocked)
```

Kad pool bude prazan:
```
"HTML5 Audio pool exhausted, returning potentially locked audio object."
```
Zvuk moze biti blokiran autoplay politikom jer novi Audio element nije otkljucan.

**Unlock mehanizam:**
Na prvi user gesture, Howler popunjava pool pozivajuci `.load()` na svakom Audio elementu. Ovo ih "otkljucava" za buducu reprodukciju bez user gesture-a.

### 4.4 Looping u HTML5 modu — micro-gap problem

HTML5 loop u Howler-u NE koristi nativni `<audio loop>` atribut. Umesto toga:

```javascript
// U _ended() handler-u:
if (!self._webAudio && loop) {
    self.stop(sound._id, true).play(sound._id);
}
```

Ovo je `stop → play` sekvenca:
1. `stop()` — resetuje `currentTime`, pauzira
2. `play()` — seek na pocetak, pokreni reprodukciju

**Rezultat**: Primetna mikro-pauza od **20-100ms** izmedju iteracija. Browser mora:
- Seek-ovati na pocetak fajla
- Ponovo buffer-ovati (za streaming izvore)
- Pokrenuti dekodiranje
- Signalizirati `canplay` pre reprodukcije

**Zasto ne koristi nativni loop:**
Nativni `<audio loop>` bi radio ali Howler treba kontrolu nad sprite granicama. Sprite loop zahteva `stop → seek → play` sekvenciju za tacno poravnanje.

---

## 5. AudioBuffer memorijski proracun

### 5.1 Formula

```
RAM (bytes) = sampleRate × duration_seconds × numberOfChannels × 4
```

| Parametar | Tipicna vrednost | Objasnjenje |
|-----------|------------------|-------------|
| sampleRate | 44100 | 44100 sampla po sekundi po kanalu |
| duration | varijabilno | Trajanje audio fajla u sekundama |
| numberOfChannels | 2 (stereo) | Mono=1, Stereo=2, 5.1=6 |
| 4 | konstantno | IEEE 754 Float32 = 4 bajta po samplu |

### 5.2 Proracun za tipicnu IGT slot igru

**Bez streaming-a (SVE kroz Web Audio):**

| Pool | Tip | Trajanje | M4A | AudioBuffer RAM |
|------|-----|----------|-----|-----------------|
| loading sprite | SFX | ~15s | ~120 KB | 5.29 MB |
| main sprite | SFX | ~45s | ~360 KB | 15.88 MB |
| bonus sprite | SFX | ~60s | ~480 KB | 21.17 MB |
| BaseGameMusicLoop1 | Muzika | 90s | ~720 KB | 31.75 MB |
| BaseGameMusicLoop2 | Muzika | 90s | ~720 KB | 31.75 MB |
| BonusMusicLoop | Muzika | 60s | ~480 KB | 21.17 MB |
| FreeSpinMusic | Muzika | 60s | ~480 KB | 21.17 MB |
| PickerMusicLoop | Muzika | 45s | ~360 KB | 15.88 MB |
| WheelBonusMusic | Muzika | 45s | ~360 KB | 15.88 MB |
| HoldAndWinMusic | Muzika | 60s | ~480 KB | 21.17 MB |
| **UKUPNO** | | | **~4.6 MB** | **~201.1 MB** |

**iOS Safari limit: ~128 MB.** Igra puca na mobilnim uredjajima.

**Sa HTML5 streaming-om za muziku:**

| Pool | Tip | RAM |
|------|-----|-----|
| loading sprite (Web Audio) | SFX | 5.29 MB |
| main sprite (Web Audio) | SFX | 15.88 MB |
| bonus sprite (Web Audio) | SFX | 21.17 MB |
| 7 muzickih traka (HTML5) | Muzika | ~3 MB × aktivne (max 2) = ~6 MB |
| **UKUPNO (base game)** | | **~27 MB** |
| **UKUPNO (bonus)** | | **~48 MB** |

**Sa unload bonusa posle zavrsetka:**

| Stanje | RAM |
|--------|-----|
| Base game (loading + main + muzika) | ~27 MB |
| Bonus (+ bonus sprite) | ~48 MB |
| Posle unload bonusa | ~27 MB nazad |

### 5.3 Mono vs Stereo

| | Mono | Stereo |
|--|------|--------|
| Dekodirani RAM | X MB | 2X MB |
| Kvalitet na telefonu | Identican (mono zvucnik) | Identican |
| Kvalitet na slusalicama | Manje prostorno | Puno prostorno |
| Preporuka za mobile-first | **DA** | Desktop-only igre |

Za mobile-first slot igre: mono SFX na 64kbps AAC je nerazluciv od stereo na telefon zvucnicima. **50% usteda memorije.**

---

## 6. AAC/M4A encoder padding i gapless looping

### 6.1 Zasto AAC dodaje padding

AAC enkoder radi na blokovima od **1024 sampla** (AAC-LC frame). Problem: audio signal retko ima tacno N × 1024 sampla.

Resenje: enkoder dodaje **priming samples** na pocetak i **remainder samples** na kraj.

```
[Priming Samples] + [Actual Audio Samples] + [Remainder Samples]
│◄── 2112 ────►│                             │◄── 0-1023 ────►│
```

### 6.2 Priming samples po enkoderu

| Enkoder | Priming sampli | Vreme na 44100Hz |
|---------|---------------|-------------------|
| Apple AAC-LC / libfdk_aac | **2112** | ~47.8ms |
| Nero AAC-LC | **2624** | ~59.5ms |
| Nero HE-AAC | **2336** | ~52.9ms |
| FFmpeg native AAC | **1024** | ~23.2ms |
| FAAC | **1024** | ~23.2ms |

**SlotAudioManager koristi ffmpeg-static sa libfdk_aac (ako dostupan) ili native AAC enkoder.**

### 6.3 Remainder (end padding) proracun

```
Remainder = 1024 - ((Priming + ActualSamples) % 1024)
```

Ako je rezultat 1024, remainder je 0 (savrseno poravnanje). Inace: 1-1023 sampla tisine na kraju.

### 6.4 iTunSMPB atom — gapless metadata

Lokacija u MP4 kontejneru: `moov/udta/meta/ilst/----/iTunSMPB`

Format (hex string, 5 polja od po 8 hex cifara):
```
 00000000 00000840 000001CA 00000000003F31F6 00000000
 │field1│ │field2│ │field3│ │    field4     │ │field5│
   0       2112     458      4141558           0
```

| Polje | Znacenje |
|-------|----------|
| Field 1 | Rezervisano (uvek 0) |
| Field 2 | Priming samples (encoder delay) |
| Field 3 | Remainder samples (end padding) |
| Field 4 | Originalni sample count (tacni audio sampli) |
| Field 5 | Rezervisano (uvek 0) |

### 6.5 Zasto HTML5 Audio ima micro-gap pri loop-u

1. **Browser NE cita gapless metadata**: Vecina browsera ignorise `iTunSMPB` atom za `<audio>` element. Chrome delimicno podrzava za MSE, ali ne za obican `<audio>`.
2. **Encoder padding se reprodukuje**: Priming (~48ms) i remainder se cuju kao tisina
3. **Stop-start sekvenca**: Howler u HTML5 modu radi `stop().play()` — browser mora seek + buffer + play
4. **Nema sample-level preciznosti**: HTML5 Audio operise na ~10-100ms rezoluciji
5. **readyState tranzicija**: Browser mora preci iz `HAVE_CURRENT_DATA` u `HAVE_ENOUGH_DATA` pre svake reprodukcije

### 6.6 Zasto Web Audio API nema ovaj problem

1. **AudioBuffer je tacan PCM**: `decodeAudioData()` vraca dekodirane sample **BEZ encoder padding-a**. Browser uklanja priming/remainder tokom dekodiranja citajuci iTunSMPB ili ekvivalentne metadata.
2. **Sample-level loop tacke**: `bufferSource.loopStart` i `loopEnd` su float64 sekunde
3. **Nema re-bufferovanja**: AudioBuffer je vec u memoriji, nula latencije
4. **Nativni loop**: Implementiran u audio thread-u (C++), ne u JavaScript-u

### 6.7 Workaround-i za gapless HTML5 loop

**1. Position monitoring (generisani BGMStreamingInit.ts koristi ovu tehniku — deployStreaming.js generise kod sa `startLoopMonitor()` koji koristi rAF):**
```javascript
function tick() {
    const pos = snd._node.currentTime;
    const remaining = duration - pos;

    if (pos > 0.1 && remaining > 0 && remaining < 0.05) {
        // 50ms pre kraja: mute → seek na 0 → unmute
        const vol = snd._node.volume;
        snd._node.volume = 0;
        snd._node.currentTime = 0;
        requestAnimationFrame(() => { snd._node.volume = vol; });
    }

    requestAnimationFrame(tick);
}
```
Prati poziciju sa `requestAnimationFrame`, seek-uje na pocetak 50ms pre kraja. Mute/unmute sakrije seek artefakt.

**2. Double-buffer:**
```javascript
const a = new Audio('music.m4a');
const b = new Audio('music.m4a');

a.addEventListener('timeupdate', () => {
    if (a.duration - a.currentTime < 0.1) {
        b.currentTime = 0;
        b.play();
    }
});
// Slicno za b -> a
```
Dva Audio elementa se naizmenicno smenjuju. Zahteva 2 simultana elementa (problem na iOS-u).

**3. MSE (Media Source Extensions):**
```javascript
const ms = new MediaSource();
video.src = URL.createObjectURL(ms);
ms.addEventListener('sourceopen', () => {
    const sb = ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
    // appendWindowStart/End za precizno trimovanje padding-a
    sb.appendWindowStart = primerSamples / sampleRate;
    sb.appendWindowEnd = (primerSamples + actualSamples) / sampleRate;
});
```
Najvise precizno ali najkompleksnije. Zahteva parsiranje MP4 kontejnera.

---

## 7. Mobilna ogranicenja (iOS Safari, Android Chrome)

### 7.1 iOS Safari

| Ogranicenje | Detalj | Uticaj na slot igru |
|-------------|--------|---------------------|
| **AudioContext suspend** | Kreiran u `'suspended'`. Mora `resume()` na user gesture. | Mora se otkljucati na prvi tap/spin |
| **Max AudioContext instanci** | 4 po stranici | Howler koristi 1 — ne problem |
| **Max HTML5 Audio elemenata** | 2-4 simultana | Ogranicava broj muzickih traka u HTML5 modu |
| **Ringer na vibrate** | Web Audio NE radi ako je telefon na silent/vibrate | Igrac nece cuti zvuk — informisati UI-om |
| **Background tab** | AudioContext → `'interrupted'` | Igra se pauzira — mora resume na visibility change |
| **SampleRate bug** | Moze promeniti sampleRate (44100→48000) pri otvaranju/zatvaranju tabova | Howler detektuje i poziva `Howler.unload()` za reset |
| **Memorija** | ~128 MB Web Audio heap limit | KRITICNO — muzika mora biti HTML5 |
| **Autoplay** | Zabranjeno bez user gesture-a | Mora se cekati prvi tap |
| **`<audio>` preload** | `preload="auto"` ne radi na celularnoj mrezi | Eksplicitni `load()` na user gesture |

**iOS scratchbuffer workaround (Howler interno):**
```javascript
// Kreira 1-sample AudioBuffer na 22050Hz
var buffer = ctx.createBuffer(1, 1, 22050);
var source = ctx.createBufferSource();
source.buffer = buffer;
source.connect(ctx.destination);
source.start(0);  // "otkljucava" AudioContext na webkit
```

### 7.2 Android Chrome

| Ogranicenje | Detalj |
|-------------|--------|
| **Autoplay** | Ista politika kao desktop Chrome (od v71) |
| **User gesture** | `click`, `touchend` rade. `touchstart` od Chrome 55+. |
| **AudioContext resume** | `ctx.resume()` mora biti na stack-u user gesture-a |
| **Latencija** | 12.5ms do 150ms zavisno od uredjaja i Android verzije |
| **Memorija** | Zavisi od uredjaja, obicno 256-512MB za tab |

### 7.3 Howler-ov unlock mehanizam (detaljan)

```javascript
// 1. Registrovani listeneri:
document.addEventListener('touchstart', unlock, true);
document.addEventListener('touchend', unlock, true);
document.addEventListener('click', unlock, true);
document.addEventListener('keydown', unlock, true);

// 2. unlock() funkcija:
function unlock() {
    // a) Popuni HTML5 Audio pool
    while (Howler._html5AudioPool.length < Howler.html5PoolSize) {
        var audioNode = new Audio();
        audioNode._unlocked = true;
        Howler._html5AudioPool.push(audioNode);
    }

    // b) Otkljucaj sve postojece HTML5 Audio node-ove
    // (pozovi .load() na svakom)

    // c) Pozovi _autoResume() (fix za Android suspend)
    Howler._autoResume();

    // d) Kreiraj BufferSource sa scratch bufferom, connect, start(0)
    var source = ctx.createBufferSource();
    source.buffer = Howler._scratchBuffer;
    source.connect(ctx.destination);
    source.start(0);

    // e) Pozovi ctx.resume()
    ctx.resume().then(function() {
        source.onended = function() {
            source.disconnect(0);
            Howler._audioUnlocked = true;

            // Ukloni listenere
            document.removeEventListener('touchstart', unlock, true);
            document.removeEventListener('touchend', unlock, true);
            document.removeEventListener('click', unlock, true);
            document.removeEventListener('keydown', unlock, true);
        };
    });
}
```

### 7.4 Auto-suspend/resume

Howler automatski suspend-uje AudioContext posle 30 sekundi neaktivnosti:

```javascript
// _autoSuspend():
if (Howler.autoSuspend && ctx && Howler.state === 'running') {
    // Proveri da li bilo koji zvuk svira
    for (var i = 0; i < Howler._howls.length; i++) {
        if (Howler._howls[i]._webAudio) {
            for (var j = 0; j < Howler._howls[i]._sounds.length; j++) {
                if (!Howler._howls[i]._sounds[j]._paused) {
                    return;  // nesto svira, ne suspenduj
                }
            }
        }
    }
    // Nista ne svira — suspenduj za 30s
    Howler._suspendTimer = setTimeout(function() {
        ctx.suspend();
    }, 30000);
}

// _autoResume():
// Poziva se iz play() — ako je ctx.state === 'suspended', poziva ctx.resume()
```

---

## 8. playa-core SubLoader sistem

### 8.1 Pregled

playa-core je IGT-ov interni framework za slot igre. `SoundLoader` i `SoundPlayer` upravljaju svim audio resursima.

**SubLoader** je mehanizam za deferred/lazy ucitavanje audio fajlova POSLE inicijalnog boot-a igre.

### 8.2 loadType vrednosti

| loadType | Ime | Kad se ucitava | Trigger | Unloadable? |
|----------|-----|----------------|---------|-------------|
| `undefined` ili `"-"` | Main | Odmah na boot | Automatski | Ne |
| `"A"` | Deferred A | Na zahtev | `startSubLoader("A")` | Opciono |
| `"B"` | Deferred B | Na zahtev | `startSubLoader("B")` | Opciono |
| `"C"` — `"F"` | Deferred C-F | Na zahtev | `startSubLoader("X")` | Opciono |
| `"Z"` | Lazy | Just-in-time | Framework automatski | Ne |
| `"M"` | Music (streaming) | Nikad (direktan HTML5) | `BGMStreamingInit` | N/A |
| `"S"` | Streaming (legacy) | Nikad (direktan HTML5) | Custom kod | N/A |

### 8.3 SoundLoader — kljucne metode

```typescript
class SoundLoader {
    _spriteMap: {};              // sprite definicije [startTime, duration]
    _howlInstances: {};          // Howl instance po source reference
    _soundFiles: string[];       // fajlovi za main load
    _subLoaderSounds: {};        // zvuci grupisani po subLoaderID
    _manifestData: any;          // kompletni manifest podaci
    _concurrency: 5;             // max paralelnih download-a

    // Manifest processing:
    process(manifest) {
        for (const entry of manifest) {
            const srcRef = resolveUrl(entry.src);
            // srcRef = "assets/default/.../file.646a97.m4a" (webpack hash)

            if (loadType === "-" || loadType === undefined) {
                this._soundFiles.push(srcRef);           // main load
            } else {
                this._subLoaderSounds[loadType].push({   // deferred
                    srcRef: srcRef,
                    id: entry.id
                });
            }
        }
    }

    // Data passing to SoundPlayer:
    setPlayerData() {
        player.setRawUrls(this._parent.props.manifest.sounds);  // SVE URL-ove
        player.setHowls(this._howlInstances);                    // samo main Howl-ove
        player.setSounds(this._manifestData);                    // SVE definicije
    }

    // Audio download (za svaki fajl):
    _downloadAudio(srcRef) {
        // 1. fetch() sa streaming progress tracking
        // 2. Konvertuj blob u Data URL via FileReader
        // 3. Kreiraj Howl instancu:
        new Howl({
            src: soundDataURL,
            format: FILE_TYPES,
            preload: true,
            autoplay: true,      // odmah dekodira
            sprite: _spriteMap   // sprite definicije za taj fajl
        });
    }

    // SubLoader audio:
    getSubLoaderSoundList(subLoaderID) {
        return this._subLoaderSounds[subLoaderID];  // [{srcRef, id}, ...]
    }

    loadSubLoaderAudio(srcRef, id, loadedFunc) {
        // 1. Kreira Howl za deferred audio (iste opcije kao main)
        // 2. Na "load" event: player.addHowls(howl, srcRef, id)
        // 3. Poziva loadedFunc callback
    }
}
```

### 8.4 SubLoader klasa — deferred loading

```typescript
class SubLoader {
    _subLoaderID: string;       // "A"-"F" ili "Z"
    _soundLoader: SoundLoader;
    _soundList: any[];          // [{srcRef, id}, ...]

    startSubLoader() {
        // 1. Dobija listu zvukova: _soundLoader.getSubLoaderSoundList(_subLoaderID)
        // 2. Dodaje svaki zvuk u load queue
        // 3. Pokrece paralelno ucitavanje (do _concurrency)
    }
}
```

**Queue ponasanje:**
- **Samo JEDAN SubLoader se ucitava istovremeno** — FIFO redosled
- Ako `startSubLoader("A")` i `startSubLoader("B")` budu pozvani istovremeno, B ceka u redu dok A ne zavrsi
- Ovo je vazno za slot igre: scatter na prvom spinu moze triggerovati i A i B

### 8.5 SoundPlayer — reprodukcija i komande

```typescript
class SoundPlayer {
    _soundManifest: {id, src}[];           // manifest niz
    _soundSprites: Map<string, ISoundSprite>;  // spriteId → instanca
    _commands: Map<string, any[]>;         // commandId → niz koraka
    _tags: Map<string, {volume, muted, sprites}>;  // tag management
    _soundUrl: any;                        // raw URL-ovi iz manifesta
    _soundManifestData: any;               // kompletni manifest podaci
    _howlInstances: {};                    // Howl instance po URL-u

    // KEY: setSounds() — inicijalizacija svih definicija
    setSounds(manifestData) {
        Howler.autoUnlock = true;

        // 1. Procesira soundSprites: kreira SoundSprite za svaki
        for (const [id, def] of soundSprites) {
            const sprite = new SoundSprite(id, def.soundId, ..., howl, ...);
            this._soundSprites.set(id, sprite);
            // Dodaje u tagove
        }

        // 2. Procesira spriteList: kreira SoundSpriteList
        // Podrzava: random, sequential tipove + pan/loop nizove

        // 3. Procesira commands: cuva u _commands Map
    }

    // addHowl() — registruje novi Howl (koristi se za SubLoader i streaming)
    addHowl(howl, srcRef, spriteId) {
        if (this._howlInstances[srcRef] !== undefined) {  // GATE CHECK
            const soundDef = this._soundManifestData.soundDefinitions.soundSprites[spriteId];
            const sp = new SoundSprite(spriteId, soundDef.soundId, ..., howl, ...);
            this._soundSprites.set(spriteId, sp);
            // + registracija u _tags
        }
    }

    // execute() — glavna API metoda za igru
    execute(commandId) {
        // 1. clearTimersAndTweens(commandId) — ubija prethodne tajmere
        // 2. Dohvata komande iz _commands
        // 3. Za svaku: gsap.delayedCall() ili instant execution
        // 4. addTimer() za tracking
        // 5. Proverava document.visibilityState pre izvrsavanja
    }

    // Command switch:
    onDelayTimer(cmd) {
        switch (cmd.command.toLowerCase()) {
            case "play":     // set volume/pan/loop → sprite.play(cmd)
            case "stop":     // sprite.stop()
            case "pause":    // sprite.pause()
            case "resume":   // sprite.resume()
            case "fade":     // sprite.fade({volume, duration, ...})
            case "set":      // set volume/pan/loop/position/rate
            case "execute":  // rekurzivno: this.execute(cmd.commandId)
            case "resetspritelist":  // spriteList.resetIndex()
        }
    }

    // pauseAllSounds(isPause) — tab visibility handling
    pauseAllSounds(isPause) {
        // Cuva fade stanja tokom pauze
        // Pristupa internom Howler._sounds nizu
        // Individualno pauzira/play-uje po Sound ID-u
        // Obnavlja fade-ove na resume
    }

    // toggleTagSounds(mute, ...tags) — mute po tagu (npr. "Music", "SoundEffects")
    toggleTagSounds(isMuted, ...tags) {
        for (const tag of tags) {
            tag.muted = isMuted;
            for (const sprite of tag.sprites) {
                sprite.mute();  // ili Howler.mute za audiosprite
            }
        }
    }
}
```

### 8.6 SoundSprite — lifecycle stanja

```
IDLE → PLAYING → PAUSED → PLAYING → STOPPED → IDLE
                    ↓
                 FADING → PLAYING
```

Kljucna polja:
```typescript
{
    _id: string;            // "s_UiClick"
    _soundId: string;       // "loading_sprite"
    _howl: Howl | undefined; // Howl instanca (undefined za deferred pre ucitavanja)
    _isPlaying: boolean;
    _isPaused: boolean;
    _isMuted: boolean;
    _volume: number;
    _loop: number;          // -1 = infinite, 0 = no loop, N = N puta
    _tags: string[];        // ["SoundEffects", "UI"]
    _startTime: number;     // ms, pocetak u sprite fajlu
    _duration: number;      // ms, trajanje
    _overlap: boolean;      // true = dozvoli istovremenu reprodukciju
}
```

**KRITICNO**: Kad je `_howl = undefined` (pre SubLoader ucitavanja), `play()` poziv TIHО PROPADA — nema greske, nema zvuka. Ovo je "by design" — igra emituje komandu, zvuk ce se cuti tek kad SubLoader zavrsi.

---

## 9. Pool arhitektura za slot igre

### 9.1 Cetiri poola

```
T=0ms        LOADING ucitava  → sinhrono, pre prvog rendera
T=0ms        STANDALONE       → zasebni M4A, base game muzika
T+1s         MAIN ucitava     → background, startSubLoader("A") na prvom spinu
T+bonus      BONUS ucitava    → deferred, startSubLoader("B") kad bonus potvrdjen
```

### 9.2 Loading pool — minimum za prvi spin

**Priority 1. Nema loadType (ucitava se odmah).**

| Zvuci | Zasto ovde |
|-------|------------|
| `UiSpin`, `UiClick`, `UiOpen`, `UiClose` | UI feedback, svira na svakom kliku |
| `ReelLand1-5` | Svira na kraju svakog spina |
| `SpinsLoop`, `SpinningReels` | Reel animacija zvuk |
| `Payline`, `RollupLow`, `CoinLoop`, `CoinCounter` | Win animacija zvuci |
| `TotalWin`, `Bell` | Rezultat spina |
| `IntroAnim`, `GameIntro`, `Tutorial` | Pocetne animacije |

**Velicina**: ~200-700 KB M4A, ~5-15 MB dekodirano. Mora biti ucitano PRE prvog spina.

### 9.3 Main pool — base game SFX

**Priority 2. loadType "A", `startSubLoader("A")` na prvom spinu.**

| Zvuci | Zasto ovde |
|-------|------------|
| `SymbolS01-S15` | Symbol win zvuci |
| `SymbolW01`, `Wild*` | Wild eventi |
| `BigWin*`, `CoinShower*` | Big win animacija |
| `Anticipation*`, `PreCog` | Anticipation na reelovima |
| `Rollup1-3`, `RollupEnd` | Win counter zvuci |
| `ScreenShake` | Screen effect |
| `PreBonusLoop` | Svira PRE bonusa (jos uvek base game) |

**Velicina**: ~1-3 MB M4A, ~20-60 MB dekodirano. Ucitava se u pozadini tokom prvog spina. Mora biti gotovo pre nego sto igrac moze dobiti big win (~5 spinova).

### 9.4 Bonus pool — svi bonus modovi

**Priority 3. loadType "B", `startSubLoader("B")` kad bonus potvrdjen. unloadable: true.**

| Zvuci | Zasto ovde |
|-------|------------|
| `Bonus*`, `FreeSpin*`, `Picker*` | Svi bonus SFX zvuci |
| `HoldAnd*`, `Respin*` | Hold & Win mod |
| `BaseToBonusStart`, `BonusToBase*` | Tranzicije |
| `SymScatter*`, `Trigger*` | Scatter i trigger zvuci |
| `Jackpot*`, `Progressive*` | Jackpot zvuci |
| `FreeSpinMusic`, `PickerMusicLoop` | Bonus muzika (NE standalone!) |
| `VO*` | Voice-over narative |
| `Wheel*`, `Gem*`, `Pot*` | Game-specifcni bonus zvuci |

**Velicina**: ~1-3 MB M4A, ~20-60 MB dekodirano. Ucitava se tek kad je bonus potvrdjen (3+ scattera evaluirana).

**Trigger timing je KRITICAN:**
- Scatter landing na reel-u je **NE** trigger
- Trigger = kad spin rezultat bude evaluiran i igra potvrdi bonus entry
- Ovo se desava u `BonusTriggerCommand` ili ekvivalentu, POSLE reel evaluacije
- Bonus intro animacija (2-3 sekunde) kupuje vreme za SubLoader B da zavrsi

**Unload lifecycle:**
```javascript
// Kad bonus zavrsi i igrac se vrati u base game:
loaderService.soundLoader.unloadSubLoader("B");
// Oslobadja ~20-60 MB dekodirane memorije

// Kad sledeci bonus bude triggereovan:
slotProps.startSubLoader("B");
// Ponovo ucitava iz kesa ili sa mreze
```

### 9.5 Standalone pool — SAMO base game muzika

**Zasebni M4A fajlovi. Svaki zvuk = zaseban Howl sa `loop: true`.**

| Zvuci | Zasto standalone |
|-------|-------------------|
| `BaseGameMusicLoop1/2/3` | Loopuje satima — mora biti zaseban fajl za cist loop |
| `AmbBg` | Ambient pozadina — loopuje kontinuirano |

**Zasto ne u sprite:**
- Sprite je JEDAN fajl sa zalepljenim zvucima
- Muzika koja loopuje satima mora biti zasebna za gapless loop
- Web Audio `bufferSource.loop = true` sa `loopStart`/`loopEnd` radi na dekodiranom AudioBuffer-u (BEZ encoder padding-a — browser ga uklanja tokom `decodeAudioData()`), ali precizno podesavanje loop tacki u sprite-u zahteva apsolutno tacne vrednosti iz build pipeline-a
- U praksi: za DirectHTML5 streaming, muzicki fajlovi NE SMEJU biti u `soundManifest` nizu — `SoundLoader` bi ih dekodirao u Web Audio i pojeo RAM. Muzika se kontrolise iskljucivo kroz `BGMStreamingInit.ts`

**Zasto bonus muzika NE ide u standalone:**
- Bonus muzika loopuje 30s-3min (kratka sesija)
- Mikro-gap iz sprite loop-a je prihvatljiv za kratke sesije
- Stedi memoriju — ne ucitava se dok bonus ne pocne

### 9.6 Kljucna pravila za raspodelu

| Zvuk | Pool | Razlog |
|------|------|--------|
| `BaseToBonusStart` | **bonus** | Tranzicija je deo bonus konteksta |
| `BonusToBaseStart` | **bonus** | Tranzicija je deo bonus konteksta |
| `SymbolB01Land1-5` | **main** | Base game kontekst (scatter land) |
| `SymbolB01Anticipation` | **main** | Base game anticipation |
| `PreBonusLoop` | **main** | Svira pre ulaska u bonus, dok je igra jos u base |
| `SpinsLoop` | **loading** | Reel zvuk, potreban od prvog spina |
| `CoinLoop`, `CoinLoopEnd` | **loading** | Rollup zvuci, potrebni od prvog spina |
| `FreeSpinMusic` | **bonus** | NE standalone — ucitava se sa bonus poolom |
| `PickerMusicLoop` | **bonus** | NE standalone |
| `BaseGameMusicLoop1/2/3` | **standalone** | Jedine prave base game muzike |
| `AmbBg` | **standalone** | Ambient pozadina |

---

## 10. Sound loading — kompletni flow

### 10.1 Boot sekvenca (T=0ms)

```
1. SoundLoader.process(manifest)
   ├── Za svaki manifest entry:
   │   ├── Resolvuj URL: "soundFiles/loading.m4a" → "assets/.../loading.646a97.m4a"
   │   ├── Ako loadType === undefined ili "-":
   │   │   └── _soundFiles.push(resolvedUrl)  // main load
   │   └── Ako loadType === "A"/"B"/..."Z":
   │       └── _subLoaderSounds[loadType].push({srcRef, id})  // deferred
   │
2. SoundLoader.loadMainSounds()
   ├── Za svaki fajl u _soundFiles (do _concurrency=5 paralelno):
   │   ├── fetch(url) sa progress tracking
   │   ├── Blob → Data URL via FileReader
   │   ├── new Howl({ src: dataUrl, sprite: spriteMap, preload: true })
   │   ├── Howler: XHR → ArrayBuffer → ctx.decodeAudioData() → AudioBuffer
   │   └── cache[url] = audioBuffer
   │
3. SoundLoader.setPlayerData()
   ├── player.setRawUrls(allUrls)     // SVE URL-ove (ukljucujuci deferred)
   ├── player.setHowls(howlInstances) // samo main Howl-ove
   └── player.setSounds(manifestData) // SVE definicije (ukljucujuci deferred)
       ├── Kreira SoundSprite za SVAKI zvuk (i deferred)
       │   └── Deferred sprites imaju howl = undefined (tihi fail na play())
       ├── Kreira SoundSpriteList
       └── Cuva commands u Map
```

### 10.2 SubLoader ucitavanje (T+spin)

```
1. Game kod: slotProps.startSubLoader("A")
   │
2. SubLoader._startLoading()
   ├── soundList = soundLoader.getSubLoaderSoundList("A")
   ├── Za svaki {srcRef, id} u soundList:
   │   ├── soundLoader.loadSubLoaderAudio(srcRef, id, callback)
   │   │   ├── fetch(srcRef) → Blob → Data URL
   │   │   ├── new Howl({ src: dataUrl, sprite: spriteMap })
   │   │   ├── Na "load" event:
   │   │   │   ├── player.addHowls(howl, srcRef, id)
   │   │   │   │   ├── Gate check: _howlInstances[srcRef] !== undefined
   │   │   │   │   ├── Kreira novi SoundSprite sa PRAVIM Howl-om
   │   │   │   │   ├── Zamenjuje stari (howl=undefined) sprite u Map-i
   │   │   │   │   └── Registruje u tagove
   │   │   │   └── callback()  // signalizira zavrsetak
   │   │   └── Na "loaderror": error handling
   │
3. Kad svi zvuci ucitani: SubLoader emituje "complete"
   └── Sledeci SubLoader u redu (ako postoji) pocinje ucitavanje
```

### 10.3 Streaming muzike ucitavanje (T+boot)

```
1. BGMStreamingInit.ts importovan u main.ts
   │
2. waitForPlayer() — poll svakih 50ms dok player._soundSprites.size > 0
   │
3. Za svaku muzicku traku:
   ├── getResolvedUrl(player, trackName)
   │   ├── Trazi manifest entry po ID-u
   │   ├── Cita player._soundUrl[entry.src[0]]
   │   └── Vraca webpack-resolvovani URL
   │
   ├── registerHtml5(name, url, player)
   │   ├── new Howl({ src: [url], html5: true, preload: true, sprite: {...} })
   │   │   └── Browser pocinje streaming (~3MB buffer)
   │   │
   │   ├── howl.once("load", () => {
   │   │   ├── player._howlInstances[url] = howl  // registruj Howl
   │   │   │
   │   │   ├── // Ocisti stari sprite (kreiran u setSounds sa howl=undefined)
   │   │   ├── const stale = player._soundSprites.get(spriteId)
   │   │   ├── player._tags.forEach(td => {
   │   │   │   td.sprites = td.sprites.filter(s => s !== stale)
   │   │   ├── })
   │   │   │
   │   │   ├── player.addHowl(howl, url, spriteId)  // novi sprite sa HTML5 Howl-om
   │   │   │
   │   │   ├── syncTagState(player, spriteId)  // ako je Music tag muted
   │   │   │
   │   │   └── // Auto-play ako je komanda vec bila emitovana (tihi fail)
   │   │       if (sp && !sp._isPlaying) { sp.play(); }
   │   │   })
   │   │
   │   └── howl.on("play", () => startLoopMonitor(howl, spriteId))
   │       // rAF position monitoring za gapless loop
   │
4. setupVisibilityHandler(player)
   └── document.addEventListener("visibilitychange", ...)
       // Pause muziku kad tab hidden, resume kad visible
```

---

## 11. Sound unloading — kompletni flow

### 11.1 unloadSubLoader("B") — bonus audio oslobadjanje

```
1. Game kod: loaderService.soundLoader.unloadSubLoader("B")
   │
2. Za svaki zvuk sa loadType "B":
   │
   ├── Pronalazi Howl instancu iz _howlInstances
   │
   ├── howl.unload()  ← Howler.js unload sekvenca (Sekcija 3)
   │   ├── Stop svih Sound-ova
   │   ├── Diskonektuj AudioBufferSourceNode-ove
   │   ├── Obrisi iz Howler._howls
   │   ├── Obrisi AudioBuffer iz kesa (ako niko drugi ne koristi)
   │   └── _state = 'unloaded', _sounds = []
   │
   ├── delete _howlInstances[srcRef]  // ukloni referencu
   │
   └── // SoundSprite za te zvukove:
       // Opcija A: Obrisi iz _soundSprites Map
       // Opcija B: Postavi howl = undefined (tihi fail pattern)
       // playa-core trenutno NE radi ni A ni B — ovo je pending task
```

### 11.2 Predlozena unloadHowl() implementacija

```typescript
// SoundPlayer.ts — predlog iz AUDIO_POOLS.md
public unloadHowl(soundId: string): void {
    const srcRef = this._soundUrl[soundId];
    const howl = this._howlInstances[srcRef];
    if (!howl) return;

    howl.unload();                           // Howler oslobadja Web Audio buffer
    delete this._howlInstances[srcRef];      // cisti Howl referencu

    // Ocisti SoundSprite reference
    for (const [id, sprite] of this._soundSprites) {
        if ((sprite as any)._soundId === soundId) {
            this._soundSprites.delete(id);
        }
    }
}
```

**Status**: playa-core tim JOS NIJE implementirao ovo. `unloadable: true` u manifest-u je metadata signal — runtime unload nije aktivan.

### 11.3 Memorija posle unload-a

| Akcija | RAM pre | RAM posle | Oslobodjeno |
|--------|---------|-----------|-------------|
| `unloadSubLoader("B")` (bonus 60s stereo) | ~48 MB | ~27 MB | ~21 MB |
| `unloadSubLoader("A")` (main 45s stereo) | ~43 MB | ~27 MB | ~16 MB |
| Zatvori HTML5 muziku (2 trake) | ~33 MB | ~27 MB | ~6 MB |

### 11.4 Re-load posle unload-a

Kad se bonus ponovo triggeruje posle unload-a:

```
1. startSubLoader("B")
   │
2. SubLoader proverava: da li su zvuci vec ucitani?
   ├── Ako _howlInstances[srcRef] postoji → preskoci (vec ucitano)
   └── Ako ne postoji → ponovo ucitaj:
       ├── fetch() → mozda iz browser HTTP kesa (304 Not Modified)
       ├── decodeAudioData() → UVEK puno dekodiranje (AudioBuffer se ne kesira posle unload)
       └── ~1-3 sekunde za re-load (zavisi od velicine i uredjaja)
```

**KRITICNO**: Re-load zahteva puno dekodiranje (`decodeAudioData()`). Browser HTTP kes cuva kompresovane bajtove, ali AudioBuffer mora ponovo da se dekodira. Na sporim uredjajima to moze trajati 1-5 sekundi.

**Zato je timing vazan**: `startSubLoader("B")` treba pozvati sto ranije — na potvrdjen bonus, ne na ulazak u bonus scenu. Bonus intro animacija (2-3s) kupuje vreme.

---

## 12. HTML5 Streaming muzike — DirectHTML5 pattern

### 12.1 Problem

playa-core `SoundLoader` konvertuje SVAKI audio fajl u Web Audio buffer. Za muziku:

```
60s × 44100Hz × 2ch × 4B = 21.2 MB RAM (od 300KB M4A na disku)
7 muzickih traka = ~150 MB RAM → iOS Safari puca
```

### 12.2 Resenje — loadType "M"

Muzika se NIKAD ne ucitava kroz Web Audio. Manifest entry:
```json
{ "id": "BaseGameMusicLoop", "src": ["soundFiles/BaseGameMusicLoop.m4a"], "loadType": "M" }
```

playa-core procesira ovaj entry ali ga NE ucitava:
- URL se resolvuje u `_soundUrl`
- SoundSprite se kreira sa `howl = undefined`
- Komande (play, fade, stop) tiho propadaju

BGMStreamingInit.ts zatim:
1. Cita resolvovani URL iz `player._soundUrl`
2. Kreira `new Howl({ html5: true })` — browser strimuje, ~3 MB buffer
3. Registruje Howl u `player._howlInstances`
4. Zamenjuje stari sprite sa novim koji ima pravi Howl
5. Komande od tog momenta RADE normalno

### 12.3 Memorijski uticaj

| Pristup | 7 muzickih traka RAM | Ukupno sa SFX |
|---------|---------------------|----------------|
| Web Audio (sve) | ~150 MB | ~200 MB ☠️ |
| SubLoader + Swap | ~40 MB peak → ~20 MB | ~65 MB peak |
| **Direct HTML5** | **~6 MB** (2 aktivne) | **~27 MB** ✓ |

### 12.4 Zasto NE SubLoader + Swap

SubLoader + Swap je **teorijski alternativni pristup** koji je razmatran ali ODBACEN pre implementacije. Nikad nije bio u produkciji. Koncept: ucitaj muziku kroz Web Audio (SubLoader M), dekodiraj u RAM, zatim swap na HTML5 Howl.

Problemi koji su identifikovani:
1. **Peak RAM spike**: Web Audio (40MB) + HTML5 (3MB) istovremeno = 43MB pre swap-a
2. **Pucketanje**: Stop Web Audio → Start HTML5 = audio artefakti
3. **Missing komande**: BonusEnd/BigWinEnd komande mogu biti emitovane tokom swap-a
4. **Base muzika u bonusu**: Race condition — base muzika moze svirati u bonus modu
5. **30s queue wait**: SubLoader queue (FIFO) — ako A nije zavrsio, muzika ceka

### 12.5 Dva pristupa za implementaciju BGMStreamingInit.ts

**Pristup A — Automatska generacija (deployStreaming.js):**
- `deployStreaming.js` automatski generise `BGMStreamingInit.ts` iz sprite-config.json
- Fajl se kopira u game repo `src/ts/utils/` i patchuje `main.ts`
- Najpouzdaniji pristup — garantuje sinhronizaciju sa audio build-om
- `copyAudio.js` ima auto-import logiku (TRENUTNO DISEJBLANA — linija 117 komentarisana)

**Pristup B — Rucna integracija (Jumanji model):**
- Developer dobija gotov `BGMStreaming.ts` modul sa hardkodiranim putanjama
- Copy-paste u `src/ts/utils/`, rucni import u `main.ts`
- Jednostavniji za jednu igru, ali zahteva rucno odrzavanje

**VAZNO**: Muzicki fajlovi se NE SMEJU pojaviti u `soundManifest` nizu ako koristite rucnu integraciju. Ako se pojave, `SoundLoader` ce ih dekodirati kroz Web Audio API i pojesti RAM. Muzika se kontrolise iskljucivo kroz `BGMStreamingInit.ts`, ne kroz sounds.json command sistem.

---

## 13. Pseudo-streaming BGM — Dual-Pool Crossfade

> **NAPOMENA**: Ovo je DRUKCIJI sistem od DirectHTML5 (Sekcija 12).
> - **DirectHTML5** = jedan muzicki fajl, HTML5 Audio loop, za jednostavne igre
> - **Pseudo-streaming** = vise segmenata sa crossfade-om, za premium iskustvo bez ponavljanja
> Oba sistema koriste HTML5 Audio (ne Web Audio) za reprodukciju muzike.

### 13.1 Koncept

Umesto jedne muzicke trake koja se loopuje satima, koristi se 4-8 segmenata od 30 sekundi koji se nasumicno smenjuju sa crossfade-om.

Rezultat: 3-5 minuta unikatnog sadrzaja. Isti segment se ponavlja ~svakih 3+ minuta u nepredvidivom redosledu.

### 13.2 Zasto dva poola

Verifikovano iz `SoundPlayer.ts` source koda:
1. `_timers` je `Map<string, gsap.core.Tween[]>` sa kljucem po **sprite ID-u**
2. `clearTimersAndTweens(commandId)` resolvuje SVE sprite ID-ove iz komande rekurzivno
3. Ako fade-out i play tweens dele isti pool (isti sprite ID kljuc), brisanje jednog unistava OBA

**Resenje**: Dva zasebna sprite list-a (`sl_BGM_A` i `sl_BGM_B`) sa zasebnim tajmer kljucevima.

### 13.3 Struktura

```
bgm.m4a (jedan Howl, jedan sprite fajl)
├── [0ms - 30000ms]        BGM_SegA1
├── [30050ms - 60050ms]    BGM_SegA2  (50ms spriteGap)
├── [60100ms - 90100ms]    BGM_SegA3
├── [90150ms - 120150ms]   BGM_SegB1
├── [120200ms - 150200ms]  BGM_SegB2
└── [150250ms - 180250ms]  BGM_SegB3

sl_BGM_A → [s_BGM_SegA1, s_BGM_SegA2, s_BGM_SegA3]  (random)
sl_BGM_B → [s_BGM_SegB1, s_BGM_SegB2, s_BGM_SegB3]  (random)
```

### 13.4 Master komanda — timing

```json
"StartBGM": [
    // ─── Pool A ───
    {"spriteListId": "sl_BGM_A", "command": "play",  "delay": 0,     "volume": 0.01},
    {"spriteListId": "sl_BGM_A", "command": "fade",  "delay": 50,    "volume": 0.7, "duration": 3000},
    {"spriteListId": "sl_BGM_A", "command": "fade",  "delay": 27000, "volume": 0,   "duration": 3000},

    // ─── Pool B ───
    {"spriteListId": "sl_BGM_B", "command": "play",  "delay": 27000, "volume": 0.01},
    {"spriteListId": "sl_BGM_B", "command": "fade",  "delay": 27050, "volume": 0.7, "duration": 3000},
    {"spriteListId": "sl_BGM_B", "command": "fade",  "delay": 54000, "volume": 0,   "duration": 3000},

    // Pattern se ponavlja za 4 sata (~1600 unosa)
]
```

**Timing per ciklus (27s):**
```
T+0ms:      play Pool X (vol 0.01)
T+50ms:     fade Pool X → 0.7 over 3s
             → Fade pocinje na T+50ms, ali PERCEPCIJSKI cujan tek oko T+1000-1500ms
               (ljudsko uho ne registruje volume ispod ~0.2-0.3)
             → Puna jacina na T+3050ms

T+27000ms:  fade Pool X → 0 over 3s
             → Pocinje fading, tisina na T+30000ms
             → Segment zavrsava prirodno (trajanje = 30s)

T+27000ms:  play Pool Y (vol 0.01)  ← SIMULTANO sa fade-out
T+27050ms:  fade Pool Y → 0.7 over 3s
             → Crossfade window: T+27000 do T+30000 (3 sekunde)
```

**Zasto `volume: 0.01` a ne 0:** Mobile Safari moze ne pokrenuti audio na volume 0.

### 13.5 Memorijski budzet

```
6 segmenata × 30s × 44100Hz × 1ch (mono) × 4B = ~31.8 MB dekodirano
6 segmenata × 30s × 44100Hz × 2ch (stereo) × 4B = ~63.5 MB dekodirano
```

| Varijanta | M4A na disku | RAM (mono) | RAM (stereo) |
|-----------|-------------|------------|--------------|
| Minimalna (4×20s) | ~620 KB | ~14 MB | ~28 MB |
| Standardna (6×30s) | ~1.4 MB | ~32 MB | ~64 MB |
| Premium (8×30s) | ~1.9 MB | ~42 MB | ~84 MB |

---

## 14. howlUtil.ts — Utility za pristup Howl instancama

```typescript
import { Howler, Howl } from 'howler';

const spriteCache = new Map<string, Howl>();

function findHowl(sprite: string): Howl | null {
    const cached = spriteCache.get(sprite);
    if (cached) return cached;

    const howls: Howl[] = (Howler as any)._howls || [];
    for (const howl of howls) {
        const sprites: Record<string, unknown> = (howl as any)._sprite;
        if (sprites && sprite in sprites) {
            // Kesiraj SVE sprite-ove za ovaj howl
            for (const key of Object.keys(sprites)) {
                spriteCache.set(key, howl);
            }
            return howl;
        }
    }
    console.warn(`[howlUtil] No howl contains sprite: ${sprite}`);
    return null;
}

export const howlUtil = {
    // Ucitaj Howl koji sadrzi dati sprite
    load(name: string, onReady?: () => void): void {
        const howl = findHowl(name);
        if (!howl) return;

        if ((howl as any)._state === 'loaded') {
            onReady?.();
            return;
        }

        if (onReady) howl.once('load', onReady);
        if ((howl as any)._state === 'unloaded') howl.load();
    },

    // Zaustavi i unload-uj Howl
    unload(name: string): void {
        const howl = findHowl(name);
        if (!howl) return;
        if ((howl as any)._state === 'loaded') {
            howl.stop();
            howl.unload();
        }
    },

    // Proveri da li je Howl ucitan
    isLoaded(name: string): boolean {
        const howl = findHowl(name);
        return howl ? (howl as any)._state === 'loaded' : false;
    },
};
```

**Kljucne stvari:**
- Pristupa `Howler._howls[]` globalnom nizu — pronadje Howl koji sadrzi trazeni sprite
- Kesira sprite→Howl mapiranja za performanse
- Proverava `_state` polje (`'loaded'`, `'unloaded'`, `'loading'`)
- `unload()` UVEK poziva `stop()` pre `unload()` — bezbedniji pattern

---

## 15. Memory management best practices

### 15.1 Zlatna pravila

1. **UVEK pozovi `unload()` pre nego sto dereferenciras Howl:**
   ```javascript
   // POGRESNO — memory leak:
   myHowl = null;  // Howl ostaje u Howler._howls, AudioBuffer u cache-u

   // ISPRAVNO:
   myHowl.unload();
   myHowl = null;
   ```

2. **HTML5 mod za SVU muziku:**
   ```javascript
   // Muzika koja traje > 10 sekundi:
   new Howl({ src: ['music.m4a'], html5: true, loop: true });
   // ~3 MB umesto ~21-42 MB po traci
   ```

3. **Pool velicina — optimizacija:**
   ```javascript
   // Zvuk koji se retko pusta (big win fanfare):
   new Howl({ src: ['bigwin.m4a'], pool: 1 });

   // Zvuk sa mnogo simultanih instanci (coin counter):
   new Howl({ src: ['coins.m4a'], pool: 10 });
   ```

4. **Jedan AudioContext za ceo lifetime:**
   - Koristiti `Howler.ctx` — deljeni kontekst za sve
   - Safari max: 4 AudioContext-a po stranici
   - NIKAD ne zatvaraj osim u `Howler.unload()` (koji odmah kreira novi)

5. **Deferred loading za nepotrebne zvukove:**
   ```javascript
   // NE ucitavaj bonus audio na boot:
   var bonusSfx = new Howl({ src: ['bonus.m4a'], preload: false });

   // Ucitaj tek kad treba:
   function onBonusConfirmed() {
       bonusSfx.load();
       bonusSfx.once('load', () => bonusSfx.play('bonusIntro'));
   }
   ```

6. **Unload kad vise ne treba:**
   ```javascript
   function onBonusEnd() {
       bonusSfx.unload();
       bonusSfx = null;
       // Sledeci bonus: kreiraj novi Howl
   }
   ```

### 15.2 Izbegavanje memory leak-ova

| Leak izvor | Resenje |
|------------|---------|
| Howl bez `unload()` | Uvek pozovi `unload()` pre `null` |
| Event listeneri na Howl-u | `.off()` pre `unload()` ako si koristio `.on()` |
| Closure-ovi u event handler-ima | Koristi `.once()` umesto `.on()` gde je moguce |
| Kontinualno kreiranje novih Howl-ova | Ponovna upotreba istog Howl-a (`stop() → play()`) |
| Chrome Web Audio buffer leak | Poznati bug — `html5: true` za muziku je workaround |
| `Howler._howls` rast u SPA | Periodican audit: `console.log(Howler._howls.length)` |

### 15.3 _drain() mehanizam

Howler automatski cisti viskove u Sound pool-u:
```javascript
// Kad _sounds.length > _pool:
for (var i = self._sounds.length - 1; i >= 0; i--) {
    if (sounds[i]._ended) {
        if (self._webAudio && sounds[i]._node) {
            sounds[i]._node.disconnect(0);  // diskonektuj GainNode
        }
        sounds.splice(i, 1);  // ukloni iz niza
        cnt++;
    }
    if (cnt >= limit) break;
}
```

---

## 16. Debugging u produkciji

### 16.1 Web Console komande

```javascript
// ─── Howler stanje ───

// Broj Howl instanci
Howler._howls.length

// AudioContext stanje
Howler.ctx.state  // 'running', 'suspended', 'closed'

// Da li je audio otkljucan
Howler._audioUnlocked

// Globalni volume i mute
Howler._volume
Howler._muted

// ─── Howl instance ───

// Ispisi sve Howl instance sa stanjem
Howler._howls.forEach((h, i) => {
    console.log(i, {
        state: h._state,
        html5: h._html5,
        src: String(h._src).slice(0, 80),
        duration: h._duration,
        sounds: h._sounds.length,
        sprites: Object.keys(h._sprite).length
    });
});

// ─── HTML5 vs Web Audio ───

// Proveri koje su HTML5 a koje Web Audio
Howler._howls.forEach((h, i) => {
    console.log(i, h._html5 ? 'HTML5 ✓' : 'WebAudio', String(h._src).slice(0, 80));
});

// ─── playa-core specifcno ───

// Proveri _soundUrl za muziku
const p = soundManager.player;
p._soundManifestData.soundManifest
    .filter(m => m.loadType === 'M')
    .forEach(m => console.log(m.id, '→', p._soundUrl[m.src[0]]));

// Proveri SoundSprite stanje
p._soundSprites.forEach((sp, id) => {
    if (sp._tags?.includes('Music')) {
        console.log(id, {
            playing: sp._isPlaying,
            html5: sp._howl?._html5,
            volume: sp._volume,
            loop: sp._loop,
            muted: sp._isMuted,
            howlExists: !!sp._howl
        });
    }
});

// ─── Memorija ───

// Estimiraj Web Audio memoriju
let totalBytes = 0;
Howler._howls.forEach(h => {
    if (!h._html5 && h._duration) {
        const channels = 2;  // pretpostavka stereo
        totalBytes += h._duration * 44100 * channels * 4;
    }
});
console.log('Estimated Web Audio RAM:', (totalBytes / 1024 / 1024).toFixed(1) + ' MB');

// Estimiraj HTML5 memoriju (~3MB po aktivnoj traci)
let html5Count = 0;
Howler._howls.forEach(h => { if (h._html5) html5Count++; });
console.log('HTML5 tracks:', html5Count, '~' + (html5Count * 3) + ' MB');
```

### 16.2 Chrome DevTools — Memory tab

1. **Heap Snapshot**: `Memory` tab → `Take heap snapshot`
   - Filtriraj po "AudioBuffer" — prikazuje sve aktivne buffer-e
   - Filtriraj po "Howl" — prikazuje sve Howl instance
   - `Retained size` pokazuje koliko memorije drzi objekat

2. **Performance Monitor**: `Performance` tab → `⚙` → `JS heap size`
   - Prati u realnom vremenu koliko memorije koristi tab
   - Skok posle `decodeAudioData()` = novi AudioBuffer
   - Pad posle `unload()` = uspesno oslobadjanje (ako Chrome GC radi)

3. **Timeline recording**: `Performance` tab → Record → reprodukuj zvuk → Stop
   - `Audio` kategorija prikazuje audio processing vreme
   - Dugacki audio task-ovi mogu blokirati main thread

---

## 17. Poznati bagovi i workaround-i

### 17.1 Chrome Web Audio memory leak

**Problem**: Dekodirani AudioBuffer-i ostaju u memoriji cak i nakon `unload()` i `delete cache[url]`. Ovo je bag u Chrome-ovom Web Audio GC-u.

**GitHub issues**: howler.js #914, #1731

**MemLab izvestaj**: ~147 detached audio instanci ostaje, retained size raste sa svakim novim Howl-om.

**Workaround-i:**
1. Ponovna upotreba Howl instance umesto kreiranja novog (retained size ostaje konstantan)
2. `html5: true` za sve sto nije kriticno za latenciju
3. Minimizirati broj Howl kreiranja/unload-ovanja tokom sesije
4. Periodican `Howler.unload()` (nuklearna opcija — resetuje SVE, ukljucujuci AudioContext)

### 17.2 iOS Safari sampleRate bug

**Problem**: Otvaranje/zatvaranje tabova moze promeniti `AudioContext.sampleRate` sa 44100 na 48000 ili obrnuto. Ovo kvari sve prethodno dekodirane AudioBuffer-e.

**Howler resenje**: Detektuje promenu sampleRate i poziva `Howler.unload()` za kompletni reset.

### 17.3 iOS Safari ringer na vibrate

**Problem**: Kad je iPhone na vibrate/silent modu, Web Audio ne proizvodi zvuk. HTML5 Audio takodje ne radi u silent modu (od iOS 15+).

**Nema workaround-a** — ovo je OS-level restrikcija. Jedino resenje: informisati igraca u UI-u.

### 17.4 HTML5 Audio pool exhaustion

**Problem**: Kad Howler potroši svih 10 Audio elemenata u pool-u, novi HTML5 zvuci mogu biti blokirani.

**Workaround-i:**
1. Povecaj pool: `Howler.html5PoolSize = 20;` (pre kreiranja prvog Howl-a)
2. Minimiziraj broj simultanih HTML5 zvukova (max 2-3 muzicke trake)
3. `unload()` muzicke Howl-ove kad nisu potrebni — vraca Audio element u pool

### 17.5 Firefox AudioContext limit

**Problem**: Firefox dozvoljava max 6 AudioContext-a po tabu. Kreiranje vise od 6 baca grešku.

**Howler resenje**: Koristi JEDNU AudioContext instancu (`Howler.ctx`).

### 17.6 Safari `interrupted` state

**Problem**: iOS Safari postavlja AudioContext u `'interrupted'` stanje pri telefonskom pozivu, timer alarmu, ili zatvaranju laptopa. Ovo stanje nije dostupno u specifikaciji — Safari-specifcno.

**Howler resenje**: `_autoResume()` proverava `ctx.state === 'interrupted'` i poziva `ctx.resume()`.

### 17.7 decodeAudioData() crash za 24-bit/32-bit WAV

**Problem**: Electron-ov `decodeAudioData()` crashuje renderer proces za 24-bit i 32-bit integer PCM WAV fajlove.

**SlotAudioManager resenje**: Custom pure-JS WAV decoder (`decodeWav()` u SoundsPage.jsx) koji skenira RIFF chunk-ove i rucno konvertuje sample. Nikad ne poziva `decodeAudioData()` za preview.

### 17.8 Howl event listener leak

**Problem**: `unload()` NE cisti `_onend`, `_onplay` i druge event listener nizove. Ako eksterni kod drzi referencu na Howl objekat, closure-ovi ostaju u memoriji.

**Workaround:**
```javascript
// Pre unload-a, eksplicitno ocisti:
howl.off();        // ukloni SVE listenere
howl.unload();
howl = null;
```

---

## Appendix A: Kompletni sounds.json manifest format

```json
{
    "soundManifest": [
        { "id": "loading_sprite", "src": ["soundFiles/loading.m4a"] },
        { "id": "main_sprite",   "src": ["soundFiles/main.m4a"],   "loadType": "A" },
        { "id": "bonus_sprite",  "src": ["soundFiles/bonus.m4a"],  "loadType": "B", "unloadable": true },
        { "id": "BaseGameMusicLoop", "src": ["soundFiles/BaseGameMusicLoop.m4a"], "loadType": "M" }
    ],
    "soundDefinitions": {
        "soundSprites": {
            "s_UiClick": {
                "soundId": "loading_sprite",
                "spriteId": "s_UiClick",
                "startTime": 0,
                "duration": 250,
                "tags": ["SoundEffects", "UI"],
                "overlap": true
            }
        },
        "commands": {
            "UiClick": [
                { "command": "play", "spriteId": "s_UiClick", "volume": 0.8, "delay": 0 }
            ],
            "StartBGM": [
                { "command": "play", "spriteId": "s_BaseGameMusicLoop", "volume": 0.7, "loop": -1, "delay": 0 }
            ]
        },
        "spriteList": {
            "sl_Symbols": {
                "items": ["s_SymS01", "s_SymS02", "s_SymS03"],
                "type": "random",
                "overlap": false
            }
        }
    }
}
```

## Appendix B: Proracun memorije — kalkulator

```
┌─────────────────────────────────────────────────────┐
│  Web Audio AudioBuffer RAM Kalkulator               │
│                                                     │
│  Trajanje (s) × SampleRate × Kanali × 4 = Bajtovi  │
│                                                     │
│  Primeri:                                           │
│  1s  × 44100 × 2 × 4 =    352,800 B =   0.34 MB   │
│  10s × 44100 × 2 × 4 =  3,528,000 B =   3.37 MB   │
│  30s × 44100 × 2 × 4 = 10,584,000 B =  10.10 MB   │
│  60s × 44100 × 2 × 4 = 21,168,000 B =  20.19 MB   │
│  90s × 44100 × 2 × 4 = 31,752,000 B =  30.28 MB   │
│                                                     │
│  Kompresija faktor (M4A 64kbps):                    │
│  ~44x (1 MB M4A ≈ 44 MB AudioBuffer)               │
│                                                     │
│  iOS Safari limit: ~128 MB Web Audio heap           │
│  Preporuka za slot: <60 MB Web Audio total          │
└─────────────────────────────────────────────────────┘
```

## Appendix C: Referentni fajlovi u projektu

| Tema | Fajl |
|------|------|
| Pool arhitektura | `AUDIO_POOLS.md` |
| Streaming implementacija | `STREAMING-ARCHITECTURE.md` |
| Projekat master doc | `CLAUDE.md` |
| playa-core deep dive | `docs/playa-core-sound-system.md` |
| BGM pseudo-streaming | `docs/pseudo-streaming-bgm-system.md` |
| Jumanji referentna impl. | `docs/jumanji-streaming-deliverable.md` |
| Howl utility | `howlUtil.ts` |
| Build manifest generator | `template/scripts/buildTieredJSON.js` |
| Sprite builder | `template/scripts/buildTiered.js` |
| Deploy pipeline | `template/scripts/deployStreaming.js` |
| BGM modul generator | `template/scripts/generateBGMModule.js` |
| Sprite config UI | `src/pages/SpriteConfigPage.jsx` |
| Build/Deploy UI | `src/pages/BuildPage.jsx` |

---

## 18. SoundSprite state machine — kompletna pravila

### 18.1 Tri stanja

```
STOPPED   (_isPlaying: false, _isPaused: false)  ── inicijalno
PLAYING   (_isPlaying: true,  _isPaused: false)
PAUSED    (_isPlaying: false, _isPaused: true)
```

### 18.2 Play matrica — 8 scenarija

Ponasanje `play()` zavisi od tri boolean-a: `_isPlaying`, `_isPaused`, `_overlap`:

| isPlaying | isPaused | overlap | Akcija |
|-----------|----------|---------|--------|
| `false` | `false` | `false` | Play nova instanca |
| `false` | `false` | `true` | Play nova instanca |
| `false` | `true` | `false` | Resume (nastavlja pauzirani zvuk) |
| `false` | `true` | `true` | Resume SVE instance |
| `true` | `false` | `false` | **NE RADI NISTA** (vec svira, nema overlap-a) |
| `true` | `false` | `true` | Play nova instanca (overlap dozvoljen) |
| `true` | `true` | `false` | **NE RADI NISTA** |
| `true` | `true` | `true` | Play SVE instance |

**KRITICNO**: Bez overlap-a, `play()` na sprite koji vec svira je NO-OP. Ovo je "by design" — sprecava duplu reprodukciju istog zvuka (npr. dva UiClick-a istovremeno).

### 18.3 Loop ponasanje

Loop counter se cuva u `_howlerIds: Map<number, {loopCount}>`:

```
Na svaki "end" event od Howler-a:
├── if (loop === 0)  → stop() — nema ponavljanja
├── if (loop > 0)    → decrement loopCount, play ponovo
└── if (loop === -1) → play ponovo (beskonacno)
```

- `loop: -1` = beskonacan loop (muzika)
- `loop: 0` = pusti jednom (SFX)
- `loop: 5` = pusti 6 puta ukupno (5 ponavljanja + original)

### 18.4 Play implementacija (detaljan)

```typescript
play(cmd?) {
    if (!this._howl) return;  // TIHI FAIL — deferred zvuk jos nije ucitan

    // Volume: cmd.volume ili tag volume (multiplicative)
    const vol = cmd?.volume ?? this._volume;
    const tagVol = getTagVolume(this._tags);
    const finalVol = vol * tagVol;

    // Mute check: ako je bilo koji tag muted → mute sprite
    if (getTagMute(this._tags)) {
        this._isMuted = true;
    }

    // cancelDelay: ako true I vec svira → stop prvo pa play
    if (cmd?.cancelDelay && this._isPlaying) {
        this.stop();
    }

    // sync: kopiraj poziciju sa drugog sprite-a
    if (cmd?.sync) {
        const syncSprite = this._soundSprites.get(cmd.sync);
        // Kopiraj currentTime
    }

    const id = this._howl.play(this._id);  // Howler kreira novi Sound
    this._howlerIds.set(id, { loopCount: this._loop });
    this._isPlaying = true;
    this._isPaused = false;

    // Registruj "end" event za loop management
    this._howl.on('end', () => this._onEnd(id), id);
}
```

### 18.5 Stop implementacija

```typescript
stop(howlerId?) {
    if (howlerId) {
        this._howl.stop(howlerId);      // Zaustavi specifican Sound
        this._howlerIds.delete(howlerId);
    } else {
        // Zaustavi SVE Sound-ove za ovaj sprite
        for (const [id] of this._howlerIds) {
            this._howl.stop(id);
        }
        this._howlerIds.clear();
    }
    this._isPlaying = false;
    this._isPaused = false;
}
```

### 18.6 Pause/Resume

```typescript
pause() {
    if (this._isPlaying) {
        for (const [id] of this._howlerIds) {
            this._howl.pause(id);
        }
        this._isPlaying = false;
        this._isPaused = true;
    }
}

resume() {
    if (!this._isPlaying && this._isPaused) {
        for (const [id] of this._howlerIds) {
            this._howl.play(id);  // Howler.play(existingId) = resume
        }
        this._isPlaying = true;
        this._isPaused = false;
    }
}
```

---

## 19. Error handling i recovery obrasci

### 19.1 loaderror event

```javascript
// SoundLoader registruje na svaki Howl:
howl.on('loaderror', (id, err) => {
    console.error('Audio load failed:', srcRef, err);
    // NE baca exception — nastavlja sa ucitavanjem ostalih fajlova
});
```

**Specijalan slucaj**: `"Decoding audio data failed"` greska je **namerno preskocena** (ne tretira se kao fatalna). Ovo se desava za korumpovane fajlove ili nepoznate codec-e.

### 19.2 playerror event

```javascript
// Howler emituje kad play() propadne:
howl.on('playerror', (id, err) => {
    // Najcesci uzrok: AudioContext jos nije otkljucan (autoplay politika)
    // Howler automatski retry-uje: cuva u _queue, pusta kad se AudioContext resume-uje
});
```

### 19.3 Tihi fail pattern (undefined Howl)

Kad je `SoundSprite._howl = undefined` (deferred zvuk pre ucitavanja):

```typescript
play() {
    if (!this._howl) return;  // TIHO PROPADNE — nema greske, nema zvuka
}
```

**Ovo je "by design"** — igra emituje komandu, ali zvuk nece svirati dok SubLoader ne zavrsi. Korisnik nece primetiti jer je bonus intro animacija (2-3s) u toku.

### 19.4 Rekurzija limit

```typescript
// SoundPlayer.getSpriteIds():
getSpriteIds(cmd, count = 0) {
    if (count > 10) {
        throw new Error('Recursive command depth exceeded');
    }
    // Rekurzivno ekstrahuje sve sprite ID-ove iz nested komandi
}
```

Sprecava beskonacan loop ako komanda A poziva B koja poziva A.

### 19.5 Duplikat detekcija u manifestu

```typescript
// SoundLoader.process():
if (this._processedIds.has(entry.id)) {
    console.warn('Duplicate manifest entry:', entry.id);
    // Nastavlja — poslednji entry prepisuje prethodni
}
```

### 19.6 Streaming greska — segment recovery

Ako BGM segment propadne pri ucitavanju:
1. `loaderror` event se emituje
2. SoundLoader loguje gresku ali nastavlja ucitavanje ostalih
3. Sprite definicija postoji u sounds.json ali nema Howl instancu
4. Kad spriteList pokusa da ga pusti: `play()` tiho propadne (undefined howl)
5. Segment se preskace — sledeci play fires 27 sekundi kasnije
6. Drugi pool nastavlja normalno — crossfade sistem je otporan

---

## 20. gsap timer integracija sa SoundPlayer

### 20.1 Kako funkcionise

playa-core koristi **gsap (GreenSock Animation Platform)** za sve zvucne tajmere. Svaka komanda sa `delay > 0` se zakazuje kroz `gsap.delayedCall()`.

### 20.2 Timer storage

```typescript
_timers: Map<string, gsap.core.Tween[]>
// Kljuc = sprite ID (NE command ID!)
// Vrednost = niz gsap Tween objekata
```

**KRITICNO**: Kljuc je **sprite ID**, ne command ID. Ovo znaci da svi tajmeri za isti sprite dele isti kljuc.

### 20.3 Lifecycle

```
1. execute(commandId)
   │
   ├── clearTimersAndTweens(commandId)
   │   ├── getSpriteIds(cmd) ← REKURZIVNO za nested komande
   │   │   ├── cmd.spriteId → direktno dodaj
   │   │   ├── cmd.spriteListId → dodaj sve sprite-ove iz liste
   │   │   └── cmd.commandId → rekurzija u sub-komandu
   │   │
   │   └── Za svaki spriteId:
   │       └── _timers.get(spriteId).forEach(tween => tween.kill())
   │       └── _timers.delete(spriteId)
   │
   ├── Za svaku komandu:
   │   ├── Ako delay === 0: odmah izvrsi onDelayTimer(cmd)
   │   └── Ako delay > 0:
   │       ├── const tween = gsap.delayedCall(delay/1000, onDelayTimer, [cmd])
   │       └── addTimer(spriteId, tween)
   │
   └── visibilityState check: ako tab hidden → preskoci play komande
```

### 20.4 Zasto dva poola za pseudo-streaming

Iz source koda `SoundPlayer.ts`:

```typescript
// clearTimersAndTweens() poziva getSpriteIds() koji REKURZIVNO
// ekstrahuje SVE sprite ID-ove iz komande.
//
// Ako koristis JEDAN pool (sl_BGM):
//   - fade-out tween za sl_BGM je pod kljucem "s_BGM_Seg1"
//   - play tween za sl_BGM je takodje pod "s_BGM_Seg2"
//   - clearTimersAndTweens ubija SVE pod "sl_BGM" → ubija i fade i play
//
// Sa DVA poola:
//   - sl_BGM_A tweens pod "s_BGM_SegA1" kljucem
//   - sl_BGM_B tweens pod "s_BGM_SegB1" kljucem
//   - Brisanje A tweens NE dira B tweens
```

### 20.5 visibilityState check

```typescript
// Pre izvrsavanja play/resume komande:
if (document.visibilityState !== 'visible') {
    return;  // Ne pustaj zvuk u background tab-u
}
```

Ovo sprecava reprodukciju zvukova u pozadinskim tabovima koji bi trosili CPU/memoriju.

### 20.6 Tab visibility catch-up problem

Kad tab postane ponovo vidljiv posle duge pauze:
1. `pauseAllSounds(false)` → Howler resume
2. gsap koristi `requestAnimationFrame` interno → potpuno pauziran u background-u
3. Kad tab postane aktivan: gsap "hvata" zaostale pozive — svi zakazani delayed call-ovi od pauze fire SIMULTANO

**Posledice po trajanje pauze:**
```
<10s:     Besprekorno — mali catch-up
10-60s:   Kratka fluktuacija volume-a
1-5min:   Audio artefakt < 3s
5+ min:   1-2s tisine, pa normalan nastavak
```

**Mitigation (jedna linija koda u igri):**
```javascript
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isBGMActive) {
        soundManager.execute("StartBGM");  // Restart chain cisto
    }
});
```

---

## 21. Fade implementacija — Web Audio vs HTML5

### 21.1 Web Audio fade (Howler interno)

```javascript
// Howler koristi Web Audio AudioParam automaciju:
var vol = parseFloat(sound._volume);
var from = vol;
var to = parseFloat(args[0]);  // target volume

// Nativna Audio API metoda — glatka, sub-ms preciznost:
sound._node.gain.linearRampToValueAtTime(
    Math.max(0, Math.min(to, 1)),  // clamp 0-1
    Howler.ctx.currentTime + (len / 1000)
);

// Howler takodje pokrece setInterval za pracenje progresa:
var diff = to - from;
var steps = Math.abs(diff / 0.01);
var stepLen = Math.max(4, (steps > 0) ? len / steps : len);
var lastTick = Date.now();

(function tick() {
    // Proverava koliko vremena je proslo
    var elapsed = Date.now() - lastTick;
    // Kalkulise trenutnu poziciju u fade-u
    var currentVol = from + (diff * (elapsed / len));
    // Postavlja volume za event tracking
    sound._volume = currentVol;

    // Kad zavrsi:
    if (elapsed >= len) {
        sound._volume = to;
        self._emit('fade', sound._id);
        // Ako fade zavrsava na 0 i pauseOnFade je true: pause()
    }
})();
```

**Kljucno**: PRAVI fade radi `linearRampToValueAtTime()` (audio thread), a `setInterval` samo PRATI progres za event emisiju i volume update.

### 21.2 HTML5 Audio fade (Howler interno)

```javascript
// HTML5 Audio NEMA AudioParam — koristi setInterval:
var interval = setInterval(function() {
    var elapsed = Date.now() - lastTick;
    var progress = elapsed / len;

    // Direktno setuje volume na Audio elementu:
    sound._node.volume = Math.max(0, Math.min(1, from + (diff * progress)));

    if (elapsed >= len) {
        clearInterval(interval);
        sound._node.volume = to;
        self._emit('fade', sound._id);
    }
}, stepLen);  // stepLen = ~4ms minimum
```

**Razlike od Web Audio fade-a:**
- Zavisi od JavaScript main thread (moze laggovati ako je thread zauzet)
- `setInterval` preciznost je ~4-16ms (zavisi od browser-a i tab aktivnosti)
- Volume skokovi su vidljivi (step-wise) umesto glatkih (linear ramp)
- Background tab: `setInterval` se throttle-uje na ~1000ms → fade baguje

### 21.3 playa-core fade (SoundSprite)

```typescript
fade(fadeProps: {volume?, rate?, pan?, duration}) {
    if (!this._howl) return;

    // Ekstrakcija parametara
    const { volume, rate, pan, duration } = fadeProps;

    // Pronalazi Sound instancu unutar Howler-a
    for (const [howlerId] of this._howlerIds) {
        // Sacuvaj fade informacije za pause/resume
        this._tempFadingSprites.set(howlerId, {
            fromVol: this._volume,
            toVol: volume,
            duration: duration
        });

        // Howler fade
        this._howl.fade(this._volume, volume, duration, howlerId);
    }

    this._volume = volume;  // Postavi ciljni volume odmah
}
```

**Pause tokom fade-a:**
Kad se igra pauzira dok fade traje, `_tempFadingSprites` cuva:
- `fromVol` — pocetni volume pre fade-a
- `toVol` — ciljni volume
- `duration` — trajanje fade-a

Na resume, fade se **NE nastavlja od gde je stao**. Umesto toga, volume se postavlja na **ciljnu vrednost odmah** (instant skok). Ovo je "good enough" pristup — korisnik nece primetiti jer je pauza bila izmedju.

---

## 22. Codec detekcija i format fallback

### 22.1 Howler codec detekcija

```javascript
// Howler.codecs(ext) — proverava browser podrsku:
var audioTest = new Audio();

_codecs: {
    mp3:  !!audioTest.canPlayType('audio/mpeg;').replace(/^no$/, ''),
    mpeg: !!audioTest.canPlayType('audio/mpeg;').replace(/^no$/, ''),
    opus: !!audioTest.canPlayType('audio/ogg; codecs="opus"').replace(/^no$/, ''),
    ogg:  !!audioTest.canPlayType('audio/ogg; codecs="vorbis"').replace(/^no$/, ''),
    oga:  !!audioTest.canPlayType('audio/ogg; codecs="vorbis"').replace(/^no$/, ''),
    wav:  !!audioTest.canPlayType('audio/wav; codecs="1"').replace(/^no$/, ''),
    aac:  !!audioTest.canPlayType('audio/aac;').replace(/^no$/, ''),
    caf:  !!audioTest.canPlayType('audio/x-caf;').replace(/^no$/, ''),
    m4a:  !!(audioTest.canPlayType('audio/x-m4a;') ||
             audioTest.canPlayType('audio/m4a;') ||
             audioTest.canPlayType('audio/aac;')).replace(/^no$/, ''),
    m4b:  !!(audioTest.canPlayType('audio/x-m4b;') ||
             audioTest.canPlayType('audio/m4b;') ||
             audioTest.canPlayType('audio/aac;')).replace(/^no$/, ''),
    mp4:  !!(audioTest.canPlayType('audio/x-mp4;') ||
             audioTest.canPlayType('audio/mp4;') ||
             audioTest.canPlayType('audio/aac;')).replace(/^no$/, ''),
    weba: !!audioTest.canPlayType('audio/webm; codecs="vorbis"').replace(/^no$/, ''),
    webm: !!audioTest.canPlayType('audio/webm; codecs="vorbis"').replace(/^no$/, ''),
    dolby: !!audioTest.canPlayType('audio/mp4; codecs="ec-3"').replace(/^no$/, ''),
    flac: !!(audioTest.canPlayType('audio/x-flac;') ||
             audioTest.canPlayType('audio/flac;')).replace(/^no$/, '')
}
```

**Format selekcija u Howl.load():**
```javascript
// Iterira kroz src niz, bira PRVI kompatibilan format:
for (var i = 0; i < self._src.length; i++) {
    var ext = /^data:audio\/([^;,]+);/.test(self._src[i])
        ? RegExp.$1 : /\.([^.]+)$/.exec(self._src[i])[1];

    if (Howler.codecs(ext)) {
        url = self._src[i];
        break;
    }
}
```

### 22.2 playa-core browser-specific logika

```typescript
// SoundLoader.process() — koristi Bowser za detekciju:
import Bowser from 'bowser';

const browser = Bowser.parse(navigator.userAgent);

if (browser.browser.name === 'Firefox' && browser.os.name !== 'iOS') {
    this._soundFormat = SoundFormat.OGG;    // Firefox non-iOS: FORCE OGG
} else {
    this._soundFormat = SoundFormat.AAC;    // Chrome, Safari, Edge, Firefox iOS: AAC
}
```

**Zasto:**
- Firefox non-iOS ne podrzava AAC nativno (treba media codec iz OS-a)
- Firefox na iOS-u koristi WebKit engine (Apple zahtev) → ima AAC podrsku
- Chrome, Safari, Edge: svi podrzavaju AAC nativno

### 22.3 sounds.json dual-format manifest

Legacy sounds.json (pre tiered build-a):
```json
{
    "id": "BaseGameMusicLoop",
    "src": [
        "soundFiles/BaseGameMusicLoop.ogg",
        "soundFiles/BaseGameMusicLoop.aac"
    ]
}
```

playa-core bira `.ogg` na Firefox-u, `.aac` na svemu ostalom. **Oba formata moraju postojati na disku.**

Tiered build (novi format):
```json
{
    "id": "game_loading",
    "src": ["soundFiles/game_loading.m4a"]
}
```

Samo `.m4a` — playa-core framework vec podrzava M4A svuda. OGG fallback nije potreban za tiered spriteove.

### 22.4 Network speed detekcija

```typescript
// SoundLoader: prati brzinu download-a
private networkSpeed(): number {
    // bytes / milliseconds → Mbps
    return (this._totalBytesLoaded / this._totalLoadTime) * 8 / 1000;
}

// LoadProgress event se emituje kad brzina >= 4.1 Mbps
if (this.networkSpeed() >= 4.1) {
    this.emit('LoadProgress', progress);
}
```

Ovo se koristi za progress bar u igri — prikazuje se tek kad je dovoljno brza mreza.

---

## 23. Rate/Pitch shifting ponasanje

### 23.1 Web Audio rate

```javascript
source.playbackRate.value = 2.0;  // 2x brze + 1 oktavu vise
source.playbackRate.value = 0.5;  // 2x sporije + 1 oktavu nize
```

**KRITICNO**: Web Audio `playbackRate` menja i BRZINU i PITCH istovremeno. Nema odvojene kontrole.

- Rate 2.0 = dvostruka brzina + duplo visi pitch
- Rate 0.5 = upola brzine + duplo nizi pitch
- Rate 1.0 = normalno

**Detune** (u centima, 100 centi = 1 poluton):
```javascript
source.detune.value = 100;   // 1 poluton vise (pri istoj brzini)
source.detune.value = -1200; // 1 oktavu nize
```
Detune menja pitch BEZ promene brzine, ali Howler ga NE eksponira (playa-core ga ne koristi).

### 23.2 playa-core rate

```typescript
// SoundSprite:
_rate: number = 1;  // default

// Postavljanje:
set rate(val: number) { this._rate = val; }
get rate(): number { return this._rate; }

// Komanda "set" moze promeniti rate:
case "set":
    if (cmd.rate !== undefined) sprite.rate = cmd.rate;

// Fade moze takodje menjati rate tokom tranzicije:
case "fade":
    fadeProps.rate = cmd.rate;  // opciono
    sprite.fade(fadeProps);
```

### 23.3 Prakticna upotreba u slot igrama

Rate se retko koristi u slot igrama, ali postoje slucajevi:
- **Reel spin ubrzanje**: SpinsLoop se moze ubrzati sa rate 1.0 → 1.5 tokom power spin-a
- **Win celebration**: BigWinLoop rate 1.0 → 0.8 za "dramatic slowdown" efekat
- **Countdown**: Timer zvuk rate 1.0 → 1.5 → 2.0 kako se vreme istice

---

## 24. SHA256 cache mehanizam (buildTiered.js)

### 24.1 Cache fajl

Lokacija: `.build-cache.json` u root-u audio repo-a.

```json
{
    "UiClick": "abc123f4e7d9abcd",
    "ReelLand1": "def456789012abcd",
    "_spriteConfigHash": "hash_od_sprite_config_json",
    "_encoderName": "libfdk_aac (Fraunhofer)",
    "_ffmpegHash": "1234567_1680000000"
}
```

### 24.2 Hash kljucevi

| Kljuc | Sadrzaj | Promena = rebuild? |
|-------|---------|-------------------|
| `soundName` | Prvih 16 karaktera SHA256 hash-a WAV fajla | Da, za taj tier |
| `_spriteConfigHash` | SHA256 od `sprite-config.json` | Da, KOMPLETNI rebuild |
| `_encoderName` | `"libfdk_aac (Fraunhofer)"` ili `"aac (native)"` | Da, KOMPLETNI rebuild |
| `_ffmpegHash` | `"${fileSize}_${mtimeMs}"` FFmpeg binarnog fajla | Da, KOMPLETNI rebuild |

### 24.3 Rebuild triggeri (prioritet)

```
1. sprite-config.json promenjen     → FORCE full rebuild (svi tierovi)
2. Enkoder promenjen                → FORCE full rebuild
3. FFmpeg binarni promenjen         → FORCE full rebuild
4. Output M4A ne postoji na disku   → rebuild taj tier
5. Music split M4A ne postoji       → rebuild taj tier (ako ima Music tag zvukove)
6. Bilo koji zvuk u tier-u promenjen → rebuild CEO tier
7. Nista promenjeno                 → PRESKOCI tier (inkrementalni build)
```

### 24.4 Tier-level caching

```javascript
// Za svaki tier:
const tierSounds = groupedSounds[tierName];  // niz WAV fajlova
const hashes = tierSounds.map(s => cache[s.name] || '');
const tierCacheKey = hashes.join('|');

// Proveri da li se nesto promenilo:
const currentHashes = tierSounds.map(s => sha256(s.path).slice(0, 16));
const newCacheKey = currentHashes.join('|');

if (tierCacheKey === newCacheKey && outputExists) {
    console.log(`  ✓ ${tierName} — unchanged, skipping`);
    continue;  // PRESKOCI tier
}
```

**KRITICNO**: Ako BILO KOJI zvuk u tier-u promeni hash, CEO tier se rebuild-uje. Ne postoji parcijalni rebuild unutar tier-a.

### 24.5 Failed build — hash ne cuva

```javascript
try {
    await buildTier(tierName, sounds);
    // Sacuvaj NOVE hash-eve samo nakon USPESNOG build-a
    sounds.forEach(s => { cache[s.name] = sha256(s.path).slice(0, 16); });
} catch (err) {
    console.error(`  ✗ ${tierName} build failed`);
    // NE cuvamo hash-eve — sledeci build ce PONOVO pokusati
}
```

Ovo garantuje da propadni build UVEK forsira ponovni pokusaj.

---

## 25. validateBuild.js — QA validacija

Pet koraka validacije posle build-a:

### Check 1: FILE SIZE CHECK

```javascript
// Za svaki manifest entry:
const m4aPath = path.join(distDir, entry.src[0]);

if (!fs.existsSync(m4aPath)) {
    errors++;
    console.log(`  ✗ MISSING: ${entry.src[0]}`);
    continue;
}

const stats = fs.statSync(m4aPath);
const sizeKB = stats.size / 1024;

// Tier matching: endsWith('_' + tierName) — NE includes()!
// Ovo sprecava false match: "game_main" NE matcha na "game_loading_main"
const tierConfig = Object.entries(spriteConfig.sprites)
    .find(([name]) => entry.id.endsWith('_' + name));

const maxKB = tierConfig ? tierConfig[1].maxSizeKB : 1500;  // default 1500KB

if (sizeKB > maxKB) {
    warnings++;
    console.log(`  ⚠️ OVER LIMIT: ${entry.src[0]} — ${sizeKB.toFixed(0)}KB > ${maxKB}KB`);
    // WARNING ONLY — ne causa exit code 1
}
```

### Check 2: COMMAND REFERENCE CHECK

```javascript
for (const [cmdName, steps] of Object.entries(commands)) {
    for (const step of steps) {
        // Proveri spriteId
        if (step.spriteId && !soundSprites[step.spriteId]) {
            errors++;
            console.log(`  ✗ Command "${cmdName}" → spriteId "${step.spriteId}" NOT FOUND`);
        }
        // Proveri spriteListId
        if (step.spriteListId && !spriteList[step.spriteListId]) {
            errors++;
            console.log(`  ✗ Command "${cmdName}" → spriteListId "${step.spriteListId}" NOT FOUND`);
        }
        // Dodaj u referencedSprites set za orphan check
        if (step.spriteId) referencedSprites.add(step.spriteId);
    }
}
```

### Check 3: SPRITE LIST CHECK

```javascript
for (const [listName, list] of Object.entries(spriteList)) {
    const items = Array.isArray(list) ? list : list.items;  // oba formata
    for (const spriteId of items) {
        if (!soundSprites[spriteId]) {
            errors++;
            console.log(`  ✗ SpriteList "${listName}" → "${spriteId}" NOT FOUND`);
        }
    }
}
```

### Check 4: MANIFEST REFERENCE CHECK

```javascript
for (const [spriteId, spriteDef] of Object.entries(soundSprites)) {
    const manifestEntry = soundManifest.find(m => m.id === spriteDef.soundId);
    if (!manifestEntry) {
        errors++;
        console.log(`  ✗ Sprite "${spriteId}" → soundId "${spriteDef.soundId}" NOT IN MANIFEST`);
    }
}
```

### Check 5: ORPHAN CHECK

```javascript
for (const spriteId of Object.keys(soundSprites)) {
    if (!referencedSprites.has(spriteId)) {
        // Takodje proveri spriteList reference
        let foundInList = false;
        for (const list of Object.values(spriteList)) {
            const items = Array.isArray(list) ? list : list.items;
            if (items.includes(spriteId)) { foundInList = true; break; }
        }
        if (!foundInList) {
            warnings++;
            console.log(`  ⚠️ ORPHAN: "${spriteId}" — not referenced by any command or spriteList`);
        }
    }
}
```

### Exit kod

```javascript
if (errors > 0) {
    process.exit(1);   // FATALNO — build je broken
} else {
    process.exit(0);   // OK (warnings su prihvatljive)
}
```

---

## 26. copyAudio.js — Deploy flow i webpack hashing

### 26.1 Dva deploy ciljna direktorijuma

```
ASSETS (za webpack build):
  dist/sounds.json        → {gameRepo}/assets/default/default/default/sounds/sounds.json
  dist/soundFiles/*.m4a   → {gameRepo}/assets/default/default/default/sounds/soundFiles/

LOCAL (za dev server, opciono):
  dist/soundFiles/*.m4a   → {gameRepo}/dist/assets/default/default/default/sounds/soundFiles/
```

### 26.2 Ciscenje pre kopiranja

```javascript
// Obrisi SVE postojece .json I .json5 pre kopiranja
// VAZNO: ne koristi "else if" — oba formata moraju biti obrisana
const jsonPath = path.join(targetSoundsDir, 'sounds.json');
const json5Path = path.join(targetSoundsDir, 'sounds.json5');

if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
if (fs.existsSync(json5Path)) fs.unlinkSync(json5Path);  // NE else if!
```

### 26.3 Webpack hash interakcija

Game repo koristi webpack koji heshira audio fajlove na build-u:
```
Nas output:     game_loading.m4a
Webpack output: game_loading.abc123.m4a
```

**Hash map building:**
```javascript
// Skeniraj postojece hashed fajlove:
const hashRegex = /^(.+)\.([a-f0-9]{6,})(\.[^.]+)$/;
const hashedMap = {};  // baseName → [hashedName1, hashedName2, ...]

for (const file of fs.readdirSync(targetSoundFilesDir)) {
    const match = hashRegex.exec(file);
    if (match) {
        const baseName = match[1] + match[3];  // "game_loading.m4a"
        if (!hashedMap[baseName]) hashedMap[baseName] = [];
        hashedMap[baseName].push(file);
    }
}
```

**Kopiranje sa hash override:**
```javascript
for (const srcFile of newFiles) {
    // 1. Kopiraj bez hash-a
    fs.copyFileSync(srcFile, path.join(targetDir, path.basename(srcFile)));

    // 2. Kopiraj PREKO svakog starog hashed fajla
    const baseName = path.basename(srcFile);
    if (hashedMap[baseName]) {
        for (const hashedName of hashedMap[baseName]) {
            fs.copyFileSync(srcFile, path.join(targetDir, hashedName));
        }
    }
}
```

**Stale cleanup:**
```javascript
// Obrisi stare hashed fajlove koji nemaju odgovarajuci novi fajl
for (const [baseName, hashedNames] of Object.entries(hashedMap)) {
    if (!newFileSet.has(baseName)) {
        for (const old of hashedNames) {
            fs.unlinkSync(path.join(targetDir, old));
        }
    }
}
```

---

## 27. Audio encoding — FFmpeg flagovi i bitrate

### 27.1 Per-category encoding config

Iz `sprite-config.json`:
```json
{
    "encoding": {
        "sfx":   { "bitrate": 64, "channels": 2, "samplerate": 44100 },
        "vo":    { "bitrate": 64, "channels": 2, "samplerate": 44100 },
        "music": { "bitrate": 64, "channels": 2, "samplerate": 44100 }
    }
}
```

Svaka kategorija (sfx, vo, music) moze imati razlicite encoding postavke. buildTiered.js detektuje Music-tagged zvukove i primenjuje `encoding.music` na njih, `encoding.sfx` na ostale.

### 27.2 Enkoder detekcija

```javascript
// buildTiered.js — detekcija dostupnog AAC enkodera:
try {
    const output = execSync(`"${ffmpegPath}" -encoders 2>&1`).toString();
    if (output.includes('libfdk_aac')) {
        encoderName = 'libfdk_aac (Fraunhofer)';
        // Bolji kvalitet na niskim bitrate-ovima (64kbps)
    }
} catch (e) {
    encoderName = 'aac (native)';
    // FFmpeg built-in — OK ali nesto nizi kvalitet na 64kbps
}
```

### 27.3 FFmpeg komandna linija

```bash
# Tipicna audiosprite komanda (interno, iz customAudioSprite.js):
ffmpeg -i input.wav -y -ac 2 -ar 44100 -b:a 64k -f mp4 -strict -2 output.m4a

# Sa FDK enkoderom:
ffmpeg -i input.wav -y -ac 2 -ar 44100 -c:a libfdk_aac -b:a 64k output.m4a
```

| Flag | Znacenje |
|------|----------|
| `-y` | Prepiši output bez pitanja |
| `-ac 2` | 2 kanala (stereo) |
| `-ar 44100` | Sample rate 44100 Hz |
| `-b:a 64k` | Audio bitrate 64 kbps |
| `-f mp4` | Output format MP4 kontejner |
| `-strict -2` | Dozvoli eksperimentalne codec-e (native AAC) |
| `-c:a libfdk_aac` | Koristi FDK AAC enkoder |

### 27.4 Music vs SFX split u build-u

Kad tier ima i SFX i Music-tagged zvukove, buildTiered.js pravi DVA sprite fajla:

```
game_main.m4a         ← SFX encoding (sfx bitrate/channels)
game_main_music.m4a   ← Music encoding (music bitrate/channels)
```

Oba se referenciraju u sounds.json kao zasebni manifest entryji.

### 27.5 Standalone i streaming encoding

- **Standalone**: Svaki zvuk = zaseban M4A. Koristi `encoding.music` postavke. `spriteGap: 0` (nema gap-a jer je jedan zvuk).
- **Streaming**: Isti princip kao standalone. `loadType: "M"` ili `"S"` u manifest-u.

---

## 28. Tag sistem — volume/mute internali

### 28.1 Tag struktura

```typescript
_tags: Map<string, {
    volume: number;    // 0.0 - 1.0, default 1.0
    muted: boolean;    // default false
    sprites: ISoundSprite[];  // svi sprite-ovi sa ovim tag-om
}>
```

### 28.2 Volume — MULTIPLIKATIVAN

```typescript
getTagVolume(tags: string[]): number {
    let result = 1.0;
    for (const tagName of tags) {
        const tag = this._tags.get(tagName);
        if (tag) result *= tag.volume;
    }
    return result;
}
```

**Primer**: Sprite sa tagovima `["SoundEffects", "Bonus"]`:
- SoundEffects volume = 0.8
- Bonus volume = 0.6
- Rezultat = 0.8 × 0.6 = **0.48**

**KRITICNO**: Volume je MULTIPLIKATIVAN, ne ADITIVAN. Dva tag-a sa volume 0.5 daju 0.25, ne 1.0.

### 28.3 Mute — ANY tag mutes

```typescript
getTagMute(tags: string[]): boolean {
    for (const tagName of tags) {
        const tag = this._tags.get(tagName);
        if (tag?.muted) return true;  // BILO KOJI muted tag = sprite muted
    }
    return false;
}
```

**Primer**: Sprite sa tagovima `["SoundEffects", "UI"]`:
- Ako je "UI" tag muted, sprite je muted — cak i ako "SoundEffects" NIJE muted.

### 28.4 toggleTagSounds()

```typescript
toggleTagSounds(isMuted: boolean, ...tags: string[]) {
    for (const tagName of tags) {
        const tag = this._tags.get(tagName);
        if (!tag) continue;

        tag.muted = isMuted;

        for (const sprite of tag.sprites) {
            // Detekcija: da li je ovo audiosprite (multi-sprite Howl)?
            if (isAudioSprite(sprite)) {
                // Audiosprite: mute/unmute specifican sound ID unutar Howl-a
                Howler.mute(isMuted, soundId);
            } else {
                // Standalone: mute/unmute ceo Howl
                sprite.mute();
            }
        }
    }
}
```

### 28.5 Tipicni tagovi u slot igrama

| Tag | Namena | Kontrola |
|-----|--------|----------|
| `SoundEffects` | Svi SFX zvuci | Master SFX volume slider |
| `Music` | Sva muzika | Master Music volume slider |
| `UI` | UI klikovi | Opcioni toggle |
| `Bonus` | Bonus zvuci | Automatski mute na bonus exit |
| `VO` | Voice-over | Opcioni toggle |

---

## 29. Command execution — svih 8 tipova komandi

### 29.1 "play"

```typescript
case "play":
    // 1. Postavi parametre
    if (cmd.volume !== undefined) sprite.volume = cmd.volume;
    if (cmd.pan !== undefined)    sprite.pan = cmd.pan;
    if (cmd.loop !== undefined)   sprite.loop = cmd.loop;
    if (cmd.position !== undefined) sprite.position = cmd.position;
    if (cmd.rate !== undefined)   sprite.rate = cmd.rate;

    // 2. cancelDelay: ako true I vec svira → stop pa play
    if (cmd.cancelDelay && sprite.isPlaying) {
        sprite.stop();
    }

    // 3. sync: kopiraj poziciju od drugog sprite-a
    if (cmd.sync) {
        const syncSprite = this._soundSprites.get(cmd.sync);
        if (syncSprite) sprite.position = syncSprite.position;
    }

    // 4. Play
    sprite.play(cmd);
```

### 29.2 "stop"

```typescript
case "stop":
    sprite.stop();  // Zaustavi sve Sound instance
```

### 29.3 "pause"

```typescript
case "pause":
    sprite.pause();
```

### 29.4 "resume"

```typescript
case "resume":
    sprite.resume();
```

### 29.5 "fade"

```typescript
case "fade":
    const fadeProps = {
        volume: cmd.volume,
        rate: cmd.rate,
        pan: cmd.pan,
        duration: cmd.duration || cmd.fadeDuration
    };

    // Sacuvaj fade info za pause/resume
    this._tempFadingSprites.set(spriteId, fadeProps);

    sprite.fade(fadeProps);
```

### 29.6 "set"

```typescript
case "set":
    // Postavi parametre BEZ play-a
    if (cmd.volume !== undefined) sprite.volume = cmd.volume;
    if (cmd.pan !== undefined)    sprite.pan = cmd.pan;
    if (cmd.loop !== undefined)   sprite.loop = cmd.loop;
    if (cmd.position !== undefined) sprite.position = cmd.position;
    if (cmd.rate !== undefined)   sprite.rate = cmd.rate;

    // Tag-based set:
    if (cmd.tag) {
        const tag = this._tags.get(cmd.tag);
        if (tag && cmd.volume !== undefined) {
            tag.volume = cmd.volume;
            // Azuriraj volume na svim sprite-ovima sa tim tag-om
        }
    }
```

### 29.7 "execute"

```typescript
case "execute":
    // Rekurzivno izvrsi drugu komandu
    this.execute(cmd.commandId);
    // OPREZ: getSpriteIds() ima limit od 10 nivoa rekurzije
```

### 29.8 "resetspritelist"

```typescript
case "resetspritelist":
    // VAZNO: SoundSpriteList se cuva u ISTOJ _soundSprites Map-i kao i SoundSprite
    // (oba implementiraju ISoundSprite interfejs). NE postoji zasebna _soundSpriteLists mapa.
    const spriteList = this._soundSprites.get(cmd.spriteListId);
    if (spriteList && spriteList instanceof SoundSpriteList) {
        spriteList.resetIndex();  // Resetuje _currentIndex na 0
    }
```

---

## 30. SoundSpriteList — random selekcija bez ponavljanja

### 30.1 Interno stanje

```typescript
class SoundSpriteList {
    _sprites: ISoundSprite[];     // svi sprite-ovi u listi
    _soundIndices: number[];      // dostupni indeksi za sledeci izbor
    _lastSelected: number;        // poslednji izabrani indeks
    _currentIndex: number;        // pozicija u sequential modu
    _type: 'random' | 'sequential';
    _overlap: boolean;
}
```

### 30.2 Random bez neposrednog ponavljanja

```typescript
getRandomIndex(): number {
    // 1. Ako je lista prazna — regenerisi
    if (this._soundIndices.length === 0) {
        this.createIndexedList();
    }

    // 2. Izaberi nasumicno
    const randomPos = Math.floor(Math.random() * this._soundIndices.length);
    const selectedIndex = this._soundIndices[randomPos];

    // 3. Ukloni iz dostupnih
    this._soundIndices.splice(randomPos, 1);

    // 4. Sacuvaj za anti-repeat
    this._lastSelected = selectedIndex;

    return selectedIndex;
}

createIndexedList(): void {
    this._soundIndices = [];
    for (let i = 0; i < this._sprites.length; i++) {
        // ISKLJUCI poslednji izabrani — spreci neposredno ponavljanje
        if (i !== this._lastSelected) {
            this._soundIndices.push(i);
        }
    }
}
```

**Rezultat**: Ako lista ima [A, B, C, D] i poslednji je bio C:
- Nova lista = [0(A), 1(B), 3(D)] — C je iskljucen
- Izaberi nasumicno iz tri opcije
- Kad se lista isprazni, regenerisi BEZ poslednjeg izabranog
- **Garantija**: isti zvuk se NIKAD ne pusta dva puta uzastopno

### 30.3 Sequential mod

```typescript
getNextSpriteDef(): ISoundSprite {
    if (this._type === 'random') {
        return this._sprites[this.getRandomIndex()];
    }

    // Sequential: inkrement + wrap-around
    const sprite = this._sprites[this._currentIndex];
    this._currentIndex = (this._currentIndex + 1) % this._sprites.length;
    return sprite;
}
```

### 30.4 Overlap pravila za SpriteList

```json
// sounds.json:
"sl_Symbols": {
    "items": ["s_SymS01", "s_SymS02", "s_SymS03"],
    "type": "random",
    "overlap": false
}
```

Kad je `overlap: false`:
- Ako je sprite iz liste vec PLAYING → `play()` je NO-OP
- Sprecava duplu reprodukciju istog zvuka iz iste liste
- Svaki `play()` poziv bira SLEDECI sprite iz liste (ne ponavlja isti)

---

## 31. Legacy vs Tiered manifest format

### 31.1 Legacy format (pre SlotAudioManager-a)

Svaki zvuk je zaseban M4A fajl. Nema sprite-ova. Nema SubLoader-a.

```json
{
    "soundManifest": [
        { "id": "BaseGameMusicLoop", "src": ["soundFiles/BaseGameMusicLoop.ogg", "soundFiles/BaseGameMusicLoop.aac"] },
        { "id": "Bell",              "src": ["soundFiles/Bell.ogg", "soundFiles/Bell.aac"] },
        { "id": "BigWinIntro",       "src": ["soundFiles/BigWinIntro.ogg", "soundFiles/BigWinIntro.aac"] },
        { "id": "BonusGameMusicLoop1", "src": ["soundFiles/BonusGameMusicLoop1.ogg", "soundFiles/BonusGameMusicLoop1.aac"] }
    ],
    "soundDefinitions": {
        "soundSprites": {
            "s_Bell": {
                "soundId": "Bell",
                "spriteId": "s_Bell",
                "startTime": 0,
                "duration": 1500,
                "tags": ["SoundEffects"],
                "overlap": false
            }
        }
    }
}
```

**Problemi:**
- **60+ HTTP zahteva** na boot (jedan po zvuku)
- **60+ AudioBuffer dekodiranja** (svaki trosi CPU)
- **SVE se ucitava odmah** — nema deferred loading-a
- **Muzika je Web Audio** — 7 traka × 20MB = 140MB RAM
- **Dual format** (OGG + AAC) — duplo fajlova na disku

### 31.2 Tiered format (SlotAudioManager)

Zvuci grupisani u sprite fajlove po pool-u. SubLoader za deferred. HTML5 za muziku.

```json
{
    "soundManifest": [
        { "id": "game_loading", "src": ["soundFiles/game_loading.m4a"] },
        { "id": "game_main",   "src": ["soundFiles/game_main.m4a"],   "loadType": "A" },
        { "id": "game_bonus",  "src": ["soundFiles/game_bonus.m4a"],  "loadType": "B", "unloadable": true },
        { "id": "BaseGameMusicLoop", "src": ["soundFiles/BaseGameMusicLoop.m4a"], "loadType": "M" }
    ],
    "soundDefinitions": {
        "soundSprites": {
            "s_Bell": {
                "soundId": "game_loading",
                "spriteId": "s_Bell",
                "startTime": 4520,
                "duration": 1500,
                "tags": ["SoundEffects"],
                "overlap": false
            }
        }
    }
}
```

**Prednosti:**
- **3-4 HTTP zahteva** umesto 60+ (loading + main + bonus + standalone)
- **3-4 AudioBuffer dekodiranja** umesto 60+
- **Deferred loading** — bonus se ucitava tek kad treba
- **Unload** — bonus se oslobadja iz RAM-a posle bonusa
- **HTML5 muzika** — 3MB umesto 20MB po traci
- **Samo M4A** — jedan format, pola fajlova

### 31.3 Manifest sortiranje

buildTieredJSON.js sortira manifest entries ovim redom:
```
1. loading (bez loadType) — prvo
2. main (loadType "A")
3. bonus (loadType "B")
4. ostali SubLoaderi ("C"-"F", "Z")
5. standalone (bez loadType, ali zaseban M4A)
6. streaming (loadType "M"/"S") — poslednje
```

---

## 32. Howler.js fade internali — source code

### 32.1 Howl.prototype.fade()

```javascript
fade: function(from, to, len, id) {
    var self = this;

    // Ako nije ucitan, queue-uj
    if (self._state !== 'loaded') {
        self._queue.push({ event: 'fade', action: function() {
            self.fade(from, to, len, id);
        }});
        return self;
    }

    // Validiraj
    from = Math.min(Math.max(0, parseFloat(from)), 1);
    to = Math.min(Math.max(0, parseFloat(to)), 1);
    len = parseFloat(len);

    // Primeni na sve zvukove (ili specifican ID)
    var ids = self._getSoundIds(id);
    for (var i = 0; i < ids.length; i++) {
        var sound = self._soundById(ids[i]);
        if (!sound) continue;

        // Postavi pocetni volume
        sound._volume = from;
        self.volume(from, sound._id);

        // ─── Web Audio ───
        if (self._webAudio && !sound._muted) {
            var currentTime = Howler.ctx.currentTime;
            var end = currentTime + (len / 1000);

            sound._node.gain.setValueAtTime(from, currentTime);
            sound._node.gain.linearRampToValueAtTime(to, end);
        }

        // ─── Interval za tracking (oba moda) ───
        self._startFadeInterval(sound, from, to, len, ids[i],
            typeof id === 'undefined');
    }

    return self;
},
```

### 32.2 _startFadeInterval()

```javascript
_startFadeInterval: function(sound, from, to, len, id, isGroup) {
    var self = this;
    var vol = from;
    var diff = to - from;
    var steps = Math.abs(diff / 0.01);  // 1% koraci
    var stepLen = Math.max(4, (steps > 0) ? len / steps : len);
    var lastTick = Date.now();

    // Pocetni volume
    sound._fadeTo = to;
    sound._interval = setInterval(function() {
        var tick = (Date.now() - lastTick) / len;
        lastTick = Date.now();

        vol += diff * tick;
        vol = Math.round(vol * 100) / 100;  // zaokruzi na 2 decimale

        // Clamp
        if (diff < 0) vol = Math.max(to, vol);
        else vol = Math.min(to, vol);

        // ─── HTML5: direktno postavi volume ───
        if (!self._webAudio) {
            self.volume(vol, id);
        }

        // Azuriraj internu vrednost
        sound._volume = vol;
        if (isGroup) self._volume = vol;

        // Zavrsetak
        if ((to < from && vol <= to) || (to > from && vol >= to)) {
            clearInterval(sound._interval);
            sound._interval = null;
            sound._volume = to;
            self.volume(to, id);
            self._emit('fade', id);
        }
    }, stepLen);
}
```

**Kljucni detalji:**
- Interval koraci su ~4ms minimum (250 koraka/s max)
- `_fadeTo` property cuva ciljni volume (za ispitivanje tokom fade-a)
- `_interval` property cuva setInterval ID (za cleanup)
- Web Audio fade: `linearRampToValueAtTime` radi u audio thread-u (glatko), interval samo prati
- HTML5 fade: interval DIREKTNO menja `node.volume` (step-wise, manje glatko)

---

## 33. Network i CDN razmatranja

### 33.1 Audio file strategija za slot igre

| Tip fajla | Velicina | Prioritet | CDN caching |
|-----------|----------|-----------|-------------|
| Loading sprite | ~100-200 KB | KRITICNO | `Cache-Control: max-age=31536000, immutable` |
| Main sprite | ~500 KB-2 MB | VISOKO | Isto — webpack hash u imenu |
| Bonus sprite | ~500 KB-2 MB | NISKO | Isto |
| Standalone muzika | ~400-900 KB | SREDNJE | Isto |
| Streaming muzika | ~400-900 KB | SREDNJE | Isto |

### 33.2 Webpack hash i CDN invalidacija

Webpack dodaje content hash u ime fajla:
```
game_loading.abc123.m4a
```

Hash se menja SAMO kad se sadrzaj fajla promeni. CDN moze kacirati zauvek (`immutable`). Novi build = novi hash = novi URL = automatska invalidacija.

### 33.3 Preload strategija

```
T=0ms:     Ucitaj loading sprite (BLOCKIRAJUCE — igra ne startuje bez njega)
T=100ms:   Ucitaj standalone muziku (paralelno, ali ne kriticno)
T+play:    startSubLoader("A") — main pool (background, 5 paralelnih download-a)
T+bonus:   startSubLoader("B") — bonus pool (background, 5 paralelnih)
T+boot:    BGMStreamingInit — HTML5 Howl za muziku (streaming, ~3MB buffer)
```

### 33.4 Fetch vs XHR

Howler interno koristi XHR za Web Audio ucitavanje (zato sto treba ArrayBuffer). playa-core koristi fetch() sa streaming progress tracking:

```typescript
// SoundLoader._downloadAudio():
const response = await fetch(srcRef);
const reader = response.body.getReader();

while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalBytes += value.length;
    // Emituj progress event
}

const blob = new Blob(chunks);
const dataUrl = await blobToDataUrl(blob);
// Kreiraj Howl sa dataUrl
```

**Zasto Data URL umesto blob URL:**
playa-core konvertuje u Data URL (base64) umesto `URL.createObjectURL(blob)` jer Howler interno koristi XHR za dekodiranje, a blob URL-ovi mogu imati problema sa CORS u nekim browser-ima.

### 33.5 Concurrent download limit

```typescript
_concurrency: 5  // Max 5 paralelnih download-a
```

playa-core limitira na 5 istovremenih fetch poziva. Ovo:
- Spreci preopterecenje mreze
- Dozvoli browser-u da procira ostale resurse (slike, fontovi)
- Spreci timeout na sporim mrezama

### 33.6 Offline/GLR scenario

Kad se igra pokrece lokalno sa GLR-om (bez mreze):
- Audio fajlovi su vec na disku (webpack build)
- `fetch()` cita sa lokalnog fajl sistema (Electron `file://` ili dev server)
- Nema CDN latencije — ucitavanje je instant
- Ista logika radi i online i offline

---

## 34. Nedostajuci detalji iz build pipeline-a

### 34.1 Music tagging detekcija iz template JSON-a

buildTiered.js cita ORIGINALNI sounds.json (template) da detektuje koje zvukove tretira kao muziku:

```javascript
const _musicTags = new Set(spriteConfig.musicTags || ['Music']);
const _originalSprites = JSON.parse(fs.readFileSync(
    settings.JSONtemplate || 'sounds.json', 'utf8'
)).soundDefinitions?.soundSprites || {};

const _musicSounds = new Set();
for (const [k, v] of Object.entries(_originalSprites)) {
    if (v?.tags?.some(t => _musicTags.has(t)))
        _musicSounds.add(path.basename(k).replace(/^s_/, ''));
}
```

**Zasto je ovo bitno**: Zvuci sa Music tagom dobijaju `encoding.music` postavke (moze biti visi bitrate), a u tier-ovima sa mesanim zvucima (SFX + Music) se prave DVA zasebna sprite fajla.

### 34.2 Auto-dodavanje neodredjenih zvukova u poslednji tier

```javascript
const unassigned = allWavFiles.filter(f => !assignedSounds.has(f));
if (unassigned.length > 0) {
    console.log(`WARNING: ${unassigned.length} sounds not assigned to any tier`);
    const lastTier = Object.keys(spriteGroups).at(-1);
    spriteGroups[lastTier].sounds.push(...unassigned);
}
```

**UPOZORENJE**: Ako dodate WAV fajlove u `sourceSoundFiles/` ali ih NE dodate u `sprite-config.json`, oni ce se TIHO dodati u poslednji tier. Ovo moze povecati velicinu sprite-a bez vaseg znanja.

### 34.3 FDK enkoder per-category selekcija

Enkoder selekcija NIJE globalna — svaka kategorija moze koristiti razlicit enkoder:

```javascript
const _fdkPath = process.env.FFMPEG_FDK_PATH;
const _fdkExists = _fdkPath && fs.existsSync(_fdkPath);

// Proveri da li BILO KOJA kategorija zahteva FDK
const _anyFdk = _fdkExists && Object.values(spriteConfig.encoding || {})
    .some(e => (e.encoder || spriteConfig.encoder) === 'fdk');

// Ako ijedna kategorija trazi FDK, koristi FDK binarni za SVE
const pathToFFmpeg = _anyFdk ? _fdkPath : require('ffmpeg-static');

// Per-category logging:
for (const [key, enc] of Object.entries(encoding)) {
    const encType = (enc.encoder || spriteConfig.encoder || 'native');
    const wantsFdk = encType === 'fdk';
    const encLabel = (wantsFdk && _fdkExists) ? 'FDK' : 'native';
    console.log(`Encoding ${key}: ${enc.keepOriginal ? '320 (keep original)'
        : enc.bitrate + 'kbps'} ${enc.channels}ch ${enc.samplerate}Hz [${encLabel}]`);
}
```

### 34.4 keepOriginal bitrate flag

sprite-config.json podrzava `keepOriginal` flag u encoding kategoriji:

```json
{
    "encoding": {
        "sfx":   { "bitrate": 64, "channels": 2, "samplerate": 44100 },
        "music": { "bitrate": 64, "channels": 2, "samplerate": 44100, "keepOriginal": true }
    }
}
```

Kad je `keepOriginal: true`:
- Bitrate se postavlja na 320 kbps (najvisi kvalitet AAC)
- `channels` i `samplerate` se NE primenjuju (cuva originalne)
- Koristi se za muziku koja zahteva maksimalni kvalitet

```javascript
// buildTiered.js:
bitrate: enc.keepOriginal ? 320 : enc.bitrate,
// ...
if (!enc.keepOriginal) {
    opts.channels = enc.channels;
    opts.samplerate = enc.samplerate;
}
```

### 34.5 deployStreaming.js zaseban cache

deployStreaming.js koristi SVOJ cache fajl (`.streaming-cache.json`), odvojen od buildTiered.js cache-a (`.build-cache.json`):

```javascript
const streamCacheFile = '.streaming-cache.json';

const encSettingsKey = bitrate + '|' + channels + '|' + samplerate;

function loadStreamCache() {
    try {
        const c = JSON.parse(fs.readFileSync(streamCacheFile, 'utf8'));
        if (c._encSettings !== encSettingsKey) {
            console.log('Encoding settings changed — rebuilding all');
            return {};  // Invalidira ceo cache
        }
        return c;
    } catch { return {}; }
}
```

**Promena bitrate/channels/samplerate u sprite-config.json automatski invalidira streaming cache i forsira rebuild svih streaming traka.**

### 34.6 spriteGap za standalone/streaming

```javascript
// buildTiered.js:
const isStandalone = build.type === 'standalone' || build.type === 'streaming';
const gap = isStandalone ? 0 : spriteConfig.spriteGap;
```

Standalone i streaming zvuci UVEK imaju `spriteGap: 0` jer su zasebni fajlovi (nema vise zvukova u sprite-u koji zahtevaju razmak).

### 34.7 copyAudio.js BGM auto-import (DISEJBLANO)

copyAudio.js ima logiku za automatski import BGMStreamingInit.ts u game repo main.ts:

```javascript
function copyBGMModule() {
    const bgmSrc = path.join(".", "dist", "BGMStreamingInit.ts");
    if (!fs.existsSync(bgmSrc)) return;

    // Kopiraj u game repo src/ts/utils/
    fs.copyFileSync(bgmSrc, targetPath);

    // Auto-add import u main.ts
    const lines = mainTs.split("\n");
    let lastImportIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (/^import\s/.test(lines[i])) lastImportIdx = i;
    }
    if (lastImportIdx >= 0) {
        lines.splice(lastImportIdx + 1, 0, 'import "./utils/BGMStreamingInit";');
    }
}

// TRENUTNO DISEJBLANO (linija 117):
// copyBGMModule();
```

**Developer mora rucno kopirati BGMStreamingInit.ts i dodati import u main.ts.**

---

## 35. Nedostajuci detalji iz playa-core

### 35.1 Block execution metode (ISoundPlayer)

```typescript
interface ISoundPlayer {
    // ... standardne metode ...

    // Opcione block-execution metode:
    executeBlock?(commandId: string, index: number): void;
    setNextBlock?(commandId: string, index: number): void;
    getCurrentBlock?(commandId: string): number;
    // getCurrentBlock vraca 0xffffffff ako nijedan block nije setovan
}
```

Block execution omogucava sekvencijalnu reprodukciju delova jedne dugacke komande. Koristi se za multi-stage animacije gde svaki stage ima svoj audio.

### 35.2 SoundLoader.FILE_TYPES

```typescript
static FILE_TYPES = ["wav", "mp3", "m4a", "ogg", "aac"];
```

Ovi formati se prosledjuju Howler-u pri kreiranju instanci. Howler bira prvi kompatibilan format sa browser-om.

### 35.3 Tab visibility + fade state cuvanje

`pauseAllSounds(true)` (poziva se kad tab postane hidden):
1. Iterira kroz SVE Sound instance u svim Howl-ovima
2. Za svaki zvuk koji ima aktivan fade: CUVA fade state u `_tempFadingSprites`
3. Pauzira svaki Sound individualno (ne koristi `Howler.mute()` — koristi per-Sound pause)

`pauseAllSounds(false)` (poziva se kad tab postane visible):
1. Resume svaki pauzirani Sound
2. Za zvukove koji su imali aktivan fade: OBNAVLJA fade state iz `_tempFadingSprites`
3. Fade NE nastavlja od pozicije gde je stao — volume se postavlja na ciljnu vrednost odmah

### 35.4 AUTO_PLAY niz struktura

Iz Jumanji deliverable-a — struktura za auto-play konfiguraciju streaming muzike:

```json
{
    "AUTO_PLAY": [
        {
            "spriteId": "s_BaseGameMusicLoop",
            "volume": 0.7,
            "fadeVolume": 0.7,
            "loop": true,
            "fadeIn": 1500
        }
    ]
}
```

| Polje | Tip | Opis |
|-------|-----|------|
| `spriteId` | string | ID sprite-a koji se automatski pusta |
| `volume` | number | Ciljni volume (0.0-1.0) |
| `fadeVolume` | number? | Opciono — volume posle fade-in-a (ako razlicit od `volume`) |
| `loop` | boolean | Da li se ponavlja |
| `fadeIn` | number | Trajanje fade-in-a u ms |

### 35.5 SoundSpriteList random state persistencija

Random state se cuva na SoundSpriteList instanci i PERSISTIRA izmedju komandi:

```typescript
class SoundSpriteList {
    _soundIndices: number[];    // dostupni indeksi za sledeci izbor
    _lastSelected: number;      // poslednji izabrani (iskljucen iz sledecerepopulacije)
    _currentIndex: number;      // pozicija u sequential modu
}
```

**Primer zivotnog ciklusa:**
```
Lista: [A, B, C, D]

1. createIndexedList() → _soundIndices = [0, 1, 2, 3] (prvi put, nema _lastSelected)
2. getRandomIndex()    → izabere 2 (C), _soundIndices = [0, 1, 3]
3. getRandomIndex()    → izabere 0 (A), _soundIndices = [1, 3]
4. getRandomIndex()    → izabere 3 (D), _soundIndices = [1]
5. getRandomIndex()    → izabere 1 (B), _soundIndices = [] ← prazan
6. createIndexedList() → _soundIndices = [0, 1, 3] ← 2 (C) iskljucen jer je _lastSelected=1... ne:

Tacnije:
6. createIndexedList() → _soundIndices = [0, 2, 3] ← 1 (B) iskljucen jer je _lastSelected=1
7. getRandomIndex()    → izabere 2 (C) — C nece biti odmah posle B
```

**Garancija**: Isti zvuk se NIKAD ne pusta dva puta uzastopno, cak ni na granici izmedju ciklusa.

**State persistira kroz bonus/base tranzicije**: Ako se BGM pauzira tokom bonusa i nastavi posle, random sekvenca nastavlja gde je stala.

---

## 36. Segment kompozicione smernice (za audio dizajnere)

### 36.1 Zahtevi za BGM segmente (pseudo-streaming)

| Svojstvo | Zahtev |
|----------|--------|
| Tonalitet | ISTI kroz sve segmente (isti key, isti mode) |
| BPM | ISTI ili bez jakog pulsa |
| Prvih 3 sekunde | Blag ulazak (ambient tekstura, pad swell) |
| Poslednjih 3 sekunde | Blaga rezolucija (sustain, reverb rep, fade) |
| Melodija | Minimalna ili pentatonska/modalna — jaki hooks zvuce "preseceno" |
| Harmonska brzina | 1-2 promene po segmentu (sporo) |
| RMS | Konzistentan izmedju segmenata (nema volume skokova) |
| Varijacija | Tekstura menja se po segmentu (tu zivi raznolikost) |

### 36.2 WAV specifikacije

```
Format: 16-bit PCM WAV
Sample rate: 44100 Hz
Kanali: Mono (preporuceno za mobile) ili Stereo (desktop-only)
Trajanje: 30.000 sekundi (TACNO — kriticno za timing)
Normalizacija: -14 LUFS (konzistentna glasnost)
```

### 36.3 Muzicki stilovi koji RADE

- Ambient/atmospheric pads
- Lo-fi chillhop (bez jakih beatova)
- Minimalisticki elektronski (soft synth arpeggios)
- Orkestralni droneovi sa sporim stringovima

### 36.4 Muzicki stilovi koji NE RADE

- Pop sa jakim hook-ovima (preseceni hook = frustracija)
- Drum-heavy EDM (beat pauza na crossfade = artefakt)
- Klasicna muzika sa dinamickim rasponom (pp→ff skokovi izmedju segmenata)
- Bilo sta sa prepoznatljivom melodijom u prvih/poslednjih 3 sekunde

---

## 37. Auto-assign obrasci za SpriteConfigPage

### 37.1 Prioritet provere

```
1. Tag iz soundsJson (Music tag → standalone)
2. Pattern match (prvi koji matchuje dobija)
3. Fallback → main (ili poslednji tier ako main ne postoji)
```

### 37.2 Pattern lista po pool-u

**standalone** (SAMO base game muzika):
```
BaseGameMusicLoop*
AmbBg
```

**loading** (minimum za prvi spin):
```
Ui*, UI_*
ReelLand*
SpinsLoop*, SpinningReels
Payline
RollupLow*
CoinLoop*, CoinCounter
Bell, TotalWin
IntroAnim*, GameIntro*
Tutorial*
PanelAppears, OptionsRoll
```

**bonus** (svi bonus modovi + bonus muzika):
```
BonusGameMusic*, FreeSpinMusic*, PickerMusicLoop
MultiplierMusicLoop, RespinLoop*, WheelBonusMusicLoop
Bonus*, Picker*, FreeSpin*
HoldAnd*, Respin*
BaseToBonusStart*, TrnBaseToBonus
BonusToBase*
SymScatter*, SymbolFreeSpins*
Trigger*, Wheel*
Jackpot*, Progressive*
Gem*, Pot*, Lamp*, Genie*, Ignite*
VO*, BonusBuy*
+ game-specificni bonus pattern-i
```

**main** (fallback — sve ostalo):
```
BigWin*, CoinShower*
Anticipation*, PreCog, ScreenShake
Sym*, Wild*
Win\d*, Rollup*
+ SVE sto ne matchuje gornje pattern-e
```

### 37.3 Kljucna pravila rasporedivanja

| Zvuk | Pool | Razlog |
|------|------|--------|
| `BaseToBonusStart` | bonus | Tranzicija pripada bonus kontekstu |
| `BonusToBaseStart` | bonus | Tranzicija pripada bonus kontekstu |
| `SymbolB01Land1-5` | main | Scatter land u base game-u |
| `PreBonusLoop` | main | Svira PRE bonusa, igra je jos u base |
| `SpinsLoop` | loading | Reel zvuk, potreban od prvog spina |
| `FreeSpinMusic` | bonus | NE standalone — ide sa bonus poolom |
| `PickerMusicLoop` | bonus | NE standalone — ide sa bonus poolom |
| `BaseGameMusicLoop1/2/3` | standalone | Prave base game muzike |

---

## 38. AUDIO_POOLS.md — status zastarelosti

> **NAPOMENA**: `AUDIO_POOLS.md` koristi STARIJU pool nomenklaturu koja se razlikuje od trenutne implementacije u aplikaciji.

### 38.1 Mapiranje starih → novih imena

| AUDIO_POOLS.md (staro) | Trenutna app (novo) | Status |
|------------------------|---------------------|--------|
| BOOT (priority 1) | **loading** | Preimenovano |
| BASE / reel_win (priority 2) | **main** | Preimenovano + prosireno |
| BIGWIN (priority 3, subLoaderId "A") | **(spojen u main)** | BIGWIN vise ne postoji kao zaseban pool |
| BONUS (priority 4, subLoaderId "B") | **bonus** | Isto |
| *(nije postojao)* | **standalone** | Novi pool |

### 38.2 Kljucna arhitekturna promena

Stara arhitektura (AUDIO_POOLS.md):
```
BOOT (main load) + BASE (main load) + BIGWIN (SubLoader "A") + BONUS (SubLoader "B")
```

Nova arhitektura (CLAUDE.md / ULTIMATE doc):
```
loading (main load) + main (SubLoader "A") + bonus (SubLoader "B") + standalone (zasebni M4A)
```

**BIGWIN je spojen u MAIN pool** — big win zvuci, anticipation, symbol wins su svi pod SubLoader "A" jer se ucitavaju u istom trenutku (prvi spin).

### 38.3 SubLoader trigger korekcija

AUDIO_POOLS.md pogresno navodi:
> `startSubLoader("B")` na prvom scatter padu

**TACNO**: `startSubLoader("B")` se poziva kad bonus bude **POTVRDJEN** (3+ scattera evaluirana u `BonusTriggerCommand`), NE na prvom scatter land-u na reel-u. Scatter landing na reel-u je vizuelni event — trigger za SubLoader je POSLE evaluacije spin rezultata.

---

## 39. replayMissedCommands i gsap catch-up

### 39.1 Problem

Kad tab postane hidden:
1. `pauseAllSounds(true)` — Howler pauzira sve
2. gsap koristi `requestAnimationFrame` interno — potpuno pauziran od browser-a
3. Zakazani `delayedCall`-ovi se AKUMULIRAJU (ne izvrsavaju se u pozadini)

Kad tab postane ponovo vidljiv:
1. `pauseAllSounds(false)` — Howler resume
2. gsap "hvata" zaostale pozive — SVI zakazani koji su "istekli" tokom pauze fire SIMULTANO
3. Rezultat: vise play/fade/stop komandi u istom frame-u

### 39.2 Posledice po trajanje pauze

| Trajanje | Posledica |
|----------|-----------|
| < 10s | Besprekorno — mali catch-up, jedva primetan |
| 10-60s | Kratka volume fluktuacija (~100ms) |
| 1-5 min | Audio artefakt < 3s (vise komandi se izvrsavaju simultano) |
| 5+ min | 1-2s tisine, pa normalan nastavak |

### 39.3 Zasto nije katastrofalno

1. `SoundSpriteList.play()` sa `overlap: false` i `_isPlaying = true` → NO-OP (ne dupla zvuk)
2. POSLEDNJI `play` u catch-up sekvenci postaje aktivni segment
3. Fade komande se medjusobno prepisuju (poslednji fade "pobedi")

### 39.4 Preporuceni mitigation (jedna linija u igri)

```javascript
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isBGMActive) {
        soundManager.execute("StartBGM");  // Restart chain cisto od pocetka
    }
});
```

Ovo resetuje ceo BGM command chain na poznatostanje, eliministuci catch-up artefakte.

### 39.5 BGMStreamingInit — replayMissedCommands

Generisani BGMStreamingInit.ts ima logiku za replay komandi koje su bile emitovane pre nego sto je HTML5 Howl zavrsio ucitavanje:

```typescript
function replayMissedCommands(player: any): void {
    // Za svaku muzicku traku:
    // - Proveri da li postoji aktivan SoundSprite
    // - Ako sprite postoji ali NE svira (jer je Howl bio undefined kad je komanda dosla)
    // - Ponovo izvrsi play sa originalnim parametrima
    for (const name of MUSIC) {
        const spriteId = "s_" + name;
        const sp = player._soundSprites?.get(spriteId);
        if (sp && !sp._isPlaying && sp._howl) {
            // Howl je sada registrovan — pusti zvuk koji je propusten
            sp._volume = vol;
            sp._loop = loop;
            sp.play();
        }
    }
}
```

Ovo resava timing problem: igra emituje `StartBGM` pre nego sto HTML5 Howl zavrsi ucitavanje → komanda tiho propadne → `replayMissedCommands` je pusta kad Howl bude spreman.

---

## 40. deployStreaming.js — liniju-po-liniju analiza (735 LOC)

> **Status**: PRODUKCIJSKI KOD — testiran i potvrdjen da radi u igri.
> Ova sekcija dokumentuje SVAKU liniju koda sa objasnjenjima.

### 40.1 Header i pipeline opis (linije 1-25)

```
Pipeline od 8 koraka:
1. Premesti streaming WAV-ove iz sourceSoundFiles/ → .streaming_temp/
2. Pokreni createAudioSpritesBySize.js (samo SFX sprite-ovi, BEZ muzike)
3. Pokreni makeMyJSONSizedSprites.js (sounds.json samo za SFX)
4. Vrati streaming WAV-ove nazad u sourceSoundFiles/
5. Enkodiraj streaming WAV-ove u individualne M4A (ffmpeg, music bitrate)
6. Azuriraj dist/sounds.json — dodaj streaming entryje sa loadType "M"
7. Generisi BGMStreamingInit.ts (direktan HTML5 — bez SubLoader-a, bez swap-a)
8. Kopiraj BGMStreamingInit.ts u game repo + patchuj main.ts
```

**Zasto premestanje**: Ako se streaming WAV-ovi ne uklone tokom SFX build-a, createAudioSpritesBySize ce ih UPALITI u sprite sa SFX zvucima. Muzika bi zavrsila u Web Audio sprite-u i pojela RAM.

### 40.2 Config citanje (linije 27-59)

```javascript
const settings   = JSON.parse(fs.readFileSync('settings.json', 'utf8'));     // L37
const spriteConfig = JSON.parse(fs.readFileSync('sprite-config.json', 'utf8')); // L40
```

- Svako citanje umotano u try-catch sa `process.exit(1)` na gresku
- `gameProjectPath` je obavezan — bez njega nema deploy-a (L44)
- `gameRepoAbs = path.resolve(gameProjectPath)` — relativna putanja → apsolutna (L45)

```javascript
const streamingSounds = spriteConfig.streaming?.sounds || [];   // L47
const autoPlaySounds = new Set(spriteConfig.streaming?.autoPlay || []); // L48
```

- `streaming.sounds` — niz imena zvukova za HTML5 streaming (npr. `["BaseGameMusicLoop", "BonusMusicLoop"]`)
- `streaming.autoPlay` — podskup koji se automatski reprodukuje na boot (npr. `["BaseGameMusicLoop"]`)
- Ako `streamingSounds` je prazan → samo SFX build, bez streaming-a (L57-59)

### 40.3 Step 1: Premestanje WAV-ova (linije 61-81)

```javascript
const tempDir = path.join('.', '.streaming_temp');
const movedFiles = [];

for (const name of streamingSounds) {
    const src = path.join(sourceDir, name + '.wav');
    const dst = path.join(tempDir, name + '.wav');
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, dst);   // Kopiraj u temp
        fs.unlinkSync(src);          // Obrisi original
        movedFiles.push(name);       // Zapamti za restore
    }
}
```

**Kriticno**: `copyFileSync` + `unlinkSync` umesto `renameSync` — `rename` moze propasti izmedju razlicitih diskova/particija. Copy+delete je bezbednije.

### 40.4 Restore mehanizam (linije 83-93)

```javascript
function restoreWavs() {
    for (const name of movedFiles) {
        const src = path.join(tempDir, name + '.wav');
        const dst = path.join(sourceDir, name + '.wav');
        if (fs.existsSync(src)) { fs.copyFileSync(src, dst); fs.unlinkSync(src); }
    }
    try { if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
}
process.on('exit', restoreWavs);
process.on('SIGINT', () => { restoreWavs(); process.exit(1); });
process.on('uncaughtException', (err) => { restoreWavs(); console.error(err); process.exit(1); });
```

**3 nivoa zastite**:
1. `process.on('exit')` — uvek se poziva kad Node proces izlazi
2. `process.on('SIGINT')` — Ctrl+C
3. `process.on('uncaughtException')` — nepredvidjena greska

**Garancija**: WAV fajlovi se UVEK vracaju nazad, cak i pri crash-u. Nikad ne ostanu u temp-u.

### 40.5 Step 2-3: SFX Build (linije 95-122)

```javascript
const optimizedScript = path.join('.', 'scripts', 'buildSpritesOptimized.js');
const useOptimized = fs.existsSync(optimizedScript);

if (useOptimized) {
    execSync('node scripts/buildSpritesOptimized.js', { stdio: 'inherit', timeout: 300000 });
} else {
    execSync('node scripts/createAudioSpritesBySize.js', { stdio: 'inherit', timeout: 300000 });
}
```

- Pokusava `buildSpritesOptimized.js` prvo (novi optimizovani build)
- Fallback na `createAudioSpritesBySize.js` (stari build)
- `stdio: 'inherit'` — output se prikazuje u real-time (vidljiv u Build Page logu)
- `timeout: 300000` — 5 minuta max (sprecava beskonacno visenje)
- `maxBuffer: 5 * 1024 * 1024` — 5MB output buffer

```javascript
if (!useOptimized) {
    execSync('node scripts/makeMyJSONSizedSprites.js audioSprite', { ... });
}
```

- Optimizovani build vec generise sounds.json — nepotrebno zvati posebno
- Stari build zahteva poseban korak za JSON generaciju

```javascript
if (movedFiles.length > 0) {
    process.removeAllListeners('exit');  // L119 — KRITICNO
    restoreWavs();
}
```

**L119 `removeAllListeners('exit')`**: Uklanja `restoreWavs` iz exit handlera jer smo ga VEC pozvali rucno. Bez ovoga bi se `restoreWavs` pozvao DVAPUT (jednom rucno, jednom na exit).

### 40.6 Step 5: Streaming encoding (linije 129-259)

#### FFmpeg selekcija (linije 135-141)

```javascript
const _ffmpegStatic = require('ffmpeg-static');
const _fdkStreamPath = process.env.FFMPEG_FDK_PATH || '';
const _fdkStreamExists = _fdkStreamPath && fs.existsSync(_fdkStreamPath);
const pathToFFmpeg = _fdkStreamExists ? _fdkStreamPath : _ffmpegStatic;
```

- Prioritet: `FFMPEG_FDK_PATH` environment variable → `ffmpeg-static` (bundled)
- FDK (Fraunhofer) daje bolji kvalitet na niskim bitrate-ovima (64kbps)
- **RAZLIKA OD buildTiered.js**: deployStreaming UVEK koristi FDK ako postoji, bez per-category provere

#### SHA-256 cache (linije 148-159)

```javascript
const streamCacheFile = path.join('.', 'dist', '.streaming-cache.json');
const encSettingsKey = bitrate + '|' + channels + '|' + samplerate;  // npr. "64|2|44100"

function loadStreamCache() {
    try {
        const c = JSON.parse(fs.readFileSync(streamCacheFile, 'utf8'));
        if (c._encSettings !== encSettingsKey) {
            console.log('  Encoding settings changed — rebuilding all');
            return {};  // INVALIDIRA CEO CACHE
        }
        return c;
    } catch { return {}; }
}
```

- Cache je ZASEBAN od buildTiered-ovog `.build-cache.json`
- Lokacija: `dist/.streaming-cache.json` (NE u root-u)
- Invalidacija: promena bitrate/channels/samplerate → CEO cache se brise
- `sha256()` koristi KOMPLETNI hex hash (64 char), NE prvih 16 kao buildTiered

#### WAV duration detekcija (linije 161-172)

```javascript
function getWavDurationMs(wavPath) {
    return new Promise((resolve) => {
        sox.identify(wavPath, (err, results) => {
            if (err || !results || !results.sampleRate) {
                resolve(0);  // NE baca gresku — vraca 0
                return;
            }
            resolve(Math.round(results.sampleCount * 100000 / results.sampleRate) / 100);
        });
    });
}
```

**Formula**: `sampleCount * 100000 / sampleRate / 100` — ovo je ekvivalentno `sampleCount / sampleRate * 1000` (ms), ali zaokruzeno na 2 decimale.

**VAZNO**: Koristi `sox` (SoX audio tool) za duration, NE exiftool kao buildTieredJSON.js. Dva razlicita alata za istu stvar — potencijalni izvor minimalnih razlika u duration preciznosti.

#### Paralelno enkodiranje (linije 174-203)

```javascript
function encodeOne(name, wavPath, m4aPath) {
    return new Promise((resolve) => {
        getWavDurationMs(wavPath).then(durationMs => {
            execFile(pathToFFmpeg, [
                '-y',                    // overwrite bez pitanja
                '-i', wavPath,           // input
                '-c:a', 'aac',           // AAC codec (native, ne FDK!)
                '-b:a', bitrate + 'k',   // bitrate iz sprite-config.json
                '-ac', String(channels), // kanali iz sprite-config.json
                '-ar', String(samplerate), // sample rate
                '-movflags', '+faststart', // MP4 moov atom na pocetak (brzi streaming)
                m4aPath                   // output
            ], { timeout: 120000 }, (error) => {
```

**KRITICNO — codec flag**: Koristi `-c:a aac` (native encoder), NE `-c:a libfdk_aac`. Cak i kad je FDK binarni selektovan, FFmpeg flag je `aac`, ne `libfdk_aac`. Ovo znaci da se FDK binarni koristi ali sa NATIVE AAC encoderom unutar njega (osim ako FDK binarni ima native zamenu).

**`-movflags +faststart`**: Premesta MP4 `moov` atom na pocetak fajla. Bez ovoga, browser mora da downloaduje CEO fajl pre nego sto moze poceti reprodukciju. Sa `faststart`, streaming pocinje odmah.

**Error handling (linije 185-196):**
```javascript
if (error) {
    console.error('  ❌ ' + name + ': ' + error.message);
    try { if (fs.existsSync(m4aPath)) fs.unlinkSync(m4aPath); } catch {} // Brisi parcijalni
    resolve(null);  // NE reject — resolve(null) signalizira neuspeh
    return;
}
if (!fs.existsSync(m4aPath) || fs.statSync(m4aPath).size === 0) {
    try { if (fs.existsSync(m4aPath)) fs.unlinkSync(m4aPath); } catch {}
    resolve(null);
    return;
}
```

- **Parcijalni M4A se UVEK brise** pri gresku (sprecava korumpirane fajlove)
- **resolve(null)** umesto reject — `Promise.all()` NE propasce na jednoj gresku, ostale trake nastavljaju

#### Cache logika i validacija (linije 205-259)

```javascript
for (const name of streamingSounds) {
    const hash = sha256(wavPath);

    if (prevCache[name] === hash && fs.existsSync(m4aPath) && fs.statSync(m4aPath).size > 0) {
        // CACHED — koristi postojeci M4A
        tracks.push({ name, m4aName: name + '.m4a', durationMs, sizeKB });
        successCache[name] = hash;
    } else {
        encodeJobs.push({ name, wavPath, m4aPath, hash });
    }
}
```

**3 uslova za cache hit:**
1. Hash se poklapa sa prethodnim
2. M4A fajl postoji na disku
3. M4A fajl NIJE prazan (size > 0)

```javascript
const results = await Promise.all(
    encodeJobs.map(j => encodeOne(j.name, j.wavPath, j.m4aPath))
);
```

**TRUE paralelno enkodiranje** — svi FFmpeg procesi se pokrecu istovremeno. Na 8-core masini, 8 traka se enkodira simultano.

```javascript
// ONLY save hashes for tracks that SUCCEEDED
saveStreamCache(successCache);

// Validate ALL required tracks exist
const missing = streamingSounds.filter(name => !tracks.some(t => t.name === name));
if (missing.length > 0) {
    console.error('❌ Missing streaming tracks: ' + missing.join(', '));
    // NE exit(1) — build NASTAVLJA sa delom traka
}
```

**Propadne trake NE zaustavljaju build** — igra ce raditi sa koliko god traka ima. Missing trake ce tiho propadati u BGMStreamingInit (undefined Howl → no-op play).

### 40.7 Step 6: sounds.json azuriranje (linije 268-311)

```javascript
soundsJson.soundManifest.push({
    id: track.name,
    src: ['soundFiles/' + track.m4aName],
    loadType: 'M'                         // Direct HTML5 signal
});

soundsJson.soundDefinitions.soundSprites[spriteKey] = {
    soundId: track.name,
    spriteId: track.name,                 // spriteId === soundId za standalone
    startTime: 0,                         // ceo fajl, ne segment
    duration: track.durationMs,           // iz sox.identify
    tags: orig.tags || ['Music'],         // cuva originalne tagove ili fallback
    overlap: orig.overlap !== undefined ? orig.overlap : false
};
```

**Kljucne odluke:**
- `loadType: 'M'` — playa-core resolvuje URL ali NE ucitava. BGMStreamingInit cita URL iz `_soundUrl`.
- `startTime: 0` — ceo fajl je jedan zvuk (ne sprite segment)
- `tags` se cuvaju iz template sounds.json (`orig = templateSprites[spriteKey]`) — ako igra vec ima tagove definisane, oni se zadrzavaju
- `spriteId` === `soundId` za streaming zvukove (1:1 mapiranje, nema sprite-ova)

### 40.8 Step 7: BGMStreamingInit.ts generacija (linije 314-639)

#### Auto-play ekstrakcija (linije 319-344)

```javascript
for (const track of streamingTracks) {
    if (!autoPlaySounds.has(track.name)) continue;
    const spriteId = 's_' + track.name;
    let playVolume = 0, fadeVolume = 0.7, playLoop = -1, fadeIn = 1500;

    for (const [, steps] of Object.entries(allCommands)) {
        const arr = Array.isArray(steps) ? steps : [steps];
        for (const step of arr) {
            if (!step || step.spriteId !== spriteId) continue;
            const cmd = (step.command || '').toLowerCase();
            if (cmd === 'play' && playVolume === 0) {
                playVolume = step.volume !== undefined ? step.volume : 0;
                playLoop = step.loop !== undefined ? step.loop : -1;
            }
            if (cmd === 'fade' && step.volume > 0) {
                fadeVolume = step.volume;
                if (step.duration) fadeIn = step.duration;
            }
        }
    }
    autoPlayConfigs.push({ spriteId, volume: playVolume, fadeVolume, loop: playLoop, fadeIn });
}
```

**Sta radi**: Skenira SVE komande u sounds.json da pronadje play/fade parametre za svaku auto-play traku. Koristi PRVI play i PRVI fade sa volume > 0 za tu traku.

**Default-ovi**: `playVolume=0` (tiho pustanje za fade-in), `fadeVolume=0.7`, `playLoop=-1` (beskonacan), `fadeIn=1500ms`.

#### Generisani TypeScript — URL rezolucija (linije 374-401)

```typescript
function getResolvedUrl(player: any, soundId: string): string | null {
    // 1. Trazi manifest entry po ID-u
    const entry = manifestData.soundManifest.find((m: any) => m.id === soundId);

    // 2. Pokusaj direktan match: _soundUrl[entry.src[0]]
    entry.src.some((srcPath: string) => {
        if (soundUrl[srcPath]) { resolved = soundUrl[srcPath]; return true; }
        return false;
    });

    // 3. Fallback: trazi po filename-u (za slucaj da je putanja razlicita)
    const fileName = entry.src[0].split("/").pop();
    Object.keys(soundUrl).some((key) => {
        if (key.includes(fileName) && typeof soundUrl[key] === "string") {
            resolved = soundUrl[key]; return true;
        }
        return false;
    });
}
```

**Dva nivoa URL rezolucije**:
1. **Direktan match**: `_soundUrl["soundFiles/BaseGameMusicLoop.m4a"]` → webpack hashed URL
2. **Filename fallback**: Ako putanja ne matchuje, trazi po imenu fajla (handles relative/absolute path razlike)

**Zasto `typeof soundUrl[key] === "string"`**: `_soundUrl` moze sadrzati i ne-string vrednosti (npr. blob URL-ove). String check sprecava pogresne match-eve.

#### Generisani TypeScript — Gapless Loop Monitor (linije 403-435)

```typescript
const loopMonitors: Record<string, { active: boolean; duration: number }> = {};

function startLoopMonitor(howl: Howl, spriteId: string, durationSec: number): void {
    // Kreira ili reuse-uje state objekat za ovaj sprite
    if (!loopMonitors[spriteId]) loopMonitors[spriteId] = { active: false, duration: durationSec };
    const state = loopMonitors[spriteId];
    if (state.active) return;  // Vec aktivan — sprecava dupli monitor
    state.active = true;

    function tick(): void {
        if (!state.active) return;  // Zaustavljen spolja (pause/stop event)
        const snd = findSnd(howl, spriteId);
        if (!snd || snd._paused || !snd._node) { state.active = false; return; }

        const pos: number = snd._node.currentTime;       // HTML5 Audio pozicija
        const remaining = state.duration - pos;

        // 50ms PRE kraja: mute → seek na 0 → unmute (na sledecem frame-u)
        if (pos > 0.1 && remaining > 0 && remaining < 0.05) {
            const vol: number = snd._node.volume;
            snd._node.volume = 0;           // Instant mute
            snd._node.currentTime = 0;      // Seek na pocetak
            requestAnimationFrame(() => {
                if (snd._node) snd._node.volume = vol;  // Unmute na sledecem frame-u
            });
        }

        requestAnimationFrame(tick);  // Nastavi monitoring
    }
    requestAnimationFrame(tick);
}
```

**Detaljno sta se desava:**
1. `requestAnimationFrame` poziva `tick()` ~60 puta u sekundi
2. Svaki tick proverava koliko je ostalo do kraja trake
3. Kad ostane < 50ms: **mute → seek → unmute** u DVA frame-a
   - Frame 1: `volume = 0`, `currentTime = 0` (tiho seek na pocetak)
   - Frame 2: `volume = vol` (vrati volume)
4. Korisnik cuje kontinuiran zvuk bez micro-gap-a

**Uslovi za seek**: `pos > 0.1` sprecava seek na samom pocetku (bug prevention). `remaining > 0` sprecava seek posle kraja.

**Zaustavljanje**: `howl.on("pause")` i `howl.on("stop")` pozivaju `stopLoopMonitor(spriteId)` koji samo stavlja `state.active = false`.

#### Generisani TypeScript — HTML5 Howl registracija (linije 437-498)

```typescript
function registerHtml5(name: string, url: string, player: any): Promise<boolean> {
    const spriteId = "s_" + name;
    const soundDef = player._soundManifestData?.soundDefinitions?.soundSprites?.[spriteId];
    if (!soundDef) { warn(name, "— no soundSprite def"); resolve(false); return; }

    const durationSec = (soundDef.duration || 0) / 1000;

    const howl = new Howl({
        src: [url],
        html5: true,             // KRITICNO — streaming, ne Web Audio
        preload: true,           // Pocni buffering odmah
        format: ["m4a"],         // Eksplicitni format (zaobilazi Howler-ovu detekciju)
        sprite: { [spriteId]: [0, 86400000] },  // 24h dummy duration
    });
```

**`sprite: { [spriteId]: [0, 86400000] }`**: Howler zahteva sprite definiciju za `.play(spriteId)`. Duration je 86400000ms (24 sata) — veci od bilo koje realne trake. Howler nece zaustaviti reprodukciju pre kraja fajla jer je dummy duration veci.

**Zasto ne tacna duration**: U momentu kreiranja Howl-a, ne znamo tacnu duration (HTML5 Audio jos nije ucitan). Loop monitor koristi `soundDef.duration` iz sounds.json za precizan seek.

```typescript
    howl.on("play", () => {
        const snd = findSnd(howl, spriteId);
        if (snd) {
            if (snd._playStart === undefined) {
                snd._playStart = (Howler as any).ctx?.currentTime || 0;
            }
            startLoopMonitor(howl, spriteId, durationSec);
        }
    });
```

**`_playStart`**: playa-core SoundSprite cita `_playStart` za poziciju kalkulaciju. Ako je `undefined`, seek ne radi. Postavljamo na `ctx.currentTime` da sprecimo bug.

```typescript
    howl.once("load", () => {
        // 1. Registruj Howl u player
        player._howlInstances[url] = howl;

        // 2. Ocisti stali sprite (kreiran u setSounds sa howl=undefined)
        const stale = player._soundSprites?.get(spriteId);
        if (stale) {
            player._tags?.forEach((td: any) => {
                if (td?.sprites) {
                    td.sprites = td.sprites.filter((s: any) => s !== stale);
                }
            });
        }

        // 3. Registruj novi sprite sa pravim Howl-om
        player.addHowl(howl, url, spriteId);

        // 4. Sinhronizuj tag stanje (Music muted → sprite muted)
        syncTagState(player, spriteId);
    });
```

**Sekvenca je KRITICNA** — mora ici ovim redom:
1. `_howlInstances[url] = howl` — gate check u `addHowl()` proverava ovo
2. Ocisti stale sprite iz tag listi — inace bi tag imao DVO sprite-a za isti zvuk
3. `addHowl()` — kreira novi SoundSprite sa pravim Howl-om i registruje u tagove
4. `syncTagState()` — ako je Music tag vec muted (korisnik je ugasio muziku pre ucitavanja), mutuj i novi sprite

#### Generisani TypeScript — replayMissedCommands (linije 500-539)

```typescript
function replayMissedCommands(player: any): void {
    const commands = player._soundManifestData?.soundDefinitions?.commands;
    if (!commands) return;
    const musicSet = new Set(MUSIC.map((n) => "s_" + n));

    // Proverava 3 komande koje se obicno izvrsavaju na boot-u:
    ["onGameInit", "onBaseGameStart", "onGameStart"].forEach((cmdName) => {
        const steps = commands[cmdName];
        if (!steps) return;
        const arr: any[] = Array.isArray(steps) ? steps : [steps];

        arr.forEach((step: any) => {
            if (!step) return;
            const cmd = (step.command || "").toLowerCase();
            const sid: string = step.spriteId || "";

            // Samo play komande za muzicke sprite-ove
            if (cmd !== "play" || !musicSet.has(sid)) return;

            const sp = player._soundSprites?.get(sid);
            if (!sp || sp._isPlaying) return;  // Vec svira ili ne postoji

            // Postavi volume i loop iz originalne komande
            if (step.volume !== undefined) sp._volume = step.volume;
            if (step.loop !== undefined) sp._loop = step.loop;
            sp.play();

            // Pronadji fade komandu za isti sprite i primeni
            const fadeStep = arr.find((fs: any) =>
                fs && (fs.command || "").toLowerCase() === "fade" &&
                fs.spriteId === sid && fs.volume > 0
            );
            if (fadeStep) {
                setTimeout(() => {
                    const c = player._soundSprites?.get(sid);
                    if (c?._isPlaying) c.fade({
                        volume: fadeStep.volume,
                        duration: fadeStep.duration || 1500
                    });
                }, fadeStep.delay || 50);
            }

            log("replay:", cmdName, "→", sid);
            musicSet.delete(sid);  // Sprecava dupli replay
        });
    });
}
```

**Sta resava**: Igra emituje `onGameInit` ili `onBaseGameStart` pre nego sto HTML5 Howl zavrsi ucitavanje. Komanda tiho propadne (jer `_howl` je `undefined`). `replayMissedCommands` pronalazi te komande u sounds.json i ponovo ih izvrsava POSLE registracije Howl-a.

**3 komande se proveravaju**: `onGameInit`, `onBaseGameStart`, `onGameStart` — standardna IGT boot sekvenca.

**`musicSet.delete(sid)`**: Sprecava da ista traka bude replay-ovana iz vise komandi (npr. ako `onGameInit` i `onBaseGameStart` obe imaju `play s_BaseGameMusicLoop`).

#### Generisani TypeScript — Tab Visibility Handler (linije 541-589)

```typescript
function setupVisibilityHandler(player: any): void {
    const musicIds = MUSIC.map((n) => "s_" + n);
    const saved: Record<string, { vol: number; pos: number }> = {};

    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            // ── TAB HIDDEN ──
            musicIds.forEach((sid) => {
                delete saved[sid];
                const sp = player._soundSprites?.get(sid);
                if (!sp?._isPlaying) return;

                const snd = findSnd(sp._howl, sid);
                saved[sid] = {
                    vol: sp._volume,
                    pos: snd?._node?.currentTime || 0  // Sacuvaj poziciju
                };
                if (snd?._node) snd._node.volume = 0;  // Instant mute (ne pause)
            });
```

**Zasto `volume = 0` umesto `pause()`**: `pause()` bi resetovao poziciju na nekim browser-ima. `volume = 0` cuva tacnu poziciju za restore. playa-core `pauseAllSounds()` ce takodje pozvati pause — ali nas handler stize PRVI i cuva stanje.

```typescript
        } else {
            // ── TAB VISIBLE ──
            Object.keys(saved).forEach((sid) => {
                const state = saved[sid];
                const sp = player._soundSprites?.get(sid);
                if (!sp) return;
                const snd = findSnd(sp._howl, sid);

                // Vrati poziciju ako se razlikuje (browser moze pomeriti)
                if (snd?._node) {
                    if (Math.abs(snd._node.currentTime - state.pos) > 0.5) {
                        snd._node.currentTime = state.pos;  // Seek nazad
                    }
                    snd._node.volume = 0;  // Kreni od nule za fade-in
                }

                // Resume ako je pauziran (playa-core pauseAllSounds mogao pauzirati)
                if (!sp._isPlaying && sp._isPaused) sp.resume();

                // Gradual fade-in (8 koraka po 5ms = 40ms total)
                if (snd?._node) {
                    const node = snd._node;
                    const target = state.vol;
                    let v = 0;
                    const step = target / 8;
                    const iv = setInterval(() => {
                        v += step;
                        if (v >= target) { node.volume = target; clearInterval(iv); return; }
                        node.volume = v;
                    }, 5);
                }

                delete saved[sid];
            });
        }
    });
}
```

**Pozicija restore**: Ako je browser pomerio `currentTime` tokom hidden stanja (neki browser-i to rade), seek nazad na sacuvanu poziciju. Tolerancija: 0.5s (manja razlika je prihvatljiva).

**Fade-in**: 8 koraka × 5ms = 40ms gradual volume ramp. Sprecava "pop" artefakt pri naglom volume skoku.

#### Generisani TypeScript — Init sekvenca (linije 591-638)

```typescript
function waitForPlayer(): Promise<any> {
    return new Promise((resolve) => {
        let elapsed = 0;
        function check(): void {
            const p = (soundManager as any)?.player;
            if (p?._soundSprites?.size > 0 && p?._soundUrl) { resolve(p); return; }
            elapsed += 50;
            if (elapsed >= 30000) { warn("SoundPlayer timeout"); resolve(null); return; }
            setTimeout(check, 50);
        }
        check();
    });
}
```

**Poll svakih 50ms** dok player ne bude spreman. Dva uslova:
1. `_soundSprites.size > 0` — setSounds() je pozvan
2. `_soundUrl` postoji — setRawUrls() je pozvan

**Timeout 30s** — ako player nije spreman za 30s, odustaje (igra nastavlja bez muzike).

```typescript
async function init(): Promise<void> {
    try {
        const player = await waitForPlayer();
        if (!player) return;

        let ok = 0;
        const results = MUSIC.map((name) => {
            const url = getResolvedUrl(player, name);
            if (!url) { warn(name, "— URL not found"); return Promise.resolve(false); }
            return registerHtml5(name, url, player);
        });

        const outcomes = await Promise.all(results);
        outcomes.forEach((r) => { if (r) ok += 1; });

        if (ok === 0) { warn("no tracks registered"); return; }

        replayMissedCommands(player);
        setupVisibilityHandler(player);

        log("done — ~" + (ok * 3) + "MB RAM (saved ~" + (ok * 37) + "MB)");
    } catch (e) {
        warn("init error (game continues):", e);  // NIKAD ne srusi igru
    }
}

init();
export const BGM_STREAMING_ACTIVE = true;
```

**Redosled init-a:**
1. Cekaj player → 2. Registruj sve HTML5 Howl-ove paralelno → 3. Replay propustene komande → 4. Postavi visibility handler

**`try-catch` na celom init-u**: Greska u BGMStreamingInit NIKAD ne srusava igru. Muzika nece svirati, ali SFX i gameplay nastavljaju normalno.

**`export BGM_STREAMING_ACTIVE = true`**: webpack tree-shaking ne moze ukloniti ovaj modul jer je export koriscen u `main.ts`:
```typescript
import { BGM_STREAMING_ACTIVE } from "./utils/BGMStreamingInit";
if (BGM_STREAMING_ACTIVE) { /* webpack: keep */ }
```

### 40.9 Step 8: Deploy u game repo (linije 647-702)

```javascript
const gameSrcTs = path.join(gameRepoAbs, 'src', 'ts');

// Kopiraj BGMStreamingInit.ts
const utilsDir = path.join(gameSrcTs, 'utils');
if (!fs.existsSync(utilsDir)) fs.mkdirSync(utilsDir, { recursive: true });
fs.copyFileSync(distTsPath, path.join(utilsDir, 'BGMStreamingInit.ts'));
```

- Kreira `utils/` ako ne postoji
- Overwrite-uje postojeci fajl (uvek svez)

```javascript
// Patch main.ts
let mainLines = fs.readFileSync(mainTsPath, 'utf8').split('\n');

// 1. Ukloni SVE postojece BGMStreamingInit reference
mainLines = mainLines.filter(l =>
    !l.includes('BGMStreamingInit') && !l.includes('BGM_STREAMING_ACTIVE')
);

// 2. Pronadji poslednji import statement
let lastImportLine = -1;
for (let i = 0; i < mainLines.length; i++) {
    if (/^\s*import\s/.test(mainLines[i])) {
        lastImportLine = i;
        // Handle multi-line imports
        if (!mainLines[i].includes(';') && !mainLines[i].includes('from')) {
            for (let j = i + 1; j < mainLines.length; j++) {
                if (mainLines[j].includes('from') || mainLines[j].includes(';')) {
                    lastImportLine = j;
                    break;
                }
            }
        }
    }
}

// 3. Dodaj import posle poslednjeg
mainLines.splice(lastImportLine + 1, 0,
    'import { BGM_STREAMING_ACTIVE } from "./utils/BGMStreamingInit";',
    'if (BGM_STREAMING_ACTIVE) { /* webpack: keep */ }'
);

fs.writeFileSync(mainTsPath, mainLines.join('\n'), 'utf8');
```

**Pristup je IDEMPOTENTAN**: Svaki run brise stare BGM linije pre dodavanja novih. Moze se pokrenuti vise puta bez dupliranja.

**Multi-line import handling**: Neki import-i u igri mogu biti multi-line:
```typescript
import {
    BaseCommand
} from "playa-core";
```
Regex proverava da li linija ima `;` ili `from` — ako ne, trazi zavrsni red.

### 40.10 Summary output (linije 704-734)

Ispisuje rezime: broj SFX sprite-ova, broj streaming traka, ukupna velicina, RAM usteda, i arhitekturni dijagram.

---

## QA Verdikt za deployStreaming.js

### Verificirano i RADI u produkciji:

| Aspekt | Status |
|--------|--------|
| WAV premestanje + restore (3 nivoa zastite) | ✅ Robustno |
| SFX build sa optimized fallback | ✅ |
| SHA-256 cache sa enc settings invalidacijom | ✅ |
| Paralelno FFmpeg enkodiranje | ✅ |
| Propadeli track ne zaustavljaju build | ✅ |
| sounds.json azuriranje sa loadType "M" | ✅ |
| BGMStreamingInit.ts generacija | ✅ |
| URL rezolucija (2 nivoa) | ✅ |
| Gapless loop (rAF + mute-seek-unmute) | ✅ |
| HTML5 Howl registracija (4-korak sekvenca) | ✅ |
| replayMissedCommands (3 boot komande) | ✅ |
| Tab visibility (save/restore + fade-in) | ✅ |
| Init sa try-catch (nikad ne srusi igru) | ✅ |
| main.ts patching (idempotentan) | ✅ |
| Parcijalni M4A cleanup pri gresku | ✅ |

### Pronadjeni detalji koji NISU bili u ULTIMATE dokumentu:

| # | Detalj | Sekcija gde je sad dodat |
|---|--------|--------------------------|
| 1 | `removeAllListeners('exit')` posle rucnog restore-a | 40.5 |
| 2 | `-movflags +faststart` za brzi streaming | 40.6 |
| 3 | sox vs exiftool za duration (razliciti alati) | 40.6 |
| 4 | `resolve(null)` umesto reject za parcijalne greske | 40.6 |
| 5 | 86400000ms dummy sprite duration | 40.8 |
| 6 | `_playStart` postavljanje za playa-core kompatibilnost | 40.8 |
| 7 | Stale sprite cleanup iz tag listi PRE addHowl | 40.8 |
| 8 | replayMissedCommands trazi 3 specificne komande | 40.8 |
| 9 | `musicSet.delete()` za anti-dupli replay | 40.8 |
| 10 | Volume=0 umesto pause za tab hidden (cuva poziciju) | 40.8 |
| 11 | 0.5s tolerancija za position restore | 40.8 |
| 12 | 8×5ms gradual fade-in (40ms ramp) | 40.8 |
| 13 | webpack keep pattern sa export | 40.8 |
| 14 | Multi-line import handling u main.ts patching | 40.9 |
| 15 | Idempotentan pristup (brise stare → dodaje nove) | 40.9 |
| 16 | `-c:a aac` flag (native, ne libfdk_aac) cak sa FDK binarnim | 40.6 |

---

## 41. Tri build sistema — uporedna analiza

> Aplikacija ima TRI build pipeline-a koji rade istu stvar na razlicite nacine.
> Ova sekcija dokumentuje SVAKU razliku izmedju njih.

### 41.1 Pregled

| # | Skripta | LOC | Tip | Koristi se kad |
|---|---------|-----|-----|----------------|
| A | `createAudioSpritesBySize.js` + `makeMyJSONSizedSprites.js` | 162+374 = 536 | Legacy (sinhroni) | Fallback ako optimized ne postoji |
| B | `buildSpritesOptimized.js` | 532 | Optimized (async) | Default ako postoji u `scripts/` |
| C | `deployStreaming.js` | 735 | Streaming pipeline | Kad igra ima streaming muziku |

**Odnos**: C poziva A ili B za SFX build (Step 2-3), zatim dodaje streaming logiku (Steps 5-8).

### 41.2 Kako se biraju

```javascript
// deployStreaming.js (L96-105):
const optimizedScript = path.join('.', 'scripts', 'buildSpritesOptimized.js');
const useOptimized = fs.existsSync(optimizedScript);

if (useOptimized) {
    execSync('node scripts/buildSpritesOptimized.js', ...);
} else {
    execSync('node scripts/createAudioSpritesBySize.js', ...);
}

// Ako je useOptimized, Step 3 se preskace (optimized vec generise sounds.json)
if (!useOptimized) {
    execSync('node scripts/makeMyJSONSizedSprites.js audioSprite', ...);
}
```

**BuildPage.jsx** koristi `run-script` IPC handler sa imenom iz `package.json scripts`:
- `npm run build` → pokrece `buildTiered.js` (tiered build) ILI `createAudioSpritesBySize.js` (size-based)
- `npm run deploy` → pokrece `deployStreaming.js` ILI `copyAudio.js`

### 41.3 Legacy: createAudioSpritesBySize.js (162 LOC)

#### Kriticni problemi

**Problem 1: `fs.rmdirSync(distDir, { recursive: true })` (L20)**
```javascript
fs.rmdirSync(distDir, { recursive: true });  // BRISE CEO dist/ FOLDER!
fs.mkdirSync(outDir, { recursive: true });
```
**OPASNO**: Brise CEO `dist/` direktorijum na svakom build-u. Ako neko ima fajlove u `dist/` (npr. streaming M4A, sounds.json od prethodnog build-a), SVE se gubi. Optimized verzija NE radi ovo — samo kreira `outDir` ako ne postoji.

**Problem 2: Sinhroni callback-based build (L138-161)**
```javascript
function createAudioSprite(audioFiles, fileNumber, opts) {
    audiosprite(pathToFFmpeg, audioFiles, opts, fileNumber, function(err, obj) {
        if (err) return console.error(err);   // SAMO loguje — NE exit(1)!
        fs.writeFile(outDir + "soundData" + fileNumber + ".json", ...);
    });
}
```
**Problemi**:
- Callback-based — nema `await`, nema garancije reda
- `console.error(err)` umesto `process.exit(1)` — greska se TIHO GUTA
- Vise sprite-ova se builduje SIMULTANO ali bez kontrole (race condition na `outDir`)
- `writeFile` je async bez cekanja — sledeci proces moze poceti pre nego sto JSON bude napisan

**Problem 3: Nema cache**
Nema SHA-256 cache — SVAKI run rebuilda SVE sprite-ove, cak i kad se nista nije promenilo.

**Problem 4: Nema gap konfiguraciju**
Ne cita `spriteGap` iz sprite-config.json — koristi default audiosprite gap (~1s).

**Problem 5: Stari chunk algoritam (L51-73)**
```javascript
while(remaining.length > 0 && remaining[count] !== undefined) {
    let fileSize = getFileSizeInMegaBytes(remaining[count]);
    totalFileSize = totalFileSize + fileSize;
    if(totalFileSize >= maxMB) {
        if(count === 0) count = 1;  // edge case: fajl > maxMB
        chunks.push(remaining.splice(0, count));
```
Splice-based mutacija niza — radi ali nepotrebno komplikovano vs optimized verzija.

### 41.4 Optimized: buildSpritesOptimized.js (532 LOC)

#### Poboljsanja vs Legacy

| Aspekt | Legacy | Optimized |
|--------|--------|-----------|
| dist/ brisanje | `rmdirSync(distDir)` — BRISE SVE | `mkdirSync(outDir)` — samo kreira ako ne postoji |
| Flow | Callback-based, fire-and-forget | Promise-based, `await Promise.allSettled()` |
| Error handling | `console.error(err)` — tihi fail | `process.exit(1)` na svakoj gresku |
| Cache | Nema | SHA-256 per-WAV + template + sprite-config hash |
| Gap | Default (~1s) | Cita `spriteConfig.spriteGap` (default 0.05) |
| JSON generacija | Posebna skripta (makeMyJSONSizedSprites) | Integrisana — jedan proces |
| Validacija | Nema | Proverava M4A exist + size, soundSprite→manifest refs |
| Broken ref cleanup | Nema | Cisti commands/spriteLists za obrisane zvukove |
| JSON-only rebuild | Nema | Detektuje kad su samo JSON/config promenjeni → preskace sprite build |
| Stale M4A cleanup | Nema | Brise stare M4A sa razlicitim sprite brojem |

#### SHA-256 Cache detalji (razlike od deployStreaming)

| Aspekt | buildSpritesOptimized | deployStreaming |
|--------|----------------------|-----------------|
| Cache fajl | `dist/.build-cache.json` | `dist/.streaming-cache.json` |
| Hash duzina | Kompletni hex (64 char) | Kompletni hex (64 char) |
| Enc settings key | Nema (koristi sprite-config hash) | `bitrate\|channels\|samplerate` |
| File list tracking | `_fileList: allFiles.join(',')` | Nema |
| Template hash | `_templateHash: sha256(sounds.json)` | Nema |
| Config hash | `_scHash: sha256(sprite-config.json)` | Nema |
| Invalidacija | WAV promena ILI file list promena ILI JSON/config promena | WAV promena ILI enc settings promena |

#### Inkrementalni build logika

```
1. Proveri da li su se WAV-ovi promenili     → filesChanged
2. Proveri da li se lista fajlova promenila  → structureChanged (dodat/obrisan WAV)
3. Proveri da li se JSON/config promenio     → jsonChanged

Ako nista → "No changes detected — skipping build"
Ako samo JSON → JSON-only rebuild (reuse M4A, regenerisi sounds.json)
Ako WAV promenjen → Full rebuild (sve iznova)
```

**JSON-only rebuild je KRITICNO poboljsanje**: Ako developer promeni samo komande ili tagove u sounds.json, NE rebuilda sprite-ove (stedii 30-60 sekundi).

#### Paralelni build

```javascript
const results = await Promise.allSettled(
    buildJobs.map(job =>
        buildSprite(job.files, job.spriteNum, job.opts)
            .then(data => ({ spriteNum: job.spriteNum, soundData: data, type: job.type }))
    )
);
```

`Promise.allSettled` — ne `Promise.all`. Razlika: `allSettled` NIKAD ne rejectuje — ceka da svi zavrse, pa proverava `status === 'rejected'` za svaki. Ovo znaci da se NE zaustavljaju ostali buildovi ako jedan propadne.

### 41.5 deployStreaming.js — SFX + Streaming

deployStreaming.js je **superset** koji:
1. Privremeno sklanja streaming WAV-ove
2. Poziva A ili B za SFX build
3. Vraca streaming WAV-ove
4. Enkodira streaming kao individualne M4A
5. Azurira sounds.json sa loadType "M"
6. Generise BGMStreamingInit.ts
7. Deploy-uje u game repo

#### Razlike u FFmpeg pozivima

| Aspekt | Legacy/Optimized (SFX) | deployStreaming (Streaming) |
|--------|------------------------|---------------------------|
| Alat | `customAudioSprite.js` (wrapper) | Direktan `execFile(ffmpeg)` |
| Encoder | Per-category (sfx/music) | Uvek `encoding.music` |
| Flag | `-c:a aac` ili `-c:a libfdk_aac` (zavisno od customAudioSprite) | Uvek `-c:a aac` |
| Faststart | Zavisi od customAudioSprite | Uvek `-movflags +faststart` |
| Output | Sprite fajl (vise zvukova u jednom M4A) | Individualni M4A (jedan zvuk po fajlu) |
| Duration | audiosprite racuna iz sprite map | sox.identify (sampleCount / sampleRate) |
| Cache | SHA-256 per-WAV (optimized) ili nema (legacy) | SHA-256 per-WAV sa enc settings key |
| Greska | exit(1) (optimized) ili tihi fail (legacy) | resolve(null) — nastavlja sa ostalim |

#### Duration preciznost — sox vs exiftool vs sprite map

| Metoda | Koristi je | Preciznost | Jedinica |
|--------|-----------|------------|----------|
| sox.identify | buildSpritesOptimized, deployStreaming | `sampleCount * 100000 / sampleRate / 100` | ms, 2 decimale |
| exiftool | buildTieredJSON.js | Cita Duration metadata iz M4A | ms |
| Sprite map | customAudioSprite output | `[startMs, durationMs]` iz audiosprite | ms, celobrojno |

**Potencijalna razlika**: sox i sprite map mogu dati razlicite durations za isti zvuk (sox cita WAV direktno, sprite map dolazi iz ffmpeg-ovog proracuna posle enkodiranja). buildSpritesOptimized koristi sox kao primarni izvor, sprite map kao fallback.

### 41.6 isMusicSound() — identicna u obe skripte

```javascript
// Ista funkcija u createAudioSpritesBySize.js I buildSpritesOptimized.js:
function isMusicSound(name) {
    return /Music|MusicLoop|BigWinLoop|BigWinEnd|BigWinIntro|BonusGameEnd/i.test(name)
        && !/Coin|Spins|Rollup|Counter|CoinShower|Amb/i.test(name);
}
```

**VAZNO**: Ova funkcija je RAZLICITA od auto-assign logike u SpriteConfigPage.jsx. SpriteConfigPage koristi mnogo detaljnije pattern-e (sekcija 37). `isMusicSound()` je samo za SFX/Music encoding split u size-based build-u.

**NE koristi se u buildTiered.js** — tiered build cita Music tagove iz template sounds.json umesto regex-a.

### 41.7 Stanje u aplikaciji — koji build se koristi gde

```
package.json scripts:
  "build":          "node scripts/buildTiered.js && node scripts/buildTieredJSON.js"
  "build-validate": "node scripts/validateBuild.js"
  "deploy":         "node scripts/copyAudio.js"

BuildPage.jsx dugmad:
  [Build]     → api.runScript('build')     → buildTiered + buildTieredJSON
  [Validate]  → api.runScript('build-validate') → validateBuild
  [Deploy]    → api.runDeploy('deploy')    → copyAudio

  [Build Streaming] → api.runScript('deploy-streaming') → deployStreaming.js
                      (deployStreaming interno poziva buildSpritesOptimized ILI createAudioSpritesBySize)
```

### 41.8 Preporuke

| Build | Kad koristiti | Status |
|-------|--------------|--------|
| buildTiered + buildTieredJSON | Tiered pool build (loading/main/bonus/standalone) | ✅ Produkcija — za igre sa SubLoader poolovima |
| buildSpritesOptimized | Size-based build (legacy igre bez poolova) | ✅ Produkcija — zamena za legacy |
| createAudioSpritesBySize + makeMyJSONSizedSprites | Legacy build | ⚠️ Samo kao fallback — ima poznate probleme |
| deployStreaming | Streaming muzike + SFX build | ✅ Produkcija — testirano, radi u igri |

**Legacy bi trebalo deprecirati**: `createAudioSpritesBySize.js` ima kriticne probleme (brise dist/, tihi fail, nema cache, nema gap config). `buildSpritesOptimized.js` je drop-in zamena sa istim outputom.

---

## 42. SubLoader auto-trigger — workaround bez game devova

### 42.1 Problem

`startSubLoader("A"/"B")` zahteva da game developer doda 2 linije u kod igre. Mi imamo pristup game repo-u i vec patchujemo `main.ts` za BGMStreamingInit. Mozemo li automatski triggerovati SubLoadere?

### 42.2 Kako startSubLoader radi interno

**Kompletni call chain** (verificiran iz playa-core i playa-slot source koda):

```
Game kod: slotProps.startSubLoader("A")
    │
    ▼ SlotProps.ts:741-751
    │
    public startSubLoader(subLoaderID: string): void {
        const subLoader = this.system.loadStatus[subLoaderID];
        if (subLoader !== undefined) {
            subLoader.subLoaderTrigger = true;   ← MobX observable
        }
    }
    │
    ▼ MobX reaction u SubLoader.ts:105-107
    │
    SubLoader detektuje subLoaderTrigger === true
    │
    ▼ SubLoader.ts:170-194
    │
    this.startSubLoader()  ← INTERNI metod
        ├── getSubLoaderSoundList(subLoaderID)
        ├── Za svaki zvuk: addLoadItem(srcRef)
        └── Paralelno ucitavanje → addHowl() → komande rade
```

**Kljucni uvid**: `startSubLoader()` ne radi nista magicno — samo postavlja `subLoaderTrigger = true` na MobX observable. SubLoader REAGUJE automatski.

### 42.3 Dva nacina pristupa

**Oba su singleton exporti — ne zahtevaju instanciranje, dostupni iz BILO KOG modula:**

#### Put A — Kroz slotProps (javni API)

```typescript
import { slotProps } from "playa-slot";
slotProps.startSubLoader("A");
```

- `slotProps` je exportovan iz `playa-slot/src/ts/index.ts:60` kao `slotStore.props`
- Ovo je isti API koji game devovi koriste
- `@action.bound` dekorator — MobX action, safe za poziv spolja

#### Put B — Direktan pristup MobX observable-u (zaobilazi slotProps)

```typescript
import { systemProps } from "playa-core";
const loadStatus = (systemProps as any).loadStatus;
if (loadStatus?.["A"]) loadStatus["A"].subLoaderTrigger = true;
```

- `systemProps` je exportovan iz `playa-core/src/ts/index.ts`
- `loadStatus` je `SystemProps.ts:58-60` — getter za `data.loadStatus`
- Ovo je ISTI mehanizam koji `SlotProps.startSubLoader` koristi interno

**Preporuka**: Put A (`slotProps` import) — cistiji, koristi javni API, manje krhak.

### 42.4 Koncept: SubLoaderAutoInit.ts

Auto-generisan modul (isti pattern kao BGMStreamingInit.ts):

```typescript
/**
 * SubLoaderAutoInit.ts — Auto-generated by deployStreaming.js
 *
 * Proaktivno triggeruje SubLoader "A" i "B" posle main load-a.
 * Eliminise potrebu za game dev intervencijom.
 * Wrapped u try-catch — nikad ne spreci igru da se ucita.
 */

import { slotProps } from "playa-slot";
import { soundManager } from "playa-core";

const TAG = "[SubLoaderAuto]";

(function init(): void {
    try {
        let elapsed = 0;

        function check(): void {
            const p = (soundManager as any)?.player;
            // Cekaj da main load zavrsi (isti check kao BGMStreamingInit)
            if (!(p?._soundSprites?.size > 0 && p?._soundUrl)) {
                elapsed += 100;
                if (elapsed < 30000) setTimeout(check, 100);
                else console.warn(TAG, "timeout — SubLoaders not triggered");
                return;
            }

            // ── Main load zavrsio — triggeruj A ──
            console.log(TAG, "triggering SubLoader A (main pool)");
            try { slotProps.startSubLoader("A"); } catch (e) {
                console.warn(TAG, "A failed:", e);
            }

            // ── SubLoader queue je FIFO — B automatski ceka da A zavrsi ──
            // Kratka pauza da se A registruje u queue pre B
            setTimeout(() => {
                console.log(TAG, "triggering SubLoader B (bonus pool)");
                try { slotProps.startSubLoader("B"); } catch (e) {
                    console.warn(TAG, "B failed:", e);
                }
            }, 200);
        }

        check();
    } catch (e) {
        console.warn(TAG, "init error (game continues):", e);
    }
})();

export const SUB_LOADER_AUTO_INIT = true;
```

### 42.5 Kako bi se deploy-ovao

Isti mehanizam kao BGMStreamingInit — `deployStreaming.js` bi:

1. Generisao `SubLoaderAutoInit.ts` u `dist/`
2. Kopirao u `game/src/ts/utils/SubLoaderAutoInit.ts`
3. Patchovao `main.ts`:
   ```typescript
   import { SUB_LOADER_AUTO_INIT } from "./utils/SubLoaderAutoInit";
   if (SUB_LOADER_AUTO_INIT) { /* webpack: keep */ }
   ```

### 42.6 Timing i queue ponasanje

```
T=0ms       Main load pocinje (loading sprite, standalone muzika)
T=2-5s      Main load zavrsava → player._soundSprites.size > 0
T=2-5s      SubLoaderAutoInit detektuje → startSubLoader("A")
T=2.2-5.2s  startSubLoader("B") (200ms posle A)
            B ulazi u FIFO queue — ceka da A zavrsi
T=5-10s     SubLoader A zavrsava ucitavanje → B automatski pocinje
T=8-15s     SubLoader B zavrsava → SVI zvuci ucitani
```

**Igrac ne primecuje nista** — loading screen je vec prosao, igra radi normalno dok se A i B ucitavaju u pozadini.

### 42.7 Tradeoff analiza

| Aspekt | Pro | Con |
|--------|-----|-----|
| Bandwidth | Bonus audio (~1-2MB) se uvek download-uje | Na modernoj mrezi zanemarljivo |
| Memorija | Bonus audio (~20-30MB decoded) uvek u RAM-u | Posto unload ne radi ionako, nema razlike |
| Timing | Svi zvuci spremni pre nego sto igrac treba | Nema |
| Dev zavisnost | 0 linija game koda potrebno | Nema |
| Rizik | try-catch — nikad ne srusi igru | SubLoader koji ne postoji loguje warning (bezopasno) |

### 42.8 Edge cases

**SubLoader ne postoji** (igra nema loadType "A" ili "B"):
```typescript
// SlotProps.startSubLoader():
const subLoader = this.system.loadStatus[subLoaderID];
if (subLoader !== undefined) {
    subLoader.subLoaderTrigger = true;
} else {
    console.log("█SUB_LOADER█ ... subLoader does not exist.");
    // SAMO log — nema exception, nema crash
}
```
Bezopasno — loguje upozorenje i nastavlja.

**SubLoader vec triggerovan** (game dev vec dodao startSubLoader u kod):
- `subLoaderTrigger` je vec `true` — postavljanje na `true` ponovo je NO-OP
- MobX reaction se ne triggeruje ponovo za istu vrednost
- Bezopasno — dupli poziv ne pravi problem

**Igra bez playa-slot** (ne-slot igra):
- `import { slotProps } from "playa-slot"` ce pasti pri webpack build-u
- Resenje: dinamicki import sa try-catch, ili provera da li modul postoji

### 42.9 Gde pristupiti slotProps — kompletna mapa

| Singleton | Paket | Import | Sta nudi |
|-----------|-------|--------|----------|
| `soundManager` | `playa-core` | `import { soundManager } from "playa-core"` | `.execute()`, `.player`, `.toggleAllSounds()` |
| `systemProps` | `playa-core` | `import { systemProps } from "playa-core"` | `.loadStatus` (MobX observable za SubLoadere) |
| `loaderService` | `playa-core` | `import { loaderService } from "playa-core"` | `.createSubLoaderById()`, `.soundLoader` |
| `slotProps` | `playa-slot` | `import { slotProps } from "playa-slot"` | `.startSubLoader()`, `.stage`, `.system` |
| `slotActions` | `playa-slot` | `import { slotActions } from "playa-slot"` | `.spin()`, `.stop()`, game actions |

**Svi su singleton-i — importuju se jednom, zive ceo lifetime igre.**

### 42.10 Kompletni call chain za svaki SubLoader metod

#### startSubLoader (RADI)

```
slotProps.startSubLoader("A")
  └── SlotProps.ts:744 → system.loadStatus["A"].subLoaderTrigger = true
      └── MobX reaction u SubLoader.ts:107
          └── SubLoader.startSubLoader()
              └── soundLoader.getSubLoaderSoundList("A") → [{srcRef, id}, ...]
                  └── Za svaki: soundLoader.loadSubLoaderAudio(srcRef, id, callback)
                      └── Kreira Howl → Na "load": player.addHowl(howl, srcRef, id)
                          └── SoundSprite kreiran sa pravim Howl-om → komande rade
```

#### unloadSubLoader (NE RADI — nije implementirano)

```
slotProps nema unloadSubLoader() metodu
SoundPlayer nema unloadHowl() metodu
SubLoader nema unload logiku
loadStatus nema "unload trigger"

→ NEMA mehanizma za runtime unload u playa-core
→ "unloadable: true" u manifestu je samo metadata signal
→ Jednom ucitan, zvuk ostaje u memoriji do reload-a stranice
```

### 42.11 Sta ceka implementaciju (playa-core tim)

| Funkcionalnost | Status | Ko implementira |
|----------------|--------|-----------------|
| `startSubLoader("A"/"B")` | ✅ RADI | Vec gotovo — mi auto-triggerujemo |
| `unloadSubLoader("B")` | ❌ NE POSTOJI | playa-core tim mora dodati: SubLoader.unload() + SoundPlayer.unloadHowl() |
| Runtime memory oslobadjanje | ❌ NE POSTOJI | playa-core tim: howl.unload() + delete _howlInstances + cleanup _soundSprites |
| `unloadable: true` flag citanje | ❌ MRTAV METADATA | playa-core tim: treba da ga cita i reaguje |

---

## 43. Oficijalna IGT/GDK dokumentacija — poredjenje i nedostajuci detalji

> Izvor: PlayDigital GDK — Foundry dokumentacija
> "How to Use Deferred Loading" + "How to Use Initial and Secondary Assets"
> Autor: Sonja Damjanić, poslednji update Feb 2026

### 43.1 Kompletna loadType tabela (oficijalna + nasa prosirenja)

| loadType | Ime | Ponasanje | Ko triggeruje | Izvor |
|----------|-----|-----------|---------------|-------|
| `"-"` ili nema | Main load | Ucitava se pre pokretanja igre | Automatski | Oficijalni GDK |
| `"Z"` | Lazy Load | **Automatski** odmah posle main load-a | Framework (NEMA game koda) | Oficijalni GDK |
| `"I"` | Initial/Secondary | Main ucitava kompresovanu verziju, posle swap-uje full-res | Framework automatski | Oficijalni GDK |
| `"A"` — `"F"` | Deferred | Ucitava se na zahtev | Game kod: `slotProps.startSubLoader("X")` | Oficijalni GDK |
| `"M"` | Music Streaming | playa-core resolvuje URL ali NE ucitava | BGMStreamingInit (nasa skripta) | **NASA INOVACIJA** |
| `"S"` | Streaming (legacy) | Isto kao "M" | Custom kod | **NASA INOVACIJA** |

### 43.2 Lazy Load ("Z") — detalji iz oficijalne dokumentacije

**Definicija**: Ucitavanje koje pocinje **automatski** po zavrsetku main load-a i inicijalizacije igre. Odvija se u pozadini, osim ako korisnik triggeruje sadrzaj pre zavrsetka.

**Tri scenarija** (oficijalni GDK):

**Scenario 1 — Najcesci (korisnik ne primecuje nista):**
> Lazy loading is complete before the game reaches a point of requiring the lazy loaded assets, so the game continues as it would have done if everything had been front loaded.

**Scenario 2 — Korisnik je srecan (bonus na prvom spinu):**
> The user is lucky enough to trigger the part of the game requiring the lazy loaded assets, before they have finished loading. In which case, the game would show a secondary loading screen or panel (likely styled to that part of the game). The loading percentage would already be somewhat progressed toward completion.

**Scenario 3 — Game-In-Progress:**
> The user triggers a Game-In-Progress situation. In this case, the secondary loading screen or panel would be shown as soon as the main load is complete. Upon full load, the game would continue as normal.

**Kriticno**: "Z" zvuci se NE MOGU pustiti pre zavrsetka ucitavanja. Pokusaj reprodukcije pre load-a baca gresku:
> You must remember that you cannot call/play a sound in the game, if you have not loaded the asset. This will cause an error, since the sound will not yet exist.

Ali u praksi, SoundSprite se kreira sa `howl = undefined` na boot-u — komande tiho propadaju (ne baca se exception, samo nema zvuka). Kad lazy load zavrsi, `addHowl()` zameni undefined sa pravim Howl-om i komande pocinju da rade.

### 43.3 loadType "I" — Initial/Secondary Assets

**Namena**: Primarno za grafiku (WebP kompresija), ali loadType "I" radi za SVE asset tipove ukljucujuci zvuk.

**Mehanizam**:
1. Main load ucitava **inicijalnu** verziju asseta (kompresovaniju, manju)
2. Igra postaje interaktivna odmah
3. U pozadini se ucitava **sekundarna** verzija (full resolution)
4. Kad sekundarna zavrsi: `loadService.onReplaceAssetFinished("I", callback)` triggeruje zamenu

**Za grafiku**: `@1x` WebP (manja) → full WebP (veca)
**Za zvuk**: Teorijski moguce ali nema prakticne primene — audio kvalitet na 64kbps je vec prihvatljiv, nema potrebe za "initial low-quality → swap to high-quality" pattern

**Pravilno praćenje zamene asset-a:**
```typescript
const loadStatus = (slotProps.loadStatus as any).I;
if (loadStatus && loadType === "I") {
    loadService.onReplaceAssetFinished("I", (): Promise<void> => {
        return new Promise(async (resolve) => {
            // Zameni grafiku sa full-res verzijom
            this._spineAnim = this.container.getChildByName("anim") as SpineAnimation;
            resolve();
        });
    });
}
```

### 43.4 SubLoader progress monitoring — MobX observables

**Nedostajalo u nasem doc-u.** playa-core eksponira progress za svaki SubLoader:

```typescript
const loadStatus = slotProps.loadStatus;

// Za lazy load ("Z"):
const lazyStatus = (loadStatus as any).Z;
if (lazyStatus) {
    // MobX reaction — reaguje na promene
    reaction(
        () => lazyStatus.subLoaderPercent || lazyStatus.subLoaderComplete,
        () => {
            console.log('Progress:', lazyStatus.subLoaderPercent + '%');
            if (lazyStatus.subLoaderComplete) {
                console.log('Lazy load complete!');
            }
        }
    );
}

// Za deferred load ("A"):
const deferredStatus = (loadStatus as any).A;
if (deferredStatus) {
    reaction(
        () => deferredStatus.subLoaderPercent || deferredStatus.subLoaderComplete,
        () => {
            if (deferredStatus.subLoaderComplete) {
                // Svi "A" zvuci su ucitani i spremni za reprodukciju
            }
        }
    );
}
```

**Dostupna polja na svakom SubLoader loadStatus:**

| Polje | Tip | Opis |
|-------|-----|------|
| `subLoaderTrigger` | `boolean` (MobX observable) | `true` = ucitavanje pokrenuto |
| `subLoaderPercent` | `number` (0-100) | Procenat zavrsetka |
| `subLoaderComplete` | `boolean` | `true` = sve ucitano |
| `subLoaderStarted` | `boolean` | `true` = ucitavanje u toku |

**Ovo mozemo koristiti u SubLoaderAutoInit.ts** za logovanje progresa u konzoli:
```typescript
const statusA = (slotProps.loadStatus as any).A;
if (statusA) {
    reaction(
        () => statusA.subLoaderComplete,
        () => {
            if (statusA.subLoaderComplete) {
                console.log("[SubLoaderAuto] Pool A complete — triggering B");
                slotProps.startSubLoader("B");
            }
        }
    );
}
```

### 43.5 Layout placeholders za pending items

Oficijalna dokumentacija kaze:
> Lazy and Deferred loading has been set up to build the game layout as normal, on initial load. Code-generated placeholders are used so that during development you can see the game is built correctly, and any code that needs to reference items before the load is complete, has something to work with.

**Za zvuk**: Ovo se manifestuje kao SoundSprite sa `howl = undefined`. Placeholder postoji u `_soundSprites` Map-i, komande ga referenciraju, ali play() tiho propadne. Kad SubLoader zavrsi, `addHowl()` zameni placeholder sa pravim Howl-om.

### 43.6 Grupni loadType — NE RADI na runtime-u

Oficijalna dokumentacija eksplicitno upozorava:
> Currently, marking group nodes with a loadType has no effect at runtime. If you want to use deferred loading for all assets in a group, you need to set the loadType for each asset individually.

**Za zvuk**: Ovo znaci da SVAKI manifest entry mora imati loadType individualno. Ne moze se staviti loadType na "grupu" zvukova — nema takvog koncepta u sounds.json. **Nas buildTieredJSON.js vec radi ispravno** — postavlja loadType na svaki manifest entry individualno.

### 43.7 Sekundarni loading screen za deferred loadere

Oficijalna dokumentacija opisuje dva scenarija za deferred ("A"-"F"):

**Scenario 1**: Korisnik triggeruje deferred sadrzaj → loading screen se prikazuje → po zavrsetku igra nastavlja
**Scenario 2**: Game-In-Progress → loading screen cim main load zavrsi → po zavrsetku igra nastavlja

**Za audio**: Bonus intro animacija (2-3s) sluzi kao "loading screen" — kupuje vreme za SubLoader B. Ako je B vec ucitan (lazy ili proaktivan), animacija se jednostavno zavrsava i bonus pocinje odmah.

### 43.8 Queue ponasanje — potvrdeno u obe dokumentacije

Oficijalni GDK i nas doc se slazu:
- Samo **jedan SubLoader** se ucitava istovremeno
- FIFO redosled
- Kad jedan zavrsi, sledeci u redu automatski pocinje

### 43.9 Sta oficijalna dokumentacija NE pokriva (nasa inovacija)

| Tema | Oficijalni GDK | Nas ULTIMATE doc |
|------|----------------|-------------------|
| HTML5 streaming muzike | ❌ Ne pominje | ✅ Sekcije 12, 40 |
| loadType "M" / "S" | ❌ Ne postoji | ✅ Nasa inovacija |
| BGMStreamingInit auto-injection | ❌ | ✅ Auto-generisan, auto-deployed |
| Tiered sprite build | ❌ | ✅ buildTiered.js + buildTieredJSON.js |
| SubLoaderAutoInit | ❌ | ✅ Koncept u sekciji 42 |
| Howler.js internali | ❌ | ✅ Sekcije 2-4 |
| Web Audio API memorija | ❌ | ✅ Sekcija 5 |
| AAC encoder padding | ❌ | ✅ Sekcija 6 |
| Gapless HTML5 loop | ❌ | ✅ rAF mute-seek-unmute |
| unloadable flag | ❌ | ✅ Metadata signal (ceka implementaciju) |
| FDK/native encoder izbor | ❌ | ✅ Per-category sa dropdown-om |

---

## 44. Strategija "Z" za main pool — eliminacija game dev koda

### 44.1 Trenutna strategija vs predlozena

**Trenutna (loadType "A" za main pool):**
```
Boot → Main load (loading sprite)
     → Game postaje interaktivna
     → Igrac pritisne Spin
     → Game kod poziva startSubLoader("A")  ← ZAHTEVA GAME DEVOVE
     → SubLoader A ucitava main pool
     → Symbols, BigWin, Anticipation rade
```

**Predlozena (loadType "Z" za main pool):**
```
Boot → Main load (loading sprite)
     → Game postaje interaktivna
     → Framework AUTOMATSKI startuje lazy load "Z"  ← BEZ GAME KODA
     → Main pool se ucitava u pozadini
     → Igrac pritisne Spin (loading pool vec pokriva osnovne zvukove)
     → Do drugog/treceg spina: main pool ucitan
     → Symbols, BigWin, Anticipation rade
```

### 44.2 Kompletna tabela — sva tri scenarija

| Pool | Trenutno | Opcija A: Z+Auto | Opcija B: Full Auto |
|------|----------|-------------------|----------------------|
| loading | main load (nema loadType) | main load | main load |
| main | `"A"` + `startSubLoader("A")` u game kodu | **`"Z"` (automatski!)** | `"A"` + SubLoaderAutoInit |
| bonus | `"B"` + `startSubLoader("B")` u game kodu | `"B"` + SubLoaderAutoInit | `"B"` + SubLoaderAutoInit |
| standalone | main load | main load | main load |
| streaming | `"M"` + BGMStreamingInit | `"M"` + BGMStreamingInit | `"M"` + BGMStreamingInit |
| **Game dev linije** | **2** (startSubLoader A + B) | **0** | **0** |

### 44.3 Opcija A: "Z" za main, SubLoaderAutoInit za bonus

**Promene u buildTieredJSON.js:**
```javascript
// Trenutno:
if (subLoaderId) manifestEntry.loadType = subLoaderId;  // "A" ili "B"

// Novo:
if (tierConfig.lazyLoad) {
    manifestEntry.loadType = "Z";  // lazy — framework auto-triggeruje
} else if (subLoaderId) {
    manifestEntry.loadType = subLoaderId;  // "A"/"B" — deferred
}
```

**Promene u sprite-config.json:**
```json
{
    "sprites": {
        "loading": { "priority": 1, "sounds": [...] },
        "main":    { "priority": 2, "lazyLoad": true, "sounds": [...] },
        "bonus":   { "priority": 3, "subLoaderId": "B", "unloadable": true, "sounds": [...] }
    }
}
```

**SubLoaderAutoInit.ts (samo za bonus):**
```typescript
import { slotProps } from "playa-slot";
import { soundManager } from "playa-core";
import { reaction } from "mobx";

(function init(): void {
    try {
        let elapsed = 0;
        function check(): void {
            const p = (soundManager as any)?.player;
            if (!(p?._soundSprites?.size > 0)) {
                elapsed += 100;
                if (elapsed < 30000) setTimeout(check, 100);
                return;
            }

            // Lazy load "Z" se vec triggerovao automatski
            // Cekaj da "Z" zavrsi pa triggeruj "B"
            const statusZ = (slotProps.loadStatus as any).Z;
            if (statusZ) {
                reaction(
                    () => statusZ.subLoaderComplete,
                    (complete) => {
                        if (complete) {
                            console.log("[SubLoaderAuto] Lazy Z complete — triggering B");
                            try { slotProps.startSubLoader("B"); } catch (_e) { /* */ }
                        }
                    },
                    { fireImmediately: true }
                );
            } else {
                // Nema "Z" — triggeruj "B" odmah
                setTimeout(() => {
                    try { slotProps.startSubLoader("B"); } catch (_e) { /* */ }
                }, 500);
            }
        }
        check();
    } catch (e) {
        console.warn("[SubLoaderAuto] init error:", e);
    }
})();

export const SUB_LOADER_AUTO_INIT = true;
```

**Prednost Opcije A**:
- Main pool koristi framework mehanizam ("Z") — najcistije resenje
- Bonus pool ceka da "Z" zavrsi pre triggerovanja — ne takmice se za bandwidth
- `reaction()` sa `fireImmediately: true` — ako je "Z" VEC zavrsio, odmah triggeruje "B"

### 44.4 Opcija B: SubLoaderAutoInit za oba (A + B)

Ovo je koncept iz sekcije 42 — oba ostaju deferred ("A"/"B"), SubLoaderAutoInit triggeruje oba.

**Prednost**: Ne menja loadType logiku u build skriptama
**Mana**: Koristi "A" umesto "Z" — propusta framework automatizaciju

### 44.5 Rizici i edge cases za Opciju A

**1. Bandwidth konkurencija sa grafikom na "Z"**

Ako igra ima i grafiku na loadType "Z", audio i grafika se ucitavaju istovremeno posle main load-a. playa-core koristi `_concurrency: 5` za paralelne download-e — audio i grafika dele tih 5 slotova.

**Mitigation**: Audio sprite od 1-2MB je mali u poredjenju sa grafikom (10-50MB). Na modernoj mrezi (~20Mbps), 2MB se download-uje za ~1s. Grafika je veci bottleneck.

**2. "Z" ne moze biti vise od jednog**

Svi zvuci sa loadType "Z" idu u JEDAN SubLoader. Ne mozemo imati "Z" za main I "Z" za bonus — oba bi bila u istom SubLoader-u i ucitala se zajedno.

**Zato koristimo "Z" samo za main, "B" za bonus** — dva odvojena SubLoader-a, razliciti prioriteti.

**3. Korisnik pogodi bonus pre nego sto "Z" zavrsi (Scenario 2)**

Oficijalni GDK kaze: igra pokazuje secondary loading screen. Ali za audio: SoundSprite placeholder tiho propadne (nema zvuka 1-2s dok se ucitava), pa pocne da radi. Nema crash-a, nema loading screen-a za audio — samo kratka tisina.

**U praksi**: "Z" zavrsi za 2-5 sekundi posle boot-a. Sansa da korisnik pogodi bonus na PRVOM spinu (pre zavrsetka "Z") je statisticki minimalna. A cak i tada — loading sprite pokriva osnovne reel/win zvukove.

**4. SubLoader queue redosled**

Ako su i "Z" (main audio) i "Z" (grafika) u istom SubLoader-u, ucitavaju se paralelno unutar tog SubLoader-a. Nema konflikta — `loadSubLoaderAudio` i graficke load metode rade nezavisno.

Kad "Z" zavrsi, SubLoaderAutoInit triggeruje "B" — ulazi u queue kao prvi deferred. Nema cekanja.

**5. Dupla "Z" + "A" konfiguracija (backward compatibility)**

Ako stari game repo VEC ima `startSubLoader("A")` u kodu, a mi promenimo loadType na "Z":
- "A" SubLoader se kreira ali je PRAZAN (nema zvukova sa loadType "A")
- `startSubLoader("A")` poziv je NO-OP (prazan SubLoader, nista za ucitavanje)
- "Z" SubLoader ucitava sve main zvukove automatski
- **Bezopasno** — stari game kod ne kvari nista

### 44.6 Implementacione promene za Opciju A

| Fajl | Promena |
|------|---------|
| `sprite-config.json` | Novi flag: `"lazyLoad": true` na main tier-u |
| `buildTieredJSON.js` | Cita `lazyLoad` → postavlja `loadType: "Z"` umesto `subLoaderId` |
| `SpriteConfigPage.jsx` | Checkbox "Lazy Load (auto)" umesto/pored SubLoader ID dropdown-a |
| `deployStreaming.js` | Generise `SubLoaderAutoInit.ts` pored BGMStreamingInit.ts |
| `main.ts` patching | Dodaje import za SubLoaderAutoInit.ts |
| `CLAUDE.md` | Dokumentuje "Z" strategiju |

### 44.7 Preporuka

**Opcija A (Z + Auto)** je superiorna jer:
1. Koristi framework mehanizam — `"Z"` je dizajniran upravo za ovo
2. Eliminise SVE game dev linije (0 linija umesto 2)
3. MobX `reaction()` je robusniji od `setTimeout` za cekanje zavrsetka
4. Backward-kompatibilna — stari `startSubLoader("A")` pozivi postaju bezopasni NO-OP

**Pre implementacije treba verifikovati:**
- [ ] Da li igre koje vec imaju grafiku na "Z" imaju problem sa bandwidth-om kad dodamo i audio na "Z"
- [ ] Da li playa-core SubLoader queue ispravno hendluje tranziciju "Z" → "B"
- [ ] Testirati na jednoj igri (npr. cash-eruption) pre roll-out-a
