import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

export const messages = {
  "error.messaging.notConnected": "مساحة عمل Slack دي مش متصلة.",
  "error.messaging.unsupported": "الجهاز ده مش قادر يتصل بـ Slack.",
  "error.messaging.relayUnavailable":
    "OpenBot مش قادر يستقبل أحداث Slack على الجهاز ده. سجّل دخول، وسمّي الجهاز ده، وجرّب تاني.",
  "error.messaging.discordNotConnected": "سيرفر Discord ده مش متصل.",
  "error.messaging.discordUnsupported": "الجهاز ده مش قادر يتصل بـ Discord.",
  "error.messaging.discordRelayUnavailable":
    "OpenBot مش قادر يستقبل أحداث Discord على الجهاز ده. سجّل دخول، وسمّي الجهاز ده، وجرّب تاني.",
  "error.messaging.discordRolesUnsupported": "OpenBot لسه مش قادر يعرض أدوار Discord. جرّب تاني بعدين.",
  "error.messaging.telegramNotConnected": "شات Telegram ده مش متصل.",
  "error.messaging.telegramUnsupported": "الجهاز ده مش قادر يتصل بـ Telegram.",
  "error.messaging.telegramRelayUnavailable":
    "OpenBot مش قادر يوصل لـ Telegram على الجهاز ده. سجّل دخول، وسمّي الجهاز ده، وجرّب تاني.",
  "error.messaging.telegramServiceUnavailable": "OpenBot مش قادر يوصّل Telegram دلوقتي. جرّب تاني بعدين.",
  "error.messaging.memoryLimit": "مساحة العمل المتصلة تقدر يكون فيها {limit} ذكرى على الأكتر. امسح واحدة الأول.",
} as const satisfies PartialTranslation<typeof source>;
