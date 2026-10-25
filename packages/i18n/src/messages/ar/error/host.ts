import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/host";

export const messages = {
  "error.host.iceServersMissing": "Remote Signal مادّاش سيرفرات ICE.",
  "error.host.keyRotationUnavailable": "السيرفر ده مش قادر يغيّر مفتاحه من غير خدمة الحسابات.",
  "error.host.keyRotationRefused": "خدمة الحسابات ماقبلتش مفتاح السيرفر الجديد. المفتاح الحالي فاضل شغّال.",
  "error.host.webRtcNotConfigured": "خدمة الجهاز المضيف بتاعة WebRTC مش متظبطة.",
  "error.host.runtimeNotInstalled": "runtime السطح المكتب البعيد مش متثبّت.",
  "error.host.setupUnavailable": "إعداد الأذونات مش متاح.",
  "error.host.accountChangedDuringUpdate": "الحساب المسجّل دخوله اتغيّر وقت تحديث السيرفر ده.",
  "error.host.nameBeforePublish": "سمّي الـ OpenBot ده قبل ما تنشره.",
  "error.host.memberNotFound": "العضو البعيد مش موجود.",
  "error.host.publishBeforeInvite": "خلّي الـ OpenBot ده عام قبل ما تعمل دعوة.",
  "error.host.teamAccessUnavailable": "وصولك للفريق مش متاح.",
  "error.host.ownerIdentityUnavailable": "هوية مالك الجهاز المضيف مش متاحة.",
  "error.host.reserveAddressFailed": "معرفتش أحجز العنوان العام.",
  "error.host.publishFailed": "الـ OpenBot ده معرفش يتنشر.",
  "error.host.mobileConnectPublishFailed": "الـ OpenBot ده معرفش يتنشر لـ Mobile Connect.",
  "error.host.mobileConnectHostChanged": "الجهاز المضيف بتاع Mobile Connect اتغيّر. جرّب تاني.",
  "error.host.noServer": "الجهاز ده مفيهوش سيرفر يتغيّر.",
  "error.host.identityLocalOnly": "اسم السيرفر واللوجو ممكن يتغيّروا بس على الجهاز اللي شغّال عليه.",
  "error.host.timezoneInvalid": "المنطقة الزمنية دي مش معروفة.",
  "error.host.maintenanceInterrupted":
    "صيانة الجهاز المضيف اتقطعت. اتأكد من التطبيق وصفّر حالة الجهاز المضيف قبل ما تجرّب تاني.",
  "error.host.updateFailed":
    "تحديث الجهاز المضيف فشل أثناء {phase}. اتأكد من ملكية الـ bundle والتوقيع وحالة الـ tenant والمساحة الفاضية على القرص قبل ما تصفّر الحالة.",
  "error.host.tenantsNotIdle": "الـ tenants ماظلّوش خاملين لخمس دقايق خلال ساعتين.",
  "error.host.tenantShutdownTimeout": "قفل الـ tenant خد وقت أطول من اللازم. ماتبدأش أي استبدال للتطبيق.",
  "error.host.tenantHealthMissing":
    "تقارير صحة الـ tenant ناقصة أو مش سليمة بعد الـ restart. افحص جلسات الـ tenant قبل أي تحديث تاني.",
} as const satisfies PartialTranslation<typeof source>;
