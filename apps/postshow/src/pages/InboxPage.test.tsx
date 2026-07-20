import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { InboxPage } from './InboxPage';
import { fetchInbox, skipInboxItem, approveInboxItem } from '@/lib/api';
import type { InboxItem } from '@/lib/types';

vi.mock('@/lib/api', () => ({
  fetchInbox: vi.fn(),
  skipInboxItem: vi.fn(),
  approveInboxItem: vi.fn(),
  updateInboxDraft: vi.fn(),
}));

vi.mock('@/state/WorkspaceContext', () => ({
  useWorkspace: () => ({
    workspace: { id: 'ws-1', name: 'Acme Cloud', plan: 'byok', created_at: '' },
  }),
}));

const fetchInboxMock = vi.mocked(fetchInbox);
const skipMock = vi.mocked(skipInboxItem);
const approveMock = vi.mocked(approveInboxItem);

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
    state: 'pending',
    resolution: {},
    resolved_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
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
    fetchInboxMock.mockReset();
    skipMock.mockReset();
    approveMock.mockReset();
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

  it('renders pending items with their evidence and approves through the action path', async () => {
    fetchInboxMock.mockResolvedValue([item({})]);
    approveMock.mockResolvedValue({ ok: true, detail: 'email sent' });
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText(/they hit the seat limit twice/i)).toBeInTheDocument();
    expect(screen.getByText(/14 sessions · seat modal ×9/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /approve and send/i }));
    expect(approveMock).toHaveBeenCalledWith('item-1');
  });

  it('skips an item via the rpc path', async () => {
    fetchInboxMock.mockResolvedValue([item({})]);
    skipMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();

    await screen.findByText(/they hit the seat limit twice/i);
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(skipMock).toHaveBeenCalledWith('item-1');
  });

  it('surfaces a failed action instead of resolving silently', async () => {
    fetchInboxMock.mockResolvedValue([item({})]);
    approveMock.mockResolvedValue({ ok: false, detail: 'connect Resend to send outreach' });
    const user = userEvent.setup();
    renderPage();

    await screen.findByText(/they hit the seat limit twice/i);
    await user.click(screen.getByRole('button', { name: /approve and send/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/connect resend/i);
  });
});
