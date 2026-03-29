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

  const recordGlr = async () => {
    setRunning('record-glr'); setLog(''); setResult(null);
    try {
      setLog('Starting GLR recording (requires VPN)...\n');
      const r = await window.api.recordGlr();
      if (!r.success) {
        setLog(prev => prev + `✖ ${r.error || 'Failed to start recording'}`);
        setResult({ script: 'record-glr', ok: false });
        showToast(r.error || 'Record failed', 'error');
        setRunning(null);
        return;
      }
      setLog(prev => prev + `Recording started — PID ${r.pid}\nServer: ${r.server} | SoftwareId: ${r.softwareId} | Channel: ${r.channel}\n\nGame will open at http://127.0.0.1:8080\nPlay through scenarios you want to record (spins, bonus, big win).\nGLR files are saved to game/GLR/ automatically.\nWhen done, click Kill to stop recording.\n\nWaiting for server on port 8080...`);
      const port = await window.api.waitForPort({ port: 8080, timeout: 60000 });
      if (port.ready) {
        setGameStarted(true);
        setLog(prev => prev + '\n\nServer ready! Opening browser...');
        setResult({ script: 'record-glr', ok: true });
        showToast('Recording — play the game to capture GLR', 'success');
        window.api.openGameWindow('http://127.0.0.1:8080');
      } else {
        setLog(prev => prev + '\n\nTimeout — server did not respond. Check VPN connection.');
        setResult({ script: 'record-glr', ok: false });
        showToast('Server timeout — VPN connected?', 'error');
      }
    } catch (e) {
      setLog('Error: ' + e.message);
      setResult({ script: 'record-glr', ok: false });
      showToast('Record error', 'error');
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

  const autoGenerateOrphanCommands = async (proj) => {
    const sj = proj?.soundsJson;
    if (!sj?.soundDefinitions?.soundSprites) return 0;
    const sprites = sj.soundDefinitions.soundSprites;
    const commands = sj.soundDefinitions.commands || {};
    // Find all spriteIds referenced by any command
    const referenced = new Set();
    for (const actions of Object.values(commands)) {
      for (const a of actions) { if (a.spriteId) referenced.add(a.spriteId); }
    }
    const orphans = Object.keys(sprites).filter(id => !referenced.has(id));
    if (orphans.length === 0) return 0;
    const j = structuredClone(sj);
    if (!j.soundDefinitions.commands) j.soundDefinitions.commands = {};
    for (const spriteId of orphans) {
      const n = spriteId.replace(/^s_/, '');
      const hookName = `on${n}`;
      const action = /Loop$/i.test(spriteId)
        ? { command: 'Play', spriteId, volume: 1, loop: -1 }
        : { command: 'Play', spriteId, volume: 1 };
      if (j.soundDefinitions.commands[hookName]) {
        // Command exists — append action only if this spriteId isn't already referenced
        const existing = j.soundDefinitions.commands[hookName];
        if (!existing.some(a => a.spriteId === spriteId)) {
          existing.push(action);
        }
      } else {
        j.soundDefinitions.commands[hookName] = [action];
      }
    }
    const r = await window.api.saveSoundsJson(j);
    if (!r?.success) return 0; // save failed — don't claim orphans were fixed
    const updated = structuredClone(proj);
    updated.soundsJson = j;
    setProject(updated);
    return orphans.length;
  };

  const fullPipeline = async () => {
    setRunning('pipeline'); setLog(''); setResult(null);
    const step = (label) => setLog(prev => prev + `\n━━ ${label} ━━\n`);
    try {
      // Step 1: Pull
      step('Step 1/5 — Pull sounds.json');
      const pull = await window.api.pullGameJson();
      if (!pull?.success) {
        setLog(prev => prev + `✖ ${pull?.error || 'Failed'}`);
        setResult({ script: 'pipeline', ok: false }); showToast('Pipeline failed at Pull', 'error'); setRunning(null); return;
      }
      if (pull.project) setProject(pull.project);
      setLog(prev => prev + `✔ Copied from: ${pull.source}\n`);

      // Step 1.5: Auto-generate commands for orphan sprites
      step('Step 2/5 — Fix orphan sprites');
      const latestProject = pull.project || project;
      const orphanCount = await autoGenerateOrphanCommands(latestProject);
      if (orphanCount > 0) {
        setLog(prev => prev + `✔ Generated ${orphanCount} command(s) for unmapped sprites\n`);
      } else {
        setLog(prev => prev + `✔ No orphans — all sprites have commands\n`);
      }

      // Step 3: Build — auto-detect script based on project config
      // If sprite-config.json has sounds assigned to tiers → use tiered build
      // Otherwise fallback to size-based or single sprite build
      const spriteConfig = project?.spriteConfig;
      const hasTieredSounds = spriteConfig?.sprites && Object.values(spriteConfig.sprites).some(t => t.sounds?.length > 0);
      const buildScript = hasTieredSounds && scripts['build'] ? 'build'
        : scripts['build-audioSprites-size'] ? 'build-audioSprites-size'
        : scripts['build-multi-audioSprites'] ? 'build-multi-audioSprites'
        : scripts['build-audioSprite'] ? 'build-audioSprite'
        : scripts['build'] ? 'build'
        : null;
      if (!buildScript) {
        setLog(prev => prev + '✖ No build script found in package.json');
        setResult({ script: 'pipeline', ok: false }); showToast('No build script', 'error'); setRunning(null); return;
      }
      step(`Step 3/5 — Build (${buildScript})`);
      const build = await window.api.runScript(buildScript);
      if (!build?.success) {
        setLog(prev => prev + '\n✖ Build failed');
        setResult({ script: 'pipeline', ok: false }); showToast('Pipeline failed at Build', 'error'); setRunning(null); return;
      }
      setLog(prev => prev + '\n✔ Build complete\n');

      // Step 4: Validate
      step('Step 4/5 — Validate');
      const validate = await window.api.runScript('build-validate');
      if (!validate?.success) {
        setLog(prev => prev + '\n⚠ Validation has errors — check log above');
      } else {
        setLog(prev => prev + '\n✔ Validation passed\n');
      }

      // Step 5: Deploy
      const refreshed = await window.api.reloadProject();
      if (refreshed && setProject) setProject(refreshed);
      const canDeploy = deployScripts.includes('deploy') && refreshed?.gameRepoExists && refreshed?.distInfo?.hasDist;
      if (canDeploy) {
        step('Step 5/5 — Deploy');
        const dr = await window.api.runDeploy('deploy');
        setLog(prev => prev + (dr?.success ? '\n✔ Deployed\n' : '\n✖ Deploy failed\n'));
        setResult({ script: 'pipeline', ok: dr?.success ?? false });
        showToast(dr?.success ? 'Full Pipeline complete' : 'Pipeline: deploy failed', dr?.success ? 'success' : 'error');
      } else {
        setResult({ script: 'pipeline', ok: !validate?.success ? false : true });
        showToast(canDeploy === false && !deployScripts.includes('deploy') ? 'Pipeline done (no deploy script)' : 'Pipeline done', validate?.success ? 'success' : 'error');
      }
    } catch (e) {
      setLog(prev => prev + '\nError: ' + e.message);
      setResult({ script: 'pipeline', ok: false }); showToast('Pipeline error', 'error');
    }
    setRunning(null);
  };

  const pullAndBuild = fullPipeline;

  const runScript = async (scriptName) => {
    setRunning(scriptName); setLog(''); setResult(null);
    try {
      // Auto-fix orphan sprites before any build/validate to ensure 0 warnings
      if (scriptName.startsWith('build')) {
        const orphanCount = await autoGenerateOrphanCommands(project);
        if (orphanCount > 0) setLog(prev => prev + `✔ Auto-fixed ${orphanCount} orphan sprite(s)\n\n`);
      }
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
          showToast(`${scriptName} passed — deploying...`, 'success');
          setLog(prev => prev + '\n\n── Auto-deploying ──\n');
          setRunning('deploy');
          try {
            const dr = await window.api.runDeploy('deploy');
            if (dr?.error) setLog(prev => prev + dr.error);
            setResult({ script: 'deploy', ok: dr?.success ?? false });
            showToast(dr?.success ? 'Build + Deploy complete' : 'Deploy failed', dr?.success ? 'success' : 'error');
          } catch (de) {
            setLog(prev => prev + '\nDeploy error: ' + de.message);
            setResult({ script: 'deploy', ok: false });
            showToast('Deploy error', 'error');
          }
        } else {
          setResult({ script: scriptName, ok: true });
          showToast(`${scriptName} passed`, 'success');
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
      showToast(r?.success ? 'Deploy complete' : 'Deploy failed', r?.success ? 'success' : 'error');
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
      <div className="shrink-0 py-1">
        <h2 className="text-xl font-bold text-text-primary">Build & Deploy</h2>
      </div>

      {/* 2-column grid - takes all remaining space */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-3">

        {/* LEFT column */}
        <div className="flex flex-col gap-2 min-h-0 overflow-y-auto pr-1">

          {/* BUILD SCRIPTS */}
          <div className="card p-3 space-y-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="badge bg-cyan-dim text-cyan text-xs" title="npm scripts defined in package.json for building audio sprites">Build Scripts</span>
              {result && (result.script === 'pipeline' || buildScripts.includes(result.script)) && (
                <span className={`badge ${result.ok ? 'bg-green-dim text-green' : 'bg-danger-dim text-danger'}`}>
                  {result.ok ? 'PASSED' : 'FAILED'}
                </span>
              )}
              <div className="ml-auto flex items-center gap-1.5">
                {deployTarget && (
                  <button
                    onClick={fullPipeline}
                    disabled={running !== null}
                    title="Pull sounds.json → fix orphans → build → validate → deploy (all in one)"
                    className={running === 'pipeline' ? 'btn-ghost text-green border-green/30 cursor-wait text-xs py-1 px-3' : 'btn-primary text-xs py-1 px-3 disabled:opacity-40 disabled:cursor-not-allowed'}
                  >
                    {running === 'pipeline' && <span className="inline-block w-2 h-2 rounded-full bg-green mr-1.5 anim-pulse-dot" />}
                    {running === 'pipeline' ? 'Running...' : 'Full Pipeline'}
                  </button>
                )}
                <button
                  onClick={handleCleanDist}
                  disabled={cleaning || running !== null}
                  className="btn-ghost text-xs py-1 px-3 disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Delete all .m4a files and sounds.json from dist/ folder"
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
                      title={`Execute this build script (npm run ${name})`}
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
                <span className="badge bg-cyan-dim text-cyan text-xs" title="Status of the last audio build — sprite count, total size, and sounds.json presence">Last Build</span>
                {distInfo.hasDist
                  ? <span className="badge bg-green-dim text-green text-xs">{distInfo.spriteCount} sprites · {distInfo.totalSizeMB} MB</span>
                  : <span className="badge bg-orange-dim text-orange text-xs">Not built yet</span>
                }
                {distInfo.hasSoundsJson && <span className="badge bg-green-dim text-green text-xs">sounds.json ✓</span>}
              </div>
              {distInfo.sprites.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {distInfo.sprites.map(s => (
                    <span key={s} className="text-xs font-mono text-text-dim bg-bg-hover px-1.5 py-0.5 rounded">{s}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* DEPLOY */}
          <div className="card p-3 space-y-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="badge bg-green-dim text-green text-xs" title="Copy built M4A sprites and sounds.json to game repo's assets/sounds/ folder">Deploy</span>
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
                  <p className="text-xs text-text-secondary font-mono truncate">{deployTarget}</p>
                </div>
                <p className="text-xs text-text-dim pl-3.5">→ assets/default/default/default/sounds/</p>
                {!deployTargetExists && (
                  <p className="text-xs text-orange pl-3.5">Game repo folder not found — check the path in Setup</p>
                )}
                {!distInfo?.hasDist && (
                  <p className="text-xs text-orange pl-3.5">Run build first before deploying</p>
                )}
                {distInfo?.hasDist && !distInfo?.hasSoundsJson && (
                  <p className="text-xs text-orange pl-3.5">dist/sounds.json missing — re-run build</p>
                )}
              </div>
            ) : (
              <p className="text-xs text-danger">Game repo not configured — go to Setup → Game Repository</p>
            )}

            {deployScripts.length > 0 ? (
              <button
                onClick={() => runDeploy('deploy')}
                disabled={running !== null || !deployTarget || !deployTargetExists || !distInfo?.hasDist || !distInfo?.hasSoundsJson}
                title="Copy built audio sprites and sounds.json to game repo assets/sounds/ folder"
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
              <span className="badge bg-purple-dim text-purple text-xs" title="Additional npm scripts found in package.json that are not build or deploy scripts">Other Scripts</span>
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
                      title={`Execute this script (npm run ${name})`}
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
                <span className="badge bg-purple-dim text-purple text-xs" title="Start game dev server using playa CLI scripts from game repo">Launch Game</span>
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
                    className="btn-ghost text-danger border-danger/30 text-xs py-1 px-2"
                    title="Stop the running game server process and free port 8080"
                  >
                    Kill
                  </button>
                )}
                <button
                  onClick={loadGameScripts}
                  disabled={loadingGameScripts || running !== null}
                  className="text-xs text-text-dim hover:text-text-secondary transition-colors cursor-pointer disabled:opacity-40"
                  title="Reload available launch scripts from game repo package.json"
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
                Game repo missing node_modules — run <span className="font-mono">yarn install</span> in Setup → Game Repository before launching
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
                      title="Start game dev server with this script (requires VPN for remote servers)"
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
                <span className="badge bg-orange-dim text-orange text-xs" title="Launch the game locally using pre-recorded GLR sessions — no VPN or server required">Local Audio Test</span>
                <span className="badge bg-green-dim text-green text-xs">No VPN</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={recordGlr}
                  disabled={running !== null || !deployTarget || gameNodeModulesMissing}
                  className="btn-ghost text-xs py-1.5 flex items-center gap-1.5 border-cyan/30 text-cyan hover:border-cyan/60 disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Record new GLR session (requires VPN)"
                >
                  {running === 'record-glr' ? (
                    <span className="anim-pulse-dot w-2 h-2 rounded-full bg-cyan shrink-0" />
                  ) : (
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <circle cx="10" cy="10" r="6" />
                    </svg>
                  )}
                  {running === 'record-glr' ? 'Recording...' : 'Record GLR'}
                </button>
                <button
                  onClick={loadGlrList}
                  disabled={glrLoading || running !== null}
                  className="text-xs text-text-dim hover:text-text-secondary transition-colors cursor-pointer disabled:opacity-40"
                  title="Reload list of GLR recordings from game/GLR/ folder"
                >
                  {glrLoading ? 'Loading...' : 'Refresh'}
                </button>
              </div>
            </div>

            <p className="text-xs text-text-dim">
              Runs the game locally using a recorded GLR session — no server, no VPN required. Build and deploy audio first, then launch.
            </p>

            {!deployTarget ? (
              <p className="text-xs text-text-dim">Link a game repo in Setup first</p>
            ) : gameNodeModulesMissing ? (
              <p className="text-xs text-orange">Game repo missing node_modules — run yarn install in Setup → Game Repository</p>
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
                      title={`Launch game locally using GLR "${name}" — no VPN required`}
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
            <span className="section-label" title="Live output from the running script — streams stdout and stderr">Output</span>
            {running && (
              <span className="flex items-center gap-1.5 text-xs text-cyan">
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
