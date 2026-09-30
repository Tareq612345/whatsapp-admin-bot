const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('studio', {
  getState: () => ipcRenderer.invoke('studio:get-state'),
  readConfig: name => ipcRenderer.invoke('studio:read-config', name),
  saveConfig: (name, value) => ipcRenderer.invoke('studio:save-config', name, value),
  startBot: () => ipcRenderer.invoke('studio:start-bot'),
  stopBot: () => ipcRenderer.invoke('studio:stop-bot'),
  restartBot: () => ipcRenderer.invoke('studio:restart-bot'),
  setAutoStart: enabled => ipcRenderer.invoke('studio:set-auto-start', enabled),
  openDashboard: port => ipcRenderer.invoke('studio:open-dashboard', port),
  openDataFolder: () => ipcRenderer.invoke('studio:open-data-folder'),
  onStatus: callback => ipcRenderer.on('bot-status', (_, payload) => callback(payload)),
  onLog: callback => ipcRenderer.on('bot-log', (_, payload) => callback(payload)),
  onBotEvent: callback => ipcRenderer.on('bot-event', (_, payload) => callback(payload))
});