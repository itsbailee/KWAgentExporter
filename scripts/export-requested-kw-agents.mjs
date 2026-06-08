import fs from 'fs';
import path from 'path';

const GRAPHQL_URL = 'https://graph.prod.consumer.kw.com/';
const OUT_FILE = path.resolve('kw-requested-agents.csv');

const TARGETS = [
  {
    url: 'https://kwrgindiana.kw.com/our-agents',
    orgId: 6422,
    label: 'Keller Williams Realty Group',
    terms: ['realty group', 'fort wayne'],
    seedNames: ['Brittany Meza']
  },
  {
    url: 'https://kellerwilliamsrealtywest.kw.com/our-agents',
    label: 'Keller Williams Realty West',
    terms: ['realty west', 'williams realty west'],
    seedNames: ['Drake Ackley']
  },
  {
    url: 'https://chesterfield.kw.com/our-agents',
    label: 'Keller Williams Chesterfield',
    terms: ['chesterfield'],
    seedNames: ['Nash Abdulla']
  },
  {
    url: 'https://swkwstl.kw.com/our-leaders',
    label: 'Keller Williams Southwest',
    terms: ['southwest', 'st louis', 'st. louis'],
    seedNames: []
  },
  {
    url: 'https://kwsoin.kw.com/our-agents',
    label: 'Keller Williams Southern Indiana',
    terms: ['southern indiana', 'soin'],
    seedNames: ['Amanda Armstrong', 'Richie Andasol']
  },
  {
    url: 'https://experience-kw.kw.com/our-agents',
    label: 'Experience Keller Williams',
    terms: ['experience'],
    seedNames: ['Grace Alvaro']
  },
  {
    url: 'https://kwsoin.kw.com/',
    label: 'Keller Williams Southern Indiana',
    terms: ['southern indiana', 'soin'],
    seedNames: ['Amanda Armstrong', 'Richie Andasol']
  },
  {
    url: 'https://kwbluegrass.kw.com/our-agents',
    label: 'Keller Williams Bluegrass',
    terms: ['bluegrass', 'lexington'],
    seedNames: ['Zach Davis']
  },
  {
    url: 'https://swkwstl.kw.com/our-leaders',
    label: 'Keller Williams Southwest',
    terms: ['southwest', 'st louis', 'st. louis'],
    seedNames: []
  },
  {
    url: 'https://kwpinnacle.kw.com/our-agents',
    label: 'Keller Williams Pinnacle',
    terms: ['pinnacle'],
    seedNames: ['Anita Barga']
  },
  {
    url: 'https://kwmarquee.kw.com/our-agents',
    label: 'Keller Williams Marquee',
    terms: ['marquee'],
    seedNames: []
  },
  {
    url: 'https://consultantsrealty.kw.com/our-agents',
    label: 'Keller Williams Consultants Realty',
    terms: ['consultants realty', 'consultants'],
    seedNames: ['Abdallah Hijazi']
  },
  {
    url: 'https://grovecity.kw.com/our-leaders',
    label: 'Keller Williams Grove City',
    terms: ['grove city', 'greater columbus'],
    seedNames: ['Patrick Shinaberry']
  },
  {
    url: 'https://kwclassicpropertiesrealty.kw.com/our-agents',
    label: 'Keller Williams Classic Properties Realty',
    terms: ['classic properties', 'classic properties realty'],
    seedNames: ['Ana Belviso']
  },
  {
    url: 'https://experience-kw.kw.com/our-agents',
    label: 'Experience Keller Williams',
    terms: ['experience'],
    seedNames: ['Grace Alvaro']
  }
];

const AGENT_LIST_QUERY = `
query SearchForAgents($filters: AgentSearchFilters, $first: Float, $after: Float) {
  agents(filters: $filters, first: $first, after: $after) {
    totalCount
    searchAgents {
      id
      firstName
      lastName
      fullName
      email
      license
      mobilePhone
      marketCenter { name dbaName }
    }
  }
}`;

const AGENT_DETAIL_QUERY = `
query AgentOrganizations($agentId: ID!) {
  agent(id: $agentId) {
    id
    fullName
    email
    mobilePhone
    marketCenter { name dbaName }
    organizations {
      id
      name
      orgType
      dbaName
    }
  }
}`;

const ORGANIZATIONS_QUERY = `
query Organizations($filters: OrgSearchFilters, $first: Float, $after: Float) {
  organizations(filters: $filters, first: $first, after: $after) {
    organizations {
      location
      id
      name
      address
    }
  }
}`;

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalize(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function titleCaseName(value) {
  const particles = new Set(['da', 'de', 'del', 'der', 'di', 'du', 'la', 'las', 'le', 'los', 'van', 'von']);
  return clean(value).toLowerCase().split(' ').map((part, index) => {
    if (!part) return '';
    if (index > 0 && particles.has(part)) return part;
    return part.split('-').map((chunk) => (
      chunk.split("'").map((piece) => piece ? piece[0].toUpperCase() + piece.slice(1) : '').join("'")
    )).join('-');
  }).join(' ');
}

function normalizePhone(value) {
  const raw = clean(value).replace(/^tel:/i, '');
  const digits = raw.replace(/\D/g, '');
  const national = digits.length >= 11 && digits[0] === '1' ? digits.slice(-10) : digits;
  if (national.length === 10) {
    return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
  }
  if (digits.length > 10) {
    const lastTen = digits.slice(-10);
    return `(${lastTen.slice(0, 3)}) ${lastTen.slice(3, 6)}-${lastTen.slice(6)}`;
  }
  return raw;
}

function csvEscape(value) {
  return `"${String(value || '').replace(/"/g, '""')}"`;
}

function toCsv(rows) {
  const header = ['Full Name', 'Brokerage', 'Phone Number'];
  return [
    header.map(csvEscape).join(','),
    ...rows.map((row) => [row.name, row.brokerage, row.phone].map(csvEscape).join(','))
  ].join('\n');
}

async function graphql(query, variables = {}, operationName = undefined) {
  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'apollographql-client-name': 'Brightspot CMS Client',
      'apollographql-client-version': 'CMOB/v1.0.0/b0.0.0'
    },
    body: JSON.stringify({ operationName, query, variables })
  });
  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join('; '));
  }
  return payload.data;
}

function scoreOrganization(target, org) {
  const haystack = normalize(`${org.name || ''} ${org.dbaName || ''} ${org.address || ''}`);
  let score = 0;
  for (const term of target.terms || []) {
    const normalizedTerm = normalize(term);
    if (normalizedTerm && haystack.includes(normalizedTerm)) score += normalizedTerm.length;
  }
  return score;
}

async function getAgentDetail(agentId) {
  const data = await graphql(AGENT_DETAIL_QUERY, { agentId: String(agentId) }, 'AgentOrganizations');
  return data.agent;
}

async function findMarketCenterFromAgent(target, agent) {
  const detail = await getAgentDetail(agent.id);
  const marketCenters = (detail.organizations || []).filter((org) => org.orgType === 'marketCenter');
  const scored = marketCenters
    .map((org) => ({ org, score: scoreOrganization(target, org) }))
    .sort((a, b) => b.score - a.score);
  const chosen = scored[0]?.org || marketCenters[0];
  if (!chosen) return null;
  return {
    id: Number(chosen.id),
    name: clean(chosen.dbaName) || clean(chosen.name) || clean(detail.marketCenter?.dbaName) || clean(detail.marketCenter?.name)
  };
}

async function fetchMarketCenters() {
  const all = [];
  for (let after = 0; after < 20000; after += 1000) {
    const data = await graphql(
      ORGANIZATIONS_QUERY,
      { filters: { orgType: ['marketCenter'] }, first: 1000, after },
      'Organizations'
    );
    const page = data.organizations?.organizations || [];
    all.push(...page);
    if (page.length < 1000) break;
  }
  return all;
}

async function resolveFromOrganizationList(target, marketCenters) {
  const scored = marketCenters
    .map((org) => ({ org, score: scoreOrganization(target, org) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return null;
  const [first, second] = scored;
  if (first.score >= 8 && first.score > (second?.score || 0)) {
    return {
      id: Number(first.org.id),
      name: clean(first.org.name)
    };
  }
  return null;
}

async function resolveFromSeedNames(target) {
  const wanted = new Set((target.seedNames || []).map(normalize).filter(Boolean));
  if (!wanted.size) return null;

  for (let after = 0; after < 160000; after += 1000) {
    const data = await graphql(AGENT_LIST_QUERY, { filters: {}, first: 1000, after }, 'SearchForAgents');
    const agents = data.agents?.searchAgents || [];
    for (const agent of agents) {
      if (!wanted.has(normalize(agent.fullName))) continue;
      const resolved = await findMarketCenterFromAgent(target, agent);
      if (resolved) return resolved;
    }
    const total = data.agents?.totalCount || 0;
    if (!agents.length || after + agents.length >= total) break;
  }

  return null;
}

async function resolveTarget(target, marketCenters) {
  if (target.orgId) {
    return { id: Number(target.orgId), name: target.label };
  }
  return await resolveFromOrganizationList(target, marketCenters)
    || await resolveFromSeedNames(target);
}

async function fetchAgentsForOrg(target, org) {
  const rows = [];
  const seen = new Set();

  for (let after = 0; after < 10000; after += 200) {
    const data = await graphql(
      AGENT_LIST_QUERY,
      { filters: { orgId: org.id }, first: 200, after },
      'SearchForAgents'
    );
    const agents = data.agents?.searchAgents || [];
    for (const agent of agents) {
      const name = titleCaseName(agent.fullName || [agent.firstName, agent.lastName].map(clean).filter(Boolean).join(' '));
      const phone = normalizePhone(agent.mobilePhone);
      const brokerage = clean(agent.marketCenter?.dbaName) || clean(agent.marketCenter?.name) || clean(org.name) || target.label;
      if (!name || !phone) continue;
      const key = `${name}|${phone}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ name, brokerage, phone });
    }
    const total = data.agents?.totalCount || 0;
    if (!agents.length || after + agents.length >= total) break;
  }

  return rows;
}

function dedupeTargets(targets) {
  const byHost = new Map();
  for (const target of targets) {
    const parsed = new URL(target.url);
    const key = parsed.hostname.toLowerCase();
    if (!byHost.has(key)) byHost.set(key, target);
  }
  return [...byHost.values()];
}

async function main() {
  const targets = dedupeTargets(TARGETS);
  console.log(`Loading market centers...`);
  const marketCenters = await fetchMarketCenters();
  console.log(`Loaded ${marketCenters.length} market centers`);

  const allRows = [];
  const globalSeen = new Set();

  for (const target of targets) {
    const org = await resolveTarget(target, marketCenters);
    if (!org?.id) {
      console.log(`SKIP ${target.url}: could not resolve market center`);
      continue;
    }

    const rows = await fetchAgentsForOrg(target, org);
    for (const row of rows) {
      const key = `${row.name}|${row.phone}`.toLowerCase();
      if (globalSeen.has(key)) continue;
      globalSeen.add(key);
      allRows.push(row);
    }
    console.log(`${target.url} -> org ${org.id} (${org.name || target.label}): ${rows.length} rows`);
  }

  fs.writeFileSync(OUT_FILE, `${toCsv(allRows)}\n`, 'utf8');
  console.log(`Wrote ${allRows.length} rows to ${OUT_FILE}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
