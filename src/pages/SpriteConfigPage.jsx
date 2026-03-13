import React, { useState, useEffect } from 'react';

export default function SpriteConfigPage({ project, showToast }) {
  const [config, setConfig] = useState(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (project?.spriteConfig) {
      setConfig(structuredClone(project.spriteConfig));
    } else {
      setConfig(null);
    }
    setDirty(false);
  }, [project?.path]);

  if (!config) {
    return (
      <div className="anim-fade-up flex flex-col items-center justify-center h-64 text-text-dim text-sm">
        No sprite-config.json found in project.
      </div>
    );
  }

  const update = (fn) => { fn(); setConfig(structuredClone(config)); setDirty(true); };

  const handleSave = async () => {
    try {
      const result = await window.api.saveSpriteConfig(config);
      if (result?.success) { setDirty(false); showToast('Sprite config saved', 'success'); }
      else showToast(result?.error || 'Save failed', 'error');
    } catch (e) {
      showToast('Save failed: ' + e.message, 'error');
    }
  };

  return (
    <div className="anim-fade-up space-y-5 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Sprite Configuration</h2>
          <p className="text-[11px] text-text-dim mt-0.5">Tier-based grouping and encoding</p>
        </div>
        <button onClick={handleSave} disabled={!dirty} className={dirty ? 'btn-primary text-xs py-2' : 'btn-ghost text-xs opacity-50 cursor-not-allowed'}>
          {dirty ? 'Save Changes' : 'No Changes'}
        </button>
      </div>

      {/* Gap */}
      <div className="card p-4 flex items-center gap-4">
        <p className="section-label w-24">Sprite Gap</p>
        <input
          type="number"
          step="0.01"
          value={config.spriteGap ?? 0.05}
          onChange={(e) => update(() => { config.spriteGap = parseFloat(e.target.value) || 0; })}
          className="input-base w-24 text-center"
        />
        <span className="text-[11px] text-text-dim">seconds between sounds</span>
      </div>

      {/* Tiers */}
      <div className="space-y-4 max-h-[calc(100vh-320px)] overflow-y-auto pr-1">
        {Object.entries(config.sprites || {}).map(([tierName, tierCfg]) => (
          <div key={tierName} className="card p-5 space-y-3">
            <div className="flex items-center gap-3">
              <span className="badge bg-purple-dim text-purple text-xs">{tierName}</span>
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-[11px] text-text-dim">Max size:</span>
                <input
                  type="number"
                  value={tierCfg.maxSizeKB || 1500}
                  onChange={(e) => update(() => { tierCfg.maxSizeKB = parseInt(e.target.value) || 0; })}
                  className="input-base w-20 text-center text-xs py-1.5 px-2"
                />
                <span className="text-[11px] text-text-dim">KB</span>
              </div>
            </div>

            <div>
              <p className="section-label mb-1.5">Sounds</p>
              <textarea
                value={(tierCfg.sounds || []).join('\n')}
                onChange={(e) => update(() => { tierCfg.sounds = e.target.value.split('\n').map(s => s.trim()).filter(Boolean); })}
                rows={Math.min(12, Math.max(3, (tierCfg.sounds || []).length + 1))}
                className="input-base font-mono text-xs resize-y max-h-64"
              />
            </div>

            {tierCfg.sortOrder && (
              <div>
                <p className="section-label mb-1.5">Sort Order (priority)</p>
                <textarea
                  value={(tierCfg.sortOrder || []).join('\n')}
                  onChange={(e) => update(() => { tierCfg.sortOrder = e.target.value.split('\n').map(s => s.trim()).filter(Boolean); })}
                  rows={Math.min(6, Math.max(2, (tierCfg.sortOrder || []).length + 1))}
                  className="input-base font-mono text-xs resize-y max-h-40"
                />
              </div>
            )}
          </div>
        ))}

        {/* Standalone */}
        <div className="card p-5 space-y-3">
          <span className="badge bg-green-dim text-green text-xs">Standalone Music</span>
          <textarea
            value={(config.standalone?.sounds || []).join('\n')}
            onChange={(e) => update(() => {
              if (!config.standalone) config.standalone = {};
              config.standalone.sounds = e.target.value.split('\n').map(s => s.trim()).filter(Boolean);
            })}
            rows={3}
            className="input-base font-mono text-xs resize-y max-h-40"
          />
        </div>

        {/* Encoding */}
        <div className="card p-5 space-y-4">
          <p className="section-label">Encoding</p>
          {Object.entries(config.encoding || {}).map(([key, enc]) => (
            <div key={key} className="flex items-center gap-4">
              <span className="badge bg-cyan-dim text-cyan w-16 justify-center">{key}</span>
              <span className="text-[11px] text-text-dim">Bitrate:</span>
              <input
                type="number"
                value={enc.bitrate || 64}
                onChange={(e) => update(() => { enc.bitrate = parseInt(e.target.value) || 64; })}
                className="input-base w-16 text-center text-xs py-1.5 px-2"
              />
              <span className="text-[11px] text-text-dim">kbps</span>
              <span className="text-[11px] text-text-dim ml-4">Channels:</span>
              <select
                value={enc.channels || 2}
                onChange={(e) => update(() => { enc.channels = parseInt(e.target.value); })}
                className="input-base w-24 text-xs py-1.5 px-2"
              >
                <option value={1}>Mono</option>
                <option value={2}>Stereo</option>
              </select>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
