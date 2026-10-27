### Changed

- An agent set to switch to a backup model without asking now moves a turn that already wrote text or ran a tool step. The backup model gets the partial answer and the tool steps as a handoff, so the work continues without repeating completed steps. Before, the error stopped the turn.
- A spent balance or quota now moves the turn to a backup model too, like a rate limit or an outage. A plan window that ends a turn after it wrote text moves the turn in the same way.

### Added

- The chat now says why a held message waits when no backup model is ready: no backup model is set, or every backup model is at its limit.
