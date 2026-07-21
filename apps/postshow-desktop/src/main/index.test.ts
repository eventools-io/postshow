import { describe, expect, it, vi } from 'vitest';

type Handler = (...args: any[]) => any;

const state = vi.hoisted(() => ({
  order: [] as string[],
  appListeners: new Map<string, Handler>(),
  webContentsListeners: new Map<string, Handler>(),
  ipcHandlers: new Map<string, Handler>(),
  windowOpenHandler: null as Handler | null,
  browserWindow: null as any,
  scheduler: null as any,
  resolveSchedulerDispose: null as (() => void) | null,
  resolveSchedulerDrain: null as (() => void) | null,
  updater: null as any,
  tray: null as any,
  permissionHandlers: {
    check: null as Handler | null,
    request: null as Handler | null,
    device: null as Handler | null,
    display: null as Handler | null,
  },
  openExternal: vi.fn(async () => {}),
  exit: vi.fn(),
  showSaveDialog: vi.fn(async () => ({ canceled: true })),
}));

vi.mock('electron-updater', () => ({ default: { autoUpdater: {} } }));

vi.mock('./updater', () => {
  class FakeDesktopUpdater {
    readonly installDownloadedUpdate = vi.fn(() => {
      state.order.push('install-update');
      return true;
    });
    readonly checkForUpdates = vi.fn(async () => this.getStatus());
    readonly start = vi.fn(async () => this.getStatus());
    readonly dispose = vi.fn();

    constructor() {
      state.updater = this;
    }

    getStatus() {
      return {
        state: 'downloaded',
        currentVersion: '0.1.0',
        availableVersion: '0.2.0',
        message: 'update ready to install',
        canCheck: false,
        canRetry: false,
        canInstall: true,
      };
    }
  }

  return { DesktopUpdater: FakeDesktopUpdater };
});

vi.mock('./release-signature', () => ({
  isTrustedReleaseBuild: vi.fn(async () => false),
}));

vi.mock('postshow/lib', () => ({
  configDir: () => '/tmp/postshow-test',
  loadConfig: () => ({ token: 'psh_test', workspaceName: 'Test workspace' }),
}));

vi.mock('./scheduler', () => {
  class FakeScheduler {
    configured = true;
    isRunning = false;
    start = vi.fn();
    tick = vi.fn(async () => ({
      at: '2026-07-21T00:00:00.000Z',
      status: 'idle',
      detail: 'nothing due',
      succeeded: 0,
      failed: 0,
    }));
    lastRuns = vi.fn(() => []);
    pauseAndDrain = vi.fn(() => {
      if (!this.isRunning) return Promise.resolve();
      return new Promise<void>((resolve) => {
        state.resolveSchedulerDrain = () => {
          this.isRunning = false;
          resolve();
        };
      });
    });
    private disposal: Promise<void> | null = null;
    dispose = vi.fn(() => {
      if (!this.disposal) {
        this.disposal = new Promise<void>((resolve) => {
          state.resolveSchedulerDispose = () => {
            this.isRunning = false;
            resolve();
          };
        });
      }
      return this.disposal;
    });

    constructor() {
      state.order.push('scheduler');
      state.scheduler = this;
    }
  }
  return { LocalScheduler: FakeScheduler };
});

vi.mock('electron', () => {
  class FakeBrowserWindow {
    readonly options: Record<string, any>;
    readonly windowListeners = new Map<string, Handler>();
    readonly webContents: Record<string, any>;
    readonly destroy = vi.fn();
    readonly show = vi.fn();
    readonly focus = vi.fn();
    readonly restore = vi.fn();
    readonly hide = vi.fn();

    constructor(options: Record<string, any>) {
      state.order.push('window');
      this.options = options;
      const mainFrame = { url: 'https://postshow.io/settings' };
      this.webContents = {
        mainFrame,
        on: vi.fn((event: string, listener: Handler) => {
          state.webContentsListeners.set(event, listener);
        }),
        setWindowOpenHandler: vi.fn((listener: Handler) => {
          state.windowOpenHandler = listener;
        }),
      };
      state.browserWindow = this;
    }

    on(event: string, listener: Handler): void {
      this.windowListeners.set(event, listener);
    }

    once(event: string, listener: Handler): void {
      this.windowListeners.set(event, listener);
    }

    isDestroyed(): boolean {
      return false;
    }

    isMinimized(): boolean {
      return false;
    }

    loadURL = vi.fn(async () => {
      state.order.push('load-url');
    });
  }

  class FakeTray {
    readonly setToolTip = vi.fn();
    readonly setContextMenu = vi.fn();
    readonly destroy = vi.fn();

    constructor() {
      state.order.push('tray');
      state.tray = this;
    }

    isDestroyed(): boolean {
      return false;
    }
  }

  const app = {
    isPackaged: true,
    getVersion: vi.fn(() => '0.1.0'),
    getPath: vi.fn((name: string) =>
      name === 'exe' ? '/Applications/Postshow.app/Contents/MacOS/Postshow' : '/tmp'
    ),
    dock: { hide: vi.fn() },
    enableSandbox: vi.fn(() => state.order.push('enable-sandbox')),
    requestSingleInstanceLock: vi.fn(() => {
      state.order.push('single-instance-lock');
      return true;
    }),
    quit: vi.fn(),
    exit: state.exit,
    whenReady: vi.fn(async () => {}),
    on: vi.fn((event: string, listener: Handler) => {
      state.appListeners.set(event, listener);
    }),
    off: vi.fn((event: string, listener: Handler) => {
      if (state.appListeners.get(event) === listener) state.appListeners.delete(event);
    }),
  };

  const defaultSession = {
    setPermissionCheckHandler: vi.fn((handler: Handler | null) => {
      state.permissionHandlers.check = handler;
      if (handler) state.order.push('permission-check');
    }),
    setPermissionRequestHandler: vi.fn((handler: Handler | null) => {
      state.permissionHandlers.request = handler;
      if (handler) state.order.push('permission-request');
    }),
    setDevicePermissionHandler: vi.fn((handler: Handler | null) => {
      state.permissionHandlers.device = handler;
      if (handler) state.order.push('permission-device');
    }),
    setDisplayMediaRequestHandler: vi.fn((handler: Handler | null) => {
      state.permissionHandlers.display = handler;
      if (handler) state.order.push('permission-display');
    }),
  };

  return {
    BrowserWindow: FakeBrowserWindow,
    dialog: { showSaveDialog: state.showSaveDialog },
    Menu: { buildFromTemplate: vi.fn((template: unknown) => template) },
    Tray: FakeTray,
    app,
    ipcMain: {
      handle: vi.fn((channel: string, handler: Handler) => state.ipcHandlers.set(channel, handler)),
      removeHandler: vi.fn((channel: string) => state.ipcHandlers.delete(channel)),
    },
    nativeImage: {
      createFromDataURL: vi.fn(() => ({ setTemplateImage: vi.fn() })),
    },
    powerMonitor: { on: vi.fn(), off: vi.fn() },
    session: { defaultSession },
    shell: {
      openExternal: state.openExternal,
      openPath: vi.fn(async () => ''),
    },
  };
});

describe('Electron shell wiring', () => {
  it('orders startup safely, hardens the renderer, validates IPC, and disposes once', async () => {
    process.env.POSTSHOW_WEB_URL = 'https://attacker.example';
    const { WEB_URL } = await import('./index');
    await Promise.resolve();
    await Promise.resolve();
    delete process.env.POSTSHOW_WEB_URL;

    expect(WEB_URL).toBe('https://postshow.io');
    expect(state.order.indexOf('single-instance-lock')).toBeLessThan(
      state.order.indexOf('scheduler')
    );
    expect(state.order.indexOf('permission-check')).toBeLessThan(state.order.indexOf('window'));
    expect(state.order.indexOf('scheduler')).toBeLessThan(state.order.indexOf('tray'));
    expect(state.order.indexOf('tray')).toBeLessThan(state.order.indexOf('load-url'));

    expect(state.browserWindow.options.webPreferences).toMatchObject({
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
    });
    expect(state.browserWindow.options.webPreferences.preload).toMatch(/preload\/index\.cjs$/);
    expect(
      Object.values(state.permissionHandlers).every((handler) => typeof handler === 'function')
    ).toBe(true);

    const willNavigate = state.webContentsListeners.get('will-navigate')!;
    const subframePrevented = vi.fn();
    willNavigate({
      isMainFrame: false,
      url: 'https://attacker.example',
      preventDefault: subframePrevented,
    });
    expect(subframePrevented).not.toHaveBeenCalled();

    const mainFramePrevented = vi.fn();
    willNavigate({
      isMainFrame: true,
      url: 'https://attacker.example',
      preventDefault: mainFramePrevented,
    });
    expect(mainFramePrevented).toHaveBeenCalledOnce();

    const openResult = state.windowOpenHandler!({
      url: 'https://checkout.stripe.com/c/pay/test',
    });
    expect(openResult).toEqual({ action: 'deny' });
    expect(state.openExternal).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/test');

    const runtimeStatus = state.ipcHandlers.get('postshow:runtime-status')!;
    const webContents = state.browserWindow.webContents;
    expect(runtimeStatus({ sender: webContents, senderFrame: webContents.mainFrame })).toEqual({
      configured: true,
      lastRuns: [],
    });
    expect(() =>
      runtimeStatus({
        sender: webContents,
        senderFrame: { url: 'https://postshow.io/embedded' },
      })
    ).toThrow('Unauthorized Postshow desktop IPC sender');

    const installUpdate = state.ipcHandlers.get('postshow:install-update')!;
    state.scheduler.isRunning = true;
    const installation = installUpdate({ sender: webContents, senderFrame: webContents.mainFrame });
    await Promise.resolve();

    expect(state.scheduler.pauseAndDrain).toHaveBeenCalledOnce();
    expect(state.updater.installDownloadedUpdate).not.toHaveBeenCalled();
    state.resolveSchedulerDrain?.();
    await expect(installation).resolves.toBe(true);
    expect(state.updater.installDownloadedUpdate).toHaveBeenCalledOnce();
    expect(state.order.at(-1)).toBe('install-update');

    const beforeQuit = state.appListeners.get('before-quit')!;
    const preventQuit = vi.fn();
    state.scheduler.isRunning = true;
    beforeQuit({ preventDefault: preventQuit });
    expect(preventQuit).toHaveBeenCalledOnce();
    expect(state.scheduler.dispose).toHaveBeenCalledOnce();
    expect(state.tray.destroy).not.toHaveBeenCalled();
    state.resolveSchedulerDispose?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(state.scheduler.dispose).toHaveBeenCalledTimes(2);
    const electron = await import('electron');
    expect(electron.app.quit).toHaveBeenCalled();
    const finalPreventQuit = vi.fn();
    beforeQuit({ preventDefault: finalPreventQuit });
    expect(finalPreventQuit).not.toHaveBeenCalled();
    expect(state.exit).not.toHaveBeenCalled();
    expect(state.tray.destroy).toHaveBeenCalledOnce();
    expect(state.browserWindow.destroy).toHaveBeenCalledOnce();
    expect(state.ipcHandlers.size).toBe(0);
    expect(Object.values(state.permissionHandlers).every((handler) => handler === null)).toBe(true);
  });
});
