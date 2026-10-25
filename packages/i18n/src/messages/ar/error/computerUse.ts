import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/computerUse";

export const messages = {
  "error.computerUse.noAppToDrag": "نسخة OpenBot دي مفيهاش تطبيق يتسحب.",
  "error.computerUse.helpWindowChanged": "نافذة مساعدة الأذونات اتغيّرت قبل ما السحب يبدأ.",
  "error.computerUse.noAppToShow": "نسخة OpenBot دي مفيهاش تطبيق يتعرض.",
  "error.computerUse.noDriver": "الجهاز ده مفيهوش driver لاستخدام الكمبيوتر.",
  "error.computerUse.socketPathTooLong": "مسار socket استخدام الكمبيوتر {length} حرف، والنظام ده بيسمح بـ {limit}.",
  "error.computerUse.socketDirectoryNotDirectory": "مسار socket استخدام الكمبيوتر {path} مش فولدر.",
  "error.computerUse.socketDirectoryOtherOwner": "فولدر socket استخدام الكمبيوتر {path} تابع لمستخدم تاني.",
  "error.computerUse.socketDirectoryShared": "فولدر socket استخدام الكمبيوتر {path} مفتوح لمستخدمين تانيين.",
  "error.computerUse.socketNotReady": "ماقبلش اتصال في {seconds} ثانية. {reason}",
} as const satisfies PartialTranslation<typeof source>;
