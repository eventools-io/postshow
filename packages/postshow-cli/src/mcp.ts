// `postshow mcp` - the MCP server, stdio transport. Exposes the workspace to
// coding agents: read the inbox, accounts, field notes, and work plan; approve
// or skip drafted actions; trigger local runs. Auth is the same personal
// access token the CLI uses (config file or POSTSHOW_TOKEN).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { gateway } from './api';
import { loadConfig } from './config';
import { runOnce } from './commands/run';

function json(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

export async function runMcpServer(): Promise<number> {
  const config = loadConfig();
  if (!config.token) {
    process.stderr.write('postshow mcp: no access token; run `postshow init` first\n');
    return 1;
  }

  const server = new McpServer({ name: 'postshow', version: '0.1.0' });

  server.registerTool(
    'workspace-status',
    {
      title: 'Workspace status',
      description:
        'Postshow workspace overview: plan, month-to-date usage (sessions watched, deep dives), and identity.',
      annotations: { readOnlyHint: true },
    },
    async () => json(await gateway(config, 'workspace.get'))
  );

  server.registerTool(
    'list-inbox',
    {
      title: 'List inbox items',
      description:
        'Drafted actions awaiting a human decision: outreach emails, tickets, save plays, expansion flags. Each has evidence and an id usable with approve-action / skip-action.',
      inputSchema: {
        state: z.enum(['pending', 'approved', 'skipped']).optional().describe('default pending'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ state }) => json(await gateway(config, 'inbox.list', { state: state ?? 'pending' }))
  );

  server.registerTool(
    'approve-action',
    {
      title: 'Approve an inbox item',
      description:
        'Approve AND execute a drafted action (send the email, file the ticket, adopt the rule). Irreversible once sent; confirm with the human when in doubt.',
      inputSchema: { item_id: z.string().describe('inbox item id') },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ item_id }) => json(await gateway(config, 'inbox.approve', { item_id }))
  );

  server.registerTool(
    'skip-action',
    {
      title: 'Skip an inbox item',
      description: 'Decline a drafted action. The agent learns from skips.',
      inputSchema: { item_id: z.string() },
    },
    async ({ item_id }) => json(await gateway(config, 'inbox.skip', { item_id }))
  );

  server.registerTool(
    'list-accounts',
    {
      title: 'List account dossiers',
      description:
        'Customer accounts with status, MRR, health score, facts the watcher learned, and the recommended next move.',
      inputSchema: { limit: z.number().int().max(500).optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ limit }) => json(await gateway(config, 'accounts.list', { limit }))
  );

  server.registerTool(
    'list-field-notes',
    {
      title: 'List field notes',
      description:
        'What the session watcher observed: ranked friction with session counts and severity.',
      inputSchema: { limit: z.number().int().max(200).optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ limit }) => json(await gateway(config, 'notes.list', { limit }))
  );

  server.registerTool(
    'list-jobs',
    {
      title: 'List the work plan',
      description:
        'The agent-authored schedule: standing jobs, cadence, runtime (cloud or local), and proposals awaiting human approval.',
      annotations: { readOnlyHint: true },
    },
    async () => json(await gateway(config, 'jobs.list'))
  );

  server.registerTool(
    'list-runs',
    {
      title: 'List recent runs',
      description: 'Recent agent runs with summaries, engine used, and stats.',
      inputSchema: { limit: z.number().int().max(50).optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ limit }) => json(await gateway(config, 'runs.list', { limit }))
  );

  server.registerTool(
    'run-local-jobs',
    {
      title: 'Run due local jobs',
      description:
        'Execute any due local-runtime jobs on this machine now (gather, narrate, sync findings). Uses the locally configured engine and keys.',
      annotations: { readOnlyHint: false },
    },
    async () => {
      const code = await runOnce();
      return json({ ok: code === 0 });
    }
  );

  server.registerTool(
    'get-scratchpad',
    {
      title: 'Read the agent scratchpad',
      description:
        "The agent's durable working memory: baselines, known noise, addressed findings.",
      annotations: { readOnlyHint: true },
    },
    async () => json(await gateway(config, 'scratchpad.list'))
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Keep the process alive; the transport closes it when stdin ends.
  await new Promise(() => {});
  return 0;
}
