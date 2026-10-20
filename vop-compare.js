// A2MAC1 — multi-product VOP comparison at one node.
// Emits a long table (one row per product × property); pivot in Excel / pandas
// to get the wide "1 row per car, 1 column per attribute" view.
//
// Preset over the shared compare implementation:
//   opencli a2mac1 compare <pids> --node <nid> --hierarchy vop
import { cli, Strategy } from '@jackwener/opencli/registry';
import { HOST } from './lib/http.js';
import { runCompare } from './lib/ops.js';

cli({
  site: 'a2mac1',
  name: 'vop-compare',
  description: 'A2MAC1 IBP — compare VOP measurements across multiple products at one node',
  access: 'read',
  example: 'opencli a2mac1 vop-compare A0000077HXAOEU01,A000006XCOGGEU01 --node 00000004OU52EU01',
  domain: HOST,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'products', type: 'string', required: true, positional: true, default: '', help: 'Comma-separated productIds or car names' },
    { name: 'node', type: 'string', required: true, default: '', help: 'VOP nodeId' },
    { name: 'hierarchy', type: 'string', default: 'vop', help: 'Hierarchy alias or ID (default = vop)' },
    { name: 'filter', type: 'string', default: '', help: 'Substring filter on property name (e.g. "SAE-L")' },
    { name: 'includeMeta', type: 'bool', default: false, help: 'Include catalogue metadata groups' },
    { name: 'limit', type: 'int', default: 1000, help: 'Max output rows' },
    { name: 'strict', type: 'bool', default: false, help: 'Fail instead of skipping nodes whose request errored' },
    { name: 'lang', type: 'string', default: '', help: 'Accept-Language, e.g. en or zh-CN' },
  ],
  columns: ['productId', 'productName', 'group', 'property', 'value', 'unit'],
  func: (page, args) => runCompare(page, args, {
    command: 'vop-compare',
    hierarchy: 'vop',
    defaultLimit: 1000,
  }),
});
