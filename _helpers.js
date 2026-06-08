// Shared helpers for A2MAC1 IBP cookie-based adapters.
// Note: opencli does NOT auto-import this file — each adapter explicitly imports
// the helpers it needs. This is a private utility module, not an adapter.
const HOST = 'ibp.a2mac1.com';
const BASE = `https://${HOST}`;
const ROOT = '.a2mac1.com';

// Hierarchy IDs commonly referenced across adapters.
const HIERARCHY = {
  VOP: '00000005ZT4GEU01',                  // Vehicle Occupant Packaging
  ELECTRONICS: '00000003O8LHEU01',
  XEV_POWERTRAIN: '0000009X67MIEU02',
  ELECTRICAL_ARCH: '00000000HVNTEU01',
  THREE_D_AUTOREVERSE: '00000003LSK4EU01',
  CELL_ANALYSIS: 'A000002R4ZBVEU01',
  SCHEDULE_CONTENT: 'A000005AE6M1EU01',
};

// Default product type group used by Technology Insights products.
const DEFAULT_PRODUCT_TYPE_GROUP = '$000000000000001';
const DEFAULT_PRODUCT_TYPE = '$000000000000006'; // Technology Insights

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

function authHeaders(cookie) {
  return {
    'User-Agent': 'Mozilla/5.0',
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Referer: `${BASE}/`,
    Cookie: cookie,
  };
}

export {
  HOST,
  BASE,
  ROOT,
  HIERARCHY,
  DEFAULT_PRODUCT_TYPE_GROUP,
  DEFAULT_PRODUCT_TYPE,
  readCookie,
  authHeaders,
};
