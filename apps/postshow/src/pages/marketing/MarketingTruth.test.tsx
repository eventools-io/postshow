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
  it('describes sampling, current plan terms, and the precise Postgres boundary', () => {
    renderPage(<LandingPage />);

    expect(screen.getAllByText('Postgres').length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/one owner-configured, bounded read-only SELECT/i).length
    ).toBeGreaterThan(0);
    expect(document.body).toHaveTextContent(/bounded sample of useful sessions/i);
    expect(document.body).not.toHaveTextContent(/free forever|every session|\bSSO\b/i);
  });

  it('does not present the open components as a turnkey hosted control plane', () => {
    renderPage(<OpenSourcePage />);

    expect(document.body).toHaveTextContent(/does not ship a supported one-command replacement/i);
    expect(document.body).toHaveTextContent(/Postgres is always device-only/i);
    expect(document.body).toHaveTextContent(/remote BYOK model/i);
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
