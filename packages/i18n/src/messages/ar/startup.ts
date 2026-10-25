import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "OpenBot معرفش يشتغل",
  "startup.failedBody":
    "{message}\n\nبياناتك المحلية ماتمسحتش ومااتكتبش عليها. شوف دليل حل المشاكل علشان تعرف خطوات الاسترجاع.",
} as const satisfies PartialTranslation<typeof source>;
