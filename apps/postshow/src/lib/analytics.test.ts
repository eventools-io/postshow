import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  optIn: vi.fn(),
  optOut: vi.fn(),
  reset: vi.fn(),
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

  it('loads only after acceptance with every automatic collection surface disabled', async () => {
    const { setAnalyticsConsent } = await analytics();

    setAnalyticsConsent('accepted');

    await vi.waitFor(() => expect(mocks.init).toHaveBeenCalledTimes(1));
    expect(mocks.moduleLoads).toHaveBeenCalledTimes(1);
    expect(mocks.init).toHaveBeenCalledWith(
      'phc_test',
      expect.objectContaining({
        autocapture: false,
        rageclick: false,
        capture_pageview: false,
        capture_pageleave: false,
        capture_dead_clicks: false,
        capture_exceptions: false,
        capture_heatmaps: false,
        capture_performance: false,
        disable_session_recording: true,
        advanced_disable_flags: true,
        opt_out_capturing_by_default: true,
        opt_out_persistence_by_default: true,
      })
    );
    expect(mocks.optIn).toHaveBeenCalledWith({ captureEventName: false });
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
  });
});
