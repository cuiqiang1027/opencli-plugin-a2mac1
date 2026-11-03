// A2MAC1 — capture & cache the session cookie from the bound Chrome profile.
//
// Run this once after logging in to https://ibp.a2mac1.com in Chrome. The
// captured cookie string is persisted under ~/.opencli/cache/a2mac1/cookies.json
// (mode 0600) and is what every other command falls back to when the browser
// yields nothing — so data commands keep working headlessly until the
// server-side session actually expires.
//
// The A2MAC1 session cookies (access_token, .AspNetCore.Identity.Application)
// are browser-session scoped: Chrome deletes them on restart. This command
// waits for the SSO dance to finish, verifies the result against a genuinely
// authenticated endpoint (quick-search — /settings is public and useless for
// this), and only then stores the cookie.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import {
  HOST,
  BASE,
  readCookie,
  hasSessionCookie,
  loadCachedCookie,
} from './lib/http.js';
import { quickSearch } from './lib/engine.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sessionNames(cookie) {
  return (cookie || '')
    .split('; ')
    .filter((p) => /access_token|AspNetCore\.Identity/i.test(p))
    .map((p) => p.split('=')[0]);
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
      description: 'Seconds to wait for the SSO redirect to finish before giving up',
    },
  },
  columns: ['status', 'detail'],
  func: async (page, args) => {
    const wait = Math.max(5, Math.min(45, Number(args.wait ?? 30)));
    const deadline = Date.now() + wait * 1000;

    // Make sure the SPA is (re)loaded so any pending SSO redirect can run.
    try {
      await page.goto(BASE);
    } catch {
      /* page API may not expose goto in this opencli build — preNav usually
         already put us on the domain root; fall through to polling. */
    }

    // Poll until a real session credential shows up (analytics-only sets don't
    // count) or the deadline passes.
    let cookie = '';
    while (Date.now() < deadline) {
      cookie = await readCookie(page);
      if (hasSessionCookie(cookie)) break;
      await sleep(2000);
    }

    if (!hasSessionCookie(cookie)) {
      const cached = loadCachedCookie();
      const found = cookie ? cookie.split('; ').length : 0;
      throw new CommandExecutionError(
        `no A2MAC1 session cookie found (saw ${found} non-session cookie(s))`,
        `Open ${BASE} in Chrome, complete the SSO login, then re-run "opencli a2mac1 login".`
          + (hasSessionCookie(cached)
            ? ' A cached session cookie still exists and may still be valid server-side.'
            : ''),
      );
    }

    // Verify server-side validity against an endpoint that actually requires
    // auth (GET /settings is public and would pass with garbage cookies).
    let detail = `session cached: ${sessionNames(cookie).join(', ')} → ~/.opencli/cache/a2mac1/cookies.json`;
    try {
      const data = await quickSearch(cookie, 'glc');
      const hits = Array.isArray(data) ? data.length : (data?.items?.length ?? 0);
      detail += `; verified via quick-search (${hits} result(s))`;
    } catch (error) {
      throw new CommandExecutionError(
        `captured cookies failed the auth check: ${error?.message || error}`,
        'The SSO session may have expired mid-capture — re-run "opencli a2mac1 login".',
      );
    }

    return [{ status: 'ok', detail }];
  },
});
