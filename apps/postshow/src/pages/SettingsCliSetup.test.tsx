import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';
import type { WorkspacePermissions } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  fetchWorkspacePermissions: vi.fn(),
  fetchEngine: vi.fn(),
  fetchKeyProviders: vi.fn(),
  fetchApiTokens: vi.fn(),
}));

vi.mock('@/state/WorkspaceContext', () => ({
  useWorkspace: () => ({
    session: { user: { id: 'actor-1' } },
    workspace: {
      id: 'workspace-1',
      name: 'Acme',
      plan: 'team',
      agent_rules: [] as string[],
      created_at: '2026-07-20T00:00:00.000Z',
    },
    reloadWorkspace: vi.fn(),
  }),
}));

vi.mock('@/lib/api', () => ({
  createApiToken: vi.fn(),
  fetchApiTokens: mocks.fetchApiTokens,
  fetchEngine: mocks.fetchEngine,
  fetchKeyProviders: mocks.fetchKeyProviders,
  fetchWorkspacePermissions: mocks.fetchWorkspacePermissions,
  revokeApiToken: vi.fn(),
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
  WorkspaceLifecycleSection: () => <div>Workspace lifecycle administration</div>,
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

describe('SettingsPage device setup', () => {
  beforeEach(() => {
    mocks.fetchWorkspacePermissions.mockReset().mockResolvedValue(permissions({ operate: true }));
    mocks.fetchEngine.mockReset().mockResolvedValue(null);
    mocks.fetchKeyProviders.mockReset().mockResolvedValue([]);
    mocks.fetchApiTokens.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('shows the API URL that setup asks for beside the token', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    render(<SettingsPage />);

    expect(await screen.findByRole('heading', { name: /access tokens/i })).toBeInTheDocument();
    expect(screen.getByText('API URL')).toBeInTheDocument();
    expect(screen.getByText('https://project.supabase.co')).toBeInTheDocument();
  });

  it('refuses to invent an API URL when the deployment has none', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    render(<SettingsPage />);

    expect(await screen.findByRole('heading', { name: /access tokens/i })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/no API origin configured/i);
  });

  it('gives a buildable install block and a runnable command with no placeholder path', async () => {
    render(<SettingsPage />);

    expect(await screen.findByRole('heading', { name: /access tokens/i })).toBeInTheDocument();
    expect(document.body).toHaveTextContent(
      /git clone https:\/\/github\.com\/eventools-io\/postshow\.git ~\/postshow/
    );
    expect(document.body).toHaveTextContent(
      /node ~\/postshow\/packages\/postshow-cli\/dist\/index\.js init/
    );
    expect(document.body).not.toHaveTextContent(/absolute\/path\/to/);
  });

  it('surfaces the desktop agent from the same page that demands a terminal', async () => {
    render(<SettingsPage />);

    expect(await screen.findByRole('heading', { name: /desktop agent/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /watch for the first release/i })).toBeInTheDocument();
  });
});
