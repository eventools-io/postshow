// The background scheduler. Due-ness lives server-side in persisted
// next-due timestamps, so catch-up after sleep is inherent: every tick just
// asks "what is due now?" and runs it. A small local ledger (node:sqlite  -
// no native module rebuilds) records what ran on this machine for the tray.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { configDir, loadConfig, runOnce } from 'postshow/lib';

export interface LedgerEntry {
  at: string;
  ok: boolean;
  detail: string;
}

export class LocalScheduler {
  private db: DatabaseSync;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly intervalMinutes = 15) {
    mkdirSync(configDir(), { recursive: true });
    this.db = new DatabaseSync(join(configDir(), 'desktop.db'));
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS run_ledger (at TEXT NOT NULL, ok INTEGER NOT NULL, detail TEXT NOT NULL)'
    );
  }

  get configured(): boolean {
    return Boolean(loadConfig().token);
  }

  lastRuns(limit = 5): LedgerEntry[] {
    const rows = this.db
      .prepare('SELECT at, ok, detail FROM run_ledger ORDER BY at DESC LIMIT ?')
      .all(limit) as { at: string; ok: number; detail: string }[];
    return rows.map((row) => ({ at: row.at, ok: row.ok === 1, detail: row.detail }));
  }

  /** One tick: run whatever is due. Never throws; the tray shows outcomes. */
  async tick(): Promise<LedgerEntry> {
    if (this.running) return { at: new Date().toISOString(), ok: true, detail: 'already running' };
    this.running = true;
    const at = new Date().toISOString();
    let entry: LedgerEntry;
    try {
      if (!this.configured) {
        entry = { at, ok: false, detail: 'not configured; run postshow init' };
      } else {
        const code = await runOnce();
        entry = { at, ok: code === 0, detail: code === 0 ? 'checked due jobs' : 'run failed' };
      }
    } catch (error) {
      entry = { at, ok: false, detail: error instanceof Error ? error.message : 'tick failed' };
    } finally {
      this.running = false;
    }
    this.db
      .prepare('INSERT INTO run_ledger (at, ok, detail) VALUES (?, ?, ?)')
      .run(entry.at, entry.ok ? 1 : 0, entry.detail);
    this.db.exec(
      'DELETE FROM run_ledger WHERE at NOT IN (SELECT at FROM run_ledger ORDER BY at DESC LIMIT 200)'
    );
    return entry;
  }

  start(onTick?: (entry: LedgerEntry) => void): void {
    const fire = () => {
      void this.tick().then((entry) => onTick?.(entry));
    };
    // Immediate catch-up on launch/wake, then the heartbeat.
    fire();
    this.timer = setInterval(fire, this.intervalMinutes * 60_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
