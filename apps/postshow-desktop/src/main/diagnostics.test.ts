import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDiagnosticBundle, writeDiagnosticBundle, type DiagnosticInput } from './diagnostics';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function input(): DiagnosticInput {
  return {
    generatedAt: '2026-07-21T08:00:00.000Z',
    appVersion: '1.2.3',
    electronVersion: '43.1.1',
    nodeVersion: '22.22.0',
    platform: 'darwin',
    arch: 'arm64',
    osRelease: '25.5.0',
    config: {
      configured: true,
      invalid: false,
      engineMode: 'byok',
      engineProvider: 'anthropic',
      connectorCount: 2,
      verifiedConnectorCount: 1,
      localOnlyConnectorCount: 2,
    },
    updater: {
      state: 'error',
      currentVersion: '1.2.3',
      message: 'must-not-be-copied',
      canCheck: false,
      canRetry: true,
      canInstall: false,
    },
    runs: [
      {
        at: '2026-07-21T07:00:00.000Z',
        status: 'failed',
        detail:
          'psh_secret sk-ant-secret jane@example.com /Users/jane/project https://secret.example',
        succeeded: 1,
        failed: 1,
      },
    ],
  };
}

describe('diagnostic bundle', () => {
  it('contains only allowlisted operational fields and never free-form details', () => {
    const json = JSON.stringify(buildDiagnosticBundle(input()));
    expect(json).toContain('Allowlisted operational metadata');
    expect(json).toContain('"engineProvider":"anthropic"');
    for (const privateValue of [
      'must-not-be-copied',
      'psh_secret',
      'sk-ant-secret',
      'jane@example.com',
      '/Users/jane',
      'secret.example',
    ]) {
      expect(json).not.toContain(privateValue);
    }
  });

  it('bounds arrays, numbers, versions, and unsupported values', () => {
    const value = input();
    value.appVersion = '1.2.3 secret@example.com';
    value.arch = 'mips-secret';
    value.config.connectorCount = Number.MAX_SAFE_INTEGER;
    value.runs = Array.from({ length: 100 }, (_, index) => ({
      at: 'invalid timestamp',
      status: 'failed' as const,
      detail: `secret-${index}`,
      succeeded: -1,
      failed: 100_000,
    }));
    const bundle = buildDiagnosticBundle(value);

    expect(bundle.app.version).toBe('unknown');
    expect(bundle.app.arch).toBe('unknown');
    expect(bundle.config.connectorCount).toBe(10_000);
    expect(bundle.recentRuns).toHaveLength(20);
    expect(bundle.recentRuns[0]).toMatchObject({
      at: 'unknown',
      succeeded: 0,
      failed: 10_000,
    });
  });

  it('exports inspectable JSON with user-only POSIX permissions', () => {
    const directory = mkdtempSync(join(tmpdir(), 'postshow-diagnostics-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'diagnostics.json');
    writeDiagnosticBundle(path, input());

    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ schemaVersion: 1 });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('reports export failures without reflecting a path or source error', () => {
    const directory = mkdtempSync(join(tmpdir(), 'postshow-diagnostics-failure-'));
    temporaryDirectories.push(directory);
    const secretPath = join(directory, 'missing-directory', 'psh_must_not_leak.json');
    let caught: unknown;
    try {
      writeDiagnosticBundle(secretPath, input());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('Postshow could not export the diagnostic bundle');
    expect((caught as Error).message).not.toContain('psh_must_not_leak');
  });
});
