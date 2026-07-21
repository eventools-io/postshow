// Release acceptance executes this entry through the packaged Electron binary
// with ELECTRON_RUN_AS_NODE. It proves the exact bundled CLI/keyring path can
// write, read, and remove a random synthetic value in the native OS store.
// It is deliberately non-interactive and never prints backend error details.

import { verifyNativeCredentialStore } from 'postshow/lib';

try {
  verifyNativeCredentialStore();
  process.stdout.write('Postshow native credential-store self-test passed\n');
} catch {
  process.stderr.write('Postshow native credential-store self-test failed\n');
  process.exitCode = 1;
}
