import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/app";

export const messages = {
  "error.app.externalLinkProtocol": "روابط HTTP(S) بس هي اللي تتفتح في المتصفح الخارجي.",
  "error.app.notificationsUnsupported": "النظام ده مبيدعمش إشعارات سطح المكتب.",
  "error.app.notificationSettingsMissing": "النظام ده مفيهوش صفحة إعدادات الإشعارات.",
  "error.app.notReady": "OpenBot مش جاهز.",
  "error.app.macSecureStorageUnavailable": "التخزين الآمن في macOS مش متاح.",
  "error.app.secretStorageUnavailable": "تخزين الأسرار في النظام مش متاح.",
  "error.app.remoteIdentityUnavailable": "هوية الجهاز المضيف البعيد مش متاحة.",
  "error.app.iceServersMissing": "Remote Signal لسه مادّاش سيرفرات ICE.",
  "error.app.finishLocalTest": "خلّص الاختبار المحلي قبل ما تبدّل الشاشات.",
} as const satisfies PartialTranslation<typeof source>;
