import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/sharedTable";

export const messages = {
  "sharedTable.title": "الجداول",
  "sharedTable.description": "اللي الإيجنتات بتحتفظ بيه بين المهام، مع الإيجنت اللي بدأ كل مجموعة سجلات",
  "sharedTable.close": "إغلاق الجداول",
  "sharedTable.loading": "جارٍ تحميل الجداول…",
  "sharedTable.empty":
    "مفيش جداول لسه. الإيجنت بيعمل جدول بنفسه لما المهمة تحتاج سجلات بين الأدوار، وكل إيجنت يقدر يستخدمه.",
  "sharedTable.loadFailed": "معرفتش أحمّل الجداول.",
  "sharedTable.deleteFailed": "معرفتش أحذف ده.",
  "sharedTable.madeOutside": "اتعمل برّه OpenBot · أي إيجنت يقدر يحذفه",
  "sharedTable.keptBy": "محتفظ بيه {name}",
  "sharedTable.keptByDeleted": "محتفظ بيه إيجنت مبقاش موجود",
  "sharedTable.deleteName": "حذف {name}",
  "sharedTable.confirmDelete": "تحذف ده لكل الإيجنتات؟ السجلات مش هتترجع.",
  "sharedTable.notCounted": "مش محسوب",
  "sharedTable.records": { one: "{count} سجل", other: "{count} سجل" },
} as const satisfies PartialTranslation<typeof source>;
