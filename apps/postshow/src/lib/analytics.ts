export type AnalyticsConsent = 'accepted' | 'declined';

export const ANALYTICS_CONSENT_STORAGE_KEY = 'postshow.analytics-consent.v1';
export const OPEN_ANALYTICS_PREFERENCES_EVENT = 'postshow:open-analytics-preferences';

type PostHogClient = (typeof import('posthog-js'))['default'];

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

function initializeClient(posthog: PostHogClient): void {
  if (initialized) return;
  const key = analyticsKey();
  if (!key) return;
  posthog.init(key, {
    api_host: import.meta.env.VITE_POSTHOG_HOST?.trim() || 'https://us.i.posthog.com',
    autocapture: false,
    rageclick: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_dead_clicks: false,
    capture_exceptions: false,
    capture_heatmaps: false,
    capture_performance: false,
    disable_session_recording: true,
    enable_recording_console_log: false,
    advanced_disable_flags: true,
    opt_out_capturing_by_default: true,
    opt_out_persistence_by_default: true,
    persistence: 'localStorage',
    save_campaign_params: false,
    save_referrer: false,
    mask_personal_data_properties: true,
    custom_personal_data_properties: ['email'],
    person_profiles: 'identified_only',
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
  if (knownUserId) posthog.identify(knownUserId);
}

function disableLoadedAnalytics(): void {
  if (!client || !initialized) return;
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
  client.reset(true);
  if (consent === 'accepted') client.opt_in_capturing({ captureEventName: false });
  else client.opt_out_capturing();
}
