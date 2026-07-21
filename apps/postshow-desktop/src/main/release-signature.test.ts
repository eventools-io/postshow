import { describe, expect, it, vi } from 'vitest';
import { isTrustedReleaseBuild, type CommandRunner } from './release-signature';

describe('isTrustedReleaseBuild', () => {
  it('requires a verified Developer ID signature and Gatekeeper acceptance on macOS', async () => {
    const run = vi.fn<CommandRunner>(async (executable, args) => {
      if (executable === '/usr/bin/codesign' && args.includes('--display')) {
        return {
          stdout: '',
          stderr:
            'Authority=Developer ID Application: Eventools (TEAM123456)\nTeamIdentifier=TEAM123456\n',
        };
      }
      return { stdout: '', stderr: '' };
    });

    await expect(
      isTrustedReleaseBuild('darwin', '/Applications/Postshow.app/Contents/MacOS/Postshow', run)
    ).resolves.toBe(true);
    expect(run).toHaveBeenCalledWith('/usr/sbin/spctl', [
      '--assess',
      '--type',
      'execute',
      '--verbose=2',
      '/Applications/Postshow.app',
    ]);
  });

  it('rejects ad-hoc, unsigned, unnotarized, and unsupported builds', async () => {
    const adHoc = vi.fn<CommandRunner>(async () => ({
      stdout: '',
      stderr: 'Signature=adhoc\nTeamIdentifier=not set\n',
    }));
    await expect(
      isTrustedReleaseBuild('darwin', '/Applications/Postshow.app/Contents/MacOS/Postshow', adHoc)
    ).resolves.toBe(false);

    const rejected = vi.fn<CommandRunner>(async () => {
      throw new Error('signature utility rejected the build');
    });
    await expect(
      isTrustedReleaseBuild(
        'darwin',
        '/Applications/Postshow.app/Contents/MacOS/Postshow',
        rejected
      )
    ).resolves.toBe(false);
    await expect(isTrustedReleaseBuild('linux', '/opt/Postshow', rejected)).resolves.toBe(false);
  });

  it('requires a valid Authenticode signer on Windows without shell interpolation', async () => {
    const run = vi.fn<CommandRunner>(async () => ({ stdout: 'VALID\r\n', stderr: '' }));
    await expect(
      isTrustedReleaseBuild('win32', "C:\\Apps\\O'Hare\\Postshow.exe", run, 'C:\\Windows')
    ).resolves.toBe(true);

    const [executable, args] = run.mock.calls[0]!;
    expect(executable).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(args).toContain('-NonInteractive');
    expect(args.at(-1)).toContain("O''Hare");
    expect(args.at(-1)).toContain('SignerCertificate');
  });

  it('refuses Windows verification without a canonical SystemRoot', async () => {
    const run = vi.fn<CommandRunner>();
    await expect(
      isTrustedReleaseBuild('win32', 'C:\\Apps\\Postshow.exe', run, 'C:\\Users\\Public')
    ).resolves.toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});
