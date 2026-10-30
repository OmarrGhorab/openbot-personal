### Added

- Autopilot now works the board. With Autopilot on, Raven takes the next ticket in Backlog when a slot
  is free (2 at once by default), picks the stack, the team and a model for each role from the ticket
  type and the size of the change, and keeps going until the review passes. The ticket then moves to
  Needs review with a note.
- The ticket shows why: the Autopilot decision on the ticket drawer names the type, the stack, the model
  of each role and the reason, and lists each model change after a failed round.
- A ticket whose type is not set and cannot be read from its text stays in Backlog with a note. Set its
  type and Autopilot takes it.
- When a job stops at the round limit, or a role needs you, the ticket gets a note that says so. A usage
  limit on an Autopilot job pauses new tickets until the provider allows work again.
- Jobs and their decisions survive a restart. Queued team jobs start again when OpenBot opens.
