import React, { useState, useEffect } from 'react';

export default function SetupPage({ project, setProject, showToast }) {
  const [health, setHealth] = useState(null);
  const [checking, setChecking] = useState(false);
  const [initLog, setInitLog] = useState([]);
  const [initializing, setInitializing] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installLog, setInstallLog] = useState('');
  const [gameRepoPath, setGameRepoPath] = useState('');
  const [configuring, setConfiguring] = useState(false);
  const [configLog, setConfigLog] = useState([]);

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
    // Reset all state on project switch
    setHealth(null);
    setInitLog([]);
    setInstallLog('');
    setConfigLog([]);
    if (project) {
      runHealthCheck();
      // Pre-fill game repo path — use resolved absolute path
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

  const initFromTemplate = async () => {
    setInitializing(true); setInitLog([]);
    try {
      const r = await window.api.initFromTemplate();
      if (r.log) setInitLog(r.log);
      if (r.success) {
        if (r.project) setProject(r.project);
        showToast('Build system initialized!', 'success');
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

  const passed = health?.passed || 0;
  const total = health?.total || 0;
  const failed = health?.failed || 0;
  const pct = total > 0 ? Math.round((passed / total) * 100) : 0;

  return (
    <div className="anim-fade-up space-y-5 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Project Setup</h2>
          <p className="text-[11px] text-text-dim mt-0.5">One-click setup — scripts, configs, and dependencies</p>
        </div>
        <button onClick={runHealthCheck} disabled={checking} className="btn-ghost text-xs">
          {checking ? 'Checking...' : 'Re-check'}
        </button>
      </div>

      {/* GAME REPO LINK */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="section-label">Game Repository</p>
            <p className="text-[11px] text-text-dim mt-1">Link game repo — auto-configures deploy paths, package.json name, and settings.</p>
          </div>
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
            className={configuring ? 'btn-ghost text-accent border-accent/30 cursor-wait text-xs' : 'btn-primary text-xs py-2'}
          >
            {configuring ? 'Linking...' : gameRepoPath ? 'Change Game Repo' : 'Link Game Repo'}
          </button>
        </div>

        {gameRepoPath && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-bg-input border border-border">
            <svg className="w-4 h-4 text-green shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-mono text-text-primary truncate">{gameRepoPath}</p>
              <p className="text-[10px] text-text-dim mt-0.5">Deploy target: assets/default/default/default/sounds/</p>
            </div>
          </div>
        )}

        {!gameRepoPath && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-bg-input border border-border/50">
            <svg className="w-4 h-4 text-text-dim shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            <p className="text-[12px] text-text-dim">No game repo linked — deploy won't work until linked</p>
          </div>
        )}

        {configLog.length > 0 && (
          <div className="space-y-1 pt-2 border-t border-border">
            {configLog.map((line, i) => (
              <div key={i} className="flex items-center gap-2">
                <svg className={`w-3 h-3 shrink-0 ${line.startsWith('Warning') ? 'text-orange' : 'text-green'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={line.startsWith('Warning') ? 'M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' : 'M5 13l4 4L19 7'} />
                </svg>
                <span className={`text-[12px] font-mono ${line.startsWith('Warning') ? 'text-orange' : 'text-text-secondary'}`}>{line}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* HEALTH CHECK */}
      {health && !health.error && (
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <p className="section-label">Health Check</p>
              <span className={`badge ${failed === 0 ? 'bg-green-dim text-green' : 'bg-orange-dim text-orange'}`}>
                {passed}/{total} ({pct}%)
              </span>
            </div>
            <button
              onClick={initFromTemplate}
              disabled={initializing}
              className={initializing ? 'btn-ghost text-accent border-accent/30 cursor-wait text-xs' : 'btn-primary text-xs py-2'}
            >
              {initializing ? 'Initializing...' : failed > 0 ? `Fix ${failed} Missing + Sync All` : 'Sync All from Template'}
            </button>
          </div>

          {/* Progress bar */}
          <div className="h-2 bg-bg-hover rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${failed === 0 ? 'bg-green' : 'bg-orange'}`}
              style={{ width: `${pct}%` }}
            />
          </div>

          {/* Check items */}
          <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
            {(health.checks || []).map((c, i) => (
              <div key={i} className="flex items-center gap-2.5 py-1">
                {c.exists ? (
                  <svg className="w-4 h-4 text-green shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-danger shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
                <span className={`text-[12px] font-mono ${c.exists ? 'text-text-secondary' : 'text-danger'}`}>{c.name}</span>
                <span className="text-[10px] text-text-dim">({c.type})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* INIT LOG */}
      {initLog.length > 0 && (
        <div className="card p-5 space-y-3">
          <p className="section-label">Initialization Log</p>
          <div className="space-y-1">
            {initLog.map((line, i) => {
              const isOverwrite = line.startsWith('Overwritten');
              return (
                <div key={i} className="flex items-center gap-2">
                  <svg className={`w-3 h-3 shrink-0 ${isOverwrite ? 'text-cyan' : 'text-green'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-[12px] text-text-secondary font-mono">{line}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* NPM INSTALL */}
      <div className="card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="section-label">Dependencies</p>
            <p className="text-[11px] text-text-dim mt-1">Run <span className="font-mono text-text-secondary">npm install</span> in project</p>
          </div>
          <button
            onClick={npmInstall}
            disabled={installing}
            className={installing ? 'btn-ghost text-cyan border-cyan/30 cursor-wait text-xs' : 'btn-ghost text-xs'}
          >
            {installing && <span className="inline-block w-2 h-2 rounded-full bg-cyan mr-2 anim-pulse-dot" />}
            {installing ? 'Installing...' : 'npm install'}
          </button>
        </div>

        {installLog && (
          <pre className="p-4 rounded-lg bg-bg-input border border-border text-[11px] font-mono text-text-secondary overflow-auto max-h-48 whitespace-pre-wrap leading-relaxed">
            {installLog}
          </pre>
        )}
      </div>

      {/* ALL GOOD */}
      {health && failed === 0 && (
        <div className="card p-4 border-green/20 bg-green-dim">
          <p className="text-[12px] text-green leading-relaxed">
            <strong>All checks passed.</strong> Your project has all required scripts, configs, and dependencies.
          </p>
        </div>
      )}
    </div>
  );
}
