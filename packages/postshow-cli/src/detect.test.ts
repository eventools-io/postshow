import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectConnectors, detectOllama, OLLAMA_PROBE_TIMEOUT_MS } from './detect';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('detectOllama', () => {
  it('returns only well-formed model names and does not follow redirects', async () => {
    const fetchStub = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.redirect).toBe('manual');
      return new Response(JSON.stringify({ models: [{ name: 'llama3.2' }, {}, 'bad'] }));
    });
    vi.stubGlobal('fetch', fetchStub);

    await expect(detectOllama()).resolves.toEqual(['llama3.2']);
    expect(fetchStub).toHaveBeenCalledOnce();
  });

  it('aborts a stalled probe at the deadline', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_url: string, init?: RequestInit) =>
          await new Promise<Response>((_resolve, reject) => {
            signal = init?.signal ?? null;
            init?.signal?.addEventListener('abort', () => reject(new Error('fetch aborted')));
          })
      )
    );

    const pending = detectOllama();
    await vi.advanceTimersByTimeAsync(OLLAMA_PROBE_TIMEOUT_MS);
    await expect(pending).resolves.toEqual([]);
    expect(signal).not.toBeNull();
    expect((signal as AbortSignal | null)?.aborted).toBe(true);
  });

  it('keeps the probe deadline active while reading model tags', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')));
          },
        });
        return new Response(stream, { status: 200 });
      })
    );

    const pending = detectOllama();
    await vi.advanceTimersByTimeAsync(OLLAMA_PROBE_TIMEOUT_MS);
    await expect(pending).resolves.toEqual([]);
  });

  it('rejects redirects and oversized responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 302 }))
    );
    await expect(detectOllama()).resolves.toEqual([]);

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response('{}', { headers: { 'content-length': String(1024 * 1024 + 1) } })
      )
    );
    await expect(detectOllama()).resolves.toEqual([]);
  });

  it('never probes remote, credential-bearing, or path-prefixed URLs', async () => {
    const fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);

    await expect(detectOllama('https://example.test')).resolves.toEqual([]);
    await expect(detectOllama('http://user:secret@localhost:11434')).resolves.toEqual([]);
    await expect(detectOllama('http://localhost:11434?token=secret')).resolves.toEqual([]);
    await expect(detectOllama('http://localhost:11434/proxy')).resolves.toEqual([]);
    expect(fetchStub).not.toHaveBeenCalled();
  });
});

describe('detectConnectors', () => {
  it('uses DATABASE_URL only as a Postgres setup hint', () => {
    const directory = mkdtempSync(join(tmpdir(), 'postshow-detect-'));
    try {
      writeFileSync(
        join(directory, '.env'),
        'DATABASE_URL=postgresql://private-user:private-password@db.example.test/private\n'
      );

      expect(detectConnectors(directory)).toEqual([{ provider: 'postgres', evidence: '.env' }]);
      expect(JSON.stringify(detectConnectors(directory))).not.toContain('private-password');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
