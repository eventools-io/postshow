export type AnalyticsConsent = 'accepted' | 'declined';

export const ANALYTICS_CONSENT_STORAGE_KEY = 'postshow.analytics-consent.v1';
export const OPEN_ANALYTICS_PREFERENCES_EVENT = 'postshow:open-analytics-preferences';

type PostHogClient = (typeof import('posthog-js'))['default'];
type CaptureResult = import('posthog-js').CaptureResult;

let client: PostHogClient | null = null;
let clientPromise: Promise<PostHogClient | null> | null = null;
let initialized = false;
let knownUserId: string | null = null;

function analyticsKey(): string {
  return import.meta.env.VITE_POSTHOG_KEY?.trim() ?? '';
}

function readStoredConsent(): AnalyticsConsent | null {
  try {
    const value = window.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY);
    return value === 'accepted' || value === 'declined' ? value : null;
  } catch {
    return null;
  }
}

function storeConsent(value: AnalyticsConsent): void {
  try {
    window.localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, value);
  } catch {
    // The in-page choice still applies even when browser storage is unavailable.
  }
}

function loadClient(): Promise<PostHogClient | null> {
  if (client) return Promise.resolve(client);
  if (clientPromise) return clientPromise;
  clientPromise = import('posthog-js')
    .then((module) => {
      client = module.default;
      return client;
    })
    .catch(() => {
      clientPromise = null;
      return null;
    });
  return clientPromise;
}

function stripUrlDetails(value: unknown): unknown {
  if (typeof value !== 'string' || !value) return value;
  try {
    const url = new URL(value, window.location.origin);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.split(/[?#]/, 1)[0];
  }
}

/** supabase-js runs a background timer (`autoRefreshToken: true`) that tries to
 * rotate the session token. When the stored refresh token is stale (signed out
 * in another tab, cleared storage, or an already-expired session) that timer
 * throws an uncaught `AuthApiError`, which exception autocapture would file as
 * an error. It is an expected auth condition, not a bug — our own `getSession`
 * path already handles it — so drop it before it becomes error-tracking noise. */
function isBenignAuthRefreshException(result: CaptureResult): boolean {
  if (result.event !== '$exception') return false;
  const properties = result.properties;
  const list = properties?.$exception_list;
  const exceptions = Array.isArray(list) ? list : [];
  return exceptions.some((exception) => {
    const type = typeof exception?.type === 'string' ? exception.type : '';
    const value = typeof exception?.value === 'string' ? exception.value : '';
    return type === 'AuthApiError' && /invalid refresh token/i.test(value);
  });
}

function sanitizeCapture(result: CaptureResult | null): CaptureResult | null {
  if (!result) return null;
  if (isBenignAuthRefreshException(result)) return null;
  const properties = result.properties;
  for (const key of ['$current_url', '$referrer', '$referring_url']) {
    if (key in properties) properties[key] = stripUrlDetails(properties[key]);
  }
  return result;
}

function initializeClient(posthog: PostHogClient): void {
  if (initialized) return;
  const key = analyticsKey();
  if (!key) return;
  posthog.init(key, {
    api_host: import.meta.env.VITE_POSTHOG_HOST?.trim() || 'https://us.i.posthog.com',
    defaults: '2026-06-25',
    autocapture: true,
    rageclick: true,
    capture_pageview: 'history_change',
    capture_pageleave: true,
    capture_dead_clicks: true,
    capture_exceptions: true,
    capture_heatmaps: true,
    capture_performance: { network_timing: true, web_vitals: true },
    disable_session_recording: false,
    session_recording: {
      maskAllInputs: true,
      recordCrossOriginIframes: false,
      recordHeaders: false,
      recordBody: false,
      captureCanvas: { recordCanvas: false },
    },
    enable_recording_console_log: false,
    advanced_disable_flags: false,
    opt_out_capturing_by_default: true,
    opt_out_persistence_by_default: true,
    persistence: 'localStorage',
    save_campaign_params: true,
    save_referrer: true,
    mask_all_text: true,
    mask_personal_data_properties: true,
    custom_personal_data_properties: [
      'email',
      'password',
      'token',
      'access_token',
      'refresh_token',
      'authorization',
      'api_key',
      'secret',
      'code',
      'invite',
    ],
    person_profiles: 'identified_only',
    before_send: sanitizeCapture,
  });
  initialized = true;
}

async function activateAcceptedAnalytics(): Promise<void> {
  if (readStoredConsent() !== 'accepted' || !analyticsKey()) return;
  const posthog = await loadClient();
  if (!posthog || readStoredConsent() !== 'accepted') return;
  initializeClient(posthog);
  if (!initialized || readStoredConsent() !== 'accepted') return;
  posthog.opt_in_capturing({ captureEventName: false });
  posthog.startSessionRecording();
  if (knownUserId) posthog.identify(knownUserId);
}

function disableLoadedAnalytics(): void {
  if (!client || !initialized) return;
  client.stopSessionRecording();
  client.reset(true);
  client.opt_out_capturing();
}

/** Does not load the analytics SDK unless a prior explicit acceptance exists. */
export function initAnalytics(): void {
  if (readStoredConsent() === 'accepted') void activateAcceptedAnalytics();
}

export function getAnalyticsConsent(): AnalyticsConsent | null {
  return readStoredConsent();
}

export function setAnalyticsConsent(value: AnalyticsConsent): void {
  storeConsent(value);
  if (value === 'accepted') void activateAcceptedAnalytics();
  else disableLoadedAnalytics();
  window.dispatchEvent(
    new window.CustomEvent('postshow:analytics-consent-changed', { detail: value })
  );
}

export function syncAnalyticsConsent(): AnalyticsConsent | null {
  const value = readStoredConsent();
  if (value === 'accepted') void activateAcceptedAnalytics();
  else disableLoadedAnalytics();
  return value;
}

export function openAnalyticsPreferences(): void {
  window.dispatchEvent(new Event(OPEN_ANALYTICS_PREFERENCES_EVENT));
}

/** Events that occur while the accepted SDK chunk is still loading are
 * intentionally dropped; product behavior never waits on analytics. */
export function track(event: string, properties?: Record<string, unknown>): void {
  if (readStoredConsent() !== 'accepted') return;
  if (client && initialized) client.capture(event, properties);
  else void activateAcceptedAnalytics();
}

/** Only the opaque auth user id is accepted here. Deliberately do not add a
 * properties argument: names and email addresses never enter PostHog. */
export function identify(userId: string): void {
  knownUserId = userId;
  if (readStoredConsent() !== 'accepted') return;
  if (client && initialized) client.identify(userId);
  else void activateAcceptedAnalytics();
}

/** A logout severs both person and device identity. PostHog reset clears its
 * consent marker, so re-apply the independently stored choice when loaded. */
export function resetAnalyticsOnSignOut(): void {
  knownUserId = null;
  if (!client || !initialized) return;
  const consent = readStoredConsent();
  client.stopSessionRecording();
  client.reset(true);
  if (consent === 'accepted') {
    client.opt_in_capturing({ captureEventName: false });
    client.startSessionRecording();
  } else client.opt_out_capturing();
}
