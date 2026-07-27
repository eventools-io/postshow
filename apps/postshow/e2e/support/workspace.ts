// The fixture workspace the browser suite signs into.
//
// The ledgers are built from the core policy constant rather than a pasted
// string, so a policy bump cannot leave this fixture asserting against a
// version the app has already stopped accepting.

import { INCIDENT_EVIDENCE_POLICY_VERSION } from '@eventools/postshow-core';

export const USER_ID = 'e2e00000-0000-4000-8000-000000000001';
export const WORKSPACE_ID = 'e2e00000-0000-4000-8000-000000000002';
export const GROUNDED_INCIDENT_ID = 'e2e00000-0000-4000-8000-000000000003';
export const THIN_INCIDENT_ID = 'e2e00000-0000-4000-8000-000000000004';
export const ACCOUNT_ID = 'e2e00000-0000-4000-8000-000000000005';
export const INBOX_ITEM_ID = 'e2e00000-0000-4000-8000-000000000006';

export const SIGN_IN_EMAIL = 'reviewer@postshow.invalid';
export const SIGN_IN_PASSWORD = 'a-long-enough-e2e-password';

export const WORKSPACE = {
  id: WORKSPACE_ID,
  name: 'Northwind Recovery',
  plan: 'team',
  agent_rules: [],
  created_at: '2026-07-01T09:00:00.000Z',
};

export const ACCOUNT = {
  id: ACCOUNT_ID,
  workspace_id: WORKSPACE_ID,
  name: 'Northwind Systems',
  status: 'at risk',
  status_tone: 'bad',
  mrr_cents: 240000,
  seats: 24,
  facts: [],
  next_move: '',
  health_score: null,
  last_activity_at: '2026-07-24T12:00:00.000Z',
  updated_at: '2026-07-24T12:00:00.000Z',
};

function requirement(
  key: string,
  status: string,
  evidenceCount: number,
  sources: string[],
  sourceStates: Record<string, string>
) {
  return {
    key,
    status,
    evidence_count: evidenceCount,
    sources,
    source_states: sourceStates,
  };
}

const GROUNDED_LEDGER = {
  policy_version: INCIDENT_EVIDENCE_POLICY_VERSION,
  evaluated_run_id: null,
  decision: 'act',
  reason_code: 'grounded_action_ready_for_review',
  requirements: [
    requirement('behavior', 'supported', 4, ['posthog'], { posthog: 'complete' }),
    requirement('account_identity', 'supported', 1, ['posthog', 'stripe'], {
      posthog: 'complete',
      stripe: 'complete',
    }),
    requirement('technical_failure', 'supported', 2, ['sentry'], { sentry: 'complete' }),
    requirement('code_context', 'supported', 1, ['github'], { github: 'complete' }),
    requirement('recovery_check', 'supported', 1, ['postshow'], {}),
  ],
  gaps: [],
  source_context: {},
};

const THIN_LEDGER = {
  policy_version: INCIDENT_EVIDENCE_POLICY_VERSION,
  evaluated_run_id: null,
  decision: 'gather_more',
  reason_code: 'account_identity_not_grounded',
  requirements: [
    requirement('behavior', 'partial', 1, ['posthog'], { posthog: 'sampled' }),
    requirement('account_identity', 'missing', 0, ['posthog', 'stripe'], {
      posthog: 'sampled',
      stripe: 'failed',
    }),
    requirement('technical_failure', 'not_linked', 0, ['sentry'], { sentry: 'failed' }),
    requirement('code_context', 'not_linked', 0, ['github'], { github: 'not_gathered' }),
    requirement('recovery_check', 'missing', 0, ['postshow'], {}),
  ],
  gaps: [
    'account_identity_not_grounded',
    'technical_failure_not_linked',
    'code_context_not_linked',
    'recovery_check_missing',
  ],
  source_context: {},
};

export const GROUNDED_INCIDENT = {
  id: GROUNDED_INCIDENT_ID,
  workspace_id: WORKSPACE_ID,
  fingerprint: 'checkout-retry-stall',
  title: 'Checkout retries strand paying accounts',
  summary: 'Repeat sessions stall on the payment step and the retry never completes.',
  lifecycle_state: 'intervention_pending',
  severity: 'high',
  revenue_exposure_cents: 480000,
  currency: 'USD',
  evidence_refs: {
    session_ids: ['session-alpha', 'session-beta', 'session-gamma', 'session-delta'],
    source_coverage: { complete: true, matchedSessions: 4, unmatchedSessions: 0, reasons: [] },
  },
  root_cause_hypothesis: {
    status: 'suspected',
    summary: 'The retry handler drops the idempotency key on the second attempt.',
  },
  verification_contract: { metric: 'repeat checkout sessions', baseline: 12, status: 'pending' },
  measured_outcome: { status: 'pending' },
  evidence_ledger: GROUNDED_LEDGER,
  first_seen_at: '2026-07-20T10:00:00.000Z',
  last_seen_at: '2026-07-24T10:00:00.000Z',
  created_at: '2026-07-20T10:00:00.000Z',
  updated_at: '2026-07-24T10:00:00.000Z',
};

export const THIN_INCIDENT = {
  ...GROUNDED_INCIDENT,
  id: THIN_INCIDENT_ID,
  fingerprint: 'export-timeout-thin',
  title: 'Report export times out for one workspace',
  summary: 'A single session shows an export that never finishes.',
  lifecycle_state: 'investigating',
  severity: 'medium',
  revenue_exposure_cents: null,
  currency: '',
  evidence_refs: {
    session_ids: ['session-epsilon'],
    source_coverage: {
      sampled: true,
      matchedSessions: 1,
      unmatchedSessions: 3,
      reasons: ['PostHog returned a sampled page for this window'],
    },
  },
  root_cause_hypothesis: { status: 'unverified', summary: '' },
  verification_contract: {},
  measured_outcome: { status: 'pending' },
  evidence_ledger: THIN_LEDGER,
  last_seen_at: '2026-07-23T10:00:00.000Z',
};

export const INBOX_ITEM = {
  id: INBOX_ITEM_ID,
  workspace_id: WORKSPACE_ID,
  account_id: ACCOUNT_ID,
  kind: 'ticket',
  meta: 'Northwind Systems',
  title: 'File the checkout retry defect',
  body: 'Two corroborating sessions stall on the same payment step.',
  evidence: '4 grounded replays',
  action_label: 'File issue',
  action_type: 'github_issue',
  action_config: {},
  action_revision: 1,
  state: 'pending',
  resolution: {},
  resolved_at: null,
  session_ids: ['session-alpha', 'session-beta'],
  account_identity_keys: [],
  incident_id: GROUNDED_INCIDENT_ID,
  created_at: '2026-07-24T11:00:00.000Z',
};

export const FIELD_NOTE = {
  id: 'e2e00000-0000-4000-8000-000000000007',
  workspace_id: WORKSPACE_ID,
  title: 'Retry loop observed on four sessions',
  detail: 'Every session repeats the payment step without a terminal state.',
  sessions: 4,
  severity: 'high',
  source: 'watcher',
  state: 'open',
  session_ids: ['session-alpha', 'session-beta'],
  account_identity_keys: [],
  root_cause_hypothesis: '',
  incident_id: GROUNDED_INCIDENT_ID,
  run_id: null,
  created_at: '2026-07-24T10:30:00.000Z',
};

export const POSTHOG_CONNECTION = {
  id: 'e2e00000-0000-4000-8000-000000000008',
  workspace_id: WORKSPACE_ID,
  provider: 'posthog',
  label: 'Northwind PostHog',
  status: 'connected',
  local_only: false,
  meta: { host: 'https://us.posthog.com', project_id: '4242' },
  last_checked_at: '2026-07-24T09:00:00.000Z',
  created_at: '2026-07-01T09:00:00.000Z',
};

export const ENGINE_SETTINGS = {
  workspace_id: WORKSPACE_ID,
  mode: 'hosted',
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  base_url: '',
  task_prefs: {},
};
