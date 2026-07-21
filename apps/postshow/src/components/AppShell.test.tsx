import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { AppShell } from './AppShell';

const mocks = vi.hoisted(() => ({
  selectWorkspace: vi.fn(),
  signOut: vi.fn(),
  fetchInbox: vi.fn(),
  fetchEngine: vi.fn(),
  context: {
    workspace: {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'First workspace',
    },
    workspaces: [
      { id: '11111111-1111-4111-8111-111111111111', name: 'First workspace' },
      { id: '22222222-2222-4222-8222-222222222222', name: 'Second workspace' },
    ],
  },
}));

vi.mock('@/state/WorkspaceContext', () => ({
  useWorkspace: () => ({
    ...mocks.context,
    selectWorkspace: mocks.selectWorkspace,
    signOut: mocks.signOut,
  }),
}));
vi.mock('@/lib/api', () => ({
  fetchInbox: mocks.fetchInbox,
  fetchEngine: mocks.fetchEngine,
}));

function SettingsProbe() {
  const location = useLocation();
  const [draft, setDraft] = useState('');
  return (
    <div>
      Settings page
      <span data-testid="location-search">{location.search}</span>
      <input
        aria-label="Workspace draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    </div>
  );
}

function shell(initialEntry: string) {
  return (
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="inbox" element={<div>Inbox page</div>} />
          <Route path="settings" element={<SettingsProbe />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('AppShell workspace switcher', () => {
  beforeEach(() => {
    mocks.context.workspace = mocks.context.workspaces[0]!;
    mocks.selectWorkspace.mockReset().mockReturnValue(true);
    mocks.signOut.mockReset();
    mocks.fetchInbox.mockReset().mockReturnValue(new Promise(() => undefined));
    mocks.fetchEngine.mockReset().mockReturnValue(new Promise(() => undefined));
  });

  it('exposes the member workspaces through labeled native controls', () => {
    render(shell('/inbox'));

    const switchers = screen.getAllByRole('combobox', { name: /workspace/i });
    expect(switchers).toHaveLength(2);
    expect(screen.getByText('Inbox page')).toBeInTheDocument();
    for (const switcher of switchers) {
      expect(switcher).toHaveValue('11111111-1111-4111-8111-111111111111');
      expect(switcher).toHaveTextContent('Second workspace');
    }

    fireEvent.change(switchers[0]!, {
      target: { value: '22222222-2222-4222-8222-222222222222' },
    });
    expect(mocks.selectWorkspace).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222');
  });

  it('switches to an exact member workspace before mounting a billing return', async () => {
    mocks.selectWorkspace.mockImplementation((workspaceId: string) => {
      const next = mocks.context.workspaces.find((workspace) => workspace.id === workspaceId);
      if (!next) return false;
      mocks.context.workspace = next;
      return true;
    });
    const entry =
      '/settings?checkout=success&workspace=22222222-2222-4222-8222-222222222222&session_id=cs_test';
    const view = render(shell(entry));

    expect(screen.getByRole('status')).toHaveTextContent(/verifying billing workspace/i);
    expect(screen.queryByText('Settings page')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.selectWorkspace).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222')
    );

    view.rerender(shell(entry));
    expect(screen.getByText('Settings page')).toBeInTheDocument();
    expect(screen.getByTestId('location-search')).toHaveTextContent(
      'workspace=22222222-2222-4222-8222-222222222222'
    );
  });

  it.each([
    '/settings?checkout=cancelled&workspace=not-a-uuid',
    '/settings?billing=return&workspace=33333333-3333-4333-8333-333333333333',
  ])('scrubs an invalid or non-member provider return before mounting settings', async (entry) => {
    render(shell(entry));

    expect(await screen.findByText('Settings page')).toBeInTheDocument();
    expect(screen.getByTestId('location-search')).toHaveTextContent('');
    expect(mocks.selectWorkspace).not.toHaveBeenCalled();
  });

  it('surfaces a failed sign-out instead of silently leaving the session active', async () => {
    mocks.signOut.mockRejectedValue(new Error('Network unavailable.'));
    render(shell('/inbox'));

    fireEvent.click(screen.getAllByRole('button', { name: /sign out/i })[0]!);

    expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable.');
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });

  it('remounts the complete route subtree when the workspace changes', () => {
    const view = render(shell('/settings'));
    const draft = screen.getByRole('textbox', { name: /workspace draft/i });
    fireEvent.change(draft, { target: { value: 'workspace A secret draft' } });
    expect(draft).toHaveValue('workspace A secret draft');

    mocks.context.workspace = mocks.context.workspaces[1]!;
    view.rerender(shell('/settings'));

    expect(screen.getByRole('textbox', { name: /workspace draft/i })).toHaveValue('');
  });
});
