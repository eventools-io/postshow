// Library surface for other Postshow frontends (the desktop app). The CLI
// and the desktop share one local profile (~/.postshow/config.json) and one
// local runtime, so setting up either sets up both.

export { loadConfig, saveConfig, configPath, configDir, defaultConfig } from './config';
export type { CliConfig, LocalConnector } from './config';
export { gateway, GatewayError } from './api';
export { runOnce } from './commands/run';
export { detectOllama } from './detect';
