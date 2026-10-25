import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/mcp";

export const messages = {
  "error.mcp.redirectByName": "العنوان ده مش ممكن الوصول له بالاسم.",
  "error.mcp.redirectGetOnly": "العنوان ده بيردّ على GET بس.",
  "error.mcp.redirectNotSignIn": "العنوان ده مش جزء من تسجيل دخول.",
  "error.mcp.redirectRefused": "تسجيل الدخول اترفض. ارجع لـ OpenBot وجرّب تاني.",
  "error.mcp.redirectNoSignIn": "مفيش تسجيل دخول مستني ده. ممكن يكون خلص.",
  "error.mcp.redirectSignedIn": "OpenBot مسجّل دخول. تقدر تقفل النافذة دي.",
  "error.mcp.signInFileUnreadable": "ملف تسجيل دخول MCP مش ممكن يتقري.",
  "error.mcp.signInFileTooLarge": "ملف تسجيل دخول MCP كبير أوي.",
  "error.mcp.unsupported": "سيرفرات MCP مش مدعومة في السيرفر ده.",
  "error.mcp.signInOnHost": "تسجيل الدخول لسيرفر MCP بيشتغل بس في OpenBot على الجهاز المضيف.",
  "error.mcp.signInAppUnsupported": "السيرفر ده مبيدعمش تطبيقات تسجيل الدخول. حدّث OpenBot على الجهاز المضيف.",
  "error.mcp.redirectRelayed": "OpenBot بعت تسجيل الدخول للسيرفر. تقدر تقفل النافذة دي.",
  "error.mcp.relayEnded": "تسجيل الدخول ده خلص. ابدأه تاني.",
  "error.mcp.relayNoState":
    "صفحة تسجيل الدخول بتاعة السيرفر مبتحميش عنوان الرجوع بتاعها، فـ OpenBot مش هيفتحها على الجهاز ده.",
  "error.mcp.relayAddressInvalid": "ده مش العنوان اللي في آخر تسجيل الدخول ده. انسخ العنوان الكامل من المتصفح.",
} as const satisfies PartialTranslation<typeof source>;
