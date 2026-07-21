import './http';
import { parseArgs } from 'node:util';
import { runInit } from './commands/init';
import { runOnce, runWatch } from './commands/run';
import { inboxApprove, inboxList, inboxSkip } from './commands/inbox';
import { runDoctor, runStatus } from './commands/status';
import { runMcpServer } from './mcp';

const HELP = `postshow - the customer-intelligence teammate (postshow.io)

Usage:
  postshow init                    Set up connectors, engine, and token
  postshow run [--job <id>]        Execute due local jobs once
  postshow watch [--every <min>]   Heartbeat: keep running due local jobs
  postshow inbox                   List drafted actions awaiting review
  postshow inbox approve <id>      Approve and execute a drafted action
  postshow inbox skip <id>         Skip a drafted action
  postshow status                  Workspace, plan, usage, and work plan
  postshow doctor                  Diagnose the local setup
  postshow mcp                     Serve workspace tools over MCP (stdio)

Environment:
  POSTSHOW_TOKEN, POSTSHOW_API_URL, POSTSHOW_CONFIG_DIR`;

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
    if (sub === 'approve' && argv[2]) return inboxApprove(argv[2]);
    if (sub === 'skip' && argv[2]) return inboxSkip(argv[2]);
    return inboxList();
  }

  if (command === 'status') return runStatus();
  if (command === 'doctor') return runDoctor();
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
