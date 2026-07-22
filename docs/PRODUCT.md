# Postshow product direction

Postshow should own a customer problem from the first trustworthy signal to proof that the customer recovered.

The unit of work is a customer incident. A replay, error, account, ticket, or pull request may be part of that incident, but none of them is the product by itself.

## The promise

> Find the customer problems worth fixing. Show the receipts. Help fix them. Prove the customer recovered.

Postshow watches product behavior, identifies affected accounts, explains the likely cause, prepares the product and customer response, and checks whether the intervention worked. Evidence, approvals, attempts, failures, and outcomes remain attached to one durable incident.

## Who it is for

The initial customer is a founder-led or compact product and engineering team at a B2B SaaS company. The initial source stack is:

- PostHog for product behavior and replay evidence.
- Stripe for customer identity, subscription state, and current revenue exposure.
- GitHub for repository context and product work.
- Sentry as an optional source of technical failure evidence.

Postshow will add providers when a real customer incident needs them. Connector count is not a launch metric.

## The recovery loop

### 1. Observe

Gather bounded evidence from connected sources. Each collection records whether it was complete, sampled, partial, failed, or not gathered. A successful API request is collection context, not proof of an incident.

### 2. Form an incident

Group corroborating observations into one customer problem. Weak observations remain field notes unless they cross a documented incident threshold.

### 3. Identify impact

Connect product identities to customer and billing records through deterministic links. Ambiguous matches are quarantined rather than guessed. Revenue is shown as current exposure, never as saved revenue.

### 4. Evaluate the evidence

The incident ledger asks five questions:

1. Is the behavior grounded in exact product evidence?
2. Are affected accounts grounded in deterministic identity evidence?
3. Is there technical failure evidence when the incident calls for it?
4. Is the suspected code context grounded in an exact repository object?
5. Is there a measurable recovery check?

A versioned policy returns:

- `act`: enough evidence exists to place a proposed intervention in front of a person;
- `gather_more`: a named source is incomplete, and bounded collection could change the decision;
- `abstain`: collection is complete enough to judge, but the evidence is insufficient, contradictory, or outside Postshow's safe scope.

This decision never executes an intervention. A model may explain a hypothesis or propose an action, but it cannot certify its own evidence or set the policy result.

### 5. Propose the response

The incident may contain separate proposals for:

- product work, such as a GitHub issue, code plan, or draft pull request;
- customer work, such as an email, support reply, or customer-success task draft;
- internal work, such as an escalation or owner assignment;
- verification, including the cohort, measure, window, threshold, and guardrails.

Each consequential action has its own approve, edit, and skip control. Customer messages remain drafts. Pull requests remain drafts. Postshow does not merge, bypass branch protection, or force-push.

### 6. Verify recovery

After an intervention, Postshow runs the recovery check saved before the action. The result is `recovered`, `improving`, `unchanged`, `regressed`, or `inconclusive`.

Negative and inconclusive outcomes remain visible. A merged pull request is not a resolved customer problem.

## The incident dossier

The incident detail is the main product surface. It must answer:

1. What happened?
2. Which exact evidence supports that statement?
3. Which accounts are affected, and how certain is the match?
4. What current revenue exposure is associated with those accounts?
5. What is the likely product cause?
6. What does Postshow propose doing?
7. Who must approve each action?
8. What will count as recovery?
9. What happened after the action?

Evidence appears beside the claim it supports. Gaps and contradictions do not live in a hidden audit screen.

## Product laws

- The customer incident is the primary product object.
- Verified customer recovery is the product outcome.
- Exact evidence is more valuable than connector breadth.
- Evidence decisions are deterministic, versioned, and independent of model prose.
- Source availability does not satisfy an incident requirement.
- External writes use typed tools and require human approval.
- Customer messages are drafts only.
- Pull requests are drafts only and are never merged by Postshow.
- Local and hosted modes use the same incident and evidence semantics.
- The public core owns the shared truth contract.
- Negative and inconclusive results remain part of the record.

## What belongs in this repository

The open repository is a usable product and the canonical home of:

- incident, evidence, identity, intervention, and verification types;
- normalization and evidence-decision logic;
- connector adapters and contract fixtures;
- the CLI, MCP server, and local runtime;
- the reference incident-review experience;
- the security model and authorization invariants.

The managed service adds multi-tenant authentication, durable scheduling, managed credentials, billing, email delivery, and hosted execution. It pins an exact revision of the public core and does not maintain a separate evidence policy.

## What is out of scope

- A general autonomous coding agent.
- A replacement for analytics, error monitoring, billing, CRM, or support tools.
- Automatic merge or automatic customer communication.
- A generic shell or write dispatcher.
- A connector marketplace before review and trust infrastructure exists.
- Broad enterprise customization before the initial customer loop works.
- Causal saved-revenue claims without an experiment that supports them.
- A dashboard whose main output is more findings.

## How we judge the product

The north star is verified customer problems resolved per active workspace.

A verified resolution needs a grounded incident, an approved intervention or documented external action, a recovery contract saved before that action, and an observed `recovered` result.

The first product test is smaller and more important: can Postshow find a real customer problem earlier than the team would have, show evidence the team trusts, and save enough investigation time that they want it to keep watching?

Read the [public roadmap](ROADMAP.md) for the delivery order and [architecture guide](ARCHITECTURE.md) for package boundaries.
