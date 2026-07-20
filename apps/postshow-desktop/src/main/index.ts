// Postshow desktop: a menu-bar agent. The window is the postshow web app;
// the shell adds a tray, a background scheduler with catch-up on wake, and
// an IPC bridge. Security stays on Electron defaults: contextIsolation and
// sandbox on, no nodeIntegration, preload exposes a narrow typed surface.

import { join } from 'node:path';
import {
  BrowserWindow,
  Menu,
  Tray,
  app,
  ipcMain,
  nativeImage,
  powerMonitor,
  shell,
} from 'electron';
import { configDir, loadConfig } from 'postshow/lib';
import { LocalScheduler, type LedgerEntry } from './scheduler';

const WEB_URL = process.env.POSTSHOW_WEB_URL ?? 'https://postshow.io';

let window: BrowserWindow | null = null;
let tray: Tray | null = null;
const scheduler = new LocalScheduler(15);
let lastEntry: LedgerEntry | null = null;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 800,
    show: false,
    backgroundColor: '#131110',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
    },
  });

  // The desktop renders the same synced workspace as the web app; the shell
  // adds the tray, the scheduler, and the local runtime.
  void win.loadURL(WEB_URL);

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Menu-bar app semantics: closing hides, the agent keeps working.
  win.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });
  win.once('ready-to-show', () => win.show());
  return win;
}

function showWindow(): void {
  if (!window || window.isDestroyed()) window = createWindow();
  else {
    window.show();
    window.focus();
  }
}

// A 16x16 template glyph: the ghost-light dot. Template images let macOS
// tint it for light/dark menu bars.
const TRAY_ICON = nativeImage.createFromDataURL(
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAVElEQVR42mNgGAWjYODA/z8DA8N/UjADEwOFYNQABgYWUjX8Z2Bg+M/AwMDIwMDASKwLGBkYGP4zMTD8Z2Rg+E+sC0bTAMOoAaNgFIyCUTAKhgcAAJgUCcVfMSChAAAAAElFTkSuQmCC'
);
TRAY_ICON.setTemplateImage(true);

function trayMenu(): Menu {
  const config = loadConfig();
  const last = lastEntry ?? scheduler.lastRuns(1)[0] ?? null;
  return Menu.buildFromTemplate([
    {
      label: config.workspaceName ? `Postshow · ${config.workspaceName}` : 'Postshow',
      enabled: false,
    },
    {
      label: last
        ? `last check ${last.at.slice(11, 16)} UTC · ${last.ok ? 'ok' : last.detail}`
        : 'no runs yet',
      enabled: false,
    },
    { type: 'separator' },
    { label: 'Open Postshow', click: showWindow },
    {
      label: 'Run due jobs now',
      click: () => {
        void scheduler.tick().then((entry) => {
          lastEntry = entry;
          tray?.setContextMenu(trayMenu());
        });
      },
    },
    {
      label: scheduler.configured
        ? 'Local runtime configured'
        : 'Not configured (npx postshow init)',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Open config folder',
      click: () => {
        void shell.openPath(configDir());
      },
    },
    { type: 'separator' },
    {
      label: 'Quit Postshow',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
}

let quitting = false;

app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock?.hide();

  tray = new Tray(TRAY_ICON);
  tray.setToolTip('Postshow');
  tray.setContextMenu(trayMenu());

  ipcMain.handle('postshow:runtime-status', () => ({
    configured: scheduler.configured,
    lastRuns: scheduler.lastRuns(5),
  }));
  ipcMain.handle('postshow:run-now', async () => {
    const entry = await scheduler.tick();
    lastEntry = entry;
    tray?.setContextMenu(trayMenu());
    return entry;
  });

  scheduler.start((entry) => {
    lastEntry = entry;
    tray?.setContextMenu(trayMenu());
  });

  // Sleep/wake: an immediate tick on resume is the catch-up.
  powerMonitor.on('resume', () => {
    void scheduler.tick().then((entry) => {
      lastEntry = entry;
      tray?.setContextMenu(trayMenu());
    });
  });

  showWindow();
});

app.on('activate', showWindow);
app.on('before-quit', () => {
  quitting = true;
  scheduler.stop();
});
// Menu-bar app: no windows does not mean quit.
app.on('window-all-closed', () => {});

export { WEB_URL };
