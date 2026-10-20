// A2MAC1 — part-level bill of materials (BOM), one row per part per vehicle.
//
// This is the layer below `weight-compare`: instead of system totals it returns
// every teardown row with its own mass, part count, material and supplier, which
// is what actually supports cost / material-mix / supplier analysis.
//
//   opencli a2mac1 bom "Xiaomi YU7" --filter door
//   opencli a2mac1 bom A0000077HXAOEU01,A000009JDDOREU01 --node 00000004QH72EU01 --depth 3
//   opencli a2mac1 bom A0000077HXAOEU01 --filter "aluminium" -f csv > al.csv
import { cli, Strategy } from '@jackwener/opencli/registry';
import { HOST } from './lib/http.js';
import { runBom } from './lib/ops.js';

cli({
  site: 'a2mac1',
  name: 'bom',
  description: 'A2MAC1 — part-level bill of materials (mass, material, supplier) across vehicles',
  access: 'read',
  example: 'opencli a2mac1 bom "Xiaomi YU7,BMW iX3" --filter door',
  domain: HOST,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'products', type: 'string', required: true, positional: true, default: '', help: 'Comma-separated productIds or car names' },
    { name: 'hierarchy', type: 'string', default: 'weight', help: 'Data domain alias or hierarchyId (see `opencli a2mac1 hierarchies`)' },
    { name: 'node', type: 'string', default: '', help: 'Restrict to one subtree by nodeId' },
    { name: 'depth', type: 'string', default: '3', help: 'How deep below --node to include (1..8)' },
    { name: 'filter', type: 'string', default: '', help: 'Substring filter on node path / material / supplier' },
    { name: 'limit', type: 'string', default: '2000', help: 'Max output rows' },
    { name: 'lang', type: 'string', default: '', help: 'Accept-Language, e.g. en or zh-CN' },
  ],
  columns: [
    'productId',
    'productName',
    'system',
    'node',
    'nodeId',
    'totalWeight_kg',
    'partsCount',
    'fastenerWeight_kg',
    'detailWeight_kg',
    'partWeight_kg',
    'materialType',
    'materialCode',
    'oemTiers',
    'dimensions_mm',
  ],
  func: (page, args) => runBom(page, args, { command: 'bom', hierarchy: 'weight' }),
});
