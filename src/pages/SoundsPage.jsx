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
  if (/music/i.test(name))                            return 'Music';
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

  useEffect(() => { setFilter(''); setDeleting(null); stopAudio(); setWaveform(null); setPaused(false); setShowTrash(false); setOrphanResult(null); setAddModal(null); setBulkAdd(null); }, [project?.path]);
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
        showToast(`Dodato u sounds.json: ${spriteKey}`, 'success');
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
        showToast(`Dodato ${missing.length} zvuk(a) u sounds.json`, 'success');
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
        if (r.removedSteps) parts.push(`${r.removedSteps} step(s) iz komandi`);
        showToast(`Očišćeno: ${parts.join(', ')}`, 'success');
        setOrphanResult(null);
      }
    } catch (e) { showToast(e.message, 'error'); }
    setCleaning(false);
  };

  const handleReload = async () => {
    try {
      const data = await window.api.reloadProject();
      if (data) { setProject(data); showToast('Refreshed', 'success'); }
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
    <div className="anim-fade-up h-full flex flex-col gap-2">
      <div className="shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-text-primary">Source Sounds</h2>
          <span className="badge bg-cyan-dim text-cyan">{project?.sounds?.length || 0} files</span>
          <span className="badge bg-bg-hover text-text-dim">{totalSizeMB} MB</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleReload} className="btn-ghost text-xs">Refresh</button>
          <button onClick={handleShowTrash} className="btn-ghost text-xs flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Trash
          </button>
          {(project?.sounds || []).some(s => !inJsonSet.has(s.name)) && (
            <button
              onClick={() => setBulkAdd({ overlap: false, saving: false })}
              className="btn-ghost text-xs flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add All to JSON
            </button>
          )}
          <button onClick={handleImport} className="btn-primary text-xs">+ Import WAVs</button>
        </div>
      </div>

      <input
        type="text"
        placeholder="Search sounds..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="input-base shrink-0"
      />

      {/* JSON CLEANUP */}
      <div className="card p-3 shrink-0 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="badge bg-orange-dim text-orange text-xs">JSON Cleanup</span>
            <span className="text-xs text-text-dim">Pronađi zvukove u JSON koji ne postoje u sourceSoundFiles</span>
          </div>
          <div className="flex items-center gap-2">
            {orphanResult && orphanResult.orphanedSprites.length > 0 && (
              <button
                onClick={handleCleanOrphans}
                disabled={cleaning}
                className="btn-primary text-xs py-1 px-3 bg-danger/80 hover:bg-danger border-danger/50"
              >
                {cleaning ? 'Čistim...' : `Obriši ${orphanResult.orphanedSprites.length} orphan-a`}
              </button>
            )}
            <button
              onClick={handleAnalyzeOrphans}
              disabled={analyzing}
              className="btn-ghost text-xs py-1 px-3"
            >
              {analyzing ? 'Analiziram...' : 'Analiziraj'}
            </button>
          </div>
        </div>

        {orphanResult && (
          orphanResult.orphanedSprites.length === 0 ? (
            <div className="flex items-center gap-2 text-green text-xs">
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              sounds.json je čist — svi spriteId-evi imaju WAV u sourceSoundFiles
            </div>
          ) : (
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">

              {/* Orphaned sprites */}
              <div>
                <p className="text-xs text-danger font-semibold mb-1">
                  {orphanResult.orphanedSprites.length} orphaned sprite(s) — biće obrisani iz soundSprites:
                </p>
                <div className="flex flex-wrap gap-1">
                  {orphanResult.orphanedSprites.map(k => (
                    <span key={k} className="badge bg-danger-dim text-danger font-mono text-xs">{k}</span>
                  ))}
                </div>
              </div>

              {/* Affected spriteLists */}
              {Object.keys(orphanResult.affectedSpriteLists).length > 0 && (
                <div className="pt-1.5 border-t border-border/50">
                  <p className="text-xs text-orange font-semibold mb-1">SpriteLists:</p>
                  <div className="space-y-0.5">
                    {Object.entries(orphanResult.affectedSpriteLists).map(([k, bad]) => (
                      <div key={k} className="flex items-center gap-2 flex-wrap">
                        <span className={`badge font-mono text-xs ${orphanResult.removedSpriteLists.includes(k) ? 'bg-danger-dim text-danger' : 'bg-orange-dim text-orange'}`}>
                          {k} {orphanResult.removedSpriteLists.includes(k) ? '(cela lista briše se)' : `(${bad.length} ID-a briše se)`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Affected commands */}
              {Object.keys(orphanResult.affectedCommands).length > 0 && (
                <div className="pt-1.5 border-t border-border/50">
                  <p className="text-xs text-orange font-semibold mb-1">Komande (samo step-ovi se brišu, komanda ostaje):</p>
                  <div className="flex flex-wrap gap-1">
                    {Object.keys(orphanResult.affectedCommands).map(cmd => (
                      <span key={cmd} className="badge bg-orange-dim text-orange font-mono text-xs">
                        {cmd} (~{orphanResult.affectedCommands[cmd].length})
                      </span>
                    ))}
                  </div>
                </div>
              )}

            </div>
          )
        )}
      </div>

      <div className="space-y-1 flex-1 min-h-0 overflow-y-auto pr-1">
        {sounds.map((s) => {
          const inJson = inJsonSet.has(s.name);
          const isPlaying = playing === s.filename;
          return (
            <div
              key={s.filename}
              className={`card flex flex-wrap items-center gap-3 px-3 py-2 group hover:border-border-bright transition-colors ${isPlaying ? 'border-accent/40 bg-accent/5' : ''}`}
              style={{ borderRadius: 10 }}
            >
              <div className="flex items-center gap-0.5 shrink-0">
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

              <span className="flex-1 text-xs font-mono text-text-primary truncate">{s.name}</span>

              {inJson
                ? <span className="badge bg-green-dim text-green shrink-0">in JSON</span>
                : (
                  <button
                    onClick={() => setAddModal({ name: s.name, tags: autoTag(s.name), overlap: false, saving: false })}
                    className="badge bg-orange-dim text-orange shrink-0 cursor-pointer hover:bg-orange/20 transition-colors"
                    title="Dodaj u sounds.json"
                  >
                    + Add to JSON
                  </button>
                )
              }

              <span className="text-xs text-text-secondary w-16 text-right tabular-nums font-mono">{s.sizeKB} KB</span>

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

              {/* Waveform + Seek */}
              {isPlaying && waveform?.filename === s.filename && waveform.peaks && (
                <div className="w-full col-span-full flex items-center gap-2 pt-1.5 pb-0.5">
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
            </div>
          );
        })}
        {sounds.length === 0 && (
          <div className="text-center py-16 text-text-dim text-sm">
            {filter ? 'No sounds match filter' : 'No WAV files in sourceSoundFiles/'}
          </div>
        )}
      </div>

      {/* Add to JSON Modal */}
      {addModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-bg-secondary border border-border rounded-2xl shadow-2xl w-[400px] flex flex-col">
            <div className="p-5 border-b border-border">
              <h3 className="text-sm font-bold text-text-primary">Dodaj u sounds.json</h3>
              <p className="text-xs text-text-dim mt-0.5 font-mono">s_{addModal.name}</p>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="section-label mb-1.5 block">Tags</label>
                <div className="flex gap-2">
                  {['SoundEffects', 'Music'].map(t => (
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
                  overlap <span className="text-text-dim">(zvuk se preklapa sa samim sobom)</span>
                </label>
              </div>
            </div>
            <div className="p-4 border-t border-border flex gap-2 justify-end">
              <button onClick={() => setAddModal(null)} className="btn-ghost text-xs px-4 py-2">Otkaži</button>
              <button
                onClick={handleAddToJson}
                disabled={addModal.saving}
                className="btn-primary text-xs px-4 py-2 disabled:opacity-40"
              >
                {addModal.saving ? 'Snimam...' : 'Dodaj'}
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
                <h3 className="text-sm font-bold text-text-primary">Dodaj sve u sounds.json</h3>
                <p className="text-xs text-text-dim mt-0.5">{missing.length} zvuk(a) koji još nisu u JSON-u</p>
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
                    overlap <span className="text-text-dim">(zvuk se preklapa sa samim sobom)</span>
                  </label>
                </div>
              </div>
              <div className="p-4 border-t border-border flex gap-2 justify-end">
                <button onClick={() => setBulkAdd(null)} className="btn-ghost text-xs px-4 py-2">Otkaži</button>
                <button
                  onClick={handleAddAllToJson}
                  disabled={bulkAdd.saving}
                  className="btn-primary text-xs px-4 py-2 disabled:opacity-40"
                >
                  {bulkAdd.saving ? 'Snimam...' : `Dodaj ${missing.length} zvuk(a)`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Trash Modal */}
      {showTrash && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-bg-secondary border border-border rounded-2xl shadow-2xl w-[440px] max-h-[70vh] flex flex-col">
            <div className="p-5 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-text-primary">Trash</h3>
                <p className="text-xs text-text-dim mt-0.5">Restore sounds back to sourceSoundFiles</p>
              </div>
              <button onClick={() => setShowTrash(false)} className="text-text-dim hover:text-text-primary transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-1">
              {deleted.length === 0 ? (
                <p className="text-center text-text-dim text-sm py-8">Trash is empty</p>
              ) : deleted.map(f => (
                <div key={f} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-bg-hover transition-colors">
                  <span className="font-mono text-xs text-text-primary flex-1 truncate">{f.replace('.wav', '')}</span>
                  <button
                    onClick={() => handleRestore(f)}
                    disabled={restoring === f}
                    className="btn-primary text-xs py-1 px-3"
                  >
                    {restoring === f ? '...' : 'Restore'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
