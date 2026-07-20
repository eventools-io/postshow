# postshow

The CLI for [Postshow](https://postshow.io), the customer-intelligence teammate by [eventools](https://eventools.io). It watches your product sessions, reads your revenue and error data, and hands you a queue of ready-to-send actions.

MIT licensed. The CLI, the local runtime, and the MCP server are open source; the hosted cloud runtime is a paid service.

## Setup

```sh
npx postshow init
```

The wizard detects your stack (PostHog, Stripe, Sentry, GitHub, Linear, Resend, Slack) from the working directory, verifies every credential before saving it, and configures your engine: your own API keys, local models through Ollama, or Postshow's hosted models on a paid plan.

Credentials never pass through a model. Connectors marked local-only keep their credentials on your machine; only derived findings sync to your workspace.

## Commands

```sh
postshow run              # execute due local jobs once
postshow watch            # keep executing them on a heartbeat, with catch-up
postshow inbox            # review drafted actions
postshow inbox approve 1a2b3c4d
postshow status           # plan, usage, and the agent's work plan
postshow doctor           # diagnose the local setup
postshow mcp              # serve workspace tools over MCP (stdio)
```

## MCP

Give your coding agent access to the workspace:

```json
{
  "mcpServers": {
    "postshow": {
      "command": "npx",
      "args": ["-y", "postshow", "mcp"]
    }
  }
}
```

Tools: `workspace-status`, `list-inbox`, `approve-action`, `skip-action`, `list-accounts`, `list-field-notes`, `list-jobs`, `list-runs`, `run-local-jobs`, `get-scratchpad`.

## Configuration

The profile lives at `~/.postshow/config.json` (chmod 600). Environment overrides: `POSTSHOW_TOKEN`, `POSTSHOW_API_URL`, `POSTSHOW_CONFIG_DIR`.
