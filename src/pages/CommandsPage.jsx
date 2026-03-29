import React, { useState, useEffect, useMemo, useCallback } from 'react';

const COMMANDS = ['Play', 'Stop', 'Fade', 'Set', 'Pause', 'Resume', 'Execute', 'ResetSpriteList'];

function StepForm({ state, setState, soundSprites, spriteLists, commands, onCreateList }) {
  const spriteIds = Object.keys(soundSprites).sort();
  const spriteListIds = Object.keys(spriteLists).sort();
  const commandIds = Object.keys(commands).sort();
  const [creatingList, setCreatingList] = React.useState(null); // { name, items, type, overlap }

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
            onChange={e => { setCreatingList(null); setState(m => ({ ...m, command: e.target.value, commandId: '', spriteId: '', spriteListId: '', targetType: 'sprite' })); }}
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
        ) : (
          <div>
            <div className="flex items-center gap-2 mb-1">
              <label className="section-label">Target</label>
              <div className="flex gap-1">
                <button type="button"
                  onClick={() => { setCreatingList(null); setState(m => ({ ...m, targetType: 'sprite', spriteListId: '' })); }}
                  className={`text-xs px-2 py-0.5 rounded border transition-colors ${state.targetType !== 'list' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-text-dim hover:border-border-bright'}`}
                >Sprite</button>
                <button type="button"
                  onClick={() => setState(m => ({ ...m, targetType: 'list', spriteId: '' }))}
                  className={`text-xs px-2 py-0.5 rounded border transition-colors ${state.targetType === 'list' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-text-dim hover:border-border-bright'}`}
                >List</button>
              </div>
            </div>
            {state.targetType === 'list' ? (
              creatingList ? (
                <div className="space-y-2.5 border border-accent/20 rounded-xl p-3 bg-accent/[0.03]">
                  {/* Row 1: List name — full width */}
                  <input type="text" value={creatingList.name} onChange={e => setCreatingList(p => ({ ...p, name: e.target.value }))}
                    placeholder="sl_ListName" className="input-base text-xs font-mono w-full py-1.5" maxLength={100} autoFocus />

                  {/* Row 2: Type + Overlap */}
                  <div className="flex items-center gap-3">
                    <select value={creatingList.type} onChange={e => setCreatingList(p => ({ ...p, type: e.target.value }))} className="input-base text-xs py-1.5 w-32">
                      <option value="random">random</option>
                      <option value="sequential">sequential</option>
                    </select>
                    <label className="flex items-center gap-1.5 cursor-pointer shrink-0">
                      <input type="checkbox" checked={creatingList.overlap} onChange={e => setCreatingList(p => ({ ...p, overlap: e.target.checked }))} className="w-3.5 h-3.5 accent-accent" />
                      <span className="text-xs text-text-dim">Overlap</span>
                    </label>
                  </div>

                  {/* Row 3: Sprites */}
                  <div className="space-y-1">
                    {creatingList.items.map((id, idx) => (
                      <div key={idx} className="flex items-center gap-1.5">
                        <span className="text-text-dim text-xs w-4 text-right tabular-nums shrink-0">{idx + 1}</span>
                        <select value={id} onChange={e => setCreatingList(p => { const items = [...p.items]; items[idx] = e.target.value; return { ...p, items }; })} className="input-base text-xs font-mono flex-1 py-1">
                          <option value="">— select sprite —</option>
                          {spriteIds.map(s => <option key={s}>{s}</option>)}
                        </select>
                        <button type="button" onClick={() => setCreatingList(p => ({ ...p, items: p.items.filter((_, i) => i !== idx) }))} className="w-5 h-5 flex items-center justify-center rounded text-text-dim hover:text-danger transition-colors">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    ))}
                    <button type="button" onClick={() => setCreatingList(p => ({ ...p, items: [...p.items, ''] }))} className="text-xs text-accent hover:text-accent/80 transition-colors pt-0.5">+ Add Sprite</button>
                  </div>

                  {/* Row 4: Actions */}
                  <div className="flex gap-2 items-center pt-0.5">
                    <button type="button" onClick={() => setCreatingList(null)} className="text-xs text-text-dim hover:text-text-primary transition-colors">Cancel</button>
                    <div className="flex-1" />
                    <button type="button" onClick={async () => {
                      const name = creatingList.name.trim();
                      const items = creatingList.items.filter(Boolean);
                      if (!name || !items.length) return;
                      const ok = onCreateList ? await onCreateList({ name, items, type: creatingList.type, overlap: creatingList.overlap }) : false;
                      if (ok) {
                        setState(m => ({ ...m, spriteListId: name }));
                        setCreatingList(null);
                      }
                    }} disabled={!creatingList.name.trim() || creatingList.items.filter(Boolean).length === 0}
                      className="btn-primary text-xs py-1.5 px-4 disabled:opacity-40">Create & Select</button>
                  </div>
                </div>
              ) : spriteListIds.length > 0 ? (
                <div className="flex gap-1.5">
                  <select
                    value={state.spriteListId || ''}
                    onChange={e => setState(m => ({ ...m, spriteListId: e.target.value }))}
                    className="input-base text-xs flex-1 font-mono"
                  >
                    <option value="">— select —</option>
                    {spriteListIds.map(id => <option key={id}>{id}</option>)}
                  </select>
                  <button type="button" onClick={() => setCreatingList({ name: '', items: ['', ''], type: 'random', overlap: true })}
                    className="btn-ghost text-xs py-1 px-2 shrink-0" title="Create a new sprite list inline">+ New</button>
                </div>
              ) : (
                <button type="button" onClick={() => setCreatingList({ name: '', items: ['', ''], type: 'random', overlap: true })}
                  className="btn-ghost text-xs py-1 w-full" title="No sprite lists yet — create one">+ Create Sprite List</button>
              )
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
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={state.overlap}
              onChange={e => setState(m => ({ ...m, overlap: e.target.checked }))}
              className="w-4 h-4 accent-accent"
            />
            <span className="text-xs text-text-secondary">Overlap</span>
          </label>
        </div>
      )}
    </div>
  );
}

function emptyStep(overrides = {}) {
  return {
    command: 'Play', commandId: '', spriteId: '', spriteListId: '',
    targetType: 'sprite', volume: 1, delay: '', loop: false, overlap: false,
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
    overlap: action.overlap === 'true' || action.overlap === true,
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
  const [renameCmd, setRenameCmd] = useState(null);
  const [scanResult, setScanResult] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanFixInclude, setScanFixInclude] = useState({ add: {}, remove: {}, fill: {} });
  const [viewTab, setViewTab_] = useState('commands'); // 'commands' | 'lists'
  const setViewTab = (tab) => { setViewTab_(tab); setExpanded(null); setFilter(''); };
  const [newList, setNewList] = useState(null); // { name, items, type, overlap, tags }
  const [editList, setEditList] = useState(null); // { name, items, type, overlap, tags }
  const [editListInline, setEditListInline] = useState(null); // { name, items, type, overlap, loop, tags, cmdName, stepIdx }
  const [confirmDeleteList, setConfirmDeleteList] = useState(null);

  useEffect(() => {
    setFilter(''); setExpanded(null); setGenPreview(null);
    setNewCmd(null); setAddStep(null); setEditStep(null); setConfirmDeleteCmd(null);
    setRenameCmd(null); setScanResult(null); setScanFixInclude({ add: {}, remove: {}, fill: {} });
    setNewList(null); setEditList(null); setEditListInline(null); setConfirmDeleteList(null);
  }, [project?.path]);

  // Close inline list editor when command expand/collapse changes
  useEffect(() => { setEditListInline(null); setConfirmDeleteCmd(null); setRenameCmd(null); }, [expanded]);

  const commands = project?.soundsJson?.soundDefinitions?.commands || {};
  const soundSprites = project?.soundsJson?.soundDefinitions?.soundSprites || {};
  const spriteLists = project?.soundsJson?.soundDefinitions?.spriteList || {};

  // Reverse map: hookName → spriteId (for auto-matching scan results to sprites)
  const scanSpriteMap = useMemo(() => {
    const map = {};
    for (const id of Object.keys(soundSprites)) {
      map[suggestHookName(id)] = id;
    }
    return map;
  }, [soundSprites]);

  // Clear stale scan results when commands change (user edited in Commands tab)
  const commandKeys = Object.keys(commands).join(',');
  useEffect(() => { setScanResult(null); }, [commandKeys]);

  useEffect(() => {
    if (!scanResult) { setScanFixInclude({ add: {}, remove: {}, fill: {} }); return; }
    const add = {}, remove = {}, fill = {};
    scanResult.hooks.filter(h => !h.inJson).forEach(h => { add[h.name] = true; });
    (scanResult.deadCommands || []).forEach(n => { remove[n] = true; });
    // Only pre-select empty hooks that have a sprite match (others can't be auto-filled)
    scanResult.hooks.filter(h => h.inJson && h.isEmpty).forEach(h => {
      fill[h.name] = !!scanSpriteMap[h.name];
    });
    setScanFixInclude({ add, remove, fill });
  }, [scanResult, scanSpriteMap]);

  const referencedSprites = useMemo(() => {
    const refs = new Set();
    for (const actions of Object.values(commands)) {
      for (const a of actions) {
        if (a.spriteId) refs.add(a.spriteId);
        if (a.spriteListId && spriteLists[a.spriteListId]) {
          const list = spriteLists[a.spriteListId];
          const items = Array.isArray(list) ? list : (list?.items || []);
          for (const item of items) { if (item) refs.add(item); }
        }
      }
    }
    return refs;
  }, [commands, spriteLists]);

  const allSpriteIds = useMemo(() => Object.keys(soundSprites).sort(), [soundSprites]);

  const unmapped = useMemo(() =>
    allSpriteIds.filter(id => !referencedSprites.has(id)),
    [allSpriteIds, referencedSprites]
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

    // Target: spriteId or spriteListId (all target-based commands support both)
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
    if (s.overlap) step.overlap = true;

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
    if (ok) { setEditStep(null); setEditListInline(null); }
  };

  const handleDeleteStep = async (cmdName, stepIdx) => {
    const j = structuredClone(project.soundsJson);
    j.soundDefinitions.commands[cmdName].splice(stepIdx, 1);
    setEditListInline(null);
    await saveJson(j, 'Step obrisan');
  };

  const handleDeleteCmd = async (cmdName) => {
    const j = structuredClone(project.soundsJson);
    delete j.soundDefinitions.commands[cmdName];
    setConfirmDeleteCmd(null);
    const ok = await saveJson(j, `Command "${cmdName}" deleted`);
    if (ok) setExpanded(null);
  };

  const handleRenameCmd = async () => {
    if (saving) return;
    const newName = renameCmd.newName.trim();
    const oldName = renameCmd.oldName;
    if (!newName || newName === oldName) { setRenameCmd(null); return; }
    if (commands[newName]) { showToast(`"${newName}" već postoji`, 'error'); return; }
    const j = structuredClone(project.soundsJson);
    j.soundDefinitions.commands[newName] = j.soundDefinitions.commands[oldName];
    delete j.soundDefinitions.commands[oldName];
    const ok = await saveJson(j, `Renamed "${oldName}" → "${newName}"`);
    if (ok) { setRenameCmd(null); setExpanded(newName); }
  };

  const handleApplyScanFixes = async () => {
    setSaving(true);
    try {
      const j = structuredClone(project.soundsJson);
      const cmds = j.soundDefinitions.commands;
      let added = 0, filled = 0, removed = 0;

      // Add missing hooks
      for (const [name, include] of Object.entries(scanFixInclude.add)) {
        if (!include) continue;
        const spriteId = scanSpriteMap[name];
        cmds[name] = spriteId ? suggestActions(spriteId) : [];
        added++;
      }

      // Fill empty hooks with auto-matched actions
      for (const [name, include] of Object.entries(scanFixInclude.fill)) {
        if (!include) continue;
        const spriteId = scanSpriteMap[name];
        if (spriteId) {
          cmds[name] = suggestActions(spriteId);
          filled++;
        }
      }

      // Remove dead commands
      for (const [name, include] of Object.entries(scanFixInclude.remove)) {
        if (!include) continue;
        delete cmds[name];
        removed++;
      }

      if (!added && !filled && !removed) {
        showToast('Ništa nije selektovano', 'error');
        setSaving(false);
        return;
      }

      const parts = [];
      if (added) parts.push(`${added} dodato`);
      if (filled) parts.push(`${filled} popunjeno`);
      if (removed) parts.push(`${removed} obrisano`);

      const ok = await saveJson(j, parts.join(', '));
      if (ok) {
        // Reset UI state — deleted commands may still be referenced by expanded/rename/etc.
        setExpanded(null);
        setRenameCmd(null);
        setConfirmDeleteCmd(null);
        setEditStep(null);
        setAddStep(null);
        setScanResult(null);
      }
    } catch (e) {
      showToast('Apply failed: ' + e.message, 'error');
      setSaving(false);
    }
  };

  // Inline create list from StepForm
  const handleInlineCreateList = async ({ name, items, type, overlap, loop }) => {
    if (saving) return false;
    const j = structuredClone(project.soundsJson);
    if (!j.soundDefinitions.spriteList) j.soundDefinitions.spriteList = {};
    if (j.soundDefinitions.spriteList[name]) { showToast(`"${name}" already exists`, 'error'); return false; }
    const entry = { items, type, overlap };
    if (loop) entry.loop = loop;
    j.soundDefinitions.spriteList[name] = entry;
    return await saveJson(j, `Sprite list "${name}" created`);
  };

  // ── Sprite List handlers ──
  const handleSaveNewList = async () => {
    if (saving) return;
    if (!newList?.name?.trim()) return;
    const name = newList.name.trim();
    if (spriteLists[name]) { showToast(`"${name}" already exists`, 'error'); return; }
    const cleanItems = newList.items.filter(Boolean);
    if (!cleanItems.length) { showToast('Add at least one sprite', 'error'); return; }
    const j = structuredClone(project.soundsJson);
    if (!j.soundDefinitions.spriteList) j.soundDefinitions.spriteList = {};
    const entry = { items: cleanItems, type: newList.type, overlap: newList.overlap };
    if (newList.loop) entry.loop = newList.loop;
    if (newList.tags?.length) entry.tags = newList.tags;
    j.soundDefinitions.spriteList[name] = entry;
    const ok = await saveJson(j, `Sprite list "${name}" created`);
    if (ok) setNewList(null);
  };

  const handleSaveEditList = async () => {
    if (saving) return;
    if (!editList?.name) return;
    const j = structuredClone(project.soundsJson);
    if (!j.soundDefinitions.spriteList) j.soundDefinitions.spriteList = {};
    const cleanItems = editList.items.filter(Boolean);
    if (!cleanItems.length) { showToast('Add at least one sprite', 'error'); return; }
    const entry = { items: cleanItems, type: editList.type, overlap: editList.overlap };
    if (editList.loop) entry.loop = editList.loop;
    if (editList.tags?.length) entry.tags = editList.tags;
    j.soundDefinitions.spriteList[editList.name] = entry;
    const ok = await saveJson(j, `Sprite list "${editList.name}" updated`);
    if (ok) setEditList(null);
  };

  const handleSaveEditListInline = async () => {
    if (saving || !editListInline?.name) return;
    const cleanItems = editListInline.items.filter(Boolean);
    if (!cleanItems.length) { showToast('Add at least one sprite', 'error'); return; }
    const j = structuredClone(project.soundsJson);
    if (!j.soundDefinitions.spriteList) j.soundDefinitions.spriteList = {};
    const entry = { items: cleanItems, type: editListInline.type, overlap: editListInline.overlap };
    if (editListInline.loop) entry.loop = editListInline.loop;
    if (editListInline.tags?.length) entry.tags = editListInline.tags;
    j.soundDefinitions.spriteList[editListInline.name] = entry;
    const ok = await saveJson(j, `List "${editListInline.name}" updated`);
    if (ok) setEditListInline(null);
  };

  const handleDeleteList = async (name) => {
    if (saving) return;
    const j = structuredClone(project.soundsJson);
    if (!j.soundDefinitions.spriteList) return;
    delete j.soundDefinitions.spriteList[name];
    setConfirmDeleteList(null);
    await saveJson(j, `Sprite list "${name}" deleted`);
  };

  const spriteListNames = useMemo(() =>
    Object.keys(spriteLists).filter(n => n.toLowerCase().includes(filter.toLowerCase())).sort(),
    [spriteLists, filter]
  );

  return (
    <div className="anim-fade-up h-full flex flex-col gap-2">
      <div className="shrink-0 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 bg-bg-hover/50 rounded-lg p-0.5">
          <button onClick={() => setViewTab('commands')} className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${viewTab === 'commands' ? 'bg-accent/20 text-accent' : 'text-text-dim hover:text-text-secondary'}`}>
            Commands
          </button>
          <button onClick={() => setViewTab('lists')} className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${viewTab === 'lists' ? 'bg-accent/20 text-accent' : 'text-text-dim hover:text-text-secondary'}`}>
            Sprite Lists
          </button>
        </div>
        {viewTab === 'commands' && (
          <>
            <span className="badge bg-cyan-dim text-cyan" title="Total number of sound commands defined in sounds.json">{Object.keys(commands).length}</span>
            {totalIssues > 0 && <span className="badge bg-danger-dim text-danger" title="Commands with missing sprite or list references">{totalIssues} broken</span>}
          </>
        )}
        {viewTab === 'lists' && (
          <span className="badge bg-purple-dim text-purple" title="Sprite lists group multiple sprites for random/sequential playback">{Object.keys(spriteLists).length}</span>
        )}
        <div className="flex items-center gap-2">
          {viewTab === 'commands' && (
            <>
              <button
                onClick={handleScan}
                disabled={scanning || !project?.settings?.gameProjectPath}
                className="btn-ghost text-xs py-2 flex items-center gap-1.5 border-cyan/30 text-cyan hover:border-cyan/60 disabled:opacity-40 disabled:cursor-not-allowed"
                title={!project?.settings?.gameProjectPath ? 'Game repo not configured' : 'Scan game source code and frameworks for soundManager.execute() calls — find missing, empty, and unused commands'}
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
                <button onClick={handleOpenGen} className="btn-ghost text-xs py-2 flex items-center gap-1.5" title="Auto-generate commands for sprites that have no command referencing them">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Generate Missing ({unmapped.length})
                </button>
              )}
              <button
                onClick={() => setNewCmd(emptyStep({ hookName: '' }))}
                disabled={saving}
                title="Create a new sound command with a hook name and action steps"
                className="btn-primary text-xs py-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                + New Command
              </button>
            </>
          )}
          {viewTab === 'lists' && (
            <button
              onClick={() => setNewList({ name: '', items: [], type: 'random', overlap: true, tags: [] })}
              disabled={saving}
              title="Create a new sprite list — groups sprites for random or sequential playback"
              className="btn-primary text-xs py-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              + New Sprite List
            </button>
          )}
        </div>
      </div>

      {viewTab === 'commands' && unmapped.length > 0 && (
        <div className="card p-3 border border-orange/30 flex items-center gap-3 shrink-0">
          <span className="badge bg-orange-dim text-orange text-xs shrink-0" title="Sprites defined in soundSprites but not referenced by any command">Unmapped</span>
          <p className="text-xs text-text-dim flex-1">
            {unmapped.length} sound{unmapped.length !== 1 ? 's' : ''} in soundSprites with no command referencing them
          </p>
        </div>
      )}

      <input
        type="text"
        placeholder={viewTab === 'commands' ? 'Search commands...' : 'Search sprite lists...'}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="input-base shrink-0"
      />

      {/* ── Sprite Lists View ── */}
      {viewTab === 'lists' && (
        <div className="flex-1 min-h-0 overflow-y-auto pr-1" style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
          {spriteListNames.map((name) => {
            const list = spriteLists[name];
            const items = Array.isArray(list) ? list : (list?.items || []);
            const listType = list?.type || 'random';
            const overlap = list?.overlap ?? false;
            const tags = list?.tags || [];
            return (
              <div key={name} style={{ borderBottom: '1px solid rgba(50,50,90,0.15)' }}>
                <div className="w-full flex items-center gap-3 px-4 py-3">
                  <button onClick={() => setExpanded(expanded === name ? null : name)} className="flex items-center gap-3 min-w-0 hover:bg-bg-hover/50 transition-colors text-left rounded-md">
                    <svg className={`w-3.5 h-3.5 text-text-dim transition-transform shrink-0 ${expanded === name ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20"><path d="M6 4l8 6-8 6V4z" /></svg>
                    <span className="text-[15px] font-mono truncate">{name}</span>
                  </button>
                  <span className="badge bg-purple-dim text-purple text-xs shrink-0" title={`Playback type: ${listType}`}>{listType}</span>
                  {overlap && <span className="text-xs text-text-dim" title="Sounds can overlap when played">overlap</span>}
                  <span className="text-xs text-text-dim shrink-0">{items.length}</span>
                </div>

                {expanded === name && (
                  <div className="px-4 pb-4 pt-3 border-t border-border/50 space-y-1.5 anim-fade-in bg-white/[0.01]">
                    {/* Items */}
                    {items.map((id, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-[13px] py-1" style={{ borderBottom: idx < items.length - 1 ? '1px solid rgba(50,50,90,0.1)' : 'none' }}>
                        <span className="text-text-dim w-5 text-right tabular-nums shrink-0">{idx + 1}</span>
                        <span className={`font-mono flex-1 truncate ${soundSprites[id] ? 'text-text-primary' : 'text-danger line-through'}`}>{id}</span>
                      </div>
                    ))}
                    {tags.length > 0 && (
                      <div className="flex gap-1 pt-1">
                        {tags.map(t => <span key={t} className="badge bg-bg-hover text-text-dim text-xs">{t}</span>)}
                      </div>
                    )}
                    <div className="flex items-center gap-2 pt-1">
                      <button onClick={() => setEditList({ name, items: [...items], type: listType, overlap, tags: [...tags] })} disabled={saving} className="text-xs text-text-dim hover:text-accent transition-colors" title="Edit sprite list items, type, and settings">Edit</button>
                      {confirmDeleteList === name ? (
                        <>
                          <span className="text-xs text-danger">Delete?</span>
                          <button onClick={() => handleDeleteList(name)} disabled={saving} className="text-xs text-danger font-semibold hover:text-red-400 transition-colors">Yes</button>
                          <button onClick={() => setConfirmDeleteList(null)} className="text-xs text-text-dim hover:text-text-primary transition-colors">Cancel</button>
                        </>
                      ) : (
                        <button onClick={() => setConfirmDeleteList(name)} disabled={saving} className="text-xs text-text-dim hover:text-danger transition-colors" title="Remove this sprite list from sounds.json">Delete</button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {spriteListNames.length === 0 && (
            <div className="text-center py-12 text-text-dim text-sm">
              {filter ? 'No sprite lists match filter' : 'No sprite lists defined — click + New Sprite List to create one'}
            </div>
          )}
        </div>
      )}

      {/* ── Commands View ── */}
      {viewTab === 'commands' && <div className="flex-1 min-h-0 overflow-y-auto pr-1" style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
        {cmdNames.map((name) => {
          const actions = commands[name] || [];
          const issues = getIssues(name);
          const isOpen = expanded === name;
          return (
            <div key={name} style={{ borderBottom: '1px solid rgba(50,50,90,0.15)' }}>
              <div className="w-full flex items-center gap-3 px-4 py-3">
                <button
                  onClick={() => setExpanded(isOpen ? null : name)}
                  className="flex items-center gap-3 min-w-0 hover:bg-bg-hover/50 transition-colors text-left rounded-md"
                >
                  <svg className={`w-3.5 h-3.5 text-text-dim transition-transform shrink-0 ${isOpen ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                    <path d="M6 4l8 6-8 6V4z" />
                  </svg>
                  <span className="text-[15px] font-mono truncate">{name}</span>
                </button>
                <span className="text-xs text-text-dim shrink-0">{actions.length}</span>
                {issues.length > 0 && <span className="badge bg-danger-dim text-danger shrink-0">{issues.length} err</span>}
                {isOpen && renameCmd?.oldName !== name && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); setRenameCmd({ oldName: name, newName: name }); }}
                      disabled={saving}
                      className="w-6 h-6 flex items-center justify-center rounded-md bg-white/[0.03] text-text-dim hover:text-accent hover:bg-accent/10 transition-colors"
                      title="Rename"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteCmd(name); }}
                      disabled={saving}
                      className="w-6 h-6 flex items-center justify-center rounded-md bg-white/[0.03] text-text-dim hover:text-danger hover:bg-danger/10 transition-colors"
                      title="Delete command"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>

              {isOpen && (
                <div className="px-4 pb-4 pt-3 border-t border-border/50 space-y-1.5 anim-fade-in bg-white/[0.01]">
                  {/* Rename command */}
                  {renameCmd?.oldName === name && (
                    <div className="flex items-center gap-2 py-1.5 px-2 rounded-lg bg-accent/5 border border-accent/30">
                      <label className="text-xs text-text-dim shrink-0">Rename:</label>
                      <input
                        type="text"
                        value={renameCmd.newName}
                        onChange={e => setRenameCmd(prev => ({ ...prev, newName: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') handleRenameCmd(); if (e.key === 'Escape') setRenameCmd(null); }}
                        className="input-base text-xs font-mono py-1 px-2 flex-1"
                        maxLength={100}
                        autoFocus
                      />
                      <button onClick={handleRenameCmd} disabled={saving || !renameCmd.newName.trim()} className="text-xs text-accent font-semibold hover:text-accent/80 transition-colors disabled:opacity-40">Save</button>
                      <button onClick={() => setRenameCmd(null)} className="text-xs text-text-dim hover:text-text-primary transition-colors">Cancel</button>
                    </div>
                  )}

                  {/* Delete command confirm */}
                  {confirmDeleteCmd === name && (
                    <div className="flex items-center gap-2 py-1.5 px-2 rounded-lg bg-danger-dim border border-danger/30">
                      <span className="text-xs text-danger flex-1">Obrisati celu komandu?</span>
                      <button onClick={() => handleDeleteCmd(name)} disabled={saving} className="text-xs text-danger font-semibold hover:text-red-400 transition-colors">Yes, delete</button>
                      <button onClick={() => setConfirmDeleteCmd(null)} className="text-xs text-text-dim hover:text-text-primary transition-colors">Cancel</button>
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
                          <StepForm state={editStep} setState={setEditStep} soundSprites={soundSprites} spriteLists={spriteLists} commands={commands} onCreateList={handleInlineCreateList} />
                          <div className="flex gap-2 justify-end">
                            <button onClick={() => setEditStep(null)} className="btn-ghost text-xs py-1 px-3">Cancel</button>
                            <button onClick={handleSaveEditStep} disabled={saving} className="btn-primary text-xs py-1 px-3 disabled:opacity-40">
                              {saving ? '...' : 'Save'}
                            </button>
                          </div>
                        </div>
                      );
                    }
                    const listEditActive = editListInline?.cmdName === name && editListInline?.stepIdx === idx;
                    return (
                      <div key={idx} style={{ borderBottom: idx < actions.length - 1 ? '1px solid rgba(50,50,90,0.12)' : 'none' }}>
                        <div className="flex items-center gap-2 text-[13px] py-1.5 group/step">
                          <span className="text-text-dim w-5 text-right tabular-nums shrink-0">{idx + 1}</span>
                          <span className="badge bg-cyan-dim text-cyan shrink-0">{action.command}</span>

                          {/* Target display */}
                          {action.commandId && (
                            <span className={`font-mono truncate ${commands[action.commandId] ? 'text-accent' : 'text-danger line-through'}`}>
                              → {action.commandId}
                            </span>
                          )}
                          {action.spriteId && (
                            <span className={`font-mono truncate ${soundSprites[action.spriteId] ? 'text-text-primary' : 'text-danger line-through'}`}>
                              {action.spriteId}
                            </span>
                          )}
                          {action.spriteListId && (
                            <span className={`font-mono ${spriteLists[action.spriteListId] ? 'text-purple' : 'text-danger line-through'}`}>
                              list:{action.spriteListId}
                            </span>
                          )}

                          {/* Extra fields */}
                          {action.volume !== undefined && action.volume !== 1 && <span className="text-text-dim text-xs">vol:{action.volume}</span>}
                          {action.delay !== undefined && action.delay !== 0 && <span className="text-text-dim text-xs">+{action.delay}ms</span>}
                          {action.duration !== undefined && action.duration !== 0 && <span className="text-text-dim text-xs">dur:{action.duration}ms</span>}
                          {action.pan !== undefined && action.pan !== 0 && <span className="text-text-dim text-xs">pan:{action.pan}</span>}
                          {action.rate !== undefined && action.rate !== 1 && <span className="text-text-dim text-xs">rate:{action.rate}</span>}
                          {action.loop === -1 && <span className="text-cyan text-xs">loop</span>}
                          {(action.cancelDelay === true || action.cancelDelay === 'true') && <span className="text-orange text-xs">cancelDelay</span>}
                          {(action.overlap === true || action.overlap === 'true') && <span className="text-purple text-xs">overlap</span>}

                          <div className={`flex items-center gap-2 transition-opacity shrink-0 ${listEditActive ? 'opacity-100' : 'opacity-0 group-hover/step:opacity-100'}`}>
                            {action.spriteListId && spriteLists[action.spriteListId] && (
                              <button
                                onClick={() => {
                                  if (listEditActive) { setEditListInline(null); return; }
                                  const list = spriteLists[action.spriteListId];
                                  const items = Array.isArray(list) ? [...list] : [...(list?.items || [])];
                                  setEditListInline({
                                    name: action.spriteListId, items, type: list?.type || 'random',
                                    overlap: list?.overlap ?? false, loop: list?.loop || 0,
                                    tags: [...(list?.tags || [])], cmdName: name, stepIdx: idx
                                  });
                                }}
                                disabled={saving}
                                className={`w-6 h-6 flex items-center justify-center rounded-md bg-white/[0.03] transition-colors ${listEditActive ? 'text-purple' : 'text-text-dim hover:text-purple hover:bg-purple/10'}`}
                                title={`Edit sprite list "${action.spriteListId}"`}
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h8m-8 6h16" />
                                </svg>
                              </button>
                            )}
                            <button
                              onClick={() => { setEditListInline(null); setEditStep({ cmdName: name, stepIdx: idx, ...stepFromAction(action) }); }}
                              disabled={saving}
                              className="w-6 h-6 flex items-center justify-center rounded-md bg-white/[0.03] text-text-dim hover:text-accent hover:bg-accent/10 transition-colors"
                              title="Edit step"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleDeleteStep(name, idx)}
                              disabled={saving}
                              className="w-6 h-6 flex items-center justify-center rounded-md bg-white/[0.03] text-text-dim hover:text-danger hover:bg-danger/10 transition-colors"
                              title="Delete step"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        </div>

                        {/* Inline sprite list editor */}
                        {listEditActive && (
                          <div className="ml-7 my-1 rounded-lg border border-purple/30 bg-purple/[0.03] p-3 space-y-2 anim-fade-in">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-mono font-semibold text-purple">{editListInline.name}</span>
                              <div className="flex-1" />
                              <select value={editListInline.type} onChange={e => setEditListInline(p => ({ ...p, type: e.target.value }))} className="input-base text-xs py-0.5 px-1.5 w-auto">
                                <option value="random">random</option>
                                <option value="sequential">sequential</option>
                              </select>
                              <label className="flex items-center gap-1.5 cursor-pointer shrink-0">
                                <input type="checkbox" checked={editListInline.overlap} onChange={e => setEditListInline(p => ({ ...p, overlap: e.target.checked }))} className="w-3 h-3 accent-accent" />
                                <span className="text-xs text-text-dim">Overlap</span>
                              </label>
                              <div className="flex items-center gap-1 shrink-0">
                                <span className="text-xs text-text-dim">Loop:</span>
                                <input type="number" min="-1" step="1" value={editListInline.loop ?? 0} onChange={e => setEditListInline(p => ({ ...p, loop: parseInt(e.target.value) || 0 }))}
                                  className="input-base text-xs py-0.5 w-12 text-center" title="Loop count (-1 = infinite)" />
                              </div>
                            </div>

                            <div className="space-y-1">
                              {editListInline.items.map((id, i) => (
                                <div key={i} className="flex items-center gap-1.5">
                                  <span className="text-text-dim text-xs w-4 text-right tabular-nums shrink-0">{i + 1}</span>
                                  <select value={id} onChange={e => setEditListInline(p => { const items = [...p.items]; items[i] = e.target.value; return { ...p, items }; })} className="input-base text-xs font-mono flex-1 py-0.5">
                                    <option value="">— select sprite —</option>
                                    {allSpriteIds.map(s => <option key={s}>{s}</option>)}
                                  </select>
                                  <button onClick={() => setEditListInline(p => ({ ...p, items: p.items.filter((_, j) => j !== i) }))} className="w-5 h-5 flex items-center justify-center rounded text-text-dim hover:text-danger transition-colors" title="Remove sprite">
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                                  </button>
                                </div>
                              ))}
                              <button onClick={() => setEditListInline(p => ({ ...p, items: [...p.items, ''] }))} className="text-xs text-accent hover:text-accent/80 transition-colors">+ Add Sprite</button>
                            </div>

                            <div className="flex gap-2 justify-end pt-0.5">
                              <button onClick={() => setEditListInline(null)} className="text-xs text-text-dim hover:text-text-primary transition-colors">Cancel</button>
                              <button onClick={handleSaveEditListInline} disabled={saving || editListInline.items.filter(Boolean).length === 0}
                                className="btn-primary text-xs py-1 px-3 disabled:opacity-40">
                                {saving ? '...' : 'Save List'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  <button
                    onClick={() => setAddStep(emptyStep({ cmdName: name }))}
                    disabled={saving}
                    className="text-xs text-text-dim hover:text-accent transition-colors pt-1 disabled:opacity-40"
                    title="Add a new action step to this command"
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
      </div>}

      {/* New/Edit Sprite List Modal */}
      {(newList || editList) && (() => {
        const isNew = !!newList;
        const st = newList || editList;
        const setSt = isNew ? setNewList : setEditList;
        const handleSave = isNew ? handleSaveNewList : handleSaveEditList;
        const spriteIds = Object.keys(soundSprites).sort();
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setSt(null)} onKeyDown={e => { if (e.key === 'Escape') setSt(null); }}>
            <div className="bg-bg-secondary border border-border rounded-2xl shadow-2xl w-[520px] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="p-5 border-b border-border">
                <h3 className="text-sm font-bold text-text-primary">{isNew ? 'New Sprite List' : `Edit: ${st.name}`}</h3>
              </div>
              <div className="p-5 space-y-4 flex-1 overflow-y-auto">
                {isNew && (
                  <div>
                    <label className="section-label mb-1 block">List Name</label>
                    <input type="text" value={st.name} onChange={e => setSt(p => ({ ...p, name: e.target.value }))}
                      placeholder="e.g. sl_VOPreCog" className="input-base text-xs font-mono w-full" maxLength={100} autoFocus />
                  </div>
                )}
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="section-label mb-1 block">Type</label>
                    <select value={st.type} onChange={e => setSt(p => ({ ...p, type: e.target.value }))} className="input-base text-xs w-full">
                      <option value="random">random</option>
                      <option value="sequential">sequential</option>
                    </select>
                  </div>
                  <div>
                    <label className="section-label mb-1 block" title="How many times each sound loops when played. -1 = infinite, 0 = once">Loop</label>
                    <input type="number" min="-1" step="1" value={st.loop ?? 0} onChange={e => setSt(p => ({ ...p, loop: parseInt(e.target.value) || 0 }))} className="input-base text-xs w-16 text-center" />
                  </div>
                  <div className="flex items-end pb-1">
                    <label className="flex items-center gap-2 cursor-pointer" title="Allow multiple sounds from this list to play simultaneously">
                      <input type="checkbox" checked={st.overlap} onChange={e => setSt(p => ({ ...p, overlap: e.target.checked }))} className="w-4 h-4 accent-accent" />
                      <span className="text-xs text-text-secondary">Overlap</span>
                    </label>
                  </div>
                </div>

                <div>
                  <label className="section-label mb-1 block">Sprites ({st.items.length})</label>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {st.items.map((id, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="text-text-dim text-xs w-5 text-right tabular-nums shrink-0">{idx + 1}</span>
                        <select value={id} onChange={e => setSt(p => { const items = [...p.items]; items[idx] = e.target.value; return { ...p, items }; })} className="input-base text-xs font-mono flex-1 py-1">
                          <option value="">— select —</option>
                          {spriteIds.map(s => <option key={s}>{s}</option>)}
                        </select>
                        <button onClick={() => setSt(p => ({ ...p, items: p.items.filter((_, i) => i !== idx) }))} className="w-5 h-5 flex items-center justify-center rounded text-text-dim hover:text-danger transition-colors" title="Remove this sprite">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setSt(p => ({ ...p, items: [...p.items, ''] }))} className="text-xs text-accent hover:text-accent/80 transition-colors mt-1.5" title="Add another sprite to this list">
                    + Add Sprite
                  </button>
                </div>
              </div>
              <div className="p-4 border-t border-border flex gap-2 justify-end">
                <button onClick={() => setSt(null)} className="btn-ghost text-xs px-4 py-2">Cancel</button>
                <button onClick={handleSave} disabled={saving || (isNew && !st.name.trim()) || st.items.filter(Boolean).length === 0}
                  className="btn-primary text-xs px-4 py-2 disabled:opacity-40">
                  {saving ? 'Saving...' : isNew ? 'Create List' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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
              <StepForm state={newCmd} setState={setNewCmd} soundSprites={soundSprites} spriteLists={spriteLists} commands={commands} onCreateList={handleInlineCreateList} />
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
              <StepForm state={addStep} setState={setAddStep} soundSprites={soundSprites} spriteLists={spriteLists} commands={commands} onCreateList={handleInlineCreateList} />
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
      {scanResult && (() => {
        const missingHooks = scanResult.hooks.filter(h => !h.inJson);
        const emptyHooks = scanResult.hooks.filter(h => h.inJson && h.isEmpty);
        const okHooks = scanResult.hooks.filter(h => h.inJson && !h.isEmpty);
        const deadCmds = scanResult.deadCommands || [];
        const addCount = Object.values(scanFixInclude.add).filter(Boolean).length;
        const fillCount = Object.values(scanFixInclude.fill).filter(Boolean).length;
        const removeCount = Object.values(scanFixInclude.remove).filter(Boolean).length;
        const totalFixes = addCount + fillCount + removeCount;

        const toggleAdd = (name) => setScanFixInclude(p => ({ ...p, add: { ...p.add, [name]: !p.add[name] } }));
        const toggleFill = (name) => setScanFixInclude(p => ({ ...p, fill: { ...p.fill, [name]: !p.fill[name] } }));
        const toggleRemove = (name) => setScanFixInclude(p => ({ ...p, remove: { ...p.remove, [name]: !p.remove[name] } }));
        const toggleAllAdd = (val) => setScanFixInclude(p => ({ ...p, add: Object.fromEntries(missingHooks.map(h => [h.name, val])) }));
        const toggleAllFill = (val) => setScanFixInclude(p => ({ ...p, fill: Object.fromEntries(emptyHooks.map(h => [h.name, val])) }));
        const toggleAllRemove = (val) => setScanFixInclude(p => ({ ...p, remove: Object.fromEntries(deadCmds.map(n => [n, val])) }));

        const SectionHeader = ({ color, children, count, toggleAll, selectedCount, totalCount }) => (
          <div className="flex items-center gap-2 mb-2 pb-2 border-b border-border/50">
            <span className={`w-2 h-2 rounded-full ${color} shrink-0`} />
            <p className="text-xs font-semibold text-text-primary tracking-wide uppercase flex-1">{children}</p>
            <span className="text-xs text-text-dim tabular-nums">{count}</span>
            {toggleAll && (
              <button onClick={() => toggleAll(selectedCount < totalCount)} className="text-xs text-accent/70 hover:text-accent transition-colors ml-1">
                {selectedCount === totalCount ? 'None' : 'All'}
              </button>
            )}
          </div>
        );

        const HookRow = ({ name, checked, onChange, disabled, matched, showMatch, recent, files, selected, colorClass }) => (
          <div className={`flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all ${selected ? 'bg-white/[0.03] border border-border/60' : 'border border-transparent opacity-40'}`}>
            <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} className="w-3.5 h-3.5 accent-accent shrink-0 rounded" />
            <span className={`font-mono text-[12px] ${colorClass || 'text-text-primary'} flex-1 truncate`}>{name}</span>
            {showMatch && matched && <span className="text-[11px] text-accent/60 font-mono shrink-0">→ {matched}</span>}
            {showMatch && !matched && <span className="text-[11px] text-text-dim/50 shrink-0">no match</span>}
            {recent && <span className="text-[10px] text-yellow-500/60 shrink-0 font-medium">NEW</span>}
            {files && (
              <span className="text-[11px] text-text-dim/40 font-mono truncate max-w-[120px] shrink-0" title={files.join('\n')}>
                {files[0]}{files.length > 1 ? ` +${files.length - 1}` : ''}
              </span>
            )}
          </div>
        );

        const allClean = missingHooks.length === 0 && emptyHooks.length === 0 && deadCmds.length === 0;

        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setScanResult(null)} onKeyDown={e => { if (e.key === 'Escape') setScanResult(null); }}>
          <div className="bg-bg-secondary border border-border rounded-2xl shadow-2xl w-[700px] max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-text-primary tracking-tight">Hook Scanner</h3>
                <p className="text-[11px] text-text-dim/60 mt-0.5 tabular-nums">
                  {scanResult.totalFiles} files · {scanResult.hooks.length} hooks
                  {(scanResult.dynamicCalls || []).length > 0 && ` · ${scanResult.dynamicCalls.length} dynamic`}
                  {allClean && ' · All synced'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {totalFixes > 0 && (
                  <button
                    onClick={handleApplyScanFixes}
                    disabled={saving}
                    className="btn-primary text-xs px-4 py-1.5 disabled:opacity-40 flex items-center gap-1.5"
                  >
                    {saving ? (
                      <><span className="anim-pulse-dot w-1.5 h-1.5 rounded-full bg-white shrink-0" /> Applying...</>
                    ) : (
                      <>Apply {totalFixes}</>
                    )}
                  </button>
                )}
                <button onClick={() => setScanResult(null)} className="text-text-dim/40 hover:text-text-primary transition-colors p-1">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">

              {/* All clean state */}
              {allClean && okHooks.length > 0 && (
                <div className="text-center py-6">
                  <p className="text-sm text-green font-medium">All hooks are synced</p>
                  <p className="text-xs text-text-dim mt-1">{okHooks.length} hooks matched between game source and sounds.json</p>
                </div>
              )}

              {/* Recent hooks */}
              {(() => {
                const newHooks = scanResult.hooks.filter(h => h.recent).sort((a, b) => b.recent.timestamp - a.recent.timestamp);
                if (!newHooks.length) return null;
                return (
                  <div className="rounded-xl border border-yellow-500/15 bg-yellow-500/[0.03] p-4 space-y-2">
                    <SectionHeader color="bg-yellow-500" count={newHooks.length}>Recently changed</SectionHeader>
                    <div className="space-y-0.5">
                      {newHooks.map(h => {
                        const statusColor = !h.inJson ? 'text-orange' : h.isEmpty ? 'text-yellow-500/70' : 'text-green/70';
                        const statusLabel = !h.inJson ? 'MISSING' : h.isEmpty ? 'EMPTY' : 'OK';
                        return (
                          <div key={h.name} className="flex items-center gap-2 py-1 group">
                            <button
                              onClick={() => { setScanResult(null); setFilter(h.name); setExpanded(h.name); }}
                              className="font-mono text-[12px] text-text-secondary hover:text-accent transition-colors text-left truncate"
                            >{h.name}</button>
                            <span className={`text-[10px] font-semibold uppercase tracking-wider ${statusColor} shrink-0`}>{statusLabel}</span>
                            <span className="text-[11px] text-text-dim/40 shrink-0">{h.recent.relative}</span>
                            <span className="text-[11px] text-text-dim/30 truncate flex-1" title={h.recent.message}>{h.recent.message}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Missing from JSON */}
              {missingHooks.length > 0 && (
                <div>
                  <SectionHeader color="bg-orange" count={missingHooks.length} toggleAll={toggleAllAdd} selectedCount={addCount} totalCount={missingHooks.length}>
                    Not in sounds.json
                  </SectionHeader>
                  <div className="space-y-0.5">
                    {missingHooks.map(h => (
                      <HookRow key={h.name} name={h.name} checked={!!scanFixInclude.add[h.name]} onChange={() => toggleAdd(h.name)}
                        showMatch matched={scanSpriteMap[h.name]} recent={h.recent} files={h.files}
                        selected={!!scanFixInclude.add[h.name]} colorClass="text-text-secondary" />
                    ))}
                  </div>
                </div>
              )}

              {/* Empty hooks */}
              {emptyHooks.length > 0 && (
                <div>
                  <SectionHeader color="bg-yellow-500" count={emptyHooks.length} toggleAll={toggleAllFill} selectedCount={fillCount} totalCount={emptyHooks.length}>
                    Empty commands
                  </SectionHeader>
                  <div className="space-y-0.5">
                    {emptyHooks.map(h => {
                      const matched = scanSpriteMap[h.name];
                      return (
                        <HookRow key={h.name} name={h.name} checked={!!scanFixInclude.fill[h.name]} onChange={() => toggleFill(h.name)}
                          disabled={!matched} showMatch matched={matched} recent={h.recent} files={h.files}
                          selected={!!scanFixInclude.fill[h.name]} colorClass="text-text-secondary" />
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Dead commands */}
              {deadCmds.length > 0 && (
                <div>
                  <SectionHeader color="bg-text-dim/50" count={deadCmds.length} toggleAll={toggleAllRemove} selectedCount={removeCount} totalCount={deadCmds.length}>
                    Unused commands
                  </SectionHeader>
                  <div className="space-y-0.5">
                    {deadCmds.map(n => (
                      <div key={n} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all ${scanFixInclude.remove[n] ? 'bg-white/[0.03] border border-border/60' : 'border border-transparent opacity-40'}`}>
                        <input type="checkbox" checked={!!scanFixInclude.remove[n]} onChange={() => toggleRemove(n)} className="w-3.5 h-3.5 accent-accent shrink-0 rounded" />
                        <span className="font-mono text-[12px] text-text-dim flex-1 truncate line-through decoration-text-dim/30">{n}</span>
                        <span className="text-[11px] text-text-dim/40 tabular-nums shrink-0">{(commands[n] || []).length} step{(commands[n] || []).length !== 1 ? 's' : ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* OK hooks */}
              {okHooks.length > 0 && !allClean && (
                <div>
                  <SectionHeader color="bg-green" count={okHooks.length}>Synced</SectionHeader>
                  <div className="flex flex-wrap gap-1">
                    {okHooks.map(h => (
                      <button
                        key={h.name}
                        onClick={() => { setScanResult(null); setFilter(h.name); setExpanded(h.name); }}
                        title={h.recent ? `${h.recent.relative} — ${h.recent.message}` : ''}
                        className="font-mono text-[11px] px-2 py-0.5 rounded-md bg-white/[0.03] text-text-dim/60 hover:text-accent hover:bg-accent/5 transition-colors cursor-pointer"
                      >
                        {h.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-border flex items-center">
              {(missingHooks.length > 0 || emptyHooks.length > 0 || deadCmds.length > 0) && (
                <div className="flex items-center gap-3 text-[11px] text-text-dim/50">
                  <button
                    onClick={() => { toggleAllAdd(true); toggleAllFill(true); toggleAllRemove(true); }}
                    className="hover:text-text-primary transition-colors"
                  >Select all</button>
                  <button
                    onClick={() => { toggleAllAdd(false); toggleAllFill(false); toggleAllRemove(false); }}
                    className="hover:text-text-primary transition-colors"
                  >Clear</button>
                </div>
              )}
              <div className="flex-1" />
              <button onClick={() => setScanResult(null)} className="text-xs text-text-dim/50 hover:text-text-primary transition-colors px-3 py-1.5">Close</button>
            </div>
          </div>
        </div>
        );
      })()}

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
