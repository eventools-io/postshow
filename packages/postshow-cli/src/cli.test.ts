import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectConnectors } from './detect';
import {
  CLI_CONFIG_VERSION,
  ConfigError,
  CredentialStoreError,
  defaultConfig,
  loadConfig,
  saveConfig,
  type CredentialStore,
} from './config';

let dir: string;

class MemoryCredentialStore implements CredentialStore {
  readonly values = new Map<string, string>();
  setCalls = 0;
  failOnSet = 0;
  failAfterWriteOnSet = 0;

  get(account: string): string | null {
    return this.values.get(account) ?? null;
  }

  set(account: string, value: string): void {
    this.setCalls += 1;
    if (this.failOnSet === this.setCalls) {
      throw new CredentialStoreError('credential store write unavailable');
    }
    this.values.set(account, value);
    if (this.failAfterWriteOnSet === this.setCalls) {
      throw new CredentialStoreError('credential store returned an ambiguous write failure');
    }
  }

  delete(account: string): void {
    this.values.delete(account);
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'postshow-cli-'));
  delete process.env.POSTSHOW_CONFIG_DIR;
  delete process.env.POSTSHOW_TOKEN;
  delete process.env.POSTSHOW_CREDENTIALS_JSON;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.POSTSHOW_CONFIG_DIR;
  delete process.env.POSTSHOW_TOKEN;
  delete process.env.POSTSHOW_CREDENTIALS_JSON;
});

describe('detectConnectors', () => {
  it('finds connectors from env files and package.json', () => {
    writeFileSync(join(dir, '.env'), 'STRIPE_SECRET_KEY=sk_test_123\nPOSTHOG_API_KEY=phx_abc\n');
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ dependencies: { resend: '^3.0.0' } })
    );
    const found = detectConnectors(dir);
    const providers = found.map((f) => f.provider).sort();
    expect(providers).toEqual(['posthog', 'resend', 'stripe']);
    expect(found.find((f) => f.provider === 'stripe')?.evidence).toBe('.env');
    expect(found.find((f) => f.provider === 'resend')?.evidence).toContain('package.json');
  });

  it('returns nothing for an empty directory', () => {
    expect(detectConnectors(dir)).toEqual([]);
  });

  it('does not flag publishable stripe keys', () => {
    writeFileSync(join(dir, '.env'), 'STRIPE_SECRET_KEY=pk_live_visible\n');
    expect(detectConnectors(dir).map((f) => f.provider)).not.toContain('stripe');
  });
});

describe('config', () => {
  it('round-trips a profile with 600 perms and env token override', () => {
    process.env.POSTSHOW_CONFIG_DIR = dir;
    const store = new MemoryCredentialStore();
    const config = defaultConfig();
    config.token = 'psh_stored';
    config.workspaceId = 'w1';
    config.keys.anthropic = 'sk-ant-1';
    config.connectors.push({
      provider: 'posthog',
      label: '',
      localOnly: true,
      verified: true,
      meta: { project_id: '1' },
      secret: { api_key: 'phx' },
    });
    chmodSync(dir, 0o755);
    saveConfig(config, store);

    const loaded = loadConfig(store);
    expect(loaded.token).toBe('psh_stored');
    expect(loaded.version).toBe(CLI_CONFIG_VERSION);
    expect(loaded.keys.anthropic).toBe('sk-ant-1');
    expect(loaded.connectors[0]?.localOnly).toBe(true);
    expect(loaded.connectors[0]?.verified).toBe(true);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, 'config.json')).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    const persisted = readFileSync(join(dir, 'config.json'), 'utf8');
    expect(JSON.parse(persisted).version).toBe(CLI_CONFIG_VERSION);
    expect(persisted).not.toContain('psh_stored');
    expect(persisted).not.toContain('sk-ant-1');
    expect(persisted).not.toContain('phx');
    expect(store.values.size).toBe(3);

    process.env.POSTSHOW_TOKEN = 'psh_env_wins';
    expect(loadConfig(store).token).toBe('psh_env_wins');
  });

  it('fails closed on corrupt config JSON', () => {
    process.env.POSTSHOW_CONFIG_DIR = dir;
    writeFileSync(join(dir, 'config.json'), '{"token":"psh_must_not_leak", not json');
    let caught: unknown;
    try {
      loadConfig();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as Error).message).not.toContain('psh_must_not_leak');
  });

  it('rejects unknown config versions', () => {
    process.env.POSTSHOW_CONFIG_DIR = dir;
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ version: 999 }));
    expect(() => loadConfig()).toThrow(/unsupported config version/);
  });

  it('refuses an invalid replacement without damaging the saved profile', () => {
    process.env.POSTSHOW_CONFIG_DIR = dir;
    const store = new MemoryCredentialStore();
    const config = defaultConfig();
    config.workspaceId = 'w1';
    saveConfig(config, store);
    const before = readFileSync(join(dir, 'config.json'), 'utf8');

    config.apiUrl = 'not a URL';
    expect(() => saveConfig(config, store)).toThrow(ConfigError);
    expect(readFileSync(join(dir, 'config.json'), 'utf8')).toBe(before);
    expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('removes a staged credential when the native store fails after accepting the write', () => {
    process.env.POSTSHOW_CONFIG_DIR = dir;
    const store = new MemoryCredentialStore();
    store.failAfterWriteOnSet = 1;
    const config = defaultConfig();
    config.token = 'psh_ambiguous_write';

    expect(() => saveConfig(config, store)).toThrow(CredentialStoreError);
    expect(store.values.size).toBe(0);
    expect(() => readFileSync(join(dir, 'config.json'), 'utf8')).toThrow();
  });

  it('refuses credentials hidden in metadata or URLs before touching storage', () => {
    process.env.POSTSHOW_CONFIG_DIR = dir;
    const store = new MemoryCredentialStore();
    const config = defaultConfig();
    config.connectors.push({
      provider: 'custom',
      label: '',
      localOnly: true,
      verified: true,
      meta: { nested: { api_key: 'psh_must_not_leak' } },
      secret: {},
    });

    expect(() => saveConfig(config, store)).toThrow(/connector credentials in metadata/);
    expect(store.values.size).toBe(0);
    expect(() => readFileSync(join(dir, 'config.json'), 'utf8')).toThrow();

    config.connectors[0]!.meta = {};
    config.engine.base_url = 'https://user:psh_must_not_leak@example.com/v1';
    expect(() => saveConfig(config, store)).toThrow(/URL containing credentials/);
    expect(store.values.size).toBe(0);

    config.engine.base_url = '';
    config.connectors[0]!.meta = { apiKey: 'psh_must_not_leak' };
    expect(() => saveConfig(config, store)).toThrow(/connector credentials in metadata/);
    expect(store.values.size).toBe(0);

    config.connectors[0]!.meta = {
      host: 'https://example.test/path?access_token=psh_must_not_leak',
    };
    expect(() => saveConfig(config, store)).toThrow(/credential-bearing URL/);
    expect(store.values.size).toBe(0);
  });

  it('rejects nonstandard remote engine ports at save time and preserves loopback ports', () => {
    process.env.POSTSHOW_CONFIG_DIR = dir;
    const store = new MemoryCredentialStore();
    const config = defaultConfig();
    config.engine = {
      mode: 'byok',
      provider: 'compatible',
      model: 'custom-model',
      base_url: 'https://models.example:8443/v1',
    };

    expect(() => saveConfig(config, store)).toThrow(/standard-port public HTTPS/);
    expect(store.values.size).toBe(0);
    expect(() => readFileSync(join(dir, 'config.json'), 'utf8')).toThrow();

    config.engine = {
      mode: 'local',
      provider: 'compatible',
      model: 'local-model',
      base_url: 'http://127.0.0.1:18080/v1',
    };
    expect(() => saveConfig(config, store)).not.toThrow();
    expect(loadConfig(store).engine.base_url).toBe('http://127.0.0.1:18080/v1');
  });

  it('persists and repairs one canonical engine endpoint without rotating its compatible key', () => {
    process.env.POSTSHOW_CONFIG_DIR = dir;
    const store = new MemoryCredentialStore();
    const config = defaultConfig();
    config.engine = {
      mode: 'byok',
      provider: 'compatible',
      model: 'custom-model',
      base_url: 'https://MÜNICH.example:443/v1///',
    };
    config.keys.compatible = 'compatible-key';
    saveConfig(config, store);

    const storedPath = join(dir, 'config.json');
    const stored = JSON.parse(readFileSync(storedPath, 'utf8')) as {
      engine: { base_url: string };
      credentials: { keys: { compatible?: string } };
    };
    expect(stored.engine.base_url).toBe('https://xn--mnich-kva.example/v1');
    const compatibleAccount = stored.credentials.keys.compatible;
    expect(compatibleAccount).toBeTruthy();
    expect(loadConfig(store).engine.base_url).toBe('https://xn--mnich-kva.example/v1');

    stored.engine.base_url = 'https://XN--MNICH-KVA.example:443/v1////';
    writeFileSync(storedPath, JSON.stringify(stored));
    expect(loadConfig(store).engine.base_url).toBe('https://xn--mnich-kva.example/v1');
    const repaired = JSON.parse(readFileSync(storedPath, 'utf8')) as {
      engine: { base_url: string };
      credentials: { keys: { compatible?: string } };
    };
    expect(repaired.engine.base_url).toBe('https://xn--mnich-kva.example/v1');
    expect(repaired.credentials.keys.compatible).toBe(compatibleAccount);
    expect(store.get(compatibleAccount!)).toBe('compatible-key');
  });

  it('allows canonical local IPv6 but rejects private and local IPv6 remote targets', () => {
    process.env.POSTSHOW_CONFIG_DIR = dir;
    const store = new MemoryCredentialStore();
    const config = defaultConfig();
    config.engine = {
      mode: 'local',
      provider: 'compatible',
      model: 'local-model',
      base_url: 'http://[::1]:11434/v1///',
    };
    saveConfig(config, store);
    expect(loadConfig(store).engine.base_url).toBe('http://[::1]:11434/v1');

    for (const baseUrl of [
      'https://[::1]/v1',
      'https://[::ffff:127.0.0.1]/v1',
      'https://[fd00::1]/v1',
      'https://[fe80::1]/v1',
      'https://[2001:db8::1]/v1',
    ]) {
      config.engine = {
        mode: 'byok',
        provider: 'compatible',
        model: 'custom-model',
        base_url: baseUrl,
      };
      expect(() => saveConfig(config, store)).toThrow(/standard-port public HTTPS/);
    }
  });

  it('repairs a hand-edited task endpoint and invalidates its compatible key before rejecting it', () => {
    process.env.POSTSHOW_CONFIG_DIR = dir;
    const store = new MemoryCredentialStore();
    const config = defaultConfig();
    config.token = 'psh_stays_available';
    config.engine = {
      mode: 'byok',
      provider: 'compatible',
      model: 'custom-model',
      base_url: 'https://workspace-models.example/v1',
    };
    config.keys.compatible = 'compatible-key-must-be-invalidated';
    saveConfig(config, store);

    const storedPath = join(dir, 'config.json');
    const stored = JSON.parse(readFileSync(storedPath, 'utf8')) as {
      taskPrefs: Record<string, unknown>;
      credentials: { keys: Record<string, string> };
    };
    const compatibleAccount = stored.credentials.keys.compatible;
    expect(compatibleAccount).toBeTruthy();
    stored.taskPrefs = {
      narration: {
        provider: 'compatible',
        base_url: 'https://per-task-attacker.example/v1',
      },
    };
    writeFileSync(storedPath, JSON.stringify(stored));

    expect(() => loadConfig(store)).toThrow(/compatible key was invalidated/);
    const repaired = JSON.parse(readFileSync(storedPath, 'utf8')) as {
      taskPrefs: { narration: Record<string, unknown> };
      credentials: { keys: Record<string, string> };
    };
    expect(repaired.taskPrefs.narration).toEqual({ provider: 'compatible' });
    expect(repaired.credentials.keys).not.toHaveProperty('compatible');
    expect(store.get(compatibleAccount!)).toBeNull();
    expect(loadConfig(store)).toMatchObject({
      token: 'psh_stays_available',
      keys: {},
      taskPrefs: { narration: { provider: 'compatible' } },
    });
  });

  it('serializes config writes and recovers an abandoned lock', () => {
    process.env.POSTSHOW_CONFIG_DIR = dir;
    const store = new MemoryCredentialStore();
    const lockPath = join(dir, '.config.lock');
    writeFileSync(lockPath, `${process.pid}\n`);

    expect(() => saveConfig(defaultConfig(), store)).toThrow(/already in progress/);
    expect(store.values.size).toBe(0);
    expect(() => readFileSync(join(dir, 'config.json'), 'utf8')).toThrow();

    const old = new Date(Date.now() - 11 * 60_000);
    utimesSync(lockPath, old, old);
    expect(() => saveConfig(defaultConfig(), store)).not.toThrow();
    expect(() => readFileSync(lockPath, 'utf8')).toThrow();
  });

  it('migrates a complete unversioned profile with connectors unverified', () => {
    process.env.POSTSHOW_CONFIG_DIR = dir;
    const store = new MemoryCredentialStore();
    const legacy = defaultConfig();
    const { version: _version, ...unversioned } = legacy;
    unversioned.connectors.push({
      provider: 'stripe',
      label: '',
      localOnly: true,
      verified: true,
      meta: {},
      secret: { api_key: 'rk_test' },
    });
    const legacyConnector = unversioned.connectors[0];
    if (!legacyConnector) throw new Error('missing test connector');
    const { verified: _verified, ...connectorWithoutVerification } = legacyConnector;
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({ ...unversioned, connectors: [connectorWithoutVerification] })
    );

    const loaded = loadConfig(store);
    expect(loaded.version).toBe(CLI_CONFIG_VERSION);
    expect(loaded.connectors[0]?.verified).toBe(false);
    expect(loaded.connectors[0]?.secret).toEqual({ api_key: 'rk_test' });
    const persisted = readFileSync(join(dir, 'config.json'), 'utf8');
    expect(persisted).not.toContain('rk_test');
    expect(JSON.parse(persisted)).toMatchObject({
      version: CLI_CONFIG_VERSION,
      connectors: [{ provider: 'stripe', verified: false }],
    });
  });

  it('migrates version 1 atomically without retaining plaintext credentials', () => {
    process.env.POSTSHOW_CONFIG_DIR = dir;
    const store = new MemoryCredentialStore();
    const legacy = {
      ...defaultConfig(),
      version: 1,
      token: 'psh_legacy',
      keys: { anthropic: 'sk-ant-legacy' },
    };
    writeFileSync(join(dir, 'config.json'), JSON.stringify(legacy));

    const loaded = loadConfig(store);

    expect(loaded).toMatchObject({ token: 'psh_legacy', keys: { anthropic: 'sk-ant-legacy' } });
    const persisted = readFileSync(join(dir, 'config.json'), 'utf8');
    expect(persisted).not.toContain('psh_legacy');
    expect(persisted).not.toContain('sk-ant-legacy');
    expect(store.values.size).toBe(2);
  });

  it('repairs and rejects a plaintext legacy task endpoint without staging its compatible key', () => {
    process.env.POSTSHOW_CONFIG_DIR = dir;
    const store = new MemoryCredentialStore();
    const legacy = {
      ...defaultConfig(),
      version: 1,
      engine: {
        mode: 'byok',
        provider: 'compatible',
        model: 'custom-model',
        base_url: 'https://workspace-models.example/v1',
      },
      taskPrefs: {
        narration: {
          provider: 'compatible',
          base_url: 'https://per-task-attacker.example/v1',
        },
      },
      keys: { compatible: 'legacy-compatible-key' },
    };
    const storedPath = join(dir, 'config.json');
    writeFileSync(storedPath, JSON.stringify(legacy));

    expect(() => loadConfig(store)).toThrow(/compatible key was invalidated/);
    const repaired = readFileSync(storedPath, 'utf8');
    expect(repaired).not.toContain('per-task-attacker');
    expect(repaired).not.toContain('legacy-compatible-key');
    expect(
      (JSON.parse(repaired) as { credentials: { keys: Record<string, string> } }).credentials.keys
    ).not.toHaveProperty('compatible');
    expect([...store.values.values()]).not.toContain('legacy-compatible-key');
  });

  it('leaves a legacy plaintext profile untouched and rolls back staged entries on migration failure', () => {
    process.env.POSTSHOW_CONFIG_DIR = dir;
    const store = new MemoryCredentialStore();
    store.failOnSet = 2;
    const legacy = {
      ...defaultConfig(),
      version: 1,
      token: 'psh_migration_secret',
      keys: { anthropic: 'sk-ant-migration-secret' },
    };
    const before = JSON.stringify(legacy);
    writeFileSync(join(dir, 'config.json'), before);

    let caught: unknown;
    try {
      loadConfig(store);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CredentialStoreError);
    expect((caught as Error).message).not.toContain('psh_migration_secret');
    expect((caught as Error).message).not.toContain('sk-ant-migration-secret');
    expect(readFileSync(join(dir, 'config.json'), 'utf8')).toBe(before);
    expect(store.values.size).toBe(0);
    expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('fails closed on a missing OS entry and supports explicit environment-only recovery', () => {
    process.env.POSTSHOW_CONFIG_DIR = dir;
    const store = new MemoryCredentialStore();
    const config = defaultConfig();
    config.token = 'psh_stored';
    config.keys.anthropic = 'sk-ant-stored';
    config.connectors.push({
      provider: 'stripe',
      label: '',
      localOnly: true,
      verified: true,
      meta: {},
      secret: { api_key: 'rk_stored' },
    });
    saveConfig(config, store);
    store.values.clear();

    expect(() => loadConfig(store)).toThrow(CredentialStoreError);

    process.env.POSTSHOW_CREDENTIALS_JSON = JSON.stringify({
      token: 'psh_environment',
      keys: { anthropic: 'sk-ant-environment' },
      connectors: { stripe: { api_key: 'rk_environment' } },
    });
    expect(loadConfig(store)).toMatchObject({
      token: 'psh_environment',
      keys: { anthropic: 'sk-ant-environment' },
      connectors: [{ provider: 'stripe', secret: { api_key: 'rk_environment' } }],
    });
  });

  it('never includes malformed environment credential contents in errors', () => {
    process.env.POSTSHOW_CREDENTIALS_JSON = '{"token":"psh_must_not_leak", nope';
    let caught: unknown;
    try {
      defaultConfig();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as Error).message).not.toContain('psh_must_not_leak');
  });
});
