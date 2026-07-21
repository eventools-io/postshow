import { invokePostshowFunction } from './functionClient';

export type BillingPlan = 'free' | 'solo' | 'team' | 'enterprise';
export type BillingProvider = 'none' | 'stripe' | 'metronome';

export interface BillingStanding {
  workspace_id: string;
  plan: BillingPlan;
  status: string;
  payment_status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  billing_provider: BillingProvider;
  standing_observed_at: string | null;
  grace_until: string | null;
}

export interface BillingInvoice {
  id: string;
  status: string;
  payment_status: string;
  period_start: string;
  period_end: string;
  amount_due_minor: number;
  amount_paid_minor: number;
  currency: string;
  observed_at: string;
}

export type PlanChangeErrorCode =
  | ''
  | 'quote_changed'
  | 'payment_action_required'
  | 'payment_method_required'
  | 'boundary_too_close'
  | 'provider_update_expired'
  | 'cancel_race_lost'
  | 'provider_unavailable'
  | 'billing_attention';

export type PlanChangeStatusName =
  | 'requested'
  | 'quoted'
  | 'confirmed'
  | 'provider_pending'
  | 'payment_action_required'
  | 'payment_method_required'
  | 'scheduled'
  | 'reconcile_pending'
  | 'cancel_requested'
  | 'completed'
  | 'canceled'
  | 'expired'
  | 'superseded'
  | 'needs_review';

export interface PlanChangeStatus {
  id: string;
  workspace_id: string;
  from_plan: 'solo' | 'team';
  to_plan: 'solo' | 'team';
  status: PlanChangeStatusName;
  effective_at: string;
  payment_action_required: boolean;
  preview_amount_due_minor: number | null;
  preview_currency: string | null;
  quote_hash: string | null;
  quoted_at: string | null;
  confirmed_at: string | null;
  mutation_expires_at: string | null;
  accepted_preview_validated_at: string | null;
  plan_changes_enabled: boolean;
  cancel_state: string;
  error_code: PlanChangeErrorCode;
  error_message: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  canceled_at: string | null;
}

export interface BillingSnapshot {
  billing: BillingStanding;
  invoices: BillingInvoice[];
  active_plan_change: PlanChangeStatus | null;
}

export interface PlanChangeQuote {
  amount_due_minor: number;
  currency: string;
  hash: string;
  effective_at: string;
}

export interface PaymentAction {
  client_secret: string;
  publishable_key: string;
}

export interface PlanChangeResponse {
  request: PlanChangeStatus;
  quote: PlanChangeQuote | null;
  payment_action: PaymentAction | null;
}

const BILLING_FUNCTION =
  import.meta.env.VITE_POSTSHOW_BILLING_FUNCTION?.trim() || 'postshow-billing';
const CHECKOUT_FUNCTION =
  import.meta.env.VITE_POSTSHOW_CHECKOUT_FUNCTION?.trim() || 'postshow-checkout';
const PLAN_CHANGE_FUNCTION =
  import.meta.env.VITE_POSTSHOW_PLAN_CHANGE_FUNCTION?.trim() || 'postshow-plan-change';

const PLANS = ['free', 'solo', 'team', 'enterprise'] as const;
const PROVIDERS = ['none', 'stripe', 'metronome'] as const;
const PLAN_CHANGE_STATUSES: readonly PlanChangeStatusName[] = [
  'requested',
  'quoted',
  'confirmed',
  'provider_pending',
  'payment_action_required',
  'payment_method_required',
  'scheduled',
  'reconcile_pending',
  'cancel_requested',
  'completed',
  'canceled',
  'expired',
  'superseded',
  'needs_review',
];
const PLAN_CHANGE_ERROR_CODES: readonly PlanChangeErrorCode[] = [
  '',
  'quote_changed',
  'payment_action_required',
  'payment_method_required',
  'boundary_too_close',
  'provider_update_expired',
  'cancel_race_lost',
  'provider_unavailable',
  'billing_attention',
];

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Billing returned an invalid ${label}.`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Billing returned an invalid ${label}.`);
  }
  return value;
}

function optionalString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  return string(value, label);
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Billing returned an invalid ${label}.`);
  return value;
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Billing returned an invalid ${label}.`);
  }
  return value as number;
}

function nullableInteger(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  return integer(value, label);
}

function oneOf<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new Error(`Billing returned an invalid ${label}.`);
  }
  return value as T;
}

function publicPlanChangeErrorCode(value: unknown): PlanChangeErrorCode {
  if (value === null || value === '') return '';
  return typeof value === 'string' && PLAN_CHANGE_ERROR_CODES.includes(value as PlanChangeErrorCode)
    ? (value as PlanChangeErrorCode)
    : 'billing_attention';
}

function publicPlanChangeErrorMessage(code: PlanChangeErrorCode): string {
  switch (code) {
    case '':
      return '';
    case 'quote_changed':
      return 'The price or tax quote changed. Review it again.';
    case 'payment_action_required':
      return 'Your bank needs you to confirm the payment.';
    case 'payment_method_required':
      return 'Update the payment method and retry.';
    case 'boundary_too_close':
      return 'The billing boundary was too close. Refresh and try again.';
    case 'provider_update_expired':
      return 'The payment did not complete. Your current plan is unchanged.';
    case 'cancel_race_lost':
      return 'The plan change completed before cancellation.';
    case 'provider_unavailable':
      return 'Billing is temporarily unavailable. We will retry.';
    case 'billing_attention':
      return 'Billing needs attention. No duplicate charge will be attempted.';
  }
}

function parsePlanChange(value: unknown): PlanChangeStatus {
  const row = record(value, 'plan change');
  const errorCode = publicPlanChangeErrorCode(row.error_code);
  return {
    id: string(row.id, 'plan-change id'),
    workspace_id: string(row.workspace_id, 'plan-change workspace'),
    from_plan: oneOf(row.from_plan, ['solo', 'team'] as const, 'source plan'),
    to_plan: oneOf(row.to_plan, ['solo', 'team'] as const, 'target plan'),
    status: oneOf(row.status, PLAN_CHANGE_STATUSES, 'plan-change status'),
    effective_at: string(row.effective_at, 'effective date'),
    payment_action_required: boolean(row.payment_action_required, 'payment-action status'),
    preview_amount_due_minor: nullableInteger(row.preview_amount_due_minor, 'quote amount'),
    preview_currency: optionalString(row.preview_currency, 'quote currency'),
    quote_hash: optionalString(row.quote_hash, 'quote hash'),
    quoted_at: optionalString(row.quoted_at, 'quote date'),
    confirmed_at: optionalString(row.confirmed_at, 'confirmation date'),
    mutation_expires_at: optionalString(row.mutation_expires_at, 'mutation expiry'),
    accepted_preview_validated_at: optionalString(
      row.accepted_preview_validated_at,
      'quote validation date'
    ),
    plan_changes_enabled: boolean(row.plan_changes_enabled, 'plan-change release status'),
    cancel_state: typeof row.cancel_state === 'string' ? row.cancel_state : 'none',
    error_code: errorCode,
    error_message: publicPlanChangeErrorMessage(errorCode),
    created_at: string(row.created_at, 'created date'),
    updated_at: string(row.updated_at, 'updated date'),
    completed_at: optionalString(row.completed_at, 'completion date'),
    canceled_at: optionalString(row.canceled_at, 'cancellation date'),
  };
}

function parseInvoice(value: unknown): BillingInvoice {
  const row = record(value, 'invoice');
  const currency = string(row.currency, 'invoice currency');
  if (!/^[a-z]{3}$/.test(currency))
    throw new Error('Billing returned an invalid invoice currency.');
  const id = string(row.id, 'invoice id');
  if (!/^[0-9a-f]{64}$/.test(id)) {
    throw new Error('Billing returned an invalid opaque invoice id.');
  }
  return {
    id,
    status: string(row.status, 'invoice status'),
    payment_status: string(row.payment_status, 'invoice payment status'),
    period_start: string(row.period_start, 'invoice period'),
    period_end: string(row.period_end, 'invoice period'),
    amount_due_minor: integer(row.amount_due_minor, 'invoice amount'),
    amount_paid_minor: integer(row.amount_paid_minor, 'invoice amount'),
    currency,
    observed_at: string(row.observed_at, 'invoice observation date'),
  };
}

function parseSnapshot(value: unknown): BillingSnapshot {
  const payload = record(value, 'snapshot');
  const row = record(payload.billing, 'standing');
  if (!Array.isArray(payload.invoices) || payload.invoices.length > 200) {
    throw new Error('Billing returned an invalid invoice history.');
  }
  return {
    billing: {
      workspace_id: string(row.workspace_id, 'workspace'),
      plan: oneOf(row.plan, PLANS, 'plan'),
      status: string(row.status, 'subscription status'),
      payment_status: string(row.payment_status, 'payment status'),
      current_period_start: optionalString(row.current_period_start, 'billing period'),
      current_period_end: optionalString(row.current_period_end, 'billing period'),
      cancel_at_period_end: boolean(row.cancel_at_period_end, 'cancellation status'),
      billing_provider: oneOf(row.billing_provider, PROVIDERS, 'billing provider'),
      standing_observed_at: optionalString(row.standing_observed_at, 'standing date'),
      grace_until: optionalString(row.grace_until, 'grace date'),
    },
    invoices: payload.invoices.map(parseInvoice),
    active_plan_change:
      payload.active_plan_change === null || payload.active_plan_change === undefined
        ? null
        : parsePlanChange(payload.active_plan_change),
  };
}

function requireSnapshotIdentity(snapshot: BillingSnapshot, workspaceId: string): BillingSnapshot {
  if (
    snapshot.billing.workspace_id !== workspaceId ||
    (snapshot.active_plan_change && snapshot.active_plan_change.workspace_id !== workspaceId)
  ) {
    throw new Error('Billing returned data for a different workspace.');
  }
  return snapshot;
}

function parseQuote(value: unknown): PlanChangeQuote | null {
  if (value === null || value === undefined) return null;
  const quote = record(value, 'plan-change quote');
  const hash = string(quote.hash, 'quote hash');
  const currency = string(quote.currency, 'quote currency');
  if (!/^[0-9a-f]{64}$/.test(hash) || !/^[a-z]{3}$/.test(currency)) {
    throw new Error('Billing returned an invalid plan-change quote.');
  }
  return {
    amount_due_minor: integer(quote.amount_due_minor, 'quote amount'),
    currency,
    hash,
    effective_at: string(quote.effective_at, 'quote effective date'),
  };
}

function parsePaymentAction(value: unknown): PaymentAction | null {
  if (value === null || value === undefined) return null;
  const action = record(value, 'payment action');
  return {
    client_secret: string(action.client_secret, 'payment confirmation'),
    publishable_key: string(action.publishable_key, 'payment key'),
  };
}

function parsePlanChangeResponse(value: unknown): PlanChangeResponse {
  const payload = record(value, 'plan-change response');
  if (payload.ok !== true) throw new Error('Billing did not accept the plan-change request.');
  return {
    request: parsePlanChange(payload.request),
    quote: parseQuote(payload.quote),
    payment_action: parsePaymentAction(payload.payment_action),
  };
}

function requirePlanChangeIdentity(
  response: PlanChangeResponse,
  workspaceId: string,
  requestId?: string
): PlanChangeResponse {
  if (
    response.request.workspace_id !== workspaceId ||
    (requestId !== undefined && response.request.id !== requestId)
  ) {
    throw new Error('Billing returned a different plan-change request.');
  }
  return response;
}

function parseRedirect(value: unknown): { url: string | null; provisioning: boolean } {
  const payload = record(value, 'redirect');
  if (payload.ok !== true) throw new Error('Billing did not accept the request.');
  const url = optionalString(payload.url, 'redirect URL');
  if (url) {
    const parsed = new URL(url);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      (parsed.hostname !== 'stripe.com' && !parsed.hostname.endsWith('.stripe.com'))
    ) {
      throw new Error('Billing returned an unsafe redirect URL.');
    }
  }
  return { url, provisioning: payload.provisioning === true };
}

export async function fetchBillingSnapshot(workspaceId: string): Promise<BillingSnapshot> {
  return requireSnapshotIdentity(
    parseSnapshot(
      await invokePostshowFunction(BILLING_FUNCTION, {
        op: 'snapshot',
        workspace_id: workspaceId,
      })
    ),
    workspaceId
  );
}

export async function beginCheckout(
  workspaceId: string,
  tier: 'solo' | 'team',
  idempotencyKey: string
): Promise<{ url: string | null; provisioning: boolean }> {
  return parseRedirect(
    await invokePostshowFunction(CHECKOUT_FUNCTION, {
      op: 'checkout',
      workspace_id: workspaceId,
      tier,
      idempotency_key: idempotencyKey,
    })
  );
}

export async function openBillingPortal(
  workspaceId: string,
  idempotencyKey: string
): Promise<string> {
  const result = parseRedirect(
    await invokePostshowFunction(CHECKOUT_FUNCTION, {
      op: 'portal',
      workspace_id: workspaceId,
      idempotency_key: idempotencyKey,
    })
  );
  if (!result.url) throw new Error('Billing did not return a portal URL.');
  return result.url;
}

export async function previewPlanChange(
  workspaceId: string,
  targetPlan: 'solo' | 'team',
  idempotencyKey: string
): Promise<PlanChangeResponse> {
  return requirePlanChangeIdentity(
    parsePlanChangeResponse(
      await invokePostshowFunction(PLAN_CHANGE_FUNCTION, {
        op: 'preview',
        workspace_id: workspaceId,
        target_plan: targetPlan,
        idempotency_key: idempotencyKey,
      })
    ),
    workspaceId
  );
}

export async function confirmPlanChange(
  workspaceId: string,
  requestId: string,
  quoteHash: string,
  idempotencyKey: string
): Promise<PlanChangeResponse> {
  return requirePlanChangeIdentity(
    parsePlanChangeResponse(
      await invokePostshowFunction(PLAN_CHANGE_FUNCTION, {
        op: 'change',
        workspace_id: workspaceId,
        request_id: requestId,
        accepted_preview_hash: quoteHash,
        idempotency_key: idempotencyKey,
      })
    ),
    workspaceId,
    requestId
  );
}

export async function cancelPlanChange(
  workspaceId: string,
  requestId: string,
  idempotencyKey: string
): Promise<PlanChangeResponse> {
  return requirePlanChangeIdentity(
    parsePlanChangeResponse(
      await invokePostshowFunction(PLAN_CHANGE_FUNCTION, {
        op: 'cancel',
        workspace_id: workspaceId,
        request_id: requestId,
        idempotency_key: idempotencyKey,
      })
    ),
    workspaceId,
    requestId
  );
}

export async function retryPlanChangePayment(
  workspaceId: string,
  requestId: string,
  idempotencyKey: string
): Promise<PlanChangeResponse> {
  return requirePlanChangeIdentity(
    parsePlanChangeResponse(
      await invokePostshowFunction(PLAN_CHANGE_FUNCTION, {
        op: 'retry_payment',
        workspace_id: workspaceId,
        request_id: requestId,
        idempotency_key: idempotencyKey,
      })
    ),
    workspaceId,
    requestId
  );
}

export async function fetchPlanChangeStatus(
  workspaceId: string,
  requestId: string
): Promise<PlanChangeResponse> {
  return requirePlanChangeIdentity(
    parsePlanChangeResponse(
      await invokePostshowFunction(PLAN_CHANGE_FUNCTION, {
        op: 'status',
        workspace_id: workspaceId,
        request_id: requestId,
      })
    ),
    workspaceId,
    requestId
  );
}
