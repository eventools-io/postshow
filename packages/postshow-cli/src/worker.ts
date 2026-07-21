import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { configDir } from './config';

export type WorkerSurface = 'cli' | 'watch' | 'desktop' | 'mcp';

const WORKER_ID = /^postshow-(cli|watch|desktop|mcp):[0-9a-f]{8}-[0-9a-f-]{27}$/i;
const STALE_WORKER_LOCK_MS = 24 * 60 * 60_000;

export class WorkerBusyError extends Error {
  constructor() {
    super('another Postshow worker for this surface is already running');
    this.name = 'WorkerBusyError';
  }
}

function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
}

/** Stable per-install, per-surface identity. A crashed worker can resume its
 * cloud claim, while CLI/watch/desktop/MCP never impersonate one another. */
export function localWorkerId(surface: WorkerSurface): string {
  const directory = configDir();
  const path = join(directory, `worker-${surface}.id`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);

  const read = (): string => {
    let value: string;
    try {
      value = readFileSync(path, 'utf8').trim();
    } catch {
      throw new Error('Postshow could not read its local worker identity');
    }
    if (!WORKER_ID.test(value) || !value.startsWith(`postshow-${surface}:`)) {
      throw new Error('Postshow local worker identity is invalid');
    }
    try {
      chmodSync(path, 0o600);
    } catch {
      // Windows permissions are enforced by the owning profile/credential ACL.
    }
    return value;
  };

  try {
    return read();
  } catch (error) {
    if (
      errorCode(error) !== 'ENOENT' &&
      !String((error as Error).message).includes('could not read')
    ) {
      throw error;
    }
  }

  const value = `postshow-${surface}:${randomUUID()}`;
  let descriptor: number | null = null;
  try {
    descriptor = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    writeFileSync(descriptor, `${value}\n`, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    return value;
  } catch (error) {
    if (descriptor !== null) {
      try {
        closeSync(descriptor);
      } catch {
        // Preserve the identity error.
      }
    }
    if (errorCode(error) === 'EEXIST') return read();
    throw new Error('Postshow could not create its local worker identity');
  }
}

function staleLockToken(path: string): string | null {
  try {
    const token = readFileSync(path, 'utf8').trim();
    const pid = Number(token.split(':', 1)[0]);
    if (!Number.isSafeInteger(pid) || pid <= 0) {
      return Date.now() - statSync(path).mtimeMs > STALE_WORKER_LOCK_MS ? token : null;
    }
    try {
      // Liveness takes precedence over wall-clock age. A healthy watch or
      // desktop process can legitimately retain this lock for days.
      process.kill(pid, 0);
      return null;
    } catch (error) {
      return errorCode(error) === 'ESRCH' ? token : null;
    }
  } catch {
    return null;
  }
}

/** Process-local exclusivity for one stable worker identity. Without this,
 * two watches sharing an ID can execute the same rehydrated cloud claim. */
export function acquireWorkerLock(surface: WorkerSurface): () => void {
  const directory = configDir();
  const path = join(directory, `.worker-${surface}.lock`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const token = `${process.pid}:${randomUUID()}`;

  let descriptor: number | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      descriptor = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      writeFileSync(descriptor, `${token}\n`, 'utf8');
      fsyncSync(descriptor);
      break;
    } catch (error) {
      if (errorCode(error) === 'EEXIST' && attempt === 0) {
        const stale = staleLockToken(path);
        if (stale !== null) {
          try {
            if (readFileSync(path, 'utf8').trim() === stale) rmSync(path, { force: true });
          } catch {
            // A concurrent owner won; the next attempt fails closed.
          }
          continue;
        }
      }
      throw new WorkerBusyError();
    }
  }
  if (descriptor === null) throw new WorkerBusyError();

  const lockedDescriptor = descriptor;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      closeSync(lockedDescriptor);
    } catch {
      // Lock-file cleanup remains best effort after work has stopped.
    }
    try {
      if (readFileSync(path, 'utf8').trim() === token) rmSync(path, { force: true });
    } catch {
      // Never remove a replacement lock.
    }
  };
}
