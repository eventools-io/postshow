import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deletePostshowAccount } from './accountDeletion';
import { invokePostshowFunction } from './functionClient';

vi.mock('./functionClient', () => ({ invokePostshowFunction: vi.fn() }));
const invoke = vi.mocked(invokePostshowFunction);

describe('account deletion service', () => {
  beforeEach(() => invoke.mockReset());

  it('binds exact confirmation proof to a captured fresh access token', async () => {
    invoke.mockResolvedValue({
      ok: true,
      receipt: {
        request_id: '00000000-0000-4000-8000-000000000004',
        deleted_at: '2026-07-21T20:00:01.000Z',
      },
    });

    await expect(deletePostshowAccount('person@example.com', 'fresh-jwt')).resolves.toEqual({
      request_id: '00000000-0000-4000-8000-000000000004',
      deleted_at: '2026-07-21T20:00:01.000Z',
    });
    expect(invoke).toHaveBeenCalledWith(
      'postshow-account-deletion',
      { email: 'person@example.com', confirmation: 'DELETE MY ACCOUNT' },
      { accessToken: 'fresh-jwt' }
    );
  });

  it('rejects an expanded or malformed receipt contract', async () => {
    invoke.mockResolvedValue({
      ok: true,
      receipt: {
        request_id: '00000000-0000-4000-8000-000000000004',
        deleted_at: '2026-07-21T20:00:01.000Z',
        email: 'must-not-be-returned@example.com',
      },
    });
    await expect(deletePostshowAccount('person@example.com', 'fresh-jwt')).rejects.toThrow(
      /invalid deletion receipt/i
    );
  });
});
