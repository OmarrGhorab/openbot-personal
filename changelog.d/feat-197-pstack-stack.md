### Added

- Autopilot can run a ticket with pstack and one playbook. A Bug with a failing case now runs
  `pstack · tdd`: a Builder writes the failing test first and fixes the root cause, and a Reviewer
  checks the commit. A pstack job shows its two roles, not the four Raven roles.
- The ticket card shows the stack of its Autopilot job in a pill, such as "pstack · tdd".
- A missing pstack skill is never silent. When `pstack-tdd` is not installed, Autopilot lite runs the
  ticket, and the decision and a note on the ticket say so and tell you to install pstack from Skills.
  A Builder that cannot find the playbook skill stops and asks you.
