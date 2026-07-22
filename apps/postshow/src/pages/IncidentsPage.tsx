import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorRow, LoadingRow, PageHeader } from '@/components/page';
import { fetchIncidents } from '@/lib/api';
import type { CustomerIncident } from '@/lib/types';
import { usePageData } from '@/lib/usePageData';
import { useWorkspace } from '@/state/WorkspaceContext';

const SEVERITY = { high: 'text-bad', medium: 'text-warn', low: 'text-night-fg-3' } as const;

function exposure(incident: CustomerIncident): string {
  if (incident.revenue_exposure_cents === null || !/^[A-Z]{3}$/.test(incident.currency)) return '';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: incident.currency,
    maximumFractionDigits: 0,
  }).format(incident.revenue_exposure_cents / 100);
}

function IncidentRow({ incident }: { incident: CustomerIncident }) {
  const sessions = incident.evidence_refs.session_ids?.length ?? 0;
  const sampled = incident.evidence_refs.source_coverage?.sampled === true;
  return (
    <li>
      <Link
        to={`/incidents/${incident.id}`}
        className="ps-card group block p-5 text-night-fg no-underline hover:border-night-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 flex flex-wrap gap-3 font-public-mono text-[10px] font-medium uppercase tracking-[0.13em]">
            <span className={SEVERITY[incident.severity]}>{incident.severity}</span>
            <span className="text-signal">{incident.lifecycle_state.replaceAll('_', ' ')}</span>
            {sampled ? <span className="text-warn">sampled evidence</span> : null}
          </p>
          <span className="font-public-mono text-[10px] text-night-fg-3 group-hover:text-night-fg-2">
            review →
          </span>
        </div>
        <h2 className="m-0 mt-2 font-public-sans text-[17px] font-semibold tracking-[-0.01em]">
          {incident.title}
        </h2>
        <p className="m-0 mt-2 max-w-[72ch] font-public-sans text-[13px] leading-[1.55] text-night-fg-2">
          {incident.summary || 'Evidence has been grouped; the incident summary is still forming.'}
        </p>
        <p className="m-0 mt-4 flex flex-wrap gap-x-5 gap-y-1 font-public-mono text-[10px] uppercase tracking-[0.11em] text-night-fg-3">
          <span>
            {sessions} grounded replay{sessions === 1 ? '' : 's'}
          </span>
          {exposure(incident) ? <span>{exposure(incident)} revenue exposure</span> : null}
          <span>last seen {new Date(incident.last_seen_at).toLocaleDateString()}</span>
        </p>
      </Link>
    </li>
  );
}

export function IncidentsPage() {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id ?? '';
  const fetcher = useCallback(() => fetchIncidents(workspaceId), [workspaceId]);
  const { data, loading, error } = usePageData(fetcher);
  const incidents = data ?? [];
  return (
    <div>
      <PageHeader
        title="Customer incidents"
        sub="One review surface for the behavior, affected accounts, suspected product cause, proposed interventions, and the check that closes the loop."
      />
      {loading ? <LoadingRow /> : null}
      {error ? <ErrorRow message={error} /> : null}
      {!loading && !error && incidents.length === 0 ? (
        <EmptyState
          title="No customer incidents yet."
          body="Run a session sweep with PostHog connected. Postshow will group corroborating sessions and keep uncertainty visible instead of manufacturing a case."
          cta={{ label: 'Check the work plan', to: '/work-plan' }}
        />
      ) : null}
      {incidents.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {incidents.map((incident) => (
            <IncidentRow key={incident.id} incident={incident} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
