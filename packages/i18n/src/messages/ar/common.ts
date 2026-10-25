import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/common";

export const messages = {
  "common.cancel": "إلغاء",
  "common.save": "حفظ",
  "common.close": "إغلاق",
  "common.delete": "حذف",
  "common.remove": "إزالة",
  "common.edit": "تعديل",
  "common.rename": "إعادة تسمية",
  "common.retry": "حاول تاني",
  "common.copy": "نسخ",
  "common.copied": "اتنسخ",
  "common.done": "تم",
  "common.back": "رجوع",
  "common.continue": "كمّل",
  "common.add": "إضافة",
  "common.create": "إنشاء",
  "common.open": "فتح",
  "common.search": "بحث",
  "common.loading": "جارٍ التحميل…",
  "common.saving": "جارٍ الحفظ…",
  "common.tryAgain": "حاول تاني",
  "common.connecting": "جارٍ الاتصال…",
  "common.download": "تنزيل",
  "common.removing": "جارٍ الإزالة…",
  "common.sending": "جارٍ الإرسال…",
} as const satisfies PartialTranslation<typeof source>;
