import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/share";

export const messages = {
  "mobile.share.signInTitle": "سجّل دخول علشان تشارك",
  "mobile.share.signInDescription":
    "امسح رمز QR في OpenBot على الكمبيوتر بتاعك. بعد كده تقدر تختار الإيجنت اللي هيستلم اللي شاركته.",
  "mobile.share.reading": "بنقرا اللي شاركته…",
  "mobile.share.readFailed": "OpenBot معرفش يقرا اللي شاركته. شاركه تاني.",
  "mobile.share.content": "للمشاركة",
  "mobile.share.footer": "الشات هيتفتح وده مكتوب في خانة الرسالة. مش هيتبعت حاجة غير لما تبعتها إنت.",
  "mobile.share.lastUsed": "آخر استخدام",
  "mobile.share.noAgents": "مفيش إيجنتات",
  "mobile.share.chooseAgent": "اختار إيجنت",
  "mobile.share.action": "مشاركة مع {name}",
} as const satisfies PartialTranslation<typeof source>;
