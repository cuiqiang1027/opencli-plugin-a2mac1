// A2MAC1 — headless login. No browser is started (no Chrome, no WebView2).
//
//   opencli a2mac1 login [--force true]
//
//   1. Fast path: the cached cookie still verifies against a real
//      authenticated endpoint (quick-search — GET /settings is public and
//      useless for this) → done, nothing else runs.
//   2. OIDC path: with credentials in ~/.opencli/a2mac1-credentials.json
//      (mode 0600, {"username":"…","password":"…"}) the full SSO +
//      authorization-code/PKCE flow runs over plain fetch (lib/oidc-login.js)
//      and the fresh token is cached for headless reuse.
//   3. If both fail (no credentials, wrong password, MFA/2FA) the command
//      points at "opencli a2mac1 login-browser", which drives the form in a
//      real Chrome via the Browser Bridge extension.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HOST, hasSessionCookie, loadCachedCookie, saveCookieCache } from './lib/http.js';
import { quickSearch } from './lib/engine.js';
import { oidcLogin } from './lib/oidc-login.js';

const CREDENTIALS_FILE = path.join(os.homedir(), '.opencli', 'a2mac1-credentials.json');

function loadCredentials() {
  try {
    const raw = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
    if (raw?.username && raw?.password) return raw;
  } catch {
    /* missing or malformed → auto-login unavailable */
  }
  return null;
}

async function verify(cookie) {
  const data = await quickSearch(cookie, 'model y');
  // Response shape: { products: […], parts: […], hierarchies: […] }
  const hits = Array.isArray(data)
    ? data.length
    : Object.values(data || {}).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0);
  const shape = Array.isArray(data) ? `array(${data.length})` : Object.keys(data || {}).join(',');
  return { hits, shape };
}

function isTruthy(v) {
  return v === true || String(v ?? '').toLowerCase() === 'true';
}

cli({
  site: 'a2mac1',
  name: 'login',
  description: 'Headless A2MAC1 login: verify the cached session or run the SSO OIDC flow with saved credentials (no browser started)',
  access: 'read',
  example: 'opencli a2mac1 login',
  domain: HOST,
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'force', type: 'bool', default: false, help: 'Re-run the OIDC login even if the cached cookie still verifies' },
  ],
  columns: ['status', 'detail'],
  func: async (args) => {
    // 1) Fast path — cached session still valid server-side.
    const cached = loadCachedCookie();
    if (!isTruthy(args.force) && hasSessionCookie(cached)) {
      try {
        const { hits } = await verify(cached);
        return [{
          status: 'ok',
          detail: `cached session still valid (verified via quick-search, ${hits} result(s)) — nothing to do`,
        }];
      } catch {
        /* stale cache — fall through to the OIDC flow */
      }
    }

    // 2) Headless OIDC login with the saved credentials.
    const credentials = loadCredentials();
    if (!credentials) {
      throw new CommandExecutionError(
        'no valid cached session and no credentials for headless login',
        `Put {"username":"…","password":"…"} into ${CREDENTIALS_FILE} (mode 0600) and re-run,`
          + ' or log in by hand in Chrome and run "opencli a2mac1 login-browser".',
      );
    }
    const { cookie, expiresIn } = await oidcLogin(credentials);

    // Trust nothing until an authenticated endpoint says so.
    let check;
    try {
      check = await verify(cookie);
    } catch (error) {
      throw new CommandExecutionError(
        `SSO login completed but the token failed the auth check: ${error?.message || error}`,
        'The account may need interactive consent (MFA). Log in by hand in Chrome and run "opencli a2mac1 login-browser".',
      );
    }
    saveCookieCache(cookie);
    const ttl = expiresIn
      ? `, ttl ≈ ${expiresIn >= 3600 ? `${Math.round(expiresIn / 3600)} h` : `${Math.round(expiresIn / 60)} min`}`
      : '';
    return [{
      status: 'ok',
      detail: `headless SSO login ok (verified via quick-search, ${check.hits} result(s) [${check.shape}])${ttl}`
        + ` → ~/.opencli/cache/a2mac1/cookies.json`,
    }];
  },
});
