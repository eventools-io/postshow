import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWorkspacePermissions } from './api';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('./supabase', () => ({ supabase: { rpc: mocks.rpc } }));

describe('workspace permissions', () => {
  beforeEach(() => mocks.rpc.mockReset());

  it('loads every administrative capability from the database authority', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null })
      .mockResolvedValueOnce({ data: false, error: null });

    await expect(fetchWorkspacePermissions('workspace-1')).resolves.toEqual({
      workspace_id: 'workspace-1',
      operate: true,
      approve_actions: true,
      manage_settings: true,
      manage_members: true,
      manage_billing: false,
      delete_workspace: false,
    });
    expect(mocks.rpc.mock.calls).toEqual([
      ['postshow_has_permission', { p_workspace: 'workspace-1', p_permission: 'operate' }],
      ['postshow_has_permission', { p_workspace: 'workspace-1', p_permission: 'approve_actions' }],
      ['postshow_has_permission', { p_workspace: 'workspace-1', p_permission: 'manage_settings' }],
      ['postshow_has_permission', { p_workspace: 'workspace-1', p_permission: 'manage_members' }],
      ['postshow_has_permission', { p_workspace: 'workspace-1', p_permission: 'manage_billing' }],
      ['postshow_has_permission', { p_workspace: 'workspace-1', p_permission: 'delete_workspace' }],
    ]);
  });

  it('fails closed on an error or a non-boolean capability', async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: { message: 'denied' } });
    await expect(fetchWorkspacePermissions('workspace-1')).rejects.toThrow('denied');

    mocks.rpc.mockReset().mockResolvedValue({ data: 'true', error: null });
    await expect(fetchWorkspacePermissions('workspace-1')).rejects.toThrow(
      /could not be verified/i
    );
  });
});
