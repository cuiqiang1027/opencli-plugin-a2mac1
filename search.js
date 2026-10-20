// A2MAC1 quick-search — full-text search across products / parts / hierarchies.
// Endpoint discovered via Browser Bridge network capture:
//   POST https://ibp.a2mac1.com/api/quick-search?api-version=2.0
//   body: { search: "<query>" }
// Auth: cookie session (same as the IBP web UI). Returns up to ~25 products,
// any matching parts, and a list of hierarchies that contain the keyword
// with per-hierarchy hit counts.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { HOST, readCookie } from './lib/http.js';
import { quickSearch } from './lib/engine.js';

const SCOPES = new Set(['all', 'products', 'parts', 'hierarchies']);

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
    { name: 'lang', type: 'string', default: '', help: 'Accept-Language, e.g. en or zh-CN' },
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
    if (!Number.isInteger(limit) || limit <= 0) throw new ArgumentError('limit must be a positive integer');
    if (limit > 100) throw new ArgumentError('limit must be <= 100');

    const cookie = await readCookie(page);
    const data = await quickSearch(cookie, query, args.lang ? String(args.lang) : undefined);

    const out = [];
    const products = Array.isArray(data?.products) ? data.products : [];
    const parts = Array.isArray(data?.parts) ? data.parts : [];
    const hierarchies = Array.isArray(data?.hierarchies) ? data.hierarchies : [];

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
      for (const h of hierarchies) {
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

    if (out.length === 0) throw new EmptyResultError('a2mac1 search', `no results for "${query}"`);
    return out.slice(0, limit);
  },
});
