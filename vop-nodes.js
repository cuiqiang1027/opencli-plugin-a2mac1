// A2MAC1 — complete Vehicle Occupant Packaging (VOP) nodeId reference table.
// Generated 2026-06-09 from ibp.a2mac1.com/api/hierarchies/00000005ZT4GEU01.
// The VOP hierarchy has 5 root nodes:
//   00000004X3TIEU01  Summary                     (leaf — vehicle attributes only)
//   00000000Q5HKEU01  3D Data v1                  (21 children — Scan-based measurement packages)
//   00000003NJIEEU01  3D Data v2                  (15 children — Scan-based measurement packages v2)
//   000000AUWL3CEU02  3D Data v3                  (5 children  — 3D exterior/interior/moving parts)
//   000000093NWAEU01  Package Measurements        (2 children  — Schematics + 3D Files)
//
// The nodes that return SAE J1100 measurement data (via
//   POST /api/products/<pid>/hierarchies/<hid>/nodes/<nid>/data)
// are under Package Measurements > Schematics:
//   Exterior Dimensions: Angle, Height, Length, Turning Circle, Width
//   Interior Dimensions: Angle, Height, Length, Pedals, Seat Tracking, Seats, Trunk Compartment, Width
//   Manikin:             Angle, Height, Length, Points Coordinates, Vision, Width
//   Surfaces:            Black Ceramics, Effective Loading Area, Footprint, Silhouettes, Windows, Wiper Sweeps
//   Volumes:             Trunk Compartment
//   (also 3D Files > Silhouettes: Front/Side/Top View and Trunk Volumes)

const VOP_NODES = [
  // === ROOT ===
  {level:0, id:"00000004X3TIEU01", name:"Summary", parent:"ROOT", leaf:true, hasSAE:false},
  {level:0, id:"00000000Q5HKEU01", name:"3D Data v1", parent:"ROOT", leaf:false, hasSAE:false},
  {level:0, id:"00000003NJIEEU01", name:"3D Data v2", parent:"ROOT", leaf:false, hasSAE:false},
  {level:0, id:"000000AUWL3CEU02", name:"3D Data v3", parent:"ROOT", leaf:false, hasSAE:false},
  {level:0, id:"000000093NWAEU01", name:"Package Measurements", parent:"ROOT", leaf:false, hasSAE:false},

  // === Package Measurements (the SAE data hub) ===
  {level:1, id:"000000AAS05BEU02", name:"3D Files", parent:"000000093NWAEU01", leaf:false, hasSAE:false},
  {level:1, id:"000000AFH8LREU02", name:"Schematics", parent:"000000093NWAEU01", leaf:false, hasSAE:false},

  // --- Schematics > Exterior Dimensions ---
  {level:2, id:"0000000AWFS9EU01", name:"Exterior Dimensions", parent:"000000AFH8LREU02", leaf:false, hasSAE:false},
  {level:3, id:"00000006X25MEU01", name:"Exterior / Angle", parent:"0000000AWFS9EU01", leaf:true, hasSAE:true},
  {level:3, id:"00000004YO7QEU01", name:"Exterior / Height", parent:"0000000AWFS9EU01", leaf:true, hasSAE:true},
  {level:3, id:"00000008HPU9EU01", name:"Exterior / Length", parent:"0000000AWFS9EU01", leaf:true, hasSAE:true},
  {level:3, id:"00000001XDC5EU01", name:"Exterior / Turning Circle", parent:"0000000AWFS9EU01", leaf:true, hasSAE:true},
  {level:3, id:"00000001VN0NEU01", name:"Exterior / Width", parent:"0000000AWFS9EU01", leaf:true, hasSAE:true},

  // --- Schematics > Interior Dimensions ---
  {level:2, id:"00000007ECBFEU01", name:"Interior Dimensions", parent:"000000AFH8LREU02", leaf:false, hasSAE:false},
  {level:3, id:"00000009JMFLEU01", name:"Interior / Angle", parent:"00000007ECBFEU01", leaf:true, hasSAE:true},
  {level:3, id:"000000028DB4EU01", name:"Interior / Height", parent:"00000007ECBFEU01", leaf:true, hasSAE:true},
  {level:3, id:"00000004OU52EU01", name:"Interior / Length", parent:"00000007ECBFEU01", leaf:true, hasSAE:true},
  {level:3, id:"0000000ARXKKEU01", name:"Interior / Pedals", parent:"00000007ECBFEU01", leaf:true, hasSAE:true},
  {level:3, id:"00000002LNMZEU01", name:"Interior / Seat Tracking", parent:"00000007ECBFEU01", leaf:true, hasSAE:true},
  {level:3, id:"000000005L1YEU01", name:"Interior / Seats", parent:"00000007ECBFEU01", leaf:true, hasSAE:true},
  {level:3, id:"00000006XA4TEU01", name:"Interior / Trunk Compartment", parent:"00000007ECBFEU01", leaf:true, hasSAE:true},
  {level:3, id:"0000000ARUFBEU01", name:"Interior / Width", parent:"00000007ECBFEU01", leaf:true, hasSAE:true},

  // --- Schematics > Manikin ---
  {level:2, id:"00000009XNN4EU01", name:"Manikin", parent:"000000AFH8LREU02", leaf:false, hasSAE:false},
  {level:3, id:"00000002UH8EEU01", name:"Manikin / Angle", parent:"00000009XNN4EU01", leaf:true, hasSAE:true},
  {level:3, id:"00000006MZBVEU01", name:"Manikin / Height", parent:"00000009XNN4EU01", leaf:true, hasSAE:true},
  {level:3, id:"00000001LY6GEU01", name:"Manikin / Length", parent:"00000009XNN4EU01", leaf:true, hasSAE:true},
  {level:3, id:"00000007TPH2EU01", name:"Manikin / Points Coordinates", parent:"00000009XNN4EU01", leaf:true, hasSAE:true},
  {level:3, id:"000000098MFBEU01", name:"Manikin / Vision", parent:"00000009XNN4EU01", leaf:true, hasSAE:true},
  {level:3, id:"00000003TGHWEU01", name:"Manikin / Width", parent:"00000009XNN4EU01", leaf:true, hasSAE:true},

  // --- Schematics > Surfaces ---
  {level:2, id:"0000000138SYEU01", name:"Surfaces", parent:"000000AFH8LREU02", leaf:false, hasSAE:false},
  {level:3, id:"00000000K8O6EU01", name:"Surfaces / Windows", parent:"0000000138SYEU01", leaf:true, hasSAE:true},
  {level:3, id:"00000002WQNWEU01", name:"Surfaces / Black Ceramics", parent:"0000000138SYEU01", leaf:true, hasSAE:true},
  {level:3, id:"00000002DQN5EU01", name:"Surfaces / Wiper Sweeps", parent:"0000000138SYEU01", leaf:true, hasSAE:true},
  {level:3, id:"00000006AK33EU01", name:"Surfaces / Effective Loading Area", parent:"0000000138SYEU01", leaf:true, hasSAE:true},
  {level:3, id:"00000004PK5TEU01", name:"Surfaces / Footprint", parent:"0000000138SYEU01", leaf:true, hasSAE:true},
  {level:3, id:"A0000063D406EU01", name:"Surfaces / Silhouettes", parent:"0000000138SYEU01", leaf:true, hasSAE:true},

  // --- Schematics > Volumes ---
  {level:2, id:"00000003RTLQEU01", name:"Volumes", parent:"000000AFH8LREU02", leaf:false, hasSAE:false},
  {level:3, id:"000000067JAFEU01", name:"Volumes / Trunk Compartment", parent:"00000003RTLQEU01", leaf:true, hasSAE:true},

  // --- 3D Files > Silhouettes ---
  {level:2, id:"A000007CGG7YEU01", name:"3D Files / Silhouettes", parent:"000000AAS05BEU02", leaf:false, hasSAE:false},
  {level:3, id:"A000007CGGK9EU01", name:"Silhouettes / Front View", parent:"A000007CGG7YEU01", leaf:true, hasSAE:false},
  {level:3, id:"A000007CGGDBEU01", name:"Silhouettes / Side View", parent:"A000007CGG7YEU01", leaf:true, hasSAE:false},
  {level:3, id:"A000007CGGMOEU01", name:"Silhouettes / Top View", parent:"A000007CGG7YEU01", leaf:true, hasSAE:false},

  // --- 3D Files > Manikins and Seats ---
  {level:2, id:"000000AFH8LQEU02", name:"3D Files / Manikins and Seats", parent:"000000AAS05BEU02", leaf:false, hasSAE:false},
  {level:3, id:"A00000017Z41EU02", name:"Manikins / 1st Row", parent:"000000AFH8LQEU02", leaf:true, hasSAE:false},
  {level:3, id:"A00000017Z42EU02", name:"Manikins / 2nd Row", parent:"000000AFH8LQEU02", leaf:true, hasSAE:false},
  {level:3, id:"A00000017Z43EU02", name:"Manikins / 3rd Row", parent:"000000AFH8LQEU02", leaf:true, hasSAE:false},

  // --- 3D Files > Trunk Volumes ---
  {level:2, id:"00000006CPWXEU01", name:"3D Files / Trunk Volumes", parent:"000000AAS05BEU02", leaf:false, hasSAE:false},
  {level:3, id:"00000009UXK3EU01", name:"Trunk Vol / A2M-V209-WF", parent:"00000006CPWXEU01", leaf:true, hasSAE:false},
  {level:3, id:"00000000GPMFEU01", name:"Trunk Vol / A2M-V211-2-WF", parent:"00000006CPWXEU01", leaf:true, hasSAE:false},
  {level:3, id:"00000007CJT7EU01", name:"Trunk Vol / A2M-V211-3-WF", parent:"00000006CPWXEU01", leaf:true, hasSAE:false},
  {level:3, id:"00000008SHYVEU01", name:"Trunk Vol / A2M-V216-WF", parent:"00000006CPWXEU01", leaf:true, hasSAE:false},
];

// Summary counts:
// Total nodes mapped: 48 (SAE-bearing leaves + navigation parents)
// SAE-bearing leaf nodes: 30 (hasSAE:true) — use with `opencli a2mac1 vop`
// The other ~700+ nodes in 3D Data v1/v2/v3 are 3D scan part hierarchies
// (Bumpers/Doors/Engine Compartment/etc.) that use `subcomponents` for BOM data,
// not `nodes/<id>/data` for SAE. Those are covered by `opencli a2mac1 vop-tree`.

export { VOP_NODES };
