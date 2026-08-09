import { describe, expect, it } from 'vitest';
import {
  buildRecoveryReceipt,
  canonicalizeReceipt,
  normalizeRecoveryReceipt,
  RECOVERY_RECEIPT_VERSION,
  type RecoveryReceiptInput,
} from './receipt';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const INCIDENT = '22222222-2222-4222-8222-222222222222';
const RECEIPT = '33333333-3333-4333-8333-333333333333';

function input(overrides: Partial<RecoveryReceiptInput> = {}): RecoveryReceiptInput {
  return {
    receipt_id: RECEIPT,
    issued_at: '2026-08-08T12:00:00.000Z',
    workspace_id: WORKSPACE,
    incident: {
      id: INCIDENT,
      title: 'Checkout retries loop on card decline',
      severity: 'high',
      first_seen_at: '2026-07-30T09:12:00.000Z',
      account_count: 12,
      revenue_exposure_cents: 418_000,
      currency: 'USD',
    },
    evidence_ledger: {
      policy_version: 'incident-evidence-v4',
      decision: 'act',
      requirements: [
        { key: 'behavior', status: 'satisfied' },
        { key: 'account_identity', status: 'satisfied' },
      ],
      gaps: [],
    },
    references: [
      {
        provider: 'github',
        kind: 'pull_request',
        external_id: 'eventools-io/postshow#218',
        url: 'https://github.com/eventools-io/postshow/pull/218',
      },
      {
        provider: 'sentry',
        kind: 'issue',
        external_id: '4509',
        url: 'https://eventools.sentry.io/issues/4509/',
      },
    ],
    approvals: [
      {
        capability: 'product_work',
        actor: 'jratliff79',
        decided_at: '2026-08-02T17:04:00.000Z',
      },
      { capability: 'customer_message', actor: 'cj-vana', decided_at: '2026-08-02T18:30:00.000Z' },
    ],
    verification_contract: {
      measure: 'decline retry failure rate',
      window: '7d',
      threshold: 'below 2 percent',
      guardrails: ['checkout volume within 5 percent'],
      recorded_at: '2026-08-02T18:31:00.000Z',
      intervened_at: '2026-08-03T15:00:00.000Z',
    },
    measured_outcome: {
      status: 'recovered',
      baseline: '18.4 percent',
      observed: '0.7 percent',
      sample: 1204,
      measured_at: '2026-08-10T15:00:00.000Z',
    },
    disclose_impact: true,
    ...overrides,
  };
}

describe('recovery receipt', () => {
  it('projects a complete incident into a receipt that claims recovery', () => {
    const receipt = buildRecoveryReceipt(input());
    expect(receipt.version).toBe(RECOVERY_RECEIPT_VERSION);
    expect(receipt.outcome.status).toBe('recovered');
    expect(receipt.verification.recorded_before_intervention).toBe(true);
    expect(receipt.claims_recovery).toBe(true);
    expect(receipt.impact).toEqual({
      disclosed: true,
      account_count: 12,
      revenue_exposure_cents: 418_000,
      currency: 'USD',
    });
  });

  // The product law this exists to enforce: a negative or inconclusive result
  // stays visible and is never rewritten as success.
  it.each(['pending', 'improving', 'unchanged', 'regressed', 'inconclusive'] as const)(
    'renders a %s outcome without claiming recovery',
    (status) => {
      const receipt = buildRecoveryReceipt(
        input({ measured_outcome: { status, baseline: '18.4 percent', observed: '17.9 percent' } })
      );
      expect(receipt.outcome.status).toBe(status);
      expect(receipt.claims_recovery).toBe(false);
    }
  );

  // A recovery check written after the result is known describes the result
  // rather than predicting it, so it cannot support the claim.
  it('refuses to claim recovery when the check was written after the intervention', () => {
    const receipt = buildRecoveryReceipt(
      input({
        verification_contract: {
          measure: 'decline retry failure rate',
          window: '7d',
          threshold: 'below 2 percent',
          guardrails: [],
          recorded_at: '2026-08-04T10:00:00.000Z',
          intervened_at: '2026-08-03T15:00:00.000Z',
        },
      })
    );
    expect(receipt.outcome.status).toBe('recovered');
    expect(receipt.verification.recorded_before_intervention).toBe(false);
    expect(receipt.claims_recovery).toBe(false);
  });

  it('refuses to claim recovery with no verification contract at all', () => {
    const receipt = buildRecoveryReceipt(input({ verification_contract: {} }));
    expect(receipt.verification.contract_recorded).toBe(false);
    expect(receipt.claims_recovery).toBe(false);
  });

  // Withholding impact must report null rather than zero. A receipt stating
  // zero affected accounts when it simply did not disclose them is false.
  it('withholds account and revenue detail without stating a zero', () => {
    const receipt = buildRecoveryReceipt(input({ disclose_impact: false }));
    expect(receipt.impact).toEqual({
      disclosed: false,
      account_count: null,
      revenue_exposure_cents: null,
      currency: null,
    });
  });

  it('keeps the evidence gaps that held the decision back', () => {
    const receipt = buildRecoveryReceipt(
      input({
        evidence_ledger: {
          policy_version: 'incident-evidence-v4',
          decision: 'abstain',
          requirements: [{ key: 'technical_failure', status: 'missing' }],
          gaps: ['technical_failure_not_linked'],
        },
      })
    );
    expect(receipt.evidence.decision).toBe('abstain');
    expect(receipt.evidence.gaps).toEqual(['technical_failure_not_linked']);
  });

  it('rejects a reference that points somewhere other than its provider', () => {
    expect(() =>
      buildRecoveryReceipt(
        input({
          references: [
            {
              provider: 'github',
              kind: 'pull_request',
              external_id: 'x#1',
              url: 'https://github.com.attacker.example/eventools-io/postshow/pull/218',
            },
          ],
        })
      )
    ).toThrow(/does not point at github/);
  });

  it('rejects a reference served over plain http', () => {
    expect(() =>
      buildRecoveryReceipt(
        input({
          references: [
            {
              provider: 'sentry',
              kind: 'issue',
              external_id: '1',
              url: 'http://eventools.sentry.io/issues/1/',
            },
          ],
        })
      )
    ).toThrow(/not https/);
  });

  it('rejects an unknown outcome status rather than defaulting it', () => {
    expect(() => buildRecoveryReceipt(input({ measured_outcome: { status: 'fixed' } }))).toThrow(
      /outcome status is invalid/
    );
  });
});

describe('receipt canonicalization', () => {
  it('produces identical bytes regardless of key or record order', () => {
    const receipt = buildRecoveryReceipt(input());
    const shuffled = buildRecoveryReceipt(
      input({
        references: [...(input().references as unknown[])].reverse(),
        approvals: [...(input().approvals as unknown[])].reverse(),
      })
    );
    expect(canonicalizeReceipt(shuffled)).toBe(canonicalizeReceipt(receipt));
  });

  it('emits sorted keys and no whitespace', () => {
    const canonical = canonicalizeReceipt(buildRecoveryReceipt(input()));
    expect(canonical.startsWith('{"approvals":')).toBe(true);
    expect(canonical).not.toContain('\n');
    expect(canonical).not.toContain(': ');
    expect(JSON.parse(canonical).receipt_id).toBe(RECEIPT);
  });

  // The signature is only as trustworthy as the serializer under it, so a
  // changed field has to change the bytes.
  it('changes when any field changes', () => {
    const base = canonicalizeReceipt(buildRecoveryReceipt(input()));
    const altered = canonicalizeReceipt(
      buildRecoveryReceipt(
        input({ incident: { ...(input().incident as object), title: 'Checkout retries loop' } })
      )
    );
    expect(altered).not.toBe(base);
  });
});

describe('receipt revalidation', () => {
  // The document has to be self-contained. A verifier sees only the bytes that
  // were signed, so anything the projection needs to recompute the recovery
  // claim has to travel inside them.
  it('round trips through its own canonical bytes with nothing alongside', () => {
    const receipt = buildRecoveryReceipt(input());
    expect(receipt.claims_recovery).toBe(true);
    const overTheWire = JSON.parse(canonicalizeReceipt(receipt));
    expect(canonicalizeReceipt(normalizeRecoveryReceipt(overTheWire))).toBe(
      canonicalizeReceipt(receipt)
    );
  });

  it('round trips a receipt that withheld its impact detail', () => {
    const receipt = buildRecoveryReceipt(input({ disclose_impact: false }));
    const overTheWire = JSON.parse(canonicalizeReceipt(receipt));
    expect(normalizeRecoveryReceipt(overTheWire).impact.disclosed).toBe(false);
  });

  it('round trips an inconclusive receipt', () => {
    const receipt = buildRecoveryReceipt(
      input({ measured_outcome: { status: 'inconclusive', baseline: '', observed: '' } })
    );
    const overTheWire = JSON.parse(canonicalizeReceipt(receipt));
    expect(normalizeRecoveryReceipt(overTheWire).outcome.status).toBe('inconclusive');
  });

  // The attack this closes: take a real receipt for an inconclusive incident,
  // flip one boolean, and present it as proof of recovery.
  it('refuses a receipt whose recovery claim its own record does not support', () => {
    const receipt = buildRecoveryReceipt(
      input({ measured_outcome: { status: 'inconclusive', baseline: '', observed: '' } })
    );
    expect(receipt.claims_recovery).toBe(false);
    expect(() => normalizeRecoveryReceipt({ ...receipt, claims_recovery: true })).toThrow(
      /does not match its own record/
    );
  });

  it('refuses a receipt from another version', () => {
    const receipt = buildRecoveryReceipt(input());
    expect(() => normalizeRecoveryReceipt({ ...receipt, version: 'recovery-receipt-v2' })).toThrow(
      /version is invalid/
    );
  });
});
