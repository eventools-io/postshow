import type { GatherCompleteness } from './adapters';

/** v2 stopped treating the technical-failure requirement as permanently
 * unlinkable: a validated Sentry reference now supports it, and an otherwise
 * actionable incident with gathered Sentry and no linked reference holds at
 * `gather_more`. A ledger written under v1 recorded a decision the current
 * policy would not reach, so it is not readable as a v2 decision.
 *
 * v3 does the same for code context. A validated GitHub pull request, commit,
 * or issue now supports it, and an incident that gathered GitHub without
 * linking one holds at `gather_more` instead of carrying a permanent gap. Every
 * v2 ledger recorded `code_context_not_linked` unconditionally, so a v2
 * decision cannot be read as a v3 one. */
export const INCIDENT_EVIDENCE_POLICY_VERSION = 'incident-evidence-v3';
export const SOURCE_EVIDENCE_CONTEXT_VERSION = 1 as const;

export const INCIDENT_EVIDENCE_SOURCES = ['posthog', 'stripe', 'sentry', 'github'] as const;

export type IncidentEvidenceSource = (typeof INCIDENT_EVIDENCE_SOURCES)[number];
export type SourceEvidenceState = 'complete' | 'sampled' | 'partial' | 'failed' | 'not_gathered';

export interface SourceEvidenceCoverage {
  state: SourceEvidenceState;
  returned: number;
  available: number | null;
}

export interface SourceEvidenceContext {
  version: typeof SOURCE_EVIDENCE_CONTEXT_VERSION;
  sources: Record<IncidentEvidenceSource, SourceEvidenceCoverage>;
}

type CoverageInput =
  | Pick<GatherCompleteness, 'complete' | 'sampled' | 'returned' | 'available'>
  | 'failed';

function coverage(value: CoverageInput | null | undefined): SourceEvidenceCoverage {
  if (!value) return { state: 'not_gathered', returned: 0, available: null };
  if (value === 'failed') return { state: 'failed', returned: 0, available: null };
  return {
    state: value.sampled ? 'sampled' : value.complete ? 'complete' : 'partial',
    returned: value.returned,
    available: value.available,
  };
}

/** A bounded, prose-free description of what each launch connector contributed
 * to one run. It intentionally does not claim that gathered Sentry or GitHub
 * records are evidence for a specific incident. The incident policy makes that
 * separate decision after persistence has linked exact records. */
export function sourceEvidenceContext(
  input: Partial<Record<IncidentEvidenceSource, CoverageInput | null>>
): SourceEvidenceContext {
  return {
    version: SOURCE_EVIDENCE_CONTEXT_VERSION,
    sources: {
      posthog: coverage(input.posthog),
      stripe: coverage(input.stripe),
      sentry: coverage(input.sentry),
      github: coverage(input.github),
    },
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function count(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 1_000_000) {
    throw new Error(`${label} is invalid`);
  }
  return Number(value);
}

/** Revalidates a local runtime's caller-supplied context before the managed
 * gateway commits it. Unknown sources, prose, and contradictory counts fail
 * closed so the durable ledger has one shape in every runtime. */
export function normalizeSourceEvidenceContext(value: unknown): SourceEvidenceContext {
  const context = record(value);
  if (context.version !== SOURCE_EVIDENCE_CONTEXT_VERSION) {
    throw new Error('evidence context version is invalid');
  }
  if (Object.keys(context).some((key) => !['version', 'sources'].includes(key))) {
    throw new Error('evidence context field is invalid');
  }
  const sources = record(context.sources);
  if (Object.keys(sources).some((source) => !INCIDENT_EVIDENCE_SOURCES.includes(source as never))) {
    throw new Error('evidence context source is invalid');
  }

  const normalized = {} as Record<IncidentEvidenceSource, SourceEvidenceCoverage>;
  for (const source of INCIDENT_EVIDENCE_SOURCES) {
    const candidate = record(sources[source]);
    const state = candidate.state;
    if (!['complete', 'sampled', 'partial', 'failed', 'not_gathered'].includes(String(state))) {
      throw new Error(`evidence context ${source} state is invalid`);
    }
    if (Object.keys(candidate).some((key) => !['state', 'returned', 'available'].includes(key))) {
      throw new Error(`evidence context ${source} field is invalid`);
    }
    const returned = count(candidate.returned, `evidence context ${source} returned`);
    const available =
      candidate.available === null
        ? null
        : count(candidate.available, `evidence context ${source} available`);
    if (available !== null && returned > available) {
      throw new Error(`evidence context ${source} counts contradict each other`);
    }
    if (state === 'complete' && available !== null && returned !== available) {
      throw new Error(`evidence context ${source} completeness contradicts its counts`);
    }
    if (
      (state === 'failed' || state === 'not_gathered') &&
      (returned !== 0 || available !== null)
    ) {
      throw new Error(
        `evidence context ${source} ${String(state).replace('_', '-')} state is invalid`
      );
    }
    normalized[source] = {
      state: state as SourceEvidenceState,
      returned,
      available,
    };
  }
  return { version: SOURCE_EVIDENCE_CONTEXT_VERSION, sources: normalized };
}
