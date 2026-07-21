import { describe, expect, it, vi } from 'vitest';
import {
  CredentialStoreError,
  verifyNativeCredentialStore,
  type CredentialStore,
} from './credentials';

function memoryStore() {
  const values = new Map<string, string>();
  const store: CredentialStore = {
    set: vi.fn((account, value) => values.set(account, value)),
    get: vi.fn((account) => values.get(account) ?? null),
    delete: vi.fn((account) => {
      values.delete(account);
    }),
  };
  return { store, values };
}

describe('verifyNativeCredentialStore', () => {
  it('writes, reads, and removes a random non-credential value', () => {
    const test = memoryStore();

    expect(() => verifyNativeCredentialStore(test.store)).not.toThrow();

    expect(test.store.set).toHaveBeenCalledOnce();
    expect(test.store.get).toHaveBeenCalledTimes(2);
    expect(test.store.delete).toHaveBeenCalledOnce();
    expect(test.values.size).toBe(0);
  });

  it('attempts cleanup when readback is wrong and does not expose its random value', () => {
    const test = memoryStore();
    vi.mocked(test.store.get).mockReturnValueOnce(null);

    expect(() => verifyNativeCredentialStore(test.store)).toThrow(CredentialStoreError);
    expect(test.store.delete).toHaveBeenCalledOnce();
    expect(test.values.size).toBe(0);
  });

  it('removes ambiguous residue when a native write commits and then throws', () => {
    const test = memoryStore();
    vi.mocked(test.store.set).mockImplementationOnce((account, value) => {
      test.values.set(account, value);
      throw new Error('ambiguous native write failure');
    });

    expect(() => verifyNativeCredentialStore(test.store)).toThrow(
      'the OS credential store self-test failed'
    );
    expect(test.store.delete).toHaveBeenCalledOnce();
    expect(test.values.size).toBe(0);
  });

  it('reports mandatory cleanup failure', () => {
    const test = memoryStore();
    vi.mocked(test.store.delete).mockImplementationOnce(() => {
      throw new Error('backend cleanup failed');
    });

    expect(() => verifyNativeCredentialStore(test.store)).toThrow(
      'the OS credential store self-test failed'
    );
  });

  it('reports a credential that remains after deletion', () => {
    const test = memoryStore();
    vi.mocked(test.store.delete).mockImplementationOnce(() => undefined);

    expect(() => verifyNativeCredentialStore(test.store)).toThrow(
      'the OS credential store did not remove its test credential'
    );
    expect(test.store.get).toHaveBeenCalledTimes(2);
  });
});
