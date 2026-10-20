// A2MAC1 — multi-product weight comparison across vehicle systems.
//
// Walks a level of the 3D AutoReverse hierarchy (default: root = the vehicle
// systems), fetches weight data for each product at every node, and emits a
// long table: one row per (product × system) so the output stays filterable and
// pivots to a wide "1 column per car" view in Excel / pandas.
//
// Preset over the shared compare implementation, flattened to numeric weight
// columns:
//   opencli a2mac1 compare <pids> --hierarchy weight --flatten weight
//
// Workflow:
//   opencli a2mac1 weight-compare pid1,pid2                    # all systems
//   opencli a2mac1 weight-compare pid1,pid2 --parent <nodeId>   # sub-systems
//   opencli a2mac1 weight-compare pid1,pid2 --depth 2           # two levels deep
import { cli, Strategy } from '@jackwener/opencli/registry';
import { HOST } from './lib/http.js';
import { runCompare } from './lib/ops.js';

cli({
  site: 'a2mac1',
  name: 'weight-compare',
  description: 'A2MAC1 — compare weight data across multiple products at one hierarchy level (long table)',
  access: 'read',
  example: 'opencli a2mac1 weight-compare A0000077HXAOEU01,A000006XCOGGEU01',
  domain: HOST,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'products', type: 'string', required: true, positional: true, default: '', help: 'Comma-separated productIds or car names' },
    { name: 'parent', type: 'string', default: '', help: 'Parent nodeId; empty = root (all vehicle systems)' },
    { name: 'depth', type: 'int', default: 1, help: 'How many levels below --parent to expand (1..3)' },
    { name: 'hierarchy', type: 'string', default: 'weight', help: 'Hierarchy alias or ID (default = weight / 3D AutoReverse)' },
    { name: 'limit', type: 'int', default: 500, help: 'Max output rows' },
    { name: 'strict', type: 'bool', default: false, help: 'Fail instead of skipping nodes whose request errored' },
    { name: 'lang', type: 'string', default: '', help: 'Accept-Language, e.g. en or zh-CN' },
  ],
  columns: ['productId', 'productName', 'system', 'nodeId', 'totalWeight_kg', 'partsCount', 'fastenersCount', 'fastenerWeight_kg', 'partCode'],
  func: (page, args) => runCompare(page, args, {
    command: 'weight-compare',
    hierarchy: 'weight',
    flatten: 'weight',
    defaultLimit: 500,
    maxDepth: 3,
  }),
});
