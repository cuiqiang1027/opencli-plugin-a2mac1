// A2MAC1 — list the data domains (hierarchies) this plugin can read.
//
// Static table, no network needed. Use it to discover the alias to pass as
// --hierarchy on tree / props / compare.
//
// status:
//   ready        verified end to end against the live platform
//   empty-root   hierarchy id resolves but the root level is empty — drill with
//                --parent <nodeId>
//   needs-recon  A2MAC1 ships this product but its hierarchyId was never captured
import { cli, Strategy } from '@jackwener/opencli/registry';
import { HOST } from './lib/http.js';
import { listDomains } from './lib/registry.js';

cli({
  site: 'a2mac1',
  name: 'hierarchies',
  description: 'A2MAC1 — list readable data domains (hierarchy aliases) for --hierarchy',
  access: 'read',
  example: 'opencli a2mac1 hierarchies --all',
  domain: HOST,
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'all', type: 'bool', default: false, help: 'Also list domains that are not ready yet' },
  ],
  columns: ['alias', 'hierarchyId', 'label', 'status', 'summary'],
  func: async (args) => listDomains({ all: Boolean(args.all) }),
});
