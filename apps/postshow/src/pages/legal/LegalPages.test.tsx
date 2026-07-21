import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CookiesPage } from './CookiesPage';
import { PrivacyPage } from './PrivacyPage';
import { TermsPage } from './TermsPage';

const mocks = vi.hoisted(() => ({
  openAnalyticsPreferences: vi.fn(),
}));

vi.mock('@/lib/analytics', () => ({
  openAnalyticsPreferences: mocks.openAnalyticsPreferences,
}));

function renderPolicy(page: React.ReactNode) {
  return render(<MemoryRouter>{page}</MemoryRouter>);
}

describe('Postshow legal policies', () => {
  beforeEach(() => mocks.openAnalyticsPreferences.mockReset());

  it('states the B2B service, human-review, and model-provider terms', () => {
    renderPolicy(<TermsPage />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Postshow Terms of Service' })
    ).toBeInTheDocument();
    expect(screen.getByText(/binding agreement between Eventools LLC/i)).toBeInTheDocument();
    expect(screen.getByText(/human review is part of the product contract/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Postgres is offered only through the device runtime/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/only sanitized derived findings sync/i)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /published vulnerability disclosure instructions/i })
    ).toHaveAttribute('href', 'https://github.com/eventools-io/postshow/security/policy');
  });

  it('discloses processors, consent, retention, export, and local-only boundaries', () => {
    renderPolicy(<PrivacyPage />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Postshow Privacy Policy' })
    ).toBeInTheDocument();
    for (const provider of [
      'Supabase',
      'Netlify',
      'Stripe',
      'Metronome',
      'Resend',
      'PostHog',
      'Cloudflare Turnstile',
      'Selected model providers',
    ]) {
      expect(screen.getByText(provider, { selector: 'dt' })).toBeInTheDocument();
    }
    expect(
      screen.getByText(/Postgres is available only through the device runtime/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/completion receipt is available to the requester for 30 days/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/retained for seven years/i)).toBeInTheDocument();
    expect(screen.getAllByText(/excludes credential values, bearer tokens/i)).toHaveLength(2);
    expect(
      screen.getByText(/download access to the private artifact expires after 24 hours/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/deletion is retried until storage confirms/i)).toBeInTheDocument();
  });

  it('inventories essential storage and keeps analytics controllable', () => {
    renderPolicy(<CookiesPage />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Cookies and Local Storage Notice' })
    ).toBeInTheDocument();
    expect(screen.getByText(/postshow\.analytics-consent\.v1/i)).toBeInTheDocument();
    expect(screen.getByText(/postshow\.operation\.invitation:<sha256>/i)).toBeInTheDocument();
    expect(screen.getByText(/Postshow analytics are disabled by default/i)).toBeInTheDocument();
    expect(screen.getByText(/session recording.*disabled/i)).toBeInTheDocument();
    expect(screen.getByText(/invitation bearers are not browser storage/i)).toBeInTheDocument();
    expect(screen.getByText(/not copied into a query string/i)).toBeInTheDocument();
    expect(
      screen.getByText(/download access ends 24 hours after an export becomes ready/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/retried until storage verifies that the artifact is absent/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/rediscover the current active workspace export/i)).toBeInTheDocument();
    expect(screen.getByText(/workspace export or workspace deletion/i)).toBeInTheDocument();
    expect(
      screen.getByText(/postshow\.workspace-deletion-recovery\.v1\.<user-id>/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/switching accounts cannot read or clear/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open analytics choices' }));
    expect(mocks.openAnalyticsPreferences).toHaveBeenCalledTimes(1);
  });
});
