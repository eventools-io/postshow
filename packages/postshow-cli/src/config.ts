// Local profile. Non-secret settings live in ~/.postshow/config.json; access
// tokens, provider keys, and connector credentials live in the OS credential
// store and are hydrated only in memory. Legacy plaintext profiles migrate by
// writing every credential first and atomically replacing the config second.

import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getProvider, resolveEngineEndpoint } from '@eventools/postshow-core';
import { z } from 'zod';
import { CredentialStoreError, systemCredentialStore, type CredentialStore } from './credentials';

export type EngineMode = 'hosted' | 'byok' | 'local';
export type EngineProviderId =
  | 'anthropic'
  | 'openai'
  | 'moonshot'
  | 'zhipu'
  | 'deepseek'
  | 'xai'
  | 'mistral'
  | 'compatible'
  | 'ollama';
export type TaskClass = 'narration' | 'investigation' | 'deep_dive' | 'drafting';
export type EffortLevel = 'minimal' | 'low' | 'medium' | 'high' | 'max';

export interface EngineDefaults {
  mode: EngineMode;
  provider: EngineProviderId;
  model: string;
  base_url: string;
}

export interface TaskPref {
  mode?: EngineMode;
  provider?: EngineProviderId;
  model?: string;
  effort?: EffortLevel;
}

export interface LocalConnector {
  provider: string;
  label: string;
  localOnly: boolean;
  verified: boolean;
  meta: Record<string, unknown>;
  secret: Record<string, unknown>;
}

export const CLI_CONFIG_VERSION = 2 as const;

export interface CliConfig {
  version: typeof CLI_CONFIG_VERSION;
  apiUrl: string;
  token: string;
  workspaceId: string;
  workspaceName: string;
  engine: EngineDefaults;
  taskPrefs: Partial<Record<TaskClass, TaskPref>>;
  keys: Partial<Record<EngineProviderId, string>>;
  connectors: LocalConnector[];
}

interface CredentialBundle {
  token: string;
  keys: Partial<Record<EngineProviderId, string>>;
  connectors: Record<string, Record<string, unknown>>;
}

const engineModeSchema = z.enum(['hosted', 'byok', 'local']);
const engineProviderSchema = z.enum([
  'anthropic',
  'openai',
  'moonshot',
  'zhipu',
  'deepseek',
  'xai',
  'mistral',
  'compatible',
  'ollama',
]);
const effortSchema = z.enum(['minimal', 'low', 'medium', 'high', 'max']);
const engineSchema = z
  .object({
    mode: engineModeSchema,
    provider: engineProviderSchema,
    model: z.string(),
    base_url: z.string(),
  })
  .strict();
const taskPrefSchema = z
  .object({
    mode: engineModeSchema.optional(),
    provider: engineProviderSchema.optional(),
    model: z.string().optional(),
    effort: effortSchema.optional(),
  })
  .strict();
const legacyTaskPrefSchema = taskPrefSchema.extend({ base_url: z.string().optional() }).strict();
const taskPrefsSchema = z
  .object({
    narration: taskPrefSchema.optional(),
    investigation: taskPrefSchema.optional(),
    deep_dive: taskPrefSchema.optional(),
    drafting: taskPrefSchema.optional(),
  })
  .strict();
const legacyTaskPrefsSchema = z
  .object({
    narration: legacyTaskPrefSchema.optional(),
    investigation: legacyTaskPrefSchema.optional(),
    deep_dive: legacyTaskPrefSchema.optional(),
    drafting: legacyTaskPrefSchema.optional(),
  })
  .strict();
const keysSchema = z
  .object({
    anthropic: z.string().optional(),
    openai: z.string().optional(),
    moonshot: z.string().optional(),
    zhipu: z.string().optional(),
    deepseek: z.string().optional(),
    xai: z.string().optional(),
    mistral: z.string().optional(),
    compatible: z.string().optional(),
    ollama: z.string().optional(),
  })
  .strict();
const credentialValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const connectorSecretSchema = z.record(credentialValueSchema);
const connectorBaseFields = {
  provider: z.string().min(1),
  label: z.string(),
  localOnly: z.boolean(),
  meta: z.record(z.unknown()),
};
const apiUrlSchema = z.union([z.literal(''), z.string().url()]);
const unversionedConnectorSchema = z
  .object({ ...connectorBaseFields, secret: connectorSecretSchema })
  .strict();
const versionOneConnectorSchema = unversionedConnectorSchema
  .extend({ verified: z.boolean() })
  .strict();
const storedConnectorSchema = z.object({ ...connectorBaseFields, verified: z.boolean() }).strict();
const runtimeConnectorSchema = storedConnectorSchema
  .extend({ secret: connectorSecretSchema })
  .strict();
const nonSecretConfigFields = {
  // Empty is the only safe unconfigured state. Network calls reject it and
  // setup replaces it with the exact workspace origin before first use.
  apiUrl: apiUrlSchema,
  workspaceId: z.string(),
  workspaceName: z.string(),
  engine: engineSchema,
  taskPrefs: taskPrefsSchema,
};
const legacyNonSecretConfigFields = {
  ...nonSecretConfigFields,
  taskPrefs: legacyTaskPrefsSchema,
};
const secretConfigFields = {
  token: z.string(),
  keys: keysSchema,
};
const unversionedConfigSchema = z
  .object({
    ...legacyNonSecretConfigFields,
    ...secretConfigFields,
    connectors: z.array(unversionedConnectorSchema),
  })
  .strict();
const versionOneConfigSchema = z
  .object({
    version: z.literal(1),
    ...legacyNonSecretConfigFields,
    ...secretConfigFields,
    connectors: z.array(versionOneConnectorSchema),
  })
  .strict();
const runtimeConfigSchema = z
  .object({
    version: z.literal(CLI_CONFIG_VERSION),
    ...nonSecretConfigFields,
    ...secretConfigFields,
    connectors: z.array(runtimeConnectorSchema),
  })
  .strict();
const credentialReferenceSchema = z
  .string()
  .regex(/^(token|engine|connector)\/[0-9a-f]{8}-[0-9a-f-]{27}$/i);
const keyReferenceSchema = z
  .object({
    anthropic: credentialReferenceSchema.optional(),
    openai: credentialReferenceSchema.optional(),
    moonshot: credentialReferenceSchema.optional(),
    zhipu: credentialReferenceSchema.optional(),
    deepseek: credentialReferenceSchema.optional(),
    xai: credentialReferenceSchema.optional(),
    mistral: credentialReferenceSchema.optional(),
    compatible: credentialReferenceSchema.optional(),
    ollama: credentialReferenceSchema.optional(),
  })
  .strict();
const credentialReferencesSchema = z
  .object({
    token: credentialReferenceSchema.nullable(),
    keys: keyReferenceSchema,
    connectors: z.record(credentialReferenceSchema),
  })
  .strict();
const storedConfigSchema = z
  .object({
    version: z.literal(CLI_CONFIG_VERSION),
    ...nonSecretConfigFields,
    credentials: credentialReferencesSchema,
    connectors: z.array(storedConnectorSchema),
  })
  .strict();
const legacyStoredConfigSchema = z
  .object({
    version: z.literal(CLI_CONFIG_VERSION),
    ...legacyNonSecretConfigFields,
    credentials: credentialReferencesSchema,
    connectors: z.array(storedConnectorSchema),
  })
  .strict();
const environmentBundleSchema = z
  .object({
    token: z.string().optional(),
    keys: keysSchema.optional(),
    connectors: z.record(connectorSecretSchema).optional(),
  })
  .strict();

type StoredConfig = z.infer<typeof storedConfigSchema>;
type CredentialReferences = z.infer<typeof credentialReferencesSchema>;
type LegacyTaskPrefs = z.infer<typeof legacyTaskPrefsSchema>;
type LegacyStoredConfig = z.infer<typeof legacyStoredConfigSchema>;

interface LegacyProfileMigration {
  config: CliConfig;
  rejectedTaskEndpoint: boolean;
  invalidatedCompatibleKey: boolean;
}

const MAX_CREDENTIAL_BYTES = 2 * 1024;
const STALE_CONFIG_LOCK_MS = 10 * 60_000;
const SECRET_METADATA_KEY =
  /(?:^|[_-])(api[_-]?key|token|secret|password|credential|private[_-]?key|webhook[_-]?url)(?:$|[_-])/i;
const NORMALIZED_SECRET_METADATA_KEYS = [
  'apikey',
  'accesstoken',
  'authtoken',
  'bearertoken',
  'clientsecret',
  'secretkey',
  'password',
  'credential',
  'credentials',
  'privatekey',
  'webhookurl',
];

export class ConfigError extends Error {
  readonly code = 'POSTSHOW_CONFIG_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function validationDetail(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`)
    .join('; ');
}

function assertUniqueConnectors(connectors: { provider: string }[]): void {
  const providers = new Set<string>();
  for (const connector of connectors) {
    if (providers.has(connector.provider)) {
      throw new ConfigError('invalid config: duplicate connector provider');
    }
    providers.add(connector.provider);
  }
}

function assertMetadataContainsNoCredentials(value: unknown, seen = new WeakSet<object>()): void {
  if (typeof value === 'string') {
    let possibleUrl: URL;
    try {
      possibleUrl = new URL(value);
    } catch {
      return;
    }
    if (possibleUrl.username || possibleUrl.password || possibleUrl.search || possibleUrl.hash) {
      throw new ConfigError(
        'refusing to persist a credential-bearing URL in connector metadata; move it into the connector secret field'
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    for (const item of value) assertMetadataContainsNoCredentials(item, seen);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (
      SECRET_METADATA_KEY.test(key) ||
      NORMALIZED_SECRET_METADATA_KEYS.some(
        (credentialKey) =>
          normalizedKey === credentialKey ||
          normalizedKey.startsWith(credentialKey) ||
          normalizedKey.endsWith(credentialKey)
      )
    ) {
      throw new ConfigError(
        'refusing to persist connector credentials in metadata; move every credential into the connector secret field'
      );
    }
    assertMetadataContainsNoCredentials(nested, seen);
  }
}

function assertNoCredentialBearingUrls(config: { apiUrl: string; engine: EngineDefaults }): void {
  const urls = [config.apiUrl, config.engine.base_url];
  for (const raw of urls) {
    if (!raw) continue;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      // The schema or engine endpoint resolver supplies the useful validation
      // error for malformed URLs. This check only protects persisted secrets.
      continue;
    }
    if (url.username || url.password || url.search || url.hash) {
      throw new ConfigError(
        'refusing to persist a URL containing credentials, query parameters, or a fragment'
      );
    }
  }
}

function canonicalEngineEndpoint(engine: EngineDefaults): EngineDefaults {
  const provider = getProvider(engine.provider);
  if (!provider) throw new ConfigError('refusing to persist an unknown engine provider');
  if (provider.id !== 'compatible' && provider.id !== 'ollama') {
    if (engine.base_url) {
      throw new ConfigError('refusing to persist a custom endpoint for a curated provider');
    }
    return { ...engine, base_url: '' };
  }
  try {
    const baseUrl = resolveEngineEndpoint(
      {
        taskClass: 'narration',
        mode: engine.mode,
        provider: engine.provider,
        model: engine.model,
        effort: 'low',
        baseUrl: engine.base_url,
      },
      provider
    );
    return { ...engine, base_url: baseUrl };
  } catch (error) {
    throw new ConfigError(
      error instanceof Error ? error.message : 'refusing to persist an invalid engine endpoint'
    );
  }
}

function assertNonSecretFields(config: {
  apiUrl: string;
  engine: EngineDefaults;
  taskPrefs: Partial<Record<TaskClass, TaskPref>>;
  connectors: { meta: Record<string, unknown> }[];
}): EngineDefaults {
  assertNoCredentialBearingUrls(config);
  const engine = canonicalEngineEndpoint(config.engine);
  for (const connector of config.connectors) {
    assertMetadataContainsNoCredentials(connector.meta);
  }
  return engine;
}

function stripLegacyTaskEndpoints(taskPrefs: LegacyTaskPrefs): {
  taskPrefs: Partial<Record<TaskClass, TaskPref>>;
  hadLegacyField: boolean;
  hadConfiguredEndpoint: boolean;
} {
  const sanitized: Partial<Record<TaskClass, TaskPref>> = {};
  let hadLegacyField = false;
  let hadConfiguredEndpoint = false;
  for (const task of ['narration', 'investigation', 'deep_dive', 'drafting'] as const) {
    const pref = taskPrefs[task];
    if (!pref) continue;
    if (Object.prototype.hasOwnProperty.call(pref, 'base_url')) {
      hadLegacyField = true;
      if (pref.base_url) hadConfiguredEndpoint = true;
    }
    const { base_url: _legacyBaseUrl, ...supported } = pref;
    sanitized[task] = supported;
  }
  return { taskPrefs: sanitized, hadLegacyField, hadConfiguredEndpoint };
}

function legacyTaskEndpointError(invalidatedKey: boolean): ConfigError {
  return new ConfigError(
    invalidatedKey
      ? 'per-task engine endpoints are no longer supported; the profile was repaired and its compatible key was invalidated; run `postshow init` to bind a key to the workspace endpoint'
      : 'per-task engine endpoints are no longer supported; the profile was repaired; review the workspace endpoint before retrying'
  );
}

function emptyCredentialBundle(): CredentialBundle {
  return { token: '', keys: {}, connectors: {} };
}

function environmentCredentialBundle(): CredentialBundle | null {
  const raw = process.env.POSTSHOW_CREDENTIALS_JSON;
  if (raw === undefined) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ConfigError('POSTSHOW_CREDENTIALS_JSON contains invalid JSON');
  }
  const parsed = environmentBundleSchema.safeParse(value);
  if (!parsed.success) {
    throw new ConfigError('POSTSHOW_CREDENTIALS_JSON has an invalid credential shape');
  }
  return {
    token: process.env.POSTSHOW_TOKEN ?? parsed.data.token ?? '',
    keys: parsed.data.keys ?? {},
    connectors: parsed.data.connectors ?? {},
  };
}

export function defaultConfig(): CliConfig {
  const credentials = environmentCredentialBundle() ?? emptyCredentialBundle();
  return {
    version: CLI_CONFIG_VERSION,
    // There is no safe or meaningful default: users must bind the CLI to the
    // exact workspace API origin shown beside their token in Settings.
    apiUrl: process.env.POSTSHOW_API_URL ?? '',
    token: process.env.POSTSHOW_TOKEN ?? credentials.token,
    workspaceId: '',
    workspaceName: '',
    engine: { mode: 'byok', provider: 'anthropic', model: '', base_url: '' },
    taskPrefs: {},
    keys: credentials.keys,
    connectors: [],
  };
}

export function configDir(): string {
  return process.env.POSTSHOW_CONFIG_DIR ?? join(homedir(), '.postshow');
}

export function configPath(): string {
  return join(configDir(), 'config.json');
}

function readConfigSource(): unknown | null {
  if (!existsSync(configPath())) return null;
  let source: string;
  try {
    source = readFileSync(configPath(), 'utf8');
  } catch {
    throw new ConfigError(`could not read ${configPath()}`);
  }
  try {
    return JSON.parse(source);
  } catch {
    // Parser messages may quote malformed source containing credentials.
    throw new ConfigError(`could not parse ${configPath()}: invalid JSON`);
  }
}

function readRequiredCredential(store: CredentialStore, account: string): string {
  const value = store.get(account);
  if (value === null) {
    throw new CredentialStoreError(
      'Postshow credentials are missing from the OS credential store; restore them or provide POSTSHOW_CREDENTIALS_JSON for this process'
    );
  }
  return value;
}

function connectorCredential(value: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new CredentialStoreError('a Postshow connector credential is unreadable');
  }
  const result = connectorSecretSchema.safeParse(parsed);
  if (!result.success) {
    throw new CredentialStoreError('a Postshow connector credential is invalid');
  }
  return result.data;
}

function assertEnvironmentRecoveryComplete(
  references: CredentialReferences,
  credentials: CredentialBundle
): void {
  if (references.token && !credentials.token) {
    throw new CredentialStoreError(
      'POSTSHOW_CREDENTIALS_JSON does not contain every credential referenced by the profile'
    );
  }
  for (const provider of Object.keys(references.keys) as EngineProviderId[]) {
    if (!credentials.keys[provider]) {
      throw new CredentialStoreError(
        'POSTSHOW_CREDENTIALS_JSON does not contain every credential referenced by the profile'
      );
    }
  }
  for (const provider of Object.keys(references.connectors)) {
    if (!credentials.connectors[provider]) {
      throw new CredentialStoreError(
        'POSTSHOW_CREDENTIALS_JSON does not contain every credential referenced by the profile'
      );
    }
  }
}

function loadCredentialBundle(stored: StoredConfig, store: CredentialStore): CredentialBundle {
  const environment = environmentCredentialBundle();
  if (environment) {
    assertEnvironmentRecoveryComplete(stored.credentials, environment);
    return environment;
  }

  const credentials = emptyCredentialBundle();
  if (stored.credentials.token) {
    credentials.token = readRequiredCredential(store, stored.credentials.token);
  }
  for (const [provider, account] of Object.entries(stored.credentials.keys)) {
    if (account) {
      credentials.keys[provider as EngineProviderId] = readRequiredCredential(store, account);
    }
  }
  for (const [provider, account] of Object.entries(stored.credentials.connectors)) {
    credentials.connectors[provider] = connectorCredential(readRequiredCredential(store, account));
  }
  credentials.token = process.env.POSTSHOW_TOKEN ?? credentials.token;
  return credentials;
}

function hydrateConfig(stored: StoredConfig, credentials: CredentialBundle): CliConfig {
  return {
    version: CLI_CONFIG_VERSION,
    apiUrl: stored.apiUrl,
    token: credentials.token,
    workspaceId: stored.workspaceId,
    workspaceName: stored.workspaceName,
    engine: stored.engine,
    taskPrefs: stored.taskPrefs,
    keys: credentials.keys,
    connectors: stored.connectors.map((connector) => ({
      ...connector,
      secret: credentials.connectors[connector.provider] ?? {},
    })),
  };
}

function migrateUnversioned(value: unknown): LegacyProfileMigration {
  const parsed = unversionedConfigSchema.safeParse(value);
  if (!parsed.success) {
    throw new ConfigError(
      `invalid legacy config in ${configPath()}: ${validationDetail(parsed.error)}`
    );
  }
  assertUniqueConnectors(parsed.data.connectors);
  assertNonSecretFields(parsed.data);
  const stripped = stripLegacyTaskEndpoints(parsed.data.taskPrefs);
  const keys = { ...parsed.data.keys };
  const invalidatedCompatibleKey = stripped.hadConfiguredEndpoint && Boolean(keys.compatible);
  if (stripped.hadConfiguredEndpoint) delete keys.compatible;
  return {
    config: {
      version: CLI_CONFIG_VERSION,
      apiUrl: parsed.data.apiUrl,
      token: parsed.data.token,
      workspaceId: parsed.data.workspaceId,
      workspaceName: parsed.data.workspaceName,
      engine: parsed.data.engine,
      taskPrefs: stripped.taskPrefs,
      keys,
      connectors: parsed.data.connectors.map((connector) => ({
        ...connector,
        verified: false,
      })),
    },
    rejectedTaskEndpoint: stripped.hadLegacyField,
    invalidatedCompatibleKey,
  };
}

function migrateVersionOne(value: unknown): LegacyProfileMigration {
  const parsed = versionOneConfigSchema.safeParse(value);
  if (!parsed.success) {
    throw new ConfigError(
      `invalid version 1 config in ${configPath()}: ${validationDetail(parsed.error)}`
    );
  }
  assertUniqueConnectors(parsed.data.connectors);
  assertNonSecretFields(parsed.data);
  const stripped = stripLegacyTaskEndpoints(parsed.data.taskPrefs);
  const keys = { ...parsed.data.keys };
  const invalidatedCompatibleKey = stripped.hadConfiguredEndpoint && Boolean(keys.compatible);
  if (stripped.hadConfiguredEndpoint) delete keys.compatible;
  return {
    config: {
      version: CLI_CONFIG_VERSION,
      apiUrl: parsed.data.apiUrl,
      token: parsed.data.token,
      workspaceId: parsed.data.workspaceId,
      workspaceName: parsed.data.workspaceName,
      engine: parsed.data.engine,
      taskPrefs: stripped.taskPrefs,
      keys,
      connectors: parsed.data.connectors,
    },
    rejectedTaskEndpoint: stripped.hadLegacyField,
    invalidatedCompatibleKey,
  };
}

function repairStoredTaskEndpoints(
  source: unknown,
  legacy: LegacyStoredConfig,
  store: CredentialStore
): never {
  const stripped = stripLegacyTaskEndpoints(legacy.taskPrefs);
  if (!stripped.hadLegacyField) {
    throw new ConfigError(`invalid config in ${configPath()}: unsupported task preference`);
  }

  const keys = { ...legacy.credentials.keys };
  const compatibleAccount = stripped.hadConfiguredEndpoint ? keys.compatible : undefined;
  if (stripped.hadConfiguredEndpoint) delete keys.compatible;
  const sanitized = storedConfigSchema.safeParse({
    ...legacy,
    taskPrefs: stripped.taskPrefs,
    credentials: { ...legacy.credentials, keys },
  });
  if (!sanitized.success) {
    throw new ConfigError(`invalid config in ${configPath()}: could not repair task preferences`);
  }

  const releaseLock = acquireConfigLock();
  try {
    const current = readConfigSource();
    if (JSON.stringify(current) !== JSON.stringify(source)) {
      throw new ConfigError('the Postshow configuration changed during endpoint repair; retry');
    }
    writeConfigAtomically(sanitized.data);
  } finally {
    releaseLock();
  }

  if (compatibleAccount) {
    try {
      store.delete(compatibleAccount);
    } catch {
      // The committed profile no longer references this key. A native-store
      // cleanup failure can leave an orphan, but it cannot be used by Postshow.
    }
  }
  throw legacyTaskEndpointError(Boolean(compatibleAccount));
}

export function loadConfig(store: CredentialStore = systemCredentialStore()): CliConfig {
  const source = readConfigSource();
  if (source === null) return defaultConfig();
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new ConfigError(`invalid config in ${configPath()}: expected an object`);
  }

  const record = source as Record<string, unknown>;
  if (record.version === undefined) {
    const migration = migrateUnversioned(source);
    saveConfig(migration.config, store);
    if (migration.rejectedTaskEndpoint) {
      throw legacyTaskEndpointError(migration.invalidatedCompatibleKey);
    }
    return loadConfig(store);
  }
  if (record.version === 1) {
    const migration = migrateVersionOne(source);
    saveConfig(migration.config, store);
    if (migration.rejectedTaskEndpoint) {
      throw legacyTaskEndpointError(migration.invalidatedCompatibleKey);
    }
    return loadConfig(store);
  }
  if (record.version !== CLI_CONFIG_VERSION) {
    throw new ConfigError(
      `unsupported config version in ${configPath()} (expected ${CLI_CONFIG_VERSION})`
    );
  }

  const parsed = storedConfigSchema.safeParse(source);
  if (!parsed.success) {
    const legacy = legacyStoredConfigSchema.safeParse(source);
    if (legacy.success) repairStoredTaskEndpoints(source, legacy.data, store);
    throw new ConfigError(`invalid config in ${configPath()}: ${validationDetail(parsed.error)}`);
  }
  assertUniqueConnectors(parsed.data.connectors);
  const canonicalEngine = assertNonSecretFields(parsed.data);
  if (canonicalEngine.base_url !== parsed.data.engine.base_url) {
    const releaseLock = acquireConfigLock();
    try {
      const current = readConfigSource();
      if (JSON.stringify(current) !== JSON.stringify(source)) {
        throw new ConfigError(
          'the Postshow configuration changed during endpoint normalization; retry'
        );
      }
      writeConfigAtomically({ ...parsed.data, engine: canonicalEngine });
    } finally {
      releaseLock();
    }
    return loadConfig(store);
  }
  return hydrateConfig(parsed.data, loadCredentialBundle(parsed.data, store));
}

function existingCredentialReferences(): CredentialReferences {
  const source = readConfigSource();
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return { token: null, keys: {}, connectors: {} };
  }
  if ((source as Record<string, unknown>).version !== CLI_CONFIG_VERSION) {
    return { token: null, keys: {}, connectors: {} };
  }
  const parsed = storedConfigSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError(`invalid config in ${configPath()}: ${validationDetail(parsed.error)}`);
  }
  return parsed.data.credentials;
}

function staleConfigLockToken(path: string): string | null {
  try {
    const token = readFileSync(path, 'utf8').trim();
    const age = Date.now() - statSync(path).mtimeMs;
    if (age > STALE_CONFIG_LOCK_MS) return token;
    const pid = Number(token.split(':', 1)[0]);
    if (!Number.isSafeInteger(pid) || pid <= 0) return null;
    try {
      process.kill(pid, 0);
      return null;
    } catch (error) {
      return error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code?: unknown }).code === 'ESRCH'
        ? token
        : null;
    }
  } catch {
    return null;
  }
}

function acquireConfigLock(): () => void {
  const directory = configDir();
  const path = join(directory, '.config.lock');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);

  const lockToken = `${process.pid}:${randomUUID()}`;
  let descriptor: number | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      descriptor = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      writeFileSync(descriptor, `${lockToken}\n`, 'utf8');
      fsyncSync(descriptor);
      break;
    } catch (error) {
      const alreadyExists = Boolean(
        error &&
          typeof error === 'object' &&
          'code' in error &&
          (error as { code?: unknown }).code === 'EEXIST'
      );
      const staleToken = alreadyExists ? staleConfigLockToken(path) : null;
      if (attempt === 0 && staleToken !== null) {
        try {
          if (readFileSync(path, 'utf8').trim() === staleToken) rmSync(path, { force: true });
        } catch {
          // A concurrent owner changed the lock; the retry will fail closed.
        }
        continue;
      }
      if (descriptor !== null) {
        closeSync(descriptor);
        descriptor = null;
        try {
          if (readFileSync(path, 'utf8').trim() === lockToken) rmSync(path, { force: true });
        } catch {
          // A failed lock write may leave no path to clean up.
        }
        throw new ConfigError('could not lock the Postshow configuration for update');
      }
      throw new ConfigError('another Postshow configuration update is already in progress');
    }
  }
  if (descriptor === null) {
    throw new ConfigError('could not lock the Postshow configuration for update');
  }

  const lockedDescriptor = descriptor;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      closeSync(lockedDescriptor);
    } catch {
      // The operation outcome is already known; lock cleanup must not mask it.
    } finally {
      try {
        if (readFileSync(path, 'utf8').trim() === lockToken) rmSync(path, { force: true });
      } catch {
        // The lock was already removed or replaced; never delete another owner's lock.
      }
    }
  };
}

function credentialAccounts(references: CredentialReferences): Set<string> {
  return new Set([
    ...(references.token ? [references.token] : []),
    ...Object.values(references.keys).filter((value): value is string => Boolean(value)),
    ...Object.values(references.connectors),
  ]);
}

function writeConfigAtomically(stored: StoredConfig): void {
  const directory = configDir();
  const destination = configPath();
  const temporary = join(directory, `.config.${process.pid}.${randomUUID()}.tmp`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);

  let descriptor: number | null = null;
  try {
    descriptor = openSync(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600
    );
    writeFileSync(descriptor, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    chmodSync(temporary, 0o600);
    renameSync(temporary, destination);
    // The renamed temporary already has the restrictive mode. Windows treats
    // chmod as advisory, so post-commit permission hardening is best effort.
    try {
      chmodSync(destination, 0o600);
    } catch {
      // Never report failure and roll back credentials after the config commit.
    }
    // POSIX needs the containing directory flushed for the rename to survive a
    // sudden power loss. Windows may not permit opening directories; the file
    // itself has already been flushed there, so directory sync is best effort.
    let directoryDescriptor: number | null = null;
    try {
      directoryDescriptor = openSync(directory, constants.O_RDONLY);
      fsyncSync(directoryDescriptor);
    } catch {
      // See comment above: never roll back a config that was already renamed.
    } finally {
      if (directoryDescriptor !== null) {
        try {
          closeSync(directoryDescriptor);
        } catch {
          // Directory flush is best effort after the committed rename.
        }
      }
    }
  } catch {
    throw new ConfigError(`could not save ${destination} atomically`);
  } finally {
    if (descriptor !== null) {
      try {
        closeSync(descriptor);
      } catch {
        // Preserve the sanitized save failure from the guarded write above.
      }
    }
    try {
      rmSync(temporary, { force: true });
    } catch {
      // A cleanup failure must not alter an already committed outcome.
    }
  }
}

function safeCredentialValue(value: string): string {
  if (Buffer.byteLength(value, 'utf8') > MAX_CREDENTIAL_BYTES) {
    throw new ConfigError('a credential exceeds the OS credential-store size limit');
  }
  return value;
}

export function saveConfig(
  config: CliConfig,
  store: CredentialStore = systemCredentialStore()
): void {
  const parsed = runtimeConfigSchema.safeParse(config);
  if (!parsed.success) {
    throw new ConfigError(`refusing to save invalid config: ${validationDetail(parsed.error)}`);
  }
  assertUniqueConnectors(parsed.data.connectors);
  const canonicalEngine = assertNonSecretFields(parsed.data);
  const canonical = { ...parsed.data, engine: canonicalEngine };

  const releaseLock = acquireConfigLock();
  try {
    const previousReferences = existingCredentialReferences();
    const nextReferences: CredentialReferences = { token: null, keys: {}, connectors: {} };
    const stagedAccounts: string[] = [];
    const stage = (kind: 'token' | 'engine' | 'connector', value: string): string => {
      const account = `${kind}/${randomUUID()}`;
      const safeValue = safeCredentialValue(value);
      // A native backend can fail ambiguously after accepting a write. Track
      // the random account before mutation so rollback also covers that case.
      stagedAccounts.push(account);
      store.set(account, safeValue);
      return account;
    };

    try {
      if (canonical.token) nextReferences.token = stage('token', canonical.token);
      for (const [provider, key] of Object.entries(canonical.keys)) {
        if (key) nextReferences.keys[provider as EngineProviderId] = stage('engine', key);
      }
      for (const connector of canonical.connectors) {
        if (Object.keys(connector.secret).length > 0) {
          nextReferences.connectors[connector.provider] = stage(
            'connector',
            JSON.stringify(connector.secret)
          );
        }
      }

      const stored: StoredConfig = {
        version: CLI_CONFIG_VERSION,
        apiUrl: canonical.apiUrl,
        workspaceId: canonical.workspaceId,
        workspaceName: canonical.workspaceName,
        engine: canonical.engine,
        taskPrefs: canonical.taskPrefs,
        credentials: nextReferences,
        connectors: canonical.connectors.map(({ secret: _secret, ...connector }) => connector),
      };
      writeConfigAtomically(stored);
    } catch (error) {
      for (const account of stagedAccounts) {
        try {
          store.delete(account);
        } catch {
          // Best effort: an orphaned OS entry is safer than plaintext rollback.
        }
      }
      throw error;
    }

    const nextAccounts = credentialAccounts(nextReferences);
    for (const account of credentialAccounts(previousReferences)) {
      if (nextAccounts.has(account)) continue;
      try {
        store.delete(account);
      } catch {
        // The new config is committed; stale OS entries can be removed manually.
      }
    }
  } finally {
    releaseLock();
  }
}

export { CredentialStoreError, type CredentialStore } from './credentials';
