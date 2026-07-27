import { describe, expect, it } from 'vitest';
import { INCIDENT_EVIDENCE_POLICY_VERSION } from '@eventools/postshow-core';
import { parseIncidentEvidenceLedger } from './incidentEvidence';

const requirements = [
  ['behavior', 'supported', 2, ['posthog'], { posthog: 'sampled' }],
  ['account_identity', 'supported', 1, ['posthog', 'stripe'], { stripe: 'complete' }],
  ['technical_failure', 'not_linked', 0, ['sentry'], { sentry: 'failed' }],
  ['code_context', 'not_linked', 0, ['github'], { github: 'complete' }],
  ['recovery_check', 'supported', 1, ['postshow'], {}],
].map(([key, status, evidence_count, sources, source_states]) => ({
  key,
  status,
  evidence_count,
  sources,
  source_states,
}));

/** The version comes from the core policy instead of a literal repeated here.
 * A policy bump that this boundary has not been taught about must fail loudly:
 * an unreadable ledger renders as "evidence not evaluated" on every dossier. */
function ledger(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    policy_version: INCIDENT_EVIDENCE_POLICY_VERSION,
    evaluated_run_id: '72000000-0000-4000-8000-000000000001',
    decision: 'act',
    reason_code: 'grounded_action_ready_for_review',
    requirements,
    gaps: ['technical_failure_not_linked', 'code_context_not_linked'],
    source_context: { version: 1 },
    ...overrides,
  };
}

describe('incident evidence boundary', () => {
  it.each([
    ['act', 'grounded_action_ready_for_review'],
    ['gather_more', 'technical_failure_not_linked'],
    ['abstain', 'complete_evidence_no_grounded_account'],
  ])('reads a current-policy %s decision', (decision, reason_code) => {
    expect(parseIncidentEvidenceLedger(ledger({ decision, reason_code }))).toMatchObject({
      policy_version: INCIDENT_EVIDENCE_POLICY_VERSION,
      decision,
      reason_code,
    });
  });

  it('degrades a ledger written under a superseded policy version', () => {
    expect(
      parseIncidentEvidenceLedger(ledger({ policy_version: 'incident-evidence-v1' }))
    ).toMatchObject({
      policy_version: 'unavailable',
      decision: 'gather_more',
      reason_code: 'evidence_ledger_unavailable',
      gaps: ['evidence_not_evaluated'],
    });
  });

  it.each([undefined, {}, { decision: 'act' }, { ...requirements, reason_code: '<script>' }])(
    'degrades a missing or malformed ledger to unavailable',
    (value) => {
      expect(parseIncidentEvidenceLedger(value)).toMatchObject({
        policy_version: 'unavailable',
        decision: 'gather_more',
        reason_code: 'evidence_ledger_unavailable',
        requirements: [],
        gaps: ['evidence_not_evaluated'],
      });
    }
  );
});
