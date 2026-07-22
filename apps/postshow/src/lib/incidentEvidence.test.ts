import { describe, expect, it } from 'vitest';
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

describe('incident evidence boundary', () => {
  it.each(['act', 'gather_more', 'abstain'] as const)('accepts a valid %s decision', (decision) => {
    const reason =
      decision === 'act'
        ? 'grounded_action_ready_for_review'
        : decision === 'abstain'
          ? 'complete_evidence_no_grounded_account'
          : 'no_intervention_cleared_threshold';
    expect(
      parseIncidentEvidenceLedger({
        policy_version: 'incident-evidence-v1',
        evaluated_run_id: '72000000-0000-4000-8000-000000000001',
        decision,
        reason_code: reason,
        requirements,
        gaps: ['technical_failure_not_linked', 'code_context_not_linked'],
        source_context: { version: 1 },
      }).decision
    ).toBe(decision);
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
