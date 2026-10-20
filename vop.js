// A2MAC1 — read all VOP measurements for one product at one node.
// Endpoint: POST /api/products/<productId>/hierarchies/<hierarchyId>/nodes/<nodeId>/data
// Returns part.scenarioPropertyGroups[0].propertyGroups[*].properties[*]
// where each property has {propertyName, values:[{formatedValue, unitLabel}]}.
//
// Long-table output (one row per property): aligned with how IBP groups
// SAE J1100 fields. Use `vop-compare` for multi-vehicle comparison.
//
// This is a preset over the shared props implementation. The generic command is:
//   opencli a2mac1 props <productId> --node <nodeId> --hierarchy vop
import { cli, Strategy } from '@jackwener/opencli/registry';
import { HOST } from './lib/http.js';
import { runProps } from './lib/ops.js';

cli({
  site: 'a2mac1',
  name: 'vop',
  description: 'A2MAC1 IBP — VOP measurements for one product at one node (long table)',
  access: 'read',
  example: 'opencli a2mac1 vop A0000077HXAOEU01 --node 00000004OU52EU01',
  domain: HOST,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'productId', type: 'string', required: true, positional: true, default: '', help: 'Product ID, or a car name (e.g. "Xiaomi YU7")' },
    { name: 'node', type: 'string', required: true, default: '', help: 'VOP nodeId (use `opencli a2mac1 tree --hierarchy vop --depth 3`)' },
    { name: 'hierarchy', type: 'string', default: 'vop', help: 'Hierarchy alias or ID (default = vop)' },
    { name: 'includeMeta', type: 'bool', default: false, help: 'Include catalogue metadata groups (概览/基本信息/文件)' },
    { name: 'groups', type: 'string', default: '', help: 'Comma-separated propertyGroup names to keep (overrides includeMeta)' },
    { name: 'lang', type: 'string', default: '', help: 'Accept-Language, e.g. en or zh-CN' },
  ],
  columns: ['group', 'property', 'value', 'unit', 'propertyId'],
  func: (page, args) => runProps(page, args, {
    command: 'vop',
    hierarchy: 'vop',
    groupMode: 'dropMeta',
  }),
});
