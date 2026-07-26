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
  it('leads with verified recovery and distinguishes the current foundation from the target', () => {
    renderPage(<LandingPage />);

    for (const source of ['PostHog', 'Stripe', 'GitHub', 'Sentry']) {
      expect(screen.getAllByText(source).length).toBeGreaterThan(0);
    }
    expect(
      screen.getByRole('heading', { name: /turn customer friction into verified fixes/i })
    ).toBeInTheDocument();
    expect(document.body).toHaveTextContent(/exact evidence and affected accounts/i);
    expect(document.body).toHaveTextContent(/linked sentry issues/i);
    expect(document.body).toHaveTextContent(
      /exact github code references, intervention execution, and measured outcomes are still being built/i
    );
    expect(document.body).toHaveTextContent(/the recovery loop/i);
    expect(document.body).toHaveTextContent(/the incident contract/i);
    expect(document.body).toHaveTextContent(
      /a merged pull request is not a resolved customer problem/i
    );
    expect(document.body).toHaveTextContent(/no action taken. human review remains required/i);
    expect(
      screen
        .getAllByRole('link', { name: /github/i })
        .some((link) => link.getAttribute('href')?.includes('github.com/eventools-io/postshow'))
    ).toBe(true);
    expect(document.body).not.toHaveTextContent(
      /free forever|every session|planned beta pricing|\bSSO\b/i
    );
  });

  it('describes the recovery check Postshow actually saves', () => {
    renderPage(<LandingPage />);

    // Every incident is materialized with the same contract: metric
    // repeat_session_count, a session-count baseline, direction decrease, and a
    // seven-day window. No cohort, threshold, or guardrail is stored anywhere,
    // so the public pages may not promise one.
    expect(document.body).toHaveTextContent(/metric, a baseline, a direction, and a window/i);
    expect(document.body).not.toHaveTextContent(/cohort|threshold|guardrail/i);
  });

  it('presents the outcome vocabulary as a target rather than a reported result', () => {
    renderPage(<LandingPage />);

    // measured_outcome is JSONB defaulted to {"status":"pending"} and nothing
    // in either repository writes it, so naming the five results is a promise
    // about the recovery check, not a description of shipped behavior.
    for (const outcome of ['recovered', 'improving', 'unchanged', 'regressed', 'inconclusive']) {
      expect(screen.getByText(outcome)).toBeInTheDocument();
    }
    expect(document.body).toHaveTextContent(/postshow does not report an outcome yet/i);
  });

  it('makes the public truth contract and contribution path explicit', () => {
    renderPage(<OpenSourcePage />);

    expect(document.body).toHaveTextContent(/canonical home of the incident, evidence, identity/i);
    expect(document.body).toHaveTextContent(/cannot keep a private alternate evidence policy/i);
    expect(document.body).toHaveTextContent(/propose a contribution/i);
    expect(document.body).toHaveTextContent(/one checkout, scoped commands/i);
    expect(screen.getByRole('link', { name: /public roadmap/i })).toHaveAttribute(
      'href',
      expect.stringContaining('/docs/ROADMAP.md')
    );
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
