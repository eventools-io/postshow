// Library surface for other Postshow frontends (the desktop app). The CLI
// and the desktop share one local profile (~/.postshow/config.json) and one
// local runtime, so setting up either sets up both.

import './http';
import {
  runOnce as runOnceCommand,
  runOnceDetailed as runOnceDetailedCommand,
} from './commands/run';
import type { RunSummary } from './commands/run';
import type { WorkerSurface } from './worker';

export { loadConfig, saveConfig, configPath, configDir, defaultConfig } from './config';
export type { CliConfig, LocalConnector } from './config';
export { gateway, GatewayError } from './api';
export type { JobRunPhase, JobRunResult, RunSummary, RunSummaryStatus } from './commands/run';
export type { WorkerSurface } from './worker';
export { detectOllama } from './detect';
export { verifyNativeCredentialStore } from './credentials';

// Keep test-only dependency injection on the command module; the public
// library contract is self-contained and does not leak private workspace types
// into the published declaration file.
export function runOnceDetailed(
  jobId?: string,
  surface: WorkerSurface = 'cli'
): Promise<RunSummary> {
  return runOnceDetailedCommand(jobId, undefined, surface);
}

export function runOnce(jobId?: string, surface: WorkerSurface = 'cli'): Promise<number> {
  return runOnceCommand(jobId, undefined, surface);
}
