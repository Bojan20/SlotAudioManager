const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  openProject: () => ipcRenderer.invoke('open-project'),
  reloadProject: () => ipcRenderer.invoke('reload-project'),
  saveSpriteConfig: (config) => ipcRenderer.invoke('save-sprite-config', config),
  saveSoundsJson: (data) => ipcRenderer.invoke('save-sounds-json', data),
  saveSettings: (data) => ipcRenderer.invoke('save-settings', data),
  runScript: (name) => ipcRenderer.invoke('run-script', name),
  runDeploy: (name) => ipcRenderer.invoke('run-deploy', name),
  gitStatus: () => ipcRenderer.invoke('git-status'),
  gitCommitPush: (message) => ipcRenderer.invoke('git-commit-push', message),
  importSounds: () => ipcRenderer.invoke('import-sounds'),
  deleteSound: (filename) => ipcRenderer.invoke('delete-sound', filename),
  // Template & health
  healthCheck: () => ipcRenderer.invoke('health-check'),
  initFromTemplate: () => ipcRenderer.invoke('init-from-template'),
  npmInstall: () => ipcRenderer.invoke('npm-install'),
  // Game configuration
  pickGameRepo: () => ipcRenderer.invoke('pick-game-repo'),
  configureGame: (config) => ipcRenderer.invoke('configure-game', config),
  // Game launch
  getGameScripts: () => ipcRenderer.invoke('get-game-scripts'),
  runGameScript: (name) => ipcRenderer.invoke('run-game-script', name),
});
