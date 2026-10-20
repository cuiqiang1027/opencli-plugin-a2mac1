// A2MAC1 — browse the 3D AutoReverse weight hierarchy.
// Endpoint: POST https://ibp.a2mac1.com/api/hierarchies/<hierarchyId>
//   body: {} (root) or { parentNodeId: '<id>' } (drill-down)
//
// Use this to find system / sub-system nodeIds before pulling weight data with
// `opencli a2mac1 weight` or `weight-compare`.
//
// The 3D AutoReverse hierarchy exposes ~22 vehicle-system categories at root
// (Body, Interior, Seats, Electrical, Suspension, …), each with sub-systems.
//
//   opencli a2mac1 weight-tree                              # all root systems
//   opencli a2mac1 weight-tree --parent 00000004QH72EU01     # Body sub-systems
//   opencli a2mac1 weight-tree --depth 2                     # auto-expand one level
//
// Preset over the shared tree implementation; `opencli a2mac1 tree --hierarchy weight`
// is the same command.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { HOST } from './lib/http.js';
import { runTree } from './lib/ops.js';

cli({
  site: 'a2mac1',
  name: 'weight-tree',
  description: 'A2MAC1 — browse the 3D AutoReverse weight hierarchy tree',
  access: 'read',
  example: 'opencli a2mac1 weight-tree --parent 00000004QH72EU01',
  domain: HOST,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'hierarchy', type: 'string', default: 'weight', help: 'Hierarchy alias or ID (default = weight / 3D AutoReverse)' },
    { name: 'parent', type: 'string', default: '', help: 'Parent nodeId; empty = root level (vehicle systems)' },
    { name: 'depth', type: 'int', default: 1, help: 'Recursion depth (1..2); >1 expands children automatically' },
    { name: 'limit', type: 'int', default: 200, help: 'Max rows (1..500)' },
    { name: 'lang', type: 'string', default: '', help: 'Accept-Language, e.g. en or zh-CN' },
  ],
  columns: ['level', 'name', 'nodeId', 'parentId', 'hasChildren'],
  func: (page, args) => runTree(page, args, {
    command: 'weight-tree',
    hierarchy: 'weight',
    maxDepth: 2,
  }),
});
