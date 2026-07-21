import { describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../config';
import {
  buildInboxReviewUrl,
  inboxReview,
  inboxSkip,
  type InboxDependencies,
  type InboxItem,
} from './inbox';

const item: InboxItem = {
  id: '00000000-0000-4000-8000-000000000001',
  kind: 'outreach',
  meta: 'Account',
  title: 'Follow up',
  body: 'Draft body',
  evidence: 'Evidence',
  action_label: 'Send email',
  action_revision: 7,
};

function harness(nextItem: InboxItem = item) {
  const config = defaultConfig();
  config.workspaceId = '10000000-0000-4000-8000-000000000001';
  config.token = 'psh_must_not_appear_in_handoff';
  const calls: { op: string; args: Record<string, unknown> }[] = [];
  const dependencies: InboxDependencies = {
    loadConfig: () => config,
    gateway: vi.fn(async (_config, op, args = {}) => {
      calls.push({ op, args });
      if (op === 'inbox.list' && args.state === 'pending') {
        return { ok: true, items: [nextItem] };
      }
      if (op === 'inbox.list' && args.state === 'skipped') {
        return { ok: true, items: [{ ...nextItem, state: 'skipped' }] };
      }
      if (op === 'inbox.skip') return { ok: true };
      throw new Error(`unexpected operation ${op}`);
    }),
    dim: vi.fn(),
    fail: vi.fn(),
    ok: vi.fn(),
    say: vi.fn(),
  };
  return { config, calls, dependencies };
}

describe('inbox command safety boundary', () => {
  it('produces a token-free authenticated web handoff and never approves via PAT', async () => {
    const test = harness();

    await expect(inboxReview(item.id.slice(0, 8), test.dependencies)).resolves.toBe(0);

    expect(test.calls.map((call) => call.op)).toEqual(['inbox.list']);
    const output = (test.dependencies.say as ReturnType<typeof vi.fn>).mock.calls.flat().join('\n');
    expect(output).toContain('https://postshow.io/inbox?');
    expect(output).toContain(encodeURIComponent(item.id));
    expect(output).not.toContain(test.config.token);
    expect(test.calls.some((call) => call.op === 'inbox.approve')).toBe(false);
  });

  it('skips only the exact current action revision', async () => {
    const test = harness();

    await expect(inboxSkip(item.id.slice(0, 8), test.dependencies)).resolves.toBe(0);

    expect(test.calls).toEqual([
      { op: 'inbox.list', args: { state: 'pending' } },
      {
        op: 'inbox.skip',
        args: { item_id: item.id, expected_revision: item.action_revision },
      },
      { op: 'inbox.list', args: { state: 'skipped', limit: 100 } },
    ]);
    expect(test.dependencies.ok).toHaveBeenCalledWith(
      'skipped. the agent learns from what you pass on.'
    );
  });

  it('does not print success for a generic skip envelope without exact readback', async () => {
    const test = harness();
    const base = test.dependencies.gateway;
    test.dependencies.gateway = vi.fn(async (config, op, args) => {
      if (op === 'inbox.list' && args?.state === 'skipped') return { ok: true };
      return base(config, op, args);
    });

    await expect(inboxSkip(item.id.slice(0, 8), test.dependencies)).rejects.toThrow(
      'gateway did not confirm the exact skipped inbox revision'
    );

    expect(test.dependencies.ok).not.toHaveBeenCalled();
  });

  it('refuses a revisionless legacy item instead of issuing an unsafe skip', async () => {
    const test = harness({ ...item, action_revision: Number.NaN });

    await expect(inboxSkip(item.id, test.dependencies)).resolves.toBe(1);

    expect(test.calls.map((call) => call.op)).toEqual(['inbox.list']);
    expect(test.dependencies.fail).toHaveBeenCalledWith(
      'the inbox item has no valid action revision; refresh and retry'
    );
  });

  it('builds a handoff from identifiers only', () => {
    const url = buildInboxReviewUrl(
      '10000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000001'
    );
    expect(url).toBe(
      'https://postshow.io/inbox?workspace=10000000-0000-4000-8000-000000000001&item=00000000-0000-4000-8000-000000000001'
    );
  });
});
