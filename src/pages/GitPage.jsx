import React, { useState, useEffect } from 'react';

export default function GitPage({ project, showToast }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');
  const [pushing, setPushing] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await window.api.gitStatus();
      setStatus(r);
    } catch (e) {
      setStatus({ error: e.message });
    }
    setLoading(false);
  };

  useEffect(() => {
    setStatus(null);
    setCommitMsg('');
    if (project) refresh();
  }, [project?.path]);

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

  return (
    <div className="anim-fade-up h-full flex flex-col gap-2">

      {/* Header */}
      <div className="shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-text-primary">Git</h2>
          {status && !status.error && (
            <span className="badge bg-purple-dim text-purple">{status.branch}</span>
          )}
          {hasChanges && (
            <span className="badge bg-orange-dim text-orange">{files.length} change{files.length !== 1 ? 's' : ''}</span>
          )}
          {status && !status.error && !hasChanges && (
            <span className="badge bg-green-dim text-green">Clean</span>
          )}
        </div>
        <button onClick={refresh} disabled={loading} className="btn-ghost text-xs">
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
            <p className="section-label mb-2 shrink-0">
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
                      }`}>{label}</span>
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
            <p className="section-label mb-2 shrink-0">Recent Commits</p>
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
            <p className="section-label shrink-0">Commit & Push</p>
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
