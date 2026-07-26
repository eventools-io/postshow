// A Supabase stand-in for the browser suite.
//
// The app, the router, the components, and supabase-js all run for real; only
// the wire is answered from a fixture. Every request that is not the app's own
// asset and not a route this file recognises is aborted, so a call this suite
// has not accounted for surfaces as a failure instead of silently reaching a
// developer's real stack.

import type { Page, Route } from '@playwright/test';
import {
  ACCOUNT,
  ENGINE_SETTINGS,
  FIELD_NOTE,
  GROUNDED_INCIDENT,
  GROUNDED_INCIDENT_ID,
  INBOX_ITEM,
  POSTHOG_CONNECTION,
  SIGN_IN_EMAIL,
  THIN_INCIDENT,
  USER_ID,
  WORKSPACE,
  WORKSPACE_ID,
} from './workspace';

export interface StackOptions {
  /** `fail` makes the permission RPC answer 500, which locks the approval controls. */
  permissions?: 'granted' | 'fail';
  /** `false` removes the PostHog connection, so replays cannot be opened. */
  posthogConnected?: boolean;
}

const APP_ORIGIN = 'http://127.0.0.1:5176';

// Reached through globalThis because the shared ESLint config declares browser
// globals; this file is the only one here that runs in Node.
function base64Url(value: object): string {
  return globalThis.Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** A structurally valid token. supabase-js reads its payload for expiry; the
 * signature is never verified in the browser. */
function accessToken(): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url({ alg: 'HS256', typ: 'JWT' });
  const payload = base64Url({
    sub: USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: SIGN_IN_EMAIL,
    iat: now,
    exp: now + 3600,
    session_id: 'e2e-session',
  });
  return `${header}.${payload}.e2e-signature-not-verified-in-the-browser`;
}

function user() {
  return {
    id: USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: SIGN_IN_EMAIL,
    email_confirmed_at: '2026-07-01T09:00:00.000Z',
    phone: '',
    confirmed_at: '2026-07-01T09:00:00.000Z',
    last_sign_in_at: new Date().toISOString(),
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    identities: [],
    created_at: '2026-07-01T09:00:00.000Z',
    updated_at: new Date().toISOString(),
    is_anonymous: false,
  };
}

function session() {
  return {
    access_token: accessToken(),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'e2e-refresh-token',
    user: user(),
  };
}

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });
}

/** PostgREST answers a select with an array; supabase-js unwraps
 * `.maybeSingle()` on the client, so tables always answer in list shape. */
function tableRows(table: string, url: URL, options: Required<StackOptions>): unknown[] | null {
  switch (table) {
    case 'postshow_workspaces':
      return [WORKSPACE];
    case 'postshow_customer_incidents': {
      const requested = url.searchParams.get('id');
      if (!requested) return [GROUNDED_INCIDENT, THIN_INCIDENT];
      return [GROUNDED_INCIDENT, THIN_INCIDENT].filter(
        (incident) => requested === `eq.${incident.id}`
      );
    }
    case 'postshow_incident_accounts': {
      const requested = url.searchParams.get('incident_id');
      if (requested && requested !== `eq.${GROUNDED_INCIDENT_ID}`) return [];
      return [
        {
          workspace_id: WORKSPACE_ID,
          incident_id: GROUNDED_INCIDENT_ID,
          account_id: ACCOUNT.id,
          confidence: 0.95,
          evidence: { source: 'stripe' },
        },
      ];
    }
    case 'postshow_accounts':
      return [ACCOUNT];
    case 'postshow_field_notes': {
      const requested = url.searchParams.get('incident_id');
      if (requested && requested !== `eq.${GROUNDED_INCIDENT_ID}`) return [];
      return [FIELD_NOTE];
    }
    case 'postshow_inbox_items': {
      const requested = url.searchParams.get('incident_id');
      if (requested && requested !== `eq.${GROUNDED_INCIDENT_ID}`) return [];
      return [INBOX_ITEM];
    }
    case 'postshow_connections':
      return options.posthogConnected ? [POSTHOG_CONNECTION] : [];
    case 'postshow_engine_settings':
      return [ENGINE_SETTINGS];
    case 'postshow_incident_references':
      return [];
    default:
      return null;
  }
}

function rpcResult(name: string): unknown {
  switch (name) {
    case 'postshow_public_release_gates':
      return {
        signup: false,
        checkout: true,
        hosted_runtime: true,
        plan_changes: true,
        workspace_export: true,
        workspace_deletion: true,
      };
    case 'postshow_has_permission':
      return true;
    default:
      return null;
  }
}

export interface StackTraffic {
  /** Tables and RPCs answered empty because this fixture does not model them.
   * A page that grows a new query lands here instead of turning red, so a
   * concurrent change to the app cannot break an unrelated assertion. */
  unmodelled: string[];
  /** Requests that were refused outright. Anything here is a real gap: the app
   * tried to reach something this suite never accounted for. */
  blocked: string[];
}

/** Answers the Supabase wire for one page and reports what it saw. */
export async function installSupabaseStack(
  page: Page,
  options: StackOptions = {}
): Promise<StackTraffic> {
  const resolved: Required<StackOptions> = {
    permissions: options.permissions ?? 'granted',
    posthogConnected: options.posthogConnected ?? true,
  };
  const traffic: StackTraffic = { unmodelled: [], blocked: [] };

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.url().startsWith(APP_ORIGIN)) {
      await route.continue();
      return;
    }

    if (url.pathname.startsWith('/auth/v1/token')) {
      await json(route, session());
      return;
    }
    if (url.pathname === '/auth/v1/user') {
      await json(route, { user: user() });
      return;
    }
    if (url.pathname === '/auth/v1/logout') {
      await route.fulfill({ status: 204, body: '' });
      return;
    }

    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const name = url.pathname.slice('/rest/v1/rpc/'.length);
      if (name === 'postshow_has_permission' && resolved.permissions === 'fail') {
        await json(
          route,
          { code: 'XX000', message: 'permission service is unavailable', details: '', hint: '' },
          500
        );
        return;
      }
      const result = rpcResult(name);
      if (result === null) {
        traffic.unmodelled.push(`rpc ${name}`);
        await json(route, null);
        return;
      }
      await json(route, result);
      return;
    }

    if (url.pathname.startsWith('/rest/v1/')) {
      const table = url.pathname.slice('/rest/v1/'.length);
      const rows = tableRows(table, url, resolved);
      if (rows === null) {
        traffic.unmodelled.push(`table ${table}`);
        await json(route, []);
        return;
      }
      await json(route, rows);
      return;
    }

    if (url.pathname === '/functions/v1/postshow-workspace-deletion') {
      await json(route, { ok: true, requests: [], truncated: false });
      return;
    }

    traffic.blocked.push(`${request.method()} ${url.href}`);
    await route.abort();
  });

  return traffic;
}
