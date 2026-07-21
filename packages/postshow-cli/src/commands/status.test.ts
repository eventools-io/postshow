import { describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../config';
import {
  runDoctor,
  runStatus,
  testReadOnlyConnector,
  usageTotals,
  type StatusDependencies,
} from './status';

function harness(): { dependencies: StatusDependencies; output: string[] } {
  const config = defaultConfig();
  config.token = 'psh_test';
  config.engine.mode = 'hosted';
  const output: string[] = [];
  const dependencies: StatusDependencies = {
    loadConfig: () => config,
    configPath: () => '/tmp/postshow/config.json',
    gateway: vi.fn(async (_config, op) => {
      if (op === 'workspace.get') {
        return {
          ok: true,
          workspace: { id: 'workspace', name: 'Acme', plan: 'team' },
          plan: { id: 'team', label: 'Team', quota: {} },
          usage: [
            { units_kind: 'sessions_watched', used_units: '12' },
            { units_kind: 'deep_dives', used_units: 2 },
            { units_kind: 'investigations', used_units: '4' },
          ],
        };
      }
      if (op === 'jobs.list') return { ok: true, jobs: [] };
      if (op === 'inbox.list') return { ok: true, items: [] };
      throw new Error(`unexpected operation ${op}`);
    }),
    detectOllama: vi.fn(async () => []),
    callModel: vi.fn(async () => ({ text: 'ok', inputTokens: 1, outputTokens: 1 })),
    testReadOnlyConnector: vi.fn(async () => ({ ok: true, detail: 'read access confirmed' })),
    verifyNativeCredentialStore: vi.fn(),
    dim: vi.fn((message: string) => output.push(message)),
    fail: vi.fn((message: string) => output.push(message)),
    ok: vi.fn((message: string) => output.push(message)),
    say: vi.fn((message: string) => output.push(message)),
    warn: vi.fn((message: string) => output.push(message)),
  };
  return { dependencies, output };
}

describe('usageTotals', () => {
  it('parses the exact usageOverview row array returned by workspace.get', () => {
    expect(
      usageTotals([
        { units_kind: 'sessions_watched', used_units: '1250' },
        { units_kind: 'deep_dives', used_units: 3 },
        { units_kind: 'investigations', used_units: '9' },
      ])
    ).toEqual({ sessionsWatched: 1250, deepDives: 3, investigations: 9 });
  });

  it('fails closed to zero for non-finite and negative counters', () => {
    expect(
      usageTotals([
        { units_kind: 'sessions_watched', used_units: 'not-a-number' },
        { units_kind: 'deep_dives', used_units: -4 },
        { units_kind: 'investigations', used_units: Number.POSITIVE_INFINITY },
      ])
    ).toEqual({ sessionsWatched: 0, deepDives: 0, investigations: 0 });
  });
});

describe('status and doctor contracts', () => {
  it('renders usage from the gateway row array rather than legacy object keys', async () => {
    const test = harness();

    await expect(runStatus(test.dependencies)).resolves.toBe(0);

    expect(test.output).toContain(
      'usage this month: 12 sessions watched · 2 deep dives · 4 investigations'
    );
  });

  it('live-tests read-only connectors, reports stale verification, and never tests Slack', async () => {
    const test = harness();
    const config = test.dependencies.loadConfig();
    config.connectors.push(
      {
        provider: 'stripe',
        label: 'Stripe',
        localOnly: true,
        verified: true,
        meta: {},
        secret: { api_key: 'rk_test' },
      },
      {
        provider: 'github',
        label: 'GitHub',
        localOnly: true,
        verified: false,
        meta: { repo: 'eventools-io/postshow' },
        secret: { token: 'ghp_test' },
      },
      {
        provider: 'slack',
        label: 'Slack',
        localOnly: true,
        verified: true,
        meta: {},
        secret: { webhook_url: 'https://hooks.slack.invalid/test' },
      }
    );

    await expect(runDoctor(test.dependencies)).resolves.toBe(1);

    const tested = (test.dependencies.testReadOnlyConnector as ReturnType<typeof vi.fn>).mock.calls
      .map(([connector]) => connector.provider)
      .sort();
    expect(tested).toEqual(['github', 'stripe']);
    expect(test.output).toContain(
      'slack: previously verified; live doctor test skipped because it would post a message'
    );
    expect(test.output.some((line) => line.includes('saved verification is false'))).toBe(true);
  });

  it('returns nonzero when a previously verified credential fails its live check', async () => {
    const test = harness();
    const config = test.dependencies.loadConfig();
    config.connectors.push({
      provider: 'stripe',
      label: 'Stripe',
      localOnly: true,
      verified: true,
      meta: {},
      secret: { api_key: 'rk_revoked' },
    });
    test.dependencies.testReadOnlyConnector = vi.fn(async () => {
      throw new Error('stripe access failed (401)');
    });

    await expect(runDoctor(test.dependencies)).resolves.toBe(1);
    expect(test.dependencies.fail).toHaveBeenCalledWith(
      'stripe: live credential check failed (stripe access failed (401))'
    );
  });

  it('requires a successful native credential write/read/delete roundtrip', async () => {
    const test = harness();
    test.dependencies.verifyNativeCredentialStore = vi.fn(() => {
      throw new Error('native account metadata must not be shown');
    });

    await expect(runDoctor(test.dependencies)).resolves.toBe(1);
    expect(test.dependencies.fail).toHaveBeenCalledWith('OS credential store self-test failed');
    expect(test.output.join('\n')).not.toContain('native account metadata');
  });

  it('routes Postgres doctor checks through the local read-only adapter', async () => {
    await expect(
      testReadOnlyConnector({
        provider: 'postgres',
        label: 'Postgres',
        localOnly: true,
        verified: true,
        meta: {},
        secret: {},
      })
    ).rejects.toThrow('Postgres connection string is required');
  });

  it('accepts verified Postgres as a complete local-run source', async () => {
    const test = harness();
    test.dependencies.loadConfig().connectors.push({
      provider: 'postgres',
      label: 'Postgres',
      localOnly: true,
      verified: true,
      meta: {},
      secret: {
        connection_string: 'postgresql://reader:private@localhost/app',
        query: 'SELECT 1 AS ok',
      },
    });

    await expect(runDoctor(test.dependencies)).resolves.toBe(0);
    expect(test.dependencies.testReadOnlyConnector).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'postgres', localOnly: true, verified: true })
    );
    expect(test.output).toContain('postgres: live credential check passed (read access confirmed)');
  });
});
