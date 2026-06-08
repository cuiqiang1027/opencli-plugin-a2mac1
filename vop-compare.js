// A2MAC1 — multi-product VOP comparison at one node.
// Calls /api/products/<pid>/hierarchies/<hid>/nodes/<nid>/data for each
// product in `products` (comma-separated) and emits a long table:
//   one row per (product × property).
// Pivot in Excel / pandas to get the wide "1 row per car, 1 col per attribute"
// view; the long form here is what naturally supports filtering by SAE code,
// sorting by value, and CSV export.
//
// Why long instead of wide: opencli adapter columns are declared statically.
// A wide table would force one fixed column per car, which doesn't generalize.
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
  DEFAULT_PRODUCT_TYPE_GROUP,
  readCookie,
  authHeaders,
} from './_helpers.js';

const META_GROUPS = new Set(['概览', '基本信息', '文件', 'Media Gallery']);

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
    { name: 'products', type: 'string', required: true, positional: true, default: '', help: 'Comma-separated productIds' },
    { name: 'node', type: 'string', required: true, default: '', help: 'VOP nodeId' },
    { name: 'hierarchy', type: 'string', default: HIERARCHY.VOP, help: 'Hierarchy ID (default = VOP)' },
    { name: 'filter', type: 'string', default: '', help: 'Substring filter on property name (e.g. "SAE-L")' },
    { name: 'includeMeta', type: 'bool', default: false, help: 'Include 概览/基本信息/文件 metadata groups' },
    { name: 'limit', type: 'int', default: 1000, help: 'Max output rows' },
  ],
  columns: ['productId', 'productName', 'group', 'property', 'value', 'unit'],
  func: async (page, args) => {
    const raw = String(args.products ?? '').trim();
    if (!raw) throw new ArgumentError('products is required (comma-separated)');
    const productIds = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
    if (productIds.length === 0) throw new ArgumentError('no valid productIds parsed from products arg');
    if (productIds.length > 25) throw new ArgumentError('compare supports up to 25 products at once');

    const node = String(args.node ?? '').trim();
    if (!node) throw new ArgumentError('--node <nodeId> is required');
    const hierarchyId = String(args.hierarchy || HIERARCHY.VOP).trim();
    const includeMeta = Boolean(args.includeMeta);
    const filter = String(args.filter ?? '').trim().toLowerCase();
    const limit = Number(args.limit ?? 1000);
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new ArgumentError('limit must be a positive integer');
    }

    const cookie = await readCookie(page);
    if (!cookie) throw new AuthRequiredError(HOST);

    // Resolve productName once per product — the node-level /data endpoint
    // returns productName=null. Fail-soft: missing names fall back to ID.
    async function fetchName(productId) {
      const url = `${BASE}/api/products/${encodeURIComponent(productId)}` +
                  `?productTypeGroupId=${encodeURIComponent(DEFAULT_PRODUCT_TYPE_GROUP)}` +
                  `&hideMappedProductTypesProperties=false`;
      try {
        const resp = await fetch(url, { headers: authHeaders(cookie), redirect: 'manual' });
        if (!resp.ok) return null;
        const d = await resp.json();
        const name = [d?.name, d?.trim].filter(Boolean).join(' ');
        return name || d?.completeName || null;
      } catch {
        return null;
      }
    }

    async function fetchOne(productId) {
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
        throw new CommandExecutionError(`vop-compare ${productId}: ${error?.message || error}`);
      }
      if (resp.status === 401 || resp.status === 403) throw new AuthRequiredError(HOST);
      if (resp.status >= 300 && resp.status < 400) throw new AuthRequiredError(HOST);
      // 404 / 403 on a single product shouldn't kill the whole batch — surface
      // as an empty placeholder so downstream pivots can spot the gap.
      if (!resp.ok) {
        return { productId, productName: `(HTTP ${resp.status})`, properties: [] };
      }
      let data;
      try {
        data = await resp.json();
      } catch {
        return { productId, productName: '(invalid JSON)', properties: [] };
      }
      const productName = data?.part?.productName
        ?? data?.product?.productName
        ?? (await fetchName(productId))
        ?? productId;
      const groups = data?.part?.scenarioPropertyGroups?.[0]?.propertyGroups || [];
      const properties = [];
      for (const grp of groups) {
        const groupName = String(grp?.propertyGroupName ?? '');
        if (!includeMeta && META_GROUPS.has(groupName)) continue;
        for (const prop of grp?.properties || []) {
          const valueObj = Array.isArray(prop?.values) ? prop.values[0] : null;
          const rawName = String(prop?.propertyName ?? '');
          let propertyName = rawName;
          let unit = String(valueObj?.unitLabel ?? '').trim();
          const m = rawName.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
          if (m) {
            propertyName = m[1].trim();
            if (!unit) unit = m[2].trim();
          }
          properties.push({
            group: groupName,
            property: propertyName,
            value: valueObj?.formatedValue ?? '',
            unit,
          });
        }
      }
      return { productId, productName, properties };
    }

    // Fire requests in parallel — A2MAC1 tolerates this fine; cap at 5 in
    // flight to be polite.
    const results = [];
    const queue = [...productIds];
    const inFlight = new Set();
    async function worker() {
      while (queue.length) {
        const pid = queue.shift();
        const promise = fetchOne(pid).then((r) => {
          results.push(r);
          inFlight.delete(promise);
        });
        inFlight.add(promise);
        if (inFlight.size >= 5) await Promise.race(inFlight);
      }
    }
    await Promise.all(Array.from({ length: Math.min(5, productIds.length) }, () => worker()));
    await Promise.all(inFlight);

    // Preserve user-supplied product order in the output.
    const order = new Map(productIds.map((id, i) => [id, i]));
    results.sort((a, b) => (order.get(a.productId) ?? 0) - (order.get(b.productId) ?? 0));

    const out = [];
    for (const r of results) {
      for (const prop of r.properties) {
        if (filter && !prop.property.toLowerCase().includes(filter)) continue;
        out.push({
          productId: r.productId,
          productName: r.productName,
          group: prop.group,
          property: prop.property,
          value: prop.value,
          unit: prop.unit,
        });
        if (out.length >= limit) break;
      }
      if (out.length >= limit) break;
    }

    if (out.length === 0) {
      throw new EmptyResultError(
        'a2mac1 vop-compare',
        `no properties matched (filter="${filter}", node=${node})`,
      );
    }
    return out;
  },
});
