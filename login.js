// A2MAC1 — capture & cache the session cookie from the bound Chrome profile,
// with optional automated SSO form login.
//
// Run `opencli a2mac1 login` after logging in to https://ibp.a2mac1.com in
// Chrome. Behaviour:
//   1. Fast path: session cookies already present → verify & cache.
//   2. Auto path: if the SSO login form shows up and a credentials file exists
//      (~/.opencli/a2mac1-credentials.json, mode 0600, {"username": "...",
//      "password": "..."}), fill the form, submit, and wait for the redirect
//      dance to finish.
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
  readCookie,
  hasSessionCookie,
  loadCachedCookie,
} from './lib/http.js';
import { quickSearch } from './lib/engine.js';

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

// Runs in the page: fills whichever login fields are currently visible and
// submits. Returns what happened so the Node side can decide to keep waiting.
function fillLoginFormJs() {
  return ({ username, password }) => {
    const visible = (el) => {
      if (!el || el.disabled || el.readOnly) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const setNativeValue = (el, value) => {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const USER_S = 'input[type=email],input[name=username],input[name=email],input[id*=user i],input[autocomplete*=username i],input[type=text][name*=login i]';
    const fields = [...document.querySelectorAll('input[type=password]')].filter(visible);
    if (fields.length === 0) return { found: 'no-password-field' };
    // A visible password field means the credential page is showing.
    let filled = [];
    try {
      const pw = fields[0];
      setNativeValue(pw, password);
      filled.push('password');
      // Username may live on the same page (single-form) or not (two-step).
      const user = [...document.querySelectorAll(USER_S)].filter(visible)[0];
      if (user && user.value !== username) {
        setNativeValue(user, username);
        filled.push('username');
      }
    } catch (e) {
      return { found: 'fill-error', error: String(e) };
    }
    // Submit: dedicated button > any submit input > form.requestSubmit().
    try {
      const form = fields[0].closest('form');
      const btn = [...document.querySelectorAll('button[type=submit],input[type=submit]')].filter(visible)[0]
        || (form ? form.querySelector('button') : null);
      if (btn) {
        btn.click();
        return { found: 'submitted', filled, via: 'button' };
      }
      if (form) {
        form.requestSubmit();
        return { found: 'submitted', filled, via: 'requestSubmit' };
      }
      return { found: 'filled-no-submit', filled };
    } catch (e) {
      return { found: 'submit-error', error: String(e) };
    }
  };
}

cli({
  site: 'a2mac1',
  name: 'login',
  description: 'Capture & cache the A2MAC1 session cookie (optionally auto-fills the SSO login form)',
  access: 'read',
  example: 'opencli a2mac1 login',
  domain: HOST,
  strategy: Strategy.COOKIE,
  browser: true,
  args: [],
  args: [
    { name: 'wait', type: 'string', default: '30', help: 'Seconds to wait for login/SSO to finish before giving up (max 45)' },
    { name: 'no-auto', type: 'string', default: 'false', help: '"true" skips automated form login even if a credentials file exists' },
  ],
  columns: ['status', 'detail'],
  func: async (page, args) => {
    const wait = Math.max(5, Math.min(45, Number(args.wait ?? 30)));
    const noAuto = String(args['no-auto'] ?? '').toLowerCase() === 'true';
    const credentials = noAuto ? null : loadCredentials();
    const deadline = Date.now() + wait * 1000;

    // Make sure the SPA is (re)loaded so any pending SSO redirect can run.
    try {
      await page.goto(BASE);
    } catch {
      /* page API may not expose goto in this opencli build — preNav usually
         already put us on the domain root; fall through to polling. */
    }

    let autoTried = false;
    let lastForm = '';
    let cookie = '';
    while (Date.now() < deadline) {
      cookie = await readCookie(page);
      if (hasSessionCookie(cookie)) break;

      // Automated credential login while the SSO form is on screen.
      if (credentials && !autoTried) {
        try {
          const result = await page.evaluate(fillLoginFormJs(), {
            username: credentials.username,
            password: credentials.password,
          });
          lastForm = result?.found || 'unknown';
          if (result?.found === 'submitted' || result?.found === 'filled-no-submit') {
            autoTried = true; // one attempt; let the redirect dance happen
          }
        } catch {
          lastForm = 'evaluate-failed';
        }
      }
      await sleep(2000);
    }

    if (!hasSessionCookie(cookie)) {
      const cached = loadCachedCookie();
      const found = cookie ? cookie.split('; ').length : 0;
      const hint = credentials
        ? `auto-login was attempted (${lastForm}) but the session never appeared — check the credentials in ${CREDENTIALS_FILE} (or MFA/2FA may be required).`
        : `Open ${BASE} in Chrome, complete the SSO login, then re-run "opencli a2mac1 login".`
          + ' To enable automated form login, put {"username":"…","password":"…"} into ~/.opencli/a2mac1-credentials.json (mode 0600).';
      throw new CommandExecutionError(
        `no A2MAC1 session cookie found (saw ${found} non-session cookie(s))`,
        hint
          + (hasSessionCookie(cached) ? ' A cached session cookie still exists and may still be valid server-side.' : ''),
      );
    }

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
    if (autoTried) detail += `; auto-login used (last form state: ${lastForm})`;

    return [{ status: 'ok', detail }];
  },
});
