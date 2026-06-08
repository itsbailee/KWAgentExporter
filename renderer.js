/* global kwApp */

// ---------------------------------------------------------------------------
// State name → abbreviation for flexible input normalization
// ---------------------------------------------------------------------------
const STATE_MAP = {
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

function normalizeQuery(input) {
  let text = input.trim();
  // Replace full state name → abbreviation (longest match first to handle "new york" etc.)
  const names = Object.keys(STATE_MAP).sort((a, b) => b.length - a.length);
  for (const name of names) {
    const re = new RegExp(`(,?\\s+)${name}\\s*$`, 'i');
    if (re.test(text)) {
      text = text.replace(re, `, ${STATE_MAP[name]}`);
      break;
    }
  }
  // "Tampa FL" → "Tampa, FL"  (state abbr at end without comma)
  text = text.replace(/([a-z])\s+([A-Z]{2})\s*$/i, (_, c, st) => `${c}, ${st.toUpperCase()}`);
  // Capitalize first letter of each word before the comma
  const parts = text.split(',');
  parts[0] = parts[0].replace(/\b\w/g, (c) => c.toUpperCase());
  return parts.join(',').trim();
}

function matchCities(raw, cities) {
  if (!raw || !cities.length) return [];
  const query = normalizeQuery(raw).toLowerCase();
  const words = query.split(/[\s,]+/).filter(Boolean);
  if (!words.length) return [];

  const startsWith = [];
  const contains = [];

  for (const city of cities) {
    const lower = city.toLowerCase();
    const cityOnly = lower.split(',')[0].trim();
    const allMatch = words.every((w) => lower.includes(w));
    if (!allMatch) continue;
    if (cityOnly.startsWith(words[0])) startsWith.push(city);
    else contains.push(city);
  }

  return [...startsWith, ...contains].slice(0, 10);
}

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const cityInput      = document.getElementById('city');
const suggestionsEl  = document.getElementById('suggestions');
const radiusSelect   = document.getElementById('radius');
const areaFilterInput = document.getElementById('areaFilter');
const startButton    = document.getElementById('start');
const stopButton     = document.getElementById('stop');
const downloadButton = document.getElementById('download');
const clearButton    = document.getElementById('clear');
const statusText     = document.getElementById('statusText');
const countEl        = document.getElementById('count');
const tbody          = document.getElementById('rows');
const logEl          = document.getElementById('log');

let rows = [];
let cityList = [];
let activeIndex = -1;
let lastRenderedCount = 0;

// Load city list from main process (org list, already warming in background)
kwApp.getCities().then((list) => { cityList = list; }).catch(() => {});

// ---------------------------------------------------------------------------
// Autocomplete
// ---------------------------------------------------------------------------
function renderSuggestions(matches) {
  if (!matches.length) { suggestionsEl.style.display = 'none'; return; }
  activeIndex = -1;
  suggestionsEl.innerHTML = '';
  matches.forEach((city) => {
    const [cityName, stateAbbr] = city.split(', ');
    const item = document.createElement('div');
    item.className = 'suggestion-item';
    item.innerHTML = `<span class="city-name">${cityName}</span>${stateAbbr ? `<span class="state-badge">${stateAbbr}</span>` : ''}`;
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      cityInput.value = city;
      hideSuggestions();
    });
    suggestionsEl.appendChild(item);
  });
  suggestionsEl.style.display = 'block';
}

function hideSuggestions() {
  suggestionsEl.style.display = 'none';
  activeIndex = -1;
}

cityInput.addEventListener('input', () => {
  const val = cityInput.value;
  if (val.length < 1) { hideSuggestions(); return; }
  renderSuggestions(matchCities(val, cityList));
});

cityInput.addEventListener('keydown', (e) => {
  const items = suggestionsEl.querySelectorAll('.suggestion-item');
  if (!items.length) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIndex = Math.min(activeIndex + 1, items.length - 1);
    items.forEach((el, i) => el.classList.toggle('active', i === activeIndex));
    if (activeIndex >= 0) items[activeIndex].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIndex = Math.max(activeIndex - 1, 0);
    items.forEach((el, i) => el.classList.toggle('active', i === activeIndex));
    if (activeIndex >= 0) items[activeIndex].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter' && activeIndex >= 0) {
    e.preventDefault();
    cityInput.value = items[activeIndex].querySelector('.city-name').textContent +
      (items[activeIndex].querySelector('.state-badge') ? ', ' + items[activeIndex].querySelector('.state-badge').textContent : '');
    hideSuggestions();
  } else if (e.key === 'Escape') {
    hideSuggestions();
  }
});

cityInput.addEventListener('blur', () => setTimeout(hideSuggestions, 150));
cityInput.addEventListener('focus', () => {
  if (cityInput.value.length >= 1) renderSuggestions(matchCities(cityInput.value, cityList));
});

// ---------------------------------------------------------------------------
// Area code filter
// ---------------------------------------------------------------------------
function getAreaCodes() {
  const val = areaFilterInput.value.trim();
  if (!val) return [];
  return val.split(/[,\s]+/).map((s) => s.trim()).filter((s) => /^\d{3}$/.test(s));
}

function applyFilter(allRows) {
  const codes = getAreaCodes();
  if (!codes.length) return allRows;
  return allRows.filter((r) => {
    const digits = r.phone.replace(/\D/g, '');
    return codes.includes(digits.slice(0, 3));
  });
}

// ---------------------------------------------------------------------------
// Table render — append-only so scroll position never jumps
// ---------------------------------------------------------------------------
function makeRow(row) {
  const tr = document.createElement('tr');
  ['name', 'brokerage', 'phone'].forEach((key) => {
    const td = document.createElement('td');
    td.textContent = row[key] || '';
    td.title = row[key] || '';
    tr.appendChild(td);
  });
  return tr;
}

function render() {
  const visible = applyFilter(rows);
  const filtered = visible.length < rows.length;
  countEl.textContent = filtered
    ? `${visible.length} of ${rows.length} agent${rows.length === 1 ? '' : 's'}`
    : `${rows.length} agent${rows.length === 1 ? '' : 's'}`;
  downloadButton.disabled = visible.length === 0;
  clearButton.disabled = rows.length === 0;

  if (!rows.length) {
    tbody.innerHTML = '<tr class="empty"><td colspan="3">Search a city or paste a URL to start.</td></tr>';
    lastRenderedCount = 0;
    return;
  }
  if (!visible.length) {
    tbody.innerHTML = '<tr class="empty"><td colspan="3">No agents match those area codes.</td></tr>';
    lastRenderedCount = 0;
    return;
  }

  // Clear placeholder row if still present
  if (tbody.querySelector('.empty')) {
    tbody.innerHTML = '';
    lastRenderedCount = 0;
  }

  // Full re-render only when the visible set shrank (filter narrowed)
  if (visible.length < lastRenderedCount) {
    tbody.innerHTML = '';
    lastRenderedCount = 0;
  }

  // Append only the new rows — leaves scroll position untouched
  for (let i = lastRenderedCount; i < visible.length; i++) {
    tbody.appendChild(makeRow(visible[i]));
  }
  lastRenderedCount = visible.length;
}

function setRunning(isRunning) {
  startButton.disabled = isRunning;
  stopButton.disabled = !isRunning;
  cityInput.disabled = isRunning;
  radiusSelect.disabled = isRunning;
  areaFilterInput.disabled = isRunning;
}

function appendLog(line) {
  logEl.textContent = `${line}\n${logEl.textContent}`.slice(0, 8000);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
kwApp.removeListeners();
kwApp.onStatus((v) => { statusText.textContent = v; });
kwApp.onRows((next) => { rows = next; render(); });
kwApp.onLog(appendLog);
kwApp.onDone(({ stopped, error, found }) => {
  setRunning(false);
  if (error) statusText.textContent = `Error: ${error}`;
  else if (stopped) statusText.textContent = `Stopped — ${rows.length} total`;
  else if (found != null) statusText.textContent = `${found} found — ${rows.length} total`;
  else statusText.textContent = `Done — ${rows.length} total`;
});

startButton.addEventListener('click', async () => {
  const raw = cityInput.value.trim();
  const areaCodes = getAreaCodes();

  rows = [];
  logEl.textContent = '';
  render();
  setRunning(true);
  statusText.textContent = 'Starting...';
  hideSuggestions();

  let result;
  if (!raw && areaCodes.length) {
    result = await kwApp.startAreaCode(areaCodes);
  } else if (raw) {
    const city = normalizeQuery(raw);
    result = await kwApp.startCity(city, Number(radiusSelect.value));
  } else {
    setRunning(false);
    statusText.textContent = 'Enter a city or area codes.';
    return;
  }

  if (!result.ok) { setRunning(false); statusText.textContent = `Error: ${result.error}`; }
});

stopButton.addEventListener('click', () => kwApp.stop());

areaFilterInput.addEventListener('input', render);

downloadButton.addEventListener('click', async () => {
  const result = await kwApp.download(applyFilter(rows));
  if (result.ok) appendLog(`Saved: ${result.filePath}`);
});

clearButton.addEventListener('click', () => {
  rows = [];
  logEl.textContent = '';
  statusText.textContent = 'Idle';
  render();
});

render();

// ---------------------------------------------------------------------------
// URL / AI scrape section
// ---------------------------------------------------------------------------
const urlInput      = document.getElementById('urlInput');
const urlStartBtn   = document.getElementById('urlStart');
const apiKeySetup   = document.getElementById('apiKeySetup');
const apiKeyInput   = document.getElementById('apiKeyInput');
const apiKeySaveBtn = document.getElementById('apiKeySave');

kwApp.getApiKey().then((key) => {
  if (!key) apiKeySetup.style.display = 'flex';
});

apiKeySaveBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  if (!key) return;
  await kwApp.setApiKey(key);
  apiKeySetup.style.display = 'none';
  apiKeyInput.value = '';
  statusText.textContent = 'API key saved.';
});

urlStartBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  if (!url) { statusText.textContent = 'Enter a URL first.'; return; }
  logEl.textContent = '';
  setRunning(true);
  render();
  urlStartBtn.disabled = true;
  urlInput.disabled = true;
  statusText.textContent = 'Starting...';

  const result = await kwApp.scrapeUrl(url);
  if (!result.ok) {
    setRunning(false);
    urlStartBtn.disabled = false;
    urlInput.disabled = false;
    if (result.error === 'NO_API_KEY') {
      apiKeySetup.style.display = 'flex';
      statusText.textContent = 'Enter your Anthropic API key to use this feature.';
    } else {
      statusText.textContent = `Error: ${result.error}`;
    }
  }
});

// Re-enable URL inputs when a scrape finishes
kwApp.onDone(({ stopped, error }) => {
  urlStartBtn.disabled = false;
  urlInput.disabled = false;
});
