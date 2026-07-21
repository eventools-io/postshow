import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiToken, fetchApiTokens } from './api';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('./supabase', () => ({
  supabase: {
    from: mocks.from,
    functions: { invoke: mocks.invoke },
  },
}));

const workspaceId = '11111111-1111-4111-8111-111111111111';
const tokenRow = {
  id: '22222222-2222-4222-8222-222222222222',
  workspace_id: workspaceId,
  name: 'Production CLI',
  token_prefix: 'psh_0123456789ab',
  scopes: ['workspace:read', 'inbox:read', 'inbox:skip'],
  expires_at: '2026-10-19T12:00:00.000Z',
  created_at: '2026-07-21T12:00:00.000Z',
  last_used_at: null,
  revoked_at: null,
};

describe('access token response contracts', () => {
  beforeEach(() => {
    const query = { select: mocks.select, eq: mocks.eq, order: mocks.order };
    mocks.from.mockReset().mockReturnValue(query);
    mocks.select.mockReset().mockReturnValue(query);
    mocks.eq.mockReset().mockReturnValue(query);
    mocks.order.mockReset().mockResolvedValue({ data: [tokenRow], error: null });
    mocks.invoke.mockReset();
  });

  it('fetches and preserves every token scope and exact expiration', async () => {
    await expect(fetchApiTokens(workspaceId)).resolves.toEqual([tokenRow]);
    expect(mocks.from).toHaveBeenCalledWith('postshow_api_tokens');
    expect(mocks.select).toHaveBeenCalledWith(
      'id, workspace_id, name, token_prefix, scopes, expires_at, created_at, last_used_at, revoked_at'
    );
    expect(mocks.eq).toHaveBeenCalledWith('workspace_id', workspaceId);
  });

  it('fails closed if a stored token omits or corrupts its authority fields', async () => {
    mocks.order.mockResolvedValueOnce({
      data: [{ ...tokenRow, scopes: undefined }],
      error: null,
    });
    await expect(fetchApiTokens(workspaceId)).rejects.toThrow(/invalid scopes/i);

    mocks.order.mockResolvedValueOnce({
      data: [{ ...tokenRow, expires_at: 'not-a-date' }],
      error: null,
    });
    await expect(fetchApiTokens(workspaceId)).rejects.toThrow(/invalid expiration/i);
  });

  it('returns the exact scope and expiry contract for a newly minted token', async () => {
    const rawToken = `psh_${'a'.repeat(64)}`;
    mocks.invoke.mockResolvedValue({
      data: {
        ok: true,
        token: rawToken,
        token_prefix: rawToken.slice(0, 16),
        scopes: ['workspace:read', 'jobs:read', 'jobs:run'],
        expires_at: '2026-11-15T09:30:00.000Z',
      },
      error: null,
    });

    await expect(createApiToken(workspaceId, 'Production CLI')).resolves.toEqual({
      ok: true,
      token: rawToken,
      token_prefix: rawToken.slice(0, 16),
      scopes: ['workspace:read', 'jobs:read', 'jobs:run'],
      expires_at: '2026-11-15T09:30:00.000Z',
    });
    expect(mocks.invoke).toHaveBeenCalledWith('postshow-token', {
      body: { workspace_id: workspaceId, name: 'Production CLI' },
    });
  });

  it.each([
    {},
    { ok: 'true' },
    {
      ok: true,
      token: `psh_${'b'.repeat(64)}`,
      token_prefix: `psh_${'b'.repeat(12)}`,
      scopes: [],
      expires_at: '2026-11-15T09:30:00.000Z',
    },
  ])('rejects an incomplete or non-boolean mint response %#', async (data) => {
    mocks.invoke.mockResolvedValue({ data, error: null });
    await expect(createApiToken(workspaceId, 'Production CLI')).rejects.toThrow();
  });
});
