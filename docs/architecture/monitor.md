# Monitor

The Monitor shows what each agent of a channel does: its status, its task and tool calls, the messages
between agents, and the channel feed. It runs on this computer. It sends nothing to a server.

## Views

- **Canvas**: one card per agent, a line per pair of agents that exchanged messages. A line label opens
  the conversation drawer. The sidebar status filters (Working, Waiting, Errors) dim the cards and lines
  that do not match. A chip names the filter and clears it. A channel with no activity shows an empty
  state and an Idle pill.
- **Feed** and **Tasks**: the channel events and the agent tasks, with Pause feed and task filters.
- **All agents**: a grid of every agent, with status filters. A card opens the agent popup.
- **Agent popup**: the task, the newest tool calls, the agents it talks to, Stop, Pause and Resume, and
  Open thread. **View all** opens the tool calls of the task.
- **Conversation drawer**: the messages between two agents, read-only.
- **Ask an agent**: a panel that sends a question to the channel lead with a redacted snapshot.
- **Members**: the members popover, the add-agent dialog, and the new-channel dialog.

## Data

- The snapshot (`monitor:get-snapshot`) is built in main from the channel page, the agents, their tasks,
  the live turns and the mailbox. `buildMonitorSnapshot` in `packages/contracts` builds it. The web client
  builds the same snapshot from the host's Team API, without the mailbox.
- The conversation (`monitor:get-conversation`) lists the mailbox deliveries between two agents.
- Changes arrive as `monitor:changed` events. The views read the snapshot again.

## Redaction

Tool-call input and output, message text and errors are redacted before the Monitor shows them. The
snapshot and the conversation are redacted in main, before they reach a window. The ask panel redacts
the snapshot it sends. Tests: `src/main/ipc/monitor-handlers.test.ts`.

## Pause and Resume

Pause holds the queue of an agent task: the running turn ends normally, and the next queued message
waits until Resume. The thread, the workspace and the identity do not change. The hold is in memory and
clears on restart.

## Surfaces

Desktop renderer, the web client (the snapshot, tool calls, pause and resume are desktop-only where noted
in the code), and the preview mock in `src/renderer/src/preview/mock-monitor.ts`.

## Checks

`bun run test:monitor-e2e -- --allow-mutations` drives the empty state, the status filter and the ask panel
in the running dev app. The popup, canvas and feed scripts (`test:monitor-popup`, `test:monitor-canvas`,
`test:monitor-feed`) cover the earlier views.
