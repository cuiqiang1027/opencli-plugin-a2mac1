// A2MAC1 — compare any data domain across multiple products.
//
// Generic form of vop-compare / weight-compare:
//   * --node <nodeId>        one node, many cars
//   * --parent + --depth N   every node under a parent, expanded N levels
//   * products accept ids OR car names ("Xiaomi YU7,BMW iX3")
//
// Emits one row per (product × node × property); pivot to get a wide view.
//
//   opencli a2mac1 compare "Xiaomi YU7,BMW iX3" --hierarchy vop --node 00000004OU52EU01
//   opencli a2mac1 compare A0000077HXAOEU01,A000006XCOGGEU01 --depth 2 -f csv
import { cli, Strategy } from '@jackwener/opencli/registry';
import { HOST } from './lib/http.js';
import { runCompare } from './lib/ops.js';

cli({
  site: 'a2mac1',
  name: 'compare',
  description: 'A2MAC1 — compare any data domain across multiple products (long table)',
  access: 'read',
  example: 'opencli a2mac1 compare "Xiaomi YU7,BMW iX3" --hierarchy vop --node 00000004OU52EU01',
  domain: HOST,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'products', type: 'string', required: true, positional: true, default: '', help: 'Comma-separated productIds or car names' },
    { name: 'node', type: 'string', default: '', help: 'Single nodeId to compare at (omit to walk --parent)' },
    { name: 'parent', type: 'string', default: '', help: 'Parent nodeId; empty = root level' },
    { name: 'depth', type: 'int', default: 1, help: 'Levels below --parent to expand (1..3)' },
    { name: 'hierarchy', type: 'string', default: 'weight', help: 'Data domain alias or hierarchyId (see `opencli a2mac1 hierarchies`)' },
    { name: 'filter', type: 'string', default: '', help: 'Substring filter on property name (e.g. "SAE-L")' },
    { name: 'groups', type: 'string', default: '', help: 'Comma-separated propertyGroup names to keep' },
    { name: 'includeMeta', type: 'bool', default: false, help: 'Include catalogue metadata groups' },
    { name: 'limit', type: 'int', default: 1000, help: 'Max output rows' },
    { name: 'strict', type: 'bool', default: false, help: 'Fail instead of skipping nodes whose request errored' },
    { name: 'lang', type: 'string', default: '', help: 'Accept-Language, e.g. en or zh-CN' },
  ],
  columns: ['productId', 'productName', 'nodeName', 'nodeId', 'group', 'property', 'value', 'unit'],
  func: (page, args) => runCompare(page, args, {
    command: 'compare',
    hierarchy: 'weight',
    includeNodeColumns: true,
    defaultLimit: 1000,
    maxDepth: 3,
  }),
});
