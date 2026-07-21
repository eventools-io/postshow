import { execFile } from 'node:child_process';
import { dirname, win32 } from 'node:path';

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export type CommandRunner = (executable: string, args: string[]) => Promise<CommandResult>;

const SIGNATURE_CHECK_TIMEOUT_MS = 15_000;
const MAX_SIGNATURE_OUTPUT_BYTES = 128 * 1024;

const runCommand: CommandRunner = (executable, args) =>
  new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      {
        encoding: 'utf8',
        maxBuffer: MAX_SIGNATURE_OUTPUT_BYTES,
        timeout: SIGNATURE_CHECK_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) reject(error);
        else resolve({ stdout, stderr });
      }
    );
  });

function macAppBundle(executablePath: string): string {
  // /Applications/Postshow.app/Contents/MacOS/Postshow -> Postshow.app
  return dirname(dirname(dirname(executablePath)));
}

async function verifyMacSignature(executablePath: string, run: CommandRunner): Promise<boolean> {
  const bundle = macAppBundle(executablePath);
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', bundle]);
  const signature = await run('/usr/bin/codesign', ['--display', '--verbose=4', bundle]);
  const details = `${signature.stdout}\n${signature.stderr}`;
  const authority = details.match(/^Authority=(.+)\r?$/m)?.[1]?.trim();
  const teamIdentifier = details.match(/^TeamIdentifier=(.+)\r?$/m)?.[1]?.trim();
  if (
    !authority ||
    !teamIdentifier ||
    teamIdentifier === 'not set' ||
    /^Signature=adhoc\r?$/m.test(details)
  ) {
    return false;
  }

  // A successful release is both Developer-ID signed and accepted by
  // Gatekeeper. This also rejects local ad-hoc acceptance packages.
  await run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', bundle]);
  return true;
}

async function verifyWindowsSignature(
  executablePath: string,
  run: CommandRunner,
  systemRoot: string | undefined
): Promise<boolean> {
  const normalizedRoot = systemRoot?.replace(/[\\/]+$/, '');
  if (!normalizedRoot || !/^[A-Za-z]:\\Windows$/i.test(normalizedRoot)) return false;
  const powerShell = win32.join(
    normalizedRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  );
  const escapedPath = executablePath.replace(/'/g, "''");
  const script = [
    `$signature = Get-AuthenticodeSignature -LiteralPath '${escapedPath}'`,
    "if ($signature.Status -eq 'Valid' -and $null -ne $signature.SignerCertificate) { Write-Output 'VALID' } else { Write-Output 'INVALID'; exit 1 }",
  ].join('; ');
  const result = await run(powerShell, [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
  ]);
  return result.stdout.trim() === 'VALID';
}

/** Auto-update is deliberately unavailable unless this exact installed build
 * is a trusted production artifact. Downloaded updates receive the updater's
 * own platform signature verification as a second, independent gate. */
export async function isTrustedReleaseBuild(
  platform: NodeJS.Platform,
  executablePath: string,
  run: CommandRunner = runCommand,
  systemRoot: string | undefined = process.env.SystemRoot
): Promise<boolean> {
  try {
    if (platform === 'darwin') return await verifyMacSignature(executablePath, run);
    if (platform === 'win32') {
      return await verifyWindowsSignature(executablePath, run, systemRoot);
    }
    return false;
  } catch {
    return false;
  }
}
