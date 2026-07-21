import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';
import type { ApiToken, WorkspacePermissions } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  fetchWorkspacePermissions: vi.fn(),
  fetchEngine: vi.fn(),
  fetchKeyProviders: vi.fn(),
  fetchApiTokens: vi.fn(),
  createApiToken: vi.fn(),
  revokeApiToken: vi.fn(),
  reloadWorkspace: vi.fn(),
  context: {
    session: { user: { id: 'actor-1' } },
    workspace: {
      id: 'workspace-1',
      name: 'Acme',
      plan: 'team',
      agent_rules: [] as string[],
      created_at: '2026-07-20T00:00:00.000Z',
    },
  },
}));

vi.mock('@/state/WorkspaceContext', () => ({
  useWorkspace: () => ({
    ...mocks.context,
    reloadWorkspace: mocks.reloadWorkspace,
  }),
}));

vi.mock('@/lib/api', () => ({
  createApiToken: mocks.createApiToken,
  fetchApiTokens: mocks.fetchApiTokens,
  fetchEngine: mocks.fetchEngine,
  fetchKeyProviders: mocks.fetchKeyProviders,
  fetchWorkspacePermissions: mocks.fetchWorkspacePermissions,
  revokeApiToken: mocks.revokeApiToken,
  setAgentRules: vi.fn(),
  setEngine: vi.fn(),
  setEngineKey: vi.fn(),
  setTaskPrefs: vi.fn(),
}));

vi.mock('@/components/settings/BillingSection', () => ({
  BillingSection: () => <div>Billing administration</div>,
}));
vi.mock('@/components/settings/MemberManagementSection', () => ({
  MemberManagementSection: () => <div>Member administration</div>,
}));
vi.mock('@/components/settings/WorkspaceLifecycleSection', () => ({
  WorkspaceLifecycleSection: ({ session }: { session: { user: { id: string } } }) => (
    <div data-testid="workspace-lifecycle" data-actor-id={session.user.id}>
      Workspace lifecycle administration
    </div>
  ),
}));
vi.mock('@/components/settings/AccountDeletionSection', () => ({
  AccountDeletionSection: () => <div>Personal account deletion</div>,
}));
vi.mock('@/components/LegalLinks', () => ({ LegalLinks: () => <div>Legal links</div> }));

function permissions(values: Partial<WorkspacePermissions>): WorkspacePermissions {
  return {
    workspace_id: 'workspace-1',
    operate: false,
    approve_actions: false,
    manage_settings: false,
    manage_members: false,
    manage_billing: false,
    delete_workspace: false,
    ...values,
  };
}

function token(workspaceId: string, values: Partial<ApiToken> = {}): ApiToken {
  return {
    id: `token-${workspaceId}`,
    workspace_id: workspaceId,
    name: 'Laptop',
    token_prefix: 'psh_0123456789ab',
    scopes: ['workspace:read', 'inbox:read'],
    expires_at: '2026-10-19T12:00:00.000Z',
    created_at: '2026-07-21T12:00:00.000Z',
    last_used_at: null,
    revoked_at: null,
    ...values,
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('SettingsPage administrative access', () => {
  beforeEach(() => {
    mocks.context.session = { user: { id: 'actor-1' } };
    mocks.context.workspace = {
      id: 'workspace-1',
      name: 'Acme',
      plan: 'team',
      agent_rules: [],
      created_at: '2026-07-20T00:00:00.000Z',
    };
    mocks.fetchWorkspacePermissions.mockReset();
    mocks.fetchEngine.mockReset().mockResolvedValue(null);
    mocks.fetchKeyProviders.mockReset().mockResolvedValue([]);
    mocks.fetchApiTokens.mockReset().mockResolvedValue([]);
    mocks.createApiToken.mockReset();
    mocks.revokeApiToken.mockReset();
    mocks.reloadWorkspace.mockReset();
  });

  it('keeps shared administration read-only for a member while retaining personal controls', async () => {
    mocks.fetchWorkspacePermissions.mockResolvedValue(permissions({}));
    render(<SettingsPage />);

    expect(await screen.findByText(/role has read-only access/i)).toBeInTheDocument();
    expect(screen.queryByText('Billing administration')).not.toBeInTheDocument();
    expect(screen.queryByText('Member administration')).not.toBeInTheDocument();
    expect(screen.queryByText('Workspace lifecycle administration')).not.toBeInTheDocument();
    expect(screen.getByText('Personal account deletion')).toBeInTheDocument();
  });

  it('shows shared settings and members to an admin without owner-only billing or deletion', async () => {
    mocks.fetchWorkspacePermissions.mockResolvedValue(
      permissions({ manage_settings: true, manage_members: true })
    );
    render(<SettingsPage />);

    expect(await screen.findByText('Member administration')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Engine' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'House rules' })).toBeInTheDocument();
    expect(screen.queryByText('Billing administration')).not.toBeInTheDocument();
    expect(screen.queryByText('Workspace lifecycle administration')).not.toBeInTheDocument();
  });

  it('shows owner-only billing and workspace lifecycle controls only after verification', async () => {
    let resolvePermissions: (value: WorkspacePermissions) => void = () => undefined;
    mocks.fetchWorkspacePermissions.mockReturnValue(
      new Promise((resolve) => {
        resolvePermissions = resolve;
      })
    );
    render(<SettingsPage />);

    expect(screen.getByText(/checking workspace permissions/i)).toBeInTheDocument();
    expect(screen.queryByText('Workspace lifecycle administration')).not.toBeInTheDocument();
    resolvePermissions(
      permissions({
        manage_settings: true,
        manage_members: true,
        manage_billing: true,
        delete_workspace: true,
      })
    );

    await waitFor(() =>
      expect(screen.getByText('Workspace lifecycle administration')).toBeInTheDocument()
    );
    expect(screen.getByTestId('workspace-lifecycle')).toHaveAttribute('data-actor-id', 'actor-1');
    expect(screen.getByText('Billing administration')).toBeInTheDocument();
  });

  it('fails closed and offers a retry when the permission authority is unavailable', async () => {
    mocks.fetchWorkspacePermissions.mockRejectedValue(new Error('network'));
    render(<SettingsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/controls are hidden/i);
    expect(screen.queryByText('Workspace lifecycle administration')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry permission check/i })).toBeInTheDocument();
  });

  it.each([
    [
      'owner',
      {
        operate: true,
        approve_actions: true,
        manage_settings: true,
        manage_members: true,
        manage_billing: true,
        delete_workspace: true,
      },
    ],
    [
      'admin',
      {
        operate: true,
        approve_actions: true,
        manage_settings: true,
        manage_members: true,
      },
    ],
    ['member', { operate: true }],
    ['viewer', {}],
  ] as const)('keeps exact personal token details visible to a %s', async (_role, capabilities) => {
    mocks.fetchWorkspacePermissions.mockResolvedValue(permissions(capabilities));
    mocks.fetchApiTokens.mockResolvedValue([token('workspace-1')]);
    render(<SettingsPage />);

    expect(await screen.findByRole('heading', { name: /access tokens/i })).toBeInTheDocument();
    expect(await screen.findByText('scopes: workspace:read, inbox:read')).toBeInTheDocument();
    expect(screen.getByText('2026-10-19T12:00:00.000Z')).toHaveAttribute(
      'datetime',
      '2026-10-19T12:00:00.000Z'
    );
    expect(screen.getByRole('button', { name: /create token/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /revoke/i })).toBeInTheDocument();
  });

  it('shows the exact scopes and expiration returned with a newly minted token', async () => {
    const rawToken = `psh_${'a'.repeat(64)}`;
    mocks.fetchWorkspacePermissions.mockResolvedValue(permissions({ operate: true }));
    mocks.createApiToken.mockResolvedValue({
      ok: true,
      token: rawToken,
      token_prefix: rawToken.slice(0, 16),
      scopes: ['workspace:read', 'jobs:read', 'jobs:run'],
      expires_at: '2026-11-15T09:30:00.000Z',
    });
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.type(await screen.findByRole('textbox', { name: /token name/i }), 'Production CLI');
    await user.click(screen.getByRole('button', { name: /create token/i }));

    expect(await screen.findByText(rawToken)).toBeInTheDocument();
    expect(screen.getByText('workspace:read, jobs:read, jobs:run')).toBeInTheDocument();
    expect(screen.getByText('2026-11-15T09:30:00.000Z')).toBeInTheDocument();
    expect(mocks.createApiToken).toHaveBeenCalledWith('workspace-1', 'Production CLI');
  });

  it('never shows a late token response from the previous workspace', async () => {
    const workspaceATokens = deferred<ApiToken[]>();
    const workspaceBTokens = deferred<ApiToken[]>();
    mocks.fetchWorkspacePermissions.mockImplementation(async (workspaceId: string) =>
      permissions({ workspace_id: workspaceId })
    );
    mocks.fetchApiTokens.mockImplementation((workspaceId: string) =>
      workspaceId === 'workspace-a' ? workspaceATokens.promise : workspaceBTokens.promise
    );
    mocks.context.workspace = {
      id: 'workspace-a',
      name: 'Workspace A',
      plan: 'team',
      agent_rules: [],
      created_at: '2026-07-20T00:00:00.000Z',
    };
    const view = render(<SettingsPage />);

    mocks.context.workspace = {
      id: 'workspace-b',
      name: 'Workspace B',
      plan: 'team',
      agent_rules: [],
      created_at: '2026-07-20T00:00:00.000Z',
    };
    view.rerender(<SettingsPage />);
    workspaceBTokens.resolve([token('workspace-b', { id: 'token-b', name: 'Workspace B token' })]);

    expect(await screen.findByText(/workspace b token/i)).toBeInTheDocument();
    workspaceATokens.resolve([
      token('workspace-a', { id: 'token-a', name: 'Workspace A private token' }),
    ]);
    await waitFor(() => {
      expect(screen.queryByText(/workspace a private token/i)).not.toBeInTheDocument();
      expect(screen.getByText(/workspace b token/i)).toBeInTheDocument();
    });
  });
});
