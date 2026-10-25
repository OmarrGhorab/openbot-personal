import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/messaging";

export const messages = {
  "messaging.help.invalid_token":
    "Slack مبقاش بيقبل OpenBot في مساحة العمل دي. ممكن يكون اتشال. اربط مساحة العمل تاني.",
  "messaging.help.secret_storage_unavailable":
    "OpenBot مش قادر يقرا التوكنات المحفوظة على الكمبيوتر ده. افصل مساحة العمل وبعدين اربطها تاني.",
  "messaging.help.relay_unavailable":
    "OpenBot مش قادر يستقبل أحداث Slack على الكمبيوتر ده. سجّل دخول، وسمّي الكمبيوتر ده في إعدادات السيرفر، وسيب OpenBot مفتوح.",
  "messaging.discordHelp.invalid_token":
    "Discord مبقاش بيقبل OpenBot في سيرفر Discord ده. ممكن يكون اتشال. اربط سيرفر Discord تاني.",
  "messaging.discordHelp.secret_storage_unavailable":
    "OpenBot مش قادر يقرا التوكنات المحفوظة على الكمبيوتر ده. افصل سيرفر Discord وبعدين اربطه تاني.",
  "messaging.discordHelp.relay_unavailable":
    "OpenBot مش قادر يستقبل أحداث Discord على الكمبيوتر ده. سجّل دخول، وسمّي الكمبيوتر ده في إعدادات السيرفر، وسيب OpenBot مفتوح.",
} as const satisfies PartialTranslation<typeof source>;
