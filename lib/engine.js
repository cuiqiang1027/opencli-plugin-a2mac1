// A2MAC1 engine: hierarchy walking, node data fetching, product resolution.
//
// All commands share these primitives, so endpoint URLs, caching and failure
// semantics only exist once.
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { BASE, requestJson } from './http.js';
import { getCached, setCached } from './cache.js';
import {
  DEFAULT_PRODUCT_TYPE_GROUP,
  PRODUCT_ID_RE,
} from './registry.js';

const NODE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// --- hierarchy ------------------------------------------------------------

/**
 * Direct children of `parentNodeId` (or root when null) in a hierarchy.
 * The endpoint returns the whole node table for the hierarchy and expects the
 * caller to filter — so we filter by parentId here, once.
 */
export async function listChildren(cookie, { hierarchyId, parentNodeId, lang }) {
  const cacheKey = `tree:${hierarchyId}:${lang || ''}:${parentNodeId || 'ROOT'}`;
  const cached = getCached(cacheKey, NODE_CACHE_TTL_MS);
  if (cached) return cached;

  const data = await requestJson(
    `${BASE}/api/hierarchies/${encodeURIComponent(hierarchyId)}`,
    {
      method: 'POST',
      body: parentNodeId ? { parentNodeId } : {},
      cookie,
      lang,
      what: `hierarchy ${hierarchyId} (parent ${parentNodeId || 'ROOT'})`,
    },
  );

  const nodes = Array.isArray(data?.hierarchyNodes) ? data.hierarchyNodes : [];
  const target = parentNodeId || null;
  const children = nodes
    .filter((n) => n?.parentId === target)
    .filter((n) => n?.id)
    .map((n) => ({
      id: String(n.id),
      name: String(n.name ?? ''),
      parentId: String(n.parentId ?? ''),
      level: Number(n.level ?? 0),
      hasChildren: Boolean(n.hasChildren),
    }));

  setCached(cacheKey, children);
  return children;
}

/**
 * Breadth-first walk of a hierarchy with a row cap.
 *
 * Children of every node in a level are fetched concurrently (previously the
 * walk was depth-first and fully sequential, which made `--depth 2` on a wide
 * system such as Body take minutes). Output order is level by level, which also
 * reads better than DFS: all first-level nodes, then all second-level nodes.
 *
 * A failing subtree is skipped rather than killing the whole walk (deep nodes
 * occasionally return 500 on the platform side) — except for the very first
 * level, where the error is the answer the user needs.
 */
export async function walkHierarchy(cookie, { hierarchyId, parent, depth, limit, lang, onSkip }) {
  const rows = [];
  const seen = new Set();

  let frontier = [parent || null];
  let level = 1;

  while (frontier.length > 0 && level <= depth && rows.length < limit) {
    const isFirstLevel = level === 1;

    const childLists = await mapPool(frontier, nodeConcurrency(), async (parentNodeId) => {
      try {
        return await listChildren(cookie, { hierarchyId, parentNodeId, lang });
      } catch (error) {
        if (isFirstLevel) throw error;
        onSkip?.(parentNodeId, error);
        return [];
      }
    });

    const next = [];
    for (const children of childLists) {
      for (const node of children) {
        if (rows.length >= limit) break;
        if (seen.has(node.id)) continue;
        seen.add(node.id);
        rows.push({
          level: Number.isFinite(node.level) ? node.level : level - 1,
          name: node.name,
          nodeId: node.id,
          parentId: node.parentId,
          hasChildren: node.hasChildren,
        });
        if (node.hasChildren && level < depth) next.push(node.id);
      }
    }

    frontier = next;
    level += 1;
  }

  return rows;
}

// --- node data ------------------------------------------------------------

/** Raw `/data` payload for one product at one node. */
export async function fetchNodeData(cookie, { productId, hierarchyId, nodeId, lang }) {
  const url = `${BASE}/api/products/${encodeURIComponent(productId)}` +
              `/hierarchies/${encodeURIComponent(hierarchyId)}` +
              `/nodes/${encodeURIComponent(nodeId)}/data` +
              `?hideMappedProperties=false&hideMappedProductTypesProperties=true` +
              `&hierarchyId=${encodeURIComponent(hierarchyId)}`;
  return requestJson(url, {
    method: 'POST',
    body: {},
    cookie,
    lang,
    what: `node data (product ${productId}, node ${nodeId})`,
  });
}

// --- products -------------------------------------------------------------

/** Display name for a product id; falls back to null (never throws). */
export async function fetchProductName(cookie, productId, lang) {
  const cacheKey = `product:${productId}:${lang || ''}`;
  const cached = getCached(cacheKey, NODE_CACHE_TTL_MS);
  if (cached !== null) return cached;

  try {
    const data = await requestJson(
      `${BASE}/api/products/${encodeURIComponent(productId)}` +
      `?productTypeGroupId=${encodeURIComponent(DEFAULT_PRODUCT_TYPE_GROUP)}` +
      `&hideMappedProductTypesProperties=false`,
      { cookie, lang, what: `product ${productId}` },
    );
    const name = [data?.name, data?.trim].filter(Boolean).join(' ') || data?.completeName || null;
    setCached(cacheKey, name);
    return name;
  } catch {
    return null;
  }
}

export async function quickSearch(cookie, query, lang) {
  return requestJson(`${BASE}/api/quick-search?api-version=2.0`, {
    method: 'POST',
    body: { search: query },
    cookie,
    lang,
    what: 'quick-search request',
  });
}

function productLabel(p) {
  const name = String(p?.productName ?? '').trim();
  const trim = String(p?.productTrim ?? '').trim();
  return [name, trim].filter(Boolean).join(' ');
}

/**
 * Accept either a raw productId or a free-text car name and return a productId.
 *
 * This is what removes the "search three times, copy three ids by hand" loop
 * from every comparison workflow.
 */
export async function resolveProduct(cookie, ref, lang) {
  const value = String(ref ?? '').trim();
  if (!value) throw new ArgumentError('empty product reference');
  if (PRODUCT_ID_RE.test(value)) return value;

  const data = await quickSearch(cookie, value, lang);
  const products = (Array.isArray(data?.products) ? data.products : [])
    .filter((p) => p?.productId);

  if (products.length === 0) {
    throw new ArgumentError(
      `no product matched "${value}"`,
      `Try a broader query: opencli a2mac1 search "${value}" --scope products`,
    );
  }

  const needle = value.toLowerCase();
  const exact = products.filter((p) => productLabel(p).toLowerCase() === needle);
  const pool = exact.length ? exact : products;

  if (pool.length === 1) return String(pool[0].productId);

  const candidates = pool
    .slice(0, 8)
    .map((p) => `${p.productId}  ${productLabel(p)}`)
    .join('\n  ');
  throw new ArgumentError(
    `"${value}" is ambiguous — ${pool.length} products match`,
    `Pass the productId explicitly, one of:\n  ${candidates}`,
  );
}

/** Resolve a comma-separated list of ids and/or names. */
export async function resolveProductList(cookie, raw, lang, max) {
  const refs = [...new Set(String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean))];
  if (refs.length === 0) {
    throw new ArgumentError('products is required (comma-separated productIds or car names)');
  }
  if (max && refs.length > max) {
    throw new ArgumentError(
      `compare supports up to ${max} products at once`,
      'Split the comparison into smaller batches.',
    );
  }

  const ids = [];
  for (const ref of refs) {
    ids.push(await resolveProduct(cookie, ref, lang));
  }
  return [...new Set(ids)];
}

// --- concurrency ----------------------------------------------------------

/**
 * Parallel request budget for node data.
 *
 * Browser-backed commands are killed by opencli after
 * OPENCLI_BROWSER_COMMAND_TIMEOUT seconds (60 by default), so a wide
 * `compare --depth 2` has to finish inside that window. 8 in flight keeps the
 * platform happy and a 150-request batch under ~25s; override with
 * A2MAC1_CONCURRENCY when the API starts pushing back.
 */
export function nodeConcurrency() {
  const raw = Number(process.env.A2MAC1_CONCURRENCY);
  if (Number.isFinite(raw) && raw > 0) return Math.min(16, Math.floor(raw));
  return 8;
}

/**
 * Run `worker` over `items` with a hard concurrency ceiling.
 *
 * The previous implementation used a `Promise.race` guard that was evaluated
 * *after* starting the next request, so the real concurrency drifted above the
 * intended cap. This version never has more than `concurrency` workers alive.
 *
 * `shouldStop` is checked before each item so batch commands can bail out early
 * once they have enough rows.
 */
export async function mapPool(items, concurrency, worker, { shouldStop } = {}) {
  const results = new Array(items.length);
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;

  async function runner() {
    for (;;) {
      if (shouldStop?.()) return;
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runner()));
  return results;
}

// --- shared guards --------------------------------------------------------

export function ensureRows(rows, command, detail) {
  if (!rows || rows.length === 0) throw new EmptyResultError(command, detail);
  return rows;
}
