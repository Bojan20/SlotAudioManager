import React, { useState, useEffect, useMemo, useRef } from 'react';

function EncoderFooter({ config, project, fdkAvailable, setFdkAvailable }) {
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    setDownloading(true);
    try {
      const r = await window.api.upgradeFfmpeg();
      if (r?.error) { console.error('FDK download failed:', r.error); }
      else { setFdkAvailable(true); }
    } catch (e) { console.error('FDK download failed:', e.message); }
    setDownloading(false);
  };

  const estimate = useMemo(() => {
    if (!config?.encoding || !project?.sounds?.length) return null;
    const sfxEnc = config.encoding.sfx || { bitrate: 64 };
    const musicEnc = config.encoding.music || { bitrate: 64 };
    const streamingSounds = new Set(config.streaming?.sounds || []);

    let sfxTotalKB = 0, musicTotalKB = 0;
    for (const s of project.sounds) {
      if (streamingSounds.has(s.name)) {
        musicTotalKB += s.sizeKB;
      } else {
        sfxTotalKB += s.sizeKB;
      }
    }
    const sfxM4A = (sfxTotalKB / 250) * ((sfxEnc.keepOriginal ? 320 : sfxEnc.bitrate) / 8);
    const musicM4A = (musicTotalKB / 250) * ((musicEnc.keepOriginal ? 320 : musicEnc.bitrate) / 8);
    const totalKB = sfxM4A + musicM4A;
    return { totalMB: (totalKB / 1024).toFixed(1), sfxKB: Math.round(sfxM4A), musicKB: Math.round(musicM4A) };
  }, [config?.encoding, project?.sounds, config?.streaming?.sounds]);

  return (
    <div className="flex items-center gap-3 pt-2.5 border-t border-border/20 flex-wrap">
      {!fdkAvailable && (
        <button onClick={download} disabled={downloading}
          className={`text-[11px] py-1 px-2.5 rounded-md border transition-all ${downloading ? 'text-orange border-orange/30 cursor-wait' : 'text-text-dim border-border hover:text-text-secondary hover:border-border-bright'}`}>
          {downloading ? 'Downloading...' : 'Download FDK-AAC'}
        </button>
      )}
      {estimate && (
        <span className="text-[11px] text-text-dim ml-auto font-mono" title={`SFX: ~${estimate.sfxKB} KB · Music: ~${estimate.musicKB} KB`}>
          ~{estimate.totalMB} MB estimated
        </span>
      )}
    </div>
  );
}

const SUBLOADER_OPTIONS = [
  { value: 'A', label: 'SubLoader A' },
  { value: 'B', label: 'SubLoader B' },
  { value: 'C', label: 'SubLoader C' },
  { value: 'D', label: 'SubLoader D' },
  { value: 'E', label: 'SubLoader E' },
  { value: 'F', label: 'SubLoader F' },
  { value: 'Z', label: 'SubLoader Z  —  lazy' },
];

function buildSnippet(tierName, tierCfg) {
  const id = tierCfg.subLoaderId;
  const isLazy = id === 'Z';
  const lines = [
    `// ── ${tierName} pool — SubLoader "${id}" ──`,
    isLazy ? `// Lazy: call just before you need these sounds` : `// Deferred: start background load at the right lifecycle event`,
    `slotProps.startSubLoader("${id}");`,
  ];
  if (tierCfg.unloadable) {
    lines.push('', `// Unload ${tierName} from RAM when session ends:`, `loaderService.soundLoader.unloadSubLoader("${id}");`);
  }
  return lines.join('\n');
}

function computeAutoAssign(unassigned, config, soundsJson, musicTags) {
  const tierKeys = Object.keys(config.sprites || {});
  // Aliases: pattern tier name → possible sprite-config tier names
  const TIER_ALIASES = {
    loading: ['loading', 'boot', 'init', 'startup', 'base'],
    main: ['main', 'reel_win', 'bigwin', 'base_game', 'primary'],
    bonus: ['bonus', 'freespins', 'free_spins', 'holdandwin', 'picker'],
  };
  const resolveTier = (name) => {
    if (!name) return null;
    // Exact match
    const exact = tierKeys.find(k => k === name);
    if (exact) return exact;
    // Case-insensitive match
    const ci = tierKeys.find(k => k.toLowerCase() === name.toLowerCase());
    if (ci) return ci;
    // Alias match — check if any tier key matches known aliases for this pattern tier
    const aliases = TIER_ALIASES[name.toLowerCase()];
    if (aliases) {
      const aliasMatch = tierKeys.find(k => aliases.includes(k.toLowerCase()));
      if (aliasMatch) return aliasMatch;
    }
    // Fuzzy substring match
    return tierKeys.find(k => k.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(k.toLowerCase())) ?? null;
  };
  const PATTERNS = [
    // ── STREAMING: background music that loops ──
    { tier: 'streaming', re: /^BaseGameMusicLoop/i },
    { tier: 'streaming', re: /^AmbBg$/i },

    // Catch-all: any remaining music loops → streaming
    { tier: 'streaming', re: /Music(?:Loop)?$/i },
    { tier: 'streaming', re: /MusicLoop/i },

    // ── LOADING: minimum for first spin ──
    // UI controls
    { tier: 'loading', re: /^Ui[A-Z]/i },
    { tier: 'loading', re: /^UI_/i },
    // Reel mechanics
    { tier: 'loading', re: /^ReelLand/i },
    { tier: 'loading', re: /^SpinsLoop/i },
    { tier: 'loading', re: /^SpinningReels$/i },
    { tier: 'loading', re: /^StopBlankReel$/i },
    // Base win feedback
    { tier: 'loading', re: /^Payline$/i },
    { tier: 'loading', re: /^RollupLow/i },
    { tier: 'loading', re: /^CoinLoop$/i },
    { tier: 'loading', re: /^CoinLoopEnd$/i },
    { tier: 'loading', re: /^CoinCounter$/i },
    { tier: 'loading', re: /^Bell$/i },
    { tier: 'loading', re: /^TotalWin$/i },
    // Intro/tutorial
    { tier: 'loading', re: /^IntroAnim/i },
    { tier: 'loading', re: /^GameIntro/i },
    { tier: 'loading', re: /^Tutorial/i },
    { tier: 'loading', re: /^PanelAppears$/i },
    { tier: 'loading', re: /^OptionsRoll$/i },

    // ── BONUS: all bonus content + bonus music + transitions ──
    // Bonus music → streaming (HTML5 Audio, not decoded into RAM)
    { tier: 'streaming', re: /^BonusGameMusic/i },
    { tier: 'streaming', re: /^BonusIntroLoop/i },
    { tier: 'streaming', re: /^FreeSpinMusic/i },
    { tier: 'streaming', re: /^FreeSpinsMusic/i },
    { tier: 'streaming', re: /^PickerMusicLoop/i },
    { tier: 'streaming', re: /^MultiplierMusicLoop/i },
    { tier: 'streaming', re: /^RespinIntroLoop/i },
    { tier: 'streaming', re: /^RespinLoop/i },
    { tier: 'streaming', re: /^WheelBonusMusicLoop/i },
    { tier: 'streaming', re: /^JumanjiMusicLoop/i },
    { tier: 'streaming', re: /^FreeSpinsIntroLoop/i },
    { tier: 'streaming', re: /^BaseToBonusMusic$/i },
    // Bonus gameplay
    { tier: 'bonus', re: /^Bonus/i },
    { tier: 'bonus', re: /^Picker/i },
    { tier: 'bonus', re: /^FreeSpins?/i },
    { tier: 'bonus', re: /^HoldAnd/i },
    { tier: 'bonus', re: /^Respin/i },
    // Transitions base↔bonus
    { tier: 'bonus', re: /^BaseToBonusStart/i },
    { tier: 'bonus', re: /^BaseToBonus/i },
    { tier: 'bonus', re: /^BonusToBase/i },
    { tier: 'bonus', re: /^BaseToFreeSpins/i },
    { tier: 'bonus', re: /^TrnBaseToBonus/i },
    { tier: 'bonus', re: /^TrnPalmtree/i },
    // Scatter/trigger — these LAND during base game reels, before bonus is confirmed
    // They go in MAIN, not bonus. Bonus starts AFTER scatter evaluation.
    // (moved to main section below)
    // Wheel bonus
    { tier: 'bonus', re: /^Wheel/i },
    { tier: 'bonus', re: /^StartWheel/i },
    // Jackpot
    { tier: 'bonus', re: /^Jackpot/i },
    { tier: 'bonus', re: /^GrandFanfare/i },
    { tier: 'bonus', re: /^Progressive/i },
    { tier: 'bonus', re: /^Stop(Mini|Minor|Major|Maxi|Grand|Super)/i },
    // Gem/pot/lamp mechanics (mystery of the lamp bonus)
    { tier: 'bonus', re: /^Gem/i },
    { tier: 'bonus', re: /^Pot(Break|Grow|Shake)/i },
    { tier: 'bonus', re: /^Lamp/i },
    { tier: 'bonus', re: /^RubLamp/i },
    { tier: 'bonus', re: /^Genie/i },
    { tier: 'bonus', re: /^Ignite/i },
    { tier: 'bonus', re: /^Icon(Burst|Particles|Pick|sOpen)/i },
    { tier: 'bonus', re: /^Twirling/i },
    { tier: 'bonus', re: /^SpinBonusButton/i },
    { tier: 'bonus', re: /^SpinCount/i },
    { tier: 'bonus', re: /^ReelBonusLand/i },
    // Boost/collect features
    { tier: 'bonus', re: /^Boost/i },
    { tier: 'bonus', re: /^Collect/i },
    { tier: 'bonus', re: /^Feature/i },
    // VO lines (always bonus context)
    { tier: 'bonus', re: /^VO[A-Z]/i },
    // Bonus buy
    { tier: 'bonus', re: /^BonusBuy/i },
    // Plaque/outro
    { tier: 'bonus', re: /^EntryPlaquete/i },
    { tier: 'bonus', re: /^OutroPlaquete/i },
    { tier: 'bonus', re: /^BonusEnd/i },
    // Specific game bonus sounds
    { tier: 'bonus', re: /^Pig(Fall|gy|Swalow)/i },
    { tier: 'bonus', re: /^Safe(Grow|Land|Explode)/i },
    { tier: 'bonus', re: /^BrickWall/i },
    { tier: 'bonus', re: /^FireBall/i },
    { tier: 'bonus', re: /^Fire(ball)?K/i },
    { tier: 'bonus', re: /^BwSafe/i },
    { tier: 'bonus', re: /^CoinBag$/i },
    { tier: 'bonus', re: /^Board/i },
    { tier: 'bonus', re: /^GhostCroco|^GhostElephant|^GhostMonkey|^GhostRhino/i },
    { tier: 'bonus', re: /^Jaguar/i },
    { tier: 'bonus', re: /^Jumanji/i },
    { tier: 'bonus', re: /^Mandrill/i },
    { tier: 'bonus', re: /^Ostrich/i },
    { tier: 'bonus', re: /^Rhino/i },
    { tier: 'bonus', re: /^Sparkles/i },
    { tier: 'bonus', re: /^Powerbucks/i },
    { tier: 'bonus', re: /^Smart\d/i },
    { tier: 'bonus', re: /^BellLoop/i },
    { tier: 'bonus', re: /^Enchanting/i },
    { tier: 'bonus', re: /^Fireworks$/i },
    { tier: 'bonus', re: /^Multiplier/i },
    { tier: 'bonus', re: /^NewLineUnlocked/i },
    { tier: 'bonus', re: /^Paper(Appears|Scroll)|^Papyrus/i },
    { tier: 'bonus', re: /^Rise\d/i },
    { tier: 'bonus', re: /^SpinsRemaining/i },
    { tier: 'bonus', re: /^ValueAdded/i },
    { tier: 'bonus', re: /^GateOpen|^GateClose/i },
    { tier: 'bonus', re: /^MpFire|^MpParticles/i },

    // ── MAIN: base game — symbols, big win, anticipation, effects ──
    // Scatter symbols LAND on reels during base game — before bonus is confirmed
    { tier: 'main', re: /^SymScatter/i },
    { tier: 'main', re: /^SymbolFreeSpins/i },
    { tier: 'main', re: /^ScatterSymbol/i },
    { tier: 'main', re: /^Trigger$/i },
    { tier: 'main', re: /^TriggerBell$/i },
    // Big win
    { tier: 'main', re: /^BigWin/i },
    { tier: 'main', re: /^CoinShower/i },
    // Anticipation
    { tier: 'main', re: /^Anticipation/i },
    { tier: 'main', re: /^PreCog/i },
    { tier: 'main', re: /^PreBonus/i },
    { tier: 'main', re: /^TensionSpin/i },
    { tier: 'main', re: /^ScreenShake/i },
    // Symbols (all symbol land/win sounds happen in base game)
    { tier: 'main', re: /^Sym/i },
    { tier: 'main', re: /^Wild/i },
    { tier: 'main', re: /^Win\d/i },
    { tier: 'main', re: /^WinEqual/i },
    { tier: 'main', re: /^Rollup/i },
    { tier: 'main', re: /^Credits/i },
    { tier: 'main', re: /^Reels?Animate/i },
    { tier: 'main', re: /^(2x|3x|4x|5x|6x)/i },
    { tier: 'main', re: /^Fire$/i },
    { tier: 'main', re: /^IntroAnimation$/i },
    { tier: 'main', re: /^BankRoll/i },
    { tier: 'main', re: /^Cleopatra|^Cleo/i },
    { tier: 'main', re: /^WhatABigWin/i },
    { tier: 'main', re: /^ThisBringsMe|^TwiceAsNice|^Magnificent/i },
    { tier: 'main', re: /^IWish|^MyFortunes|^EnjoyYour|^ItsTime/i },
  ];
  const fallback = resolveTier('main') ?? tierKeys[tierKeys.length - 1] ?? null;
  return unassigned.map(s => {
    const tags = soundsJson?.soundDefinitions?.soundSprites?.[`s_${s.name}`]?.tags ?? [];
    if (musicTags?.some(mt => tags.includes(mt))) return { name: s.name, tier: 'streaming' };
    for (const { tier, re } of PATTERNS) {
      if (!re.test(s.name)) continue;
      if (tier === 'streaming') return { name: s.name, tier: 'streaming' };
      const resolved = resolveTier(tier);
      if (resolved) return { name: s.name, tier: resolved };
    }
    return { name: s.name, tier: fallback };
  });
}

// Pool color schemes — per SubLoader letter
const POOL_THEME = {
  immediate: { accentColor: '#34d399', label: 'IMMEDIATE' },
  streaming: { accentColor: '#fb7185', label: 'STREAMING' },
};
const SUBLOADER_COLORS = {
  A: '#38bdf8', // sky
  B: '#c084fc', // purple
  C: '#fb923c', // orange
  D: '#2dd4bf', // teal
  E: '#f472b6', // pink
  F: '#a3e635', // lime
  Z: '#fbbf24', // amber
};

function getTheme(tierCfg, tierName) {
  if (tierName === 'streaming') return POOL_THEME.streaming;
  const id = tierCfg?.subLoaderId;
  if (id === 'Z') return { accentColor: SUBLOADER_COLORS.Z, label: 'LAZY' };
  if (id && SUBLOADER_COLORS[id]) return { accentColor: SUBLOADER_COLORS[id], label: 'DEFERRED' };
  if (id) return { accentColor: '#38bdf8', label: 'DEFERRED' };
  return POOL_THEME.immediate;
}

const fmtSize = (kb) => kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB';

function PoolCard({ tierName, tierCfg, sounds, theme, maxKB, sizeInfo, wavSet, tierOptions, onMove, onUpdate, onCopy, copied, config, showToast }) {
  const [expanded, setExpanded] = useState(true);
  const [measuring, setMeasuring] = useState(false);
  const [measuredKB, setMeasuredKB] = useState(null);
  const [measuredRAM, setMeasuredRAM] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const isStreaming = tierName === 'streaming';
  const isDeferred = !!tierCfg?.subLoaderId;

  // Reset measurement when sounds or encoding change
  const enc = isStreaming
    ? config?.encoding?.music || { bitrate: 64, channels: 2, samplerate: 44100 }
    : config?.encoding?.sfx || { bitrate: 64, channels: 1, samplerate: 44100 };
  const encKey = `${enc.bitrate}-${enc.channels}-${enc.samplerate}-${enc.keepOriginal}`;
  const soundsKey = sounds.join(',');
  useEffect(() => { setMeasuredKB(null); setMeasuredRAM(null); }, [soundsKey, encKey]);

  const displayKB = measuredKB ?? (sizeInfo.isActual ? sizeInfo.kb : null);
  const over = maxKB > 0 && displayKB && displayKB > maxKB;
  const pct = maxKB > 0 && displayKB ? Math.min(100, (displayKB / maxKB) * 100) : 0;

  const handleMeasure = async () => {
    if (sounds.length === 0) return;
    setMeasuring(true);
    try {
      const r = await window.api.measurePool({ tierName, sounds, encoding: enc, isStreaming });
      if (r?.error) { showToast?.('Measure failed: ' + r.error, 'error'); }
      else if (r?.sizeKB !== undefined) {
        setMeasuredKB(r.sizeKB);
        setMeasuredRAM(r.ramMB ?? null);
      }
    } catch (e) { showToast?.('Measure failed: ' + (e.message || 'unknown'), 'error'); }
    setMeasuring(false);
  };

  const accentC = theme.accentColor;

  return (
    <div
      className="card overflow-hidden h-full flex flex-col transition-all duration-200"
      style={dragOver ? { borderColor: 'var(--color-accent)', background: 'rgba(139,124,248,0.04)' } : {}}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); const d = e.dataTransfer.getData('text/plain'); if (d) { try { const { sound, from } = JSON.parse(d); if (from !== tierName) onMove(sound, from, tierName); } catch {} } }}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-border/40" style={{ padding: '12px 18px' }}>
        <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: accentC }} />
        <span className="text-[13px] font-bold uppercase tracking-wider" style={{ color: accentC }}>{tierName}</span>
        <span className="text-[9px] font-bold px-2 py-[3px] rounded uppercase tracking-widest" style={{ background: `${accentC}14`, color: accentC }}>{theme.label}</span>
        {isDeferred && tierCfg.subLoaderId && (
          <span className="text-[9px] font-bold font-mono px-2 py-[3px] rounded" style={{ background: `${accentC}14`, color: accentC }}>"{tierCfg.subLoaderId}"</span>
        )}
        {tierCfg?.unloadable && (
          <span className="text-[9px] font-bold px-2 py-[3px] rounded" style={{ background: 'rgba(251,191,36,0.1)', color: '#fbbf24' }}>UNLOAD</span>
        )}
        <div className="flex-1" />
        <span className="text-[11px] font-mono tabular-nums" style={{ color: `${accentC}90` }}>{sounds.length} sounds</span>
      </div>

      {/* Sounds */}
      <div className="flex-1" style={{ padding: '12px 18px' }}>
        <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-1.5 hover:opacity-80 transition-opacity mb-2">
          <svg className={`w-2.5 h-2.5 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} style={{ color: accentC, opacity: 0.5 }}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
          <span className="text-[9px] font-bold uppercase tracking-[0.14em]" style={{ color: accentC, opacity: 0.5 }}>Sounds ({sounds.length})</span>
        </button>
        {expanded && (
          <div style={sounds.length <= 12 ? { display: 'flex', flexDirection: 'column' } : { display: 'grid', gridAutoFlow: 'column', gridTemplateRows: `repeat(${Math.min(sounds.length, Math.max(6, Math.ceil(sounds.length / 4)))}, auto)`, gap: '0' }}>
            {sounds.map((s, i) => {
              const missing = !wavSet.has(s);
              return (
                <div key={s} draggable
                  onDragStart={(e) => { e.currentTarget.style.opacity = '0.3'; e.dataTransfer.setData('text/plain', JSON.stringify({ sound: s, from: tierName })); e.dataTransfer.effectAllowed = 'move'; }}
                  onDragEnd={(e) => { e.currentTarget.style.opacity = '1'; }}
                  className="cursor-grab active:cursor-grabbing transition-all truncate"
                  onMouseEnter={e => { e.currentTarget.style.background = `${accentC}18`; e.currentTarget.style.color = missing ? '' : '#fff'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = i % 2 === 0 ? `${accentC}05` : 'transparent'; e.currentTarget.style.color = missing ? 'var(--color-danger)' : `${accentC}bb`; }}
                  style={{
                    padding: '3px 10px',
                    fontSize: '10.5px', fontFamily: 'monospace', lineHeight: 1.5,
                    color: missing ? 'var(--color-danger)' : `${accentC}bb`,
                    background: i % 2 === 0 ? `${accentC}05` : 'transparent',
                    borderBottom: `1px solid ${accentC}06`,
                    textDecoration: missing ? 'line-through' : 'none',
                    borderRadius: '3px',
                    transition: 'background 0.1s, color 0.1s',
                  }}
                  title={s}
                >{s}</div>
              );
            })}
            {sounds.length === 0 && <span className="text-[10px] italic" style={{ color: `${accentC}40`, padding: '8px 0' }}>Drop sounds here</span>}
          </div>
        )}
      </div>

      {/* Measure + Settings footer */}
      {!isStreaming ? (
        <div className="border-t flex flex-col" style={{ borderColor: 'rgba(255,255,255,0.04)', background: 'rgba(0,0,0,0.12)' }}>
          {/* Measure row */}
          <div className="flex items-center gap-3" style={{ padding: '8px 18px', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
            <button onClick={handleMeasure} disabled={measuring || sounds.length === 0}
              className="transition-all disabled:opacity-20"
              style={{ fontSize: '10px', padding: '3px 10px', borderRadius: '5px', border: `1px solid ${accentC}25`, color: `${accentC}90`, background: `${accentC}06`, cursor: measuring ? 'wait' : 'pointer' }}>
              {measuring ? 'Measuring...' : displayKB ? 'Re-measure' : 'Measure Size'}
            </button>
            {displayKB && (
              <span className="text-[11px] font-mono tabular-nums font-semibold" style={{ color: over ? 'var(--color-danger)' : accentC }}>{fmtSize(displayKB)}</span>
            )}
            {measuredRAM && (
              <span className="text-[10px] font-mono tabular-nums text-orange">~{measuredRAM} MB RAM</span>
            )}
            {over && <span className="text-[9px] font-bold text-danger uppercase tracking-wider">Over limit</span>}
          </div>
          {/* Settings row */}
          <div className="flex items-center gap-2.5 flex-wrap" style={{ padding: '10px 18px' }}>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-text-dim uppercase tracking-wider font-bold">Limit</span>
              <input type="number" value={maxKB || 0} onChange={(e) => onUpdate(() => { tierCfg.maxSizeKB = parseInt(e.target.value) || 0; })} className="input-base text-center" style={{ width: '68px', fontSize: '11px', padding: '3px 6px', borderRadius: '6px' }} />
              <span className="text-[9px] text-text-dim">KB</span>
            </div>
            {isDeferred && (<>
              <div className="h-3 w-px bg-white/[0.06]" />
              <select value={tierCfg.subLoaderId || 'A'} onChange={(e) => onUpdate(() => { tierCfg.subLoaderId = e.target.value; if (tierCfg.unloadable === undefined) tierCfg.unloadable = false; })} className="input-base" style={{ fontSize: '11px', padding: '3px 6px', width: '130px', borderRadius: '6px' }}>
                {SUBLOADER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </>)}
            {isDeferred && (<>
              <div className="h-3 w-px bg-white/[0.06]" />
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input type="checkbox" checked={tierCfg.unloadable === true} onChange={(e) => onUpdate(() => { tierCfg.unloadable = e.target.checked; })} className="w-3 h-3 accent-amber-400 rounded cursor-pointer" />
                <span className="text-[10px] text-text-dim">Unloadable</span>
              </label>
            </>)}
            {isDeferred && (
              <div className="flex items-center gap-2 ml-auto">
                <code className="text-[9px] font-mono" style={{ color: `${accentC}90` }}>startSubLoader("{tierCfg.subLoaderId}")</code>
                <button onClick={() => onCopy(tierName, buildSnippet(tierName, tierCfg))}
                  className="transition-all"
                  style={{ fontSize: '10px', padding: '3px 10px', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.06)', color: 'var(--color-text-dim)', cursor: 'pointer' }}>
                  {copied === tierName ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Streaming — measure + info, 2-row footer to align with neighbor */
        <div className="border-t flex flex-col" style={{ borderColor: 'rgba(255,255,255,0.04)', background: 'rgba(0,0,0,0.12)' }}>
          <div className="flex items-center gap-3" style={{ padding: '8px 18px', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
            <button onClick={handleMeasure} disabled={measuring || sounds.length === 0}
              className="transition-all disabled:opacity-20"
              style={{ fontSize: '10px', padding: '3px 10px', borderRadius: '5px', border: `1px solid ${accentC}25`, color: `${accentC}90`, background: `${accentC}06`, cursor: measuring ? 'wait' : 'pointer' }}>
              {measuring ? 'Measuring...' : displayKB ? 'Re-measure' : 'Measure Size'}
            </button>
            {displayKB && (
              <span className="text-[11px] font-mono tabular-nums font-semibold" style={{ color: accentC }}>{fmtSize(displayKB)}</span>
            )}
            {measuredRAM && (
              <span className="text-[10px] font-mono tabular-nums text-orange">~{measuredRAM} MB RAM</span>
            )}
          </div>
          <div style={{ padding: '10px 18px', minHeight: '44px' }} />
        </div>
      )}
    </div>
  );
}

export default function SpriteConfigPage({ project, setProject, showToast }) {
  const [config, setConfig]           = useState(null);
  const [dirty, setDirty]             = useState(false);
  const [saving, setSaving]           = useState(false);
  const [assignTarget, setAssignTarget] = useState({});
  const [preview, setPreview]         = useState(null);
  const [previewIsReassign, setPreviewIsReassign] = useState(false);
  const [copied, setCopied]           = useState(null);
  const [configKey, setConfigKey]     = useState(0);
  const [fdkAvailable, setFdkAvailable] = useState(false);
  const copyTimerRef = useRef(null);

  useEffect(() => {
    // Reset only on actual project change (different folder), not on reload
    if (project?.spriteConfig) setConfig(structuredClone(project.spriteConfig));
    else setConfig(null);
    setDirty(false); setSaving(false); setPreview(null); setAssignTarget({});
    setConfigKey(k => k + 1);
  }, [project?.path]); // eslint-disable-line — intentionally path only, not _reloadKey

  // Sync from disk on reload — but only if no unsaved changes
  useEffect(() => {
    if (!dirty && project?.spriteConfig && project?._reloadKey) {
      setConfig(structuredClone(project.spriteConfig));
      setConfigKey(k => k + 1);
    }
  }, [project?._reloadKey]); // eslint-disable-line — intentionally reloadKey only

  useEffect(() => {
    window.api.getEncoderSetting().then(r => setFdkAvailable(!!r?.fdkAvailable)).catch(() => {});
  }, []);

  const unassigned = useMemo(() => {
    if (!config || !project?.sounds) return [];
    const assigned = new Set([
      ...Object.values(config.sprites || {}).flatMap(t => t.sounds || []),
      ...(config.streaming?.sounds || []),
    ]);
    return project.sounds.filter(s => !assigned.has(s.name));
  }, [config, project?.sounds]);

  const deferredTiers = useMemo(() => {
    if (!config) return [];
    return Object.entries(config.sprites || {}).filter(([, tc]) => tc.subLoaderId);
  }, [config]);

  const wavSet = useMemo(() => new Set((project?.sounds || []).map(s => s.name)), [project?.sounds]);

  const distSizes = project?.distInfo?.spriteSizes || {};
  // gameName from gameProjectPath (matches buildTiered.js), fallback to audio repo folder name
  const gameName = project?.settings?.gameProjectPath?.split(/[/\\]/).pop()
    || project?.path?.split(/[/\\]/).pop()?.replace(/-audio$/, '') || '';

  const poolSizeInfo = (tierName, sounds) => {
    // Only show real M4A sizes from dist/ — no estimation
    for (const fname of [`${gameName}_${tierName}.m4a`, `${tierName}.m4a`]) {
      if (distSizes[fname]) return { kb: distSizes[fname], isActual: true };
    }
    if (tierName === 'streaming' && sounds.length > 0) {
      let total = 0, foundCount = 0;
      for (const s of sounds) {
        for (const f of [`${gameName}_${s}.m4a`, `${s}.m4a`]) { if (distSizes[f]) { total += distSizes[f]; foundCount++; break; } }
      }
      if (foundCount > 0) return { kb: total, isActual: foundCount === sounds.length };
    }
    return { kb: 0, isActual: false };
  };

  useEffect(() => () => clearTimeout(copyTimerRef.current), []);

  if (!config) {
    return (
      <div className="anim-fade-up flex flex-col items-center justify-center h-64">
        <span className="text-[13px] text-text-dim">No sprite-config.json found in project.</span>
      </div>
    );
  }

  const tierOptions = [...Object.keys(config.sprites || {}), 'streaming'];
  const update = (fn) => { fn(); setConfig(structuredClone(config)); setDirty(true); };

  const handleMove = (soundName, fromTier, toTier) => {
    if (!toTier || toTier === fromTier) return;
    update(() => {
      // Remove from source (skip if dragged from unassigned)
      if (fromTier === '__unassigned__') { /* nothing to remove */ }
      else if (fromTier === 'streaming') {
        if (config.streaming) config.streaming.sounds = (config.streaming.sounds || []).filter(s => s !== soundName);
      } else if (config.sprites[fromTier]) {
        config.sprites[fromTier].sounds = (config.sprites[fromTier].sounds || []).filter(s => s !== soundName);
      }
      // Add to target
      if (toTier === 'streaming') {
        if (!config.streaming) config.streaming = { sounds: [] };
        if (!config.streaming.sounds.includes(soundName)) config.streaming.sounds.push(soundName);
      } else if (config.sprites[toTier]) {
        if (!config.sprites[toTier].sounds) config.sprites[toTier].sounds = [];
        if (!config.sprites[toTier].sounds.includes(soundName)) config.sprites[toTier].sounds.push(soundName);
      }
    });
  };

  const handleAssign = (soundName, tierKey) => {
    if (!tierKey) return;
    update(() => {
      if (tierKey === 'streaming') {
        if (!config.streaming) config.streaming = { sounds: [] };
        if (!config.streaming.sounds.includes(soundName)) config.streaming.sounds.push(soundName);
      } else if (config.sprites[tierKey]) {
        if (!config.sprites[tierKey].sounds) config.sprites[tierKey].sounds = [];
        if (!config.sprites[tierKey].sounds.includes(soundName)) config.sprites[tierKey].sounds.push(soundName);
      }
    });
    setAssignTarget(prev => ({ ...prev, [soundName]: '' }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await window.api.saveSpriteConfig(config);
      if (result?.success) {
        setDirty(false);
        showToast('Sprite config saved', 'success');
        if (setProject) setProject(prev => ({ ...structuredClone(prev), spriteConfig: structuredClone(config) }));
      } else showToast(result?.error || 'Save failed', 'error');
    } catch (e) { showToast('Save failed: ' + e.message, 'error'); }
    setSaving(false);
  };

  const handleCopy = (key, text) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(null), 2000);
    }).catch(() => showToast('Clipboard copy failed', 'error'));
  };

  const handleOpenPreview = (reassignAll = false) => {
    setPreviewIsReassign(reassignAll);
    if (reassignAll) {
      const allSounds = (project?.sounds || []).map(s => ({ name: s.name }));
      setPreview(computeAutoAssign(allSounds, config, project?.soundsJson, config.musicTags));
    } else {
      setPreview(computeAutoAssign(unassigned, config, project?.soundsJson, config.musicTags));
    }
  };
  const handleApplyPreview = () => {
    if (!preview) return;
    // Batch all assignments into a single update (one structuredClone instead of N)
    update(() => {
      if (previewIsReassign) {
        for (const tier of Object.values(config.sprites || {})) tier.sounds = [];
        if (config.streaming) config.streaming.sounds = [];
      }
      for (const { name, tier } of preview) {
        if (!tier) continue;
        if (tier === 'streaming') {
          if (!config.streaming) config.streaming = { sounds: [] };
          if (!config.streaming.sounds.includes(name)) config.streaming.sounds.push(name);
        } else if (config.sprites[tier]) {
          if (!config.sprites[tier].sounds) config.sprites[tier].sounds = [];
          if (!config.sprites[tier].sounds.includes(name)) config.sprites[tier].sounds.push(name);
        }
      }
    });
    setPreview(null);
    setPreviewIsReassign(false);
  };
  const handleCopyAll = () => handleCopy('__all__', deferredTiers.map(([n, tc]) => buildSnippet(n, tc)).join('\n\n'));

  // Group tiers by loading type for visual ordering
  const immediateTiers = Object.entries(config.sprites || {}).filter(([, tc]) => !tc.subLoaderId);
  const deferredOnly = Object.entries(config.sprites || {}).filter(([, tc]) => tc.subLoaderId && tc.subLoaderId !== 'Z');
  const lazyTiers = Object.entries(config.sprites || {}).filter(([, tc]) => tc.subLoaderId === 'Z');
  const streamingSoundsArr = config.streaming?.sounds || [];

  return (
    <div className="anim-fade-up h-full flex flex-col" style={{ gap: '16px', padding: '8px 0' }}>
      {/* Header */}
      <div className="shrink-0" style={{ textAlign: 'center' }}>
        <h2 className="text-text-primary" style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '-0.02em' }}>Sprite Config</h2>
        <div className="flex items-center justify-center" style={{ marginTop: '10px', gap: '10px' }}>
          <label className="flex items-center gap-1.5 text-[10px] text-text-dim font-bold uppercase tracking-wider">
            Gap
            <input type="number" step="1" min="0" value={Math.round((config.spriteGap ?? 0.05) * 1000)} onChange={(e) => update(() => { config.spriteGap = (parseInt(e.target.value) || 0) / 1000; })} className="input-base text-center" style={{ width: '48px', fontSize: '11px', padding: '4px 6px', borderRadius: '6px' }} />
            ms
          </label>
          <div className="h-4 w-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
          <button onClick={() => handleOpenPreview(true)}
            style={{ fontSize: '10px', fontWeight: 600, padding: '5px 14px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--color-text-dim)', background: 'rgba(255,255,255,0.02)', cursor: 'pointer', transition: 'all 0.15s' }}>
            Re-assign All
          </button>
          <button onClick={handleSave} disabled={!dirty || saving}
            style={{ fontSize: '10px', fontWeight: 700, padding: '5px 16px', borderRadius: '6px', cursor: dirty && !saving ? 'pointer' : 'not-allowed', transition: 'all 0.15s', ...(dirty && !saving ? { background: 'var(--color-accent)', color: '#fff', border: 'none', boxShadow: '0 2px 8px rgba(139,124,248,0.25)' } : { background: 'transparent', color: 'var(--color-text-dim)', border: '1px solid rgba(255,255,255,0.06)', opacity: 0.4 }) }}>
            {saving ? 'Saving...' : dirty ? 'Save Changes' : 'Saved'}
          </button>
        </div>
      </div>

      {/* Unassigned banner */}
      {unassigned.length > 0 && (
        <div className="shrink-0 card overflow-hidden" style={{ borderColor: 'rgba(251,191,36,0.2)' }}>
          <div className="flex items-center gap-2.5" style={{ padding: '10px 18px', borderBottom: '1px solid rgba(251,191,36,0.12)', background: 'rgba(251,191,36,0.03)' }}>
            <span className="w-[7px] h-[7px] rounded-full shrink-0 anim-pulse-dot" style={{ background: '#fbbf24' }} />
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#fbbf24' }}>{unassigned.length} Unassigned</span>
            <div className="flex-1" />
            <button onClick={handleOpenPreview}
              style={{ fontSize: '10px', fontWeight: 600, padding: '4px 14px', borderRadius: '6px', background: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: 'none', cursor: 'pointer', transition: 'all 0.15s' }}>
              Auto-Assign
            </button>
          </div>
          <div className="flex flex-wrap max-h-32 overflow-y-auto" style={{ padding: '12px 18px', gap: '5px' }}>
            {unassigned.map(s => (
              <span key={s.name} draggable
                onDragStart={(e) => { e.dataTransfer.setData('text/plain', JSON.stringify({ sound: s.name, from: '__unassigned__' })); e.dataTransfer.effectAllowed = 'move'; }}
                className="cursor-grab active:cursor-grabbing transition-all"
                style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 8px', borderRadius: '6px', fontSize: '10.5px', fontFamily: 'monospace', lineHeight: 1.4, color: 'rgba(251,191,36,0.75)', background: 'rgba(251,191,36,0.05)', border: '1px solid rgba(251,191,36,0.15)' }}
              >{s.name}</span>
            ))}
          </div>
        </div>
      )}

      {/* Pool cards */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-1" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

        {/* Immediate + Streaming — side by side */}
        {(immediateTiers.length > 0 || streamingSoundsArr.length > 0 || Object.keys(config.sprites || {}).length > 0) && (
          <div className="flex" style={{ gap: '14px', alignItems: 'stretch' }}>
            {immediateTiers.map(([name, cfg]) => (
              <div key={name + '_' + configKey} className="flex-1 min-w-0">
                <PoolCard tierName={name} tierCfg={cfg} sounds={cfg.sounds || []} theme={getTheme(cfg, name)} maxKB={cfg.maxSizeKB || 0} sizeInfo={poolSizeInfo(name, cfg.sounds || [])} wavSet={wavSet} tierOptions={tierOptions} onMove={handleMove} onUpdate={update} onCopy={handleCopy} copied={copied} config={config} showToast={showToast} />
              </div>
            ))}
            {(streamingSoundsArr.length > 0 || Object.keys(config.sprites || {}).length > 0) && (
              <div className="flex-1 min-w-0">
                <PoolCard key={'streaming_' + configKey} tierName="streaming" tierCfg={{}} sounds={streamingSoundsArr} theme={POOL_THEME.streaming} maxKB={0} sizeInfo={poolSizeInfo('streaming', streamingSoundsArr)} wavSet={wavSet} tierOptions={tierOptions} onMove={handleMove} onUpdate={update} onCopy={handleCopy} copied={copied} config={config} showToast={showToast} />
              </div>
            )}
          </div>
        )}

        {/* SubLoader pools — side by side */}
        {(deferredOnly.length > 0 || lazyTiers.length > 0) && (<>
          <div className="flex items-center gap-3 px-1">
            <div className="h-px flex-1 bg-gradient-to-r from-sky-500/20 to-transparent" />
            <span className="text-[10px] font-bold tracking-[0.16em] uppercase text-sky-400/50">SubLoader Pools</span>
            <div className="h-px flex-1 bg-gradient-to-l from-sky-500/20 to-transparent" />
          </div>
          <div className="flex" style={{ gap: '14px', alignItems: 'stretch' }}>
            {[...deferredOnly, ...lazyTiers].map(([name, cfg]) => (
              <div key={name + '_' + configKey} className="flex-1 min-w-0">
                <PoolCard tierName={name} tierCfg={cfg} sounds={cfg.sounds || []} theme={getTheme(cfg, name)} maxKB={cfg.maxSizeKB || 0} sizeInfo={poolSizeInfo(name, cfg.sounds || [])} wavSet={wavSet} tierOptions={tierOptions} onMove={handleMove} onUpdate={update} onCopy={handleCopy} copied={copied} config={config} showToast={showToast} />
              </div>
            ))}
          </div>
        </>)}

        {/* Encoding */}
        <div>
          <div className="flex items-center gap-3 px-1" style={{ paddingBottom: '10px' }}>
            <div className="h-px flex-1" style={{ background: 'linear-gradient(to right, rgba(139,124,248,0.2), transparent)' }} />
            <span className="text-[9px] font-bold tracking-[0.18em] uppercase" style={{ color: 'rgba(139,124,248,0.4)' }}>Encoding</span>
            <div className="h-px flex-1" style={{ background: 'linear-gradient(to left, rgba(139,124,248,0.2), transparent)' }} />
          </div>
          <div className="card overflow-hidden">
            <div style={{ padding: '14px 18px' }} className="space-y-2.5">
              {Object.entries(config.encoding || {}).map(([key, enc]) => {
                const keyColor = key === 'sfx' ? '#38bdf8' : key === 'vo' ? '#fb923c' : '#a78bfa';
                return (
                  <div key={key} className="flex items-center gap-2.5 flex-wrap">
                    <span className="text-[11px] font-bold uppercase tracking-wider w-10" style={{ color: keyColor }}>{key}</span>
                    <select value={enc.encoder || 'native'} onChange={(e) => update(() => { enc.encoder = e.target.value; })} className="input-base" style={{ width: 'auto', fontSize: '11px', padding: '3px 6px', borderRadius: '6px' }}>
                      <option value="native">Native</option>
                      <option value="fdk" disabled={!fdkAvailable}>FDK{!fdkAvailable ? ' — n/a' : ''}</option>
                    </select>
                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input type="checkbox" checked={enc.keepOriginal === true} onChange={(e) => update(() => { enc.keepOriginal = e.target.checked; })} className="w-3 h-3 accent-accent rounded cursor-pointer" />
                      <span className="text-[10px] text-text-dim">Keep Original</span>
                    </label>
                    {enc.keepOriginal ? (
                      <span className="text-[10px] text-text-dim italic">320 kbps, source ch & sr</span>
                    ) : (<>
                      <select value={enc.bitrate || 64} onChange={(e) => update(() => { enc.bitrate = parseInt(e.target.value); })} className="input-base" style={{ width: '88px', fontSize: '11px', padding: '3px 6px', borderRadius: '6px' }}>
                        {[32, 48, 64, 96, 128, 160, 192, 256, 320].map(b => <option key={b} value={b}>{b} kbps</option>)}
                      </select>
                      <select value={enc.channels || 2} onChange={(e) => update(() => { enc.channels = parseInt(e.target.value); })} className="input-base" style={{ width: '80px', fontSize: '11px', padding: '3px 6px', borderRadius: '6px' }}>
                        <option value={1}>Mono</option>
                        <option value={2}>Stereo</option>
                      </select>
                      <select value={enc.samplerate || 44100} onChange={(e) => update(() => { enc.samplerate = parseInt(e.target.value); })} className="input-base" style={{ width: '88px', fontSize: '11px', padding: '3px 6px', borderRadius: '6px' }}>
                        <option value={22050}>22050 Hz</option>
                        <option value={32000}>32000 Hz</option>
                        <option value={44100}>44100 Hz</option>
                        <option value={48000}>48000 Hz</option>
                      </select>
                    </>)}
                  </div>
                );
              })}
              <EncoderFooter config={config} project={project} fdkAvailable={fdkAvailable} setFdkAvailable={setFdkAvailable} />
            </div>
          </div>
        </div>

        {/* Copy all snippets */}
        {deferredTiers.length > 0 && (
          <div className="flex justify-end" style={{ paddingBottom: '6px' }}>
            <button onClick={handleCopyAll}
              style={{ fontSize: '10px', fontWeight: 600, padding: '4px 14px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)', color: 'var(--color-text-dim)', background: 'rgba(255,255,255,0.02)', cursor: 'pointer', transition: 'all 0.15s' }}>
              {copied === '__all__' ? '✓ Copied All' : 'Copy All Snippets'}
            </button>
          </div>
        )}
      </div>

      {/* Auto-Assign Preview Modal */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setPreview(null)}>
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div className="relative card overflow-hidden w-full max-w-lg max-h-[80vh] mx-4 flex flex-col anim-fade-up" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3" style={{ padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <span className="text-[13px] font-bold text-text-primary">Auto-Assign Preview</span>
              <span className="text-[10px] text-text-dim font-mono">{preview.length} sounds</span>
              <button onClick={() => setPreview(null)} className="ml-auto"
                style={{ fontSize: '10px', padding: '3px 10px', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.06)', color: 'var(--color-text-dim)', cursor: 'pointer', transition: 'all 0.15s' }}>Close</button>
            </div>
            <div className="flex-1 overflow-y-auto" style={{ padding: '10px 18px' }}>
              {preview.map((item, i) => {
                const tierTheme = item.tier === 'streaming' ? POOL_THEME.streaming : getTheme(config.sprites?.[item.tier] || {}, item.tier);
                return (
                  <div key={item.name} className="flex items-center gap-2 transition-colors hover:bg-white/[0.015]" style={{ padding: '4px 8px', borderRadius: '6px' }}>
                    <span className="w-[5px] h-[5px] rounded-full shrink-0" style={{ background: tierTheme.accentColor }} />
                    <span className="font-mono text-[10.5px] text-text-primary flex-1 truncate">{item.name}</span>
                    <select value={item.tier || ''} onChange={e => setPreview(prev => prev.map((p, j) => j === i ? { ...p, tier: e.target.value } : p))} className="input-base" style={{ fontSize: '10px', padding: '2px 6px', width: '110px', borderRadius: '5px' }}>
                      {tierOptions.map(t => <option key={t} value={t}>{t === 'streaming' ? 'Streaming' : t}</option>)}
                    </select>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2 justify-end" style={{ padding: '10px 18px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              <button onClick={() => setPreview(null)}
                style={{ fontSize: '10px', fontWeight: 600, padding: '5px 14px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)', color: 'var(--color-text-dim)', cursor: 'pointer', transition: 'all 0.15s' }}>Cancel</button>
              <button onClick={handleApplyPreview}
                style={{ fontSize: '10px', fontWeight: 700, padding: '5px 16px', borderRadius: '6px', background: 'var(--color-accent)', color: '#fff', border: 'none', cursor: 'pointer', boxShadow: '0 2px 8px rgba(139,124,248,0.25)', transition: 'all 0.15s' }}>Apply All</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
