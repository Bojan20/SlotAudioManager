const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const md = fs.readFileSync(path.join(__dirname, 'technical-architecture.md'), 'utf8');
const content = marked.parse(md);

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>IGT Slot Audio Manager — Technical Architecture</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  @page {
    size: A4;
    margin: 0;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  :root {
    --bg-deep: #06060e;
    --bg-dark: #0a0a16;
    --bg-card: #0f0f1e;
    --bg-card-hover: #14142a;
    --bg-code: #0c0c1a;
    --accent: #8b7cf8;
    --accent-bright: #a599ff;
    --accent-dim: rgba(139, 124, 248, 0.12);
    --accent-glow: rgba(139, 124, 248, 0.25);
    --cyan: #38bdf8;
    --cyan-dim: rgba(56, 189, 248, 0.12);
    --green: #4ade80;
    --green-dim: rgba(74, 222, 128, 0.12);
    --orange: #fb923c;
    --orange-dim: rgba(251, 146, 60, 0.12);
    --danger: #f87171;
    --text-primary: #eeeeff;
    --text-secondary: #b0b0d0;
    --text-dim: #6a6a96;
    --border: rgba(255,255,255,0.08);
    --border-bright: rgba(255,255,255,0.15);
  }

  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-size: 12.5px;
    line-height: 1.7;
    color: var(--text-primary);
    background: var(--bg-deep);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  /* ═══════════════════════════════════════════════════════
     COVER PAGE
     ═══════════════════════════════════════════════════════ */
  .cover {
    height: 100vh;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    background:
      radial-gradient(ellipse 80% 60% at 50% 40%, rgba(139,124,248,0.15) 0%, transparent 70%),
      radial-gradient(ellipse 60% 50% at 70% 60%, rgba(56,189,248,0.08) 0%, transparent 60%),
      linear-gradient(180deg, #06060e 0%, #0a0a1a 40%, #0e0e24 100%);
    text-align: center;
    padding: 80px 60px;
    position: relative;
    overflow: hidden;
    page-break-after: always;
  }

  .cover::before {
    content: '';
    position: absolute;
    top: -50%; left: -50%; right: -50%; bottom: -50%;
    background: repeating-linear-gradient(
      0deg,
      transparent,
      transparent 100px,
      rgba(139,124,248,0.02) 100px,
      rgba(139,124,248,0.02) 101px
    ),
    repeating-linear-gradient(
      90deg,
      transparent,
      transparent 100px,
      rgba(139,124,248,0.02) 100px,
      rgba(139,124,248,0.02) 101px
    );
    pointer-events: none;
  }

  .cover-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: rgba(139,124,248,0.1);
    border: 1px solid rgba(139,124,248,0.2);
    color: var(--accent-bright);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 6px 16px;
    border-radius: 100px;
    margin-bottom: 32px;
    position: relative;
  }

  .cover-icon {
    width: 72px; height: 72px;
    border-radius: 18px;
    background: linear-gradient(135deg, var(--accent) 0%, var(--cyan) 100%);
    display: flex; align-items: center; justify-content: center;
    margin-bottom: 36px;
    box-shadow:
      0 0 0 1px rgba(255,255,255,0.1),
      0 20px 60px rgba(139,124,248,0.3),
      0 8px 24px rgba(0,0,0,0.4);
    position: relative;
  }

  .cover h1 {
    font-size: 42px;
    font-weight: 900;
    letter-spacing: -1px;
    background: linear-gradient(135deg, #fff 0%, var(--accent-bright) 50%, var(--cyan) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    margin-bottom: 12px;
    border: none;
    padding: 0;
    line-height: 1.1;
    position: relative;
  }

  .cover .subtitle {
    font-size: 17px;
    color: var(--text-dim);
    font-weight: 400;
    margin-bottom: 56px;
    letter-spacing: 0.02em;
    position: relative;
  }

  .cover-meta {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px 40px;
    text-align: left;
    max-width: 400px;
    background: rgba(255,255,255,0.03);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 24px 32px;
    position: relative;
  }

  .cover-meta dt {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    color: var(--text-dim);
    font-weight: 600;
  }

  .cover-meta dd {
    font-size: 14px;
    color: var(--text-secondary);
    font-weight: 500;
    margin-top: 2px;
  }

  /* ═══════════════════════════════════════════════════════
     TABLE OF CONTENTS
     ═══════════════════════════════════════════════════════ */
  .toc {
    page-break-after: always;
    padding: 60px;
    background: var(--bg-deep);
    min-height: 100vh;
  }

  .toc h2 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    color: var(--accent);
    font-weight: 700;
    margin-bottom: 32px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
  }

  .toc-list {
    list-style: none;
    padding: 0;
    counter-reset: toc-counter;
  }

  .toc-list li {
    counter-increment: toc-counter;
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: baseline;
    gap: 12px;
  }

  .toc-list li::before {
    content: counter(toc-counter, decimal-leading-zero);
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    font-weight: 600;
    color: var(--accent);
    min-width: 24px;
  }

  .toc-list li span {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary);
  }

  .toc-list li em {
    font-style: normal;
    font-size: 12px;
    color: var(--text-dim);
    margin-left: auto;
  }

  /* ═══════════════════════════════════════════════════════
     CONTENT AREA
     ═══════════════════════════════════════════════════════ */
  .content {
    max-width: 780px;
    margin: 0 auto;
    padding: 40px 56px 60px;
    background: var(--bg-deep);
  }

  /* ── Typography ── */
  h1 {
    font-size: 24px;
    font-weight: 800;
    color: var(--text-primary);
    letter-spacing: -0.3px;
    margin: 56px 0 20px;
    padding-bottom: 14px;
    border-bottom: 2px solid var(--accent);
    position: relative;
  }
  h1::after {
    content: '';
    position: absolute;
    bottom: -2px;
    left: 0;
    width: 60px;
    height: 2px;
    background: var(--cyan);
  }
  h1:first-child { margin-top: 0; }

  h2 {
    font-size: 18px;
    font-weight: 700;
    color: var(--text-primary);
    margin: 44px 0 16px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border-bright);
    page-break-after: avoid;
  }

  h3 {
    font-size: 15px;
    font-weight: 600;
    color: var(--accent-bright);
    margin: 32px 0 12px;
    page-break-after: avoid;
  }

  h4 {
    font-size: 12px;
    font-weight: 700;
    color: var(--cyan);
    margin: 24px 0 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    page-break-after: avoid;
  }

  p {
    margin: 8px 0;
    color: var(--text-secondary);
  }

  strong {
    color: var(--text-primary);
    font-weight: 600;
  }

  em {
    color: var(--accent-bright);
    font-style: italic;
  }

  a {
    color: var(--accent);
    text-decoration: none;
    border-bottom: 1px solid var(--accent-dim);
  }

  hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 40px 0;
  }

  /* ── Lists ── */
  ul, ol {
    padding-left: 20px;
    margin: 10px 0;
    color: var(--text-secondary);
  }

  li {
    margin: 5px 0;
    padding-left: 4px;
  }

  li::marker {
    color: var(--accent);
  }

  li strong {
    color: var(--text-primary);
  }

  /* ── Inline Code ── */
  code {
    font-family: 'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace;
    font-size: 11px;
    background: var(--accent-dim);
    color: var(--accent-bright);
    padding: 2px 7px;
    border-radius: 5px;
    font-weight: 500;
    border: 1px solid rgba(139,124,248,0.1);
  }

  /* ── Code Blocks ── */
  pre {
    background: var(--bg-code);
    color: #c8c8e8;
    padding: 20px 24px;
    border-radius: 12px;
    overflow-x: auto;
    font-size: 11px;
    line-height: 1.65;
    margin: 16px 0;
    border: 1px solid var(--border);
    position: relative;
    page-break-inside: avoid;
  }

  pre::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 1px;
    background: linear-gradient(90deg, var(--accent), var(--cyan), transparent);
    opacity: 0.4;
  }

  pre code {
    background: none;
    color: inherit;
    padding: 0;
    font-size: inherit;
    font-weight: 400;
    border: none;
    border-radius: 0;
  }

  /* ── Tables ── */
  table {
    border-collapse: separate;
    border-spacing: 0;
    width: 100%;
    margin: 16px 0;
    font-size: 11.5px;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid var(--border-bright);
    page-break-inside: avoid;
  }

  thead th {
    background: rgba(139,124,248,0.08);
    color: var(--accent-bright);
    font-weight: 600;
    text-align: left;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border-bright);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  td {
    padding: 9px 16px;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
    color: var(--text-secondary);
  }

  tr:last-child td {
    border-bottom: none;
  }

  tbody tr {
    background: rgba(255,255,255,0.01);
  }

  tbody tr:nth-child(even) {
    background: rgba(255,255,255,0.025);
  }

  td code {
    font-size: 10.5px;
  }

  /* First column bold */
  td:first-child {
    color: var(--text-primary);
    font-weight: 500;
  }

  /* ── Blockquote ── */
  blockquote {
    border-left: 3px solid var(--accent);
    padding: 14px 20px;
    margin: 20px 0;
    background: var(--accent-dim);
    border-radius: 0 10px 10px 0;
    color: var(--text-secondary);
    font-style: italic;
  }

  blockquote p {
    margin: 0;
    color: inherit;
  }

  /* ═══════════════════════════════════════════════════════
     SECTION DIVIDERS
     ═══════════════════════════════════════════════════════ */
  .section-break {
    page-break-before: always;
    margin-top: 60px;
  }

  /* ═══════════════════════════════════════════════════════
     PRINT STYLES
     ═══════════════════════════════════════════════════════ */
  @media print {
    body {
      font-size: 11px;
      background: var(--bg-deep);
      color: var(--text-primary);
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .cover {
      height: 100vh;
      background:
        radial-gradient(ellipse 80% 60% at 50% 40%, rgba(139,124,248,0.15) 0%, transparent 70%),
        linear-gradient(180deg, #06060e 0%, #0a0a1a 40%, #0e0e24 100%) !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    pre, table, blockquote {
      page-break-inside: avoid;
    }

    h2, h3, h4 {
      page-break-after: avoid;
    }

    .content {
      padding: 32px 44px;
    }

    .toc {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }
</style>
</head>
<body>

<!-- ══════════════════ COVER PAGE ══════════════════ -->
<div class="cover">
  <div class="cover-badge">
    <svg width="12" height="12" fill="currentColor" viewBox="0 0 16 16"><circle cx="8" cy="8" r="4"/></svg>
    Technical Architecture Document
  </div>
  <div class="cover-icon">
    <svg width="36" height="36" fill="white" viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
  </div>
  <h1 style="font-size:42px;border:none;margin:0 0 12px;padding:0;">IGT Slot Audio Manager</h1>
  <div class="subtitle">Cross-Platform Electron Desktop Application for Slot Game Audio Workflow</div>
  <dl class="cover-meta">
    <div><dt>Version</dt><dd>2.0</dd></div>
    <div><dt>Date</dt><dd>April 2026</dd></div>
    <div><dt>Author</dt><dd>Bojan Petkovic</dd></div>
    <div><dt>Audience</dt><dd>Tech Leads & Architecture Review</dd></div>
  </dl>
</div>

<!-- ══════════════════ TABLE OF CONTENTS ══════════════════ -->
<div class="toc">
  <h2>Table of Contents</h2>
  <ol class="toc-list">
    <li><span>Executive Summary</span> <em>Overview & impact</em></li>
    <li><span>Technology Stack</span> <em>Electron, React, Vite, FFmpeg</em></li>
    <li><span>Architecture Overview</span> <em>Process model, page architecture</em></li>
    <li><span>Application Pages — Detailed Walkthrough</span> <em>All 7 tabs explained</em></li>
    <li><span>Data Model</span> <em>JSON schemas, project structure</em></li>
    <li><span>Tiered Audio Loading</span> <em>SubLoader system, pool architecture</em></li>
    <li><span>Build Pipeline</span> <em>WAV → M4A → deploy flow</em></li>
    <li><span>IPC Channel Reference</span> <em>30+ channels documented</em></li>
    <li><span>Security Model</span> <em>Process isolation, input validation</em></li>
    <li><span>Cross-Platform Compatibility</span> <em>macOS + Windows</em></li>
    <li><span>UI Design System</span> <em>Dark theme, components, animations</em></li>
    <li><span>Build & Distribution</span> <em>DMG, NSIS, template system</em></li>
    <li><span>Key Design Decisions</span> <em>Rationale for architectural choices</em></li>
  </ol>
</div>

<!-- ══════════════════ CONTENT ══════════════════ -->
<div class="content">
${content}
</div>

</body>
</html>`;

const outPath = path.join(__dirname, 'technical-architecture.html');
fs.writeFileSync(outPath, html);
console.log('✓ HTML written to', outPath);
console.log('');
console.log('To generate PDF:');
console.log('  1. Open technical-architecture.html in Chrome/Edge');
console.log('  2. Ctrl+P → Save as PDF');
console.log('  3. Enable "Background graphics"');
console.log('  4. Margins: None');
console.log('  5. Paper size: A4');
