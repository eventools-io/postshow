import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceProvider, useWorkspace } from './WorkspaceContext';
import type { Workspace } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signOut: vi.fn(),
  fetchWorkspaces: vi.fn(),
  bootstrapWorkspace: vi.fn(),
  unsubscribe: vi.fn(),
  identify: vi.fn(),
  resetAnalyticsOnSignOut: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: mocks.onAuthStateChange,
      signOut: mocks.signOut,
    },
  },
}));
vi.mock('@/lib/api', () => ({
  fetchWorkspaces: mocks.fetchWorkspaces,
  bootstrapWorkspace: mocks.bootstrapWorkspace,
}));
vi.mock('@/lib/analytics', () => ({
  identify: mocks.identify,
  resetAnalyticsOnSignOut: mocks.resetAnalyticsOnSignOut,
  track: vi.fn(),
}));

const first: Workspace = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'First workspace',
  plan: 'free',
  agent_rules: [],
  created_at: '2026-07-20T10:00:00.000Z',
};
const second: Workspace = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Second workspace',
  plan: 'solo',
  agent_rules: [],
  created_at: '2026-07-21T10:00:00.000Z',
};

function Probe() {
  const { workspace, workspaces, selectWorkspace, reloadWorkspace, signOut } = useWorkspace();
  return (
    <div>
      <span data-testid="workspace">{workspace?.id ?? 'none'}</span>
      <span data-testid="workspace-count">{workspaces.length}</span>
      <button type="button" onClick={() => selectWorkspace(second.id)}>
        Select second
      </button>
      <button type="button" onClick={() => selectWorkspace('not-a-membership')}>
        Select unavailable
      </button>
      <button type="button" onClick={() => void reloadWorkspace()}>
        Reload
      </button>
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
    </div>
  );
}

function renderProvider() {
  return render(
    <WorkspaceProvider>
      <Probe />
    </WorkspaceProvider>
  );
}

describe('WorkspaceProvider selection', () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
        clear: () => storage.clear(),
      },
    });
    mocks.getSession.mockReset().mockResolvedValue({
      data: { session: { user: { id: 'user-1', email: 'owner@example.com' } } },
      error: null,
    });
    mocks.onAuthStateChange.mockReset().mockReturnValue({
      data: { subscription: { unsubscribe: mocks.unsubscribe } },
    });
    mocks.fetchWorkspaces.mockReset().mockResolvedValue([first, second]);
    mocks.bootstrapWorkspace.mockReset();
    mocks.unsubscribe.mockReset();
    mocks.signOut.mockReset().mockResolvedValue({ error: null });
    mocks.identify.mockReset();
    mocks.resetAnalyticsOnSignOut.mockReset();
  });

  it('restores only a selected workspace that remains in the membership list', async () => {
    storage.set('postshow.selected-workspace-id', second.id);

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('workspace')).toHaveTextContent(second.id));
    expect(screen.getByTestId('workspace-count')).toHaveTextContent('2');
    expect([...storage.entries()]).toEqual([['postshow.selected-workspace-id', second.id]]);
  });

  it('rejects an unavailable persisted or requested workspace', async () => {
    storage.set('postshow.selected-workspace-id', '33333333-3333-4333-8333-333333333333');

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('workspace')).toHaveTextContent(first.id));
    expect(storage.get('postshow.selected-workspace-id')).toBe(first.id);
    fireEvent.click(screen.getByRole('button', { name: /select unavailable/i }));
    expect(screen.getByTestId('workspace')).toHaveTextContent(first.id);
    expect(storage.get('postshow.selected-workspace-id')).toBe(first.id);
  });

  it('fences a stale membership reload across a workspace switch', async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('workspace')).toHaveTextContent(first.id));

    let resolveReload: (value: Workspace[]) => void = () => undefined;
    const staleReload = new Promise<Workspace[]>((resolve) => {
      resolveReload = resolve;
    });
    mocks.fetchWorkspaces.mockReturnValueOnce(staleReload);
    fireEvent.click(screen.getByRole('button', { name: /^reload$/i }));
    await waitFor(() => expect(mocks.fetchWorkspaces).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('button', { name: /select second/i }));
    expect(screen.getByTestId('workspace')).toHaveTextContent(second.id);

    await act(async () => resolveReload([first]));
    expect(screen.getByTestId('workspace')).toHaveTextContent(second.id);
    expect(screen.getByTestId('workspace-count')).toHaveTextContent('2');
    expect(storage.get('postshow.selected-workspace-id')).toBe(second.id);
  });

  it('identifies only by opaque user id and resets analytics on sign-out', async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('workspace')).toHaveTextContent(first.id));

    expect(mocks.identify).toHaveBeenCalledWith('user-1');
    expect(mocks.identify.mock.calls[0]).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(1));
    expect(mocks.resetAnalyticsOnSignOut).toHaveBeenCalledTimes(1);
  });
});
