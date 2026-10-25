import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/attachment";

export const messages = {
  "attachment.openFile": "فتح الملف",
  "attachment.preview": "معاينة {name}",
  "attachment.notFound": "الملف مش موجود",
  "attachment.download": "تنزيل {name}",
  "attachment.open": "فتح {name}",
  "attachment.loadMedia": "تشغيل {name}",
  "attachment.previewUnavailable": "المعاينة مش متاحة.",
  "attachment.error.preview": "معرفتش أعرض معاينة {name}. حاول تاني.",
  "attachment.error.download": "معرفتش أنزّل المرفقات. حاول تاني.",
  "attachment.error.open": "معرفتش أفتح المرفق ده أو أحفظه. حاول تاني.",
  "attachment.error.openFile": "معرفتش أفتح الملف ده. حاول تاني.",
  "attachment.error.fileFallback": "ملف",
  "attachment.error.fileNotFound": "«{name}» مش موجود في المسار ده. ممكن يكون اتنقل أو اتحذف.",
  "attachment.error.previewFile": "معرفتش أعرض معاينة «{name}». حاول تاني.",
} as const satisfies PartialTranslation<typeof source>;
