# Postshow

The customer-intelligence teammate, by [eventools](https://eventools.io). Postshow watches your product sessions, reads your revenue and error data, and hands you a queue of ready-to-send actions: outreach drafts, friction tickets, churn-save plays, expansion flags. Its only output is action a human approves.

Live at [postshow.io](https://postshow.io).

## Open core

Postshow is open core: the product is open source, the always-on cloud is the business.

MIT licensed (see LICENSE in each package):

- `apps/postshow` - this web app (marketing site + workspace UI)
- `apps/postshow-desktop` - the menu-bar desktop agent
- `packages/postshow-cli` - the `postshow` CLI, setup wizard, local runtime, and MCP server
- `packages/postshow-core` - the shared engine: model catalog, multi-provider calls, task classes, prompts, connector adapters

Proprietary (this monorepo's `supabase/` tree): the hosted cloud runtime, scheduler, billing, and gateway. The free product is fully usable without them through BYOK keys or local models.

These packages are staged for extraction to a public `eventools-io/postshow` repository; workspace boundaries and licenses are already drawn along that line.

## Plans

- **Free** - the full product with your own API keys or local models (Ollama). Desktop, CLI, MCP, workspace sync, on-demand runs. We are structurally incapable of a bait-and-switch here: the free tier costs us nothing in model spend, so it never needs to be killed.
- **Solo ($99/mo)** and **Team ($249/mo)** - the always-on cloud runtime plus hosted models, priced in sessions watched and deep dives, never tokens. Quotas are set so every tier is profitable on its own; over a budget the agent degrades gracefully instead of stopping or surprise-billing.
- **Enterprise** - volume, SSO, priority support for self-hosted and local-only deployments.

## Self-hosting

The honest version: you can, and for most teams the hosted tier is less work than running your own Supabase project plus a scheduler. If you want it anyway, the client surfaces above run against any Supabase project carrying the `postshow_*` migrations, with your own keys. We do not provide support or guarantees for self-hosted deployments; the MIT license is your insurance against vendor risk, not our deployment recommendation.

## Develop

```sh
pnpm dev:postshow          # web app on :5173
pnpm --filter @eventools/postshow test
pnpm --filter postshow build     # the CLI
```

The agent runtime lives in `supabase/functions/postshow-*` with shared logic generated from `packages/postshow-core` (`pnpm gen:postshow-core`).
