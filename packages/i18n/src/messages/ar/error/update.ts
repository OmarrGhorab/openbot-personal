import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/update";

export const messages = {
  "error.update.unsupported": "التحديثات متاحة في نسخ سطح المكتب المثبّتة.",
  "error.update.notReady": "التحديث لسه مش جاهز للتثبيت.",
  "error.update.restartFailed": "OpenBot معرفش يعمل restart علشان يثبّت التحديث.",
  "error.update.downloadStalled": "تنزيل التحديث وقف عن الاستجابة. جرّب تاني.",
  "error.update.installFailed": "معرفتش أثبّت التحديث. اقفل OpenBot وافتحه تاني، وبعدين جرّب تاني.",
  "error.update.downloadFailed": "معرفتش أنزّل التحديث. جرّب تاني.",
  "error.update.checkFailed": "معرفتش أدوّر على تحديثات. جرّب تاني.",
  "error.update.checkStalled": "البحث عن تحديثات وقف عن الاستجابة. جرّب تاني.",
  "error.update.checkOffline": "معرفتش أوصل لخدمة التحديثات. اتأكد من اتصال الإنترنت، وبعدين جرّب تاني.",
  "error.update.checkUnavailable": "خدمة التحديثات ماردّتش. OpenBot هيحاول تاني لوحده بعد كام دقيقة.",
  "error.update.checkNoRelease": "مفيش تحديث منشور للمنصة دي. OpenBot هيحاول تاني لوحده بعد كام دقيقة.",
  "error.update.managedByNix": "Nix هو اللي بيثبّت التحديثات لنسخة OpenBot دي. حدّثها بـ Nix.",
  "error.update.managedByHost":
    "التحديثات على الـ Mac ده بيثبّتها الجهاز المضيف. التحديث هيفضل جاهز لحد ما صيانة الجهاز المضيف تشتغل.",
  "error.update.siblingSession":
    "فيه جلسة OpenBot تانية لسه شغّالة من التطبيق ده. وقّف OpenBot في كل حساب مستخدم macOS تاني الأول، وبعدين ثبّت التحديث تاني.",
  "error.update.siblingSessionSameAccount":
    "فيه عملية OpenBot تانية لسه شغّالة في حساب المستخدم ده. اقفلها، وبعدين ثبّت التحديث تاني.",
  "error.update.siblingCheckFailed": "معرفتش أتأكد من جلسات OpenBot التانية. جرّب تاني قبل ما تثبّت.",
  "error.update.remoteDisabled": "التحديثات من أدمنز السيرفر مقفولة على الجهاز ده.",
  "error.update.restartStarted": "OpenBot بيعمل restart بالفعل علشان يثبّت التحديث.",
  "error.update.alreadyRestarting": "OpenBot بيعمل restart بالفعل.",
} as const satisfies PartialTranslation<typeof source>;
