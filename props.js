// A2MAC1 — all properties for one product at one node, in any data domain.
//
// The generic form of `vop` / `weight`: same long-table shape, but the domain
// is chosen with --hierarchy, so a newly captured domain needs no new adapter.
//
//   opencli a2mac1 props A0000077HXAOEU01 --node 00000004QH72EU01
//   opencli a2mac1 props "Xiaomi YU7" --node 00000004OU52EU01 --hierarchy vop
//   opencli a2mac1 props <pid> --node <nid> --hierarchy electronics --groups "Overview"
import { cli, Strategy } from '@jackwener/opencli/registry';
import { HOST } from './lib/http.js';
import { runProps } from './lib/ops.js';

cli({
  site: 'a2mac1',
  name: 'props',
  description: 'A2MAC1 — all properties for one product at one node in any data domain',
  access: 'read',
  example: 'opencli a2mac1 props A0000077HXAOEU01 --node 00000004QH72EU01',
  domain: HOST,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'productId', type: 'string', required: true, positional: true, default: '', help: 'Product ID, or a car name (e.g. "Xiaomi YU7")' },
    { name: 'node', type: 'string', required: true, default: '', help: 'nodeId (use `opencli a2mac1 tree --hierarchy <alias>`)' },
    { name: 'hierarchy', type: 'string', default: 'weight', help: 'Data domain alias or hierarchyId (see `opencli a2mac1 hierarchies`)' },
    { name: 'includeMeta', type: 'bool', default: false, help: 'Include catalogue metadata groups (概览/基本信息/文件)' },
    { name: 'groups', type: 'string', default: '', help: 'Comma-separated propertyGroup names to keep (overrides includeMeta)' },
    { name: 'lang', type: 'string', default: '', help: 'Accept-Language, e.g. en or zh-CN' },
  ],
  columns: ['group', 'property', 'value', 'unit', 'propertyId'],
  func: (page, args) => runProps(page, args, {
    command: 'props',
    hierarchy: 'weight',
  }),
});
