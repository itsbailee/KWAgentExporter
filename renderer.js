// renderer.js
// Handles all UI logic for Agent Exporter (multi-brokerage edition)

const { getAdapterList, getAdapter } = require('./adapters');

// ─── DOM refs ───────────────────────────────────────────────────
const brokerageSelect = document.getElementById('brokerageSelect');
const cityInput       = document.getElementById('cityInput');
const stateInput      = document.getElementById('stateInput');
const startPageInput  = document.getElementById('startPage');
const endPageInput    = document.getElementById('endPage');
const startBtn        = document.getElementById('startBtn');
const stopBtn         = document.getElementById('stopBtn');
const exportBtn       = document.getElementById('exportBtn');
const statusText      = document.getElementById('statusText');
const agentCountEl    = document.getElementById('agentCount');
const progressWrap    = document.getElementById('progressWrap');
const progressBar     = document.getElementById('progressBar');
const resultsBody     = document.getElementById('resultsBody');

// ─── State ──────────────────────────────────────────────────────
let allAgents = [];
let isScraping = false;

// ─── Populate brokerage dropdown ────────────────────────────────
function populateBrokerageDropdown() {
  brokerageSelect.innerHTML = '';
  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = '— Select a Brokerage —';
  brokerageSelect.appendChild(defaultOpt);

  getAdapterList().forEach(({ id, label }) => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = label;
    brokerageSelect.appendChild(opt);
  });
}

populateBrokerageDropdown();

// ─── Scraping control ────────────────────────────────────────────
startBtn.addEventListener('click', async () => {
  const adapterId = brokerageSelect.value;
  const city      = cityInput.value.trim();
  const state     = stateInput.value.trim().toUpperCase();
  const startPage = parseInt(startPageInput.value, 10);
  const endPage   = parseInt(endPageInput.value, 10);

  if (!adapterId) return setStatus('Please select a brokerage.', 'warn');
  if (!city)      return setStatus('Please enter a city.', 'warn');
  if (!state)     return setStatus('Please enter a state abbreviation.', 'warn');

  const adapter = getAdapter(adapterId);
  if (!adapter)   return setStatus('Unknown adapter — check adapters.js.', 'error');

  // Reset UI
  allAgents = [];
  resultsBody.innerHTML = '';
  isScraping = true;
  startBtn.disabled = true;
  stopBtn.disabled  = false;
  exportBtn.disabled = true;
  progressWrap.classList.remove('hidden');
  setStatus(`Scraping ${adapter.label} — ${city}, ${state}…`);

  const totalPages = endPage - startPage + 1;
  let scrapedPages = 0;

  for (let page = startPage; page <= endPage; page++) {
    if (!isScraping) break;

    const url = adapter.searchUrl({ city, state, page });
    setStatus(`Page ${page}/${endPage} — ${url}`);

    try {
      const pageAgents = await window.electronAPI.scrapePage({
        url,
        waitForSelector: adapter.waitForSelector,
        adapterId,
      });

      if (pageAgents && pageAgents.length > 0) {
        pageAgents.forEach(agent => addAgentRow(agent));
        allAgents.push(...pageAgents);
        agentCountEl.textContent = `${allAgents.length} agents`;
      } else {
        // No agents found — probably end of results
        setStatus(`No agents on page ${page}. Stopping early.`);
        break;
      }
    } catch (err) {
      console.error('Scrape error:', err);
      setStatus(`Error on page ${page}: ${err.message}`, 'error');
      break;
    }

    scrapedPages++;
    const pct = Math.round((scrapedPages / totalPages) * 100);
    progressBar.style.width = `${pct}%`;

    // Polite delay between pages (1–2 seconds)
    await sleep(1000 + Math.random() * 1000);
  }

  isScraping = false;
  startBtn.disabled  = false;
  stopBtn.disabled   = true;
  exportBtn.disabled = allAgents.length === 0;
  setStatus(`Done — ${allAgents.length} agents collected.`);
});

stopBtn.addEventListener('click', () => {
  isScraping = false;
  setStatus('Stopping after current page…');
});

// ─── Export CSV ──────────────────────────────────────────────────
exportBtn.addEventListener('click', async () => {
  if (!allAgents.length) return;

  const headers = ['Name', 'Phone', 'Email', 'Office', 'Brokerage'];
  const rows = allAgents.map(a => [
    csvEsc(a.name),
    csvEsc(a.phone),
    csvEsc(a.email),
    csvEsc(a.office),
    csvEsc(a.brokerage),
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

  try {
    const filePath = await window.electronAPI.saveFile(csv);
    if (filePath) setStatus(`Exported to ${filePath}`);
  } catch (err) {
    setStatus(`Export failed: ${err.message}`, 'error');
  }
});

// ─── Helpers ─────────────────────────────────────────────────────
function addAgentRow(agent) {
  const rowNum = allAgents.length + 1; // called before push
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${rowNum}</td>
    <td>${esc(agent.name)}</td>
    <td>${esc(agent.phone)}</td>
    <td>${esc(agent.email)}</td>
    <td>${esc(agent.office)}</td>
    <td>${esc(agent.brokerage)}</td>
  `;
  resultsBody.appendChild(tr);
}

function setStatus(msg, type = 'info') {
  statusText.textContent = msg;
  statusText.className = type;
}

function esc(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function csvEsc(str) {
  const s = (str || '').replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
