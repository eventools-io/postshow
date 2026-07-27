import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INCIDENT_EVIDENCE_POLICY_VERSION } from '@eventools/postshow-core';
import { fetchIncidentDossier, fetchPosthogReplayConfig, fetchSentryIssueConfig } from '@/lib/api';
import type { IncidentDossier } from '@/lib/types';
import { IncidentPage } from './IncidentPage';

const INCIDENT_ID = '71000000-0000-4000-8000-000000000001';

vi.mock('@/lib/api', () => ({
  fetchIncidentDossier: vi.fn(),
  fetchPosthogReplayConfig: vi.fn(),
  fetchSentryIssueConfig: vi.fn(),
}));
vi.mock('@/state/WorkspaceContext', () => ({
  useWorkspace: () => ({ workspace: { id: 'workspace-1' } }),
}));

const fetchDossier = vi.mocked(fetchIncidentDossier);
const fetchReplay = vi.mocked(fetchPosthogReplayConfig);
const fetchSentry = vi.mocked(fetchSentryIssueConfig);

function dossier(): IncidentDossier {
  return {
    incident: {
      id: INCIDENT_ID,
      workspace_id: 'workspace-1',
      fingerprint: 'checkout-stall',
      title: 'Checkout stalls after a failed payment',
      summary: 'Two grounded sessions show the same failed recovery path.',
      lifecycle_state: 'intervention_pending',
      severity: 'high',
      revenue_exposure_cents: 12_500,
      currency: 'USD',
      evidence_refs: {
        session_ids: ['session-grounded-1'],
        account_identity_keys: ['stripe:cus_acme'],
        source_coverage: { matchedSessions: 1, unmatchedSessions: 0, sampled: true },
      },
      root_cause_hypothesis: { status: 'suspected', summary: 'Retry state may stay stale.' },
      verification_contract: { metric: 'repeat_session_count', baseline: 2, status: 'pending' },
      measured_outcome: { status: 'pending' },
      evidence_ledger: {
        policy_version: INCIDENT_EVIDENCE_POLICY_VERSION,
        evaluated_run_id: '72000000-0000-4000-8000-000000000001',
        decision: 'act',
        reason_code: 'grounded_action_ready_for_review',
        requirements: [
          {
            key: 'behavior',
            status: 'supported',
            evidence_count: 1,
            sources: ['posthog'],
            source_states: { posthog: 'sampled' },
          },
          {
            key: 'account_identity',
            status: 'supported',
            evidence_count: 1,
            sources: ['posthog', 'stripe'],
            source_states: { posthog: 'sampled', stripe: 'complete' },
          },
          {
            key: 'technical_failure',
            status: 'not_linked',
            evidence_count: 0,
            sources: ['sentry'],
            source_states: { sentry: 'complete' },
          },
          {
            key: 'code_context',
            status: 'not_linked',
            evidence_count: 0,
            sources: ['github'],
            source_states: { github: 'complete' },
          },
          {
            key: 'recovery_check',
            status: 'supported',
            evidence_count: 1,
            sources: ['postshow'],
            source_states: {},
          },
        ],
        gaps: ['technical_failure_not_linked', 'code_context_not_linked'],
        source_context: {},
      },
      first_seen_at: '2026-07-22T00:00:00.000Z',
      last_seen_at: '2026-07-22T00:00:00.000Z',
      created_at: '2026-07-22T00:00:00.000Z',
      updated_at: '2026-07-22T00:00:00.000Z',
    },
    accounts: [],
    references: [],
    fieldNotes: [],
    inboxItems: [],
  };
}

function dossierWithLinkedIssue(): IncidentDossier {
  const base = dossier();
  const ledger = base.incident.evidence_ledger;
  return {
    ...base,
    incident: {
      ...base.incident,
      evidence_ledger: {
        ...ledger,
        requirements: ledger.requirements.map((requirement) =>
          requirement.key === 'technical_failure'
            ? { ...requirement, status: 'supported' as const, evidence_count: 1 }
            : requirement
        ),
        gaps: ['code_context_not_linked'],
      },
    },
    references: [
      {
        id: '73000000-0000-4000-8000-000000000001',
        provider: 'sentry',
        object_type: 'issue',
        sentry_issue_id: '6042118',
        github_repo: null,
        github_object_id: null,
      },
    ],
  };
}

function dossierWithLinkedCodeContext(): IncidentDossier {
  const base = dossierWithLinkedIssue();
  const ledger = base.incident.evidence_ledger;
  return {
    ...base,
    incident: {
      ...base.incident,
      evidence_ledger: {
        ...ledger,
        requirements: ledger.requirements.map((requirement) =>
          requirement.key === 'code_context'
            ? { ...requirement, status: 'supported' as const, evidence_count: 1 }
            : requirement
        ),
        gaps: [],
      },
    },
    references: [
      ...base.references,
      {
        id: '73000000-0000-4000-8000-000000000002',
        provider: 'github',
        object_type: 'pull_request',
        sentry_issue_id: null,
        github_repo: 'northwind-labs/invoice-web',
        github_object_id: '812',
      },
    ],
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/incidents/${INCIDENT_ID}`]}>
      <Routes>
        <Route path="/incidents/:incidentId" element={<IncidentPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('IncidentPage evidence decision', () => {
  beforeEach(() => {
    fetchDossier.mockReset().mockResolvedValue(dossier());
    fetchReplay.mockReset().mockResolvedValue(null);
    fetchSentry.mockReset().mockResolvedValue(null);
  });

  it('shows the deterministic decision, policy, requirements, and open gaps', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: /act/i })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(INCIDENT_EVIDENCE_POLICY_VERSION, 'i'))).toBeInTheDocument();
    expect(screen.getByText(/does not execute the intervention/i)).toBeInTheDocument();
    expect(screen.getByText('Technical failure evidence')).toBeInTheDocument();
    expect(screen.getByText(/no sentry issue is linked/i)).toBeInTheDocument();
    expect(
      screen.getByText(/no github pull request, commit, or issue is linked/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /issue/i })).not.toBeInTheDocument();
  });

  it('cites each linked Sentry issue by identifier beside the requirement it supports', async () => {
    fetchDossier.mockResolvedValue(dossierWithLinkedIssue());
    fetchSentry.mockResolvedValue({ orgSlug: 'acme' });
    renderPage();

    const link = await screen.findByRole('link', { name: 'issue 6042118 ↗' });
    expect(link).toHaveAttribute('href', 'https://sentry.io/organizations/acme/issues/6042118/');
    expect(link.closest('li')?.textContent).toContain('Technical failure evidence');
    expect(screen.getAllByRole('link', { name: /^issue/ })).toHaveLength(1);
    expect(screen.queryByText(/no sentry issue is linked/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/no github pull request, commit, or issue is linked/i)
    ).toBeInTheDocument();
  });

  it('cites each linked repository object beside the code-context requirement', async () => {
    fetchDossier.mockResolvedValue(dossierWithLinkedCodeContext());
    fetchSentry.mockResolvedValue({ orgSlug: 'acme' });
    renderPage();

    const link = await screen.findByRole('link', { name: 'pull #812 ↗' });
    expect(link).toHaveAttribute('href', 'https://github.com/northwind-labs/invoice-web/pull/812');
    expect(link.closest('li')?.textContent).toContain('Code context');
    expect(
      screen.queryByText(/no github pull request, commit, or issue is linked/i)
    ).not.toBeInTheDocument();
  });

  it('says why a linked issue has no deep link when the Sentry connection is gone', async () => {
    fetchDossier.mockResolvedValue(dossierWithLinkedIssue());
    renderPage();

    expect(await screen.findByText(/reconnect sentry to open these issues/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /issue/i })).not.toBeInTheDocument();
  });
});
