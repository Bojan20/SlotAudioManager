import React, { useState, useEffect, useRef, useMemo } from 'react';

// Decode WAV manually — scans fmt/data chunks properly, handles 8/16/24/32-bit PCM and 32-bit float.
// Never calls decodeAudioData (crashes Electron renderer on 24-bit and 32-bit int WAV).
function decodeWav(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const tag4 = (o) => String.fromCharCode(view.getUint8(o), view.getUint8(o+1), view.getUint8(o+2), view.getUint8(o+3));
  if (tag4(0) !== 'RIFF' || tag4(8) !== 'WAVE') throw new Error('Not a valid WAV file');

  // Scan all chunks to find fmt and data
  let audioFormat = 0, numChannels = 0, sampleRate = 0, bitsPerSample = 0;
  let dataOffset = -1, dataSize = 0;
  let pos = 12;
  while (pos + 8 <= arrayBuffer.byteLength) {
    const chunkId = tag4(pos);
    const chunkSize = view.getUint32(pos + 4, true);
    if (chunkId === 'fmt ' && chunkSize >= 16) {
      audioFormat  = view.getUint16(pos + 8,  true);
      numChannels  = view.getUint16(pos + 10, true);
      sampleRate   = view.getUint32(pos + 12, true);
      bitsPerSample = view.getUint16(pos + 22, true);
    } else if (chunkId === 'data') {
      dataOffset = pos + 8;
      dataSize   = chunkSize;
      break;
    }
    const nextPos = pos + 8 + chunkSize + (chunkSize % 2); // word-align
    if (nextPos <= pos) break; // guard against corrupt chunk size causing infinite loop
    pos = nextPos;
  }
  if (dataOffset < 0) throw new Error('WAV data chunk not found');
  if (!numChannels || !sampleRate || !bitsPerSample) throw new Error('WAV fmt chunk not found or invalid');

  const bytesPerSample = bitsPerSample >> 3;
  const numSamples = Math.floor(dataSize / (numChannels * bytesPerSample));
  if (numSamples <= 0) throw new Error('WAV contains no audio samples');
  const ctx = new AudioContext({ sampleRate });
  const audioBuffer = ctx.createBuffer(numChannels, numSamples, sampleRate);

  for (let ch = 0; ch < numChannels; ch++) {
    const out = audioBuffer.getChannelData(ch);
    if (audioFormat === 3 && bitsPerSample === 32) {
      // IEEE float 32 — slice to ensure 4-byte alignment (dataOffset may not be 4-aligned)
      const floats = new Float32Array(arrayBuffer.slice(dataOffset));
      for (let i = 0; i < numSamples; i++) out[i] = floats[i * numChannels + ch];
    } else if (audioFormat === 1 && bitsPerSample === 16) {
      // PCM 16-bit — slice to ensure 2-byte alignment (dataOffset may not be aligned)
      const ints = new Int16Array(arrayBuffer.slice(dataOffset));
      for (let i = 0; i < numSamples; i++) out[i] = ints[i * numChannels + ch] / 32768;
    } else if (audioFormat === 1 && bitsPerSample === 8) {
      // PCM 8-bit unsigned
      const bytes = new Uint8Array(arrayBuffer, dataOffset);
      for (let i = 0; i < numSamples; i++) out[i] = (bytes[i * numChannels + ch] - 128) / 128;
    } else if (audioFormat === 1 && bitsPerSample === 24) {
      // PCM 24-bit — manual byte read
      for (let i = 0; i < numSamples; i++) {
        const o = dataOffset + (i * numChannels + ch) * 3;
        let s = (view.getUint8(o+2) << 16) | (view.getUint8(o+1) << 8) | view.getUint8(o);
        if (s >= 0x800000) s -= 0x1000000;
        out[i] = s / 0x800000;
      }
    } else if (audioFormat === 1 && bitsPerSample === 32) {
      // PCM 32-bit int
      for (let i = 0; i < numSamples; i++) {
        out[i] = view.getInt32(dataOffset + (i * numChannels + ch) * 4, true) / 2147483648;
      }
    } else {
      ctx.close().catch(() => {});
      throw new Error(`Unsupported WAV format: audioFormat=${audioFormat}, bits=${bitsPerSample}`);
    }
  }
  return { audioBuffer, ctx };
}

function autoTag(name) {
  if (/^vo[A-Z_]|^VO[_]|voice/i.test(name))            return 'Voice';
  if (/music/i.test(name))                              return 'Music';
  if (/(loop|ambient|atmo|background|bg$)/i.test(name)) return 'Music';
  return 'SoundEffects';
}

export default function SoundsPage({ project, setProject, showToast }) {
  const [filter, setFilter] = useState('');
  const [deleting, setDeleting] = useState(null);
  const [playing, setPlaying] = useState(null);
  const [paused, setPaused] = useState(false);
  const [waveform, setWaveform] = useState(null); // { filename, peaks[], duration, buffer }
  const [showTrash, setShowTrash] = useState(false);
  const [deleted, setDeleted] = useState([]);
  const [restoring, setRestoring] = useState(null);
  const [orphanResult, setOrphanResult] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [addModal, setAddModal] = useState(null); // null | { name, tags, overlap, saving }
  const [bulkAdd, setBulkAdd] = useState(null); // null | { tags, overlap, saving }
  const [selectedSound, setSelectedSound] = useState(null); // sound name for usage panel
  const [renaming, setRenaming] = useState(null); // null | sound name being renamed
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState('');
  const [trashPlaying, setTrashPlaying] = useState(null);
  const [tagDropdown, setTagDropdown] = useState(null); // sound name with open tag dropdown
  const trashAudioRef = useRef(null);
  const ctxRef = useRef(null);
  const sourceRef = useRef(null);
  const playStartRef = useRef(0);  // ctx.currentTime when playback started
  const offsetRef = useRef(0);     // offset into buffer where playback started
  const rafRef = useRef(null);     // requestAnimationFrame id
  const [playProgress, setPlayProgress] = useState(0); // 0-1

  const inJsonSet = useMemo(() => {
    const set = new Set();
    const sprites = project?.soundsJson?.soundDefinitions?.soundSprites || {};
    for (const sprite of Object.values(sprites)) {
      if (sprite.spriteId) set.add(sprite.spriteId);
    }
    return set;
  }, [project?.soundsJson]);

  // Build usage map: soundName → { sprites: [], commands: [], spriteLists: [] }
  const usageMap = useMemo(() => {
    const map = {};
    const defs = project?.soundsJson?.soundDefinitions;
    if (!defs) return map;
    const sprites = defs.soundSprites || {};
    const commands = defs.commands || {};
    const lists = defs.spriteList || {};
    // Index: spriteKey → soundName (via spriteId)
    const spriteKeyToName = {};
    for (const [key, sp] of Object.entries(sprites)) {
      if (sp.spriteId) spriteKeyToName[key] = sp.spriteId;
    }
    // Commands: each step references spriteId or spriteListId
    for (const [cmdName, steps] of Object.entries(commands)) {
      if (!Array.isArray(steps)) continue;
      for (const step of steps) {
        // Direct sprite reference
        if (step.spriteId) {
          const name = spriteKeyToName[step.spriteId] || step.spriteId;
          if (!map[name]) map[name] = { sprites: [], commands: [], spriteLists: [] };
          if (!map[name].commands.includes(cmdName)) map[name].commands.push(cmdName);
        }
        // SpriteList reference — expand list items
        if (step.spriteListId && lists[step.spriteListId]) {
          const list = lists[step.spriteListId];
          const items = Array.isArray(list) ? list : (list.items || []);
          for (const itemId of items) {
            const name = spriteKeyToName[itemId] || itemId;
            if (!map[name]) map[name] = { sprites: [], commands: [], spriteLists: [] };
            if (!map[name].commands.includes(cmdName)) map[name].commands.push(cmdName);
          }
        }
      }
    }
    // SoundSprites: each sprite key references a sound by spriteId
    for (const [key, sp] of Object.entries(sprites)) {
      const name = sp.spriteId;
      if (!name) continue;
      if (!map[name]) map[name] = { sprites: [], commands: [], spriteLists: [] };
      if (!map[name].sprites.includes(key)) map[name].sprites.push(key);
    }
    // SpriteLists: which lists reference this sound
    for (const [listName, list] of Object.entries(lists)) {
      const items = Array.isArray(list) ? list : (list.items || []);
      for (const itemId of items) {
        const name = spriteKeyToName[itemId] || itemId;
        if (!map[name]) map[name] = { sprites: [], commands: [], spriteLists: [] };
        if (!map[name].spriteLists.includes(listName)) map[name].spriteLists.push(listName);
      }
    }
    return map;
  }, [project?.soundsJson]);

  useEffect(() => { setFilter(''); setDeleting(null); stopAudio(); setWaveform(null); setPaused(false); { if (trashAudioRef.current) { trashAudioRef.current.pause(); trashAudioRef.current.src = ''; } setTrashPlaying(null); setShowTrash(false); }; setOrphanResult(null); setAddModal(null); setBulkAdd(null); setSelectedSound(null); }, [project?.path, project?._reloadKey]);
  useEffect(() => () => stopAudio(), []);

  const stopAudio = () => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    try { sourceRef.current?.stop(); } catch {}
    sourceRef.current = null;
    try { ctxRef.current?.close().catch(() => {}); } catch {}
    ctxRef.current = null;
    setPlaying(null);
    setPaused(false);
    setPlayProgress(0);
  };

  const pauseAudio = () => {
    if (ctxRef.current && ctxRef.current.state === 'running') {
      // Capture exact progress before suspending
      const ctx = ctxRef.current;
      const buffer = waveform?.buffer;
      if (buffer) {
        const elapsed = ctx.currentTime - playStartRef.current + offsetRef.current;
        setPlayProgress(Math.min(1, elapsed / buffer.duration));
      }
      ctxRef.current.suspend();
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      setPaused(true);
    }
  };

  const resumeAudio = () => {
    if (ctxRef.current && ctxRef.current.state === 'suspended') {
      ctxRef.current.resume();
      setPaused(false);
      const ctx = ctxRef.current;
      const buffer = waveform?.buffer;
      if (ctx && buffer) {
        // Start playback from the current offset (handles seek-while-paused)
        startPlayback(ctx, buffer, offsetRef.current);
      }
    }
  };

  const startPlayback = (ctx, buffer, offset) => {
    // Detach old source's onended before stopping — prevents it from closing everything
    if (sourceRef.current) { sourceRef.current.onended = null; }
    try { sourceRef.current?.stop(); } catch {}
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    sourceRef.current = source;
    offsetRef.current = offset;
    playStartRef.current = ctx.currentTime;
    source.onended = () => {
      // Only cleanup if THIS source is still the active one (not replaced by seek)
      if (sourceRef.current !== source) return;
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      if (ctxRef.current === ctx) {
        ctxRef.current = null; sourceRef.current = null;
        setPlaying(null); setPlayProgress(0); setWaveform(null);
      }
    };
    source.start(0, offset);
    // Animate playhead
    const tick = () => {
      if (!ctxRef.current || ctxRef.current !== ctx) return;
      const elapsed = ctx.currentTime - playStartRef.current + offset;
      setPlayProgress(Math.min(1, elapsed / buffer.duration));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const seekTo = (fraction, isDrag = false, wasPaused = false) => {
    if (!waveform?.buffer || !ctxRef.current) return;
    if (isDrag) {
      // During drag: only move trackhead visually, don't restart audio
      setPlayProgress(fraction);
      return;
    }
    const offset = fraction * waveform.buffer.duration;
    if (wasPaused) {
      // Was paused — just update position visually, don't create source (resumeAudio will)
      setPlayProgress(fraction);
      offsetRef.current = offset;
      playStartRef.current = ctxRef.current.currentTime;
      if (sourceRef.current) { sourceRef.current.onended = null; }
      try { sourceRef.current?.stop(); } catch {}
      sourceRef.current = null;
      return;
    }
    // Was playing — restart audio from new position
    if (ctxRef.current.state === 'suspended') ctxRef.current.resume();
    setPaused(false);
    startPlayback(ctxRef.current, waveform.buffer, offset);
  };

  const handlePlay = async (filename) => {
    if (playing === filename) {
      if (paused) resumeAudio(); else pauseAudio();
      return;
    }
    stopAudio();
    try {
      const res = await fetch(`audio://local/${encodeURIComponent(filename)}`);
      if (!res.ok) { showToast('Could not read audio: ' + res.status, 'error'); return; }
      const arrayBuffer = await res.arrayBuffer();
      const { audioBuffer, ctx } = decodeWav(arrayBuffer);
      ctxRef.current = ctx;
      // Extract waveform peaks
      const ch = audioBuffer.getChannelData(0);
      const buckets = 200;
      const bSize = Math.floor(ch.length / buckets);
      const peaks = [];
      for (let i = 0; i < buckets; i++) {
        let max = 0;
        const end = Math.min((i + 1) * bSize, ch.length);
        for (let j = i * bSize; j < end; j++) {
          const abs = Math.abs(ch[j]);
          if (abs > max) max = abs;
        }
        peaks.push(max);
      }
      setWaveform({ filename, peaks, duration: audioBuffer.duration, buffer: audioBuffer });
      startPlayback(ctx, audioBuffer, 0);
      setPlaying(filename);
    } catch (e) {
      showToast('Could not play audio: ' + e.message, 'error');
    }
  };

  const loadTrash = async () => {
    const result = await window.api.listDeletedSounds();
    setDeleted(result?.files || []);
  };

  const handleShowTrash = async () => {
    await loadTrash();
    setShowTrash(true);
  };

  const handleDelete = async (filename) => {
    if (playing === filename) stopAudio();
    setDeleting(filename);
    try {
      const result = await window.api.deleteSound(filename);
      if (result?.project) { setProject(result.project); showToast(`Moved to trash: ${filename}`, 'success'); }
      else if (result?.error) showToast(result.error, 'error');
    } catch (e) {
      showToast('Delete failed: ' + e.message, 'error');
    }
    setDeleting(null);
  };

  const handleRestore = async (filename) => {
    setRestoring(filename);
    try {
      const result = await window.api.restoreSound(filename);
      if (result?.project) {
        setProject(result.project);
        setDeleted(prev => prev.filter(f => f !== filename));
        showToast(`Restored: ${filename}`, 'success');
      } else showToast(result?.error || 'Restore failed', 'error');
    } catch (e) {
      showToast('Restore failed: ' + e.message, 'error');
    }
    setRestoring(null);
  };

  const handleRename = async (oldName) => {
    const newName = renameValue.trim();
    if (!newName || newName === oldName) { setRenaming(null); setRenameError(''); return; }
    if (!/^[a-zA-Z0-9_-]+$/.test(newName)) { setRenameError('Only letters, numbers, _ and -'); return; }
    if (newName.startsWith('s_') || newName.startsWith('sl_')) { setRenameError('Cannot start with s_ or sl_'); return; }
    if ((project?.sounds || []).some(s => s.name === newName)) { setRenameError('Name already exists'); return; }
    if (playing) stopAudio(); // stop playback if active
    try {
      const result = await window.api.renameSound(oldName, newName);
      if (result?.success && result?.project) {
        setProject(result.project);
        showToast(`Renamed: ${oldName} → ${newName}`, 'success');
        if (selectedSound === oldName) setSelectedSound(newName);
        setRenaming(null);
        setRenameValue('');
        setRenameError('');
      } else {
        setRenameError(result?.error || 'Rename failed');
      }
    } catch (e) {
      setRenameError('Failed: ' + e.message);
    }
  };

  if (!project) {
    return (
      <div className="anim-fade-up flex flex-col items-center justify-center h-64 text-text-dim text-sm">
        Open a project first to manage sounds.
      </div>
    );
  }

  const sounds = (project?.sounds || []).filter(s =>
    s.name.toLowerCase().includes(filter.toLowerCase())
  );
  const totalSizeMB = (project?.sounds || []).reduce((sum, s) => sum + parseFloat(s.sizeMB || 0), 0).toFixed(1);

  const handleAddToJson = async () => {
    const { name, tags, overlap } = addModal;
    const spriteKey = `s_${name}`;
    const newSoundsJson = structuredClone(project.soundsJson || { soundManifest: [], soundDefinitions: { soundSprites: {}, commands: {}, spriteList: {} } });
    if (!newSoundsJson.soundDefinitions) newSoundsJson.soundDefinitions = {};
    if (!newSoundsJson.soundDefinitions.soundSprites) newSoundsJson.soundDefinitions.soundSprites = {};
    newSoundsJson.soundDefinitions.soundSprites[spriteKey] = {
      soundId: '',
      spriteId: name,
      startTime: 0,
      duration: 0,
      tags: [tags],
      overlap,
    };
    setAddModal(m => ({ ...m, saving: true }));
    try {
      const r = await window.api.saveSoundsJson(newSoundsJson);
      if (r?.success) {
        const updated = structuredClone(project);
        updated.soundsJson = newSoundsJson;
        setProject(updated);
        showToast(`Added to sounds.json: ${spriteKey}`, 'success');
        setAddModal(null);
      } else {
        showToast(r?.error || 'Save failed', 'error');
        setAddModal(m => ({ ...m, saving: false }));
      }
    } catch (e) {
      showToast('Save failed: ' + e.message, 'error');
      setAddModal(m => ({ ...m, saving: false }));
    }
  };

  const handleAddAllToJson = async () => {
    const { overlap } = bulkAdd;
    const missing = (project?.sounds || []).filter(s => !inJsonSet.has(s.name));
    if (!missing.length) { setBulkAdd(null); return; }
    const newSoundsJson = structuredClone(project.soundsJson || { soundManifest: [], soundDefinitions: { soundSprites: {}, commands: {}, spriteList: {} } });
    if (!newSoundsJson.soundDefinitions) newSoundsJson.soundDefinitions = {};
    if (!newSoundsJson.soundDefinitions.soundSprites) newSoundsJson.soundDefinitions.soundSprites = {};
    for (const s of missing) {
      newSoundsJson.soundDefinitions.soundSprites[`s_${s.name}`] = {
        soundId: '', spriteId: s.name, startTime: 0, duration: 0, tags: [autoTag(s.name)], overlap,
      };
    }
    setBulkAdd(m => ({ ...m, saving: true }));
    try {
      const r = await window.api.saveSoundsJson(newSoundsJson);
      if (r?.success) {
        const updated = structuredClone(project);
        updated.soundsJson = newSoundsJson;
        setProject(updated);
        showToast(`Added ${missing.length} sound(s) to sounds.json`, 'success');
        setBulkAdd(null);
      } else {
        showToast(r?.error || 'Save failed', 'error');
        setBulkAdd(m => ({ ...m, saving: false }));
      }
    } catch (e) {
      showToast('Save failed: ' + e.message, 'error');
      setBulkAdd(m => ({ ...m, saving: false }));
    }
  };

  const handleAnalyzeOrphans = async () => {
    setAnalyzing(true); setOrphanResult(null);
    try {
      const r = await window.api.analyzeOrphans();
      if (r.error) showToast(r.error, 'error');
      else setOrphanResult(r);
    } catch (e) { showToast(e.message, 'error'); }
    setAnalyzing(false);
  };

  const handleCleanOrphans = async () => {
    setCleaning(true);
    try {
      const r = await window.api.cleanOrphans();
      if (r.error) { showToast(r.error, 'error'); }
      else {
        if (r.project) setProject(r.project);
        const parts = [];
        if (r.removedSprites) parts.push(`${r.removedSprites} sprite(s)`);
        if (r.removedSpriteLists) parts.push(`${r.removedSpriteLists} spriteList(s)`);
        if (r.removedSteps) parts.push(`${r.removedSteps} step(s) from commands`);
        showToast(`Cleaned: ${parts.join(', ')}`, 'success');
        setOrphanResult(null);
      }
    } catch (e) { showToast(e.message, 'error'); }
    setCleaning(false);
  };

  const handleReload = async () => {
    try {
      const data = await window.api.reloadProject();
      if (data) { data._reloadKey = Date.now(); setProject(data); showToast('Refreshed', 'success'); }
    } catch (e) {
      showToast('Refresh failed: ' + e.message, 'error');
    }
  };

  const handleImport = async () => {
    try {
      const result = await window.api.importSounds();
      if (result?.project) { setProject(result.project); showToast(`Imported ${result.imported} file(s)`, 'success'); }
    } catch (e) {
      showToast('Import failed: ' + e.message, 'error');
    }
  };

  return (
    <div className="anim-fade-up h-full flex flex-col" style={{ gap: '10px' }}>
      {/* Header — centered */}
      <div className="shrink-0" style={{ textAlign: 'center', paddingTop: '8px' }}>
        <h2 className="text-text-primary" style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '-0.02em' }}>Sounds</h2>
        <div style={{ fontSize: '12px', color: 'var(--color-text-dim, #5c5c72)', marginTop: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
          <span>{sounds.length} files</span>
          <span style={{ width: '3px', height: '3px', borderRadius: '50%', background: 'currentColor' }} />
          <span>{totalSizeMB} MB</span>
          <span style={{ width: '3px', height: '3px', borderRadius: '50%', background: 'currentColor' }} />
          <span>{inJsonSet.size} in JSON</span>
        </div>
      </div>

      {/* Toolbar — search + pill buttons */}
      <div className="shrink-0 flex items-center" style={{ gap: '8px', padding: '0 0 4px' }}>
        <div style={{ width: '220px', position: 'relative', flexShrink: 0 }}>
          <svg style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', width: '14px', height: '14px', color: 'var(--color-text-dim, #606078)', pointerEvents: 'none' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input type="text" placeholder="Search sounds..." value={filter} onChange={(e) => setFilter(e.target.value)}
            className="input-base" style={{ width: '100%', paddingLeft: '34px' }} />
        </div>
        <button onClick={handleAnalyzeOrphans} disabled={analyzing}
          className="btn-ghost text-xs" style={{ borderColor: 'rgba(56,189,248,0.2)', color: '#38bdf8' }}>
          {analyzing ? 'Analyzing...' : 'Analyze'}
        </button>
        {(project?.sounds || []).some(s => !inJsonSet.has(s.name)) && (
          <button onClick={() => setBulkAdd({ overlap: false, saving: false })}
            className="btn-ghost text-xs" style={{ borderColor: 'rgba(245,158,11,0.2)', color: '#f59e0b' }}>
            + Add All to JSON
          </button>
        )}
        <button onClick={handleShowTrash}
          className="btn-ghost text-xs" style={{ borderColor: 'rgba(239,68,68,0.2)', color: '#ef4444' }}>
          Trash{showTrash && deleted.length > 0 ? ` (${deleted.length})` : ''}
        </button>
        <button onClick={handleImport} className="btn-primary text-xs">+ Import</button>
        <button onClick={handleReload} className="btn-ghost text-xs" style={{ marginLeft: 'auto' }}>Refresh</button>
      </div>

      {/* Main content — table + optional analyze panel */}
      <div className="flex-1 min-h-0 flex" style={{ gap: '14px', overflow: 'hidden' }}>

      {/* Sound list */}
      <div className="flex-1 min-h-0 min-w-0 overflow-y-auto card" style={{ display: 'grid', gridTemplateColumns: 'auto auto auto auto auto auto auto auto', gap: '0 16px', alignItems: 'center', justifyContent: 'start', padding: '0 12px' }}>
        {/* Table header — sticky */}
        <div style={{ display: 'grid', gridTemplateColumns: 'subgrid', gridColumn: '1 / -1', position: 'sticky', top: 0, zIndex: 10, background: 'var(--color-bg-card)', backdropFilter: 'blur(16px)', padding: '0 12px', borderBottom: '1px solid rgba(50,50,90,0.25)' }}>
          {['', 'Name', 'Status', 'Tag', 'Size', 'Dur', 'Fmt', ''].map((h, i) => (
            <span key={i} style={{ padding: '10px 0 8px', fontSize: '10px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#9090b0', textAlign: i >= 2 && i <= 6 ? 'center' : 'left' }}>{h}</span>
          ))}
        </div>
        {sounds.map((s) => {
          const inJson = inJsonSet.has(s.name);
          const isPlaying = playing === s.filename;
          return (
            <div
              key={s.filename}
              className={`group hover:bg-bg-hover/30 transition-colors ${isPlaying ? 'bg-accent/5' : ''}`}
              style={{ display: 'grid', gridTemplateColumns: 'subgrid', gridColumn: '1 / -1', borderRadius: 8, padding: '6px 12px', alignItems: 'center', borderBottom: '1px solid rgba(50,50,90,0.15)' }}
            >
              <div className="flex items-center gap-0.5">
                {/* Play / Pause */}
                <button
                  onClick={() => handlePlay(s.filename)}
                  className={`w-7 h-7 flex items-center justify-center rounded-lg transition-all
                    ${isPlaying ? 'bg-accent/20 text-accent' : 'text-text-dim hover:text-accent hover:bg-accent/10'}`}
                  title={isPlaying ? (paused ? 'Resume' : 'Pause') : 'Play'}
                >
                  {isPlaying && !paused ? (
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                      <rect x="6" y="5" width="4" height="14" rx="1" />
                      <rect x="14" y="5" width="4" height="14" rx="1" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>
                {/* Stop */}
                {isPlaying && (
                  <button
                    onClick={stopAudio}
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-text-dim hover:text-danger hover:bg-danger/10 transition-all"
                    title="Stop"
                  >
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                      <rect x="6" y="6" width="12" height="12" rx="1" />
                    </svg>
                  </button>
                )}
              </div>

              {renaming === s.name ? (
                <div className="flex items-center gap-1" style={{ maxWidth: '320px' }}>
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => { setRenameValue(e.target.value); setRenameError(''); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleRename(s.name); if (e.key === 'Escape') { setRenaming(null); setRenameError(''); } }}
                    onBlur={() => { if (!renameError) setTimeout(() => { setRenaming(r => r === s.name ? null : r); setRenameError(''); }, 200); }}
                    className={`input-base text-sm font-mono py-0.5 px-1.5 w-full ${renameError ? '!border-danger' : ''}`}
                    title={renameError || 'Enter to save, Esc to cancel'}
                  />
                  {renameError && <span className="text-[10px] text-danger whitespace-nowrap">{renameError}</span>}
                </div>
              ) : (
                <span
                  className={`text-sm font-mono whitespace-nowrap overflow-hidden text-ellipsis cursor-pointer transition-colors ${selectedSound === s.name ? 'text-accent' : 'text-text-primary hover:text-accent'}`}
                  style={{ maxWidth: '320px' }}
                  onClick={() => setSelectedSound(selectedSound === s.name ? null : s.name)}
                  onDoubleClick={() => { setRenaming(s.name); setRenameValue(s.name); setRenameError(''); }}
                  title="Click: usage · Double-click: rename"
                >{s.name}</span>
              )}

              {inJson
                ? (() => {
                    const sprite = project.soundsJson?.soundDefinitions?.soundSprites?.[`s_${s.name}`];
                    const currentTag = sprite?.tags?.[0] || 'SoundEffects';
                    const tagOptions = ['SoundEffects', 'Music', 'Voice'];
                    return (<>
                      <span className="badge bg-green-dim text-green" style={{ justifySelf: 'center' }} title="In soundSprites">in JSON</span>
                      <div style={{ justifySelf: 'center', position: 'relative' }}>
                        <button onClick={() => setTagDropdown(tagDropdown === s.name ? null : s.name)}
                          className="text-[10px] font-mono rounded-md cursor-pointer font-semibold"
                          style={{ padding: '4px 10px', width: '110px', justifyContent: 'center', border: '1px solid rgba(255,255,255,0.06)', background: currentTag === 'Music' ? 'rgba(192,132,252,0.1)' : currentTag === 'Voice' ? 'rgba(251,146,60,0.1)' : 'rgba(34,211,238,0.1)', color: currentTag === 'Music' ? '#c084fc' : currentTag === 'Voice' ? '#fb923c' : '#22d3ee', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {currentTag}
                          <svg width="8" height="5" viewBox="0 0 8 5" fill="none"><path d="M1 1l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                        </button>
                        {tagDropdown === s.name && (
                          <div style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: '4px', zIndex: 10, background: '#13132a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.4)', width: '130px' }}>
                            {tagOptions.map(t => {
                              const tc = t === 'Music' ? '#c084fc' : t === 'Voice' ? '#fb923c' : '#22d3ee';
                              const bg = t === 'Music' ? 'rgba(192,132,252,0.08)' : t === 'Voice' ? 'rgba(251,146,60,0.08)' : 'rgba(34,211,238,0.08)';
                              return (
                                <button key={t} onClick={async () => {
                                  setTagDropdown(null);
                                  if (t === currentTag) return;
                                  const newSoundsJson = structuredClone(project.soundsJson);
                                  newSoundsJson.soundDefinitions.soundSprites[`s_${s.name}`].tags = [t];
                                  const r = await window.api.saveSoundsJson(newSoundsJson);
                                  if (r?.success) { const updated = structuredClone(project); updated.soundsJson = newSoundsJson; setProject(updated); }
                                  else showToast(r?.error || 'Save failed', 'error');
                                }} style={{ display: 'block', width: '100%', padding: '8px 14px', border: 'none', background: t === currentTag ? bg : 'transparent', color: tc, fontSize: '11px', fontFamily: "'SF Mono', monospace", fontWeight: 600, cursor: 'pointer', textAlign: 'left', transition: 'background 0.1s' }}
                                onMouseEnter={e => e.currentTarget.style.background = bg}
                                onMouseLeave={e => e.currentTarget.style.background = t === currentTag ? bg : 'transparent'}>
                                  {t === currentTag ? '✓ ' : ''}{t}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </>);
                  })()
                : (<>
                  <button
                    onClick={() => setAddModal({ name: s.name, tags: autoTag(s.name), overlap: false, saving: false })}
                    className="badge bg-orange-dim text-orange cursor-pointer hover:bg-orange/20 transition-colors"
                    style={{ justifySelf: 'center' }}
                    title="Add to sounds.json"
                  >
                    + Add
                  </button>
                  <span></span>
                </>)
              }

              <span className="text-[11px] text-text-secondary text-center tabular-nums font-mono whitespace-nowrap">{s.sizeKB >= 1000 ? (s.sizeKB / 1000).toFixed(1) + ' MB' : s.sizeKB + ' KB'}</span>
              <span className="text-[11px] text-text-dim text-center tabular-nums font-mono whitespace-nowrap">{s.duration ? s.duration + 's' : ''}</span>
              <span className="text-[10px] text-text-dim text-center font-mono whitespace-nowrap">{s.sampleRate ? (s.sampleRate / 1000) + '/' + s.bitDepth : ''}</span>

              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => { setRenaming(s.name); setRenameValue(s.name); setRenameError(''); }}
                  className="opacity-0 group-hover:opacity-100 w-7 h-7 flex items-center justify-center rounded-lg text-text-dim hover:text-accent hover:bg-accent/10 transition-all"
                  title="Rename"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                <button
                  onClick={() => handleDelete(s.filename)}
                  disabled={deleting === s.filename}
                  className="opacity-0 group-hover:opacity-100 w-7 h-7 flex items-center justify-center rounded-lg text-danger hover:bg-danger-dim transition-all"
                  title="Move to Trash"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>

              {/* Waveform + Seek */}
              {isPlaying && waveform?.filename === s.filename && waveform.peaks && (
                <div className="flex items-center gap-2 pt-1.5 pb-0.5" style={{ gridColumn: '1 / -1' }}>
                  <div
                    className="flex-1 h-10 relative cursor-pointer select-none"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      // Remember if paused before drag — if so, stay paused after seek
                      const wasPausedBefore = paused;
                      const wasPlaying = ctxRef.current && ctxRef.current.state === 'running';
                      if (wasPlaying) { ctxRef.current.suspend(); setPaused(true); }
                      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }

                      const rect = e.currentTarget.getBoundingClientRect();
                      let lastX = 0;
                      const drag = (ev) => {
                        ev.preventDefault();
                        lastX = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
                        seekTo(lastX, true); // visual only
                      };
                      drag(e);
                      const up = () => {
                        window.removeEventListener('mousemove', drag);
                        window.removeEventListener('mouseup', up);
                        seekTo(lastX, false, wasPausedBefore); // commit: resume only if was playing
                      };
                      window.addEventListener('mousemove', drag);
                      window.addEventListener('mouseup', up);
                    }}
                  >
                    {/* Waveform bars */}
                    <div className="absolute inset-0 flex items-center">
                      <div className="flex items-center gap-px h-full w-full">
                        {waveform.peaks.map((p, i) => {
                          const barPct = i / waveform.peaks.length;
                          const played = barPct < playProgress;
                          return (
                            <div key={i} className="flex-1 flex items-center h-full">
                              <div
                                className={`w-full rounded-sm transition-colors duration-75 ${played ? 'bg-accent' : 'bg-text-dim/25'}`}
                                style={{ height: `${Math.max(6, p * 100)}%` }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    {/* Playhead line */}
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-accent shadow-sm shadow-accent/50 pointer-events-none"
                      style={{ left: `${playProgress * 100}%` }}
                    />
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="text-xs text-accent font-mono tabular-nums block">
                      {(playProgress * (waveform.duration || 0)).toFixed(1)}s
                    </span>
                    <span className="text-xs text-text-dim font-mono tabular-nums block">
                      {waveform.duration?.toFixed(1)}s
                    </span>
                  </div>
                </div>
              )}

              {/* Usage panel */}
              {selectedSound === s.name && (() => {
                const usage = usageMap[s.name];
                if (!usage) return (
                  <div className="py-2 px-3 rounded-lg bg-bg-primary/40 border border-border/30" style={{ gridColumn: '1 / -1' }}>
                    <span className="text-xs text-text-dim">Not referenced in sounds.json</span>
                  </div>
                );
                return (
                  <div className="py-2 px-3 rounded-lg bg-bg-primary/40 border border-border/30 space-y-1.5" style={{ gridColumn: '1 / -1' }}>
                    {usage.sprites.length > 0 && (
                      <div className="flex items-start gap-2">
                        <span className="text-[10px] text-text-dim uppercase tracking-wider shrink-0 pt-0.5 w-16">Sprites</span>
                        <div className="flex flex-wrap gap-1">
                          {usage.sprites.map(k => <span key={k} className="badge bg-cyan-dim text-cyan font-mono text-xs">{k}</span>)}
                        </div>
                      </div>
                    )}
                    {usage.commands.length > 0 && (
                      <div className="flex items-start gap-2">
                        <span className="text-[10px] text-text-dim uppercase tracking-wider shrink-0 pt-0.5 w-16">Commands</span>
                        <div className="flex flex-wrap gap-1">
                          {usage.commands.map(k => <span key={k} className="badge bg-purple-dim text-purple font-mono text-xs">{k}</span>)}
                        </div>
                      </div>
                    )}
                    {usage.spriteLists.length > 0 && (
                      <div className="flex items-start gap-2">
                        <span className="text-[10px] text-text-dim uppercase tracking-wider shrink-0 pt-0.5 w-16">Lists</span>
                        <div className="flex flex-wrap gap-1">
                          {usage.spriteLists.map(k => <span key={k} className="badge bg-green-dim text-green font-mono text-xs">{k}</span>)}
                        </div>
                      </div>
                    )}
                    {usage.sprites.length === 0 && usage.commands.length === 0 && usage.spriteLists.length === 0 && (
                      <span className="text-xs text-text-dim">Defined in JSON but not used in any commands or lists</span>
                    )}
                  </div>
                );
              })()}
            </div>
          );
        })}
        {sounds.length === 0 && (
          <div className="text-center py-16 text-text-dim text-sm" style={{ gridColumn: '1 / -1' }}>
            {filter ? 'No sounds match filter' : 'No WAV files in sourceSoundFiles/'}
          </div>
        )}
      </div>

      {/* Analyze Panel — right sidebar */}
      {orphanResult && (
        <div className="card" style={{ width: '280px', flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="flex items-center gap-2" style={{ padding: '14px 18px', borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.05))' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#38bdf8', boxShadow: '0 0 6px rgba(56,189,248,0.4)' }} />
            <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.3)' }}>JSON Cleanup</span>
            <button onClick={() => setOrphanResult(null)} style={{ marginLeft: 'auto', width: '24px', height: '24px', borderRadius: '6px', border: 'none', background: 'transparent', color: 'var(--color-text-dim)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {orphanResult.orphanedSprites.length === 0 ? (
              <div className="flex items-center gap-2" style={{ padding: '12px', borderRadius: '8px', background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.1)' }}>
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="#34d399" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                <span style={{ fontSize: '12px', color: '#34d399', fontWeight: 600 }}>All clean</span>
              </div>
            ) : (<>
              <div>
                <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#ef4444', marginBottom: '8px' }}>{orphanResult.orphanedSprites.length} Orphaned Sprite{orphanResult.orphanedSprites.length !== 1 ? 's' : ''}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {orphanResult.orphanedSprites.map(k => (
                    <span key={k} style={{ fontSize: '11px', fontFamily: "'SF Mono', monospace", color: 'var(--color-text-secondary)', padding: '5px 10px', borderRadius: '6px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.08)' }}>{k}</span>
                  ))}
                </div>
              </div>
              {Object.keys(orphanResult.affectedSpriteLists).length > 0 && (
                <div>
                  <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-dim)', marginBottom: '8px' }}>Affected Lists</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {Object.entries(orphanResult.affectedSpriteLists).map(([k, bad]) => (
                      <div key={k} style={{ fontSize: '11px', fontFamily: "'SF Mono', monospace", padding: '5px 10px', borderRadius: '6px', background: 'rgba(192,132,252,0.06)', border: '1px solid rgba(192,132,252,0.08)' }}>
                        <span style={{ color: '#c084fc', fontWeight: 600 }}>{k}</span>
                        <span style={{ color: 'var(--color-text-dim)', marginLeft: '6px', fontSize: '10px' }}>{orphanResult.removedSpriteLists.includes(k) ? 'removed' : `${bad.length} ID(s)`}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {Object.keys(orphanResult.affectedCommands).length > 0 && (
                <div>
                  <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-dim)', marginBottom: '8px' }}>Affected Commands</div>
                  <div className="flex flex-wrap" style={{ gap: '4px' }}>
                    {Object.keys(orphanResult.affectedCommands).map(cmd => (
                      <span key={cmd} style={{ fontSize: '10px', fontFamily: "'SF Mono', monospace", color: '#38bdf8', padding: '3px 8px', borderRadius: '4px', background: 'rgba(56,189,248,0.08)' }}>
                        {cmd} ~{orphanResult.affectedCommands[cmd].length}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>)}
          </div>
          {orphanResult.orphanedSprites.length > 0 && (
            <div style={{ padding: '14px 18px', borderTop: '1px solid var(--color-border, rgba(255,255,255,0.05))' }}>
              <button onClick={handleCleanOrphans} disabled={cleaning}
                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: 'none', background: 'rgba(239,68,68,0.12)', color: '#ef4444', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                {cleaning ? 'Cleaning...' : `Delete ${orphanResult.orphanedSprites.length} Orphan(s)`}
              </button>
            </div>
          )}
        </div>
      )}

      </div>{/* end flex row */}

      {/* Add to JSON Modal */}
      {addModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-bg-secondary border border-border rounded-2xl shadow-2xl w-[400px] flex flex-col">
            <div className="p-5 border-b border-border">
              <h3 className="text-sm font-bold text-text-primary">Add to sounds.json</h3>
              <p className="text-xs text-text-dim mt-0.5 font-mono">s_{addModal.name}</p>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="section-label mb-1.5 block">Tags</label>
                <div className="flex gap-2">
                  {['SoundEffects', 'Music', 'Voice'].map(t => (
                    <button
                      key={t}
                      onClick={() => setAddModal(m => ({ ...m, tags: t }))}
                      className={`px-3 py-1.5 rounded-lg text-xs font-mono border transition-colors ${addModal.tags === t ? 'bg-accent/20 border-accent/50 text-accent' : 'bg-bg-hover border-border text-text-dim hover:border-border-bright'}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="overlap-check"
                  checked={addModal.overlap}
                  onChange={e => setAddModal(m => ({ ...m, overlap: e.target.checked }))}
                  className="w-4 h-4 accent-accent"
                />
                <label htmlFor="overlap-check" className="text-xs text-text-secondary cursor-pointer">
                  overlap <span className="text-text-dim">(sound overlaps with itself)</span>
                </label>
              </div>
            </div>
            <div className="p-4 border-t border-border flex gap-2 justify-end">
              <button onClick={() => setAddModal(null)} className="btn-ghost text-xs px-4 py-2">Cancel</button>
              <button
                onClick={handleAddToJson}
                disabled={addModal.saving}
                className="btn-primary text-xs px-4 py-2 disabled:opacity-40"
              >
                {addModal.saving ? 'Saving...' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Add to JSON Modal */}
      {bulkAdd && (() => {
        const missing = (project?.sounds || []).filter(s => !inJsonSet.has(s.name));
        const musicCount = missing.filter(s => autoTag(s.name) === 'Music').length;
        const sfxCount = missing.length - musicCount;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-bg-secondary border border-border rounded-2xl shadow-2xl w-[400px] flex flex-col">
              <div className="p-5 border-b border-border">
                <h3 className="text-sm font-bold text-text-primary">Add all to sounds.json</h3>
                <p className="text-xs text-text-dim mt-0.5">{missing.length} sound(s) not yet in JSON</p>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <p className="section-label mb-2">Auto-detekcija tagova</p>
                  <div className="flex gap-2">
                    {sfxCount > 0 && (
                      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-dim border border-cyan/20">
                        <span className="text-xs font-mono text-cyan">{sfxCount}×</span>
                        <span className="text-xs text-text-secondary">SoundEffects</span>
                      </div>
                    )}
                    {musicCount > 0 && (
                      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-dim border border-purple/20">
                        <span className="text-xs font-mono text-purple">{musicCount}×</span>
                        <span className="text-xs text-text-secondary">Music</span>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-text-dim mt-2">
                    Tagovi se detektuju po imenu: <span className="font-mono text-text-secondary">Music/Loop/Ambient/BG</span> → Music, ostalo → SoundEffects
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="bulk-overlap-check"
                    checked={bulkAdd.overlap}
                    onChange={e => setBulkAdd(m => ({ ...m, overlap: e.target.checked }))}
                    className="w-4 h-4 accent-accent"
                  />
                  <label htmlFor="bulk-overlap-check" className="text-xs text-text-secondary cursor-pointer">
                    overlap <span className="text-text-dim">(sound overlaps with itself)</span>
                  </label>
                </div>
              </div>
              <div className="p-4 border-t border-border flex gap-2 justify-end">
                <button onClick={() => setBulkAdd(null)} className="btn-ghost text-xs px-4 py-2">Cancel</button>
                <button
                  onClick={handleAddAllToJson}
                  disabled={bulkAdd.saving}
                  className="btn-primary text-xs px-4 py-2 disabled:opacity-40"
                >
                  {bulkAdd.saving ? 'Saving...' : `Add ${missing.length} sound(s)`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Trash Modal */}
      {showTrash && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }} onClick={() => { if (trashAudioRef.current) { trashAudioRef.current.pause(); trashAudioRef.current.src = ''; } setTrashPlaying(null); setShowTrash(false); }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '480px', maxHeight: '75vh', display: 'flex', flexDirection: 'column', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)', background: 'var(--color-bg-card, #0d0d18)', overflow: 'hidden', boxShadow: '0 24px 80px rgba(0,0,0,0.5)' }}>
            {/* Header */}
            <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(239,68,68,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg style={{ width: '18px', height: '18px', color: '#ef4444' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--color-text-primary, #e8e8f0)' }}>Trash</h3>
                <p style={{ fontSize: '12px', color: 'var(--color-text-dim, #606078)', marginTop: '2px' }}>
                  {deleted.length === 0 ? 'No deleted sounds' : `${deleted.length} sound${deleted.length !== 1 ? 's' : ''} in trash`}
                </p>
              </div>
              <button onClick={() => { if (trashAudioRef.current) { trashAudioRef.current.pause(); trashAudioRef.current.src = ''; } setTrashPlaying(null); setShowTrash(false); }} style={{ width: '32px', height: '32px', borderRadius: '8px', border: 'none', background: 'transparent', color: 'var(--color-text-dim)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-dim)'; }}>
                <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            {/* List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
              {deleted.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--color-text-dim, #606078)' }}>
                  <svg style={{ width: '32px', height: '32px', margin: '0 auto 12px', opacity: 0.3 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  <p style={{ fontSize: '13px' }}>Trash is empty</p>
                </div>
              ) : deleted.map(f => (
                <div key={f} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', borderRadius: '10px', marginBottom: '4px', transition: 'background 0.12s' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <button onClick={e => {
                    e.stopPropagation();
                    const url = `audio://deleted/${encodeURIComponent(f)}`;
                    if (trashAudioRef.current?.src?.includes(encodeURIComponent(f))) { trashAudioRef.current.pause(); trashAudioRef.current.src = ''; setTrashPlaying(null); return; }
                    if (trashAudioRef.current) { trashAudioRef.current.pause(); trashAudioRef.current.src = ''; }
                    const a = new Audio(url);
                    a.onended = () => setTrashPlaying(null);
                    a.play().catch(() => {});
                    trashAudioRef.current = a;
                    setTrashPlaying(f);
                  }} style={{ width: '28px', height: '28px', borderRadius: '7px', border: 'none', background: trashPlaying === f ? 'rgba(124,106,239,0.12)' : 'transparent', color: trashPlaying === f ? '#7c6aef' : 'rgba(255,255,255,0.25)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s', flexShrink: 0 }}>
                    {trashPlaying === f
                      ? <svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
                      : <svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>}
                  </button>
                  <span style={{ fontSize: '13px', fontFamily: "'SF Mono', monospace", fontWeight: 500, color: 'var(--color-text-primary, #e8e8f0)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.replace('.wav', '')}</span>
                  <button onClick={() => handleRestore(f)} disabled={restoring === f}
                    style={{ fontSize: '11px', fontWeight: 600, padding: '6px 14px', borderRadius: '7px', border: '1px solid rgba(52,211,153,0.2)', background: 'rgba(52,211,153,0.06)', color: '#34d399', cursor: restoring === f ? 'wait' : 'pointer', fontFamily: 'inherit', transition: 'all 0.15s', whiteSpace: 'nowrap' }}
                    onMouseEnter={e => { if (restoring !== f) { e.currentTarget.style.background = 'rgba(52,211,153,0.12)'; e.currentTarget.style.borderColor = 'rgba(52,211,153,0.35)'; } }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(52,211,153,0.06)'; e.currentTarget.style.borderColor = 'rgba(52,211,153,0.2)'; }}>
                    {restoring === f ? '...' : 'Restore'}
                  </button>
                </div>
              ))}
            </div>
            {/* Footer */}
            {deleted.length > 0 && (
              <div style={{ padding: '14px 24px', borderTop: '1px solid rgba(255,255,255,0.04)', textAlign: 'center' }}>
                <span style={{ fontSize: '11px', color: 'var(--color-text-dim, #606078)' }}>Restored sounds return to sourceSoundFiles/</span>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Footer — format breakdown */}
      {sounds.length > 0 && (() => {
        const fmts = {};
        sounds.forEach(s => { if (s.sampleRate && s.bitDepth) { const k = (s.sampleRate/1000) + 'k/' + s.bitDepth; fmts[k] = (fmts[k] || 0) + 1; } });
        return (
          <div className="shrink-0 flex items-center" style={{ gap: '16px', padding: '8px 0', fontSize: '11px', color: 'var(--color-text-dim, #5c5c72)' }}>
            {Object.entries(fmts).map(([k, v]) => <span key={k}>{k}: <span style={{ color: '#a0a0b8', fontWeight: 600 }}>{v}</span></span>)}
            <span style={{ marginLeft: 'auto', fontStyle: 'italic' }}>Click name for usage · Double-click to rename</span>
          </div>
        );
      })()}
    </div>
  );
}
