import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';

const COMMANDS = ['Play', 'Stop', 'Fade', 'Set', 'Pause', 'Resume', 'Execute', 'ResetSpriteList'];

// Minimal WAV decoder — same as SoundsPage, avoids decodeAudioData crash on 24/32-bit PCM
function decodeWavForPreview(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const tag4 = (o) => String.fromCharCode(view.getUint8(o), view.getUint8(o+1), view.getUint8(o+2), view.getUint8(o+3));
  if (tag4(0) !== 'RIFF' || tag4(8) !== 'WAVE') throw new Error('Not a valid WAV file');
  let audioFormat = 0, numChannels = 0, sampleRate = 0, bitsPerSample = 0, dataOffset = -1, dataSize = 0;
  let pos = 12;
  while (pos + 8 <= arrayBuffer.byteLength) {
    const chunkId = tag4(pos);
    const chunkSize = view.getUint32(pos + 4, true);
    if (chunkId === 'fmt ' && chunkSize >= 16) {
      audioFormat = view.getUint16(pos + 8, true);
      numChannels = view.getUint16(pos + 10, true);
      sampleRate = view.getUint32(pos + 12, true);
      bitsPerSample = view.getUint16(pos + 22, true);
    } else if (chunkId === 'data') {
      dataOffset = pos + 8;
      dataSize = chunkSize;
      break;
    }
    pos += 8 + chunkSize + (chunkSize % 2);
  }
  if (dataOffset < 0) throw new Error('No data chunk');
  const numSamples = Math.floor(dataSize / (numChannels * (bitsPerSample / 8)));
  const ctx = new AudioContext({ sampleRate });
  const audioBuffer = ctx.createBuffer(numChannels, numSamples, sampleRate);
  for (let ch = 0; ch < numChannels; ch++) {
    const channelData = audioBuffer.getChannelData(ch);
    for (let i = 0; i < numSamples; i++) {
      const sampleOffset = dataOffset + (i * numChannels + ch) * (bitsPerSample / 8);
      if (bitsPerSample === 16) {
        channelData[i] = view.getInt16(sampleOffset, true) / 32768;
      } else if (bitsPerSample === 24) {
        const b0 = view.getUint8(sampleOffset), b1 = view.getUint8(sampleOffset+1), b2 = view.getUint8(sampleOffset+2);
        const val = (b2 << 16) | (b1 << 8) | b0;
        channelData[i] = (val >= 0x800000 ? val - 0x1000000 : val) / 8388608;
      } else if (bitsPerSample === 32 && audioFormat === 3) {
        channelData[i] = view.getFloat32(sampleOffset, true);
      } else if (bitsPerSample === 32) {
        channelData[i] = view.getInt32(sampleOffset, true) / 2147483648;
      } else if (bitsPerSample === 8) {
        channelData[i] = (view.getUint8(sampleOffset) - 128) / 128;
      }
    }
  }
  return { audioBuffer, ctx };
}

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
  const showDelay = ['Play', 'Stop', 'Fade', 'Set', 'Pause', 'Resume', 'ResetSpriteList'].includes(cmd);
  const showRate = ['Play', 'Set'].includes(cmd);

  return (
    <div className="space-y-2">
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
            {state.targetType === 'list' ? (<>
              {creatingList ? (
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
              )}
              {state.spriteListId && !creatingList && spriteLists[state.spriteListId] && state.command === 'Play' && (
                <div className="mt-1.5">
                  <label className="section-label mb-1 block" title="Force a specific sprite from the list instead of next in sequence/random">Sprite To Play</label>
                  <select
                    value={state.spriteToPlay || ''}
                    onChange={e => setState(m => ({ ...m, spriteToPlay: e.target.value }))}
                    className="input-base text-xs w-full font-mono"
                  >
                    <option value="">— auto (next in list) —</option>
                    {(Array.isArray(spriteLists[state.spriteListId])
                      ? spriteLists[state.spriteListId]
                      : spriteLists[state.spriteListId]?.items || []
                    ).map(id => <option key={id} value={id}>{id}</option>)}
                  </select>
                </div>
              )}
            </>) : (
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
      {!isExecute && (
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

      {/* Row 3: checkboxes — only if at least one checkbox would be visible */}
      {!isExecute && !isResetSpriteList && (showDelay || (state.spriteId && soundSprites[state.spriteId])) && (
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
          {isPlay && showDelay && (
            <label className="flex items-center gap-2 cursor-pointer" title="If sprite is NOT playing when delay expires, skip this Play (don't start it)">
              <input
                type="checkbox"
                checked={state.cancelDelay}
                onChange={e => setState(m => ({ ...m, cancelDelay: e.target.checked }))}
                className="w-4 h-4 accent-accent"
              />
              <span className="text-xs text-text-secondary">cancelDelay</span>
            </label>
          )}
          {isPlay && state.spriteId && soundSprites[state.spriteId] && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={state.spriteOverlap ?? soundSprites[state.spriteId]?.overlap ?? false}
                onChange={e => setState(m => ({ ...m, spriteOverlap: e.target.checked }))}
                className="w-4 h-4 accent-accent"
              />
              <span className="text-xs text-text-secondary">overlap <span className="text-text-dim">(sprite)</span></span>
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
    pan: '', duration: '', cancelDelay: false, rate: '', spriteToPlay: '',
    ...overrides,
  };
}

function stepFromAction(action, soundSprites) {
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
    spriteOverlap: soundSprites?.[action.spriteId]?.overlap ?? false,
    spriteToPlay: action.spriteToPlay || '',
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
  const [clipboard, setClipboard] = useState(null); // { name, actions }
  const [scanResult, setScanResult] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanFixInclude, setScanFixInclude] = useState({ add: {}, remove: {}, fill: {} });
  const [viewTab, setViewTab_] = useState('commands'); // 'commands' | 'lists'
  const setViewTab = (tab) => { setViewTab_(tab); setExpanded(null); setFilter(''); };
  const [newList, setNewList] = useState(null); // { name, items, type, overlap, tags }
  const [editList, setEditList] = useState(null); // { name, items, type, overlap, tags }
  const [editListInline, setEditListInline] = useState(null); // { name, items, type, overlap, loop, tags, cmdName, stepIdx }
  const [confirmDeleteList, setConfirmDeleteList] = useState(null);
  const [selected, setSelected] = useState(new Set()); // multi-select for bulk ops
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [previewCmds, setPreviewCmds] = useState(new Set()); // active preview command names (UI)
  const previewCmdsRef = useRef(new Set()); // same as state but readable in callbacks without stale closure
  const previewCtxRef = useRef(null);
  const previewSourcesRef = useRef([]); // { source, cmdName }
  const previewTimersRef = useRef([]); // { timer, cmdName }
  const dragRef = useRef({ cmdName: null, fromIdx: null }); // drag-and-drop reorder state
  const [dragOver, setDragOver] = useState(null); // { cmdName, idx } — visual drop indicator
  const [hooksCollapsed, setHooksCollapsed] = useState(false); // Game Hooks panel collapse

  useEffect(() => {
    setFilter(''); setExpanded(null); setGenPreview(null);
    setNewCmd(null); setAddStep(null); setEditStep(null); setConfirmDeleteCmd(null);
    setRenameCmd(null); setScanResult(null); setScanFixInclude({ add: {}, remove: {}, fill: {} });
    setNewList(null); setEditList(null); setEditListInline(null); setConfirmDeleteList(null); setClipboard(null);
    setSelected(new Set()); setConfirmBulkDelete(false); setDragOver(null); setHooksCollapsed(false);
    stopAllPreviews();
  }, [project?.path, project?._reloadKey]);

  // Clear selection when switching tabs
  useEffect(() => { setSelected(new Set()); setConfirmBulkDelete(false); }, [viewTab]);

  // Space key: play/stop preview for expanded command
  const playPreviewRef = useRef(null);
  useEffect(() => {
    const handler = (e) => {
      if (e.code !== 'Space') return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (!expanded || viewTab !== 'commands') return;
      e.preventDefault();
      playPreviewRef.current(expanded);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [expanded, viewTab]);

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

  // Sprite lists not referenced by any command
  const referencedLists = useMemo(() => {
    const refs = new Set();
    for (const actions of Object.values(commands)) {
      for (const a of actions) { if (a.spriteListId) refs.add(a.spriteListId); }
    }
    return refs;
  }, [commands]);
  const unusedLists = useMemo(() =>
    Object.keys(spriteLists).filter(id => !referencedLists.has(id)),
    [spriteLists, referencedLists]
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

  // ── Command audio preview ────────────────────────────────────────────────────
  // Stop ALL previews
  const stopAllPreviews = () => {
    previewTimersRef.current.forEach(t => clearTimeout(t.timer));
    previewTimersRef.current = [];
    previewSourcesRef.current.forEach(s => { try { s.source.stop(); } catch {} });
    previewSourcesRef.current = [];
    if (previewCtxRef.current) { previewCtxRef.current.close().catch(() => {}); previewCtxRef.current = null; }
    previewCmdsRef.current = new Set();
    setPreviewCmds(new Set());
  };

  // Stop ONE command's preview
  const stopPreviewCmd = (cmdName) => {
    const timers = previewTimersRef.current.filter(t => t.cmdName === cmdName);
    timers.forEach(t => clearTimeout(t.timer));
    previewTimersRef.current = previewTimersRef.current.filter(t => t.cmdName !== cmdName);
    const sources = previewSourcesRef.current.filter(s => s.cmdName === cmdName);
    sources.forEach(s => { try { s.source.stop(); } catch {} });
    previewSourcesRef.current = previewSourcesRef.current.filter(s => s.cmdName !== cmdName);
    previewCmdsRef.current.delete(cmdName);
    setPreviewCmds(prev => { const next = new Set(prev); next.delete(cmdName); return next; });
    // Close ctx only if nothing left playing
    if (previewSourcesRef.current.length === 0 && previewTimersRef.current.length === 0) {
      if (previewCtxRef.current) { previewCtxRef.current.close().catch(() => {}); previewCtxRef.current = null; }
    }
  };

  const playPreview = async (cmdName) => {
    // Toggle: if this command is already playing, stop only it
    if (previewCmdsRef.current.has(cmdName)) { stopPreviewCmd(cmdName); return; }
    const steps = commands[cmdName];
    if (!Array.isArray(steps) || steps.length === 0) return;

    previewCmdsRef.current.add(cmdName);
    setPreviewCmds(prev => new Set(prev).add(cmdName));

    try {
    // Resolve target spriteId for any step
    const resolveTarget = (step) => {
      if (step.spriteId) return step.spriteId;
      if (step.spriteListId) {
        const list = spriteLists[step.spriteListId];
        const items = Array.isArray(list) ? list : list?.items || [];
        return step.spriteToPlay || items[0] || null;
      }
      return null;
    };

    // Preload WAVs for Play steps only
    const wavCache = {}; // spriteId → audioBuffer
    for (const step of steps) {
      if (step.command !== 'Play') continue;
      const target = resolveTarget(step);
      if (!target || wavCache[target]) continue;
      const wavName = target.replace(/^s_/, '');
      try {
        const res = await fetch(`audio://local/${encodeURIComponent(wavName + '.wav')}`);
        if (!res.ok) continue;
        const buf = await res.arrayBuffer();
        const { audioBuffer, ctx: wavCtx } = decodeWavForPreview(buf);
        wavCtx.close().catch(() => {});
        wavCache[target] = audioBuffer;
      } catch (e) {
        console.error(`Preview load ${wavName}:`, e.message);
      }
    }

    // Reuse or create shared AudioContext
    if (!previewCtxRef.current || previewCtxRef.current.state === 'closed') {
      previewCtxRef.current = new AudioContext();
    }
    const ctx = previewCtxRef.current;

    // Schedule ALL steps — Play, Stop, Fade, Pause, Resume
    for (const step of steps) {
      const delay = step.delay || 0;
      const target = resolveTarget(step);
      const cmd = (step.command || '').toLowerCase();

      const timer = setTimeout(() => {
        if (!previewCmdsRef.current.has(cmdName)) return;
        try {
          if (cmd === 'play' && target && wavCache[target]) {
            const volume = step.volume ?? 1;
            const gain = ctx.createGain();
            gain.gain.value = volume;
            gain.connect(ctx.destination);

            const source = ctx.createBufferSource();
            source.buffer = wavCache[target];
            source.loop = step.loop === -1;
            source.connect(gain);
            source.start(0);
            previewSourcesRef.current.push({ source, cmdName, target, gain });

            source.onended = () => {
              previewSourcesRef.current = previewSourcesRef.current.filter(s => s.source !== source);
            };
          } else if (cmd === 'stop' && target) {
            // Stop all active sources matching this target across ALL commands
            const toStop = previewSourcesRef.current.filter(s => s.target === target);
            toStop.forEach(s => { try { s.source.stop(); } catch {} });
            previewSourcesRef.current = previewSourcesRef.current.filter(s => s.target !== target);
          } else if (cmd === 'stop' && !target) {
            // Stop without target — stop all sources from this command? No — in playa, Stop with spriteListId stops all in that list
            // For preview: stop all from the spriteListId
            if (step.spriteListId) {
              const list = spriteLists[step.spriteListId];
              const items = new Set(Array.isArray(list) ? list : list?.items || []);
              const toStop = previewSourcesRef.current.filter(s => items.has(s.target));
              toStop.forEach(s => { try { s.source.stop(); } catch {} });
              previewSourcesRef.current = previewSourcesRef.current.filter(s => !items.has(s.target));
            }
          } else if (cmd === 'fade' && target) {
            const duration = (step.duration || 500) / 1000;
            const targetVol = step.volume ?? 0;
            const toFade = previewSourcesRef.current.filter(s => s.target === target);
            toFade.forEach(s => {
              if (s.gain) {
                s.gain.gain.linearRampToValueAtTime(targetVol, ctx.currentTime + duration);
                if (targetVol === 0) setTimeout(() => { try { s.source.stop(); } catch {} }, duration * 1000 + 50);
              }
            });
          }
        } catch (e) {
          console.error(`Preview ${cmd} ${target}:`, e.message);
        }
      }, delay);
      previewTimersRef.current.push({ timer, cmdName });
    }
    } catch (e) {
      showToast('Preview failed: ' + e.message, 'error');
      stopPreviewCmd(cmdName);
    }
  };

  playPreviewRef.current = playPreview;

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
      if (s.command === 'Play' && s.spriteToPlay) step.spriteToPlay = s.spriteToPlay;
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
    if (s.command === 'Play' && s.cancelDelay) step.cancelDelay = true;

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

  const handlePasteCmd = async () => {
    if (!clipboard || saving) return;
    let name = clipboard.name + '_copy';
    let i = 1;
    while (commands[name]) { name = clipboard.name + '_copy' + (++i); }
    const j = structuredClone(project.soundsJson);
    j.soundDefinitions.commands[name] = structuredClone(clipboard.actions);
    const ok = await saveJson(j, `Pasted "${name}"`);
    if (ok) setExpanded(name);
  };

  const handlePasteSteps = async (targetCmd) => {
    if (!clipboard?.actions?.length || saving || !targetCmd) return;
    const j = structuredClone(project.soundsJson);
    const existing = j.soundDefinitions.commands[targetCmd] || [];
    j.soundDefinitions.commands[targetCmd] = [...existing, ...structuredClone(clipboard.actions)];
    await saveJson(j, `Pasted ${clipboard.actions.length} step(s) into "${targetCmd}"`);
  };

  const handleSaveNewCmd = async () => {
    const hookName = newCmd.hookName.trim();
    if (!hookName) return;
    if (commands[hookName]) { showToast(`Command "${hookName}" already exists`, 'error'); return; }
    if (!validateStep(newCmd)) return;
    const j = structuredClone(project.soundsJson);
    j.soundDefinitions.commands[hookName] = [buildStep(newCmd)];
    applySpriteOverlap(j, newCmd);
    const ok = await saveJson(j, `Command "${hookName}" added`);
    if (ok) { setNewCmd(null); setExpanded(hookName); }
  };

  // Write spriteOverlap back to soundSprites (overlap lives on the sprite, not the command step)
  const applySpriteOverlap = (j, formState) => {
    if (formState.spriteOverlap !== undefined && formState.spriteId && j.soundDefinitions?.soundSprites?.[formState.spriteId]) {
      j.soundDefinitions.soundSprites[formState.spriteId].overlap = formState.spriteOverlap;
    }
  };

  const handleSaveAddStep = async () => {
    if (!validateStep(addStep)) return;
    const j = structuredClone(project.soundsJson);
    j.soundDefinitions.commands[addStep.cmdName] = [
      ...(j.soundDefinitions.commands[addStep.cmdName] || []),
      buildStep(addStep),
    ];
    applySpriteOverlap(j, addStep);
    const ok = await saveJson(j, 'Step dodan');
    if (ok) setAddStep(null);
  };

  const handleSaveEditStep = async () => {
    if (!validateStep(editStep)) return;
    const j = structuredClone(project.soundsJson);
    j.soundDefinitions.commands[editStep.cmdName][editStep.stepIdx] = buildStep(editStep);
    applySpriteOverlap(j, editStep);
    const ok = await saveJson(j, 'Step saved');
    if (ok) { setEditStep(null); setEditListInline(null); }
  };

  const handleDeleteStep = async (cmdName, stepIdx) => {
    const j = structuredClone(project.soundsJson);
    j.soundDefinitions.commands[cmdName].splice(stepIdx, 1);
    setEditListInline(null);
    await saveJson(j, 'Step obrisan');
  };

  const handleReorderStep = async (cmdName, fromIdx, toIdx) => {
    if (saving || fromIdx === toIdx) return;
    const j = structuredClone(project.soundsJson);
    const arr = j.soundDefinitions.commands[cmdName];
    if (!arr || fromIdx < 0 || fromIdx >= arr.length || toIdx < 0 || toIdx >= arr.length) return;
    const [moved] = arr.splice(fromIdx, 1);
    arr.splice(toIdx, 0, moved);
    await saveJson(j, `Step ${fromIdx + 1} → ${toIdx + 1}`);
  };

  const handleDeleteCmd = async (cmdName) => {
    const j = structuredClone(project.soundsJson);
    delete j.soundDefinitions.commands[cmdName];
    setConfirmDeleteCmd(null);
    const ok = await saveJson(j, `Command "${cmdName}" deleted`);
    if (ok) {
      setExpanded(null);
      setSelected(prev => { const next = new Set(prev); next.delete(cmdName); return next; });
    }
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
    const loopVal = Array.isArray(newList.loop)
      ? newList.loop.filter((_, i) => Boolean(newList.items[i]))
      : newList.loop;
    if (Array.isArray(loopVal) ? loopVal.length > 0 : loopVal) entry.loop = loopVal;
    const panVal = Array.isArray(newList.pan)
      ? newList.pan.filter((_, i) => Boolean(newList.items[i]))
      : newList.pan;
    if (Array.isArray(panVal) ? panVal.length > 0 : panVal) entry.pan = panVal;
    if (newList.tags?.length) entry.tags = newList.tags;
    j.soundDefinitions.spriteList[name] = entry;
    const ok = await saveJson(j, `Sprite list "${name}" created`);
    if (ok) setNewList(null);
  };

  const handleSaveEditList = async () => {
    if (saving) return;
    if (!editList?.name) return;
    const newName = editList.name.trim();
    if (!newName) { showToast('Name cannot be empty', 'error'); return; }
    if (!/^[a-zA-Z0-9_-]+$/.test(newName)) { showToast('Name can only contain letters, numbers, _ and -', 'error'); return; }
    const j = structuredClone(project.soundsJson);
    if (!j.soundDefinitions.spriteList) j.soundDefinitions.spriteList = {};
    const cleanItems = editList.items.filter(Boolean);
    if (!cleanItems.length) { showToast('Add at least one sprite', 'error'); return; }
    const entry = { items: cleanItems, type: editList.type, overlap: editList.overlap };
    // Sync loop array with filtered items — remove entries for deleted sprites
    const loopVal = Array.isArray(editList.loop)
      ? editList.loop.filter((_, i) => Boolean(editList.items[i]))
      : editList.loop;
    if (Array.isArray(loopVal) ? loopVal.length > 0 : loopVal) entry.loop = loopVal;
    // Sync pan array with filtered items
    const panVal = Array.isArray(editList.pan)
      ? editList.pan.filter((_, i) => Boolean(editList.items[i]))
      : editList.pan;
    if (Array.isArray(panVal) ? panVal.length > 0 : panVal) entry.pan = panVal;
    if (editList.tags?.length) entry.tags = editList.tags;

    // Rename: if name changed, delete old key and update all command references
    const origName = (editList._originalName || editList.name || '').trim();
    if (newName !== origName) {
      if (j.soundDefinitions.spriteList[newName]) { showToast('List "' + newName + '" already exists', 'error'); return; }
      delete j.soundDefinitions.spriteList[origName];
      // Update spriteListId references in all commands
      if (j.soundDefinitions.commands) {
        for (const steps of Object.values(j.soundDefinitions.commands)) {
          if (!Array.isArray(steps)) continue;
          for (const s of steps) {
            if (s && s.spriteListId === origName) s.spriteListId = newName;
          }
        }
      }
    }

    j.soundDefinitions.spriteList[newName] = entry;
    const ok = await saveJson(j, newName !== origName ? `Sprite list renamed "${origName}" → "${newName}"` : `Sprite list "${newName}" updated`);
    if (ok) setEditList(null);
  };

  const handleSaveEditListInline = async () => {
    if (saving || !editListInline?.name) return;
    const cleanItems = editListInline.items.filter(Boolean);
    if (!cleanItems.length) { showToast('Add at least one sprite', 'error'); return; }
    const j = structuredClone(project.soundsJson);
    if (!j.soundDefinitions.spriteList) j.soundDefinitions.spriteList = {};
    const entry = { items: cleanItems, type: editListInline.type, overlap: editListInline.overlap };
    const loopVal = Array.isArray(editListInline.loop)
      ? editListInline.loop.filter((_, i) => Boolean(editListInline.items[i]))
      : editListInline.loop;
    if (Array.isArray(loopVal) ? loopVal.length > 0 : loopVal) entry.loop = loopVal;
    const panVal = Array.isArray(editListInline.pan)
      ? editListInline.pan.filter((_, i) => Boolean(editListInline.items[i]))
      : editListInline.pan;
    if (Array.isArray(panVal) ? panVal.length > 0 : panVal) entry.pan = panVal;
    if (editListInline.tags?.length) entry.tags = editListInline.tags;
    j.soundDefinitions.spriteList[editListInline.name] = entry;
    const ok = await saveJson(j, `List "${editListInline.name}" updated`);
    if (ok) setEditListInline(null);
  };

  const toggleSelect = (name) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  const toggleSelectAll = (names) => setSelected(prev => {
    const allSelected = names.every(n => prev.has(n));
    if (allSelected) return new Set();
    return new Set(names);
  });

  const handleBulkDelete = async () => {
    if (!selected.size || saving) return;
    setSaving(true);
    try {
      const j = structuredClone(project.soundsJson);
      const section = viewTab === 'commands' ? 'commands' : 'spriteList';
      if (!j.soundDefinitions[section]) { setSaving(false); return; }
      for (const name of selected) delete j.soundDefinitions[section][name];
      const ok = await saveJson(j, `Deleted ${selected.size} ${viewTab === 'commands' ? 'command' : 'sprite list'}${selected.size > 1 ? 's' : ''}`);
      if (ok) { setSelected(new Set()); setConfirmBulkDelete(false); setExpanded(null); }
    } catch (e) {
      showToast('Bulk delete failed: ' + e.message, 'error');
    }
    setSaving(false);
  };

  const handleDeleteList = async (name) => {
    if (saving) return;
    const j = structuredClone(project.soundsJson);
    if (!j.soundDefinitions.spriteList) return;
    delete j.soundDefinitions.spriteList[name];
    setConfirmDeleteList(null);
    const ok = await saveJson(j, `Sprite list "${name}" deleted`);
    if (ok) setSelected(prev => { const next = new Set(prev); next.delete(name); return next; });
  };

  const spriteListNames = useMemo(() =>
    Object.keys(spriteLists).filter(n => n.toLowerCase().includes(filter.toLowerCase())).sort(),
    [spriteLists, filter]
  );

  // ── Color helpers for command types ──
  const cmdColor = (cmd) => {
    switch ((cmd || '').toLowerCase()) {
      case 'play': return { bg: 'rgba(74,222,128,0.1)', text: '#4ade80' };
      case 'stop': return { bg: 'rgba(56,189,248,0.1)', text: '#38bdf8' };
      case 'fade': return { bg: 'rgba(196,181,253,0.1)', text: '#c4b5fd' };
      case 'set': return { bg: 'rgba(251,146,60,0.1)', text: '#fb923c' };
      case 'execute': return { bg: 'rgba(244,114,182,0.1)', text: '#f472b6' };
      case 'pause': case 'resume': return { bg: 'rgba(74,222,128,0.1)', text: '#4ade80' };
      case 'resetspritelist': return { bg: 'rgba(196,181,253,0.1)', text: '#c4b5fd' };
      default: return { bg: 'rgba(255,255,255,0.05)', text: '#999' };
    }
  };

  // Compute total delay duration for a command
  const cmdDuration = (actions) => {
    if (!actions?.length) return 0;
    let maxEnd = 0;
    for (const a of actions) {
      const d = (a.delay || 0) + (a.duration || 0);
      if (d > maxEnd) maxEnd = d;
    }
    return maxEnd;
  };

  // Get referenced sprites for the expanded command
  const expandedRefs = useMemo(() => {
    if (!expanded || !commands[expanded]) return { sprites: [], lists: [] };
    const sprites = new Set();
    const lists = new Set();
    for (const a of commands[expanded]) {
      if (a.spriteId) sprites.add(a.spriteId);
      if (a.spriteListId) lists.add(a.spriteListId);
      if (a.spriteListId && spriteLists[a.spriteListId]) {
        const list = spriteLists[a.spriteListId];
        const items = Array.isArray(list) ? list : (list?.items || []);
        for (const item of items) { if (item) sprites.add(item); }
      }
    }
    return { sprites: [...sprites], lists: [...lists] };
  }, [expanded, commands, spriteLists]);

  // Find which commands reference a given sprite
  const findReferencingCommands = (spriteId) => {
    const refs = [];
    for (const [name, actions] of Object.entries(commands)) {
      for (const a of actions) {
        if (a.spriteId === spriteId) { refs.push(name); break; }
        if (a.spriteListId && spriteLists[a.spriteListId]) {
          const list = spriteLists[a.spriteListId];
          const items = Array.isArray(list) ? list : (list?.items || []);
          if (items.includes(spriteId)) { refs.push(name); break; }
        }
      }
    }
    return refs;
  };

  // Find tier info for a sprite from sprite-config
  const getTierInfo = (spriteId) => {
    const cfg = project?.spriteConfig;
    if (!cfg?.sprites) return null;
    const soundName = spriteId.replace(/^s_/, '');
    for (const [tierName, tier] of Object.entries(cfg.sprites)) {
      if (tier.sounds?.includes(soundName) || tier.sounds?.includes(spriteId)) {
        return { tier: tierName, subLoaderId: tier.subLoaderId, unloadable: tier.unloadable };
      }
    }
    if (cfg.standalone?.sounds?.includes(soundName) || cfg.standalone?.sounds?.includes(spriteId)) {
      return { tier: 'standalone' };
    }
    return null;
  };

  return (
    <div className="anim-fade-up h-full flex flex-col" style={{ gap: '10px' }}>
      {/* ── HEADER ── */}
      <div className="shrink-0" style={{ textAlign: 'center', padding: '4px 0' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#eee', margin: 0 }}>Commands</h2>
      </div>

      {/* ── 3-PANEL ROW ── */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: '14px' }}>

        {/* ── LEFT PANEL: Command List ── */}
        <div style={{ width: '300px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* Search */}
          <div style={{ position: 'relative' }}>
            <svg style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', width: '13px', height: '13px', color: 'rgba(255,255,255,0.25)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="11" cy="11" r="8" /><path strokeLinecap="round" d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder="Search commands..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="input-base"
              style={{ width: '100%', paddingLeft: '30px', fontSize: '11px', padding: '6px 10px 6px 30px' }}
            />
          </div>
          <div className="card" style={{ flex: 1, minHeight: 0, borderRadius: '12px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Panel header */}
          <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(50,50,90,0.18)', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#eee' }}>Commands</span>
            <span className="badge bg-cyan-dim text-cyan">{Object.keys(commands).length}</span>
            {totalIssues > 0 && <span className="badge bg-danger-dim text-danger">{totalIssues} err</span>}
            <div style={{ flex: 1 }} />
            <button
              onClick={stopAllPreviews}
              style={{ fontSize: '9px', padding: '3px 8px', borderRadius: '12px', border: '1px solid rgba(124,106,239,0.3)', background: previewCmds.size > 0 ? 'rgba(124,106,239,0.08)' : 'transparent', color: previewCmds.size > 0 ? '#c4b5fd' : 'rgba(255,255,255,0.2)', cursor: previewCmds.size > 0 ? 'pointer' : 'default', fontWeight: 500, flexShrink: 0, transition: 'all 0.15s' }}
              disabled={previewCmds.size === 0}
            >{'\u25A0'} Stop{previewCmds.size > 0 ? ` (${previewCmds.size})` : ''}</button>
            <button
              onClick={() => setNewCmd(emptyStep({ hookName: '' }))}
              disabled={saving}
              style={{ fontSize: '9px', padding: '3px 8px', borderRadius: '5px', border: 'none', cursor: 'pointer', background: '#7c6aef', color: '#fff', fontWeight: 600, opacity: saving ? 0.4 : 1, flexShrink: 0 }}
            >+ New</button>
          </div>

          {/* Select All */}
          {cmdNames.length > 0 && (
            <div style={{ padding: '6px 14px', borderBottom: '1px solid rgba(50,50,90,0.18)', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, position: 'sticky', top: 0, zIndex: 1, background: 'var(--color-bg-secondary, #0e0e15)' }}>
              <input
                type="checkbox"
                checked={cmdNames.length > 0 && cmdNames.every(n => selected.has(n))}
                onChange={() => toggleSelectAll(cmdNames)}
                style={{ width: '13px', height: '13px' }}
                className="accent-accent cursor-pointer"
              />
              <span style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.35)' }}>Select All</span>
            </div>
          )}

          {/* Inline New Command */}
          {newCmd && (
            <div style={{ padding: '8px 10px', borderBottom: '1px solid rgba(50,50,90,0.18)', background: 'rgba(139,124,248,0.03)' }}>
              <input
                type="text"
                value={newCmd.hookName}
                onChange={e => setNewCmd(m => ({ ...m, hookName: e.target.value }))}
                placeholder="onHookName"
                autoFocus
                onKeyDown={async e => { if (e.key === 'Enter' && newCmd.hookName.trim()) { const hn = newCmd.hookName.trim(); if (commands[hn]) { showToast(`"${hn}" already exists`, 'error'); return; } const j = structuredClone(project.soundsJson); j.soundDefinitions.commands[hn] = []; const ok = await saveJson(j, `Command "${hn}" added`); if (ok) { setNewCmd(null); setExpanded(hn); } } if (e.key === 'Escape') setNewCmd(null); }}
                style={{ width: '100%', padding: '4px 8px', background: 'var(--color-bg-input)', border: '1px solid rgba(139,124,248,0.3)', borderRadius: '5px', color: '#eee', fontSize: '11px', fontFamily: "'JetBrains Mono', monospace", outline: 'none', marginBottom: '6px' }}
              />
              <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                <button onClick={async () => { const hn = newCmd.hookName.trim(); if (!hn) return; if (commands[hn]) { showToast(`"${hn}" already exists`, 'error'); return; } const j = structuredClone(project.soundsJson); j.soundDefinitions.commands[hn] = []; const ok = await saveJson(j, `Command "${hn}" added`); if (ok) { setNewCmd(null); setExpanded(hn); } }} disabled={saving || !newCmd.hookName.trim()}
                  style={{ fontSize: '9px', fontWeight: 600, padding: '3px 10px', borderRadius: '5px', background: '#7c6aef', color: '#fff', border: 'none', cursor: 'pointer', opacity: (saving || !newCmd.hookName.trim()) ? 0.4 : 1 }}>
                  {saving ? '...' : 'Create'}
                </button>
                <button onClick={() => setNewCmd(null)}
                  style={{ fontSize: '9px', padding: '3px 10px', borderRadius: '5px', background: 'none', color: '#6a6a96', border: '1px solid rgba(50,50,90,0.5)', cursor: 'pointer' }}>Cancel</button>
              </div>
            </div>
          )}
          {/* Bulk bar */}
          {selected.size > 0 && (
            <div style={{ padding: '4px 10px', borderBottom: '1px solid rgba(50,50,90,0.18)', display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '9px', color: '#f87171', fontWeight: 600 }}>{selected.size} sel</span>
              {!confirmBulkDelete ? (
                <button onClick={() => setConfirmBulkDelete(true)} disabled={saving}
                  style={{ fontSize: '9px', color: '#f87171', background: 'none', border: '1px solid rgba(248,113,113,0.2)', borderRadius: '4px', padding: '2px 6px', cursor: 'pointer', opacity: saving ? 0.4 : 1 }}>Delete</button>
              ) : (
                <span style={{ fontSize: '9px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <button onClick={handleBulkDelete} disabled={saving} style={{ color: '#f87171', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', fontSize: '9px' }}>Yes</button>
                  <span style={{ color: 'rgba(255,255,255,0.1)' }}>|</span>
                  <button onClick={() => setConfirmBulkDelete(false)} style={{ color: '#6a6a96', background: 'none', border: 'none', cursor: 'pointer', fontSize: '9px' }}>No</button>
                </span>
              )}
              <button onClick={() => setSelected(new Set())} style={{ fontSize: '9px', color: '#6a6a96', background: 'none', border: 'none', cursor: 'pointer', marginLeft: 'auto' }}>Clear</button>
            </div>
          )}
          {/* Command rows */}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {cmdNames.map((name) => {
              const actions = commands[name] || [];
              const issues = getIssues(name);
              const isSelected = expanded === name;
              const isEmpty = actions.length === 0;
              return (
                <div
                  key={name}
                  onClick={(e) => {
                    if (e.detail === 2) { setExpanded(name); setRenameCmd({ oldName: name, newName: name, source: 'left' }); }
                    else if (!isSelected) setExpanded(name);
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 10px',
                    borderBottom: '1px solid rgba(50,50,90,0.18)', cursor: 'pointer',
                    background: isSelected ? 'rgba(139,124,248,0.05)' : 'transparent',
                    borderLeft: isSelected ? '2px solid #7c6aef' : '2px solid transparent',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.015)'; }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(name)}
                    onChange={() => toggleSelect(name)}
                    onClick={e => e.stopPropagation()}
                    style={{ width: '13px', height: '13px', flexShrink: 0 }}
                    className="accent-accent cursor-pointer"
                  />
                  {renameCmd?.oldName === name && renameCmd?.source === 'left' ? (
                    <input
                      type="text"
                      value={renameCmd.newName}
                      onChange={e => setRenameCmd(p => ({ ...p, newName: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); handleRenameCmd(); } if (e.key === 'Escape') { e.stopPropagation(); setRenameCmd(null); } }}
                      onBlur={() => { if (!renameCmd) return; if (renameCmd.newName?.trim() && renameCmd.newName !== renameCmd.oldName) handleRenameCmd(); else setRenameCmd(null); }}
                      onClick={e => e.stopPropagation()}
                      onDoubleClick={e => e.stopPropagation()}
                      autoFocus
                      style={{
                        fontSize: '11px', fontFamily: "'JetBrains Mono', monospace", color: '#eee',
                        width: '130px', flexShrink: 0, padding: '1px 4px',
                        background: 'var(--color-bg-input)', border: '1px solid rgba(139,124,248,0.4)',
                        borderRadius: '4px', outline: 'none',
                      }}
                    />
                  ) : (
                    <span style={{
                      fontSize: '11px', fontFamily: "'JetBrains Mono', monospace", color: isEmpty ? 'rgba(255,255,255,0.3)' : '#b0c4ff',
                      width: '130px', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      fontStyle: isEmpty ? 'italic' : 'normal',
                    }}>{name}</span>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); playPreview(name); }}
                    style={{
                      width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      borderRadius: '5px', flexShrink: 0, border: 'none', cursor: 'pointer',
                      background: previewCmds.has(name) ? 'rgba(56,189,248,0.12)' : 'rgba(74,222,128,0.08)',
                      color: previewCmds.has(name) ? '#38bdf8' : '#4ade80',
                      fontSize: '10px', fontWeight: 700, transition: 'all 0.15s',
                    }}
                    title={previewCmds.has(name) ? `Stop "${name}"` : `Preview "${name}"`}
                  >{previewCmds.has(name) ? '\u25A0' : '\u25B6'}</button>
                  <span style={{
                    fontSize: '10px', fontFamily: "'JetBrains Mono', monospace",
                    color: isEmpty ? '#fb923c' : 'rgba(255,255,255,0.3)', flexShrink: 0,
                  }}>
                    {actions.length} step{actions.length !== 1 ? 's' : ''}
                  </span>
                  {issues.length > 0 && (
                    <span style={{ fontSize: '10px', color: '#ef4444', fontWeight: 600, flexShrink: 0 }}>
                      {issues.length} err
                    </span>
                  )}
                </div>
              );
            })}
            {cmdNames.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 16px', color: 'rgba(255,255,255,0.3)', fontSize: '13px' }}>
                {filter ? 'No commands match filter' : 'No commands defined'}
              </div>
            )}
          </div>
        </div>
        </div>

        {/* ── CENTER PANEL: Detail ── */}
        <div className="card" style={{ flex: 1, minWidth: 0, borderRadius: '12px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Detail header */}
          <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(50,50,90,0.18)', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0, flexWrap: 'wrap' }}>
            {expanded && (
              <>
                <span style={{ fontSize: '10px', textTransform: 'uppercase', color: '#b0b0d0', letterSpacing: '0.08em', fontWeight: 700 }}>Details</span>
                <span style={{ fontSize: '15px', fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: '#b0c4ff' }}>{expanded}</span>
                <span style={{ fontSize: '10px', fontFamily: "'JetBrains Mono', monospace", color: 'rgba(255,255,255,0.3)' }}>
                  {(commands[expanded] || []).length} step{(commands[expanded] || []).length !== 1 ? 's' : ''}
                </span>
                {(() => {
                  const dur = cmdDuration(commands[expanded]);
                  return dur > 0 ? (
                    <span style={{ fontSize: '10px', fontFamily: "'JetBrains Mono', monospace", color: '#b0b0d0', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '5px', padding: '3px 10px' }}>
                      <span style={{ color: '#8090b0' }}>Duration</span> <span style={{ color: '#eeeeff', fontWeight: 600 }}>~{dur}ms</span>
                    </span>
                  ) : null;
                })()}
                {/* Action buttons */}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px', flexShrink: 0 }}>
                  {/* Copy */}
                  <button
                    onClick={() => { setClipboard({ name: expanded, actions: structuredClone(commands[expanded] || []) }); showToast(`Copied "${expanded}"`, 'success'); }}
                    style={{ width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', border: 'none', cursor: 'pointer', background: 'rgba(196,181,253,0.08)', color: '#c4b5fd', transition: 'all 0.15s' }}
                    title="Copy command"
                  >
                    <svg style={{ width: '14px', height: '14px' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                  {/* Rename */}
                  <button
                    onClick={() => setRenameCmd({ oldName: expanded, newName: expanded, source: 'center' })}
                    disabled={saving}
                    style={{ width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', border: 'none', cursor: 'pointer', background: 'rgba(56,189,248,0.08)', color: '#38bdf8', transition: 'all 0.15s', opacity: saving ? 0.4 : 1 }}
                    title="Rename"
                  >
                    <svg style={{ width: '14px', height: '14px' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  {/* Delete */}
                  <div style={{ position: 'relative' }}>
                    <button
                      onClick={() => setConfirmDeleteCmd(confirmDeleteCmd === expanded ? null : expanded)}
                      disabled={saving}
                      style={{ width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', border: 'none', cursor: 'pointer', background: confirmDeleteCmd === expanded ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.08)', color: '#ef4444', transition: 'all 0.15s', opacity: saving ? 0.4 : 1 }}
                      title="Delete command"
                    >
                      <svg style={{ width: '14px', height: '14px' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                    {confirmDeleteCmd === expanded && (
                      <div className="anim-fade-in" style={{ position: 'absolute', top: '100%', right: 0, marginTop: '4px', zIndex: 10, display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px', borderRadius: '8px', background: 'var(--color-bg-secondary, #0e0e15)', border: '1px solid rgba(239,68,68,0.4)', boxShadow: '0 4px 16px rgba(0,0,0,0.3)', whiteSpace: 'nowrap' }}>
                        <button onClick={() => handleDeleteCmd(expanded)} disabled={saving} style={{ fontSize: '12px', color: '#ef4444', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer' }}>Yes, delete</button>
                        <span style={{ color: 'rgba(255,255,255,0.15)' }}>|</span>
                        <button onClick={() => setConfirmDeleteCmd(null)} style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Detail body */}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: expanded ? '12px 16px' : '0' }}>
            {!expanded ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'rgba(255,255,255,0.25)', fontSize: '13px' }}>
                <span>Select a command to view details</span>
              </div>
            ) : (() => {
              const actions = commands[expanded] || [];
              const issues = getIssues(expanded);
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {/* Rename bar */}
                  {renameCmd?.oldName === expanded && renameCmd?.source !== 'left' && (
                    <div className="anim-fade-in" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 10px', borderRadius: '6px', background: 'rgba(124,106,239,0.05)', border: '1px solid rgba(124,106,239,0.3)' }}>
                      <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', flexShrink: 0 }}>Rename:</span>
                      <input
                        type="text"
                        value={renameCmd.newName}
                        onChange={e => setRenameCmd(prev => ({ ...prev, newName: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') handleRenameCmd(); if (e.key === 'Escape') setRenameCmd(null); }}
                        style={{ fontSize: '11px', fontFamily: "'JetBrains Mono', monospace", padding: '2px 6px', background: 'var(--color-bg-input)', border: '1px solid rgba(50,50,90,0.5)', borderRadius: '4px', color: '#eee', outline: 'none', width: `${Math.max(100, (renameCmd.newName?.length || 10) * 7 + 16)}px` }}
                        maxLength={100}
                        autoFocus
                      />
                      <button onClick={handleRenameCmd} disabled={saving || !renameCmd.newName.trim()} style={{ fontSize: '10px', color: '#7c6aef', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', opacity: (saving || !renameCmd.newName.trim()) ? 0.4 : 1 }}>Save</button>
                      <button onClick={() => setRenameCmd(null)} style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
                    </div>
                  )}

                  {/* Issues */}
                  {issues.map((iss, i) => (
                    <p key={i} className="text-xs text-danger flex items-center gap-1.5">
                      <svg className="w-3 h-3 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      {iss}
                    </p>
                  ))}

                  {/* Steps + Game Hooks row */}
                  <div style={{ display: 'flex', gap: '14px' }}>
                    {/* Steps area */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {actions.map((action, idx) => {
                        const isEditing = editStep?.cmdName === expanded && editStep?.stepIdx === idx;
                        if (isEditing) {
                          return (
                            <div key={idx} className="rounded-lg border border-accent/30 bg-accent/5 p-3 space-y-2" style={{ marginBottom: '4px' }}>
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
                        const listEditActive = editListInline?.cmdName === expanded && editListInline?.stepIdx === idx;
                        const isDragOver = dragOver?.cmdName === expanded && dragOver?.idx === idx;
                        const cc = cmdColor(action.command);
                        return (
                          <div key={idx}
                            draggable={!isEditing && !listEditActive && !saving}
                            onDragStart={e => {
                              dragRef.current = { cmdName: expanded, fromIdx: idx };
                              e.dataTransfer.effectAllowed = 'move';
                              e.currentTarget.style.opacity = '0.4';
                            }}
                            onDragEnd={e => {
                              e.currentTarget.style.opacity = '1';
                              dragRef.current = { cmdName: null, fromIdx: null };
                              setDragOver(null);
                            }}
                            onDragOver={e => {
                              if (dragRef.current.cmdName !== expanded) return;
                              e.preventDefault();
                              e.dataTransfer.dropEffect = 'move';
                              if (dragOver?.cmdName !== expanded || dragOver?.idx !== idx) setDragOver({ cmdName: expanded, idx });
                            }}
                            onDragLeave={() => { if (dragOver?.cmdName === expanded && dragOver?.idx === idx) setDragOver(null); }}
                            onDrop={e => {
                              e.preventDefault();
                              setDragOver(null);
                              const { cmdName: fromCmd, fromIdx } = dragRef.current;
                              if (fromCmd === expanded && fromIdx !== null && fromIdx !== idx) handleReorderStep(expanded, fromIdx, idx);
                              dragRef.current = { cmdName: null, fromIdx: null };
                            }}
                            style={{ borderBottom: idx < actions.length - 1 ? '1px solid rgba(50,50,90,0.18)' : 'none' }}
                          >
                            {isDragOver && <div style={{ height: '2px', background: '#7c6aef', borderRadius: '1px', marginTop: '-1px', marginBottom: '2px' }} />}
                            <div className="group/step" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 6px', transition: 'background 0.1s' }}
                              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.018)'; }}
                              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                            >
                              {/* Step number */}
                              <span style={{ fontSize: '10px', fontFamily: "'JetBrains Mono', monospace", color: 'rgba(255,255,255,0.3)', width: '22px', textAlign: 'right', flexShrink: 0, cursor: 'grab' }}>{idx + 1}</span>
                              {/* Command badge */}
                              <span style={{ fontSize: '9px', fontWeight: 600, padding: '2px 6px', borderRadius: '4px', background: cc.bg, color: cc.text, flexShrink: 0, width: '90px', textAlign: 'center', whiteSpace: 'nowrap' }}>{action.command}</span>
                              {/* Target */}
                              <span style={{ fontSize: '12px', fontFamily: "'JetBrains Mono', monospace", width: '148px', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                color: action.commandId
                                  ? (commands[action.commandId] ? '#f472b6' : '#ef4444')
                                  : action.spriteListId
                                    ? (spriteLists[action.spriteListId] ? cc.text : '#ef4444')
                                    : action.spriteId
                                      ? (soundSprites[action.spriteId] ? cc.text : '#ef4444')
                                      : 'rgba(255,255,255,0.3)',
                                textDecoration: (action.spriteId && !soundSprites[action.spriteId]) || (action.spriteListId && !spriteLists[action.spriteListId]) || (action.commandId && !commands[action.commandId]) ? 'line-through' : 'none',
                              }}>
                                {action.commandId ? `\u2192 ${action.commandId}` : action.spriteListId ? `list:${action.spriteListId}` : action.spriteId || '\u2014'}
                              </span>
                              {/* Parameters */}
                              <div style={{ display: 'flex', gap: '12px', fontFamily: "'JetBrains Mono', monospace", fontSize: '10px', minWidth: 0, flexWrap: 'wrap' }}>
                                {action.volume !== undefined && (
                                  <span><span style={{ color: 'rgba(255,255,255,0.3)' }}>vol:</span><span style={{ color: '#eeeeff', fontWeight: 500 }}>{action.volume}</span></span>
                                )}
                                {action.delay !== undefined && action.delay !== 0 && (
                                  <span><span style={{ color: 'rgba(255,255,255,0.3)' }}>+</span><span style={{ color: '#eeeeff', fontWeight: 500 }}>{action.delay}ms</span></span>
                                )}
                                {action.duration !== undefined && action.duration !== 0 && (
                                  <span><span style={{ color: 'rgba(255,255,255,0.3)' }}>dur:</span><span style={{ color: '#eeeeff', fontWeight: 500 }}>{action.duration}ms</span></span>
                                )}
                                {action.pan !== undefined && (
                                  <span><span style={{ color: 'rgba(255,255,255,0.3)' }}>pan:</span><span style={{ color: '#eeeeff', fontWeight: 500 }}>{action.pan}</span></span>
                                )}
                                {action.rate !== undefined && (
                                  <span><span style={{ color: 'rgba(255,255,255,0.3)' }}>rate:</span><span style={{ color: '#eeeeff', fontWeight: 500 }}>{action.rate}</span></span>
                                )}
                                {action.loop === -1 && <span style={{ color: '#38bdf8' }}>loop</span>}
                                {action.command === 'Play' && (action.cancelDelay === true || action.cancelDelay === 'true') && <span style={{ color: '#fb923c' }}>cancelDelay</span>}
                                {action.spriteId && soundSprites[action.spriteId]?.overlap && <span style={{ color: '#c4b5fd' }}>overlap</span>}
                                {action.spriteToPlay && <span style={{ color: '#4ade80', fontFamily: "'JetBrains Mono', monospace" }}>spriteToPlay:{action.spriteToPlay}</span>}
                              </div>
                              {/* Step actions */}
                              <div style={{ display: 'flex', gap: '3px', marginLeft: '8px', flexShrink: 0, opacity: 0, transition: 'opacity 0.15s' }} className="group-hover/step:!opacity-100">
                                {action.spriteListId && spriteLists[action.spriteListId] && (
                                  <button
                                    onClick={() => {
                                      if (listEditActive) { setEditListInline(null); return; }
                                      const list = spriteLists[action.spriteListId];
                                      const items = Array.isArray(list) ? [...list] : [...(list?.items || [])];
                                      setEditListInline({
                                        name: action.spriteListId, items, type: list?.type || 'random',
                                        overlap: list?.overlap ?? false, loop: list?.loop || 0, pan: list?.pan ?? 0,
                                        tags: [...(list?.tags || [])], cmdName: expanded, stepIdx: idx
                                      });
                                    }}
                                    disabled={saving}
                                    style={{ width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '5px', border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.03)', color: listEditActive ? '#c4b5fd' : 'rgba(255,255,255,0.3)', transition: 'all 0.15s' }}
                                    title={`Edit sprite list "${action.spriteListId}"`}
                                  >
                                    <svg style={{ width: '13px', height: '13px' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h8m-8 6h16" />
                                    </svg>
                                  </button>
                                )}
                                <button
                                  onClick={() => { setEditListInline(null); setEditStep({ cmdName: expanded, stepIdx: idx, ...stepFromAction(action, soundSprites) }); }}
                                  disabled={saving}
                                  style={{ width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '5px', border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.3)', transition: 'all 0.15s' }}
                                  title="Edit step"
                                  onMouseEnter={e => { e.currentTarget.style.color = '#38bdf8'; }}
                                  onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.3)'; }}
                                >
                                  <svg style={{ width: '13px', height: '13px' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                  </svg>
                                </button>
                                <button
                                  onClick={() => handleDeleteStep(expanded, idx)}
                                  disabled={saving}
                                  style={{ width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '5px', border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.3)', transition: 'all 0.15s' }}
                                  title="Delete step"
                                  onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; }}
                                  onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.3)'; }}
                                >
                                  <svg style={{ width: '13px', height: '13px' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              </div>
                            </div>

                            {/* Inline sprite list editor */}
                            {listEditActive && (
                              <div className="anim-fade-in" style={{ margin: '4px 0 4px 28px', borderRadius: '8px', border: '1px solid rgba(196,181,253,0.2)', background: 'rgba(196,181,253,0.03)', padding: '12px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                                  <span style={{ fontSize: '12px', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, color: '#c4b5fd' }}>{editListInline.name}</span>
                                  <div style={{ flex: 1 }} />
                                  <select value={editListInline.type} onChange={e => setEditListInline(p => ({ ...p, type: e.target.value }))} className="input-base" style={{ fontSize: '12px', padding: '2px 6px', width: 'auto' }}>
                                    <option value="random">random</option>
                                    <option value="sequential">sequential</option>
                                  </select>
                                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', flexShrink: 0 }}>
                                    <input type="checkbox" checked={editListInline.overlap} onChange={e => setEditListInline(p => ({ ...p, overlap: e.target.checked }))} style={{ width: '12px', height: '12px' }} className="accent-accent" />
                                    <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)' }}>Overlap</span>
                                  </label>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                                    <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)' }}>Loop:</span>
                                    {Array.isArray(editListInline.loop) ? (
                                      <span style={{ fontSize: '12px', color: '#7c6aef' }} title="Per-sprite loop">per-sprite</span>
                                    ) : (
                                      <input type="number" min="-1" step="1" value={editListInline.loop ?? 0} onChange={e => setEditListInline(p => ({ ...p, loop: parseInt(e.target.value) || 0 }))}
                                        className="input-base" style={{ fontSize: '12px', padding: '2px 0', width: '48px', textAlign: 'center' }} title="Loop count (-1 = infinite)" />
                                    )}
                                  </div>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                  {editListInline.items.map((id, i) => (
                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                      <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.3)', width: '16px', textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                                      <select value={id} onChange={e => setEditListInline(p => { const items = [...p.items]; items[i] = e.target.value; return { ...p, items }; })} className="input-base" style={{ fontSize: '12px', fontFamily: "'JetBrains Mono', monospace", flex: 1, padding: '2px 4px' }}>
                                        <option value="">-- select sprite --</option>
                                        {allSpriteIds.map(s => <option key={s}>{s}</option>)}
                                      </select>
                                      <button onClick={() => setEditListInline(p => ({ ...p, items: p.items.filter((_, j) => j !== i), pan: Array.isArray(p.pan) ? p.pan.filter((_, j) => j !== i) : p.pan }))}
                                        style={{ width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', border: 'none', cursor: 'pointer', background: 'transparent', color: 'rgba(255,255,255,0.3)', transition: 'color 0.15s' }}
                                        onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; }}
                                        onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.3)'; }}
                                        title="Remove sprite">
                                        <svg style={{ width: '12px', height: '12px' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                                      </button>
                                    </div>
                                  ))}
                                  <button onClick={() => setEditListInline(p => ({ ...p, items: [...p.items, ''], pan: Array.isArray(p.pan) ? [...p.pan, { '': 0 }] : p.pan }))} style={{ fontSize: '12px', color: '#7c6aef', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: '2px 0' }}>+ Add Sprite</button>
                                </div>

                                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', paddingTop: '6px' }}>
                                  <button onClick={() => setEditListInline(null)} style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
                                  <button onClick={handleSaveEditListInline} disabled={saving || editListInline.items.filter(Boolean).length === 0}
                                    className="btn-primary" style={{ fontSize: '12px', padding: '4px 12px', opacity: (saving || editListInline.items.filter(Boolean).length === 0) ? 0.4 : 1 }}>
                                    {saving ? '...' : 'Save List'}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {/* Add Step + Paste */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingTop: '6px' }}>
                        <button
                          onClick={() => setAddStep(emptyStep({ cmdName: expanded }))}
                          disabled={saving}
                          style={{ fontSize: '12px', fontWeight: 600, color: '#6b5bd6', background: 'none', border: 'none', cursor: 'pointer', opacity: saving ? 0.4 : 1 }}
                        >+ Add Step</button>
                        {clipboard?.actions?.length > 0 && clipboard.name !== expanded && (
                          <button
                            onClick={() => handlePasteSteps(expanded)}
                            disabled={saving}
                            style={{ fontSize: '12px', color: '#38bdf8', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', opacity: saving ? 0.4 : 1 }}
                            title={`Paste ${clipboard.actions.length} step(s) from "${clipboard.name}"`}
                          >
                            <svg style={{ width: '12px', height: '12px' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                            </svg>
                            Paste {clipboard.actions.length} step(s)
                          </button>
                        )}
                      </div>

                      {/* Inline Add Step form */}
                      {addStep && addStep.cmdName === expanded && (
                        <div style={{ marginTop: '6px', padding: '8px 10px', borderRadius: '6px', border: '1px solid rgba(107,91,214,0.15)', background: 'rgba(107,91,214,0.02)', fontSize: '11px' }}>
                          <div style={{ fontSize: '11px' }}>
                            <StepForm state={addStep} setState={setAddStep} soundSprites={soundSprites} spriteLists={spriteLists} commands={commands} onCreateList={handleInlineCreateList} />
                          </div>
                          <div style={{ display: 'flex', gap: '5px', justifyContent: 'flex-end', marginTop: '6px' }}>
                            <button onClick={() => setAddStep(null)} style={{ fontSize: '9px', padding: '3px 10px', borderRadius: '5px', background: 'none', color: '#6a6a96', border: '1px solid rgba(50,50,90,0.5)', cursor: 'pointer' }}>Cancel</button>
                            <button onClick={handleSaveAddStep} disabled={saving}
                              style={{ fontSize: '9px', fontWeight: 600, padding: '3px 10px', borderRadius: '5px', background: '#7c6aef', color: '#fff', border: 'none', cursor: 'pointer', opacity: saving ? 0.4 : 1 }}>
                              {saving ? '...' : 'Add'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Game Hooks panel */}
                    <div style={{ flexShrink: 0, width: 'fit-content', minWidth: '180px', maxWidth: '300px', borderRadius: '8px', border: '1px solid rgba(56,189,248,0.12)', background: 'rgba(56,189,248,0.02)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                      <div style={{ padding: '10px 12px', borderBottom: hooksCollapsed ? 'none' : '1px solid rgba(56,189,248,0.08)', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, cursor: 'pointer' }} onClick={() => setHooksCollapsed(p => !p)}>
                        <svg style={{ width: '10px', height: '10px', color: '#38bdf8', transition: 'transform 0.15s', transform: hooksCollapsed ? 'rotate(0deg)' : 'rotate(90deg)', flexShrink: 0 }} viewBox="0 0 20 20" fill="currentColor"><path d="M6 4l8 6-8 6V4z" /></svg>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: '#38bdf8' }}>Game Hooks</span>
                        {scanResult && <span className="badge bg-cyan-dim text-cyan">{scanResult.hooks.length}</span>}
                        <div style={{ flex: 1 }} />
                        <button
                          onClick={(e) => { e.stopPropagation(); handleScan(); }}
                          disabled={scanning || !project?.settings?.gameProjectPath}
                          style={{ fontSize: '10px', padding: '3px 10px', borderRadius: '5px', border: '1px solid rgba(56,189,248,0.3)', background: 'transparent', color: '#38bdf8', cursor: 'pointer', fontWeight: 500, opacity: (scanning || !project?.settings?.gameProjectPath) ? 0.4 : 1, display: 'flex', alignItems: 'center', gap: '5px' }}
                          title={!project?.settings?.gameProjectPath ? 'Game repo not configured' : 'Scan game source for hooks'}
                        >
                          {scanning && <span className="anim-pulse-dot" style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#38bdf8' }} />}
                          {scanning ? 'Scanning...' : 'Scan'}
                        </button>
                      </div>
                      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px', display: hooksCollapsed ? 'none' : 'block' }}>
                        {!scanResult ? (
                          <div style={{ textAlign: 'center', padding: '20px 8px', color: 'rgba(255,255,255,0.2)', fontSize: '11px' }}>
                            {!project?.settings?.gameProjectPath ? 'Game repo not configured' : 'Click Scan to analyze game hooks'}
                          </div>
                        ) : (() => {
                          const missingHooks = scanResult.hooks.filter(h => !h.inJson);
                          const emptyHooks = scanResult.hooks.filter(h => h.inJson && h.isEmpty);
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

                          const allClean = missingHooks.length === 0 && emptyHooks.length === 0 && deadCmds.length === 0;

                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                              {allClean && (
                                <div style={{ textAlign: 'center', padding: '12px', color: '#4ade80', fontSize: '11px', fontWeight: 500 }}>All hooks synced</div>
                              )}

                              {/* Missing hooks */}
                              {missingHooks.length > 0 && (
                                <div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                                    <span style={{ fontSize: '8px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#fb923c', fontWeight: 600 }}>Missing ({missingHooks.length})</span>
                                    <div style={{ flex: 1 }} />
                                    <button onClick={() => toggleAllAdd(true)} style={{ fontSize: '9px', color: '#38bdf8', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>Select all</button>
                                    <button onClick={() => toggleAllAdd(false)} style={{ fontSize: '9px', color: '#fb923c', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>Clear all</button>
                                  </div>
                                  {missingHooks.map(h => (
                                    <div key={h.name} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 6px' }}>
                                      <input type="checkbox" checked={!!scanFixInclude.add[h.name]} onChange={() => toggleAdd(h.name)} style={{ width: '10px', height: '10px' }} className="accent-accent" />
                                      <span style={{ fontSize: '9px', fontFamily: "'JetBrains Mono', monospace", color: '#fb923c', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.name}</span>
                                      <span style={{ fontSize: '8px', color: 'rgba(255,255,255,0.25)', textAlign: 'right', flexShrink: 0 }}>{scanSpriteMap[h.name] ? `\u2192 ${scanSpriteMap[h.name]}` : 'no match'}</span>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Empty hooks */}
                              {emptyHooks.length > 0 && (
                                <div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                                    <span style={{ fontSize: '8px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#eab308', fontWeight: 600 }}>Empty ({emptyHooks.length})</span>
                                    <div style={{ flex: 1 }} />
                                    <button onClick={() => toggleAllFill(true)} style={{ fontSize: '9px', color: '#38bdf8', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>Select all</button>
                                    <button onClick={() => toggleAllFill(false)} style={{ fontSize: '9px', color: '#fb923c', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>Clear all</button>
                                  </div>
                                  {emptyHooks.map(h => {
                                    const matched = scanSpriteMap[h.name];
                                    return (
                                      <div key={h.name} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 6px' }}>
                                        <input type="checkbox" checked={!!scanFixInclude.fill[h.name]} onChange={() => toggleFill(h.name)} disabled={!matched} style={{ width: '10px', height: '10px' }} className="accent-accent" />
                                        <span style={{ fontSize: '9px', fontFamily: "'JetBrains Mono', monospace", color: '#eab308', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.name}</span>
                                        <span style={{ fontSize: '8px', color: 'rgba(255,255,255,0.25)', textAlign: 'right', flexShrink: 0 }}>{matched ? `\u2192 ${matched}` : 'no match'}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}

                              {/* Unused commands */}
                              {deadCmds.length > 0 && (
                                <div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                                    <span style={{ fontSize: '8px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.35)', fontWeight: 600 }}>Unused ({deadCmds.length})</span>
                                    <div style={{ flex: 1 }} />
                                    <button onClick={() => toggleAllRemove(true)} style={{ fontSize: '9px', color: '#38bdf8', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>Select all</button>
                                    <button onClick={() => toggleAllRemove(false)} style={{ fontSize: '9px', color: '#fb923c', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>Clear all</button>
                                  </div>
                                  {deadCmds.map(n => (
                                    <div key={n} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 6px' }}>
                                      <input type="checkbox" checked={!!scanFixInclude.remove[n]} onChange={() => toggleRemove(n)} style={{ width: '10px', height: '10px' }} className="accent-accent" />
                                      <span style={{ fontSize: '9px', fontFamily: "'JetBrains Mono', monospace", color: 'rgba(255,255,255,0.3)', flex: 1, textDecoration: 'line-through', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n}</span>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Apply button */}
                              {totalFixes > 0 && (
                                <button
                                  onClick={handleApplyScanFixes}
                                  disabled={saving}
                                  className="btn-primary"
                                  style={{ width: '100%', fontSize: '11px', padding: '6px 0', opacity: saving ? 0.4 : 1 }}
                                >
                                  {saving ? 'Applying...' : `Apply ${totalFixes} fixes`}
                                </button>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  </div>

                  {/* Referenced Sounds */}
                  {expandedRefs.sprites.length > 0 && (
                    <div style={{ marginTop: '8px' }}>
                      <span style={{ fontSize: '10px', textTransform: 'uppercase', color: '#b0b0d0', letterSpacing: '0.08em', fontWeight: 700 }}>Referenced Sounds</span>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '8px' }}>
                        {expandedRefs.sprites.map(spriteId => {
                          const sprite = soundSprites[spriteId];
                          const tierInfo = getTierInfo(spriteId);
                          const refCmds = findReferencingCommands(spriteId);
                          // WAV info from project.sounds (real file data)
                          const wavName = spriteId.replace(/^s_/, '');
                          const wavInfo = (project?.sounds || []).find(s => s.name === wavName);
                          // Determine which command type references this sprite for color
                          const refAction = (commands[expanded] || []).find(a => a.spriteId === spriteId || (a.spriteListId && (() => {
                            const list = spriteLists[a.spriteListId];
                            const items = Array.isArray(list) ? list : (list?.items || []);
                            return items.includes(spriteId);
                          })()));
                          const refColor = refAction ? cmdColor(refAction.command).text : '#b0c4ff';

                          return (
                            <div key={spriteId} style={{ padding: '10px 14px', borderRadius: '8px', border: '1px solid rgba(50,50,90,0.25)', background: 'rgba(255,255,255,0.015)', transition: 'border-color 0.15s' }}
                              onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(124,106,239,0.3)'; }}
                              onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(50,50,90,0.25)'; }}
                            >
                              <div style={{ fontSize: '11px', fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: refColor, marginBottom: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{spriteId}</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                {wavInfo?.duration > 0 && (
                                  <div style={{ display: 'flex', gap: '4px' }}>
                                    <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', width: '52px', flexShrink: 0 }}>duration</span>
                                    <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)' }}>{wavInfo.duration.toFixed(2)}s</span>
                                  </div>
                                )}
                                {wavInfo && (
                                  <div style={{ display: 'flex', gap: '4px' }}>
                                    <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', width: '52px', flexShrink: 0 }}>format</span>
                                    <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)' }}>{wavInfo.bitDepth}-bit {(wavInfo.sampleRate/1000).toFixed(1)}kHz {wavInfo.channels === 1 ? 'mono' : 'stereo'}</span>
                                  </div>
                                )}
                                {wavInfo?.sizeKB > 0 && (
                                  <div style={{ display: 'flex', gap: '4px' }}>
                                    <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', width: '52px', flexShrink: 0 }}>size</span>
                                    <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)' }}>{wavInfo.sizeKB >= 1024 ? (wavInfo.sizeKB / 1024).toFixed(1) + ' MB' : wavInfo.sizeKB + ' KB'}</span>
                                  </div>
                                )}
                                {sprite?.tags?.length > 0 && (
                                  <div style={{ display: 'flex', gap: '4px' }}>
                                    <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', width: '52px', flexShrink: 0 }}>tags</span>
                                    <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)' }}>{sprite.tags.join(', ')}</span>
                                  </div>
                                )}
                              </div>
                              {tierInfo && (
                                <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                                  <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', width: '52px', flexShrink: 0 }}>tier</span>
                                  <span className="badge" style={{
                                    fontSize: '9px', padding: '1px 6px',
                                    background: tierInfo.tier === 'loading' ? 'rgba(52,211,153,0.1)' : tierInfo.tier === 'main' ? 'rgba(56,189,248,0.1)' : tierInfo.tier === 'bonus' ? 'rgba(196,181,253,0.1)' : tierInfo.tier === 'standalone' ? 'rgba(244,114,182,0.1)' : 'rgba(255,255,255,0.05)',
                                    color: tierInfo.tier === 'loading' ? '#34d399' : tierInfo.tier === 'main' ? '#38bdf8' : tierInfo.tier === 'bonus' ? '#c4b5fd' : tierInfo.tier === 'standalone' ? '#f472b6' : '#999',
                                  }}>{tierInfo.tier}</span>
                                  {tierInfo.subLoaderId && (
                                    <>
                                      <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginLeft: '4px' }}>loader</span>
                                      <span style={{ fontSize: '10px', color: tierInfo.subLoaderId === 'A' ? '#38bdf8' : '#fb923c' }}>SubLoader {tierInfo.subLoaderId}</span>
                                    </>
                                  )}
                                  {!tierInfo.subLoaderId && tierInfo.tier !== 'standalone' && (
                                    <>
                                      <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginLeft: '4px' }}>loader</span>
                                      <span style={{ fontSize: '10px', color: '#4ade80' }}>immediate</span>
                                    </>
                                  )}
                                </div>
                              )}
                              {tierInfo?.subLoaderId === 'B' && (
                                <div style={{ marginTop: '6px', padding: '4px 8px', borderRadius: '4px', background: 'rgba(251,146,60,0.08)', border: '1px solid rgba(251,146,60,0.2)', fontSize: '9px', color: '#fb923c' }}>
                                  {'\u26A0'} Requires startSubLoader("B")
                                </div>
                              )}
                              {/* Referenced commands chips */}
                              {refCmds.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
                                  {refCmds.map(cmd => (
                                    <span key={cmd} style={{
                                      fontSize: '9px', fontFamily: "'JetBrains Mono', monospace", padding: '1px 6px', borderRadius: '3px',
                                      background: cmd === expanded ? 'rgba(124,106,239,0.15)' : 'rgba(255,255,255,0.04)',
                                      color: cmd === expanded ? '#7c6aef' : 'rgba(255,255,255,0.35)',
                                      cursor: 'pointer',
                                    }} onClick={() => setExpanded(cmd)}>{cmd}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Referenced Sprite Lists */}
                  {expandedRefs.lists.length > 0 && (
                    <div style={{ marginTop: '8px' }}>
                      <span style={{ fontSize: '10px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', letterSpacing: '0.05em', fontWeight: 500 }}>Referenced Sprite Lists</span>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '8px' }}>
                        {expandedRefs.lists.map(listName => {
                          const list = spriteLists[listName];
                          if (!list) return null;
                          const items = Array.isArray(list) ? list : (list?.items || []);
                          const listType = list?.type || 'random';
                          return (
                            <div key={listName} style={{ padding: '10px 14px', borderRadius: '8px', border: '1px solid rgba(50,50,90,0.25)', background: 'rgba(255,255,255,0.015)' }}>
                              <div style={{ fontSize: '11px', fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: '#8ecae6', marginBottom: '4px' }}>{listName}</div>
                              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)' }}>{listType} \u00B7 {items.length} items</div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '4px' }}>
                                {items.map((item, i) => (
                                  <span key={i} style={{ fontSize: '9px', fontFamily: "'JetBrains Mono', monospace", color: soundSprites[item] ? 'rgba(255,255,255,0.5)' : '#ef4444', textDecoration: soundSprites[item] ? 'none' : 'line-through' }}>{item}{i < items.length - 1 ? ',' : ''}</span>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>

        {/* ── RIGHT PANEL: Sprite Lists ── */}
        <div className="card" style={{ width: '280px', flexShrink: 0, borderRadius: '12px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Panel header */}
          <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(50,50,90,0.18)', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#eee' }}>Sprite Lists</span>
            <span style={{ fontSize: '10px', fontFamily: "'JetBrains Mono', monospace", color: '#8ecae6', background: 'rgba(142,202,230,0.1)', padding: '1px 8px', borderRadius: '8px' }}>{Object.keys(spriteLists).length}</span>
            <div style={{ flex: 1 }} />
            <button
              onClick={() => setNewList({ name: '', items: [''], type: 'random', overlap: true, loop: 0, pan: 0, tags: [] })}
              disabled={saving}
              style={{ fontSize: '10px', padding: '4px 10px', borderRadius: '6px', border: 'none', cursor: 'pointer', background: '#7c6aef', color: '#fff', fontWeight: 600, opacity: saving ? 0.4 : 1 }}
            >+ New List</button>
          </div>

          {/* Sprite list items */}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {/* Inline New List form */}
            {newList && (
              <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(50,50,90,0.18)', background: 'rgba(139,124,248,0.03)' }}>
                <input type="text" value={newList.name} onChange={e => setNewList(p => ({ ...p, name: e.target.value }))}
                  placeholder="sl_ListName" autoFocus
                  style={{ width: '100%', padding: '4px 8px', background: 'var(--color-bg-input)', border: '1px solid rgba(50,50,90,0.5)', borderRadius: '6px', color: '#eee', fontSize: '11px', fontFamily: "'JetBrains Mono', monospace", outline: 'none', marginBottom: '6px' }} />
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '5px', flexWrap: 'wrap' }}>
                  <select value={newList.type} onChange={e => setNewList(p => ({ ...p, type: e.target.value }))}
                    style={{ padding: '3px 6px', background: 'var(--color-bg-input)', border: '1px solid rgba(50,50,90,0.5)', borderRadius: '5px', color: '#eee', fontSize: '10px', outline: 'none' }}>
                    <option value="random">random</option>
                    <option value="sequential">sequential</option>
                  </select>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '3px', cursor: 'pointer', fontSize: '9px', color: '#6a6a96' }}>
                    <input type="checkbox" checked={newList.overlap} onChange={e => setNewList(p => ({ ...p, overlap: e.target.checked }))} style={{ width: '11px', height: '11px' }} className="accent-accent" /> Overlap
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '9px', color: '#6a6a96' }}>
                    Loop {!Array.isArray(newList.loop) ? (
                      <input type="number" value={newList.loop ?? 0} onChange={e => setNewList(p => ({ ...p, loop: parseInt(e.target.value) || 0 }))}
                        style={{ width: '32px', padding: '2px 3px', background: 'var(--color-bg-input)', border: '1px solid rgba(50,50,90,0.5)', borderRadius: '4px', color: '#38bdf8', fontSize: '9px', textAlign: 'center', fontFamily: "'JetBrains Mono', monospace", outline: 'none' }} />
                    ) : <span style={{ color: '#38bdf8', fontSize: '8px' }}>per-sprite</span>}
                  </label>
                  <button onClick={() => setNewList(p => ({ ...p, loop: Array.isArray(p.loop) ? 0 : p.items.map(id => ({ [id]: typeof p.loop === 'number' ? p.loop : 0 })) }))}
                    style={{ fontSize: '8px', color: '#7c6aef', background: 'none', border: 'none', cursor: 'pointer' }}>{Array.isArray(newList.loop) ? 'uniform' : 'per-sprite'}</button>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '9px', color: '#6a6a96' }}>
                    Pan {!Array.isArray(newList.pan) ? (
                      <input type="number" value={newList.pan ?? 0} min="-1" max="1" step="0.1" onChange={e => setNewList(p => ({ ...p, pan: parseFloat(e.target.value) || 0 }))}
                        style={{ width: '32px', padding: '2px 3px', background: 'var(--color-bg-input)', border: '1px solid rgba(50,50,90,0.5)', borderRadius: '4px', color: '#b0b0d0', fontSize: '9px', textAlign: 'center', fontFamily: "'JetBrains Mono', monospace", outline: 'none' }} />
                    ) : <span style={{ color: '#b0b0d0', fontSize: '8px' }}>per-sprite</span>}
                  </label>
                  <button onClick={() => setNewList(p => ({ ...p, pan: Array.isArray(p.pan) ? 0 : p.items.map(id => ({ [id]: typeof p.pan === 'number' ? p.pan : 0 })) }))}
                    style={{ fontSize: '8px', color: '#7c6aef', background: 'none', border: 'none', cursor: 'pointer' }}>{Array.isArray(newList.pan) ? 'uniform' : 'per-sprite'}</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginBottom: '6px' }}>
                  {newList.items.map((id, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <span style={{ fontSize: '8px', color: '#6a6a96', width: '12px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>{idx + 1}</span>
                      <select value={id} onChange={e => setNewList(p => { const items = [...p.items]; items[idx] = e.target.value; return { ...p, items }; })}
                        style={{ flex: 1, padding: '2px 4px', background: 'var(--color-bg-input)', border: '1px solid rgba(50,50,90,0.5)', borderRadius: '4px', color: '#eee', fontSize: '9px', fontFamily: "'JetBrains Mono', monospace", outline: 'none' }}>
                        <option value="">— select —</option>
                        {allSpriteIds.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <button onClick={() => setNewList(p => ({ ...p, items: p.items.filter((_, i) => i !== idx), loop: Array.isArray(p.loop) ? p.loop.filter((_, i) => i !== idx) : p.loop, pan: Array.isArray(p.pan) ? p.pan.filter((_, i) => i !== idx) : p.pan }))}
                        style={{ width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', color: '#6a6a96', cursor: 'pointer', fontSize: '11px' }}>&times;</button>
                    </div>
                  ))}
                  <button onClick={() => setNewList(p => ({ ...p, items: [...p.items, ''], loop: Array.isArray(p.loop) ? [...p.loop, { '': 0 }] : p.loop, pan: Array.isArray(p.pan) ? [...p.pan, { '': 0 }] : p.pan }))}
                    style={{ fontSize: '9px', color: '#7c6aef', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: '1px 0' }}>+ Add</button>
                </div>
                <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                  <button onClick={handleSaveNewList} disabled={saving || !newList.name.trim() || newList.items.filter(Boolean).length === 0}
                    style={{ fontSize: '9px', fontWeight: 600, padding: '3px 10px', borderRadius: '5px', background: '#7c6aef', color: '#fff', border: 'none', cursor: 'pointer', opacity: (saving || !newList.name.trim() || newList.items.filter(Boolean).length === 0) ? 0.4 : 1 }}>
                    {saving ? '...' : 'Create'}
                  </button>
                  <button onClick={() => setNewList(null)}
                    style={{ fontSize: '9px', padding: '3px 10px', borderRadius: '5px', background: 'none', color: '#6a6a96', border: '1px solid rgba(50,50,90,0.5)', cursor: 'pointer' }}>Cancel</button>
                </div>
              </div>
            )}
            {spriteListNames.map((name) => {
              const list = spriteLists[name];
              const items = Array.isArray(list) ? list : (list?.items || []);
              const listType = list?.type || 'random';
              const overlap = list?.overlap ?? false;
              const tags = list?.tags || [];
              const isEditing = editList?.name === name || (editList?._originalName === name);

              return (
                <div key={name}>
                  <div
                    onClick={() => setEditList(isEditing ? null : { name, _originalName: name, items: [...items], type: listType, overlap, loop: list?.loop ?? 0, pan: list?.pan ?? 0, tags: [...tags] })}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 16px',
                      borderBottom: '1px solid rgba(50,50,90,0.18)', cursor: 'pointer',
                      background: isEditing ? 'rgba(142,202,230,0.04)' : 'transparent',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => { if (!isEditing) e.currentTarget.style.background = 'rgba(255,255,255,0.015)'; }}
                    onMouseLeave={e => { if (!isEditing) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{ fontSize: '12px', fontFamily: "'JetBrains Mono', monospace", color: '#8ecae6', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                    <span style={{ fontSize: '9px', fontFamily: "'JetBrains Mono', monospace", color: 'rgba(255,255,255,0.3)' }}>{listType}</span>
                    <span style={{ fontSize: '10px', fontFamily: "'JetBrains Mono', monospace", color: 'rgba(255,255,255,0.3)' }}>{items.length}</span>
                    {!referencedLists.has(name) && (
                      <span style={{ fontSize: '9px', color: '#fb923c', background: 'rgba(251,146,60,0.1)', padding: '1px 6px', borderRadius: '6px' }}>unused</span>
                    )}
                  </div>

                  {/* Inline editor */}
                  {isEditing && editList && (
                    <div className="anim-fade-in" style={{ padding: '12px 14px', background: 'rgba(196,181,253,0.03)', borderBottom: '1px solid rgba(50,50,90,0.18)' }}>
                      {/* Name */}
                      <div style={{ marginBottom: '8px' }}>
                        <input type="text" value={editList.name} onChange={e => setEditList(p => ({ ...p, name: e.target.value }))}
                          className="input-base" style={{ fontSize: '11px', fontFamily: "'JetBrains Mono', monospace", width: '100%', padding: '4px 8px' }} maxLength={100} />
                      </div>
                      {/* Type + Overlap */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                        <select value={editList.type} onChange={e => setEditList(p => ({ ...p, type: e.target.value }))} className="input-base" style={{ fontSize: '10px', padding: '3px 6px', width: 'auto' }}>
                          <option value="random">random</option>
                          <option value="sequential">sequential</option>
                        </select>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                          <input type="checkbox" checked={editList.overlap} onChange={e => setEditList(p => ({ ...p, overlap: e.target.checked }))} style={{ width: '12px', height: '12px' }} className="accent-accent" />
                          <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>Overlap</span>
                        </label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>Loop:</span>
                          {!Array.isArray(editList.loop) ? (
                            <>
                              <input type="number" min="-1" step="1" value={editList.loop ?? 0} onChange={e => setEditList(p => ({ ...p, loop: parseInt(e.target.value) || 0 }))} className="input-base" style={{ fontSize: '10px', padding: '2px', width: '36px', textAlign: 'center' }} />
                              <button type="button" onClick={() => setEditList(p => ({ ...p, loop: p.items.map(id => ({ [id]: (p.loop && p.loop !== 0) ? p.loop : -1 })) }))}
                                style={{ fontSize: '9px', color: '#7c6aef', background: 'none', border: 'none', cursor: 'pointer' }}>per sprite</button>
                            </>
                          ) : (
                            <button type="button" onClick={() => setEditList(p => ({ ...p, loop: 0 }))}
                              style={{ fontSize: '9px', color: '#7c6aef', background: 'none', border: 'none', cursor: 'pointer' }}>uniform</button>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>Pan:</span>
                          {!Array.isArray(editList.pan) ? (
                            <>
                              <input type="number" min="-1" max="1" step="0.1" value={editList.pan ?? 0} onChange={e => setEditList(p => ({ ...p, pan: parseFloat(e.target.value) || 0 }))} className="input-base" style={{ fontSize: '10px', padding: '2px', width: '36px', textAlign: 'center' }} />
                              <button type="button" onClick={() => setEditList(p => ({ ...p, pan: p.items.map(id => ({ [id]: (p.pan && p.pan !== 0) ? p.pan : 0 })) }))}
                                style={{ fontSize: '9px', color: '#7c6aef', background: 'none', border: 'none', cursor: 'pointer' }}>per sprite</button>
                            </>
                          ) : (
                            <button type="button" onClick={() => setEditList(p => ({ ...p, pan: 0 }))}
                              style={{ fontSize: '9px', color: '#7c6aef', background: 'none', border: 'none', cursor: 'pointer' }}>uniform</button>
                          )}
                        </div>
                      </div>
                      {/* Tags */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>Tags:</span>
                        {(editList.tags || []).map((t, ti) => (
                          <span key={ti} style={{ fontSize: '9px', padding: '1px 6px', borderRadius: '4px', background: 'rgba(56,189,248,0.08)', color: 'rgba(56,189,248,0.7)', fontFamily: "'JetBrains Mono', monospace", display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            {t}
                            <button onClick={() => setEditList(p => ({ ...p, tags: p.tags.filter((_, i) => i !== ti) }))}
                              style={{ background: 'none', border: 'none', color: 'rgba(56,189,248,0.4)', cursor: 'pointer', fontSize: '10px', padding: 0 }}>&times;</button>
                          </span>
                        ))}
                        <button onClick={() => {
                          const tag = prompt('Tag name:');
                          if (tag?.trim()) setEditList(p => ({ ...p, tags: [...(p.tags || []), tag.trim()] }));
                        }} style={{ fontSize: '9px', color: '#7c6aef', background: 'none', border: 'none', cursor: 'pointer' }}>+ tag</button>
                      </div>
                      {/* Items */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginBottom: '8px' }}>
                        {editList.items.map((id, idx) => (
                          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', width: '14px', textAlign: 'right', flexShrink: 0 }}>{idx + 1}</span>
                            <select value={id} onChange={e => setEditList(p => {
                              const items2 = [...p.items]; items2[idx] = e.target.value;
                              const loop2 = Array.isArray(p.loop) ? p.loop.map((l, i) => i === idx ? { [e.target.value]: Object.values(l)[0] || 0 } : l) : p.loop;
                              const pan2 = Array.isArray(p.pan) ? p.pan.map((pn, i) => i === idx ? { [e.target.value]: Object.values(pn)[0] || 0 } : pn) : p.pan;
                              return { ...p, items: items2, loop: loop2, pan: pan2 };
                            })} className="input-base" style={{ fontSize: '10px', fontFamily: "'JetBrains Mono', monospace", flex: 1, padding: '2px 4px' }}>
                              <option value="">-- select --</option>
                              {allSpriteIds.map(s => <option key={s}>{s}</option>)}
                            </select>
                            {Array.isArray(editList.loop) && (
                              <input type="number" min="-1" step="1"
                                value={editList.loop[idx] ? Object.values(editList.loop[idx])[0] ?? 0 : 0}
                                onChange={e => setEditList(p => {
                                  const loop2 = [...p.loop];
                                  loop2[idx] = { [p.items[idx]]: parseInt(e.target.value) || 0 };
                                  return { ...p, loop: loop2 };
                                })}
                                className="input-base" style={{ fontSize: '10px', width: '36px', textAlign: 'center', flexShrink: 0, padding: '2px' }} />
                            )}
                            {Array.isArray(editList.pan) && (
                              <input type="number" min="-1" max="1" step="0.1"
                                value={editList.pan[idx] ? Object.values(editList.pan[idx])[0] ?? 0 : 0}
                                onChange={e => setEditList(p => {
                                  const pan2 = [...p.pan];
                                  pan2[idx] = { [p.items[idx]]: parseFloat(e.target.value) || 0 };
                                  return { ...p, pan: pan2 };
                                })}
                                className="input-base" style={{ fontSize: '10px', width: '36px', textAlign: 'center', flexShrink: 0, padding: '2px' }} />
                            )}
                            <button onClick={() => setEditList(p => {
                              const items2 = p.items.filter((_, i) => i !== idx);
                              const loop2 = Array.isArray(p.loop) ? p.loop.filter((_, i) => i !== idx) : p.loop;
                              const pan2 = Array.isArray(p.pan) ? p.pan.filter((_, i) => i !== idx) : p.pan;
                              return { ...p, items: items2, loop: loop2, pan: pan2 };
                            })} style={{ width: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '3px', border: 'none', cursor: 'pointer', background: 'transparent', color: 'rgba(255,255,255,0.3)' }}
                              onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; }}
                              onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.3)'; }}>
                              <svg style={{ width: '10px', height: '10px' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          </div>
                        ))}
                      </div>
                      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                        <button onClick={() => setEditList(p => ({
                          ...p, items: [...p.items, ''],
                          loop: Array.isArray(p.loop) ? [...p.loop, { '': 0 }] : p.loop,
                          pan: Array.isArray(p.pan) ? [...p.pan, { '': 0 }] : p.pan
                        }))} style={{ fontSize: '10px', color: '#7c6aef', background: 'none', border: 'none', cursor: 'pointer' }}>+ Add One</button>
                        <button onClick={() => setEditList(p => ({ ...p, _showBulkAdd: !p._showBulkAdd }))}
                          style={{ fontSize: '10px', color: '#7c6aef', background: 'none', border: 'none', cursor: 'pointer' }}>+ Add Multiple</button>
                      </div>
                      {/* Bulk add */}
                      {editList._showBulkAdd && (() => {
                        const alreadyIn = new Set(editList.items);
                        const available = allSpriteIds.filter(id => !alreadyIn.has(id));
                        return (
                          <div style={{ border: '1px solid rgba(50,50,90,0.3)', borderRadius: '8px', padding: '10px', background: 'rgba(255,255,255,0.02)', marginBottom: '8px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                              <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)' }}>{available.length} available</span>
                              <div style={{ display: 'flex', gap: '8px' }}>
                                <button onClick={() => setEditList(p => ({ ...p, _bulkSelected: new Set(available) }))} style={{ fontSize: '9px', color: '#7c6aef', background: 'none', border: 'none', cursor: 'pointer' }}>Select All</button>
                                <button onClick={() => setEditList(p => ({ ...p, _bulkSelected: new Set() }))} style={{ fontSize: '9px', color: 'rgba(255,255,255,0.3)', background: 'none', border: 'none', cursor: 'pointer' }}>Clear</button>
                              </div>
                            </div>
                            <div style={{ maxHeight: '120px', overflowY: 'auto' }}>
                              {available.map(id => (
                                <label key={id} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 4px', cursor: 'pointer' }}>
                                  <input type="checkbox" checked={editList._bulkSelected?.has(id) || false}
                                    onChange={e => setEditList(p => {
                                      const sel = new Set(p._bulkSelected || []);
                                      if (e.target.checked) sel.add(id); else sel.delete(id);
                                      return { ...p, _bulkSelected: sel };
                                    })} style={{ width: '10px', height: '10px' }} className="accent-accent" />
                                  <span style={{ fontSize: '10px', fontFamily: "'JetBrains Mono', monospace", color: 'rgba(255,255,255,0.5)' }}>{id}</span>
                                </label>
                              ))}
                            </div>
                            <button onClick={() => setEditList(p => {
                              const toAdd = [...(p._bulkSelected || [])].filter(Boolean);
                              if (!toAdd.length) return p;
                              return { ...p, items: [...p.items, ...toAdd], loop: Array.isArray(p.loop) ? [...p.loop, ...toAdd.map(id => ({ [id]: 0 }))] : p.loop, pan: Array.isArray(p.pan) ? [...p.pan, ...toAdd.map(id => ({ [id]: 0 }))] : p.pan, _bulkSelected: new Set(), _showBulkAdd: false };
                            })} disabled={!editList._bulkSelected?.size}
                              className="btn-primary" style={{ width: '100%', fontSize: '10px', padding: '5px 0', marginTop: '6px', opacity: editList._bulkSelected?.size ? 1 : 0.4 }}>
                              Add {editList._bulkSelected?.size || 0} Selected
                            </button>
                          </div>
                        );
                      })()}
                      {/* Actions */}
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <button onClick={handleSaveEditList} disabled={saving || !editList.name.trim() || editList.items.filter(Boolean).length === 0}
                          className="btn-primary" style={{ fontSize: '10px', padding: '5px 14px', opacity: (saving || !editList.name.trim() || editList.items.filter(Boolean).length === 0) ? 0.4 : 1 }}>
                          {saving ? '...' : 'Save'}
                        </button>
                        <button onClick={() => setEditList(null)} style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', background: 'none', border: '1px solid rgba(50,50,90,0.3)', borderRadius: '6px', padding: '4px 12px', cursor: 'pointer' }}>Cancel</button>
                        <div style={{ flex: 1 }} />
                        <div style={{ position: 'relative' }}>
                          <button onClick={() => setConfirmDeleteList(confirmDeleteList === name ? null : name)} disabled={saving}
                            style={{ fontSize: '10px', color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', opacity: saving ? 0.4 : 1 }}>Del</button>
                          {confirmDeleteList === name && (
                            <div className="anim-fade-in" style={{ position: 'absolute', bottom: '100%', right: 0, marginBottom: '4px', zIndex: 10, display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px', borderRadius: '8px', background: 'var(--color-bg-secondary, #0e0e15)', border: '1px solid rgba(239,68,68,0.4)', boxShadow: '0 4px 16px rgba(0,0,0,0.3)', whiteSpace: 'nowrap' }}>
                              <button onClick={() => handleDeleteList(name)} disabled={saving} style={{ fontSize: '11px', color: '#ef4444', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer' }}>Yes, delete</button>
                              <span style={{ color: 'rgba(255,255,255,0.15)' }}>|</span>
                              <button onClick={() => setConfirmDeleteList(null)} style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {spriteListNames.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 16px', color: 'rgba(255,255,255,0.25)', fontSize: '12px' }}>
                {filter ? 'No lists match' : 'No sprite lists'}
              </div>
            )}
          </div>
        </div>

      </div>

      {/* ══════════ MODALS (kept as-is) ══════════ */}

      {/* New List modal removed — now inline in right panel */}
      {false && newList && (() => {
        const st = newList;
        const setSt = setNewList;
        const handleSave = handleSaveNewList;
        const spriteIds = Object.keys(soundSprites).sort();
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setSt(null)} onKeyDown={e => { if (e.key === 'Escape') setSt(null); }}>
            <div className="bg-bg-secondary border border-border rounded-2xl shadow-2xl w-[520px] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="p-5 border-b border-border">
                <h3 className="text-sm font-bold text-text-primary">New Sprite List</h3>
              </div>
              <div className="p-5 space-y-4 flex-1 overflow-y-auto">
                <div>
                  <label className="section-label mb-1 block">List Name</label>
                  <input type="text" value={st.name} onChange={e => setSt(p => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. sl_VOPreCog" className="input-base text-xs font-mono w-full" maxLength={100} autoFocus />
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="section-label mb-1 block">Type</label>
                    <select value={st.type} onChange={e => setSt(p => ({ ...p, type: e.target.value }))} className="input-base text-xs w-full">
                      <option value="random">random</option>
                      <option value="sequential">sequential</option>
                    </select>
                  </div>
                  <div>
                    <label className="section-label mb-1 block">Loop</label>
                    <div className="flex items-center gap-2">
                      {!Array.isArray(st.loop) ? (
                        <>
                          <input type="number" min="-1" step="1" value={st.loop ?? 0} onChange={e => setSt(p => ({ ...p, loop: parseInt(e.target.value) || 0 }))} className="input-base text-xs w-16 text-center" />
                          <button type="button" onClick={() => setSt(p => ({ ...p, loop: p.items.map(id => ({ [id]: (p.loop && p.loop !== 0) ? p.loop : -1 })) }))}
                            className="text-[10px] text-accent hover:text-accent/80">per sprite</button>
                        </>
                      ) : (
                        <button type="button" onClick={() => setSt(p => ({ ...p, loop: 0 }))}
                          className="text-[10px] text-accent hover:text-accent/80">uniform</button>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="section-label mb-1 block">Pan</label>
                    <div className="flex items-center gap-2">
                      {!Array.isArray(st.pan) ? (
                        <>
                          <input type="number" min="-1" max="1" step="0.1" value={st.pan ?? 0} onChange={e => setSt(p => ({ ...p, pan: parseFloat(e.target.value) || 0 }))} className="input-base text-xs w-16 text-center" />
                          <button type="button" onClick={() => setSt(p => ({ ...p, pan: p.items.map(id => ({ [id]: (p.pan && p.pan !== 0) ? p.pan : 0 })) }))}
                            className="text-[10px] text-accent hover:text-accent/80">per sprite</button>
                        </>
                      ) : (
                        <button type="button" onClick={() => setSt(p => ({ ...p, pan: 0 }))}
                          className="text-[10px] text-accent hover:text-accent/80">uniform</button>
                      )}
                    </div>
                  </div>
                  <div className="flex items-end pb-1">
                    <label className="flex items-center gap-2 cursor-pointer">
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
                        <select value={id} onChange={e => setSt(p => {
                          const items = [...p.items]; items[idx] = e.target.value;
                          const loop = Array.isArray(p.loop) ? p.loop.map((l, i) => i === idx ? { [e.target.value]: Object.values(l)[0] || 0 } : l) : p.loop;
                          const pan = Array.isArray(p.pan) ? p.pan.map((pn, i) => i === idx ? { [e.target.value]: Object.values(pn)[0] || 0 } : pn) : p.pan;
                          return { ...p, items, loop, pan };
                        })} className="input-base text-xs font-mono flex-1 py-1">
                          <option value="">-- select --</option>
                          {spriteIds.map(s => <option key={s}>{s}</option>)}
                        </select>
                        {Array.isArray(st.loop) && (
                          <input type="number" min="-1" step="1"
                            value={st.loop[idx] ? Object.values(st.loop[idx])[0] ?? 0 : 0}
                            onChange={e => setSt(p => {
                              const loop = [...p.loop];
                              loop[idx] = { [p.items[idx]]: parseInt(e.target.value) || 0 };
                              return { ...p, loop };
                            })}
                            className="input-base text-xs w-14 text-center shrink-0" />
                        )}
                        {Array.isArray(st.pan) && (
                          <input type="number" min="-1" max="1" step="0.1"
                            value={st.pan[idx] ? Object.values(st.pan[idx])[0] ?? 0 : 0}
                            onChange={e => setSt(p => {
                              const pan = [...p.pan];
                              pan[idx] = { [p.items[idx]]: parseFloat(e.target.value) || 0 };
                              return { ...p, pan };
                            })}
                            className="input-base text-xs w-14 text-center shrink-0" />
                        )}
                        <button onClick={() => setSt(p => {
                          const items = p.items.filter((_, i) => i !== idx);
                          const loop = Array.isArray(p.loop) ? p.loop.filter((_, i) => i !== idx) : p.loop;
                          const pan = Array.isArray(p.pan) ? p.pan.filter((_, i) => i !== idx) : p.pan;
                          return { ...p, items, loop, pan };
                        })} className="w-5 h-5 flex items-center justify-center rounded text-text-dim hover:text-danger transition-colors">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <button onClick={() => setSt(p => ({
                      ...p, items: [...p.items, ''],
                      loop: Array.isArray(p.loop) ? [...p.loop, { '': 0 }] : p.loop,
                      pan: Array.isArray(p.pan) ? [...p.pan, { '': 0 }] : p.pan
                    }))} className="text-xs text-accent hover:text-accent/80 transition-colors">
                      + Add One
                    </button>
                    <button onClick={() => setSt(p => ({ ...p, _showBulkAdd: !p._showBulkAdd }))}
                      className="text-xs text-accent hover:text-accent/80 transition-colors">
                      + Add Multiple
                    </button>
                  </div>
                  {st._showBulkAdd && (() => {
                    const alreadyIn = new Set(st.items);
                    const available = spriteIds.filter(id => !alreadyIn.has(id));
                    return (
                      <div className="mt-2 border border-border/50 rounded-lg p-3 bg-bg-hover/20 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-text-dim">{available.length} available</span>
                          <div className="flex gap-2">
                            <button onClick={() => setSt(p => ({ ...p, _bulkSelected: new Set(available) }))}
                              className="text-[10px] text-accent hover:text-accent/80">Select All</button>
                            <button onClick={() => setSt(p => ({ ...p, _bulkSelected: new Set() }))}
                              className="text-[10px] text-text-dim hover:text-text-secondary">Clear</button>
                          </div>
                        </div>
                        <div className="max-h-36 overflow-y-auto space-y-0.5">
                          {available.map(id => (
                            <label key={id} className="flex items-center gap-2 py-0.5 px-1 rounded hover:bg-bg-hover/30 cursor-pointer">
                              <input type="checkbox" checked={st._bulkSelected?.has(id) || false}
                                onChange={e => setSt(p => {
                                  const sel = new Set(p._bulkSelected || []);
                                  if (e.target.checked) sel.add(id); else sel.delete(id);
                                  return { ...p, _bulkSelected: sel };
                                })} className="w-3 h-3 accent-accent" />
                              <span className="text-xs font-mono text-text-secondary">{id}</span>
                            </label>
                          ))}
                        </div>
                        <button onClick={() => setSt(p => {
                          const toAdd = [...(p._bulkSelected || [])].filter(Boolean);
                          if (!toAdd.length) return p;
                          const newItems = [...p.items, ...toAdd];
                          const newLoop = Array.isArray(p.loop) ? [...p.loop, ...toAdd.map(id => ({ [id]: 0 }))] : p.loop;
                          const newPan = Array.isArray(p.pan) ? [...p.pan, ...toAdd.map(id => ({ [id]: 0 }))] : p.pan;
                          return { ...p, items: newItems, loop: newLoop, pan: newPan, _bulkSelected: new Set(), _showBulkAdd: false };
                        })} disabled={!st._bulkSelected?.size}
                          className={st._bulkSelected?.size ? 'btn-primary text-xs py-1.5 px-4 w-full' : 'btn-ghost text-xs py-1.5 px-4 w-full opacity-40 cursor-not-allowed'}>
                          Add {st._bulkSelected?.size || 0} Selected
                        </button>
                      </div>
                    );
                  })()}
                </div>
              </div>
              <div className="p-4 border-t border-border flex gap-2 justify-end">
                <button onClick={() => setSt(null)} className="btn-ghost text-xs px-4 py-2">Cancel</button>
                <button onClick={handleSave} disabled={saving || !st.name.trim() || st.items.filter(Boolean).length === 0}
                  className="btn-primary text-xs px-4 py-2 disabled:opacity-40">
                  {saving ? 'Saving...' : 'Create List'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* New Command Modal — disabled, now inline */}
      {false && newCmd && (
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

      {/* Add Step Modal — disabled, now inline */}
      {false && addStep && (
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

      {/* Auto-Generate Modal */}
      {false && genPreview && (
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
