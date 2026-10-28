### Added

- Graded permissions per agent, in Settings, Safety and limits. Each action has a risk level: low, medium or high. A medium or high action asks for your approval. Both levels ask by default. Turn either one off for an agent to let its actions of that level run without a card.
- Budgets per work thread and per agent per day. Set a limit for tokens, minutes or estimated cost. An agent stops at a limit, keeps its queue and waits until you raise the limit or the day changes. Usage per agent and per work thread is in the same settings tab.
- An audit log of autonomous actions: approvals that a rule answered, approvals that waited for you, budget stops, Stop all agents, and changes of a rule or a budget. Secrets in a command are masked. Filter it by agent, risk or action.
- A Stop all agents switch in the sidebar header. It stops every running turn and holds every queue on this computer until you choose Resume agents. The stop stays on after a restart.

### Changed

- Agents with Ask first no longer ask for low-risk actions: read, run tests, make a branch, and push to a branch that OpenBot made for a work thread. Medium and high risk actions still ask. A Workspace only agent still asks for every approval.
- A command that OpenBot does not recognise is high risk. It asks by default, like every high risk action.
