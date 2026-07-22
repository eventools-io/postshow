import './http';
import { parseArgs } from 'node:util';
import { runInit } from './commands/init';
import { runOnce, runWatch } from './commands/run';
import { inboxList, inboxReview, inboxSkip } from './commands/inbox';
import { runDoctor, runStatus } from './commands/status';
import { runMcpServer } from './mcp';
import { runExportVerify } from './commands/export';

const HELP = `postshow - local evidence and review tools for Postshow (postshow.io)

Usage:
  postshow init                    Set up connectors, engine, and token
  postshow run [--job <id>]        Execute due local jobs once
  postshow watch [--every <min>]   Heartbeat: keep running due local jobs
  postshow inbox                   List drafted actions awaiting review
  postshow inbox review <id>       Continue in the authenticated web preview
  postshow inbox skip <id>         Skip a drafted action
  postshow status                  Workspace, plan, usage, and work plan
  postshow doctor                  Diagnose the local setup
  postshow export verify <ndjson> <manifest>
                                   Verify every export part and the artifact tree
  postshow mcp                     Serve workspace tools over MCP (stdio)

Environment:
  POSTSHOW_TOKEN, POSTSHOW_CREDENTIALS_JSON, POSTSHOW_API_URL, POSTSHOW_CONFIG_DIR`;

async function main(argv: string[]): Promise<number> {
  const command = argv[0];

  if (!command || command === 'help' || command === '--help') {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }

  if (command === 'init') return runInit();

  if (command === 'run') {
    const { values } = parseArgs({
      args: argv.slice(1),
      options: { job: { type: 'string' } },
      strict: false,
    });
    return runOnce(values.job as string | undefined);
  }

  if (command === 'watch') {
    const { values } = parseArgs({
      args: argv.slice(1),
      options: { every: { type: 'string' } },
      strict: false,
    });
    return runWatch(Number(values.every ?? 30));
  }

  if (command === 'inbox') {
    const sub = argv[1];
    if ((sub === 'review' || sub === 'approve') && argv[2]) return inboxReview(argv[2]);
    if (sub === 'skip' && argv[2]) return inboxSkip(argv[2]);
    return inboxList();
  }

  if (command === 'status') return runStatus();
  if (command === 'doctor') return runDoctor();
  if (command === 'export' && argv[1] === 'verify') return runExportVerify(argv.slice(2));
  if (command === 'mcp') return runMcpServer();

  process.stderr.write(`unknown command: ${command}\n\n${HELP}\n`);
  return 1;
}

main(process.argv.slice(2))
  .then((code) => {
    if (code !== 0) process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'unexpected error'}\n`);
    process.exitCode = 1;
  });
