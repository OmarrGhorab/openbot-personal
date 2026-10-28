### Added

- Agents check their own work. In agent settings, set a definition of done: the commands that must pass
  before the agent reports its work as done. Each command runs in the agent workspace, or in the git
  worktree of the task.
- When an agent reports a change as done, OpenBot runs the commands and shows each result in the chat.
  A failed command means the work is not done. The agent fixes the cause and checks again.
- Set a reviewer agent for each agent. The reviewer reads the change before the work counts as done.
  An agent runs at most three review rounds.
