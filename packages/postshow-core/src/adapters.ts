// Connector adapters: verify (connection test), gather (read for runs), and
// dispatch (execute approved actions). Pure fetch so every runtime (edge,
// CLI, desktop) can use them. All reads are read-only. The one adapter that
// cannot live here is the Postgres connection test, which needs a driver and
// stays in the edge runtime.

import { isUnsafePublicHostname } from './network';
import { canonicalSentryIssueId, canonicalSessionId } from './sanitize';

export const ADAPTER_TIMEOUT_MS = 20_000;
const MAX_ADAPTER_RESPONSE_BYTES = 8 * 1024 * 1024;

/** Syntactic half of connector egress validation. Cloud callers must also
 * resolve DNS and reject private/link-local answers immediately before use. */
export function publicHttpsOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('connector endpoint is invalid');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    isUnsafePublicHostname(url.hostname)
  ) {
    throw new Error('connector endpoint must be a public HTTPS origin');
  }
  return url.origin;
}

async function adapterResponse(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ADAPTER_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, redirect: 'manual', signal: controller.signal });
    if (response.status >= 300 && response.status < 400) {
      throw new Error('connector redirects are not allowed');
    }
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (Number.isFinite(declared) && declared > MAX_ADAPTER_RESPONSE_BYTES) {
      throw new Error('connector response exceeded the 8 MiB safety limit');
    }
    if (!response.body) return response;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_ADAPTER_RESPONSE_BYTES) {
          void reader.cancel().catch(() => {});
          throw new Error('connector response exceeded the 8 MiB safety limit');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const headers = new Headers(response.headers);
    headers.delete('content-encoding');
    headers.set('content-length', String(bytes.byteLength));
    return new Response(bytes, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('connector request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function responseText(response: Response): Promise<string> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_ADAPTER_RESPONSE_BYTES) {
    throw new Error('connector response exceeded the 8 MiB safety limit');
  }
  return new TextDecoder().decode(bytes);
}

async function adapterJson(
  url: string,
  init: RequestInit,
  label: string
): Promise<Record<string, unknown>> {
  const response = await adapterResponse(url, init);
  const body = await responseText(response);
  if (!response.ok) throw new Error(`${label} failed (${response.status})`);
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${label} returned a non-object JSON response`);
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

export interface AdapterResult {
  ok: boolean;
  detail: string;
}

/** Every bounded gather reports whether it covered its declared source window.
 * `complete: false` is data, not an error: callers must preserve the reason in
 * the model packet and in run diagnostics instead of silently treating a cap
 * or a deliberate sample as the entire source. */
export interface GatherCompleteness {
  complete: boolean;
  sampled: boolean;
  returned: number;
  available: number | null;
  reason?: string;
}

export interface GatherResult<T> {
  data: T;
  completeness: GatherCompleteness;
}

interface GatherPageOptions {
  /** Test/operational escape hatch. Production defaults remain deliberately
   * bounded so a connector cannot monopolize a worker forever. */
  maxPages?: number;
  maxChildPages?: number;
}

function pageLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value)) throw new Error('connector page limit must be an integer');
  return Math.min(fallback, Math.max(1, value));
}

function completeness(
  complete: boolean,
  returned: number,
  options: { sampled?: boolean; available?: number | null; reason?: string } = {}
): GatherCompleteness {
  return {
    complete,
    sampled: options.sampled ?? false,
    returned,
    available: options.available ?? (complete ? returned : null),
    ...(options.reason ? { reason: options.reason } : {}),
  };
}

export interface SessionSample {
  sid: string;
  email: string;
  distinctId: string;
  started: string;
  seconds: number;
  events: number;
  firstEvents: string[];
  rages: number;
  errors: number;
}

export interface PosthogGather {
  topline: { sessions: number; users: number; pageviews: number };
  ragePages: { url: string; count: number }[];
  samples: SessionSample[];
  completeness: GatherCompleteness;
}

export function privacySafeUrl(raw: unknown): string {
  try {
    const url = new URL(String(raw ?? ''));
    if (!['http:', 'https:'].includes(url.protocol) || url.origin === 'null') return ':invalid-url';
    const path = url.pathname
      .split('/')
      .map((segment) => {
        let decoded: string;
        try {
          decoded = decodeURIComponent(segment);
        } catch {
          return ':redacted';
        }
        if (decoded.includes('@')) return ':email';
        if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(decoded)) return ':id';
        if (/^\d{6,}$/.test(decoded) || /^[A-Za-z0-9_-]{32,}$/.test(decoded)) return ':id';
        return segment;
      })
      .join('/');
    return `${url.origin}${path}`.slice(0, 500);
  } catch {
    return ':invalid-url';
  }
}

interface PosthogConfig {
  host: string;
  projectId: string;
  apiKey: string;
}

function posthogConfig(
  meta: Record<string, unknown>,
  secret: Record<string, unknown>
): PosthogConfig {
  const host = publicHttpsOrigin(String(meta.host || 'https://us.posthog.com'));
  const projectId = String(meta.project_id || '');
  const apiKey = String(secret.api_key || '');
  if (!/^\d+$/.test(projectId) || !apiKey) {
    throw new Error('posthog connection is missing a numeric project id or key');
  }
  return { host, projectId, apiKey };
}

async function hogql(config: PosthogConfig, query: string): Promise<unknown[][]> {
  const data = await adapterJson(
    `${config.host}/api/projects/${config.projectId}/query/`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
    },
    'posthog query'
  );
  return (data.results ?? []) as unknown[][];
}

export async function posthogTest(
  meta: Record<string, unknown>,
  secret: Record<string, unknown>
): Promise<AdapterResult> {
  const config = posthogConfig(meta, secret);
  const rows = await hogql(
    config,
    'SELECT count() FROM events WHERE timestamp > now() - INTERVAL 7 DAY'
  );
  const count = Number(rows[0]?.[0] ?? 0);
  return { ok: true, detail: `${count.toLocaleString()} events in the last 7 days` };
}

/** Tier-1 watcher gather: three batched HogQL queries per sweep, well inside
 * PostHog's query-endpoint rate limits. `sampleLimit` shrinks when a hosted
 * workspace is over its watching budget - the sweep degrades, never fails. */
export async function posthogGather(
  meta: Record<string, unknown>,
  secret: Record<string, unknown>,
  windowDays: number,
  sampleLimit = 40
): Promise<PosthogGather> {
  const config = posthogConfig(meta, secret);
  const safeWindowDays = Math.min(30, Math.max(1, Math.round(windowDays)));
  const interval = `INTERVAL ${safeWindowDays} DAY`;
  const limit = Math.min(80, Math.max(1, Math.round(sampleLimit)));

  const topline = await hogql(
    config,
    `SELECT count(DISTINCT properties.$session_id), count(DISTINCT person_id), countIf(event = '$pageview')
     FROM events WHERE timestamp > now() - ${interval}`
  );

  const ragePages = await hogql(
    config,
    `SELECT properties.$current_url AS url, count() AS c
     FROM events
     WHERE timestamp > now() - ${interval} AND event IN ('$rageclick', '$exception')
     GROUP BY url ORDER BY c DESC LIMIT 12`
  );

  const samples = await hogql(
    config,
    `SELECT properties.$session_id AS sid,
            argMin(person.properties.email, timestamp) AS email,
            argMin(toString(distinct_id), timestamp) AS distinct_id,
            toString(min(timestamp)) AS started,
            dateDiff('second', min(timestamp), max(timestamp)) AS seconds,
            count() AS events,
            groupArray(24)(event) AS first_events,
            countIf(event = '$rageclick') AS rages,
            countIf(event = '$exception') AS errors
     FROM events
     WHERE timestamp > now() - ${interval} AND properties.$session_id IS NOT NULL
     GROUP BY sid
     ORDER BY rages DESC, errors DESC, events DESC
     LIMIT ${limit}`
  );

  const sampleRows = samples.flatMap((row) => {
    const sid = canonicalSessionId(row[0]);
    if (!sid) return [];
    return [
      {
        sid,
        email: String(row[1] ?? ''),
        distinctId: String(row[2] ?? ''),
        started: String(row[3] ?? ''),
        seconds: Number(row[4] ?? 0),
        events: Number(row[5] ?? 0),
        firstEvents: (row[6] as string[]) ?? [],
        rages: Number(row[7] ?? 0),
        errors: Number(row[8] ?? 0),
      },
    ];
  });
  const sessionCount = Number(topline[0]?.[0] ?? 0);
  const sampled = sessionCount > sampleRows.length;
  return {
    topline: {
      sessions: sessionCount,
      users: Number(topline[0]?.[1] ?? 0),
      pageviews: Number(topline[0]?.[2] ?? 0),
    },
    ragePages: ragePages.map((row) => ({
      url: privacySafeUrl(row[0]),
      count: Number(row[1] ?? 0),
    })),
    samples: sampleRows,
    completeness: completeness(!sampled, sampleRows.length, {
      sampled,
      available: sessionCount,
      reason: sampled
        ? `highest-signal sample capped at ${limit} sessions from ${sessionCount} in the window`
        : undefined,
    }),
  };
}

export interface StripeAccount {
  customerId: string;
  subscriptionId: string;
  name: string;
  email: string;
  status: string;
  mrrCents: number;
  currency: string;
}

export async function stripeTest(secret: Record<string, unknown>): Promise<AdapterResult> {
  const key = String(secret.api_key || '');
  const response = await adapterResponse('https://api.stripe.com/v1/customers?limit=1', {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`stripe auth failed (${response.status})`);
  return { ok: true, detail: 'read access confirmed' };
}

const STRIPE_SUBSCRIPTION_PAGE_CAP = 10;
const STRIPE_ITEM_PAGE_CAP = 10;

function stripeObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stripeObjectRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (row): row is Record<string, unknown> =>
          row !== null && typeof row === 'object' && !Array.isArray(row)
      )
    : [];
}

async function stripeItems(
  key: string,
  subscription: Record<string, unknown>,
  maxPages: number
): Promise<GatherResult<Record<string, unknown>[]>> {
  const embeddedItems = stripeObject(subscription.items);
  const items = stripeObjectRows(embeddedItems.data);
  let hasMore = embeddedItems.has_more === true;
  let after = String(items.at(-1)?.id ?? '');
  let page = 1;
  while (hasMore && after && page < maxPages) {
    const url = new URL('https://api.stripe.com/v1/subscription_items');
    url.searchParams.set('subscription', String(subscription.id ?? ''));
    url.searchParams.set('limit', '100');
    url.searchParams.set('starting_after', after);
    const data = await adapterJson(
      url.toString(),
      { headers: { Authorization: `Bearer ${key}` } },
      'stripe subscription items'
    );
    const rows = stripeObjectRows(data.data);
    items.push(...rows);
    hasMore = data.has_more === true;
    after = String(rows.at(-1)?.id ?? '');
    page += 1;
  }
  const complete = !hasMore;
  return {
    data: items,
    completeness: completeness(complete, items.length, {
      reason: complete
        ? undefined
        : `a subscription exceeded the ${maxPages * 100}-line-item safety cap`,
    }),
  };
}

export async function stripeGather(
  secret: Record<string, unknown>,
  options: GatherPageOptions = {}
): Promise<GatherResult<StripeAccount[]>> {
  const key = String(secret.api_key || '');
  if (!key) throw new Error('stripe connection is missing an API key');
  const accounts: StripeAccount[] = [];
  const maxPages = pageLimit(options.maxPages, STRIPE_SUBSCRIPTION_PAGE_CAP);
  const maxChildPages = pageLimit(options.maxChildPages, STRIPE_ITEM_PAGE_CAP);
  let after = '';
  let hasMore = false;
  const incompleteReasons = new Set<string>();
  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL('https://api.stripe.com/v1/subscriptions');
    url.searchParams.set('limit', '100');
    url.searchParams.set('expand[]', 'data.customer');
    if (after) url.searchParams.set('starting_after', after);
    const data = await adapterJson(
      url.toString(),
      { headers: { Authorization: `Bearer ${key}` } },
      'stripe subscriptions'
    );
    const rows = stripeObjectRows(data.data);
    for (const sub of rows) {
      if (!['active', 'trialing', 'past_due'].includes(String(sub.status ?? ''))) continue;
      const customer = stripeObject(sub.customer);
      const customerId = String(customer.id ?? sub.customer ?? '');
      if (!customerId.startsWith('cus_')) continue;
      let mrr = 0;
      let currency = '';
      const itemResult = await stripeItems(key, sub, maxChildPages);
      if (!itemResult.completeness.complete && itemResult.completeness.reason) {
        incompleteReasons.add(itemResult.completeness.reason);
      }
      for (const item of itemResult.data) {
        const price = stripeObject(item.price);
        const recurring = stripeObject(price.recurring);
        const itemCurrency = String(price.currency ?? '').toUpperCase();
        if (currency && itemCurrency && itemCurrency !== currency) continue;
        currency ||= itemCurrency;
        const unitAmount = Number(price.unit_amount_decimal ?? price.unit_amount ?? 0);
        const quantity = Number(item.quantity ?? 1);
        const intervalCount = Math.max(1, Number(recurring.interval_count ?? 1));
        if (!Number.isFinite(unitAmount) || !Number.isFinite(quantity) || quantity < 0) continue;
        const amount = unitAmount * quantity;
        switch (recurring.interval) {
          case 'day':
            mrr += (amount * (365.2425 / 12)) / intervalCount;
            break;
          case 'week':
            mrr += (amount * (365.2425 / 84)) / intervalCount;
            break;
          case 'month':
            mrr += amount / intervalCount;
            break;
          case 'year':
            mrr += amount / (12 * intervalCount);
            break;
        }
      }
      accounts.push({
        customerId,
        subscriptionId: String(sub.id ?? ''),
        name: String(customer.name || customer.email || `customer ${sub.customer}`),
        email: String(customer.email || ''),
        status: String(sub.status),
        mrrCents: Math.max(0, Math.round(mrr)),
        currency: currency || 'USD',
      });
    }
    hasMore = data.has_more === true;
    if (!hasMore || rows.length === 0) break;
    after = String(rows.at(-1)?.id ?? '');
    if (!after) break;
  }
  if (hasMore) {
    incompleteReasons.add(`subscription list exceeded the ${maxPages * 100}-record safety cap`);
  }
  const complete = incompleteReasons.size === 0;
  return {
    data: accounts,
    completeness: completeness(complete, accounts.length, {
      reason: complete ? undefined : [...incompleteReasons].join('; '),
    }),
  };
}

/** Backward-compatible data-only wrapper. New run paths must use
 * `stripeGather` so completeness cannot be discarded accidentally. */
export async function stripeAccounts(secret: Record<string, unknown>): Promise<StripeAccount[]> {
  return (await stripeGather(secret)).data;
}

export interface GithubPr {
  number: number;
  title: string;
  mergedAt: string;
}

export async function githubTest(
  meta: Record<string, unknown>,
  secret: Record<string, unknown>
): Promise<AdapterResult> {
  const repo = String(meta.repo || '');
  const token = String(secret.token || '');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))
    throw new Error('invalid GitHub repository');
  const response = await adapterResponse(`https://api.github.com/repos/${repo}`, {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'postshow' },
  });
  if (!response.ok) throw new Error(`github access failed (${response.status})`);
  return { ok: true, detail: `access to ${repo} confirmed` };
}

export async function githubRecentPrs(
  meta: Record<string, unknown>,
  secret: Record<string, unknown>,
  days: number
): Promise<GithubPr[]> {
  return (await githubGather(meta, secret, days)).data;
}

const GITHUB_PULL_PAGE_CAP = 10;

export async function githubGather(
  meta: Record<string, unknown>,
  secret: Record<string, unknown>,
  days: number,
  options: GatherPageOptions = {}
): Promise<GatherResult<GithubPr[]>> {
  const repo = String(meta.repo || '');
  const token = String(secret.token || '');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))
    throw new Error('invalid GitHub repository');
  const safeDays = Math.min(30, Math.max(1, Math.round(days)));
  const cutoff = Date.now() - safeDays * 86400_000;
  const maxPages = pageLimit(options.maxPages, GITHUB_PULL_PAGE_CAP);
  const prs: GithubPr[] = [];
  let complete = false;
  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(`https://api.github.com/repos/${repo}/pulls`);
    url.searchParams.set('state', 'closed');
    url.searchParams.set('sort', 'updated');
    url.searchParams.set('direction', 'desc');
    url.searchParams.set('per_page', '100');
    url.searchParams.set('page', String(page));
    const response = await adapterResponse(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'postshow' },
    });
    if (!response.ok) throw new Error(`github pull requests failed (${response.status})`);
    const rows = (await response.json()) as {
      number: number;
      title: string;
      merged_at: string | null;
      updated_at?: string | null;
    }[];
    for (const pr of rows) {
      if (pr.merged_at && new Date(pr.merged_at).getTime() > cutoff) {
        prs.push({ number: pr.number, title: pr.title, mergedAt: pr.merged_at });
      }
    }
    const oldestUpdated = Date.parse(rows.at(-1)?.updated_at ?? '');
    if (rows.length < 100 || (Number.isFinite(oldestUpdated) && oldestUpdated <= cutoff)) {
      complete = true;
      break;
    }
  }
  return {
    data: prs,
    completeness: completeness(complete, prs.length, {
      reason: complete
        ? undefined
        : `closed pull-request history exceeded the ${maxPages * 100}-record safety cap`,
    }),
  };
}

export async function githubCreateIssue(
  meta: Record<string, unknown>,
  secret: Record<string, unknown>,
  title: string,
  body: string
): Promise<string> {
  const repo = String(meta.repo || '');
  const token = String(secret.token || '');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))
    throw new Error('invalid GitHub repository');
  const response = await adapterResponse(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'postshow',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, body }),
  });
  if (!response.ok) throw new Error(`github issue failed (${response.status})`);
  const issue = await response.json();
  return String(issue.html_url ?? '');
}

async function linearGraphql(
  secret: Record<string, unknown>,
  query: string,
  variables?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const apiKey = String(secret.api_key || '');
  const response = await adapterResponse('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: apiKey },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`linear request failed (${response.status})`);
  const data = await response.json();
  if (data.errors?.length) throw new Error('linear rejected the request');
  return data.data as Record<string, unknown>;
}

export async function linearTest(
  secret: Record<string, unknown>,
  meta: Record<string, unknown> = {}
): Promise<AdapterResult> {
  const teamKey = String(meta.team_key ?? '');
  if (!teamKey) throw new Error('a Linear team key is required');
  const data = await linearGraphql(secret, '{ viewer { email } teams { nodes { key } } }');
  const viewer = data.viewer as { email?: string } | undefined;
  const teams = ((data.teams as { nodes?: { key?: string }[] } | undefined)?.nodes ?? []).map((t) =>
    String(t.key ?? '')
  );
  if (!teams.includes(teamKey)) throw new Error(`Linear team ${teamKey} is not accessible`);
  return {
    ok: true,
    detail: `authenticated as ${viewer?.email ?? 'unknown'}${teamKey ? ` · team ${teamKey}` : ''}`,
  };
}

export async function linearCreateIssue(
  meta: Record<string, unknown>,
  secret: Record<string, unknown>,
  title: string,
  body: string
): Promise<string> {
  const teamKey = String(meta.team_key || '');
  const teams = await linearGraphql(secret, '{ teams { nodes { id key } } }');
  const nodes = (teams.teams as { nodes: { id: string; key: string }[] }).nodes ?? [];
  const team = nodes.find((t) => t.key === teamKey);
  if (!team) throw new Error(`configured Linear team ${teamKey || '(missing)'} was not found`);
  const result = await linearGraphql(
    secret,
    `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { url } } }`,
    { input: { title, description: body, teamId: team.id } }
  );
  const create = result.issueCreate as { success: boolean; issue?: { url?: string } };
  if (!create.success) throw new Error('linear issue creation failed');
  return String(create.issue?.url ?? '');
}

export async function resendTest(
  meta: Record<string, unknown>,
  secret: Record<string, unknown>
): Promise<AdapterResult> {
  const key = String(secret.api_key || '');
  const from = String(meta.from || '')
    .trim()
    .toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(from)) {
    throw new Error('a valid Resend from address is required');
  }
  const fromDomain = from.split('@')[1]!;
  const response = await adapterResponse('https://api.resend.com/domains', {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`resend auth failed (${response.status})`);
  const data = await response.json();
  const domains = Array.isArray(data.data) ? data.data : [];
  const match = domains.find(
    (domain: unknown) =>
      domain !== null &&
      typeof domain === 'object' &&
      String((domain as Record<string, unknown>).name ?? '').toLowerCase() === fromDomain
  ) as Record<string, unknown> | undefined;
  if (!match || String(match.status ?? '').toLowerCase() !== 'verified') {
    throw new Error(`Resend domain ${fromDomain} is not verified`);
  }
  return { ok: true, detail: `verified sender domain ${fromDomain}` };
}

export async function resendSend(
  meta: Record<string, unknown>,
  secret: Record<string, unknown>,
  to: string,
  subject: string,
  text: string,
  idempotencyKey?: string
): Promise<string> {
  const key = String(secret.api_key || '');
  const from = String(meta.from || '');
  if (!from) throw new Error('resend connection has no from address');
  const response = await adapterResponse('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify({ from, to, subject, text }),
  });
  if (!response.ok) throw new Error(`resend send failed (${response.status})`);
  const data = await response.json();
  return String(data.id ?? '');
}

export async function slackTest(secret: Record<string, unknown>): Promise<AdapterResult> {
  const url = String(secret.webhook_url || '');
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'hooks.slack.com' ||
    !parsed.pathname.startsWith('/services/')
  ) {
    throw new Error('expected a Slack incoming-webhook URL');
  }
  const response = await adapterResponse(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Postshow connected. This channel gets the debrief.' }),
  });
  if (!response.ok) throw new Error(`slack webhook failed (${response.status})`);
  return { ok: true, detail: 'test message posted' };
}

export async function slackDigest(secret: Record<string, unknown>, text: string): Promise<void> {
  const url = String(secret.webhook_url || '');
  if (!url) return;
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'hooks.slack.com' ||
    !parsed.pathname.startsWith('/services/')
  ) {
    throw new Error('expected a Slack incoming-webhook URL');
  }
  const response = await adapterResponse(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) throw new Error(`slack webhook failed (${response.status})`);
}

export interface SentryIssue {
  /** Provider-owned stable identifier. The only value a finding may cite. */
  id: string;
  title: string;
  count: number;
  permalink: string;
  firstSeen: string;
  lastSeen: string;
}

/** The exact `lastSeen` range one run asked Sentry for. It travels with the
 * issues because an issue list without its window cannot be validated: a later
 * reference is only evidence if it falls inside the collection that produced
 * it. */
export interface SentryCollectionWindow {
  days: number;
  since: string;
  until: string;
}

export interface SentryGather extends GatherResult<SentryIssue[]> {
  window: SentryCollectionWindow;
}

const SENTRY_ISSUE_PAGE_CAP = 5;
const SENTRY_TEXT_MAX = 200;
// deno-lint-ignore no-control-regex -- the C0 range and DEL are exactly what this class strips
const SENTRY_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;
const SENTRY_EMAIL = /[^\s@]+@[^\s@]+\.[A-Za-z]{2,}/g;
const SENTRY_QUERY_STRING = /\?[^\s]*=[^\s]*/g;
const SENTRY_HOME_DIRECTORY = /((?:[A-Za-z]:)?[\\/](?:Users|home))([\\/])[^\\/\s]+/g;
const SENTRY_OPAQUE_TOKEN = /[0-9a-f]{8}-[0-9a-f-]{27,}|[A-Za-z0-9_-]{32,}|\d{6,}/gi;

/** The `privacySafeUrl` treatment for provider-authored free text. Sentry issue
 * titles are written by whoever threw the exception inside the customer's
 * product, and they routinely carry breadcrumb emails, developer home
 * directories, query strings, and bearer tokens. Redaction happens here, at the
 * connector boundary, so nothing unredacted can reach a packet or a model. */
export function privacySafeSentryText(raw: unknown): string {
  return String(raw ?? '')
    .replace(SENTRY_CONTROL_CHARACTERS, ' ')
    .replace(SENTRY_EMAIL, ':email')
    .replace(SENTRY_QUERY_STRING, '?:redacted')
    .replace(SENTRY_HOME_DIRECTORY, '$1$2:user')
    .replace(SENTRY_OPAQUE_TOKEN, ':id')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SENTRY_TEXT_MAX);
}

/** A permalink is a rendered link, never the reference itself, so an unusable
 * one costs the issue its deep link and nothing else. */
function sentryPermalink(raw: unknown): string {
  let url: URL;
  try {
    url = new URL(String(raw ?? ''));
  } catch {
    return '';
  }
  if (url.protocol !== 'https:') return '';
  if (url.hostname !== 'sentry.io' && !url.hostname.endsWith('.sentry.io')) return '';
  return url.toString().slice(0, 500);
}

function sentryTimestamp(raw: unknown): string {
  const parsed = Date.parse(String(raw ?? ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function sentryObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sentryNextCursor(linkHeader: string | null, expectedPath: string): string | null {
  if (!linkHeader) return null;
  const next = linkHeader
    .split(/,(?=\s*<)/)
    .find(
      (entry) =>
        /rel="next"/i.test(entry) &&
        !/results="false"/i.test(entry) &&
        /results="true"/i.test(entry)
    );
  if (!next) return null;
  const rawUrl = next.match(/<([^>]+)>/)?.[1];
  if (!rawUrl) throw new Error('sentry pagination returned an invalid next link');
  const url = new URL(rawUrl);
  if (url.origin !== 'https://sentry.io' || url.pathname !== expectedPath) {
    throw new Error('sentry pagination attempted to leave the configured endpoint');
  }
  const cursor = url.searchParams.get('cursor');
  if (!cursor) throw new Error('sentry pagination returned an invalid cursor');
  return cursor;
}

export async function sentryTest(
  meta: Record<string, unknown>,
  secret: Record<string, unknown>
): Promise<AdapterResult> {
  const org = String(meta.org_slug || '');
  const token = String(secret.token || '');
  if (!/^[A-Za-z0-9_-]+$/.test(org)) throw new Error('invalid Sentry organization slug');
  const response = await adapterResponse(`https://sentry.io/api/0/organizations/${org}/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`sentry access failed (${response.status})`);
  return { ok: true, detail: `access to ${org} confirmed` };
}

export async function sentryGather(
  meta: Record<string, unknown>,
  secret: Record<string, unknown>,
  windowDays: number,
  options: GatherPageOptions = {}
): Promise<SentryGather> {
  const org = String(meta.org_slug || '');
  const project = String(meta.project_slug || '');
  const token = String(secret.token || '');
  if (!/^[A-Za-z0-9_-]+$/.test(org) || !/^[A-Za-z0-9_-]+$/.test(project)) {
    throw new Error('invalid Sentry organization or project slug');
  }
  // The window is provenance, not a display detail, so an unusable one is an
  // error rather than a silently degraded range.
  if (!Number.isFinite(windowDays)) {
    throw new Error('sentry collection window must be a finite number of days');
  }
  const days = Math.min(30, Math.max(1, Math.round(windowDays)));
  const until = Date.now();
  const window: SentryCollectionWindow = {
    days,
    since: new Date(until - days * 86400_000).toISOString(),
    until: new Date(until).toISOString(),
  };
  const expectedPath = `/api/0/projects/${org}/${project}/issues/`;
  const maxPages = pageLimit(options.maxPages, SENTRY_ISSUE_PAGE_CAP);
  const issues: SentryIssue[] = [];
  const seenIssueIds = new Set<string>();
  const seenCursors = new Set<string>();
  let uncitableRows = 0;
  let cursor: string | null = null;
  let reachedEnd = false;
  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(`https://sentry.io${expectedPath}`);
    // On this endpoint `statsPeriod` picks the response graph rather than the
    // filter, so the collection window is the structured `lastSeen` query and
    // the graph is switched off instead of paid for and discarded.
    url.searchParams.set('query', `is:unresolved lastSeen:-${days}d`);
    url.searchParams.set('statsPeriod', '');
    url.searchParams.set('sort', 'freq');
    url.searchParams.set('per_page', '100');
    if (cursor) url.searchParams.set('cursor', cursor);
    const response = await adapterResponse(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`sentry issues failed (${response.status})`);
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) throw new Error('sentry issues returned a non-array payload');
    for (const raw of payload) {
      const row = sentryObject(raw);
      const id = canonicalSentryIssueId(row.id);
      const firstSeen = sentryTimestamp(row.firstSeen);
      const lastSeen = sentryTimestamp(row.lastSeen);
      // An issue that cannot be named or placed in time can never become a
      // reference, so it is dropped and counted rather than padding the packet.
      if (!id || !firstSeen || !lastSeen) {
        uncitableRows += 1;
        continue;
      }
      if (seenIssueIds.has(id)) continue;
      seenIssueIds.add(id);
      const count = Number(row.count ?? 0);
      issues.push({
        id,
        title: privacySafeSentryText(row.title),
        count: Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0,
        permalink: sentryPermalink(row.permalink),
        firstSeen,
        lastSeen,
      });
    }
    const nextCursor = sentryNextCursor(response.headers.get('link'), expectedPath);
    if (!nextCursor) {
      reachedEnd = true;
      break;
    }
    if (seenCursors.has(nextCursor)) throw new Error('sentry pagination cursor repeated');
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
  const reasons: string[] = [];
  if (!reachedEnd) {
    reasons.push(`unresolved issue history exceeded the ${maxPages * 100}-record safety cap`);
  }
  if (uncitableRows > 0) {
    reasons.push(`${uncitableRows} issue row(s) had no usable provider identifier or timestamps`);
  }
  return {
    data: issues,
    window,
    completeness: completeness(reasons.length === 0, issues.length, {
      reason: reasons.length === 0 ? undefined : reasons.join('; '),
    }),
  };
}

/** Render adapter gather results into packet sections. Shared so the cloud
 * runtime and the local (CLI/desktop) runtime produce identical packets. */
type ArrayGatherInput<T> = T[] | GatherResult<T[]> | null;

function normalizeArrayGather<T>(input: ArrayGatherInput<T>): GatherResult<T[]> | null {
  if (input === null) return null;
  if (Array.isArray(input)) {
    return { data: input, completeness: completeness(true, input.length) };
  }
  return input;
}

function completenessSummary(source: string, value: GatherCompleteness, presented: number): string {
  const state = value.complete ? 'complete' : value.sampled ? 'sampled' : 'partial';
  const available = value.available === null ? 'unknown' : String(value.available);
  const presentation =
    presented < value.returned ? `; packet presents ${presented} of ${value.returned}` : '';
  const reason = value.reason ? `; reason=${value.reason}` : '';
  return `SOURCE COVERAGE (${source}): ${state}; gathered=${value.returned}; available=${available}${presentation}${reason}`;
}

export function packetSections(input: {
  posthog: PosthogGather | null;
  stripe: ArrayGatherInput<StripeAccount>;
  /** Sentry has no data-only form: without its collection window an issue list
   * cannot be labeled honestly or validated later. */
  sentry: SentryGather | null;
  github: ArrayGatherInput<GithubPr>;
}): string[] {
  const sections: string[] = [];
  if (input.posthog) {
    const p = input.posthog;
    sections.push(
      completenessSummary('posthog sessions', p.completeness, p.samples.length),
      `PRODUCT ANALYTICS (last window): sessions=${p.topline.sessions} users=${p.topline.users} pageviews=${p.topline.pageviews}`,
      `PAGES WITH RAGE CLICKS / EXCEPTIONS:\n${p.ragePages.map((r) => `  ${r.count}× ${r.url}`).join('\n') || '  none'}`,
      `SESSION SAMPLES (worst first; firstEvents is the ordered event stream):\n${p.samples
        .map(
          (s) =>
            `  [session_id=${s.sid}] ${s.email ? 'identified user' : 'anonymous'} · ${s.seconds}s · ${s.events} events · rages=${s.rages} errors=${s.errors} · ${s.firstEvents.join('>')}`
        )
        .join('\n')}`
    );
  } else {
    sections.push('PRODUCT ANALYTICS: not connected.');
  }
  const stripe = normalizeArrayGather(input.stripe);
  if (stripe) {
    const presented = [...stripe.data]
      .sort((left, right) => right.mrrCents - left.mrrCents)
      .slice(0, 50);
    sections.push(
      completenessSummary('stripe subscriptions', stripe.completeness, presented.length),
      `REVENUE (stripe subscriptions; highest MRR first):\n${
        presented
          .map(
            (a) =>
              `  [account_identity_key=stripe:${a.customerId}] ${a.name} · ${a.status} · ${a.currency} ${(a.mrrCents / 100).toFixed(0)}/mo`
          )
          .join('\n') || '  none'
      }`
    );
  }
  const sentry = input.sentry;
  if (sentry) {
    const presented = sentry.data.slice(0, 50);
    sections.push(
      completenessSummary('sentry unresolved issues', sentry.completeness, presented.length),
      `ERRORS (sentry, unresolved, last seen inside the ${sentry.window.days}d collection window ${sentry.window.since} to ${sentry.window.until}):\n${
        presented
          .map(
            (issue) =>
              `  [sentry_issue_id=${issue.id}] ${issue.count}× ${issue.title} · first seen ${issue.firstSeen} · last seen ${issue.lastSeen}`
          )
          .join('\n') || '  none'
      }`
    );
  }
  const github = normalizeArrayGather(input.github);
  if (github) {
    const presented = github.data.slice(0, 50);
    sections.push(
      completenessSummary('github merged pull requests', github.completeness, presented.length),
      `RECENT MERGED PRS:\n${presented.map((pr) => `  #${pr.number} ${pr.title} (${pr.mergedAt})`).join('\n') || '  none'}`
    );
  }
  return sections;
}
