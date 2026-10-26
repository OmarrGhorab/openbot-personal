import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/monitor";

export const messages = {
  "monitor.agentStatus.working": "شغال",
  "monitor.agentStatus.waiting": "مستني",
  "monitor.agentStatus.error": "فيه مشكلة",
  "monitor.agentStatus.idle": "فاضي",
  "monitor.toolStatus.running": "شغالة",
  "monitor.toolStatus.done": "خلصت",
  "monitor.toolStatus.failed": "فشلت",
  "monitor.filter.allAgents": "كل الإيجنتات",
  "monitor.filter.allStatuses": "كل الحالات",
  "monitor.error.load": "المراقبة معرفتش تقرا القناة دي.",
} as const satisfies PartialTranslation<typeof source>;
