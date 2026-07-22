# postshow

The CLI for [Postshow](https://postshow.io), the customer recovery agent being built by [eventools](https://eventools.io). It runs the local evidence path, exposes scoped customer incidents over MCP, and sends schema-validated findings to the human review surfaces.

MIT licensed. The CLI, the local runtime, and the MCP server are open source; the hosted cloud runtime is a paid service.

## Setup

The CLI requires a provisioned Postshow workspace, API URL, and workspace access token. This repository does not include a standalone workspace control plane.

```sh
git clone https://github.com/eventools-io/postshow.git
cd postshow
pnpm install
pnpm --filter postshow build
cd /absolute/path/to/your-product
node /absolute/path/to/postshow/packages/postshow-cli/dist/index.js init
```

Replace both placeholder paths for your machine. Run the final command from the product repository you want the wizard to inspect, not from the Postshow clone.

After the first supported npm release, the shorter entry point will be `npx postshow init`. Until then, build the CLI from `main` as shown above.

The command examples below use the future `postshow` binary name. In a source checkout, replace it with `node /absolute/path/to/postshow/packages/postshow-cli/dist/index.js`.

The wizard detects supported configuration in the working directory, verifies each connector and engine credential you choose before saving it, and configures your engine: your own API keys, local models through Ollama, or Postshow's hosted models on a paid plan.

Credentials never pass through a model. Connectors marked local-only keep their credentials on your machine. For a local-only run, gathered source data goes directly to the local or BYOK model you selected for inference; Postshow receives schema-validated derived output rather than raw connector records. That output can still contain account names, facts, evidence excerpts, and other customer context. It is not anonymized; source scoping and data minimization remain separate responsibilities.

Postgres is always local-only. Setup asks for a connection string using a read-only database user and one explicit read-only `SELECT`; both stay in the OS credential store. A remote database must explicitly require TLS. The runtime executes the query in a read-only transaction with row, row-size, result-size, and time bounds. Its rows enter the evidence packet for the local or BYOK model selected on that device, so a remote BYOK provider receives them directly; only schema-validated derived findings sync to Postshow, and those findings can still contain customer context.

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
      "command": "node",
      "args": ["/absolute/path/to/postshow/packages/postshow-cli/dist/index.js", "mcp"]
    }
  }
}
```

After the npm release, `"command": "npx"` with `"args": ["-y", "postshow", "mcp"]` will be the shorter equivalent.

Tools: `workspace-status`, `list-customer-incidents`, `get-customer-incident`, `list-inbox`, `review-action-in-web`, `skip-action`, `list-accounts`, `list-field-notes`, `list-jobs`, `list-runs`, `run-local-jobs`, `get-scratchpad`.

Those tools can return scoped workspace data, including incident replay evidence, account and revenue context, suspected product causes, verification plans, notes, inbox items, runs, and scratchpad content. Connect only a trusted MCP client. Its model provider and retention policy govern any data it receives. Tokens remain workspace-scoped; revoke the workspace token if a client or machine is no longer trusted.

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
