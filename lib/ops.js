// Shared command implementations for tree / props / compare.
//
// The legacy command names (vop, weight, vop-compare…) are thin presets over
// these functions, so behaviour only needs fixing once and new data domains
// cost a table entry instead of three new files.
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { HOST, readCookie, getSettings } from './http.js';
import { resolveHierarchy, isMetaGroup } from './registry.js';
import {
  nodeConcurrency,
  listChildren,
  walkHierarchy,
  fetchNodeData,
  fetchBom,
  fetchProductName,
  resolveProduct,
  resolveProductList,
  mapPool,
  BOM_COLUMNS,
} from './engine.js';
import { extractGroups, parseGroups, toNumber } from './render.js';

// Property name (lowercase, unit stripped) → output column for the flattened
// weight view. `partCode` stays a string; everything else is numeric.
const WEIGHT_FIELDS = {
  'total weight': 'totalWeight_kg',
  'number of parts': 'partsCount',
  'number of fasteners': 'fastenersCount',
  'fastener(s) weight': 'fastenerWeight_kg',
  'part code': 'partCode',
};

const OVERVIEW_GROUPS = ['overview', '概览'];

let maxProductsCache = null;

/** `compare.max-products` from the platform settings, with a safe default. */
async function maxProducts(cookie, lang) {
  if (maxProductsCache) return maxProductsCache;
  try {
    const settings = await getSettings(cookie);
    const value = Number(settings?.['compare.max-products']);
    maxProductsCache = Number.isFinite(value) && value > 0 ? value : 25;
  } catch {
    maxProductsCache = 25;
  }
  return maxProductsCache;
}

function parseGroupList(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

async function prepare(page, args, preset = {}) {
  const cookie = await readCookie(page);
  const lang = args.lang ? String(args.lang) : undefined;
  const token = String(args.hierarchy ?? '').trim() || preset.hierarchy || '';
  const hierarchy = resolveHierarchy(token, ArgumentError);
  return { cookie, lang, hierarchy };
}

// --- tree -----------------------------------------------------------------

export async function runTree(page, args, preset = {}) {
  const { cookie, lang, hierarchy } = await prepare(page, args, preset);
  const parent = String(args.parent ?? '').trim();
  const depth = Number(args.depth ?? 1);
  const maxDepth = preset.maxDepth ?? 3;
  if (!Number.isInteger(depth) || depth < 1 || depth > maxDepth) {
    throw new ArgumentError(`depth must be 1..${maxDepth}`);
  }
  const limit = Number(args.limit ?? 200);
  if (!Number.isInteger(limit) || limit <= 0 || limit > 1000) {
    throw new ArgumentError('limit must be 1..1000');
  }

  const skipped = [];
  const rows = await walkHierarchy(cookie, {
    hierarchyId: hierarchy.id,
    parent,
    depth,
    limit,
    lang,
    onSkip: (nodeId, error) => skipped.push({ nodeId, reason: error?.message || String(error) }),
  });

  if (rows.length === 0) {
    throw new EmptyResultError(
      `a2mac1 ${preset.command || 'tree'}`,
      parent
        ? `no children under nodeId "${parent}" in hierarchy ${hierarchy.id}`
        : `no nodes under hierarchy ${hierarchy.id}`,
    );
  }
  if (skipped.length) warn(`skipped ${skipped.length} subtree(s) that failed to load`);
  return rows;
}

// --- props ----------------------------------------------------------------

export async function runProps(page, args, preset = {}) {
  const { cookie, lang, hierarchy } = await prepare(page, args, preset);

  const productArg = String(args.productId ?? '').trim();
  if (!productArg) throw new ArgumentError('productId is required (or pass a car name)');
  const productId = await resolveProduct(cookie, productArg, lang);

  const node = String(args.node ?? '').trim();
  if (!node) {
    throw new ArgumentError(
      '--node <nodeId> is required',
      `Run \`opencli a2mac1 tree --hierarchy ${hierarchy.alias || hierarchy.id}\` to browse nodeIds.`,
    );
  }

  const includeMeta = Boolean(args.includeMeta);
  const explicitGroups = parseGroupList(args.groups);

  let only = null;
  let dropMeta = false;
  if (explicitGroups) {
    only = explicitGroups;
  } else if (preset.groupMode === 'only') {
    only = preset.groups || OVERVIEW_GROUPS;
  } else if (!includeMeta) {
    dropMeta = true;
  }

  const data = await fetchNodeData(cookie, { productId, hierarchyId: hierarchy.id, nodeId: node, lang });
  const rows = parseGroups(extractGroups(data), { only, dropMeta, isMetaGroup });

  if (rows.length === 0) {
    throw new EmptyResultError(
      `a2mac1 ${preset.command || 'props'}`,
      `no properties for product=${productId}, node=${node} in ${hierarchy.label}` +
      (only ? ` (group filter: ${only.join(', ')})` : ''),
    );
  }
  return rows;
}

// --- compare --------------------------------------------------------------

export async function runCompare(page, args, preset = {}) {
  const { cookie, lang, hierarchy } = await prepare(page, args, preset);

  const max = await maxProducts(cookie, lang);
  const productIds = await resolveProductList(cookie, args.products, lang, max);

  const singleNode = String(args.node ?? '').trim();
  const parent = String(args.parent ?? '').trim();
  const depth = Number(args.depth ?? 1);
  const maxDepth = preset.maxDepth ?? 3;
  if (!Number.isInteger(depth) || depth < 1 || depth > maxDepth) {
    throw new ArgumentError(`depth must be 1..${maxDepth}`);
  }
  const limit = Number(args.limit ?? preset.defaultLimit ?? 1000);
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new ArgumentError('limit must be a positive integer');
  }

  // Node axis: a single --node, or every child under --parent expanded to --depth.
  let nodes;
  if (singleNode) {
    nodes = [{ id: singleNode, name: '' }];
  } else {
    const walked = await walkHierarchy(cookie, {
      hierarchyId: hierarchy.id,
      parent,
      depth,
      limit: 500,
      lang,
    });
    if (walked.length === 0) {
      throw new EmptyResultError(
        `a2mac1 ${preset.command || 'compare'}`,
        parent ? `no child nodes under "${parent}"` : `no nodes in hierarchy ${hierarchy.id}`,
      );
    }
    nodes = walked.map((n) => ({ id: n.nodeId, name: n.name }));
  }

  // Resolve display names once per product.
  const nameMap = new Map();
  for (const pid of productIds) {
    nameMap.set(pid, (await fetchProductName(cookie, pid, lang)) || pid);
  }

  const jobs = [];
  for (const pid of productIds) {
    for (const node of nodes) jobs.push({ productId: pid, nodeId: node.id, nodeName: node.name });
  }

  const flatten = preset.flatten || null;
  const includeMeta = Boolean(args.includeMeta);
  const explicitGroups = parseGroupList(args.groups);
  const filter = String(args.filter ?? '').trim().toLowerCase();

  let only = null;
  let dropMeta = false;
  if (explicitGroups) only = explicitGroups;
  else if (flatten) only = OVERVIEW_GROUPS;
  else if (!includeMeta) dropMeta = true;

  const rows = [];
  const failures = [];

  await mapPool(jobs, nodeConcurrency(), async (job) => {
    let data;
    try {
      data = await fetchNodeData(cookie, {
        productId: job.productId,
        hierarchyId: hierarchy.id,
        nodeId: job.nodeId,
        lang,
      });
    } catch (error) {
      if (error?.code === 'AUTH_REQUIRED') throw error;
      failures.push({ ...job, reason: error?.message || String(error) });
      return;
    }

    const parsed = parseGroups(extractGroups(data), { only, dropMeta, isMetaGroup });

    if (flatten === 'weight') {
      const fields = {};
      for (const row of parsed) {
        const key = WEIGHT_FIELDS[row.property.trim().toLowerCase()];
        if (!key) continue;
        if (key === 'partCode') fields.partCode = row.value === '' ? null : row.value;
        else fields[key] = toNumber(row.value);
      }
      rows.push({
        productId: job.productId,
        productName: nameMap.get(job.productId),
        system: job.nodeName,
        nodeId: job.nodeId,
        totalWeight_kg: fields.totalWeight_kg ?? null,
        partsCount: fields.partsCount ?? null,
        fastenersCount: fields.fastenersCount ?? null,
        fastenerWeight_kg: fields.fastenerWeight_kg ?? null,
        partCode: fields.partCode ?? null,
      });
      return;
    }

    for (const row of parsed) {
      if (filter && !row.property.toLowerCase().includes(filter)) continue;
      const out = {
        productId: job.productId,
        productName: nameMap.get(job.productId),
      };
      if (preset.includeNodeColumns) {
        out.nodeName = job.nodeName;
        out.nodeId = job.nodeId;
      }
      out.group = row.group;
      out.property = row.property;
      out.value = row.value;
      out.unit = row.unit;
      rows.push(out);
    }
  }, { shouldStop: () => rows.length >= limit });

  if (failures.length) {
    if (args.strict) {
      const sample = failures.slice(0, 3).map((f) => `product ${f.productId} node ${f.nodeId}: ${f.reason}`).join('; ');
      throw new EmptyResultError(
        `a2mac1 ${preset.command || 'compare'}`,
        `${failures.length}/${jobs.length} requests failed (${sample}). Drop --strict to ignore failed nodes.`,
      );
    }
    warn(`${failures.length}/${jobs.length} node request(s) failed and were skipped`);
  }

  // Preserve user product order, then hierarchy order.
  const productOrder = new Map(productIds.map((id, i) => [id, i]));
  const nodeOrder = new Map(nodes.map((n, i) => [n.id, i]));
  rows.sort((a, b) => {
    const byProduct = (productOrder.get(a.productId) ?? 0) - (productOrder.get(b.productId) ?? 0);
    if (byProduct !== 0) return byProduct;
    return (nodeOrder.get(a.nodeId ?? '') ?? 0) - (nodeOrder.get(b.nodeId ?? '') ?? 0);
  });

  const out = rows.slice(0, limit);
  if (out.length === 0) {
    throw new EmptyResultError(
      `a2mac1 ${preset.command || 'compare'}`,
      `no data for ${productIds.length} product(s) in ${hierarchy.label}` +
      (filter ? ` with filter "${filter}"` : ''),
    );
  }
  return out;
}

// --- bom (part level) -----------------------------------------------------

const BOM_SEPARATOR = ' > ';

/**
 * First entry of a BOM cell as a display string.
 *
 * Multi-value cells come back wrapped in `>a;b<` (the platform's list marker),
 * so the wrappers are stripped — "PC;PET" reads better in CSV than ">PC;PET<".
 */
function cellText(row, column) {
  const list = row?.data?.[column];
  if (!Array.isArray(list) || list.length === 0) return null;
  const value = list[0]?.formatedValue;
  let text = value === undefined || value === null ? '' : String(value).trim();
  if (text.startsWith('>')) text = text.slice(1);
  if (text.endsWith('<')) text = text.slice(0, -1);
  return text.trim() === '' ? null : text.trim();
}

/** First entry of a BOM cell as a number; `originalValue` is already numeric. */
function cellNumber(row, column) {
  const list = row?.data?.[column];
  if (!Array.isArray(list) || list.length === 0) return null;
  const entry = list[0];
  if (typeof entry?.originalValue === 'number') return entry.originalValue;
  const text = String(entry?.formatedValue ?? '').replace(/,/g, '').trim();
  if (text === '') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function splitBomId(id) {
  const text = String(id ?? '');
  const cut = text.indexOf('_');
  if (cut <= 0) return { productId: '', nodeId: text };
  return { productId: text.slice(0, cut), nodeId: text.slice(cut + 1) };
}

/**
 * Part-level BOM across one or more vehicles.
 *
 * The platform returns the whole table in one response (no paging when `page`
 * is omitted), with each row already labelled by its full node path, so this is
 * a single request plus local filtering — no per-node fan-out, no tree walk.
 */
export async function runBom(page, args, preset = {}) {
  const { cookie, lang, hierarchy } = await prepare(page, args, preset);

  const max = await maxProducts(cookie, lang);
  const productIds = await resolveProductList(cookie, args.products, lang, max);

  const limit = Number(args.limit ?? preset.defaultLimit ?? 2000);
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new ArgumentError('limit must be a positive integer');
  }
  const filter = String(args.filter ?? '').trim().toLowerCase();
  const nodeArg = String(args.node ?? '').trim();

  // Optional subtree restriction. The BOM endpoint has no node filter, so the
  // subtree is resolved from the hierarchy tree and applied locally.
  let subtree = null;
  if (nodeArg) {
    const depth = Number(args.depth ?? 3);
    if (!Number.isInteger(depth) || depth < 1 || depth > 8) {
      throw new ArgumentError('depth must be 1..8');
    }
    const walked = await walkHierarchy(cookie, {
      hierarchyId: hierarchy.id,
      parent: nodeArg,
      depth,
      limit: 5000,
      lang,
    });
    subtree = new Set([nodeArg, ...walked.map((n) => n.nodeId)]);
  }

  const payload = await fetchBom(cookie, { productIds, hierarchyId: hierarchy.id, lang });
  const rawRows = Array.isArray(payload?.rows) ? payload.rows : [];
  if (rawRows.length === 0) {
    // Only some domains carry BOM data; the endpoint answers with an empty body
    // for the rest, which is a "not available here" rather than a hard failure.
    throw new EmptyResultError(
      'a2mac1 bom',
      `no bill of materials for ${productIds.length} product(s) in ${hierarchy.label} ` +
      `(${hierarchy.id}). BOM is populated for teardown domains — try --hierarchy weight, ` +
      'or use `compare` for property-level data in this domain.',
    );
  }

  const nameMap = new Map();
  for (const pid of productIds) {
    nameMap.set(pid, (await fetchProductName(cookie, pid, lang)) || pid);
  }

  const rows = [];
  for (const raw of rawRows) {
    const { productId, nodeId } = splitBomId(raw?.id);
    if (!productId) continue;
    if (subtree && !subtree.has(nodeId)) continue;

    const path = cellText(raw, BOM_COLUMNS.node) || '';
    const segments = path ? path.split(BOM_SEPARATOR) : [];
    const node = segments.length ? segments[segments.length - 1] : '';
    const system = segments.length > 1 ? segments[0] : node;

    const width = cellNumber(raw, BOM_COLUMNS.width);
    const height = cellNumber(raw, BOM_COLUMNS.height);
    const depthMm = cellNumber(raw, BOM_COLUMNS.depth);

    const row = {
      productId,
      productName: nameMap.get(productId) || productId,
      system,
      node,
      nodeId,
      totalWeight_kg: cellNumber(raw, BOM_COLUMNS.totalWeight),
      partsCount: cellNumber(raw, BOM_COLUMNS.partsCount),
      fastenerWeight_kg: cellNumber(raw, BOM_COLUMNS.fastenerWeight),
      detailWeight_kg: cellNumber(raw, BOM_COLUMNS.detailWeight),
      partWeight_kg: cellNumber(raw, BOM_COLUMNS.partWeight),
      materialType: cellText(raw, BOM_COLUMNS.materialType),
      materialCode: cellText(raw, BOM_COLUMNS.materialCode),
      oemTiers: cellText(raw, BOM_COLUMNS.oemTiers),
      dimensions_mm: width && height && depthMm ? `${width} x ${height} x ${depthMm}` : null,
      path,
    };

    if (filter) {
      const haystack = [row.path, row.materialType, row.materialCode, row.oemTiers, row.node]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(filter)) continue;
    }

    // Rows that carry no measurement at all are structural placeholders.
    if (row.totalWeight_kg === null && row.partsCount === null && row.partWeight_kg === null) continue;

    rows.push(row);
  }

  if (rows.length === 0) {
    throw new EmptyResultError(
      'a2mac1 bom',
      `no parts matched in ${hierarchy.label}` +
      (filter ? ` with filter "${filter}"` : '') +
      (nodeArg ? ` under node ${nodeArg}` : ''),
    );
  }

  const productOrder = new Map(productIds.map((id, i) => [id, i]));
  rows.sort((a, b) => {
    const byProduct = (productOrder.get(a.productId) ?? 0) - (productOrder.get(b.productId) ?? 0);
    if (byProduct !== 0) return byProduct;
    return a.path.localeCompare(b.path);
  });

  const out = rows.slice(0, limit);
  if (rows.length > out.length) {
    warn(`showing ${out.length} of ${rows.length} part rows — raise --limit to see the rest`);
  }
  return out;
}

// --- helpers --------------------------------------------------------------

function warn(message) {
  process.stderr.write(`[a2mac1] ${message}\n`);
}

export { HOST };
