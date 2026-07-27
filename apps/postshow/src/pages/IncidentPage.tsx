import { useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ReplayLinks } from '@/components/ReplayLinks';
import { SentryIssueLinks } from '@/components/SentryIssueLinks';
import { ErrorRow, LoadingRow, Section } from '@/components/page';
import { fetchIncidentDossier, fetchPosthogReplayConfig, fetchSentryIssueConfig } from '@/lib/api';
import type {
  Account,
  IncidentDossier,
  IncidentEvidenceDecision,
  IncidentEvidenceRequirement,
  PosthogReplayConfig,
  SentryIssueConfig,
} from '@/lib/types';
import { usePageData } from '@/lib/usePageData';
import { useWorkspace } from '@/state/WorkspaceContext';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const REQUIREMENT_LABELS: Record<IncidentEvidenceRequirement['key'], string> = {
  behavior: 'Behavior evidence',
  account_identity: 'Account identity',
  technical_failure: 'Technical failure evidence',
  code_context: 'Code context',
  recovery_check: 'Recovery check',
};

const GAP_LABELS: Record<string, string> = {
  account_identity_not_grounded: 'No affected account is grounded to this incident yet.',
  technical_failure_not_linked: 'No Sentry issue is linked to this incident yet.',
  code_context_not_linked:
    'No GitHub code reference is linked. Postshow does not attach repository objects to incidents yet, so this gap stays open on every incident.',
  recovery_check_missing: 'The recovery check is not measurable yet.',
  behavior_evidence_missing: 'No source-grounded behavior evidence remains attached.',
  evidence_not_evaluated: 'The evidence decision is unavailable for this incident.',
};

function decisionCopy(decision: IncidentEvidenceDecision): string {
  if (decision === 'act') {
    return 'The grounded evidence clears the threshold for human review. This decision does not execute the intervention.';
  }
  if (decision === 'abstain') {
    return 'The evidence does not clear the minimum incident-action threshold, so Postshow stopped.';
  }
  return 'The incident is worth retaining, but the next intervention needs more evidence before review.';
}

function requirementTone(status: IncidentEvidenceRequirement['status']): string {
  if (status === 'supported') return 'text-signal';
  if (status === 'partial') return 'text-warn';
  return 'text-night-fg-3';
}

function mrr(account: Account): string {
  if (account.mrr_cents === null) return 'revenue unavailable';
  return `$${Math.round(account.mrr_cents / 100).toLocaleString()}/mo exposure`;
}

interface IncidentPageData {
  dossier: IncidentDossier;
  replay: PosthogReplayConfig | null;
  sentry: SentryIssueConfig | null;
}

export function IncidentPage() {
  const { incidentId = '' } = useParams();
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id ?? '';
  const fetcher = useCallback(async (): Promise<IncidentPageData> => {
    if (!UUID.test(incidentId)) throw new Error('Incident not found.');
    const [dossier, replay, sentry] = await Promise.all([
      fetchIncidentDossier(workspaceId, incidentId),
      fetchPosthogReplayConfig(workspaceId),
      fetchSentryIssueConfig(workspaceId),
    ]);
    return { dossier, replay, sentry };
  }, [incidentId, workspaceId]);
  const { data, loading, error } = usePageData(fetcher);

  if (loading) return <LoadingRow />;
  if (error || !data) return <ErrorRow message={error || 'Incident not found.'} />;
  const { incident, accounts, references, fieldNotes, inboxItems } = data.dossier;
  const sentryReferences = references.filter(
    (reference) => reference.provider === 'sentry' && reference.object_type === 'issue'
  );
  const sessionIds = incident.evidence_refs.session_ids ?? [];
  const coverage = incident.evidence_refs.source_coverage ?? {};
  const coverageReasons = coverage.reasons ?? [];
  const hypothesis = incident.root_cause_hypothesis;
  const verification = incident.verification_contract;
  const outcome = incident.measured_outcome;
  const ledger = incident.evidence_ledger;

  return (
    <article>
      <Link
        to="/incidents"
        className="font-public-mono text-[10px] uppercase tracking-[0.12em] text-night-fg-3 hover:text-night-fg"
      >
        ← customer incidents
      </Link>
      <header className="mt-5 border-b border-night-3 pb-6">
        <p className="m-0 flex flex-wrap gap-3 font-public-mono text-[10px] font-medium uppercase tracking-[0.14em]">
          <span className="text-signal">{incident.lifecycle_state.replaceAll('_', ' ')}</span>
          <span className={incident.severity === 'high' ? 'text-bad' : 'text-warn'}>
            {incident.severity} severity
          </span>
          {coverage.sampled ? <span className="text-warn">sampled run coverage</span> : null}
          <span className={ledger.decision === 'act' ? 'text-signal' : 'text-warn'}>
            decision: {ledger.decision.replaceAll('_', ' ')}
          </span>
        </p>
        <h1 className="m-0 mt-3 max-w-[24ch] font-public-sans text-[clamp(28px,4vw,44px)] font-semibold leading-[1.08] tracking-[-0.03em] text-night-fg">
          {incident.title}
        </h1>
        <p className="m-0 mt-4 max-w-[72ch] font-public-sans text-[15px] leading-[1.6] text-night-fg-2">
          {incident.summary}
        </p>
      </header>

      <section className="pt-6" aria-labelledby="evidence-decision-title">
        <div className="ps-card overflow-hidden">
          <div className="grid gap-4 border-b border-night-3 p-5 md:grid-cols-[0.7fr_1.3fr]">
            <div>
              <p className="mk-eyebrow m-0 text-signal">evidence decision</p>
              <h2
                id="evidence-decision-title"
                className="m-0 mt-2 font-public-sans text-[24px] font-semibold capitalize tracking-[-0.02em]"
              >
                {ledger.decision.replaceAll('_', ' ')}
              </h2>
              <p className="m-0 mt-2 font-public-mono text-[10px] uppercase tracking-[0.1em] text-night-fg-3">
                {ledger.policy_version} · {ledger.reason_code.replaceAll('_', ' ')}
              </p>
            </div>
            <p className="m-0 max-w-[68ch] font-public-sans text-[14px] leading-[1.6] text-night-fg-2">
              {decisionCopy(ledger.decision)} The model may propose a cause or action, but this
              policy-owned decision is derived from persisted evidence.
            </p>
          </div>
          <ul className="m-0 grid list-none p-0 md:grid-cols-5">
            {ledger.requirements.map((requirement) => (
              <li
                key={requirement.key}
                className="border-b border-night-3 p-4 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0"
              >
                <p className="m-0 font-public-sans text-[12px] font-medium">
                  {REQUIREMENT_LABELS[requirement.key]}
                </p>
                <p
                  className={`m-0 mt-2 font-public-mono text-[10px] uppercase tracking-[0.1em] ${requirementTone(requirement.status)}`}
                >
                  {requirement.status.replaceAll('_', ' ')}
                </p>
                <p className="m-0 mt-1 font-public-mono text-[9px] text-night-fg-3">
                  {requirement.evidence_count} linked · {requirement.sources.join(' + ')}
                </p>
                {requirement.key === 'technical_failure' && sentryReferences.length > 0 ? (
                  <div className="mt-2">
                    <SentryIssueLinks references={sentryReferences} config={data.sentry} />
                    {!data.sentry ? (
                      <p className="m-0 font-public-mono text-[9px] text-night-fg-3">
                        Reconnect Sentry to open these issues.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {ledger.gaps.length > 0 ? (
            <div className="border-t border-night-3 px-5 py-4">
              <p className="m-0 font-public-mono text-[10px] uppercase tracking-[0.11em] text-night-fg-3">
                open evidence gaps
              </p>
              <ul className="mb-0 mt-2 pl-5 font-public-sans text-[12px] leading-[1.55] text-warn">
                {ledger.gaps.map((gap) => (
                  <li key={gap}>{GAP_LABELS[gap] ?? gap.replaceAll('_', ' ')}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </section>

      <div className="grid gap-5 pt-5 lg:grid-cols-[1.35fr_0.65fr]">
        <section className="ps-card p-5">
          <p className="mk-eyebrow m-0 text-signal">behavior evidence</p>
          <h2 className="m-0 mt-2 font-public-sans text-[19px] font-semibold">
            {sessionIds.length} grounded replay{sessionIds.length === 1 ? '' : 's'}
          </h2>
          <p className="m-0 mt-2 font-public-sans text-[13px] leading-[1.55] text-night-fg-2">
            Run sample coverage: {coverage.matchedSessions ?? sessionIds.length} sessions matched an
            account; {coverage.unmatchedSessions ?? 0} remained unattributed. These run-level counts
            provide collection context and are not specific to this incident.
          </p>
          <div className="mt-4">
            <ReplayLinks sessionIds={sessionIds} config={data.replay} />
          </div>
          {!data.replay && sessionIds.length > 0 ? (
            <p className="m-0 mt-3 font-public-mono text-[10px] text-night-fg-3">
              Connect the matching PostHog project to open replays.
            </p>
          ) : null}
          {coverageReasons.length > 0 ? (
            <ul className="mb-0 mt-4 pl-5 font-public-sans text-[12px] leading-[1.55] text-warn">
              {coverageReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="ps-card p-5">
          <p className="mk-eyebrow m-0 text-signal">account impact</p>
          <p className="m-0 mt-2 font-public-sans text-[26px] font-semibold tracking-[-0.02em]">
            {incident.revenue_exposure_cents === null || !incident.currency
              ? 'Not safely summable'
              : new Intl.NumberFormat(undefined, {
                  style: 'currency',
                  currency: incident.currency,
                  maximumFractionDigits: 0,
                }).format(incident.revenue_exposure_cents / 100)}
          </p>
          <p className="m-0 mt-1 font-public-mono text-[10px] uppercase tracking-[0.11em] text-night-fg-3">
            current revenue exposure · not saved revenue
          </p>
          <ul className="m-0 mt-4 list-none border-t border-night-3 p-0">
            {accounts.map(({ account, confidence }) => (
              <li key={account.id} className="border-b border-night-3 py-3">
                <span className="block font-public-sans text-[13px] font-medium">
                  {account.name}
                </span>
                <span className="font-public-mono text-[10px] text-night-fg-3">
                  {mrr(account)} · {Math.round(confidence * 100)}% source match
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <Section title="Suspected product cause">
        <div className="ps-card p-5">
          <p className="m-0 font-public-mono text-[10px] uppercase tracking-[0.12em] text-warn">
            {hypothesis.status ?? 'unverified'} · hypothesis, not a confirmed cause
          </p>
          <p className="m-0 mt-2 max-w-[72ch] font-public-sans text-[14px] leading-[1.6] text-night-fg-2">
            {hypothesis.summary ||
              'The current evidence does not support a product-cause hypothesis yet.'}
          </p>
        </div>
      </Section>

      <Section title="Proposed interventions">
        {inboxItems.length > 0 ? (
          <div className="ps-card divide-y divide-night-3">
            {inboxItems.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="m-0 font-public-sans text-[14px] font-medium">{item.title}</p>
                  <p className="m-0 mt-1 font-public-mono text-[10px] uppercase tracking-[0.1em] text-night-fg-3">
                    {item.action_type.replaceAll('_', ' ')} · {item.state}
                  </p>
                </div>
                <Link to="/inbox" className="ps-btn-ghost">
                  Review in inbox
                </Link>
              </div>
            ))}
          </div>
        ) : (
          <p className="m-0 font-public-sans text-[13px] text-night-fg-3">
            No intervention has cleared the review threshold yet.
          </p>
        )}
      </Section>

      <Section title="Verification plan">
        <div className="ps-card grid gap-4 p-5 sm:grid-cols-3">
          <div>
            <p className="m-0 font-public-mono text-[10px] uppercase tracking-[0.11em] text-night-fg-3">
              metric
            </p>
            <p className="m-0 mt-1 font-public-sans text-[14px]">
              {verification.metric ?? 'repeat session count'}
            </p>
          </div>
          <div>
            <p className="m-0 font-public-mono text-[10px] uppercase tracking-[0.11em] text-night-fg-3">
              baseline
            </p>
            <p className="m-0 mt-1 font-public-sans text-[14px]">
              {verification.baseline ?? 'not set'}
            </p>
          </div>
          <div>
            <p className="m-0 font-public-mono text-[10px] uppercase tracking-[0.11em] text-night-fg-3">
              outcome
            </p>
            <p className="m-0 mt-1 font-public-sans text-[14px]">
              {String(outcome.status ?? 'pending')}
            </p>
          </div>
        </div>
      </Section>

      {fieldNotes.length > 1 ? (
        <p className="mt-8 font-public-mono text-[10px] text-night-fg-3">
          {fieldNotes.length} observations have accumulated under this stable incident fingerprint.
        </p>
      ) : null}
    </article>
  );
}
