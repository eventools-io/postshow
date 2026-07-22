import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchIncidentDossier, fetchPosthogReplayConfig } from '@/lib/api';
import type { IncidentDossier } from '@/lib/types';
import { IncidentPage } from './IncidentPage';

const INCIDENT_ID = '71000000-0000-4000-8000-000000000001';

vi.mock('@/lib/api', () => ({
  fetchIncidentDossier: vi.fn(),
  fetchPosthogReplayConfig: vi.fn(),
}));
vi.mock('@/state/WorkspaceContext', () => ({
  useWorkspace: () => ({ workspace: { id: 'workspace-1' } }),
}));

const fetchDossier = vi.mocked(fetchIncidentDossier);
const fetchReplay = vi.mocked(fetchPosthogReplayConfig);

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
        policy_version: 'incident-evidence-v1',
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
    fieldNotes: [],
    inboxItems: [],
  };
}

describe('IncidentPage evidence decision', () => {
  beforeEach(() => {
    fetchDossier.mockReset().mockResolvedValue(dossier());
    fetchReplay.mockReset().mockResolvedValue(null);
  });

  it('shows the deterministic decision, policy, requirements, and open gaps', async () => {
    render(
      <MemoryRouter initialEntries={[`/incidents/${INCIDENT_ID}`]}>
        <Routes>
          <Route path="/incidents/:incidentId" element={<IncidentPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: /act/i })).toBeInTheDocument();
    expect(screen.getByText(/incident-evidence-v1/i)).toBeInTheDocument();
    expect(screen.getByText(/does not execute the intervention/i)).toBeInTheDocument();
    expect(screen.getByText('Technical failure evidence')).toBeInTheDocument();
    expect(screen.getByText(/no sentry issue is linked/i)).toBeInTheDocument();
    expect(screen.getByText(/no github code reference is linked/i)).toBeInTheDocument();
  });
});
