import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectForm, ConnectionsPage, ConnectorCard } from './ConnectionsPage';
import { CONNECTORS } from '@/lib/connectors';
import {
  deleteConnection,
  fetchConnections,
  fetchWorkspacePermissions,
  testConnection,
  upsertConnection,
} from '@/lib/api';
import type { Connection, WorkspacePermissions } from '@/lib/types';

const workspaceState = vi.hoisted(() => ({ workspace: { id: 'workspace-1' } }));

vi.mock('@/lib/api', () => ({
  fetchConnections: vi.fn(),
  fetchWorkspacePermissions: vi.fn(),
  upsertConnection: vi.fn(),
  deleteConnection: vi.fn(),
  testConnection: vi.fn(),
}));
vi.mock('@/state/WorkspaceContext', () => ({
  useWorkspace: () => ({ workspace: workspaceState.workspace }),
}));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

const upsert = vi.mocked(upsertConnection);
const test = vi.mocked(testConnection);
const removeConnection = vi.mocked(deleteConnection);
const fetchConnectionsMock = vi.mocked(fetchConnections);
const fetchPermissionsMock = vi.mocked(fetchWorkspacePermissions);
const stripe = CONNECTORS.find((connector) => connector.provider === 'stripe')!;
const slack = CONNECTORS.find((connector) => connector.provider === 'slack')!;
const postgres = CONNECTORS.find((connector) => connector.provider === 'postgres')!;
const posthog = CONNECTORS.find((connector) => connector.provider === 'posthog')!;
const github = CONNECTORS.find((connector) => connector.provider === 'github')!;
const linear = CONNECTORS.find((connector) => connector.provider === 'linear')!;
const resend = CONNECTORS.find((connector) => connector.provider === 'resend')!;
const sentry = CONNECTORS.find((connector) => connector.provider === 'sentry')!;
const cloudStripe: Connection = {
  id: 'connection-1',
  workspace_id: 'workspace-1',
  provider: 'stripe',
  label: '',
  status: 'connected',
  local_only: false,
  meta: {},
  last_checked_at: '2026-07-21T00:00:00Z',
  created_at: '2026-07-20T00:00:00Z',
};

function cloudConnection(
  provider: Connection['provider'],
  meta: Record<string, unknown>,
  overrides: Partial<Connection> = {}
): Connection {
  return {
    ...cloudStripe,
    id: `${provider}-connection`,
    provider,
    meta,
    ...overrides,
  };
}

function permissions(
  workspaceId: string,
  values: Partial<WorkspacePermissions> = {}
): WorkspacePermissions {
  return {
    workspace_id: workspaceId,
    operate: false,
    approve_actions: false,
    manage_settings: false,
    manage_members: false,
    manage_billing: false,
    delete_workspace: false,
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

describe('ConnectionsPage safety boundaries', () => {
  beforeEach(() => {
    workspaceState.workspace = { id: 'workspace-1' };
    upsert.mockReset();
    test.mockReset().mockResolvedValue({ ok: true, detail: 'test message posted' });
    removeConnection.mockReset();
    fetchConnectionsMock.mockReset().mockResolvedValue([cloudStripe]);
    fetchPermissionsMock.mockReset().mockResolvedValue(
      permissions('workspace-1', {
        operate: true,
        approve_actions: true,
        manage_settings: true,
        manage_members: true,
      })
    );
  });

  it('never collects or transmits a local-only credential in the web form', async () => {
    const user = userEvent.setup();
    const view = render(
      <ConnectForm
        def={stripe}
        existing={cloudStripe}
        workspaceId="workspace-1"
        canManage
        onDone={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByLabelText(/restricted api key/i)).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /configure this source on a device/i }));
    expect(screen.queryByLabelText(/restricted api key/i)).not.toBeInTheDocument();
    expect(screen.getByText(/existing cloud credential remains unchanged/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument();

    fireEvent.submit(view.container.querySelector('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent(/configured on the device/i);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('requires explicit confirmation before posting a visible Slack test', async () => {
    const connection: Connection = { ...cloudStripe, id: 'slack-1', provider: 'slack' };
    const user = userEvent.setup();
    render(
      <ConnectorCard
        def={slack}
        existing={connection}
        workspaceId="workspace-1"
        canManage
        onChanged={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /^test$/i }));
    expect(test).not.toHaveBeenCalled();
    expect(screen.getByText(/posts a visible/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /post test message/i }));
    await waitFor(() => expect(test).toHaveBeenCalledWith('slack-1', true));
  });

  it('never offers a cloud credential path for Postgres', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const view = render(
      <ConnectForm
        def={postgres}
        existing={null}
        workspaceId="workspace-1"
        canManage
        onDone={vi.fn()}
        onCancel={onCancel}
      />
    );

    expect(screen.queryByLabelText(/connection string/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByText(/postgres is always device-only/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /connect|save/i })).not.toBeInTheDocument();

    fireEvent.submit(view.container.querySelector('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent(/configured on the device/i);
    expect(upsert).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('does not test a legacy cloud Postgres record', async () => {
    const user = userEvent.setup();
    render(
      <ConnectorCard
        def={postgres}
        existing={{ ...cloudStripe, id: 'postgres-legacy', provider: 'postgres' }}
        workspaceId="workspace-1"
        canManage
        onChanged={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: /^test$/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /device setup/i }));
    expect(screen.getByText(/legacy cloud connection cannot be used/i)).toBeInTheDocument();
    expect(test).not.toHaveBeenCalled();
  });

  it('omits an optional blank PostHog host instead of persisting an invalid empty target', async () => {
    const user = userEvent.setup();
    upsert.mockResolvedValue();
    render(
      <ConnectForm
        def={posthog}
        existing={null}
        workspaceId="workspace-1"
        canManage
        onDone={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    await user.type(screen.getByLabelText(/personal api key/i), 'phx_secret');
    await user.type(screen.getByLabelText(/project id/i), '12345');
    await user.click(screen.getByRole('button', { name: /^connect$/i }));

    await waitFor(() =>
      expect(upsert).toHaveBeenCalledWith({
        workspaceId: 'workspace-1',
        provider: 'posthog',
        localOnly: false,
        meta: { project_id: '12345' },
        secret: { api_key: 'phx_secret' },
      })
    );
  });

  it.each([
    {
      name: 'PostHog host',
      def: posthog,
      existingMeta: { host: 'https://eu.posthog.com:443', project_id: '12345' },
      field: /host/i,
      nextValue: 'https://app.posthog.com/',
      secret: /personal api key/i,
      secretValue: 'phx_rebound',
      expectedMeta: { host: 'https://app.posthog.com', project_id: '12345' },
    },
    {
      name: 'GitHub repository case',
      def: github,
      existingMeta: { repo: 'Eventools/Postshow' },
      field: /repository/i,
      nextValue: 'eventools/postshow',
      secret: /fine-grained token/i,
      secretValue: 'github_pat_rebound',
      expectedMeta: { repo: 'eventools/postshow' },
    },
    {
      name: 'Linear team',
      def: linear,
      existingMeta: { team_key: 'ENG' },
      field: /team key/i,
      nextValue: 'ops',
      secret: /^api key/i,
      secretValue: 'lin_api_rebound',
      expectedMeta: { team_key: 'OPS' },
    },
    {
      name: 'Resend sender',
      def: resend,
      existingMeta: { from: 'owner@example.com' },
      field: /verified from address/i,
      nextValue: 'Sales@Example.COM',
      secret: /^api key/i,
      secretValue: 're_rebound',
      expectedMeta: { from: 'sales@example.com' },
    },
    {
      name: 'Sentry project',
      def: sentry,
      existingMeta: { org_slug: 'eventools', project_slug: 'frontend' },
      field: /project slug/i,
      nextValue: 'Backend_App',
      secret: /auth token/i,
      secretValue: 'sntrys_rebound',
      expectedMeta: { org_slug: 'eventools', project_slug: 'backend_app' },
    },
  ])('requires credential re-entry before changing the $name target', async (testCase) => {
    const user = userEvent.setup();
    const existing = cloudConnection(testCase.def.provider, testCase.existingMeta);
    upsert.mockResolvedValue();
    const view = render(
      <ConnectForm
        def={testCase.def}
        existing={existing}
        workspaceId="workspace-1"
        canManage
        onDone={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const target = screen.getByLabelText(testCase.field);
    await user.clear(target);
    await user.type(target, testCase.nextValue);
    const secret = screen.getByLabelText(testCase.secret);
    expect(secret).toBeRequired();
    expect(secret).toHaveAccessibleName(/required to bind this target/i);
    fireEvent.submit(view.container.querySelector('form')!);

    expect(await screen.findByRole('alert')).toHaveTextContent(/re-enter the credential/i);
    expect(upsert).not.toHaveBeenCalled();

    await user.type(secret, testCase.secretValue);
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() =>
      expect(upsert).toHaveBeenCalledWith({
        workspaceId: 'workspace-1',
        provider: testCase.def.provider,
        localOnly: false,
        meta: testCase.expectedMeta,
        secret: { [testCase.def.secretFields[0]!.key]: testCase.secretValue },
      })
    );
  });

  it.each([
    {
      name: 'an omitted default PostHog host',
      def: posthog,
      existingMeta: { project_id: '12345' },
      field: /host/i,
      nextValue: 'HTTPS://US.POSTHOG.COM:443/',
    },
    {
      name: 'a default PostHog host cleared to its optional blank form',
      def: posthog,
      existingMeta: { host: 'https://us.posthog.com:443', project_id: '12345' },
      field: /host/i,
      nextValue: '',
    },
    {
      name: 'a non-default PostHog origin with case, slash, and default port changes',
      def: posthog,
      existingMeta: { host: 'https://eu.posthog.com:443', project_id: '12345' },
      field: /host/i,
      nextValue: 'HTTPS://EU.POSTHOG.COM/',
    },
    {
      name: 'a trimmed GitHub repository',
      def: github,
      existingMeta: { repo: 'Eventools/Postshow' },
      field: /repository/i,
      nextValue: ' Eventools/Postshow ',
    },
    {
      name: 'a case-equivalent Linear team key',
      def: linear,
      existingMeta: { team_key: 'ENG' },
      field: /team key/i,
      nextValue: ' eng ',
    },
    {
      name: 'a case-equivalent Resend sender',
      def: resend,
      existingMeta: { from: 'owner@example.com' },
      field: /verified from address/i,
      nextValue: ' Owner@Example.COM ',
    },
    {
      name: 'case-equivalent Sentry slugs',
      def: sentry,
      existingMeta: { org_slug: 'eventools', project_slug: 'frontend' },
      field: /project slug/i,
      nextValue: ' FRONTEND ',
    },
  ])('retains the exact raw metadata and credential for $name', async (testCase) => {
    const user = userEvent.setup();
    const existing = cloudConnection(testCase.def.provider, testCase.existingMeta);
    upsert.mockResolvedValue();
    render(
      <ConnectForm
        def={testCase.def}
        existing={existing}
        workspaceId="workspace-1"
        canManage
        onDone={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const target = screen.getByLabelText(testCase.field);
    await user.clear(target);
    if (testCase.nextValue) await user.type(target, testCase.nextValue);
    const secret = screen.getByLabelText(new RegExp(testCase.def.secretFields[0]!.label, 'i'));
    expect(secret).not.toBeRequired();
    expect(secret).toHaveAccessibleName(/leave blank to keep current/i);
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() =>
      expect(upsert).toHaveBeenCalledWith({
        workspaceId: 'workspace-1',
        provider: testCase.def.provider,
        localOnly: false,
        meta: testCase.existingMeta,
        secret: null,
      })
    );
  });

  it('requires a credential when moving an existing local-only source to cloud', async () => {
    const user = userEvent.setup();
    const existing = cloudConnection('posthog', { project_id: '12345' }, { local_only: true });
    upsert.mockResolvedValue();
    const view = render(
      <ConnectForm
        def={posthog}
        existing={existing}
        workspaceId="workspace-1"
        canManage
        onDone={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    await user.click(screen.getByRole('checkbox', { name: /configure this source on a device/i }));
    const secret = screen.getByLabelText(/personal api key/i);
    expect(secret).toBeRequired();
    expect(secret).toHaveAccessibleName(/required to bind this target/i);
    fireEvent.submit(view.container.querySelector('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent(/re-enter the credential/i);
    expect(upsert).not.toHaveBeenCalled();

    await user.type(secret, 'phx_cloud');
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() =>
      expect(upsert).toHaveBeenCalledWith({
        workspaceId: 'workspace-1',
        provider: 'posthog',
        localOnly: false,
        meta: { project_id: '12345' },
        secret: { api_key: 'phx_cloud' },
      })
    );
  });

  it.each([
    {
      name: 'PostHog project',
      def: posthog,
      fields: [[/project id/i, 'project-1']] as const,
      secret: /personal api key/i,
      secretValue: 'phx_must_not_send',
    },
    {
      name: 'GitHub repository',
      def: github,
      fields: [[/repository/i, 'owner/repo/extra']] as const,
      secret: /fine-grained token/i,
      secretValue: 'github_pat_must_not_send',
    },
    {
      name: 'Linear team',
      def: linear,
      fields: [[/team key/i, '1-BAD']] as const,
      secret: /^api key/i,
      secretValue: 'lin_api_must_not_send',
    },
    {
      name: 'Resend sender',
      def: resend,
      fields: [[/verified from address/i, 'not-an-email']] as const,
      secret: /^api key/i,
      secretValue: 're_must_not_send',
    },
    {
      name: 'Sentry slug',
      def: sentry,
      fields: [
        [/organization slug/i, 'bad slug'],
        [/project slug/i, 'frontend'],
      ] as const,
      secret: /auth token/i,
      secretValue: 'sntrys_must_not_send',
    },
  ])('never submits a credential with an invalid $name target', async (testCase) => {
    const user = userEvent.setup();
    const view = render(
      <ConnectForm
        def={testCase.def}
        existing={null}
        workspaceId="workspace-1"
        canManage
        onDone={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    for (const [label, value] of testCase.fields) {
      await user.type(screen.getByLabelText(label), value);
    }
    await user.type(screen.getByLabelText(testCase.secret), testCase.secretValue);
    fireEvent.submit(view.container.querySelector('form')!);

    expect(await screen.findByRole('alert')).toHaveTextContent(/may contain|must|valid|exact/i);
    expect(upsert).not.toHaveBeenCalled();
  });

  it.each(['owner', 'admin'])('keeps connection controls available to an %s', async () => {
    render(<ConnectionsPage />);

    expect(await screen.findByRole('button', { name: /^test$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^remove$/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^connect$/i }).length).toBeGreaterThan(0);
  });

  it.each([
    [
      'member',
      {
        operate: true,
      },
    ],
    ['viewer', {}],
  ] as const)('keeps Connections read-only for a %s', async (_role, capabilities) => {
    fetchPermissionsMock.mockResolvedValue(permissions('workspace-1', capabilities));
    render(<ConnectionsPage />);

    expect(await screen.findByText(/connections are read-only/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^test$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^remove$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^connect$/i })).not.toBeInTheDocument();
    expect(test).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(removeConnection).not.toHaveBeenCalled();
  });

  it('fails closed when connection permissions cannot be verified', async () => {
    fetchPermissionsMock.mockRejectedValue(new Error('permission service unavailable'));
    render(<ConnectionsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/controls remain locked/i);
    expect(screen.queryByRole('button', { name: /^test$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry permission check/i })).toBeInTheDocument();
  });

  it('never applies late connection data or permissions after a workspace switch', async () => {
    const workspaceAConnections = deferred<Connection[]>();
    const workspaceAPermissions = deferred<WorkspacePermissions>();
    const workspaceBConnections = deferred<Connection[]>();
    const workspaceBPermissions = deferred<WorkspacePermissions>();
    fetchConnectionsMock.mockImplementation((workspaceId) =>
      workspaceId === 'workspace-a' ? workspaceAConnections.promise : workspaceBConnections.promise
    );
    fetchPermissionsMock.mockImplementation((workspaceId) =>
      workspaceId === 'workspace-a' ? workspaceAPermissions.promise : workspaceBPermissions.promise
    );
    workspaceState.workspace = { id: 'workspace-a' };
    const view = render(<ConnectionsPage />);

    workspaceState.workspace = { id: 'workspace-b' };
    view.rerender(<ConnectionsPage />);
    workspaceBConnections.resolve([]);
    workspaceBPermissions.resolve(permissions('workspace-b'));

    expect(await screen.findByText(/connections are read-only/i)).toBeInTheDocument();
    workspaceAConnections.resolve([
      {
        ...cloudStripe,
        id: 'connection-a',
        workspace_id: 'workspace-a',
        provider: 'postgres',
        local_only: true,
      },
    ]);
    workspaceAPermissions.resolve(
      permissions('workspace-a', { operate: true, approve_actions: true, manage_settings: true })
    );
    await waitFor(() => {
      expect(screen.queryByText('local-only')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^connect$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
    });
  });

  it('drops an unsaved credential draft when switching workspaces', async () => {
    fetchConnectionsMock.mockImplementation(async (workspaceId) => [
      cloudConnection(
        'posthog',
        { project_id: workspaceId === 'workspace-a' ? '111' : '222' },
        { workspace_id: workspaceId }
      ),
    ]);
    fetchPermissionsMock.mockImplementation(async (workspaceId) =>
      permissions(workspaceId, {
        operate: true,
        approve_actions: true,
        manage_settings: true,
      })
    );
    workspaceState.workspace = { id: 'workspace-a' };
    const user = userEvent.setup();
    const view = render(<ConnectionsPage />);

    await user.click(await screen.findByRole('button', { name: /^edit$/i }));
    await user.type(screen.getByLabelText(/personal api key/i), 'phx_workspace_a_secret');
    expect(screen.getByLabelText(/project id/i)).toHaveValue('111');

    workspaceState.workspace = { id: 'workspace-b' };
    view.rerender(<ConnectionsPage />);
    await user.click(await screen.findByRole('button', { name: /^edit$/i }));

    expect(screen.getByLabelText(/project id/i)).toHaveValue('222');
    expect(screen.getByLabelText(/personal api key/i)).toHaveValue('');
    expect(screen.queryByDisplayValue('phx_workspace_a_secret')).not.toBeInTheDocument();
  });
});
