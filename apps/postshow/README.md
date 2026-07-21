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

Proprietary (separate private repository): the hosted cloud runtime, scheduler, billing, and gateway. The free product is usable without hosted models through BYOK keys or local models.

## Plans

- **Free** - the current plan uses your own API keys or local models (Ollama) and includes desktop, CLI, MCP, workspace sync, and on-demand runs.
- **Solo ($99/mo)** and **Team ($249/mo)** - the always-on cloud runtime plus hosted models. Current self-service plans meter sessions watched and deep dives rather than tokens; over an included budget the agent reduces sampling or defers deep dives instead of surprise-billing.
- **Enterprise** - custom quotas and seats, metered-usage billing, and security and entitlement planning under an order form.

## Running the open components

This repository contains inspectable clients and the local runtime. It does not contain or package a supported one-command replacement for Postshow's hosted control plane. The MIT components can be used as building blocks for a service you design and operate, but you own its deployment, security, scheduling, billing, upgrades, and compatibility. Eventools does not support or warrant self-managed deployments unless a separate written agreement says otherwise.

## Develop

```sh
pnpm dev:postshow          # web app on :5173
pnpm --filter @eventools/postshow test
pnpm --filter postshow build     # the CLI
```

Supabase Auth requires email confirmation for new accounts. The waitlist calls
`VITE_POSTSHOW_WAITLIST_FUNCTION` when set and otherwise uses `postshow-waitlist`; its public Edge
endpoint applies keyed email/IP limits before the service-only database admission RPC.

The authenticated workspace-export client calls
`VITE_POSTSHOW_WORKSPACE_EXPORT_FUNCTION` when set and otherwise uses
`postshow-workspace-export`. It persists only replay-safe request references, streams the private
NDJSON artifact from an exact-project signed Storage URL, and never buffers the artifact or stores
the signed URL in the browser.

The managed agent runtime and database migrations live in the separate private cloud repository.
The open CLI and desktop runtime consume `packages/postshow-core` directly.
