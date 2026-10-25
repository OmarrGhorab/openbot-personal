import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/billing";

export const messages = {
  "error.billing.lifecycleFailed": "باقة السيرفر معرفتش تتغيّر. حدّث الفواتير وجرّب تاني.",
  "error.billing.confirmMismatch": "اكتب اسم السيرفر علشان تمسحه.",
  "error.billing.restartBusy": "السيرفر مش قادر يعمل restart دلوقتي. جرّب تاني بعد دقيقة.",
  "error.billing.planRequired": "باقة السيرفر ده خلصت. جدّدها علشان السيرفر يشتغل.",
  "error.billing.planSoldOut": "الباقة دي خلصت الكمية. اختار باقة تانية.",
  "error.billing.licenseExists": "الحساب ده عنده رخصة بالفعل. غيّر المستخدمين فيها بدل كده.",
  "error.billing.licenseCurrency": "الرخصة لازم تستخدم عملة باقاتك التانية.",
  "error.billing.licenseUsersInUse": "الرخصة مينفعش يكون فيها مستخدمين أقل من الناس اللي بيستخدموها دلوقتي.",
  "error.billing.licensePaymentFailed": "الدفع للمستخدمين المضافين فشل. حدّث طريقة الدفع وجرّب تاني.",
  "error.billing.licenseUnavailable": "الرخص مش متاحة دلوقتي.",
  "error.billing.noLicense": "الحساب ده مفيهوش رخصة.",
  "error.billing.invalidRequest": "طلب الفواتير مش صالح.",
  "error.billing.invalidResponse": "ردّ الفواتير مش صالح.",
  "error.billing.notStripePage": "صفحة الفواتير مش صفحة Stripe.",
} as const satisfies PartialTranslation<typeof source>;
