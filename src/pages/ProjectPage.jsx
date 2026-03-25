import React from 'react';

export default function ProjectPage({ project, onOpen, onReload, showToast }) {
  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center anim-fade-up">
        <div className="w-20 h-20 rounded-3xl bg-bg-card border border-border-bright flex items-center justify-center mb-5 shadow-lg">
          <svg className="w-10 h-10 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold mb-2 text-text-primary">Slot Audio Manager</h2>
        <p className="text-text-secondary text-sm mb-6 max-w-xs leading-relaxed">
          Open a slot audio project to manage sounds, configure sprites, build and deploy.
        </p>
        <button onClick={onOpen} className="btn-primary px-8">Open Project Folder</button>
      </div>
    );
  }

  const stats = [
    { label: 'WAV Files',    value: project.sounds?.length || 0,                                                                              color: 'text-cyan',   bg: 'bg-cyan-dim',   border: 'border-cyan/20' },
    { label: 'Sprite Tiers', value: project.spriteConfig ? Object.keys(project.spriteConfig.sprites || {}).length : 0,                        color: 'text-purple', bg: 'bg-purple-dim', border: 'border-purple/20' },
    { label: 'Standalone',   value: project.spriteConfig?.standalone?.sounds?.length || 0,                                                    color: 'text-green',  bg: 'bg-green-dim',  border: 'border-green/20' },
    { label: 'Commands',     value: project.soundsJson ? Object.keys(project.soundsJson.soundDefinitions?.commands || {}).length : 0,          color: 'text-orange', bg: 'bg-orange-dim', border: 'border-orange/20' },
  ];

  const settingsEntries = project.settings ? Object.entries(project.settings) : [];

  return (
    <div className="anim-fade-up h-full flex flex-col gap-2">

      {/* Header */}
      <div className="shrink-0 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-text-primary">Project Overview</h2>
          <p className="text-[11px] text-text-dim font-mono mt-0.5">{project.path}</p>
        </div>
        <button onClick={onReload} className="btn-ghost text-xs">Reload</button>
      </div>

      {/* Stats row — 4 inline cards */}
      <div className="grid grid-cols-4 gap-2 shrink-0">
        {stats.map((s) => (
          <div key={s.label} className={`card p-3 border ${s.border} flex items-center gap-3`}>
            <span className={`text-2xl font-bold leading-none tabular-nums ${s.color}`}>{s.value}</span>
            <p className={`text-[11px] font-semibold leading-tight ${s.color} opacity-80`}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* 2-column body: Settings | Tiers + Standalone */}
      <div className="flex-1 min-h-0 grid grid-cols-2 gap-2">

        {/* Left — Settings */}
        <div className="card p-3 flex flex-col min-h-0">
          <p className="section-label mb-2 shrink-0">Settings</p>
          {settingsEntries.length > 0 ? (
            <div className="flex-1 min-h-0 overflow-y-auto">
              {settingsEntries.map(([key, val]) => (
                <div key={key} className="flex items-start gap-2 py-1 border-b border-border/30 last:border-0">
                  <span className="text-[11px] text-text-dim w-40 shrink-0 font-mono">{key}</span>
                  <span className="text-[11px] text-text-primary font-mono break-all">{String(val)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-dim italic">No settings.json found</p>
          )}
        </div>

        {/* Right — Sprite Tiers + Standalone */}
        <div className="flex flex-col gap-2 min-h-0">
          {project.spriteConfig?.sprites ? (
            <div className="card p-3 flex-1 min-h-0 flex flex-col">
              <p className="section-label mb-2 shrink-0">Sprite Tiers</p>
              <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
                {Object.entries(project.spriteConfig.sprites).map(([tier, cfg]) => (
                  <div key={tier} className="flex items-center gap-2.5">
                    <span className="badge bg-purple-dim text-purple text-[10px] w-24 justify-center shrink-0">{tier}</span>
                    <div className="flex-1 h-1 bg-bg-hover rounded-full overflow-hidden">
                      <div
                        className="h-full bg-purple rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, ((cfg.sounds?.length || 0) / Math.max(1, project.sounds?.length || 1)) * 100)}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-text-dim font-mono tabular-nums shrink-0 w-28 text-right">
                      {cfg.sounds?.length || 0} snd · {cfg.maxSizeKB}KB
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="card p-3 flex-1 flex items-center justify-center">
              <p className="text-xs text-text-dim italic">No sprite-config.json found</p>
            </div>
          )}

          {project.spriteConfig?.standalone?.sounds?.length > 0 && (
            <div className="card p-3 shrink-0">
              <p className="section-label mb-1.5">Standalone Music</p>
              <div className="flex flex-wrap gap-1.5">
                {project.spriteConfig.standalone.sounds.map(s => (
                  <span key={s} className="badge bg-green-dim text-green border border-green/20 text-[10px]">{s}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
