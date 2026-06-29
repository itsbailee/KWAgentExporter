// preload.js
// Runs in the isolated context of the main BrowserWindow.
// Exposes safe IPC methods to renderer.js via contextBridge.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Scrape a single page using the specified adapter.
   * @param {{ url: string, waitForSelector: string, adapterId: string }} opts
   * @returns {Promise<Array>} Array of agent objects
   */
  scrapePage: (opts) => ipcRenderer.invoke('scrape-page', opts),

  /**
   * Open a Save dialog and write CSV content to disk.
   * @param {string} csvContent
   * @returns {Promise<string|null>} Written file path, or null if cancelled
   */
  saveFile: (csvContent) => ipcRenderer.invoke('save-file', csvContent),
});
