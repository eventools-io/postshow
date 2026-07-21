import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LegalLinks } from './LegalLinks';
import { openAnalyticsPreferences } from '@/lib/analytics';

vi.mock('@/lib/analytics', () => ({ openAnalyticsPreferences: vi.fn() }));

describe('LegalLinks', () => {
  it('uses Postshow legal routes and Eventools LLC support destinations', () => {
    render(
      <MemoryRouter>
        <LegalLinks />
      </MemoryRouter>
    );

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

    fireEvent.click(screen.getByRole('button', { name: /analytics choices/i }));
    expect(openAnalyticsPreferences).toHaveBeenCalledTimes(1);
  });
});
