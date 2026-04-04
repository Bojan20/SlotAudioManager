import React, { useState, useEffect } from 'react';

export default function GitPage({ project, showToast }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');
  const [pushing, setPushing] = useState(false);

  const [autoFilled, setAutoFilled] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await window.api.gitStatus();
      setStatus(r);
      setAutoFilled(false); // allow auto-fill on next render
    } catch (e) {
      setStatus({ error: e.message });
    }
    setLoading(false);
  };

  useEffect(() => {
    setStatus(null);
    setCommitMsg('');
    setAutoFilled(false);
    if (project) refresh();
  }, [project?.path, project?._reloadKey]);

  const handleCommitPush = async () => {
    if (!commitMsg.trim()) { showToast('Enter a commit message', 'error'); return; }
    setPushing(true);
    try {
      const r = await window.api.gitCommitPush(commitMsg.trim());
      if (r?.success) { showToast('Committed & pushed', 'success'); setCommitMsg(''); refresh(); }
      else showToast(r?.error || 'Git error', 'error');
    } catch (e) {
      showToast('Git error: ' + e.message, 'error');
    }
    setPushing(false);
  };

  if (!project) {
    return (
      <div className="anim-fade-up flex flex-col items-center justify-center h-64 text-text-dim text-sm">
        Open a project first to view git status.
      </div>
    );
  }

  const files = (status?.status || '').split('\n').filter(Boolean);
  const hasChanges = files.length > 0;

  // Auto-generate commit message from changed files
  const generateCommitMsg = () => {
    if (!hasChanges) return '';
    const newWavs = files.filter(f => f.includes('sourceSoundFiles/') && (f.startsWith('??') || f.startsWith(' A') || f.startsWith('A '))).length;
    const delWavs = files.filter(f => f.includes('sourceSoundFiles/') && (f.startsWith(' D') || f.startsWith('D '))).length;
    const modWavs = files.filter(f => f.includes('sourceSoundFiles/') && (f.startsWith(' M') || f.startsWith('M '))).length;
    const soundsJsonChanged = files.some(f => f.endsWith('sounds.json') && !f.includes('dist/'));
    const spriteConfigChanged = files.some(f => f.includes('sprite-config.json'));
    const distChanged = files.some(f => f.includes('dist/'));
    const scriptsChanged = files.some(f => f.includes('scripts/'));
    const settingsChanged = files.some(f => f.includes('settings.json'));
    const pkgChanged = files.some(f => f.includes('package.json'));

    const parts = [];
    if (newWavs > 0) parts.push(`add ${newWavs} sound${newWavs > 1 ? 's' : ''}`);
    if (delWavs > 0) parts.push(`remove ${delWavs} sound${delWavs > 1 ? 's' : ''}`);
    if (modWavs > 0) parts.push(`update ${modWavs} sound${modWavs > 1 ? 's' : ''}`);
    if (soundsJsonChanged && !newWavs && !delWavs) parts.push('update commands');
    if (spriteConfigChanged) parts.push('update sprite config');
    if (distChanged && !parts.length) parts.push('rebuild audio sprites');
    if (scriptsChanged && !parts.length) parts.push('update build scripts');
    if (settingsChanged && !parts.length) parts.push('update settings');
    if (pkgChanged && !parts.length) parts.push('update dependencies');
    if (!parts.length) parts.push(`update ${files.length} file${files.length > 1 ? 's' : ''}`);

    // Capitalize first letter
    const msg = parts.join(', ');
    return msg.charAt(0).toUpperCase() + msg.slice(1);
  };

  // Auto-fill commit message when status changes
  useEffect(() => {
    if (!autoFilled && hasChanges && !commitMsg.trim()) {
      setCommitMsg(generateCommitMsg());
      setAutoFilled(true);
    }
  }, [hasChanges, autoFilled]);

  return (
    <div className="anim-fade-up h-full flex flex-col gap-2">

      {/* Header */}
      <div className="shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-text-primary">Git</h2>
          {status && !status.error && (
            <span className="badge bg-purple-dim text-purple" title="Current git branch">{status.branch}</span>
          )}
          {hasChanges && (
            <span className="badge bg-orange-dim text-orange" title="Number of modified, added, or deleted files in working tree">{files.length} change{files.length !== 1 ? 's' : ''}</span>
          )}
          {status && !status.error && !hasChanges && (
            <span className="badge bg-green-dim text-green" title="Working tree is clean — no uncommitted changes">Clean</span>
          )}
        </div>
        <button onClick={refresh} disabled={loading} className="btn-ghost text-xs" title="Reload git status — branch, changed files, and recent commits">
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {status?.error && (
        <div className="card p-3 border-danger/30 bg-danger-dim text-sm text-danger shrink-0">{status.error}</div>
      )}

      {status && !status.error && (
        <div className="flex-1 min-h-0 grid grid-cols-2 gap-2">

          {/* LEFT — Changed files */}
          <div className="card p-3 flex flex-col min-h-0">
            <p className="section-label mb-2 shrink-0" title="Files modified, added, or deleted since last commit">
              {hasChanges ? `Changed Files (${files.length})` : 'Working Tree'}
            </p>

            {hasChanges ? (
              <div className="flex-1 min-h-0 overflow-y-auto space-y-0.5">
                {files.map((line, i) => {
                  const code = line.substring(0, 2);
                  const file = line.substring(3);
                  let label = 'MOD';
                  if (code.includes('?'))      { label = 'NEW'; }
                  else if (code.includes('A')) { label = 'ADD'; }
                  else if (code.includes('D')) { label = 'DEL'; }
                  else if (code.includes('M')) { label = 'MOD'; }
                  else if (code.includes('R')) { label = 'REN'; }
                  return (
                    <div key={i} className="flex items-center gap-2 py-1 border-b border-border/30 last:border-0">
                      <span className={`badge text-xs w-9 justify-center ${
                        label === 'NEW' ? 'bg-cyan-dim text-cyan' :
                        label === 'ADD' ? 'bg-green-dim text-green' :
                        label === 'DEL' ? 'bg-danger-dim text-danger' :
                        label === 'REN' ? 'bg-purple-dim text-purple' :
                        'bg-orange-dim text-orange'
                      }`} title={
                        label === 'NEW' ? 'Untracked file — not yet added to git' :
                        label === 'ADD' ? 'Newly staged file — added to git index' :
                        label === 'DEL' ? 'Deleted file — removed from working tree' :
                        label === 'REN' ? 'Renamed file — path changed' :
                        'Modified file — content changed since last commit'
                      }>{label}</span>
                      <span className="text-xs font-mono truncate text-text-secondary">{file}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <svg className="w-8 h-8 text-green mx-auto mb-2 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-sm text-text-dim">Working tree clean</p>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT — Recent Commits */}
          <div className="card p-3 flex flex-col min-h-0">
            <p className="section-label mb-2 shrink-0" title="Last 10 commits on current branch">Recent Commits</p>
            <div className="flex-1 min-h-0 overflow-y-auto space-y-0.5">
              {(status.log || '').split('\n').filter(Boolean).map((line, i) => {
                const hash = line.substring(0, 7);
                const msg  = line.substring(8);
                return (
                  <div key={i} className="flex items-center gap-3 py-1.5 border-b border-border/30 last:border-0">
                    <span className="text-xs font-mono text-accent shrink-0">{hash}</span>
                    <span className="text-xs text-text-secondary truncate">{msg}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Commit & Push — full width at bottom */}
      {status && !status.error && hasChanges && (
        <div className="card p-3 shrink-0">
          <div className="flex gap-2 items-center">
            <p className="section-label shrink-0" title="Stage all changes, commit with message, and push to remote">Commit & Push</p>
            <input
              type="text"
              placeholder="Commit message..."
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !pushing && handleCommitPush()}
              className="input-base flex-1 py-1.5 text-xs"
            />
            <button
              onClick={handleCommitPush}
              disabled={pushing || !commitMsg.trim()}
              title="Stage all changes (git add -A), commit with message, and push to remote"
              className={pushing ? 'btn-ghost text-accent border-accent/30 cursor-wait whitespace-nowrap text-xs' :
                !commitMsg.trim() ? 'btn-ghost opacity-40 cursor-not-allowed whitespace-nowrap text-xs' : 'btn-primary whitespace-nowrap text-xs'}
            >
              {pushing ? 'Pushing...' : 'Commit & Push'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
