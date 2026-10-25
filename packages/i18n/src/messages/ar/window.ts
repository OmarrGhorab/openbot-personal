import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  "window.localHostTitle": "الجهاز المضيف المحلي لـ OpenBot",
  "window.localClientTitle": "العميل المحلي لـ OpenBot",
  "window.computerUsePermissionTitle": "تشغيل استخدام الكمبيوتر",
} as const satisfies PartialTranslation<typeof source>;
