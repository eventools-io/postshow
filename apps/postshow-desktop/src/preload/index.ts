// Preload: the only bridge between the web app and the shell. Narrow, typed,
// and read-mostly; never expose raw ipcRenderer.

import { contextBridge, ipcRenderer } from 'electron';
import type { LedgerEntry } from '../main/scheduler';
import type { DesktopUpdateStatus } from '../main/updater';

export interface PostshowDesktopBridge {
  runtimeStatus: () => Promise<{
    configured: boolean;
    lastRuns: LedgerEntry[];
  }>;
  runNow: () => Promise<LedgerEntry>;
  updateStatus: () => Promise<DesktopUpdateStatus>;
  checkForUpdates: () => Promise<DesktopUpdateStatus>;
  installUpdate: () => Promise<boolean>;
  exportDiagnostics: () => Promise<boolean>;
}

const bridge: PostshowDesktopBridge = {
  runtimeStatus: () => ipcRenderer.invoke('postshow:runtime-status'),
  runNow: () => ipcRenderer.invoke('postshow:run-now'),
  updateStatus: () => ipcRenderer.invoke('postshow:update-status'),
  checkForUpdates: () => ipcRenderer.invoke('postshow:check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('postshow:install-update'),
  exportDiagnostics: () => ipcRenderer.invoke('postshow:export-diagnostics'),
};

contextBridge.exposeInMainWorld('postshowDesktop', bridge);
