// A2MAC1 — browse a hierarchy tree (default: Vehicle Occupant Packaging).
// Endpoint: POST https://ibp.a2mac1.com/api/hierarchies/<hierarchyId>
//   body: {} (root) or { parentNodeId: '<id>' } (drill-down)
//
// Preset over the shared tree implementation. The generic command is:
//   opencli a2mac1 tree --hierarchy vop --depth 3
import { cli, Strategy } from '@jackwener/opencli/registry';
import { HOST } from './lib/http.js';
import { runTree } from './lib/ops.js';

cli({
  site: 'a2mac1',
  name: 'vop-tree',
  description: 'A2MAC1 IBP — browse the Vehicle Occupant Packaging (or any) hierarchy tree',
  access: 'read',
  example: 'opencli a2mac1 vop-tree --parent 000000093NWAEU01',
  domain: HOST,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'hierarchy', type: 'string', default: 'vop', help: 'Hierarchy alias or ID (default = vop)' },
    { name: 'parent', type: 'string', default: '', help: 'Parent nodeId; empty = root level' },
    { name: 'depth', type: 'int', default: 1, help: 'Recursion depth (1..3); >1 expands children automatically' },
    { name: 'limit', type: 'int', default: 200, help: 'Max rows (1..1000)' },
    { name: 'lang', type: 'string', default: '', help: 'Accept-Language, e.g. en or zh-CN' },
  ],
  columns: ['level', 'name', 'nodeId', 'parentId', 'hasChildren'],
  func: (page, args) => runTree(page, args, {
    command: 'vop-tree',
    hierarchy: 'vop',
    maxDepth: 3,
  }),
});
