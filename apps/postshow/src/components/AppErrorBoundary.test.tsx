import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppErrorBoundary, chunkReloadMarker } from './AppErrorBoundary';

function Broken(): never {
  throw new Error('render exploded');
}

describe('AppErrorBoundary', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('contains a render failure and offers recovery without exposing internals', () => {
    render(
      <MemoryRouter>
        <AppErrorBoundary>
          <Broken />
        </AppErrorBoundary>
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: /needs a fresh start/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload postshow/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /contact support/i })).toHaveAttribute(
      'href',
      'mailto:support@eventools.io'
    );
    expect(screen.queryByText(/render exploded/i)).not.toBeInTheDocument();
  });

  it('never persists invitation bearers in the chunk-reload marker', () => {
    const token = `psi_${'d'.repeat(64)}`;
    const marker = chunkReloadMarker(
      `https://postshow.io/invite?invite=${token}&source=email#token=${token}`
    );
    expect(marker).toBe('https://postshow.io/invite?source=email');
    expect(marker).not.toContain(token);
  });
});
