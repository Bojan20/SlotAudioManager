import React from 'react';

export default function ProjectPage({ project, onOpen, onReload }) {
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

  const sounds = project.sounds || [];
  const spriteConfig = project.spriteConfig;
  const tiers = spriteConfig?.sprites || {};
  const standalone = spriteConfig?.standalone?.sounds || [];
  const commands = project.soundsJson?.soundDefinitions?.commands || {};
  const soundSprites = project.soundsJson?.soundDefinitions?.soundSprites || {};
  const distInfo = project.distInfo;

  // Unassigned count
  const assigned = new Set();
  for (const cfg of Object.values(tiers)) for (const s of (cfg.sounds || [])) assigned.add(s);
  for (const s of standalone) assigned.add(s);
  const unassigned = sounds.filter(s => !assigned.has(s.name.replace(/\.wav$/i, ''))).length;

  // Game repo
  const hasGame = !!project.settings?.gameProjectPath;
  const gameOk = project.gameRepoExists;
  const gameMods = project.gameNodeModulesExists;

  return (
    <div className="anim-fade-up h-full flex flex-col gap-3">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-text-primary">Dashboard</h2>
          <p className="text-xs text-text-dim font-mono mt-1 truncate">{project.path}</p>
        </div>
        <button onClick={onReload} className="btn-ghost text-xs">Reload</button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
        {[
          { label: 'WAV Files',  value: sounds.length,                      color: 'text-cyan',   bg: 'border-cyan/20' },
          { label: 'Commands',   value: Object.keys(commands).length,        color: 'text-orange', bg: 'border-orange/20' },
          { label: 'Sprites',    value: Object.keys(soundSprites).length,    color: 'text-green',  bg: 'border-green/20' },
          { label: 'Unassigned', value: unassigned, color: unassigned > 0 ? 'text-danger' : 'text-success', bg: unassigned > 0 ? 'border-danger/20' : 'border-success/20' },
        ].map(s => (
          <div key={s.label} className={`card p-4 border ${s.bg} flex items-center gap-3`}>
            <span className={`text-2xl font-bold leading-none tabular-nums ${s.color}`}>{s.value}</span>
            <p className={`text-xs font-semibold leading-tight ${s.color} opacity-80`}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Game Repo + Build Status */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-3">

        <div className="flex flex-col gap-2 min-h-0 overflow-y-auto">
          {/* Game Repo */}
          <p className="section-label shrink-0">Game Repo</p>
          <div className="card p-3 space-y-2">
            {hasGame ? (
              <>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${gameOk ? 'bg-success' : 'bg-danger'}`} />
                  <span className="text-xs text-text-secondary font-mono truncate">{project.settings.gameProjectPath}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${gameMods ? 'bg-success' : 'bg-orange'}`} />
                  <span className="text-xs text-text-secondary">{gameMods ? 'node_modules OK' : 'node_modules missing'}</span>
                </div>
              </>
            ) : (
              <p className="text-xs text-text-dim italic">Not linked — go to Setup</p>
            )}
          </div>

          {/* Last Build */}
          <p className="section-label shrink-0">Last Build</p>
          <div className="card p-3 space-y-2">
            {distInfo?.hasDist ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0 bg-success" />
                  <span className="text-xs text-text-secondary">{distInfo.spriteCount} sprites · {distInfo.totalSizeMB} MB</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${distInfo.hasSoundsJson ? 'bg-success' : 'bg-danger'}`} />
                  <span className="text-xs text-text-secondary">{distInfo.hasSoundsJson ? 'sounds.json OK' : 'sounds.json missing'}</span>
                </div>
                {distInfo.sprites?.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {distInfo.sprites.map(s => (
                      <span key={s} className="text-xs font-mono text-text-dim bg-bg-hover px-1.5 py-0.5 rounded">{s}</span>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-text-dim italic">Not built yet</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
