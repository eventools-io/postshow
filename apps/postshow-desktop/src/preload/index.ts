// Preload: the only bridge between the web app and the shell. Narrow, typed,
// and read-mostly; never expose raw ipcRenderer.

import { contextBridge, ipcRenderer } from 'electron';

export interface PostshowDesktopBridge {
  runtimeStatus: () => Promise<{
    configured: boolean;
    lastRuns: { at: string; ok: boolean; detail: string }[];
  }>;
  runNow: () => Promise<{ at: string; ok: boolean; detail: string }>;
}

const bridge: PostshowDesktopBridge = {
  runtimeStatus: () => ipcRenderer.invoke('postshow:runtime-status'),
  runNow: () => ipcRenderer.invoke('postshow:run-now'),
};

contextBridge.exposeInMainWorld('postshowDesktop', bridge);
