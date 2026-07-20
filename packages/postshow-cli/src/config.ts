// Local profile: ~/.postshow/config.json, chmod 600. Holds the access token,
// the gateway URL, the local engine choice, provider keys, and connector
// credentials for local-only connectors. Nothing here ever transits through
// a model; secrets go straight from prompt to disk to provider API.

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  EngineDefaults,
  EngineProviderId,
  TaskClass,
  TaskPref,
} from '@eventools/postshow-core';

export interface LocalConnector {
  provider: string;
  label: string;
  localOnly: boolean;
  meta: Record<string, unknown>;
  secret: Record<string, unknown>;
}

export interface CliConfig {
  apiUrl: string;
  token: string;
  workspaceId: string;
  workspaceName: string;
  engine: EngineDefaults;
  taskPrefs: Partial<Record<TaskClass, TaskPref>>;
  keys: Partial<Record<EngineProviderId, string>>;
  connectors: LocalConnector[];
}

export function defaultConfig(): CliConfig {
  return {
    apiUrl: process.env.POSTSHOW_API_URL ?? 'https://qlszsqnhjaywvkgdzoxz.supabase.co',
    token: process.env.POSTSHOW_TOKEN ?? '',
    workspaceId: '',
    workspaceName: '',
    engine: { mode: 'byok', provider: 'anthropic', model: '', base_url: '' },
    taskPrefs: {},
    keys: {},
    connectors: [],
  };
}

export function configDir(): string {
  return process.env.POSTSHOW_CONFIG_DIR ?? join(homedir(), '.postshow');
}

export function configPath(): string {
  return join(configDir(), 'config.json');
}

export function loadConfig(): CliConfig {
  const base = defaultConfig();
  if (!existsSync(configPath())) return base;
  try {
    const stored = JSON.parse(readFileSync(configPath(), 'utf8')) as Partial<CliConfig>;
    return {
      ...base,
      ...stored,
      engine: { ...base.engine, ...stored.engine },
      taskPrefs: stored.taskPrefs ?? {},
      keys: stored.keys ?? {},
      connectors: stored.connectors ?? [],
      // Environment always wins for the token so CI never persists one.
      token: process.env.POSTSHOW_TOKEN ?? stored.token ?? '',
    };
  } catch {
    return base;
  }
}

export function saveConfig(config: CliConfig): void {
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  chmodSync(configPath(), 0o600);
}
