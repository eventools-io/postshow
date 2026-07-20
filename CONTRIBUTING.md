# Contributing to Postshow

Thanks for wanting to make Postshow better. Issues, bug reports, and pull
requests are all welcome here.

## How this repo works right now

This repository is currently a generated export of the Postshow surfaces
from the eventools monorepo, where the hosted cloud runtime also lives.
Until development moves here at launch, that means one honest wrinkle:

- Open your PR here. CI runs here, review happens here, in the open.
- When a maintainer approves it, we apply the change upstream (preserving
  your authorship with a Co-authored-by trailer), run it through the full
  pipeline including the cloud runtime the public CI cannot see, and ship it.
- Your PR is closed with a link to the sync commit that carries your change,
  and the release notes credit you.
- If a sync lands while your PR is open, rebase on main and CI re-runs.

At launch, development moves to this repository and PRs merge directly.

## Ground rules

- By submitting a contribution you agree it is licensed under the MIT
  license of this repository.
- Conventional PR titles (type(scope): lowercase subject); CI enforces this.
- No em dashes in prose or comments; the unslop gate checks a set of
  writing and code tells on added lines.
- The agent's guardrails are product law: nothing sends without a human
  approve, connector reads stay read-only, credentials never pass through a
  model, and local-only stays local. PRs that weaken these will be declined
  regardless of code quality.

## Getting started

```sh
pnpm install
pnpm test          # unit tests across every package
pnpm type-check
pnpm build         # web app (with prerendered heads), cli, desktop shell
```

Good first areas: connector adapters (packages/postshow-core/src/adapters.ts),
the CLI wizard's stack detection (packages/postshow-cli/src/detect.ts), and
provider support in the engine catalog.
