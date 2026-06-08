// A2MAC1 — list nodes under a given hierarchy (default: Vehicle Occupant Packaging).
// Endpoint: POST https://ibp.a2mac1.com/api/hierarchies/<hierarchyId>
//   body: {} (root) or { parentNodeId: '<id>' } (drill-down)
// Returns the node tree for a hierarchy. By default shows VOP top level
// (Schedule / Summary / 3D Data v3 / Package Measurements). Drill into any
// subtree by passing --parent <nodeId>.
//
// Practical use: find the nodeId you want for `opencli a2mac1 vop`.
//   opencli a2mac1 vop-tree                    # VOP root
//   opencli a2mac1 vop-tree --parent 000000093NWAEU01  # Package Measurements children
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
  name: 'vop-tree',
  description: 'A2MAC1 IBP — browse the Vehicle Occupant Packaging (or any) hierarchy tree',
  access: 'read',
  example: 'opencli a2mac1 vop-tree --parent 000000093NWAEU01',
  domain: HOST,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'hierarchy', type: 'string', default: HIERARCHY.VOP, help: 'Hierarchy ID (default = VOP)' },
    { name: 'parent', type: 'string', default: '', help: 'Parent nodeId; empty = root level' },
    { name: 'depth', type: 'int', default: 1, help: 'Recursion depth (1..3); >1 expands children automatically' },
    { name: 'limit', type: 'int', default: 200, help: 'Max rows (1..1000)' },
  ],
  columns: ['level', 'name', 'nodeId', 'parentId', 'hasChildren'],
  func: async (page, args) => {
    const hierarchyId = String(args.hierarchy || HIERARCHY.VOP).trim();
    const parent = String(args.parent || '').trim();
    const depth = Number(args.depth ?? 1);
    if (!Number.isInteger(depth) || depth < 1 || depth > 3) {
      throw new ArgumentError('depth must be 1..3');
    }
    const limit = Number(args.limit ?? 200);
    if (!Number.isInteger(limit) || limit <= 0 || limit > 1000) {
      throw new ArgumentError('limit must be 1..1000');
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
        throw new CommandExecutionError(`vop-tree request failed: ${error?.message || error}`);
      }
      if (resp.status === 401 || resp.status === 403) throw new AuthRequiredError(HOST);
      if (resp.status >= 300 && resp.status < 400) throw new AuthRequiredError(HOST);
      if (!resp.ok) throw new CommandExecutionError(`vop-tree failed: HTTP ${resp.status}`);
      let data;
      try {
        data = await resp.json();
      } catch (error) {
        throw new CommandExecutionError(`vop-tree: invalid JSON (${error?.message || error})`);
      }
      const nodes = Array.isArray(data?.hierarchyNodes) ? data.hierarchyNodes : [];
      const target = parentNodeId || null;
      return nodes.filter((n) => n?.parentId === target);
    }

    const out = [];
    const seen = new Set();

    async function walk(parentNodeId, currentDepth) {
      if (out.length >= limit) return;
      const children = await fetchLevel(parentNodeId);
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
          await walk(id, currentDepth + 1);
        }
      }
    }

    await walk(parent || null, 1);

    if (out.length === 0) {
      throw new EmptyResultError(
        'a2mac1 vop-tree',
        parent ? `no children under nodeId "${parent}"` : `no nodes under hierarchy "${hierarchyId}"`,
      );
    }
    return out;
  },
});
