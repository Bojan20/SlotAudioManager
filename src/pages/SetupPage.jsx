import React, { useState, useEffect } from 'react';

export default function SetupPage({ project, setProject, showToast }) {
  const [health, setHealth] = useState(null);
  const [checking, setChecking] = useState(false);
  const [initLog, setInitLog] = useState([]);
  const [initializing, setInitializing] = useState(false);
  const [confirmSync, setConfirmSync] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installLog, setInstallLog] = useState('');
  const [gameRepoPath, setGameRepoPath] = useState('');
  const [configuring, setConfiguring] = useState(false);
  const [configLog, setConfigLog] = useState([]);
  const [gameInstalling, setGameInstalling] = useState(false);
  const [gameInstallLog, setGameInstallLog] = useState('');
  const [pulling, setPulling] = useState(false);

  const runHealthCheck = async () => {
    setChecking(true);
    try {
      const r = await window.api.healthCheck();
      if (r && !r.error) setHealth(r);
      else if (r?.error) showToast(r.error, 'error');
    } catch (e) {
      showToast('Health check failed', 'error');
    }
    setChecking(false);
  };

  useEffect(() => {
    setHealth(null);
    setInitLog([]);
    setInstallLog('');
    setConfigLog([]);
    setGameInstallLog('');
    setConfirmSync(false);
    if (project) {
      runHealthCheck();
      setGameRepoPath(project.gameRepoAbsPath || project.settings?.gameProjectPath || '');
    } else {
      setGameRepoPath('');
    }
  }, [project?.path]);

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
        showToast('Template synced — installing dependencies...', 'success');
        // Auto-chain npm install so the project is immediately usable after sync
        setInstalling(true); setInstallLog('Installing dependencies...\n');
        try {
          const nr = await window.api.npmInstall();
          setInstallLog(nr.output || nr.error || '');
          if (nr.success) {
            if (nr.project) setProject(nr.project);
            showToast('Sync complete — ready to build!', 'success');
          } else {
            showToast('npm install failed after sync', 'error');
          }
        } catch (e2) {
          setInstallLog('Error: ' + e2.message);
          showToast('npm install failed', 'error');
        }
        setInstalling(false);
        runHealthCheck();
      } else {
        showToast(r.error || 'Init failed', 'error');
      }
    } catch (e) {
      showToast('Init failed: ' + e.message, 'error');
    }
    setInitializing(false);
  };

  const npmInstall = async () => {
    setInstalling(true); setInstallLog('Installing dependencies...\n');
    try {
      const r = await window.api.npmInstall();
      setInstallLog(r.output || r.error || '');
      if (r.success) {
        if (r.project) setProject(r.project);
        showToast('Dependencies installed', 'success');
        runHealthCheck();
      } else {
        showToast('npm install failed', 'error');
      }
    } catch (e) {
      setInstallLog('Error: ' + e.message);
      showToast('npm install failed', 'error');
    }
    setInstalling(false);
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
      setGameInstallLog(r.output || r.error || '');
      if (r.success) {
        if (r.success && r.project) setProject(r.project);
        showToast('Game dependencies installed', 'success');
      } else {
        showToast(r.error || 'yarn install failed', 'error');
      }
    } catch (e) {
      setGameInstallLog('Error: ' + e.message);
      showToast('yarn install failed', 'error');
    }
    setGameInstalling(false);
  };

  const passed = health?.passed || 0;
  const total  = health?.total  || 0;
  const failed = health?.failed || 0;
  const pct    = total > 0 ? Math.round((passed / total) * 100) : 0;

  return (
    <div className="anim-fade-up h-full flex flex-col gap-2">

      {/* Header */}
      <div className="shrink-0 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-text-primary">Project Setup</h2>
          <p className="text-xs text-text-dim mt-0.5">Scripts, configs, and dependencies</p>
        </div>
        <button onClick={runHealthCheck} disabled={checking} className="btn-ghost text-xs">
          {checking ? 'Checking...' : 'Re-check'}
        </button>
      </div>

      {/* 2-column body */}
      <div className="flex-1 min-h-0 grid grid-cols-2 gap-2">

        {/* LEFT — Game Repo + NPM + Logs */}
        <div className="flex flex-col gap-2 min-h-0">

          {/* Game Repo */}
          <div className="card p-3 shrink-0">
            <div className="flex items-center justify-between mb-2">
              <p className="section-label">Game Repository</p>
              <button
                onClick={async () => {
                  const p = await window.api.pickGameRepo();
                  if (!p) return;
                  setGameRepoPath(p);
                  setConfiguring(true); setConfigLog([]);
                  try {
                    const r = await window.api.configureGame({ gameRepoPath: p });
                    if (r.log) setConfigLog(r.log);
                    if (r.success) {
                      if (r.project) setProject(r.project);
                      showToast('Game repo linked!', 'success');
                    } else {
                      showToast(r.error || 'Config failed', 'error');
                    }
                  } catch (e) {
                    showToast('Config failed: ' + e.message, 'error');
                  }
                  setConfiguring(false);
                }}
                disabled={configuring}
                className={configuring ? 'btn-ghost text-accent border-accent/30 cursor-wait text-xs' : 'btn-primary text-xs'}
              >
                {configuring ? 'Linking...' : gameRepoPath ? 'Change' : 'Link Repo'}
              </button>
            </div>

            {gameRepoPath ? (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-bg-input border border-green/20">
                <svg className="w-3.5 h-3.5 text-green shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-mono text-text-primary truncate">{gameRepoPath}</p>
                  <p className="text-[10px] text-text-dim">→ assets/default/default/default/sounds/</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-bg-input border border-border">
                <svg className="w-3.5 h-3.5 text-text-dim shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                <p className="text-[11px] text-text-dim">No repo linked — deploy won't work</p>
              </div>
            )}

            {configLog.length > 0 && (
              <div className="mt-2 space-y-1 pt-2 border-t border-border">
                {configLog.map((line, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <svg className={`w-3 h-3 shrink-0 ${line.startsWith('Warning') ? 'text-orange' : 'text-green'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={line.startsWith('Warning') ? 'M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' : 'M5 13l4 4L19 7'} />
                    </svg>
                    <span className={`text-[11px] font-mono ${line.startsWith('Warning') ? 'text-orange' : 'text-text-secondary'}`}>{line}</span>
                  </div>
                ))}
              </div>
            )}

            {gameRepoPath && project?.gameRepoExists && (
              <div className="mt-2 pt-2 border-t border-border space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] text-text-secondary">
                      Game <span className="font-mono text-accent">yarn install</span>
                      {project?.gameNodeModulesExists === false && (
                        <span className="ml-2 text-orange font-semibold">· node_modules missing!</span>
                      )}
                    </p>
                  </div>
                  <button
                    onClick={yarnInstallGame}
                    disabled={gameInstalling || pulling}
                    className={gameInstalling ? 'btn-ghost text-cyan border-cyan/30 cursor-wait text-xs' : project?.gameNodeModulesExists === false ? 'btn-primary text-xs' : 'btn-ghost text-xs'}
                  >
                    {gameInstalling && <span className="inline-block w-2 h-2 rounded-full bg-cyan mr-1.5 anim-pulse-dot" />}
                    {gameInstalling ? 'Installing...' : 'yarn install'}
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-[11px] text-text-secondary">
                    Pull <span className="font-mono text-accent">sounds.json</span> from game repo
                  </p>
                  <button
                    onClick={pullGameJson}
                    disabled={pulling || gameInstalling}
                    className={pulling ? 'btn-ghost text-green border-green/30 cursor-wait text-xs' : 'btn-ghost text-xs'}
                  >
                    {pulling && <span className="inline-block w-2 h-2 rounded-full bg-green mr-1.5 anim-pulse-dot" />}
                    {pulling ? 'Pulling...' : 'Pull JSON'}
                  </button>
                </div>
                {gameInstallLog && (
                  <pre className="mt-2 p-2 rounded-lg bg-bg-input border border-border text-[11px] font-mono text-text-secondary overflow-auto max-h-24 whitespace-pre-wrap leading-relaxed">
                    {gameInstallLog}
                  </pre>
                )}
              </div>
            )}
          </div>

          {/* NPM Install */}
          <div className="card p-3 shrink-0">
            <div className="flex items-center justify-between mb-1">
              <div>
                <p className="section-label">Dependencies</p>
                <p className="text-[11px] text-text-secondary mt-0.5">Run <span className="font-mono text-accent">npm install</span> in project</p>
              </div>
              <button
                onClick={npmInstall}
                disabled={installing}
                className={installing ? 'btn-ghost text-cyan border-cyan/30 cursor-wait text-xs' : 'btn-ghost text-xs'}
              >
                {installing && <span className="inline-block w-2 h-2 rounded-full bg-cyan mr-1.5 anim-pulse-dot" />}
                {installing ? 'Installing...' : 'npm install'}
              </button>
            </div>
            {installLog && (
              <pre className="mt-2 p-3 rounded-lg bg-bg-input border border-border text-[11px] font-mono text-text-secondary overflow-auto max-h-32 whitespace-pre-wrap leading-relaxed">
                {installLog}
              </pre>
            )}
          </div>

          {/* Init Log */}
          {initLog.length > 0 && (
            <div className="card p-3 flex-1 min-h-0 flex flex-col">
              <p className="section-label mb-2 shrink-0">Initialization Log</p>
              <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
                {initLog.map((line, i) => {
                  const isOverwrite = line.startsWith('Overwritten');
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <svg className={`w-3 h-3 shrink-0 ${isOverwrite ? 'text-cyan' : 'text-green'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      <span className={`text-[11px] font-mono ${isOverwrite ? 'text-cyan' : 'text-text-secondary'}`}>{line}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT — Health Check */}
        <div className="card p-3 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-2 shrink-0">
            <div className="flex items-center gap-2">
              <p className="section-label">Health Check</p>
              {health && !health.error && (
                <span className={`badge ${failed === 0 ? 'bg-green-dim text-green' : 'bg-orange-dim text-orange'}`}>
                  {passed}/{total} — {pct}%
                </span>
              )}
            </div>
            {health && !health.error && !confirmSync && (
              <button
                onClick={() => setConfirmSync(true)}
                disabled={initializing}
                className={initializing ? 'btn-ghost text-accent border-accent/30 cursor-wait text-xs' : 'btn-primary text-xs'}
              >
                {initializing ? 'Initializing...' : failed > 0 ? `Fix ${failed} + Sync` : 'Sync Template'}
              </button>
            )}
          </div>

          {confirmSync && (
            <div className="mb-2 p-3 rounded-lg border border-orange/40 bg-orange-dim shrink-0">
              <p className="text-xs text-orange font-semibold mb-1">Sync Template</p>
              <p className="text-[11px] text-text-secondary mb-2">Da li da prepišem i <span className="text-text font-semibold">sprite-config.json</span> i <span className="text-text font-semibold">sounds.json</span>? Ako si već podesio zvukove i komande — izaberi "Preskoči config".</p>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => { setConfirmSync(false); initFromTemplate(); }}
                  disabled={initializing}
                  className="btn-primary text-xs py-1.5 px-3"
                >
                  Sync sve
                </button>
                <button
                  onClick={() => { setConfirmSync(false); initFromTemplate({ skipConfigs: true }); }}
                  disabled={initializing}
                  className="btn-ghost text-xs py-1.5 px-3 border-cyan/40 text-cyan"
                >
                  Preskoči config/sounds
                </button>
                <button
                  onClick={() => setConfirmSync(false)}
                  className="btn-ghost text-xs py-1.5 px-3"
                >
                  Otkaži
                </button>
              </div>
            </div>
          )}

          {health && !health.error && (
            <>
              <div className="h-1.5 bg-bg-hover rounded-full overflow-hidden mb-3 shrink-0">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${failed === 0 ? 'bg-green' : pct > 60 ? 'bg-orange' : 'bg-danger'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto">
                <div className="grid grid-cols-2 gap-x-3">
                  {(health.checks || []).map((c, i) => (
                    <div key={i} className="flex items-center gap-2 py-1.5 border-b border-border/40 last:border-0">
                      {c.exists ? (
                        <svg className="w-3.5 h-3.5 text-green shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-3.5 h-3.5 text-danger shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      )}
                      <span className={`text-[11px] font-mono flex-1 truncate ${c.exists ? 'text-text-primary' : 'text-danger'}`}>{c.name}</span>
                      <span className="text-[10px] text-text-dim bg-bg-hover px-1.5 py-0.5 rounded font-mono shrink-0">{c.type}</span>
                    </div>
                  ))}
                </div>
              </div>

              {failed === 0 && (
                <div className="mt-2 p-2.5 rounded-lg border border-green/25 bg-green-dim shrink-0">
                  <div className="flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 text-green shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-xs text-green font-semibold">All checks passed — project ready.</p>
                  </div>
                </div>
              )}
            </>
          )}

          {!health && !checking && (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-xs text-text-dim">Click Re-check to run health check</p>
            </div>
          )}

          {checking && (
            <div className="flex-1 flex items-center justify-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-accent anim-pulse-dot" />
              <p className="text-xs text-text-dim">Running health check...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
