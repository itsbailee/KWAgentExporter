const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { Anthropic } = require('@anthropic-ai/sdk');
const ScraperEngine = require('./scraper-engine');

const GRAPHQL_URL = 'https://graph.prod.consumer.kw.com/';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

// ---------------------------------------------------------------------------
// Single-instance: kill old process, register this PID
// ---------------------------------------------------------------------------
const PID_FILE = () => path.join(app.getPath('userData'), 'app.pid');
function takeSingleInstanceLock() {
  try {
    const old = parseInt(fs.readFileSync(PID_FILE(), 'utf8'), 10);
    if (old && old !== process.pid) {
      try { process.kill(old, 'SIGTERM'); } catch (_) {}
    }
  } catch (_) {}
  try { fs.writeFileSync(PID_FILE(), String(process.pid), 'utf8'); } catch (_) {}
}

// ---------------------------------------------------------------------------
// Persistent geocode cache
// ---------------------------------------------------------------------------
let geocodeCache = {};
let geocacheDirty = false;
const geocachePath = () => path.join(app.getPath('userData'), 'geocode-cache.json');
function loadGeocodeCache() {
  try { geocodeCache = JSON.parse(fs.readFileSync(geocachePath(), 'utf8')); } catch (_) {}
}
function saveGeocodeCache() {
  if (!geocacheDirty) return;
  try { fs.writeFileSync(geocachePath(), JSON.stringify(geocodeCache), 'utf8'); geocacheDirty = false; } catch (_) {}
}

// ---------------------------------------------------------------------------
// App bootstrap
// ---------------------------------------------------------------------------
let mainWindow = null;
let running = false;
let currentRows = [];
let orgCache = null;
let orgCachePromise = null;
let scraperEngine = null;

// ---------------------------------------------------------------------------
// Settings (API key etc.)
// ---------------------------------------------------------------------------
let settings = {};
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try { settings = JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch (_) {}
}
function saveSettings() {
  try { fs.writeFileSync(settingsPath(), JSON.stringify(settings), 'utf8'); } catch (_) {}
}

app.setName('KW Agent CSV Exporter');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 760,
    minHeight: 540,
    title: 'KW Agent CSV Exporter',
    backgroundColor: '#ffffff',
    icon: path.join(__dirname, 'assets', 'AppIcon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile('index.html');
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  takeSingleInstanceLock();
  loadGeocodeCache();
  loadSettings();
  if (app.dock) app.dock.setIcon(path.join(__dirname, 'assets', 'AppIcon.png'));
  createWindow();
  loadAllOrgs().catch(() => {}); // warm org cache in background
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!mainWindow) createWindow(); });

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function emit(channel, value) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, value);
}
function log(line) { emit('scrape:log', line); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function cleanText(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }

function titleCaseName(value) {
  const particles = new Set(['da','de','del','der','di','du','la','las','le','los','van','von']);
  return cleanText(value).toLowerCase().split(' ').map((part, i) => {
    if (!part) return '';
    if (i > 0 && particles.has(part)) return part;
    return part.split('-').map((c) => c.split("'").map((p) => p ? p[0].toUpperCase() + p.slice(1) : '').join("'")).join('-');
  }).join(' ');
}

function normalizePhone(value) {
  const raw = cleanText(value).replace(/^tel:/i, '');
  if (raw.includes('@')) return '';
  const digits = raw.replace(/\D/g, '');
  const national = digits.length >= 11 && digits[0] === '1' ? digits.slice(-10) : digits;
  if (national.length === 10) return `(${national.slice(0,3)}) ${national.slice(3,6)}-${national.slice(6)}`;
  if (digits.length > 10) { const t = digits.slice(-10); return `(${t.slice(0,3)}) ${t.slice(3,6)}-${t.slice(6)}`; }
  return raw;
}

function csvEscape(value) { return `"${String(value || '').replace(/"/g, '""')}"`; }

function toCsv(rows) {
  const header = ['Full Name', 'Brokerage', 'Phone Number'];
  const body = rows.map((r) => [r.name, r.brokerage, r.phone].map(csvEscape).join(','));
  return [header.map(csvEscape).join(','), ...body].join('\n');
}

function addRows(nextRows) {
  const seen = new Set(currentRows.map((r) => `${r.name}|${r.phone}`.toLowerCase()));
  nextRows.forEach((row) => {
    const name = titleCaseName(row.name);
    const phone = normalizePhone(row.phone);
    if (!name || !phone) return;
    const key = `${name}|${phone}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    currentRows.push({ name, brokerage: cleanText(row.brokerage), phone });
  });
  emit('scrape:rows', currentRows.slice());
}

// ---------------------------------------------------------------------------
// GraphQL
// ---------------------------------------------------------------------------
function graphqlPost(query, variables, operationName, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify({ operationName, query, variables }));
    const req = https.request(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': body.length,
        'apollographql-client-name': 'Brightspot CMS Client',
        'apollographql-client-version': 'CMOB/v1.0.0/b0.0.0',
        'user-agent': UA
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (payload.errors?.length) return reject(new Error(payload.errors.map((e) => e.message).join('; ')));
          resolve(payload.data);
        } catch (err) { reject(err); }
      });
    });
    const timer = setTimeout(() => { req.destroy(new Error('Request timed out')); }, timeoutMs);
    req.on('error', (err) => { clearTimeout(timer); reject(err); });
    req.on('close', () => clearTimeout(timer));
    req.write(body);
    req.end();
  });
}

const GQL_SEARCH_AGENTS = `
query SearchForAgents($filters: AgentSearchFilters, $first: Float, $after: Float) {
  agents(filters: $filters, first: $first, after: $after) {
    totalCount
    searchAgents {
      fullName firstName lastName mobilePhone
      marketCenter { name dbaName }
    }
  }
}`;

const GQL_SEARCH_ORGS = `
query Organizations($filters: OrgSearchFilters, $first: Float, $after: Float) {
  organizations(filters: $filters, first: $first, after: $after) {
    organizations { id name dbaName address city state country }
  }
}`;

async function loadAllOrgs() {
  if (orgCache) return orgCache;
  if (orgCachePromise) return orgCachePromise;
  orgCachePromise = (async () => {
    log('Loading KW market centers...');
    const all = [];
    for (let after = 0; after < 20000; after += 1000) {
      const data = await graphqlPost(GQL_SEARCH_ORGS, { filters: { orgType: ['marketCenter'] }, first: 1000, after }, 'Organizations');
      const page = data?.organizations?.organizations || [];
      all.push(...page);
      if (page.length < 1000) break;
    }
    log(`Loaded ${all.length} market centers`);
    orgCache = all;
    return all;
  })();
  return orgCachePromise;
}

async function fetchAgentsViaGraphQL(orgId, fallbackBrokerage) {
  const rows = [];
  const seen = new Set();
  let total = null;
  for (let after = 0; after < 10000; after += 200) {
    let data;
    try {
      data = await graphqlPost(GQL_SEARCH_AGENTS, { filters: { orgId }, first: 200, after }, 'SearchForAgents');
    } catch (err) {
      log(`  API error at offset ${after}: ${err.message}`);
      break;
    }
    const agents = data?.agents?.searchAgents || [];
    if (total === null) total = data?.agents?.totalCount || 0;
    for (const agent of agents) {
      const name = titleCaseName(
        agent.fullName || [agent.firstName, agent.lastName].map(cleanText).filter(Boolean).join(' ')
      );
      const phone = normalizePhone(agent.mobilePhone || '');
      const brokerage = cleanText(agent.marketCenter?.dbaName) || cleanText(agent.marketCenter?.name) || fallbackBrokerage;
      if (!name || !phone) continue;
      const key = `${name}|${phone}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ name, brokerage, phone });
    }
    if (!agents.length || (total > 0 && after + agents.length >= total)) break;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Geocoding + radius search
// ---------------------------------------------------------------------------
let lastGeocodeMs = 0;
async function geocodeQuery(query) {
  const key = query.toLowerCase().trim();
  if (Object.prototype.hasOwnProperty.call(geocodeCache, key)) return geocodeCache[key];
  const wait = 1150 - (Date.now() - lastGeocodeMs);
  if (wait > 0) await sleep(wait);
  lastGeocodeMs = Date.now();
  return new Promise((resolve) => {
    const qs = new URLSearchParams({ q: `${query}, USA`, format: 'json', limit: '1', addressdetails: '1' }).toString();
    const req = https.get(
      { hostname: 'nominatim.openstreetmap.org', path: `/search?${qs}`, headers: { 'User-Agent': 'KWAgentCSVExporter/1.0 (christian.nold@gmail.com)' } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          clearTimeout(timer);
          try {
            const results = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (!results.length) { geocodeCache[key] = null; geocacheDirty = true; return resolve(null); }
            const r = results[0];
            const stateCode = (r.address?.['ISO3166-2-lvl4'] || '').split('-')[1] || '';
            const result = { lat: parseFloat(r.lat), lng: parseFloat(r.lon), stateCode };
            geocodeCache[key] = result; geocacheDirty = true; resolve(result);
          } catch (_) { resolve(null); }
        });
      }
    );
    const timer = setTimeout(() => { req.destroy(); resolve(null); }, 10000);
    req.on('error', () => { clearTimeout(timer); resolve(null); });
  });
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function orgCityState(org) {
  const city = cleanText(org.city);
  const state = cleanText(org.state);
  return city && state ? `${city}, ${state}` : null;
}

async function geocodeBatch(queries) {
  const BATCH = 3;
  const results = new Array(queries.length).fill(null);
  for (let i = 0; i < queries.length; i += BATCH) {
    const slice = queries.slice(i, i + BATCH);
    const settled = await Promise.all(slice.map((q) => geocodeQuery(q)));
    settled.forEach((r, j) => { results[i + j] = r; });
    if (i + BATCH < queries.length) await sleep(1200);
  }
  return results;
}

async function findOrgsByRadius(searchQuery, allOrgs, radiusMiles) {
  emit('scrape:status', `Locating ${searchQuery}...`);

  const queryNorm = searchQuery.toLowerCase().trim();
  const exactOrgs = allOrgs.filter((o) => {
    const cs = orgCityState(o);
    return cs && cs.toLowerCase() === queryNorm && cleanText(o.country) === 'US';
  });

  const searchCoords = await geocodeQuery(searchQuery);

  if (!searchCoords) {
    if (exactOrgs.length) {
      log(`Geocoding failed for "${searchQuery}" — using exact KW city match (${exactOrgs.length} office${exactOrgs.length === 1 ? '' : 's'})`);
      return { orgs: exactOrgs };
    }
    return { error: `Could not locate "${searchQuery}" — try including the state, e.g. "Tampa, FL"` };
  }

  log(`Searching within ${radiusMiles} mi of ${searchQuery} (${searchCoords.lat.toFixed(3)}, ${searchCoords.lng.toFixed(3)})`);

  const candidates = searchCoords.stateCode
    ? allOrgs.filter((o) => cleanText(o.state) === searchCoords.stateCode && cleanText(o.country) === 'US')
    : allOrgs.filter((o) => cleanText(o.country) === 'US');

  const cityGroups = {};
  for (const org of candidates) {
    const cs = orgCityState(org);
    if (!cs) continue;
    if (!cityGroups[cs]) cityGroups[cs] = [];
    cityGroups[cs].push(org);
  }

  const cities = Object.keys(cityGroups);
  const uncached = cities.filter((cs) => !Object.prototype.hasOwnProperty.call(geocodeCache, cs.toLowerCase().trim()));
  if (uncached.length > 0) {
    emit('scrape:status', `Locating nearby offices... (${uncached.length} new cities)`);
    log(`Geocoding ${uncached.length} new cities...`);
    await geocodeBatch(uncached);
    saveGeocodeCache();
  }

  const seen = new Set(exactOrgs.map((o) => o.id));
  const matching = [...exactOrgs];
  for (const cs of cities) {
    if (!running) break;
    const coords = geocodeCache[cs.toLowerCase().trim()];
    if (!coords) continue;
    const dist = haversine(searchCoords.lat, searchCoords.lng, coords.lat, coords.lng);
    if (dist <= radiusMiles) {
      const names = cityGroups[cs].map((o) => cleanText(o.dbaName) || cleanText(o.name)).join(', ');
      log(`  ✓ ${cs} — ${Math.round(dist)} mi — ${names}`);
      for (const o of cityGroups[cs]) {
        if (!seen.has(o.id)) { seen.add(o.id); matching.push(o); }
      }
    }
  }
  return { orgs: matching };
}

// ---------------------------------------------------------------------------
// City scrape
// ---------------------------------------------------------------------------
async function scrapeByCity(cityQuery, radiusMiles) {
  currentRows = [];
  emit('scrape:rows', currentRows);
  log(`City search: "${cityQuery}" — ${radiusMiles} mi radius`);

  let allOrgs;
  try {
    allOrgs = await loadAllOrgs();
  } catch (err) {
    log(`Failed to load offices: ${err.message}`);
    emit('scrape:done', { error: err.message });
    running = false;
    return;
  }

  const { orgs: matchingOrgs, error } = await findOrgsByRadius(cityQuery, allOrgs, radiusMiles);

  if (error) {
    log(error);
    emit('scrape:status', error);
    emit('scrape:done', { total: 0 });
    running = false;
    return;
  }

  if (!matchingOrgs.length) {
    log(`No KW offices found within ${radiusMiles} miles of "${cityQuery}"`);
    emit('scrape:status', `No offices found within ${radiusMiles} mi`);
    emit('scrape:done', { total: 0 });
    running = false;
    return;
  }

  log(`Found ${matchingOrgs.length} office${matchingOrgs.length === 1 ? '' : 's'} — pulling agents...`);

  for (let i = 0; running && i < matchingOrgs.length; i++) {
    const org = matchingOrgs[i];
    const brokerage = cleanText(org.dbaName) || cleanText(org.name);
    emit('scrape:status', `Fetching ${brokerage} (${i + 1}/${matchingOrgs.length})...`);
    log(`${brokerage}`);
    try {
      const gqlRows = await fetchAgentsViaGraphQL(Number(org.id), brokerage);
      addRows(gqlRows);
      log(`  → ${gqlRows.length} agents`);
    } catch (err) {
      log(`  → error: ${err.message}`);
    }
    if (running && i < matchingOrgs.length - 1) await sleep(300);
  }

  emit('scrape:status', `Done — ${currentRows.length} agents`);
  emit('scrape:done', { total: currentRows.length });
  running = false;
}

// ---------------------------------------------------------------------------
// AI URL scraping
// ---------------------------------------------------------------------------
function resolveUrl(href, base) {
  try { return new URL(href, base).href; } catch (_) { return null; }
}

// Extract compact page data (text + links) — much cheaper than sending full HTML to Claude
const EXTRACT_PAGE_DATA = `(() => {
  const clone = document.body ? document.body.cloneNode(true) : document.createElement('div');
  clone.querySelectorAll('script,style,svg,noscript,iframe,header,footer,nav').forEach(el => el.remove());
  const text = (clone.innerText || clone.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 10000);
  const links = [...document.querySelectorAll('a[href]')]
    .filter(a => a.href && !/^(javascript|mailto|tel):/.test(a.href))
    .map(a => ({ href: a.href, text: a.textContent.trim().replace(/\\s+/g, ' ').slice(0, 80) }))
    .filter(l => l.text)
    .slice(0, 300);
  return { text, links, url: window.location.href };
})()`;

// Compact page snapshot for Claude analysis (first page only)
const GET_LISTING_DATA = `(() => {
  const c = document.body ? document.body.cloneNode(true) : document.createElement('div');
  c.querySelectorAll('script,style,svg,noscript,iframe').forEach(e => e.remove());
  const text = (c.innerText || c.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 10000);
  const links = [...document.querySelectorAll('a[href]')]
    .filter(a => a.href && !/^(javascript|mailto|tel):/.test(a.href))
    .map(a => ({ href: a.href, text: a.textContent.trim().replace(/\\s+/g, ' ').slice(0, 80) }))
    .filter(l => l.text).slice(0, 100);
  return { text, links, url: window.location.href };
})()`;

// Full visible text from an individual agent page
const GET_PAGE_TEXT = `(() => {
  const c = document.body ? document.body.cloneNode(true) : document.createElement('div');
  c.querySelectorAll('script,style,svg,noscript,iframe').forEach(e => e.remove());
  return (c.innerText || c.textContent || '').replace(/\\s+/g, ' ').trim();
})()`;

// Extract agent cards directly from the DOM — works at every scroll position
// Used for listing pages that show phones inline (direct mode)
const EXTRACT_CARDS = `(() => {
  const phoneRe = /\\(?\\d{3}\\)?[\\s\\.\\-]\\d{3}[\\s\\.\\-]\\d{4}/;
  const seen = new Set();
  const results = [];
  const cards = document.querySelectorAll(
    'li, article, tr, [class*="member"], [class*="agent"], [class*="card"], [class*="item"], [class*="result"], [class*="profile"], [class*="listing"]'
  );
  for (const card of cards) {
    const text = (card.innerText || card.textContent || '').trim();
    if (!text || text.length > 1000 || text.length < 5) continue;
    const pm = text.match(phoneRe);
    if (!pm) continue;
    const phone = pm[0];
    if (seen.has(phone)) continue;
    seen.add(phone);
    let name = '';
    const nameEl = card.querySelector('h1,h2,h3,h4,h5,strong,b,[class*="name"],[class*="title"]');
    if (nameEl) {
      const t = (nameEl.innerText || nameEl.textContent || '').trim();
      if (!t.includes('@')) name = t;
    }
    if (!name) {
      const lines = text.split('\\n').map(l => l.trim())
        .filter(l => l.length >= 3 && l.length <= 55 && !phoneRe.test(l)
          && !l.includes('@')
          && !/^(cell|phone|mobile|office|fax|email|www\\.|http|license)/i.test(l));
      name = lines[0] || '';
    }
    if (name) results.push({ name: name.slice(0, 60), phone });
  }
  return results;
})()`;

// Snapshot of all hrefs visible right now — used to collect links incrementally
const SNAPSHOT_LINKS = `[...document.querySelectorAll('a[href]')]
  .filter(a => a.href && !/^(javascript|mailto|tel):/.test(a.href))
  .map(a => ({href: a.href, text: (a.textContent||'').trim().replace(/\\s+/g,' ').slice(0,80)}))
  .filter(l => l.text)`;

// One scroll step: scroll all containers + click any "load more" button
async function scrollStep(scraperEngine) {
  await scraperEngine.extract(`(() => {
    window.scrollTo(0, 999999);
    document.documentElement.scrollTop = 999999;
    [...document.querySelectorAll('*')].forEach(el => {
      try {
        const s = getComputedStyle(el);
        if ((s.overflow + s.overflowY).match(/scroll|auto/) && el.scrollHeight > el.clientHeight + 50)
          el.scrollTop = el.scrollHeight;
      } catch(_) {}
    });
    const btn = [...document.querySelectorAll('button,a,[role=button]')]
      .filter(e => e.offsetParent !== null)
      .find(e => /load\\s*more|show\\s*more|view\\s*more|more\\s*results|see\\s*all/i.test(e.textContent.trim()));
    if (btn) btn.click();
  })()`);
  await sleep(1300);
}

// Find the "next page" URL from current page
async function findNextPageUrl(scraperEngine) {
  return scraperEngine.extract(`(() => {
    const a = document.querySelector('a[rel="next"]');
    if (a?.href && !a.href.startsWith('javascript')) return a.href;
    for (const sel of ['a.next','a.page-next','[class*="next"] a','[aria-label*="next" i]']) {
      const el = document.querySelector(sel);
      if (el?.href && !el.href.startsWith('javascript') && el.offsetParent) return el.href;
    }
    const nextLink = [...document.querySelectorAll('a')]
      .find(a => /^(next|›|>|→|>>)$/i.test(a.textContent.trim()) &&
                 a.href && !a.href.startsWith('javascript') && a.offsetParent);
    return nextLink?.href || null;
  })()`);
}

// Derive a person's name from a URL slug like /agents/amanda-delcampo/
function nameFromSlug(url) {
  try {
    const slug = new URL(url).pathname.replace(/\/$/, '').split('/').pop() || '';
    const words = slug.split('-').filter(w => w.length >= 2);
    if (words.length < 2 || words.length > 5) return '';
    return words.map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  } catch (_) { return ''; }
}

// Find all valid phone numbers in text
function findPhones(text) {
  const matches = [...text.matchAll(/\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/g)].map(m => m[0]);
  return [...new Set(matches.map(normalizePhone))].filter(p => p.replace(/\D/g, '').length === 10);
}

// Derive a common URL path prefix from a set of URLs (e.g. "/members/directory/")
function commonPathPrefix(urls) {
  if (!urls.length) return '';
  const paths = urls.map(u => { try { return new URL(u).pathname.split('/').filter(Boolean); } catch(_) { return []; } });
  const min = Math.min(...paths.map(p => p.length));
  let prefix = '';
  for (let i = 0; i < min; i++) {
    if (paths.every(p => p[i] === paths[0][i])) prefix += '/' + paths[0][i];
    else break;
  }
  return prefix ? prefix + '/' : '';
}

async function scrapeUrlWithAI(url, apiKey) {
  if (!scraperEngine) scraperEngine = new ScraperEngine();
  const client = new Anthropic({ apiKey });
  const startCount = currentRows.length;

  // --- 1. Load page + quick Claude analysis to determine mode ---
  log(`Loading ${url}...`);
  emit('scrape:status', 'Loading page...');
  try {
    await scraperEngine.loadUrl(url, 2500);
  } catch (err) {
    log(`Failed: ${err.message}`);
    emit('scrape:done', { error: err.message });
    running = false;
    return;
  }

  const firstPage = await scraperEngine.extract(GET_LISTING_DATA);
  const pageUrl   = firstPage.url || url;
  const brokerage = (() => { try { return new URL(pageUrl).hostname.replace(/^www\./, ''); } catch (_) { return url; } })();

  log('Analyzing with AI...');
  emit('scrape:status', 'Analyzing page structure...');

  let analysis;
  try {
    const linkSample = firstPage.links.map(l => `${l.href} → ${l.text}`).join('\n');
    const res = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Real estate directory. Goal: collect agent names + phone numbers.
URL: ${pageUrl}
JSON only, no explanation.

If agent names AND phones are both visible in the listing (even just a few visible now):
{"mode":"direct"}

If phones only appear on individual agent profile pages (need to click each agent):
{"mode":"links","urlPattern":"/path/segment/"}
(urlPattern = the common URL path shared by all agent profile links, e.g. "/members/directory/")

If nothing useful: {"mode":"none"}

PAGE TEXT: ${firstPage.text}
LINKS SAMPLE: ${linkSample}`
      }]
    });
    const match = res.content[0].text.trim().match(/\{[\s\S]*\}/);
    analysis = JSON.parse(match[0]);
  } catch (err) {
    log(`AI failed: ${err.message}`);
    emit('scrape:done', { error: err.message });
    running = false;
    return;
  }

  // --- 2a. DIRECT MODE: phones visible on listing — scroll + extract cards incrementally ---
  if (analysis.mode === 'direct') {
    log('Direct mode — extracting agents while scrolling...');
    emit('scrape:status', 'Extracting agents...');
    let noNewRounds = 0;

    for (let s = 0; s < 80 && running; s++) {
      const cards = await scraperEngine.extract(EXTRACT_CARDS);
      const newRows = (cards || []).map(c => ({
        name: titleCaseName(c.name), phone: normalizePhone(c.phone), brokerage
      })).filter(r => r.name && r.phone.replace(/\D/g, '').length === 10);

      const before = currentRows.length;
      if (newRows.length) addRows(newRows);
      const added = currentRows.length - before;

      if (added > 0) {
        noNewRounds = 0;
        emit('scrape:status', `${currentRows.length} agents found...`);
      } else {
        if (++noNewRounds >= 4) break;
      }

      await scrollStep(scraperEngine);

      // Also follow pagination if present
      const nextUrl = await findNextPageUrl(scraperEngine);
      const curUrl  = await scraperEngine.extract('window.location.href');
      if (nextUrl && nextUrl !== curUrl) {
        log(`Pagination → ${nextUrl}`);
        try { await scraperEngine.loadUrl(nextUrl, 2000); noNewRounds = 0; } catch(_) {}
      }
    }

    log(`Direct extraction complete: ${currentRows.length} agents`);

  // --- 2b. LINKS MODE: phones on individual pages — collect all links then visit each ---
  } else if (analysis.mode === 'links') {
    const pattern = (analysis.urlPattern || '').trim();
    log(`Links mode — collecting all agent URLs (pattern: "${pattern || 'auto'}")...`);
    emit('scrape:status', 'Collecting agent links...');

    // Collect links incrementally at each scroll position (handles virtual scroll)
    const allLinksSeen = new Map();
    let noNewLinkRounds = 0;
    let pageNum = 0;

    while (running && pageNum < 40) {
      pageNum++;

      for (let s = 0; s < 40 && running; s++) {
        const snapshot = await scraperEngine.extract(SNAPSHOT_LINKS);
        let newCount = 0;
        for (const l of (snapshot || [])) {
          const matches = pattern
            ? ((() => { try { return new URL(l.href).pathname.startsWith(pattern); } catch(_) { return false; } })())
            : true;
          if (matches && !allLinksSeen.has(l.href)) { allLinksSeen.set(l.href, l.text); newCount++; }
        }
        if (newCount === 0) { if (++noNewLinkRounds >= 3) break; } else { noNewLinkRounds = 0; }
        await scrollStep(scraperEngine);
      }

      log(`Page ${pageNum}: ${allLinksSeen.size} links collected`);
      const nextUrl = await findNextPageUrl(scraperEngine);
      const curUrl  = await scraperEngine.extract('window.location.href');
      if (!nextUrl || nextUrl === curUrl) break;
      log(`Pagination → ${nextUrl}`);
      try { await scraperEngine.loadUrl(nextUrl, 2000); noNewLinkRounds = 0; } catch(_) { break; }
    }

    // If pattern given, filter; otherwise let Claude's sample + URL matching do it
    let agentLinks = [...allLinksSeen.keys()];
    if (!pattern) {
      // Ask Claude to identify the pattern from all collected links
      try {
        const sample = agentLinks.slice(0, 80).join('\n');
        const r = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 128,
          messages: [{ role: 'user', content: `From these URLs, what is the common path prefix for individual agent/member profile pages? Return JSON: {"pattern":"/members/directory/"} or {"pattern":""} if unclear.\n${sample}` }]
        });
        const m = r.content[0].text.trim().match(/\{[\s\S]*\}/);
        if (m) {
          const p = JSON.parse(m[0]).pattern || '';
          if (p) {
            agentLinks = agentLinks.filter(href => { try { return new URL(href).pathname.startsWith(p); } catch(_) { return false; } });
            log(`Pattern "${p}" — filtered to ${agentLinks.length} agent links`);
          }
        }
      } catch(_) {}
    }

    log(`Visiting ${agentLinks.length} agent pages...`);
    let aiCalls = 0;

    for (let i = 0; running && i < agentLinks.length; i++) {
      const link = agentLinks[i];
      emit('scrape:status', `Agent ${i + 1} of ${agentLinks.length}...`);

      try {
        await scraperEngine.loadUrl(link, 1500);
        const name     = titleCaseName(nameFromSlug(link));
        const pageText = (await scraperEngine.extract(GET_PAGE_TEXT)).slice(0, 8000);
        const phones   = findPhones(pageText);

        let phone = '';
        let usedAI = false;

        if (phones.length === 1) {
          phone = phones[0];
        } else if (phones.length > 1) {
          usedAI = true; aiCalls++;
          const r = await client.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 64,
            messages: [{ role: 'user', content: `Agent: ${name || 'unknown'}. Phones on page: ${phones.join(', ')}. Which is their direct number? JSON: {"phone":"..."}` }]
          });
          const d = JSON.parse(r.content[0].text.trim().match(/\{[\s\S]*\}/)[0]);
          phone = normalizePhone(d.phone || '');
          if (phone.replace(/\D/g, '').length !== 10) phone = phones[0];
        } else {
          usedAI = true; aiCalls++;
          const r = await client.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 64,
            messages: [{ role: 'user', content: `Find the phone number on this real estate agent page. JSON: {"phone":"727-555-1234"} or {"phone":""}.\n\n${pageText.slice(0, 3000)}` }]
          });
          const m = r.content[0].text.trim().match(/\{[\s\S]*\}/);
          if (m) { const p = normalizePhone(JSON.parse(m[0]).phone || ''); if (p.replace(/\D/g, '').length === 10) phone = p; }
        }

        if (name && phone) {
          addRows([{ name, phone, brokerage }]);
          log(`  ${name}: ${phone}${usedAI ? ' (AI)' : ''}`);
        } else {
          log(`  No phone — ${link}`);
        }
      } catch (err) {
        log(`  Error: ${err.message}`);
      }

      if (running && i < agentLinks.length - 1) await sleep(400);
    }

    log(`Done. AI used for ${aiCalls}/${agentLinks.length} agent pages.`);

  } else {
    log('No agents found on this page');
  }

  const found = currentRows.length - startCount;
  emit('scrape:status', `${found} found — ${currentRows.length} total`);
  emit('scrape:done', { total: currentRows.length, found });
  running = false;
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------
ipcMain.handle('orgs:cities', async () => {
  try {
    const orgs = await loadAllOrgs();
    const cities = [...new Set(
      orgs
        .filter((o) => o.city && o.state && cleanText(o.country) === 'US')
        .map((o) => `${cleanText(o.city)}, ${cleanText(o.state)}`)
    )].sort();
    return cities;
  } catch (_) {
    return [];
  }
});

ipcMain.handle('scrape:start-city', async (_event, cityQuery, radiusMiles) => {
  if (running) return { ok: false, error: 'Already running' };
  const query = cleanText(cityQuery);
  if (!query) return { ok: false, error: 'Enter a city name.' };
  const radius = Number(radiusMiles) > 0 ? Number(radiusMiles) : 30;
  running = true;
  scrapeByCity(query, radius).catch((err) => {
    log(err.stack || err.message);
    emit('scrape:done', { error: err.message });
    running = false;
  });
  return { ok: true };
});

ipcMain.handle('scrape:stop', async () => {
  running = false;
  emit('scrape:done', { stopped: true, total: currentRows.length });
  return { ok: true };
});

ipcMain.handle('csv:download', async (_event, rows) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save KW agents CSV',
    defaultPath: `kw-agents-${Date.now()}.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  });
  if (canceled || !filePath) return { ok: false };
  fs.writeFileSync(filePath, toCsv(rows), 'utf8');
  return { ok: true, filePath };
});

// ---------------------------------------------------------------------------
// Area code → state lookup
// ---------------------------------------------------------------------------
const AREA_CODE_STATE = {
  '205':'AL','251':'AL','256':'AL','334':'AL','938':'AL',
  '907':'AK',
  '480':'AZ','520':'AZ','602':'AZ','623':'AZ','928':'AZ',
  '479':'AR','501':'AR','870':'AR',
  '209':'CA','213':'CA','310':'CA','323':'CA','341':'CA','408':'CA','415':'CA','424':'CA','442':'CA','510':'CA','530':'CA','559':'CA','562':'CA','619':'CA','626':'CA','628':'CA','650':'CA','657':'CA','661':'CA','669':'CA','707':'CA','714':'CA','747':'CA','760':'CA','805':'CA','818':'CA','820':'CA','831':'CA','858':'CA','909':'CA','916':'CA','925':'CA','949':'CA','951':'CA',
  '303':'CO','719':'CO','720':'CO','970':'CO',
  '203':'CT','475':'CT','860':'CT','959':'CT',
  '302':'DE',
  '239':'FL','305':'FL','321':'FL','352':'FL','386':'FL','407':'FL','561':'FL','727':'FL','754':'FL','772':'FL','786':'FL','813':'FL','850':'FL','863':'FL','904':'FL','941':'FL','954':'FL',
  '229':'GA','404':'GA','470':'GA','478':'GA','678':'GA','706':'GA','762':'GA','770':'GA','912':'GA',
  '808':'HI',
  '208':'ID','986':'ID',
  '217':'IL','224':'IL','309':'IL','312':'IL','331':'IL','447':'IL','464':'IL','618':'IL','630':'IL','708':'IL','773':'IL','779':'IL','815':'IL','847':'IL','872':'IL',
  '219':'IN','260':'IN','317':'IN','463':'IN','574':'IN','765':'IN','812':'IN','930':'IN',
  '319':'IA','515':'IA','563':'IA','641':'IA','712':'IA',
  '316':'KS','620':'KS','785':'KS','913':'KS',
  '270':'KY','364':'KY','502':'KY','606':'KY','859':'KY',
  '225':'LA','318':'LA','337':'LA','504':'LA','985':'LA',
  '207':'ME',
  '240':'MD','301':'MD','410':'MD','443':'MD','667':'MD',
  '339':'MA','351':'MA','413':'MA','508':'MA','617':'MA','774':'MA','781':'MA','857':'MA','978':'MA',
  '231':'MI','248':'MI','269':'MI','313':'MI','517':'MI','586':'MI','616':'MI','734':'MI','810':'MI','906':'MI','947':'MI','989':'MI',
  '218':'MN','320':'MN','507':'MN','612':'MN','651':'MN','763':'MN','952':'MN',
  '228':'MS','601':'MS','662':'MS','769':'MS',
  '314':'MO','417':'MO','573':'MO','636':'MO','660':'MO','816':'MO',
  '406':'MT',
  '308':'NE','402':'NE','531':'NE',
  '702':'NV','725':'NV','775':'NV',
  '603':'NH',
  '201':'NJ','551':'NJ','609':'NJ','640':'NJ','732':'NJ','848':'NJ','856':'NJ','862':'NJ','908':'NJ','973':'NJ',
  '505':'NM','575':'NM',
  '212':'NY','315':'NY','332':'NY','347':'NY','516':'NY','518':'NY','585':'NY','607':'NY','631':'NY','646':'NY','680':'NY','716':'NY','718':'NY','838':'NY','845':'NY','914':'NY','917':'NY','929':'NY','934':'NY',
  '252':'NC','336':'NC','704':'NC','743':'NC','828':'NC','910':'NC','919':'NC','980':'NC','984':'NC',
  '701':'ND',
  '216':'OH','220':'OH','234':'OH','330':'OH','380':'OH','419':'OH','440':'OH','513':'OH','567':'OH','614':'OH','740':'OH','937':'OH',
  '405':'OK','539':'OK','580':'OK','918':'OK',
  '458':'OR','503':'OR','541':'OR','971':'OR',
  '215':'PA','223':'PA','267':'PA','272':'PA','412':'PA','445':'PA','484':'PA','570':'PA','610':'PA','717':'PA','724':'PA','814':'PA','878':'PA',
  '401':'RI',
  '803':'SC','839':'SC','843':'SC','854':'SC','864':'SC',
  '605':'SD',
  '423':'TN','615':'TN','629':'TN','731':'TN','865':'TN','901':'TN','931':'TN',
  '210':'TX','214':'TX','254':'TX','281':'TX','325':'TX','346':'TX','361':'TX','409':'TX','430':'TX','432':'TX','469':'TX','512':'TX','682':'TX','713':'TX','726':'TX','737':'TX','806':'TX','817':'TX','830':'TX','832':'TX','903':'TX','915':'TX','936':'TX','940':'TX','956':'TX','972':'TX','979':'TX',
  '385':'UT','435':'UT','801':'UT',
  '802':'VT',
  '202':'DC',
  '276':'VA','434':'VA','540':'VA','571':'VA','703':'VA','757':'VA','804':'VA',
  '206':'WA','253':'WA','360':'WA','425':'WA','509':'WA','564':'WA',
  '304':'WV','681':'WV',
  '262':'WI','414':'WI','534':'WI','608':'WI','715':'WI','920':'WI',
  '307':'WY',
};

async function scrapeByAreaCodes(areaCodes) {
  currentRows = [];
  emit('scrape:rows', currentRows);

  const codeSet = new Set(areaCodes);
  const states = [...new Set(areaCodes.map((c) => AREA_CODE_STATE[c]).filter(Boolean))];

  if (!states.length) {
    log(`No known US states for area codes: ${areaCodes.join(', ')}`);
    emit('scrape:status', 'Unknown area codes');
    emit('scrape:done', { total: 0 });
    running = false;
    return;
  }

  log(`Area code search: ${areaCodes.join(', ')} — scanning states: ${states.join(', ')}`);

  let allOrgs;
  try {
    allOrgs = await loadAllOrgs();
  } catch (err) {
    log(`Failed to load offices: ${err.message}`);
    emit('scrape:done', { error: err.message });
    running = false;
    return;
  }

  const matchingOrgs = allOrgs.filter(
    (o) => states.includes(cleanText(o.state)) && cleanText(o.country) === 'US'
  );

  if (!matchingOrgs.length) {
    log(`No KW offices found in target states`);
    emit('scrape:status', 'No offices found');
    emit('scrape:done', { total: 0 });
    running = false;
    return;
  }

  log(`Found ${matchingOrgs.length} offices — pulling agents with area codes ${areaCodes.join('/')}...`);

  for (let i = 0; running && i < matchingOrgs.length; i++) {
    const org = matchingOrgs[i];
    const brokerage = cleanText(org.dbaName) || cleanText(org.name);
    emit('scrape:status', `Fetching ${brokerage} (${i + 1}/${matchingOrgs.length})...`);
    log(`${brokerage}`);
    try {
      const gqlRows = await fetchAgentsViaGraphQL(Number(org.id), brokerage);
      const filtered = gqlRows.filter((r) => {
        const digits = r.phone.replace(/\D/g, '');
        return codeSet.has(digits.slice(0, 3));
      });
      if (filtered.length) addRows(filtered);
      log(`  → ${filtered.length}/${gqlRows.length} agents match`);
    } catch (err) {
      log(`  → error: ${err.message}`);
    }
    if (running && i < matchingOrgs.length - 1) await sleep(300);
  }

  emit('scrape:status', `Done — ${currentRows.length} agents`);
  emit('scrape:done', { total: currentRows.length });
  running = false;
}

ipcMain.handle('scrape:start-areacode', async (_event, areaCodes) => {
  if (running) return { ok: false, error: 'Already running' };
  if (!areaCodes || !areaCodes.length) return { ok: false, error: 'No area codes provided.' };
  running = true;
  scrapeByAreaCodes(areaCodes).catch((err) => {
    log(err.stack || err.message);
    emit('scrape:done', { error: err.message });
    running = false;
  });
  return { ok: true };
});

ipcMain.handle('settings:apikey-get', () => settings.anthropicApiKey || '');

ipcMain.handle('settings:apikey-set', (_e, key) => {
  settings.anthropicApiKey = key.trim();
  saveSettings();
  return { ok: true };
});

ipcMain.handle('scrape:url', async (_event, url) => {
  if (running) return { ok: false, error: 'Already running' };
  const apiKey = settings.anthropicApiKey;
  if (!apiKey) return { ok: false, error: 'NO_API_KEY' };
  const cleanUrl = cleanText(url);
  if (!cleanUrl) return { ok: false, error: 'Enter a URL.' };
  running = true;
  scrapeUrlWithAI(cleanUrl, apiKey).catch((err) => {
    log(err.stack || err.message);
    emit('scrape:done', { error: err.message });
    running = false;
  });
  return { ok: true };
});

// ---------------------------------------------------------------------------
// State scrape
// ---------------------------------------------------------------------------
const STATE_CODES = {
  'alabama':'AL','alaska':'AK','arizona':'AZ','arkansas':'AR','california':'CA',
  'colorado':'CO','connecticut':'CT','delaware':'DE','florida':'FL','georgia':'GA',
  'hawaii':'HI','idaho':'ID','illinois':'IL','indiana':'IN','iowa':'IA','kansas':'KS',
  'kentucky':'KY','louisiana':'LA','maine':'ME','maryland':'MD','massachusetts':'MA',
  'michigan':'MI','minnesota':'MN','mississippi':'MS','missouri':'MO','montana':'MT',
  'nebraska':'NE','nevada':'NV','new hampshire':'NH','new jersey':'NJ','new mexico':'NM',
  'new york':'NY','north carolina':'NC','north dakota':'ND','ohio':'OH','oklahoma':'OK',
  'oregon':'OR','pennsylvania':'PA','rhode island':'RI','south carolina':'SC',
  'south dakota':'SD','tennessee':'TN','texas':'TX','utah':'UT','vermont':'VT',
  'virginia':'VA','washington':'WA','west virginia':'WV','wisconsin':'WI','wyoming':'WY'
};

function resolveStateCode(input) {
  const s = input.trim();
  if (s.length === 2) return s.toUpperCase();
  return STATE_CODES[s.toLowerCase()] || null;
}

async function scrapeByState(stateInput) {
  currentRows = [];
  emit('scrape:rows', currentRows);

  const stateCode = resolveStateCode(stateInput);
  if (!stateCode) {
    log(`Unknown state: "${stateInput}"`);
    emit('scrape:status', `Unknown state: "${stateInput}"`);
    emit('scrape:done', { total: 0 });
    running = false;
    return;
  }

  log(`State search: ${stateCode}`);

  let allOrgs;
  try {
    allOrgs = await loadAllOrgs();
  } catch (err) {
    log(`Failed to load offices: ${err.message}`);
    emit('scrape:done', { error: err.message });
    running = false;
    return;
  }

  const matchingOrgs = allOrgs.filter(
    (o) => cleanText(o.state) === stateCode && cleanText(o.country) === 'US'
  );

  if (!matchingOrgs.length) {
    log(`No KW offices found in ${stateCode}`);
    emit('scrape:status', `No offices found in ${stateCode}`);
    emit('scrape:done', { total: 0 });
    running = false;
    return;
  }

  log(`Found ${matchingOrgs.length} offices in ${stateCode} — pulling agents...`);

  for (let i = 0; running && i < matchingOrgs.length; i++) {
    const org = matchingOrgs[i];
    const brokerage = cleanText(org.dbaName) || cleanText(org.name);
    emit('scrape:status', `Fetching ${brokerage} (${i + 1}/${matchingOrgs.length})...`);
    log(`${brokerage}`);
    try {
      const gqlRows = await fetchAgentsViaGraphQL(Number(org.id), brokerage);
      addRows(gqlRows);
      log(`  → ${gqlRows.length} agents`);
    } catch (err) {
      log(`  → error: ${err.message}`);
    }
    if (running && i < matchingOrgs.length - 1) await sleep(300);
  }

  emit('scrape:status', `Done — ${currentRows.length} agents`);
  emit('scrape:done', { total: currentRows.length });
  running = false;
}

ipcMain.handle('scrape:start-state', async (_event, stateInput) => {
  if (running) return { ok: false, error: 'Already running' };
  const input = cleanText(stateInput);
  if (!input) return { ok: false, error: 'Select a state.' };
  running = true;
  scrapeByState(input).catch((err) => {
    log(err.stack || err.message);
    emit('scrape:done', { error: err.message });
    running = false;
  });
  return { ok: true };
});
