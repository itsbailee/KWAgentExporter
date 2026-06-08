const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kwApp', {
  getCities: () => ipcRenderer.invoke('orgs:cities'),
  startCity: (city, radius) => ipcRenderer.invoke('scrape:start-city', city, radius),
  startState: (state) => ipcRenderer.invoke('scrape:start-state', state),
  startAreaCode: (codes) => ipcRenderer.invoke('scrape:start-areacode', codes),
  scrapeUrl:    (url)   => ipcRenderer.invoke('scrape:url', url),
  getApiKey:    ()      => ipcRenderer.invoke('settings:apikey-get'),
  setApiKey:    (key)   => ipcRenderer.invoke('settings:apikey-set', key),
  stop: () => ipcRenderer.invoke('scrape:stop'),
  download: (rows) => ipcRenderer.invoke('csv:download', rows),
  onStatus: (cb) => ipcRenderer.on('scrape:status', (_e, v) => cb(v)),
  onRows: (cb) => ipcRenderer.on('scrape:rows', (_e, rows) => cb(rows)),
  onDone: (cb) => ipcRenderer.on('scrape:done', (_e, result) => cb(result)),
  onLog: (cb) => ipcRenderer.on('scrape:log', (_e, line) => cb(line)),
  removeListeners: () => {
    ['scrape:status', 'scrape:rows', 'scrape:done', 'scrape:log'].forEach((ch) => ipcRenderer.removeAllListeners(ch));
  }
});
