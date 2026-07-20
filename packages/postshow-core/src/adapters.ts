// Connector adapters: verify (connection test), gather (read for runs), and
// dispatch (execute approved actions). Pure fetch so every runtime (edge,
// CLI, desktop) can use them. All reads are read-only. The one adapter that
// cannot live here is the Postgres connection test, which needs a driver and
// stays in the edge runtime.

export interface AdapterResult {
  ok: boolean;
  detail: string;
}

export interface SessionSample {
  sid: string;
  email: string;
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
  const host = String(meta.host || 'https://us.posthog.com').replace(/\/$/, '');
  const projectId = String(meta.project_id || '');
  const apiKey = String(secret.api_key || '');
  if (!projectId || !apiKey) throw new Error('posthog connection is missing project id or key');
  return { host, projectId, apiKey };
}

async function hogql(config: PosthogConfig, query: string): Promise<unknown[][]> {
  const response = await fetch(`${config.host}/api/projects/${config.projectId}/query/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
  });
  if (!response.ok) {
    throw new Error(
      `posthog query failed (${response.status}): ${(await response.text()).slice(0, 200)}`
    );
  }
  const data = await response.json();
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
  const interval = `INTERVAL ${windowDays} DAY`;
  const limit = Math.min(80, Math.max(5, Math.round(sampleLimit)));

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
            any(person.properties.email) AS email,
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

  return {
    topline: {
      sessions: Number(topline[0]?.[0] ?? 0),
      users: Number(topline[0]?.[1] ?? 0),
      pageviews: Number(topline[0]?.[2] ?? 0),
    },
    ragePages: ragePages.map((row) => ({ url: String(row[0] ?? ''), count: Number(row[1] ?? 0) })),
    samples: samples.map((row) => ({
      sid: String(row[0] ?? ''),
      email: String(row[1] ?? ''),
      started: String(row[2] ?? ''),
      seconds: Number(row[3] ?? 0),
      events: Number(row[4] ?? 0),
      firstEvents: (row[5] as string[]) ?? [],
      rages: Number(row[6] ?? 0),
      errors: Number(row[7] ?? 0),
    })),
  };
}

export interface StripeAccount {
  name: string;
  email: string;
  status: string;
  mrrCents: number;
}

export async function stripeTest(secret: Record<string, unknown>): Promise<AdapterResult> {
  const key = String(secret.api_key || '');
  const response = await fetch('https://api.stripe.com/v1/customers?limit=1', {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`stripe auth failed (${response.status})`);
  return { ok: true, detail: 'read access confirmed' };
}

export async function stripeAccounts(secret: Record<string, unknown>): Promise<StripeAccount[]> {
  const key = String(secret.api_key || '');
  const response = await fetch(
    'https://api.stripe.com/v1/subscriptions?limit=100&expand[]=data.customer',
    { headers: { Authorization: `Bearer ${key}` } }
  );
  if (!response.ok) throw new Error(`stripe subscriptions failed (${response.status})`);
  const data = await response.json();
  const accounts: StripeAccount[] = [];
  for (const sub of data.data ?? []) {
    if (!['active', 'trialing', 'past_due'].includes(sub.status)) continue;
    const customer = sub.customer && typeof sub.customer === 'object' ? sub.customer : {};
    let mrr = 0;
    for (const item of sub.items?.data ?? []) {
      const price = item.price ?? {};
      const amount = Number(price.unit_amount ?? 0) * Number(item.quantity ?? 1);
      if (price.recurring?.interval === 'month') mrr += amount;
      else if (price.recurring?.interval === 'year') mrr += Math.round(amount / 12);
    }
    accounts.push({
      name: String(customer.name || customer.email || `customer ${sub.customer}`),
      email: String(customer.email || ''),
      status: String(sub.status),
      mrrCents: mrr,
    });
  }
  return accounts;
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
  const response = await fetch(`https://api.github.com/repos/${repo}`, {
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
  const repo = String(meta.repo || '');
  const token = String(secret.token || '');
  const response = await fetch(
    `https://api.github.com/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=20`,
    { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'postshow' } }
  );
  if (!response.ok) return [];
  const cutoff = Date.now() - days * 86400_000;
  const prs = (await response.json()) as {
    number: number;
    title: string;
    merged_at: string | null;
  }[];
  return prs
    .filter((pr) => pr.merged_at && new Date(pr.merged_at).getTime() > cutoff)
    .map((pr) => ({ number: pr.number, title: pr.title, mergedAt: pr.merged_at ?? '' }));
}

export async function githubCreateIssue(
  meta: Record<string, unknown>,
  secret: Record<string, unknown>,
  title: string,
  body: string
): Promise<string> {
  const repo = String(meta.repo || '');
  const token = String(secret.token || '');
  const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
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
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: apiKey },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`linear request failed (${response.status})`);
  const data = await response.json();
  if (data.errors?.length) throw new Error(String(data.errors[0].message));
  return data.data as Record<string, unknown>;
}

export async function linearTest(secret: Record<string, unknown>): Promise<AdapterResult> {
  const data = await linearGraphql(secret, '{ viewer { email } }');
  const viewer = data.viewer as { email?: string } | undefined;
  return { ok: true, detail: `authenticated as ${viewer?.email ?? 'unknown'}` };
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
  const team = nodes.find((t) => t.key === teamKey) ?? nodes[0];
  if (!team) throw new Error('no linear team found');
  const result = await linearGraphql(
    secret,
    `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { url } } }`,
    { input: { title, description: body, teamId: team.id } }
  );
  const create = result.issueCreate as { success: boolean; issue?: { url?: string } };
  if (!create.success) throw new Error('linear issue creation failed');
  return String(create.issue?.url ?? '');
}

export async function resendTest(secret: Record<string, unknown>): Promise<AdapterResult> {
  const key = String(secret.api_key || '');
  const response = await fetch('https://api.resend.com/domains', {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`resend auth failed (${response.status})`);
  const data = await response.json();
  const count = (data.data ?? []).length;
  return { ok: true, detail: `${count} sending domain${count === 1 ? '' : 's'} available` };
}

export async function resendSend(
  meta: Record<string, unknown>,
  secret: Record<string, unknown>,
  to: string,
  subject: string,
  text: string
): Promise<string> {
  const key = String(secret.api_key || '');
  const from = String(meta.from || '');
  if (!from) throw new Error('resend connection has no from address');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, text }),
  });
  if (!response.ok) {
    throw new Error(
      `resend send failed (${response.status}): ${(await response.text()).slice(0, 200)}`
    );
  }
  const data = await response.json();
  return String(data.id ?? '');
}

export async function slackTest(secret: Record<string, unknown>): Promise<AdapterResult> {
  const url = String(secret.webhook_url || '');
  if (!url.startsWith('https://hooks.slack.com/')) {
    throw new Error('expected a Slack incoming-webhook URL');
  }
  const response = await fetch(url, {
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
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

export interface SentryIssue {
  title: string;
  count: number;
  permalink: string;
}

export async function sentryTest(
  meta: Record<string, unknown>,
  secret: Record<string, unknown>
): Promise<AdapterResult> {
  const org = String(meta.org_slug || '');
  const token = String(secret.token || '');
  const response = await fetch(`https://sentry.io/api/0/organizations/${org}/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`sentry access failed (${response.status})`);
  return { ok: true, detail: `access to ${org} confirmed` };
}

export async function sentryIssues(
  meta: Record<string, unknown>,
  secret: Record<string, unknown>
): Promise<SentryIssue[]> {
  const org = String(meta.org_slug || '');
  const project = String(meta.project_slug || '');
  const token = String(secret.token || '');
  const response = await fetch(
    `https://sentry.io/api/0/projects/${org}/${project}/issues/?query=is:unresolved&statsPeriod=24h&sort=freq`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!response.ok) return [];
  const issues = (await response.json()) as { title: string; count: string; permalink: string }[];
  return issues.slice(0, 10).map((issue) => ({
    title: issue.title,
    count: Number(issue.count ?? 0),
    permalink: issue.permalink,
  }));
}

/** Render adapter gather results into packet sections. Shared so the cloud
 * runtime and the local (CLI/desktop) runtime produce identical packets. */
export function packetSections(input: {
  posthog: PosthogGather | null;
  stripe: StripeAccount[] | null;
  sentry: SentryIssue[] | null;
  github: GithubPr[] | null;
}): string[] {
  const sections: string[] = [];
  if (input.posthog) {
    const p = input.posthog;
    sections.push(
      `PRODUCT ANALYTICS (last window): sessions=${p.topline.sessions} users=${p.topline.users} pageviews=${p.topline.pageviews}`,
      `PAGES WITH RAGE CLICKS / EXCEPTIONS:\n${p.ragePages.map((r) => `  ${r.count}× ${r.url}`).join('\n') || '  none'}`,
      `SESSION SAMPLES (worst first; firstEvents is the ordered event stream):\n${p.samples
        .slice(0, 24)
        .map(
          (s) =>
            `  [${s.sid.slice(0, 8)}] ${s.email || 'anonymous'} · ${s.seconds}s · ${s.events} events · rages=${s.rages} errors=${s.errors} · ${s.firstEvents.join('>')}`
        )
        .join('\n')}`
    );
  } else {
    sections.push('PRODUCT ANALYTICS: not connected.');
  }
  if (input.stripe) {
    sections.push(
      `REVENUE (stripe subscriptions):\n${input.stripe
        .slice(0, 50)
        .map((a) => `  ${a.name} <${a.email}> · ${a.status} · $${(a.mrrCents / 100).toFixed(0)}/mo`)
        .join('\n')}`
    );
  }
  if (input.sentry?.length) {
    sections.push(
      `ERRORS (sentry, 24h, unresolved):\n${input.sentry.map((i) => `  ${i.count}× ${i.title}`).join('\n')}`
    );
  }
  if (input.github?.length) {
    sections.push(
      `RECENT MERGED PRS:\n${input.github.map((pr) => `  #${pr.number} ${pr.title} (${pr.mergedAt})`).join('\n')}`
    );
  }
  return sections;
}
