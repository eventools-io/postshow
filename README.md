<p>
  <img src="assets/postshow-logo.svg" alt="Postshow" width="246">
</p>

Postshow is a customer-incident agent for B2B software teams. The current incident spine connects source-grounded product behavior to affected accounts and revenue, keeps proposed interventions beside the evidence, and records the verification plan. Automated product-fix preparation and measured post-intervention outcomes are the next part of the loop.

[Website](https://postshow.io) · [Contributing](CONTRIBUTING.md) · [Architecture](docs/ARCHITECTURE.md) · [Security](SECURITY.md) · [Support](SUPPORT.md)

## The product loop

```text
customer behavior → account and revenue impact → product cause
        → human-reviewed fix and follow-up → measured outcome
```

A Postshow customer incident keeps replay evidence, affected accounts, current revenue exposure, a suspected product cause, proposed actions, and the verification contract together. Pull requests are one possible intervention, not the product by themselves. Outbound messages and code changes always require human approval.

Postshow is in closed beta. Provisioned workspaces can use the open clients and local runtime with their own model key or Ollama; the repository does not yet provide a standalone workspace control plane. Managed cloud availability is gated while the complete incident-to-recovery loop is validated.

## Run the repository

Prerequisites: Node.js 24 and pnpm 10.

```sh
pnpm install
pnpm --filter @eventools/postshow dev   # web app at http://localhost:5173
pnpm --filter @eventools/postshow test  # web tests only
```

Before opening a pull request:

```sh
pnpm test
pnpm type-check
pnpm lint
pnpm build
pnpm format:check
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for scoped commands, contribution rules, and the pull-request path.

## Repository map

| Path                                               | What lives there                                                                      | Start here when…                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------- |
| [`packages/postshow-core`](packages/postshow-core) | Connector adapters, model execution, prompts, sanitization, schedules, and cost rules | Changing evidence gathering or agent behavior |
| [`packages/postshow-cli`](packages/postshow-cli)   | CLI, local runtime, workspace setup, exports, and MCP server                          | Improving terminal or coding-agent workflows  |
| [`apps/postshow`](apps/postshow)                   | Marketing site and authenticated web product                                          | Changing customer-facing web behavior         |
| [`apps/postshow-desktop`](apps/postshow-desktop)   | Desktop scheduler, credential access, diagnostics, and packaging                      | Changing local background execution           |

The architectural flow and cross-package contracts are documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Product laws

Contributions must preserve these invariants:

- Connector access is read-only unless a user explicitly approves a supported action.
- Credentials never enter model prompts.
- Local-only sources keep credentials and raw records off Postshow cloud.
- Customer communication never sends automatically.
- Generated code never merges automatically.
- Evidence and affected-customer context must stay attached to consequential actions.

## Contributing

Issues and pull requests are welcome. A good first contribution is small enough to verify locally and comes with a regression test or a synthetic connector fixture where appropriate.

1. Search [existing issues](https://github.com/eventools-io/postshow/issues).
2. If no issue matches, [propose a focused change](https://github.com/eventools-io/postshow/issues/new?template=feature_request.yml) before starting a large contribution.
3. Follow [CONTRIBUTING.md](CONTRIBUTING.md).
4. Never include credentials, customer data, or private service logs in an issue or fixture.

Use [SUPPORT.md](SUPPORT.md) for hosted-product help and [SECURITY.md](SECURITY.md) for private vulnerability reports. Participation follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Open-core boundary

The web app, desktop runtime, CLI, MCP server, and shared engine are MIT licensed. The supported always-on control plane, scheduler, billing system, and hosted model gateway are maintained separately. This repository provides inspectable clients and a local runtime; it does not promise a one-command clone of the managed service.

Each distributable package includes its own `LICENSE`. Maintainers can run `pnpm governance:check` to verify repository, package, workflow, and licensing invariants.
