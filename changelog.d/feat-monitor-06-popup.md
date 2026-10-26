### Added

- A click on an agent in the Monitor (canvas card, sidebar row or Tasks row) opens the agent popup: the agent's status, role and provider, what it does now (task, text, step n of m, start time and progress), its last five tool calls with the running one highlighted, and the agents it talks to with message counts. An idle agent shows "No task". Esc, the close button or a click on the dim layer closes it. Desktop and the web client.
- **Open thread** in the popup opens the agent's thread. The thread then shows **Back to monitor**, which opens the Monitor again with the same channel and view.
- **Stop task** in the popup asks for confirmation first and says what stops and what stays in the workspace. An agent task stops with the existing task Stop; a channel task is held, and **Resume task** continues it. The agent keeps its workspace, thread and identity.
