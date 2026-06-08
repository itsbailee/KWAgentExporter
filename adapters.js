// Brokerage adapter configs for the hidden-BrowserWindow scraper.
//
// Three types:
//   single-page   — load one URL, extract all agents from the DOM
//   follow-links  — load an index page, collect profile URLs, visit each for contact info
//   paginated     — increment a page param until a page returns 0 new agents

module.exports = [
  // ----------------------------------------------------------------
  // Meyer Lucas Real Estate
  // Team page shows names only; each /agents/[slug] has the phone.
  // ----------------------------------------------------------------
  {
    id: 'meyerlucas',
    name: 'Meyer Lucas Real Estate',
    brokerage: 'Meyer Lucas Real Estate',
    type: 'follow-links',
    indexUrl: 'https://meyerlucas.com/team',
    indexWaitMs: 2500,
    // Returns an array of absolute profile URLs
    extractLinks: `(() => {
      const links = new Set();
      document.querySelectorAll('a[href*="/agents/"]').forEach(a => {
        const m = a.href.match(/\\/agents\\/([^/?#]+)/);
        if (m && m[1]) links.add(a.href.split('?')[0].split('#')[0]);
      });
      return [...links];
    })()`,
    profileWaitMs: 2000,
    // Returns { name, phone } for a single profile page
    extractProfile: `(() => {
      const name = (document.querySelector('h1') || document.querySelector('h2'))?.innerText?.trim() || '';
      const tels = [...document.querySelectorAll('a[href^="tel:"]')];
      const phone = tels[0]?.href?.replace('tel:', '').trim() || '';
      return { name, phone };
    })()`,
  },

  // ----------------------------------------------------------------
  // Jupiter Lighthouse Realty
  // Static HTML — h3 names, tel: links in adjacent list items.
  // Office phone is shared (first tel:); cell is usually second.
  // ----------------------------------------------------------------
  {
    id: 'jupiterfl',
    name: 'Jupiter Lighthouse Realty',
    brokerage: 'Jupiter Lighthouse Realty',
    type: 'single-page',
    url: 'https://www.jupiterflrealestate.com/our-agents/',
    waitMs: 1500,
    extractAgents: `(() => {
      const agents = [];
      document.querySelectorAll('h3').forEach(h3 => {
        const name = h3.innerText.trim();
        if (!name || name.length < 3) return;
        // Walk up until we find a container that has tel: links
        let el = h3.parentElement;
        for (let i = 0; i < 7; i++) {
          if (!el) break;
          const tels = el.querySelectorAll('a[href^="tel:"]');
          if (tels.length > 0) {
            // Second tel: is usually the individual cell; first is shared office
            const phone = (tels[1] || tels[0]).href.replace('tel:', '').trim();
            if (phone) { agents.push({ name, phone }); break; }
          }
          el = el.parentElement;
        }
      });
      return agents;
    })()`,
  },

  // ----------------------------------------------------------------
  // Hughes Browne Group
  // Static HTML — heading elements for names, tel: links for phones.
  // ----------------------------------------------------------------
  {
    id: 'hughesbrowne',
    name: 'Hughes Browne Group',
    brokerage: 'Hughes Browne Group',
    type: 'single-page',
    url: 'https://hughesbrownegroup.com/team',
    waitMs: 2000,
    extractAgents: `(() => {
      const agents = [];
      const seen = new Set();
      document.querySelectorAll('a[href^="tel:"]').forEach(tel => {
        const phone = tel.href.replace('tel:', '').trim();
        if (!phone) return;
        // Walk up to find the nearest heading sibling/ancestor
        let el = tel.parentElement;
        for (let i = 0; i < 8; i++) {
          if (!el) break;
          const h = el.querySelector('h1, h2, h3, h4, h5');
          if (h) {
            const name = h.innerText.trim();
            const key = name + '|' + phone;
            if (name && !seen.has(key)) { seen.add(key); agents.push({ name, phone }); }
            return;
          }
          el = el.parentElement;
        }
      });
      return agents;
    })()`,
  },

  // ----------------------------------------------------------------
  // Engel & Völkers Jupiter
  // React-rendered, paginated via ?currentPage=N.
  // scraper-preload.js intercepts fetch/XHR — if the site loads agent
  // data from an internal API the captured JSON is checked first.
  // Falls back to DOM selectors if no API data is found.
  // ----------------------------------------------------------------
  {
    id: 'ev-jupiter',
    name: 'Engel & Völkers Jupiter',
    brokerage: 'Engel & Völkers Jupiter',
    type: 'paginated',
    urlFn: (page) => `https://jupiter.evrealestate.com/en/our-advisors?currentPage=${page}`,
    startPage: 1,
    waitMs: 4000,
    extractAgents: `(() => {
      // ── 1. Try captured API responses (React sites often fetch from /api/…) ──
      const captured = window.__kwCapturedResponses || {};
      for (const [url, body] of Object.entries(captured)) {
        const u = url.toLowerCase();
        if (!u.includes('advisor') && !u.includes('agent') && !u.includes('member')) continue;
        try {
          const d = JSON.parse(body);
          const items =
            d?.data?.advisors || d?.advisors ||
            d?.data?.agents   || d?.agents   ||
            d?.data?.members  || d?.members  ||
            d?.results || d?.items ||
            (Array.isArray(d) ? d : null);
          if (Array.isArray(items) && items.length > 0) {
            return items.map(item => ({
              name: [item.firstName, item.lastName].filter(Boolean).join(' ') ||
                    item.fullName || item.name || item.displayName || '',
              phone: item.mobilePhone || item.phone || item.cell || item.phoneNumber || ''
            })).filter(a => a.name);
          }
        } catch (_) {}
      }

      // ── 2. Class-based DOM selectors ──
      const agents = [];
      const seen = new Set();
      const add = (name, phone) => {
        const k = name + '|' + phone;
        if (name && name.length > 2 && !seen.has(k)) { seen.add(k); agents.push({ name, phone }); }
      };

      for (const sel of [
        '[class*="advisor"]', '[class*="Advisor"]',
        '[class*="agent-card"]', '[class*="AgentCard"]',
        '[class*="team-member"]', '[class*="TeamMember"]',
        '[class*="staff-card"]', '[class*="card"]',
      ]) {
        const cards = document.querySelectorAll(sel);
        if (cards.length < 2) continue;
        cards.forEach(card => {
          const nameEl = card.querySelector('h1, h2, h3, h4, h5, [class*="name"], [class*="Name"]');
          const name = nameEl?.innerText?.trim() || '';
          const tel = card.querySelector('a[href^="tel:"]');
          const phone = tel?.href?.replace('tel:', '').trim() || '';
          add(name, phone);
        });
        if (agents.length > 0) break;
      }

      // ── 3. Broadest fallback: walk up from every tel: link ──
      if (!agents.length) {
        document.querySelectorAll('a[href^="tel:"]').forEach(tel => {
          const phone = tel.href.replace('tel:', '').trim();
          let el = tel.parentElement;
          for (let i = 0; i < 8; i++) {
            if (!el) break;
            const h = el.querySelector('h1, h2, h3, h4, h5, strong');
            if (h) { add(h.innerText.trim(), phone); return; }
            el = el.parentElement;
          }
        });
      }

      return agents;
    })()`,
  },
];
