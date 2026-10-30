### Added

- An agent can take a ticket from a chat message. Write "take this ticket in jira fix it" with a Jira,
  Linear or GitHub link or key. The agent finds the ticket on the board, imports it from the connected
  ticket system, or adds it to Backlog, and Autopilot starts its job at once, also when Autopilot is off.
- A "Ticket taken" card shows in the chat: the type, the key and the title, the stack chosen and why, the
  model of each role, and a live checklist. It follows the job as it changes. "Open on the board" opens the
  Tickets board, and "Stop" stops the job and leaves the ticket in Needs review.
- When the ticket system is not connected, the agent asks you to connect it. Linear has no connection in
  OpenBot yet.
- You can keep chatting with the agent while the job runs. The card says when you get a merge notification.
