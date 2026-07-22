import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../config';
import { WorkerBusyError } from '../worker';
import {
  executeLocalJob,
  LEASE_HEARTBEAT_MS,
  MAX_LOCAL_JOBS_PER_RUN,
  parseClaimedJobs,
  runOnce,
  runOnceDetailed,
  runWatch,
  type GatewayJob,
  type RunDependencies,
} from './run';

interface GatewayCall {
  op: string;
  args: Record<string, unknown>;
}

const ids = {
  job1: '00000000-0000-4000-8000-000000000001',
  job2: '00000000-0000-4000-8000-000000000002',
  run1: '10000000-0000-4000-8000-000000000001',
  run2: '10000000-0000-4000-8000-000000000002',
  claim1: '20000000-0000-4000-8000-000000000001',
  claim2: '20000000-0000-4000-8000-000000000002',
};

function job(number: number): GatewayJob {
  const suffix = String(number).padStart(12, '0');
  return {
    run_id: `10000000-0000-4000-8000-${suffix}`,
    claim_token: `20000000-0000-4000-8000-${suffix}`,
    job_id: `00000000-0000-4000-8000-${suffix}`,
    label: `Job ${number}`,
    kind: 'session_sweep',
    interval_minutes: 60,
    runtime: 'local',
    config: {},
    attempt: 1,
    lease_expires_at: '2026-07-21T12:15:00.000Z',
  };
}

function harness(initialJobs: GatewayJob[] = [job(1)]) {
  const config = defaultConfig();
  config.token = 'psh_test';
  config.keys.anthropic = 'sk-ant-test';
  config.connectors.push({
    provider: 'stripe',
    label: 'Stripe',
    localOnly: true,
    verified: true,
    meta: {},
    secret: { api_key: 'rk_test' },
  });
  const jobs = [...initialJobs];
  const gatewayCalls: GatewayCall[] = [];
  const gateway: RunDependencies['gateway'] = vi.fn(async (_config, op, args = {}) => {
    gatewayCalls.push({ op, args });
    if (op === 'jobs.claim_local') {
      const target = typeof args.job_id === 'string' ? args.job_id : null;
      const index = target ? jobs.findIndex((candidate) => candidate.job_id === target) : 0;
      if (index < 0 || jobs.length === 0) return { ok: true, jobs: [] };
      return { ok: true, jobs: jobs.splice(index, 1) };
    }
    if (op === 'runs.renew') {
      return { ok: true, lease_expires_at: '2026-07-21T12:20:00.000Z' };
    }
    if (op === 'workspace.get') return { ok: true, workspace: { agent_rules: [] } };
    if (op === 'scratchpad.list') return { ok: true, scratchpad: [] };
    if (op === 'findings.list') return { ok: true, fingerprints: [] };
    if (op === 'inbox.list') return { ok: true, items: [] };
    if (op === 'runs.submit') {
      if (args.status === 'error') return { ok: true, run_id: args.run_id, status: 'error' };
      return {
        ok: true,
        run_id: args.run_id,
        stats: {
          items: 2,
          notes: 3,
          accounts: 1,
          source: 'local',
          engine: 'byok/anthropic/claude-test',
          sessions_sampled: 0,
        },
      };
    }
    if (op === 'runs.list') return { ok: true, runs: [] };
    throw new Error(`unexpected gateway operation: ${op}`);
  });
  const dependencies: RunDependencies = {
    loadConfig: () => config,
    gateway,
    callModel: vi.fn(async () => ({ text: '{}', inputTokens: 11, outputTokens: 7 })),
    parseModelJson: vi.fn(() => ({})),
    posthogGather: vi.fn(async () => ({
      topline: { sessions: 0, users: 0, pageviews: 0 },
      ragePages: [],
      samples: [],
      completeness: { complete: true, sampled: false, returned: 0, available: 0 },
    })),
    stripeGather: vi.fn(async () => ({
      data: [],
      completeness: { complete: true, sampled: false, returned: 0, available: 0 },
    })),
    sentryGather: vi.fn(async () => ({
      data: [],
      completeness: { complete: true, sampled: false, returned: 0, available: 0 },
    })),
    githubGather: vi.fn(async () => ({
      data: [],
      completeness: { complete: true, sampled: false, returned: 0, available: 0 },
    })),
    postgresGather: vi.fn(async () => ({
      rows: [],
      completeness: { complete: true, sampled: false, returned: 0, available: 0 },
    })),
    postgresPacketSection: vi.fn(
      (snapshot) => `POSTGRES READ-ONLY SNAPSHOT (untrusted):\n${JSON.stringify(snapshot.rows)}`
    ),
    localWorkerId: vi.fn((surface) => `postshow-${surface}:00000000-0000-4000-8000-000000000099`),
    acquireWorkerLock: vi.fn(() => vi.fn()),
    dim: vi.fn(),
    fail: vi.fn(),
    ok: vi.fn(),
    say: vi.fn(),
    warn: vi.fn(),
  };
  return { config, dependencies, gateway, gatewayCalls };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('local claim contract', () => {
  it('rejects the legacy id-only job shape', () => {
    expect(() =>
      parseClaimedJobs({ jobs: [{ id: ids.job1, label: 'legacy', kind: 'session_sweep' }] })
    ).toThrow(/invalid local claim/);
  });

  it('rejects multiple rows because each request may claim only one job', () => {
    expect(() => parseClaimedJobs({ jobs: [job(1), job(2)] })).toThrow(
      /invalid local-claim response/
    );
  });

  it('claims serially with one stable worker and submits exact run credentials', async () => {
    const test = harness([job(1), job(2)]);

    const summary = await runOnceDetailed(undefined, test.dependencies);

    expect(summary).toMatchObject({ status: 'succeeded', exitCode: 0, succeeded: 2, failed: 0 });
    const claims = test.gatewayCalls.filter((call) => call.op === 'jobs.claim_local');
    expect(claims).toHaveLength(3);
    expect(claims.every((call) => call.args.limit === 1)).toBe(true);
    expect(new Set(claims.map((call) => call.args.worker_id))).toEqual(
      new Set(['postshow-cli:00000000-0000-4000-8000-000000000099'])
    );

    const commits = test.gatewayCalls.filter(
      (call) => call.op === 'runs.submit' && call.args.status === 'ok'
    );
    expect(commits).toHaveLength(2);
    expect(commits[0]?.args).toMatchObject({
      run_id: ids.run1,
      claim_token: ids.claim1,
      usage: {
        provider: 'anthropic',
        mode: 'byok',
        input_tokens: 11,
        output_tokens: 7,
      },
    });
    expect(commits[0]?.args).not.toHaveProperty('job_id');
    expect(commits[0]?.args).toMatchObject({
      source_accounts: [],
      source_session_ids: [],
      identity_context: {
        links: [],
        sessions: [],
        completeness: { complete: true, sampled: false },
      },
    });
    expect(summary.jobs[0]?.detail).toBe('2 draft(s), 3 field note(s) synced');
  });

  it('sanitizes model output locally before any upload', async () => {
    const test = harness();
    test.dependencies.parseModelJson = vi.fn(() => ({
      summary: 'A safe summary',
      inbox_items: [
        {
          kind: 'outreach',
          title: 'Follow up',
          action_type: 'email',
          action_config: {
            subject: 'Checking in',
            recipient: 'private@example.test',
            rawSessions: [{ distinct_id: 'customer-secret' }],
          },
        },
      ],
      source_accounts: [{ email: 'private@example.test' }],
      sourceAccounts: [{ email: 'also-private@example.test' }],
      rawSessions: [{ distinct_id: 'customer-secret' }],
      secret: 'must-not-leave-device',
    }));

    await expect(executeLocalJob(test.config, job(1), test.dependencies)).resolves.toMatchObject({
      status: 'succeeded',
    });

    const submit = test.gatewayCalls.find(
      (call) => call.op === 'runs.submit' && call.args.status === 'ok'
    );
    expect(submit?.args.output).toMatchObject({
      summary: 'A safe summary',
      inboxItems: [
        {
          title: 'Follow up',
          action_type: 'email',
          action_config: { subject: 'Checking in' },
        },
      ],
    });
    const serialized = JSON.stringify(submit?.args.output);
    expect(serialized).not.toContain('private@example.test');
    expect(serialized).not.toContain('customer-secret');
    expect(serialized).not.toContain('must-not-leave-device');
    expect(submit?.args.output).not.toHaveProperty('source_accounts');
    expect(submit?.args.output).not.toHaveProperty('sourceAccounts');
    expect(submit?.args.source_accounts).toEqual([]);
  });

  it('uses the atomic optional job_id claim for a targeted run', async () => {
    const test = harness([job(1), job(2)]);

    const summary = await runOnceDetailed(ids.job2, test.dependencies);

    expect(summary.jobs).toMatchObject([{ jobId: ids.job2, runId: ids.run2 }]);
    expect(test.gatewayCalls.filter((call) => call.op === 'jobs.claim_local')).toEqual([
      {
        op: 'jobs.claim_local',
        args: {
          worker_id: 'postshow-cli:00000000-0000-4000-8000-000000000099',
          limit: 1,
          job_id: ids.job2,
        },
      },
    ]);
    expect(test.gatewayCalls.some((call) => call.op === 'jobs.list')).toBe(false);
    expect(test.gatewayCalls.some((call) => call.op === 'jobs.due_local')).toBe(false);
  });

  it('processes at most ten jobs without taking an eleventh claim', async () => {
    const test = harness(Array.from({ length: 11 }, (_, index) => job(index + 1)));

    const summary = await runOnceDetailed(undefined, test.dependencies);

    expect(summary).toMatchObject({
      status: 'succeeded',
      succeeded: MAX_LOCAL_JOBS_PER_RUN,
      failed: 0,
      uncertain: 0,
    });
    expect(test.gatewayCalls.filter((call) => call.op === 'jobs.claim_local')).toHaveLength(
      MAX_LOCAL_JOBS_PER_RUN
    );
    expect(summary.jobs.some((result) => result.jobId === job(11).job_id)).toBe(false);
  });

  it('returns idle only after an authoritative empty claim response', async () => {
    const test = harness([]);

    await expect(runOnceDetailed(undefined, test.dependencies)).resolves.toEqual({
      status: 'idle',
      exitCode: 0,
      succeeded: 0,
      failed: 0,
      uncertain: 0,
      jobs: [],
    });
  });

  it('retries an ambiguous claim with the same worker identity', async () => {
    const test = harness([job(1)]);
    const base = test.dependencies.gateway;
    let claims = 0;
    test.dependencies.gateway = vi.fn(async (config, op, args) => {
      if (op === 'jobs.claim_local' && claims++ === 0) throw new Error('response lost');
      return base(config, op, args);
    });

    await expect(runOnceDetailed(undefined, test.dependencies)).resolves.toMatchObject({
      status: 'succeeded',
    });
    expect(claims).toBe(3); // lost response, recovered claim, final empty poll
  });
});

describe('executeLocalJob', () => {
  it('renews during slow model work and stops heartbeating after commit', async () => {
    vi.useFakeTimers();
    const test = harness();
    let finishModel!: (value: { text: string; inputTokens: number; outputTokens: number }) => void;
    test.dependencies.callModel = vi.fn(
      async () =>
        await new Promise<{ text: string; inputTokens: number; outputTokens: number }>(
          (resolve) => {
            finishModel = resolve;
          }
        )
    );

    const pending = executeLocalJob(test.config, job(1), test.dependencies);
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
    expect(test.dependencies.callModel).toHaveBeenCalledOnce();
    expect(test.gatewayCalls.filter((call) => call.op === 'runs.renew')).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(LEASE_HEARTBEAT_MS);
    expect(test.gatewayCalls.filter((call) => call.op === 'runs.renew')).toHaveLength(2);

    finishModel({ text: '{}', inputTokens: 2, outputTokens: 1 });
    await expect(pending).resolves.toMatchObject({ status: 'succeeded' });
    await vi.advanceTimersByTimeAsync(LEASE_HEARTBEAT_MS * 2);
    expect(test.gatewayCalls.filter((call) => call.op === 'runs.renew')).toHaveLength(2);
  });

  it('ignores unverified connectors and refuses to run without a verified source', async () => {
    const test = harness();
    test.config.connectors[0]!.verified = false;

    const result = await executeLocalJob(test.config, job(1), test.dependencies);

    expect(result).toMatchObject({ status: 'failed', phase: 'preflight', failureReported: true });
    expect(test.dependencies.stripeGather).not.toHaveBeenCalled();
    expect(test.dependencies.callModel).not.toHaveBeenCalled();
    expect(test.dependencies.warn).toHaveBeenCalledWith(
      'stripe: ignored because its credential is not verified'
    );
  });

  it('continues when one verified connector fails but another gathers successfully', async () => {
    const test = harness();
    test.config.connectors.push({
      provider: 'posthog',
      label: 'PostHog',
      localOnly: true,
      verified: true,
      meta: { project_id: '1' },
      secret: { api_key: 'phx_test' },
    });
    test.dependencies.posthogGather = vi.fn(async () => {
      throw new Error('posthog unavailable');
    });

    const result = await executeLocalJob(test.config, job(1), test.dependencies);

    expect(result).toMatchObject({ status: 'succeeded', phase: 'complete' });
    expect(test.dependencies.stripeGather).toHaveBeenCalledOnce();
    expect(test.dependencies.callModel).toHaveBeenCalledOnce();
    expect(test.dependencies.warn).toHaveBeenCalledWith(
      '  posthog: gather failed (posthog unavailable)'
    );
  });

  it('runs with a verified local-only Postgres query and uploads no credential or raw rows', async () => {
    const test = harness();
    test.config.connectors = [
      {
        provider: 'postgres',
        label: 'Postgres',
        localOnly: true,
        verified: true,
        meta: {},
        secret: {
          connection_string: 'postgresql://reader:private@localhost/app',
          query: 'SELECT account_id, plan FROM reporting.accounts',
        },
      },
    ];
    test.dependencies.postgresGather = vi.fn(async () => ({
      rows: [{ account_id: 'acct_1', plan: 'team' }],
      completeness: {
        complete: false,
        sampled: false,
        returned: 1,
        available: null,
        reason: 'bounded fixture',
      },
    }));

    const result = await executeLocalJob(test.config, job(1), test.dependencies);

    expect(result).toMatchObject({ status: 'succeeded', phase: 'complete' });
    expect(test.dependencies.postgresGather).toHaveBeenCalledWith(
      test.config.connectors[0]?.secret
    );
    expect(test.dependencies.callModel).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        prompt: expect.stringContaining('POSTGRES READ-ONLY SNAPSHOT'),
      })
    );
    expect(test.dependencies.warn).toHaveBeenCalledWith(
      '  postgres: partial source coverage (bounded fixture)'
    );
    const submit = test.gatewayCalls.find(
      (call) => call.op === 'runs.submit' && call.args.status === 'ok'
    );
    const serializedSubmit = JSON.stringify(submit?.args);
    expect(serializedSubmit).not.toContain('postgresql://');
    expect(serializedSubmit).not.toContain('reporting.accounts');
    expect(serializedSubmit).not.toContain('acct_1');
  });

  it('fails in gather only when every verified source fails', async () => {
    const test = harness();
    test.dependencies.stripeGather = vi.fn(async () => {
      throw new Error('stripe unavailable');
    });

    const result = await executeLocalJob(test.config, job(1), test.dependencies);

    expect(result).toMatchObject({ status: 'failed', phase: 'gather', failureReported: true });
    expect(test.dependencies.callModel).not.toHaveBeenCalled();
  });

  it('preserves partial source coverage in the model packet', async () => {
    const test = harness();
    test.dependencies.stripeGather = vi.fn(async () => ({
      data: [
        {
          customerId: 'cus_1',
          subscriptionId: 'sub_1',
          name: 'Acme',
          email: 'private@example.test',
          status: 'active',
          mrrCents: 12000,
          currency: 'USD',
        },
      ],
      completeness: {
        complete: false,
        sampled: false,
        returned: 1,
        available: null,
        reason: 'subscription history exceeded the safety cap',
      },
    }));

    await expect(executeLocalJob(test.config, job(1), test.dependencies)).resolves.toMatchObject({
      status: 'succeeded',
    });

    const modelCall = (test.dependencies.callModel as ReturnType<typeof vi.fn>).mock.calls[0]?.[2];
    expect(modelCall?.prompt).toContain(
      'SOURCE COVERAGE (stripe subscriptions): partial; gathered=1; available=unknown; reason=subscription history exceeded the safety cap'
    );
    expect(modelCall?.prompt).not.toContain('private@example.test');
    expect(test.dependencies.warn).toHaveBeenCalledWith(
      '  stripe: partial source coverage (subscription history exceeded the safety cap)'
    );
  });

  it('does not submit a terminal failure when lease renewal is unconfirmed', async () => {
    const test = harness();
    const base = test.dependencies.gateway;
    test.dependencies.gateway = vi.fn(async (config, op, args) => {
      if (op === 'runs.renew') throw new Error('renew response lost');
      return base(config, op, args);
    });

    const result = await executeLocalJob(test.config, job(1), test.dependencies);

    expect(result).toMatchObject({
      status: 'uncertain',
      phase: 'preflight',
      failureReported: false,
    });
    expect(
      (test.dependencies.gateway as ReturnType<typeof vi.fn>).mock.calls.some(
        ([, op]) => op === 'runs.submit'
      )
    ).toBe(false);
  });

  it('does not run or print success for a generic lease-renewal envelope', async () => {
    const test = harness();
    const base = test.dependencies.gateway;
    test.dependencies.gateway = vi.fn(async (config, op, args) => {
      if (op === 'runs.renew') return { ok: true };
      return base(config, op, args);
    });

    const result = await executeLocalJob(test.config, job(1), test.dependencies);

    expect(result).toMatchObject({
      status: 'uncertain',
      phase: 'preflight',
      failureReported: false,
    });
    expect(test.dependencies.ok).not.toHaveBeenCalled();
    expect(
      (test.dependencies.gateway as ReturnType<typeof vi.fn>).mock.calls.some(
        ([, op]) => op === 'runs.submit'
      )
    ).toBe(false);
  });

  it('does not print success for a generic run-commit envelope', async () => {
    const test = harness();
    const base = test.dependencies.gateway;
    test.dependencies.gateway = vi.fn(async (config, op, args) => {
      if (op === 'runs.submit' && args?.status === 'ok') return { ok: true };
      return base(config, op, args);
    });

    const result = await executeLocalJob(test.config, job(1), test.dependencies);

    expect(result).toMatchObject({ status: 'uncertain', phase: 'submit' });
    expect(test.dependencies.ok).not.toHaveBeenCalled();
  });

  it('retries a lost success response and accepts authoritative readback', async () => {
    const test = harness();
    const base = test.dependencies.gateway;
    let successSubmits = 0;
    test.dependencies.gateway = vi.fn(async (config, op, args) => {
      if (op === 'runs.submit' && args?.status === 'ok') {
        successSubmits += 1;
        throw new Error('commit response lost');
      }
      if (op === 'runs.list') {
        return {
          ok: true,
          runs: [
            {
              id: ids.run1,
              status: 'ok',
              stats: { items: 4, notes: 2, accounts: 1, source: 'local' },
              error: '',
            },
          ],
        };
      }
      return base(config, op, args);
    });

    const result = await executeLocalJob(test.config, job(1), test.dependencies);

    expect(result).toMatchObject({
      status: 'succeeded',
      phase: 'complete',
      detail: '4 draft(s), 2 field note(s) synced',
    });
    expect(successSubmits).toBe(2);
    expect(
      (test.dependencies.gateway as ReturnType<typeof vi.fn>).mock.calls.some(
        ([, op, args]) => op === 'runs.submit' && args?.status === 'error'
      )
    ).toBe(false);
  });

  it('does not overwrite an indeterminate commit with a failure', async () => {
    const test = harness();
    const base = test.dependencies.gateway;
    test.dependencies.gateway = vi.fn(async (config, op, args) => {
      if (op === 'runs.submit' && args?.status === 'ok') throw new Error('response lost');
      if (op === 'runs.list') throw new Error('readback unavailable');
      return base(config, op, args);
    });

    const result = await executeLocalJob(test.config, job(1), test.dependencies);

    expect(result).toMatchObject({ status: 'uncertain', phase: 'submit', failureReported: false });
    const submissions = (test.dependencies.gateway as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([, op]) => op === 'runs.submit'
    );
    expect(submissions).toHaveLength(2);
    expect(submissions.every(([, , args]) => args?.status === 'ok')).toBe(true);
  });

  it('submits local failures with the exact claim and confirms ambiguous failure by readback', async () => {
    const test = harness();
    test.dependencies.callModel = vi.fn(async () => {
      throw new Error('model unavailable');
    });
    const base = test.dependencies.gateway;
    test.dependencies.gateway = vi.fn(async (config, op, args) => {
      if (op === 'runs.submit' && args?.status === 'error') throw new Error('response lost');
      if (op === 'runs.list') {
        return { ok: true, runs: [{ id: ids.run1, status: 'error', stats: {}, error: 'safe' }] };
      }
      return base(config, op, args);
    });

    const result = await executeLocalJob(test.config, job(1), test.dependencies);

    expect(result).toMatchObject({ status: 'failed', phase: 'model', failureReported: true });
    const failures = (test.dependencies.gateway as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([, op, args]) => op === 'runs.submit' && args?.status === 'error'
    );
    expect(failures).toHaveLength(2);
    expect(failures[0]?.[2]).toMatchObject({ run_id: ids.run1, claim_token: ids.claim1 });
  });

  it('never uploads raw provider, parser, or source detail in a failure', async () => {
    const test = harness();
    test.dependencies.parseModelJson = vi.fn(() => {
      throw new Error(
        'unexpected model fragment postgresql://reader:private@localhost/app acct_private'
      );
    });

    const result = await executeLocalJob(test.config, job(1), test.dependencies);

    expect(result).toMatchObject({ status: 'failed', phase: 'parse', failureReported: true });
    const failure = test.gatewayCalls.find(
      (call) => call.op === 'runs.submit' && call.args.status === 'error'
    );
    expect(failure?.args).toMatchObject({
      run_id: ids.run1,
      claim_token: ids.claim1,
      error: 'local run failed',
    });
    expect(JSON.stringify(failure?.args)).not.toContain('postgresql://');
    expect(JSON.stringify(failure?.args)).not.toContain('acct_private');
  });
});

describe('runOnceDetailed outcomes', () => {
  it('continues after an authoritatively reported failure and returns partial/nonzero', async () => {
    const test = harness([job(1), job(2)]);
    let calls = 0;
    test.dependencies.callModel = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('model unavailable');
      return { text: '{}', inputTokens: 1, outputTokens: 1 };
    });

    const summary = await runOnceDetailed(undefined, test.dependencies);

    expect(summary).toMatchObject({ status: 'partial', exitCode: 1, succeeded: 1, failed: 1 });
    expect(summary.jobs).toMatchObject([
      { jobId: ids.job1, runId: ids.run1, status: 'failed', failureReported: true },
      { jobId: ids.job2, runId: ids.run2, status: 'succeeded' },
    ]);
  });

  it('stops claiming after an unconfirmed terminal result so the live claim is recoverable', async () => {
    const test = harness([job(1), job(2)]);
    const base = test.dependencies.gateway;
    test.dependencies.gateway = vi.fn(async (config, op, args) => {
      if (op === 'runs.submit') throw new Error('submit unavailable');
      if (op === 'runs.list') throw new Error('readback unavailable');
      return base(config, op, args);
    });

    const summary = await runOnceDetailed(undefined, test.dependencies);

    expect(summary).toMatchObject({ status: 'uncertain', failed: 0, uncertain: 1 });
    expect(summary.jobs).toHaveLength(1);
    expect(test.gatewayCalls.filter((call) => call.op === 'jobs.claim_local')).toHaveLength(1);
  });

  it('returns structured configuration, discovery, and concurrency failures', async () => {
    const unconfigured = harness();
    unconfigured.config.token = '';
    await expect(runOnceDetailed(undefined, unconfigured.dependencies)).resolves.toMatchObject({
      status: 'failed',
      error: { phase: 'configuration' },
    });

    const undiscoverable = harness();
    undiscoverable.dependencies.gateway = vi.fn(async () => {
      throw new Error('gateway unavailable');
    });
    await expect(runOnceDetailed(undefined, undiscoverable.dependencies)).resolves.toMatchObject({
      status: 'failed',
      error: { phase: 'discovery', detail: 'gateway unavailable' },
    });

    const busy = harness();
    busy.dependencies.acquireWorkerLock = vi.fn(() => {
      throw new WorkerBusyError();
    });
    await expect(runOnceDetailed(undefined, busy.dependencies)).resolves.toMatchObject({
      status: 'failed',
      error: { phase: 'concurrency' },
    });
  });

  it('keeps the numeric adapter nonzero for operational failures', async () => {
    const test = harness();
    test.dependencies.callModel = vi.fn(async () => {
      throw new Error('model unavailable');
    });
    await expect(runOnce(undefined, test.dependencies)).resolves.toBe(1);
  });
});

describe('runWatch', () => {
  it('rejects non-finite, fractional, and unsafe heartbeat intervals before looping', async () => {
    for (const interval of [Number.NaN, Number.POSITIVE_INFINITY, 4, 5.5, 1441]) {
      await expect(runWatch(interval)).rejects.toThrow(
        'watch interval must be a whole number from 5 to 1440 minutes'
      );
    }
  });
});
