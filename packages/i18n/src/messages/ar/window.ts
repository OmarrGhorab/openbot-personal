import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  "window.localHostTitle": "الجهاز المضيف المحلي لـ OpenBot",
  "window.localClientTitle": "العميل المحلي لـ OpenBot",
  "window.computerUsePermissionTitle": "تشغيل استخدام الكمبيوتر",
  "window.recover.crashedTitle": "الشباك وقف",
  "window.recover.crashedDetail": "وقف كذا مرة ورا بعض، غالبًا عشان الميموري خلصت. الإيجنتس لسه شغالين.",
  "window.recover.hungTitle": "الشباك مش بيرد",
  "window.recover.hungDetail": "اعمل له ريلود، أو استنى لحد ما يرد. الإيجنتس لسه شغالين.",
  "window.recover.reload": "ريلود",
  "window.recover.wait": "استنى",
} as const satisfies PartialTranslation<typeof source>;
