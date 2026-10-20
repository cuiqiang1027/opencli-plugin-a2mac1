// A2MAC1 — show platform settings & key URLs for the logged-in user.
// The IBP platform exposes /settings as a first-load endpoint that bundles
// API base URLs, OIDC config, module URLs, and feature toggles. It returns 401
// when the cookie session has expired, which is the cleanest signal we have
// for "are you actually logged in?" without hitting a real user-data endpoint.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { HOST, readCookie, getSettings } from './lib/http.js';

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
  func: async (page) => {
    const cookie = await readCookie(page);
    const data = await getSettings(cookie);

    const entries = data && typeof data === 'object' ? Object.entries(data) : [];
    if (entries.length === 0) throw new EmptyResultError('a2mac1 me', 'settings response was empty');

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
