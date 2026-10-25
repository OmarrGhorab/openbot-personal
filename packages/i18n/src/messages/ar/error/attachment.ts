import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/attachment";

export const messages = {
  "error.attachment.notFound": "المرفق مش موجود.",
  "error.attachment.fileTooLarge": "فيه ملف أكبر من حد 100 MB.",
  "error.attachment.totalTooLarge": "المرفقات أكبر من الحد الكلي 250 MB.",
  "error.attachment.unavailable": "الملف ده مبقاش متاح.",
  "error.attachment.tooMany": "اختار {limit} ملف على الأكتر.",
  "error.attachment.mediaUnsupported": "السيرفر ده مبيدعمش مرفقات MP3 أو MOV. حدّث OpenBot على الجهاز المضيف وجرّب تاني.",
  "error.attachment.emlUnsupported": "السيرفر ده مبيدعمش مرفقات EML. حدّث OpenBot على الجهاز المضيف وجرّب تاني.",
  "error.attachment.zipUnsupported": "السيرفر ده مبيدعمش مرفقات ZIP. حدّث OpenBot على الجهاز المضيف وجرّب تاني.",
  "error.attachment.previewTooLarge": "الملف أكبر من حد 100 MB.",
} as const satisfies PartialTranslation<typeof source>;
