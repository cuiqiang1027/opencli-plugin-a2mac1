// A2MAC1 — show the complete SAE-bearing VOP node reference table.
// Reads from the bundled vop-nodes.js map (generated from a full recursive walk
// of the ibp.a2mac1.com/api/hierarchies/00000005ZT4GEU01 endpoint).
// Use this to find the nodeId you need for `opencli a2mac1 vop` or `vop-compare`.
//
//   opencli a2mac1 vop-list              # all 48 nodes
//   opencli a2mac1 vop-list --sae-only   # only SAE-bearing leaf nodes
//   opencli a2mac1 vop-list --leaves     # all leaf nodes (SAE + 3D)
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { VOP_NODES } from './vop-nodes.js';

cli({
  site: 'a2mac1',
  name: 'vop-list',
  description: 'A2MAC1 VOP — static nodeId reference table (48 nodes, 30 SAE-bearing leaves)',
  access: 'read',
  example: 'opencli a2mac1 vop-list --sae-only',
  domain: 'ibp.a2mac1.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'sae-only', type: 'bool', default: false, help: 'Only show nodes that return SAE J1100 data' },
    { name: 'leaves', type: 'bool', default: false, help: 'Only show leaf nodes' },
  ],
  columns: ['level', 'name', 'nodeId', 'parentId', 'hasSAE'],
  func: async (args) => {
    let rows = [...VOP_NODES];
    if (args['sae-only']) rows = rows.filter((n) => n.hasSAE);
    if (args.leaves) rows = rows.filter((n) => n.leaf);
    return rows.map((n) => ({
      level: n.level,
      name: n.name,
      nodeId: n.id,
      parentId: n.parent,
      hasSAE: n.hasSAE,
    }));
  },
});
