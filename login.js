// A2MAC1 — capture & cache the session cookie from the bound Chrome profile.
//
// Run this once after logging in to https://ibp.a2mac1.com in Chrome. The
// captured cookie string is persisted under ~/.opencli/cache/a2mac1/cookies.json
// (mode 0600) and is what every other command falls back to when the browser
// yields nothing — so data commands keep working headlessly until the
// server-side session actually expires.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { HOST, BASE, readCookie, getSettings, loadCachedCookie } from './lib/http.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

cli({
  site: 'a2mac1',
  name: 'login',
  description: 'Capture & cache the A2MAC1 session cookie from the bound Chrome',
  access: 'read',
  example: 'opencli a2mac1 login',
  domain: HOST,
  strategy: Strategy.COOKIE,
  browser: true,
  args: [],
  options: {
    wait: {
      type: 'int',
      default: 30,
      description: 'Seconds to poll for session cookies (in case SSO is still in flight)',
    },
  },
  columns: ['status', 'detail'],
  func: async (page, args) => {
    const wait = Math.max(5, Math.min(45, Number(args.wait ?? 30)));
    const deadline = Date.now() + wait * 1000;

    // Poll: the SPA may still be mid-SSO-redirect when we start.
    let cookie = '';
    while (Date.now() < deadline) {
      cookie = await readCookie(page);
      if (cookie) break;
      await sleep(2000);
    }

    if (!cookie) {
      const cached = loadCachedCookie();
      throw new CommandExecutionError(
        'no A2MAC1 cookies found in the bound browser',
        `Open ${BASE} in Chrome, complete the SSO login, then re-run "opencli a2mac1 login".`
          + (cached ? ' Note: a cached cookie from a previous login still exists and may already be expired.' : ''),
      );
    }

    // Verify server-side validity and surface a bit of account context.
    let detail = `cookie cached (${cookie.split('; ').length} names) → ~/.opencli/cache/a2mac1/cookies.json`;
    try {
      const settings = await getSettings(cookie);
      const interesting = Object.entries(settings || {})
        .filter(([k]) => /user|email|account|tenant/i.test(k))
        .slice(0, 3)
        .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`);
      if (interesting.length) detail += `; ${interesting.join(', ')}`;
      else detail += '; session verified against /settings';
    } catch {
      detail += '; WARNING: cookie did not pass the /settings check — the server-side session may already be expired';
    }

    return [{ status: 'ok', detail }];
  },
});
