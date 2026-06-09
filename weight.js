// A2MAC1 — pull weight data for one product at one node under the 3D AutoReverse hierarchy.
// Endpoint: POST /api/products/<productId>/hierarchies/<hierarchyId>/nodes/<nodeId>/data
//   ?hideMappedProperties=false&hideMappedProductTypesProperties=true&hierarchyId=<hierarchyId>
//   body: {}
//
// Returns weight-related properties: Total Weight (kg), Number of Parts,
// Number of Fasteners, Fastener(s) Weight (kg), Part code, plus
// optional dimensions (Width/Height/Depth mm) when available.
//
// Typical workflow:
//   1. opencli a2mac1 weight-tree              # find the system node you want
//   2. opencli a2mac1 weight <pid> --node <nid> # pull its weight data
//   3. opencli a2mac1 weight-compare pid1,pid2  # compare multiple cars
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

// Group names we want to keep. "Overview" contains the core weight fields,
// "System and Function" gives context; everything else is noise for this adapter.
const KEEP_GROUPS = new Set(['Overview', 'System and Function', 'Additional Properties']);

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
    { name: 'productId', type: 'string', required: true, positional: true, default: '', help: 'Product ID (use `opencli a2mac1 search ...` to find it)' },
    { name: 'node', type: 'string', required: true, default: '', help: 'Weight nodeId (use `opencli a2mac1 weight-tree` to browse)' },
    { name: 'hierarchy', type: 'string', default: HIERARCHY.THREE_D_AUTOREVERSE, help: 'Hierarchy ID (default = 3D AutoReverse)' },
  ],
  columns: ['group', 'property', 'value', 'unit', 'propertyId'],
  func: async (page, args) => {
    const productId = String(args.productId ?? '').trim();
    if (!productId) throw new ArgumentError('productId is required');
    const node = String(args.node ?? '').trim();
    if (!node) throw new ArgumentError('--node <nodeId> is required (run `opencli a2mac1 weight-tree`)');
    const hierarchyId = String(args.hierarchy || HIERARCHY.THREE_D_AUTOREVERSE).trim();

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
      throw new CommandExecutionError(`weight request failed: ${error?.message || error}`);
    }
    if (resp.status === 401 || resp.status === 403) throw new AuthRequiredError(HOST);
    if (resp.status >= 300 && resp.status < 400) throw new AuthRequiredError(HOST);
    if (!resp.ok) throw new CommandExecutionError(`weight failed: HTTP ${resp.status}`);

    let data;
    try {
      data = await resp.json();
    } catch (error) {
      throw new CommandExecutionError(`weight: invalid JSON (${error?.message || error})`);
    }

    const scenarios = data?.part?.scenarioPropertyGroups;
    const groups = Array.isArray(scenarios) && scenarios[0]?.propertyGroups
      ? scenarios[0].propertyGroups
      : [];

    const out = [];
    for (const grp of groups) {
      const groupName = String(grp?.propertyGroupName ?? '');
      if (!KEEP_GROUPS.has(groupName)) continue;
      const properties = Array.isArray(grp?.properties) ? grp.properties : [];
      for (const prop of properties) {
        const valueObj = Array.isArray(prop?.values) ? prop.values[0] : null;
        const rawName = String(prop?.propertyName ?? '');
        let propertyName = rawName;
        let unit = String(valueObj?.unitLabel ?? '').trim();
        const unitBracketMatch = rawName.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
        const unitParenMatch = rawName.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
        const unitMatch = unitBracketMatch || unitParenMatch;
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
        'a2mac1 weight',
        `no weight properties for product=${productId}, node=${node} (node may not have teardown data yet)`,
      );
    }
    return out;
  },
});
