---
name: SlotAudioManager Electron App
description: Cross-platform Electron app for slot audio workflow — project status, architecture, GitHub repo location
type: project
---

SlotAudioManager is a cross-platform Electron 28 desktop app for managing slot game audio workflows.

**Why:** IGT slot audio production needs a unified tool for building audio sprites, configuring tier-based grouping, deploying to game repos, and validating builds.

**Status (2026-03-13):**
- App is complete and functional — QA'd twice + role-based review (5 roles)
- All code pushed to GitHub: https://github.com/Bojan20/SlotAudioManager
- Branch: main
- Cross-platform fixes applied (titlebar, dev script, paths)
- CLAUDE.md in repo root has full architecture reference
- No known bugs remaining

**Stack:** Electron 28 + React 19 + Tailwind CSS v4 + Vite 8, CommonJS main/preload, ESM renderer

**How to apply:** Read CLAUDE.md in the repo root for complete architecture, IPC channels, schemas, security rules, and QA roles.
