### Added

- An agent can watch a GitHub repository for open issues with a label. Set it in the agent settings, under Ticket source. For each new matching issue, the agent starts a work thread with the issue as its first message, and OpenBot comments on the issue with the work thread. An issue starts only once.
- The agent can record the pull request that it opens for a ticket. When pull request events reach the work thread, the thread stops after three failed checks in a row and asks you for the next step. Pull request events are not delivered from GitHub yet.
