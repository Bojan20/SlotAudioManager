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
    <div className="anim-fade-up space-y-5 max-w-4xl">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Git</h2>
        <button onClick={refresh} disabled={loading} className="btn-ghost text-xs">
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {status?.error && (
        <div className="card p-4 border-danger/30 bg-danger-dim text-[13px] text-danger">{status.error}</div>
      )}

      {status && !status.error && (
        <>
          {/* Branch */}
          <div className="card p-4 flex items-center gap-4">
            <p className="section-label w-16">Branch</p>
            <span className="badge bg-purple-dim text-purple">{status.branch}</span>
          </div>

          {/* Changed files */}
          <div className="card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="section-label">Changes</p>
              {hasChanges && <span className="badge bg-orange-dim text-orange">{files.length} file{files.length !== 1 ? 's' : ''}</span>}
            </div>

            {hasChanges ? (
              <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                {files.map((line, i) => {
                  const code = line.substring(0, 2);
                  const file = line.substring(3);
                  let color = 'text-text-secondary';
                  let label = 'MOD';
                  if (code.includes('?')) { color = 'text-cyan'; label = 'NEW'; }
                  else if (code.includes('A')) { color = 'text-green'; label = 'ADD'; }
                  else if (code.includes('D')) { color = 'text-danger'; label = 'DEL'; }
                  else if (code.includes('M')) { color = 'text-orange'; label = 'MOD'; }
                  else if (code.includes('R')) { color = 'text-purple'; label = 'REN'; }
                  return (
                    <div key={i} className="flex items-center gap-2 py-0.5">
                      <span className={`badge text-[9px] w-8 justify-center ${
                        label === 'NEW' ? 'bg-cyan-dim text-cyan' :
                        label === 'ADD' ? 'bg-green-dim text-green' :
                        label === 'DEL' ? 'bg-danger-dim text-danger' :
                        label === 'REN' ? 'bg-purple-dim text-purple' :
                        'bg-orange-dim text-orange'
                      }`}>{label}</span>
                      <span className={`text-[12px] font-mono truncate ${color}`}>{file}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-[12px] text-text-dim">Working tree clean</p>
            )}
          </div>

          {/* Commit + Push */}
          {hasChanges && (
            <div className="card p-5 space-y-3">
              <p className="section-label">Commit & Push</p>
              <div className="flex gap-3">
                <input
                  type="text"
                  placeholder="Commit message..."
                  value={commitMsg}
                  onChange={(e) => setCommitMsg(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !pushing && handleCommitPush()}
                  className="input-base flex-1"
                />
                <button
                  onClick={handleCommitPush}
                  disabled={pushing || !commitMsg.trim()}
                  className={pushing ? 'btn-ghost text-accent border-accent/30 cursor-wait whitespace-nowrap' :
                    !commitMsg.trim() ? 'btn-ghost opacity-40 cursor-not-allowed whitespace-nowrap' : 'btn-primary whitespace-nowrap'}
                >
                  {pushing ? 'Pushing...' : 'Commit & Push'}
                </button>
              </div>
            </div>
          )}

          {/* Recent commits */}
          <div className="card p-5 space-y-3">
            <p className="section-label">Recent Commits</p>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {(status.log || '').split('\n').filter(Boolean).map((line, i) => {
                const hash = line.substring(0, 7);
                const msg = line.substring(8);
                return (
                  <div key={i} className="flex items-center gap-3 py-0.5">
                    <span className="text-[11px] font-mono text-accent">{hash}</span>
                    <span className="text-[12px] text-text-secondary truncate">{msg}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
