# Contributing to Postshow

Thanks for wanting to make Postshow better. Issues, bug reports, and pull
requests are welcome here when they contain no credentials, customer data, or
private service context. Use [SUPPORT.md](SUPPORT.md) for private product help and
[SECURITY.md](SECURITY.md) for vulnerability reports.

## How contributions work

This is the real development repository. Open your PR here; CI runs here,
review happens here, and approved PRs merge here, with your commits and
authorship in the history like any other project.

The hosted cloud runtime lives in a separate private repository that vendors
this repo's engine core at a pinned ref, so a change to
packages/postshow-core ships to the hosted product when we bump that pin.
Nothing about your contribution flow depends on it.

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
pnpm governance:check
```

Good first areas: connector adapters (packages/postshow-core/src/adapters.ts),
the CLI wizard's stack detection (packages/postshow-cli/src/detect.ts), and
provider support in the engine catalog.

Participation in this repository follows
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). The pull-request template asks for exact
verification and explicit security, privacy, tenancy, licensing, and release-impact
notes; complete it rather than deleting the checklist.
