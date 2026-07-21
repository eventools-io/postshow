import { describe, expect, it, vi } from 'vitest';
import { LifecycleDisposer, acquireSingleInstance, type SingleInstancePort } from './lifecycle';

function singleInstancePort(
  lockAcquired: boolean,
  ready = true
): {
  port: SingleInstancePort;
  emitSecondInstance: () => void;
  resolveReady: () => void;
  quit: ReturnType<typeof vi.fn>;
  offSecondInstance: ReturnType<typeof vi.fn>;
} {
  let listener: (() => void) | undefined;
  let resolveReady: (() => void) | undefined;
  const readyPromise = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const quit = vi.fn();
  const offSecondInstance = vi.fn((candidate: () => void) => {
    if (listener === candidate) listener = undefined;
  });
  return {
    port: {
      requestLock: () => lockAcquired,
      quit,
      isReady: () => ready,
      whenReady: () => readyPromise,
      onSecondInstance: (candidate) => {
        listener = candidate;
      },
      offSecondInstance,
    },
    emitSecondInstance: () => listener?.(),
    resolveReady: () => resolveReady?.(),
    quit,
    offSecondInstance,
  };
}

describe('acquireSingleInstance', () => {
  it('quits a secondary process without registering lifecycle work', () => {
    const harness = singleInstancePort(false);
    const showExisting = vi.fn();

    const guard = acquireSingleInstance(harness.port, showExisting);
    harness.emitSecondInstance();
    guard.dispose();

    expect(guard.acquired).toBe(false);
    expect(harness.quit).toHaveBeenCalledOnce();
    expect(showExisting).not.toHaveBeenCalled();
    expect(harness.offSecondInstance).not.toHaveBeenCalled();
  });

  it('focuses the existing window for a second launch and removes its listener once', () => {
    const harness = singleInstancePort(true);
    const showExisting = vi.fn();
    const guard = acquireSingleInstance(harness.port, showExisting);

    harness.emitSecondInstance();
    guard.dispose();
    guard.dispose();
    harness.emitSecondInstance();

    expect(showExisting).toHaveBeenCalledOnce();
    expect(harness.offSecondInstance).toHaveBeenCalledOnce();
  });

  it('coalesces launches until Electron is ready and does not focus after disposal', async () => {
    const harness = singleInstancePort(true, false);
    const showExisting = vi.fn();
    const guard = acquireSingleInstance(harness.port, showExisting);

    harness.emitSecondInstance();
    harness.emitSecondInstance();
    harness.resolveReady();
    await Promise.resolve();
    expect(showExisting).toHaveBeenCalledOnce();

    harness.emitSecondInstance();
    guard.dispose();
    harness.resolveReady();
    await Promise.resolve();
    expect(showExisting).toHaveBeenCalledOnce();
  });
});

describe('LifecycleDisposer', () => {
  it('runs every cleanup in reverse order exactly once and isolates failures', () => {
    const calls: string[] = [];
    const errors: unknown[] = [];
    const disposer = new LifecycleDisposer((error) => errors.push(error));
    disposer.add(() => calls.push('first'));
    disposer.add(() => {
      calls.push('second');
      throw new Error('cleanup failed');
    });
    disposer.add(() => calls.push('third'));

    disposer.dispose();
    disposer.dispose();

    expect(calls).toEqual(['third', 'second', 'first']);
    expect(errors).toHaveLength(1);
  });

  it('runs late cleanups immediately after disposal', () => {
    const cleanup = vi.fn();
    const disposer = new LifecycleDisposer();
    disposer.dispose();

    disposer.add(cleanup);

    expect(cleanup).toHaveBeenCalledOnce();
  });
});
