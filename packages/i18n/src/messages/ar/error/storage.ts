import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/storage";

export const messages = {
  "error.storage.unsupported": "التخزين مش مدعوم في السيرفر ده.",
  "error.storage.agentMissing": "الإيجنت مش موجود.",
  "error.storage.unreadableFile": "OpenBot مش قادر يقرا {path}. الملف تالف.",
} as const satisfies PartialTranslation<typeof source>;
