import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/reference";

export const messages = {
  "error.reference.label": "الكود: {code}",
  "error.reference.copy": "نسخ كود الخطأ",
  "error.reference.copied": "كود الخطأ اتنسخ",
} as const satisfies PartialTranslation<typeof source>;
