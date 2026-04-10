import React, { useState, useEffect } from 'react';

const Check = ({ ok }) => ok ? (
  <svg className="w-3.5 h-3.5 text-green shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
) : (
  <svg className="w-3.5 h-3.5 text-danger shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
);

const Dot = ({ color = 'bg-accent' }) => <span className={`inline-block w-1.5 h-1.5 rounded-full ${color} anim-pulse-dot`} />;

const ActionBtn = ({ onClick, disabled, loading, loadingText, idleText, variant = 'ghost', color, className = '', title }) => {
  const base = variant === 'primary'
    ? 'btn-primary text-xs !py-2 !px-4 !rounded-lg'
    : 'btn-ghost text-xs !py-2 !px-4 !rounded-lg';
  const colorClass = loading && color ? `!border-${color}/30 !text-${color}` : '';
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${colorClass} ${loading ? '!cursor-wait' : ''} ${className}`} title={title}
      style={{ transition: 'all 0.15s ease' }}
      onMouseEnter={e => { if (!disabled) { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(124,106,239,0.15)'; } }}
      onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}>
      {loading && <Dot color={`bg-${color || 'accent'}`} />}
      <span className={loading ? 'ml-1.5' : ''}>{loading ? loadingText : idleText}</span>
    </button>
  );
};

const Divider = ({ label, color = 'border' }) => (
  <div className="flex items-center gap-3 py-1">
    <div className={`h-px flex-1 bg-gradient-to-r from-${color}/40 to-transparent`} />
    <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-text-dim/50">{label}</span>
    <div className={`h-px flex-1 bg-gradient-to-l from-${color}/40 to-transparent`} />
  </div>
);

const LogBlock = ({ text, maxH = 'max-h-28' }) => text ? (
  <pre className={`p-2.5 rounded-xl bg-bg-primary/60 border border-border/30 text-[11px] font-mono text-text-secondary overflow-auto ${maxH} whitespace-pre-wrap leading-relaxed`}>{text}</pre>
) : null;

const LogLines = ({ lines, maxH = 'max-h-36' }) => lines.length > 0 ? (
  <div className={`overflow-y-auto ${maxH} space-y-0.5 p-2 rounded-xl bg-bg-primary/60 border border-border/30`}>
    {lines.map((line, i) => {
      const warn = line.startsWith('Warning');
      const overwrite = line.startsWith('Overwritten');
      return (
        <div key={i} className="flex items-start gap-2 py-0.5">
          <Check ok={!warn} />
          <span className={`text-[11px] font-mono leading-snug ${warn ? 'text-orange' : overwrite ? 'text-cyan' : 'text-text-secondary'}`}>{line}</span>
        </div>
      );
    })}
  </div>
) : null;

export default function SetupPage({ project, setProject, showToast }) {
  const [initLog, setInitLog] = useState([]);
  const [initializing, setInitializing] = useState(false);
  const [npmInstalling, setNpmInstalling] = useState(false);
  const [confirmSync, setConfirmSync] = useState(false);
  const [gameInstalling, setGameInstalling] = useState(false);
  const [gameInstallLog, setGameInstallLog] = useState('');
  const [pulling, setPulling] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [switching, setSwitching] = useState(false);
  const [branchLog, setBranchLog] = useState('');

  useEffect(() => {
    setInitLog([]); setInitializing(false); setNpmInstalling(false);
    setGameInstallLog(''); setGameInstalling(false);
    setConfirmSync(false); setPulling(false); setSwitching(false);
    setBranchLog('');
    setSelectedBranch(project?.gameRepoBranch || '');
  }, [project?.path, project?._reloadKey]);

  useEffect(() => {
    if (project?.gameRepoBranch) setSelectedBranch(project.gameRepoBranch);
  }, [project?.gameRepoBranch]);

  if (!project) {
    return (
      <div className="anim-fade-up flex flex-col items-center justify-center h-64 text-text-dim text-sm">
        Open a project first to run setup.
      </div>
    );
  }

  const initFromTemplate = async (opts) => {
    setInitializing(true); setInitLog([]);
    try {
      const r = await window.api.initFromTemplate(opts);
      if (r.log) setInitLog(r.log);
      if (r.success) {
        if (r.project) setProject(r.project);
        showToast('Template synced!', 'success');
      } else {
        showToast(r.error || 'Sync failed', 'error');
      }
    } catch (e) {
      showToast('Sync failed: ' + e.message, 'error');
    }
    setInitializing(false);
  };

  const pullGameJson = async () => {
    setPulling(true);
    try {
      const r = await window.api.pullGameJson();
      if (r?.success) {
        if (r.project) setProject(r.project);
        showToast('sounds.json pulled from game repo', 'success');
      } else {
        showToast(r?.error || 'Pull failed', 'error');
      }
    } catch (e) {
      showToast('Pull failed: ' + e.message, 'error');
    }
    setPulling(false);
  };

  const yarnInstallGame = async () => {
    setGameInstalling(true); setGameInstallLog('Running yarn install in game repo...\n');
    try {
      const r = await window.api.yarnInstallGame();
      const noise = /NODE_TLS_REJECT_UNAUTHORIZED|incorrect peer dependency|unmet peer dependency|Invalid bin field|Workspaces can only be enabled|trouble with your network|\(node:\d+\) Warning:|Use `node --trace-warnings/;
      setGameInstallLog((r.output || r.error || '').split('\n').filter(l => !noise.test(l)).join('\n'));
      if (r.success) {
        if (r.project) setProject(r.project);
        if (r.detectedNode) showToast(`Game uses Node ${r.detectedNode} (auto-detected via nvm)`, 'success');
        else showToast('Game dependencies installed', 'success');
      } else {
        showToast(r.error || 'yarn install failed', 'error');
      }
    } catch (e) {
      setGameInstallLog('Error: ' + e.message);
      showToast('yarn install failed', 'error');
    }
    setGameInstalling(false);
  };

  const checkoutBranch = async () => {
    if (!selectedBranch) return;
    const sameBranch = selectedBranch === project?.gameRepoBranch;
    setSwitching(true); setBranchLog('');
    try {
      if (sameBranch) {
        // Pull only — no checkout needed
        const r = await window.api.gitPullGame();
        if (r?.error || r?.success === false) {
          setBranchLog(r.error || r.output || 'Pull failed');
          showToast('Pull failed', 'error');
        } else {
          setBranchLog(r.output || 'Already up to date.');
          showToast('Pull complete', 'success');
          try { const rp = await window.api.reloadProject(); if (rp) { rp._reloadKey = Date.now(); setProject(rp); } } catch {}
        }
      } else {
        const r = await window.api.checkoutGameBranch(selectedBranch);
        if (r?.success) {
          if (r.project) setProject(r.project);
          const newBranch = r.branch || selectedBranch;
          setSelectedBranch(newBranch);
          showToast(`Switched to ${newBranch}`, 'success');
        } else {
          setBranchLog(r?.error || 'Branch switch failed');
          showToast(r?.error || 'Branch switch failed', 'error');
        }
      }
    } catch (e) {
      setBranchLog('Error: ' + e.message);
      showToast(sameBranch ? 'Pull failed' : 'Branch switch failed', 'error');
    }
    setSwitching(false);
  };

  const gameOperationBusy = switching || gameInstalling || pulling;
  const hasGame = project?.settings?.gameProjectPath && project?.gameRepoExists;

  const anyBusy = initializing || npmInstalling || gameOperationBusy;
  const health = project?.healthCheck;
  const hasNodeModules = health?.nodeModules !== false;
  const gameHasNodeModules = project?.gameNodeModulesExists !== false;

  return (
    <div className="anim-fade-up h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 flex flex-col items-center justify-center pt-2 pb-6">
        <h2 className="text-xl font-bold text-text-primary tracking-tight">Setup Project</h2>
        <p className="text-xs text-text-dim mt-1">Follow each step from top to bottom</p>
      </div>

      {/* Single column flow — centered */}
      <div className="flex-1 min-h-0 overflow-y-auto" style={{ display: 'flex', justifyContent: 'center' }}>
        <div style={{ width: '100%', maxWidth: '900px', padding: '40px 24px 32px' }} className="space-y-5">

          {/* ═══ SECTION: CONNECT ═══ */}
          <div>
            <div className="flex items-center gap-4 mb-4">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-purple/25 to-transparent" />
              <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-purple/60">Connect</span>
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-purple/25 to-transparent" />
            </div>

            <div className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* 1. Game Branch */}
              <div className="py-5">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-purple/10 text-purple text-sm font-bold shrink-0">1</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-text-primary">Game Branch</p>
                    <p className="text-[11px] text-text-dim mt-0.5">Select branch and pull latest changes</p>
                  </div>
                  {hasGame && project?.gameRepoBranches?.length > 0 ? (
                    <div className="flex items-center gap-2.5 shrink-0">
                      <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)} disabled={anyBusy}
                        className="input-base text-xs !py-2 !px-2.5 !rounded-lg font-mono max-w-[180px]">
                        {project.gameRepoBranch && !project.gameRepoBranches.includes(project.gameRepoBranch) && <option value={project.gameRepoBranch}>{project.gameRepoBranch} (local)</option>}
                        {project.gameRepoBranches.map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                      <ActionBtn onClick={checkoutBranch} disabled={anyBusy || !selectedBranch} loading={switching}
                        loadingText={selectedBranch === project?.gameRepoBranch ? 'Pulling...' : 'Switching...'}
                        idleText={selectedBranch === project?.gameRepoBranch ? 'Pull' : 'Switch & Pull'}
                        color={selectedBranch === project?.gameRepoBranch ? 'cyan' : 'purple'} />
                    </div>
                  ) : <span className="text-[10px] text-text-dim italic shrink-0">{hasGame ? 'No branches' : 'Link repo first'}</span>}
                </div>
                {branchLog && <div className="mt-3"><LogBlock text={branchLog} maxH="max-h-16" /></div>}
              </div>
            </div>
          </div>

          {/* ═══ SECTION: SYNC ═══ */}
          <div>
            <div className="flex items-center gap-4 mb-4">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-accent/25 to-transparent" />
              <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-accent/60">Sync</span>
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-accent/25 to-transparent" />
            </div>

            <div className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* 2. Sync Template */}
              <div className="py-5 border-b border-border/20">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-accent/10 text-accent text-sm font-bold shrink-0">2</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-text-primary">Sync Template</p>
                    <p className="text-[11px] text-text-dim mt-0.5">Overwrite scripts, configs, dependencies from app template</p>
                  </div>
                  {!confirmSync ? (
                    <ActionBtn onClick={() => setConfirmSync(true)} disabled={anyBusy} loading={initializing}
                      loadingText="Syncing..." idleText="Sync" color="accent" />
                  ) : (
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => { setConfirmSync(false); initFromTemplate(); }} disabled={initializing}
                        className="btn-primary text-xs !py-2.5 !px-5 !rounded-xl">Sync All</button>
                      <button onClick={() => { setConfirmSync(false); initFromTemplate({ skipConfigs: true }); }} disabled={initializing}
                        className="btn-ghost text-xs !py-2.5 !px-5 !rounded-xl !border-cyan/30 !text-cyan">Skip Configs</button>
                      <button onClick={() => setConfirmSync(false)}
                        className="btn-ghost text-xs !py-2.5 !px-4 !rounded-xl">Cancel</button>
                    </div>
                  )}
                </div>
                {initLog.length > 0 && <div className="mt-4"><LogLines lines={initLog} maxH="max-h-28" /></div>}
              </div>

              {/* 3. Pull sounds.json */}
              <div className="py-5">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-green/10 text-green text-sm font-bold shrink-0">3</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-text-primary">Pull sounds.json</p>
                    <p className="text-[11px] text-text-dim mt-0.5">Copy commands and sprite definitions from game repo</p>
                  </div>
                  {hasGame ? (
                    <ActionBtn onClick={pullGameJson} disabled={anyBusy} loading={pulling}
                      loadingText="Pulling..." idleText="Pull" color="green" />
                  ) : <span className="text-[10px] text-text-dim italic shrink-0">Link repo first</span>}
                </div>
              </div>
            </div>
          </div>

          {/* ═══ SECTION: INSTALL ═══ */}
          <div>
            <div className="flex items-center gap-4 mb-4">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-cyan/25 to-transparent" />
              <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-cyan/60">Install</span>
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-cyan/25 to-transparent" />
            </div>

            <div className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* 4. npm install */}
              <div className="py-5 border-b border-border/20">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-cyan/10 text-cyan text-sm font-bold shrink-0">4</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-text-primary">npm install</p>
                    <p className="text-[11px] text-text-dim mt-0.5">Audio dependencies — ffmpeg, sox, audiosprite</p>
                  </div>
                  {hasNodeModules && <span className="text-[10px] font-semibold text-green bg-green/8 px-2.5 py-1 rounded-lg shrink-0">node_modules ✓</span>}
                  <ActionBtn
                    onClick={async () => {
                      setNpmInstalling(true);
                      setInitLog(prev => [...prev, '', 'Running npm install...']);
                      try {
                        const r = await window.api.npmInstall();
                        if (r?.success) {
                          if (r.project) setProject(r.project);
                          setInitLog(prev => [...prev, '✔ Dependencies installed']);
                          showToast('npm install complete', 'success');
                        } else {
                          setInitLog(prev => [...prev, '✖ npm install failed: ' + (r?.error || 'unknown')]);
                          showToast('npm install failed', 'error');
                        }
                      } catch (e) {
                        setInitLog(prev => [...prev, '✖ ' + e.message]);
                        showToast('npm install failed', 'error');
                      }
                      setNpmInstalling(false);
                    }}
                    disabled={anyBusy} loading={npmInstalling}
                    loadingText="Installing..." idleText="Install" color="cyan" />
                </div>
              </div>

              {/* 5. yarn install Game */}
              <div className="py-5">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-orange/10 text-orange text-sm font-bold shrink-0">5</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-text-primary">yarn install</p>
                    <p className="text-[11px] text-text-dim mt-0.5">Game dependencies — playa, webpack (needs VPN)</p>
                  </div>
                  {hasGame && gameHasNodeModules && <span className="text-[10px] font-semibold text-green bg-green/8 px-2.5 py-1 rounded-lg shrink-0">node_modules ✓</span>}
                  {hasGame && !gameHasNodeModules && <span className="text-[10px] font-semibold text-orange bg-orange/8 px-2.5 py-1 rounded-lg shrink-0">missing</span>}
                  {hasGame ? (
                    <ActionBtn onClick={yarnInstallGame} disabled={anyBusy} loading={gameInstalling}
                      loadingText="Installing..." idleText="Install"
                      variant={!gameHasNodeModules ? 'primary' : 'ghost'} color="orange" />
                  ) : <span className="text-[10px] text-text-dim italic shrink-0">Link repo first</span>}
                </div>
                {gameInstallLog && <div className="mt-3"><LogBlock text={gameInstallLog} maxH="max-h-28" /></div>}
              </div>
            </div>
          </div>

          {/* ═══ SETUP COMPLETE ═══ */}
          {hasGame && hasNodeModules && (
            <div className="flex justify-center" style={{ paddingTop: '40px', paddingBottom: '24px' }}>
              <div className="inline-flex items-center gap-4 rounded-2xl bg-green/6 border border-green/15" style={{ padding: '24px 40px' }}>
                <svg className="w-7 h-7 text-green shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                <div>
                  <p className="text-[15px] font-semibold text-green">Setup complete</p>
                  <p className="text-xs text-text-secondary mt-1">Go to <span className="text-text-primary font-medium">Sounds</span> to import WAVs or <span className="text-text-primary font-medium">Build</span> to build & deploy</p>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
