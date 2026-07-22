<p>
  <img src="assets/postshow-logo.svg" alt="Postshow" width="246">
</p>

Postshow is a customer recovery agent for B2B software teams. It is being built to own a customer problem from the first trustworthy signal to proof that the customer recovered.

[Website](https://postshow.io) · [Product direction](docs/PRODUCT.md) · [Roadmap](docs/ROADMAP.md) · [Contributing](CONTRIBUTING.md) · [Architecture](docs/ARCHITECTURE.md) · [Security](SECURITY.md) · [Support](SUPPORT.md)

## The product loop

```text
customer behavior → account and revenue impact → product cause
        → human-reviewed fix and follow-up → measured outcome
```

A Postshow customer incident keeps replay evidence, affected accounts, current revenue exposure, a policy-owned evidence ledger, a suspected product cause, proposed actions, and the recovery contract together. A model may propose a cause or action; it cannot mark its own evidence complete. Pull requests are one possible intervention, not the product by themselves. Customer messages remain drafts, code changes remain draft pull requests, and both require human approval.

The current foundation persists exact replay evidence, deterministic PostHog-to-Stripe account links, current revenue exposure, proposed actions, a recovery plan, and a reproducible `act`, `gather_more`, or `abstain` decision. Exact GitHub and Sentry references, automated intervention preparation, and measured outcomes are the next delivery slices.

Postshow is in closed beta. Provisioned workspaces can use the open clients and local runtime with their own model key or Ollama; the repository does not include a standalone workspace control plane. Managed cloud access remains gated while the complete recovery loop is tested on real customer incidents.

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

| Path                                               | What lives there                                                                     | Start here when…                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------- |
| [`packages/postshow-core`](packages/postshow-core) | Incident evidence, identity rules, decision policy, connectors, and model boundaries | Changing the shared product contract         |
| [`packages/postshow-cli`](packages/postshow-cli)   | CLI, local runtime, workspace setup, exports, and MCP server                         | Improving terminal or coding-agent workflows |
| [`apps/postshow`](apps/postshow)                   | Marketing site and authenticated web product                                         | Changing customer-facing web behavior        |
| [`apps/postshow-desktop`](apps/postshow-desktop)   | Desktop scheduler, credential access, diagnostics, and packaging                     | Changing local background execution          |

Start with [docs/PRODUCT.md](docs/PRODUCT.md) for product decisions, [docs/ROADMAP.md](docs/ROADMAP.md) for the delivery order, and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for package boundaries.

## Product laws

Contributions must preserve these invariants:

- Connector access is read-only unless a user explicitly approves a supported action.
- Credentials never enter model prompts.
- Local-only sources keep credentials and raw records off Postshow cloud.
- Source availability is not incident evidence; a connector record counts only after an exact reference is linked to the incident.
- Evidence decisions are deterministic, versioned, and independent of model prose.
- Customer communication stays a draft and never sends automatically.
- Generated code stays a draft pull request and never merges automatically.
- Evidence and affected-customer context must stay attached to consequential actions.
- Negative and inconclusive outcomes remain visible on the incident.

## Contributing

Issues and pull requests are welcome. A good first contribution is small enough to verify locally and comes with a regression test or a synthetic connector fixture where appropriate.

1. Search [existing issues](https://github.com/eventools-io/postshow/issues).
2. If no issue matches, [propose a focused change](https://github.com/eventools-io/postshow/issues/new?template=feature_request.yml) before starting a large contribution.
3. Follow [CONTRIBUTING.md](CONTRIBUTING.md).
4. Never include credentials, customer data, or private service logs in an issue or fixture.

Use [SUPPORT.md](SUPPORT.md) for hosted-product help and [SECURITY.md](SECURITY.md) for private vulnerability reports. Participation follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Open-core boundary

The incident and evidence contracts, connector engine, web app, desktop runtime, CLI, MCP server, and local runtime are MIT licensed. The supported multi-tenant control plane, always-on scheduler, managed secrets, billing system, and hosted execution are maintained separately. The managed product pins an exact revision of this public core and does not maintain a private alternate evidence policy. This repository does not promise a one-command clone of the managed service.

Each distributable package includes its own `LICENSE`. Maintainers can run `pnpm governance:check` to verify repository, package, workflow, and licensing invariants.
