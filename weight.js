// A2MAC1 — weight data for one product at one node (3D AutoReverse hierarchy).
//
// Preset over the shared props implementation, restricted to the "Overview"
// property group where Total Weight / Number of Parts / Part Code live.
//
// Typical workflow:
//   1. opencli a2mac1 tree --hierarchy weight      # find the system node
//   2. opencli a2mac1 weight <pid> --node <nid>    # pull its weight data
//   3. opencli a2mac1 weight-compare pid1,pid2     # compare multiple cars
import { cli, Strategy } from '@jackwener/opencli/registry';
import { HOST } from './lib/http.js';
import { runProps } from './lib/ops.js';

cli({
  site: 'a2mac1',
  name: 'weight',
  description: 'A2MAC1 — weight data for one product at one node (3D AutoReverse hierarchy)',
  access: 'read',
  example: 'opencli a2mac1 weight A0000077HXAOEU01 --node 00000004QH72EU01',
  domain: HOST,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'productId', type: 'string', required: true, positional: true, default: '', help: 'Product ID, or a car name (e.g. "Xiaomi YU7")' },
    { name: 'node', type: 'string', required: true, default: '', help: 'Weight nodeId (use `opencli a2mac1 tree --hierarchy weight`)' },
    { name: 'hierarchy', type: 'string', default: 'weight', help: 'Hierarchy alias or ID (default = weight / 3D AutoReverse)' },
    { name: 'groups', type: 'string', default: '', help: 'Comma-separated propertyGroup names to keep (default = Overview)' },
    { name: 'lang', type: 'string', default: '', help: 'Accept-Language, e.g. en or zh-CN' },
  ],
  columns: ['group', 'property', 'value', 'unit', 'propertyId'],
  func: (page, args) => runProps(page, args, {
    command: 'weight',
    hierarchy: 'weight',
    groupMode: 'only',
    groups: ['overview', '概览'],
  }),
});
