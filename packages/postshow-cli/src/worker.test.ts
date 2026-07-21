import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireWorkerLock, localWorkerId, WorkerBusyError } from './worker';

const originalConfigDir = process.env.POSTSHOW_CONFIG_DIR;
const directories: string[] = [];

function temporaryConfigDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'postshow-worker-'));
  directories.push(directory);
  process.env.POSTSHOW_CONFIG_DIR = directory;
  return directory;
}

afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.POSTSHOW_CONFIG_DIR;
  else process.env.POSTSHOW_CONFIG_DIR = originalConfigDir;
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('local worker identity', () => {
  it('is stable per installation and distinct per execution surface', () => {
    temporaryConfigDir();

    const cli = localWorkerId('cli');
    expect(localWorkerId('cli')).toBe(cli);
    expect(localWorkerId('mcp')).not.toBe(cli);
    expect(cli).toMatch(/^postshow-cli:[0-9a-f-]{36}$/i);
    if (process.platform !== 'win32') {
      expect(statSync(join(process.env.POSTSHOW_CONFIG_DIR!, 'worker-cli.id')).mode & 0o777).toBe(
        0o600
      );
    }
  });

  it('keeps an old lock when its owning PID is still live', () => {
    const directory = temporaryConfigDir();
    const path = join(directory, '.worker-watch.lock');
    const token = `${process.pid}:00000000-0000-4000-8000-000000000001`;
    writeFileSync(path, `${token}\n`, { mode: 0o600 });
    const old = new Date(Date.now() - 48 * 60 * 60_000);
    utimesSync(path, old, old);

    expect(() => acquireWorkerLock('watch')).toThrow(WorkerBusyError);
    expect(readFileSync(path, 'utf8').trim()).toBe(token);
  });

  it('releases only the lock token it acquired', () => {
    const directory = temporaryConfigDir();
    const release = acquireWorkerLock('desktop');
    const path = join(directory, '.worker-desktop.lock');
    expect(readFileSync(path, 'utf8')).toContain(`${process.pid}:`);

    release();
    expect(() => readFileSync(path, 'utf8')).toThrow();
    release();
  });

  it('rejects a concurrent process-local owner for the same surface', () => {
    temporaryConfigDir();
    const release = acquireWorkerLock('mcp');

    expect(() => acquireWorkerLock('mcp')).toThrow(WorkerBusyError);
    release();
    const releaseAgain = acquireWorkerLock('mcp');
    releaseAgain();
  });
});
