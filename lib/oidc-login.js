// Pure-HTTP A2MAC1 SSO login (no browser at all).
//
// login.a2mac1.com runs ASP.NET Identity with a two-step form
// (email → Next → password) and then bounces through an OIDC
// authorization-code + PKCE chain back to ibp.a2mac1.com. Everything here is
// plain fetch with a cookie jar — no Chrome, no WebView2, no extension:
//
//   1. GET  /oauth/authorize (PKCE)   → redirect to the login form
//   2. POST email step                → redirect to the password step
//   3. POST password step (Input.Prompt comes from the URL query!)
//   4. follow the authorize chain     → callback?code=…
//   5. POST /oauth/token              → access_token (+ id_token)
//
// The resulting access_token works as the `access_token` cookie for the IBP
// API (verified via quick-search by the caller). Server-side TTL ≈ 24 h.
import crypto from 'node:crypto';
import { CommandExecutionError } from '@jackwener/opencli/errors';

const LOGIN_BASE = 'https://login.a2mac1.com';
const IBP_BASE = 'https://ibp.a2mac1.com';

const CLIENT_ID = '82746cfe-869a-4047-8e15-e7d27e23f3ab';
const REDIRECT_URI = 'https://ibp.a2mac1.com/auth/callback';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  + ' (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Pull __RequestVerificationToken out of an ASP.NET form page. */
function verificationToken(html) {
  return (html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/) || [])[1] || '';
}

function formPost(url, body, cookie, referer) {
  return fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(referer ? { Referer: referer } : {}),
    },
    body: new URLSearchParams(body).toString(),
    redirect: 'manual',
  });
}

/**
 * Run the full SSO+PKCE login flow with fetch only.
 * @param {{username: string, password: string}} credentials
 * @returns {Promise<{cookie: string, expiresIn: number}>} cookie string for
 *   requestJson()/authHeaders() and the server-side TTL in seconds.
 */
export async function oidcLogin({ username, password }) {
  const jar = new Map();
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const absorb = (res) => {
    for (const c of res.headers.getSetCookie?.() || []) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  };
  const location = (res, base) => new URL(res.headers.get('location') || '', base).toString();

  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const authorize = `${LOGIN_BASE}/oauth/authorize?client_id=${CLIENT_ID}`
    + `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
    + '&response_type=code&scope=openid%20production'
    + `&nonce=${crypto.randomBytes(12).toString('hex')}`
    + `&state=${crypto.randomBytes(16).toString('hex')}`
    + `&code_challenge=${challenge}&code_challenge_method=S256`;

  let res;
  try {
    // 1) authorize endpoint → login form (email step)
    res = await fetch(authorize, { headers: { 'User-Agent': UA }, redirect: 'manual' });
    absorb(res);
    let stepUrl = location(res, LOGIN_BASE);

    res = await fetch(stepUrl, { headers: { 'User-Agent': UA, Cookie: cookieHeader() }, redirect: 'manual' });
    absorb(res);
    const emailHtml = await res.text();

    // 2) email step
    res = await formPost(stepUrl, {
      'Input.Email': username,
      'Input.Password': '',
      __RequestVerificationToken: verificationToken(emailHtml),
    }, cookieHeader(), stepUrl);
    absorb(res);
    const passwordUrl = location(res, LOGIN_BASE);
    if (res.status >= 400 || !passwordUrl.includes(LOGIN_BASE.replace('https://', ''))) {
      throw new CommandExecutionError(
        `SSO email step failed (HTTP ${res.status})`,
        'Check that the username in ~/.opencli/a2mac1-credentials.json is the account email.',
      );
    }

    // 3) password step — Input.Prompt must come from the URL query, the hidden
    //    field value alone is rejected.
    res = await fetch(passwordUrl, { headers: { 'User-Agent': UA, Cookie: cookieHeader() }, redirect: 'manual' });
    absorb(res);
    const passwordHtml = await res.text();
    res = await formPost(passwordUrl, {
      'Input.Password': password,
      'Input.Prompt': new URL(passwordUrl).searchParams.get('Prompt') || '',
      'Input.RememberMe': 'false',
      __RequestVerificationToken: verificationToken(passwordHtml),
    }, cookieHeader(), passwordUrl);
    absorb(res);
    const afterPassword = location(res, LOGIN_BASE);
    if (res.status >= 400) {
      throw new CommandExecutionError(
        `SSO password step failed (HTTP ${res.status})`,
        'Wrong password, or MFA/2FA is required. For MFA, log in by hand in Chrome'
          + ' and run "opencli a2mac1 login-browser" to capture the session.',
      );
    }

    // 4) follow the authorize chain until callback?code= appears
    let next = afterPassword;
    let code = new URL(next, IBP_BASE).searchParams.get('code');
    for (let hop = 0; !code && hop < 6; hop += 1) {
      res = await fetch(next, { headers: { 'User-Agent': UA, Cookie: cookieHeader() }, redirect: 'manual' });
      absorb(res);
      next = location(res, LOGIN_BASE);
      code = new URL(next, IBP_BASE).searchParams.get('code');
      if (!next || next === afterPassword) break;
    }
    if (!code) {
      throw new CommandExecutionError(
        'SSO login did not produce an authorization code',
        'The flow may require MFA/2FA or a captcha. Log in by hand in Chrome and run'
          + ' "opencli a2mac1 login-browser" to capture the session instead.',
      );
    }

    // 5) exchange the code for tokens
    const tokenRes = await fetch(`${LOGIN_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      }).toString(),
    });
    const token = await tokenRes.json().catch(() => ({}));
    if (tokenRes.status !== 200 || !token.access_token) {
      throw new CommandExecutionError(
        `token exchange failed (HTTP ${tokenRes.status}${token.error ? `, ${token.error}` : ''})`,
        'The authorization code may have expired mid-flight — retry "opencli a2mac1 login".',
      );
    }

    const parts = [`access_token=${token.access_token}`];
    if (token.id_token) parts.push(`id_token=${token.id_token}`);
    return { cookie: parts.join('; '), expiresIn: Number(token.expires_in) || 0 };
  } catch (error) {
    if (error instanceof CommandExecutionError) throw error;
    throw new CommandExecutionError(
      `SSO login failed: ${error?.cause?.code || error?.message || error}`,
      'Check VPN / network reachability of login.a2mac1.com.',
    );
  }
}
