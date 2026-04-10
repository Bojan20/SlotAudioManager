import React, { useState, useRef, useEffect, useMemo } from 'react';

export default function BuildPage({ project, setProject, showToast }) {
  const [running, setRunning] = useState(null);
  const [log, setLog] = useState('');
  const [result, setResult] = useState(null); // { script, ok }
  const [gameScripts, setGameScripts] = useState([]);
  const [gameRepoPath, setGameRepoPath] = useState('');
  const [loadingGameScripts, setLoadingGameScripts] = useState(false);
  const [gameScriptsError, setGameScriptsError] = useState('');
  const [deploying, setDeploying] = useState(false);
  const [gameStarted, setGameStarted] = useState(false); // stays true after timeout — keeps Kill visible
  const [gameGit, setGameGit] = useState(null); // { branch, files, hasDevelop, releaseBranches }
  const [gameGitLoading, setGameGitLoading] = useState(false);
  const [gameGitBranchName, setGameGitBranchName] = useState('');
  const [gameGitCommitMsg, setGameGitCommitMsg] = useState('');
  const [gameGitTarget, setGameGitTarget] = useState('');
  const [gameGitPushing, setGameGitPushing] = useState(false);
  const [gameGitPrUrl, setGameGitPrUrl] = useState('');
  const [buildVersion, setBuildVersion] = useState(null); // { version, sha } or null
  const [buildChecking, setBuildChecking] = useState(false);
  const [vpnConnected, setVpnConnected] = useState(false);
  const [vpnBusy, setVpnBusy] = useState(false);
  const [abFiles, setAbFiles] = useState([]); // encoder A/B test files
  const [abPlaying, setAbPlaying] = useState(null); // 'native_Name' or 'fdk_Name'
  const logRef = useRef(null);
  const abortRef = useRef(false);
  // Cleanup A/B audio on unmount
  useEffect(() => () => { try { const s = abSourceRef.current; if (s) { s.onended = null; s.onerror = null; s.pause(); s.src = ''; } } catch {} }, []);
  const abSourceRef = useRef(null);
  const abIdRef = useRef(0);
  const buildVersionTimerRef = useRef(null);

  // Auto-scroll log to bottom as lines stream in
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);

  // Subscribe to live script output — mount once, unmount cleanup
  useEffect(() => {
    const handler = (_, line) => {
      // Filter noisy non-fatal warnings from yarn/playa/webpack
      if (/NODE_TLS_REJECT_UNAUTHORIZED/.test(line)) return;
      if (/ENOTFOUND.*wagerworks|ENOTFOUND.*igt\.com/.test(line)) return;
      if (/warning.*incorrect peer dependency|warning.*unmet peer dependency/.test(line)) return;
      if (/warning.*Invalid bin field/.test(line)) return;
      if (/warning.*Workspaces can only be enabled/.test(line)) return;
      if (/info There appears to be trouble with your network/.test(line)) return;
      if (/ERR_INVALID_IP_ADDRESS/.test(line)) return;
      if (/^\s*\(node:\d+\) Warning:/.test(line)) return;
      if (/Use `node --trace-warnings/.test(line)) return;
      setLog(prev => prev + line);
    };
    window.api.onScriptOutput(handler);
    return () => window.api.offScriptOutput(handler);
  }, []);

  // Reset on project change — clear everything
  useEffect(() => {
    setLog(''); setResult(null); setRunning(null); setGameStarted(false);
    setGameScripts([]); setGameRepoPath(''); setGameScriptsError(''); setDeploying(false);
    setGameGit(null); setGameGitBranchName(''); setGameGitCommitMsg(''); setGameGitPrUrl(''); setBuildVersion(null); setBuildChecking(false);
    if (buildVersionTimerRef.current) { clearTimeout(buildVersionTimerRef.current); buildVersionTimerRef.current = null; }
    setAbFiles([]); setAbPlaying(null); stopAbAudio();
    if (project) { loadGameScripts(); }
  }, [project?.path]);

  // Refresh on reload — preserve gameGit state
  useEffect(() => {
    if (!project?._reloadKey) return;
    setResult(null);
    if (buildVersionTimerRef.current) { clearTimeout(buildVersionTimerRef.current); buildVersionTimerRef.current = null; }
    if (project) { loadGameScripts(); }
  }, [project?._reloadKey]);

  // VPN status polling — always active, check every 30s
  useEffect(() => {
    const checkVpn = () => window.api.vpnStatus().then(r => setVpnConnected(!!r?.connected)).catch(() => {});
    checkVpn();
    const interval = setInterval(checkVpn, 30000);
    return () => clearInterval(interval);
  }, []);

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

  const checkBuildVersion = async (retries = 0) => {
    if (!gameGitTarget) return;
    if (retries > 0 && !buildVersionTimerRef.current) return; // stale — timer was cleared by project change
    setBuildChecking(true);
    try {
      const r = await window.api.getGameBuildVersion({ targetBranch: gameGitTarget });
      if (r?.success) {
        setBuildVersion({ version: r.version, sha: r.sha });
        showToast(`Build: ${r.version}`, 'success');
      } else if (r?.pending && retries < 5) {
        // Jenkins hasn't tagged yet — auto-retry in 15s (up to 5 times = ~75s)
        showToast(`Build not ready, checking again in 15s... (${retries + 1}/5)`, 'info');
        buildVersionTimerRef.current = setTimeout(() => checkBuildVersion(retries + 1), 15000);
        return; // don't clear buildChecking — still polling
      } else if (r?.pending) {
        showToast('Build version not found after 5 attempts — check Jenkins manually', 'error');
      } else if (r?.error) {
        showToast(r.error, 'error');
      }
    } catch (e) { showToast(e.message, 'error'); }
    setBuildChecking(false);
  };

  const loadGameScripts = async () => {
    setLoadingGameScripts(true);
    setGameScriptsError('');
    try {
      const r = await window.api.getGameScripts();
      if (r?.error) { setGameScriptsError(r.error); }
      else if (r?.scripts) {
          setGameScripts(r.scripts); setGameRepoPath(r.gameRepoPath || '');
        }
    } catch (e) { setGameScriptsError(e.message); }
    setLoadingGameScripts(false);
  };

  const scripts = project?.scripts || {};

  // Hidden scripts — not relevant for current workflow
  const hiddenScripts = new Set(['build', 'build-validate', 'generate-subloader-init', 'test']);

  // Script descriptions for hover tooltips
  const scriptDesc = {
    'build-optimized': 'Incremental sprite build — chunks by size, SHA-256 cache, SFX/Music split',
    'build-audioSprites-size': 'Legacy sprite build — chunks by size, no cache',
    'build-audio': 'Convert single audio file to M4A',
    'build-audioSprite': 'Build a single audio sprite from all sounds',
    'build-multi-audioSprites': 'Build multiple sprites (fixed count)',
    'deploy': 'Copy M4A sprites + sounds.json to game repo sounds/ folder',
    'deploy-streaming': 'Build streaming M4A for background music + generate BGMStreamingInit.ts',
    'compare-encoders': 'Compare native AAC vs FDK-AAC encoder quality and file sizes',
  };

  const buildScripts = useMemo(() => {
    const known = ['build-optimized', 'build-audioSprites-size', 'build-audio', 'build-audioSprite', 'build-multi-audioSprites', 'deploy-streaming'];
    return known.filter(s => scripts[s]);
  }, [scripts]);

  const deployScripts = useMemo(() => {
    const known = ['deploy'];
    return known.filter(s => scripts[s]);
  }, [scripts]);

  const toolScripts = useMemo(() => {
    const known = ['compare-encoders'];
    return known.filter(s => scripts[s]);
  }, [scripts]);

  const otherScripts = useMemo(() => {
    const allKnown = new Set([...Object.keys(scriptDesc), ...hiddenScripts]);
    return Object.keys(scripts).filter(s => !allKnown.has(s));
  }, [scripts]);

  // ── A/B encoder audio playback ──────────────────────────────────────────────
  const stopAbAudio = () => {
    abIdRef.current++;
    try {
      const src = abSourceRef.current;
      if (src) {
        src.onended = null;
        src.onerror = null;
        src.pause();
        src.src = '';
      }
    } catch {}
    abSourceRef.current = null;
    setAbPlaying(null);
  };

  const playAbAudio = async (filename) => {
    if (abPlaying === filename) { stopAbAudio(); return; }
    stopAbAudio();
    const playId = ++abIdRef.current;
    try {
      // Use HTML5 Audio element — decodeAudioData can crash renderer on some M4A formats
      const url = `audio://test/${encodeURIComponent(filename)}`;
      const audio = new Audio(url);
      audio.onended = () => { if (abIdRef.current === playId) stopAbAudio(); };
      audio.onerror = () => {
        if (abIdRef.current !== playId) return;
        showToast('Playback error: could not decode ' + filename, 'error');
        stopAbAudio();
      };
      abSourceRef.current = audio;
      setAbPlaying(filename);
      await audio.play();
    } catch (e) {
      if (abIdRef.current !== playId) return;
      showToast('Playback error: ' + e.message, 'error');
      stopAbAudio();
    }
  };

  const loadAbFiles = async () => {
    try {
      const r = await window.api.listEncoderTest();
      if (r?.files?.length > 0) setAbFiles(r.files);
      else showToast('No encoder test files found', 'error');
    } catch {}
  };

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
        // Selective refresh — only update distInfo and soundsJson, preserve all other state
        const refreshed = await window.api.reloadProject();
        if (stopped()) return;
        if (refreshed && setProject) {
          setProject(prev => {
            const next = structuredClone(prev);
            next.distInfo = refreshed.distInfo;
            next.soundsJson = refreshed.soundsJson;
            return next;
          });
        }
        setResult({ script: scriptName, ok: true });
        showToast(`${scriptName} complete`, 'success');
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

  const runDeployOnly = async () => {
    setDeploying(true); setLog('── Deploy ──\n'); setResult(null);
    try {
      const dr = await window.api.runDeploy('deploy');
      if (dr?.error) setLog(prev => prev + dr.error);
      if (dr?.success) {
        setLog(prev => prev + '✔ Deploy complete\n');
        setResult({ script: 'deploy', ok: true });
        showToast('Deploy complete', 'success');
      } else {
        setResult({ script: 'deploy', ok: false });
        showToast('Deploy failed', 'error');
      }
    } catch (e) {
      setLog(prev => prev + '\nError: ' + e.message);
      setResult({ script: 'deploy', ok: false });
      showToast('Deploy error', 'error');
    }
    setDeploying(false);
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
        if (build?.detectedNode) {
          showToast(`Game uses Node ${build.detectedNode} (auto-detected)`, 'success');
        }
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
        // Wait for server to fully stabilize — playa responds 200 on HTML shell
        // before game bundle is fully ready to serve all assets
        await new Promise(r => setTimeout(r, 4000));
        if (stopped()) return;
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

  const stepNum = (() => { let n = 1; return () => n++; })();

  return (
    <div className="anim-fade-up h-full flex flex-col" style={{ gap: '16px', padding: '8px 0' }}>
      {/* Header */}
      <div className="shrink-0" style={{ textAlign: 'center' }}>
        <h2 className="text-text-primary" style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '-0.02em' }}>Build & Deploy</h2>
        {result && !running && (
          <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${result.ok ? 'bg-green/10 text-green' : 'bg-danger/10 text-danger'}`} style={{ display: 'inline-block', marginTop: '6px' }}>
            {result.script}: {result.ok ? 'OK' : 'FAILED'}
          </span>
        )}
      </div>

      {/* 2-column — always side by side */}
      <div className="flex-1 min-h-0 grid grid-cols-2" style={{ gap: '16px' }}>

        {/* ═══ LEFT: Audio Pipeline ═══ */}
        <div className="flex flex-col min-h-0 min-w-0 overflow-y-auto">
          <div className="card overflow-hidden">
            {/* Panel header */}
            <div className="flex items-center gap-2.5 px-6 py-4 border-b border-border/40">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-cyan/10 text-cyan text-sm shrink-0">&#9835;</span>
              <span className="text-sm font-bold text-text-primary">Audio Pipeline</span>
              <span className="ml-auto flex items-center gap-2 text-xs font-mono text-text-secondary">
                {distInfo?.hasDist ? (<>
                  {distInfo.spriteCount} sprites <span className="text-text-dim">&middot;</span> {distInfo.totalSizeMB} MB
                  {distInfo.hasSoundsJson && <span className="text-[11px] font-semibold text-green bg-green/8 px-1.5 py-0.5 rounded">json ✓</span>}
                </>) : (
                  <span className="text-text-dim italic">Not built</span>
                )}
              </span>
            </div>
            {/* Panel body */}
            <div style={{ padding: '24px' }} className="space-y-4">

              {/* ── Build ── */}
              <div className="rounded-lg border border-white/[0.04] bg-white/[0.015] p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-cyan/12 text-cyan text-[10px] font-bold">{stepNum()}</span>
                  <span className="text-[10.5px] font-bold tracking-[0.14em] uppercase text-cyan/55">Build</span>
                </div>
                {buildScripts.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    {buildScripts.map(name => (
                      <button key={name} onClick={() => runScript(name)} disabled={running !== null || deploying}
                        className={`flex items-center gap-2 w-full text-[13px] font-medium rounded-lg border transition-all ${
                          running === name ? 'bg-white/[0.06] text-text-primary border-white/15 cursor-wait'
                          : (running || deploying) ? 'border-white/[0.06] text-text-dim opacity-40'
                          : 'border-white/[0.08] text-text-secondary hover:text-text-primary hover:border-white/20 hover:bg-white/[0.03]'
                        }`} style={{ padding: '10px 18px' }} title={scriptDesc[name] || scripts[name]}>
                        {running === name && <span className="w-1.5 h-1.5 rounded-full bg-cyan anim-pulse-dot shrink-0" />}
                        {running === name ? `${name}...` : name}
                      </button>
                    ))}
                  </div>
                ) : <p className="text-xs text-text-dim">No build scripts</p>}
                {distInfo?.sprites?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {distInfo.sprites.map(s => (
                      <span key={s} className="inline-flex items-center gap-2.5 text-[11px] font-mono bg-cyan/[0.05] border border-cyan/[0.08] px-2.5 py-1 rounded-md"><span className="text-cyan/60">{s}</span>{distInfo.spriteSizes?.[s] ? <span className="text-text-secondary font-semibold">{distInfo.spriteSizes[s] >= 1000 ? (distInfo.spriteSizes[s] / 1000).toFixed(3) + ' MB' : distInfo.spriteSizes[s] + ' KB'}</span> : ''}</span>
                    ))}
                  </div>
                )}
              </div>

              {/* Connector */}
              <div className="flex justify-center"><div className="w-px h-3 bg-white/[0.06]" /></div>

              {/* ── Tools ── */}
              {(toolScripts.length > 0 || otherScripts.length > 0) && (<>
                <div className="rounded-lg border border-purple/[0.06] bg-purple/[0.02] p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-purple/12 text-purple text-[10px] font-bold">{stepNum()}</span>
                    <span className="text-[10.5px] font-bold tracking-[0.14em] uppercase text-purple/55">Tools</span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {[...toolScripts, ...otherScripts].map(name => (
                      <button key={name} onClick={() => runScript(name)} disabled={running !== null || deploying}
                        className={`flex items-center justify-center gap-2 w-full text-[13px] font-medium rounded-lg border transition-all ${
                          running === name ? 'bg-purple/10 text-purple border-purple/25 cursor-wait'
                          : (running || deploying) ? 'border-border/40 text-text-dim opacity-40'
                          : 'border-purple/15 text-purple/75 hover:text-purple hover:border-purple/30 hover:bg-purple/[0.04]'
                        }`} style={{ padding: '10px 20px' }} title={scriptDesc[name] || scripts[name]}>
                        {running === name && <span className="w-1.5 h-1.5 rounded-full bg-purple anim-pulse-dot" />}
                        {running === name ? `${name}...` : name}
                      </button>
                    ))}
                    {result?.script === 'compare-encoders' && result?.ok && !running && (<>
                      <button onClick={loadAbFiles} style={{ padding: '10px 20px' }} className="inline-flex items-center text-[13px] font-medium rounded-lg border border-green/15 text-green/75 hover:text-green hover:border-green/30 hover:bg-green/[0.04] transition-all" title="Load A/B results">A/B Compare</button>
                      <button onClick={async () => { const r = await window.api.openFolder('dist/encoder-test'); if (r?.error) showToast(r.error, 'error'); }} style={{ padding: '10px 20px' }} className="inline-flex items-center text-[13px] font-medium rounded-lg border border-white/[0.08] text-text-dim hover:text-text-secondary hover:border-white/15 transition-all" title="Open folder">Open Folder</button>
                    </>)}
                  </div>
                  {/* A/B modal rendered at page level */}
                </div>
                <div className="flex justify-center"><div className="w-px h-3 bg-white/[0.06]" /></div>
              </>)}

              {/* ── Deploy ── */}
              {deployTarget && (
                <div className="rounded-lg border border-green/[0.06] bg-green/[0.02] p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green/12 text-green text-[10px] font-bold">{stepNum()}</span>
                    <span className="text-[10.5px] font-bold tracking-[0.14em] uppercase text-green/55">Deploy</span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {deployScripts.map(name => (
                      <button key={name}
                        onClick={() => name === 'deploy' ? runDeployOnly() : runScript(name)}
                        disabled={running !== null || deploying || (name === 'deploy' && (!distInfo?.hasDist || !distInfo?.hasSoundsJson))}
                        className={`flex items-center justify-center gap-2 w-full text-[13px] rounded-lg border transition-all ${
                          (deploying && name === 'deploy') || running === name
                            ? 'font-semibold bg-green/15 text-green border-green/25 cursor-wait'
                            : (running || deploying) ? 'font-medium border-border/40 text-text-dim opacity-40'
                            : name === 'deploy'
                            ? 'font-semibold bg-green/8 text-green border-green/20 hover:bg-green/15 hover:border-green/35 shadow-sm hover:shadow-green/8'
                            : 'font-medium border-green/15 text-green/75 hover:text-green hover:border-green/30 hover:bg-green/[0.04]'
                        }`} style={{ padding: name === 'deploy' ? '12px 28px' : '10px 20px' }}
                        title={scriptDesc[name] || scripts[name]}>
                        {((deploying && name === 'deploy') || running === name) && <span className="w-1.5 h-1.5 rounded-full bg-green anim-pulse-dot" />}
                        {(deploying && name === 'deploy') ? 'Deploying...' : running === name ? `${name}...` : name === 'deploy' ? 'Deploy to Game' : name}
                        {name === 'deploy' && result?.script === 'deploy' && result?.ok && !running && !deploying && <span className="text-green ml-1">✓</span>}
                      </button>
                    ))}
                    {!distInfo?.hasDist && <span className="text-[11px] text-text-dim italic">Build first</span>}
                    {distInfo?.hasDist && !distInfo?.hasSoundsJson && <span className="text-[11px] text-orange italic">sounds.json missing</span>}
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>

        {/* ═══ RIGHT: Game ═══ */}
        <div className="flex flex-col min-h-0 min-w-0 overflow-y-auto" style={{ gap: '16px' }}>

          {/* LAUNCH */}
          <div className="card overflow-hidden">
            <div className="flex items-center gap-2.5 px-6 py-4 border-b border-border/40">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-purple/10 text-purple text-sm shrink-0">&#9654;</span>
              <span className="text-sm font-bold text-text-primary">Game</span>
              {gameRepoPath && <span className="text-xs font-mono text-text-dim truncate" title={gameRepoPath}>{gameRepoPath.split(/[/\\]/).pop()}</span>}
              {project?.gameNodeVersion && <span className="text-[10px] font-semibold text-green bg-green/8 px-1.5 py-0.5 rounded">Node {project.gameNodeVersion}</span>}
              <div className="ml-auto flex items-center gap-1.5">
                <button onClick={async () => { setVpnBusy(true); try { const r = vpnConnected ? await window.api.vpnDisconnect() : await window.api.vpnConnect(); if (r?.error) showToast(r.error,'error'); else { setVpnConnected(!vpnConnected); showToast(vpnConnected?'VPN disconnected':'VPN connected','success'); } } catch(e){showToast(e.message,'error');} finally { const s = await window.api.vpnStatus(); setVpnConnected(!!s?.connected); setVpnBusy(false); } }}
                  disabled={vpnBusy} className={`text-[11px] font-medium py-1 px-2.5 rounded-md border transition-all flex items-center gap-1.5 disabled:opacity-40 ${vpnConnected ? 'bg-green/8 text-green border-green/25' : 'bg-danger/8 text-danger border-danger/25'}`} title={vpnConnected ? 'Disconnect VPN' : 'Connect VPN'}>
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${vpnBusy ? 'bg-orange anim-pulse-dot' : vpnConnected ? 'bg-green' : 'bg-danger'}`} /> VPN
                </button>
                <button onClick={() => { window.api.killGame(); setGameStarted(false); showToast('Port freed','success'); }} className="text-[11px] py-1 px-2.5 rounded-md border border-border text-text-dim hover:text-danger hover:border-danger/25 transition-colors" title="Kill server">Kill</button>
                <button onClick={async () => { const r = await window.api.clearGameStorage(); showToast(r?.message || 'Cleared', r?.error ? 'error' : 'success'); }} className="text-[11px] py-1 px-2.5 rounded-md border border-border text-text-dim hover:text-orange hover:border-orange/25 transition-colors" title="Clear Chrome localStorage + webpack cache (kills Chrome if needed)">Clear</button>
                <button onClick={loadGameScripts} disabled={loadingGameScripts||running!==null||deploying} className="text-[11px] py-1 px-2.5 rounded-md border border-border text-text-dim hover:text-text-secondary hover:border-border-bright transition-colors disabled:opacity-40">{loadingGameScripts ? '...' : 'Refresh'}</button>
              </div>
            </div>
            <div style={{ padding: '24px' }} className="space-y-4">
              {deployTarget && project?.gameRepoBranches?.length > 0 && (
                <div className="flex items-center gap-2.5">
                  <span className="text-[10px] font-bold tracking-[0.12em] uppercase text-text-dim">Branch</span>
                  <select value={project?.gameRepoBranch || ''} onChange={async (e) => { const branch = e.target.value; if (!branch || branch === project?.gameRepoBranch) return; setRunning('checkout'); setLog(''); try { const r = await window.api.checkoutGameBranch(branch); if (r?.success && r.project) { setProject(prev => { const next = structuredClone(prev); next.gameRepoBranch = r.project.gameRepoBranch; next.gameRepoBranches = r.project.gameRepoBranches; next.gameNodeVersion = r.project.gameNodeVersion; next.gameRepoExists = r.project.gameRepoExists; next.gameNodeModulesExists = r.project.gameNodeModulesExists; next.gameRepoAbsPath = r.project.gameRepoAbsPath; return next; }); loadGameScripts(); showToast(`Switched to ${r.branch}`,'success'); } else showToast(r?.error||'Checkout failed','error'); } catch(err){showToast('Checkout failed','error');} setRunning(null); }}
                    disabled={running !== null || deploying} className="input-base text-sm font-mono py-1 px-2 flex-1" title="Game branch">
                    {project.gameRepoBranch && !project.gameRepoBranches.includes(project.gameRepoBranch) && <option value={project.gameRepoBranch}>{project.gameRepoBranch} (local)</option>}
                    {project.gameRepoBranches.map(b => <option key={b} value={b}>{b}{b === project?.gameRepoBranch ? ' (current)' : ''}</option>)}
                  </select>
                </div>
              )}
              {gameScriptsError && <p className="text-xs text-danger font-mono">{gameScriptsError}</p>}
              {gameNodeModulesMissing && <p className="text-xs text-orange">Missing node_modules — run yarn install in Setup</p>}
              {!deployTarget ? <p className="text-xs text-text-dim">Link a game repo in Setup first</p>
              : gameScripts.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {gameScripts.map(({ name, cmd }) => {
                    const server = cmd.match(/--server\s+([\w-]+)/)?.[1] || null;
                    return (
                      <button key={name} onClick={() => runGameScript(name)} disabled={running !== null || deploying}
                        className={`flex items-baseline gap-2.5 w-full rounded-lg border transition-all ${
                          running === 'game:' + name ? 'bg-sky-400/8 text-sky-400 border-sky-400/20 cursor-wait'
                          : (running || deploying) ? 'border-border/30 text-text-dim opacity-40'
                          : 'border-sky-400/12 text-sky-400/85 hover:text-sky-400 hover:border-sky-400/30 hover:bg-sky-400/[0.04]'
                        }`} style={{ padding: '10px 18px' }} title={cmd}>
                        {running === 'game:' + name && <span className="w-1.5 h-1.5 rounded-full bg-sky-400 anim-pulse-dot shrink-0" />}
                        <span className="text-[13px] font-medium">{running === 'game:' + name ? 'Launching...' : name}</span>
                        {server && <span className="text-[11px] font-mono text-text-secondary">{server}</span>}
                      </button>
                    );
                  })}
                </div>
              ) : loadingGameScripts ? <p className="text-xs text-text-dim">Loading...</p>
              : <p className="text-xs text-text-dim">No launch scripts</p>}
            </div>
          </div>

          {/* GAME GIT */}
          {deployTarget && (
            <div className="card overflow-hidden">
              <div className="flex items-center gap-2.5 px-6 py-4 border-b border-border/40">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-orange/10 text-orange text-sm shrink-0">&#9733;</span>
                <span className="text-sm font-bold text-text-primary">Game Git</span>
                {gameGit && <span className="text-xs font-mono text-purple">{gameGit.branch}</span>}
                {gameGit && gameGit.files.length > 0 && <span className="text-[10px] font-semibold text-orange bg-orange/10 px-1.5 py-0.5 rounded">{gameGit.files.length}</span>}
                <button onClick={loadGameGitStatus} disabled={gameGitLoading} className="ml-auto text-[11px] py-1 px-2.5 rounded-md border border-border text-text-dim hover:text-text-secondary hover:border-border-bright transition-colors disabled:opacity-40">{gameGitLoading ? '...' : 'Refresh'}</button>
              </div>
              <div style={{ padding: '24px' }}>
                {!gameGit ? <p className="text-sm text-text-dim">Click Refresh to load status</p>
                : gameGit.files.length === 0 ? <p className="text-sm text-green">No changes — deploy first</p>
                : (
                  <div className="space-y-2.5">
                    <div className="flex gap-3 items-center">
                      <label className="text-xs text-text-dim shrink-0 w-12">Target</label>
                      <select value={gameGitTarget} onChange={e => { setGameGitTarget(e.target.value); const audioName = project?.path?.split(/[/\\]/).pop()?.replace('-audio','') || 'audio'; const prefix = e.target.value.startsWith('release') ? 'bugfix/PA-' : 'feature/PA-'; setGameGitBranchName(`${prefix}${audioName}-audio-update`); }} className="input-base text-sm font-mono flex-1 py-1">
                        {gameGit.hasDevelop && <option value="develop">develop</option>}
                        {gameGit.releaseBranches.map(b => <option key={b} value={b}>{b}</option>)}
                        {gameGit.branch !== 'develop' && !gameGit.releaseBranches.includes(gameGit.branch) && <option value={gameGit.branch}>{gameGit.branch} (current)</option>}
                      </select>
                    </div>
                    <div className="flex gap-3 items-center">
                      <label className="text-xs text-text-dim shrink-0 w-12">Branch</label>
                      <input type="text" value={gameGitBranchName} onChange={e => setGameGitBranchName(e.target.value)} placeholder="feature/PA-audio-update" className="input-base text-sm font-mono flex-1 py-1" maxLength={100} />
                    </div>
                    <div className="flex gap-3 items-center">
                      <label className="text-xs text-text-dim shrink-0 w-12">Msg</label>
                      <input type="text" value={gameGitCommitMsg} onChange={e => setGameGitCommitMsg(e.target.value)} placeholder="Update audio sprites" className="input-base text-sm flex-1 py-1" onKeyDown={e => e.key === 'Enter' && handleGameGitPush()} />
                    </div>
                    <div className="flex items-center gap-3">
                      <button onClick={handleGameGitPush} disabled={gameGitPushing || !gameGitBranchName.trim() || !gameGitCommitMsg.trim()} className="btn-primary text-xs py-1.5 px-4 disabled:opacity-40">{gameGitPushing ? 'Pushing...' : 'Commit, Push & PR'}</button>
                      {gameGitPrUrl && <button onClick={() => window.api.openUrl(gameGitPrUrl)} className="text-xs text-accent hover:text-accent/80 font-mono truncate">{gameGitPrUrl}</button>}
                    </div>
                    {gameGitPrUrl && (
                      <div className="flex items-center gap-2 flex-wrap">
                        {buildVersion ? (
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-semibold text-green bg-green/8 px-1.5 py-0.5 rounded font-mono">{buildVersion.version}</span>
                            <span className="text-xs text-text-dim font-mono">{buildVersion.sha}</span>
                            <button onClick={() => { navigator.clipboard.writeText(buildVersion.version); showToast('Copied','success'); }} className="text-xs text-text-dim hover:text-accent transition-colors">Copy</button>
                          </div>
                        ) : (
                          <button onClick={() => checkBuildVersion(0)} disabled={buildChecking} className="text-[11px] py-1 px-2.5 rounded-md border border-border text-text-dim hover:text-text-secondary hover:border-border-bright transition-colors flex items-center gap-1.5 disabled:opacity-40">
                            {buildChecking ? <><span className="anim-pulse-dot">●</span> Checking...</> : 'Check Build Version'}
                          </button>
                        )}
                      </div>
                    )}
                    <details className="text-xs">
                      <summary className="text-text-dim cursor-pointer hover:text-text-secondary">{gameGit.files.length} file{gameGit.files.length !== 1 ? 's' : ''} changed</summary>
                      <div className="mt-1 space-y-0.5 max-h-24 overflow-y-auto">
                        {gameGit.files.map((f, i) => <p key={i} className="font-mono text-text-dim truncate">{f}</p>)}
                      </div>
                    </details>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

      </div>

      {/* LOG */}
      {(log || running || deploying) && (
        <div className="card overflow-hidden shrink-0">
          <div className="flex items-center gap-2.5 px-6 py-3 border-b border-border/40">
            <span className="text-[10px] font-bold tracking-[0.14em] uppercase text-text-dim">Output</span>
            {(running || deploying) && (
              <span className="flex items-center gap-1.5 text-[11px] text-cyan">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-cyan anim-pulse-dot" /> live
              </span>
            )}
            <button onClick={() => { if (running) { abortRef.current = true; window.api.stopAll(); setRunning(null); setGameStarted(false); setLog(prev => prev + '\n\n✖ Stopped by user\n'); showToast('Stopped','success'); } else { setLog(''); setResult(null); } }}
              className={`ml-auto text-[11px] py-1 px-2.5 rounded-md border transition-colors ${running ? 'border-danger/25 text-danger hover:bg-danger/8' : 'border-border text-text-dim hover:text-text-secondary hover:border-border-bright'}`}
            >{running ? 'Stop' : 'Clear'}</button>
          </div>
          <pre ref={logRef} className="px-6 py-4 text-xs font-mono text-text-secondary whitespace-pre-wrap leading-relaxed overflow-auto max-h-64">{(log || ' ').split('\n').map((line, i) =>
            /✔.*[Cc]omplete|BUILD COMPLETE/.test(line)
              ? <span key={i} className="text-green font-medium">{line}{'\n'}</span>
              : /[✖✗]|failed|ERROR/.test(line)
              ? <span key={i} className="text-danger">{line}{'\n'}</span>
              : /⚠|OVER LIMIT|WARNING/.test(line)
              ? <span key={i} className="text-orange">{line}{'\n'}</span>
              : line + '\n'
          )}</pre>
        </div>
      )}

      {/* ═══ A/B Encoder Comparison Modal ═══ */}
      {abFiles.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => { stopAbAudio(); setAbFiles([]); }}>
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          {/* Panel */}
          <div className="relative w-auto max-w-[90vw] max-h-[85vh] mx-4 card overflow-hidden anim-fade-up" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center gap-3 px-6 py-4 border-b border-border/40">
              <span className="text-sm font-bold text-text-primary">Encoder A/B Comparison</span>
              <span className="text-[11px] text-text-dim">{abFiles.length} sound{abFiles.length !== 1 ? 's' : ''}</span>
              <button onClick={() => { stopAbAudio(); setAbFiles([]); }} className="ml-auto text-[11px] py-1 px-3 rounded-md border border-border text-text-dim hover:text-text-secondary hover:border-border-bright transition-colors">Close</button>
            </div>
            {/* Table */}
            <div className="overflow-y-auto max-h-[65vh]">
              <table className="w-auto border-collapse" style={{ marginLeft: '24px', marginRight: '24px' }}>
                <thead>
                  <tr className="text-[10px] font-bold tracking-[0.12em] uppercase border-b border-border/20">
                    <td className="text-text-dim py-2.5 pr-4">Sound</td>
                    <td className="text-center text-cyan/60 py-2.5 px-1" style={{ width: '68px' }}>Native</td>
                    <td className="text-center text-cyan/40 py-2.5 px-1" style={{ width: '50px' }}>Size</td>
                    <td className="text-center text-green/60 py-2.5 px-1" style={{ width: '68px' }}>FDK</td>
                    <td className="text-center text-green/40 py-2.5 px-1" style={{ width: '50px' }}>Size</td>
                  </tr>
                </thead>
                <tbody>
                  {abFiles.map((f, idx) => (
                    <tr key={f.name} className={`${idx % 2 === 0 ? 'bg-white/[0.015]' : ''} hover:bg-white/[0.03] transition-colors`}>
                      <td className="text-xs font-mono text-text-primary whitespace-nowrap py-2 pr-4">{f.name}</td>
                      <td className="text-center py-2 px-1">{f.native ? (
                        <button onClick={() => playAbAudio(f.native)} className={`w-full text-center text-xs py-1.5 rounded-md border transition-all ${abPlaying === f.native ? 'bg-cyan/15 text-cyan border-cyan/30 font-medium' : 'text-cyan/50 border-cyan/15 hover:text-cyan hover:border-cyan/30 hover:bg-cyan/8'}`}>
                          {abPlaying === f.native ? '■ Stop' : '▶ Play'}
                        </button>
                      ) : <span className="text-[11px] text-text-dim">—</span>}</td>
                      <td className="text-center text-[11px] font-mono text-cyan/50 py-2 px-1">{f.nativeSize ? `${(f.nativeSize/1024).toFixed(1)}K` : '—'}</td>
                      <td className="text-center py-2 px-1">{f.fdk ? (
                        <button onClick={() => playAbAudio(f.fdk)} className={`w-full text-center text-xs py-1.5 rounded-md border transition-all ${abPlaying === f.fdk ? 'bg-green/15 text-green border-green/30 font-medium' : 'text-green/50 border-green/15 hover:text-green hover:border-green/30 hover:bg-green/8'}`}>
                          {abPlaying === f.fdk ? '■ Stop' : '▶ Play'}
                        </button>
                      ) : <span className="text-[11px] text-text-dim italic">n/a</span>}</td>
                      <td className="text-center text-[11px] font-mono text-green/50 py-2 px-1">{f.fdkSize ? `${(f.fdkSize/1024).toFixed(1)}K` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Footer */}
            <div className="flex items-center gap-4 px-6 py-3 border-t border-border/40 text-[11px] text-text-dim">
              <span>Native: <span className="text-cyan font-mono">{(abFiles.reduce((s,f) => s + (f.nativeSize||0), 0)/1024).toFixed(1)}K</span> total</span>
              <span>FDK: <span className="text-green font-mono">{(abFiles.reduce((s,f) => s + (f.fdkSize||0), 0)/1024).toFixed(1)}K</span> total</span>
              <span className="font-mono">{abFiles.filter(f => f.fdkSize && f.nativeSize && f.fdkSize < f.nativeSize).length}/{abFiles.filter(f => f.fdk).length} FDK smaller</span>
              <button onClick={async () => { const r = await window.api.openFolder('dist/encoder-test'); if (r?.error) showToast(r.error, 'error'); }}
                className="ml-auto text-text-dim hover:text-text-secondary transition-colors">Open Folder</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
