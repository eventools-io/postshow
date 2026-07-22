# Contributing to Postshow

Postshow welcomes public bug reports, documentation improvements, tests, connector work, and product changes to the open clients and shared engine. The project is building one customer-incident loop from exact evidence to verified recovery.

Do not include credentials, customer data, private logs, or confidential hosted-service context in an issue, fixture, commit, or pull request. Use [SUPPORT.md](SUPPORT.md) for private product help and [SECURITY.md](SECURITY.md) for vulnerabilities.

## Before you start

- Search [open issues](https://github.com/eventools-io/postshow/issues) and pull requests.
- Read the [product direction](docs/PRODUCT.md) and [public roadmap](docs/ROADMAP.md) before proposing a new product surface.
- Comment on an issue before taking a large or user-visible change.
- If the issue queue is empty, open a focused contribution proposal and wait for maintainer confirmation before doing substantial work.
- Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before changing a shared contract.

A useful proposal explains the user problem, the intended outcome, and the privacy or approval boundaries. It does not need a complete technical design.

## Set up the repository

Prerequisites:

- Node.js 24
- pnpm 10.20.0, enabled through Corepack or installed directly
- Git

```sh
git clone https://github.com/eventools-io/postshow.git
cd postshow
pnpm install
pnpm test
```

No hosted Postshow credentials are required for the unit-test suite. Tests must use synthetic fixtures or fully scrubbed recordings from a maintainer-owned test account, never customer or production captures.

## Work on one surface

| Area          | Development command                                 | Test command                                     |
| ------------- | --------------------------------------------------- | ------------------------------------------------ |
| Shared engine | `pnpm --filter @eventools/postshow-core type-check` | `pnpm --filter @eventools/postshow-core test`    |
| CLI and MCP   | `pnpm --filter postshow build`                      | `pnpm --filter postshow test`                    |
| Web app       | `pnpm --filter @eventools/postshow dev`             | `pnpm --filter @eventools/postshow test`         |
| Desktop app   | `pnpm --filter @eventools/postshow-desktop build`   | `pnpm --filter @eventools/postshow-desktop test` |

Keep changes scoped. A connector change should not quietly restyle the web app; a documentation fix should not carry generated build output.

## Product and security rules

These are product contracts, not preferences:

- Connector reads remain least-scope and read-only by default.
- Credentials never enter prompts, logs, fixtures, or browser storage.
- Local-only sources keep credentials and raw records off Postshow cloud.
- Provider references must come from validated objects returned for the same workspace.
- Models may propose a hypothesis or action but cannot certify evidence or set the incident decision.
- Customer messages stay drafts and never send without a human action.
- Generated code stays in draft pull requests and never merges automatically.
- One connector failure must not fabricate evidence or erase healthy evidence from other sources.
- Negative and inconclusive outcomes remain visible on the incident.
- Unknown model prices and malformed usage data must fail accounting visibly.

Changes that touch authentication, credentials, tenancy, model routing, exports, connector data, or outbound actions need focused tests and an explicit security note in the pull request.

## Tests and fixtures

- Add a regression test for a bug fix.
- Use synthetic fixtures whenever possible. A recorded response is allowed only from a maintainer-owned test account after fully removing names, emails, identifiers, URLs, tokens, and provider payload fragments. Never record customer or production traffic.
- Connector tests should cover success, malformed provider data, timeout, rate limit, partial failure, and redaction where relevant.
- Test behavior through public package interfaces when possible.
- Do not update snapshots or expected output without explaining the behavioral change.

Run the full gate before requesting review:

```sh
pnpm test
pnpm type-check
pnpm lint
pnpm build
pnpm format:check
pnpm governance:check
git diff --check
```

CI also runs a pinned actionlint and ShellCheck pass over workflows, `pnpm audit --audit-level low`, a diff-aware prose and code quality check, and the conventional-title rule below. Those checks download their own pinned tools on GitHub-hosted runners; review their failure output if you do not reproduce them locally.

## Open a pull request

Use a conventional title with a lowercase subject, for example:

```text
fix(core): preserve partial connector evidence
docs: clarify local model setup
test(cli): cover expired workspace token
```

In the pull request:

1. Explain the user-visible problem and the chosen behavior.
2. Link the issue when one exists.
3. List the exact verification commands you ran.
4. Call out security, privacy, tenancy, migration, compatibility, licensing, and release impact.
5. Include screenshots for visible web or desktop changes.

Maintainers may ask to split a change when independent concerns need different review or release paths.

## How changes ship

This is the development repository for the open components. CI and review happen here, and accepted contributions merge with their original authorship.

The managed cloud runtime lives separately and pins an exact revision of `packages/postshow-core`. A core contribution reaches hosted Postshow when maintainers update and verify that pin. Contributors do not need access to the private runtime.

The public core owns the meaning of incident evidence, identity, decisions, interventions, and outcomes. The managed runtime may add tenancy, scheduling, secrets, billing, and delivery metadata, but it must not maintain a private alternate evidence policy.

By submitting a contribution, you agree that it is licensed under this repository's MIT license. Participation follows the [Code of Conduct](CODE_OF_CONDUCT.md).
