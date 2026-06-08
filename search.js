// A2MAC1 quick-search — full-text search across products / parts / hierarchies.
// Endpoint discovered via Browser Bridge network capture:
//   POST https://ibp.a2mac1.com/api/quick-search?api-version=2.0
//   body: { search: "<query>" }
// Auth: cookie session (same as the IBP web UI). Returns up to ~25 products,
// any matching parts, and a list of hierarchies that contain the keyword
// with per-hierarchy hit counts.
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  ArgumentError,
  AuthRequiredError,
  CommandExecutionError,
  EmptyResultError,
} from '@jackwener/opencli/errors';

const HOST = 'ibp.a2mac1.com';
const BASE = `https://${HOST}`;
const ROOT = '.a2mac1.com';
const ENDPOINT = `${BASE}/api/quick-search?api-version=2.0`;

const SCOPES = new Set(['all', 'products', 'parts', 'hierarchies']);

async function readCookie(page) {
  const seen = new Map();
  for (const opts of [{ domain: HOST }, { domain: ROOT }]) {
    try {
      const cookies = await page.getCookies(opts);
      for (const c of cookies || []) {
        if (!seen.has(c.name)) seen.set(c.name, c.value);
      }
    } catch {
      /* try next domain */
    }
  }
  return [...seen].map(([k, v]) => `${k}=${v}`).join('; ');
}

cli({
  site: 'a2mac1',
  name: 'search',
  description: 'A2MAC1 IBP quick-search (products / parts / hierarchies)',
  access: 'read',
  example: 'opencli a2mac1 search "Xiaomi YU7"',
  domain: HOST,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'query', type: 'string', required: true, positional: true, default: '', help: 'Free-text query (vehicle / part / keyword)' },
    { name: 'scope', type: 'string', default: 'all', help: 'all | products | parts | hierarchies' },
    { name: 'limit', type: 'int', default: 25, help: 'Max rows (1..100)' },
  ],
  columns: ['kind', 'name', 'detail', 'productType', 'id', 'extra'],
  func: async (page, args) => {
    const query = String(args.query ?? '').trim();
    if (!query) throw new ArgumentError('query must be a non-empty string');
    const scope = String(args.scope ?? 'all').toLowerCase();
    if (!SCOPES.has(scope)) {
      throw new ArgumentError(`scope must be one of: ${[...SCOPES].join(', ')}`);
    }
    const limit = Number(args.limit ?? 25);
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new ArgumentError('limit must be a positive integer');
    }
    if (limit > 100) throw new ArgumentError('limit must be <= 100');

    const cookie = await readCookie(page);
    if (!cookie) throw new AuthRequiredError(HOST);

    let resp;
    try {
      resp = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Referer: `${BASE}/`,
          Cookie: cookie,
        },
        body: JSON.stringify({ search: query }),
        redirect: 'manual',
      });
    } catch (error) {
      throw new CommandExecutionError(
        `quick-search request failed: ${error?.message || error}`,
      );
    }

    if (resp.status === 401 || resp.status === 403) throw new AuthRequiredError(HOST);
    if (resp.status >= 300 && resp.status < 400) throw new AuthRequiredError(HOST);
    if (!resp.ok) throw new CommandExecutionError(`quick-search failed: HTTP ${resp.status}`);

    let data;
    try {
      data = await resp.json();
    } catch (error) {
      throw new CommandExecutionError(`quick-search: invalid JSON (${error?.message || error})`);
    }

    const out = [];
    const products = Array.isArray(data?.products) ? data.products : [];
    const parts = Array.isArray(data?.parts) ? data.parts : [];
    const hiers = Array.isArray(data?.hierarchies) ? data.hierarchies : [];

    if (scope === 'all' || scope === 'products') {
      for (const p of products) {
        out.push({
          kind: 'product',
          name: p?.productName ?? '',
          detail: p?.productTrim ?? '',
          productType: p?.productTypeName ?? '',
          id: p?.productId ?? '',
          extra: p?.isIb ? 'IB' : '',
        });
      }
    }

    if (scope === 'all' || scope === 'parts') {
      for (const p of parts) {
        out.push({
          kind: 'part',
          name: p?.partName ?? p?.name ?? '',
          detail: p?.partNumber ?? p?.partTrim ?? '',
          productType: p?.productTypeName ?? '',
          id: p?.partId ?? p?.id ?? '',
          extra: '',
        });
      }
    }

    if (scope === 'all' || scope === 'hierarchies') {
      for (const h of hiers) {
        out.push({
          kind: 'hierarchy',
          name: h?.hierarchyName ?? '',
          detail: '',
          productType: h?.productTypeName ?? '',
          id: h?.hierarchyId ?? '',
          extra: Number.isFinite(h?.resultCount) ? `${h.resultCount} hits` : '',
        });
      }
    }

    if (out.length === 0) {
      throw new EmptyResultError('a2mac1 search', `no results for "${query}"`);
    }

    return out.slice(0, limit);
  },
});
