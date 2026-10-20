// A2MAC1 — list the data domains (hierarchies) this plugin can read.
//
// Without flags this is a static table: no network, no browser, works offline.
// With --live it asks the platform (`get-part-hierarchies`, the same endpoint
// the IBP filter panel uses) and diffs the answer against the alias table, so
// id drift and newly published domains show up instead of failing later.
//
// status:
//   ready        verified end to end against the live platform
//   empty-root   hierarchy id resolves but the root level is empty — drill with
//                --parent <nodeId>
//   needs-recon  A2MAC1 ships this product but its hierarchyId was never captured
//   unaliased    (--live) the account can see it, the plugin has no short alias
//   unavailable  (--live) the plugin knows it, the account cannot see it
import { cli, Strategy } from '@jackwener/opencli/registry';
import { HOST, readCookie } from './lib/http.js';
import { fetchLiveHierarchies } from './lib/engine.js';
import { getCached, setCached } from './lib/cache.js';
import { listDomains, mergeLiveDomains } from './lib/registry.js';

const LIVE_TTL_MS = 24 * 60 * 60 * 1000;

cli({
  site: 'a2mac1',
  name: 'hierarchies',
  description: 'A2MAC1 — list readable data domains (hierarchy aliases) for --hierarchy',
  access: 'read',
  example: 'opencli a2mac1 hierarchies --live',
  domain: HOST,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'all', type: 'bool', default: false, help: 'Also list domains that are not ready yet' },
    { name: 'live', type: 'bool', default: false, help: 'Ask the platform for its real domain list and diff it against the table' },
  ],
  columns: ['alias', 'hierarchyId', 'label', 'status', 'summary'],
  func: async (page, args) => {
    if (!args.live) return listDomains({ all: Boolean(args.all) });

    const cacheKey = 'live-hierarchies';
    let live = getCached(cacheKey, LIVE_TTL_MS);
    if (!live) {
      const cookie = await readCookie(page);
      live = await fetchLiveHierarchies(cookie);
      if (live.length) setCached(cacheKey, live);
    }

    const rows = mergeLiveDomains(live);
    if (args.all) return rows;
    return rows.filter((r) => r.status === 'ready' || r.status === 'unaliased');
  },
});
