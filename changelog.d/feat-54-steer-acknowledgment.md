### Changed

- A message that you steer into a running turn gets a 👍 reaction from the agent once the provider takes it into the turn. Before, a steered message showed no sign that the agent had received it until the agent answered.
- The "Steer agents while they work" setting names the agents that can steer: ChatGPT, Claude, Grok, Pi, Muse and Inception. Other agents keep new messages in the queue.
- OpenCode, Antigravity, Cursor, Cline and custom ACP agents still queue a message sent while they work. They talk to OpenBot over the Agent Client Protocol, which has no request to add a message to a running turn (only `session/prompt` and `session/cancel`), and none of these CLIs offers an extension for it the way Grok offers `x.ai/interject`. Steering them would mean cancelling their turn, which loses the work in flight, so they wait for the turn to end instead.
