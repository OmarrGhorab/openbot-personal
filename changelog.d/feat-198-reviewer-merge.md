### Added

- The Reviewer can merge the pull request itself when you turn on "Reviewer can merge" and the switch of
  the ticket type in the Autopilot tab. It is off by default. The merge method is squash by default.
- It merges only when all of these hold: the Reviewer said PASS on the head commit, Quality scored 10/10
  (when Quality is on the team), every CI check is green, and no new commit came after the verdict. GitHub
  also refuses the merge when the pull request head is not the commit that passed.
- A merged ticket moves to Done and shows "Merged by Reviewer". When a rule does not hold, the ticket stays
  in Needs review with a note that says why. A FAIL never merges.
- Turning the setting off stops the next merge at once: it is read again just before each merge.
