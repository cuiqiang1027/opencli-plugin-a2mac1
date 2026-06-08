// A2MAC1 — read all VOP measurements for one product at one node.
// Endpoint: POST /api/products/<productId>/hierarchies/<hierarchyId>/nodes/<nodeId>/data
//   ?hideMappedProperties=false&hideMappedProductTypesProperties=true&hierarchyId=<hierarchyId>
//   body: {}
// Returns part.scenarioPropertyGroups[0].propertyGroups[*].properties[*]
// where each property has {propertyName, values:[{formatedValue, unitLabel}]}.
//
// Long-table output (one row per property): aligned with how IBP groups
// SAE J1100 fields. Use `vop-compare` for wide-table multi-vehicle comparison.
//
// Common nodeIds (drill via `opencli a2mac1 vop-tree`):
//   00000004OU52EU01  Interior Dimensions / Length
//   000000028DB4EU01  Interior Dimensions / Height
//   0000000ARUFBEU01  Interior Dimensions / Width
//   00000009JMFLEU01  Interior Dimensions / Angle
//   000000005L1YEU01  Interior Dimensions / Seats
//   00000006XA4TEU01  Interior Dimensions / Trunk Compartment
//   00000008HPU9EU01  Exterior Dimensions / Length
//   00000004YO7QEU01  Exterior Dimensions / Height
//   00000001VN0NEU01  Exterior Dimensions / Width
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  ArgumentError,
  AuthRequiredError,
  CommandExecutionError,
  EmptyResultError,
} from '@jackwener/opencli/errors';
import {
  HOST,
  BASE,
  HIERARCHY,
  readCookie,
  authHeaders,
} from './_helpers.js';

// Group names that aren't measurement fields — drop them by default unless
// the user passes --include-meta.
const META_GROUPS = new Set(['概览', '基本信息', '文件', 'Media Gallery']);

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
    { name: 'productId', type: 'string', required: true, positional: true, default: '', help: 'Product ID (use `opencli a2mac1 search ...` to find it)' },
    { name: 'node', type: 'string', required: true, default: '', help: 'VOP nodeId (use `opencli a2mac1 vop-tree --depth 3`)' },
    { name: 'hierarchy', type: 'string', default: HIERARCHY.VOP, help: 'Hierarchy ID (default = VOP)' },
    { name: 'includeMeta', type: 'bool', default: false, help: 'Include 概览/基本信息/文件 metadata groups' },
  ],
  columns: ['group', 'property', 'value', 'unit', 'propertyId'],
  func: async (page, args) => {
    const productId = String(args.productId ?? '').trim();
    if (!productId) throw new ArgumentError('productId is required');
    const node = String(args.node ?? '').trim();
    if (!node) throw new ArgumentError('--node <nodeId> is required (run `opencli a2mac1 vop-tree --depth 3`)');
    const hierarchyId = String(args.hierarchy || HIERARCHY.VOP).trim();
    const includeMeta = Boolean(args.includeMeta);

    const cookie = await readCookie(page);
    if (!cookie) throw new AuthRequiredError(HOST);

    const url = `${BASE}/api/products/${encodeURIComponent(productId)}` +
                `/hierarchies/${encodeURIComponent(hierarchyId)}` +
                `/nodes/${encodeURIComponent(node)}/data` +
                `?hideMappedProperties=false&hideMappedProductTypesProperties=true` +
                `&hierarchyId=${encodeURIComponent(hierarchyId)}`;

    let resp;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: authHeaders(cookie),
        body: '{}',
        redirect: 'manual',
      });
    } catch (error) {
      throw new CommandExecutionError(`vop request failed: ${error?.message || error}`);
    }
    if (resp.status === 401 || resp.status === 403) throw new AuthRequiredError(HOST);
    if (resp.status >= 300 && resp.status < 400) throw new AuthRequiredError(HOST);
    if (!resp.ok) throw new CommandExecutionError(`vop failed: HTTP ${resp.status}`);

    let data;
    try {
      data = await resp.json();
    } catch (error) {
      throw new CommandExecutionError(`vop: invalid JSON (${error?.message || error})`);
    }

    const scenarios = data?.part?.scenarioPropertyGroups;
    const groups = Array.isArray(scenarios) && scenarios[0]?.propertyGroups
      ? scenarios[0].propertyGroups
      : [];

    const out = [];
    for (const grp of groups) {
      const groupName = String(grp?.propertyGroupName ?? '');
      if (!includeMeta && META_GROUPS.has(groupName)) continue;
      const properties = Array.isArray(grp?.properties) ? grp.properties : [];
      for (const prop of properties) {
        const valueObj = Array.isArray(prop?.values) ? prop.values[0] : null;
        const rawName = String(prop?.propertyName ?? '');
        // Names look like "SAE-L18 - Foot Entrance Clearance – Front [mm]".
        // Pull the bracketed unit out so it lands in the unit column.
        let propertyName = rawName;
        let unit = String(valueObj?.unitLabel ?? '').trim();
        const unitMatch = rawName.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
        if (unitMatch) {
          propertyName = unitMatch[1].trim();
          if (!unit) unit = unitMatch[2].trim();
        }
        out.push({
          group: groupName,
          property: propertyName,
          value: valueObj?.formatedValue ?? '',
          unit,
          propertyId: String(prop?.propertyId ?? ''),
        });
      }
    }

    if (out.length === 0) {
      throw new EmptyResultError(
        'a2mac1 vop',
        `no properties for product=${productId}, node=${node} (try includeMeta or another node)`,
      );
    }
    return out;
  },
});
