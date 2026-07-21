import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPublicReleaseGates } from './auth';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('./supabase', () => ({ supabase: { rpc: mocks.rpc } }));

describe('public release gates', () => {
  beforeEach(() => mocks.rpc.mockReset());

  it('loads the database-owned launch gates', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        signup: false,
        checkout: true,
        hosted_runtime: true,
        plan_changes: false,
        workspace_export: true,
        workspace_deletion: false,
      },
      error: null,
    });

    await expect(fetchPublicReleaseGates()).resolves.toEqual({
      signup: false,
      checkout: true,
      hosted_runtime: true,
      plan_changes: false,
      workspace_export: true,
      workspace_deletion: false,
    });
    expect(mocks.rpc).toHaveBeenCalledWith('postshow_public_release_gates');
  });

  it('fails closed on a malformed gate response', async () => {
    mocks.rpc.mockResolvedValue({ data: { signup: 'yes' }, error: null });
    await expect(fetchPublicReleaseGates()).rejects.toThrow(/could not be verified/i);
  });
});
