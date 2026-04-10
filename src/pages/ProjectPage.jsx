import React, { useState } from 'react';

const StatCard = ({ label, value, color, icon, title }) => (
  <div className="glass" style={{ padding: '16px', transition: 'all 0.25s' }} title={title}>
    <div className="flex items-center" style={{ gap: '14px' }}>
      <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: `${color}11`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <svg style={{ width: '18px', height: '18px', color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
        </svg>
      </div>
      <div>
        <p style={{ fontSize: '24px', fontWeight: 700, lineHeight: 1, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', color }}>{value}</p>
        <p style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.28)', marginTop: '4px' }}>{label}</p>
      </div>
    </div>
  </div>
);

const StatusDot = ({ ok, warn }) => (
  <span style={{ width: '7px', height: '7px', borderRadius: '999px', flexShrink: 0, background: ok ? '#4ade80' : warn ? '#fb923c' : '#f87171' }} />
);

export default function ProjectPage({ project, setProject, onOpen, onReload, showToast }) {
  const [linking, setLinking] = useState(false);

  const pickAndLink = async () => {
    const p = await window.api.pickGameRepo();
    if (!p) return;
    setLinking(true);
    try {
      // 1. Link game repo
      const r = await window.api.configureGame({ gameRepoPath: p });
      if (!r.success) { showToast(r.error || 'Config failed', 'error'); setLinking(false); return; }
      if (r.project) setProject(r.project);
      showToast('Game repo linked — syncing template...', 'success');

      // 2. Auto sync template (skip configs to preserve existing sounds.json/sprite-config)
      try {
        const sr = await window.api.initFromTemplate({ skipConfigs: true });
        if (sr.success) {
          if (sr.project) setProject(sr.project);
          // 3. Auto npm install
          try {
            const nr = await window.api.npmInstall();
            if (nr.success) {
              if (nr.project) setProject(nr.project);
              showToast('Linked, synced & installed — ready!', 'success');
            } else {
              showToast('npm install failed after sync', 'error');
            }
          } catch (e2) { showToast('npm install failed: ' + e2.message, 'error'); }
        } else {
          showToast(sr.error || 'Template sync failed', 'error');
        }
      } catch (e2) { showToast('Template sync failed: ' + e2.message, 'error'); }
    } catch (e) {
      showToast('Config failed: ' + e.message, 'error');
    }
    setLinking(false);
  };

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center anim-fade-up">
        {/* Hero icon */}
        <div className="relative" style={{ marginBottom: '48px' }}>
          <div className="absolute" style={{ inset: '-20px', borderRadius: '36px', background: 'rgba(139,124,248,0.06)', filter: 'blur(30px)' }} />
          <div className="relative flex items-center justify-center" style={{ width: '120px', height: '120px', borderRadius: '32px', background: 'linear-gradient(135deg, rgba(139,124,248,0.14) 0%, rgba(139,124,248,0.02) 100%)', border: '1px solid rgba(139,124,248,0.08)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 24px 64px rgba(139,124,248,0.06)' }}>
            <svg className="text-accent" style={{ width: '48px', height: '48px' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
          </div>
        </div>

        {/* Title */}
        <div style={{ marginBottom: '40px' }}>
          <div className="flex items-center justify-center" style={{ gap: '12px', marginBottom: '14px' }}>
            <div style={{ width: '32px', height: '1px', background: 'rgba(139,124,248,0.15)' }} />
            <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.45em', color: 'rgba(139,124,248,0.4)', textTransform: 'uppercase' }}>IGT</span>
            <div style={{ width: '32px', height: '1px', background: 'rgba(139,124,248,0.15)' }} />
          </div>
          <h2 className="text-text-primary" style={{ fontSize: '34px', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.1 }}>Slot Audio Manager</h2>
          <p style={{ fontSize: '15px', color: 'rgba(255,255,255,0.35)', marginTop: '16px', maxWidth: '420px', lineHeight: 1.6, marginLeft: 'auto', marginRight: 'auto' }}>
            Manage sounds, configure sprites, build and deploy audio for slot games.
          </p>
        </div>

        <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.2)', marginTop: '8px' }}>Open a project from the sidebar to get started.</p>
      </div>
    );
  }

  const sounds = project.sounds || [];
  const spriteConfig = project.spriteConfig;
  const tiers = spriteConfig?.sprites || {};
  const streaming = spriteConfig?.streaming?.sounds || [];
  const commands = project.soundsJson?.soundDefinitions?.commands || {};
  const soundSprites = project.soundsJson?.soundDefinitions?.soundSprites || {};
  const distInfo = project.distInfo;

  const assigned = new Set();
  for (const cfg of Object.values(tiers)) for (const s of (cfg.sounds || [])) assigned.add(s);
  for (const s of streaming) assigned.add(s);
  const unassigned = sounds.filter(s => !assigned.has(s.name.replace(/\.wav$/i, ''))).length;

  const hasGame = !!project.settings?.gameProjectPath;
  const gameOk = project.gameRepoExists;
  const gameMods = project.gameNodeModulesExists;

  return (
    <div className="anim-fade-up h-full flex flex-col">

      {/* Header */}
      <div className="shrink-0 flex items-center justify-between" style={{ marginBottom: '20px' }}>
        <div className="min-w-0 flex-1 mr-4">
          <h2 className="text-text-primary" style={{ fontSize: '22px', fontWeight: 700, letterSpacing: '-0.02em' }}>Dashboard</h2>
          <p style={{ fontSize: '12px', fontFamily: "'SF Mono', 'Fira Code', monospace", color: 'rgba(255,255,255,0.22)', marginTop: '6px' }} className="truncate" title={project.path}>{project.path}</p>
        </div>
        <button onClick={onReload} className="btn-ghost" style={{ padding: '10px 22px', borderRadius: '12px' }} title="Reload project data from disk — re-reads all config files and sound lists">Reload</button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 shrink-0" style={{ gap: '12px', marginBottom: '20px' }}>
        <StatCard label="WAV Files" value={sounds.length} color="#38bdf8"
          icon="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
          title="Total WAV files in sourceSoundFiles/ directory" />
        <StatCard label="Commands" value={Object.keys(commands).length} color="#fb923c"
          icon="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
          title="Total sound commands defined in sounds.json" />
        <StatCard label="Sprites" value={Object.keys(soundSprites).length} color="#4ade80"
          icon="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
          title="Total sound sprites defined in soundSprites" />
        <StatCard label="Unassigned" value={unassigned} color={unassigned > 0 ? '#f87171' : '#4ade80'}
          icon="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          title="WAV files not yet assigned to any tier in sprite-config.json" />
      </div>

      {/* Info panels — single row, no separate cards */}
      <div className="glass-panel shrink-0" style={{ display: 'grid', gridTemplateColumns: '1fr 1px 1fr' }}>
        {/* Game Repo */}
        <div style={{ padding: '14px 20px' }}>
          <div className="flex items-center" style={{ gap: '8px', marginBottom: '10px' }}>
            <svg style={{ width: '12px', height: '12px', flexShrink: 0, color: hasGame && gameOk ? '#4ade80' : 'rgba(255,255,255,0.25)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
            <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.28)' }} title="Linked game repository — used for deploy, launch, and GLR testing">Game Repo</span>
          </div>
          {hasGame ? (
            <>
              <button onClick={pickAndLink} disabled={linking} className="flex items-center w-full truncate" style={{ gap: '8px', padding: '8px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)', cursor: linking ? 'wait' : 'pointer', transition: 'all 0.15s', textAlign: 'left', marginBottom: '8px' }} onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }} onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.04)'; }}>
                <StatusDot ok={gameOk} />
                <span className="truncate" style={{ fontSize: '11px', fontFamily: "'SF Mono', monospace", color: '#eeeeff', flex: 1, minWidth: 0 }}>{linking ? 'Linking...' : project.settings.gameProjectPath}</span>
                <svg style={{ width: '10px', height: '10px', color: 'rgba(255,255,255,0.12)', flexShrink: 0 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
              </button>
              <div className="flex items-center" style={{ gap: '6px', fontSize: '11px', color: 'rgba(255,255,255,0.35)' }}>
                <StatusDot ok={gameMods} warn={!gameMods} />
                {gameMods ? 'Ready' : 'node_modules missing'}
              </div>
            </>
          ) : (
            <button onClick={pickAndLink} disabled={linking} className="flex items-center w-full" style={{ gap: '8px', padding: '10px 12px', borderRadius: '8px', border: '1px dashed rgba(255,255,255,0.06)', cursor: linking ? 'wait' : 'pointer', transition: 'all 0.15s', background: 'transparent' }} onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(139,124,248,0.2)'; }} onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; }}>
              <svg style={{ width: '12px', height: '12px', color: 'rgba(255,255,255,0.2)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
              <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.25)' }} title="Pick a game repo folder to link — enables deploy, launch, and GLR features">{linking ? 'Linking...' : 'Link game repository'}</span>
            </button>
          )}
        </div>

        {/* Divider */}
        <div style={{ background: 'rgba(255,255,255,0.04)', margin: '12px 0' }} />

        {/* Last Build */}
        <div style={{ padding: '14px 20px' }}>
          <div className="flex items-center" style={{ gap: '8px', marginBottom: '10px' }}>
            <svg style={{ width: '12px', height: '12px', flexShrink: 0, color: distInfo?.hasDist ? '#4ade80' : 'rgba(255,255,255,0.25)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.28)' }} title="Status of the last audio build — sprite count, total size, and output files in dist/">Last Build</span>
            {distInfo?.hasDist && (
              <span style={{ marginLeft: 'auto', fontSize: '10px', fontWeight: 700, fontFamily: "'SF Mono', monospace", padding: '2px 8px', borderRadius: '6px', background: 'rgba(74,222,128,0.07)', color: '#4ade80' }} title="Total size of all built M4A sprites in dist/">{distInfo.totalSizeMB} MB</span>
            )}
          </div>
          {distInfo?.hasDist ? (
            <>
              <div className="flex items-center" style={{ gap: '6px', fontSize: '11px', color: 'rgba(255,255,255,0.35)', marginBottom: '4px' }}>
                <StatusDot ok />
                {distInfo.spriteCount} sprites · {distInfo.hasSoundsJson ? 'JSON OK' : 'JSON missing'}
              </div>
              {distInfo.sprites?.length > 0 && (
                <div className="flex flex-wrap" style={{ gap: '4px', marginTop: '8px' }}>
                  {distInfo.sprites.map(s => (
                    <span key={s} style={{ fontSize: '10px', fontFamily: "'SF Mono', monospace", color: 'rgba(255,255,255,0.2)', padding: '4px 8px', borderRadius: '6px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}>{s}</span>
                  ))}
                </div>
              )}
            </>
          ) : (
            <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.2)' }}>No build yet</span>
          )}
        </div>
      </div>
    </div>
  );
}
