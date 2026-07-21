import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AnalyticsConsent } from './AnalyticsConsent';
import { setAnalyticsConsent } from '@/lib/analytics';

vi.mock('@/lib/analytics', () => ({
  ANALYTICS_CONSENT_STORAGE_KEY: 'postshow.analytics-consent.v1',
  OPEN_ANALYTICS_PREFERENCES_EVENT: 'postshow:open-analytics-preferences',
  getAnalyticsConsent: vi.fn(() => null),
  setAnalyticsConsent: vi.fn(),
  syncAnalyticsConsent: vi.fn(() => null),
  openAnalyticsPreferences: vi.fn(),
}));

describe('AnalyticsConsent', () => {
  beforeEach(() => vi.mocked(setAnalyticsConsent).mockReset());

  it('offers an accessible accept/decline choice and can be reopened later', () => {
    render(<AnalyticsConsent />);

    expect(screen.getByRole('region', { name: /optional product analytics/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /cookies notice/i })).toHaveAttribute(
      'href',
      '/cookies'
    );

    fireEvent.click(screen.getByRole('button', { name: /accept analytics/i }));
    expect(setAnalyticsConsent).toHaveBeenCalledWith('accepted');
    expect(screen.queryByRole('region', { name: /optional product analytics/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /privacy choices/i }));
    expect(screen.getByText(/current choice: analytics on/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^decline$/i }));
    expect(setAnalyticsConsent).toHaveBeenLastCalledWith('declined');
  });
});
