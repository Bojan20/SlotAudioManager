import React, { useState, useCallback, useRef, useMemo, useEffect, Component } from 'react';
import ProjectPage from './pages/ProjectPage';
import SoundsPage from './pages/SoundsPage';
import SpriteConfigPage from './pages/SpriteConfigPage';
import CommandsPage from './pages/CommandsPage';
import BuildPage from './pages/BuildPage';
import GitPage from './pages/GitPage';
import SetupPage from './pages/SetupPage';

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div className="p-6 space-y-3">
          <p className="text-danger font-bold text-sm">Page crashed</p>
          <pre className="text-xs text-text-dim bg-bg-secondary p-4 rounded-xl overflow-auto whitespace-pre-wrap">
            {this.state.error?.message}{'\n'}{this.state.error?.stack}
          </pre>
          <button className="btn-primary text-xs" onClick={() => this.setState({ error: null })}>Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}

const NAV = [
  { id: 'project',  label: 'Project',       icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { id: 'setup',    label: 'Setup',         icon: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4' },
  { id: 'sounds',   label: 'Sounds',        icon: 'M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z' },
  { id: 'sprites',  label: 'Sprite Config', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
  { id: 'commands', label: 'Commands',      icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01' },
  { id: 'build',    label: 'Build & Deploy', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  { id: 'git',      label: 'Git',           icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4' },
];

function NavIcon({ d }) {
  return (
    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

export default function App() {
  const [page, setPage] = useState('project');
  const [project, setProject] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const showToast = useCallback((msg, type = 'info') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, type });
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const refreshUndoStatus = useCallback(async () => {
    try { const s = await window.api.undoStatus(); setCanUndo(s.canUndo); setCanRedo(s.canRedo); } catch {}
  }, []);

  const handleUndo = useCallback(async () => {
    try {
      const r = await window.api.undo();
      if (r?.success && r.project) { setProject(r.project); showToast('Undo', 'success'); }
      else if (r?.error) showToast(r.error, 'error');
      setCanUndo(r?.canUndo ?? false); setCanRedo(r?.canRedo ?? false);
    } catch {}
  }, [showToast]);

  const handleRedo = useCallback(async () => {
    try {
      const r = await window.api.redo();
      if (r?.success && r.project) { setProject(r.project); showToast('Redo', 'success'); }
      else if (r?.error) showToast(r.error, 'error');
      setCanUndo(r?.canUndo ?? false); setCanRedo(r?.canRedo ?? false);
    } catch {}
  }, [showToast]);

  // Refresh undo status when project changes (after saves)
  useEffect(() => { refreshUndoStatus(); }, [project, refreshUndoStatus]);

  // Ctrl+Z / Ctrl+Shift+Z keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) { e.preventDefault(); handleRedo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); handleRedo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleUndo, handleRedo]);

  const openProject = async () => {
    try {
      const data = await window.api.openProject();
      if (data) { setProject(data); showToast('Project loaded', 'success'); }
    } catch (e) {
      showToast('Failed to open project: ' + e.message, 'error');
    }
  };

  const reloadProject = async () => {
    try {
      const data = await window.api.reloadProject();
      if (data) {
        // null→data cycle forces useEffect([project?.path]) to re-fire on all pages
        setProject(null);
        requestAnimationFrame(() => { setProject(data); showToast('Reloaded', 'success'); });
      }
    } catch (e) {
      showToast('Reload failed: ' + e.message, 'error');
    }
  };

  const gameName = project?.path ? project.path.split(/[/\\]/).pop() : null;

  // Compute badge counts for sidebar
  const badges = useMemo(() => {
    if (!project) return {};
    const sc = project.spriteConfig;
    const tiers = sc?.sprites || {};
    const standalone = sc?.standalone?.sounds || [];
    const allAssigned = new Set();
    for (const cfg of Object.values(tiers)) for (const s of (cfg.sounds || [])) allAssigned.add(s);
    for (const s of standalone) allAssigned.add(s);
    const unassigned = (project.sounds || []).filter(s => !allAssigned.has(s.name.replace(/\.wav$/i, ''))).length;
    return {
      sprites: unassigned > 0 ? unassigned : null,
    };
  }, [project]);

  const pages = [
    { id: 'project',  el: <ProjectPage project={project} setProject={setProject} onOpen={openProject} onReload={reloadProject} showToast={showToast} /> },
    { id: 'setup',    el: <SetupPage project={project} setProject={setProject} showToast={showToast} /> },
    { id: 'sounds',   el: <SoundsPage project={project} setProject={setProject} showToast={showToast} /> },
    { id: 'sprites',  el: <SpriteConfigPage project={project} setProject={setProject} showToast={showToast} /> },
    { id: 'commands', el: <CommandsPage project={project} setProject={setProject} showToast={showToast} /> },
    { id: 'build',    el: <BuildPage project={project} setProject={setProject} reloadProject={reloadProject} showToast={showToast} /> },
    { id: 'git',      el: <GitPage project={project} showToast={showToast} /> },
  ];

  return (
    <div className="flex h-full w-full">
      {/* Sidebar */}
      <aside className="w-[250px] shrink-0 flex flex-col select-none border-r border-white/[0.04]" style={{ background: 'rgba(13,13,22,0.85)', backdropFilter: 'blur(20px) saturate(1.5)', WebkitBackdropFilter: 'blur(20px) saturate(1.5)' }}>
        <div className="h-8 drag-region shrink-0" />

        {/* ── Branding ── */}
        <div style={{ padding: '8px 20px 28px 20px' }}>
          <div className="flex items-center" style={{ gap: '14px' }}>
            <div className="relative shrink-0">
              <div className="absolute rounded-[20px]" style={{ inset: '-10px', background: 'rgba(139,124,248,0.06)', filter: 'blur(16px)' }} />
              <div className="relative flex items-center justify-center" style={{ width: '42px', height: '42px', borderRadius: '16px', background: 'linear-gradient(135deg, rgba(139,124,248,0.15) 0%, rgba(139,124,248,0.04) 100%)', border: '1px solid rgba(139,124,248,0.1)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 8px 32px rgba(139,124,248,0.06)' }}>
                <svg className="text-accent" style={{ width: '22px', height: '22px' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
              </div>
            </div>
            <div>
              <div className="flex items-center" style={{ gap: '8px', marginBottom: '5px' }}>
                <span style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.4em', color: 'rgba(139,124,248,0.45)', textTransform: 'uppercase' }}>IGT</span>
                <div style={{ width: '20px', height: '1px', background: 'rgba(139,124,248,0.1)' }} />
              </div>
              <p className="text-text-primary" style={{ fontSize: '15px', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.2 }}>Slot Audio</p>
              <p style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', lineHeight: 1.4, marginTop: '2px' }}>Manager</p>
            </div>
          </div>
        </div>

        {/* ── Active project ── */}
        {gameName && (
          <div className="glass" style={{ margin: '0 16px 20px 16px', padding: '14px 16px' }}>
            <p style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', marginBottom: '8px' }}>Active Project</p>
            <p className="text-cyan truncate" style={{ fontSize: '13px', fontWeight: 700 }}>{gameName}</p>
          </div>
        )}

        {/* ── Navigation ── */}
        <nav className="flex-1 overflow-y-auto" style={{ padding: '4px 14px 16px 14px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {NAV.map((item) => {
              const disabled = !project && item.id !== 'project';
              const active = page === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => !disabled && setPage(item.id)}
                  style={{ padding: '11px 14px', gap: '12px', fontSize: '13px', borderRadius: '14px', transition: 'all 0.15s', border: active ? '1px solid rgba(139,124,248,0.12)' : '1px solid transparent', background: active ? 'rgba(139,124,248,0.08)' : 'transparent', boxShadow: active ? 'inset 0 1px 0 rgba(255,255,255,0.03)' : 'none' }}
                  className={`w-full flex items-center text-left cursor-pointer
                    ${active ? 'text-accent font-semibold' : 'text-text-secondary hover:text-text-primary font-medium'}
                    ${disabled ? 'opacity-20 pointer-events-none' : ''}
                  `}
                >
                  <NavIcon d={item.icon} />
                  <span className="flex-1">{item.label}</span>
                  {badges[item.id] && (
                    <span style={{ minWidth: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '999px', background: 'rgba(248,113,113,0.12)', color: '#f87171', fontSize: '11px', fontWeight: 700 }}>
                      {badges[item.id]}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </nav>

        {/* ── Undo/Redo ── */}
        {project && (
          <div style={{ padding: '8px 16px 0', display: 'flex', gap: '6px' }}>
            <button onClick={handleUndo} disabled={!canUndo}
              className="btn-ghost flex-1 text-xs py-1.5 disabled:opacity-20"
              title="Undo (Ctrl+Z)"
            >
              <svg className="w-3.5 h-3.5 mr-1 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a5 5 0 015 5v2M3 10l4-4M3 10l4 4" /></svg>
              Undo
            </button>
            <button onClick={handleRedo} disabled={!canRedo}
              className="btn-ghost flex-1 text-xs py-1.5 disabled:opacity-20"
              title="Redo (Ctrl+Shift+Z)"
            >
              Redo
              <svg className="w-3.5 h-3.5 ml-1 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 10H11a5 5 0 00-5 5v2M21 10l-4-4M21 10l-4 4" /></svg>
            </button>
          </div>
        )}

        {/* ── Bottom action ── */}
        <div style={{ padding: '12px 16px 20px 16px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
          <button onClick={openProject} className="btn-primary w-full" style={{ borderRadius: '12px', fontSize: '13px', padding: '12px 0' }}>
            {project ? 'Switch Project' : 'Open Project'}
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col overflow-hidden bg-bg-primary">
        <div className="h-8 drag-region shrink-0" />
        <div className="flex-1 min-h-0 overflow-hidden" style={{ padding: '24px 32px 32px' }}>
          {pages.map(({ id, el }) => (
            <div key={id} className={`h-full overflow-y-auto overflow-x-hidden ${page === id ? '' : 'hidden'}`}>
              <ErrorBoundary>
                {project || id === 'project' ? el : null}
              </ErrorBoundary>
            </div>
          ))}
        </div>
      </main>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl text-[13px] font-semibold anim-fade-up shadow-2xl backdrop-blur-sm
          ${toast.type === 'success' ? 'bg-success-dim text-success border border-success/30' :
            toast.type === 'error' ? 'bg-danger-dim text-danger border border-danger/30' :
            'bg-accent-glow text-accent border border-accent/30'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
