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
  const resolveTier = (name) => {
    if (!name) return null;
    return tierKeys.find(k => k === name) ?? tierKeys.find(k => k.toLowerCase() === name.toLowerCase()) ?? tierKeys.find(k => k.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(k.toLowerCase())) ?? null;
  };
  const PATTERNS = [
    { tier: 'standalone', re: /^(Base|Bonus|Main|Bg|Background)MusicLoop$/i },
    { tier: 'standalone', re: /MusicLoop$/i },
    { tier: 'loading', re: /^(Ui[A-Z]|ReelLand|Payline|RollupLow|BaseGameStart)/i },
    { tier: 'bonus', re: /^(Bonus|Picker|BaseToBonusStart|BonusToBase|FreeS|HoldAnd)/i },
    { tier: 'main', re: /Symbol[A-Za-z]\d+(Land|Anticipation)/i },
    { tier: 'main', re: /^(BigWin|Anticipation[A-Z]|PreBonus)/i },
    { tier: 'main', re: /^(Symbol|Rollup[1-9]|ScreenShake|IntroStart|SymbolPreshow)/i },
  ];
  const fallback = resolveTier('main') ?? tierKeys[tierKeys.length - 1] ?? null;
  return unassigned.map(s => {
    const tags = soundsJson?.soundDefinitions?.soundSprites?.[`s_${s.name}`]?.tags ?? [];
    if (musicTags?.some(mt => tags.includes(mt))) return { name: s.name, tier: 'standalone' };
    for (const { tier, re } of PATTERNS) {
      if (!re.test(s.name)) continue;
      if (tier === 'standalone') return { name: s.name, tier: 'standalone' };
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
};

function getTheme(tierCfg, tierName) {
  if (tierName === 'standalone') return POOL_THEME.standalone;
  if (tierCfg?.subLoaderId === 'Z') return POOL_THEME.lazy;
  if (tierCfg?.subLoaderId) return POOL_THEME.deferred;
  return POOL_THEME.immediate;
}

const fmtSize = (kb) => kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB';

function PoolCard({ tierName, tierCfg, sounds, theme, maxKB, sizeInfo, wavSet, tierOptions, onMove, onUpdate, onCopy, copied, config }) {
  const [expanded, setExpanded] = useState(true);
  const [measuring, setMeasuring] = useState(false);
  const [measuredKB, setMeasuredKB] = useState(null);
  const displayKB = measuredKB ?? (sizeInfo.isActual ? sizeInfo.kb : null);
  const over = maxKB > 0 && displayKB && displayKB > maxKB;
  const pct = maxKB > 0 && displayKB ? Math.min(100, (displayKB / maxKB) * 100) : 0;
  const isStandalone = tierName === 'standalone';
  const isDeferred = !!tierCfg?.subLoaderId;

  const handleMeasure = async () => {
    if (sounds.length === 0) return;
    setMeasuring(true);
    try {
      // Determine encoding for this tier
      const enc = isStandalone
        ? config?.encoding?.music || { bitrate: 96, channels: 2, samplerate: 44100 }
        : config?.encoding?.sfx || { bitrate: 64, channels: 1, samplerate: 44100 };
      const r = await window.api.measurePool({ tierName, sounds, encoding: enc });
      if (r?.sizeKB !== undefined) setMeasuredKB(r.sizeKB);
    } catch {}
    setMeasuring(false);
  };

  return (
    <div className={`rounded-2xl border ${theme.border} overflow-hidden shadow-lg ${theme.glow} transition-all duration-200 hover:shadow-xl`}>
      {/* Header */}
      <div className={`${theme.headerBg} px-5 py-3.5 flex items-center gap-3 flex-wrap`}>
        <span className={`w-2.5 h-2.5 rounded-full ${theme.dot} shrink-0`} />
        <h3 className={`text-sm font-bold ${theme.accent} uppercase tracking-wide`}>{tierName}</h3>
        <span className={`${theme.badge} text-xs font-bold px-2 py-0.5 rounded-md uppercase tracking-wider`}>{theme.label}</span>
        {isDeferred && tierCfg.subLoaderId && (
          <span className={`${theme.badge} text-xs font-bold px-2 py-0.5 rounded-md`}>"{tierCfg.subLoaderId}"</span>
        )}
        {tierCfg?.unloadable && (
          <span className="bg-amber-500/15 text-amber-400 text-xs font-bold px-2 py-0.5 rounded-md">UNLOADABLE</span>
        )}
        <div className="flex-1" />
        <span className="text-xs text-text-dim font-mono tabular-nums">{sounds.length} sounds</span>
        {displayKB ? (
          <span className={`text-xs font-mono tabular-nums font-semibold ${over ? 'text-danger' : theme.accent}`}>
            {fmtSize(displayKB)}
          </span>
        ) : null}
        <button
          onClick={handleMeasure}
          disabled={measuring || sounds.length === 0}
          className={`text-xs px-3 py-1 rounded-lg font-semibold transition-all ${measuring ? 'text-text-dim cursor-wait' : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover/50 cursor-pointer'} disabled:opacity-30 disabled:cursor-not-allowed`}
        >
          {measuring ? 'Measuring...' : displayKB ? 'Re-measure' : 'Measure'}
        </button>
      </div>

      {/* Size bar — only show when we have data */}
      {maxKB > 0 && displayKB > 0 && (
        <div className="px-5 pt-2 pb-1">
          <div className="h-1.5 bg-bg-hover rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-700 ${over ? 'bg-danger' : theme.accentBg}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="flex justify-between mt-1">
            <span className={`text-xs font-mono ${over ? 'text-danger' : 'text-text-dim'}`}>{Math.round(pct)}%</span>
            <span className="text-xs text-text-dim font-mono">limit: {fmtSize(maxKB)}</span>
          </div>
        </div>
      )}

      {/* Sounds */}
      <div className="px-5 py-3">
        <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-1.5 text-xs text-text-dim hover:text-text-secondary transition-colors mb-2 uppercase tracking-widest font-bold">
          <svg className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
          Sounds
        </button>
        {expanded && (
          <div className="flex flex-wrap gap-1.5">
            {sounds.map(s => (
              <span key={s} className={`inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-lg text-xs font-mono border transition-all ${!wavSet.has(s) ? 'text-danger border-danger/30 bg-danger/5 line-through' : 'text-text-secondary border-border/60 bg-bg-primary/50 hover:border-border-bright hover:bg-bg-hover/50'}`}>
                {s}
                <select value="" onChange={(e) => { if (e.target.value) onMove(s, tierName, e.target.value); }} className="bg-transparent text-text-dim cursor-pointer w-5 text-center appearance-none opacity-30 hover:opacity-100 transition-opacity" title="Move to...">
                  <option value="">→</option>
                  {tierOptions.filter(t => t !== tierName).map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </span>
            ))}
            {sounds.length === 0 && <span className="text-xs text-text-dim/50 italic py-2">No sounds assigned yet</span>}
          </div>
        )}
      </div>

      {/* Settings footer — only for deferred/lazy tiers */}
      {!isStandalone && (
        <div className="px-5 py-3 border-t border-border/20 bg-bg-primary/30 flex items-center gap-3 flex-wrap">
          {/* Max size */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-text-dim uppercase tracking-wider font-semibold">Limit</span>
            <input type="number" value={maxKB || 0} onChange={(e) => onUpdate(() => { tierCfg.maxSizeKB = parseInt(e.target.value) || 0; })} className="input-base !w-20 text-center text-xs !py-1 !px-2 !rounded-lg" />
            <span className="text-xs text-text-dim">KB</span>
          </div>

          {/* SubLoader select */}
          <select value={tierCfg.subLoaderId || ''} onChange={(e) => onUpdate(() => { if (e.target.value === '') { delete tierCfg.subLoaderId; delete tierCfg.unloadable; } else { tierCfg.subLoaderId = e.target.value; if (tierCfg.unloadable === undefined) tierCfg.unloadable = false; } })} className="input-base text-xs !py-1 !px-2 !w-44 !rounded-lg">
            {SUBLOADER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          {/* Unloadable checkbox */}
          {isDeferred && (
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input type="checkbox" checked={tierCfg.unloadable === true} onChange={(e) => onUpdate(() => { tierCfg.unloadable = e.target.checked; })} className="w-3.5 h-3.5 accent-amber-400 rounded cursor-pointer" />
              <span className="text-xs text-text-dim">Unloadable</span>
            </label>
          )}

          {/* Snippet */}
          {isDeferred && (
            <div className="flex items-center gap-2 ml-auto">
              <code className={`text-xs font-mono ${theme.accent} truncate max-w-xs`}>
                startSubLoader("{tierCfg.subLoaderId}")
              </code>
              <button onClick={() => onCopy(tierName, buildSnippet(tierName, tierCfg))} className="btn-ghost !text-xs !py-0.5 !px-2.5 !rounded-lg">{copied === tierName ? '✓' : 'Copy'}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SpriteConfigPage({ project, showToast }) {
  const [config, setConfig]           = useState(null);
  const [dirty, setDirty]             = useState(false);
  const [saving, setSaving]           = useState(false);
  const [assignTarget, setAssignTarget] = useState({});
  const [preview, setPreview]         = useState(null);
  const [copied, setCopied]           = useState(null);
  const copyTimerRef = useRef(null);

  useEffect(() => {
    if (project?.spriteConfig) setConfig(structuredClone(project.spriteConfig));
    else setConfig(null);
    setDirty(false); setSaving(false); setPreview(null); setAssignTarget({});
  }, [project?.path]);

  const unassigned = useMemo(() => {
    if (!config || !project?.sounds) return [];
    const assigned = new Set([
      ...Object.values(config.sprites || {}).flatMap(t => t.sounds || []),
      ...(config.standalone?.sounds || []),
    ]);
    return project.sounds.filter(s => !assigned.has(s.name));
  }, [config, project?.sounds]);

  const deferredTiers = useMemo(() => {
    if (!config) return [];
    return Object.entries(config.sprites || {}).filter(([, tc]) => tc.subLoaderId);
  }, [config]);

  const wavSet = useMemo(() => new Set((project?.sounds || []).map(s => s.name)), [project?.sounds]);

  const wavSizeMap = useMemo(() => {
    const m = {};
    for (const s of (project?.sounds || [])) m[s.name] = s.sizeKB || 0;
    return m;
  }, [project?.sounds]);

  const distSizes = project?.distInfo?.spriteSizes || {};
  // gameName from audio repo folder (not game repo) — matches how buildTiered.js names output files
  const gameName = project?.path?.split(/[/\\]/).pop()?.replace(/-audio$/, '') || '';

  const poolSizeInfo = (tierName, sounds) => {
    // Only show real M4A sizes from dist/ — no estimation
    for (const fname of [`${gameName}_${tierName}.m4a`, `${tierName}.m4a`]) {
      if (distSizes[fname]) return { kb: distSizes[fname], isActual: true };
    }
    if (tierName === 'standalone') {
      let total = 0, foundAny = false;
      for (const s of sounds) {
        for (const f of [`${gameName}_${s}.m4a`, `${s}.m4a`]) { if (distSizes[f]) { total += distSizes[f]; foundAny = true; break; } }
      }
      if (foundAny) return { kb: total, isActual: true };
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

  const tierOptions = [...Object.keys(config.sprites || {}), 'standalone'];
  const update = (fn) => { fn(); setConfig(structuredClone(config)); setDirty(true); };

  const handleMove = (soundName, fromTier, toTier) => {
    if (!toTier || toTier === fromTier) return;
    update(() => {
      // Remove from source
      if (fromTier === 'standalone') {
        if (config.standalone) config.standalone.sounds = (config.standalone.sounds || []).filter(s => s !== soundName);
      } else if (config.sprites[fromTier]) {
        config.sprites[fromTier].sounds = (config.sprites[fromTier].sounds || []).filter(s => s !== soundName);
      }
      // Add to target
      if (toTier === 'standalone') {
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
      if (tierKey === 'standalone') {
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
      if (result?.success) { setDirty(false); showToast('Sprite config saved', 'success'); }
      else showToast(result?.error || 'Save failed', 'error');
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

  const handleOpenPreview = () => setPreview(computeAutoAssign(unassigned, config, project?.soundsJson, config.musicTags));
  const handleApplyPreview = () => { if (!preview) return; preview.forEach(({ name, tier }) => handleAssign(name, tier)); setPreview(null); };
  const handleCopyAll = () => handleCopy('__all__', deferredTiers.map(([n, tc]) => buildSnippet(n, tc)).join('\n\n'));

  // Group tiers by loading type for visual ordering
  const immediateTiers = Object.entries(config.sprites || {}).filter(([, tc]) => !tc.subLoaderId);
  const deferredOnly = Object.entries(config.sprites || {}).filter(([, tc]) => tc.subLoaderId && tc.subLoaderId !== 'Z');
  const lazyTiers = Object.entries(config.sprites || {}).filter(([, tc]) => tc.subLoaderId === 'Z');
  const standaloneSounds = config.standalone?.sounds || [];

  return (
    <div className="anim-fade-up h-full flex flex-col gap-3">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-text-primary">Sprite Config</h2>
          <p className="text-xs text-text-dim mt-0.5">Audio pools, loading strategy, encoding</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-bg-card border border-border rounded-xl px-3 py-1.5">
            <span className="text-xs text-text-dim font-semibold uppercase tracking-wider">Gap</span>
            <input type="number" step="0.01" value={config.spriteGap ?? 0.05} onChange={(e) => update(() => { config.spriteGap = parseFloat(e.target.value) || 0; })} className="input-base !w-14 text-center text-xs !py-0.5 !px-1 !rounded-lg" />
            <span className="text-xs text-text-dim">s</span>
          </div>
          <button onClick={handleSave} disabled={!dirty || saving} className={dirty && !saving ? 'btn-primary text-xs' : 'btn-ghost text-xs opacity-40 cursor-not-allowed'}>
            {saving ? 'Saving...' : dirty ? 'Save' : 'Saved'}
          </button>
        </div>
      </div>

      {/* Unassigned banner */}
      {unassigned.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 shrink-0">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0 anim-pulse-dot" />
            <span className="text-xs font-bold text-amber-400 uppercase tracking-wide">{unassigned.length} Unassigned</span>
            <div className="flex-1" />
            <button onClick={handleOpenPreview} className="btn-primary text-xs py-1.5 px-4">Auto-Assign</button>
          </div>
          <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto">
            {unassigned.map(s => (
              <div key={s.name} className="flex items-center gap-1.5 bg-bg-primary/40 rounded-lg px-2 py-1">
                <span className="font-mono text-xs text-text-secondary flex-1 truncate">{s.name}</span>
                <select value={assignTarget[s.name] || ''} onChange={e => setAssignTarget(prev => ({ ...prev, [s.name]: e.target.value }))} className="input-base text-xs !py-0.5 !px-1.5 !w-24 !rounded-lg">
                  <option value="">Tier...</option>
                  {Object.keys(config.sprites || {}).map(t => <option key={t}>{t}</option>)}
                  <option value="standalone">Standalone</option>
                </select>
                <button onClick={() => handleAssign(s.name, assignTarget[s.name])} disabled={!assignTarget[s.name]} className="text-xs font-bold text-accent disabled:text-text-dim/30 hover:text-accent-hover transition-colors">Add</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pool cards */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">

        {/* Immediate pools */}
        {immediateTiers.map(([name, cfg]) => (
          <PoolCard key={name} tierName={name} tierCfg={cfg} sounds={cfg.sounds || []} theme={getTheme(cfg, name)} maxKB={cfg.maxSizeKB || 0} sizeInfo={poolSizeInfo(name, cfg.sounds || [])} wavSet={wavSet} tierOptions={tierOptions} onMove={handleMove} onUpdate={update} onCopy={handleCopy} copied={copied} config={config} />
        ))}

        {/* Standalone */}
        {(standaloneSounds.length > 0 || Object.keys(config.sprites || {}).length > 0) && (
          <PoolCard tierName="standalone" tierCfg={{}} sounds={standaloneSounds} theme={POOL_THEME.standalone} maxKB={0} sizeInfo={poolSizeInfo('standalone', standaloneSounds, 5)} wavSet={wavSet} tierOptions={tierOptions} onMove={handleMove} onUpdate={update} onCopy={handleCopy} copied={copied} config={config} />
        )}

        {/* Deferred pools */}
        {deferredOnly.map(([name, cfg]) => (
          <PoolCard key={name} tierName={name} tierCfg={cfg} sounds={cfg.sounds || []} theme={getTheme(cfg, name)} maxKB={cfg.maxSizeKB || 0} sizeInfo={poolSizeInfo(name, cfg.sounds || [])} wavSet={wavSet} tierOptions={tierOptions} onMove={handleMove} onUpdate={update} onCopy={handleCopy} copied={copied} config={config} />
        ))}

        {/* Lazy pools */}
        {lazyTiers.map(([name, cfg]) => (
          <PoolCard key={name} tierName={name} tierCfg={cfg} sounds={cfg.sounds || []} theme={getTheme(cfg, name)} maxKB={cfg.maxSizeKB || 0} sizeInfo={poolSizeInfo(name, cfg.sounds || [])} wavSet={wavSet} tierOptions={tierOptions} onMove={handleMove} onUpdate={update} onCopy={handleCopy} copied={copied} config={config} />
        ))}

        {/* Encoding */}
        <div className="rounded-2xl border border-border/50 overflow-hidden">
          <div className="bg-bg-hover/30 px-5 py-3 flex items-center gap-2">
            <span className="text-xs font-bold tracking-widest uppercase text-text-dim">Encoding</span>
          </div>
          <div className="px-5 py-3 space-y-2">
            {Object.entries(config.encoding || {}).map(([key, enc]) => (
              <div key={key} className="flex items-center gap-3 flex-wrap">
                <span className={`text-xs font-bold uppercase tracking-wider w-12 ${key === 'sfx' ? 'text-sky-400' : 'text-violet-400'}`}>{key}</span>
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input type="checkbox" checked={enc.keepOriginal === true} onChange={(e) => update(() => { enc.keepOriginal = e.target.checked; })} className="w-3.5 h-3.5 accent-accent rounded cursor-pointer" />
                  <span className="text-xs text-text-dim">Keep Original</span>
                </label>
                {enc.keepOriginal ? (
                  <span className="text-xs text-text-dim italic">320kbps, source channels & rate</span>
                ) : (
                  <>
                    <span className="text-xs text-text-dim">Bitrate:</span>
                    <input type="number" value={enc.bitrate || 64} onChange={(e) => update(() => { enc.bitrate = parseInt(e.target.value) || 64; })} className="input-base !w-16 text-center text-xs !py-0.5 !px-1 !rounded-lg" />
                    <span className="text-xs text-text-dim">kbps</span>
                    <span className="text-xs text-text-dim ml-2">Ch:</span>
                    <select value={enc.channels || 2} onChange={(e) => update(() => { enc.channels = parseInt(e.target.value); })} className="input-base !w-20 text-xs !py-0.5 !px-1 !rounded-lg">
                      <option value={1}>Mono</option>
                      <option value={2}>Stereo</option>
                    </select>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Copy all snippets */}
        {deferredTiers.length > 0 && (
          <div className="flex justify-end pb-2">
            <button onClick={handleCopyAll} className="btn-ghost text-xs py-1.5 px-4">
              {copied === '__all__' ? '✓ Copied' : 'Copy All SubLoader Snippets'}
            </button>
          </div>
        )}
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
                    {tierOptions.map(t => <option key={t} value={t}>{t === 'standalone' ? 'Standalone' : t}</option>)}
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
