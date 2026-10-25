import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/computerUse";

export const messages = {
  "status.computerUse.driverNotStarted": "driver استخدام الكمبيوتر ماشتغلش. {reason}",
  "status.computerUse.driverStoppedBeforeAnswer": "driver استخدام الكمبيوتر وقف قبل ما يقدر يرد.",
  "status.computerUse.driverNoAnswer": "driver استخدام الكمبيوتر ماردّش. {reason}",
  "status.computerUse.driverStopped": "driver استخدام الكمبيوتر وقف.",
  "status.computerUse.unsupported": "استخدام الكمبيوتر متاح على macOS وWindows وLinux.",
  "status.computerUse.driverMissing": "نسخة OpenBot دي مفيهاش driver لاستخدام الكمبيوتر.",
  "status.computerUse.progressActing": "بيستخدم تطبيق على الجهاز ده…",
  "status.computerUse.progressDeciding": "بيقرر الخطوة الجاية في التطبيق…",
} as const satisfies PartialTranslation<typeof source>;
