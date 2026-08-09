import { INCIDENT_EVIDENCE_POLICY_VERSION } from './evidence';

/** A recovery receipt is the durable, portable statement of what one customer
 * incident actually was: the evidence that grounded it, who approved each
 * consequential action, the recovery check that was written down before the
 * intervention ran, and what the measurement returned afterwards.
 *
 * It exists because every tool in this category stops at detection. Anyone can
 * say a problem was found. Almost nothing can hand a customer, an auditor, or a
 * board a document that shows the problem, the fix, the approval trail, and the
 * measured result, and let them check it was not edited afterwards.
 *
 * Two rules make it worth trusting, and both are enforced here rather than left
 * to the caller. A receipt is a projection of persisted fields, so no model
 * writes any part of it and the same incident produces the same bytes in a local
 * run and a hosted one. And a receipt reports the outcome it was given: pending,
 * unchanged, regressed, and inconclusive render exactly as they are. The one
 * thing a receipt may never do is claim a recovery the record does not support,
 * which is why `claims_recovery` is computed here from the outcome and the
 * ordering of the verification contract rather than accepted as an input. */
export const RECOVERY_RECEIPT_VERSION = 'recovery-receipt-v1';

export const RECEIPT_OUTCOME_STATUSES = [
  'pending',
  'recovered',
  'improving',
  'unchanged',
  'regressed',
  'inconclusive',
] as const;

export const RECEIPT_EVIDENCE_DECISIONS = ['act', 'gather_more', 'abstain'] as const;

export const RECEIPT_SEVERITIES = ['high', 'medium', 'low'] as const;

export const RECEIPT_REFERENCE_PROVIDERS = ['posthog', 'stripe', 'sentry', 'github'] as const;

export type ReceiptOutcomeStatus = (typeof RECEIPT_OUTCOME_STATUSES)[number];
export type ReceiptEvidenceDecision = (typeof RECEIPT_EVIDENCE_DECISIONS)[number];
export type ReceiptSeverity = (typeof RECEIPT_SEVERITIES)[number];
export type ReceiptReferenceProvider = (typeof RECEIPT_REFERENCE_PROVIDERS)[number];

export interface ReceiptReference {
  provider: ReceiptReferenceProvider;
  kind: string;
  external_id: string;
  url: string;
}

export interface ReceiptRequirement {
  key: string;
  status: string;
}

export interface ReceiptApproval {
  capability: string;
  actor: string;
  decided_at: string;
}

export interface ReceiptImpact {
  /** False when the issuer chose not to disclose account and revenue detail. The
   * counts are then null rather than zero, because a receipt that reports zero
   * affected accounts when it simply withheld them is a false statement. */
  disclosed: boolean;
  account_count: number | null;
  revenue_exposure_cents: number | null;
  currency: string | null;
}

export interface ReceiptVerification {
  contract_recorded: boolean;
  /** A recovery check written after the result is known is not a prediction. A
   * receipt that claims recovery requires this to be true. */
  recorded_before_intervention: boolean;
  measure: string;
  window: string;
  threshold: string;
  guardrails: string[];
}

export interface ReceiptOutcome {
  status: ReceiptOutcomeStatus;
  baseline: string;
  observed: string;
  sample: number | null;
  measured_at: string | null;
}

export interface RecoveryReceipt {
  version: typeof RECOVERY_RECEIPT_VERSION;
  receipt_id: string;
  issued_at: string;
  workspace_id: string;
  incident: {
    id: string;
    title: string;
    severity: ReceiptSeverity;
    first_seen_at: string;
  };
  evidence: {
    policy_version: string;
    decision: ReceiptEvidenceDecision;
    requirements: ReceiptRequirement[];
    gaps: string[];
    references: ReceiptReference[];
  };
  impact: ReceiptImpact;
  approvals: ReceiptApproval[];
  verification: ReceiptVerification;
  outcome: ReceiptOutcome;
  /** Never an input. A receipt claims recovery only when the measurement said
   * recovered and a recovery check existed before the intervention ran. */
  claims_recovery: boolean;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, label: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string') throw new Error(`${label} is invalid`);
  const trimmed = value.trim();
  if (!allowEmpty && trimmed.length === 0) throw new Error(`${label} is empty`);
  if (trimmed.length > max) throw new Error(`${label} is too long`);
  return trimmed;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function uuid(value: unknown, label: string): string {
  const candidate = text(value, label, 36);
  if (!UUID.test(candidate)) throw new Error(`${label} is invalid`);
  return candidate;
}

/** Receipts are compared and signed as bytes, so a timestamp has exactly one
 * spelling: UTC, milliseconds, trailing Z. Anything else would let the same
 * moment produce two different signatures. */
function instant(value: unknown, label: string): string {
  const candidate = text(value, label, 40);
  const parsed = Date.parse(candidate);
  if (!Number.isFinite(parsed)) throw new Error(`${label} is invalid`);
  return new Date(parsed).toISOString();
}

function nullableInstant(value: unknown, label: string): string | null {
  return value === null || value === undefined ? null : instant(value, label);
}

function counted(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} is invalid`);
  return Number(value);
}

function nullableCount(value: unknown, label: string): number | null {
  return value === null || value === undefined ? null : counted(value, label);
}

function member<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`${label} is invalid`);
  }
  return value as T;
}

/** Only the provider hosts a receipt is allowed to link to. A receipt is meant
 * to be handed to someone outside the team, so a reference that points anywhere
 * else is either a mistake or an attempt to use a signed document as a lure. */
const REFERENCE_HOSTS: Record<ReceiptReferenceProvider, RegExp> = {
  posthog: /^(?:[a-z0-9-]+\.)*posthog\.com$/,
  stripe: /^(?:dashboard\.)?stripe\.com$/,
  sentry: /^(?:[a-z0-9-]+\.)*sentry\.io$/,
  github: /^github\.com$/,
};

function referenceUrl(value: unknown, provider: ReceiptReferenceProvider, label: string): string {
  const candidate = text(value, label, 2048);
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`${label} is invalid`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`${label} is not https`);
  if (!REFERENCE_HOSTS[provider].test(parsed.hostname)) {
    throw new Error(`${label} does not point at ${provider}`);
  }
  return parsed.toString();
}

function reference(value: unknown, index: number): ReceiptReference {
  const entry = record(value);
  const provider = member(
    entry.provider,
    RECEIPT_REFERENCE_PROVIDERS,
    `receipt reference ${index} provider`
  );
  return {
    provider,
    kind: text(entry.kind, `receipt reference ${index} kind`, 60),
    external_id: text(entry.external_id, `receipt reference ${index} external id`, 200),
    url: referenceUrl(entry.url, provider, `receipt reference ${index} url`),
  };
}

function requirement(value: unknown, index: number): ReceiptRequirement {
  const entry = record(value);
  return {
    key: text(entry.key, `receipt requirement ${index} key`, 60),
    status: text(entry.status, `receipt requirement ${index} status`, 60),
  };
}

function approval(value: unknown, index: number): ReceiptApproval {
  const entry = record(value);
  return {
    capability: text(entry.capability, `receipt approval ${index} capability`, 120),
    actor: text(entry.actor, `receipt approval ${index} actor`, 200),
    decided_at: instant(entry.decided_at, `receipt approval ${index} decided at`),
  };
}

/** Sorted by the fields a reader would sort by, so two runs that gathered the
 * same records in a different order still serialize to the same bytes. */
function sortReferences(values: ReceiptReference[]): ReceiptReference[] {
  return [...values].sort(
    (left, right) =>
      left.provider.localeCompare(right.provider) ||
      left.kind.localeCompare(right.kind) ||
      left.external_id.localeCompare(right.external_id)
  );
}

function sortApprovals(values: ReceiptApproval[]): ReceiptApproval[] {
  return [...values].sort(
    (left, right) =>
      left.decided_at.localeCompare(right.decided_at) ||
      left.capability.localeCompare(right.capability) ||
      left.actor.localeCompare(right.actor)
  );
}

export interface RecoveryReceiptInput {
  receipt_id: string;
  issued_at: string;
  workspace_id: string;
  incident: unknown;
  evidence_ledger: unknown;
  references: unknown;
  approvals: unknown;
  verification_contract: unknown;
  measured_outcome: unknown;
  /** Account and revenue detail is withheld unless the issuer asked for it. A
   * receipt travels outside the team that made it, and current revenue exposure
   * for named accounts is the most sensitive thing an incident holds. */
  disclose_impact: boolean;
}

/** Projects persisted incident state into a receipt. Every field is derived, no
 * field is authored, and anything that does not typecheck fails the whole
 * receipt rather than being dropped: a receipt that quietly omits a failed
 * requirement is worse than no receipt. */
export function buildRecoveryReceipt(input: RecoveryReceiptInput): RecoveryReceipt {
  const incident = record(input.incident);
  const ledger = record(input.evidence_ledger);
  const contract = record(input.verification_contract);
  const outcome = record(input.measured_outcome);

  const contractRecorded = Object.keys(contract).length > 0;
  const status = member(
    outcome.status ?? 'pending',
    RECEIPT_OUTCOME_STATUSES,
    'receipt outcome status'
  );

  // A recovery check that was written down after the intervention already ran
  // describes the result rather than predicting it, so it cannot support a
  // recovery claim. Absent ordering is treated as absent proof.
  const recordedAt = nullableInstant(contract.recorded_at, 'receipt verification recorded at');
  const intervenedAt = nullableInstant(
    contract.intervened_at,
    'receipt verification intervened at'
  );
  const recordedBefore =
    contractRecorded &&
    recordedAt !== null &&
    intervenedAt !== null &&
    Date.parse(recordedAt) <= Date.parse(intervenedAt);

  const impact: ReceiptImpact = input.disclose_impact
    ? {
        disclosed: true,
        account_count: nullableCount(incident.account_count, 'receipt account count'),
        revenue_exposure_cents: nullableCount(
          incident.revenue_exposure_cents,
          'receipt revenue exposure'
        ),
        currency:
          incident.currency === null || incident.currency === undefined || incident.currency === ''
            ? null
            : text(incident.currency, 'receipt currency', 3),
      }
    : { disclosed: false, account_count: null, revenue_exposure_cents: null, currency: null };

  return {
    version: RECOVERY_RECEIPT_VERSION,
    receipt_id: uuid(input.receipt_id, 'receipt id'),
    issued_at: instant(input.issued_at, 'receipt issued at'),
    workspace_id: uuid(input.workspace_id, 'receipt workspace id'),
    incident: {
      id: uuid(incident.id, 'receipt incident id'),
      title: text(incident.title, 'receipt incident title', 300),
      severity: member(incident.severity, RECEIPT_SEVERITIES, 'receipt incident severity'),
      first_seen_at: instant(incident.first_seen_at, 'receipt incident first seen at'),
    },
    evidence: {
      policy_version: text(
        ledger.policy_version ?? INCIDENT_EVIDENCE_POLICY_VERSION,
        'receipt evidence policy version',
        60
      ),
      decision: member(ledger.decision, RECEIPT_EVIDENCE_DECISIONS, 'receipt evidence decision'),
      requirements: list(ledger.requirements).map(requirement),
      gaps: list(ledger.gaps).map((gap, index) => text(gap, `receipt evidence gap ${index}`, 120)),
      references: sortReferences(list(input.references).map(reference)),
    },
    impact,
    approvals: sortApprovals(list(input.approvals).map(approval)),
    verification: {
      contract_recorded: contractRecorded,
      recorded_before_intervention: recordedBefore,
      measure: text(contract.measure ?? '', 'receipt verification measure', 300, true),
      window: text(contract.window ?? '', 'receipt verification window', 120, true),
      threshold: text(contract.threshold ?? '', 'receipt verification threshold', 200, true),
      guardrails: list(contract.guardrails).map((guardrail, index) =>
        text(guardrail, `receipt verification guardrail ${index}`, 200)
      ),
    },
    outcome: {
      status,
      baseline: text(outcome.baseline ?? '', 'receipt outcome baseline', 200, true),
      observed: text(outcome.observed ?? '', 'receipt outcome observed', 200, true),
      sample: nullableCount(outcome.sample, 'receipt outcome sample'),
      measured_at: nullableInstant(outcome.measured_at, 'receipt outcome measured at'),
    },
    claims_recovery: status === 'recovered' && recordedBefore,
  };
}

/** Deterministic bytes for signing and verifying. Keys are emitted in sorted
 * order at every depth and no whitespace is added, so the same receipt produces
 * the same string in any runtime and on any host. Written here rather than taken
 * from a dependency because a signature is only as trustworthy as the
 * serializer under it, and this one is covered by fixtures. */
export function canonicalizeReceipt(receipt: RecoveryReceipt): string {
  const encode = (value: unknown): string => {
    if (value === null) return 'null';
    if (Array.isArray(value)) return `[${value.map(encode).join(',')}]`;
    if (typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => `${JSON.stringify(key)}:${encode(entry)}`);
      return `{${entries.join(',')}}`;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('receipt number is not finite');
      return JSON.stringify(value);
    }
    if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    throw new Error('receipt value is not serializable');
  };
  return encode(receipt);
}

/** Revalidates a receipt that arrived from somewhere else, which is every
 * receipt a verifier sees. Rebuilding through the same projection means a
 * document cannot carry a `claims_recovery` its own outcome does not support,
 * even if it was signed by a valid key. */
export function normalizeRecoveryReceipt(value: unknown): RecoveryReceipt {
  const candidate = record(value);
  if (candidate.version !== RECOVERY_RECEIPT_VERSION) {
    throw new Error('receipt version is invalid');
  }
  const incident = record(candidate.incident);
  const evidence = record(candidate.evidence);
  const impact = record(candidate.impact);
  const verification = record(candidate.verification);
  const outcome = record(candidate.outcome);

  const rebuilt = buildRecoveryReceipt({
    receipt_id: String(candidate.receipt_id ?? ''),
    issued_at: String(candidate.issued_at ?? ''),
    workspace_id: String(candidate.workspace_id ?? ''),
    incident: {
      ...incident,
      account_count: impact.account_count,
      revenue_exposure_cents: impact.revenue_exposure_cents,
      currency: impact.currency,
    },
    evidence_ledger: {
      policy_version: evidence.policy_version,
      decision: evidence.decision,
      requirements: evidence.requirements,
      gaps: evidence.gaps,
    },
    references: evidence.references,
    approvals: candidate.approvals,
    verification_contract: verification.contract_recorded
      ? {
          measure: verification.measure,
          window: verification.window,
          threshold: verification.threshold,
          guardrails: verification.guardrails,
          // The projection recomputes ordering from these two, so a document
          // that asserts it was recorded first has to carry the timestamps that
          // prove it.
          recorded_at: candidate.verification_recorded_at ?? null,
          intervened_at: candidate.verification_intervened_at ?? null,
        }
      : {},
    measured_outcome: outcome,
    disclose_impact: impact.disclosed === true,
  });

  // The rebuilt document is authoritative, but a mismatch means the receipt was
  // edited after signing or built by something that is not this projection.
  if (rebuilt.claims_recovery !== (candidate.claims_recovery === true)) {
    throw new Error('receipt recovery claim does not match its own record');
  }
  return rebuilt;
}
