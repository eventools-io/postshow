import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LandingPage } from './LandingPage';
import { OpenSourcePage } from './OpenSourcePage';
import { SecurityPage } from './SecurityPage';

function renderPage(page: React.ReactNode) {
  return render(<MemoryRouter>{page}</MemoryRouter>);
}

describe('public product claims', () => {
  it('leads with a supported evidence stack and labels the recovery loop as the target', () => {
    renderPage(<LandingPage />);

    for (const source of ['PostHog', 'Stripe', 'GitHub', 'Sentry']) {
      expect(screen.getAllByText(source).length).toBeGreaterThan(0);
    }
    expect(document.body).toHaveTextContent(/affected accounts and revenue/i);
    expect(document.body).toHaveTextContent(/checks? whether the intervention worked/i);
    expect(document.body).toHaveTextContent(/the loop we.re building/i);
    expect(document.body).toHaveTextContent(/target incident contract/i);
    expect(
      screen
        .getAllByRole('link', { name: /github/i })
        .some((link) => link.getAttribute('href')?.includes('github.com/eventools-io/postshow'))
    ).toBe(true);
    expect(document.body).not.toHaveTextContent(/free forever|every session|\bSSO\b/i);
  });

  it('makes the repository useful without claiming a turnkey hosted control plane', () => {
    renderPage(<OpenSourcePage />);

    expect(document.body).toHaveTextContent(/does not promise a one-command clone/i);
    expect(document.body).toHaveTextContent(/propose a contribution/i);
    expect(document.body).toHaveTextContent(/one install, scoped commands/i);
    expect(screen.getAllByRole('link', { name: /github|repository/i }).length).toBeGreaterThan(0);
    expect(document.body).not.toHaveTextContent(/free forever|any Supabase project|\bSSO\b/i);
  });

  it('publishes the exact device, TLS, model, and sync boundaries', () => {
    renderPage(<SecurityPage />);

    expect(document.body).toHaveTextContent(/Postgres: device-only connection string/i);
    expect(document.body).toHaveTextContent(/non-loopback databases must explicitly require TLS/i);
    expect(document.body).toHaveTextContent(/selected local or BYOK model on that device/i);
    expect(document.body).toHaveTextContent(/only sanitized derived findings sync/i);
  });
});
