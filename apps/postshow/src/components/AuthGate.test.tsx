import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthGate } from './AuthGate';

const mocks = vi.hoisted(() => ({
  reloadSession: vi.fn(),
  reloadWorkspace: vi.fn(),
  signOut: vi.fn(),
  context: {} as Record<string, unknown>,
}));

vi.mock('@/state/WorkspaceContext', () => ({ useWorkspace: () => mocks.context }));

function baseContext() {
  return {
    session: { user: { id: 'user-id' } },
    sessionLoading: false,
    sessionError: '',
    workspace: { id: 'workspace-id', name: 'Acme Cloud' },
    workspaceLoading: false,
    workspaceError: '',
    createWorkspace: vi.fn(),
    reloadSession: mocks.reloadSession,
    reloadWorkspace: mocks.reloadWorkspace,
    signOut: mocks.signOut,
  };
}

describe('AuthGate loading failures', () => {
  beforeEach(() => {
    mocks.reloadSession.mockReset();
    mocks.reloadWorkspace.mockReset();
    mocks.signOut.mockReset();
    mocks.context = baseContext();
  });

  it('does not turn a workspace load failure into the new-workspace screen', () => {
    mocks.context = {
      ...baseContext(),
      workspace: null,
      workspaceError: 'The workspace service is unavailable.',
    };
    render(
      <MemoryRouter>
        <AuthGate>
          <div>private app</div>
        </AuthGate>
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: /workspace didn’t load/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /name your workspace/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(mocks.reloadWorkspace).toHaveBeenCalledOnce();
  });

  it('offers an explicit retry when the auth session cannot be verified', () => {
    mocks.context = {
      ...baseContext(),
      session: null,
      workspace: null,
      sessionError: 'Session lookup timed out.',
    };
    render(
      <MemoryRouter>
        <AuthGate>
          <div>private app</div>
        </AuthGate>
      </MemoryRouter>
    );

    expect(
      screen.getByRole('heading', { name: /couldn’t verify your session/i })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(mocks.reloadSession).toHaveBeenCalledOnce();
  });

  it('keeps an already validated workspace usable during a fenced background refresh', () => {
    mocks.context = { ...baseContext(), workspaceLoading: true };
    render(
      <MemoryRouter>
        <AuthGate>
          <div>private app</div>
        </AuthGate>
      </MemoryRouter>
    );

    expect(screen.getByText('private app')).toBeInTheDocument();
    expect(screen.queryByText('loading…')).not.toBeInTheDocument();
  });

  it('binds workspace creation to the authoritative Eventools terms', () => {
    mocks.context = { ...baseContext(), workspace: null };
    render(
      <MemoryRouter>
        <AuthGate>
          <div>private app</div>
        </AuthGate>
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: /name your workspace/i })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Terms' })[0]).toHaveAttribute('href', '/terms');
    expect(screen.getAllByRole('link', { name: /privacy/i })[0]).toHaveAttribute(
      'href',
      '/privacy'
    );
  });
});
