// A2MAC1 data-domain registry: hierarchy aliases, ids and per-domain presets.
//
// A2MAC1 exposes many "hierarchies" (data domains) behind the same endpoint
// shape. Keeping them in one table means adding a domain is a one-line change
// instead of three new adapter files.

// Hierarchy ids confirmed against the live platform.
export const HIERARCHY = {
  VOP: '00000005ZT4GEU01',
  THREE_D_AUTOREVERSE: '00000003LSK4EU01',
  ELECTRONICS: '00000003O8LHEU01',
  XEV_POWERTRAIN: '0000009X67MIEU02',
  ELECTRICAL_ARCH: '00000000HVNTEU01',
  CELL_ANALYSIS: '0000002R4ZBVEU01',
  SCHEDULE_CONTENT: '0000005AE6M1EU01',
};

// Default product-type scope for name lookups (Technology Insights products).
export const DEFAULT_PRODUCT_TYPE_GROUP = '$000000000000001';

// Product ids look like A0000077HXAOEU01 / 00000004R3WAEU01.
export const PRODUCT_ID_RE = /^[A-Z0-9]{12,20}$/i;

/**
 * Known data domains.
 *
 * `status` records what was actually verified against the live platform:
 *   ready        root level returns nodes, usable end to end
 *   empty-root   the hierarchy id resolves but returns no root nodes — these
 *                behave like package trees and need a parent nodeId to drill
 *   needs-recon  advertised by A2MAC1 but the hierarchyId was never captured
 *
 * `hierarchies` reports this honestly instead of letting a command fail with a
 * confusing empty result.
 */
export const DOMAINS = [
  {
    alias: 'weight',
    id: HIERARCHY.THREE_D_AUTOREVERSE,
    label: '3D AutoReverse',
    status: 'ready',
    summary: 'Teardown mass, part counts and fasteners per vehicle system',
  },
  {
    alias: 'vop',
    id: HIERARCHY.VOP,
    label: 'Vehicle Occupant Packaging',
    status: 'ready',
    summary: 'SAE J1100 interior/exterior dimensions, manikin, volumes',
  },
  {
    alias: 'electronics',
    id: HIERARCHY.ELECTRONICS,
    label: 'Electronics',
    status: 'ready',
    summary: 'ECU studies: per-vehicle electronic module benchmarking',
  },
  {
    alias: 'xev',
    id: HIERARCHY.XEV_POWERTRAIN,
    label: 'xEV Powertrain',
    status: 'ready',
    summary: 'Battery pack, e-machine, inverter and thermal systems',
  },
  {
    alias: 'eearch',
    id: HIERARCHY.ELECTRICAL_ARCH,
    label: 'Electrical Architecture',
    status: 'ready',
    summary: 'Harness studies and electrical distribution',
  },
  {
    alias: 'cell',
    id: HIERARCHY.CELL_ANALYSIS,
    label: 'Cell Analysis',
    status: 'empty-root',
    summary: 'Battery cell teardown — root level empty, drill with --parent',
  },
  {
    alias: 'planning',
    id: HIERARCHY.SCHEDULE_CONTENT,
    label: 'Planning / Schedule Content',
    status: 'empty-root',
    summary: 'Teardown pipeline — root level empty, drill with --parent',
  },
  { alias: 'biw', id: null, status: 'needs-recon', label: 'Body-in-White', summary: 'BIW structure benchmarking' },
  { alias: 'chassis', id: null, status: 'needs-recon', label: 'Chassis', summary: 'Chassis and suspension benchmarking' },
  { alias: 'ims', id: null, status: 'needs-recon', label: 'Interior Master Sections', summary: 'Interior master sections' },
  { alias: 'ems', id: null, status: 'needs-recon', label: 'Exterior Master Sections', summary: 'Exterior master sections' },
  { alias: 'hmi', id: null, status: 'needs-recon', label: 'HMI Experience', summary: 'HMI / UX benchmarking' },
  { alias: 'van', id: null, status: 'needs-recon', label: 'Van Insights', summary: 'Light commercial vehicle benchmarking' },
];

const DOMAIN_BY_ALIAS = new Map(DOMAINS.map((d) => [d.alias, d]));

// Friendly aliases people actually type.
const ALIAS_ALIASES = new Map([
  ['3d', 'weight'],
  ['3dar', 'weight'],
  ['autoreverse', 'weight'],
  ['3d-autoreverse', 'weight'],
  ['powertrain', 'xev'],
  ['electrical', 'eearch'],
  ['electrical-architecture', 'eearch'],
  ['battery', 'cell'],
  ['schedule', 'planning'],
  ['body', 'biw'],
  ['body-in-white', 'biw'],
]);

export function listDomains({ all = false } = {}) {
  const rows = DOMAINS.map((d) => ({
    alias: d.alias,
    hierarchyId: d.id || '',
    label: d.label,
    status: d.status,
    summary: d.summary,
  }));
  return all ? rows : rows.filter((r) => r.status === 'ready');
}

/**
 * Accept an alias ("weight", "biw") or a raw hierarchyId and return
 * { alias, id, label }. Throws an actionable ArgumentError when the domain is
 * known but its id was never captured, or when nothing matches.
 */
export function resolveHierarchy(token, ArgumentError) {
  const raw = String(token ?? '').trim();
  if (!raw) {
    throw new ArgumentError(
      'hierarchy is required (alias or hierarchyId)',
      `Known aliases: ${DOMAINS.map((d) => d.alias).join(', ')}`,
    );
  }

  const lower = raw.toLowerCase();
  const alias = DOMAIN_BY_ALIAS.has(lower) ? lower : ALIAS_ALIASES.get(lower);
  if (alias) {
    const domain = DOMAIN_BY_ALIAS.get(alias);
    if (!domain.id) {
      throw new ArgumentError(
        `data domain "${alias}" (${domain.label}) has no captured hierarchyId yet`,
        'Its hierarchy id still needs a network recon. Meanwhile, use a command with --hierarchy <id> once you have the id, or pick another alias.',
      );
    }
    return { alias, id: domain.id, label: domain.label };
  }

  // Raw hierarchy id — pass through untouched.
  if (PRODUCT_ID_RE.test(raw)) {
    return { alias: '', id: raw, label: raw };
  }

  throw new ArgumentError(
    `unknown hierarchy "${raw}"`,
    `Use an alias (${DOMAINS.map((d) => d.alias).join(', ')}) or a raw hierarchyId.`,
  );
}

// --- property-group handling ---------------------------------------------

// Groups that carry catalogue metadata rather than measurements. Matched
// case-insensitively and bilingually, because the API localises group names.
// NOTE: "Overview" is deliberately absent — for weight that group *is* the data.
const META_GROUP_NAMES = new Set([
  '概览',
  '基本信息',
  '文件',
  'media gallery',
  'general information',
  'files',
  'media',
  'attachments',
]);

export function isMetaGroup(name) {
  return META_GROUP_NAMES.has(String(name ?? '').trim().toLowerCase());
}

/**
 * Per-domain presets used by the legacy command names (vop / weight / …).
 * New commands take these as defaults but can override via --groups.
 */
export const PRESETS = {
  vop: {
    hierarchy: 'vop',
    groupMode: 'dropMeta',
  },
  weight: {
    hierarchy: 'weight',
    // The Overview group holds Total Weight / Number of Parts / Part Code.
    groupMode: 'only',
    groups: ['overview', '概览'],
  },
};
