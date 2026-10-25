import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/remote";

export const messages = {
  "status.remote.setupMacOnly": "إعداد الأذونات متاح على macOS.",
  "status.remote.setupInstallHost": "ثبّت مكوّن الجهاز المضيف للسطح المكتب البعيد، وبعدين افحص تاني.",
  "status.remote.setupUpdateRuntime": "حدّث runtime السطح المكتب البعيد علشان تفحص أذونات macOS.",
  "status.remote.setupCheckFailed": "Sunshine معرفش يكمّل فحص الأذونات. اتأكد من جلسة الجهاز المضيف، وبعدين جرّب تاني.",
  "status.remote.setupServiceFailed":
    "خدمة السطح المكتب البعيد معرفتش تشتغل. اتأكد إن مستخدم macOS ده عنده جلسة واجهة رسومية شغّالة.",
  "status.remote.connectingSunshine": "بيتصل عن طريق Sunshine…",
  "status.remote.switchingMonitor": "بيبدّل الشاشة المشتركة…",
  "status.remote.controlConnected": "التحكم عن بُعد اتوصّل.",
  "status.remote.controlFailed": "التحكم عن بُعد فشل.",
  "status.remote.stagePreferences": "بيحمّل تفضيلات الشات المحلية: {reason}",
  "status.remote.stageConnection": "بيتصل بالكمبيوتر: {reason}",
  "status.remote.stageCompatibility": "بيفحص توافق الكمبيوتر: {reason}",
  "status.remote.stageAgents": "بيحمّل الإيجنتات: {reason}",
  "status.remote.stageReads": "بيحمّل حالة القراءة: {reason}",
  "status.remote.suspendedDetail": "حدّث OpenBot Mobile أو تطبيق سطح المكتب قبل ما تتصل.\n{detail}",
  "status.remote.cooldownDetail": "الاتصال فشل بعد {limit} محاولات. هيحاول تاني بعد {minutes}:{seconds}.\n{detail}",
  "status.remote.cooldown": "الاتصال فشل بعد {limit} محاولات. هيحاول تاني بعد {minutes}:{seconds}.",
  "status.remote.connectionLostDetail": {
    one: "الاتصال اتقطع. هيحاول تاني بعد {count} ثانية.\n{detail}",
    other: "الاتصال اتقطع. هيحاول تاني بعد {count} ثانية.\n{detail}",
  },
  "status.remote.connectionLost": {
    one: "الاتصال اتقطع. هيحاول تاني بعد {count} ثانية.",
    other: "الاتصال اتقطع. هيحاول تاني بعد {count} ثانية.",
  },
  "status.remote.attemptFailedDetail": {
    one: "محاولة الاتصال فشلت. هيحاول تاني بعد {count} ثانية.\n{detail}",
    other: "محاولة الاتصال فشلت. هيحاول تاني بعد {count} ثانية.\n{detail}",
  },
  "status.remote.attemptFailed": {
    one: "محاولة الاتصال فشلت. هيحاول تاني بعد {count} ثانية.",
    other: "محاولة الاتصال فشلت. هيحاول تاني بعد {count} ثانية.",
  },
  "status.remote.reconnectingDetail": {
    one: "بيعيد الاتصال {attempt}/{count}\n{detail}",
    other: "بيعيد الاتصال {attempt}/{count}\n{detail}",
  },
  "status.remote.reconnecting": { one: "بيعيد الاتصال {attempt}/{count}", other: "بيعيد الاتصال {attempt}/{count}" },
} as const satisfies PartialTranslation<typeof source>;
