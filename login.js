// A2MAC1 — capture & cache the session cookie from the bound Chrome profile,
// with automated SSO form login (A2MAC1 uses a two-step email → password page).
//
// Run `opencli a2mac1 login`. Behaviour:
//   1. Fast path: session cookies already present → verify & cache.
//   2. Auto path: if the SSO form shows up and a credentials file exists
//      (~/.opencli/a2mac1-credentials.json, mode 0600,
//      {"username": "...", "password": "..."}), fill each visible step, submit,
//      and wait for the OIDC redirect back to ibp.a2mac1.com.
//   3. Otherwise: tell the user to log in manually and re-run.
//
// The A2MAC1 session cookies (access_token, .AspNetCore.Identity.Application)
// are browser-session scoped: Chrome deletes them on restart. Whatever this
// command captures is verified against a genuinely authenticated endpoint
// (quick-search — GET /settings is public and useless for this) and stored to
// ~/.opencli/cache/a2mac1/cookies.json for headless reuse.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  HOST,
  BASE,
  LOGIN_HOST,
  readBrowserCookie,
  readCookie,
  hasSessionCookie,
  loadCachedCookie,
} from './lib/http.js';
import { quickSearch } from './lib/engine.js';
import { loginStepJs } from './lib/login-form.js';

const CREDENTIALS_FILE = path.join(os.homedir(), '.opencli', 'a2mac1-credentials.json');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sessionNames(cookie) {
  return (cookie || '')
    .split('; ')
    .filter((p) => /access_token|AspNetCore\.Identity/i.test(p))
    .map((p) => p.split('=')[0]);
}

function loadCredentials() {
  try {
    const raw = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
    if (raw?.username && raw?.password) return raw;
  } catch {
    /* missing or malformed → auto-login unavailable */
  }
  return null;
}

cli({
  site: 'a2mac1',
  name: 'login',
  description: 'Capture & cache the A2MAC1 session cookie (auto-fills the SSO login form when credentials are configured)',
  access: 'read',
  example: 'opencli a2mac1 login',
  domain: HOST,
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'wait', type: 'string', default: '35', help: 'Seconds to wait for login/SSO to finish before giving up (max 45)' },
    { name: 'no-auto', type: 'string', default: 'false', help: '"true" skips automated form login even if a credentials file exists' },
  ],
  columns: ['status', 'detail'],
  func: async (page, args) => {
    const wait = Math.max(5, Math.min(45, Number(args.wait ?? 35)));
    const noAuto = String(args['no-auto'] ?? '').toLowerCase() === 'true';
    const credentials = noAuto ? null : loadCredentials();
    const deadline = Date.now() + wait * 1000;

    // Make sure the SPA is (re)loaded so any pending SSO redirect can run.
    try {
      await page.goto(BASE);
    } catch {
      /* page API may not expose goto in this build — preNav usually already
         put us on the domain root; fall through to polling. */
    }

    const notes = [];
    let cookie = '';
    let attempts = 0;
    let lastUrl = '';
    let perUrl = 0;
    let verified = false;

    while (Date.now() < deadline) {
      let url = '';
      try {
        url = (await page.getCurrentUrl?.()) || '';
      } catch {
        /* ignore */
      }
      // Browser-only on purpose: the merged cookie always carries a stale
      // access_token from the cache, which would look like a valid session.
      const browserCookie = await readBrowserCookie(page);

      // The only trustworthy success signal is an authenticated API call:
      // Chrome happily keeps an expired access_token cookie for a while.
      if (url.includes(HOST) && hasSessionCookie(browserCookie)) {
        try {
          await quickSearch(browserCookie, 'model y');
          verified = true;
          cookie = browserCookie;
          break;
        } catch {
          /* stale token — keep driving the login flow */
        }
      }

      if (credentials && attempts < 8 && url.includes(LOGIN_HOST)) {
        if (url !== lastUrl) {
          lastUrl = url;
          perUrl = 0;
        }
        // Two attempts per page: one to fill+submit, one retry if the click
        // landed before the form was interactive.
        if (perUrl < 2) {
          try {
            const step = await page.evaluate(loginStepJs(), {
              username: credentials.username,
              password: credentials.password,
            });
            const note = `${step?.found || 'unknown'}${step?.via ? `/${step.via}` : ''}`;
            if (notes[notes.length - 1] !== note) notes.push(note);
            if (step?.found === 'email-submitted' || step?.found === 'password-submitted') {
              attempts += 1;
              perUrl += 1;
            }
          } catch {
            if (notes[notes.length - 1] !== 'eval-failed') notes.push('eval-failed');
          }
        }
      }
      await sleep(2500);
    }

    if (!verified) {
      const cached = loadCachedCookie();
      const trail = notes.length ? ` Attempts: ${notes.join(' → ')}.` : '';
      const hint = credentials
        ? `auto-login ran but no authenticated session appeared.${trail} Check the credentials in ${CREDENTIALS_FILE}`
          + ' (wrong password, or MFA/2FA required — then log in by hand and run `opencli a2mac1 login --no-auto true`).'
        : `Open ${BASE} in Chrome, complete the SSO login, then re-run "opencli a2mac1 login".`
          + ' To enable automated form login, put {"username":"…","password":"…"} into ~/.opencli/a2mac1-credentials.json (mode 0600).';
      throw new CommandExecutionError(
        'no authenticated A2MAC1 session after login attempt',
        hint
          + (hasSessionCookie(cached) ? ' A cached session cookie still exists and may still be valid server-side.' : ''),
      );
    }
    // Persist the full browser set (merged with the cache) for headless runs.
    cookie = await readCookie(page);

    // Verify server-side validity against an endpoint that actually requires
    // auth (GET /settings is public and would pass with garbage cookies).
    let detail = `session cached: ${sessionNames(cookie).join(', ')} → ~/.opencli/cache/a2mac1/cookies.json`;
    try {
      const data = await quickSearch(cookie, 'model y');
      const hits = Array.isArray(data) ? data.length : (data?.items?.length ?? 0);
      detail += `; verified via quick-search (${hits} result(s))`;
    } catch (error) {
      throw new CommandExecutionError(
        `captured cookies failed the auth check: ${error?.message || error}`,
        'The SSO session may have expired mid-capture — re-run "opencli a2mac1 login".',
      );
    }
    if (attempts > 0) detail += `; auto-login used (${notes.join(' → ')})`;

    return [{ status: 'ok', detail }];
  },
});
