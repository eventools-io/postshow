# postshow

The CLI for [Postshow](https://postshow.io), the customer-intelligence teammate by [eventools](https://eventools.io). It watches your product sessions, reads your revenue and error data, and hands you a queue of ready-to-send actions.

MIT licensed. The CLI, the local runtime, and the MCP server are open source; the hosted cloud runtime is a paid service.

## Setup

```sh
npx postshow init
```

The wizard detects your stack (PostHog, Stripe, Postgres, Sentry, GitHub, Linear, Resend, Slack) from the working directory, verifies each connector and engine credential you choose before saving it, and configures your engine: your own API keys, local models through Ollama, or Postshow's hosted models on a paid plan.

Credentials never pass through a model. Connectors marked local-only keep their credentials on your machine. For a local-only run, gathered source data goes directly to the local or BYOK model you selected for inference; Postshow receives only the model's sanitized findings, not the raw connector records.

Postgres is always local-only. Setup asks for a connection string using a read-only database user and one explicit read-only `SELECT`; both stay in the OS credential store. A remote database must explicitly require TLS. The runtime executes the query in a read-only transaction with row, row-size, result-size, and time bounds. Its rows enter the evidence packet for the local or BYOK model selected on that device, so a remote BYOK provider receives them directly; only sanitized derived findings sync to Postshow.

## Commands

### Verify a workspace export

Save the NDJSON artifact and its integrity manifest from Settings, then verify the exact multipart
boundaries, each SHA-256, and the final `sha256-part-tree-v1` checksum locally:

```sh
postshow export verify postshow-workspace-….ndjson postshow-workspace-….ndjson.integrity.json
```

The command streams the artifact instead of loading it into memory. It fails closed on a renamed,
truncated, extended, modified, or concurrently changing artifact, an altered part boundary or hash,
and any unsupported manifest shape. The integrity manifest contains no signed download URL.

For independent implementations, hash each exact byte range declared by `parts[].byte_size` with
SHA-256. Then SHA-256 the UTF-8 lines `part_number:byte_size:sha256`, ordered by part number and
joined with `\n` without a trailing newline. That final digest is `artifact_checksum`.

```sh
postshow run              # execute due local jobs once
postshow watch            # keep executing them on a heartbeat, with catch-up
postshow inbox            # review drafted actions
postshow inbox review 1a2b3c4d  # authenticated web preview; CLI never executes it
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

Tools: `workspace-status`, `list-inbox`, `review-action-in-web`, `skip-action`, `list-accounts`, `list-field-notes`, `list-jobs`, `list-runs`, `run-local-jobs`, `get-scratchpad`.

## Configuration

Non-secret profile settings live at `~/.postshow/config.json` (directory mode 700,
file mode 600). Access tokens, model-provider keys, and connector credentials are
stored as separate randomly named entries in macOS Keychain or Windows Credential
Manager; the JSON profile contains references only. An existing plaintext version
1 profile is migrated transactionally on first load: every OS credential entry is
written before the profile is atomically replaced. If any write fails, the original
profile stays byte-for-byte intact.

Environment overrides: `POSTSHOW_TOKEN`, `POSTSHOW_API_URL`,
`POSTSHOW_CONFIG_DIR`. For a noninteractive runner or OS-store recovery, inject
`POSTSHOW_CREDENTIALS_JSON` through the process manager or CI secret store. Do not
place it directly in shell history. Its shape is:

```json
{
  "token": "<workspace-access-token>",
  "keys": { "anthropic": "<provider-key>" },
  "connectors": { "stripe": { "api_key": "<restricted-key>" } }
}
```

When a saved profile references credentials, the environment bundle must provide
every referenced token, provider key, and connector entry. Partial recovery fails
closed. Values and remote error bodies are never included in configuration or
gateway error messages.

## Support and security

For public CLI bugs, follow the repository's
[support guide](https://github.com/eventools-io/postshow/blob/main/SUPPORT.md). Report
security vulnerabilities privately through the
[security policy](https://github.com/eventools-io/postshow/security/policy), never in
a public issue.
