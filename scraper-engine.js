// scraper-engine.js
// Runs inside the hidden BrowserWindow (renderer context of the scraper window).
// Receives { adapterId } via scraper-preload.js, then parses agents using
// the matching adapter's parseAgents() function.

const { ADAPTERS } = require('./adapters');

/**
 * Called by main.js after the scraper window has navigated to the target URL
 * and the waitForSelector has resolved.
 *
 * @param {string} adapterId   - The adapter key (e.g. 'kw', 'remax')
 * @returns {Array}            - Array of agent objects
 */
function parseCurrentPage(adapterId) {
  const adapter = ADAPTERS[adapterId];
  if (!adapter) {
    console.error(`[scraper-engine] Unknown adapterId: "${adapterId}"`);
    return [];
  }

  try {
    return adapter.parseAgents(document);
  } catch (err) {
    console.error(`[scraper-engine] parseAgents error for "${adapterId}":`, err);
    return [];
  }
}

// Expose to the preload bridge
if (typeof window !== 'undefined') {
  window.__parseCurrentPage = parseCurrentPage;
}

module.exports = { parseCurrentPage };
