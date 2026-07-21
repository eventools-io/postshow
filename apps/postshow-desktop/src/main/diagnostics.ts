import { chmodSync, writeFileSync } from 'node:fs';
import type { LedgerEntry, LedgerStatus } from './scheduler';
import type { DesktopUpdateStatus, UpdateState } from './updater';

export const DIAGNOSTIC_SCHEMA_VERSION = 1 as const;
export const MAX_DIAGNOSTIC_RUNS = 20;

export interface DiagnosticConfigState {
  configured: boolean;
  invalid: boolean;
  engineMode?: string;
  engineProvider?: string;
  connectorCount: number;
  verifiedConnectorCount: number;
  localOnlyConnectorCount: number;
}

export interface DiagnosticInput {
  generatedAt: string;
  appVersion: string;
  electronVersion: string;
  nodeVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  osRelease: string;
  config: DiagnosticConfigState;
  updater: DesktopUpdateStatus;
  runs: LedgerEntry[];
}

const ENGINE_MODES = new Set(['hosted', 'byok', 'local']);
const ENGINE_PROVIDERS = new Set([
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
const LEDGER_STATUSES = new Set<LedgerStatus>([
  'idle',
  'succeeded',
  'partial',
  'failed',
  'uncertain',
  'busy',
  'unconfigured',
]);
const UPDATE_STATES = new Set<UpdateState>([
  'verifying',
  'disabled',
  'idle',
  'checking',
  'available',
  'downloading',
  'downloaded',
  'up-to-date',
  'error',
  'installing',
]);

function safeVersion(value: string): string {
  return /^[0-9A-Za-z.+-]{1,64}$/.test(value) ? value : 'unknown';
}

function safeSystemValue(value: string): string {
  return /^[0-9A-Za-z._+-]{1,64}$/.test(value) ? value : 'unknown';
}

function safeCount(value: number): number {
  return Number.isSafeInteger(value) ? Math.max(0, Math.min(10_000, value)) : 0;
}

function safeTimestamp(value: string): string {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ? value : 'unknown';
}

/** Build diagnostics by allowlist, never by redaction. Raw config, secrets,
 * connector metadata, workspace identifiers, logs, paths, prompts, gathered
 * data, and free-form errors are not accepted into the output shape at all. */
export function buildDiagnosticBundle(input: DiagnosticInput) {
  const updaterState = UPDATE_STATES.has(input.updater.state) ? input.updater.state : 'error';
  return {
    schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
    generatedAt: safeTimestamp(input.generatedAt),
    privacy:
      'Allowlisted operational metadata only; excludes credentials, identifiers, content, paths, URLs, logs, and free-form errors.',
    app: {
      version: safeVersion(input.appVersion),
      electron: safeVersion(input.electronVersion),
      node: safeVersion(input.nodeVersion),
      platform: ['darwin', 'win32'].includes(input.platform) ? input.platform : 'unsupported',
      arch: ['arm64', 'x64'].includes(input.arch) ? input.arch : 'unknown',
      osRelease: safeSystemValue(input.osRelease),
    },
    config: {
      configured: Boolean(input.config.configured),
      invalid: Boolean(input.config.invalid),
      engineMode: ENGINE_MODES.has(input.config.engineMode ?? '')
        ? input.config.engineMode
        : 'unknown',
      engineProvider: ENGINE_PROVIDERS.has(input.config.engineProvider ?? '')
        ? input.config.engineProvider
        : 'unknown',
      connectorCount: safeCount(input.config.connectorCount),
      verifiedConnectorCount: safeCount(input.config.verifiedConnectorCount),
      localOnlyConnectorCount: safeCount(input.config.localOnlyConnectorCount),
    },
    updater: {
      state: updaterState,
      currentVersion: safeVersion(input.updater.currentVersion),
      availableVersion: input.updater.availableVersion
        ? safeVersion(input.updater.availableVersion)
        : null,
      progressPercent:
        typeof input.updater.progressPercent === 'number'
          ? Math.max(0, Math.min(100, Math.round(input.updater.progressPercent)))
          : null,
    },
    recentRuns: input.runs.slice(0, MAX_DIAGNOSTIC_RUNS).map((run) => ({
      at: safeTimestamp(run.at),
      status: LEDGER_STATUSES.has(run.status) ? run.status : 'failed',
      succeeded: safeCount(run.succeeded),
      failed: safeCount(run.failed),
    })),
  };
}

export function writeDiagnosticBundle(path: string, input: DiagnosticInput): void {
  try {
    const output = `${JSON.stringify(buildDiagnosticBundle(input), null, 2)}\n`;
    writeFileSync(path, output, { encoding: 'utf8', mode: 0o600 });
    // Existing files retain their previous mode on POSIX; force the exported
    // support artifact back to user-only access.
    chmodSync(path, 0o600);
  } catch {
    throw new Error('Postshow could not export the diagnostic bundle');
  }
}
