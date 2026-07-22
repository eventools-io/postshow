import { afterEach, describe, expect, it, vi } from 'vitest';
import { callModel, MODEL_MAX_ATTEMPTS, ModelRequestError, MODEL_TIMEOUT_MS } from './engine';

const engine = {
  taskClass: 'narration' as const,
  mode: 'byok' as const,
  provider: 'anthropic' as const,
  model: 'claude-haiku-4-5',
  effort: 'low' as const,
  baseUrl: '',
};

function success(): Response {
  return new Response(
    JSON.stringify({
      content: [{ type: 'text', text: '{"summary":"ok"}' }],
      usage: { input_tokens: 10, output_tokens: 2 },
      stop_reason: 'end_turn',
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('model retry policy', () => {
  it.each([429, 500, 503])(
    'retries status %s and preserves the successful usage',
    async (status) => {
      const request = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response('', { status, headers: { 'retry-after': '0' } }))
        .mockResolvedValueOnce(success());

      await expect(
        callModel(engine, 'sk-test', {
          system: 'return JSON',
          prompt: 'summarize',
          retryTransientErrors: true,
        })
      ).resolves.toMatchObject({
        inputTokens: 10,
        outputTokens: 2,
        billingAmbiguous: status >= 500,
      });
      expect(request).toHaveBeenCalledTimes(2);
    }
  );

  it('stops at the bounded retry budget', async () => {
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 503, headers: { 'retry-after': '0' } }));

    const error = await callModel(engine, 'sk-test', {
      system: 'return JSON',
      prompt: 'summarize',
      retryTransientErrors: true,
    }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ModelRequestError);
    expect(error).toMatchObject({ message: 'model call failed (503)', status: 503, attempts: 3 });
    expect(request).toHaveBeenCalledTimes(MODEL_MAX_ATTEMPTS);
  });

  it('carries ambiguity from an earlier 5xx into a terminal client error', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 500, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(new Response('', { status: 400 }));

    const error = await callModel(engine, 'sk-test', {
      system: 'return JSON',
      prompt: 'summarize',
      retryTransientErrors: true,
    }).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ status: 400, attempts: 2, billingAmbiguous: true });
  });

  it('does not retry non-transient client errors', async () => {
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 400 }));

    const error = await callModel(engine, 'sk-test', {
      system: 'return JSON',
      prompt: 'summarize',
      retryTransientErrors: true,
    }).catch((failure: unknown) => failure);
    expect(error).toMatchObject({
      message: 'model call failed (400)',
      billingAmbiguous: false,
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('defers a long provider retry window to job backoff', async () => {
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 429, headers: { 'retry-after': '31' } }));

    await expect(
      callModel(engine, 'sk-test', {
        system: 'return JSON',
        prompt: 'summarize',
        retryTransientErrors: true,
      })
    ).rejects.toThrow('model call failed (429)');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('bounds retries by one end-to-end model deadline', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockImplementationOnce(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            const signal = init?.signal;
            signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError'))
            );
          })
      );

    const pending = callModel(engine, 'sk-test', {
      system: 'return JSON',
      prompt: 'summarize',
      retryTransientErrors: true,
    });
    const assertion = expect(pending).rejects.toThrow('model call timed out');
    await vi.advanceTimersByTimeAsync(MODEL_TIMEOUT_MS + 1);
    await assertion;
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('marks malformed provider usage invalid instead of propagating nonfinite costs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [{ type: 'text', text: '{"summary":"ok"}' }],
          usage: { input_tokens: 'unknown', output_tokens: -4 },
          stop_reason: 'end_turn',
        }),
        { status: 200 }
      )
    );

    await expect(
      callModel(engine, 'sk-test', { system: 'return JSON', prompt: 'summarize' })
    ).resolves.toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      usageValid: false,
      attempts: 1,
    });
  });

  it('zeros both token counts when either provider usage field is invalid', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [{ type: 'text', text: '{"summary":"ok"}' }],
          usage: { input_tokens: 1_000, output_tokens: 'unknown' },
          stop_reason: 'end_turn',
        }),
        { status: 200 }
      )
    );

    await expect(
      callModel(engine, 'sk-test', { system: 'return JSON', prompt: 'summarize' })
    ).resolves.toMatchObject({ inputTokens: 0, outputTokens: 0, usageValid: false });
  });

  it('returns exact usage without marking a single accepted response ambiguous', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [{ type: 'text', text: '{}' }],
          usage: { input_tokens: 10, output_tokens: 200 },
          stop_reason: 'max_tokens',
        }),
        { status: 200 }
      )
    );

    const error = await callModel(engine, 'sk-test', {
      system: 'return JSON',
      prompt: 'summarize',
    }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ModelRequestError);
    expect(error).toMatchObject({
      status: 200,
      attempts: 1,
      billingAmbiguous: false,
      inputTokens: 10,
      outputTokens: 200,
      usageValid: true,
    });
  });

  it('returns typed attempt metadata for ambiguous network failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));

    const error = await callModel(engine, 'sk-test', {
      system: 'return JSON',
      prompt: 'summarize',
    }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ModelRequestError);
    expect(error).toMatchObject({ attempts: 1, billingAmbiguous: true });
  });
});
