// main.js  (multi-brokerage edition)
// Key change: the 'scrape-page' IPC handler now accepts `adapterId`
// and passes it down to the scraper BrowserWindow so scraper-engine.js
// can call the right adapter's parseAgents().

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');

let mainWindow;
let scraperWindow;

// ─── Main window ─────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile('index.html');
}

// ─── Hidden scraper window ───────────────────────────────────────
function createScraperWindow() {
  if (scraperWindow && !scraperWindow.isDestroyed()) return scraperWindow;

  scraperWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'scraper-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Allow loading external brokerage websites
      webSecurity: true,
    },
  });

  scraperWindow.on('closed', () => { scraperWindow = null; });
  return scraperWindow;
}

// ─── IPC: scrape a single page ───────────────────────────────────
ipcMain.handle('scrape-page', async (event, { url, waitForSelector, adapterId }) => {
  const win = createScraperWindow();

  return new Promise((resolve, reject) => {
    // Timeout guard (30 s)
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for selector "${waitForSelector}" at ${url}`));
    }, 30000);

    win.webContents.once('did-finish-load', async () => {
      try {
        // Wait for the agent card selector to appear (up to 15 s)
        await win.webContents.executeJavaScript(`
          new Promise((res, rej) => {
            const sel = ${JSON.stringify(waitForSelector)};
            if (document.querySelector(sel)) return res();
            const obs = new MutationObserver(() => {
              if (document.querySelector(sel)) { obs.disconnect(); res(); }
            });
            obs.observe(document.body, { childList: true, subtree: true });
            setTimeout(() => { obs.disconnect(); res(); /* resolve anyway */ }, 15000);
          })
        `);

        // Ask the preload to run parseCurrentPage with the correct adapterId
        const agents = await win.webContents.executeJavaScript(
          `window.__scraper.parseCurrentPage(${JSON.stringify(adapterId)})`
        );

        clearTimeout(timeout);
        resolve(agents || []);
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
      }
    });

    win.loadURL(url);
  });
});

// ─── IPC: save CSV file ──────────────────────────────────────────
ipcMain.handle('save-file', async (event, csvContent) => {
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Agents CSV',
    defaultPath: `agents_${Date.now()}.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });

  if (canceled || !filePath) return null;

  fs.writeFileSync(filePath, csvContent, 'utf8');
  return filePath;
});

// ─── App lifecycle ───────────────────────────────────────────────
app.whenReady().then(createMainWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
