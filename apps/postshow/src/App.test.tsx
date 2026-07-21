import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LandingPage } from './pages/marketing/LandingPage';

function renderLanding() {
  return render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>
  );
}

describe('LandingPage', () => {
  it('renders the hero headline', () => {
    renderLanding();
    expect(
      screen.getByRole('heading', { level: 1, name: /what happened last night/i })
    ).toBeInTheDocument();
  });

  it('renders the waitlist form', () => {
    renderLanding();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /join the waitlist/i })).toBeInTheDocument();
  });

  it('links sign in to the in-app route', () => {
    renderLanding();
    const signInLinks = screen.getAllByRole('link', { name: /sign in/i });
    for (const link of signInLinks) {
      expect(link).toHaveAttribute('href', '/signin');
    }
  });

  it('carries the eventools brand line', () => {
    renderLanding();
    expect(screen.getAllByText('an eventools product').length).toBeGreaterThan(0);
  });

  it('exposes authoritative legal, support, and status links in the footer', () => {
    renderLanding();
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: 'Cookies' })).toHaveAttribute('href', '/cookies');
    expect(screen.getByRole('link', { name: 'support@eventools.io' })).toHaveAttribute(
      'href',
      'mailto:support@eventools.io'
    );
    expect(screen.getByRole('link', { name: 'Status' })).toHaveAttribute(
      'href',
      'https://status.eventools.io'
    );
  });
});
