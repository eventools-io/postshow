import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmPlanChangePayment } from './stripeBrowser';

describe('Stripe browser confirmation', () => {
  afterEach(() => {
    delete window.Stripe;
  });

  it('confirms the exact PaymentIntent without forcing a redirect', async () => {
    const confirmPayment = vi.fn().mockResolvedValue({});
    const factory = vi.fn().mockReturnValue({ confirmPayment });
    window.Stripe = factory;

    await confirmPlanChangePayment(
      {
        publishable_key: 'pk_test_example',
        client_secret: 'pi_example_secret_example',
      },
      '11111111-1111-4111-8111-111111111111'
    );

    expect(factory).toHaveBeenCalledWith('pk_test_example');
    expect(confirmPayment).toHaveBeenCalledWith({
      clientSecret: 'pi_example_secret_example',
      confirmParams: {
        return_url: `${window.location.origin}/settings?billing=payment-return&workspace=11111111-1111-4111-8111-111111111111`,
      },
      redirect: 'if_required',
    });
  });

  it('rejects malformed provider credentials before loading Stripe', async () => {
    window.Stripe = vi.fn();

    await expect(
      confirmPlanChangePayment(
        {
          publishable_key: 'secret-key',
          client_secret: 'not-a-client-secret',
        },
        '11111111-1111-4111-8111-111111111111'
      )
    ).rejects.toThrow(/invalid payment key/i);
    expect(window.Stripe).not.toHaveBeenCalled();
  });

  it('does not begin confirmation when its workspace operation is canceled while Stripe loads', async () => {
    const confirmPayment = vi.fn().mockResolvedValue({});
    const factory = vi.fn().mockReturnValue({ confirmPayment });
    window.Stripe = factory;
    const controller = new AbortController();

    const confirmation = confirmPlanChangePayment(
      {
        publishable_key: 'pk_test_example',
        client_secret: 'pi_example_secret_example',
      },
      '11111111-1111-4111-8111-111111111111',
      controller.signal
    );
    controller.abort();
    await confirmation;

    expect(factory).not.toHaveBeenCalled();
    expect(confirmPayment).not.toHaveBeenCalled();
  });
});
