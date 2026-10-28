### Added

- Questions list on the Tasks page. It shows each question that an agent waits on, from every agent and every task or chat on this computer, and you answer it there with the same card as in the chat.
- A task that waits for your answer says "Waiting for your answer" and moves to the "Needs you" section. It holds no turn slot while it waits, so another task of the agent can run.
- Two built-in agent skills: `ask-when-blocked` (when to ask you, and when to decide alone) and `confidence-notes` (the parts an agent is not sure about, listed at the end of a task).

### Changed

- Your answer goes to the task that asked. The task then continues in its own conversation.
