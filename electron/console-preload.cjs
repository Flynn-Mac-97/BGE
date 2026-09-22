const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  command: request => ipcRenderer.invoke('desktop:command', request)
})
