import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DesktopAgentSection } from './DesktopAgentSection';

describe('DesktopAgentSection', () => {
  it('links the desktop agent without advertising a download that does not exist', () => {
    render(<DesktopAgentSection />);

    expect(screen.getByRole('heading', { name: /desktop agent/i })).toBeInTheDocument();
    expect(screen.getByText(/no build published yet/i)).toBeInTheDocument();
    expect(document.body).toHaveTextContent(/nothing to download today/i);
    expect(screen.getByRole('link', { name: /watch for the first release/i })).toHaveAttribute(
      'href',
      'https://github.com/eventools-io/postshow/releases'
    );
    expect(screen.getByRole('link', { name: /build it from source/i })).toHaveAttribute(
      'href',
      'https://github.com/eventools-io/postshow/tree/main/apps/postshow-desktop'
    );
  });

  it('says setup still needs a terminal because the agent reads the CLI profile', () => {
    render(<DesktopAgentSection />);

    expect(document.body).toHaveTextContent(/postshow init/);
    expect(document.body).toHaveTextContent(/setup still happens once in a terminal/i);
  });
});
