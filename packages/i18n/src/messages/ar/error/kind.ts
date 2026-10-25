import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/kind";

export const messages = {
  "error.kind.network": "معرفتش أتصل. اتأكد من اتصالك وجرّب تاني.",
  "error.kind.timeout": "الطلب خد وقت طويل أوي. اتأكد إن الإجراء كمل قبل ما تجرّب تاني.",
  "error.kind.storage": "مفيش مساحة تخزين كفاية. فضّي مساحة على الجهاز اللي شغّال عليه OpenBot، وبعدين جرّب تاني.",
  "error.kind.filePermission": "OpenBot معندوش إذن يكمّل الإجراء ده. اتأكد من أذونات الملف أو الفولدر، وبعدين جرّب تاني.",
  "error.kind.notFound": "ملف أو فولدر مطلوب مش موجود. رجّعه أو اختار حاجة تانية، وبعدين جرّب تاني.",
  "error.kind.readOnly": "الفولدر ده للقراءة بس. اختار فولدر تقدر تكتب فيه، وبعدين جرّب تاني.",
  "error.kind.conflict": "فيه عنصر بنفس الاسم ده موجود بالفعل. اختار اسم تاني، وبعدين جرّب تاني.",
  "error.kind.auth": "المصادقة فشلت. اتأكد من حسابك أو اتصال السيرفر، وبعدين جرّب تاني.",
  "error.kind.permission": "معندكش إذن تكمّل الإجراء ده. اطلب الصلاحية من المالك.",
  "error.kind.rateLimit": "طلبات كتير أوي. استنى شوية، وبعدين جرّب تاني.",
  "error.kind.service": "الخدمة مش متاحة. استنى شوية، وبعدين جرّب تاني.",
} as const satisfies PartialTranslation<typeof source>;
