import { defineMessages } from "../../message";

export const messages = defineMessages("monitor", {
  "monitor.agentStatus.working": "Working",
  "monitor.agentStatus.waiting": "Waiting",
  "monitor.agentStatus.error": "Error",
  "monitor.agentStatus.idle": "Idle",
  "monitor.toolStatus.running": "Running",
  "monitor.toolStatus.done": "Done",
  "monitor.toolStatus.failed": "Failed",
  "monitor.filter.allAgents": "All agents",
  "monitor.filter.allStatuses": "All statuses",
  "monitor.error.load": "The monitor could not read this channel.",
});
