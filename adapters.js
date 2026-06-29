// adapters.js
// Multi-Brokerage Agent Exporter
// Drop-in replacement for the original KW-only adapters.js
// Supports: KW, Berkshire Hathaway, Coldwell Banker, ReMax, Century 21,
//           Compass, ERA, EXP, HomeSmart, Better Homes & Gardens, Realty ONE

const ADAPTERS = {

  // ─────────────────────────────────────────────────────────────
  // KELLER WILLIAMS
  // ─────────────────────────────────────────────────────────────
  kw: {
    id: 'kw',
    label: 'Keller Williams (KW)',
    searchUrl: ({ city, state, page = 1 }) =>
      `https://www.kw.com/agent/search?city=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}&page=${page}`,
    waitForSelector: '.agent-card, .agent-search-results',
    paginationType: 'page',       // 'page' | 'loadmore' | 'scroll'
    pageParam: 'page',
    parseAgents: (document) => {
      const agents = [];
      document.querySelectorAll('.agent-card').forEach(card => {
        agents.push({
          name:   card.querySelector('.agent-name')?.textContent?.trim() || '',
          phone:  card.querySelector('.agent-phone')?.textContent?.trim() || '',
          email:  card.querySelector('.agent-email')?.textContent?.trim() || '',
          office: card.querySelector('.agent-office')?.textContent?.trim() || '',
          brokerage: 'Keller Williams',
        });
      });
      return agents;
    },
    hasNextPage: (document) =>
      !!document.querySelector('[aria-label="Next page"], .pagination-next:not(.disabled)'),
  },

  // ─────────────────────────────────────────────────────────────
  // BERKSHIRE HATHAWAY HOME SERVICES
  // ─────────────────────────────────────────────────────────────
  berkshire: {
    id: 'berkshire',
    label: 'Berkshire Hathaway HomeServices',
    searchUrl: ({ city, state, page = 1 }) =>
      `https://www.bhhs.com/luxury-real-estate-agents/${state.toLowerCase()}/${city.toLowerCase().replace(/\s+/g, '-')}?pg=${page}`,
    waitForSelector: '.agent-card, .AgentCard, [data-test="agent-card"]',
    paginationType: 'page',
    pageParam: 'pg',
    parseAgents: (document) => {
      const agents = [];
      // BHHS uses multiple possible class names across regions
      const cards = document.querySelectorAll(
        '.agent-card, .AgentCard, [data-test="agent-card"], .agent-listing'
      );
      cards.forEach(card => {
        agents.push({
          name:   card.querySelector('.agent-name, .AgentCard__name, h3, h2')?.textContent?.trim() || '',
          phone:  card.querySelector('.agent-phone, [href^="tel:"]')?.textContent?.trim() || '',
          email:  card.querySelector('.agent-email, [href^="mailto:"]')?.textContent?.trim() || '',
          office: card.querySelector('.agent-office, .office-name')?.textContent?.trim() || '',
          brokerage: 'Berkshire Hathaway HomeServices',
        });
      });
      return agents;
    },
    hasNextPage: (document) =>
      !!document.querySelector('.pagination-next:not(.disabled), [rel="next"]'),
  },

  // ─────────────────────────────────────────────────────────────
  // COLDWELL BANKER
  // ─────────────────────────────────────────────────────────────
  coldwellbanker: {
    id: 'coldwellbanker',
    label: 'Coldwell Banker',
    searchUrl: ({ city, state, page = 1 }) =>
      `https://www.coldwellbanker.com/agents/${state.toLowerCase()}/${city.toLowerCase().replace(/\s+/g, '-')}?startIndex=${(page - 1) * 20}`,
    waitForSelector: '.agent-card, .CB-AgentCard, [data-testid="agent-card"]',
    paginationType: 'offset',
    pageSize: 20,
    parseAgents: (document) => {
      const agents = [];
      document.querySelectorAll(
        '.agent-card, .CB-AgentCard, [data-testid="agent-card"]'
      ).forEach(card => {
        agents.push({
          name:   card.querySelector('.agent-name, .CB-AgentCard__name')?.textContent?.trim() || '',
          phone:  card.querySelector('[href^="tel:"]')?.getAttribute('href')?.replace('tel:', '') || '',
          email:  card.querySelector('[href^="mailto:"]')?.getAttribute('href')?.replace('mailto:', '') || '',
          office: card.querySelector('.agent-office, .CB-AgentCard__office')?.textContent?.trim() || '',
          brokerage: 'Coldwell Banker',
        });
      });
      return agents;
    },
    hasNextPage: (document) =>
      !!document.querySelector('.pagination-next:not([disabled]), [aria-label="Next"]'),
  },

  // ─────────────────────────────────────────────────────────────
  // REMAX
  // ─────────────────────────────────────────────────────────────
  remax: {
    id: 'remax',
    label: 'RE/MAX',
    searchUrl: ({ city, state, page = 1 }) =>
      `https://www.remax.com/find-agents/results?city=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}&page=${page}`,
    waitForSelector: '.agent-card, [data-component="AgentCard"]',
    paginationType: 'page',
    pageParam: 'page',
    parseAgents: (document) => {
      const agents = [];
      document.querySelectorAll(
        '.agent-card, [data-component="AgentCard"], .agent-item'
      ).forEach(card => {
        agents.push({
          name:   card.querySelector('.agent-name, h2, h3')?.textContent?.trim() || '',
          phone:  card.querySelector('[href^="tel:"]')?.getAttribute('href')?.replace('tel:', '') || '',
          email:  card.querySelector('[href^="mailto:"]')?.getAttribute('href')?.replace('mailto:', '') || '',
          office: card.querySelector('.office-name, .agent-office')?.textContent?.trim() || '',
          brokerage: 'RE/MAX',
        });
      });
      return agents;
    },
    hasNextPage: (document) =>
      !!document.querySelector('[aria-label="Next page"]:not([disabled]), .pagination__next:not(.disabled)'),
  },

  // ─────────────────────────────────────────────────────────────
  // CENTURY 21
  // ─────────────────────────────────────────────────────────────
  century21: {
    id: 'century21',
    label: 'Century 21',
    searchUrl: ({ city, state, page = 1 }) =>
      `https://www.century21.com/real-estate-agents/${state.toLowerCase()}/${city.toLowerCase().replace(/\s+/g, '-')}/?pg=${page}`,
    waitForSelector: '.agent-card, .C21AgentCard',
    paginationType: 'page',
    pageParam: 'pg',
    parseAgents: (document) => {
      const agents = [];
      document.querySelectorAll('.agent-card, .C21AgentCard, [class*="AgentCard"]').forEach(card => {
        agents.push({
          name:   card.querySelector('.agent-name, h3')?.textContent?.trim() || '',
          phone:  card.querySelector('[href^="tel:"]')?.getAttribute('href')?.replace('tel:', '') || '',
          email:  card.querySelector('[href^="mailto:"]')?.getAttribute('href')?.replace('mailto:', '') || '',
          office: card.querySelector('.office-name')?.textContent?.trim() || '',
          brokerage: 'Century 21',
        });
      });
      return agents;
    },
    hasNextPage: (document) =>
      !!document.querySelector('.pagination-next, [rel="next"]:not(.disabled)'),
  },

  // ─────────────────────────────────────────────────────────────
  // COMPASS
  // ─────────────────────────────────────────────────────────────
  compass: {
    id: 'compass',
    label: 'Compass',
    searchUrl: ({ city, state, page = 1 }) =>
      `https://www.compass.com/agents/${state.toLowerCase()}/${city.toLowerCase().replace(/\s+/g, '-')}/?page=${page}`,
    waitForSelector: '[data-eid="agentCard"], .agent-card',
    paginationType: 'page',
    pageParam: 'page',
    parseAgents: (document) => {
      const agents = [];
      document.querySelectorAll('[data-eid="agentCard"], [class*="AgentCard"]').forEach(card => {
        agents.push({
          name:   card.querySelector('[data-eid="agentName"], h3, h2')?.textContent?.trim() || '',
          phone:  card.querySelector('[href^="tel:"]')?.getAttribute('href')?.replace('tel:', '') || '',
          email:  card.querySelector('[href^="mailto:"]')?.getAttribute('href')?.replace('mailto:', '') || '',
          office: card.querySelector('[data-eid="officeName"]')?.textContent?.trim() || '',
          brokerage: 'Compass',
        });
      });
      return agents;
    },
    hasNextPage: (document) =>
      !!document.querySelector('[aria-label="Next page"]:not([aria-disabled="true"])'),
  },

  // ─────────────────────────────────────────────────────────────
  // ERA REAL ESTATE
  // ─────────────────────────────────────────────────────────────
  era: {
    id: 'era',
    label: 'ERA Real Estate',
    searchUrl: ({ city, state, page = 1 }) =>
      `https://www.era.com/find-agents/${state.toLowerCase()}/${city.toLowerCase().replace(/\s+/g, '-')}?page=${page}`,
    waitForSelector: '.agent-card, .ERA-AgentCard',
    paginationType: 'page',
    pageParam: 'page',
    parseAgents: (document) => {
      const agents = [];
      document.querySelectorAll('.agent-card, .ERA-AgentCard, [class*="agent-card"]').forEach(card => {
        agents.push({
          name:   card.querySelector('.agent-name, h3')?.textContent?.trim() || '',
          phone:  card.querySelector('[href^="tel:"]')?.getAttribute('href')?.replace('tel:', '') || '',
          email:  card.querySelector('[href^="mailto:"]')?.getAttribute('href')?.replace('mailto:', '') || '',
          office: card.querySelector('.office-name')?.textContent?.trim() || '',
          brokerage: 'ERA Real Estate',
        });
      });
      return agents;
    },
    hasNextPage: (document) =>
      !!document.querySelector('.pagination-next:not(.disabled), [rel="next"]'),
  },

  // ─────────────────────────────────────────────────────────────
  // EXP REALTY  (big with investors/fix & flip)
  // ─────────────────────────────────────────────────────────────
  exp: {
    id: 'exp',
    label: 'eXp Realty',
    searchUrl: ({ city, state, page = 1 }) =>
      `https://exprealty.com/agents/?city=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}&pg=${page}`,
    waitForSelector: '.agent-card, [class*="AgentCard"]',
    paginationType: 'page',
    pageParam: 'pg',
    parseAgents: (document) => {
      const agents = [];
      document.querySelectorAll('.agent-card, [class*="AgentCard"], .agent-item').forEach(card => {
        agents.push({
          name:   card.querySelector('.agent-name, h2, h3')?.textContent?.trim() || '',
          phone:  card.querySelector('[href^="tel:"]')?.getAttribute('href')?.replace('tel:', '') || '',
          email:  card.querySelector('[href^="mailto:"]')?.getAttribute('href')?.replace('mailto:', '') || '',
          office: card.querySelector('.office-name')?.textContent?.trim() || '',
          brokerage: 'eXp Realty',
        });
      });
      return agents;
    },
    hasNextPage: (document) =>
      !!document.querySelector('.pagination-next:not(.disabled)'),
  },

  // ─────────────────────────────────────────────────────────────
  // HOMESMART  (active in investor/fix-flip markets)
  // ─────────────────────────────────────────────────────────────
  homesmart: {
    id: 'homesmart',
    label: 'HomeSmart',
    searchUrl: ({ city, state, page = 1 }) =>
      `https://www.homesmart.com/find-an-agent/?city=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}&page=${page}`,
    waitForSelector: '.agent-card, .hs-agent-card',
    paginationType: 'page',
    pageParam: 'page',
    parseAgents: (document) => {
      const agents = [];
      document.querySelectorAll('.agent-card, .hs-agent-card, [class*="agent"]').forEach(card => {
        agents.push({
          name:   card.querySelector('.agent-name, h3')?.textContent?.trim() || '',
          phone:  card.querySelector('[href^="tel:"]')?.getAttribute('href')?.replace('tel:', '') || '',
          email:  card.querySelector('[href^="mailto:"]')?.getAttribute('href')?.replace('mailto:', '') || '',
          office: card.querySelector('.office-name, .agent-office')?.textContent?.trim() || '',
          brokerage: 'HomeSmart',
        });
      });
      return agents;
    },
    hasNextPage: (document) =>
      !!document.querySelector('.pagination-next, [rel="next"]'),
  },

  // ─────────────────────────────────────────────────────────────
  // BETTER HOMES & GARDENS REAL ESTATE
  // ─────────────────────────────────────────────────────────────
  bhg: {
    id: 'bhg',
    label: 'Better Homes & Gardens Real Estate',
    searchUrl: ({ city, state, page = 1 }) =>
      `https://www.bhgrealestate.com/agents/${state.toLowerCase()}/${city.toLowerCase().replace(/\s+/g, '-')}?page=${page}`,
    waitForSelector: '.agent-card, [class*="AgentCard"]',
    paginationType: 'page',
    pageParam: 'page',
    parseAgents: (document) => {
      const agents = [];
      document.querySelectorAll('.agent-card, [class*="AgentCard"]').forEach(card => {
        agents.push({
          name:   card.querySelector('.agent-name, h2, h3')?.textContent?.trim() || '',
          phone:  card.querySelector('[href^="tel:"]')?.getAttribute('href')?.replace('tel:', '') || '',
          email:  card.querySelector('[href^="mailto:"]')?.getAttribute('href')?.replace('mailto:', '') || '',
          office: card.querySelector('.office-name')?.textContent?.trim() || '',
          brokerage: 'Better Homes & Gardens Real Estate',
        });
      });
      return agents;
    },
    hasNextPage: (document) =>
      !!document.querySelector('.pagination-next:not(.disabled)'),
  },

  // ─────────────────────────────────────────────────────────────
  // REALTY ONE GROUP  (strong in investor markets, SW / TX)
  // ─────────────────────────────────────────────────────────────
  realtyone: {
    id: 'realtyone',
    label: 'Realty ONE Group',
    searchUrl: ({ city, state, page = 1 }) =>
      `https://www.realtyonegroup.com/find-an-agent/?city=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}&page=${page}`,
    waitForSelector: '.agent-card, [class*="agent"]',
    paginationType: 'page',
    pageParam: 'page',
    parseAgents: (document) => {
      const agents = [];
      document.querySelectorAll('.agent-card, [class*="agent-card"]').forEach(card => {
        agents.push({
          name:   card.querySelector('.agent-name, h3')?.textContent?.trim() || '',
          phone:  card.querySelector('[href^="tel:"]')?.getAttribute('href')?.replace('tel:', '') || '',
          email:  card.querySelector('[href^="mailto:"]')?.getAttribute('href')?.replace('mailto:', '') || '',
          office: card.querySelector('.office-name')?.textContent?.trim() || '',
          brokerage: 'Realty ONE Group',
        });
      });
      return agents;
    },
    hasNextPage: (document) =>
      !!document.querySelector('.pagination-next:not(.disabled)'),
  },

};

// ─────────────────────────────────────────────────────────────
// Export helpers
// ─────────────────────────────────────────────────────────────

/**
 * Returns array of all adapter definitions for populating the UI dropdown.
 */
function getAdapterList() {
  return Object.values(ADAPTERS).map(a => ({ id: a.id, label: a.label }));
}

/**
 * Returns a single adapter by ID, or null if not found.
 */
function getAdapter(id) {
  return ADAPTERS[id] || null;
}

// Node/Electron export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ADAPTERS, getAdapterList, getAdapter };
}
