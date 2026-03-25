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

function tierLoadBadge(tierCfg) {
  const id = tierCfg?.subLoaderId;
  if (!id) return null;
  const isLazy = id === 'Z';
  return (
    <span className={`badge text-xs ${isLazy ? 'bg-orange-dim text-orange' : 'bg-cyan-dim text-cyan'}`}>
      {isLazy ? `Lazy ${id}` : `Deferred ${id}`}
    </span>
  );
}

function buildSnippet(tierName, tierCfg) {
  const id = tierCfg.subLoaderId;
  const isLazy = id === 'Z';
  const lines = [
    `// ── ${tierName} pool — SubLoader "${id}" ──`,
    isLazy
      ? `// Lazy: call just before you need these sounds`
      : `// Deferred: start background load at the right lifecycle event`,
    `slotProps.startSubLoader("${id}");`,
  ];
  if (tierCfg.unloadable) {
    lines.push('');
    lines.push(`// Unload ${tierName} from RAM when session ends:`);
    lines.push(`loaderService.soundLoader.unloadSubLoader("${id}");`);
  }
  return lines.join('\n');
}

function computeAutoAssign(unassigned, config, soundsJson, musicTags) {
  const tierKeys = Object.keys(config.sprites || {});

  const resolveTier = (name) => {
    if (!name) return null;
    const exact = tierKeys.find(k => k === name);
    if (exact) return exact;
    const ci = tierKeys.find(k => k.toLowerCase() === name.toLowerCase());
    if (ci) return ci;
    const fuzzy = tierKeys.find(k =>
      k.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(k.toLowerCase())
    );
    return fuzzy ?? null;
  };

  // Priority-ordered patterns — first match wins
  const PATTERNS = [
    // Standalone: music loops — too large for sprites
    { tier: 'standalone', re: /^(Base|Bonus|Main|Bg|Background)MusicLoop$/i },
    { tier: 'standalone', re: /MusicLoop$/i },

    // Loading: minimum for first spin — UI controls, reel land, payline, base rollup
    { tier: 'loading', re: /^(Ui[A-Z]|ReelLand|Payline|RollupLow|BaseGameStart)/i },

    // Bonus: all bonus modes (free spins, hold & win, picker) + transitions
    { tier: 'bonus', re: /^(Bonus|Picker|BaseToBonusStart|BonusToBase|FreeS|HoldAnd)/i },

    // Main: everything else — symbols, big win, anticipation, rollups, screen effects
    { tier: 'main', re: /Symbol[A-Za-z]\d+(Land|Anticipation)/i },
    { tier: 'main', re: /^(BigWin|Anticipation[A-Z]|PreBonus)/i },
    { tier: 'main', re: /^(Symbol|Rollup[1-9]|ScreenShake|IntroStart|SymbolPreshow)/i },
  ];

  const fallback = resolveTier('main') ?? tierKeys[tierKeys.length - 1] ?? null;

  return unassigned.map(s => {
    // 1. Tags in soundsJson take priority (explicit Music tag → standalone)
    const tags = soundsJson?.soundDefinitions?.soundSprites?.[`s_${s.name}`]?.tags ?? [];
    if (musicTags?.some(mt => tags.includes(mt))) return { name: s.name, tier: 'standalone' };

    // 2. Name-based pattern matching
    for (const { tier, re } of PATTERNS) {
      if (!re.test(s.name)) continue;
      if (tier === 'standalone') return { name: s.name, tier: 'standalone' };
      const resolved = resolveTier(tier);
      if (resolved) return { name: s.name, tier: resolved };
    }

    // 3. Fallback
    return { name: s.name, tier: fallback };
  });
}

export default function SpriteConfigPage({ project, showToast }) {
  const [config, setConfig]           = useState(null);
  const [dirty, setDirty]             = useState(false);
  const [saving, setSaving]           = useState(false);
  const [assignTarget, setAssignTarget] = useState({});
  const [preview, setPreview]         = useState(null);
  const [copied, setCopied]           = useState(null); // tier name that was just copied
  const copyTimerRef = useRef(null);

  useEffect(() => {
    if (project?.spriteConfig) {
      setConfig(structuredClone(project.spriteConfig));
    } else {
      setConfig(null);
    }
    setDirty(false);
    setSaving(false);
    setPreview(null);
    setAssignTarget({});
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

  // WAV size lookup: soundName → sizeKB
  const wavSizeMap = useMemo(() => {
    const m = {};
    for (const s of (project?.sounds || [])) m[s.name] = s.sizeKB || 0;
    return m;
  }, [project?.sounds]);

  // dist M4A sizes: { "gameName_tierName.m4a": sizeKB }
  const distSizes = project?.distInfo?.spriteSizes || {};
  // gameName prefix for matching dist files to tiers
  const gameName = (project?.settings?.gameProjectPath || '').split(/[/\\]/).pop()?.replace(/-game$/, '') || '';

  // Pool size: returns { estKB, actualKB, isActual }
  // If dist has a matching M4A, show actual. Otherwise estimate from WAV sizes.
  const poolSizeInfo = (tierName, sounds, ratio = 8) => {
    // Try to find actual M4A in dist — format: gameName_tierName.m4a
    const possibleNames = [
      `${gameName}_${tierName}.m4a`,
      `${tierName}.m4a`,
    ];
    for (const fname of possibleNames) {
      if (distSizes[fname]) return { kb: distSizes[fname], isActual: true };
    }
    // Standalone: each sound is its own M4A
    if (tierName === 'standalone') {
      let total = 0;
      let foundAny = false;
      for (const s of sounds) {
        const fname = `${gameName}_${s}.m4a`;
        if (distSizes[fname]) { total += distSizes[fname]; foundAny = true; }
        else { const f2 = `${s}.m4a`; if (distSizes[f2]) { total += distSizes[f2]; foundAny = true; } }
      }
      if (foundAny) return { kb: total, isActual: true };
    }
    // Fallback: estimate from WAV
    const totalWavKB = sounds.reduce((sum, name) => sum + (wavSizeMap[name] || 0), 0);
    return { kb: Math.round(totalWavKB / ratio), isActual: false };
  };

  const formatSize = (kb) => kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB';

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

  const removeSoundFrom = (soundName, fromTier) => {
    if (fromTier === 'standalone') {
      if (config.standalone) config.standalone.sounds = (config.standalone.sounds || []).filter(s => s !== soundName);
    } else if (config.sprites[fromTier]) {
      config.sprites[fromTier].sounds = (config.sprites[fromTier].sounds || []).filter(s => s !== soundName);
    }
  };

  const handleAssign = (soundName, tierKey) => {
    if (!tierKey) return;
    if (tierKey === 'standalone') {
      update(() => {
        if (!config.standalone) config.standalone = { sounds: [] };
        if (!config.standalone.sounds.includes(soundName)) config.standalone.sounds.push(soundName);
      });
    } else {
      if (!config.sprites[tierKey]) return;
      update(() => {
        if (!config.sprites[tierKey].sounds) config.sprites[tierKey].sounds = [];
        if (!config.sprites[tierKey].sounds.includes(soundName)) config.sprites[tierKey].sounds.push(soundName);
      });
    }
    setAssignTarget(prev => ({ ...prev, [soundName]: '' }));
  };

  const handleMove = (soundName, fromTier, toTier) => {
    if (!toTier || toTier === fromTier) return;
    update(() => {
      removeSoundFrom(soundName, fromTier);
      if (toTier === 'standalone') {
        if (!config.standalone) config.standalone = { sounds: [] };
        if (!config.standalone.sounds.includes(soundName)) config.standalone.sounds.push(soundName);
      } else if (config.sprites[toTier]) {
        if (!config.sprites[toTier].sounds) config.sprites[toTier].sounds = [];
        if (!config.sprites[toTier].sounds.includes(soundName)) config.sprites[toTier].sounds.push(soundName);
      }
    });
  };

  const handleOpenPreview = () => {
    const proposals = computeAutoAssign(unassigned, config, project?.soundsJson, config.musicTags);
    setPreview(proposals);
  };

  const handleApplyPreview = () => {
    if (!preview) return;
    preview.forEach(({ name, tier }) => handleAssign(name, tier));
    setPreview(null);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await window.api.saveSpriteConfig(config);
      if (result?.success) { setDirty(false); showToast('Sprite config saved', 'success'); }
      else showToast(result?.error || 'Save failed', 'error');
    } catch (e) {
      showToast('Save failed: ' + e.message, 'error');
    }
    setSaving(false);
  };

  const handleCopy = (key, text) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(null), 2000);
    }).catch(() => showToast('Clipboard copy failed', 'error'));
  };

  const handleCopyAll = () => {
    const all = deferredTiers.map(([n, tc]) => buildSnippet(n, tc)).join('\n\n');
    handleCopy('__all__', all);
  };

  return (
    <div className="anim-fade-up h-full flex flex-col gap-2">
      {/* Header + Gap + Unassigned in one compact row group */}
      <div className="shrink-0 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-text-primary">Sprite Configuration</h2>
          <p className="text-xs text-text-dim mt-0.5">Tier-based grouping, loading strategy, and encoding</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 card px-3 py-1.5">
            <p className="section-label">Gap</p>
            <input
              type="number"
              step="0.01"
              value={config.spriteGap ?? 0.05}
              onChange={(e) => update(() => { config.spriteGap = parseFloat(e.target.value) || 0; })}
              className="input-base w-16 text-center text-xs py-1 px-2"
            />
            <span className="text-[11px] text-text-dim">s</span>
          </div>
          <button onClick={handleSave} disabled={!dirty || saving} className={dirty && !saving ? 'btn-primary text-xs' : 'btn-ghost text-xs opacity-50 cursor-not-allowed'}>
            {dirty ? 'Save' : 'Saved'}
          </button>
        </div>
      </div>

      {/* Unassigned — compact banner */}
      {unassigned.length > 0 && (
        <div className="card p-3 border border-orange/30 shrink-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="badge bg-orange-dim text-orange text-xs">Unassigned</span>
            <span className="text-[11px] text-text-dim">{unassigned.length} sound{unassigned.length !== 1 ? 's' : ''} not in any tier</span>
            <button onClick={handleOpenPreview} className="ml-auto btn-primary text-xs py-1 px-3">
              Auto-Assign All
            </button>
          </div>
          <div className="space-y-1">
            {unassigned.map(s => (
              <div key={s.name} className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-text-primary flex-1 truncate">{s.name}</span>
                <select
                  value={assignTarget[s.name] || ''}
                  onChange={e => setAssignTarget(prev => ({ ...prev, [s.name]: e.target.value }))}
                  className="input-base text-xs py-1 px-2 w-36"
                >
                  <option value="">Pick tier...</option>
                  {Object.keys(config.sprites || {}).map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                  <option value="standalone">Standalone</option>
                </select>
                <button
                  onClick={() => handleAssign(s.name, assignTarget[s.name])}
                  disabled={!assignTarget[s.name]}
                  className="btn-primary text-xs py-1 px-2.5 disabled:opacity-40 disabled:cursor-not-allowed"
                >Add</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pools */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-6 pr-1">

        {/* Each immediate pool as its own section */}
        {Object.entries(config.sprites || {}).filter(([, tc]) => !tc.subLoaderId).map(([tierName, tierCfg]) => {
          const size = poolSizeInfo(tierName, tierCfg.sounds || []);
          const overLimit = tierCfg.maxSizeKB && size.kb > tierCfg.maxSizeKB;
          return (
          <div key={tierName} className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="h-px flex-1 bg-green/30" />
              <span className="text-[10px] font-bold tracking-widest uppercase text-green">{tierName}</span>
              <span className="text-[10px] text-green/60">IMMEDIATE</span>
              <div className="h-px flex-1 bg-green/30" />
            </div>
            <div className="card p-4 space-y-3 border-l-2 border-l-green/50">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="badge bg-green-dim text-green text-xs">immediate</span>
                <span className="text-[11px] text-text-dim">{(tierCfg.sounds || []).length} sounds</span>
                <span className={`text-[11px] font-mono ${overLimit ? 'text-danger font-semibold' : 'text-text-dim'}`}>{size.isActual ? '' : '~'}{formatSize(size.kb)}</span>
                {tierCfg.description && <span className="text-[11px] text-text-dim italic">— {tierCfg.description}</span>}
                <div className="flex items-center gap-1.5 ml-auto">
                  <span className="text-[11px] text-text-dim">Max:</span>
                  <input type="number" value={tierCfg.maxSizeKB || 700} onChange={(e) => update(() => { tierCfg.maxSizeKB = parseInt(e.target.value) || 0; })} className="input-base w-18 text-center text-xs py-1 px-2" />
                  <span className="text-[11px] text-text-dim">KB</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {(tierCfg.sounds || []).map(s => (
                  <span key={s} className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-mono border ${!wavSet.has(s) ? 'text-danger border-danger/30 bg-danger/10' : 'text-text-secondary border-border bg-bg-primary hover:border-border-bright'}`}>
                    {s}
                    <select value="" onChange={(e) => { if (e.target.value) handleMove(s, tierName, e.target.value); }} className="bg-transparent text-text-dim cursor-pointer w-4 appearance-none opacity-40 hover:opacity-100" title="Move to...">
                      <option value="">→</option>
                      {tierOptions.filter(t => t !== tierName).map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </span>
                ))}
                {(tierCfg.sounds || []).length === 0 && <span className="text-[11px] text-text-dim italic">No sounds assigned</span>}
              </div>
            </div>
          </div>
          );
        })}

        {/* ── STANDALONE ── */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-green/30" />
            <span className="text-[10px] font-bold tracking-widest uppercase text-green">Standalone Music</span>
            <span className="text-[10px] text-green/60">IMMEDIATE</span>
            <div className="h-px flex-1 bg-green/30" />
          </div>
          {(() => { const sz = poolSizeInfo('standalone', config.standalone?.sounds || [], 5); return (
          <div className="card p-4 space-y-3 border-l-2 border-l-green/50">
            <div className="flex items-center gap-2">
              <span className="badge bg-green-dim text-green text-xs">immediate</span>
              <span className="text-[11px] text-text-dim">{(config.standalone?.sounds || []).length} sounds</span>
              <span className="text-[11px] font-mono text-text-dim">{sz.isActual ? '' : '~'}{formatSize(sz.kb)}</span>
              <span className="text-[11px] text-text-dim italic">— individual M4A per sound (loopable music)</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {(config.standalone?.sounds || []).map(s => (
                <span key={s} className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-mono border ${!wavSet.has(s) ? 'text-danger border-danger/30 bg-danger/10' : 'text-text-secondary border-border bg-bg-primary hover:border-border-bright'}`}>
                  {s}
                  <select value="" onChange={(e) => { if (e.target.value) handleMove(s, 'standalone', e.target.value); }} className="bg-transparent text-text-dim cursor-pointer w-4 appearance-none opacity-40 hover:opacity-100" title="Move to...">
                    <option value="">→</option>
                    {tierOptions.filter(t => t !== 'standalone').map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </span>
              ))}
              {(config.standalone?.sounds || []).length === 0 && <span className="text-[11px] text-text-dim italic">No sounds assigned</span>}
            </div>
          </div>
          ); })()}
        </div>

        {/* Each deferred pool as its own section */}
        {Object.entries(config.sprites || {}).filter(([, tc]) => tc.subLoaderId && tc.subLoaderId !== 'Z').map(([tierName, tierCfg]) => {
          const size = poolSizeInfo(tierName, tierCfg.sounds || []);
          const overLimit = tierCfg.maxSizeKB && size.kb > tierCfg.maxSizeKB;
          return (
          <div key={tierName} className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="h-px flex-1 bg-cyan/30" />
              <span className="text-[10px] font-bold tracking-widest uppercase text-cyan">{tierName}</span>
              <span className="text-[10px] text-cyan/60">DEFERRED "{tierCfg.subLoaderId}"</span>
              <div className="h-px flex-1 bg-cyan/30" />
            </div>
            <div className="card p-4 space-y-3 border-l-2 border-l-cyan/50">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="badge bg-cyan-dim text-cyan text-xs">SubLoader "{tierCfg.subLoaderId}"</span>
                {tierCfg.unloadable && <span className="badge bg-orange-dim text-orange text-xs">unloadable</span>}
                <span className="text-[11px] text-text-dim">{(tierCfg.sounds || []).length} sounds</span>
                <span className={`text-[11px] font-mono ${overLimit ? 'text-danger font-semibold' : 'text-text-dim'}`}>{size.isActual ? '' : '~'}{formatSize(size.kb)}</span>
                {tierCfg.description && <span className="text-[11px] text-text-dim italic">— {tierCfg.description}</span>}
                <div className="flex items-center gap-1.5 ml-auto">
                  <span className="text-[11px] text-text-dim">Max:</span>
                  <input type="number" value={tierCfg.maxSizeKB || 3000} onChange={(e) => update(() => { tierCfg.maxSizeKB = parseInt(e.target.value) || 0; })} className="input-base w-18 text-center text-xs py-1 px-2" />
                  <span className="text-[11px] text-text-dim">KB</span>
                </div>
              </div>

              {/* Sound chips */}
              <div className="flex flex-wrap gap-1">
                {(tierCfg.sounds || []).map(s => (
                  <span key={s} className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-mono border ${!wavSet.has(s) ? 'text-danger border-danger/30 bg-danger/10' : 'text-text-secondary border-border bg-bg-primary hover:border-border-bright'}`}>
                    {s}
                    <select value="" onChange={(e) => { if (e.target.value) handleMove(s, tierName, e.target.value); }} className="bg-transparent text-text-dim cursor-pointer w-4 appearance-none opacity-40 hover:opacity-100" title="Move to...">
                      <option value="">→</option>
                      {tierOptions.filter(t => t !== tierName).map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </span>
                ))}
                {(tierCfg.sounds || []).length === 0 && <span className="text-[11px] text-text-dim italic">No sounds assigned</span>}
              </div>

              {/* Settings + snippet footer */}
              <div className="flex items-center gap-3 flex-wrap pt-2 border-t border-border/30">
                <select value={tierCfg.subLoaderId || ''} onChange={(e) => update(() => { if (e.target.value === '') { delete tierCfg.subLoaderId; delete tierCfg.unloadable; } else { tierCfg.subLoaderId = e.target.value; if (tierCfg.unloadable === undefined) tierCfg.unloadable = false; } })} className="input-base text-xs py-1 px-2 w-44">
                  {SUBLOADER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input type="checkbox" checked={tierCfg.unloadable === true} onChange={(e) => update(() => { tierCfg.unloadable = e.target.checked; })} className="w-3.5 h-3.5 accent-orange rounded cursor-pointer" />
                  <span className="text-[11px] text-text-dim">Unloadable after use</span>
                </label>
                <div className="flex items-center gap-2 ml-auto bg-bg-primary rounded-lg px-3 py-1.5">
                  <code className="text-[11px] font-mono text-cyan truncate">
                    startSubLoader("{tierCfg.subLoaderId}");{tierCfg.unloadable ? `  →  unloadSubLoader("${tierCfg.subLoaderId}");` : ''}
                  </code>
                  <button onClick={() => handleCopy(tierName, buildSnippet(tierName, tierCfg))} className="btn-ghost text-[10px] py-0.5 px-2 shrink-0">{copied === tierName ? '✓' : 'Copy'}</button>
                </div>
              </div>
            </div>
          </div>
          );
        })}

        {/* Each lazy pool as its own section */}
        {Object.entries(config.sprites || {}).filter(([, tc]) => tc.subLoaderId === 'Z').map(([tierName, tierCfg]) => {
          const size = poolSizeInfo(tierName, tierCfg.sounds || []);
          const overLimit = tierCfg.maxSizeKB && size.kb > tierCfg.maxSizeKB;
          return (
          <div key={tierName} className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="h-px flex-1 bg-orange/30" />
              <span className="text-[10px] font-bold tracking-widest uppercase text-orange">{tierName}</span>
              <span className="text-[10px] text-orange/60">LAZY</span>
              <div className="h-px flex-1 bg-orange/30" />
            </div>
            <div className="card p-4 space-y-3 border-l-2 border-l-orange/50">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="badge bg-orange-dim text-orange text-xs">Lazy "Z"</span>
                <span className="text-[11px] text-text-dim">{(tierCfg.sounds || []).length} sounds</span>
                <span className={`text-[11px] font-mono ${overLimit ? 'text-danger font-semibold' : 'text-text-dim'}`}>{size.isActual ? '' : '~'}{formatSize(size.kb)}</span>
                {tierCfg.description && <span className="text-[11px] text-text-dim italic">— {tierCfg.description}</span>}
                <div className="flex items-center gap-1.5 ml-auto">
                  <span className="text-[11px] text-text-dim">Max:</span>
                  <input type="number" value={tierCfg.maxSizeKB || 1500} onChange={(e) => update(() => { tierCfg.maxSizeKB = parseInt(e.target.value) || 0; })} className="input-base w-18 text-center text-xs py-1 px-2" />
                  <span className="text-[11px] text-text-dim">KB</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {(tierCfg.sounds || []).map(s => (
                  <span key={s} className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-mono border ${!wavSet.has(s) ? 'text-danger border-danger/30 bg-danger/10' : 'text-text-secondary border-border bg-bg-primary hover:border-border-bright'}`}>
                    {s}
                    <select value="" onChange={(e) => { if (e.target.value) handleMove(s, tierName, e.target.value); }} className="bg-transparent text-text-dim cursor-pointer w-4 appearance-none opacity-40 hover:opacity-100" title="Move to...">
                      <option value="">→</option>
                      {tierOptions.filter(t => t !== tierName).map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </span>
                ))}
                {(tierCfg.sounds || []).length === 0 && <span className="text-[11px] text-text-dim italic">No sounds assigned</span>}
              </div>
            </div>
          </div>
          );
        })}

        {/* Encoding */}
        <div className="card p-3 space-y-2">
          <p className="section-label">Encoding</p>
          {Object.entries(config.encoding || {}).map(([key, enc]) => (
            <div key={key} className="flex items-center gap-3 flex-wrap">
              <span className="badge bg-cyan-dim text-cyan w-16 justify-center shrink-0">{key}</span>
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={enc.keepOriginal === true}
                  onChange={(e) => update(() => { enc.keepOriginal = e.target.checked; })}
                  className="w-3.5 h-3.5 accent-accent rounded cursor-pointer"
                />
                <span className="text-[11px] text-text-dim">Keep Original</span>
              </label>
              {enc.keepOriginal ? (
                <span className="text-[11px] text-text-dim italic">320kbps, source channels & rate</span>
              ) : (
                <>
                  <span className="text-[11px] text-text-dim">Bitrate:</span>
                  <input
                    type="number"
                    value={enc.bitrate || 64}
                    onChange={(e) => update(() => { enc.bitrate = parseInt(e.target.value) || 64; })}
                    className="input-base w-16 text-center text-xs py-1 px-2"
                  />
                  <span className="text-[11px] text-text-dim">kbps</span>
                  <span className="text-[11px] text-text-dim ml-3">Channels:</span>
                  <select
                    value={enc.channels || 2}
                    onChange={(e) => update(() => { enc.channels = parseInt(e.target.value); })}
                    className="input-base w-24 text-xs py-1 px-2"
                  >
                    <option value={1}>Mono</option>
                    <option value={2}>Stereo</option>
                  </select>
                </>
              )}
            </div>
          ))}
        </div>

        {/* Copy All Deferred Snippets */}
        {deferredTiers.length > 0 && (
          <div className="flex justify-end">
            <button
              onClick={handleCopyAll}
              className="btn-ghost text-[11px] py-1.5 px-3"
            >
              {copied === '__all__' ? '✓ All snippets copied' : 'Copy all SubLoader snippets'}
            </button>
          </div>
        )}
      </div>

      {/* Auto-Assign Preview Modal */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-bg-secondary border border-border rounded-2xl shadow-2xl w-[480px] max-h-[80vh] flex flex-col">
            <div className="p-5 border-b border-border">
              <h3 className="text-sm font-bold text-text-primary">Auto-Assign Preview</h3>
              <p className="text-[11px] text-text-dim mt-0.5">Review assignments before applying. You can change any tier.</p>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {preview.map((item, i) => (
                <div key={item.name} className="flex items-center gap-2">
                  <span className="font-mono text-xs text-text-primary flex-1 truncate">{item.name}</span>
                  <select
                    value={item.tier || ''}
                    onChange={e => setPreview(prev => prev.map((p, j) => j === i ? { ...p, tier: e.target.value } : p))}
                    className="input-base text-xs py-1 px-2 w-36"
                  >
                    {tierOptions.map(t => (
                      <option key={t} value={t}>{t === 'standalone' ? 'Standalone Music' : t}</option>
                    ))}
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
