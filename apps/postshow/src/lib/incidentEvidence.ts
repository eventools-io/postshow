import { INCIDENT_EVIDENCE_POLICY_VERSION } from '@eventools/postshow-core';
import type {
  IncidentEvidenceLedger,
  IncidentEvidenceRequirement,
  IncidentEvidenceSourceState,
} from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUIREMENTS = new Set<IncidentEvidenceRequirement['key']>([
  'behavior',
  'account_identity',
  'technical_failure',
  'code_context',
  'recovery_check',
]);
const STATUSES = new Set<IncidentEvidenceRequirement['status']>([
  'supported',
  'partial',
  'not_linked',
  'missing',
]);
const SOURCE_STATES = new Set<IncidentEvidenceSourceState>([
  'complete',
  'sampled',
  'partial',
  'failed',
  'not_gathered',
]);
const SOURCES = new Set(['posthog', 'stripe', 'sentry', 'github', 'postshow']);
const REASON_CODES = new Set([
  'grounded_action_ready_for_review',
  'account_identity_not_grounded',
  'technical_failure_not_linked',
  'complete_evidence_no_grounded_account',
  'no_intervention_cleared_threshold',
  'missing_behavior_evidence',
]);
const GAP_CODES = new Set([
  'account_identity_not_grounded',
  'technical_failure_not_linked',
  'code_context_not_linked',
  'recovery_check_missing',
  'behavior_evidence_missing',
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function unavailableIncidentEvidenceLedger(): IncidentEvidenceLedger {
  return {
    policy_version: 'unavailable',
    evaluated_run_id: null,
    decision: 'gather_more',
    reason_code: 'evidence_ledger_unavailable',
    requirements: [],
    gaps: ['evidence_not_evaluated'],
    source_context: {},
  };
}

export function parseIncidentEvidenceLedger(value: unknown): IncidentEvidenceLedger {
  const ledger = record(value);
  if (
    ledger.policy_version !== INCIDENT_EVIDENCE_POLICY_VERSION ||
    !['act', 'gather_more', 'abstain'].includes(String(ledger.decision)) ||
    !REASON_CODES.has(String(ledger.reason_code)) ||
    (ledger.evaluated_run_id !== null &&
      (typeof ledger.evaluated_run_id !== 'string' || !UUID.test(ledger.evaluated_run_id))) ||
    !Array.isArray(ledger.requirements) ||
    ledger.requirements.length !== REQUIREMENTS.size ||
    !Array.isArray(ledger.gaps) ||
    ledger.gaps.length > GAP_CODES.size
  ) {
    return unavailableIncidentEvidenceLedger();
  }

  const seen = new Set<string>();
  const requirements: IncidentEvidenceRequirement[] = [];
  for (const rawRequirement of ledger.requirements) {
    const requirement = record(rawRequirement);
    const key = String(requirement.key) as IncidentEvidenceRequirement['key'];
    const status = String(requirement.status) as IncidentEvidenceRequirement['status'];
    const evidenceCount = Number(requirement.evidence_count);
    const sources = requirement.sources;
    const sourceStates = record(requirement.source_states);
    if (
      !REQUIREMENTS.has(key) ||
      seen.has(key) ||
      !STATUSES.has(status) ||
      !Number.isSafeInteger(evidenceCount) ||
      evidenceCount < 0 ||
      evidenceCount > 1_000_000 ||
      !Array.isArray(sources) ||
      sources.length < 1 ||
      sources.length > 2 ||
      sources.some((source) => typeof source !== 'string' || !SOURCES.has(source)) ||
      Object.entries(sourceStates).some(
        ([source, state]) =>
          !SOURCES.has(source) || !SOURCE_STATES.has(String(state) as IncidentEvidenceSourceState)
      )
    ) {
      return unavailableIncidentEvidenceLedger();
    }
    seen.add(key);
    requirements.push({
      key,
      status,
      evidence_count: evidenceCount,
      sources: sources as string[],
      source_states: sourceStates as Record<string, IncidentEvidenceSourceState>,
    });
  }

  const gaps = ledger.gaps;
  if (
    new Set(gaps).size !== gaps.length ||
    gaps.some((gap) => typeof gap !== 'string' || !GAP_CODES.has(gap))
  ) {
    return unavailableIncidentEvidenceLedger();
  }

  return {
    policy_version: INCIDENT_EVIDENCE_POLICY_VERSION,
    evaluated_run_id: ledger.evaluated_run_id as string | null,
    decision: ledger.decision as IncidentEvidenceLedger['decision'],
    reason_code: String(ledger.reason_code),
    requirements,
    gaps: gaps as string[],
    source_context: record(ledger.source_context) as IncidentEvidenceLedger['source_context'],
  };
}
