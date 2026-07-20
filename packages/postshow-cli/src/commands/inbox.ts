// `postshow inbox` - review the action queue from the terminal. Approving
// executes the action (send, file, adopt) exactly as the web approve does.

import { gateway } from '../api';
import { loadConfig } from '../config';
import { dim, fail, ok, say } from '../ui';

interface Item {
  id: string;
  kind: string;
  meta: string;
  title: string;
  body: string;
  evidence: string;
  action_label: string;
}

export async function inboxList(): Promise<number> {
  const config = loadConfig();
  const { items } = await gateway<{ items: Item[] }>(config, 'inbox.list', { state: 'pending' });
  if (!items.length) {
    dim('inbox zero. the agent only queues what is worth a human decision.');
    return 0;
  }
  for (const item of items) {
    say('');
    say(`[${item.id.slice(0, 8)}] ${item.title}`);
    dim(`  ${item.meta || item.kind} · ${item.action_label}`);
    if (item.evidence) dim(`  evidence: ${item.evidence}`);
    if (item.body) {
      for (const line of item.body.split('\n').slice(0, 6)) dim(`  ${line}`);
    }
  }
  say('');
  say(`${items.length} pending · postshow inbox approve <id> · postshow inbox skip <id>`);
  return 0;
}

async function resolveItemId(prefix: string): Promise<string | null> {
  const config = loadConfig();
  const { items } = await gateway<{ items: Item[] }>(config, 'inbox.list', { state: 'pending' });
  const match = items.filter((item) => item.id.startsWith(prefix));
  if (match.length === 1) return match[0]!.id;
  if (match.length > 1) fail(`ambiguous id prefix: ${prefix}`);
  else fail(`no pending item matches: ${prefix}`);
  return null;
}

export async function inboxApprove(prefix: string): Promise<number> {
  const id = await resolveItemId(prefix);
  if (!id) return 1;
  const config = loadConfig();
  try {
    const result = await gateway<{ detail: string }>(config, 'inbox.approve', { item_id: id });
    ok(result.detail);
    return 0;
  } catch (error) {
    fail(error instanceof Error ? error.message : 'approve failed');
    return 1;
  }
}

export async function inboxSkip(prefix: string): Promise<number> {
  const id = await resolveItemId(prefix);
  if (!id) return 1;
  const config = loadConfig();
  await gateway(config, 'inbox.skip', { item_id: id });
  ok('skipped. the agent learns from what you pass on.');
  return 0;
}
