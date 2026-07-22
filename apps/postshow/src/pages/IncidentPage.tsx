import { useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ReplayLinks } from '@/components/ReplayLinks';
import { ErrorRow, LoadingRow, Section } from '@/components/page';
import { fetchIncidentDossier, fetchPosthogReplayConfig } from '@/lib/api';
import type { Account, IncidentDossier, PosthogReplayConfig } from '@/lib/types';
import { usePageData } from '@/lib/usePageData';
import { useWorkspace } from '@/state/WorkspaceContext';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function mrr(account: Account): string {
  if (account.mrr_cents === null) return 'revenue unavailable';
  return `$${Math.round(account.mrr_cents / 100).toLocaleString()}/mo exposure`;
}

interface IncidentPageData {
  dossier: IncidentDossier;
  replay: PosthogReplayConfig | null;
}

export function IncidentPage() {
  const { incidentId = '' } = useParams();
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id ?? '';
  const fetcher = useCallback(async (): Promise<IncidentPageData> => {
    if (!UUID.test(incidentId)) throw new Error('Incident not found.');
    const [dossier, replay] = await Promise.all([
      fetchIncidentDossier(workspaceId, incidentId),
      fetchPosthogReplayConfig(workspaceId),
    ]);
    return { dossier, replay };
  }, [incidentId, workspaceId]);
  const { data, loading, error } = usePageData(fetcher);

  if (loading) return <LoadingRow />;
  if (error || !data) return <ErrorRow message={error || 'Incident not found.'} />;
  const { incident, accounts, fieldNotes, inboxItems } = data.dossier;
  const sessionIds = incident.evidence_refs.session_ids ?? [];
  const coverage = incident.evidence_refs.source_coverage ?? {};
  const coverageReasons = coverage.reasons ?? [];
  const hypothesis = incident.root_cause_hypothesis;
  const verification = incident.verification_contract;
  const outcome = incident.measured_outcome;

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
        </p>
        <h1 className="m-0 mt-3 max-w-[24ch] font-public-sans text-[clamp(28px,4vw,44px)] font-semibold leading-[1.08] tracking-[-0.03em] text-night-fg">
          {incident.title}
        </h1>
        <p className="m-0 mt-4 max-w-[72ch] font-public-sans text-[15px] leading-[1.6] text-night-fg-2">
          {incident.summary}
        </p>
      </header>

      <div className="grid gap-5 pt-6 lg:grid-cols-[1.35fr_0.65fr]">
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
