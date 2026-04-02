import React, { useState, useEffect, useMemo, useRef } from 'react';

const SUBLOADER_OPTIONS = [
  { value: '',  label: 'Main load  —  immediate' },
  { value: 'A', label: 'SubLoader A  —  deferred' },
  { value: 'B', label: 'SubLoader B  —  deferred' },
  { value: 'C', label: 'SubLoader C  —  deferred' },
  { value: 'D', label: 'SubLoader D  —  deferred' },
  { value: 'E', label: 'SubLoader E  —  deferred' },
  { value: 'F', label: 'SubLoader F  —  deferred' },
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
    // ── STANDALONE: only base game music that loops from first frame ──
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
      if (tier === 'streaming' || tier === 'standalone') return { name: s.name, tier: 'streaming' };
      const resolved = resolveTier(tier);
      if (resolved) return { name: s.name, tier: resolved };
    }
    return { name: s.name, tier: fallback };
  });
}

// Pool color schemes
const POOL_THEME = {
  immediate: { accent: 'text-emerald-400', accentBg: 'bg-emerald-400', border: 'border-emerald-500/30', headerBg: 'bg-emerald-500/8', badge: 'bg-emerald-500/15 text-emerald-400', glow: 'shadow-emerald-500/5', label: 'IMMEDIATE', dot: 'bg-emerald-400' },
  deferred:  { accent: 'text-sky-400',     accentBg: 'bg-sky-400',     border: 'border-sky-500/30',     headerBg: 'bg-sky-500/8',     badge: 'bg-sky-500/15 text-sky-400',     glow: 'shadow-sky-500/5',     label: 'DEFERRED',  dot: 'bg-sky-400' },
  lazy:      { accent: 'text-amber-400',   accentBg: 'bg-amber-400',   border: 'border-amber-500/30',   headerBg: 'bg-amber-500/8',   badge: 'bg-amber-500/15 text-amber-400', glow: 'shadow-amber-500/5',   label: 'LAZY',      dot: 'bg-amber-400' },
  standalone:{ accent: 'text-violet-400',  accentBg: 'bg-violet-400',  border: 'border-violet-500/30',  headerBg: 'bg-violet-500/8',  badge: 'bg-violet-500/15 text-violet-400',glow: 'shadow-violet-500/5', label: 'MUSIC',     dot: 'bg-violet-400' },
  streaming: { accent: 'text-rose-400',    accentBg: 'bg-rose-400',    border: 'border-rose-500/30',    headerBg: 'bg-rose-500/8',    badge: 'bg-rose-500/15 text-rose-400',    glow: 'shadow-rose-500/5',   label: 'STREAMING', dot: 'bg-rose-400' },
};

function getTheme(tierCfg, tierName) {
  if (tierName === 'standalone') return POOL_THEME.standalone;
  if (tierName === 'streaming') return POOL_THEME.streaming;
  if (tierCfg?.subLoaderId === 'Z') return POOL_THEME.lazy;
  if (tierCfg?.subLoaderId) return POOL_THEME.deferred;
  return POOL_THEME.immediate;
}

const fmtSize = (kb) => kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB';

function PoolCard({ tierName, tierCfg, sounds, theme, maxKB, sizeInfo, wavSet, tierOptions, onMove, onUpdate, onCopy, copied, config, showToast }) {
  const [expanded, setExpanded] = useState(true);
  const [measuring, setMeasuring] = useState(false);
  const [measuredKB, setMeasuredKB] = useState(null);
  const [measuredRAM, setMeasuredRAM] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const isStandalone = tierName === 'standalone' || tierName === 'streaming';
  const isDeferred = !!tierCfg?.subLoaderId;

  // Reset measurement when sounds or encoding change
  const enc = isStandalone
    ? config?.encoding?.music || { bitrate: 128, channels: 2, samplerate: 44100 }
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
      const r = await window.api.measurePool({ tierName, sounds, encoding: enc, isStandalone });
      if (r?.error) { showToast?.('Measure failed: ' + r.error, 'error'); }
      else if (r?.sizeKB !== undefined) {
        setMeasuredKB(r.sizeKB);
        setMeasuredRAM(r.ramMB ?? null);
      }
    } catch (e) { showToast?.('Measure failed: ' + (e.message || 'unknown'), 'error'); }
    setMeasuring(false);
  };

  return (
    <div
      className={`rounded-2xl border ${dragOver ? 'border-accent !bg-accent/5' : theme.border} overflow-hidden shadow-lg ${theme.glow} transition-all duration-200 hover:shadow-xl h-full flex flex-col`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); const d = e.dataTransfer.getData('text/plain'); if (d) { try { const { sound, from } = JSON.parse(d); if (from !== tierName) onMove(sound, from, tierName); } catch {} } }}
    >
      {/* Header */}
      <div className={`${theme.headerBg} px-6 py-4 flex items-center gap-3 flex-wrap`}>
        <span className={`w-3 h-3 rounded-full ${theme.dot} shrink-0`} />
        <h3 className={`text-base font-bold ${theme.accent} uppercase tracking-wide`} title={`Audio pool: ${tierName} — sounds in this tier are grouped into one M4A sprite`}>{tierName}</h3>
        <span className={`${theme.badge} text-xs font-bold px-2.5 py-1 rounded-lg uppercase tracking-wider`} title={`Loading strategy: ${theme.label.toLowerCase()} — determines when this pool is loaded by playa-core`}>{theme.label}</span>
        {isDeferred && tierCfg.subLoaderId && (
          <span className={`${theme.badge} text-xs font-bold px-2.5 py-1 rounded-lg`} title={`playa-core SubLoader ID — call startSubLoader("${tierCfg.subLoaderId}") to load this pool`}>"{tierCfg.subLoaderId}"</span>
        )}
        {tierCfg?.unloadable && (
          <span className="bg-amber-500/15 text-amber-400 text-xs font-bold px-2.5 py-1 rounded-lg" title="This pool can be unloaded from RAM when no longer needed (e.g., after bonus ends)">UNLOADABLE</span>
        )}
        <div className="flex-1" />
        <span className="text-sm text-text-dim font-mono tabular-nums">{sounds.length} sounds</span>
        {displayKB ? (
          <span className={`text-sm font-mono tabular-nums font-semibold ${over ? 'text-danger' : theme.accent}`}>
            {fmtSize(displayKB)}
          </span>
        ) : null}
        {measuredRAM ? (
          <span className="text-xs font-mono tabular-nums text-orange" title="Estimated decoded RAM when Web Audio API loads this audio">
            ~{measuredRAM} MB RAM
          </span>
        ) : null}
        <button
          onClick={handleMeasure}
          disabled={measuring || sounds.length === 0}
          className={`btn-ghost !text-xs !py-2 !px-4 ${measuring ? '!text-text-dim !cursor-wait' : ''} disabled:!opacity-20`}
          title="Estimate compressed M4A size for this tier based on encoding settings"
        >
          {measuring ? 'Measuring...' : displayKB ? 'Re-measure' : 'Measure Size'}
        </button>

      </div>

      {/* Size bar — only show when we have data */}
      {maxKB > 0 && displayKB > 0 && (
        <div className="px-6 pt-3 pb-2">
          <div className="h-2 bg-bg-hover rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-700 ${over ? 'bg-danger' : theme.accentBg}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className={`text-xs font-mono ${over ? 'text-danger font-semibold' : 'text-text-dim'}`}>{Math.round(pct)}% used</span>
            <span className="text-xs text-text-dim font-mono">limit: {fmtSize(maxKB)}</span>
          </div>
        </div>
      )}

      {/* Sounds */}
      <div className="px-6 py-4 flex-1">
        <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-2 text-xs text-text-dim hover:text-text-secondary transition-colors mb-3 uppercase tracking-widest font-bold">
          <svg className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
          Sounds ({sounds.length})
        </button>
        {expanded && (
          <div className="flex flex-wrap gap-2">
            {sounds.map(s => (
              <span
                key={s}
                draggable
                onDragStart={(e) => { e.dataTransfer.setData('text/plain', JSON.stringify({ sound: s, from: tierName })); e.dataTransfer.effectAllowed = 'move'; }}
                className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-mono border cursor-grab active:cursor-grabbing transition-all ${!wavSet.has(s) ? 'text-danger border-danger/30 bg-danger/5 line-through' : 'text-text-secondary border-border/60 bg-bg-primary/50 hover:border-border-bright hover:bg-bg-hover/50'}`}
              >
                {s}
              </span>
            ))}
            {sounds.length === 0 && <span className="text-sm text-text-dim/50 italic py-3">Drop sounds here</span>}
          </div>
        )}
      </div>

      {/* Settings footer */}
      {!isStandalone && (
        <div className="px-6 py-4 border-t border-border/20 bg-bg-primary/30 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-dim uppercase tracking-wider font-semibold">Limit</span>
            <input type="number" value={maxKB || 0} onChange={(e) => onUpdate(() => { tierCfg.maxSizeKB = parseInt(e.target.value) || 0; })} className="input-base !w-24 text-center text-sm !py-1.5 !px-2 !rounded-lg" />
            <span className="text-xs text-text-dim">KB</span>
          </div>

          <select value={tierCfg.subLoaderId || ''} onChange={(e) => onUpdate(() => { if (e.target.value === '') { delete tierCfg.subLoaderId; delete tierCfg.unloadable; } else { tierCfg.subLoaderId = e.target.value; if (tierCfg.unloadable === undefined) tierCfg.unloadable = false; } })} className="input-base text-sm !py-1.5 !px-3 !w-52 !rounded-lg">
            {SUBLOADER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          {isDeferred && (
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={tierCfg.unloadable === true} onChange={(e) => onUpdate(() => { tierCfg.unloadable = e.target.checked; })} className="w-4 h-4 accent-amber-400 rounded cursor-pointer" />
              <span className="text-sm text-text-dim">Unloadable after use</span>
            </label>
          )}

          {isDeferred && (
            <div className="flex items-center gap-3 ml-auto">
              <code className={`text-xs font-mono ${theme.accent}`}>
                startSubLoader("{tierCfg.subLoaderId}")
              </code>
              <button onClick={() => onCopy(tierName, buildSnippet(tierName, tierCfg))} className="btn-ghost !text-xs !py-1.5 !px-4" title="Copy SubLoader integration code snippet to clipboard">{copied === tierName ? '✓ Copied' : 'Copy Snippet'}</button>
            </div>
          )}
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
  const copyTimerRef = useRef(null);

  useEffect(() => {
    if (project?.spriteConfig) setConfig(structuredClone(project.spriteConfig));
    else setConfig(null);
    setDirty(false); setSaving(false); setPreview(null); setAssignTarget({});
    setConfigKey(k => k + 1);
  }, [project?.path]);

  const unassigned = useMemo(() => {
    if (!config || !project?.sounds) return [];
    const assigned = new Set([
      ...Object.values(config.sprites || {}).flatMap(t => t.sounds || []),
      ...(config.standalone?.sounds || []),
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
    if ((tierName === 'standalone' || tierName === 'streaming') && sounds.length > 0) {
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
      <div className="anim-fade-up flex flex-col items-center justify-center h-64 text-text-dim text-sm">
        No sprite-config.json found in project.
      </div>
    );
  }

  const tierOptions = [...Object.keys(config.sprites || {}), 'standalone', 'streaming'];
  const update = (fn) => { fn(); setConfig(structuredClone(config)); setDirty(true); };

  const handleMove = (soundName, fromTier, toTier) => {
    if (!toTier || toTier === fromTier) return;
    update(() => {
      // Remove from source (skip if dragged from unassigned)
      if (fromTier === '__unassigned__') { /* nothing to remove */ }
      else if (fromTier === 'streaming') {
        if (config.streaming) config.streaming.sounds = (config.streaming.sounds || []).filter(s => s !== soundName);
      } else if (fromTier === 'standalone') {
        if (config.standalone) config.standalone.sounds = (config.standalone.sounds || []).filter(s => s !== soundName);
      } else if (config.sprites[fromTier]) {
        config.sprites[fromTier].sounds = (config.sprites[fromTier].sounds || []).filter(s => s !== soundName);
      }
      // Add to target
      if (toTier === 'streaming') {
        if (!config.streaming) config.streaming = { sounds: [] };
        if (!config.streaming.sounds.includes(soundName)) config.streaming.sounds.push(soundName);
      } else if (toTier === 'standalone') {
        if (!config.standalone) config.standalone = { sounds: [] };
        if (!config.standalone.sounds.includes(soundName)) config.standalone.sounds.push(soundName);
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
      } else if (tierKey === 'standalone') {
        if (!config.standalone) config.standalone = { sounds: [] };
        if (!config.standalone.sounds.includes(soundName)) config.standalone.sounds.push(soundName);
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
    if (previewIsReassign) {
      // Clear all pools first — full re-assignment
      update(() => {
        for (const tier of Object.values(config.sprites || {})) tier.sounds = [];
        if (config.standalone) config.standalone.sounds = [];
        if (config.streaming) config.streaming.sounds = [];
      });
    }
    preview.forEach(({ name, tier }) => handleAssign(name, tier));
    setPreview(null);
    setPreviewIsReassign(false);
  };
  const handleCopyAll = () => handleCopy('__all__', deferredTiers.map(([n, tc]) => buildSnippet(n, tc)).join('\n\n'));

  // Group tiers by loading type for visual ordering
  const immediateTiers = Object.entries(config.sprites || {}).filter(([, tc]) => !tc.subLoaderId);
  const deferredOnly = Object.entries(config.sprites || {}).filter(([, tc]) => tc.subLoaderId && tc.subLoaderId !== 'Z');
  const lazyTiers = Object.entries(config.sprites || {}).filter(([, tc]) => tc.subLoaderId === 'Z');
  const standaloneSounds = config.standalone?.sounds || [];
  const streamingSoundsArr = config.streaming?.sounds || [];

  return (
    <div className="anim-fade-up h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between pb-4">
        <div>
          <h2 className="text-xl font-bold text-text-primary">Sprite Config</h2>
          <p className="text-sm text-text-dim mt-1">Audio pools, loading strategy, encoding</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => handleOpenPreview(true)} className="btn-ghost text-xs" title="Clear all tier assignments and re-run auto-assign from scratch based on naming patterns">
            Re-assign All
          </button>
          <label className="flex items-center gap-2 text-xs text-text-dim font-semibold uppercase tracking-wider" title="Silence gap between sounds in the sprite (milliseconds)">
            Gap
            <input type="number" step="1" min="0" value={Math.round((config.spriteGap ?? 0.05) * 1000)} onChange={(e) => update(() => { config.spriteGap = (parseInt(e.target.value) || 0) / 1000; })} className="input-base !w-16 text-center text-sm !py-1.5 !px-2 !rounded-lg" />
            ms
          </label>
          <button onClick={handleSave} disabled={!dirty || saving} className={dirty && !saving ? 'btn-primary' : 'btn-ghost opacity-40 cursor-not-allowed'} title="Save sprite-config.json with current tier assignments and encoding settings">
            {saving ? 'Saving...' : dirty ? 'Save Changes' : 'Saved'}
          </button>
        </div>
      </div>

      {/* Unassigned banner */}
      {unassigned.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 shrink-0 mb-4">
          <div className="flex items-center gap-3 mb-4">
            <span className="w-3 h-3 rounded-full bg-amber-400 shrink-0 anim-pulse-dot" />
            <span className="text-sm font-bold text-amber-400 uppercase tracking-wide">{unassigned.length} Unassigned Sound{unassigned.length !== 1 ? 's' : ''}</span>
            <div className="flex-1" />
            <button onClick={handleOpenPreview} className="btn-primary py-2.5 px-5" title="Automatically assign unassigned sounds to tiers based on naming patterns (loading, main, bonus, standalone)">Auto-Assign All</button>
          </div>
          <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto pr-1">
            {unassigned.map(s => (
              <span
                key={s.name}
                draggable
                onDragStart={(e) => { e.dataTransfer.setData('text/plain', JSON.stringify({ sound: s.name, from: '__unassigned__' })); e.dataTransfer.effectAllowed = 'move'; }}
                className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-mono text-amber-300 border border-amber-500/30 bg-amber-500/8 cursor-grab active:cursor-grabbing hover:border-amber-400/50 hover:bg-amber-500/12 transition-all"
              >
                {s.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Pool cards — fill remaining height */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        <div className="flex flex-col gap-3 min-h-full">

          {/* Immediate pools */}
          {immediateTiers.length > 0 && (
            <div className="flex flex-col gap-3 flex-1">
              {immediateTiers.map(([name, cfg]) => (
                <PoolCard key={name + '_' + configKey} tierName={name} tierCfg={cfg} sounds={cfg.sounds || []} theme={getTheme(cfg, name)} maxKB={cfg.maxSizeKB || 0} sizeInfo={poolSizeInfo(name, cfg.sounds || [])} wavSet={wavSet} tierOptions={tierOptions} onMove={handleMove} onUpdate={update} onCopy={handleCopy} copied={copied} config={config} showToast={showToast} />
              ))}
            </div>
          )}

          {/* Standalone */}
          {(standaloneSounds.length > 0 || Object.keys(config.sprites || {}).length > 0) && (
            <div className="flex-1">
              <PoolCard key={'standalone_' + configKey} tierName="standalone" tierCfg={{}} sounds={standaloneSounds} theme={POOL_THEME.standalone} maxKB={0} sizeInfo={poolSizeInfo('standalone', standaloneSounds)} wavSet={wavSet} tierOptions={tierOptions} onMove={handleMove} onUpdate={update} onCopy={handleCopy} copied={copied} config={config} showToast={showToast} />
            </div>
          )}

          {/* Streaming — HTML5 Audio, excluded from manifest */}
          {(streamingSoundsArr.length > 0 || Object.keys(config.sprites || {}).length > 0) && (
            <div className="flex-1">
              <div className="flex items-center gap-3 px-1 pt-1 mb-3">
                <div className="h-px flex-1 bg-gradient-to-r from-rose-500/30 to-transparent" />
                <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-rose-400/60" title="Music loaded via HTML5 Audio — streams from disk, ~3 MB RAM instead of ~40 MB. Excluded from soundManifest. Auto-generates BGMStreaming.ts for game developer.">Streaming (HTML5 Audio)</span>
                <div className="h-px flex-1 bg-gradient-to-l from-rose-500/30 to-transparent" />
              </div>
              <PoolCard key={'streaming_' + configKey} tierName="streaming" tierCfg={{}} sounds={streamingSoundsArr} theme={POOL_THEME.streaming} maxKB={0} sizeInfo={poolSizeInfo('streaming', streamingSoundsArr)} wavSet={wavSet} tierOptions={tierOptions} onMove={handleMove} onUpdate={update} onCopy={handleCopy} copied={copied} config={config} showToast={showToast} />
            </div>
          )}

          {/* Deferred pools */}
          {deferredOnly.length > 0 && (
            <div className="flex flex-col gap-3 flex-1">
              <div className="flex items-center gap-3 px-1 pt-1">
                <div className="h-px flex-1 bg-gradient-to-r from-sky-500/30 to-transparent" />
                <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-sky-400/60" title="Pools loaded on demand via startSubLoader() — not loaded at game start">Deferred Pools</span>
                <div className="h-px flex-1 bg-gradient-to-l from-sky-500/30 to-transparent" />
              </div>
              {deferredOnly.map(([name, cfg]) => (
                <PoolCard key={name + '_' + configKey} tierName={name} tierCfg={cfg} sounds={cfg.sounds || []} theme={getTheme(cfg, name)} maxKB={cfg.maxSizeKB || 0} sizeInfo={poolSizeInfo(name, cfg.sounds || [])} wavSet={wavSet} tierOptions={tierOptions} onMove={handleMove} onUpdate={update} onCopy={handleCopy} copied={copied} config={config} showToast={showToast} />
              ))}
            </div>
          )}

          {/* Lazy pools */}
          {lazyTiers.length > 0 && (
            <div className="flex flex-col gap-3 flex-1">
              <div className="flex items-center gap-3 px-1 pt-1">
                <div className="h-px flex-1 bg-gradient-to-r from-amber-500/30 to-transparent" />
                <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-amber-400/60" title="Pools loaded lazily (SubLoader Z) — loaded just before the sounds are needed">Lazy Pools</span>
                <div className="h-px flex-1 bg-gradient-to-l from-amber-500/30 to-transparent" />
              </div>
              {lazyTiers.map(([name, cfg]) => (
                <PoolCard key={name + '_' + configKey} tierName={name} tierCfg={cfg} sounds={cfg.sounds || []} theme={getTheme(cfg, name)} maxKB={cfg.maxSizeKB || 0} sizeInfo={poolSizeInfo(name, cfg.sounds || [])} wavSet={wavSet} tierOptions={tierOptions} onMove={handleMove} onUpdate={update} onCopy={handleCopy} copied={copied} config={config} showToast={showToast} />
              ))}
            </div>
          )}

          {/* Encoding */}
          <div className="flex-none">
            <div className="flex items-center gap-3 px-1 pt-1 pb-3">
              <div className="h-px flex-1 bg-gradient-to-r from-border/50 to-transparent" />
              <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-text-dim/60" title="M4A encoding settings for SFX and Music — bitrate, channels, and sample rate">Encoding</span>
              <div className="h-px flex-1 bg-gradient-to-l from-border/50 to-transparent" />
            </div>
            <div className="rounded-2xl border border-border/50 overflow-hidden">
              <div className="px-6 py-4 space-y-4">
                {Object.entries(config.encoding || {}).map(([key, enc]) => (
                  <div key={key} className="flex items-center gap-4 flex-wrap">
                    <span className={`text-sm font-bold uppercase tracking-wider w-14 ${key === 'sfx' ? 'text-sky-400' : 'text-violet-400'}`}>{key}</span>
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input type="checkbox" checked={enc.keepOriginal === true} onChange={(e) => update(() => { enc.keepOriginal = e.target.checked; })} className="w-4 h-4 accent-accent rounded cursor-pointer" />
                      <span className="text-sm text-text-dim">Keep Original</span>
                    </label>
                    {enc.keepOriginal ? (
                      <span className="text-sm text-text-dim italic">320 kbps, source channels & sample rate</span>
                    ) : (
                      <>
                        <span className="text-sm text-text-dim">Bitrate:</span>
                        <select value={enc.bitrate || 64} onChange={(e) => update(() => { enc.bitrate = parseInt(e.target.value); })} className="input-base !w-28 text-sm !py-1.5 !px-2 !rounded-lg">
                          {[32, 48, 64, 96, 128, 160, 192, 256, 320].map(b => <option key={b} value={b}>{b} kbps</option>)}
                        </select>
                        <span className="text-sm text-text-dim ml-2">Channels:</span>
                        <select value={enc.channels || 2} onChange={(e) => update(() => { enc.channels = parseInt(e.target.value); })} className="input-base !w-28 text-sm !py-1.5 !px-2 !rounded-lg">
                          <option value={1}>Mono</option>
                          <option value={2}>Stereo</option>
                        </select>
                        <span className="text-sm text-text-dim ml-2">Sample Rate:</span>
                        <select value={enc.samplerate || 44100} onChange={(e) => update(() => { enc.samplerate = parseInt(e.target.value); })} className="input-base !w-28 text-sm !py-1.5 !px-2 !rounded-lg">
                          <option value={22050}>22050 Hz</option>
                          <option value={32000}>32000 Hz</option>
                          <option value={44100}>44100 Hz</option>
                          <option value={48000}>48000 Hz</option>
                        </select>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Copy all snippets */}
          {deferredTiers.length > 0 && (
            <div className="flex-none flex justify-end pb-2">
              <button onClick={handleCopyAll} className="btn-ghost" title="Copy all SubLoader integration code snippets for all deferred pools to clipboard">
                {copied === '__all__' ? '✓ All Snippets Copied' : 'Copy All SubLoader Snippets'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Auto-Assign Preview Modal */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-bg-secondary border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] mx-4 flex flex-col">
            <div className="p-5 border-b border-border">
              <h3 className="text-sm font-bold text-text-primary">Auto-Assign Preview</h3>
              <p className="text-xs text-text-dim mt-0.5">Review before applying. Change any tier below.</p>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
              {preview.map((item, i) => (
                <div key={item.name} className="flex items-center gap-2 bg-bg-primary/30 rounded-lg px-3 py-1.5">
                  <span className="font-mono text-xs text-text-primary flex-1 truncate">{item.name}</span>
                  <select value={item.tier || ''} onChange={e => setPreview(prev => prev.map((p, j) => j === i ? { ...p, tier: e.target.value } : p))} className="input-base text-xs !py-1 !px-2 !w-32 !rounded-lg">
                    {tierOptions.map(t => <option key={t} value={t}>{t === 'standalone' ? 'Standalone' : t === 'streaming' ? 'Streaming' : t}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-border flex gap-2 justify-end">
              <button onClick={() => setPreview(null)} className="btn-ghost text-xs px-4 py-2">Cancel</button>
              <button onClick={handleApplyPreview} className="btn-primary text-xs px-4 py-2">Apply All</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
