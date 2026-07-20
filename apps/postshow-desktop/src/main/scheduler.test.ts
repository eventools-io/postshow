import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  it('records an unconfigured tick in the ledger instead of throwing', async () => {
    const scheduler = new LocalScheduler(15);
    const entry = await scheduler.tick();
    expect(entry.ok).toBe(false);
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
});
