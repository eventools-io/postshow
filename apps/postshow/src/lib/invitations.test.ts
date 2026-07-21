import { beforeEach, describe, expect, it, vi } from 'vitest';
import { acceptInvitationToken, createInvitation, fetchInvitations, revokeInvitation } from './api';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('./supabase', () => ({
  supabase: {
    rpc: mocks.rpc,
    from: mocks.from,
    functions: { invoke: mocks.invoke },
  },
}));

const token = `psi_${'c'.repeat(64)}`;
const workspaceId = '00000000-0000-4000-8000-000000000001';
const requestId = '00000000-0000-4000-8000-000000000002';
const invitationId = '00000000-0000-4000-8000-000000000003';
const expiresAt = '2026-07-28T23:59:59.000Z';

function delivery(link = `https://postshow.io/invite#token=${token}`) {
  return {
    ok: true,
    invitation: {
      id: invitationId,
      workspace_name: 'Launch team',
      state: 'active',
      expires_at: expiresAt,
      link,
      delivery_state: 'delivered',
    },
  };
}

describe('invitation API', () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.from.mockReset().mockReturnValue({ select: mocks.select });
    mocks.select.mockReset().mockReturnValue({ eq: mocks.eq });
    mocks.eq.mockReset().mockReturnValue({ order: mocks.order });
    mocks.order.mockReset().mockReturnValue({ limit: mocks.limit });
    mocks.limit.mockReset().mockResolvedValue({ data: [], error: null });
    mocks.invoke.mockReset();
  });

  it('sends only a SHA-256 invitation digest to PostgreSQL during acceptance', async () => {
    mocks.rpc.mockResolvedValue({ data: workspaceId, error: null });

    await expect(acceptInvitationToken(token)).resolves.toBe(workspaceId);
    const expected = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))),
      (byte) => byte.toString(16).padStart(2, '0')
    ).join('');
    expect(mocks.rpc).toHaveBeenCalledWith('postshow_accept_invitation', {
      p_token_hash: expected,
    });
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(token);
  });

  it('rejects malformed acceptance tokens before any network call', async () => {
    await expect(acceptInvitationToken('bad-token')).rejects.toThrow(/invalid/i);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('creates an exact replayable request and accepts only a fragment bearer response', async () => {
    mocks.invoke.mockResolvedValue({ data: delivery(), error: null });

    await expect(
      createInvitation({
        requestId,
        workspaceId,
        email: ' Invitee@Example.com ',
        role: 'member',
        expiresAt,
      })
    ).resolves.toEqual(delivery().invitation);
    expect(mocks.invoke).toHaveBeenCalledWith('postshow-invitation', {
      body: {
        request_id: requestId,
        workspace_id: workspaceId,
        email: 'invitee@example.com',
        role: 'member',
        expires_at: expiresAt,
      },
    });
  });

  it('rejects query-string invitation bearers without echoing the secret', async () => {
    mocks.invoke.mockResolvedValue({
      data: delivery(`https://postshow.io/invite?token=${token}`),
      error: null,
    });

    let error: unknown;
    try {
      await createInvitation({
        requestId,
        workspaceId,
        email: 'invitee@example.com',
        role: 'member',
        expiresAt,
      });
    } catch (value) {
      error = value;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/invalid response/i);
    expect((error as Error).message).not.toContain(token);
  });

  it('rejects an invitation link on an untrusted origin', async () => {
    mocks.invoke.mockResolvedValue({
      data: delivery(`https://attacker.example/invite#token=${token}`),
      error: null,
    });

    await expect(
      createInvitation({
        requestId,
        workspaceId,
        email: 'invitee@example.com',
        role: 'member',
        expiresAt,
      })
    ).rejects.toThrow(/invalid response/i);
  });

  it('lists only non-secret invitation metadata through the scoped table query', async () => {
    mocks.limit.mockResolvedValue({
      data: [
        {
          id: invitationId,
          workspace_id: workspaceId,
          email: 'invitee@example.com',
          role: 'viewer',
          created_at: '2026-07-21T00:00:00.000Z',
          expires_at: expiresAt,
          accepted_at: null,
          revoked_at: null,
        },
      ],
      error: null,
    });

    await expect(fetchInvitations(workspaceId)).resolves.toHaveLength(1);
    expect(mocks.from).toHaveBeenCalledWith('postshow_workspace_invitations');
    expect(mocks.select).toHaveBeenCalledWith(
      'id, workspace_id, email, role, created_at, expires_at, accepted_at, revoked_at'
    );
    expect(mocks.select.mock.calls[0]?.[0]).not.toContain('token');
    expect(mocks.eq).toHaveBeenCalledWith('workspace_id', workspaceId);
  });

  it('revokes by the exact invitation RPC', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(revokeInvitation(invitationId)).resolves.toBeUndefined();
    expect(mocks.rpc).toHaveBeenCalledWith('postshow_revoke_invitation', {
      p_invitation: invitationId,
    });
  });
});
