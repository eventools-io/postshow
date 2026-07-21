import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PLANS,
  effectiveQuota,
  normalizePlanId,
  type EntitlementOverrides,
} from '@eventools/postshow-core';
import { useSearchParams } from 'react-router-dom';
import { ErrorRow, LoadingRow, Section } from '@/components/page';
import {
  beginCheckout,
  cancelPlanChange,
  confirmPlanChange,
  fetchBillingSnapshot,
  fetchPlanChangeStatus,
  openBillingPortal,
  previewPlanChange,
  retryPlanChangePayment,
  type BillingInvoice,
  type BillingPlan,
  type PaymentAction,
  type PlanChangeQuote,
  type PlanChangeStatus,
} from '@/lib/billing';
import { clearIdempotencyKey, idempotencyKey } from '@/lib/idempotency';
import { confirmPlanChangePayment } from '@/lib/stripeBrowser';
import { usePageData } from '@/lib/usePageData';
import type { UsageSummaryRow } from '@/lib/types';
import { fetchEntitlements, fetchUsageSummary } from '@/lib/api';
import { track } from '@/lib/analytics';
import { fetchPublicReleaseGates } from '@/lib/auth';

const TERMINAL_PLAN_CHANGE = new Set(['completed', 'canceled', 'expired', 'superseded']);
const AUTONOMOUS_PLAN_CHANGE = new Set([
  'confirmed',
  'provider_pending',
  'reconcile_pending',
  'cancel_requested',
]);
const HANDOFF_POLL_MS = 2 * 60 * 1000;

interface BillingHandoff {
  kind: 'checkout' | 'portal' | 'payment';
  startedAt: number;
  plan: BillingPlan;
  standingObservedAt: string | null;
  cancelAtPeriodEnd: boolean;
  operationScope: string | null;
}

function handoffStorageKey(workspaceId: string): string {
  return `postshow.billing-handoff.${workspaceId}`;
}

function loadBillingHandoff(workspaceId: string): BillingHandoff | null {
  try {
    const raw = window.localStorage.getItem(handoffStorageKey(workspaceId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<BillingHandoff>;
    if (
      !['checkout', 'portal', 'payment'].includes(value.kind ?? '') ||
      typeof value.startedAt !== 'number' ||
      Date.now() - value.startedAt > HANDOFF_POLL_MS ||
      value.startedAt > Date.now() + 60_000 ||
      !['free', 'solo', 'team', 'enterprise'].includes(value.plan ?? '') ||
      typeof value.cancelAtPeriodEnd !== 'boolean' ||
      (value.standingObservedAt !== null && typeof value.standingObservedAt !== 'string') ||
      (value.operationScope !== null &&
        (typeof value.operationScope !== 'string' || value.operationScope.length > 300))
    ) {
      window.localStorage.removeItem(handoffStorageKey(workspaceId));
      return null;
    }
    return value as BillingHandoff;
  } catch {
    return null;
  }
}

function saveBillingHandoff(workspaceId: string, handoff: BillingHandoff): void {
  try {
    window.localStorage.setItem(handoffStorageKey(workspaceId), JSON.stringify(handoff));
  } catch {
    // Polling still continues for the lifetime of this renderer.
  }
}

function removeBillingHandoff(workspaceId: string): void {
  try {
    window.localStorage.removeItem(handoffStorageKey(workspaceId));
  } catch {
    // Nothing else to clear.
  }
}

function formatMoney(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amountMinor / 100);
}

function formatDate(value: string | null, withTime = false): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' as const } : {}),
  }).format(date);
}

function planChangeMessage(change: PlanChangeStatus): string {
  if (change.error_message) return change.error_message;
  if (change.cancel_state !== 'none' && change.cancel_state !== 'completed') {
    return 'Canceling this plan change safely. Your current entitlement remains authoritative.';
  }
  switch (change.status) {
    case 'requested':
    case 'quoted':
      return 'Waiting for your confirmation.';
    case 'confirmed':
    case 'provider_pending':
      return 'Applying the change with the billing provider.';
    case 'payment_action_required':
      return 'Your bank needs an additional payment confirmation.';
    case 'payment_method_required':
      return 'Update your payment method, then retry the payment.';
    case 'scheduled':
      return `Scheduled for ${formatDate(change.effective_at)}.`;
    case 'reconcile_pending':
      return 'The provider accepted the change. Verifying entitlement before it appears here.';
    case 'cancel_requested':
      return 'Canceling the plan change.';
    case 'completed':
      return 'Plan change completed and verified.';
    case 'canceled':
      return 'Plan change canceled.';
    case 'expired':
      return 'The quote expired without changing your plan.';
    case 'superseded':
      return 'A newer billing state superseded this request.';
    case 'needs_review':
      return 'Billing is preserving your current entitlement while support reviews this change.';
  }
}

function UsageMeter({ label, used, quota }: { label: string; used: number; quota: number }) {
  const percent = quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-public-sans text-[13px] text-night-fg">{label}</span>
        <span className="font-public-mono text-[11px] text-night-fg-2">
          {used.toLocaleString()} / {quota.toLocaleString()}
        </span>
      </div>
      <div
        className="h-[6px] w-full overflow-hidden rounded-full bg-night-3"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={quota}
        aria-valuenow={Math.min(used, quota)}
      >
        <div
          className={percent >= 100 ? 'h-full bg-warn' : 'h-full bg-signal'}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function InvoiceHistory({ invoices }: { invoices: BillingInvoice[] }) {
  if (invoices.length === 0) {
    return (
      <p className="m-0 font-public-sans text-[12px] text-night-fg-3">
        No invoices have been issued for this workspace.
      </p>
    );
  }
  return (
    <ol className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Invoice history">
      {invoices.map((invoice) => (
        <li
          key={invoice.id}
          className="grid gap-1 rounded-md border border-night-4 bg-night-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-4"
        >
          <span className="min-w-0">
            <span className="block font-public-sans text-[13px] text-night-fg">
              Observed {formatDate(invoice.observed_at)}
            </span>
            <span className="block font-public-mono text-[10px] text-night-fg-3">
              {formatDate(invoice.period_start)} – {formatDate(invoice.period_end)}
            </span>
          </span>
          <span className="font-public-mono text-[10px] uppercase tracking-[0.1em] text-night-fg-2">
            {invoice.payment_status || invoice.status}
          </span>
          <span className="font-public-mono text-[12px] text-night-fg">
            {invoice.amount_paid_minor > 0 && invoice.amount_paid_minor < invoice.amount_due_minor
              ? `${formatMoney(invoice.amount_paid_minor, invoice.currency)} paid / ${formatMoney(invoice.amount_due_minor, invoice.currency)} due`
              : `${formatMoney(invoice.amount_paid_minor || invoice.amount_due_minor, invoice.currency)}${invoice.amount_paid_minor === 0 && invoice.amount_due_minor > 0 ? ' due' : ''}`}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function BillingSection({
  workspaceId,
  workspacePlan,
  onStandingChange,
}: {
  workspaceId: string;
  workspacePlan?: string;
  onStandingChange?: () => Promise<void>;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const billingFetcher = useCallback(() => fetchBillingSnapshot(workspaceId), [workspaceId]);
  const { data: snapshot, loading, error: loadError, reload } = usePageData(billingFetcher);
  const usageFetcher = useCallback(() => fetchUsageSummary(workspaceId), [workspaceId]);
  const { data: usage } = usePageData(usageFetcher);
  const entitlementFetcher = useCallback(() => fetchEntitlements(workspaceId), [workspaceId]);
  const { data: entitlementRow } = usePageData(entitlementFetcher);
  const gatesFetcher = useCallback(() => fetchPublicReleaseGates(), []);
  const {
    data: releaseGates,
    loading: releaseGatesLoading,
    error: releaseGateError,
  } = usePageData(gatesFetcher);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [activity, setActivity] = useState('');
  const [quote, setQuote] = useState<{
    request: PlanChangeStatus;
    quote: PlanChangeQuote;
  } | null>(null);
  const [localChange, setLocalChange] = useState<PlanChangeStatus | null>(null);
  const [paymentAction, setPaymentAction] = useState<PaymentAction | null>(null);
  const [handoff, setHandoff] = useState<BillingHandoff | null>(() =>
    loadBillingHandoff(workspaceId)
  );
  const pollAttempts = useRef(0);
  const focusedQuote = useRef('');
  const mounted = useRef(true);
  const currentWorkspaceId = useRef(workspaceId);
  const paymentConfirmation = useRef<AbortController | null>(null);
  currentWorkspaceId.current = workspaceId;

  const isCurrentWorkspace = useCallback(
    (expectedWorkspaceId: string) =>
      mounted.current && currentWorkspaceId.current === expectedWorkspaceId,
    []
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      paymentConfirmation.current?.abort();
    };
  }, []);

  useEffect(
    () => () => {
      paymentConfirmation.current?.abort();
    },
    [workspaceId]
  );

  const activeChange = localChange ?? snapshot?.active_plan_change ?? null;
  const returnState = searchParams.get('checkout') ?? searchParams.get('billing');
  const shouldPollChange = activeChange
    ? AUTONOMOUS_PLAN_CHANGE.has(activeChange.status) ||
      (activeChange.status === 'payment_action_required' && !paymentAction)
    : false;
  const shouldPollReturn =
    returnState === 'success' || returnState === 'return' || returnState === 'payment-return';
  const shouldPollHandoff = Boolean(handoff && Date.now() - handoff.startedAt < HANDOFF_POLL_MS);

  const startHandoff = useCallback(
    (kind: BillingHandoff['kind'], operationScope: string | null = null) => {
      const next: BillingHandoff = {
        kind,
        startedAt: Date.now(),
        plan: snapshot?.billing.plan ?? 'free',
        standingObservedAt: snapshot?.billing.standing_observed_at ?? null,
        cancelAtPeriodEnd: snapshot?.billing.cancel_at_period_end ?? false,
        operationScope,
      };
      pollAttempts.current = 0;
      saveBillingHandoff(workspaceId, next);
      setHandoff(next);
    },
    [snapshot, workspaceId]
  );

  useEffect(() => {
    const refresh = () => reload();
    const visible = () => {
      if (document.visibilityState === 'visible') reload();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [reload]);

  useEffect(() => {
    if (!snapshot || !workspacePlan || snapshot.billing.plan === workspacePlan || !onStandingChange)
      return;
    void onStandingChange();
  }, [onStandingChange, snapshot, workspacePlan]);

  useEffect(() => {
    if (returnState !== 'cancelled') return;
    clearIdempotencyKey(`${workspaceId}.checkout.solo`);
    clearIdempotencyKey(`${workspaceId}.checkout.team`);
    const next = new URLSearchParams(searchParams);
    next.delete('checkout');
    next.delete('session_id');
    next.delete('workspace');
    setSearchParams(next, { replace: true });
    setActivity('Checkout was canceled. Your current plan is unchanged.');
  }, [returnState, searchParams, setSearchParams, workspaceId]);

  useEffect(() => {
    const change = snapshot?.active_plan_change;
    if (
      !quote &&
      change?.status === 'quoted' &&
      (!localChange || localChange.id !== change.id || localChange.status === 'quoted') &&
      change.quote_hash &&
      change.preview_amount_due_minor !== null &&
      change.preview_currency
    ) {
      setQuote({
        request: change,
        quote: {
          amount_due_minor: change.preview_amount_due_minor,
          currency: change.preview_currency,
          hash: change.quote_hash,
          effective_at: change.effective_at,
        },
      });
    }
    if (
      localChange &&
      TERMINAL_PLAN_CHANGE.has(localChange.status) &&
      !snapshot?.active_plan_change
    ) {
      setLocalChange(null);
    }
  }, [localChange, quote, snapshot]);

  useEffect(() => {
    if (!shouldPollChange && !shouldPollReturn && !shouldPollHandoff) return;
    if ((shouldPollReturn || shouldPollHandoff) && pollAttempts.current >= 18) {
      setActivity('Billing is still reconciling. It is safe to leave this page and check again.');
      return;
    }
    let cancelled = false;
    const delay = Math.min(15_000, 1500 * 1.55 ** pollAttempts.current);
    const timer = window.setTimeout(() => {
      pollAttempts.current += 1;
      if (
        activeChange &&
        !TERMINAL_PLAN_CHANGE.has(activeChange.status) &&
        (shouldPollChange || shouldPollReturn || shouldPollHandoff)
      ) {
        void fetchPlanChangeStatus(workspaceId, activeChange.id)
          .then((response) => {
            if (cancelled) return;
            setLocalChange(response.request);
            setPaymentAction(response.payment_action);
            if (TERMINAL_PLAN_CHANGE.has(response.request.status)) reload();
          })
          .catch(() => {
            if (!cancelled) reload();
          });
      } else {
        reload();
      }
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeChange, reload, shouldPollChange, shouldPollHandoff, shouldPollReturn, workspaceId]);

  useEffect(() => {
    if ((!shouldPollReturn && !handoff) || loading || !snapshot) return;
    const planSettled =
      !snapshot.active_plan_change || TERMINAL_PLAN_CHANGE.has(snapshot.active_plan_change.status);
    const querySettled =
      (returnState !== 'success' || snapshot.billing.plan !== 'free') &&
      planSettled &&
      pollAttempts.current >= 1;
    const queryExpired = shouldPollReturn && pollAttempts.current >= 18;
    if (shouldPollReturn && (querySettled || queryExpired)) {
      const next = new URLSearchParams(searchParams);
      next.delete('checkout');
      next.delete('session_id');
      next.delete('billing');
      next.delete('workspace');
      setSearchParams(next, { replace: true });
      if (returnState === 'success' && querySettled) {
        clearIdempotencyKey(`${workspaceId}.checkout.solo`);
        clearIdempotencyKey(`${workspaceId}.checkout.team`);
      }
      setActivity(
        querySettled
          ? 'Billing status is verified and up to date.'
          : 'Billing is still reconciling. It is safe to leave this page and check again.'
      );
    }
    if (!handoff) return;
    const handoffSettled =
      (handoff.kind === 'checkout' && snapshot.billing.plan !== handoff.plan) ||
      (handoff.kind === 'portal' &&
        (snapshot.billing.standing_observed_at !== handoff.standingObservedAt ||
          snapshot.billing.cancel_at_period_end !== handoff.cancelAtPeriodEnd)) ||
      (handoff.kind === 'payment' && planSettled);
    const handoffExpired = Date.now() - handoff.startedAt >= HANDOFF_POLL_MS;
    if (handoffSettled) {
      if (handoff.operationScope) clearIdempotencyKey(handoff.operationScope);
      removeBillingHandoff(workspaceId);
      setHandoff(null);
      setActivity('Billing status is verified and up to date.');
    } else if (handoffExpired) {
      if (handoff.operationScope && handoff.kind !== 'checkout') {
        clearIdempotencyKey(handoff.operationScope);
      }
      removeBillingHandoff(workspaceId);
      setHandoff(null);
      setActivity('Billing is still reconciling. It is safe to leave this page and check again.');
    }
  }, [
    handoff,
    loading,
    returnState,
    searchParams,
    setSearchParams,
    shouldPollReturn,
    snapshot,
    workspaceId,
  ]);

  const plan = snapshot ? PLANS[normalizePlanId(snapshot.billing.plan)] : PLANS.free;
  const overrides: EntitlementOverrides | null = entitlementRow
    ? {
        sessionsWatched: entitlementRow.sessions_watched,
        deepDives: entitlementRow.deep_dives,
        investigations: entitlementRow.investigations,
        seats: entitlementRow.seats,
        metered: entitlementRow.metered,
      }
    : null;
  const quota = effectiveQuota(plan, overrides);
  const totals = useMemo(() => {
    const rows = usage ?? [];
    const sum = (task: string) =>
      rows
        .filter((row: UsageSummaryRow) => row.task_class === task)
        .reduce((total, row) => total + row.units, 0);
    return {
      sessions: sum('narration'),
      deepDives: sum('deep_dive'),
      investigations: sum('investigation') + sum('drafting'),
      costUsd: rows.reduce((total, row) => total + row.cost_usd_micros, 0) / 1_000_000,
    };
  }, [usage]);

  function fail(value: unknown, fallback: string) {
    setError(value instanceof Error ? value.message : fallback);
    setActivity('');
  }

  async function checkout(tier: 'solo' | 'team') {
    if (busy) return;
    const operationWorkspaceId = workspaceId;
    const scope = `${operationWorkspaceId}.checkout.${tier}`;
    setBusy(`checkout-${tier}`);
    setError('');
    setActivity('Creating a secure checkout…');
    try {
      const result = await beginCheckout(operationWorkspaceId, tier, idempotencyKey(scope));
      if (!isCurrentWorkspace(operationWorkspaceId)) return;
      if (result.url) {
        startHandoff('checkout', scope);
        window.location.assign(result.url);
        return;
      }
      if (result.provisioning) {
        startHandoff('checkout', scope);
        setActivity('Checkout completed. Verifying the subscription before enabling the plan…');
        reload();
        return;
      }
      throw new Error('Checkout did not return a secure destination.');
    } catch (value) {
      if (isCurrentWorkspace(operationWorkspaceId)) fail(value, 'Checkout could not be opened.');
    } finally {
      if (isCurrentWorkspace(operationWorkspaceId)) setBusy('');
    }
  }

  async function portal() {
    if (busy) return;
    const operationWorkspaceId = workspaceId;
    const scope = `${operationWorkspaceId}.portal`;
    setBusy('portal');
    setError('');
    setActivity('Opening secure billing management…');
    try {
      const url = await openBillingPortal(operationWorkspaceId, idempotencyKey(scope));
      if (!isCurrentWorkspace(operationWorkspaceId)) return;
      startHandoff('portal', scope);
      window.location.assign(url);
    } catch (value) {
      if (isCurrentWorkspace(operationWorkspaceId)) {
        fail(value, 'Billing management could not be opened.');
      }
    } finally {
      if (isCurrentWorkspace(operationWorkspaceId)) setBusy('');
    }
  }

  async function preview(target: 'solo' | 'team') {
    if (busy) return;
    const operationWorkspaceId = workspaceId;
    const scope = `${operationWorkspaceId}.plan-preview.${target}`;
    setBusy(`preview-${target}`);
    setError('');
    setActivity('Calculating an exact tax and proration quote…');
    try {
      const response = await previewPlanChange(operationWorkspaceId, target, idempotencyKey(scope));
      if (!isCurrentWorkspace(operationWorkspaceId)) return;
      if (!response.quote) throw new Error('Billing did not return a quote to review.');
      pollAttempts.current = 0;
      setQuote({ request: response.request, quote: response.quote });
      setLocalChange(response.request);
      clearIdempotencyKey(scope);
      setActivity('Quote ready. Review it before confirming.');
    } catch (value) {
      if (isCurrentWorkspace(operationWorkspaceId)) {
        fail(value, 'The plan-change quote could not be created.');
      }
    } finally {
      if (isCurrentWorkspace(operationWorkspaceId)) setBusy('');
    }
  }

  async function confirmQuote() {
    if (!quote || busy) return;
    const operationWorkspaceId = workspaceId;
    const scope = `${operationWorkspaceId}.plan-confirm.${quote.request.id}`;
    setBusy('confirm-change');
    setError('');
    setActivity('Submitting the accepted quote exactly once…');
    try {
      const response = await confirmPlanChange(
        operationWorkspaceId,
        quote.request.id,
        quote.quote.hash,
        idempotencyKey(scope)
      );
      if (!isCurrentWorkspace(operationWorkspaceId)) return;
      pollAttempts.current = 0;
      setLocalChange(response.request);
      setPaymentAction(response.payment_action);
      setQuote(null);
      clearIdempotencyKey(scope);
      track('billing_plan_change_confirmed', { to_plan: response.request.to_plan });
      setActivity(planChangeMessage(response.request));
      reload();
    } catch (value) {
      if (isCurrentWorkspace(operationWorkspaceId)) {
        fail(value, 'The plan change could not be submitted.');
      }
    } finally {
      if (isCurrentWorkspace(operationWorkspaceId)) setBusy('');
    }
  }

  async function dismissQuote() {
    if (!quote || busy) return;
    const operationWorkspaceId = workspaceId;
    const scope = `${operationWorkspaceId}.plan-cancel.${quote.request.id}`;
    setBusy('cancel-quote');
    setError('');
    setActivity('Canceling the unaccepted quote…');
    try {
      const response = await cancelPlanChange(
        operationWorkspaceId,
        quote.request.id,
        idempotencyKey(scope)
      );
      if (!isCurrentWorkspace(operationWorkspaceId)) return;
      setQuote(null);
      setLocalChange(response.request);
      clearIdempotencyKey(scope);
      setActivity('Quote canceled. Your current plan is unchanged.');
      reload();
    } catch (value) {
      if (isCurrentWorkspace(operationWorkspaceId)) {
        fail(value, 'The quote could not be canceled.');
      }
    } finally {
      if (isCurrentWorkspace(operationWorkspaceId)) setBusy('');
    }
  }

  async function cancelChange() {
    if (!activeChange || busy) return;
    const operationWorkspaceId = workspaceId;
    const scope = `${operationWorkspaceId}.plan-cancel.${activeChange.id}`;
    setBusy('cancel-change');
    setError('');
    setActivity('Canceling the pending change…');
    try {
      const response = await cancelPlanChange(
        operationWorkspaceId,
        activeChange.id,
        idempotencyKey(scope)
      );
      if (!isCurrentWorkspace(operationWorkspaceId)) return;
      pollAttempts.current = 0;
      setLocalChange(response.request);
      clearIdempotencyKey(scope);
      setActivity(planChangeMessage(response.request));
      reload();
    } catch (value) {
      if (isCurrentWorkspace(operationWorkspaceId)) {
        fail(value, 'The plan change could not be canceled.');
      }
    } finally {
      if (isCurrentWorkspace(operationWorkspaceId)) setBusy('');
    }
  }

  async function retryPayment() {
    if (!activeChange || busy) return;
    const operationWorkspaceId = workspaceId;
    const scope = `${operationWorkspaceId}.plan-retry.${activeChange.id}`;
    setBusy('retry-payment');
    setError('');
    setActivity('Retrying the exact plan-change invoice…');
    try {
      const response = await retryPlanChangePayment(
        operationWorkspaceId,
        activeChange.id,
        idempotencyKey(scope)
      );
      if (!isCurrentWorkspace(operationWorkspaceId)) return;
      pollAttempts.current = 0;
      setLocalChange(response.request);
      setPaymentAction(response.payment_action);
      clearIdempotencyKey(scope);
      setActivity(planChangeMessage(response.request));
      reload();
    } catch (value) {
      if (isCurrentWorkspace(operationWorkspaceId)) {
        fail(value, 'The payment could not be retried.');
      }
    } finally {
      if (isCurrentWorkspace(operationWorkspaceId)) setBusy('');
    }
  }

  async function confirmPayment() {
    if (!paymentAction || busy) return;
    const operationWorkspaceId = workspaceId;
    const controller = new AbortController();
    paymentConfirmation.current?.abort();
    paymentConfirmation.current = controller;
    setBusy('confirm-payment');
    setError('');
    setActivity('Opening your bank’s secure confirmation…');
    try {
      startHandoff('payment');
      await confirmPlanChangePayment(paymentAction, operationWorkspaceId, controller.signal);
      if (!isCurrentWorkspace(operationWorkspaceId) || controller.signal.aborted) return;
      setPaymentAction(null);
      setActivity('Payment confirmation submitted. Verifying billing status…');
      if (activeChange) {
        const response = await fetchPlanChangeStatus(operationWorkspaceId, activeChange.id);
        if (!isCurrentWorkspace(operationWorkspaceId) || controller.signal.aborted) return;
        setLocalChange(response.request);
        setPaymentAction(response.payment_action);
      }
      reload();
    } catch (value) {
      if (isCurrentWorkspace(operationWorkspaceId) && !controller.signal.aborted) {
        fail(value, 'Payment confirmation did not complete.');
      }
    } finally {
      if (paymentConfirmation.current === controller) paymentConfirmation.current = null;
      if (isCurrentWorkspace(operationWorkspaceId)) setBusy('');
    }
  }

  const authoritativePlan = snapshot?.billing.plan ?? ('free' as BillingPlan);
  const canCancelChange =
    activeChange &&
    !TERMINAL_PLAN_CHANGE.has(activeChange.status) &&
    activeChange.cancel_state === 'none';

  return (
    <Section title="Plan, billing, and usage">
      <div className="ps-card flex flex-col gap-5 p-4 sm:p-5">
        {loading && !snapshot ? <LoadingRow /> : null}
        {loadError && !snapshot ? (
          <div className="flex flex-wrap items-center gap-3">
            <ErrorRow message={`Billing status could not be loaded: ${loadError}`} />
            <button type="button" onClick={reload} className="ps-btn-ghost">
              Retry
            </button>
          </div>
        ) : null}

        {snapshot ? (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="m-0 font-public-sans text-[16px] font-medium text-night-fg">
                  {plan.label}
                  {plan.priceUsdMonthly ? ` · $${plan.priceUsdMonthly}/mo` : ' · $0'}
                </p>
                <p className="m-0 mt-1 max-w-[62ch] font-public-sans text-[13px] leading-[1.55] text-night-fg-2">
                  {plan.blurb}
                </p>
                <p className="m-0 mt-2 font-public-mono text-[10px] uppercase tracking-[0.1em] text-night-fg-3">
                  {snapshot.billing.status} · {snapshot.billing.payment_status}
                  {snapshot.billing.current_period_end
                    ? ` · ${snapshot.billing.cancel_at_period_end ? 'ends' : 'renews'} ${formatDate(snapshot.billing.current_period_end)}`
                    : ''}
                </p>
              </div>
              {snapshot.billing.billing_provider === 'stripe' ? (
                <button
                  type="button"
                  onClick={() => void portal()}
                  disabled={busy !== ''}
                  className="ps-btn-ghost shrink-0"
                >
                  {busy === 'portal'
                    ? 'Opening…'
                    : snapshot.billing.cancel_at_period_end
                      ? 'Undo cancellation in billing'
                      : 'Manage billing'}
                </button>
              ) : null}
            </div>

            {snapshot.billing.cancel_at_period_end ? (
              <div className="rounded-md border border-warn/50 bg-night-2 p-3" role="status">
                <p className="m-0 font-public-sans text-[13px] text-night-fg">
                  Cancellation is scheduled for {formatDate(snapshot.billing.current_period_end)}.
                </p>
                <p className="m-0 mt-1 font-public-sans text-[12px] text-night-fg-2">
                  Your plan remains active until then. Use billing management above to undo it.
                </p>
              </div>
            ) : null}

            {snapshot.billing.grace_until ? (
              <div className="rounded-md border border-warn/50 bg-night-2 p-3" role="alert">
                <p className="m-0 font-public-sans text-[13px] text-night-fg">
                  Payment needs attention before {formatDate(snapshot.billing.grace_until, true)}.
                </p>
                <p className="m-0 mt-1 font-public-sans text-[12px] text-night-fg-2">
                  We keep your last verified entitlement during this short reconciliation window.
                </p>
              </div>
            ) : null}

            {plan.hostedModels ? (
              <div className="flex flex-col gap-3">
                <UsageMeter
                  label="Sessions watched"
                  used={totals.sessions}
                  quota={quota.sessionsWatched}
                />
                <UsageMeter label="Deep dives" used={totals.deepDives} quota={quota.deepDives} />
                <UsageMeter
                  label="Investigations"
                  used={totals.investigations}
                  quota={quota.investigations}
                />
                <p className="m-0 font-public-sans text-[12px] leading-[1.5] text-night-fg-3">
                  {quota.metered
                    ? 'Custom usage billing stays available beyond the included quota under your agreement.'
                    : 'At the budget, cloud work degrades safely instead of surprise-billing. Your own-key and local runs are never metered.'}
                  {totals.costUsd > 0
                    ? ` Estimated hosted model cost this month: $${totals.costUsd.toFixed(2)}.`
                    : ''}
                </p>
              </div>
            ) : null}

            {!activeChange && !quote ? (
              <div className="flex flex-wrap items-center gap-2">
                {authoritativePlan === 'free' ? (
                  releaseGates?.checkout ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void checkout('solo')}
                        disabled={busy !== ''}
                        className="ps-btn-primary"
                      >
                        {busy === 'checkout-solo'
                          ? 'Opening…'
                          : `Upgrade to Solo · $${PLANS.solo.priceUsdMonthly}/mo`}
                      </button>
                      <button
                        type="button"
                        onClick={() => void checkout('team')}
                        disabled={busy !== ''}
                        className="ps-btn-ghost"
                      >
                        {busy === 'checkout-team'
                          ? 'Opening…'
                          : `Team · $${PLANS.team.priceUsdMonthly}/mo`}
                      </button>
                    </>
                  ) : (
                    <span className="font-public-sans text-[12px] text-night-fg-3">
                      {releaseGatesLoading
                        ? 'Checking checkout availability…'
                        : releaseGateError
                          ? 'Checkout availability could not be verified. Refresh before upgrading.'
                          : 'Hosted-plan checkout is not released yet.'}
                    </span>
                  )
                ) : authoritativePlan === 'solo' ? (
                  releaseGates?.plan_changes ? (
                    <button
                      type="button"
                      onClick={() => void preview('team')}
                      disabled={busy !== ''}
                      className="ps-btn-primary"
                    >
                      {busy === 'preview-team' ? 'Quoting…' : 'Review upgrade to Team'}
                    </button>
                  ) : (
                    <span className="font-public-sans text-[12px] text-night-fg-3">
                      {releaseGatesLoading
                        ? 'Checking plan-change availability…'
                        : releaseGateError
                          ? 'Plan-change availability could not be verified. Refresh before changing plans.'
                          : 'Self-serve plan changes are not released yet. Billing management remains available.'}
                    </span>
                  )
                ) : authoritativePlan === 'team' ? (
                  releaseGates?.plan_changes ? (
                    <button
                      type="button"
                      onClick={() => void preview('solo')}
                      disabled={busy !== ''}
                      className="ps-btn-ghost"
                    >
                      {busy === 'preview-solo' ? 'Quoting…' : 'Review change to Solo'}
                    </button>
                  ) : (
                    <span className="font-public-sans text-[12px] text-night-fg-3">
                      {releaseGatesLoading
                        ? 'Checking plan-change availability…'
                        : releaseGateError
                          ? 'Plan-change availability could not be verified. Refresh before changing plans.'
                          : 'Self-serve plan changes are not released yet. Billing management remains available.'}
                    </span>
                  )
                ) : (
                  <span className="font-public-sans text-[12px] text-night-fg-3">
                    Enterprise billing changes follow your signed agreement.
                  </span>
                )}
              </div>
            ) : null}

            {quote ? (
              <div
                className="rounded-md border border-signal/50 bg-night-2 p-4"
                aria-labelledby="plan-change-quote-title"
              >
                <h3
                  id="plan-change-quote-title"
                  ref={(node) => {
                    if (node && focusedQuote.current !== quote.request.id) {
                      focusedQuote.current = quote.request.id;
                      node.focus();
                    }
                  }}
                  tabIndex={-1}
                  className="m-0 font-public-sans text-[15px] font-medium text-night-fg"
                >
                  Confirm {quote.request.to_plan === 'team' ? 'Team' : 'Solo'}
                </h3>
                <p className="m-0 mt-2 font-public-sans text-[13px] leading-[1.55] text-night-fg-2">
                  {quote.quote.amount_due_minor > 0
                    ? `${formatMoney(quote.quote.amount_due_minor, quote.quote.currency)} is due now, including the current tax and proration quote.`
                    : `No payment is due now. This change takes effect ${formatDate(quote.quote.effective_at)}.`}
                </p>
                <p className="m-0 mt-1 font-public-sans text-[12px] text-night-fg-3">
                  The quote is bound to this request. If price or tax changes, you will review a new
                  quote before anything changes.
                </p>
                {!quote.request.plan_changes_enabled ? (
                  <p className="m-0 mt-2 font-public-sans text-[12px] text-warn" role="status">
                    Plan changes are paused. Cancel this quote or return after the release gate
                    opens.
                  </p>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void confirmQuote()}
                    disabled={busy !== '' || !quote.request.plan_changes_enabled}
                    className="ps-btn-primary"
                  >
                    {busy === 'confirm-change' ? 'Submitting…' : 'Accept exact quote'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void dismissQuote()}
                    disabled={busy !== ''}
                    className="ps-btn-ghost"
                  >
                    {busy === 'cancel-quote' ? 'Canceling…' : 'Keep current plan'}
                  </button>
                </div>
              </div>
            ) : null}

            {activeChange && !quote ? (
              <div className="rounded-md border border-night-4 bg-night-2 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div role="status" aria-live="polite">
                    <p className="m-0 font-public-sans text-[14px] font-medium text-night-fg">
                      {activeChange.from_plan} → {activeChange.to_plan} ·{' '}
                      {activeChange.status.replaceAll('_', ' ')}
                    </p>
                    <p className="m-0 mt-1 max-w-[62ch] font-public-sans text-[12px] leading-[1.5] text-night-fg-2">
                      {planChangeMessage(activeChange)}
                    </p>
                  </div>
                  <span className="font-public-mono text-[10px] uppercase tracking-[0.1em] text-night-fg-3">
                    updated {formatDate(activeChange.updated_at, true)}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {paymentAction ? (
                    <button
                      type="button"
                      onClick={() => void confirmPayment()}
                      disabled={busy !== ''}
                      className="ps-btn-primary"
                    >
                      {busy === 'confirm-payment' ? 'Confirming…' : 'Continue secure payment'}
                    </button>
                  ) : null}
                  {activeChange.status === 'payment_method_required' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void portal()}
                        disabled={busy !== ''}
                        className="ps-btn-primary"
                      >
                        Update payment method
                      </button>
                      <button
                        type="button"
                        onClick={() => void retryPayment()}
                        disabled={busy !== ''}
                        className="ps-btn-ghost"
                      >
                        {busy === 'retry-payment' ? 'Retrying…' : 'Retry payment'}
                      </button>
                    </>
                  ) : null}
                  {canCancelChange ? (
                    <button
                      type="button"
                      onClick={() => void cancelChange()}
                      disabled={busy !== ''}
                      className="ps-btn-ghost"
                    >
                      {busy === 'cancel-change' ? 'Canceling…' : 'Cancel plan change'}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="border-t border-night-4 pt-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="m-0 font-public-sans text-[14px] font-medium text-night-fg">
                  Invoice history
                </h3>
                <span className="font-public-mono text-[10px] uppercase tracking-[0.1em] text-night-fg-3">
                  {snapshot.billing.standing_observed_at
                    ? `provider evidence ${formatDate(snapshot.billing.standing_observed_at, true)}`
                    : 'no provider observation recorded'}
                </span>
              </div>
              <InvoiceHistory invoices={snapshot.invoices} />
            </div>
          </>
        ) : null}

        {error ? <ErrorRow message={error} /> : null}
        {activity ? (
          <p
            className="m-0 font-public-sans text-[12px] text-signal"
            role="status"
            aria-live="polite"
          >
            {activity}
          </p>
        ) : null}
      </div>
    </Section>
  );
}
