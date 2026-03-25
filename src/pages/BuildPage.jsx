import React, { useState, useRef, useEffect, useMemo } from 'react';

export default function BuildPage({ project, setProject, reloadProject, showToast }) {
  const [running, setRunning] = useState(null);
  const [log, setLog] = useState('');
  const [result, setResult] = useState(null); // { script, ok }
  const [gameScripts, setGameScripts] = useState([]);
  const [gameRepoPath, setGameRepoPath] = useState('');
  const [loadingGameScripts, setLoadingGameScripts] = useState(false);
  const [gameScriptsError, setGameScriptsError] = useState('');
  const [cleaning, setCleaning] = useState(false);
  const [glrList, setGlrList] = useState([]);
  const [glrLoading, setGlrLoading] = useState(false);
  const [glrError, setGlrError] = useState('');
  const [gameStarted, setGameStarted] = useState(false); // stays true after timeout — keeps Kill visible
  const logRef = useRef(null);

  // Auto-scroll log to bottom as lines stream in
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);

  // Subscribe to live script output — mount once, unmount cleanup
  useEffect(() => {
    const handler = (_, line) => setLog(prev => prev + line);
    window.api.onScriptOutput(handler);
    return () => window.api.offScriptOutput(handler);
  }, []);

  useEffect(() => {
    setLog(''); setResult(null); setRunning(null); setGameStarted(false);
    setGameScripts([]); setGameRepoPath(''); setGameScriptsError('');
    setGlrList([]); setGlrError('');
    if (project) { loadGameScripts(); loadGlrList(); }
  }, [project?.path]);

  const loadGlrList = async () => {
    setGlrLoading(true);
    setGlrError('');
    try {
      const r = await window.api.listGlr();
      if (r?.error) setGlrError(r.error);
      else setGlrList(r?.glrList || []);
    } catch (e) { setGlrError(e.message); }
    setGlrLoading(false);
  };

  const launchLocalGlr = async (glrName) => {
    setRunning('glr:' + glrName); setLog(''); setResult(null);
    try {
      setLog('Pulling latest game code...\n');
      const pull = await window.api.gitPullGame();
      if (!pull.success) {
        setLog(prev => prev + `⚠️  git pull failed: ${pull.error || 'check network'}\nLaunching with current local version...\n\n`);
      } else {
        setLog(prev => prev + (pull.output?.trim() || 'Already up to date.') + '\n\n');
      }

      // Build game before GLR launch
      setLog(prev => prev + '── yarn build-dev ──\n');
      const build = await window.api.buildGame();
      if (build?.error === 'No build-dev script in game package.json') {
        setLog(prev => prev + 'No build-dev script found, skipping build step...\n\n');
      } else if (!build?.success) {
        setLog(prev => prev + `\n\n✖ build-dev failed: ${build?.error || 'unknown error'}`);
        setResult({ script: glrName, ok: false });
        showToast('Game build failed — GLR launch cancelled', 'error');
        setRunning(null);
        return;
      } else {
        setLog(prev => prev + '\n✔ build-dev complete\n\n');
      }

      const r = await window.api.launchLocalGlr({ glrName });
      if (!r.success) {
        setLog(prev => prev + (r.error || 'Failed to launch'));
        setResult({ script: glrName, ok: false });
        showToast(`Launch failed: ${r.error}`, 'error');
        setRunning(null);
        return;
      }
      setLog(prev => prev + `Launched GLR "${glrName}" locally (no VPN) — PID ${r.pid}\nSoftwareId: ${r.softwareId}\n\nWaiting for server on port 8080...`);
      showToast(`Launching "${glrName}"...`, 'success');
      const port = await window.api.waitForPort({ port: 8080, timeout: 60000 });
      if (port.ready) {
        setGameStarted(true);
        setLog(prev => prev + '\nServer ready! Opening browser...');
        setResult({ script: glrName, ok: true });
        showToast('Game ready!', 'success');
        window.api.openGameWindow('http://127.0.0.1:8080');
      } else {
        setLog(prev => prev + '\nTimeout — server did not respond within 60s.');
        setResult({ script: glrName, ok: false });
        showToast('Server timeout', 'error');
      }
    } catch (e) {
      setLog('Error: ' + e.message);
      setResult({ script: glrName, ok: false });
      showToast('Launch error', 'error');
    }
    setRunning(null);
  };

  const loadGameScripts = async () => {
    setLoadingGameScripts(true);
    setGameScriptsError('');
    try {
      const r = await window.api.getGameScripts();
      if (r?.error) { setGameScriptsError(r.error); }
      else if (r?.scripts) { setGameScripts(r.scripts); setGameRepoPath(r.gameRepoPath || ''); }
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

  const pullAndBuild = async () => {
    setRunning('pull-build'); setLog(''); setResult(null);
    try {
      // Step 1: Pull sounds.json from game repo
      setLog('── Pull sounds.json from game repo ──\n');
      const pull = await window.api.pullGameJson();
      if (!pull?.success) {
        setLog(prev => prev + `✖ ${pull?.error || 'Failed to pull JSON'}`);
        setResult({ script: 'pull-build', ok: false });
        showToast(pull?.error || 'Pull failed', 'error');
        setRunning(null);
        return;
      }
      if (pull.project) setProject(pull.project);
      setLog(prev => prev + `✔ Copied from:\n  ${pull.source}\n\n`);

      // Step 2: Build audio (npm run build)
      setLog(prev => prev + '── npm run build ──\n');
      const build = await window.api.runScript('build');
      if (!build?.success) {
        setLog(prev => prev + '\n✖ Build failed');
        setResult({ script: 'pull-build', ok: false });
        showToast('Build failed after pull', 'error');
        setRunning(null);
        return;
      }
      setLog(prev => prev + '\n✔ Build complete\n\n');

      // Step 3: Reload project + auto-deploy
      const refreshed = await window.api.reloadProject();
      if (refreshed && setProject) setProject(refreshed);
      const refreshedDistOk = refreshed?.distInfo?.hasDist && refreshed?.distInfo?.hasSoundsJson;
      const canDeploy = deployScripts.includes('deploy') && !!(refreshed?.gameRepoAbsPath) && (refreshed?.gameRepoExists ?? false) && refreshedDistOk;
      if (canDeploy) {
        setLog(prev => prev + '── Auto-deploying ──\n');
        const dr = await window.api.runDeploy('deploy');
        setResult({ script: 'pull-build', ok: dr?.success ?? false });
        showToast(dr?.success ? 'Pull → Build → Deploy završen' : 'Deploy failed', dr?.success ? 'success' : 'error');
      } else {
        setResult({ script: 'pull-build', ok: true });
        showToast('Pull → Build završen', 'success');
      }
    } catch (e) {
      setLog(prev => prev + '\nError: ' + e.message);
      setResult({ script: 'pull-build', ok: false });
      showToast('Error', 'error');
    }
    setRunning(null);
  };

  const runScript = async (scriptName) => {
    setRunning(scriptName); setLog(''); setResult(null);
    try {
      const r = await window.api.runScript(scriptName);
      if (r?.error) setLog(r.error);
      if (r?.success) {
        // Auto-reload project to pick up new dist/sounds.json and distInfo
        const refreshed = await window.api.reloadProject();
        if (refreshed && setProject) setProject(refreshed);

        // Use freshly reloaded distInfo — stale closure values could reflect pre-build state
        const refreshedDistOk = refreshed?.distInfo?.hasDist && refreshed?.distInfo?.hasSoundsJson;
        const shouldAutoDeploy = !scriptName.includes('validate') && deployScripts.includes('deploy')
          && !!(refreshed?.gameRepoAbsPath) && (refreshed?.gameRepoExists ?? false) && refreshedDistOk;
        if (shouldAutoDeploy) {
          showToast(`${scriptName} prošao — deploying...`, 'success');
          setLog(prev => prev + '\n\n── Auto-deploying ──\n');
          setRunning('deploy');
          try {
            const dr = await window.api.runDeploy('deploy');
            if (dr?.error) setLog(prev => prev + dr.error);
            setResult({ script: 'deploy', ok: dr?.success ?? false });
            showToast(dr?.success ? 'Build + Deploy završen' : 'Deploy failed', dr?.success ? 'success' : 'error');
          } catch (de) {
            setLog(prev => prev + '\nDeploy error: ' + de.message);
            setResult({ script: 'deploy', ok: false });
            showToast('Deploy error', 'error');
          }
        } else {
          setResult({ script: scriptName, ok: true });
          showToast(`${scriptName} prošao`, 'success');
        }
      } else {
        setResult({ script: scriptName, ok: false });
        showToast(`${scriptName} failed`, 'error');
      }
    } catch (e) {
      setLog(prev => prev + '\nError: ' + e.message);
      setResult({ script: scriptName, ok: false });
      showToast('Script error', 'error');
    }
    setRunning(null);
  };

  const runDeploy = async (scriptName) => {
    setRunning(scriptName); setLog(''); setResult(null);
    try {
      const r = await window.api.runDeploy(scriptName);
      if (r?.error) setLog(r.error);
      setResult({ script: scriptName, ok: r?.success ?? false });
      showToast(r?.success ? 'Deploy završen' : 'Deploy failed', r?.success ? 'success' : 'error');
    } catch (e) {
      setLog(prev => prev + '\nError: ' + e.message);
      setResult({ script: scriptName, ok: false });
      showToast('Deploy error', 'error');
    }
    setRunning(null);
  };

  const runGameScript = async (scriptName) => {
    setRunning('game:' + scriptName); setLog(''); setResult(null);
    try {
      // Step 1: build-dev first (unless user clicked build-dev itself)
      if (scriptName !== 'build-dev') {
        setLog('── yarn build-dev ──\n');
        const build = await window.api.buildGame();
        if (build?.error === 'No build-dev script in game package.json') {
          setLog(prev => prev + 'No build-dev script found, skipping build step...\n\n');
        } else if (!build?.success) {
          setLog(prev => prev + `\n\n✖ build-dev failed: ${build?.error || 'unknown error'}`);
          setResult({ script: scriptName, ok: false });
          showToast('Game build failed — launch cancelled', 'error');
          setRunning(null);
          return;
        } else {
          setLog(prev => prev + '\n✔ build-dev complete\n\n');
        }
      }

      // Step 2: launch
      setLog(prev => prev + `── yarn ${scriptName} ──\n`);
      const r = await window.api.runGameScript(scriptName);
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
      setLog(prev => prev + '\nError: ' + e.message);
      setResult({ script: scriptName, ok: false });
      showToast('Launch error', 'error');
    }
    setRunning(null);
  };

  const handleCleanDist = async () => {
    setCleaning(true);
    try {
      const r = await window.api.cleanDist();
      if (r?.success) {
        showToast(r.removed > 0 ? `Removed ${r.removed} file(s) from dist/` : 'dist/ already clean', 'success');
      } else {
        showToast(r?.error || 'Clean failed', 'error');
      }
    } catch (e) {
      showToast('Clean failed: ' + e.message, 'error');
    }
    setCleaning(false);
  };

  const deployTarget = project?.gameRepoAbsPath || null;
  const deployTargetExists = project?.gameRepoExists || false;
  const distInfo = project?.distInfo || null;
  const gameNodeModulesMissing = deployTarget && deployTargetExists && project?.gameNodeModulesExists === false;

  return (
    <div className="anim-fade-up h-full flex flex-col gap-2">
      {/* Header */}
      <div className="shrink-0 py-0.5">
        <h2 className="text-xl font-bold text-text-primary">Build & Deploy</h2>
      </div>

      {/* 2-column grid - takes all remaining space */}
      <div className="flex-1 min-h-0 grid grid-cols-2 gap-2">

        {/* LEFT column */}
        <div className="flex flex-col gap-2 min-h-0 overflow-y-auto pr-1">

          {/* BUILD SCRIPTS */}
          <div className="card p-3 space-y-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="badge bg-cyan-dim text-cyan text-xs">Build Scripts</span>
              {result && (result.script === 'pull-build' || buildScripts.includes(result.script)) && (
                <span className={`badge ${result.ok ? 'bg-green-dim text-green' : 'bg-danger-dim text-danger'}`}>
                  {result.ok ? 'PASSED' : 'FAILED'}
                </span>
              )}
              <div className="ml-auto flex items-center gap-1.5">
                {deployTarget && (
                  <button
                    onClick={pullAndBuild}
                    disabled={running !== null}
                    className={running === 'pull-build' ? 'btn-ghost text-green border-green/30 cursor-wait text-[11px] py-1 px-3' : 'btn-primary text-[11px] py-1 px-3 disabled:opacity-40 disabled:cursor-not-allowed'}
                  >
                    {running === 'pull-build' && <span className="inline-block w-2 h-2 rounded-full bg-green mr-1.5 anim-pulse-dot" />}
                    {running === 'pull-build' ? 'Running...' : 'Pull & Build'}
                  </button>
                )}
                <button
                  onClick={handleCleanDist}
                  disabled={cleaning || running !== null}
                  className="btn-ghost text-[11px] py-1 px-3 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {cleaning ? 'Cleaning...' : 'Clean dist/'}
                </button>
              </div>
            </div>

            {buildScripts.length > 0 ? (
              <div className="space-y-2">
                {buildScripts.map(name => (
                  <div key={name} className="flex items-center gap-3 py-1.5">
                    <div className="flex-1">
                      <p className="text-xs font-mono font-semibold text-text-primary">{name}</p>
                      <p className="text-xs text-text-dim font-mono truncate mt-0.5">{scripts[name]}</p>
                    </div>
                    <button
                      onClick={() => runScript(name)}
                      disabled={running !== null}
                      className={running === name ? 'btn-ghost text-cyan border-cyan/30 cursor-wait text-xs' : running ? 'btn-ghost text-xs opacity-40' : 'btn-primary text-xs py-2'}
                    >
                      {running === name && <span className="inline-block w-2 h-2 rounded-full bg-cyan mr-2 anim-pulse-dot" />}
                      {running === name ? 'Running...' : 'Run'}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-text-dim">No build scripts found in package.json</p>
            )}
          </div>

          {/* DIST STATUS */}
          {distInfo && (
            <div className="card p-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="badge bg-cyan-dim text-cyan text-xs">Last Build</span>
                {distInfo.hasDist
                  ? <span className="badge bg-green-dim text-green text-xs">{distInfo.spriteCount} sprites · {distInfo.totalSizeMB} MB</span>
                  : <span className="badge bg-orange-dim text-orange text-xs">Not built yet</span>
                }
                {distInfo.hasSoundsJson && <span className="badge bg-green-dim text-green text-xs">sounds.json ✓</span>}
              </div>
              {distInfo.sprites.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {distInfo.sprites.map(s => (
                    <span key={s} className="text-[10px] font-mono text-text-dim bg-bg-hover px-1.5 py-0.5 rounded">{s}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* DEPLOY */}
          <div className="card p-3 space-y-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="badge bg-green-dim text-green text-xs">Deploy</span>
              {result && deployScripts.includes(result.script) && (
                <span className={`badge ${result.ok ? 'bg-green-dim text-green' : 'bg-danger-dim text-danger'}`}>
                  {result.ok ? 'OK' : 'FAILED'}
                </span>
              )}
            </div>

            {deployTarget ? (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${deployTargetExists ? 'bg-green' : 'bg-orange'}`} />
                  <p className="text-[11px] text-text-secondary font-mono truncate">{deployTarget}</p>
                </div>
                <p className="text-[10px] text-text-dim pl-3.5">→ assets/default/default/default/sounds/</p>
                {!deployTargetExists && (
                  <p className="text-[10px] text-orange pl-3.5">Game repo folder not found — provjeri putanju u Setup-u</p>
                )}
                {!distInfo?.hasDist && (
                  <p className="text-[10px] text-orange pl-3.5">Pokreni build prvo prije deploy-a</p>
                )}
                {distInfo?.hasDist && !distInfo?.hasSoundsJson && (
                  <p className="text-[10px] text-orange pl-3.5">dist/sounds.json nedostaje — ponovi build</p>
                )}
              </div>
            ) : (
              <p className="text-xs text-danger">Game repo nije podešen — idi na Setup → Game Repository</p>
            )}

            {deployScripts.length > 0 ? (
              <button
                onClick={() => runDeploy('deploy')}
                disabled={running !== null || !deployTarget || !deployTargetExists || !distInfo?.hasDist || !distInfo?.hasSoundsJson}
                className={running === 'deploy' ? 'btn-ghost text-green border-green/30 cursor-wait' : (!deployTarget || !deployTargetExists || !distInfo?.hasDist || !distInfo?.hasSoundsJson) ? 'btn-ghost opacity-40 cursor-not-allowed' : 'btn-primary'}
              >
                {running === 'deploy' && <span className="inline-block w-2 h-2 rounded-full bg-green mr-2 anim-pulse-dot" />}
                {running === 'deploy' ? 'Deploying...' : 'Deploy to Game'}
              </button>
            ) : (
              <p className="text-xs text-text-dim">No deploy script found in package.json</p>
            )}
          </div>

          {/* OTHER SCRIPTS */}
          {otherScripts.length > 0 && (
            <div className="card p-3 space-y-2">
              <span className="badge bg-purple-dim text-purple text-xs">Other Scripts</span>
              <div className="space-y-2">
                {otherScripts.map(name => (
                  <div key={name} className="flex items-center gap-3 py-1">
                    <div className="flex-1">
                      <p className="text-xs font-mono font-semibold text-text-primary">{name}</p>
                      <p className="text-xs text-text-dim font-mono truncate mt-0.5">{scripts[name]}</p>
                    </div>
                    <button
                      onClick={() => runScript(name)}
                      disabled={running !== null}
                      className={running === name ? 'btn-ghost text-purple border-purple/30 cursor-wait text-xs' : running ? 'btn-ghost text-xs opacity-40' : 'btn-ghost text-xs'}
                    >
                      {running === name ? 'Running...' : 'Run'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* RIGHT column */}
        <div className="flex flex-col gap-2 min-h-0 overflow-y-auto pr-1">

          {/* LAUNCH GAME */}
          <div className="card p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="badge bg-purple-dim text-purple text-xs">Launch Game</span>
                {result && gameScripts.some(s => s.name === result.script) && (
                  <span className={`badge ${result.ok ? 'bg-green-dim text-green' : 'bg-danger-dim text-danger'}`}>
                    {result.ok ? 'LAUNCHED' : 'FAILED'}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {(running?.startsWith('game:') || gameStarted) && (
                  <button
                    onClick={() => { window.api.killGame(); setRunning(null); setGameStarted(false); showToast('Game process killed', 'success'); }}
                    className="btn-ghost text-danger border-danger/30 text-[10px] py-1 px-2"
                  >
                    Kill
                  </button>
                )}
                <button
                  onClick={loadGameScripts}
                  disabled={loadingGameScripts || running !== null}
                  className="text-[10px] text-text-dim hover:text-text-secondary transition-colors cursor-pointer disabled:opacity-40"
                >
                  {loadingGameScripts ? 'Loading...' : 'Refresh'}
                </button>
              </div>
            </div>

            {gameRepoPath && (
              <p className="text-xs text-text-secondary font-mono truncate">{gameRepoPath}</p>
            )}

            {gameScriptsError && (
              <p className="text-xs text-danger font-mono">{gameScriptsError}</p>
            )}

            {gameNodeModulesMissing && (
              <p className="text-xs text-orange">
                ⚠ Game repo nema node_modules — pokreni <span className="font-mono">yarn install</span> u Setup → Game Repository pre launch-a
              </p>
            )}

            {!deployTarget ? (
              <p className="text-xs text-text-dim">Link a game repo in Setup first</p>
            ) : gameScripts.length > 0 ? (
              <div className="space-y-2">
                {gameScripts.map(({ name, cmd }) => (
                  <div key={name} className="flex items-center gap-3 py-1.5 border-b border-border/40 last:border-0">
                    <div className="flex-1">
                      <p className="text-xs font-mono font-semibold text-text-primary">{name}</p>
                      <p className="text-xs text-text-dim font-mono truncate mt-0.5">{cmd}</p>
                    </div>
                    <button
                      onClick={() => runGameScript(name)}
                      disabled={running !== null}
                      className={running === 'game:' + name ? 'btn-ghost text-purple border-purple/30 cursor-wait text-xs' : running ? 'btn-ghost text-xs opacity-40' : 'btn-ghost text-xs'}
                    >
                      {running === 'game:' + name && <span className="inline-block w-2 h-2 rounded-full bg-purple mr-2 anim-pulse-dot" />}
                      {running === 'game:' + name ? 'Launching...' : 'Launch'}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-text-dim">
                {loadingGameScripts ? 'Reading game repo...' : 'No launch scripts found in game package.json'}
              </p>
            )}
          </div>

          {/* LOCAL AUDIO TEST — GLR (no VPN) */}
          <div className="card p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="badge bg-orange-dim text-orange text-xs">Local Audio Test</span>
                <span className="badge bg-green-dim text-green text-[10px]">No VPN</span>
              </div>
              <button
                onClick={loadGlrList}
                disabled={glrLoading || running !== null}
                className="text-[10px] text-text-dim hover:text-text-secondary transition-colors cursor-pointer disabled:opacity-40"
              >
                {glrLoading ? 'Loading...' : 'Refresh'}
              </button>
            </div>

            <p className="text-xs text-text-dim">
              Runs the game locally using a recorded GLR session — no server, no VPN required. Build and deploy audio first, then launch.
            </p>

            {!deployTarget ? (
              <p className="text-xs text-text-dim">Link a game repo in Setup first</p>
            ) : gameNodeModulesMissing ? (
              <p className="text-xs text-orange">⚠ Game repo nema node_modules — pokreni yarn install u Setup → Game Repository</p>
            ) : glrError ? (
              <p className="text-xs text-danger font-mono">{glrError}</p>
            ) : glrList.length === 0 ? (
              <p className="text-xs text-text-dim">{glrLoading ? 'Reading GLR folder...' : 'No GLR recordings found in game/GLR/'}</p>
            ) : (
              <div className="space-y-1">
                {glrList.map(name => (
                  <div key={name} className="flex items-center gap-3 py-1.5 border-b border-border/30 last:border-0">
                    <p className="flex-1 text-sm font-mono text-text-primary">{name}</p>
                    <button
                      onClick={() => launchLocalGlr(name)}
                      disabled={running !== null}
                      className={running === 'glr:' + name ? 'btn-ghost text-orange border-orange/30 cursor-wait text-xs' : running ? 'btn-ghost text-xs opacity-40' : 'btn-ghost text-xs'}
                    >
                      {running === 'glr:' + name && <span className="inline-block w-2 h-2 rounded-full bg-orange mr-2 anim-pulse-dot" />}
                      {running === 'glr:' + name ? 'Launching...' : 'Launch'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

      </div>

      {/* LOG OUTPUT — full width at bottom, only when active */}
      {(log || running) && (
        <div className="card p-3 space-y-1.5 shrink-0">
          <div className="flex items-center gap-2">
            <span className="section-label">Output</span>
            {running && (
              <span className="flex items-center gap-1.5 text-[11px] text-cyan">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-cyan anim-pulse-dot" />
                live
              </span>
            )}
            {result && !running && (
              <span className={`badge ${result.ok ? 'bg-green-dim text-green' : 'bg-danger-dim text-danger'}`}>
                {result.script}: {result.ok ? 'SUCCESS' : 'FAILED'}
              </span>
            )}
            <button
              onClick={() => { setLog(''); setResult(null); }}
              disabled={running !== null}
              className="ml-auto text-xs text-text-dim hover:text-text-secondary transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >Clear</button>
          </div>
          <pre
            ref={logRef}
            className="p-3 rounded-lg bg-bg-input border border-border text-xs font-mono text-text-primary overflow-auto max-h-36 whitespace-pre-wrap leading-relaxed"
          >{log || ' '}</pre>
        </div>
      )}
    </div>
  );
}
