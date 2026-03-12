import React, { useState, useRef, useEffect, useMemo } from 'react';

export default function BuildPage({ project, showToast }) {
  const [running, setRunning] = useState(null); // which script is running
  const [log, setLog] = useState('');
  const [result, setResult] = useState(null); // { script, ok }
  const logRef = useRef(null);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);

  if (!project) {
    return (
      <div className="anim-fade-up flex flex-col items-center justify-center h-64 text-text-dim text-sm">
        Open a project first to build & deploy.
      </div>
    );
  }

  // Detect available build/deploy scripts from project
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

  const runScript = async (scriptName) => {
    setRunning(scriptName); setLog(''); setResult(null);
    try {
      const r = await window.api.runScript(scriptName);
      setLog(r.output || r.error || 'No output');
      setResult({ script: scriptName, ok: r.success });
      showToast(r.success ? `${scriptName} passed` : `${scriptName} failed`, r.success ? 'success' : 'error');
    } catch (e) {
      setLog('Error: ' + e.message);
      setResult({ script: scriptName, ok: false });
      showToast('Script error', 'error');
    }
    setRunning(null);
  };

  const runDeploy = async (scriptName) => {
    setRunning(scriptName); setLog(''); setResult(null);
    try {
      const r = await window.api.runDeploy(scriptName);
      setLog(r.output || r.error || 'No output');
      setResult({ script: scriptName, ok: r.success });
      showToast(r.success ? 'Deploy complete' : 'Deploy failed', r.success ? 'success' : 'error');
    } catch (e) {
      setLog('Error: ' + e.message);
      setResult({ script: scriptName, ok: false });
      showToast('Deploy error', 'error');
    }
    setRunning(null);
  };

  const deployTarget = project?.settings?.gameProjectPath || null;

  return (
    <div className="anim-fade-up space-y-5 max-w-4xl">
      <h2 className="text-lg font-bold">Build & Deploy</h2>

      {/* BUILD SCRIPTS */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="badge bg-cyan-dim text-cyan text-xs">Build Scripts</span>
          {result && buildScripts.includes(result.script) && (
            <span className={`badge ${result.ok ? 'bg-green-dim text-green' : 'bg-danger-dim text-danger'}`}>
              {result.ok ? 'PASSED' : 'FAILED'}
            </span>
          )}
        </div>

        {buildScripts.length > 0 ? (
          <div className="space-y-2">
            {buildScripts.map(name => (
              <div key={name} className="flex items-center gap-3 py-1.5">
                <div className="flex-1">
                  <p className="text-[13px] font-mono font-medium">{name}</p>
                  <p className="text-[10px] text-text-dim font-mono truncate mt-0.5">{scripts[name]}</p>
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
          <p className="text-[12px] text-text-dim">No build scripts found in package.json</p>
        )}
      </div>

      {/* DEPLOY */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="badge bg-green-dim text-green text-xs">Deploy</span>
          {result && deployScripts.includes(result.script) && (
            <span className={`badge ${result.ok ? 'bg-green-dim text-green' : 'bg-danger-dim text-danger'}`}>
              {result.ok ? 'OK' : 'FAILED'}
            </span>
          )}
        </div>

        {deployTarget ? (
          <p className="text-[11px] text-text-dim font-mono truncate">{deployTarget}</p>
        ) : (
          <p className="text-[11px] text-danger">gameProjectPath not set in settings.json</p>
        )}

        {deployScripts.length > 0 ? (
          <button
            onClick={() => runDeploy('deploy')}
            disabled={running !== null || !deployTarget}
            className={running === 'deploy' ? 'btn-ghost text-green border-green/30 cursor-wait' : !deployTarget ? 'btn-ghost opacity-40 cursor-not-allowed' : 'btn-primary'}
          >
            {running === 'deploy' && <span className="inline-block w-2 h-2 rounded-full bg-green mr-2 anim-pulse-dot" />}
            {running === 'deploy' ? 'Deploying...' : 'Deploy'}
          </button>
        ) : (
          <p className="text-[12px] text-text-dim">No deploy script found in package.json</p>
        )}
      </div>

      {/* OTHER SCRIPTS */}
      {otherScripts.length > 0 && (
        <div className="card p-5 space-y-3">
          <span className="badge bg-purple-dim text-purple text-xs">Other Scripts</span>
          <div className="space-y-2">
            {otherScripts.map(name => (
              <div key={name} className="flex items-center gap-3 py-1">
                <div className="flex-1">
                  <p className="text-[13px] font-mono font-medium">{name}</p>
                  <p className="text-[10px] text-text-dim font-mono truncate mt-0.5">{scripts[name]}</p>
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

      {/* LOG OUTPUT */}
      {log && (
        <div className="card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <span className="section-label">Output</span>
            {result && (
              <span className={`badge ${result.ok ? 'bg-green-dim text-green' : 'bg-danger-dim text-danger'}`}>
                {result.script}: {result.ok ? 'SUCCESS' : 'FAILED'}
              </span>
            )}
            <button
              onClick={() => { setLog(''); setResult(null); }}
              className="ml-auto text-[10px] text-text-dim hover:text-text-secondary transition-colors cursor-pointer"
            >Clear</button>
          </div>
          <pre
            ref={logRef}
            className="p-4 rounded-lg bg-bg-input border border-border text-[11px] font-mono text-text-secondary overflow-auto max-h-64 whitespace-pre-wrap leading-relaxed"
          >{log}</pre>
        </div>
      )}
    </div>
  );
}
