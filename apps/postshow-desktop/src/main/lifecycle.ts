export interface SingleInstancePort {
  requestLock(): boolean;
  quit(): void;
  isReady(): boolean;
  whenReady(): Promise<unknown>;
  onSecondInstance(listener: () => void): void;
  offSecondInstance(listener: () => void): void;
}

export interface SingleInstanceGuard {
  acquired: boolean;
  dispose(): void;
}

/**
 * Acquire the process-wide lock before any persistent or UI resources exist.
 * Secondary launches only signal the owner and wait for its safe-ready boundary.
 */
export function acquireSingleInstance(
  app: SingleInstancePort,
  showExisting: () => void
): SingleInstanceGuard {
  if (!app.requestLock()) {
    app.quit();
    return { acquired: false, dispose: () => {} };
  }

  let disposed = false;
  let waitingForReady = false;
  const handleSecondInstance = () => {
    if (disposed) return;
    if (app.isReady()) {
      showExisting();
      return;
    }
    if (waitingForReady) return;

    waitingForReady = true;
    void app.whenReady().then(
      () => {
        waitingForReady = false;
        if (!disposed) showExisting();
      },
      () => {
        waitingForReady = false;
      }
    );
  };

  app.onSecondInstance(handleSecondInstance);
  return {
    acquired: true,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      app.offSecondInstance(handleSecondInstance);
    },
  };
}

/** Runs every registered cleanup exactly once, even if another cleanup fails. */
export class LifecycleDisposer {
  private actions: Array<() => void> = [];
  private disposed = false;

  constructor(private readonly onError: (error: unknown) => void = () => {}) {}

  get isDisposed(): boolean {
    return this.disposed;
  }

  add(action: () => void): void {
    if (this.disposed) {
      this.run(action);
      return;
    }
    this.actions.push(action);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const action of this.actions.reverse()) this.run(action);
    this.actions = [];
  }

  private run(action: () => void): void {
    try {
      action();
    } catch (error) {
      this.onError(error);
    }
  }
}
