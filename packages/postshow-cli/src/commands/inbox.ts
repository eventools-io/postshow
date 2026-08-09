// `postshow inbox` - read and skip drafted actions from the terminal.
// Execution stays in the authenticated web app, where the user sees the
// destination preview and completes the one-time confirmation ceremony.

import { gateway } from '../api';
import { loadConfig, type CliConfig } from '../config';
import { dim, fail, ok, say } from '../ui';

export interface InboxItem {
  id: string;
  state?: string;
  kind: string;
  meta: string;
  title: string;
  body: string;
  evidence: string;
  action_label: string;
  action_revision: number;
}

type InboxGateway = (
  config: CliConfig,
  op: string,
  args?: Record<string, unknown>
) => Promise<unknown>;

const INBOX_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export interface InboxDependencies {
  loadConfig: typeof loadConfig;
  gateway: (config: CliConfig, op: string, args?: Record<string, unknown>) => Promise<unknown>;
  dim: typeof dim;
  fail: typeof fail;
  ok: typeof ok;
  say: typeof say;
}

const inboxDependencies: InboxDependencies = {
  loadConfig,
  gateway: (config, op, args) => gateway(config, op, args),
  dim,
  fail,
  ok,
  say,
};

export const HOSTED_REVIEW_ORIGIN = 'https://postshow.io';

/** The review link has to point at the deployment the caller is actually
 * talking to. A self-hosted workspace sent to the hosted origin is a link to
 * someone else's product, so the origin is derived from the configured gateway
 * and only falls back to the hosted app when the gateway is the hosted one. */
export function inboxReviewOrigin(apiUrl: string): string {
  if (!apiUrl) return HOSTED_REVIEW_ORIGIN;
  let gateway: URL;
  try {
    gateway = new URL(apiUrl);
  } catch {
    return HOSTED_REVIEW_ORIGIN;
  }
  if (gateway.hostname.endsWith('.supabase.co')) return HOSTED_REVIEW_ORIGIN;
  return gateway.origin;
}

export function buildInboxReviewUrl(workspaceId: string, itemId: string, apiUrl = ''): string {
  const url = new URL('/inbox', inboxReviewOrigin(apiUrl));
  if (workspaceId) url.searchParams.set('workspace', workspaceId);
  url.searchParams.set('item', itemId);
  return url.href;
}

/** A generic successful mutation envelope is not evidence that this exact
 * action revision was skipped. Read the authoritative skipped row back before
 * either the CLI or MCP surface reports success. */
export async function skipInboxItem(
  config: CliConfig,
  itemId: string,
  actionRevision: number,
  call: InboxGateway = (gatewayConfig, op, args) => gateway(gatewayConfig, op, args)
): Promise<{ ok: true; item_id: string; action_revision: number; state: 'skipped' }> {
  if (!INBOX_UUID_RE.test(itemId) || !Number.isSafeInteger(actionRevision) || actionRevision < 1) {
    throw new Error('a valid item id and exact positive action revision are required');
  }

  let mutationError: unknown;
  try {
    await call(config, 'inbox.skip', {
      item_id: itemId,
      expected_revision: actionRevision,
    });
  } catch (error) {
    // The write may have committed before the response was lost. The exact
    // readback below is authoritative and makes a retry safely idempotent.
    mutationError = error;
  }

  let readback: unknown;
  try {
    readback = await call(config, 'inbox.list', { state: 'skipped', limit: 100 });
  } catch (error) {
    throw mutationError ?? error;
  }
  const confirmed =
    isRecord(readback) &&
    Array.isArray(readback.items) &&
    readback.items.some(
      (entry) =>
        isRecord(entry) &&
        entry.id === itemId &&
        entry.action_revision === actionRevision &&
        entry.state === 'skipped'
    );
  if (!confirmed) {
    if (mutationError) throw mutationError;
    throw new Error('gateway did not confirm the exact skipped inbox revision');
  }

  return { ok: true, item_id: itemId, action_revision: actionRevision, state: 'skipped' };
}

async function pendingItems(
  config: CliConfig,
  dependencies: InboxDependencies
): Promise<InboxItem[]> {
  const payload = (await dependencies.gateway(config, 'inbox.list', {
    state: 'pending',
  })) as { items?: InboxItem[] };
  if (!Array.isArray(payload?.items)) throw new Error('gateway returned an invalid inbox response');
  return payload.items;
}

export async function inboxList(
  dependencies: InboxDependencies = inboxDependencies
): Promise<number> {
  const config = dependencies.loadConfig();
  const items = await pendingItems(config, dependencies);
  if (!items.length) {
    dependencies.dim('inbox zero. the agent only queues what is worth a human decision.');
    return 0;
  }
  for (const item of items) {
    dependencies.say('');
    dependencies.say(`[${item.id.slice(0, 8)}] ${item.title}`);
    dependencies.dim(`  ${item.meta || item.kind} · ${item.action_label}`);
    if (item.evidence) dependencies.dim(`  evidence: ${item.evidence}`);
    if (item.body) {
      for (const line of item.body.split('\n').slice(0, 6)) dependencies.dim(`  ${line}`);
    }
  }
  dependencies.say('');
  dependencies.say(
    `${items.length} pending · postshow inbox review <id> · postshow inbox skip <id>`
  );
  return 0;
}

async function resolvePendingItem(
  config: CliConfig,
  prefix: string,
  dependencies: InboxDependencies
): Promise<InboxItem | null> {
  const items = await pendingItems(config, dependencies);
  const matches = items.filter((item) => item.id.startsWith(prefix));
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) dependencies.fail(`ambiguous id prefix: ${prefix}`);
  else dependencies.fail(`no pending item matches: ${prefix}`);
  return null;
}

/** Print a token-free handoff. This deliberately does not mint an action
 * capability or execute anything from a long-lived CLI token. */
export async function inboxReview(
  prefix: string,
  dependencies: InboxDependencies = inboxDependencies
): Promise<number> {
  const config = dependencies.loadConfig();
  const item = await resolvePendingItem(config, prefix, dependencies);
  if (!item) return 1;
  dependencies.say('Review and confirm this action in your authenticated browser:');
  dependencies.say(buildInboxReviewUrl(config.workspaceId, item.id, config.apiUrl));
  dependencies.dim(
    'The CLI cannot execute inbox actions. The web preview binds the exact destination and revision.'
  );
  return 0;
}

// Backward-compatible command target: older scripts receive the safe web
// handoff instead of the former irreversible behavior.
export const inboxApprove = inboxReview;

export async function inboxSkip(
  prefix: string,
  dependencies: InboxDependencies = inboxDependencies
): Promise<number> {
  const config = dependencies.loadConfig();
  const item = await resolvePendingItem(config, prefix, dependencies);
  if (!item) return 1;
  if (!Number.isSafeInteger(item.action_revision) || item.action_revision < 1) {
    dependencies.fail('the inbox item has no valid action revision; refresh and retry');
    return 1;
  }
  await skipInboxItem(config, item.id, item.action_revision, dependencies.gateway);
  dependencies.ok('skipped. the agent learns from what you pass on.');
  return 0;
}
