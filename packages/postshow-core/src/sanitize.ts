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

export function sanitizeModelOutput(output: ModelOutput): CleanOutput {
  const fieldNotes: CleanFieldNote[] = [];
  for (const note of (output.field_notes ?? []).slice(0, OUTPUT_LIMITS.fieldNotes)) {
    if (!note.title || !note.fingerprint) continue;
    fieldNotes.push({
      title: note.title.slice(0, 200),
      detail: (note.detail ?? '').slice(0, 2000),
      sessions: Math.max(0, Math.round(note.sessions ?? 0)),
      severity: SEVERITIES.has(note.severity ?? '') ? (note.severity as string) : 'medium',
      fingerprint: note.fingerprint.slice(0, 120),
    });
  }

  const inboxItems: CleanInboxItem[] = [];
  for (const item of (output.inbox_items ?? []).slice(0, OUTPUT_LIMITS.inboxItems)) {
    if (!item.title) continue;
    const actionType = ACTION_TYPES.has(item.action_type ?? '')
      ? (item.action_type as string)
      : 'none';
    inboxItems.push({
      kind: INBOX_KINDS.has(item.kind ?? '') ? (item.kind as string) : 'other',
      meta: (item.meta ?? '').slice(0, 200),
      title: item.title.slice(0, 300),
      body: (item.body ?? '').slice(0, 10000),
      evidence: (item.evidence ?? '').slice(0, 500),
      action_label: actionLabel(actionType),
      action_type: actionType,
      action_config:
        item.action_config && typeof item.action_config === 'object' ? item.action_config : {},
      account_name: (item.account_name ?? '').slice(0, 200),
      fingerprint: (item.fingerprint ?? '').slice(0, 120),
    });
  }

  const accountUpdates: CleanAccountUpdate[] = [];
  for (const update of (output.account_updates ?? []).slice(0, OUTPUT_LIMITS.accountUpdates)) {
    if (!update.name) continue;
    const score = Number(update.health_score);
    accountUpdates.push({
      name: update.name.slice(0, 200),
      status: (update.status ?? 'active').slice(0, 60),
      status_tone: STATUS_TONES.has(update.status_tone ?? '')
        ? (update.status_tone as string)
        : 'good',
      facts: (update.facts ?? []).filter((f) => typeof f === 'string').slice(0, 8),
      next_move: (update.next_move ?? '').slice(0, 500),
      health_score: Number.isFinite(score) ? Math.min(100, Math.max(0, Math.round(score))) : null,
    });
  }

  let proposedJob: CleanProposedJob | null = null;
  const rawJob = output.proposed_job;
  if (rawJob?.label) {
    const minutes = Number(rawJob.interval_minutes);
    if (
      Number.isFinite(minutes) &&
      minutes >= MIN_INTERVAL_MINUTES &&
      minutes <= MAX_INTERVAL_MINUTES
    ) {
      proposedJob = {
        label: rawJob.label.slice(0, 200),
        reason: (rawJob.reason ?? '').slice(0, 500),
        interval_minutes: clampIntervalMinutes(minutes),
        schedule_label: (rawJob.schedule_label ?? 'proposed').slice(0, 100),
      };
    }
  }

  const proposedRule =
    typeof output.proposed_rule === 'string' && output.proposed_rule.trim()
      ? output.proposed_rule.trim().slice(0, OUTPUT_LIMITS.ruleChars)
      : null;

  const scratchpadUpdates: CleanScratchpadEntry[] = [];
  for (const entry of (output.scratchpad_updates ?? []).slice(0, OUTPUT_LIMITS.scratchpadUpdates)) {
    if (!entry.key || !entry.content) continue;
    const key = entry.key.trim().toLowerCase();
    if (!SCRATCHPAD_KEY.test(key)) continue;
    scratchpadUpdates.push({ key, content: entry.content.slice(0, 600) });
  }

  return {
    summary: (output.summary ?? '').slice(0, OUTPUT_LIMITS.summaryChars) || 'Run complete.',
    fieldNotes,
    inboxItems,
    accountUpdates,
    proposedJob,
    proposedRule,
    scratchpadUpdates,
  };
}
