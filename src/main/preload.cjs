const { contextBridge, ipcRenderer } = require('electron');
const invoke = method => (...args) => ipcRenderer.invoke(`agent-watch:${method}`, ...args);
contextBridge.exposeInMainWorld('agentWatch', {
  state: invoke('state'), chooseProject: invoke('choose-project'), settings: invoke('settings'),
  saveLayout: invoke('save-layout'),
  catalog: invoke('catalog'), installTheme: invoke('install-theme'), selectTheme: invoke('select-theme'),
  cloneTheme: invoke('clone-theme'), importTheme: invoke('import-theme'), saveTheme: invoke('save-theme'),
  replaceImage: invoke('replace-image'), openTheme: invoke('open-theme'), checkUpdates: invoke('check-updates'),
  installUpdate: invoke('install-update'), openGuide: invoke('open-guide'),
  onChange: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('agent-watch:change', listener); return () => ipcRenderer.removeListener('agent-watch:change', listener); }
});
