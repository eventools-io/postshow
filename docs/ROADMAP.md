# Postshow public roadmap

Postshow is being built as a sequence of complete customer-incident slices. A slice is not done when its model prompt works. It must persist its contract, render in the incident dossier, behave the same in local and managed runs, and include provider-failure fixtures.

The product direction and closed decisions live in [PRODUCT.md](PRODUCT.md).

## Current foundation

The current open and managed products already support:

- full PostHog replay identifiers and safe deep links;
- deterministic PostHog-to-Stripe account identity;
- tenant-safe customer incidents with current revenue exposure;
- proposed actions and a saved verification plan;
- source collection states for complete, sampled, partial, failed, and not-gathered runs;
- a versioned `act`, `gather_more`, or `abstain` evidence decision;
- incident review through the web app and scoped MCP reads.

This foundation does not yet include exact incident-specific GitHub and Sentry references, automated patch preparation, customer-message delivery, or measured post-intervention outcomes.

## Slice 1: Exact technical and code evidence

Status: next

- Add source-owned references for exact Sentry issues and GitHub repository objects.
- Validate every reference against the workspace and collection window.
- Persist incident links and render safe provider links beside the requirement they satisfy.
- Reject fabricated, malformed, expired, and cross-workspace references in application and database validation.
- Complete GitHub and Sentry fixtures for success, partial data, timeout, rate limit, malformed data, and redaction.
- Reproduce the same evidence decision in local and managed incident commits.

Exit condition: a real incident changes from behavior-only `gather_more` to `act` or `abstain` because exact technical and code evidence was added, and the user can inspect every reference.

## Slice 2: Reviewable product intervention

Status: planned

- Add GitHub App installation and validated repository targets.
- Produce an evidence-backed GitHub issue before attempting a patch.
- Add bounded code-plan and draft-pull-request proposals.
- Enforce branch, path, file-count, line-count, and required-check policies.
- Record checkout, patch, test, revision, and failure states on the incident.
- Require human approval before each external write.

Exit condition: a design-partner incident produces a useful issue or draft pull request that an engineer approves, with no broad repository credential and no hidden failed checks.

## Slice 3: Customer response and recovery contract

Status: planned

- Add account-specific customer-response drafts.
- Keep product and customer approvals separate.
- Save a recovery contract before executing an intervention.
- Observe merge and deployment events without treating them as proof of recovery.
- Schedule the verification window.

Exit condition: the same incident contains approved product work, an accurate customer draft, and a fixed measurement plan.

## Slice 4: Verified outcome

Status: planned

- Run the saved verification query against the affected cohort.
- Render recovered, improving, unchanged, regressed, and inconclusive outcomes.
- Show the baseline, observed value, sample, window, and guardrails.
- Propose follow-up or revert work without executing it.
- Turn confirmed contract failures into regression fixtures.

Exit condition: a design-partner incident reaches a measured outcome without a person assembling the evidence manually.

## Slice 5: Closed-beta product

Status: planned

- Replace generic onboarding with a real-data backfill flow.
- Add fair, durable scheduling and visible connector degradation.
- Add opt-in delivery for changed incidents, waiting approvals, and outcomes.
- Instrument activation, incident quality, intervention quality, and outcomes.
- Publish support expectations and keep contribution paths current.

Exit condition: three to five design partners can use the complete loop without a terminal, and at least one reaches verified recovery.

## Contribution priorities

Good public contributions improve a contract that can be verified locally:

- connector failure fixtures and redaction;
- exact provider-reference normalization;
- incident and evidence boundary tests;
- accessibility and incident-review usability;
- CLI and MCP incident inspection;
- documentation and small reproducible bugs.

Large changes should begin with an issue. Read [CONTRIBUTING.md](../CONTRIBUTING.md) for setup, test commands, fixture rules, and the pull-request process.
