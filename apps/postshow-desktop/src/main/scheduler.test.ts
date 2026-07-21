import { chmodSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunSummary } from 'postshow/lib';
import { LocalScheduler } from './scheduler';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'postshow-desktop-'));
  process.env.POSTSHOW_CONFIG_DIR = dir;
  delete process.env.POSTSHOW_TOKEN;
});

afterEach(() => {
  delete process.env.POSTSHOW_CONFIG_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('LocalScheduler', () => {
  it('repairs private config and ledger permissions without persistent WAL sidecars', async () => {
    chmodSync(dir, 0o755);
    const scheduler = new LocalScheduler(15);

    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, 'desktop.db')).mode & 0o777).toBe(0o600);
    expect(existsSync(join(dir, 'desktop.db-wal'))).toBe(false);
    expect(existsSync(join(dir, 'desktop.db-shm'))).toBe(false);
    await scheduler.dispose();
  });

  it('records an unconfigured tick in the ledger instead of throwing', async () => {
    const scheduler = new LocalScheduler(15);
    const entry = await scheduler.tick();
    expect(entry.status).toBe('unconfigured');
    expect(entry.detail).toContain('not configured');
    const runs = scheduler.lastRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.detail).toContain('not configured');
  });

  it('caps the ledger and returns newest first', async () => {
    const scheduler = new LocalScheduler(15);
    await scheduler.tick();
    await scheduler.tick();
    const runs = scheduler.lastRuns(1);
    expect(runs).toHaveLength(1);
  });

  it('records partial and idle summaries without flattening them to success/failure', async () => {
    process.env.POSTSHOW_TOKEN = 'psh_test';
    const summaries: RunSummary[] = [
      {
        status: 'partial',
        exitCode: 1,
        succeeded: 1,
        failed: 1,
        uncertain: 0,
        jobs: [
          {
            jobId: 'one',
            runId: 'run-one',
            label: 'One',
            status: 'failed',
            phase: 'model',
            detail: 'model unavailable',
            failureReported: true,
          },
          {
            jobId: 'two',
            runId: 'run-two',
            label: 'Two',
            status: 'succeeded',
            phase: 'complete',
            detail: 'synced',
            failureReported: false,
          },
        ],
      },
      { status: 'idle', exitCode: 0, succeeded: 0, failed: 0, uncertain: 0, jobs: [] },
    ];
    const scheduler = new LocalScheduler(15, async () => summaries.shift()!);

    const partial = await scheduler.tick();
    const idle = await scheduler.tick();

    expect(partial).toMatchObject({ status: 'partial', succeeded: 1, failed: 1 });
    expect(partial.detail).toContain('at model');
    expect(idle).toMatchObject({ status: 'idle', succeeded: 0, failed: 0 });
    expect(scheduler.lastRuns(2).map((entry) => entry.status)).toEqual(['idle', 'partial']);
  });

  it('preserves an unconfirmed claim outcome as uncertain rather than failed', async () => {
    process.env.POSTSHOW_TOKEN = 'psh_test';
    const scheduler = new LocalScheduler(15, async () => ({
      status: 'uncertain',
      exitCode: 1,
      succeeded: 0,
      failed: 0,
      uncertain: 1,
      jobs: [
        {
          jobId: 'one',
          runId: 'run-one',
          label: 'One',
          status: 'uncertain',
          phase: 'submit',
          detail: 'commit confirmation unavailable',
          failureReported: false,
        },
      ],
    }));

    const entry = await scheduler.tick();

    expect(entry).toMatchObject({ status: 'uncertain', succeeded: 0, failed: 0 });
    expect(entry.detail).toContain('live claim will recover');
    expect(scheduler.lastRuns(1)[0]?.status).toBe('uncertain');
  });

  it('returns and records busy as neutral state while a tick is already running', async () => {
    process.env.POSTSHOW_TOKEN = 'psh_test';
    let finish: ((summary: RunSummary) => void) | undefined;
    const pending = new Promise<RunSummary>((resolve) => {
      finish = resolve;
    });
    const scheduler = new LocalScheduler(15, async () => pending);

    const first = scheduler.tick();
    await Promise.resolve();
    const busy = await scheduler.tick();
    expect(busy).toMatchObject({ status: 'busy', succeeded: 0, failed: 0 });

    finish?.({
      status: 'succeeded',
      exitCode: 0,
      succeeded: 1,
      failed: 0,
      uncertain: 0,
      jobs: [],
    });
    await first;
    expect(scheduler.lastRuns(2).map((entry) => entry.status)).toContain('busy');
  });

  it('disposes idempotently and waits for an in-flight tick before closing its database', async () => {
    process.env.POSTSHOW_TOKEN = 'psh_test';
    let finish: ((summary: RunSummary) => void) | undefined;
    const pending = new Promise<RunSummary>((resolve) => {
      finish = resolve;
    });
    const scheduler = new LocalScheduler(15, async () => pending);

    const inFlight = scheduler.tick();
    await Promise.resolve();
    let drained = false;
    const firstDisposal = scheduler.dispose().then(() => {
      drained = true;
    });
    const secondDisposal = scheduler.dispose();
    await Promise.resolve();
    expect(drained).toBe(false);

    finish?.({
      status: 'succeeded',
      exitCode: 0,
      succeeded: 1,
      failed: 0,
      uncertain: 0,
      jobs: [],
    });
    await expect(inFlight).resolves.toMatchObject({ status: 'succeeded' });
    await Promise.all([firstDisposal, secondDisposal]);
    expect(drained).toBe(true);
    const reopened = new LocalScheduler(15);
    expect(reopened.lastRuns(1)).toMatchObject([{ status: 'succeeded' }]);
    await reopened.dispose();
    await expect(scheduler.tick()).resolves.toMatchObject({
      status: 'failed',
      detail: 'scheduler disposed',
    });
    expect(scheduler.lastRuns()).toEqual([]);
    expect(() => scheduler.start()).toThrow('scheduler disposed');
  });

  it('pauses future heartbeats, drains an active run, and remains resumable', async () => {
    process.env.POSTSHOW_TOKEN = 'psh_test';
    let finish: ((summary: RunSummary) => void) | undefined;
    const pending = new Promise<RunSummary>((resolve) => {
      finish = resolve;
    });
    const scheduler = new LocalScheduler(15, async () => pending);
    const inFlight = scheduler.tick();
    await Promise.resolve();

    let drained = false;
    const drain = scheduler.pauseAndDrain().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);

    finish?.({
      status: 'succeeded',
      exitCode: 0,
      succeeded: 1,
      failed: 0,
      uncertain: 0,
      jobs: [],
    });
    await inFlight;
    await drain;
    expect(drained).toBe(true);
    expect(() => scheduler.start()).not.toThrow();
    await scheduler.dispose();
  });

  it('reports ledger write failures without rejecting a tick', async () => {
    const scheduler = new LocalScheduler(15);
    const database = (scheduler as unknown as { db: { close: () => void } }).db;
    database.close();

    await expect(scheduler.tick()).resolves.toMatchObject({
      status: 'unconfigured',
      detail: expect.stringContaining('local ledger unavailable'),
    });
    expect(scheduler.lastRuns()).toEqual([]);
    await expect(scheduler.dispose()).resolves.toBeUndefined();
  });
});
