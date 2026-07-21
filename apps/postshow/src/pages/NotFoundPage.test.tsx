import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NotFoundPage } from './NotFoundPage';

describe('NotFoundPage', () => {
  it('provides useful home and sign-in exits', () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>
    );
    expect(screen.getByRole('heading', { name: /page is not here/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /homepage/i })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/signin');
  });
});
