import React, { useState, useCallback, useRef, useMemo, Component } from 'react';
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

  const showToast = useCallback((msg, type = 'info') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, type });
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

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
      if (data) { setProject(data); showToast('Reloaded', 'success'); }
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
    { id: 'project',  el: <ProjectPage project={project} onOpen={openProject} onReload={reloadProject} /> },
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
      <aside className="w-56 shrink-0 bg-bg-secondary flex flex-col border-r border-border select-none">
        <div className="h-8 drag-region shrink-0" />

        <div className="px-3 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-accent/25 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-bold text-text-primary leading-tight">Slot Audio</p>
              <p className="text-xs text-text-dim font-semibold tracking-widest uppercase">Manager</p>
            </div>
          </div>
        </div>

        {gameName && (
          <div className="mx-3 mb-2 px-3 py-2 rounded-xl bg-bg-active border border-border-bright">
            <p className="section-label mb-1">Active Project</p>
            <p className="text-xs font-bold text-cyan truncate">{gameName}</p>
          </div>
        )}

        <nav className="flex-1 px-2 py-1 space-y-0.5 overflow-y-auto">
          {NAV.map((item) => {
            const disabled = !project && item.id !== 'project';
            const active = page === item.id;
            return (
              <button
                key={item.id}
                onClick={() => !disabled && setPage(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-all duration-150
                  ${active
                    ? 'bg-accent/15 text-accent font-semibold border border-accent/20'
                    : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary font-medium border border-transparent'}
                  ${disabled ? 'opacity-20 pointer-events-none' : 'cursor-pointer'}
                `}
              >
                <NavIcon d={item.icon} />
                <span className="flex-1 text-left">{item.label}</span>
                {badges[item.id] && (
                  <span className="min-w-5 h-5 flex items-center justify-center rounded-full bg-danger/20 text-danger text-xs font-bold leading-none">
                    {badges[item.id]}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-border">
          <button onClick={openProject} className="btn-primary w-full text-xs">
            {project ? 'Switch Project' : 'Open Project'}
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col overflow-hidden bg-bg-primary">
        <div className="h-8 drag-region shrink-0" />
        <div className="flex-1 min-h-0 overflow-hidden px-6 pt-3 pb-4">
          {pages.map(({ id, el }) => (
            <div key={id} className={`h-full overflow-y-auto ${page === id ? '' : 'hidden'}`}>
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
