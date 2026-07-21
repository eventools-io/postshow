import { describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../config';
import {
  CONNECTOR_PLANS,
  setupConnector,
  setupEngine,
  type ConnectorPlan,
  type ConnectorSetupDependencies,
  type EngineSetupDependencies,
} from './init';

function testPlan(test: ConnectorPlan['test']): ConnectorPlan {
  return {
    provider: 'example',
    label: 'Example',
    evidence: '',
    fields: [
      { key: 'project', question: 'Project', secret: false, meta: true },
      { key: 'api_key', question: 'API key', secret: true },
    ],
    test,
  };
}

function testDependencies(confirmations: boolean[], provider = 'example') {
  const gatewayCalls: { op: string; args: Record<string, unknown> }[] = [];
  const order: string[] = [];
  const ask = vi.fn(async () => 'project-1');
  const askSecret = vi.fn(async () => 'secret-1');
  const dependencies: ConnectorSetupDependencies = {
    ask,
    askSecret,
    confirm: vi.fn(async () => confirmations.shift() ?? false),
    dim: vi.fn(),
    fail: vi.fn(),
    gateway: vi.fn(async (_config, op, args) => {
      order.push(op);
      gatewayCalls.push({ op, args });
      if (op === 'connections.upsert') return { connection_id: 'connection-1' };
      if (op === 'connections.list') {
        const upsert = gatewayCalls.find((call) => call.op === 'connections.upsert');
        return {
          connections: [
            {
              provider,
              status: 'connected',
              local_only: upsert?.args.local_only,
            },
          ],
        };
      }
      return { ok: true };
    }),
    heading: vi.fn(),
    ok: vi.fn(),
    say: vi.fn(),
    warn: vi.fn(),
    saveConfig: vi.fn(() => order.push('save')),
  };
  return { ask, askSecret, dependencies, gatewayCalls, order };
}

describe('setupConnector', () => {
  it('uses the masked prompt for credentials and persists verified evidence only after success', async () => {
    const config = defaultConfig();
    const test = vi.fn(async () => ({ ok: true, detail: 'connected' }));
    const harness = testDependencies([false]);

    await setupConnector(config, testPlan(test), '', harness.dependencies);

    expect(harness.ask).toHaveBeenCalledWith('Project', '');
    expect(harness.askSecret).toHaveBeenCalledWith('API key');
    expect(test).toHaveBeenCalledWith({ project: 'project-1' }, { api_key: 'secret-1' });
    expect(config.connectors[0]?.verified).toBe(true);
    expect(harness.gatewayCalls).toEqual([
      {
        op: 'connections.upsert',
        args: {
          provider: 'example',
          local_only: false,
          meta: { project: 'project-1' },
          secret: { api_key: 'secret-1' },
          verified: true,
        },
      },
      {
        op: 'connections.verify',
        args: { connection_id: 'connection-1' },
      },
      {
        op: 'connections.list',
        args: {},
      },
    ]);
    expect(harness.order).toEqual([
      'save',
      'connections.upsert',
      'connections.verify',
      'connections.list',
    ]);
  });

  it('never persists or registers a credential that fails verification', async () => {
    const config = defaultConfig();
    const harness = testDependencies([]);

    await expect(
      setupConnector(
        config,
        testPlan(async () => {
          throw new Error('credential rejected');
        }),
        '',
        harness.dependencies
      )
    ).rejects.toThrow('credential verification failed');

    expect(config.connectors).toEqual([]);
    expect(harness.dependencies.saveConfig).not.toHaveBeenCalled();
    expect(harness.gatewayCalls).toEqual([]);
  });

  it('registers a verified local-only connector without uploading its secret', async () => {
    const config = defaultConfig();
    const harness = testDependencies([true]);

    await setupConnector(
      config,
      testPlan(async () => ({ ok: true, detail: 'connected' })),
      '',
      harness.dependencies
    );

    expect(harness.gatewayCalls).toEqual([
      {
        op: 'connections.upsert',
        args: {
          provider: 'example',
          local_only: true,
          meta: { project: 'project-1' },
          secret: null,
          verified: true,
        },
      },
      { op: 'connections.list', args: {} },
    ]);
  });

  it('forces Postgres local-only and keeps both the connection string and query off cloud metadata', async () => {
    const config = defaultConfig();
    const harness = testDependencies([], 'postgres');
    const plan = CONNECTOR_PLANS.find((candidate) => candidate.provider === 'postgres');
    expect(plan).toBeDefined();
    if (!plan) throw new Error('Postgres connector plan is missing');
    const connectionString = 'postgresql://reader:private@localhost/app';
    const query = 'SELECT account_id, plan FROM reporting.accounts';
    harness.askSecret.mockResolvedValueOnce(connectionString).mockResolvedValueOnce(query);

    await setupConnector(
      config,
      { ...plan, test: vi.fn(async () => ({ ok: true, detail: 'read-only query verified' })) },
      '.env',
      harness.dependencies
    );

    expect(harness.dependencies.confirm).not.toHaveBeenCalled();
    expect(harness.ask).not.toHaveBeenCalled();
    expect(harness.askSecret).toHaveBeenNthCalledWith(
      1,
      'Postgres connection string (use a read-only database user)'
    );
    expect(harness.askSecret).toHaveBeenNthCalledWith(2, 'One read-only SELECT query for Postshow');
    expect(config.connectors).toEqual([
      {
        provider: 'postgres',
        label: '',
        localOnly: true,
        verified: true,
        meta: {},
        secret: { connection_string: connectionString, query },
      },
    ]);
    expect(harness.gatewayCalls).toEqual([
      {
        op: 'connections.upsert',
        args: {
          provider: 'postgres',
          local_only: true,
          meta: {},
          secret: null,
          verified: true,
        },
      },
      { op: 'connections.list', args: {} },
    ]);
    expect(JSON.stringify(harness.gatewayCalls)).not.toContain('postgresql://');
    expect(JSON.stringify(harness.gatewayCalls)).not.toContain('reporting.accounts');
    expect(harness.order).toEqual(['save', 'connections.upsert', 'connections.list']);
  });

  it('requires the explicit Postgres query before verification or persistence', async () => {
    const config = defaultConfig();
    const harness = testDependencies([], 'postgres');
    const plan = CONNECTOR_PLANS.find((candidate) => candidate.provider === 'postgres');
    expect(plan).toBeDefined();
    if (!plan) throw new Error('Postgres connector plan is missing');
    const adapterTest = vi.fn(async () => ({ ok: true, detail: 'read-only query verified' }));
    harness.askSecret
      .mockResolvedValueOnce('postgresql://reader:private@localhost/app')
      .mockResolvedValueOnce('');

    await expect(
      setupConnector(config, { ...plan, test: adapterTest }, '.env', harness.dependencies)
    ).rejects.toThrow('postgres credential is required');

    expect(adapterTest).not.toHaveBeenCalled();
    expect(config.connectors).toEqual([]);
    expect(harness.dependencies.saveConfig).not.toHaveBeenCalled();
    expect(harness.gatewayCalls).toEqual([]);
  });

  it('requires a credential after the user chooses to configure a connector', async () => {
    const config = defaultConfig();
    const harness = testDependencies([]);
    harness.askSecret.mockResolvedValueOnce('');

    await expect(
      setupConnector(
        config,
        testPlan(async () => ({ ok: true, detail: 'connected' })),
        '',
        harness.dependencies
      )
    ).rejects.toThrow('credential is required');
    expect(harness.dependencies.saveConfig).not.toHaveBeenCalled();
    expect(harness.gatewayCalls).toEqual([]);
  });

  it('treats an adapter result with ok false as a hard verification failure', async () => {
    const config = defaultConfig();
    const harness = testDependencies([]);

    await expect(
      setupConnector(
        config,
        testPlan(async () => ({ ok: false, detail: 'credential rejected' })),
        '',
        harness.dependencies
      )
    ).rejects.toThrow('credential verification failed');

    expect(config.connectors).toEqual([]);
    expect(harness.gatewayCalls).toEqual([]);
  });

  it('does not mutate the cloud when native credential persistence fails', async () => {
    const config = defaultConfig();
    const harness = testDependencies([true]);
    vi.mocked(harness.dependencies.saveConfig).mockImplementation(() => {
      throw new Error('native credential store unavailable');
    });

    await expect(
      setupConnector(
        config,
        testPlan(async () => ({ ok: true, detail: 'connected' })),
        '',
        harness.dependencies
      )
    ).rejects.toThrow('native credential store unavailable');

    expect(harness.gatewayCalls).toEqual([]);
  });

  it('requires a connected readback after cloud verification', async () => {
    const config = defaultConfig();
    const harness = testDependencies([false]);
    vi.mocked(harness.dependencies.gateway).mockImplementation(async (_config, op, args) => {
      harness.gatewayCalls.push({ op, args });
      if (op === 'connections.upsert') return { connection_id: 'connection-1' };
      if (op === 'connections.list') {
        return { connections: [{ provider: 'example', status: 'error', local_only: false }] };
      }
      return { ok: true };
    });

    await expect(
      setupConnector(
        config,
        testPlan(async () => ({ ok: true, detail: 'connected' })),
        '',
        harness.dependencies
      )
    ).rejects.toThrow('did not read back as connected');
  });

  it('recovers idempotently when an upsert response is lost', async () => {
    const config = defaultConfig();
    const harness = testDependencies([false]);
    let upserts = 0;
    vi.mocked(harness.dependencies.gateway).mockImplementation(async (_config, op, args) => {
      harness.gatewayCalls.push({ op, args });
      if (op === 'connections.upsert' && upserts++ === 0) throw new Error('response lost');
      if (op === 'connections.upsert') return { connection_id: 'connection-1' };
      if (op === 'connections.list') {
        return { connections: [{ provider: 'example', status: 'connected', local_only: false }] };
      }
      return { ok: true };
    });

    await setupConnector(
      config,
      testPlan(async () => ({ ok: true, detail: 'connected' })),
      '',
      harness.dependencies
    );

    expect(harness.gatewayCalls.filter((call) => call.op === 'connections.upsert')).toHaveLength(2);
  });

  it('reads back a lost verification response before repeating a provider probe', async () => {
    const config = defaultConfig();
    const harness = testDependencies([false]);
    let verifies = 0;
    vi.mocked(harness.dependencies.gateway).mockImplementation(async (_config, op, args) => {
      harness.gatewayCalls.push({ op, args });
      if (op === 'connections.upsert') return { connection_id: 'connection-1' };
      if (op === 'connections.verify') {
        verifies += 1;
        throw new Error('response lost after commit');
      }
      if (op === 'connections.list') {
        return { connections: [{ provider: 'example', status: 'connected', local_only: false }] };
      }
      return { ok: true };
    });

    await setupConnector(
      config,
      testPlan(async () => ({ ok: true, detail: 'connected' })),
      '',
      harness.dependencies
    );

    expect(verifies).toBe(1);
  });
});

function engineDependencies(options: { probeFails?: boolean; syncKey?: boolean } = {}) {
  const order: string[] = [];
  const choices = ['byok', 'anthropic'];
  const dependencies: EngineSetupDependencies = {
    ask: vi.fn(async () => 'claude-haiku-4-5-20251001'),
    askSecret: vi.fn(async () => 'test-key'),
    callModel: vi.fn(async () => {
      order.push('probe');
      if (options.probeFails) throw new Error('credential rejected');
      return { text: 'ok', inputTokens: 1, outputTokens: 1 };
    }),
    choose: vi.fn(async () => choices.shift() ?? 'anthropic'),
    confirm: vi.fn(async () => options.syncKey ?? true),
    detectOllama: vi.fn(async () => []),
    dim: vi.fn(),
    gateway: vi.fn(async (_config, op) => {
      order.push(op);
      if (op === 'engine.get') {
        return {
          defaults: {
            mode: 'byok',
            provider: 'anthropic',
            model: 'claude-haiku-4-5-20251001',
          },
          key_providers: options.syncKey === false ? [] : ['anthropic'],
        };
      }
      return { ok: true };
    }),
    heading: vi.fn(),
    ok: vi.fn(),
    saveConfig: vi.fn(() => order.push('save')),
    say: vi.fn(),
  };
  return { dependencies, order };
}

describe('setupEngine', () => {
  it('probes BYOK credentials, persists them before cloud mutation, and reads them back', async () => {
    const config = defaultConfig();
    const harness = engineDependencies();

    await setupEngine(config, harness.dependencies);

    expect(config.keys.anthropic).toBe('test-key');
    expect(harness.order).toEqual(['probe', 'save', 'engine.set', 'engine.get']);
    expect(harness.dependencies.gateway).toHaveBeenCalledWith(
      config,
      'engine.set',
      expect.objectContaining({ api_key: 'test-key' })
    );
  });

  it('does not persist or mutate cloud engine state when its probe fails', async () => {
    const config = defaultConfig();
    const harness = engineDependencies({ probeFails: true });

    await expect(setupEngine(config, harness.dependencies)).rejects.toThrow('credential rejected');
    expect(harness.dependencies.saveConfig).not.toHaveBeenCalled();
    expect(harness.dependencies.gateway).not.toHaveBeenCalled();
  });

  it('removes an older cloud key when BYOK is selected as local-only', async () => {
    const config = defaultConfig();
    const harness = engineDependencies({ syncKey: false });

    await setupEngine(config, harness.dependencies);

    expect(harness.dependencies.gateway).toHaveBeenCalledWith(config, 'engine.set_key', {
      provider: 'anthropic',
      key: '',
    });
    expect(harness.order).toEqual(['probe', 'save', 'engine.set', 'engine.set_key', 'engine.get']);
  });
});
