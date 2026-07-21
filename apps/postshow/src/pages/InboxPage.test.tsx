import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { InboxPage } from './InboxPage';
import {
  fetchInbox,
  fetchWorkspacePermissions,
  skipInboxItem,
  previewInboxAction,
  executeInboxAction,
} from '@/lib/api';
import type { InboxItem, WorkspacePermissions } from '@/lib/types';

const workspaceState = vi.hoisted(() => ({
  workspace: { id: 'ws-1', name: 'Acme Cloud', plan: 'team', created_at: '' },
}));

vi.mock('@/lib/api', () => ({
  fetchInbox: vi.fn(),
  fetchWorkspacePermissions: vi.fn(),
  skipInboxItem: vi.fn(),
  previewInboxAction: vi.fn(),
  executeInboxAction: vi.fn(),
  updateInboxDraft: vi.fn(),
}));

vi.mock('@/state/WorkspaceContext', () => ({
  useWorkspace: () => ({
    workspace: workspaceState.workspace,
  }),
}));

const fetchInboxMock = vi.mocked(fetchInbox);
const fetchPermissionsMock = vi.mocked(fetchWorkspacePermissions);
const skipMock = vi.mocked(skipInboxItem);
const previewMock = vi.mocked(previewInboxAction);
const executeMock = vi.mocked(executeInboxAction);

function item(overrides: Partial<InboxItem>): InboxItem {
  return {
    id: 'item-1',
    workspace_id: 'ws-1',
    account_id: null,
    kind: 'expansion',
    meta: 'Expansion · Lattice Metrics',
    title: 'They hit the seat limit twice this week.',
    body: 'Hi there, noticed you are at your seat limit…',
    evidence: '14 sessions · seat modal ×9',
    action_label: 'Approve and send',
    action_type: 'email',
    action_config: { to: 'admin@lattice.example' },
    action_revision: 4,
    state: 'pending',
    resolution: {},
    resolved_at: null,
    created_at: new Date().toISOString(),
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

function renderPage() {
  return render(
    <MemoryRouter>
      <InboxPage />
    </MemoryRouter>
  );
}

describe('InboxPage', () => {
  beforeEach(() => {
    workspaceState.workspace = { id: 'ws-1', name: 'Acme Cloud', plan: 'team', created_at: '' };
    fetchInboxMock.mockReset();
    fetchPermissionsMock.mockReset().mockResolvedValue(
      permissions('ws-1', {
        operate: true,
        approve_actions: true,
        manage_settings: true,
        manage_members: true,
      })
    );
    skipMock.mockReset();
    previewMock.mockReset();
    executeMock.mockReset();
  });

  it('shows the first-run empty state with a path to connections', async () => {
    fetchInboxMock.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/no drafts waiting/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go to connections/i })).toHaveAttribute(
      'href',
      '/connections'
    );
  });

  it('requires an exact server preview before executing an action', async () => {
    fetchInboxMock.mockResolvedValue([item({})]);
    previewMock.mockResolvedValue({
      confirmation_id: 'confirm-1',
      confirmation_token: `pca_${'a'.repeat(64)}`,
      expires_at: new Date(Date.now() + 300_000).toISOString(),
      preview: {
        workspace_id: 'ws-1',
        item_id: 'item-1',
        revision: 4,
        action_type: 'email',
        title: 'They hit the seat limit twice this week.',
        body: 'Hi there, noticed you are at your seat limit…',
        evidence: '14 sessions · seat modal ×9',
        action_config: { subject: 'Seats' },
        destination: 'owner@lattice.example',
        sender: 'team@postshow.example',
      },
    });
    executeMock.mockResolvedValue({ ok: true, detail: 'email sent', receipt_id: 'receipt-1' });
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText(/they hit the seat limit twice/i)).toBeInTheDocument();
    expect(screen.getByText(/14 sessions · seat modal ×9/)).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: /review approve and send/i }));
    expect(previewMock).toHaveBeenCalledWith('item-1', 4);
    expect(executeMock).not.toHaveBeenCalled();
    expect(screen.getByText('owner@lattice.example')).toBeInTheDocument();
    expect(screen.getByText('team@postshow.example')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /confirm and send/i }));
    expect(executeMock).toHaveBeenCalledWith(`pca_${'a'.repeat(64)}`);
  });

  it('skips an item via the rpc path', async () => {
    fetchInboxMock.mockResolvedValue([item({})]);
    skipMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();

    await screen.findByText(/they hit the seat limit twice/i);
    await user.click(await screen.findByRole('button', { name: 'Skip' }));
    expect(skipMock).toHaveBeenCalledWith('item-1', 4);
  });

  it('surfaces a failed preview instead of executing silently', async () => {
    fetchInboxMock.mockResolvedValue([item({})]);
    previewMock.mockRejectedValue(new Error('connect Resend to send outreach'));
    const user = userEvent.setup();
    renderPage();

    await screen.findByText(/they hit the seat limit twice/i);
    await user.click(await screen.findByRole('button', { name: /review approve and send/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/connect resend/i);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it.each(['owner', 'admin'])('lets an %s operate and approve inbox drafts', async () => {
    fetchInboxMock.mockResolvedValue([item({})]);
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByRole('button', { name: /review approve and send/i })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /14 sessions/i }));
    expect(screen.getByRole('button', { name: /edit draft/i })).toBeInTheDocument();
  });

  it('lets a member edit or skip but never preview or approve an irreversible action', async () => {
    fetchPermissionsMock.mockResolvedValue(permissions('ws-1', { operate: true }));
    fetchInboxMock.mockResolvedValue([item({})]);
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText(/owner or admin must approve/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /review approve and send/i })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /14 sessions/i }));
    expect(screen.getByRole('button', { name: /edit draft/i })).toBeInTheDocument();
    expect(previewMock).not.toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('keeps the inbox fully read-only for a viewer', async () => {
    fetchPermissionsMock.mockResolvedValue(permissions('ws-1'));
    fetchInboxMock.mockResolvedValue([item({})]);
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText(/inbox drafts are read-only/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /review approve and send/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /14 sessions/i }));
    expect(screen.queryByRole('button', { name: /edit draft/i })).not.toBeInTheDocument();
    expect(skipMock).not.toHaveBeenCalled();
    expect(previewMock).not.toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('fails closed when inbox permissions cannot be verified', async () => {
    fetchPermissionsMock.mockRejectedValue(new Error('permission service unavailable'));
    fetchInboxMock.mockResolvedValue([item({})]);
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(/controls remain locked/i);
    expect(
      screen.queryByRole('button', { name: /review approve and send/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry permission check/i })).toBeInTheDocument();
  });

  it('never applies late inbox data or permissions after a workspace switch', async () => {
    const workspaceAInbox = deferred<InboxItem[]>();
    const workspaceAPermissions = deferred<WorkspacePermissions>();
    const workspaceBInbox = deferred<InboxItem[]>();
    const workspaceBPermissions = deferred<WorkspacePermissions>();
    fetchInboxMock.mockImplementation((workspaceId) =>
      workspaceId === 'workspace-a' ? workspaceAInbox.promise : workspaceBInbox.promise
    );
    fetchPermissionsMock.mockImplementation((workspaceId) =>
      workspaceId === 'workspace-a' ? workspaceAPermissions.promise : workspaceBPermissions.promise
    );
    workspaceState.workspace = {
      id: 'workspace-a',
      name: 'Workspace A',
      plan: 'team',
      created_at: '',
    };
    const view = renderPage();

    workspaceState.workspace = {
      id: 'workspace-b',
      name: 'Workspace B',
      plan: 'team',
      created_at: '',
    };
    view.rerender(
      <MemoryRouter>
        <InboxPage />
      </MemoryRouter>
    );
    workspaceBInbox.resolve([
      item({ id: 'item-b', workspace_id: 'workspace-b', title: 'Workspace B draft' }),
    ]);
    workspaceBPermissions.resolve(permissions('workspace-b'));

    expect(await screen.findByText('Workspace B draft')).toBeInTheDocument();
    expect(screen.getByText(/inbox drafts are read-only/i)).toBeInTheDocument();
    workspaceAInbox.resolve([
      item({ id: 'item-a', workspace_id: 'workspace-a', title: 'Workspace A private draft' }),
    ]);
    workspaceAPermissions.resolve(
      permissions('workspace-a', { operate: true, approve_actions: true })
    );
    await waitFor(() => {
      expect(screen.queryByText('Workspace A private draft')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /review approve and send/i })
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
    });
  });
});
