import React, { useState, useEffect } from 'react';

const Check = ({ ok }) => ok ? (
  <svg className="w-3.5 h-3.5 text-green shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
) : (
  <svg className="w-3.5 h-3.5 text-danger shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
);

const Dot = ({ color = 'bg-accent' }) => <span className={`inline-block w-1.5 h-1.5 rounded-full ${color} anim-pulse-dot`} />;

const ActionBtn = ({ onClick, disabled, loading, loadingText, idleText, variant = 'ghost', color, className = '', title }) => {
  const base = variant === 'primary'
    ? 'btn-primary text-xs !py-2.5 !px-5 !rounded-xl'
    : 'btn-ghost text-xs !py-2.5 !px-5 !rounded-xl';
  const colorClass = loading && color ? `!border-${color}/30 !text-${color}` : '';
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${colorClass} ${loading ? '!cursor-wait' : ''} ${className}`} title={title}>
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
    setInitLog([]);
    setGameInstallLog('');
    setConfirmSync(false);
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

  return (
    <div className="anim-fade-up h-full flex flex-col">

      {/* Header */}
      <div className="shrink-0 flex items-center justify-between pb-5">
        <div>
          <h2 className="text-xl font-bold text-text-primary">Project Setup</h2>
          <p className="text-xs text-text-dim mt-1">Link, sync, install — then build</p>
        </div>
      </div>

      {/* Body — responsive 2-col grid */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-4">

        {/* ═══ LEFT — Audio Project ═══ */}
        <div className="flex flex-col gap-4 min-h-0 overflow-y-auto pr-0.5">

          {/* ── 1. Sync Template ── */}
          <div className="rounded-2xl border border-border/40 overflow-hidden bg-bg-card/60 flex-1 min-h-0 flex flex-col">
            <div className="px-5 py-4 flex items-center gap-3 bg-bg-hover/20 border-b border-border/20 shrink-0 flex-wrap">
              <svg className="w-4 h-4 shrink-0 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span className="text-xs font-bold uppercase tracking-wider text-text-dim" title="Overwrites scripts, configs, and package.json dependencies from the bundled template">Sync Template</span>
              <div className="flex-1" />
              {!confirmSync && (
                <ActionBtn
                  onClick={() => setConfirmSync(true)}
                  disabled={initializing || npmInstalling}
                  loading={initializing}
                  loadingText="Syncing..."
                  idleText="Sync Template"
                  color="accent"
                  title="Overwrite scripts and configs from bundled template"
                />
              )}
            </div>

            {/* Sync confirmation inline */}
            {confirmSync && (
              <div className="px-5 py-4 border-b border-orange/20 bg-orange/5 shrink-0">
                <p className="text-xs text-orange font-semibold mb-2">Sync Template</p>
                <p className="text-[11px] text-text-secondary mb-3 leading-relaxed">
                  Overwrite <span className="text-text-primary font-semibold">sprite-config.json</span> and <span className="text-text-primary font-semibold">sounds.json</span> from template? If you've already configured sounds — choose "Skip Configs".
                </p>
                <div className="flex gap-2.5">
                  <button onClick={() => { setConfirmSync(false); initFromTemplate(); }} disabled={initializing} className="btn-primary text-xs !py-2.5 !px-5 !rounded-xl flex-1" title="Overwrite all scripts, configs, and sounds.json from template">Sync All</button>
                  <button onClick={() => { setConfirmSync(false); initFromTemplate({ skipConfigs: true }); }} disabled={initializing} className="btn-ghost text-xs !py-2.5 !px-5 !rounded-xl !border-cyan/30 !text-cyan flex-1" title="Overwrite scripts and dependencies only — keep existing sprite-config.json and sounds.json">Skip Configs</button>
                  <button onClick={() => setConfirmSync(false)} className="btn-ghost text-xs !py-2.5 !px-5 !rounded-xl">Cancel</button>
                </div>
              </div>
            )}

            {/* Sync description */}
            {!confirmSync && initLog.length === 0 && (
              <div className="px-5 py-4 flex-1 flex items-start">
                <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-bg-primary/30 border border-border/20">
                  <svg className="w-3.5 h-3.5 text-text-dim/50 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  <p className="text-[11px] text-text-dim leading-relaxed">Overwrites scripts, configs, and dependencies from the bundled template. Run <span className="font-mono text-text-secondary">npm install</span> separately after sync if dependencies changed.</p>
                </div>
              </div>
            )}

            {/* Sync log inline */}
            {initLog.length > 0 && (
              <div className="px-5 py-4 shrink-0">
                <LogLines lines={initLog} maxH="max-h-32" />
              </div>
            )}

            {/* npm install — separate from sync */}
            <div className="px-5 py-3 border-t border-border/20 flex items-center gap-3">
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
                disabled={initializing || npmInstalling}
                loading={npmInstalling}
                loadingText="Installing..."
                idleText="npm install"
                color="cyan"
                title="Install audio project dependencies"
              />
              <span className="text-[10px] text-text-dim">Run after Sync if dependencies changed</span>
            </div>
          </div>

        </div>

        {/* ═══ RIGHT — Game Repo Actions ═══ */}
        <div className="flex flex-col gap-4 min-h-0 overflow-y-auto pl-0.5">

          {/* ── 0. Game Branch Selector ── */}
          <div className="rounded-2xl border border-border/40 overflow-hidden bg-bg-card/60 flex-none">
            <div className="px-5 py-4 flex items-center gap-3 bg-bg-hover/20 border-b border-border/20">
              <svg className="w-4 h-4 text-purple shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span className="text-xs font-bold uppercase tracking-wider text-text-dim">Game Branch</span>
              {project?.gameRepoBranch && (
                <span className="badge bg-purple-dim text-purple text-[10px]">{project.gameRepoBranch}</span>
              )}
              {project?.gameNodeVersion && (
                <span className="badge bg-green/10 text-green text-[10px]" title="Detected Node version for this game repo">Node {project.gameNodeVersion}</span>
              )}
              <div className="flex-1" />
            </div>
            <div className="px-5 py-4">
              {hasGame && project?.gameRepoBranches?.length > 0 ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2.5">
                    <select
                      value={selectedBranch}
                      onChange={e => setSelectedBranch(e.target.value)}
                      disabled={gameOperationBusy}
                      className="input-base text-xs flex-1 !py-2 !rounded-xl"
                    >
                      {project.gameRepoBranch && !project.gameRepoBranches.includes(project.gameRepoBranch) && (
                        <option value={project.gameRepoBranch}>{project.gameRepoBranch} (local)</option>
                      )}
                      {project.gameRepoBranches.map(b => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </select>
                    <ActionBtn
                      onClick={checkoutBranch}
                      disabled={gameOperationBusy || !selectedBranch}
                      loading={switching}
                      loadingText={selectedBranch === project?.gameRepoBranch ? 'Pulling...' : 'Switching...'}
                      idleText={selectedBranch === project?.gameRepoBranch ? 'Pull' : 'Switch & Pull'}
                      color={selectedBranch === project?.gameRepoBranch ? 'cyan' : 'purple'}
                      title={selectedBranch === project?.gameRepoBranch ? 'Fetch + pull current branch' : 'Checkout selected branch and pull latest changes'}
                    />
                  </div>
                  <LogBlock text={branchLog} maxH="max-h-20" />
                </div>
              ) : !hasGame ? (
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-bg-primary/40 border border-border/30">
                  <svg className="w-3.5 h-3.5 text-text-dim/40 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  <p className="text-xs text-text-dim/60">Link a game repository in Project tab first</p>
                </div>
              ) : (
                <p className="text-[11px] text-text-dim">No remote branches found</p>
              )}
            </div>
          </div>

          {/* ── 1. Pull sounds.json ── */}
          <div className="rounded-2xl border border-border/40 overflow-hidden bg-bg-card/60 flex-none">
            <div className="px-5 py-4 flex items-center gap-3 bg-bg-hover/20 border-b border-border/20">
              <svg className="w-4 h-4 text-green shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
              </svg>
              <span className="text-xs font-bold uppercase tracking-wider text-text-dim" title="Copies sounds.json from game repo deploy folder to audio repo root">Pull sounds.json</span>
              <div className="flex-1" />
              {hasGame ? (
                <ActionBtn
                  onClick={pullGameJson}
                  disabled={gameOperationBusy || !hasGame}
                  loading={pulling}
                  loadingText="Pulling..."
                  idleText="Pull from Game"
                  color="green"
                  title="Copy sounds.json from game/assets/sounds/ to audio repo root"
                />
              ) : (
                <span className="text-[10px] text-text-dim/40 italic">Link repo first</span>
              )}
            </div>

            <div className="px-5 py-4">
              <div className={`flex items-start gap-3 px-4 py-3 rounded-xl border ${hasGame ? 'bg-bg-primary/30 border-border/20' : 'bg-bg-primary/40 border-border/30'}`}>
                <svg className="w-3.5 h-3.5 text-text-dim/50 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <div className="space-y-1">
                  <p className="text-[11px] text-text-dim leading-relaxed">Copies <span className="font-mono text-text-secondary">sounds.json</span> from game repo deploy folder to audio repo root.</p>
                  <p className="text-[11px] text-text-dim leading-relaxed">Useful after first init to pull existing commands and sprite definitions.</p>
                </div>
              </div>
            </div>
          </div>

          {/* ── 2. Yarn Install (Game) ── */}
          <div className="rounded-2xl border border-border/40 overflow-hidden bg-bg-card/60 flex-none">
            <div className="px-5 py-4 flex items-center gap-3 bg-bg-hover/20 border-b border-border/20">
              <svg className="w-4 h-4 text-sky-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span className="text-xs font-bold uppercase tracking-wider text-text-dim" title="Installs npm packages in the game repo (yarn install) — requires VPN for internal registry">Game Dependencies</span>
              <span className="text-[10px] font-mono text-text-dim/50">yarn install</span>
              <div className="flex-1" />
              {hasGame ? (
                <ActionBtn
                  onClick={yarnInstallGame}
                  disabled={gameOperationBusy || !hasGame}
                  loading={gameInstalling}
                  loadingText="Installing..."
                  idleText="Install"
                  variant={project?.gameNodeModulesExists === false ? 'primary' : 'ghost'}
                  color="cyan"
                  title="Run yarn install in game repo — requires VPN access to internal npm registry"
                />
              ) : (
                <span className="text-[10px] text-text-dim/40 italic">Link repo first</span>
              )}
            </div>

            <div className="px-5 py-4">
              {!hasGame ? (
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-bg-primary/40 border border-border/30">
                  <svg className="w-3.5 h-3.5 text-text-dim/40 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  <p className="text-xs text-text-dim/60">Link a game repository in Project tab to enable game actions</p>
                </div>
              ) : project?.gameNodeModulesExists === false ? (
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-orange/5 border border-orange/15">
                  <svg className="w-3.5 h-3.5 text-orange shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  <p className="text-xs text-orange font-medium">node_modules missing — install required before build/launch</p>
                </div>
              ) : (
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-green/5 border border-green/15">
                  <Check ok />
                  <p className="text-xs text-green font-medium">Game dependencies installed</p>
                </div>
              )}
              <LogBlock text={gameInstallLog} maxH="max-h-32" />
            </div>
          </div>

          {/* ── Flow hint ── */}
          <div className="flex-1 flex items-end justify-center pb-4">
            <div className="text-center space-y-2 opacity-30">
              <div className="flex items-center justify-center gap-3">
                <div className="w-8 h-px bg-border" />
                <span className="text-[10px] font-bold tracking-[0.25em] uppercase text-text-dim">Setup Flow</span>
                <div className="w-8 h-px bg-border" />
              </div>
              <p className="text-[10px] text-text-dim font-mono">Link → Sync → Install → Build</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
