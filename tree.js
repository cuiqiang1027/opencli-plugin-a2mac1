// A2MAC1 — browse any data-domain hierarchy.
//
// One tree walker for every domain. The domain is selected by alias
// (`opencli a2mac1 hierarchies` lists them) or by raw hierarchyId.
//
//   opencli a2mac1 tree                                  # 3D AutoReverse root
//   opencli a2mac1 tree --hierarchy vop --depth 3         # VOP down to SAE leaves
//   opencli a2mac1 tree --hierarchy electronics --parent <nodeId>
import { cli, Strategy } from '@jackwener/opencli/registry';
import { HOST } from './lib/http.js';
import { runTree } from './lib/ops.js';

cli({
  site: 'a2mac1',
  name: 'tree',
  description: 'A2MAC1 — browse any data-domain hierarchy (default: 3D AutoReverse)',
  access: 'read',
  example: 'opencli a2mac1 tree --hierarchy vop --depth 3',
  domain: HOST,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'hierarchy', type: 'string', default: 'weight', help: 'Data domain alias or hierarchyId (see `opencli a2mac1 hierarchies`)' },
    { name: 'parent', type: 'string', default: '', help: 'Parent nodeId; empty = root level' },
    { name: 'depth', type: 'int', default: 1, help: 'Recursion depth (1..3); >1 expands children automatically' },
    { name: 'limit', type: 'int', default: 200, help: 'Max rows (1..1000)' },
    { name: 'lang', type: 'string', default: '', help: 'Accept-Language, e.g. en or zh-CN' },
  ],
  columns: ['level', 'name', 'nodeId', 'parentId', 'hasChildren'],
  func: (page, args) => runTree(page, args, {
    command: 'tree',
    hierarchy: 'weight',
    maxDepth: 3,
  }),
});
