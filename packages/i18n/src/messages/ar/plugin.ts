import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/plugin";

export const messages = {
  "plugin.link.website": "الموقع",
  "plugin.link.privacyPolicy": "سياسة الخصوصية",
  "plugin.link.terms": "شروط الخدمة",
  "plugin.copyLink": "نسخ الرابط",
  "plugin.askPrompt": "اسأل {name}: {prompt}",
  "plugin.section.skills": "المهارات",
  "plugin.section.information": "معلومات",
  "plugin.info.developer": "المطوّر",
  "plugin.info.category": "الفئة",
  "plugin.info.version": "الإصدار",
  "plugin.uninstallDialog.title": "تفصل {name}؟",
  "plugin.uninstallDialog.description":
    "ده هيشيل اللي {name} نصّبه على الكمبيوتر ده. مفيش حاجة تانية على الجهاز المضيف ده أو على الإيجنت ده هتتغير.",
  "plugin.uninstallDialog.confirm": "فصل",
  "plugin.uninstallDialog.appsLabel": "التطبيقات اللي هتتشال، {number}",
  "plugin.uninstallDialog.appsTitle": "التطبيقات اللي اتشالت من الجهاز المضيف ده",
  "plugin.uninstallDialog.appsNote": "أدواتها هتبطّل تكون متاحة، وأي تسجيل دخول OpenBot حافظه ليها هيتنسي.",
  "plugin.uninstallDialog.skillsLabel": "المهارات اللي هتتشال، {number}",
  "plugin.uninstallDialog.skillsTitle": "المهارات اللي اتشالت من {agentName}",
} as const satisfies PartialTranslation<typeof source>;
