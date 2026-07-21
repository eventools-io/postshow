// Normalizes raw model output into clamped, enum-checked rows every runtime
// (edge, CLI, desktop) persists identically. The model is untrusted: lengths
// are clamped, enums are whitelisted, counts are capped.

import {
  ACTION_TYPES,
  INBOX_KINDS,
  type ModelOutput,
  OUTPUT_LIMITS,
  SEVERITIES,
  STATUS_TONES,
} from './prompts';
import { MAX_INTERVAL_MINUTES, MIN_INTERVAL_MINUTES, clampIntervalMinutes } from './schedule';

export interface CleanFieldNote {
  title: string;
  detail: string;
  sessions: number;
  severity: string;
  fingerprint: string;
}

export interface CleanInboxItem {
  kind: string;
  meta: string;
  title: string;
  body: string;
  evidence: string;
  action_label: string;
  action_type: string;
  action_config: Record<string, unknown>;
  account_name: string;
  fingerprint: string;
}

export interface CleanAccountUpdate {
  name: string;
  status: string;
  status_tone: string;
  facts: string[];
  next_move: string;
  health_score: number | null;
}

export interface CleanProposedJob {
  label: string;
  reason: string;
  interval_minutes: number;
  schedule_label: string;
}

export interface CleanScratchpadEntry {
  key: string;
  content: string;
}

export interface CleanOutput {
  summary: string;
  fieldNotes: CleanFieldNote[];
  inboxItems: CleanInboxItem[];
  accountUpdates: CleanAccountUpdate[];
  proposedJob: CleanProposedJob | null;
  proposedRule: string | null;
  scratchpadUpdates: CleanScratchpadEntry[];
}

function actionLabel(actionType: string): string {
  if (actionType === 'email') return 'Approve and send';
  if (actionType === 'github_issue' || actionType === 'linear_issue') return 'File ticket';
  return 'Mark done';
}

const SCRATCHPAD_KEY = /^(pattern|noise|addressed|dedupe)-[a-z0-9-]{1,80}$/;

/** The model may put anything in any field: a string where we expect one, but
 * also numbers, objects, or arrays. Coerce scalars, drop the rest. */
function str(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function sanitizeModelOutput(output: ModelOutput): CleanOutput {
  const fieldNotes: CleanFieldNote[] = [];
  for (const raw of arr(output.field_notes).slice(0, OUTPUT_LIMITS.fieldNotes)) {
    const note = (raw ?? {}) as NonNullable<ModelOutput['field_notes']>[number];
    const title = str(note.title);
    const fingerprint = str(note.fingerprint);
    if (!title || !fingerprint) continue;
    const sessions = Number(note.sessions ?? 0);
    const severity = str(note.severity);
    fieldNotes.push({
      title: title.slice(0, 200),
      detail: str(note.detail).slice(0, 2000),
      sessions: Number.isFinite(sessions) ? Math.max(0, Math.round(sessions)) : 0,
      severity: SEVERITIES.has(severity) ? severity : 'medium',
      fingerprint: fingerprint.slice(0, 120),
    });
  }

  const inboxItems: CleanInboxItem[] = [];
  for (const raw of arr(output.inbox_items).slice(0, OUTPUT_LIMITS.inboxItems)) {
    const item = (raw ?? {}) as NonNullable<ModelOutput['inbox_items']>[number];
    const title = str(item.title);
    if (!title) continue;
    const kind = str(item.kind);
    const rawAction = str(item.action_type);
    const actionType = ACTION_TYPES.has(rawAction) ? rawAction : 'none';
    inboxItems.push({
      kind: INBOX_KINDS.has(kind) ? kind : 'other',
      meta: str(item.meta).slice(0, 200),
      title: title.slice(0, 300),
      body: str(item.body).slice(0, 10000),
      evidence: str(item.evidence).slice(0, 500),
      action_label: actionLabel(actionType),
      action_type: actionType,
      action_config:
        item.action_config && typeof item.action_config === 'object' ? item.action_config : {},
      account_name: str(item.account_name).slice(0, 200),
      fingerprint: str(item.fingerprint).slice(0, 120),
    });
  }

  const accountUpdates: CleanAccountUpdate[] = [];
  for (const raw of arr(output.account_updates).slice(0, OUTPUT_LIMITS.accountUpdates)) {
    const update = (raw ?? {}) as NonNullable<ModelOutput['account_updates']>[number];
    const name = str(update.name);
    if (!name) continue;
    const tone = str(update.status_tone);
    const score = Number(update.health_score);
    accountUpdates.push({
      name: name.slice(0, 200),
      status: (str(update.status) || 'active').slice(0, 60),
      status_tone: STATUS_TONES.has(tone) ? tone : 'good',
      facts: arr(update.facts)
        .filter((f): f is string => typeof f === 'string')
        .slice(0, 8),
      next_move: str(update.next_move).slice(0, 500),
      health_score: Number.isFinite(score) ? Math.min(100, Math.max(0, Math.round(score))) : null,
    });
  }

  let proposedJob: CleanProposedJob | null = null;
  const rawJob = output.proposed_job;
  const jobLabel = rawJob && typeof rawJob === 'object' ? str(rawJob.label) : '';
  if (rawJob && jobLabel) {
    const minutes = Number(rawJob.interval_minutes);
    if (
      Number.isFinite(minutes) &&
      minutes >= MIN_INTERVAL_MINUTES &&
      minutes <= MAX_INTERVAL_MINUTES
    ) {
      proposedJob = {
        label: jobLabel.slice(0, 200),
        reason: str(rawJob.reason).slice(0, 500),
        interval_minutes: clampIntervalMinutes(minutes),
        schedule_label: (str(rawJob.schedule_label) || 'proposed').slice(0, 100),
      };
    }
  }

  const proposedRule =
    typeof output.proposed_rule === 'string' && output.proposed_rule.trim()
      ? output.proposed_rule.trim().slice(0, OUTPUT_LIMITS.ruleChars)
      : null;

  const scratchpadUpdates: CleanScratchpadEntry[] = [];
  for (const raw of arr(output.scratchpad_updates).slice(0, OUTPUT_LIMITS.scratchpadUpdates)) {
    const entry = (raw ?? {}) as NonNullable<ModelOutput['scratchpad_updates']>[number];
    const key = str(entry.key).trim().toLowerCase();
    const content = str(entry.content);
    if (!key || !content || !SCRATCHPAD_KEY.test(key)) continue;
    scratchpadUpdates.push({ key, content: content.slice(0, 600) });
  }

  return {
    summary: str(output.summary).slice(0, OUTPUT_LIMITS.summaryChars) || 'Run complete.',
    fieldNotes,
    inboxItems,
    accountUpdates,
    proposedJob,
    proposedRule,
    scratchpadUpdates,
  };
}
