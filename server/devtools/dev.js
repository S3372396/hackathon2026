// Dev check page: signs in through TideCloak with DPoP, then exercises the API the way the web app
// will. Everything it shows about access comes from the server's answers, not from this page.
import { IAMService } from '@tidecloak/js';

const $ = (id) => document.getElementById(id);

export function log(...parts) {
  const line = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
  $('log').textContent = `${new Date().toLocaleTimeString()}  ${line}\n${$('log').textContent}`;
}

/**
 * Calls our API with the Tide session. With no Authorization header, secureFetch attaches
 * `DPoP <token>` and the proof itself; it needs an absolute URL to build the proof's htu.
 */
export async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const url = new URL(path, window.location.origin).href;
  const res = await IAMService.secureFetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = text;
  try { data = text ? JSON.parse(text) : undefined; } catch { /* not JSON */ }
  return { status: res.status, body: data };
}

const ROLE_CHECKS = [
  ['GET', '/api/me', { patient: 200, professional: 200 }],
  ['GET', '/api/professionals', { patient: 200, professional: 403 }],
  ['GET', '/api/entries', { patient: 200, professional: 403 }],
  ['GET', '/api/shares', { patient: 200, professional: 200 }],
  ['GET', '/api/audit', { patient: 200, professional: 403 }],
];

async function runRoleCheck(role) {
  const rows = [];
  for (const [method, path, expected] of ROLE_CHECKS) {
    const res = await api(path, { method });
    const want = expected[role];
    rows.push(`<tr><td><code>${method} ${path}</code></td><td>${want}</td><td class="${res.status === want ? 'ok' : 'bad'}">${res.status}</td>` +
      `<td>${res.status === want ? 'as expected' : 'UNEXPECTED'}</td></tr>`);
  }
  $('role-results').innerHTML = rows.join('');
  log('role check done for', role);
}

function show(id, visible = true) { $(id).hidden = !visible; }

async function main() {
  const res = await fetch('/tidecloak.json');
  if (!res.ok) {
    $('status').textContent = 'TideCloak is not set up yet: run bash tidecloak/setup.sh phase2, then restart the server.';
    return;
  }
  const config = await res.json();
  IAMService.on('authError', (_e, err) => log('auth error', String(err)));
  const authenticated = await IAMService.initIAM({ ...config, useDPoP: { mode: 'strict', alg: 'ES256' } });

  // Back from the login redirect: keep the session, drop ?code= from the address bar.
  if (location.pathname === '/auth/redirect') history.replaceState(null, '', IAMService.getReturnUrl() || '/dev/');

  $('sign-in').onclick = () => IAMService.doLogin();
  $('sign-out').onclick = () => IAMService.doLogout();
  if (!authenticated) {
    $('status').textContent = 'Not signed in.';
    show('sign-in');
    return;
  }

  const me = await api('/api/me');
  const username = IAMService.getValueFromToken('preferred_username');
  const tokenRoles = (IAMService.getValueFromToken('realm_access')?.roles ?? []).filter((r) => !r.startsWith('default-') && !['offline_access', 'uma_authorization'].includes(r));
  $('status').textContent = me.status === 200 ? `Signed in as ${me.body.name} (${me.body.role}).` : `Signed in to TideCloak, but the API answered ${me.status}: ${JSON.stringify(me.body)}`;
  $('whoami').innerHTML = [
    ['TideCloak user', username],
    ['Roles in token', tokenRoles.join(', ') || '(none)'],
    ['Tide key', `<code>${IAMService.getValueFromToken('tideuserkey') ?? '(none)'}</code>`],
    ['API /api/me', `${me.status} ${me.status === 200 ? me.body.id : JSON.stringify(me.body)}`],
  ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  show('whoami');
  show('sign-out');

  if (me.status === 200) {
    show('roles');
    $('check-roles').onclick = () => runRoleCheck(me.body.role).catch((e) => log('role check failed', String(e)));
    await runRoleCheck(me.body.role);
    window.dispatchEvent(new CustomEvent('dev-signed-in', { detail: me.body }));
  }
}

main().catch((err) => {
  $('status').textContent = `Error: ${err?.message ?? err}`;
  log('fatal', String(err?.stack ?? err));
});
