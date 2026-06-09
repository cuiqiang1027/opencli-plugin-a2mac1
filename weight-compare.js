// A2MAC1 — multi-product weight comparison at any hierarchy level (the "configurator").
//
// Walks a level of the 3D AutoReverse hierarchy (default: root = 22 vehicle systems),
// then fetches weight details for each product at every child node. Emits a long table:
//   one row per (product × node) so the output is filterable, sortable, and pivotable
//   to a wide "1 column per car" view in Excel / pandas.
//
// Typical workflow:
//   opencli a2mac1 weight-compare pid1,pid2                    # all systems
//   opencli a2mac1 weight-compare pid1,pid2 --parent <nodeId>   # sub-systems under one system
//   opencli a2mac1 weight-compare pid1,pid2 -f json            # machine-readable
//
// The adapter fetches data in two phases:
//   Phase 1 — resolve the hierarchy children at --parent (or root)
//   Phase 2 — for each product × child node, POST /data to get weight properties
//   Parallel worker pool (max 5 concurrent) to be polite to the A2MAC1 API.
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

// We only extract the "Overview" property group — it contains the canonical
// weight fields. "System and Function" and "Additional Properties" are
// supplementary but non-numeric; skip them to keep output clean.
const WEIGHT_GROUP = 'Overview';

// Mapping from expected property names to output column keys.
// The API returns names like "Total Weight (kg)", "Number of Parts", etc.
// We extract the numeric value and expose it in a form that pivots cleanly.
const WEIGHT_PROPS = {
  'Total Weight': 'totalWeight_kg',
  'Number of Parts': 'partsCount',
  'Number of Fasteners': 'fastenersCount',
  'Fastener(s) Weight': 'fastenerWeight_kg',
  'Part code': 'partCode',
};

function parseWeightProperties(groups) {
  const result = {};
  for (const grp of groups) {
    if (String(grp?.propertyGroupName ?? '') !== WEIGHT_GROUP) continue;
    for (const prop of grp?.properties || []) {
      const rawName = String(prop?.propertyName ?? '');
      // Strip unit suffix in either [unit] or (unit) form so we can match
      // against WEIGHT_PROPS keys (e.g. "Total Weight (kg)" → "Total Weight").
      const cleanName = rawName
        .replace(/\s*\([^)]+\)\s*$/, '')
        .replace(/\s*\[[^\]]+\]\s*$/, '')
        .trim();
      const valueObj = Array.isArray(prop?.values) ? prop.values[0] : null;
      const val = valueObj?.formatedValue ?? '';
      for (const [label, key] of Object.entries(WEIGHT_PROPS)) {
        if (cleanName === label) {
          result[key] = val;
          break;
        }
      }
    }
  }
  return result;
}

// Weight data is mostly numeric. Strip commas from formatted values
// (e.g. "1,234.56" → "1234.56") so downstream CSV parsing works.
function cleanNumeric(val) {
  if (typeof val !== 'string') return val;
  return val.replace(/,/g, '');
}

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
    { name: 'products', type: 'string', required: true, positional: true, default: '', help: 'Comma-separated productIds' },
    { name: 'parent', type: 'string', default: '', help: 'Parent nodeId; empty = root (all vehicle systems)' },
    { name: 'hierarchy', type: 'string', default: HIERARCHY.THREE_D_AUTOREVERSE, help: 'Hierarchy ID (default = 3D AutoReverse)' },
    { name: 'limit', type: 'int', default: 500, help: 'Max output rows' },
  ],
  columns: ['productId', 'productName', 'system', 'nodeId', 'totalWeight_kg', 'partsCount', 'fastenersCount', 'fastenerWeight_kg', 'partCode'],
  func: async (page, args) => {
    // --- Parse inputs ---
    const raw = String(args.products ?? '').trim();
    if (!raw) throw new ArgumentError('products is required (comma-separated productIds)');
    const productIds = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
    if (productIds.length === 0) throw new ArgumentError('no valid productIds parsed from products arg');
    if (productIds.length > 25) throw new ArgumentError('weight-compare supports up to 25 products at once');

    const parent = String(args.parent || '').trim() || null;
    const hierarchyId = String(args.hierarchy || HIERARCHY.THREE_D_AUTOREVERSE).trim();
    const limit = Number(args.limit ?? 500);
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new ArgumentError('limit must be a positive integer');
    }

    const cookie = await readCookie(page);
    if (!cookie) throw new AuthRequiredError(HOST);

    // --- Phase 1: Discover hierarchy children at the target level ---
    const treeUrl = `${BASE}/api/hierarchies/${encodeURIComponent(hierarchyId)}`;
    async function fetchChildren(parentNodeId) {
      const body = parentNodeId ? { parentNodeId } : {};
      let resp;
      try {
        resp = await fetch(treeUrl, {
          method: 'POST',
          headers: authHeaders(cookie),
          body: JSON.stringify(body),
          redirect: 'manual',
        });
      } catch (error) {
        throw new CommandExecutionError(`weight-compare: hierarchy fetch failed: ${error?.message || error}`);
      }
      if (resp.status === 401 || resp.status === 403) throw new AuthRequiredError(HOST);
      if (resp.status >= 300 && resp.status < 400) throw new AuthRequiredError(HOST);
      if (!resp.ok) {
        throw new CommandExecutionError(
          `weight-compare: HTTP ${resp.status} fetching children of "${parentNodeId || 'ROOT'}"`,
        );
      }
      let data;
      try {
        data = await resp.json();
      } catch (error) {
        throw new CommandExecutionError(`weight-compare: invalid JSON from hierarchy (${error?.message || error})`);
      }
      const nodes = Array.isArray(data?.hierarchyNodes) ? data.hierarchyNodes : [];
      const target = parentNodeId || null;
      return nodes
        .filter((n) => n?.parentId === target)
        .filter((n) => n?.id);
    }

    const children = await fetchChildren(parent);
    if (children.length === 0) {
      throw new EmptyResultError(
        'a2mac1 weight-compare',
        parent ? `no children under parent "${parent}"` : 'no systems found at root level',
      );
    }

    // --- Phase 1b: Resolve product names ---
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

    const nameMap = new Map();
    for (const pid of productIds) {
      const name = await fetchName(pid);
      nameMap.set(pid, name || pid);
    }

    // --- Phase 2: For each product × child node, fetch weight data ---
    async function fetchWeight(productId, nodeId) {
      const url = `${BASE}/api/products/${encodeURIComponent(productId)}` +
                  `/hierarchies/${encodeURIComponent(hierarchyId)}` +
                  `/nodes/${encodeURIComponent(nodeId)}/data` +
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
        return { error: error?.message || 'fetch failed' };
      }
      if (resp.status === 401 || resp.status === 403) throw new AuthRequiredError(HOST);
      if (resp.status >= 300 && resp.status < 400) throw new AuthRequiredError(HOST);
      if (!resp.ok) {
        return { error: `HTTP ${resp.status}` };
      }
      let data;
      try {
        data = await resp.json();
      } catch {
        return { error: 'invalid JSON' };
      }
      const scenarios = data?.part?.scenarioPropertyGroups;
      const groups = Array.isArray(scenarios) && scenarios[0]?.propertyGroups
        ? scenarios[0].propertyGroups
        : [];
      return { groups };
    }

    // Worker pool: max 5 in-flight requests, ordered by priority
    const results = [];
    const queue = [];
    for (const pid of productIds) {
      for (const child of children) {
        queue.push({ productId: pid, nodeId: child.id, nodeName: child.name });
      }
    }

    const inFlight = new Set();
    async function worker() {
      while (queue.length > 0 && results.length < limit) {
        const job = queue.shift();
        const promise = fetchWeight(job.productId, job.nodeId).then((result) => {
          if (!result.error && result.groups) {
            const weights = parseWeightProperties(result.groups);
            results.push({
              productId: job.productId,
              productName: nameMap.get(job.productId) || job.productId,
              system: job.nodeName,
              nodeId: job.nodeId,
              totalWeight_kg: cleanNumeric(weights.totalWeight_kg ?? ''),
              partsCount: cleanNumeric(weights.partsCount ?? ''),
              fastenersCount: cleanNumeric(weights.fastenersCount ?? ''),
              fastenerWeight_kg: cleanNumeric(weights.fastenerWeight_kg ?? ''),
              partCode: weights.partCode ?? '',
            });
          }
          inFlight.delete(promise);
        });
        inFlight.add(promise);
        if (inFlight.size >= 5) await Promise.race(inFlight);
      }
    }

    await Promise.all(Array.from({ length: Math.min(5, queue.length) }, () => worker()));
    await Promise.all(inFlight);

    // Preserve user-supplied product order + hierarchy order
    const order = new Map(productIds.map((id, i) => [id, i]));
    const nodeOrder = new Map(children.map((c, i) => [c.id, i]));
    results.sort((a, b) => {
      const po = (order.get(a.productId) ?? 0) - (order.get(b.productId) ?? 0);
      if (po !== 0) return po;
      return (nodeOrder.get(a.nodeId) ?? 0) - (nodeOrder.get(b.nodeId) ?? 0);
    });

    const out = results.slice(0, limit);

    if (out.length === 0) {
      throw new EmptyResultError(
        'a2mac1 weight-compare',
        `no weight data found for any of the ${productIds.length} product(s) at the requested level`,
      );
    }

    return out;
  },
});
