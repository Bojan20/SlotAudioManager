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
  const [gameStarted, setGameStarted] = useState(false); // stays true after timeout — keeps Kill visible
  const [gameGit, setGameGit] = useState(null); // { branch, files, hasDevelop, releaseBranches }
  const [gameGitLoading, setGameGitLoading] = useState(false);
  const [gameGitBranchName, setGameGitBranchName] = useState('');
  const [gameGitCommitMsg, setGameGitCommitMsg] = useState('');
  const [gameGitTarget, setGameGitTarget] = useState('');
  const [gameGitPushing, setGameGitPushing] = useState(false);
  const [gameGitPrUrl, setGameGitPrUrl] = useState('');
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
    // Find all spriteIds referenced by any command (direct or via sprite list)
    const lists = sj.soundDefinitions.spriteList || {};
    const referenced = new Set();
    for (const actions of Object.values(commands)) {
      for (const a of actions) {
        if (a.spriteId) referenced.add(a.spriteId);
        if (a.spriteListId && lists[a.spriteListId]) {
          const list = lists[a.spriteListId];
          const items = Array.isArray(list) ? list : (list?.items || []);
          for (const item of items) { if (item) referenced.add(item); }
        }
      }
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
      const spriteConfig = latestProject?.spriteConfig;
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
  const gameName = deployTarget ? deployTarget.split(/[/\\]/).pop() : '';

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
          <div className="card p-2.5 space-y-2">
            {/* Header row */}
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
              <div className="ml-auto flex items-center gap-1.5">
                {deployTarget && (
                  <button
                    onClick={fullPipeline}
                    disabled={running !== null}
                    title="Pull → fix orphans → build → validate → deploy"
                    className={running === 'pipeline' ? 'btn-ghost text-green border-green/30 cursor-wait text-xs py-1 px-2.5' : 'btn-primary text-xs py-1 px-2.5 disabled:opacity-40 disabled:cursor-not-allowed'}
                  >
                    {running === 'pipeline' && <span className="inline-block w-1.5 h-1.5 rounded-full bg-green mr-1.5 anim-pulse-dot" />}
                    {running === 'pipeline' ? 'Running...' : 'Full Pipeline'}
                  </button>
                )}
                <button
                  onClick={handleCleanDist}
                  disabled={cleaning || running !== null}
                  className="btn-ghost text-xs py-1 px-2.5 disabled:opacity-40"
                  title="Remove .m4a + sounds.json from dist/"
                >
                  {cleaning ? '...' : 'Clean'}
                </button>
              </div>
            </div>

            {/* Build script buttons — inline flex */}
            {buildScripts.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {buildScripts.map(name => (
                  <button
                    key={name}
                    onClick={() => runScript(name)}
                    disabled={running !== null}
                    className={running === name ? 'btn-ghost text-cyan border-cyan/30 cursor-wait text-xs py-1 px-2.5' : running ? 'btn-ghost text-xs py-1 px-2.5 opacity-40' : 'btn-ghost text-xs py-1 px-2.5'}
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

            {/* Dist sprite tags */}
            {distInfo?.sprites?.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {distInfo.sprites.map(s => (
                  <span key={s} className="text-xs font-mono text-text-dim bg-bg-hover px-1.5 py-0.5 rounded">{s}</span>
                ))}
              </div>
            )}

            {/* Deploy — compact single line */}
            {deployTarget ? (
              <div className="flex items-center gap-2 pt-1.5 border-t border-border/30">
                <span className="section-label shrink-0">Deploy</span>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${deployTargetExists ? 'bg-green' : 'bg-orange'}`} />
                <p className="text-xs font-mono text-text-dim truncate flex-1" title={`${deployTarget} → assets/default/default/default/sounds/`}>{gameName}</p>
                {!deployTargetExists ? (
                  <span className="text-xs text-orange shrink-0">Not found</span>
                ) : !distInfo?.hasDist ? (
                  <span className="text-xs text-text-dim shrink-0">Build first</span>
                ) : !distInfo?.hasSoundsJson ? (
                  <span className="text-xs text-orange shrink-0">Missing sounds.json</span>
                ) : deployScripts.length > 0 ? (
                  <button
                    onClick={() => runDeploy('deploy')}
                    disabled={running !== null}
                    className={running === 'deploy' ? 'btn-ghost text-green border-green/30 cursor-wait text-xs py-1 px-2.5' : 'btn-ghost text-xs py-1 px-2.5 disabled:opacity-40'}
                    title="Copy built audio to game repo"
                  >
                    {running === 'deploy' && <span className="inline-block w-1.5 h-1.5 rounded-full bg-green mr-1.5 anim-pulse-dot" />}
                    {running === 'deploy' ? 'Deploying...' : 'Deploy'}
                  </button>
                ) : (
                  <span className="text-xs text-text-dim shrink-0">No deploy script</span>
                )}
              </div>
            ) : (
              <p className="text-xs text-text-dim pt-1.5 border-t border-border/30">Link a game repo in Setup to deploy</p>
            )}

            {/* Other scripts — inline buttons */}
            {otherScripts.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-border/30">
                <span className="section-label shrink-0">Other</span>
                {otherScripts.map(name => (
                  <button
                    key={name}
                    onClick={() => runScript(name)}
                    disabled={running !== null}
                    className={running === name ? 'btn-ghost text-purple border-purple/30 cursor-wait text-xs py-1 px-2.5' : running ? 'btn-ghost text-xs py-1 px-2.5 opacity-40' : 'btn-ghost text-xs py-1 px-2.5'}
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

          {/* LAUNCH + GLR — merged card */}
          <div className="card p-2.5 space-y-2">
            {/* Header */}
            <div className="flex items-center gap-2">
              <span className="badge bg-purple-dim text-purple text-xs">Game</span>
              {gameRepoPath && (
                <p className="text-xs font-mono text-text-dim truncate flex-1" title={gameRepoPath}>{gameRepoPath.split(/[/\\]/).pop()}</p>
              )}
              <div className="ml-auto flex items-center gap-1.5">
                {(running?.startsWith('game:') || gameStarted) && (
                  <button
                    onClick={() => { window.api.killGame(); setRunning(null); setGameStarted(false); showToast('Process killed', 'success'); }}
                    className="btn-ghost text-danger border-danger/30 text-xs py-0.5 px-2"
                    title="Kill running game process and free port 8080"
                  >
                    Kill
                  </button>
                )}
                <button
                  onClick={loadGameScripts}
                  disabled={loadingGameScripts || running !== null}
                  className="text-xs text-text-dim hover:text-text-secondary disabled:opacity-40"
                  title="Reload launch scripts"
                >
                  {loadingGameScripts ? '...' : 'Refresh'}
                </button>
              </div>
            </div>

            {gameScriptsError && <p className="text-xs text-danger font-mono">{gameScriptsError}</p>}
            {gameNodeModulesMissing && (
              <p className="text-xs text-orange">Missing node_modules — run yarn install in Setup</p>
            )}

            {/* VPN launch scripts */}
            {!deployTarget ? (
              <p className="text-xs text-text-dim">Link a game repo in Setup first</p>
            ) : gameScripts.length > 0 ? (
              <div className="space-y-0.5">
                {gameScripts.map(({ name, cmd }) => (
                  <div key={name} className="flex items-center gap-2 py-1 border-b border-border/20 last:border-0">
                    <p className="flex-1 text-xs font-mono font-semibold text-text-primary truncate" title={cmd}>{name}</p>
                    <button
                      onClick={() => runGameScript(name)}
                      disabled={running !== null}
                      className={running === 'game:' + name ? 'btn-ghost text-purple border-purple/30 cursor-wait text-xs py-0.5 px-2' : running ? 'btn-ghost text-xs py-0.5 px-2 opacity-40' : 'btn-ghost text-xs py-0.5 px-2'}
                      title={cmd}
                    >
                      {running === 'game:' + name && <span className="inline-block w-1.5 h-1.5 rounded-full bg-purple mr-1 anim-pulse-dot" />}
                      {running === 'game:' + name ? 'Launching...' : 'Launch'}
                    </button>
                  </div>
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
            <div className="card p-2.5 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="badge bg-accent-dim text-accent text-xs">Game Git</span>
                {gameGit && <span className="text-xs font-mono text-purple">{gameGit.branch}</span>}
                {gameGit && gameGit.files.length > 0 && <span className="badge bg-orange-dim text-orange text-xs">{gameGit.files.length}</span>}
                <button onClick={loadGameGitStatus} disabled={gameGitLoading}
                  className="ml-auto text-xs text-text-dim hover:text-text-secondary disabled:opacity-40">
                  {gameGitLoading ? '...' : 'Refresh'}
                </button>
              </div>

              {!gameGit ? (
                <p className="text-xs text-text-dim">Click Refresh to load status</p>
              ) : gameGit.files.length === 0 ? (
                <p className="text-xs text-green">No changes — deploy first</p>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex gap-2 items-center">
                    <label className="text-xs text-text-dim shrink-0">Target:</label>
                    <select value={gameGitTarget} onChange={e => {
                      setGameGitTarget(e.target.value);
                      const audioName = project?.path?.split(/[/\\]/).pop()?.replace('-audio', '') || 'audio';
                      const prefix = e.target.value.startsWith('release') ? 'bugfix/PA-' : 'feature/PA-';
                      setGameGitBranchName(`${prefix}${audioName}-audio-update`);
                    }} className="input-base text-xs font-mono flex-1 py-0.5">
                      {gameGit.hasDevelop && <option value="develop">develop</option>}
                      {gameGit.releaseBranches.map(b => <option key={b} value={b}>{b}</option>)}
                      {gameGit.branch !== 'develop' && !gameGit.releaseBranches.includes(gameGit.branch) && (
                        <option value={gameGit.branch}>{gameGit.branch} (current)</option>
                      )}
                    </select>
                  </div>
                  <div className="flex gap-2 items-center">
                    <label className="text-xs text-text-dim shrink-0">Branch:</label>
                    <input type="text" value={gameGitBranchName} onChange={e => setGameGitBranchName(e.target.value)}
                      placeholder="feature/PA-audio-update" className="input-base text-xs font-mono flex-1 py-0.5" maxLength={100} />
                  </div>
                  <div className="flex gap-2 items-center">
                    <label className="text-xs text-text-dim shrink-0">Msg:</label>
                    <input type="text" value={gameGitCommitMsg} onChange={e => setGameGitCommitMsg(e.target.value)}
                      placeholder="Update audio sprites" className="input-base text-xs flex-1 py-0.5"
                      onKeyDown={e => e.key === 'Enter' && handleGameGitPush()} />
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={handleGameGitPush}
                      disabled={gameGitPushing || !gameGitBranchName.trim() || !gameGitCommitMsg.trim()}
                      className="btn-primary text-xs py-1 px-3 disabled:opacity-40"
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
              onClick={() => { setLog(''); setResult(null); }}
              disabled={running !== null}
              className="ml-auto text-xs text-text-dim hover:text-text-secondary disabled:opacity-40"
            >Clear</button>
          </div>
          <pre
            ref={logRef}
            className="p-2 rounded-lg bg-bg-input border border-border text-xs font-mono text-text-primary overflow-auto max-h-32 whitespace-pre-wrap leading-relaxed"
          >{log || ' '}</pre>
        </div>
      )}
    </div>
  );
}
