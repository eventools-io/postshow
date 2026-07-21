import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

vi.mock('./state/WorkspaceContext', () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useWorkspace: vi.fn(() => ({})),
}));
vi.mock('./components/AnalyticsConsent', () => ({ AnalyticsConsent: () => null }));
vi.mock('./components/settings/WorkspaceLifecycleSection', () => ({
  DeletionReceiptRecovery: () => <aside>Deletion receipt recovery</aside>,
}));

describe('public legal routes', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'scrollTo', {
      configurable: true,
      value: vi.fn(),
    });
  });

  it.each([
    ['/terms', 'Postshow Terms of Service'],
    ['/privacy', 'Postshow Privacy Policy'],
    ['/cookies', 'Cookies and Local Storage Notice'],
  ])('renders %s without authentication', async (path, heading) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
    expect(screen.queryByText('Deletion receipt recovery')).not.toBeInTheDocument();
  });

  it('keeps deletion recovery off marketing pages and available on account access', async () => {
    const marketing = render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByText('Deletion receipt recovery')).not.toBeInTheDocument();
    marketing.unmount();

    render(
      <MemoryRouter initialEntries={['/signin']}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByText('Deletion receipt recovery')).toBeInTheDocument();
  });
});
