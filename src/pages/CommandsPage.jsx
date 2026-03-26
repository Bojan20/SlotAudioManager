import React, { useState, useEffect, useMemo, useCallback } from 'react';

const COMMANDS = ['Play', 'Stop', 'Fade', 'Set', 'Pause', 'Resume', 'Execute', 'ResetSpriteList'];

function StepForm({ state, setState, soundSprites, spriteLists, commands }) {
  const spriteIds = Object.keys(soundSprites).sort();
  const spriteListIds = Object.keys(spriteLists).sort();
  const commandIds = Object.keys(commands).sort();

  const cmd = state.command;
  const isExecute = cmd === 'Execute';
  const isResetSpriteList = cmd === 'ResetSpriteList';
  const isPlay = cmd === 'Play';
  const isFade = cmd === 'Fade';
  const isStop = cmd === 'Stop';
  const showVolume = ['Play', 'Fade', 'Set'].includes(cmd);
  const showDelay = ['Play', 'Stop', 'Fade', 'Pause', 'Resume'].includes(cmd);
  const showRate = ['Play', 'Set'].includes(cmd);

  return (
    <div className="space-y-3">
      {/* Row 1: Command + target */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="section-label mb-1 block">Command</label>
          <select
            value={cmd}
            onChange={e => setState(m => ({ ...m, command: e.target.value, commandId: '', spriteId: '', spriteListId: '', targetType: 'sprite' }))}
            className="input-base text-xs w-full"
          >
            {COMMANDS.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>

        {isExecute ? (
          <div>
            <label className="section-label mb-1 block">Command ID</label>
            <select
              value={state.commandId || ''}
              onChange={e => setState(m => ({ ...m, commandId: e.target.value }))}
              className="input-base text-xs w-full font-mono"
            >
              <option value="">— select —</option>
              {commandIds.map(id => <option key={id}>{id}</option>)}
            </select>
          </div>
        ) : isResetSpriteList ? (
          <div>
            <label className="section-label mb-1 block">Sprite List</label>
            <select
              value={state.spriteListId || ''}
              onChange={e => setState(m => ({ ...m, spriteListId: e.target.value }))}
              className="input-base text-xs w-full font-mono"
            >
              <option value="">— select —</option>
              {spriteListIds.map(id => <option key={id}>{id}</option>)}
            </select>
          </div>
        ) : isPlay ? (
          <div>
            <div className="flex items-center gap-2 mb-1">
              <label className="section-label">Target</label>
              <div className="flex gap-1">
                <button type="button"
                  onClick={() => setState(m => ({ ...m, targetType: 'sprite', spriteListId: '' }))}
                  className={`text-xs px-2 py-0.5 rounded border transition-colors ${state.targetType !== 'list' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-text-dim hover:border-border-bright'}`}
                >Sprite</button>
                <button type="button"
                  onClick={() => setState(m => ({ ...m, targetType: 'list', spriteId: '' }))}
                  className={`text-xs px-2 py-0.5 rounded border transition-colors ${state.targetType === 'list' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-text-dim hover:border-border-bright'}`}
                >List</button>
              </div>
            </div>
            {state.targetType === 'list' ? (
              <select
                value={state.spriteListId || ''}
                onChange={e => setState(m => ({ ...m, spriteListId: e.target.value }))}
                className="input-base text-xs w-full font-mono"
              >
                <option value="">— select —</option>
                {spriteListIds.map(id => <option key={id}>{id}</option>)}
              </select>
            ) : (
              <select
                value={state.spriteId}
                onChange={e => setState(m => ({ ...m, spriteId: e.target.value }))}
                className="input-base text-xs w-full font-mono"
              >
                <option value="">— select —</option>
                {spriteIds.map(id => <option key={id}>{id}</option>)}
              </select>
            )}
          </div>
        ) : (
          <div>
            <label className="section-label mb-1 block">SpriteId</label>
            <select
              value={state.spriteId}
              onChange={e => setState(m => ({ ...m, spriteId: e.target.value }))}
              className="input-base text-xs w-full font-mono"
            >
              <option value="">— select —</option>
              {spriteIds.map(id => <option key={id}>{id}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Row 2: numeric fields */}
      {!isExecute && !isResetSpriteList && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {showVolume && (
            <div>
              <label className="section-label mb-1 block">Volume</label>
              <input
                type="number" min="0" max="1" step="0.1"
                value={state.volume}
                onChange={e => setState(m => ({ ...m, volume: e.target.value }))}
                className="input-base text-xs w-full"
              />
            </div>
          )}
          {showDelay && (
            <div>
              <label className="section-label mb-1 block">Delay ms</label>
              <input
                type="number" min="0"
                value={state.delay}
                onChange={e => setState(m => ({ ...m, delay: e.target.value }))}
                placeholder="0"
                className="input-base text-xs w-full"
              />
            </div>
          )}
          {isFade && (
            <div>
              <label className="section-label mb-1 block">Duration ms</label>
              <input
                type="number" min="0"
                value={state.duration}
                onChange={e => setState(m => ({ ...m, duration: e.target.value }))}
                placeholder="0"
                className="input-base text-xs w-full"
              />
            </div>
          )}
          {(isPlay || cmd === 'Set') && (
            <div>
              <label className="section-label mb-1 block">Pan</label>
              <input
                type="number" min="-1" max="1" step="0.1"
                value={state.pan}
                onChange={e => setState(m => ({ ...m, pan: e.target.value }))}
                placeholder="0"
                className="input-base text-xs w-full"
              />
            </div>
          )}
          {showRate && (
            <div>
              <label className="section-label mb-1 block">Rate</label>
              <input
                type="number" min="0.5" max="4" step="0.1"
                value={state.rate}
                onChange={e => setState(m => ({ ...m, rate: e.target.value }))}
                placeholder="1"
                className="input-base text-xs w-full"
              />
            </div>
          )}
        </div>
      )}

      {/* Row 3: checkboxes */}
      {!isExecute && !isResetSpriteList && (
        <div className="flex items-center gap-4">
          {isPlay && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={state.loop}
                onChange={e => setState(m => ({ ...m, loop: e.target.checked }))}
                className="w-4 h-4 accent-accent"
              />
              <span className="text-xs text-text-secondary">Loop</span>
            </label>
          )}
          {(isPlay || isStop) && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={state.cancelDelay}
                onChange={e => setState(m => ({ ...m, cancelDelay: e.target.checked }))}
                className="w-4 h-4 accent-accent"
              />
              <span className="text-xs text-text-secondary">cancelDelay</span>
            </label>
          )}
        </div>
      )}
    </div>
  );
}

function emptyStep(overrides = {}) {
  return {
    command: 'Play', commandId: '', spriteId: '', spriteListId: '',
    targetType: 'sprite', volume: 1, delay: '', loop: false,
    pan: '', duration: '', cancelDelay: false, rate: '',
    ...overrides,
  };
}

function stepFromAction(action) {
  return {
    command: action.command || 'Play',
    commandId: action.commandId || '',
    spriteId: action.spriteId || '',
    spriteListId: action.spriteListId || '',
    targetType: action.spriteListId ? 'list' : 'sprite',
    volume: action.volume ?? 1,
    delay: action.delay ?? '',
    loop: action.loop === -1,
    pan: action.pan ?? '',
    duration: action.duration ?? '',
    cancelDelay: action.cancelDelay === 'true' || action.cancelDelay === true,
    rate: action.rate ?? '',
  };
}

function suggestHookName(spriteId) {
  const n = spriteId.replace(/^s_/, '');
  const m1 = n.match(/^Symbol(S\d+)$/);   if (m1) return `onSymbolWin${m1[1]}`;
  const m2 = n.match(/^Symbol(W\d+)$/);   if (m2) return `onSymbolWin${m2[1]}`;
  const m3 = n.match(/^Symbol(F\d+)$/);   if (m3) return `onSymbolWin${m3[1]}`;
  const m4 = n.match(/^Symbol(B\d+)$/);   if (m4) return `onSymbolWin${m4[1]}`;
  const m5 = n.match(/^BonusSymbol(S\d+)$/); if (m5) return `onBonusSymbolWin${m5[1]}`;
  const m6 = n.match(/^BonusSymbol(W\d+)$/); if (m6) return `onBonusSymbolWin${m6[1]}`;
  const m7 = n.match(/^Symbol(B\d+)Land(\d+)$/); if (m7) return `onSymbolLand${m7[1]}_${m7[2]}`;
  const m8 = n.match(/^(Ui.+)$/);  if (m8) return `on${m8[1]}`;
  return `on${n}`;
}

function suggestActions(spriteId) {
  const base = { command: 'Play', spriteId, volume: 1 };
  if (/Loop$/i.test(spriteId))           return [{ ...base, loop: -1 }];
  if (/RollupStart$/i.test(spriteId))    return [{ ...base, loop: -1 }];
  if (/Rollup\dStart$/i.test(spriteId))  return [{ ...base, loop: -1 }];
  return [base];
}

export default function CommandsPage({ project, setProject, showToast }) {
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [genPreview, setGenPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [newCmd, setNewCmd] = useState(null);
  const [addStep, setAddStep] = useState(null);
  const [editStep, setEditStep] = useState(null);
  const [confirmDeleteCmd, setConfirmDeleteCmd] = useState(null);
  const [scanResult, setScanResult] = useState(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    setFilter(''); setExpanded(null); setGenPreview(null);
    setNewCmd(null); setAddStep(null); setEditStep(null); setConfirmDeleteCmd(null);
    setScanResult(null);
  }, [project?.path]);

  const commands = project?.soundsJson?.soundDefinitions?.commands || {};
  const soundSprites = project?.soundsJson?.soundDefinitions?.soundSprites || {};
  const spriteLists = project?.soundsJson?.soundDefinitions?.spriteList || {};

  const referencedSprites = useMemo(() => {
    const refs = new Set();
    for (const actions of Object.values(commands)) {
      for (const a of actions) {
        if (a.spriteId) refs.add(a.spriteId);
      }
    }
    return refs;
  }, [commands]);

  const unmapped = useMemo(() =>
    Object.keys(soundSprites).filter(id => !referencedSprites.has(id)).sort(),
    [soundSprites, referencedSprites]
  );

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

  if (!project) {
    return (
      <div className="anim-fade-up flex flex-col items-center justify-center h-64 text-text-dim text-sm">
        Open a project first to view commands.
      </div>
    );
  }

  const handleScan = async () => {
    setScanning(true);
    try {
      const r = await window.api.scanGameHooks();
      if (r?.error) { showToast(r.error, 'error'); }
      else setScanResult(r);
    } catch (e) { showToast('Scan failed: ' + e.message, 'error'); }
    setScanning(false);
  };

  const handleOpenGen = () => {
    const proposals = unmapped.map(spriteId => ({
      spriteId,
      hookName: suggestHookName(spriteId),
      actions: suggestActions(spriteId),
      include: true,
    }));
    setGenPreview(proposals);
  };

  const handleApplyGen = async () => {
    const toAdd = genPreview.filter(p => p.include && p.hookName.trim());
    if (!toAdd.length) { setGenPreview(null); return; }
    setSaving(true);
    try {
      const j = structuredClone(project.soundsJson);
      for (const { hookName, actions } of toAdd) {
        j.soundDefinitions.commands[hookName.trim()] = actions;
      }
      const r = await window.api.saveSoundsJson(j);
      if (r?.success) {
        const updated = structuredClone(project);
        updated.soundsJson = j;
        setProject(updated);
        showToast(`Added ${toAdd.length} command(s)`, 'success');
        setGenPreview(null);
      } else {
        showToast(r?.error || 'Save failed', 'error');
      }
    } catch (e) {
      showToast('Save failed: ' + e.message, 'error');
    }
    setSaving(false);
  };

  const saveJson = async (newSoundsJson, successMsg) => {
    setSaving(true);
    let saved = false;
    try {
      const r = await window.api.saveSoundsJson(newSoundsJson);
      if (r?.success) {
        const updated = structuredClone(project);
        updated.soundsJson = newSoundsJson;
        setProject(updated);
        showToast(successMsg, 'success');
        saved = true;
      } else showToast(r?.error || 'Save failed', 'error');
    } catch (e) { showToast('Save failed: ' + e.message, 'error'); }
    setSaving(false);
    return saved;
  };

  const buildStep = (s) => {
    const step = { command: s.command };

    if (s.command === 'Execute') {
      if (s.commandId) step.commandId = s.commandId;
      return step;
    }

    if (s.command === 'ResetSpriteList') {
      if (s.spriteListId) step.spriteListId = s.spriteListId;
      if (s.delay) step.delay = parseInt(s.delay) || 0;
      return step;
    }

    // Target: spriteId or spriteListId (Play supports both)
    if (s.targetType === 'list' && s.spriteListId) {
      step.spriteListId = s.spriteListId;
    } else if (s.spriteId) {
      step.spriteId = s.spriteId;
    }

    if (['Play', 'Fade', 'Set'].includes(s.command)) {
      const vol = parseFloat(s.volume);
      step.volume = isNaN(vol) ? 1 : vol;
    }
    if (s.delay !== '' && s.delay !== undefined) step.delay = parseInt(s.delay) || 0;
    if (s.command === 'Fade' && s.duration !== '' && s.duration !== undefined) step.duration = parseInt(s.duration) || 0;
    if (['Play', 'Set'].includes(s.command) && s.pan !== '' && s.pan !== undefined && parseFloat(s.pan) !== 0) step.pan = parseFloat(s.pan);
    if (['Play', 'Set'].includes(s.command) && s.rate !== '' && s.rate !== undefined) {
      const r = parseFloat(s.rate);
      if (!isNaN(r)) step.rate = r;
    }
    if (s.command === 'Play' && s.loop) step.loop = -1;
    if ((s.command === 'Play' || s.command === 'Stop') && s.cancelDelay) step.cancelDelay = true;

    return step;
  };

  const validateStep = (s) => {
    if (s.command === 'Execute' && !s.commandId) { showToast('Izaberi commandId', 'error'); return false; }
    if (s.command === 'ResetSpriteList' && !s.spriteListId) { showToast('Izaberi sprite list', 'error'); return false; }
    if (!['Execute', 'ResetSpriteList'].includes(s.command)) {
      if (s.targetType === 'list' && !s.spriteListId) { showToast('Izaberi sprite list', 'error'); return false; }
      if (s.targetType !== 'list' && !s.spriteId) { showToast('Izaberi spriteId', 'error'); return false; }
    }
    return true;
  };

  const handleSaveNewCmd = async () => {
    const hookName = newCmd.hookName.trim();
    if (!hookName) return;
    if (commands[hookName]) { showToast(`Command "${hookName}" already exists`, 'error'); return; }
    if (!validateStep(newCmd)) return;
    const j = structuredClone(project.soundsJson);
    j.soundDefinitions.commands[hookName] = [buildStep(newCmd)];
    const ok = await saveJson(j, `Command "${hookName}" added`);
    if (ok) { setNewCmd(null); setExpanded(hookName); }
  };

  const handleSaveAddStep = async () => {
    if (!validateStep(addStep)) return;
    const j = structuredClone(project.soundsJson);
    j.soundDefinitions.commands[addStep.cmdName] = [
      ...(j.soundDefinitions.commands[addStep.cmdName] || []),
      buildStep(addStep),
    ];
    const ok = await saveJson(j, 'Step dodan');
    if (ok) setAddStep(null);
  };

  const handleSaveEditStep = async () => {
    if (!validateStep(editStep)) return;
    const j = structuredClone(project.soundsJson);
    j.soundDefinitions.commands[editStep.cmdName][editStep.stepIdx] = buildStep(editStep);
    const ok = await saveJson(j, 'Step saved');
    if (ok) setEditStep(null);
  };

  const handleDeleteStep = async (cmdName, stepIdx) => {
    const j = structuredClone(project.soundsJson);
    j.soundDefinitions.commands[cmdName].splice(stepIdx, 1);
    await saveJson(j, 'Step obrisan');
  };

  const handleDeleteCmd = async (cmdName) => {
    const j = structuredClone(project.soundsJson);
    delete j.soundDefinitions.commands[cmdName];
    setConfirmDeleteCmd(null);
    const ok = await saveJson(j, `Command "${cmdName}" deleted`);
    if (ok) setExpanded(null);
  };

  return (
    <div className="anim-fade-up h-full flex flex-col gap-2">
      <div className="shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-text-primary">Commands</h2>
          <span className="badge bg-cyan-dim text-cyan">{Object.keys(commands).length} total</span>
          {totalIssues > 0 && <span className="badge bg-danger-dim text-danger">{totalIssues} broken</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleScan}
            disabled={scanning || !project?.settings?.gameProjectPath}
            className="btn-ghost text-xs py-2 flex items-center gap-1.5 border-cyan/30 text-cyan hover:border-cyan/60 disabled:opacity-40 disabled:cursor-not-allowed"
            title={!project?.settings?.gameProjectPath ? 'Game repo not configured' : ''}
          >
            {scanning ? (
              <span className="anim-pulse-dot w-2 h-2 rounded-full bg-cyan shrink-0" />
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 21h7a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v11m0 5l4.879-4.879m0 0a3 3 0 104.243-4.242 3 3 0 00-4.243 4.242z" />
              </svg>
            )}
            {scanning ? 'Scanning...' : 'Scan Game'}
          </button>
          {unmapped.length > 0 && (
            <button onClick={handleOpenGen} className="btn-ghost text-xs py-2 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Generate Missing ({unmapped.length})
            </button>
          )}
          <button
            onClick={() => setNewCmd(emptyStep({ hookName: '' }))}
            disabled={saving}
            className="btn-primary text-xs py-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            + New Command
          </button>
        </div>
      </div>

      {unmapped.length > 0 && (
        <div className="card p-3 border border-orange/30 flex items-center gap-3 shrink-0">
          <span className="badge bg-orange-dim text-orange text-xs shrink-0">Unmapped</span>
          <p className="text-xs text-text-dim flex-1">
            {unmapped.length} sound{unmapped.length !== 1 ? 's' : ''} in soundSprites with no command referencing them
          </p>
        </div>
      )}

      <input
        type="text"
        placeholder="Search commands..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="input-base shrink-0"
      />

      <div className="space-y-1 flex-1 min-h-0 overflow-y-auto pr-1">
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
                {issues.length > 0 && <span className="badge bg-danger-dim text-danger">{issues.length} err</span>}
                <span className="text-xs text-text-dim">{actions.length} action{actions.length !== 1 ? 's' : ''}</span>
              </button>

              {isOpen && (
                <div className="px-4 pb-3 pt-2 border-t border-border space-y-1 anim-fade-in">
                  {/* Delete command confirm */}
                  {confirmDeleteCmd === name ? (
                    <div className="flex items-center gap-2 py-1.5 px-2 rounded-lg bg-danger-dim border border-danger/30">
                      <span className="text-xs text-danger flex-1">Obrisati celu komandu?</span>
                      <button onClick={() => handleDeleteCmd(name)} disabled={saving} className="text-xs text-danger font-semibold hover:text-red-400 transition-colors">Yes, delete</button>
                      <button onClick={() => setConfirmDeleteCmd(null)} className="text-xs text-text-dim hover:text-text-primary transition-colors">Cancel</button>
                    </div>
                  ) : (
                    <div className="flex justify-end pb-0.5">
                      <button
                        onClick={() => setConfirmDeleteCmd(name)}
                        disabled={saving}
                        className="text-xs text-text-dim hover:text-danger transition-colors disabled:opacity-40"
                      >
                        Delete command
                      </button>
                    </div>
                  )}

                  {issues.map((iss, i) => (
                    <p key={i} className="text-xs text-danger flex items-center gap-1.5">
                      <svg className="w-3 h-3 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      {iss}
                    </p>
                  ))}

                  {actions.map((action, idx) => {
                    const isEditing = editStep?.cmdName === name && editStep?.stepIdx === idx;
                    if (isEditing) {
                      return (
                        <div key={idx} className="rounded-lg border border-accent/30 bg-accent/5 p-3 space-y-2">
                          <StepForm state={editStep} setState={setEditStep} soundSprites={soundSprites} spriteLists={spriteLists} commands={commands} />
                          <div className="flex gap-2 justify-end">
                            <button onClick={() => setEditStep(null)} className="btn-ghost text-xs py-1 px-3">Cancel</button>
                            <button onClick={handleSaveEditStep} disabled={saving} className="btn-primary text-xs py-1 px-3 disabled:opacity-40">
                              {saving ? '...' : 'Save'}
                            </button>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div key={idx} className="flex items-center gap-2 text-[12px] py-0.5 group/step">
                        <span className="text-text-dim w-5 text-right tabular-nums shrink-0">{idx + 1}</span>
                        <span className="badge bg-cyan-dim text-cyan shrink-0">{action.command}</span>

                        {/* Target display */}
                        {action.commandId && (
                          <span className={`font-mono flex-1 truncate ${commands[action.commandId] ? 'text-accent' : 'text-danger line-through'}`}>
                            → {action.commandId}
                          </span>
                        )}
                        {action.spriteId && (
                          <span className={`font-mono flex-1 truncate ${soundSprites[action.spriteId] ? 'text-text-primary' : 'text-danger line-through'}`}>
                            {action.spriteId}
                          </span>
                        )}
                        {action.spriteListId && (
                          <span className={`font-mono flex-1 ${spriteLists[action.spriteListId] ? 'text-purple' : 'text-danger line-through'}`}>
                            list:{action.spriteListId}
                          </span>
                        )}
                        {!action.spriteId && !action.spriteListId && !action.commandId && <span className="flex-1" />}

                        {/* Extra fields */}
                        {action.volume !== undefined && action.volume !== 1 && <span className="text-text-dim text-xs">vol:{action.volume}</span>}
                        {action.delay !== undefined && action.delay !== 0 && <span className="text-text-dim text-xs">+{action.delay}ms</span>}
                        {action.duration !== undefined && action.duration !== 0 && <span className="text-text-dim text-xs">dur:{action.duration}ms</span>}
                        {action.pan !== undefined && action.pan !== 0 && <span className="text-text-dim text-xs">pan:{action.pan}</span>}
                        {action.rate !== undefined && action.rate !== 1 && <span className="text-text-dim text-xs">rate:{action.rate}</span>}
                        {action.loop === -1 && <span className="text-cyan text-xs">loop</span>}
                        {(action.cancelDelay === true || action.cancelDelay === 'true') && <span className="text-orange text-xs">cancelDelay</span>}

                        <div className="flex items-center gap-1 opacity-0 group-hover/step:opacity-100 transition-opacity shrink-0">
                          <button
                            onClick={() => setEditStep({ cmdName: name, stepIdx: idx, ...stepFromAction(action) })}
                            disabled={saving}
                            className="w-5 h-5 flex items-center justify-center rounded text-text-dim hover:text-accent transition-colors"
                            title="Edituj step"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDeleteStep(name, idx)}
                            disabled={saving}
                            className="w-5 h-5 flex items-center justify-center rounded text-text-dim hover:text-danger transition-colors"
                            title="Delete step"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  <button
                    onClick={() => setAddStep(emptyStep({ cmdName: name }))}
                    disabled={saving}
                    className="text-xs text-text-dim hover:text-accent transition-colors pt-1 disabled:opacity-40"
                  >
                    + Add Step
                  </button>
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

      {/* New Command Modal */}
      {newCmd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-bg-secondary border border-border rounded-2xl shadow-2xl w-[520px] flex flex-col">
            <div className="p-5 border-b border-border">
              <h3 className="text-sm font-bold text-text-primary">Nova komanda</h3>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="section-label mb-1 block">Hook name</label>
                <input
                  type="text"
                  value={newCmd.hookName}
                  onChange={e => setNewCmd(m => ({ ...m, hookName: e.target.value }))}
                  placeholder="npr. onBigWinStart"
                  className="input-base text-xs font-mono w-full"
                  autoFocus
                />
              </div>
              <StepForm state={newCmd} setState={setNewCmd} soundSprites={soundSprites} spriteLists={spriteLists} commands={commands} />
            </div>
            <div className="p-4 border-t border-border flex gap-2 justify-end">
              <button onClick={() => setNewCmd(null)} className="btn-ghost text-xs px-4 py-2">Cancel</button>
              <button
                onClick={handleSaveNewCmd}
                disabled={saving || !newCmd.hookName.trim()}
                className="btn-primary text-xs px-4 py-2 disabled:opacity-40"
              >
                {saving ? 'Saving...' : 'Add Command'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Step Modal */}
      {addStep && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-bg-secondary border border-border rounded-2xl shadow-2xl w-[520px] flex flex-col">
            <div className="p-5 border-b border-border">
              <h3 className="text-sm font-bold text-text-primary">Add Step</h3>
              <p className="text-xs text-text-dim font-mono mt-0.5">{addStep.cmdName}</p>
            </div>
            <div className="p-5">
              <StepForm state={addStep} setState={setAddStep} soundSprites={soundSprites} spriteLists={spriteLists} commands={commands} />
            </div>
            <div className="p-4 border-t border-border flex gap-2 justify-end">
              <button onClick={() => setAddStep(null)} className="btn-ghost text-xs px-4 py-2">Cancel</button>
              <button
                onClick={handleSaveAddStep}
                disabled={saving}
                className="btn-primary text-xs px-4 py-2 disabled:opacity-40"
              >
                {saving ? 'Saving...' : 'Add Step'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scan Game Hooks Modal */}
      {scanResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-bg-secondary border border-border rounded-2xl shadow-2xl w-[680px] max-h-[85vh] flex flex-col">
            <div className="p-5 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-text-primary">Game Hook Scanner</h3>
                <p className="text-xs text-text-dim mt-0.5">
                  Scanned {scanResult.totalFiles} .ts files · {scanResult.hooks.length} hooks found
                  {scanResult.dynamicCalls.length > 0 && ` · ${scanResult.dynamicCalls.length} dynamic calls (cannot be statically analyzed)`}
                </p>
              </div>
              <button onClick={() => setScanResult(null)} className="text-text-dim hover:text-text-primary transition-colors p-1">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">

              {/* NEWLY ADDED — top section, sorted newest first */}
              {(() => {
                const newHooks = scanResult.hooks.filter(h => h.recent).sort((a, b) => b.recent.timestamp - a.recent.timestamp);
                if (!newHooks.length) return null;
                return (
                  <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-3 space-y-2">
                    <p className="section-label text-yellow-400">
                      Recent hooks — added in the last 90 days ({newHooks.length})
                    </p>
                    <div className="space-y-1">
                      {newHooks.map(h => {
                        const statusColor = !h.inJson ? 'text-danger' : h.isEmpty ? 'text-orange' : 'text-green';
                        const statusLabel = !h.inJson ? 'MISSING' : h.isEmpty ? 'EMPTY' : 'OK';
                        const statusBg = !h.inJson ? 'bg-danger-dim border-danger/20' : h.isEmpty ? 'bg-orange-dim border-orange/20' : 'bg-green-dim border-green/20';
                        return (
                          <div key={h.name} className="flex items-center gap-2 group">
                            <button
                              onClick={() => { setScanResult(null); setFilter(h.name); setExpanded(h.name); }}
                              className="font-mono text-[12px] text-text-primary hover:text-yellow-400 transition-colors text-left"
                            >{h.name}</button>
                            <span className={`badge ${statusBg} ${statusColor} text-xs shrink-0`}>{statusLabel}</span>
                            <span className="text-xs text-yellow-500/80 shrink-0">· {h.recent.relative}</span>
                            <span className="text-xs text-text-dim truncate flex-1" title={h.recent.message}>{h.recent.message}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Empty hooks — needs attention */}
              {scanResult.hooks.filter(h => h.inJson && h.isEmpty).length > 0 && (
                <div>
                  <p className="section-label mb-2 text-orange">
                    Empty hooks — in JSON but no actions ({scanResult.hooks.filter(h => h.inJson && h.isEmpty).length})
                  </p>
                  <div className="space-y-1">
                    {scanResult.hooks.filter(h => h.inJson && h.isEmpty).map(h => (
                      <div key={h.name} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-orange-dim border border-orange/20 group">
                        <span className="font-mono text-[12px] text-orange flex-1">{h.name}</span>
                        {h.recent && <span className="text-xs text-yellow-500/80 shrink-0">NEW · {h.recent.relative}</span>}
                        <button
                          onClick={() => { setScanResult(null); setFilter(h.name); setExpanded(h.name); }}
                          className="text-xs text-text-dim hover:text-orange transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                        >Otvori →</button>
                        <div className="text-xs text-text-dim font-mono truncate max-w-[180px]" title={h.files.join('\n')}>
                          {h.files[0]}{h.files.length > 1 ? ` +${h.files.length - 1}` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Missing from JSON */}
              {scanResult.hooks.filter(h => !h.inJson).length > 0 && (
                <div>
                  <p className="section-label mb-2 text-danger">
                    Missing in sounds.json — game calls them but not defined ({scanResult.hooks.filter(h => !h.inJson).length})
                  </p>
                  <div className="space-y-1">
                    {scanResult.hooks.filter(h => !h.inJson).map(h => (
                      <div key={h.name} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-danger-dim border border-danger/20">
                        <span className="font-mono text-[12px] text-danger flex-1">{h.name}</span>
                        {h.recent && <span className="text-xs text-yellow-500/80 shrink-0">NEW · {h.recent.relative}</span>}
                        <div className="text-xs text-text-dim font-mono truncate max-w-[180px]" title={h.files.join('\n')}>
                          {h.files[0]}{h.files.length > 1 ? ` +${h.files.length - 1}` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Populated hooks — all good */}
              {scanResult.hooks.filter(h => h.inJson && !h.isEmpty).length > 0 && (
                <div>
                  <p className="section-label mb-2 text-green">
                    Popunjeni — igra ih koristi i sounds.json ima akcije ({scanResult.hooks.filter(h => h.inJson && !h.isEmpty).length})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {scanResult.hooks.filter(h => h.inJson && !h.isEmpty).map(h => (
                      <button
                        key={h.name}
                        onClick={() => { setScanResult(null); setFilter(h.name); setExpanded(h.name); }}
                        title={h.recent ? `Dodat: ${h.recent.relative} — ${h.recent.message}` : ''}
                        className={`badge font-mono text-xs hover:bg-green/20 transition-colors cursor-pointer ${h.recent ? 'bg-yellow-500/10 border border-yellow-500/30 text-yellow-400' : 'bg-green-dim text-green'}`}
                      >
                        {h.name}{h.recent ? ' ✦' : ''}
                      </button>
                    ))}
                  </div>
                  {scanResult.hooks.filter(h => h.inJson && !h.isEmpty && h.recent).length > 0 && (
                    <p className="text-xs text-text-dim mt-1.5">✦ = new in the last 90 days</p>
                  )}
                </div>
              )}

              {/* Dead commands */}
              {scanResult.deadCommands.length > 0 && (
                <div>
                  <p className="section-label mb-2 text-text-dim">
                    Dead commands — in sounds.json but never called by the game ({scanResult.deadCommands.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {scanResult.deadCommands.map(n => (
                      <button
                        key={n}
                        onClick={() => { setScanResult(null); setFilter(n); setExpanded(n); }}
                        className="badge bg-bg-hover text-text-dim font-mono text-xs hover:text-text-secondary transition-colors cursor-pointer"
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-border flex justify-end">
              <button onClick={() => setScanResult(null)} className="btn-ghost text-xs px-4 py-2">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Auto-Generate Modal */}
      {genPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-bg-secondary border border-border rounded-2xl shadow-2xl w-[560px] max-h-[80vh] flex flex-col">
            <div className="p-5 border-b border-border">
              <h3 className="text-sm font-bold text-text-primary">Generate Missing Commands</h3>
              <p className="text-xs text-text-dim mt-0.5">
                {genPreview.filter(p => p.include).length} of {genPreview.length} selected. Edit hook names as needed.
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {genPreview.map((item, i) => (
                <div key={item.spriteId} className={`flex items-center gap-2 py-1 ${!item.include ? 'opacity-40' : ''}`}>
                  <input
                    type="checkbox"
                    checked={item.include}
                    onChange={e => setGenPreview(prev => prev.map((p, j) => j === i ? { ...p, include: e.target.checked } : p))}
                    className="w-3.5 h-3.5 accent-accent shrink-0"
                  />
                  <span className="font-mono text-xs text-text-dim w-44 truncate shrink-0">{item.spriteId}</span>
                  <svg className="w-3 h-3 text-text-dim shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                  <input
                    type="text"
                    value={item.hookName}
                    onChange={e => setGenPreview(prev => prev.map((p, j) => j === i ? { ...p, hookName: e.target.value } : p))}
                    className="input-base text-xs py-1 px-2 flex-1 font-mono"
                    disabled={!item.include}
                  />
                  <span className="text-xs text-text-dim shrink-0">
                    {item.actions[0]?.loop === -1 ? 'loop' : 'play'}
                  </span>
                </div>
              ))}
            </div>

            <div className="p-4 border-t border-border flex items-center gap-2">
              <button
                onClick={() => setGenPreview(prev => prev.map(p => ({ ...p, include: true })))}
                className="text-xs text-text-dim hover:text-text-primary transition-colors"
              >
                Select all
              </button>
              <button
                onClick={() => setGenPreview(prev => prev.map(p => ({ ...p, include: false })))}
                className="text-xs text-text-dim hover:text-text-primary transition-colors ml-2"
              >
                Deselect all
              </button>
              <div className="flex-1" />
              <button onClick={() => setGenPreview(null)} className="btn-ghost text-xs px-4 py-2">Cancel</button>
              <button onClick={handleApplyGen} disabled={saving || !genPreview.some(p => p.include)} className="btn-primary text-xs px-4 py-2 disabled:opacity-40">
                {saving ? 'Saving...' : `Add ${genPreview.filter(p => p.include).length} Commands`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
