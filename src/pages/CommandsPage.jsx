import React, { useState, useMemo, useCallback } from 'react';

export default function CommandsPage({ project, showToast }) {
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState(null);

  if (!project) {
    return (
      <div className="anim-fade-up flex flex-col items-center justify-center h-64 text-text-dim text-sm">
        Open a project first to view commands.
      </div>
    );
  }

  const commands = project?.soundsJson?.soundDefinitions?.commands || {};
  const soundSprites = project?.soundsJson?.soundDefinitions?.soundSprites || {};
  const spriteLists = project?.soundsJson?.soundDefinitions?.spriteList || {};

  const cmdNames = useMemo(() =>
    Object.keys(commands).filter(n => n.toLowerCase().includes(filter.toLowerCase())).sort(),
    [commands, filter]
  );

  const getIssues = useCallback((name) => {
    const issues = [];
    for (const action of commands[name] || []) {
      if (action.spriteId && !soundSprites[action.spriteId]) issues.push(`Missing sprite: ${action.spriteId}`);
      if (action.spriteListId && !spriteLists[action.spriteListId]) issues.push(`Missing list: ${action.spriteListId}`);
      if (action.commandId && !commands[action.commandId]) issues.push(`Missing command: ${action.commandId}`);
    }
    return issues;
  }, [commands, soundSprites, spriteLists]);

  const totalIssues = useMemo(() => cmdNames.reduce((s, n) => s + getIssues(n).length, 0), [cmdNames, getIssues]);

  return (
    <div className="anim-fade-up space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Commands</h2>
          <p className="text-[11px] text-text-dim mt-0.5">
            {Object.keys(commands).length} total
            {totalIssues > 0 && <span className="text-danger ml-2">&middot; {totalIssues} broken ref(s)</span>}
          </p>
        </div>
      </div>

      <input
        type="text"
        placeholder="Search commands..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="input-base"
      />

      <div className="space-y-1 max-h-[calc(100vh-250px)] overflow-y-auto pr-1">
        {cmdNames.map((name) => {
          const actions = commands[name] || [];
          const issues = getIssues(name);
          const isOpen = expanded === name;
          return (
            <div key={name} className="card overflow-hidden" style={{ borderRadius: 10 }}>
              <button
                onClick={() => setExpanded(isOpen ? null : name)}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-bg-hover/50 transition-colors text-left"
              >
                <svg className={`w-3 h-3 text-text-dim transition-transform ${isOpen ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                  <path d="M6 4l8 6-8 6V4z" />
                </svg>
                <span className="flex-1 text-[13px] font-mono truncate">{name}</span>
                {issues.length > 0 && (
                  <span className="badge bg-danger-dim text-danger">{issues.length} err</span>
                )}
                <span className="text-[11px] text-text-dim">{actions.length} action{actions.length !== 1 ? 's' : ''}</span>
              </button>

              {isOpen && (
                <div className="px-4 pb-3 pt-2 border-t border-border space-y-1.5 anim-fade-in">
                  {issues.map((iss, i) => (
                    <p key={i} className="text-[11px] text-danger flex items-center gap-1.5">
                      <svg className="w-3 h-3 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                      {iss}
                    </p>
                  ))}
                  {actions.map((action, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-[12px] py-0.5">
                      <span className="text-text-dim w-5 text-right tabular-nums">{idx + 1}</span>
                      <span className="badge bg-cyan-dim text-cyan">{action.command}</span>
                      {action.spriteId && (
                        <span className={`font-mono ${soundSprites[action.spriteId] ? 'text-text-primary' : 'text-danger line-through'}`}>
                          {action.spriteId}
                        </span>
                      )}
                      {action.spriteListId && (
                        <span className={`font-mono ${spriteLists[action.spriteListId] ? 'text-purple' : 'text-danger line-through'}`}>
                          list:{action.spriteListId}
                        </span>
                      )}
                      {action.volume !== undefined && <span className="text-text-dim">vol:{action.volume}</span>}
                      {action.duration !== undefined && <span className="text-text-dim">dur:{action.duration}ms</span>}
                      {action.delay !== undefined && <span className="text-text-dim">delay:{action.delay}ms</span>}
                      {action.loop !== undefined && <span className="text-text-dim">loop:{String(action.loop)}</span>}
                      {action.commandId && <span className="font-mono text-accent">{action.commandId}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {cmdNames.length === 0 && (
          <div className="text-center py-12 text-text-dim text-sm">
            {filter ? 'No commands match filter' : 'No commands defined in sounds.json'}
          </div>
        )}
      </div>
    </div>
  );
}
