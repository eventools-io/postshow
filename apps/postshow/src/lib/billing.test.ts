import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginCheckout,
  fetchBillingSnapshot,
  openBillingPortal,
  previewPlanChange,
} from './billing';
import { invokePostshowFunction } from './functionClient';

vi.mock('./functionClient', () => ({ invokePostshowFunction: vi.fn() }));

const invoke = vi.mocked(invokePostshowFunction);

const planChange = {
  id: '11111111-1111-4111-8111-111111111111',
  workspace_id: '22222222-2222-4222-8222-222222222222',
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

describe('billing client', () => {
  beforeEach(() => invoke.mockReset());

  it('loads and validates the authoritative standing and invoice history', async () => {
    invoke.mockResolvedValue({
      billing: {
        workspace_id: planChange.workspace_id,
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
      active_plan_change: planChange,
    });

    const result = await fetchBillingSnapshot(planChange.workspace_id);

    expect(invoke).toHaveBeenCalledWith('postshow-billing', {
      op: 'snapshot',
      workspace_id: planChange.workspace_id,
    });
    expect(result.billing.plan).toBe('solo');
    expect(result.invoices[0]?.amount_paid_minor).toBe(2900);
    expect(result.invoices[0]?.id).toBe('b'.repeat(64));
    expect(result.invoices[0]?.observed_at).toBe('2026-07-21T09:59:00.000Z');
    expect(result.active_plan_change?.quote_hash).toBe('a'.repeat(64));
  });

  it('sends a durable key for checkout and rejects unsafe redirects', async () => {
    invoke.mockResolvedValueOnce({ ok: true, url: 'https://checkout.stripe.com/c/pay' });
    await expect(beginCheckout(planChange.workspace_id, 'team', 'idem-key')).resolves.toEqual({
      url: 'https://checkout.stripe.com/c/pay',
      provisioning: false,
    });
    expect(invoke).toHaveBeenLastCalledWith('postshow-checkout', {
      op: 'checkout',
      workspace_id: planChange.workspace_id,
      tier: 'team',
      idempotency_key: 'idem-key',
    });

    invoke.mockResolvedValueOnce({ ok: true, url: 'http://attacker.invalid/portal' });
    await expect(openBillingPortal(planChange.workspace_id, 'portal-key')).rejects.toThrow(
      /unsafe redirect/i
    );
  });

  it('binds plan confirmation to the exact preview hash', async () => {
    invoke.mockResolvedValue({
      ok: true,
      request: planChange,
      quote: {
        amount_due_minor: 1200,
        currency: 'usd',
        hash: 'a'.repeat(64),
        effective_at: planChange.effective_at,
        financial_manifest: {},
      },
    });

    const result = await previewPlanChange(planChange.workspace_id, 'team', 'preview-key');

    expect(invoke).toHaveBeenCalledWith('postshow-plan-change', {
      op: 'preview',
      workspace_id: planChange.workspace_id,
      target_plan: 'team',
      idempotency_key: 'preview-key',
    });
    expect(result.quote?.hash).toBe('a'.repeat(64));
  });

  it('fails closed on malformed authoritative data', async () => {
    invoke.mockResolvedValue({
      billing: {
        workspace_id: planChange.workspace_id,
        plan: 'team',
        status: 'active',
        payment_status: 'paid',
        current_period_start: null,
        current_period_end: null,
        cancel_at_period_end: 'no',
        billing_provider: 'stripe',
        standing_observed_at: null,
        grace_until: null,
      },
      invoices: [],
      active_plan_change: null,
    });

    await expect(fetchBillingSnapshot(planChange.workspace_id)).rejects.toThrow(
      /cancellation status/i
    );
  });

  it('rejects a valid snapshot bound to a different workspace', async () => {
    invoke.mockResolvedValue({
      billing: {
        workspace_id: '33333333-3333-4333-8333-333333333333',
        plan: 'free',
        status: 'none',
        payment_status: 'unverified',
        current_period_start: null,
        current_period_end: null,
        cancel_at_period_end: false,
        billing_provider: 'none',
        standing_observed_at: null,
        grace_until: null,
      },
      invoices: [],
      active_plan_change: null,
    });

    await expect(fetchBillingSnapshot(planChange.workspace_id)).rejects.toThrow(
      /different workspace/i
    );
  });

  it('rejects provider invoice identifiers and the obsolete issued-at contract', async () => {
    const base = {
      billing: {
        workspace_id: planChange.workspace_id,
        plan: 'solo',
        status: 'active',
        payment_status: 'paid',
        current_period_start: null,
        current_period_end: null,
        cancel_at_period_end: false,
        billing_provider: 'stripe',
        standing_observed_at: '2026-07-21T10:00:00.000Z',
        grace_until: null,
      },
      active_plan_change: null,
    };
    invoke.mockResolvedValue({
      ...base,
      invoices: [
        {
          id: 'in_provider_identifier',
          status: 'paid',
          payment_status: 'paid',
          period_start: '2026-07-01T00:00:00.000Z',
          period_end: '2026-08-01T00:00:00.000Z',
          amount_due_minor: 2900,
          amount_paid_minor: 2900,
          currency: 'usd',
          observed_at: '2026-07-21T10:00:00.000Z',
        },
      ],
    });
    await expect(fetchBillingSnapshot(planChange.workspace_id)).rejects.toThrow(/opaque invoice/i);

    invoke.mockResolvedValue({
      ...base,
      invoices: [
        {
          id: 'c'.repeat(64),
          status: 'paid',
          payment_status: 'paid',
          period_start: '2026-07-01T00:00:00.000Z',
          period_end: '2026-08-01T00:00:00.000Z',
          amount_due_minor: 2900,
          amount_paid_minor: 2900,
          currency: 'usd',
          issued_at: '2026-07-21T10:00:00.000Z',
        },
      ],
    });
    await expect(fetchBillingSnapshot(planChange.workspace_id)).rejects.toThrow(
      /invoice observation date/i
    );
  });

  it('maps unknown plan-change errors to public billing-attention copy', async () => {
    invoke.mockResolvedValue({
      ok: true,
      request: {
        ...planChange,
        error_code: 'stripe_internal_stack_trace',
        error_message: 'sensitive provider detail',
      },
      quote: null,
      payment_action: null,
    });

    const result = await previewPlanChange(planChange.workspace_id, 'team', 'preview-key');

    expect(result.request.error_code).toBe('billing_attention');
    expect(result.request.error_message).toBe(
      'Billing needs attention. No duplicate charge will be attempted.'
    );
  });
});
