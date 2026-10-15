const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nonna', {
  onStart: (cb) => ipcRenderer.on('nonna:start', (_e, data) => cb(data)),
  onSwept: (cb) => ipcRenderer.on('nonna:swept', (_e, data) => cb(data)),
  sweep: (req) => ipcRenderer.send('nonna:sweep', req),
  finished: () => ipcRenderer.send('nonna:finished'),
  hover: (over) => ipcRenderer.send('nonna:hover', over),
  audio: (data) => ipcRenderer.send('nonna:audio', data),
});
