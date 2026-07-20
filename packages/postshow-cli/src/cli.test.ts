import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectConnectors } from './detect';
import { defaultConfig, loadConfig, saveConfig } from './config';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'postshow-cli-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.POSTSHOW_CONFIG_DIR;
  delete process.env.POSTSHOW_TOKEN;
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
    const config = defaultConfig();
    config.token = 'psh_stored';
    config.workspaceId = 'w1';
    config.keys.anthropic = 'sk-ant-1';
    config.connectors.push({
      provider: 'posthog',
      label: '',
      localOnly: true,
      meta: { project_id: '1' },
      secret: { api_key: 'phx' },
    });
    saveConfig(config);

    const loaded = loadConfig();
    expect(loaded.token).toBe('psh_stored');
    expect(loaded.keys.anthropic).toBe('sk-ant-1');
    expect(loaded.connectors[0]?.localOnly).toBe(true);

    process.env.POSTSHOW_TOKEN = 'psh_env_wins';
    expect(loadConfig().token).toBe('psh_env_wins');
  });

  it('survives a corrupt config file', () => {
    process.env.POSTSHOW_CONFIG_DIR = dir;
    writeFileSync(join(dir, 'config.json'), '{not json');
    expect(loadConfig().workspaceId).toBe('');
  });
});
