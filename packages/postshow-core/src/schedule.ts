// Work-plan scheduling. Two cadence forms coexist: legacy cron strings for
// the daily/weekly presets, and plain interval minutes for agent-proposed
// jobs (bounded, no grammar for an agent or a human to get wrong).

export const MIN_INTERVAL_MINUTES = 30;
export const MAX_INTERVAL_MINUTES = 43200; // 30 days

/** A minute of slack so a job a few seconds shy of due at one dispatcher
 * tick doesn't slip a whole cycle on timestamp jitter. */
export const DUE_GRACE_MS = 60_000;

/** Minimal cron "next" for the forms Postshow writes: `m h * * *` (daily) and
 * `m h * * dow` (weekly). Anything unparseable re-runs in 24h. */
export function nextCronDate(cron: string | null, from: Date): Date {
  const fallback = new Date(from.getTime() + 24 * 3600_000);
  if (!cron) return fallback;
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return fallback;
  const minute = Number(parts[0]);
  const hour = Number(parts[1]);
  const dow = parts[4] === '*' ? null : Number(parts[4]);
  if (!Number.isFinite(minute) || !Number.isFinite(hour)) return fallback;
  if (dow !== null && !Number.isFinite(dow)) return fallback;
  const next = new Date(from);
  next.setUTCHours(hour, minute, 0, 0);
  while (next <= from || (dow !== null && next.getUTCDay() !== dow)) {
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(hour, minute, 0, 0);
  }
  return next;
}

export function clampIntervalMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return 1440;
  return Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, Math.round(minutes)));
}

export interface Schedulable {
  schedule_cron: string | null;
  interval_minutes: number | null;
}

/** When this job should next run after finishing at `from`. Interval wins
 * when both are set (an agent edit supersedes the legacy preset). */
export function nextDueDate(job: Schedulable, from: Date): Date {
  if (job.interval_minutes) {
    return new Date(from.getTime() + clampIntervalMinutes(job.interval_minutes) * 60_000);
  }
  return nextCronDate(job.schedule_cron, from);
}

/** Due check with grace, treating never-run jobs as due now. */
export function isDue(nextDueAt: string | null, now: Date): boolean {
  if (!nextDueAt) return true;
  return new Date(nextDueAt).getTime() <= now.getTime() + DUE_GRACE_MS;
}

export function describeCadence(job: Schedulable): string {
  if (job.interval_minutes) {
    const minutes = clampIntervalMinutes(job.interval_minutes);
    if (minutes % 1440 === 0) {
      const days = minutes / 1440;
      return days === 1 ? 'daily' : `every ${days} days`;
    }
    if (minutes % 60 === 0) {
      const hours = minutes / 60;
      return hours === 1 ? 'hourly' : `every ${hours} hours`;
    }
    return `every ${minutes} min`;
  }
  return job.schedule_cron ? `cron ${job.schedule_cron}` : 'manual';
}
