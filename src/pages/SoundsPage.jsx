import React, { useState } from 'react';

export default function SoundsPage({ project, setProject, showToast }) {
  const [filter, setFilter] = useState('');
  const [deleting, setDeleting] = useState(null);

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

  // Build tier lookup
  const tierMap = {};
  if (project?.spriteConfig?.sprites) {
    for (const [tier, cfg] of Object.entries(project.spriteConfig.sprites)) {
      for (const snd of cfg.sounds || []) tierMap[snd] = tier;
    }
  }
  const standaloneSet = new Set(project?.spriteConfig?.standalone?.sounds || []);

  const handleImport = async () => {
    try {
      const result = await window.api.importSounds();
      if (result?.project) { setProject(result.project); showToast(`Imported ${result.imported} file(s)`, 'success'); }
    } catch (e) {
      showToast('Import failed: ' + e.message, 'error');
    }
  };

  const handleDelete = async (filename) => {
    setDeleting(filename);
    try {
      const result = await window.api.deleteSound(filename);
      if (result?.project) { setProject(result.project); showToast(`Deleted ${filename}`, 'success'); }
      else if (result?.error) showToast(result.error, 'error');
    } catch (e) {
      showToast('Delete failed: ' + e.message, 'error');
    }
    setDeleting(null);
  };

  return (
    <div className="anim-fade-up space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Source Sounds</h2>
          <p className="text-[11px] text-text-dim mt-0.5">
            {project?.sounds?.length || 0} files &middot; {totalSizeMB} MB total
          </p>
        </div>
        <button onClick={handleImport} className="btn-primary text-xs py-2">+ Import WAVs</button>
      </div>

      <input
        type="text"
        placeholder="Search sounds..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="input-base"
      />

      <div className="space-y-1 max-h-[calc(100vh-250px)] overflow-y-auto pr-1">
        {sounds.map((s) => {
          const tier = tierMap[s.name];
          const isStandalone = standaloneSet.has(s.name);
          const unassigned = !tier && !isStandalone;
          return (
            <div
              key={s.filename}
              className="card flex items-center gap-3 px-4 py-2.5 group"
              style={{ borderRadius: 10 }}
            >
              <svg className="w-4 h-4 text-text-dim shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072M12 6v12m0-12l4.5-3M12 18c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" />
              </svg>
              <span className="flex-1 text-[13px] font-mono truncate">{s.name}</span>

              {tier && <span className="badge bg-purple-dim text-purple">{tier}</span>}
              {isStandalone && <span className="badge bg-green-dim text-green">standalone</span>}
              {unassigned && <span className="badge bg-orange-dim text-orange">unassigned</span>}

              <span className="text-[11px] text-text-dim w-14 text-right tabular-nums">{s.sizeKB} KB</span>

              <button
                onClick={() => handleDelete(s.filename)}
                disabled={deleting === s.filename}
                className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center rounded-md text-danger hover:bg-danger-dim transition-all"
                title="Delete"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          );
        })}
        {sounds.length === 0 && (
          <div className="text-center py-12 text-text-dim text-sm">
            {filter ? 'No sounds match filter' : 'No WAV files in sourceSoundFiles/'}
          </div>
        )}
      </div>
    </div>
  );
}
