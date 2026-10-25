import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/vault";

export const messages = {
  "error.vault.unavailable": "الجهاز ده مفيهوش تخزين أسرار، فالـ Vault مش قادر يحفظ عناصر.",
  "error.vault.unreadable": "ملف الـ Vault مش ممكن يتقري. صفّر الـ Vault علشان تستخدمه تاني.",
  "error.vault.tooLarge": "الـ Vault مليان. امسح شوية عناصر، وبعدين جرّب تاني.",
  "error.vault.itemMissing": "العنصر ده مبقاش في الـ Vault.",
  "error.vault.valueTooLong": "فيه قيمة طويلة أوي.",
  "error.vault.websiteInvalid": "اكتب عنوان موقع HTTPS.",
  "error.vault.passwordRequired": "اكتب باسورد.",
  "error.vault.cardNumberInvalid": "اكتب رقم كارت صالح.",
  "error.vault.securityCodeInvalid": "اكتب كود أمان من 3 أو 4 أرقام.",
  "error.vault.expiryInvalid": "اكتب شهر وسنة انتهاء صالحين.",
  "error.vault.contactEmpty": "اكتب اسم أو عنوان أو رقم تليفون أو إيميل.",
  "error.vault.contactMissing": "جهة اتصال الفواتير مبقتش في الـ Vault.",
  "error.vault.csvInvalid": "الملف ده مش تصدير باسوردات بصيغة CSV.",
  "error.vault.csvTooLarge": "ملف CSV كبير أوي.",
} as const satisfies PartialTranslation<typeof source>;
