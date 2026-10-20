// Shared HTTP / auth plumbing for A2MAC1 IBP adapters.
//
// Everything that talks to ibp.a2mac1.com goes through here so that cookie
// handling, login-redirect detection, network diagnostics and retry/backoff
// behave the same in every command.
import {
  AuthRequiredError,
  CommandExecutionError,
} from '@jackwener/opencli/errors';

export const HOST = 'ibp.a2mac1.com';
export const BASE = `https://${HOST}`;
export const ROOT_DOMAIN = '.a2mac1.com';
export const LOGIN_HOST = 'login.a2mac1.com';

// Statuses worth retrying. 401/403 are NOT here — they mean the session is gone.
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

// Node/undici error codes → human hint. Without this the user only sees
// "fetch failed", which is impossible to act on.
const NETWORK_HINTS = {
  ENOTFOUND: 'DNS lookup failed: check VPN / proxy, or whether the host is reachable from this network.',
  EAI_AGAIN: 'DNS lookup failed temporarily: check VPN / network and retry.',
  ECONNREFUSED: 'Connection refused: a proxy or firewall is likely blocking the request.',
  ECONNRESET: 'Connection reset: proxy or gateway dropped the request, retry later.',
  ETIMEDOUT: 'Connection timed out: check VPN / network quality.',
  EHOSTUNREACH: 'Host unreachable: check VPN / routing.',
  UND_ERR_CONNECT_TIMEOUT: 'Connect timeout: check VPN / network quality.',
  UND_ERR_SOCKET: 'Socket closed unexpectedly: retry, or check the proxy.',
  CERT_HAS_EXPIRED: 'TLS certificate expired: corporate MITM proxy in the way?',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'TLS verification failed: check the corporate root CA.',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'TLS self-signed certificate: corporate MITM proxy in the way?',
};

// --- cookies -------------------------------------------------------------

/**
 * Read the A2MAC1 session cookies out of the bound Chrome profile.
 * Tries the exact host first, then the parent domain, and de-duplicates by name
 * (the parent-domain pass tends to return the same cookies again).
 */
export async function readCookie(page) {
  const seen = new Map();
  for (const opts of [{ domain: HOST }, { domain: ROOT_DOMAIN }]) {
    try {
      const cookies = await page.getCookies(opts);
      for (const c of cookies || []) {
        if (c?.name && !seen.has(c.name)) seen.set(c.name, c.value);
      }
    } catch {
      /* try next domain */
    }
  }
  return [...seen].map(([k, v]) => `${k}=${v}`).join('; ');
}

export function authHeaders(cookie, { json = true, lang } = {}) {
  const headers = {
    'User-Agent': 'Mozilla/5.0',
    Accept: 'application/json',
    Referer: `${BASE}/`,
    Cookie: cookie,
  };
  if (json) headers['Content-Type'] = 'application/json';
  if (lang) headers['Accept-Language'] = lang;
  return headers;
}

// --- error description ----------------------------------------------------

/**
 * Turn a low-level fetch failure into a message + hint that names the actual
 * cause. undici hides the real reason in `error.cause`, so we surface
 * `error.cause.code` / `error.cause.message` instead of "fetch failed".
 */
export function describeFetchError(error, what) {
  const code = error?.cause?.code || error?.code || '';
  const causeMessage = error?.cause?.message || error?.message || String(error);
  const detail = code ? `${code}: ${causeMessage}` : causeMessage;
  return {
    message: `${what} failed (${detail})`,
    hint: NETWORK_HINTS[code],
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt) {
  // 400ms, 800ms, 1600ms … plus jitter so parallel workers don't sync up.
  return 400 * 2 ** attempt + Math.floor(Math.random() * 200);
}

/**
 * POST/GET JSON against the IBP API with cookie auth.
 *
 * Retries transient failures (429 / 5xx / network) with exponential backoff.
 * Only a redirect to the OIDC login host counts as "session expired" — any
 * other 3xx is reported as a plain error instead of a bogus auth failure.
 */
export async function requestJson(url, options = {}) {
  const {
    method = 'GET',
    body,
    cookie,
    what = 'request',
    lang,
    retries = 2,
  } = options;

  if (!cookie) throw new AuthRequiredError(HOST);

  for (let attempt = 0; ; attempt += 1) {
    let resp;
    try {
      resp = await fetch(url, {
        method,
        headers: authHeaders(cookie, { lang }),
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
        redirect: 'manual',
      });
    } catch (error) {
      if (attempt < retries) {
        await sleep(backoffDelay(attempt));
        continue;
      }
      const { message, hint } = describeFetchError(error, what);
      throw new CommandExecutionError(message, hint);
    }

    if (resp.status === 401 || resp.status === 403) throw new AuthRequiredError(HOST);

    // A redirect is only a login problem when it actually points at the OIDC host.
    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get('location') || '';
      if (location.includes(LOGIN_HOST) || /^\/?(login|signin)/i.test(location)) {
        throw new AuthRequiredError(HOST);
      }
      throw new CommandExecutionError(
        `${what} was redirected (HTTP ${resp.status}) to ${location || 'an unknown location'}`,
        'Unexpected redirect — the session may be half-expired. Reload https://ibp.a2mac1.com in Chrome and retry.',
      );
    }

    if (RETRYABLE_STATUS.has(resp.status) && attempt < retries) {
      await sleep(backoffDelay(attempt));
      continue;
    }

    if (!resp.ok) {
      throw new CommandExecutionError(`${what} failed: HTTP ${resp.status}`);
    }

    try {
      return await resp.json();
    } catch (error) {
      throw new CommandExecutionError(
        `${what}: invalid JSON response (${error?.message || error})`,
      );
    }
  }
}

/**
 * Platform settings (`GET /settings`). Doubles as the login health check and as
 * the source of account-level limits such as `compare.max-products`.
 */
export async function getSettings(cookie) {
  return requestJson(`${BASE}/settings`, { cookie, what: 'settings request' });
}
