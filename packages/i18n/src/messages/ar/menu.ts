import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/menu";

export const messages = {
  "menu.stopAllAgents": "وقف كل الإيجنتات",
  "menu.checkForUpdates": "التحقق من التحديثات…",
  "menu.preferences": "الإعدادات…",
  "menu.actualSize": "الحجم الفعلي",
  "menu.zoomIn": "تكبير",
  "menu.zoomOut": "تصغير",
  "menu.copyLink": "نسخ الرابط",
  "menu.trayOpen": "فتح OpenBot",
  "menu.trayQuit": "إنهاء OpenBot",
  "menu.trayTooltip": "OpenBot",
} as const satisfies PartialTranslation<typeof source>;
