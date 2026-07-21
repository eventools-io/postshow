import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppUpdater, UpdateInfo } from 'electron-updater';
import { DesktopUpdater, UPDATE_CHECK_INTERVAL_MS, isStrictlyNewerStableVersion } from './updater';

class FakeUpdater extends EventEmitter {
  logger: unknown = console;
  autoDownload = true;
  autoInstallOnAppQuit = true;
  autoRunAppAfterInstall = false;
  forceDevUpdateConfig = true;
  fullChangelog = true;
  disableWebInstaller = false;
  allowPrerelease = true;
  allowDowngrade = true;
  checkForUpdates = vi.fn(async () => null);
  downloadUpdate = vi.fn(async () => []);
  quitAndInstall = vi.fn();
}

function updaterHarness(options: { packaged?: boolean; trusted?: boolean } = {}) {
  const port = new FakeUpdater();
  const statuses: string[] = [];
  const updater = new DesktopUpdater({
    updater: port as unknown as AppUpdater,
    currentVersion: '1.2.3',
    packaged: options.packaged ?? true,
    platform: 'darwin',
    executablePath: '/Applications/Postshow.app/Contents/MacOS/Postshow',
    verifyRelease: vi.fn(async () => options.trusted ?? true),
    onStatus: (value) => statuses.push(value.state),
  });
  return { port, updater, statuses };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('DesktopUpdater', () => {
  it('never initializes electron-updater in development or untrusted packages', async () => {
    for (const options of [
      { packaged: false, trusted: true },
      { packaged: true, trusted: false },
    ]) {
      const { port, updater } = updaterHarness(options);
      await expect(updater.start()).resolves.toMatchObject({ state: 'disabled' });
      expect(port.checkForUpdates).not.toHaveBeenCalled();
      expect(port.downloadUpdate).not.toHaveBeenCalled();
      updater.dispose();
    }
  });

  it('forces stable non-downgrade settings before checking and schedules later checks', async () => {
    vi.useFakeTimers();
    const { port, updater } = updaterHarness();
    await updater.start();

    expect(port).toMatchObject({
      logger: null,
      autoDownload: false,
      autoInstallOnAppQuit: false,
      autoRunAppAfterInstall: true,
      forceDevUpdateConfig: false,
      fullChangelog: false,
      disableWebInstaller: true,
      allowPrerelease: false,
      allowDowngrade: false,
    });
    expect(port.checkForUpdates).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(port.checkForUpdates).toHaveBeenCalledTimes(2);
    updater.dispose();
  });

  it('downloads only a strict stable upgrade and installs only after download confirmation', async () => {
    const { port, updater } = updaterHarness();
    await updater.start();

    port.emit('update-available', { version: '1.3.0' } as UpdateInfo);
    expect(updater.getStatus()).toMatchObject({
      state: 'downloading',
      availableVersion: '1.3.0',
      progressPercent: 0,
    });
    port.emit('download-progress', { percent: 55.6 });
    expect(updater.getStatus().progressPercent).toBe(56);
    port.emit('update-downloaded', { version: '1.3.0' } as UpdateInfo);
    expect(updater.getStatus()).toMatchObject({ state: 'downloaded', canInstall: true });
    expect(updater.installDownloadedUpdate()).toBe(true);
    expect(port.quitAndInstall).toHaveBeenCalledWith(false, true);
    updater.dispose();
  });

  it('refuses equal, lower, prerelease, malformed, or mismatched downloaded versions', async () => {
    const { port, updater } = updaterHarness();
    await updater.start();

    for (const version of ['1.2.3', '1.2.2', '1.3.0-beta.1', 'not-a-version']) {
      port.emit('update-available', { version } as UpdateInfo);
      expect(port.downloadUpdate).not.toHaveBeenCalled();
      expect(updater.installDownloadedUpdate()).toBe(false);
    }

    port.emit('update-available', { version: '1.3.0' } as UpdateInfo);
    port.emit('update-downloaded', { version: '9.0.0' } as UpdateInfo);
    expect(updater.getStatus()).toMatchObject({ state: 'error', canRetry: true });
    expect(updater.installDownloadedUpdate()).toBe(false);
    updater.dispose();
  });

  it('surfaces failure as retryable status and removes every listener on disposal', async () => {
    const { port, updater } = updaterHarness();
    await updater.start();
    port.emit('error', new Error('https://example.test/?token=must-not-leak'));

    expect(updater.getStatus()).toEqual(
      expect.objectContaining({
        state: 'error',
        message: 'update check or download failed',
        canRetry: true,
      })
    );
    expect(JSON.stringify(updater.getStatus())).not.toContain('must-not-leak');
    updater.dispose();
    expect(port.eventNames()).toEqual([]);
  });

  it('retries a rejected check without exposing its remote error', async () => {
    const { port, updater } = updaterHarness();
    port.checkForUpdates.mockRejectedValueOnce(
      new Error('https://updates.example/?token=must-not-leak')
    );
    await expect(updater.start()).resolves.toMatchObject({ state: 'error', canRetry: true });
    expect(JSON.stringify(updater.getStatus())).not.toContain('must-not-leak');

    port.checkForUpdates.mockImplementationOnce(async () => {
      port.emit('update-not-available', { version: '1.2.3' } as UpdateInfo);
      return null;
    });
    await expect(updater.checkForUpdates()).resolves.toMatchObject({
      state: 'up-to-date',
      canRetry: false,
    });
    updater.dispose();
  });
});

describe('isStrictlyNewerStableVersion', () => {
  it('compares stable semantic versions without number precision loss', () => {
    expect(isStrictlyNewerStableVersion('2.0.0', '1.999.999')).toBe(true);
    expect(isStrictlyNewerStableVersion('1.2.4+build.8', '1.2.3')).toBe(true);
    expect(isStrictlyNewerStableVersion('999999999999999999999.0.0', '2.0.0')).toBe(true);
    expect(isStrictlyNewerStableVersion(`${'9'.repeat(1_000_000)}.0.0`, '2.0.0')).toBe(false);
    expect(isStrictlyNewerStableVersion('1.2.3-beta.1', '1.2.2')).toBe(false);
    expect(isStrictlyNewerStableVersion('1.2.3', '1.2.3')).toBe(false);
  });
});
