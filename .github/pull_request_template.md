## What changed

<!-- Describe the user-visible and technical changes. -->

## Why

<!-- Link the issue and explain the problem this solves. -->

## Verification

<!-- List the exact commands and manual checks run. -->

## Safety and release impact

<!-- Describe security, privacy, tenancy, credential, migration, compatibility, and release impact. Write "none" only after checking each area. -->

- [ ] Connector access remains read-only unless the user explicitly approves a supported outbound action.
- [ ] Credentials and private source records do not enter model prompts or hosted paths that are not explicitly documented.
- [ ] Local-only and tenant boundaries remain intact.
- [ ] Human approval still gates every outbound action.
- [ ] New dependencies and redistributed assets have compatible licenses and preserved notices.
- [ ] Tests, documentation, and package metadata cover the changed behavior.
- [ ] The change contains no credentials, customer data, generated build output, or unrelated edits.
