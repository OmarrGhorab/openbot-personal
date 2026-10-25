import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/shared";

export const messages = {
  "mobile.shared.crop.choose": "اختيار",
  "mobile.shared.crop.label": "اقتصاص الصورة",
  "mobile.shared.crop.hint": "اسحب علشان تحرّك الصورة. قرّب صباعينك أو بعّدهم علشان تكبّرها أو تصغّرها.",
  "mobile.shared.splash.loading": "بنحمّل الحساب",
  "mobile.shared.photo.openFailed": "معرفناش نفتح الصورة دي. حاول تاني.",
  "mobile.shared.photo.tooLarge": "OpenBot معرفش يصغّر الصورة دي كفاية. اختار صورة أبسط.",
  "mobile.shared.save.changes": "حفظ التغييرات",
} as const satisfies PartialTranslation<typeof source>;
