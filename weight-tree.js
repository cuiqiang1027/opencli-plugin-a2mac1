// A2MAC1 — browse the 3D AutoReverse weight hierarchy.
// Endpoint: POST https://ibp.a2mac1.com/api/hierarchies/<hierarchyId>
//   body: {} (root) or { parentNodeId: '<id>' } (drill-down)
//
// Use this to find system and sub-system nodeIds before pulling weight data
// with `opencli a2mac1 weight` or `opencli a2mac1 weight-compare`.
//
// The 3D AutoReverse hierarchy exposes 22 vehicle-system categories at root
// (Body, Interior, Seats, Electrical, Suspension, etc.), each with sub-system
// children where teardown weight data is available.
//
//   opencli a2mac1 weight-tree                   # all 22 system categories
//   opencli a2mac1 weight-tree --parent 00000004QH72EU01  # Body sub-systems
//   opencli a2mac1 weight-tree --depth 2               # auto-expand one level
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

cli({
  site: 'a2mac1',
  name: 'weight-tree',
  description: 'A2MAC1 — browse the 3D AutoReverse weight hierarchy tree',
  access: 'read',
  example: 'opencli a2mac1 weight-tree --parent 00000004QH72EU01',
  domain: HOST,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'hierarchy', type: 'string', default: HIERARCHY.THREE_D_AUTOREVERSE, help: 'Hierarchy ID (default = 3D AutoReverse)' },
    { name: 'parent', type: 'string', default: '', help: 'Parent nodeId; empty = root level (vehicle systems)' },
    { name: 'depth', type: 'int', default: 1, help: 'Recursion depth (1..2); >1 expands children automatically' },
    { name: 'limit', type: 'int', default: 200, help: 'Max rows (1..500)' },
  ],
  columns: ['level', 'name', 'nodeId', 'parentId', 'hasChildren'],
  func: async (page, args) => {
    const hierarchyId = String(args.hierarchy || HIERARCHY.THREE_D_AUTOREVERSE).trim();
    const parent = String(args.parent || '').trim();
    const depth = Number(args.depth ?? 1);
    if (!Number.isInteger(depth) || depth < 1 || depth > 2) {
      throw new ArgumentError('depth must be 1..2 (deeper levels may be unreliable)');
    }
    const limit = Number(args.limit ?? 200);
    if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
      throw new ArgumentError('limit must be 1..500');
    }

    const cookie = await readCookie(page);
    if (!cookie) throw new AuthRequiredError(HOST);

    const url = `${BASE}/api/hierarchies/${encodeURIComponent(hierarchyId)}`;

    async function fetchLevel(parentNodeId) {
      const body = parentNodeId ? { parentNodeId } : {};
      let resp;
      try {
        resp = await fetch(url, {
          method: 'POST',
          headers: authHeaders(cookie),
          body: JSON.stringify(body),
          redirect: 'manual',
        });
      } catch (error) {
        throw new CommandExecutionError(`weight-tree request failed: ${error?.message || error}`);
      }
      if (resp.status === 401 || resp.status === 403) throw new AuthRequiredError(HOST);
      if (resp.status >= 300 && resp.status < 400) throw new AuthRequiredError(HOST);
      if (!resp.ok) {
        // 500s happen on deep nodes — surface gracefully
        throw new CommandExecutionError(`weight-tree: HTTP ${resp.status} for parent "${parentNodeId || 'ROOT'}"`);
      }
      let data;
      try {
        data = await resp.json();
      } catch (error) {
        throw new CommandExecutionError(`weight-tree: invalid JSON (${error?.message || error})`);
      }
      const nodes = Array.isArray(data?.hierarchyNodes) ? data.hierarchyNodes : [];
      const target = parentNodeId || null;
      return nodes.filter((n) => n?.parentId === target);
    }

    const out = [];
    const seen = new Set();

    async function walk(parentNodeId, currentDepth) {
      if (out.length >= limit) return;
      let children;
      try {
        children = await fetchLevel(parentNodeId);
      } catch {
        // If a subtree fails, skip it rather than killing the whole walk
        return;
      }
      for (const node of children) {
        if (out.length >= limit) return;
        const id = String(node?.id ?? '');
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push({
          level: Number(node?.level ?? currentDepth - 1),
          name: String(node?.name ?? ''),
          nodeId: id,
          parentId: String(node?.parentId ?? ''),
          hasChildren: Boolean(node?.hasChildren),
        });
        if (currentDepth < depth && node?.hasChildren) {
          try {
            await walk(id, currentDepth + 1);
          } catch {
            // skip failing sub-trees
          }
        }
      }
    }

    await walk(parent || null, 1);

    if (out.length === 0) {
      throw new EmptyResultError(
        'a2mac1 weight-tree',
        parent ? `no children under nodeId "${parent}"` : `no nodes under hierarchy "${hierarchyId}"`,
      );
    }
    return out;
  },
});
