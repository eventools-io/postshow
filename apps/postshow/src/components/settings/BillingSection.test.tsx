import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { BillingSection } from './BillingSection';
import {
  fetchBillingSnapshot,
  fetchPlanChangeStatus,
  openBillingPortal,
  previewPlanChange,
  type BillingSnapshot,
  type PlanChangeStatus,
} from '@/lib/billing';
import { confirmPlanChangePayment } from '@/lib/stripeBrowser';

vi.mock('@/lib/billing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing')>();
  return {
    ...actual,
    fetchBillingSnapshot: vi.fn(),
    beginCheckout: vi.fn(),
    openBillingPortal: vi.fn(),
    previewPlanChange: vi.fn(),
    confirmPlanChange: vi.fn(),
    cancelPlanChange: vi.fn(),
    retryPlanChangePayment: vi.fn(),
    fetchPlanChangeStatus: vi.fn(),
  };
});
vi.mock('@/lib/api', () => ({
  fetchUsageSummary: vi.fn().mockResolvedValue([]),
  fetchEntitlements: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));
vi.mock('@/lib/stripeBrowser', () => ({ confirmPlanChangePayment: vi.fn() }));
vi.mock('@/lib/auth', () => ({
  fetchPublicReleaseGates: vi.fn().mockResolvedValue({
    signup: true,
    checkout: true,
    hosted_runtime: true,
    plan_changes: true,
    workspace_export: true,
    workspace_deletion: true,
  }),
}));

const workspaceId = '22222222-2222-4222-8222-222222222222';
const status: PlanChangeStatus = {
  id: '11111111-1111-4111-8111-111111111111',
  workspace_id: workspaceId,
  from_plan: 'solo',
  to_plan: 'team',
  status: 'quoted',
  effective_at: '2026-07-21T12:00:00.000Z',
  payment_action_required: false,
  preview_amount_due_minor: 1200,
  preview_currency: 'usd',
  quote_hash: 'a'.repeat(64),
  quoted_at: '2026-07-21T10:00:00.000Z',
  confirmed_at: null,
  mutation_expires_at: null,
  accepted_preview_validated_at: null,
  plan_changes_enabled: true,
  cancel_state: 'none',
  error_code: '',
  error_message: '',
  created_at: '2026-07-21T10:00:00.000Z',
  updated_at: '2026-07-21T10:00:00.000Z',
  completed_at: null,
  canceled_at: null,
};
const snapshot: BillingSnapshot = {
  billing: {
    workspace_id: workspaceId,
    plan: 'solo',
    status: 'active',
    payment_status: 'paid',
    current_period_start: '2026-07-01T00:00:00.000Z',
    current_period_end: '2026-08-01T00:00:00.000Z',
    cancel_at_period_end: false,
    billing_provider: 'stripe',
    standing_observed_at: '2026-07-21T10:00:00.000Z',
    grace_until: null,
  },
  invoices: [
    {
      id: 'b'.repeat(64),
      status: 'paid',
      payment_status: 'paid',
      period_start: '2026-07-01T00:00:00.000Z',
      period_end: '2026-08-01T00:00:00.000Z',
      amount_due_minor: 2900,
      amount_paid_minor: 2900,
      currency: 'usd',
      observed_at: '2026-07-21T09:59:00.000Z',
    },
  ],
  active_plan_change: null,
};

function LocationProbe() {
  return <span data-testid="location-search">{useLocation().search}</span>;
}

function renderBilling(initialEntry = '/settings') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <BillingSection workspaceId={workspaceId} />
      <LocationProbe />
    </MemoryRouter>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('BillingSection', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
      },
    });
    vi.mocked(fetchBillingSnapshot).mockReset().mockResolvedValue(snapshot);
    vi.mocked(fetchPlanChangeStatus).mockReset();
    vi.mocked(previewPlanChange).mockReset();
    vi.mocked(openBillingPortal).mockReset();
    vi.mocked(confirmPlanChangePayment).mockReset();
  });

  it('renders authoritative standing, usage controls, and invoice receipts', async () => {
    renderBilling();

    expect(await screen.findByText(/Solo · \$99\/mo/i)).toBeInTheDocument();
    expect(screen.getByText('$29.00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /manage billing/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /review upgrade to team/i })).toBeInTheDocument();
  });

  it('requires review of the exact quote before a plan change', async () => {
    vi.mocked(previewPlanChange).mockResolvedValue({
      request: status,
      quote: {
        amount_due_minor: 1200,
        currency: 'usd',
        hash: 'a'.repeat(64),
        effective_at: status.effective_at,
      },
      payment_action: null,
    });
    renderBilling();

    fireEvent.click(await screen.findByRole('button', { name: /review upgrade to team/i }));

    await waitFor(() => expect(previewPlanChange).toHaveBeenCalled());
    expect(await screen.findByRole('heading', { name: /confirm team/i })).toBeInTheDocument();
    expect(screen.getByText(/\$12.00 is due now/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /accept exact quote/i })).toBeInTheDocument();
  });

  it('refreshes authoritative standing when the app regains focus', async () => {
    renderBilling();
    await screen.findByText(/Solo · \$99\/mo/i);
    const callsBeforeFocus = vi.mocked(fetchBillingSnapshot).mock.calls.length;

    fireEvent.focus(window);

    await waitFor(() =>
      expect(vi.mocked(fetchBillingSnapshot).mock.calls.length).toBeGreaterThan(callsBeforeFocus)
    );
  });

  it('recovers a secure payment action for an in-progress confirmation', async () => {
    const paymentStatus: PlanChangeStatus = {
      ...status,
      status: 'payment_action_required',
      payment_action_required: true,
    };
    vi.mocked(fetchBillingSnapshot).mockResolvedValue({
      ...snapshot,
      active_plan_change: paymentStatus,
    });
    vi.mocked(fetchPlanChangeStatus).mockResolvedValue({
      request: paymentStatus,
      quote: null,
      payment_action: {
        publishable_key: 'pk_test_example',
        client_secret: 'pi_example_secret_example',
      },
    });

    renderBilling();

    expect(
      await screen.findByRole('button', { name: /continue secure payment/i }, { timeout: 3500 })
    ).toBeInTheDocument();
    expect(fetchPlanChangeStatus).toHaveBeenCalledWith(workspaceId, paymentStatus.id);
  });

  it('cleans the workspace binding from a verified checkout cancellation', async () => {
    renderBilling(`/settings?checkout=cancelled&workspace=${workspaceId}`);

    expect(await screen.findByText(/checkout was canceled/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('location-search')).toHaveTextContent(''));
  });

  it('does not continue a workspace A billing redirect after its keyed view switches to B', async () => {
    const portal = deferred<string>();
    vi.mocked(openBillingPortal).mockReturnValue(portal.promise);
    const storageWrite = vi.spyOn(window.localStorage, 'setItem');
    const secondWorkspaceId = '33333333-3333-4333-8333-333333333333';
    const view = render(
      <MemoryRouter initialEntries={['/settings']}>
        <BillingSection key={workspaceId} workspaceId={workspaceId} />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole('button', { name: /manage billing/i }));
    await waitFor(() =>
      expect(openBillingPortal).toHaveBeenCalledWith(workspaceId, expect.any(String))
    );

    view.rerender(
      <MemoryRouter initialEntries={['/settings']}>
        <BillingSection key={secondWorkspaceId} workspaceId={secondWorkspaceId} />
      </MemoryRouter>
    );
    await act(async () => {
      portal.resolve('https://billing.stripe.com/p/session-example');
      await portal.promise;
    });

    expect(storageWrite).not.toHaveBeenCalledWith(
      `postshow.billing-handoff.${workspaceId}`,
      expect.any(String)
    );
  });

  it('cancels a delayed workspace A payment confirmation when its keyed view switches to B', async () => {
    const paymentStatus: PlanChangeStatus = {
      ...status,
      status: 'payment_action_required',
      payment_action_required: true,
    };
    vi.mocked(fetchBillingSnapshot).mockResolvedValue({
      ...snapshot,
      active_plan_change: paymentStatus,
    });
    vi.mocked(fetchPlanChangeStatus).mockResolvedValue({
      request: paymentStatus,
      quote: null,
      payment_action: {
        publishable_key: 'pk_test_example',
        client_secret: 'pi_example_secret_example',
      },
    });
    const confirmation = deferred<void>();
    vi.mocked(confirmPlanChangePayment).mockReturnValue(confirmation.promise);
    const secondWorkspaceId = '33333333-3333-4333-8333-333333333333';
    const view = render(
      <MemoryRouter initialEntries={['/settings']}>
        <BillingSection key={workspaceId} workspaceId={workspaceId} />
      </MemoryRouter>
    );

    fireEvent.click(
      await screen.findByRole('button', { name: /continue secure payment/i }, { timeout: 3500 })
    );
    await waitFor(() => expect(confirmPlanChangePayment).toHaveBeenCalledOnce());
    const signal = vi.mocked(confirmPlanChangePayment).mock.calls[0]?.[2];
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);

    vi.mocked(fetchBillingSnapshot).mockResolvedValue({
      ...snapshot,
      billing: { ...snapshot.billing, workspace_id: secondWorkspaceId },
      active_plan_change: null,
    });
    view.rerender(
      <MemoryRouter initialEntries={['/settings']}>
        <BillingSection key={secondWorkspaceId} workspaceId={secondWorkspaceId} />
      </MemoryRouter>
    );

    expect(signal?.aborted).toBe(true);
    await act(async () => {
      confirmation.resolve();
      await confirmation.promise;
    });
  });
});
