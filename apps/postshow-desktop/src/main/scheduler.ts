// The background scheduler. Due-ness lives server-side in persisted
// next-due timestamps, so catch-up after sleep is inherent: every tick just
// asks "what is due now?" and runs it. A small local ledger (node:sqlite  -
// no native module rebuilds) records what ran on this machine for the tray.

import { chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { configDir, loadConfig, runOnceDetailed, type RunSummary } from 'postshow/lib';

export type LedgerStatus =
  | 'idle'
  | 'succeeded'
  | 'partial'
  | 'failed'
  | 'uncertain'
  | 'busy'
  | 'unconfigured';

export interface LedgerEntry {
  at: string;
  status: LedgerStatus;
  detail: string;
  succeeded: number;
  failed: number;
}

type RunDetailed = () => Promise<RunSummary>;

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown local error';
}

const LEDGER_STATUSES = new Set<LedgerStatus>([
  'idle',
  'succeeded',
  'partial',
  'failed',
  'uncertain',
  'busy',
  'unconfigured',
]);

function entryFromSummary(at: string, summary: RunSummary): LedgerEntry {
  if (summary.status === 'idle') {
    return { at, status: 'idle', detail: 'nothing due', succeeded: 0, failed: 0 };
  }
  if (summary.status === 'succeeded') {
    return {
      at,
      status: 'succeeded',
      detail: `${summary.succeeded} job(s) succeeded`,
      succeeded: summary.succeeded,
      failed: 0,
    };
  }
  const firstFailure = summary.jobs.find((job) => job.status === 'failed');
  const firstUncertain = summary.jobs.find((job) => job.status === 'uncertain');
  const detail = summary.error?.detail
    ? summary.error.detail
    : firstUncertain
      ? `${summary.uncertain} job outcome(s) uncertain at ${firstUncertain.phase}; live claim will recover`
      : `${summary.failed} job(s) failed${firstFailure ? ` at ${firstFailure.phase}` : ''}`;
  return {
    at,
    status: summary.status,
    detail,
    succeeded: summary.succeeded,
    failed: summary.failed,
  };
}

export class LocalScheduler {
  private db: DatabaseSync;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private disposed = false;
  private databaseClosed = false;
  private idleWaiters = new Set<() => void>();

  constructor(
    private readonly intervalMinutes = 15,
    private readonly runDetailed: RunDetailed = () => runOnceDetailed(undefined, 'desktop')
  ) {
    const directory = configDir();
    const databasePath = join(directory, 'desktop.db');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    // Repair directories created by older desktop builds or a permissive umask.
    // The ledger can contain operational failure detail, so private traversal is
    // required even if a transient SQLite journal inherits broader file bits.
    chmodSync(directory, 0o700);
    this.db = new DatabaseSync(databasePath);
    chmodSync(databasePath, 0o600);
    // Keep rollback journals inside the private directory and avoid persistent
    // WAL/SHM sidecars that would need their own lifecycle and permission repair.
    this.db.exec('PRAGMA journal_mode = DELETE; PRAGMA temp_store = MEMORY');
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS run_ledger (at TEXT NOT NULL, ok INTEGER NOT NULL, detail TEXT NOT NULL, status TEXT, succeeded INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0)'
    );
    const columns = this.db.prepare('PRAGMA table_info(run_ledger)').all() as { name: string }[];
    const names = new Set(columns.map((column) => column.name));
    if (!names.has('status')) this.db.exec('ALTER TABLE run_ledger ADD COLUMN status TEXT');
    if (!names.has('succeeded')) {
      this.db.exec('ALTER TABLE run_ledger ADD COLUMN succeeded INTEGER NOT NULL DEFAULT 0');
    }
    if (!names.has('failed')) {
      this.db.exec('ALTER TABLE run_ledger ADD COLUMN failed INTEGER NOT NULL DEFAULT 0');
    }
  }

  get configured(): boolean {
    return Boolean(loadConfig().token);
  }

  get isRunning(): boolean {
    return this.running;
  }

  lastRuns(limit = 5): LedgerEntry[] {
    if (this.databaseClosed) return [];
    try {
      const rows = this.db
        .prepare(
          'SELECT at, ok, detail, status, succeeded, failed FROM run_ledger ORDER BY at DESC, rowid DESC LIMIT ?'
        )
        .all(limit) as {
        at: string;
        ok: number;
        detail: string;
        status: string | null;
        succeeded: number;
        failed: number;
      }[];
      return rows.map((row) => ({
        at: row.at,
        status:
          row.status && LEDGER_STATUSES.has(row.status as LedgerStatus)
            ? (row.status as LedgerStatus)
            : row.ok === 1
              ? 'succeeded'
              : 'failed',
        detail: row.detail,
        succeeded: row.succeeded,
        failed: row.failed,
      }));
    } catch {
      return [];
    }
  }

  private record(entry: LedgerEntry, allowDuringDisposal = false): LedgerEntry {
    if (this.databaseClosed || (this.disposed && !allowDuringDisposal)) return entry;
    // Older builds only understand `ok`; preserve their prior neutral treatment
    // of an overlap while the richer status column identifies it as `busy`.
    const legacyOk =
      entry.status === 'idle' || entry.status === 'succeeded' || entry.status === 'busy' ? 1 : 0;
    try {
      this.db
        .prepare(
          'INSERT INTO run_ledger (at, ok, detail, status, succeeded, failed) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(entry.at, legacyOk, entry.detail, entry.status, entry.succeeded, entry.failed);
      this.db.exec(
        'DELETE FROM run_ledger WHERE rowid NOT IN (SELECT rowid FROM run_ledger ORDER BY at DESC, rowid DESC LIMIT 200)'
      );
      return entry;
    } catch (error) {
      return {
        ...entry,
        detail: `${entry.detail}; local ledger unavailable: ${errorDetail(error)}`,
      };
    }
  }

  /** One tick: run whatever is due. Never throws; the tray shows outcomes. */
  async tick(): Promise<LedgerEntry> {
    if (this.disposed) {
      return {
        at: new Date().toISOString(),
        status: 'failed',
        detail: 'scheduler disposed',
        succeeded: 0,
        failed: 0,
      };
    }
    if (this.running) {
      return this.record({
        at: new Date().toISOString(),
        status: 'busy',
        detail: 'already running',
        succeeded: 0,
        failed: 0,
      });
    }
    this.running = true;
    const at = new Date().toISOString();
    let entry: LedgerEntry;
    try {
      if (!this.configured) {
        entry = {
          at,
          status: 'unconfigured',
          detail: 'not configured; run postshow init',
          succeeded: 0,
          failed: 0,
        };
      } else {
        entry = entryFromSummary(at, await this.runDetailed());
      }
    } catch (error) {
      entry = {
        at,
        status: 'failed',
        detail: errorDetail(error),
        succeeded: 0,
        failed: 0,
      };
    }
    this.running = false;
    // A quit that began during this run still needs an auditable local outcome.
    const recorded = this.record(entry, true);
    if (this.disposed) this.closeDatabase();
    this.resolveIdleWaiters();
    return recorded;
  }

  start(onTick?: (entry: LedgerEntry) => void): void {
    if (this.disposed) throw new Error('scheduler disposed');
    if (this.timer) return;
    const fire = () => {
      void this.tick().then(
        (entry) => this.notify(onTick, entry),
        (error) =>
          this.notify(onTick, {
            at: new Date().toISOString(),
            status: 'failed',
            detail: errorDetail(error),
            succeeded: 0,
            failed: 0,
          })
      );
    };
    // Immediate catch-up on launch/wake, then the heartbeat.
    fire();
    this.timer = setInterval(fire, this.intervalMinutes * 60_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Pause future heartbeats and wait for the current run without permanently
   * disposing the scheduler. An updater can resume it if installer handoff
   * fails after the drain. */
  pauseAndDrain(): Promise<void> {
    this.stop();
    if (!this.running) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.add(resolve));
  }

  dispose(): Promise<void> {
    if (!this.disposed) {
      this.disposed = true;
      this.stop();
      if (!this.running) this.closeDatabase();
    }
    if (!this.running) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.add(resolve));
  }

  private closeDatabase(): void {
    if (this.databaseClosed) return;
    try {
      this.db.close();
    } catch {
      // Shutdown must continue even if SQLite cannot finalize a damaged handle.
    } finally {
      this.databaseClosed = true;
    }
  }

  private resolveIdleWaiters(): void {
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }

  private notify(onTick: ((entry: LedgerEntry) => void) | undefined, entry: LedgerEntry): void {
    try {
      onTick?.(entry);
    } catch {
      // A presentation callback must never become an unhandled timer rejection.
    }
  }
}
