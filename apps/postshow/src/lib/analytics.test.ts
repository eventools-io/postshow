import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  optIn: vi.fn(),
  optOut: vi.fn(),
  reset: vi.fn(),
  startSessionRecording: vi.fn(),
  stopSessionRecording: vi.fn(),
  moduleLoads: vi.fn(),
}));

vi.mock('posthog-js', () => {
  mocks.moduleLoads();
  return {
    default: {
      init: mocks.init,
      capture: mocks.capture,
      identify: mocks.identify,
      opt_in_capturing: mocks.optIn,
      opt_out_capturing: mocks.optOut,
      reset: mocks.reset,
      startSessionRecording: mocks.startSessionRecording,
      stopSessionRecording: mocks.stopSessionRecording,
    },
  };
});

async function analytics() {
  vi.resetModules();
  return import('./analytics');
}

describe('analytics consent boundary', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    vi.stubEnv('VITE_POSTHOG_HOST', 'https://us.i.posthog.com');
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
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  it('does not import or initialize PostHog before explicit acceptance', async () => {
    const { initAnalytics, setAnalyticsConsent, track } = await analytics();

    initAnalytics();
    track('should_not_capture');

    expect(mocks.moduleLoads).not.toHaveBeenCalled();
    expect(mocks.init).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();

    setAnalyticsConsent('declined');
    await Promise.resolve();
    expect(mocks.moduleLoads).not.toHaveBeenCalled();
    expect(mocks.init).not.toHaveBeenCalled();
  });

  it('does not load the SDK when analytics is accepted but production configuration is absent', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', '');
    const { setAnalyticsConsent } = await analytics();

    setAnalyticsConsent('accepted');
    await Promise.resolve();

    expect(mocks.moduleLoads).not.toHaveBeenCalled();
    expect(mocks.init).not.toHaveBeenCalled();
  });

  it('loads rich product analytics only after acceptance with replay content masked', async () => {
    const { setAnalyticsConsent } = await analytics();

    setAnalyticsConsent('accepted');

    await vi.waitFor(() => expect(mocks.init).toHaveBeenCalledTimes(1));
    expect(mocks.moduleLoads).toHaveBeenCalledTimes(1);
    expect(mocks.init).toHaveBeenCalledWith(
      'phc_test',
      expect.objectContaining({
        autocapture: true,
        rageclick: true,
        capture_pageview: 'history_change',
        capture_pageleave: true,
        capture_dead_clicks: true,
        capture_exceptions: true,
        capture_heatmaps: true,
        capture_performance: { network_timing: true, web_vitals: true },
        disable_session_recording: false,
        session_recording: expect.objectContaining({
          maskAllInputs: true,
          recordHeaders: false,
          recordBody: false,
        }),
        mask_all_text: true,
        advanced_disable_flags: false,
        opt_out_capturing_by_default: true,
        opt_out_persistence_by_default: true,
      })
    );
    expect(mocks.optIn).toHaveBeenCalledWith({ captureEventName: false });
    expect(mocks.startSessionRecording).toHaveBeenCalled();
  });

  it('drops benign supabase stale-refresh-token exceptions before capture', async () => {
    const { setAnalyticsConsent } = await analytics();

    setAnalyticsConsent('accepted');
    await vi.waitFor(() => expect(mocks.init).toHaveBeenCalledTimes(1));
    const config = mocks.init.mock.calls[0]?.[1] as { before_send: (result: unknown) => unknown };
    const beforeSend = config.before_send;

    const authNoise = {
      event: '$exception',
      properties: {
        $exception_list: [
          { type: 'AuthApiError', value: 'Invalid Refresh Token: Refresh Token Not Found' },
        ],
      },
    };
    expect(beforeSend(authNoise)).toBeNull();

    const realError = {
      event: '$exception',
      properties: {
        $exception_list: [{ type: 'TypeError', value: 'x is not a function' }],
      },
    };
    expect(beforeSend(realError)).toBe(realError);
  });

  it('captures and identifies only after explicit consent, without email properties', async () => {
    const { identify, initAnalytics, setAnalyticsConsent, track } = await analytics();
    initAnalytics();
    identify('user-123');
    track('before_consent');
    expect(mocks.identify).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();

    setAnalyticsConsent('accepted');
    await vi.waitFor(() => expect(mocks.identify).toHaveBeenCalledWith('user-123'));
    track('after_consent', { source: 'manual' });

    expect(mocks.optIn).toHaveBeenCalledWith({ captureEventName: false });
    expect(mocks.identify).toHaveBeenCalledWith('user-123');
    expect(mocks.capture).toHaveBeenCalledWith('after_consent', { source: 'manual' });
  });

  it('clears identity and persistence when consent is declined', async () => {
    window.localStorage.setItem('postshow.analytics-consent.v1', 'accepted');
    const { initAnalytics, setAnalyticsConsent } = await analytics();
    initAnalytics();
    await vi.waitFor(() => expect(mocks.init).toHaveBeenCalledTimes(1));

    setAnalyticsConsent('declined');

    expect(window.localStorage.getItem('postshow.analytics-consent.v1')).toBe('declined');
    expect(mocks.reset).toHaveBeenCalledWith(true);
    expect(mocks.stopSessionRecording).toHaveBeenCalled();
    expect(mocks.optOut).toHaveBeenCalled();
  });

  it('rotates identity on sign-out and restores the independent consent choice', async () => {
    window.localStorage.setItem('postshow.analytics-consent.v1', 'accepted');
    const { identify, initAnalytics, resetAnalyticsOnSignOut } = await analytics();
    initAnalytics();
    await vi.waitFor(() => expect(mocks.init).toHaveBeenCalledTimes(1));
    identify('user-123');
    mocks.optIn.mockClear();

    resetAnalyticsOnSignOut();

    expect(mocks.reset).toHaveBeenCalledWith(true);
    expect(mocks.optIn).toHaveBeenCalledWith({ captureEventName: false });
    expect(mocks.stopSessionRecording).toHaveBeenCalled();
    expect(mocks.startSessionRecording).toHaveBeenCalled();
  });
});
