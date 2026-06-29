// scraper-preload.js
// Runs in the isolated context of the hidden scraper BrowserWindow.
// Exposes window.__scraper.parseCurrentPage() so main.js can call it
// via executeJavaScript().

const { contextBridge } = require('electron');
const { parseCurrentPage } = require('./scraper-engine');

contextBridge.exposeInMainWorld('__scraper', {
  parseCurrentPage,
});
