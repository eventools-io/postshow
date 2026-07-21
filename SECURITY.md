# Security policy

Postshow handles customer data, connector credentials, model-provider credentials,
and human-approved outbound actions. Please report security issues privately so we
can investigate them without exposing users.

## Supported surfaces

Postshow has not yet published a supported open-source binary or npm release from
this repository. Until the first release, we accept reports that affect the current
`main` branch, the hosted Postshow service, or an official pre-release build supplied
by Eventools.

After releases begin, the latest supported release and the current `main` branch
will receive security fixes. Development snapshots, forks, and self-managed systems
that Eventools does not operate are not supported services, but we still welcome
reports about vulnerabilities in code maintained in this repository.

## Report a vulnerability

Email [security@eventools.io](mailto:security@eventools.io) with the subject
`Postshow security report`. Do not open a public GitHub issue.

Include as much of the following as you can safely provide:

- affected URL, component, package version, release identifier, or commit SHA;
- prerequisites and a minimal, repeatable proof of concept;
- expected and observed behavior;
- security impact, including whether another tenant or account may be affected;
- relevant logs or screenshots after removing credentials, personal data, and
  customer content; and
- a safe way to contact you about validation and disclosure.

Never email passwords, API keys, session tokens, database contents, or private
customer records. Ask for a secure transfer method before sending sensitive
artifacts that are essential to the report.

Our operating target is to acknowledge a complete report within three business
days and provide an initial assessment within ten business days. These are targets,
not contractual service levels. Remediation timing depends on severity, affected
systems, and safe rollout requirements. If you do not receive an acknowledgement,
resend the report to the same address and note the original date.

Eventools does not currently operate a public bug-bounty program. This policy does
not promise payment or other compensation.

## Authorized research

You may inspect this repository and test a local environment, account, workspace,
data, connectors, and recipients that you own under this policy. Before testing an
Eventools-operated production system, email
[security@eventools.io](mailto:security@eventools.io) with the proposed scope,
method, timing, and source addresses, and wait for written authorization. Approval
is limited to the scope and period in that response.

Authorized research must follow all of these rules:

- use only systems, accounts, workspaces, data, connectors, and recipients covered
  by this policy or by the written authorization;
- keep requests low volume and stop as soon as you have enough evidence to report
  the issue;
- avoid changing, deleting, exporting, or retaining data beyond the minimum needed
  to demonstrate the vulnerability;
- do not access another user's or tenant's data beyond the minimum accidental
  access needed to establish that a boundary failed;
- do not use denial of service, resource exhaustion, spam, social engineering,
  phishing, physical attacks, malware, persistence, or credential theft;
- do not test third-party providers or infrastructure that Eventools does not own;
- do not run automated scanners against production without advance written
  authorization from Eventools; and
- comply with applicable law and coordinate disclosure with Eventools.

If you unexpectedly encounter credentials, personal data, or another tenant's
content, stop testing, do not copy or share it, and report the exposure immediately.
Delete any retained sensitive data after Eventools confirms that it is no longer
needed for validation.

Testing outside these boundaries is not authorized. Neither this policy nor an
Eventools production-test approval authorizes testing of Stripe, Supabase, Netlify,
model providers, connector providers, email providers, or any other third-party
service.

## Disclosure coordination

Give Eventools a reasonable opportunity to validate and remediate a report before
public disclosure. The default coordination window is up to 90 days after Eventools
confirms the vulnerability, shortened when active exploitation creates urgent user
risk or extended by mutual agreement. We will credit reporters who request credit
and will coordinate a CVE when one is appropriate.

## Scope of this policy

This policy is the published vulnerability disclosure instruction referenced by
the Postshow Terms. Product support, account help, billing questions, and ordinary
bugs belong in [SUPPORT.md](SUPPORT.md), not the security mailbox.
