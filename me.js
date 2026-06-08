// A2MAC1 — show platform settings & key URLs for the logged-in user.
// The IBP platform exposes /settings as a first-load endpoint that bundles
// API base URLs, OIDC config, module URLs, and feature toggles. It returns 401
// when the cookie session has expired, which is the cleanest signal we have
// for "are you actually logged in?" without hitting a real user-data endpoint.
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  AuthRequiredError,
  CommandExecutionError,
  EmptyResultError,
} from '@jackwener/opencli/errors';

const HOST = 'ibp.a2mac1.com';
const BASE = `https://${HOST}`;
const ROOT = '.a2mac1.com';

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
  name: 'me',
  description: 'A2MAC1 platform settings + key URLs for the logged-in account',
  access: 'read',
  example: 'opencli a2mac1 me -f yaml',
  domain: HOST,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [],
  columns: ['key', 'value'],
  func: async (page /* , args */) => {
    const cookie = await readCookie(page);
    if (!cookie) throw new AuthRequiredError(HOST);

    let resp;
    try {
      resp = await fetch(`${BASE}/settings`, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Accept: 'application/json',
          Referer: `${BASE}/`,
          Cookie: cookie,
        },
        redirect: 'manual',
      });
    } catch (error) {
      throw new CommandExecutionError(
        `a2mac1 settings request failed: ${error?.message || error}`,
      );
    }

    if (resp.status === 401 || resp.status === 403) {
      throw new AuthRequiredError(HOST);
    }
    // 30x usually means the session redirected to the OIDC login page.
    if (resp.status >= 300 && resp.status < 400) {
      throw new AuthRequiredError(HOST);
    }
    if (!resp.ok) {
      throw new CommandExecutionError(
        `a2mac1 settings failed: HTTP ${resp.status}`,
      );
    }

    let data;
    try {
      data = await resp.json();
    } catch (error) {
      throw new CommandExecutionError(
        `a2mac1 settings: invalid JSON (${error?.message || error})`,
      );
    }

    const entries = data && typeof data === 'object' ? Object.entries(data) : [];
    if (entries.length === 0) {
      throw new EmptyResultError('a2mac1 me', 'settings response was empty');
    }

    // Stable column order: key first (asc), value rendered as compact string.
    return entries
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => ({
        key,
        value:
          value === null || value === undefined
            ? ''
            : typeof value === 'object'
              ? JSON.stringify(value)
              : String(value),
      }));
  },
});
