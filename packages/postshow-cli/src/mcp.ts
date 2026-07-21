// `postshow mcp` - the MCP server, stdio transport. Exposes the workspace to
// coding agents: read the inbox, accounts, field notes, and work plan; hand
// irreversible actions to the authenticated web app; skip drafted actions;
// trigger local runs. Auth is the same personal
// access token the CLI uses (config file or POSTSHOW_TOKEN).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { gateway } from './api';
import { loadConfig, type CliConfig } from './config';
import { runOnceDetailed } from './commands/run';
import { buildInboxReviewUrl, skipInboxItem } from './commands/inbox';

function json(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

const MCP_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function mcpReviewHandoff(config: Pick<CliConfig, 'workspaceId'>, itemId: string) {
  if (!MCP_UUID_RE.test(itemId)) throw new Error('a valid inbox item id is required');
  return {
    item_id: itemId,
    review_url: buildInboxReviewUrl(config.workspaceId, itemId),
    requires_authenticated_browser: true,
    executed: false,
  };
}

export function mcpSkipArgs(itemId: string, actionRevision: number) {
  if (!MCP_UUID_RE.test(itemId) || !Number.isSafeInteger(actionRevision) || actionRevision < 1) {
    throw new Error('a valid item id and exact positive action revision are required');
  }
  return { item_id: itemId, expected_revision: actionRevision };
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
        'Drafted actions awaiting a human decision. Each includes an id and action_revision usable with review-action-in-web or skip-action.',
      inputSchema: {
        state: z.enum(['pending', 'approved', 'skipped']).optional().describe('default pending'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ state }) => json(await gateway(config, 'inbox.list', { state: state ?? 'pending' }))
  );

  server.registerTool(
    'review-action-in-web',
    {
      title: 'Review an inbox item in Postshow',
      description:
        'Return a token-free URL for the authenticated Postshow web preview. The MCP server cannot execute irreversible actions.',
      inputSchema: { item_id: z.string().uuid().describe('inbox item id') },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ item_id }) => json(mcpReviewHandoff(config, item_id))
  );

  server.registerTool(
    'skip-action',
    {
      title: 'Skip an inbox item',
      description: 'Decline a drafted action. The agent learns from skips.',
      inputSchema: {
        item_id: z.string().uuid(),
        action_revision: z.number().int().positive().describe('exact revision from list-inbox'),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ item_id, action_revision }) => {
      const args = mcpSkipArgs(item_id, action_revision);
      return json(await skipInboxItem(config, args.item_id, args.expected_revision));
    }
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
      const summary = await runOnceDetailed(undefined, undefined, 'mcp');
      return { ...json(summary), isError: summary.exitCode !== 0 };
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
