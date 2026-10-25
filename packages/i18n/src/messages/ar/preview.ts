import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/preview";

export const messages = {
  "preview.panel.label": "معاينة الملف",
  "preview.panel.resize": "تغيير حجم معاينة الملف",
  "preview.panel.copy": "نسخ نص الملف",
  "preview.panel.openExternally": "فتح الملف خارج التطبيق",
  "preview.panel.download": "تحميل الملف",
  "preview.panel.reveal": "إظهار الملف في Finder",
  "preview.panel.close": "إغلاق معاينة الملف",
  "preview.panel.back": "رجوع",
  "preview.panel.rawMarkdown": "عرض مصدر Markdown",
  "preview.panel.rawHtml": "عرض مصدر HTML",
  "preview.panel.wrapLines": "التفاف الأسطر الطويلة",
  "preview.folder.empty": "الفولدر ده فاضي.",
  "preview.folder.truncated": "بنعرض أول {limit} عنصر بس.",
  "preview.truncated": "المعاينة اتقطعت بعد {limit} حرف.",
  "preview.unavailable": "المعاينة مش متاحة.",
  "preview.unsupported.title": "المعاينة مش متاحة",
  "preview.unsupported.description": "نوع الملف ده ممكن يتفتح في التطبيق الافتراضي بتاعه.",
  "preview.unsupported.openExternally": "فتح خارجيًا",
  "preview.spreadsheet.readFailed": "معرفناش نقرا الجدول ده.",
  "preview.spreadsheet.truncated": "المعاينة محدودة بأول {rows} صف و{columns} عمود.",
} as const satisfies PartialTranslation<typeof source>;
