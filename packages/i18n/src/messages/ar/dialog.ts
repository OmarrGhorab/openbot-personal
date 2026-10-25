import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/dialog";

export const messages = {
  "dialog.chooseSiteDirectory": "اختار فولدر موقع ثابت",
  "dialog.chooseSkill": "اختار فولدر مهارة أو ملف ZIP",
  "dialog.filter.skillPackages": "حزم المهارات",
  "dialog.filter.images": "الصور",
  "dialog.filter.supportedFiles": "الملفات المدعومة",
  "dialog.filter.attachment": "المرفق",
  "dialog.filter.zipArchive": "أرشيف ZIP",
  "dialog.filter.jsonDocument": "مستند JSON",
  "dialog.chooseAgentExport": "اختار ملف تصدير إيجنت",
  "dialog.chooseHermesFolder": "اختار فولدر Hermes",
  "dialog.filter.agentExports": "ملفات تصدير الإيجنت",
  "dialog.chooseVaultCsv": "اختار ملف تصدير كلمات المرور",
  "dialog.filter.csv": "ملفات CSV",
  "dialog.saveExportSkill": "احفظ مهارة التصدير",
  "dialog.saveTransfer": "احفظ ملف النقل",
  "dialog.chooseTransfer": "اختار ملف نقل",
  "dialog.filter.transfer": "ملفات نقل OpenBot",
} as const satisfies PartialTranslation<typeof source>;
