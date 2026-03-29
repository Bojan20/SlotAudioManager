import React, { useState, useRef, useEffect, useMemo } from 'react';

export default function BuildPage({ project, setProject, reloadProject, showToast }) {
  const [running, setRunning] = useState(null);
  const [log, setLog] = useState('');
  const [result, setResult] = useState(null); // { script, ok }
  const [gameScripts, setGameScripts] = useState([]);
  const [gameRepoPath, setGameRepoPath] = useState('');
  const [loadingGameScripts, setLoadingGameScripts] = useState(false);
  const [gameScriptsError, setGameScriptsError] = useState('');
  const [autoLaunch, setAutoLaunch] = useState(''); // selected launch script for auto-launch after build
  const [gameStarted, setGameStarted] = useState(false); // stays true after timeout — keeps Kill visible
  const [gameGit, setGameGit] = useState(null); // { branch, files, hasDevelop, releaseBranches }
  const [gameGitLoading, setGameGitLoading] = useState(false);
  const [gameGitBranchName, setGameGitBranchName] = useState('');
  const [gameGitCommitMsg, setGameGitCommitMsg] = useState('');
  const [gameGitTarget, setGameGitTarget] = useState('');
  const [gameGitPushing, setGameGitPushing] = useState(false);
  const [gameGitPrUrl, setGameGitPrUrl] = useState('');
  const logRef = useRef(null);
  const abortRef = useRef(false);

  // Auto-scroll log to bottom as lines stream in
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);

  // Subscribe to live script output — mount once, unmount cleanup
  useEffect(() => {
    const handler = (_, line) => {
      // Filter noisy non-fatal DNS/TLS errors from playa process
      if (/ENOTFOUND.*wagerworks|ENOTFOUND.*igt\.com|NODE_TLS_REJECT_UNAUTHORIZED/.test(line)) return;
      setLog(prev => prev + line);
    };
    window.api.onScriptOutput(handler);
    return () => window.api.offScriptOutput(handler);
  }, []);

  useEffect(() => {
    setLog(''); setResult(null); setRunning(null); setGameStarted(false);
    setGameScripts([]); setGameRepoPath(''); setGameScriptsError(''); setAutoLaunch('');
    setGameGit(null); setGameGitBranchName(''); setGameGitCommitMsg(''); setGameGitPrUrl('');
    if (project) { loadGameScripts(); }
  }, [project?.path]);

  const loadGameGitStatus = async () => {
    setGameGitLoading(true);
    try {
      const r = await window.api.gameGitStatus();
      if (r?.error) { showToast(r.error, 'error'); setGameGit(null); }
      else {
        setGameGit(r);
        // Auto-select target: prefer develop, fallback to first release, then current branch
        const target = r.hasDevelop ? 'develop' : r.releaseBranches[0] || r.branch;
        setGameGitTarget(target);

        // Auto-generate branch name (only if empty or ends with default suffix)
        const audioName = project?.path?.split(/[/\\]/).pop()?.replace('-audio', '') || 'audio';
        const prefix = target.startsWith('release') ? 'bugfix/PA-' : 'feature/PA-';
        const autoName = `${prefix}${audioName}-audio-update`;
        if (!gameGitBranchName.trim() || gameGitBranchName.endsWith('-audio-update')) {
          setGameGitBranchName(autoName);
        }

        // Auto-generate commit message from changed files (only if empty)
        if (!gameGitCommitMsg.trim() && r.files.length > 0) {
          const soundFiles = r.files.filter(f => f.includes('sounds/'));
          const m4aCount = soundFiles.filter(f => f.includes('.m4a')).length;
          const jsonChanged = soundFiles.some(f => f.includes('sounds.json'));
          const parts = [];
          if (m4aCount > 0) parts.push(`update ${m4aCount} audio sprite${m4aCount > 1 ? 's' : ''}`);
          if (jsonChanged) parts.push('update sounds.json');
          if (!parts.length) parts.push(`update ${r.files.length} file${r.files.length > 1 ? 's' : ''}`);
          const msg = parts.join(', ');
          setGameGitCommitMsg(msg.charAt(0).toUpperCase() + msg.slice(1));
        }
      }
    } catch (e) { showToast(e.message, 'error'); }
    setGameGitLoading(false);
  };

  const handleGameGitPush = async () => {
    if (gameGitPushing || !gameGitBranchName.trim() || !gameGitCommitMsg.trim()) return;
    setGameGitPushing(true);
    try {
      const r = await window.api.gameGitCreateBranchCommitPush({
        targetBranch: gameGitTarget,
        branchName: gameGitBranchName.trim(),
        commitMsg: gameGitCommitMsg.trim(),
      });
      if (r?.error) { showToast(r.error, 'error'); }
      else {
        showToast(`Pushed to ${r.branch}`, 'success');
        // Auto-create PR
        const pr = await window.api.gameGitCreatePr({
          branchName: gameGitBranchName.trim(),
          targetBranch: gameGitTarget,
          title: gameGitCommitMsg.trim(),
        });
        if (pr?.success) {
          setGameGitPrUrl(pr.url);
          showToast('PR created', 'success');
        } else {
          showToast('Push OK but PR failed: ' + (pr?.error || 'gh CLI error'), 'error');
        }
        setGameGitCommitMsg('');
        loadGameGitStatus();
      }
    } catch (e) { showToast(e.message, 'error'); }
    setGameGitPushing(false);
  };

  const loadGameScripts = async () => {
    setLoadingGameScripts(true);
    setGameScriptsError('');
    try {
      const r = await window.api.getGameScripts();
      if (r?.error) { setGameScriptsError(r.error); }
      else if (r?.scripts) {
          setGameScripts(r.scripts); setGameRepoPath(r.gameRepoPath || '');
          // Auto-select first launch script if none selected
          if (!autoLaunch && r.scripts.length > 0) {
            const launchScripts = r.scripts.filter(s => /^playa\s+launch\b/.test(s.cmd));
            setAutoLaunch(launchScripts.length > 0 ? launchScripts[0].name : r.scripts[0].name);
          }
        }
    } catch (e) { setGameScriptsError(e.message); }
    setLoadingGameScripts(false);
  };

  const scripts = project?.scripts || {};
  const buildScripts = useMemo(() => {
    const known = ['build', 'build-audio', 'build-audioSprite', 'build-multi-audioSprites', 'build-audioSprites-size', 'build-validate'];
    return known.filter(s => scripts[s]);
  }, [scripts]);

  const deployScripts = useMemo(() => {
    const known = ['deploy'];
    return known.filter(s => scripts[s]);
  }, [scripts]);

  const otherScripts = useMemo(() => {
    const allKnown = new Set(['build', 'build-audio', 'build-audioSprite', 'build-multi-audioSprites', 'build-audioSprites-size', 'build-validate', 'deploy', 'test']);
    return Object.keys(scripts).filter(s => !allKnown.has(s));
  }, [scripts]);

  if (!project) {
    return (
      <div className="anim-fade-up flex flex-col items-center justify-center h-64 text-text-dim text-sm">
        Open a project first to build & deploy.
      </div>
    );
  }

  const runScript = async (scriptName) => {
    abortRef.current = false;
    setRunning(scriptName); setLog(''); setResult(null);
    const stopped = () => abortRef.current;
    try {
      const r = await window.api.runScript(scriptName);
      if (stopped()) return;
      if (r?.error) setLog(r.error);
      if (r?.success) {
        const refreshed = await window.api.reloadProject();
        if (stopped()) return;
        if (refreshed && setProject) setProject(refreshed);

        const refreshedDistOk = refreshed?.distInfo?.hasDist && refreshed?.distInfo?.hasSoundsJson;
        const shouldAutoDeploy = !scriptName.includes('validate') && deployScripts.includes('deploy')
          && !!(refreshed?.gameRepoAbsPath) && (refreshed?.gameRepoExists ?? false) && refreshedDistOk;
        if (shouldAutoDeploy) {
          showToast(`${scriptName} passed — deploying...`, 'success');
          setLog(prev => prev + '\n\n── Deploy ──\n');
          setRunning('deploy');
          try {
            const dr = await window.api.runDeploy('deploy');
            if (stopped()) return;
            if (dr?.error) setLog(prev => prev + dr.error);
            if (!dr?.success) {
              setResult({ script: 'deploy', ok: false });
              showToast('Deploy failed', 'error');
              setRunning(null); return;
            }
            setLog(prev => prev + '✔ Deployed\n');

            if (autoLaunch) {
              setLog(prev => prev + '\n── yarn install ──\n');
              setRunning('game:install');
              const yi = await window.api.yarnInstallGame();
              if (stopped()) return;
              if (!yi?.success) {
                setLog(prev => prev + `⚠ yarn install failed: ${yi?.error || 'unknown'}\n`);
              } else {
                setLog(prev => prev + '✔ Dependencies OK\n');
              }

              setLog(prev => prev + '\n── yarn build-dev ──\n');
              setRunning('game:build');
              const build = await window.api.buildGame();
              if (stopped()) return;
              if (build?.error === 'No build-dev script in game package.json') {
                setLog(prev => prev + 'No build-dev script, skipping...\n');
              } else if (!build?.success) {
                setLog(prev => prev + `\n✖ build-dev failed: ${build?.error || 'unknown'}\n`);
                setResult({ script: scriptName, ok: false });
                showToast('Game build failed', 'error');
                setRunning(null); return;
              } else {
                setLog(prev => prev + '\n✔ build-dev complete\n');
              }

              if (stopped()) return;
              setLog(prev => prev + `\n── Launch: ${autoLaunch} ──\n`);
              setRunning('game:' + autoLaunch);
              const lr = await window.api.runGameScript(autoLaunch);
              if (stopped()) return;
              if (!lr.success) {
                setLog(prev => prev + (lr.error || 'Launch failed'));
                setResult({ script: scriptName, ok: false });
                showToast('Launch failed', 'error');
                setRunning(null); return;
              }
              setGameStarted(true);
              setLog(prev => prev + `${lr.output}\n\nWaiting for server on port 8080...`);
              const port = await window.api.waitForPort({ port: 8080, timeout: 120000 });
              if (stopped()) return;
              if (port.ready) {
                setLog(prev => prev + '\n✔ Server ready! Opening browser...');
                setResult({ script: scriptName, ok: true });
                showToast('Build → Deploy → Launch complete!', 'success');
                window.api.openGameWindow('http://127.0.0.1:8080');
              } else {
                setLog(prev => prev + '\nTimeout — server did not respond.');
                setResult({ script: scriptName, ok: false });
                showToast('Server timeout', 'error');
              }
            } else {
              setResult({ script: 'deploy', ok: true });
              showToast('Build + Deploy complete', 'success');
            }
          } catch (de) {
            if (stopped()) return;
            setLog(prev => prev + '\nError: ' + de.message);
            setResult({ script: 'deploy', ok: false });
            showToast('Error', 'error');
          }
        } else {
          setResult({ script: scriptName, ok: true });
          showToast(`${scriptName} passed`, 'success');
        }
      } else {
        if (stopped()) return;
        setResult({ script: scriptName, ok: false });
        showToast(`${scriptName} failed`, 'error');
      }
    } catch (e) {
      if (stopped()) return;
      setLog(prev => prev + '\nError: ' + e.message);
      setResult({ script: scriptName, ok: false });
      showToast('Script error', 'error');
    }
    if (!stopped()) setRunning(null);
  };


  const runGameScript = async (scriptName) => {
    abortRef.current = false;
    setRunning('game:' + scriptName); setLog(''); setResult(null);
    const stopped = () => abortRef.current;
    try {
      if (scriptName !== 'build-dev') {
        setLog('── yarn build-dev ──\n');
        const build = await window.api.buildGame();
        if (stopped()) return;
        if (build?.error === 'No build-dev script in game package.json') {
          setLog(prev => prev + 'No build-dev script found, skipping build step...\n\n');
        } else if (!build?.success) {
          setLog(prev => prev + `\n\n✖ build-dev failed: ${build?.error || 'unknown error'}`);
          setResult({ script: scriptName, ok: false });
          showToast('Game build failed — launch cancelled', 'error');
          setRunning(null); return;
        } else {
          setLog(prev => prev + '\n✔ build-dev complete\n\n');
        }
      }

      if (stopped()) return;
      setLog(prev => prev + `── yarn ${scriptName} ──\n`);
      const r = await window.api.runGameScript(scriptName);
      if (stopped()) return;
      if (!r.success) {
        setLog(prev => prev + (r.error || 'Failed to start'));
        setResult({ script: scriptName, ok: false });
        showToast(`${scriptName} failed`, 'error');
        setRunning(null);
        return;
      }
      setGameStarted(true);
      setLog(prev => prev + `${r.output}\n\nWaiting for server on port 8080...`);
      showToast('Launched — waiting for server...', 'success');
      const port = await window.api.waitForPort({ port: 8080, timeout: 120000 });
      if (stopped()) return;
      if (port.ready) {
        setLog(prev => prev + '\nServer ready! Opening browser...');
        setResult({ script: scriptName, ok: true });
        showToast('Server ready!', 'success');
        window.api.openGameWindow('http://127.0.0.1:8080');
      } else {
        setLog(prev => prev + '\nTimeout — server did not respond within 2 minutes.');
        setResult({ script: scriptName, ok: false });
        showToast('Server timeout', 'error');
      }
    } catch (e) {
      if (stopped()) return;
      setLog(prev => prev + '\nError: ' + e.message);
      setResult({ script: scriptName, ok: false });
      showToast('Launch error', 'error');
    }
    if (!stopped()) setRunning(null);
  };

  const deployTarget = project?.gameRepoAbsPath || null;
  const deployTargetExists = project?.gameRepoExists || false;
  const distInfo = project?.distInfo || null;
  const gameNodeModulesMissing = deployTarget && deployTargetExists && project?.gameNodeModulesExists === false;

  return (
    <div className="anim-fade-up h-full flex flex-col gap-1.5">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2">
        <h2 className="text-lg font-bold text-text-primary">Build & Deploy</h2>
        {result && !running && (
          <span className={`badge ${result.ok ? 'bg-green-dim text-green' : 'bg-danger-dim text-danger'} text-xs`}>
            {result.script}: {result.ok ? 'OK' : 'FAILED'}
          </span>
        )}
      </div>

      {/* 2-column grid */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-1.5">

        {/* ═══ LEFT: Audio Pipeline ═══ */}
        <div className="flex flex-col gap-1.5 min-h-0 overflow-y-auto pr-0.5">
          <div className="card p-3 space-y-3">
            {/* Header */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="badge bg-cyan-dim text-cyan text-xs">Audio Pipeline</span>
              {distInfo?.hasDist ? (
                <>
                  <span className="text-xs text-text-dim">{distInfo.spriteCount} sprites · {distInfo.totalSizeMB} MB</span>
                  {distInfo.hasSoundsJson && <span className="text-xs text-green">✓ json</span>}
                </>
              ) : (
                <span className="text-xs text-text-dim italic">Not built</span>
              )}
            </div>

            {/* Build scripts */}
            <div className="flex flex-col gap-2">
              {buildScripts.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {buildScripts.map(name => (
                    <button
                      key={name}
                      onClick={() => runScript(name)}
                      disabled={running !== null}
                      className={running === name ? 'btn-ghost text-cyan border-cyan/30 cursor-wait text-xs py-1.5 px-3' : running ? 'btn-ghost text-xs py-1.5 px-3 opacity-40' : 'btn-ghost text-xs py-1.5 px-3'}
                      title={scripts[name]}
                    >
                      {running === name && <span className="inline-block w-1.5 h-1.5 rounded-full bg-cyan mr-1.5 anim-pulse-dot" />}
                      {running === name ? `${name}...` : name}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-text-dim">No build scripts in package.json</p>
              )}
            </div>

            {/* Auto-launch dropdown */}
            {deployTarget && gameScripts.length > 0 && (
              <div className="flex items-center gap-2 pt-2 border-t border-border/30">
                <span className="section-label shrink-0">After build</span>
                <select
                  value={autoLaunch}
                  onChange={e => setAutoLaunch(e.target.value)}
                  disabled={running !== null}
                  className="input-base text-sm font-mono py-1 px-2 w-auto"
                  title="Deploy + launch this script automatically after build completes"
                >
                  <option value="">Deploy only</option>
                  {gameScripts.filter(s => /^playa\s+launch\b/.test(s.cmd)).map(s => (
                    <option key={s.name} value={s.name}>Deploy + Launch: {s.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Dist sprite tags */}
            {distInfo?.sprites?.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {distInfo.sprites.map(s => (
                  <span key={s} className="text-xs font-mono text-text-dim bg-bg-hover px-1.5 py-0.5 rounded">{s}</span>
                ))}
              </div>
            )}

            {/* Other scripts */}
            {otherScripts.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/30">
                <span className="section-label shrink-0">Other</span>
                {otherScripts.map(name => (
                  <button
                    key={name}
                    onClick={() => runScript(name)}
                    disabled={running !== null}
                    className={running === name ? 'btn-ghost text-purple border-purple/30 cursor-wait text-xs py-1.5 px-3' : running ? 'btn-ghost text-xs py-1.5 px-3 opacity-40' : 'btn-ghost text-xs py-1.5 px-3'}
                    title={scripts[name]}
                  >
                    {running === name && <span className="inline-block w-1.5 h-1.5 rounded-full bg-purple mr-1.5 anim-pulse-dot" />}
                    {running === name ? `${name}...` : name}
                  </button>
                ))}
              </div>
            )}
          </div>

        </div>

        {/* ═══ RIGHT: Game ═══ */}
        <div className="flex flex-col gap-1.5 min-h-0 overflow-y-auto pr-0.5">

          {/* LAUNCH GAME */}
          <div className="card p-3 space-y-3">
            {/* Header */}
            <div className="flex items-center gap-2">
              <span className="badge bg-purple-dim text-purple text-xs">Game</span>
              {gameRepoPath && (
                <p className="text-xs font-mono text-text-dim truncate" title={gameRepoPath}>{gameRepoPath.split(/[/\\]/).pop()}</p>
              )}
              {(running?.startsWith('game:') || gameStarted) && (
                <button
                  onClick={() => { abortRef.current = true; window.api.stopAll(); setRunning(null); setGameStarted(false); showToast('Process killed', 'success'); }}
                  className="btn-ghost text-danger border-danger/30 text-xs py-1 px-2.5"
                  title="Kill running game process and free port 8080"
                >
                  Kill
                </button>
              )}
              <button
                onClick={loadGameScripts}
                disabled={loadingGameScripts || running !== null}
                className="btn-ghost text-xs py-1 px-2.5 disabled:opacity-40"
                title="Reload launch scripts"
              >
                {loadingGameScripts ? '...' : 'Refresh'}
              </button>
            </div>

            {gameScriptsError && <p className="text-xs text-danger font-mono">{gameScriptsError}</p>}
            {gameNodeModulesMissing && (
              <p className="text-xs text-orange">Missing node_modules — run yarn install in Setup</p>
            )}

            {/* Launch scripts — grid for column alignment */}
            {!deployTarget ? (
              <p className="text-xs text-text-dim">Link a game repo in Setup first</p>
            ) : gameScripts.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: '6px 12px', alignItems: 'center', justifyContent: 'start' }}>
                {gameScripts.map(({ name, cmd }) => (
                  <React.Fragment key={name}>
                    <p className="text-sm font-mono font-semibold text-text-primary" title={cmd}>{name}</p>
                    <button
                      onClick={() => runGameScript(name)}
                      disabled={running !== null}
                      className={running === 'game:' + name ? 'btn-ghost text-purple border-purple/30 cursor-wait text-xs py-1.5 px-3' : running ? 'btn-ghost text-xs py-1.5 px-3 opacity-40' : 'btn-ghost text-xs py-1.5 px-3'}
                      title={cmd}
                    >
                      {running === 'game:' + name && <span className="inline-block w-1.5 h-1.5 rounded-full bg-purple mr-1 anim-pulse-dot" />}
                      {running === 'game:' + name ? 'Launching...' : 'Launch'}
                    </button>
                  </React.Fragment>
                ))}
              </div>
            ) : loadingGameScripts ? (
              <p className="text-xs text-text-dim">Loading scripts...</p>
            ) : (
              <p className="text-xs text-text-dim">No launch scripts found</p>
            )}

          </div>

          {/* GAME GIT — compact */}
          {deployTarget && (
            <div className="card p-3 space-y-2">
              <div className="flex items-center gap-3">
                <span className="badge bg-accent-dim text-accent text-xs">Game Git</span>
                {gameGit && <span className="text-sm font-mono text-purple">{gameGit.branch}</span>}
                {gameGit && gameGit.files.length > 0 && <span className="badge bg-orange-dim text-orange text-xs">{gameGit.files.length}</span>}
                <button onClick={loadGameGitStatus} disabled={gameGitLoading}
                  className="btn-ghost text-xs py-1 px-2.5 disabled:opacity-40">
                  {gameGitLoading ? '...' : 'Refresh'}
                </button>
              </div>

              {!gameGit ? (
                <p className="text-sm text-text-dim">Click Refresh to load status</p>
              ) : gameGit.files.length === 0 ? (
                <p className="text-sm text-green">No changes — deploy first</p>
              ) : (
                <div className="space-y-2.5">
                  <div className="flex gap-3 items-center">
                    <label className="text-xs text-text-dim shrink-0 w-12">Target</label>
                    <select value={gameGitTarget} onChange={e => {
                      setGameGitTarget(e.target.value);
                      const audioName = project?.path?.split(/[/\\]/).pop()?.replace('-audio', '') || 'audio';
                      const prefix = e.target.value.startsWith('release') ? 'bugfix/PA-' : 'feature/PA-';
                      setGameGitBranchName(`${prefix}${audioName}-audio-update`);
                    }} className="input-base text-sm font-mono flex-1 py-1">
                      {gameGit.hasDevelop && <option value="develop">develop</option>}
                      {gameGit.releaseBranches.map(b => <option key={b} value={b}>{b}</option>)}
                      {gameGit.branch !== 'develop' && !gameGit.releaseBranches.includes(gameGit.branch) && (
                        <option value={gameGit.branch}>{gameGit.branch} (current)</option>
                      )}
                    </select>
                  </div>
                  <div className="flex gap-3 items-center">
                    <label className="text-xs text-text-dim shrink-0 w-12">Branch</label>
                    <input type="text" value={gameGitBranchName} onChange={e => setGameGitBranchName(e.target.value)}
                      placeholder="feature/PA-audio-update" className="input-base text-sm font-mono flex-1 py-1" maxLength={100} />
                  </div>
                  <div className="flex gap-3 items-center">
                    <label className="text-xs text-text-dim shrink-0 w-12">Msg</label>
                    <input type="text" value={gameGitCommitMsg} onChange={e => setGameGitCommitMsg(e.target.value)}
                      placeholder="Update audio sprites" className="input-base text-sm flex-1 py-1"
                      onKeyDown={e => e.key === 'Enter' && handleGameGitPush()} />
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={handleGameGitPush}
                      disabled={gameGitPushing || !gameGitBranchName.trim() || !gameGitCommitMsg.trim()}
                      className="btn-primary text-xs py-1.5 px-4 disabled:opacity-40"
                      title="Create branch, commit, push, open PR">
                      {gameGitPushing ? 'Pushing...' : 'Commit, Push & PR'}
                    </button>
                    {gameGitPrUrl && (
                      <button onClick={() => window.api.openUrl(gameGitPrUrl)}
                        className="text-xs text-accent hover:text-accent/80 font-mono truncate">
                        {gameGitPrUrl}
                      </button>
                    )}
                  </div>
                  <details className="text-xs">
                    <summary className="text-text-dim cursor-pointer hover:text-text-secondary">
                      {gameGit.files.length} file{gameGit.files.length !== 1 ? 's' : ''} changed
                    </summary>
                    <div className="mt-1 space-y-0.5 max-h-24 overflow-y-auto">
                      {gameGit.files.map((f, i) => <p key={i} className="font-mono text-text-dim truncate">{f}</p>)}
                    </div>
                  </details>
                </div>
              )}
            </div>
          )}
        </div>

      </div>

      {/* LOG — full width, compact */}
      {(log || running) && (
        <div className="card p-2.5 shrink-0 space-y-1">
          <div className="flex items-center gap-2">
            <span className="section-label">Output</span>
            {running && (
              <span className="flex items-center gap-1 text-xs text-cyan">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-cyan anim-pulse-dot" />
                live
              </span>
            )}
            <button
              onClick={() => {
                if (running) { abortRef.current = true; window.api.stopAll(); setRunning(null); setGameStarted(false); setLog(prev => prev + '\n\n✖ Stopped by user\n'); showToast('Stopped', 'success'); }
                else { setLog(''); setResult(null); }
              }}
              className={`ml-auto text-xs ${running ? 'btn-ghost text-danger border-danger/30 py-1 px-2.5' : 'text-text-dim hover:text-text-secondary'}`}
            >{running ? 'Stop' : 'Clear'}</button>
          </div>
          <pre
            ref={logRef}
            className="p-2 rounded-lg bg-bg-input border border-border text-xs font-mono text-text-primary overflow-auto max-h-64 whitespace-pre-wrap leading-relaxed"
          >{log || ' '}</pre>
        </div>
      )}
    </div>
  );
}
