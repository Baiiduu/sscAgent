---
name: security-report-drafting
description: Generate disclosure-aware upstream security report drafts only for project-level verified findings, after reading the target repository's security policy and submission requirements.
---

# Disclosure-Aware Security Report Drafting

Use this skill at the end of a repository security analysis only when upstream report generation is explicitly enabled.

This skill does not submit reports. It prepares human-reviewed drafts and tells the user which submission channel and form choices are recommended.

## Scope

Only generate an upstream submission draft for a finding that is verified against the target project's real code path.

A finding is eligible only when all of these are true:

- The finding has `poc_evaluated.data.status = verified`.
- The verification exercised the target repository's real entrypoint, API, CLI, dependency path, or runtime behavior.
- The report can explain expected behavior, actual behavior, impact, and reproduction without relying on private local artifacts.
- The report can be submitted responsibly through the target project's documented disclosure process.

Do not generate upstream submission drafts for:

- dependency security update only
- SCA/advisory/version maintenance without project-level exploitability
- likely impact
- blocked
- conceptual PoC
- simulated PoC
- not_triggered
- inconclusive
- unsafe_blocked
- not_affected
- findings without a concrete reproduction path

These skipped findings may remain in internal artifacts and Finding Console, but they must not become upstream report drafts.

## Required First Step: Disclosure Policy Discovery

Before writing any report draft, inspect the target repository's disclosure requirements.

Read local repository files first:

- `SECURITY.md`
- `.github/SECURITY.md`
- `.github/ISSUE_TEMPLATE/*`
- `.github/ISSUE_TEMPLATE/*.yml`
- `README*`
- `CONTRIBUTING*`
- documentation pages that mention security, vulnerability, disclosure, bug bounty, HackerOne, CVE, advisory, or private reporting

If local files do not contain enough information and internet access is available, inspect the repository's GitHub Security page and issue template pages.

Write the policy summary to:

```text
./artifacts/<repo-name>/report-drafts/disclosure-policy.md
./artifacts/<repo-name>/report-drafts/disclosure-policy.json
```

The policy summary must include:

- recommended submission channel
- whether public security issues are allowed
- whether private GitHub vulnerability reporting is required
- whether email, HackerOne, or another platform is required
- required fields
- forbidden public content
- expected response or disclosure timeline, if documented
- source files or URLs used
- confidence level: `high`, `medium`, or `low`

If policy confidence is `low`, put eligible drafts under `manual-review/` instead of guessing the channel.

## Submission Channels

Choose exactly one primary channel for each eligible verified finding:

```text
public-issue
private-github-advisory
email
hackerone
bug-bounty-platform
manual-review
```

Use the documented project policy over general assumptions.

If the project forbids public disclosure of unpatched vulnerabilities, do not generate a public issue draft for a verified vulnerability.

If the project explicitly allows public security issues, a public issue draft is allowed, but it must still avoid unnecessary weaponization.

## Output Layout

Write report drafts under:

```text
./artifacts/<repo-name>/report-drafts/
```

Use these subdirectories:

```text
public-issues/
private-advisories/
email-reports/
hackerone-reports/
bug-bounty-reports/
manual-review/
no-submit/
```

Each eligible finding should get its own directory:

```text
./artifacts/<repo-name>/report-drafts/<channel>/<finding-stable-key>/
```

Inside each finding directory, write:

```text
report.md
submission-guide.md
```

For skipped findings, write a short skip explanation to:

```text
./artifacts/<repo-name>/report-drafts/no-submit/<finding-stable-key>.md
```

Also write an overall summary:

```text
./artifacts/<repo-name>/report-drafts/submission-summary.md
```

## Report Draft Requirements

Every `report.md` must be self-contained. Do not ask maintainers to inspect this agent's SQLite database, Finding Console, local artifact directory, or internal JSON events.

Use only facts from the current analysis context. Do not invent:

- CVE, GHSA, OSV, CWE, or package identifiers
- affected versions
- fixed versions
- file paths or line numbers
- commands
- PoC output
- impact
- exploitability
- disclosure policy details

Required sections:

```markdown
# <concise title>

## Summary

## Affected component

## Verified reproduction

## Expected behavior

## Actual behavior

## Impact

## Evidence and reachability

## Suggested remediation

## Environment

## Disclosure notes
```

If the selected channel has a required template, match that template instead. Preserve the project's section names and fields when possible.

## Submission Guide Requirements

Every `submission-guide.md` must tell the human submitter what to choose without taking the action itself.

Include:

- selected channel
- reason for selected channel
- direct URL or repository location for submission, if known
- suggested title
- suggested severity, with rationale
- suggested affected component choices, if the project template uses choices
- suggested affected versions, if known
- suggested CWE/CVE/GHSA values, if known
- fields that require human confirmation
- content that should not be pasted publicly
- whether full PoC details should be included in the chosen channel

If a form option is uncertain, say so explicitly and recommend manual review instead of guessing.

## Verification Standard

Do not treat these as verified project impact:

- a script that only simulates framework behavior
- a dependency version match without exercising the vulnerable behavior in the project
- a grep result showing that a package or API exists
- a generic upstream PoC not adapted to the project
- agent reasoning without tool-backed evidence

Valid verification examples include:

- a local request to the target project's route or API that triggers the vulnerable behavior
- a target project CLI invocation that triggers the vulnerable behavior
- a target project test or minimal harness importing the real project code path and proving the issue
- a dependency PoC wired through the target project's reachable function, parser, middleware, adapter, or sink

If verification is conceptual or simulated, put the finding in `no-submit/`.

## Safety Rules

- Do not include secrets, real credentials, private tokens, private addresses, or third-party targets.
- Do not include destructive commands.
- Do not include scanning, persistence, exfiltration, or third-party attack automation.
- For private channels, include enough PoC detail for maintainers to reproduce, but keep the reproduction local and bounded.
- For public channels, avoid unpatched exploit details unless the project explicitly permits public vulnerability issues and the content is non-weaponized.
- Clearly separate verified facts from inferred impact and remaining uncertainty.

## Final Check

Before finishing, ensure:

- disclosure policy was read and summarized
- only real project-level verified findings received report drafts
- every draft has a matching submission guide
- skipped findings have a skip reason
- the selected channel follows the target project's policy
- no draft overclaims project impact
- no draft relies on internal artifacts being available to maintainers
