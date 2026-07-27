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
  session_ids: string[];
  account_identity_keys: string[];
  sentry_issue_ids: string[];
  github_object_refs: string[];
  root_cause_hypothesis: string;
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
  session_ids: string[];
  account_identity_keys: string[];
  sentry_issue_ids: string[];
  github_object_refs: string[];
  fingerprint: string;
  incident_fingerprint: string;
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
const DURABLE_INSTRUCTION =
  /\b(ignore|disregard|override|system prompt|developer message|instructions?|execute|run command|send (?:an )?email|api key|password|secret)\b/i;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stripUnsafeControlCharacters(value: string): string {
  return Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 || code === 9 || code === 10 || code === 13;
    })
    .join('');
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? stripUnsafeControlCharacters(value).slice(0, max) : '';
}

const SESSION_ID = /^[A-Za-z0-9_-]{6,160}$/;

export function canonicalSessionId(value: unknown): string | null {
  return typeof value === 'string' && SESSION_ID.test(value) ? value : null;
}

function sessionIds(value: unknown, allowed: ReadonlySet<string>): string[] {
  const unique = new Set<string>();
  for (const candidate of array(value)) {
    const id = canonicalSessionId(candidate);
    if (!id || !allowed.has(id)) continue;
    unique.add(id);
    if (unique.size >= OUTPUT_LIMITS.sessionIds) break;
  }
  return [...unique];
}

// Sentry issue ids are numeric strings. Short ids, permalinks, and anything the
// model composed itself are not references and never become one.
const SENTRY_ISSUE_ID = /^[0-9]{1,32}$/;

export function canonicalSentryIssueId(value: unknown): string | null {
  return typeof value === 'string' && SENTRY_ISSUE_ID.test(value) ? value : null;
}

function sentryIssueIds(value: unknown, allowed: ReadonlySet<string>): string[] {
  const unique = new Set<string>();
  for (const candidate of array(value)) {
    const id = canonicalSentryIssueId(candidate);
    if (!id || !allowed.has(id)) continue;
    unique.add(id);
    if (unique.size >= OUTPUT_LIMITS.sentryIssueIds) break;
  }
  return [...unique];
}

/** The repository object kinds a finding may cite as code context. A repository
 * on its own is deliberately absent: naming the repo the workspace already
 * connected says nothing about any particular incident, so it cannot ground a
 * claim. */
export const GITHUB_OBJECT_TYPES = ['pull_request', 'commit', 'issue'] as const;

export type GithubObjectType = (typeof GITHUB_OBJECT_TYPES)[number];

const GITHUB_REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const GITHUB_COMMIT_SHA = /^[0-9a-f]{40}$/;
const GITHUB_OBJECT_NUMBER = /^[1-9][0-9]{0,19}$/;
const GITHUB_OBJECT_REF = /^(pull_request|commit|issue):([0-9a-zA-Z]{1,40})$/;

/** A full commit sha or an issue/pull number, normalized to the exact string
 * the database stores. An abbreviated sha is not accepted: it is ambiguous
 * within a large repository and cannot be re-resolved later. */
export function canonicalGithubObjectId(type: GithubObjectType, value: unknown): string | null {
  const candidate = typeof value === 'number' ? String(value) : String(value ?? '');
  if (type === 'commit') {
    const sha = candidate.toLowerCase();
    return GITHUB_COMMIT_SHA.test(sha) ? sha : null;
  }
  return GITHUB_OBJECT_NUMBER.test(candidate) ? candidate : null;
}

export function canonicalGithubRepo(value: unknown): string | null {
  const repo = String(value ?? '');
  return GITHUB_REPO.test(repo) ? repo : null;
}

/** A reference is the object kind and the provider identifier together. `#42`
 * is ambiguous across pull requests and issues, so the kind travels with the
 * number. The repository is not part of the reference: it comes from the run's
 * own collection, never from model output. */
export function canonicalGithubObjectRef(value: unknown): string | null {
  const match = GITHUB_OBJECT_REF.exec(typeof value === 'string' ? value : '');
  if (!match) return null;
  const type = match[1] as GithubObjectType;
  const id = canonicalGithubObjectId(type, match[2]);
  return id ? `${type}:${id}` : null;
}

function githubObjectRefs(value: unknown, allowed: ReadonlySet<string>): string[] {
  const unique = new Set<string>();
  for (const candidate of array(value)) {
    const ref = canonicalGithubObjectRef(candidate);
    if (!ref || !allowed.has(ref)) continue;
    unique.add(ref);
    if (unique.size >= OUTPUT_LIMITS.githubObjectRefs) break;
  }
  return [...unique];
}

function groundedAccountIdentityKeys(
  citedSessions: readonly string[],
  accountsBySession: ReadonlyMap<string, string>
): string[] {
  const unique = new Set<string>();
  for (const sessionId of citedSessions) {
    const accountIdentityKey = accountsBySession.get(sessionId);
    if (!accountIdentityKey) continue;
    unique.add(accountIdentityKey);
    if (unique.size >= OUTPUT_LIMITS.accountIdentityKeys) break;
  }
  return [...unique];
}

function actionConfig(actionType: string, value: unknown): Record<string, unknown> {
  const raw = record(value);
  if (actionType === 'email') {
    // The model is deliberately unable to choose the recipient. A human must
    // set it in the approval UI; the server binds that exact revision.
    const subject = text(raw.subject, 200).trim();
    return subject ? { subject } : {};
  }
  // GitHub and Linear destinations are bound to the saved connection, never
  // accepted from model output.
  return {};
}

export function sanitizeModelOutput(
  output: ModelOutput | unknown,
  options: {
    allowedSessionIds: Iterable<string>;
    allowedAccountIdentityKeys: Iterable<string>;
    allowedSentryIssueIds: Iterable<string>;
    allowedGithubObjectRefs?: Iterable<string>;
    sessionAccountIdentityKeys?: Iterable<readonly [string, string]>;
  }
): CleanOutput {
  const rawOutput = record(output);
  const allowedSessionIds = new Set(
    Array.from(options.allowedSessionIds ?? []).flatMap((value) => {
      const id = canonicalSessionId(value);
      return id ? [id] : [];
    })
  );
  const allowedAccountIdentityKeys = new Set(
    Array.from(options.allowedAccountIdentityKeys).filter((value) =>
      /^stripe:[A-Za-z0-9_-]{1,200}$/.test(value)
    )
  );
  const allowedSentryIssueIds = new Set(
    Array.from(options.allowedSentryIssueIds).flatMap((value) => {
      const id = canonicalSentryIssueId(value);
      return id ? [id] : [];
    })
  );
  const allowedGithubObjectRefs = new Set(
    Array.from(options.allowedGithubObjectRefs ?? []).flatMap((value) => {
      const ref = canonicalGithubObjectRef(value);
      return ref ? [ref] : [];
    })
  );
  const accountsBySession = new Map<string, string>();
  for (const [rawSessionId, rawAccountIdentityKey] of options.sessionAccountIdentityKeys ?? []) {
    const sessionId = canonicalSessionId(rawSessionId);
    if (
      sessionId &&
      allowedSessionIds.has(sessionId) &&
      allowedAccountIdentityKeys.has(rawAccountIdentityKey)
    ) {
      accountsBySession.set(sessionId, rawAccountIdentityKey);
    }
  }
  const fieldNotes: CleanFieldNote[] = [];
  for (const value of array(rawOutput.field_notes).slice(0, OUTPUT_LIMITS.fieldNotes)) {
    const note = record(value);
    const title = text(note.title, 200);
    const fingerprint = text(note.fingerprint, 120);
    if (!title || !fingerprint) continue;
    const sessions = Number(note.sessions ?? 0);
    const groundedSessionIds = sessionIds(note.session_ids, allowedSessionIds);
    fieldNotes.push({
      title,
      detail: text(note.detail, 2000),
      sessions: Number.isFinite(sessions)
        ? Math.min(1_000_000_000, Math.max(0, Math.round(sessions)))
        : 0,
      session_ids: groundedSessionIds,
      account_identity_keys: groundedAccountIdentityKeys(groundedSessionIds, accountsBySession),
      sentry_issue_ids: sentryIssueIds(note.sentry_issue_ids, allowedSentryIssueIds),
      github_object_refs: githubObjectRefs(note.github_object_refs, allowedGithubObjectRefs),
      root_cause_hypothesis: text(note.root_cause_hypothesis, 1000),
      severity: SEVERITIES.has(String(note.severity ?? '')) ? String(note.severity) : 'medium',
      fingerprint,
    });
  }

  const inboxItems: CleanInboxItem[] = [];
  const allowedIncidentFingerprints = new Set(fieldNotes.map((note) => note.fingerprint));
  for (const value of array(rawOutput.inbox_items).slice(0, OUTPUT_LIMITS.inboxItems)) {
    const item = record(value);
    const title = text(item.title, 300);
    if (!title) continue;
    // adopt_rule is reserved for a server-created proposal; model output can
    // never install a durable instruction by smuggling that action type.
    const requestedAction = String(item.action_type ?? '');
    const actionType =
      ACTION_TYPES.has(requestedAction) && requestedAction !== 'adopt_rule'
        ? requestedAction
        : 'none';
    const groundedSessionIds = sessionIds(item.session_ids, allowedSessionIds);
    inboxItems.push({
      kind: INBOX_KINDS.has(String(item.kind ?? '')) ? String(item.kind) : 'other',
      meta: text(item.meta, 200),
      title,
      body: text(item.body, 10000),
      evidence: text(item.evidence, 500),
      action_label: actionLabel(actionType),
      action_type: actionType,
      action_config: actionConfig(actionType, item.action_config),
      account_name: text(item.account_name, 200),
      session_ids: groundedSessionIds,
      account_identity_keys: groundedAccountIdentityKeys(groundedSessionIds, accountsBySession),
      sentry_issue_ids: sentryIssueIds(item.sentry_issue_ids, allowedSentryIssueIds),
      github_object_refs: githubObjectRefs(item.github_object_refs, allowedGithubObjectRefs),
      fingerprint: text(item.fingerprint, 120),
      incident_fingerprint: allowedIncidentFingerprints.has(text(item.incident_fingerprint, 120))
        ? text(item.incident_fingerprint, 120)
        : '',
    });
  }

  const accountUpdates: CleanAccountUpdate[] = [];
  for (const value of array(rawOutput.account_updates).slice(0, OUTPUT_LIMITS.accountUpdates)) {
    const update = record(value);
    const name = text(update.name, 200);
    if (!name) continue;
    const score = Number(update.health_score);
    accountUpdates.push({
      name,
      status: text(update.status ?? 'active', 60) || 'active',
      status_tone: STATUS_TONES.has(String(update.status_tone ?? ''))
        ? String(update.status_tone)
        : 'good',
      facts: array(update.facts)
        .filter((f): f is string => typeof f === 'string')
        .map((fact) => text(fact, 500))
        .slice(0, 8),
      next_move: text(update.next_move, 500),
      health_score: Number.isFinite(score) ? Math.min(100, Math.max(0, Math.round(score))) : null,
    });
  }

  let proposedJob: CleanProposedJob | null = null;
  const rawJob = record(rawOutput.proposed_job);
  const jobLabel = text(rawJob.label, 200);
  if (jobLabel) {
    const minutes = Number(rawJob.interval_minutes);
    if (
      Number.isFinite(minutes) &&
      minutes >= MIN_INTERVAL_MINUTES &&
      minutes <= MAX_INTERVAL_MINUTES
    ) {
      proposedJob = {
        label: jobLabel,
        reason: text(rawJob.reason, 500),
        interval_minutes: clampIntervalMinutes(minutes),
        schedule_label: text(rawJob.schedule_label ?? 'proposed', 100) || 'proposed',
      };
    }
  }

  const proposedRule =
    typeof rawOutput.proposed_rule === 'string' && rawOutput.proposed_rule.trim()
      ? text(rawOutput.proposed_rule.trim(), OUTPUT_LIMITS.ruleChars)
      : null;

  const scratchpadUpdates: CleanScratchpadEntry[] = [];
  for (const value of array(rawOutput.scratchpad_updates).slice(
    0,
    OUTPUT_LIMITS.scratchpadUpdates
  )) {
    const entry = record(value);
    const key = text(entry.key, 100).trim().toLowerCase();
    const content = text(entry.content, 600).replace(/\s+/g, ' ').trim();
    if (!key || !content) continue;
    if (!SCRATCHPAD_KEY.test(key)) continue;
    if (DURABLE_INSTRUCTION.test(content)) continue;
    scratchpadUpdates.push({ key, content });
  }

  return {
    summary: text(rawOutput.summary, OUTPUT_LIMITS.summaryChars) || 'Run complete.',
    fieldNotes,
    inboxItems,
    accountUpdates,
    proposedJob,
    proposedRule,
    scratchpadUpdates,
  };
}
