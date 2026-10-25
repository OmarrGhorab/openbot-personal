import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  "error.auth.serviceUnavailable": "OpenBot معرفش يوصل لخدمة الحسابات. اتأكد إن الـ API شغّال، وبعدين جرّب تاني.",
  "error.auth.networkBlocked":
    "firewall أو بروكسي على الشبكة دي منع OpenBot إنه يوصل لـ {host}. اطلب من مسؤول الشبكة يسمح بـ {host}، وبعدين جرّب تاني.",
  "error.auth.signInFirst": "سجّل دخول لـ OpenBot الأول.",
  "error.auth.signInRequired": "لازم تسجّل دخول.",
  "error.auth.accountChangedDuringRegister": "الحساب المسجّل دخوله اتغيّر وقت تسجيل السيرفر ده.",
  "error.auth.hostCredentialUnavailable": "بيانات اعتماد الجهاز المضيف البعيد مش متاحة. سجّل الجهاز المضيف تاني.",
  "error.auth.codeNotVerified": "كود تسجيل الدخول معرفتش أتأكد منه.",
  "error.auth.serviceError": "خدمة الحسابات رجّعت خطأ.",
  "error.auth.serviceUnreachable": "OpenBot معرفش يوصل لخدمة الحسابات. اتأكد من اتصالك، وبعدين جرّب تاني.",
  "error.auth.serviceTimeout": "خدمة الحسابات ماردّتش في الوقت المناسب. جرّب تاني.",
  "error.auth.serviceStatus": "خدمة الحسابات رجّعت خطأ ({status}). جرّب تاني بعدين.",
  "error.auth.invalidHostedServer": "خدمة الحسابات رجّعت سيرفر مستضاف مش صالح.",
  "error.auth.codeNotSent": "OpenBot معرفش يبعت كود تسجيل الدخول.",
  "error.auth.deliveryTimeout":
    "OpenBot معرفش يتأكد من التسليم في الوقت المناسب. ممكن الكود يوصل لسه؛ اتأكد من التسليم قبل ما تبعت تاني.",
  "error.auth.deliveryInterrupted":
    "الاتصال خلص قبل ما OpenBot يتأكد من التسليم. اتأكد من التسليم علشان ماتبعتش كود تاني.",
  "error.auth.deliveryUnknown":
    "OpenBot معرفش يتأكد إن كود تسجيل الدخول اتبعت ولا لأ. اتأكد من التسليم قبل ما تبعت تاني.",
} as const satisfies PartialTranslation<typeof source>;
