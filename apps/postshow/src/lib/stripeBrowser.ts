import type { PaymentAction } from './billing';

interface StripeConfirmationResult {
  error?: { message?: string };
}

interface StripeBrowserClient {
  confirmPayment(options: {
    clientSecret: string;
    confirmParams: { return_url: string };
    redirect: 'if_required';
  }): Promise<StripeConfirmationResult>;
}

type StripeFactory = (publishableKey: string) => StripeBrowserClient;

declare global {
  interface Window {
    Stripe?: StripeFactory;
  }
}

let loading: Promise<StripeFactory> | null = null;
const STRIPE_JS_URL = 'https://js.stripe.com/v3/';
const LOAD_TIMEOUT_MS = 15_000;

function stripeFactory(): Promise<StripeFactory> {
  if (window.Stripe) return Promise.resolve(window.Stripe);
  if (loading) return loading;
  loading = new Promise<StripeFactory>((resolve, reject) => {
    const existing = document.querySelector('script[data-postshow-stripe-js="true"]');
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Secure payment confirmation timed out while loading.'));
    }, LOAD_TIMEOUT_MS);
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      if (window.Stripe) resolve(window.Stripe);
      else reject(new Error('Secure payment confirmation did not load.'));
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      reject(new Error('Secure payment confirmation could not be loaded.'));
    };
    if (existing) {
      if (existing.getAttribute('src') !== STRIPE_JS_URL) {
        fail();
        return;
      }
      existing.addEventListener('load', finish, { once: true });
      existing.addEventListener('error', fail, { once: true });
      window.queueMicrotask(() => {
        if (window.Stripe) finish();
      });
    } else {
      const script = document.createElement('script');
      script.addEventListener('load', finish, { once: true });
      script.addEventListener('error', fail, { once: true });
      script.src = STRIPE_JS_URL;
      script.async = true;
      script.dataset.postshowStripeJs = 'true';
      document.head.append(script);
    }
  }).catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

export async function confirmPlanChangePayment(
  action: PaymentAction,
  workspaceId: string,
  signal?: AbortSignal
): Promise<void> {
  if (!/^pk_(test|live)_[A-Za-z0-9_]+$/.test(action.publishable_key)) {
    throw new Error('Billing returned an invalid payment key.');
  }
  if (!/^pi_[A-Za-z0-9_]+_secret_[A-Za-z0-9_]+$/.test(action.client_secret)) {
    throw new Error('Billing returned an invalid payment confirmation.');
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workspaceId)
  ) {
    throw new Error('Billing returned an invalid workspace binding.');
  }
  if (signal?.aborted) return;
  const factory = await stripeFactory();
  if (signal?.aborted) return;
  const client = factory(action.publishable_key);
  if (!client || typeof client.confirmPayment !== 'function') {
    throw new Error('Secure payment confirmation is unavailable.');
  }
  const result = await client.confirmPayment({
    clientSecret: action.client_secret,
    confirmParams: {
      return_url: `${window.location.origin}/settings?billing=payment-return&workspace=${workspaceId}`,
    },
    redirect: 'if_required',
  });
  if (signal?.aborted) return;
  if (result.error) {
    throw new Error(result.error.message || 'The payment could not be confirmed.');
  }
}
