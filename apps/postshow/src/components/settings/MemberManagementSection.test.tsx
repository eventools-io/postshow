import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemberManagementSection } from './MemberManagementSection';
import {
  createInvitation,
  fetchEntitlements,
  fetchInvitations,
  fetchMembers,
  removeMember,
  revokeInvitation,
  setMemberRole,
  transferWorkspaceOwnership,
} from '@/lib/api';
import { PostshowFunctionError } from '@/lib/functionClient';
import type { WorkspaceInvitation } from '@/lib/types';

vi.mock('@/lib/api', () => ({
  createInvitation: vi.fn(),
  fetchMembers: vi.fn(),
  fetchInvitations: vi.fn(),
  fetchEntitlements: vi.fn(),
  removeMember: vi.fn(),
  revokeInvitation: vi.fn(),
  setMemberRole: vi.fn(),
  transferWorkspaceOwnership: vi.fn(),
}));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

const members = vi.mocked(fetchMembers);
const invitations = vi.mocked(fetchInvitations);
const entitlements = vi.mocked(fetchEntitlements);
const create = vi.mocked(createInvitation);
const revoke = vi.mocked(revokeInvitation);
const remove = vi.mocked(removeMember);
const setRole = vi.mocked(setMemberRole);
const transfer = vi.mocked(transferWorkspaceOwnership);
const invitationLink = `https://postshow.io/invite#token=psi_${'b'.repeat(64)}`;

function invitation(overrides: Partial<WorkspaceInvitation> = {}): WorkspaceInvitation {
  return {
    id: '00000000-0000-4000-8000-000000000101',
    workspace_id: '00000000-0000-4000-8000-000000000001',
    email: 'pending@example.com',
    role: 'member',
    created_at: '2026-07-21T00:00:00.000Z',
    expires_at: '2099-07-28T23:59:59.000Z',
    accepted_at: null,
    revoked_at: null,
    ...overrides,
  };
}

function delivery(deliveryState: 'delivered' | 'failed' = 'delivered') {
  return {
    id: '00000000-0000-4000-8000-000000000109',
    workspace_name: 'Launch team',
    state: 'active' as const,
    expires_at: '2099-07-28T23:59:59.000Z',
    link: invitationLink,
    delivery_state: deliveryState,
  };
}

async function submitInvite(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText(/^email$/i), 'Invitee@Example.com ');
  await user.click(screen.getByRole('button', { name: /send invitation/i }));
}

describe('MemberManagementSection', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    members.mockReset().mockResolvedValue([
      {
        user_id: 'owner-1',
        email: 'owner@example.com',
        role: 'owner',
        created_at: '2026-07-20T00:00:00Z',
      },
      {
        user_id: 'member-2',
        email: 'teammate@example.com',
        role: 'viewer',
        created_at: '2026-07-21T00:00:00Z',
      },
    ]);
    invitations.mockReset().mockResolvedValue([]);
    entitlements.mockReset().mockResolvedValue({
      workspace_id: 'workspace-1',
      sessions_watched: null,
      deep_dives: null,
      investigations: null,
      seats: 5,
      metered: false,
    });
    create.mockReset().mockResolvedValue(delivery());
    revoke.mockReset().mockResolvedValue(undefined);
    remove.mockReset().mockResolvedValue(undefined);
    setRole.mockReset().mockResolvedValue(undefined);
    transfer.mockReset().mockResolvedValue(undefined);
  });

  it('changes a non-owner role through the exact role RPC', async () => {
    const user = userEvent.setup();
    render(<MemberManagementSection workspaceId="workspace-1" planId="team" actorId="owner-1" />);
    const select = await screen.findByRole('combobox', { name: /role for teammate/i });
    await user.selectOptions(select, 'member');
    await waitFor(() => expect(setRole).toHaveBeenCalledWith('workspace-1', 'member-2', 'member'));
  });

  it('requires the exact destination email before ownership transfer', async () => {
    const user = userEvent.setup();
    render(<MemberManagementSection workspaceId="workspace-1" planId="team" actorId="owner-1" />);
    await user.click(await screen.findByRole('button', { name: /transfer ownership/i }));
    const confirm = screen.getByRole('button', { name: /confirm ownership transfer/i });
    expect(confirm).toBeDisabled();
    await user.type(
      screen.getByLabelText(/ownership transfer confirmation/i),
      'TRANSFER TO teammate@example.com'
    );
    await user.click(confirm);
    await waitFor(() => expect(transfer).toHaveBeenCalledWith('workspace-1', 'member-2'));
  });

  it('uses a second explicit action before removing a member', async () => {
    const user = userEvent.setup();
    render(<MemberManagementSection workspaceId="workspace-1" planId="team" actorId="owner-1" />);
    await user.click(await screen.findByRole('button', { name: /^remove$/i }));
    expect(remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /confirm removal/i }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('workspace-1', 'member-2'));
  });

  it('sends a canonical invitation and exposes the fragment link after confirmed delivery', async () => {
    const user = userEvent.setup();
    render(<MemberManagementSection workspaceId="workspace-1" planId="team" actorId="owner-1" />);
    await submitInvite(user);

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        email: 'invitee@example.com',
        role: 'member',
        requestId: expect.any(String),
        expiresAt: expect.stringMatching(/T23:59:59\.000Z$/),
      })
    );
    expect(await screen.findByText(/invitation email delivered/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/invitation link/i)).toHaveValue(invitationLink);
  });

  it('keeps a failed provider delivery active with an accessible manual-copy fallback', async () => {
    create.mockResolvedValue(delivery('failed'));
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(<MemberManagementSection workspaceId="workspace-1" planId="team" actorId="owner-1" />);
    await submitInvite(user);

    expect(await screen.findByText(/email delivery failed/i)).toBeInTheDocument();
    const link = screen.getByLabelText(/invitation link/i);
    expect(link).toHaveAttribute('readonly');
    expect(link).toHaveValue(invitationLink);
    await user.click(screen.getByRole('button', { name: /copy invitation link/i }));
    expect(await screen.findByText(/select and copy.*manually/i)).toBeInTheDocument();
  });

  it('replays the exact request id after an uncertain response', async () => {
    create
      .mockRejectedValueOnce(
        new PostshowFunctionError(
          'Invitation delivery is temporarily unavailable.',
          'invitation_delivery_unavailable',
          503
        )
      )
      .mockResolvedValueOnce(delivery());
    const user = userEvent.setup();
    render(<MemberManagementSection workspaceId="workspace-1" planId="team" actorId="owner-1" />);
    await submitInvite(user);
    expect(await screen.findByText(/retry this exact invitation/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /send invitation/i }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1]?.[0].requestId).toBe(create.mock.calls[0]?.[0].requestId);
    expect(create.mock.calls[1]?.[0].expiresAt).toBe(create.mock.calls[0]?.[0].expiresAt);
  });

  it('fails closed at the seat limit and presents authorization loss safely', async () => {
    entitlements.mockResolvedValue({
      workspace_id: 'workspace-1',
      sessions_watched: null,
      deep_dives: null,
      investigations: null,
      seats: 2,
      metered: false,
    });
    const { unmount } = render(
      <MemberManagementSection workspaceId="workspace-1" planId="team" actorId="owner-1" />
    );
    expect(await screen.findByText(/every seat is assigned or reserved/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /send invitation/i })).not.toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
    unmount();

    entitlements.mockResolvedValue({
      workspace_id: 'workspace-1',
      sessions_watched: null,
      deep_dives: null,
      investigations: null,
      seats: 5,
      metered: false,
    });
    create.mockRejectedValue(new PostshowFunctionError('Not authorized.', 'not_authorized', 403));
    const user = userEvent.setup();
    render(<MemberManagementSection workspaceId="workspace-1" planId="team" actorId="owner-1" />);
    await submitInvite(user);
    expect(await screen.findByText(/no longer have permission/i)).toBeInTheDocument();
  });

  it('lists active, accepted, revoked, and expired invitations and confirms revocation', async () => {
    invitations.mockResolvedValue([
      invitation(),
      invitation({
        id: '00000000-0000-4000-8000-000000000102',
        email: 'accepted@example.com',
        accepted_at: '2026-07-21T01:00:00.000Z',
      }),
      invitation({
        id: '00000000-0000-4000-8000-000000000103',
        email: 'revoked@example.com',
        revoked_at: '2026-07-21T01:00:00.000Z',
      }),
      invitation({
        id: '00000000-0000-4000-8000-000000000104',
        email: 'expired@example.com',
        expires_at: '2020-07-21T01:00:00.000Z',
      }),
    ]);
    const user = userEvent.setup();
    render(<MemberManagementSection workspaceId="workspace-1" planId="team" actorId="owner-1" />);

    expect(await screen.findByText(/active · reserves a seat/i)).toBeInTheDocument();
    expect(screen.getByText(/member · accepted/i)).toBeInTheDocument();
    expect(screen.getByText(/member · revoked/i)).toBeInTheDocument();
    expect(screen.getByText(/member · expired/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^revoke$/i }));
    expect(revoke).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /confirm revoke/i }));
    await waitFor(() =>
      expect(revoke).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000101')
    );
  });

  it('does not expose invitation controls to non-managers or let an admin revoke admin access', async () => {
    invitations.mockResolvedValue([invitation({ role: 'admin' })]);
    const { rerender } = render(
      <MemberManagementSection workspaceId="workspace-1" planId="team" actorId="member-2" />
    );
    await screen.findByText(/teammate@example.com/i);
    expect(screen.queryByRole('heading', { name: /invitations/i })).not.toBeInTheDocument();

    members.mockResolvedValue([
      {
        user_id: 'owner-1',
        email: 'owner@example.com',
        role: 'owner',
        created_at: '2026-07-20T00:00:00Z',
      },
      {
        user_id: 'admin-2',
        email: 'admin@example.com',
        role: 'admin',
        created_at: '2026-07-21T00:00:00Z',
      },
    ]);
    rerender(<MemberManagementSection workspaceId="workspace-2" planId="team" actorId="admin-2" />);
    expect(await screen.findByRole('heading', { name: /invitations/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^revoke$/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/invitation role/i)).not.toContainHTML('value="admin"');
  });
});
