import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/site";

export const messages = {
  "error.site.absolutePath": "اختار مسار مطلق لفولدر الموقع.",
  "error.site.rootSymlink": "الروابط الرمزية مش مسموحة في المواقع المستضافة.",
  "error.site.notDirectory": "مصدر الموقع لازم يكون فولدر.",
  "error.site.outsideWorkspace": "الموقع لازم يكون جوه مساحة عمل الإيجنت ده أو OpenBot Shared.",
  "error.site.packageJsonInvalid": "ملف package.json بتاع الموقع مش صالح.",
  "error.site.astroServerOutput": "Astro لازم يستخدم مخرجات static.",
  "error.site.astroAdapter": "adapters السيرفر وتكامل React في Astro مش مسموحة.",
  "error.site.astroApiRoutes": "مسارات API وserver actions في Astro مش مسموحة.",
  "error.site.astroMiddleware": "الـ middleware وكود السيرفر في Astro مش مسموحين.",
  "error.site.astroNotBuilt": "ابني مشروع Astro الأول. فولدر dist/ الموجود بتاعه مطلوب.",
  "error.site.astroDistNotDirectory": "فولدر dist/ بتاع Astro لازم يكون فولدر حقيقي.",
  "error.site.astroDistOutside": "فولدر dist/ بتاع Astro لازم يفضل جوه فولدر المشروع.",
  "error.site.directoryOutsideRoot": "فولدرات الموقع لازم تفضل جوه جذر المصدر.",
  "error.site.siteTooLarge": "الموقع أكبر من حد 2 MB.",
  "error.site.missingIndex": "جذر الموقع لازم يحتوي على index.html.",
  "error.site.symlink": "الروابط الرمزية مش مسموحة: {name}",
  "error.site.unsupportedEntry": "عنصر موقع مش مدعوم: {name}",
  "error.site.tooManyFiles": "الموقع يقدر يحتوي على {limit} ملف على الأكتر.",
  "error.site.hiddenFile": "الملفات المخفية مش مسموحة: {path}",
  "error.site.unsafePath": "مسار الملف ده مش مسموح: {path}",
  "error.site.secretFile": "بيانات الاعتماد والمفاتيح الخاصة وكود السيرفر مش مسموحين: {path}",
  "error.site.fileType": "نوع الملف ده مش مسموح: {path}",
  "error.site.fileOutsideRoot": "ملفات الموقع لازم تفضل جوه جذر المصدر: {path}",
  "error.site.fileTooLarge": "فيه ملف أكبر من حد 1 MB: {path}",
} as const satisfies PartialTranslation<typeof source>;
