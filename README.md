# Postshow

The customer-intelligence teammate, by [eventools](https://eventools.io). Postshow watches your product sessions, reads your revenue and error data, and hands you a queue of ready-to-send actions: outreach drafts, friction tickets, churn-save plays, expansion flags. Its only output is action a human approves.

Production home: [postshow.io](https://postshow.io).

## Open core

Postshow is open core: the product is open source, the always-on cloud is the business.

MIT licensed (see LICENSE in each package):

- `apps/postshow` - this web app (marketing site + workspace UI)
- `apps/postshow-desktop` - the menu-bar desktop agent
- `packages/postshow-cli` - the `postshow` CLI, setup wizard, local runtime, and MCP server
- `packages/postshow-core` - the shared engine: model catalog, multi-provider calls, task classes, prompts, connector adapters

Proprietary (separate private repo): the hosted cloud runtime, scheduler, billing, and gateway. The current Free plan avoids hosted-model charges by running inference through your BYOK keys or local models, while account, workspace, scheduling, and sync operations still use the Postshow service.

The hosted cloud runtime (Supabase migrations and edge functions, billing, scheduler) lives in a separate private repository and vendors this repo's engine core at a pinned ref.

## Plans

- **Free** - the current plan uses your own API keys or local models (Ollama) and includes desktop, CLI, MCP, workspace sync, and on-demand runs.
- **Solo ($99/mo)** and **Team ($249/mo)** - the always-on cloud runtime plus hosted models. Current self-service plans meter sessions watched and deep dives rather than tokens; over an included budget the agent reduces sampling or defers deep dives instead of surprise-billing.
- **Enterprise** - custom quotas and seats, metered-usage billing, and security and entitlement planning under an order form.

## Running the open components

This repository contains inspectable clients and the local runtime. It does not contain or package a supported one-command replacement for Postshow's hosted control plane. The MIT components can be used as building blocks for a service you design and operate, but you own its deployment, security, scheduling, billing, upgrades, and compatibility. Eventools does not support or warrant self-managed deployments unless a separate written agreement says otherwise.

## Develop

```sh
pnpm install
pnpm --filter @eventools/postshow dev    # web app on :5173
pnpm test                                # every package
pnpm build                               # web (with prerendered heads), cli, desktop
```

## Community, support, and security

- Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.
- Use [SUPPORT.md](SUPPORT.md) to choose between public issues and private product support.
- Report vulnerabilities privately through [SECURITY.md](SECURITY.md), never in a public issue.
- Participation follows [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
- Maintainers can run `pnpm governance:check` to verify repository policy, license, package, and workflow invariants offline.
