const { BrowserWindow } = require('electron');
const path = require('path');

class ScraperEngine {
  constructor() {
    this._win = null;
  }

  _ensureWindow() {
    if (this._win && !this._win.isDestroyed()) return;
    this._win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        preload: path.join(__dirname, 'scraper-preload.js'),
        contextIsolation: false,  // required so executeJavaScript can read window.__kwCapturedResponses
        nodeIntegration: false,
        javascript: true,
        webSecurity: true,
      }
    });
    this._win.webContents.setAudioMuted(true);
  }

  // Load a URL and wait waitMs after did-finish-load for JS frameworks to render.
  loadUrl(url, waitMs = 2000) {
    this._ensureWindow();
    return new Promise((resolve, reject) => {
      const hardTimer = setTimeout(() => resolve(), waitMs + 30000);

      const onFinish = () => {
        clearTimeout(hardTimer);
        setTimeout(resolve, waitMs);
      };

      const onFail = (_e, code, desc) => {
        clearTimeout(hardTimer);
        this._win.webContents.removeListener('did-finish-load', onFinish);
        // -3 = ERR_ABORTED (navigation cancelled by new navigation), treat as ok
        if (code === -3) { setTimeout(resolve, waitMs); return; }
        reject(new Error(`${desc} (${code})`));
      };

      this._win.webContents.once('did-finish-load', onFinish);
      this._win.webContents.once('did-fail-load', onFail);

      this._win.loadURL(url).catch((err) => {
        clearTimeout(hardTimer);
        this._win.webContents.removeListener('did-finish-load', onFinish);
        this._win.webContents.removeListener('did-fail-load', onFail);
        reject(err);
      });
    });
  }

  // Run a JS expression in the page context and return the result.
  async extract(script) {
    this._ensureWindow();
    try {
      return await this._win.webContents.executeJavaScript(script);
    } catch (err) {
      throw new Error(`Extract failed: ${err.message}`);
    }
  }

  destroy() {
    if (this._win && !this._win.isDestroyed()) {
      this._win.destroy();
    }
    this._win = null;
  }
}

module.exports = ScraperEngine;
