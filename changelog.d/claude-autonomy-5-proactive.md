### Added

- Start a coding routine from a template in an agent's routines. Each template schedules one job with
  one click: update dependencies (weekly), triage flaky tests (weekly), clean old TODOs (monthly) and
  triage stale issues (weekly). Each job tells the agent to work in the agent's repository and to
  open a draft pull request or a ticket. It needs a Git repository with a GitHub remote, and `gh`
  signed in on the computer. A run that the provider's plan limit blocks is skipped, not queued.

### Security

- A webhook event is redacted before the agent reads it. Secret patterns, such as a bearer token in
  a request header, no longer reach the agent or the routine run history.
