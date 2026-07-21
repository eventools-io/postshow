import type { AppUpdater, ProgressInfo, UpdateInfo } from 'electron-updater';

export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60_000;

export type UpdateState =
  | 'verifying'
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'error'
  | 'installing';

export interface DesktopUpdateStatus {
  state: UpdateState;
  currentVersion: string;
  availableVersion?: string;
  progressPercent?: number;
  message: string;
  canCheck: boolean;
  canRetry: boolean;
  canInstall: boolean;
}

interface StableVersion {
  major: bigint;
  minor: bigint;
  patch: bigint;
}

function stableVersion(raw: string): StableVersion | null {
  if (raw.length === 0 || raw.length > 64) return null;
  const match = raw.match(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
  );
  if (!match) return null;
  return { major: BigInt(match[1]!), minor: BigInt(match[2]!), patch: BigInt(match[3]!) };
}

export function isStrictlyNewerStableVersion(candidate: string, current: string): boolean {
  const next = stableVersion(candidate);
  const installed = stableVersion(current);
  if (!next || !installed) return false;
  if (next.major !== installed.major) return next.major > installed.major;
  if (next.minor !== installed.minor) return next.minor > installed.minor;
  return next.patch > installed.patch;
}

function safeVersion(raw: string): string | undefined {
  return stableVersion(raw) ? raw : undefined;
}

function status(
  state: UpdateState,
  currentVersion: string,
  options: Pick<DesktopUpdateStatus, 'availableVersion' | 'progressPercent'> = {}
): DesktopUpdateStatus {
  const messages: Record<UpdateState, string> = {
    verifying: 'verifying this release before update checks',
    disabled: 'updates unavailable in development or unsigned builds',
    idle: 'ready to check for updates',
    checking: 'checking for updates',
    available: 'update available',
    downloading: 'downloading update',
    downloaded: 'update ready to install',
    'up-to-date': 'Postshow is up to date',
    error: 'update check or download failed',
    installing: 'restarting to install update',
  };
  return {
    state,
    currentVersion,
    ...options,
    message: messages[state],
    canCheck: ['idle', 'up-to-date'].includes(state),
    canRetry: state === 'error',
    canInstall: state === 'downloaded',
  };
}

export interface DesktopUpdaterOptions {
  updater: AppUpdater;
  currentVersion: string;
  packaged: boolean;
  platform: NodeJS.Platform;
  executablePath: string;
  verifyRelease: (platform: NodeJS.Platform, executablePath: string) => Promise<boolean>;
  onStatus?: (status: DesktopUpdateStatus) => void;
}

/** A deliberately conservative stable-channel updater. It never runs in dev,
 * ad-hoc, unsigned, or untrusted packages; never accepts a prerelease or
 * non-increasing version; and never installs without an explicit user action. */
export class DesktopUpdater {
  private value: DesktopUpdateStatus;
  private eligible = false;
  private started = false;
  private disposed = false;
  private checkPromise: Promise<DesktopUpdateStatus> | null = null;
  private downloadPromise: Promise<void> | null = null;
  private interval: NodeJS.Timeout | null = null;
  private expectedDownloadVersion: string | null = null;
  private downloadedVersion: string | null = null;
  private cleanup: Array<() => void> = [];

  constructor(private readonly options: DesktopUpdaterOptions) {
    this.value = status('verifying', options.currentVersion);
  }

  getStatus(): DesktopUpdateStatus {
    return { ...this.value };
  }

  async start(): Promise<DesktopUpdateStatus> {
    if (this.started || this.disposed) return this.getStatus();
    this.started = true;
    this.publish(status('verifying', this.options.currentVersion));

    if (!this.options.packaged || !['darwin', 'win32'].includes(this.options.platform)) {
      this.publish(status('disabled', this.options.currentVersion));
      return this.getStatus();
    }

    let trusted = false;
    try {
      trusted = await this.options.verifyRelease(
        this.options.platform,
        this.options.executablePath
      );
    } catch {
      trusted = false;
    }
    if (this.disposed) return this.getStatus();
    if (!trusted) {
      this.publish(status('disabled', this.options.currentVersion));
      return this.getStatus();
    }

    const updater = this.options.updater;
    updater.logger = null;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.autoRunAppAfterInstall = true;
    updater.forceDevUpdateConfig = false;
    updater.fullChangelog = false;
    updater.disableWebInstaller = true;
    // Setting allowPrerelease or channel may implicitly enable downgrades in
    // electron-updater, so keep stable and set the downgrade gate last.
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;

    this.attachListeners();
    this.eligible = true;
    this.publish(status('idle', this.options.currentVersion));
    this.interval = setInterval(() => void this.checkForUpdates(), UPDATE_CHECK_INTERVAL_MS);
    this.interval.unref?.();
    return await this.checkForUpdates();
  }

  async checkForUpdates(): Promise<DesktopUpdateStatus> {
    if (
      this.disposed ||
      !this.eligible ||
      ['downloading', 'downloaded', 'installing'].includes(this.value.state)
    ) {
      return this.getStatus();
    }
    if (this.checkPromise) return await this.checkPromise;

    this.publish(status('checking', this.options.currentVersion));
    this.checkPromise = this.options.updater
      .checkForUpdates()
      .then(() => this.getStatus())
      .catch(() => {
        if (!this.disposed) this.publish(status('error', this.options.currentVersion));
        return this.getStatus();
      })
      .finally(() => {
        this.checkPromise = null;
      });
    return await this.checkPromise;
  }

  installDownloadedUpdate(): boolean {
    if (
      this.disposed ||
      !this.eligible ||
      this.value.state !== 'downloaded' ||
      !this.downloadedVersion ||
      !isStrictlyNewerStableVersion(this.downloadedVersion, this.options.currentVersion)
    ) {
      return false;
    }
    this.publish(
      status('installing', this.options.currentVersion, {
        availableVersion: this.downloadedVersion,
      })
    );
    try {
      this.options.updater.quitAndInstall(false, true);
      return true;
    } catch {
      this.publish(status('error', this.options.currentVersion));
      return false;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.eligible = false;
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    for (const remove of this.cleanup.splice(0).reverse()) remove();
  }

  private attachListeners(): void {
    const updater = this.options.updater;
    const checking = () => this.publish(status('checking', this.options.currentVersion));
    const unavailable = () => this.publish(status('up-to-date', this.options.currentVersion));
    const available = (info: UpdateInfo) => this.handleAvailable(info);
    const progress = (info: ProgressInfo) => this.handleProgress(info);
    const downloaded = (info: UpdateInfo) => this.handleDownloaded(info);
    const failed = () => this.handleFailure();

    updater.on('checking-for-update', checking);
    updater.on('update-not-available', unavailable);
    updater.on('update-available', available);
    updater.on('download-progress', progress);
    updater.on('update-downloaded', downloaded);
    updater.on('update-cancelled', failed);
    updater.on('error', failed);
    this.cleanup.push(
      () => updater.off('checking-for-update', checking),
      () => updater.off('update-not-available', unavailable),
      () => updater.off('update-available', available),
      () => updater.off('download-progress', progress),
      () => updater.off('update-downloaded', downloaded),
      () => updater.off('update-cancelled', failed),
      () => updater.off('error', failed)
    );
  }

  private handleAvailable(info: UpdateInfo): void {
    const version = safeVersion(info.version);
    if (!version || !isStrictlyNewerStableVersion(version, this.options.currentVersion)) {
      this.publish(status('up-to-date', this.options.currentVersion));
      return;
    }
    // Do not let a second event replace the version whose download is already
    // in flight. The completion event must match this exact approved version.
    if (this.downloadPromise || this.expectedDownloadVersion) return;
    this.publish(status('available', this.options.currentVersion, { availableVersion: version }));
    void this.download(version);
  }

  private download(version: string): Promise<void> {
    if (this.downloadPromise) return this.downloadPromise;
    this.expectedDownloadVersion = version;
    this.downloadedVersion = null;
    this.publish(
      status('downloading', this.options.currentVersion, {
        availableVersion: version,
        progressPercent: 0,
      })
    );
    this.downloadPromise = this.options.updater
      .downloadUpdate()
      .then(() => {})
      .catch(() => {
        if (!this.disposed) this.handleFailure();
      })
      .finally(() => {
        this.downloadPromise = null;
      });
    return this.downloadPromise;
  }

  private handleProgress(info: ProgressInfo): void {
    if (this.value.state !== 'downloading') return;
    const percent = Number.isFinite(info.percent)
      ? Math.max(0, Math.min(100, Math.round(info.percent)))
      : 0;
    this.publish({ ...this.value, progressPercent: percent });
  }

  private handleDownloaded(info: UpdateInfo): void {
    const version = safeVersion(info.version);
    if (
      !version ||
      version !== this.expectedDownloadVersion ||
      !isStrictlyNewerStableVersion(version, this.options.currentVersion)
    ) {
      this.handleFailure();
      return;
    }
    this.expectedDownloadVersion = null;
    this.downloadedVersion = version;
    this.publish(status('downloaded', this.options.currentVersion, { availableVersion: version }));
  }

  private handleFailure(): void {
    this.expectedDownloadVersion = null;
    this.downloadedVersion = null;
    this.publish(status('error', this.options.currentVersion));
  }

  private publish(next: DesktopUpdateStatus): void {
    if (this.disposed) return;
    this.value = next;
    try {
      this.options.onStatus?.(this.getStatus());
    } catch {
      // A presentation callback cannot break update verification or download.
    }
  }
}
