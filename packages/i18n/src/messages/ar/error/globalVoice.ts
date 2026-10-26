import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/globalVoice";

export const messages = {
  "error.globalVoice.agentUnavailable": "الـ agent ده مش على الجهاز ده.",
  "error.globalVoice.sendTimedOut":
    "الإرسال بياخد وقت أطول من المتوقع. ممكن الرسالة لسه توصل، فاتأكد من الشات قبل ما تبعتها تاني.",
} satisfies PartialTranslation<typeof source>;
