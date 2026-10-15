const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nonna', {
  onStart: (cb) => ipcRenderer.on('nonna:start', (_e, data) => cb(data)),
  onSwept: (cb) => ipcRenderer.on('nonna:swept', (_e, data) => cb(data)),
  sweep: (max) => ipcRenderer.send('nonna:sweep', max),
  finished: () => ipcRenderer.send('nonna:finished'),
  hover: (over) => ipcRenderer.send('nonna:hover', over),
});
