import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { InvitePage } from './InvitePage';
import { acceptInvitationToken } from '@/lib/api';

const workspace = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email: string } },
  sessionLoading: false,
  reloadWorkspace: vi.fn(),
  signOut: vi.fn(),
}));
const legalAcceptance = vi.hoisted(() => ({ record: vi.fn() }));

vi.mock('@/lib/api', () => ({ acceptInvitationToken: vi.fn() }));
vi.mock('@/state/WorkspaceContext', () => ({ useWorkspace: () => workspace }));
vi.mock('@/lib/legalAcceptance', () => ({
  POSTSHOW_LEGAL_EFFECTIVE_DATE: 'July 21, 2026',
  recordPostshowLegalAcceptance: legalAcceptance.record,
}));

const acceptMock = vi.mocked(acceptInvitationToken);
const token = `psi_${'b'.repeat(64)}`;

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">{`${location.pathname}${location.search}${location.hash}`}</output>
  );
}

function renderPage(entry = `/invite#token=${token}`) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <InvitePage />
      <LocationProbe />
    </MemoryRouter>
  );
}

describe('InvitePage', () => {
  beforeEach(() => {
    workspace.session = null;
    workspace.sessionLoading = false;
    workspace.reloadWorkspace.mockReset().mockResolvedValue(undefined);
    workspace.signOut.mockReset().mockResolvedValue(undefined);
    acceptMock.mockReset();
    legalAcceptance.record.mockReset().mockResolvedValue(undefined);
  });

  it('keeps the bearer in component memory, scrubs it, and uses fragments for auth paths', async () => {
    renderPage();
    expect(screen.getByRole('link', { name: /sign in to accept/i })).toHaveAttribute(
      'href',
      `/signin#token=${token}`
    );
    expect(screen.getByRole('link', { name: /create invited account/i })).toHaveAttribute(
      'href',
      `/signin?mode=signup#token=${token}`
    );
    await waitFor(() => expect(screen.getByTestId('location')).not.toHaveTextContent(token));
    expect(screen.getByTestId('location')).toHaveTextContent('/invite');
  });

  it('accepts only after explicit confirmation and activates the returned workspace', async () => {
    workspace.session = { user: { id: 'user-1', email: 'invitee@example.com' } };
    acceptMock.mockResolvedValue('workspace-2');
    renderPage();

    expect(acceptMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /join workspace/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /I agree to Eventools LLC/i }));
    fireEvent.click(screen.getByRole('button', { name: /join workspace/i }));
    await waitFor(() =>
      expect(legalAcceptance.record).toHaveBeenCalledWith('invitation_acceptance')
    );
    await waitFor(() => expect(acceptMock).toHaveBeenCalledWith(token));
    expect(workspace.reloadWorkspace).toHaveBeenCalledWith('workspace-2');
  });

  it('rejects malformed links without exposing an acceptance control', () => {
    renderPage('/invite#token=not-a-secret');
    expect(screen.getByText(/incomplete or invalid/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /join workspace/i })).not.toBeInTheDocument();
  });

  it('rejects both legacy query bearer names while preserving unrelated parameters', async () => {
    renderPage(`/invite?token=${token}&invite=${token}&source=email`);
    expect(screen.getByText(/incomplete or invalid/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('location')).not.toHaveTextContent(token));
    expect(screen.getByTestId('location')).toHaveTextContent('/invite?source=email');
  });
});
