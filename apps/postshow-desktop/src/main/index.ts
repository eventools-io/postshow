// Postshow desktop: a menu-bar agent. The window is the Postshow web app;
// the shell adds a tray, a background scheduler with catch-up on wake, and
// a narrow, origin-validated IPC bridge.

import { join } from 'node:path';
import { release as osRelease } from 'node:os';
import {
  BrowserWindow,
  Menu,
  Tray,
  app,
  dialog,
  ipcMain,
  nativeImage,
  powerMonitor,
  session,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import electronUpdater from 'electron-updater';
import { configDir, loadConfig } from 'postshow/lib';
import {
  writeDiagnosticBundle,
  type DiagnosticConfigState,
  type DiagnosticInput,
} from './diagnostics';
import { LifecycleDisposer, acquireSingleInstance } from './lifecycle';
import { classifyNavigation, isTrustedRendererUrl, resolveWebUrl } from './navigation';
import { isTrustedReleaseBuild } from './release-signature';
import { LocalScheduler, type LedgerEntry } from './scheduler';
import { DesktopUpdater, type DesktopUpdateStatus } from './updater';

const { autoUpdater } = electronUpdater;

app.enableSandbox();

// Packaged builds deliberately ignore POSTSHOW_WEB_URL. Development may use
// only the exact local Vite origins accepted by resolveWebUrl.
const WEB_URL = resolveWebUrl(app.isPackaged, process.env.POSTSHOW_WEB_URL);
const QUIT_DRAIN_TIMEOUT_MS = 180_000;
const CONFIG_STATE_CACHE_MS = 30_000;
const resources = new LifecycleDisposer(() => {
  console.error('Postshow desktop cleanup failed');
});

let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let scheduler: LocalScheduler | null = null;
let desktopUpdater: DesktopUpdater | null = null;
let updateInstallPromise: Promise<boolean> | null = null;
let updateInstallInProgress = false;
let updateInstallNote = '';
let lastEntry: LedgerEntry | null = null;
let diagnosticStatus = '';
let cachedConfigState: ReturnType<typeof readLocalConfigState> | null = null;
let cachedConfigStateAt = 0;
let quitting = false;
let desktopReady = false;
let resolveDesktopReady: () => void = () => {};
const desktopReadyPromise = new Promise<void>((resolve) => {
  resolveDesktopReady = resolve;
});

function openExternal(url: string): void {
  void shell.openExternal(url).catch(() => {
    console.error('Unable to open an approved external destination');
  });
}

function enforceNavigation(rawUrl: string, preventDefault: () => void): void {
  const decision = classifyNavigation(rawUrl, WEB_URL);
  if (decision.action === 'allow') return;

  preventDefault();
  if (decision.action === 'external') openExternal(decision.url);
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 800,
    show: false,
    backgroundColor: '#131110',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
    },
  });

  win.webContents.on('will-navigate', (event) => {
    if (!event.isMainFrame) return;
    enforceNavigation(event.url, () => event.preventDefault());
  });
  win.webContents.on('will-redirect', (event) => {
    if (!event.isMainFrame) return;
    enforceNavigation(event.url, () => event.preventDefault());
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    const decision = classifyNavigation(url, WEB_URL);
    if (decision.action === 'external') openExternal(decision.url);
    return { action: 'deny' };
  });

  // Menu-bar semantics: closing hides the window while the agent keeps working.
  win.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => {
    if (window === win) window = null;
  });
  win.once('ready-to-show', () => {
    if (!resources.isDisposed && !quitting) {
      win.show();
      win.focus();
    }
  });

  void win.loadURL(WEB_URL).catch(() => {
    if (!resources.isDisposed) console.error('Unable to load the Postshow web app');
  });
  return win;
}

function showWindow(): void {
  if (resources.isDisposed || quitting || !desktopReady) return;
  if (!window || window.isDestroyed()) {
    window = createWindow();
    return;
  }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function readLocalConfigState(): {
  workspaceName: string;
  configured: boolean;
  invalid: boolean;
} {
  try {
    const config = loadConfig();
    return {
      workspaceName: config.workspaceName,
      configured: Boolean(config.token),
      invalid: false,
    };
  } catch {
    return { workspaceName: '', configured: false, invalid: true };
  }
}

function localConfigState(): ReturnType<typeof readLocalConfigState> {
  const now = Date.now();
  if (!cachedConfigState || now - cachedConfigStateAt >= CONFIG_STATE_CACHE_MS) {
    cachedConfigState = readLocalConfigState();
    cachedConfigStateAt = now;
  }
  return cachedConfigState;
}

function diagnosticConfigState(): DiagnosticConfigState {
  try {
    const config = loadConfig();
    return {
      configured: Boolean(config.token),
      invalid: false,
      engineMode: config.engine.mode,
      engineProvider: config.engine.provider,
      connectorCount: config.connectors.length,
      verifiedConnectorCount: config.connectors.filter((connector) => connector.verified).length,
      localOnlyConnectorCount: config.connectors.filter((connector) => connector.localOnly).length,
    };
  } catch {
    return {
      configured: false,
      invalid: true,
      connectorCount: 0,
      verifiedConnectorCount: 0,
      localOnlyConnectorCount: 0,
    };
  }
}

function currentUpdateStatus(): DesktopUpdateStatus {
  return (
    desktopUpdater?.getStatus() ?? {
      state: 'verifying',
      currentVersion: app.getVersion(),
      message: 'verifying this release before update checks',
      canCheck: false,
      canRetry: false,
      canInstall: false,
    }
  );
}

async function checkForUpdates(): Promise<DesktopUpdateStatus> {
  const updater = desktopUpdater;
  if (!updater) return currentUpdateStatus();
  return await updater.checkForUpdates();
}

async function finishesBefore(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise.then(
        () => true,
        () => false
      ),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function installDownloadedUpdate(): Promise<boolean> {
  if (updateInstallPromise) return await updateInstallPromise;
  const updater = desktopUpdater;
  if (!updater?.getStatus().canInstall) return false;

  const attempt = (async () => {
    updateInstallInProgress = true;
    updateInstallNote = '';
    refreshTrayMenu();

    const activeScheduler = scheduler;
    const drain = activeScheduler?.pauseAndDrain() ?? Promise.resolve();
    const drained = await finishesBefore(drain, QUIT_DRAIN_TIMEOUT_MS);
    if (!drained) {
      updateInstallInProgress = false;
      updateInstallNote = 'active run did not finish; retry update installation';
      console.error('Postshow could not drain the active run before installing the update');
      // Keep future heartbeats paused while the current run finishes, then
      // resume only if no retry or real quit superseded this attempt.
      void drain.then(() => {
        if (
          activeScheduler &&
          scheduler === activeScheduler &&
          !updateInstallInProgress &&
          !quitting &&
          !resources.isDisposed
        ) {
          try {
            activeScheduler.start(refreshTray);
          } catch {
            console.error('Postshow could not resume its scheduler after update deferral');
          }
        }
      });
      refreshTrayMenu();
      return false;
    }

    // A manual/OS quit that arrived while draining wins over the update action.
    if (quitting || resources.isDisposed || desktopUpdater !== updater) {
      updateInstallInProgress = false;
      return false;
    }

    // The scheduler is now idle and paused. Only now may electron-updater ask
    // the native installer to quit and replace this build.
    quitting = true;
    const installing = updater.installDownloadedUpdate();
    updateInstallInProgress = false;
    if (!installing) {
      quitting = false;
      updateInstallNote = 'installer handoff failed; retry the update';
      if (activeScheduler && scheduler === activeScheduler && !resources.isDisposed) {
        try {
          activeScheduler.start(refreshTray);
        } catch {
          console.error('Postshow could not resume its scheduler after an update failure');
        }
      }
    }
    refreshTrayMenu();
    return installing;
  })();

  updateInstallPromise = attempt;
  try {
    return await attempt;
  } finally {
    if (updateInstallPromise === attempt) updateInstallPromise = null;
  }
}

function diagnosticInput(): DiagnosticInput {
  return {
    generatedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron ?? 'unknown',
    nodeVersion: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    osRelease: osRelease(),
    config: diagnosticConfigState(),
    updater: currentUpdateStatus(),
    runs: scheduler?.lastRuns(20) ?? [],
  };
}

async function exportDiagnostics(): Promise<boolean> {
  try {
    const defaultPath = join(
      app.getPath('downloads'),
      `Postshow-diagnostics-${new Date().toISOString().slice(0, 10)}.json`
    );
    const options = {
      title: 'Export privacy-safe Postshow diagnostics',
      defaultPath,
      filters: [{ name: 'JSON diagnostic bundle', extensions: ['json'] }],
      properties: ['showOverwriteConfirmation' as const],
    };
    const result =
      window && !window.isDestroyed()
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return false;

    writeDiagnosticBundle(result.filePath, diagnosticInput());
    diagnosticStatus = 'Diagnostics exported';
    refreshTrayMenu();
    return true;
  } catch {
    diagnosticStatus = 'Diagnostics export failed';
    console.error('Postshow could not export the diagnostic bundle');
    refreshTrayMenu();
    return false;
  }
}

function refreshTrayMenu(): void {
  try {
    if (tray && !tray.isDestroyed()) tray.setContextMenu(trayMenu());
  } catch {
    console.error('Unable to refresh the Postshow tray');
  }
}

function refreshTray(entry: LedgerEntry): void {
  if (resources.isDisposed) return;
  lastEntry = entry;
  refreshTrayMenu();
}

function runSchedulerTick(activeScheduler: LocalScheduler): void {
  void activeScheduler.tick().then(refreshTray, () => {
    if (!resources.isDisposed) console.error('Postshow scheduler tick failed');
  });
}

function trayMenu(): Menu {
  const activeScheduler = scheduler;
  const config = localConfigState();
  const last = lastEntry ?? activeScheduler?.lastRuns(1)[0] ?? null;
  const update = currentUpdateStatus();
  const updateProgress =
    update.state === 'downloading' && update.progressPercent !== undefined
      ? ` · ${update.progressPercent}%`
      : '';
  const updateMessage = updateInstallInProgress
    ? 'finishing the active run before installing update'
    : updateInstallNote || update.message;
  return Menu.buildFromTemplate([
    {
      label: config.workspaceName ? `Postshow · ${config.workspaceName}` : 'Postshow',
      enabled: false,
    },
    {
      label: last
        ? `last check ${last.at.slice(11, 16)} UTC · ${last.status} · ${last.detail}`
        : 'no runs yet',
      enabled: false,
    },
    { type: 'separator' },
    { label: 'Open Postshow', click: showWindow },
    {
      label: 'Run due jobs now',
      enabled: Boolean(activeScheduler) && !quitting && !updateInstallInProgress,
      click: () => {
        if (activeScheduler) runSchedulerTick(activeScheduler);
      },
    },
    {
      label: config.invalid
        ? 'Local config invalid (npx postshow init)'
        : config.configured
          ? 'Local runtime configured'
          : 'Not configured (npx postshow init)',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: `Updates · ${updateMessage}${updateProgress}`,
      enabled: false,
    },
    ...(update.canInstall
      ? [
          {
            label: `Restart and install Postshow ${update.availableVersion ?? ''}`.trim(),
            enabled: !updateInstallInProgress,
            click: () => void installDownloadedUpdate(),
          },
        ]
      : [
          {
            label: update.canRetry ? 'Retry update' : 'Check for updates',
            enabled: update.canRetry || update.canCheck,
            click: () => void checkForUpdates(),
          },
        ]),
    { type: 'separator' },
    {
      label: 'Export privacy-safe diagnostics…',
      click: () => void exportDiagnostics(),
    },
    ...(diagnosticStatus ? [{ label: diagnosticStatus, enabled: false }] : []),
    {
      label: 'Open config folder',
      click: () => {
        void shell.openPath(configDir()).catch(() => {
          console.error('Unable to open the Postshow config folder');
        });
      },
    },
    { type: 'separator' },
    {
      label: quitting ? 'Force Quit Postshow' : 'Quit Postshow',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
}

function assertTrustedIpcSender(event: IpcMainInvokeEvent): void {
  const senderFrame = event.senderFrame;
  if (
    !window ||
    window.isDestroyed() ||
    event.sender !== window.webContents ||
    !senderFrame ||
    senderFrame !== event.sender.mainFrame ||
    !isTrustedRendererUrl(senderFrame.url, WEB_URL)
  ) {
    throw new Error('Unauthorized Postshow desktop IPC sender');
  }
}

function denyRendererPermissions(): void {
  const rendererSession = session.defaultSession;
  rendererSession.setPermissionCheckHandler(() => false);
  resources.add(() => rendererSession.setPermissionCheckHandler(null));
  rendererSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  resources.add(() => rendererSession.setPermissionRequestHandler(null));
  rendererSession.setDevicePermissionHandler(() => false);
  resources.add(() => rendererSession.setDevicePermissionHandler(null));
  rendererSession.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  resources.add(() => rendererSession.setDisplayMediaRequestHandler(null));
}

function bootstrap(): void {
  if (resources.isDisposed) return;

  try {
    denyRendererPermissions();

    const activeScheduler = new LocalScheduler(15);
    scheduler = activeScheduler;
    resources.add(() => {
      void activeScheduler.dispose();
      if (scheduler === activeScheduler) scheduler = null;
    });

    const trayIcon = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAVElEQVR42mNgGAWjYODA/z8DA8N/UjADEwOFYNQABgYWUjX8Z2Bg+M/AwMDIwMDASKwLGBkYGP4zMTD8Z2Rg+E+sC0bTAMOoAaNgFIyCUTAKhgcAAJgUCcVfMSChAAAAAElFTkSuQmCC'
    );
    trayIcon.setTemplateImage(true);
    tray = new Tray(trayIcon);
    tray.setToolTip('Postshow');
    tray.setContextMenu(trayMenu());

    ipcMain.handle('postshow:runtime-status', (event) => {
      assertTrustedIpcSender(event);
      return {
        configured: localConfigState().configured,
        lastRuns: activeScheduler.lastRuns(5),
      };
    });
    resources.add(() => ipcMain.removeHandler('postshow:runtime-status'));
    ipcMain.handle('postshow:run-now', async (event) => {
      assertTrustedIpcSender(event);
      if (updateInstallInProgress) {
        return {
          at: new Date().toISOString(),
          status: 'busy',
          detail: 'update installation pending',
          succeeded: 0,
          failed: 0,
        } satisfies LedgerEntry;
      }
      const entry = await activeScheduler.tick();
      refreshTray(entry);
      return entry;
    });
    resources.add(() => ipcMain.removeHandler('postshow:run-now'));
    ipcMain.handle('postshow:update-status', (event) => {
      assertTrustedIpcSender(event);
      return currentUpdateStatus();
    });
    resources.add(() => ipcMain.removeHandler('postshow:update-status'));
    ipcMain.handle('postshow:check-for-updates', async (event) => {
      assertTrustedIpcSender(event);
      return await checkForUpdates();
    });
    resources.add(() => ipcMain.removeHandler('postshow:check-for-updates'));
    ipcMain.handle('postshow:install-update', (event) => {
      assertTrustedIpcSender(event);
      return installDownloadedUpdate();
    });
    resources.add(() => ipcMain.removeHandler('postshow:install-update'));
    ipcMain.handle('postshow:export-diagnostics', async (event) => {
      assertTrustedIpcSender(event);
      return await exportDiagnostics();
    });
    resources.add(() => ipcMain.removeHandler('postshow:export-diagnostics'));

    const releaseUpdater = new DesktopUpdater({
      updater: autoUpdater,
      currentVersion: app.getVersion(),
      packaged: app.isPackaged,
      platform: process.platform,
      executablePath: app.getPath('exe'),
      verifyRelease: isTrustedReleaseBuild,
      onStatus: refreshTrayMenu,
    });
    desktopUpdater = releaseUpdater;
    resources.add(() => {
      releaseUpdater.dispose();
      if (desktopUpdater === releaseUpdater) desktopUpdater = null;
    });
    void releaseUpdater.start().catch(() => {
      console.error('Postshow could not initialize automatic updates');
    });

    activeScheduler.start(refreshTray);

    // Sleep/wake: an immediate tick on resume is the catch-up.
    const handleResume = () => {
      if (quitting || updateInstallInProgress) return;
      runSchedulerTick(activeScheduler);
      void checkForUpdates();
    };
    powerMonitor.on('resume', handleResume);
    resources.add(() => powerMonitor.off('resume', handleResume));

    if (process.platform === 'darwin') app.dock?.hide();
    desktopReady = true;
    resolveDesktopReady();
    showWindow();
  } catch {
    console.error('Unable to start Postshow desktop');
    quitting = true;
    app.quit();
  }
}

// Lock ownership is decided before the scheduler opens SQLite or any tray/window
// resources are created. A second launch only asks the owner to focus its window.
const singleInstance = acquireSingleInstance(
  {
    requestLock: () => app.requestSingleInstanceLock(),
    quit: () => app.quit(),
    isReady: () => desktopReady,
    whenReady: () => desktopReadyPromise,
    onSecondInstance: (listener) => app.on('second-instance', listener),
    offSecondInstance: (listener) => app.off('second-instance', listener),
  },
  showWindow
);
resources.add(singleInstance.dispose);

if (singleInstance.acquired) {
  resources.add(() => {
    if (window && !window.isDestroyed()) window.destroy();
    window = null;
  });
  resources.add(() => {
    if (tray && !tray.isDestroyed()) tray.destroy();
    tray = null;
  });

  let quitDrainStarted = false;
  let quitFinalized = false;
  let allowFinalQuit = false;
  let quitDrainTimer: NodeJS.Timeout | null = null;
  const handleActivate = () => showWindow();
  const finalizeQuit = (forced: boolean): void => {
    if (quitFinalized) return;
    quitFinalized = true;
    if (quitDrainTimer) clearTimeout(quitDrainTimer);
    quitDrainTimer = null;
    resources.dispose();
    if (forced) app.exit(0);
    else {
      // The second before-quit emitted by this app.quit() must pass through;
      // the active run is drained and every resource is already disposed.
      allowFinalQuit = true;
      app.quit();
    }
  };
  const handleBeforeQuit = (event: { preventDefault(): void }) => {
    quitting = true;
    if (allowFinalQuit) return;
    const activeScheduler = scheduler;
    if (quitDrainStarted) {
      event.preventDefault();
      console.warn('Forcing Postshow to quit before the active run finished');
      finalizeQuit(true);
      return;
    }
    if (activeScheduler?.isRunning) {
      event.preventDefault();
      quitDrainStarted = true;
      try {
        if (tray && !tray.isDestroyed()) {
          tray.setToolTip('Postshow · finishing the active run before quitting');
          tray.setContextMenu(trayMenu());
        }
      } catch {
        console.error('Unable to show Postshow shutdown status');
      }
      quitDrainTimer = setTimeout(() => {
        console.error('Postshow active run did not drain before the quit deadline');
        finalizeQuit(true);
      }, QUIT_DRAIN_TIMEOUT_MS);
      void activeScheduler.dispose().then(
        () => finalizeQuit(false),
        () => {
          console.error('Unable to drain the Postshow scheduler cleanly');
          finalizeQuit(true);
        }
      );
      return;
    }
    resources.dispose();
  };
  const handleWillQuit = () => {
    quitting = true;
    resources.dispose();
  };
  const keepAliveWithoutWindows = () => {};
  app.on('activate', handleActivate);
  app.on('before-quit', handleBeforeQuit);
  app.on('will-quit', handleWillQuit);
  app.on('window-all-closed', keepAliveWithoutWindows);
  resources.add(() => app.off('activate', handleActivate));
  resources.add(() => app.off('before-quit', handleBeforeQuit));
  resources.add(() => app.off('will-quit', handleWillQuit));
  resources.add(() => app.off('window-all-closed', keepAliveWithoutWindows));

  void app.whenReady().then(bootstrap, () => {
    console.error('Electron failed before Postshow was ready');
    quitting = true;
    resources.dispose();
    app.quit();
  });
}

export { WEB_URL };
