import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/globalVoice";

export const messages = {
  "error.globalVoice.agentUnavailable": "الـ agent ده مش على الجهاز ده.",
} satisfies PartialTranslation<typeof source>;
