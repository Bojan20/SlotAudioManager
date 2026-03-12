import React from 'react';

export default function ProjectPage({ project, onOpen, onReload, showToast }) {
  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center anim-fade-up">
        <div className="w-20 h-20 rounded-2xl bg-bg-card border border-border flex items-center justify-center mb-5">
          <svg className="w-10 h-10 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
        </div>
        <h2 className="text-xl font-bold mb-1.5">Slot Audio Manager</h2>
        <p className="text-text-secondary text-sm mb-6 max-w-sm leading-relaxed">
          Open a slot audio project to manage sounds, configure sprites, build and deploy.
        </p>
        <button onClick={onOpen} className="btn-primary">Open Project Folder</button>
      </div>
    );
  }

  const stats = [
    { label: 'WAV Files', value: project.sounds?.length || 0, color: 'text-cyan', bg: 'bg-cyan-dim' },
    { label: 'Sprite Tiers', value: project.spriteConfig ? Object.keys(project.spriteConfig.sprites || {}).length : 0, color: 'text-purple', bg: 'bg-purple-dim' },
    { label: 'Standalone', value: project.spriteConfig?.standalone?.sounds?.length || 0, color: 'text-green', bg: 'bg-green-dim' },
    { label: 'Commands', value: project.soundsJson ? Object.keys(project.soundsJson.soundDefinitions?.commands || {}).length : 0, color: 'text-orange', bg: 'bg-orange-dim' },
  ];

  const settingsEntries = project.settings ? Object.entries(project.settings) : [];

  return (
    <div className="anim-fade-up space-y-5 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Project Overview</h2>
          <p className="text-[11px] text-text-dim mt-0.5 font-mono">{project.path}</p>
        </div>
        <button onClick={onReload} className="btn-ghost text-xs">Reload</button>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="card card-glow p-4">
            <div className={`w-8 h-8 rounded-lg ${s.bg} flex items-center justify-center mb-2`}>
              <span className={`text-lg font-bold ${s.color}`}>{s.value}</span>
            </div>
            <p className="text-[11px] text-text-dim font-medium">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Settings */}
      {settingsEntries.length > 0 && (
        <div className="card p-5">
          <p className="section-label mb-3">Settings</p>
          <div className="space-y-2">
            {settingsEntries.map(([key, val]) => (
              <div key={key} className="flex items-start gap-4">
                <span className="text-[11px] text-text-dim w-40 shrink-0 font-mono pt-px">{key}</span>
                <span className="text-[11px] text-text-primary font-mono break-all">{String(val)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sprite tiers */}
      {project.spriteConfig?.sprites && (
        <div className="card p-5">
          <p className="section-label mb-3">Sprite Tiers</p>
          <div className="space-y-2">
            {Object.entries(project.spriteConfig.sprites).map(([tier, cfg]) => (
              <div key={tier} className="flex items-center gap-4 py-1">
                <span className="badge bg-purple-dim text-purple w-24 justify-center">{tier}</span>
                <div className="flex-1 h-1.5 bg-bg-hover rounded-full overflow-hidden">
                  <div
                    className="h-full bg-purple rounded-full"
                    style={{ width: `${Math.min(100, ((cfg.sounds?.length || 0) / Math.max(1, project.sounds?.length || 1)) * 100)}%` }}
                  />
                </div>
                <span className="text-[11px] text-text-dim w-20 text-right">{cfg.sounds?.length || 0} sounds</span>
                <span className="text-[11px] text-text-dim w-20 text-right">max {cfg.maxSizeKB}KB</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Standalone */}
      {project.spriteConfig?.standalone?.sounds?.length > 0 && (
        <div className="card p-5">
          <p className="section-label mb-3">Standalone Music</p>
          <div className="flex flex-wrap gap-2">
            {project.spriteConfig.standalone.sounds.map(s => (
              <span key={s} className="badge bg-green-dim text-green">{s}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
