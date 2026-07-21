// OS-backed credential storage shared by the CLI and Electron desktop shell.
// @napi-rs/keyring maps this API to macOS Keychain, Windows Credential
// Manager, and Secret Service on supported Linux desktops. Loading is lazy so
// explicit environment-only operation does not require a native backend.

import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CREDENTIAL_SERVICE = 'io.postshow.credentials';

interface NativeEntry {
  getPassword(): string | null;
  setPassword(password: string): void;
  deletePassword(): boolean;
}

interface NativeKeyring {
  Entry: new (service: string, account: string) => NativeEntry;
}

export interface CredentialStore {
  get(account: string): string | null;
  set(account: string, value: string): void;
  delete(account: string): void;
}

export class CredentialStoreError extends Error {
  readonly code = 'POSTSHOW_CREDENTIAL_STORE_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'CredentialStoreError';
  }
}

function unavailable(action: 'read' | 'write' | 'delete'): CredentialStoreError {
  return new CredentialStoreError(
    `could not ${action} Postshow credentials in the OS credential store; unlock the system credential store and retry, or provide POSTSHOW_CREDENTIALS_JSON for this process`
  );
}

function nativeEntry(account: string, action: 'read' | 'write' | 'delete'): NativeEntry {
  try {
    const keyring = require('@napi-rs/keyring') as NativeKeyring;
    return new keyring.Entry(CREDENTIAL_SERVICE, account);
  } catch {
    throw unavailable(action);
  }
}

export function systemCredentialStore(): CredentialStore {
  return {
    get(account) {
      try {
        return nativeEntry(account, 'read').getPassword();
      } catch (error) {
        if (error instanceof CredentialStoreError) throw error;
        throw unavailable('read');
      }
    },
    set(account, value) {
      try {
        nativeEntry(account, 'write').setPassword(value);
      } catch (error) {
        if (error instanceof CredentialStoreError) {
          throw new CredentialStoreError(
            'could not write Postshow credentials in the OS credential store; unlock the system credential store and retry'
          );
        }
        throw unavailable('write');
      }
    },
    delete(account) {
      try {
        if (!nativeEntry(account, 'delete').deletePassword()) {
          throw unavailable('delete');
        }
      } catch (error) {
        if (error instanceof CredentialStoreError) throw unavailable('delete');
        throw unavailable('delete');
      }
    },
  };
}

/** Prove the active OS backend can complete the same write/read/delete cycle
 * configuration needs. The random value is not a real credential and cleanup
 * is mandatory; errors never include the account or value. */
export function verifyNativeCredentialStore(
  store: CredentialStore = systemCredentialStore()
): void {
  const account = `self-test-${randomUUID()}`;
  const value = randomUUID();
  let writeAttempted = false;
  let stored = false;
  let failure: unknown;
  try {
    writeAttempted = true;
    store.set(account, value);
    stored = true;
    if (store.get(account) !== value) {
      throw new CredentialStoreError('the OS credential store did not return its test credential');
    }
  } catch (error) {
    failure = error;
  }
  if (stored) {
    try {
      store.delete(account);
      if (store.get(account) !== null) {
        throw new CredentialStoreError(
          'the OS credential store did not remove its test credential'
        );
      }
    } catch (error) {
      failure ??= error;
    }
  } else if (writeAttempted) {
    // A native backend can report a write failure after committing it. Probe
    // the random account and remove any ambiguous residue before returning the
    // original sanitized failure.
    try {
      if (store.get(account) !== null) {
        store.delete(account);
        if (store.get(account) !== null) {
          throw new CredentialStoreError(
            'the OS credential store did not remove its test credential'
          );
        }
      }
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure) {
    if (failure instanceof CredentialStoreError) throw failure;
    throw new CredentialStoreError('the OS credential store self-test failed');
  }
}
