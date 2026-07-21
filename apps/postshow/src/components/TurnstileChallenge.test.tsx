import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { TurnstileChallenge, type TurnstileChallengeHandle } from './TurnstileChallenge';

const mocks = vi.hoisted(() => ({
  render: vi.fn(),
  reset: vi.fn(),
  remove: vi.fn(),
}));

describe('TurnstileChallenge', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_POSTSHOW_TURNSTILE_SITE_KEY', '1x00000000000000000000AA');
    vi.stubEnv('VITE_POSTSHOW_TURNSTILE_BYPASS', 'false');
    mocks.render.mockReset().mockReturnValue('widget-id');
    mocks.reset.mockReset();
    mocks.remove.mockReset();
    Object.defineProperty(window, 'turnstile', {
      configurable: true,
      value: { render: mocks.render, reset: mocks.reset, remove: mocks.remove },
    });
  });

  it('renders the official widget, reports a token, and resets it on demand', async () => {
    const onChange = vi.fn();
    const ref = createRef<TurnstileChallengeHandle>();
    render(<TurnstileChallenge ref={ref} action="sign_in" onChange={onChange} />);

    await waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(1));
    const options = mocks.render.mock.calls[0]?.[1] as {
      sitekey: string;
      action: string;
      callback: (token: string) => void;
    };
    expect(options.sitekey).toBe('1x00000000000000000000AA');
    expect(options.action).toBe('sign_in');

    act(() => options.callback('verified-token'));
    expect(onChange).toHaveBeenLastCalledWith('verified-token', false);
    expect(screen.getByText(/security verification complete/i)).toBeInTheDocument();

    act(() => ref.current?.reset());
    expect(mocks.reset).toHaveBeenCalledWith('widget-id');
    expect(onChange).toHaveBeenLastCalledWith(null, false);
  });
});
