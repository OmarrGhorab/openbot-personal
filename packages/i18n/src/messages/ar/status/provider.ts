import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {
  "status.provider.downloadStopped": "التنزيل وقف. جرّب تاني.",
  "status.provider.downloadFailed": "التنزيل فشل. جرّب تاني.",
  "status.provider.updateWaiting": "التحديث هيبدأ لما الدور الحالي يخلص.",
  "status.provider.confirmContinue": "كمّل",
  "status.provider.confirmCancel": "إلغاء",
} as const satisfies PartialTranslation<typeof source>;
