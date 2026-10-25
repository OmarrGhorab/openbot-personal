import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/marketplace";

export const messages = {
  "error.marketplace.timezoneInvalid": "المنطقة الزمنية المحلية مش صالحة.",
  "error.marketplace.installedAgentMissing": "الإيجنت المثبّت مبقاش موجود.",
  "error.marketplace.differentListing": "الإيجنت المحلي ده اتثبّت من إيجنت تاني في السوق.",
  "error.marketplace.marketplaceAvatarInvalid": "صورة إيجنت السوق مش صالحة.",
  "error.marketplace.shareCardInvalid": "كارت المشاركة مش صالح.",
  "error.marketplace.cannotPublish": "الإيجنت ده مينفعش يتنشر.",
  "error.marketplace.templateName": {
    one: "اكتب للإيجنت ده اسم من 1 لـ {count} حرف.",
    other: "اكتب للإيجنت ده اسم من 1 لـ {count} حرف.",
  },
  "error.marketplace.templateRole": {
    one: "الدور أطول من {count} حرف. قصّره.",
    other: "الدور أطول من {count} حرف. قصّره.",
  },
  "error.marketplace.templateNoInstructions": "ضيف تعليمات للإيجنت ده قبل ما تنشره.",
  "error.marketplace.templateInstructions": {
    one: "التعليمات أطول من {count} حرف. قصّرها.",
    other: "التعليمات أطول من {count} حرف. قصّرها.",
  },
  "error.marketplace.templateAvatar": "صورة الإيجنت ده مش صالحة. اختارها تاني من إعدادات الإيجنت.",
  "error.marketplace.templateSkills": {
    one: "الإيجنت يقدر ينشر لحد {count} مهارة. شيل شوية منها.",
    other: "الإيجنت يقدر ينشر لحد {count} مهارة. شيل شوية منها.",
  },
  "error.marketplace.templateLocalSkills": {
    one: "الإيجنت يقدر ينشر لحد {count} مهارة محلية. شيل شوية منها.",
    other: "الإيجنت يقدر ينشر لحد {count} مهارة محلية. شيل شوية منها.",
  },
  "error.marketplace.templateSkill": "المهارة «{name}» مينفعش تتنشر. راجع اسمها وملف SKILL.md بتاعها.",
  "error.marketplace.templateRoutines": {
    one: "الإيجنت يقدر ينشر لحد {count} روتين. شيل شوية منها.",
    other: "الإيجنت يقدر ينشر لحد {count} روتين. شيل شوية منها.",
  },
  "error.marketplace.templateRoutine": {
    one: "الروتين «{name}» محتاج اسم لحد {count} حرف وتعليمات.",
    other: "الروتين «{name}» محتاج اسم لحد {count} حرف وتعليمات.",
  },
  "error.marketplace.templateRoutineNoName": "من غير اسم",
  "error.marketplace.templateTooLarge":
    "الإيجنت ده كبير أوي ومينفعش يتنشر. قصّر التعليمات أو المهارات أو الروتينات بتاعته.",
  "error.marketplace.linkInvalid": "رابط الإيجنت مش صالح.",
  "error.marketplace.changedSinceOpened": "الإيجنت ده اتغيّر بعد ما فتحته. افتح الرابط تاني علشان تراجع النسخة الجديدة.",
  "error.marketplace.skillNameConflict":
    "عندك بالفعل مهارة محلية مختلفة اسمها «{name}». غيّر اسمها أو امسحها، وبعدين ضيف الإيجنت ده تاني.",
  "error.marketplace.avatarInvalid": "صورة الإيجنت مش صالحة.",
  "error.marketplace.secretInName": "شيل السرّ أو الإيميل من الاسم قبل ما تنشر.",
  "error.marketplace.secretInTitle": "شيل السرّ أو الإيميل من العنوان قبل ما تنشر.",
  "error.marketplace.secretInInstructions": "شيل السرّ أو الإيميل من التعليمات قبل ما تنشر.",
  "error.marketplace.secretInRoutine": "شيل السرّ أو الإيميل من الروتين «{name}» قبل ما تنشر.",
  "error.marketplace.secretInSkill": "شيل السرّ أو الإيميل من المهارة «{name}» قبل ما تنشر.",
  "error.marketplace.catalogLoadFailed": "السوق معرفش يتحمّل. جرّب تاني.",
  "error.marketplace.templateUnreadable": "الإيجنت المشترك ده مش ممكن يتقري. ممكن مالكه يكون شاله.",
} as const satisfies PartialTranslation<typeof source>;
