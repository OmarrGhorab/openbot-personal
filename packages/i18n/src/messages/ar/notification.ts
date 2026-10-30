import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/notification";

export const messages = {
  "notification.needsInput": "محتاج رد منك.",
  "notification.needsApproval": "محتاج موافقتك.",
  "notification.needsBrowserStep": "محتاجك تكمّل خطوة في المتصفح.",
  "notification.needsApprovalFor": "محتاج موافقتك: {action}",
  "notification.finished": "خلّص الشغل.",
  "notification.failed": "وقف بسبب خطأ.",
  "notification.channelTitle": "{agent} في {channel}",
  "notification.workThreadTitle": "{agent}، مهمة: {thread}",
  "notification.channelMessage": "بعت رسالة.",
  "notification.usageLimit.title": "حساب {provider} وصل للحد الأقصى",
  "notification.usageLimit.body": {
    one: "{count} إيجنت مستني. OpenBot هيحاول تاني بعدين.",
    other: "{count} إيجنت مستنيين. OpenBot هيحاول تاني بعدين.",
  },
  "notification.usageLimit.bodyResets": {
    one: "{count} إيجنت مستني. بيتجدد {reset}.",
    other: "{count} إيجنت مستنيين. بيتجدد {reset}.",
  },
  "notification.test": "الإشعارات شغالة.",
  "notification.welcome": "OpenBot هيقولك هنا لما إيجنت يحتاجك.",
  "notification.toast.region": "الإشعارات",
  "notification.toast.close": "إغلاق الإشعار",
  "notification.ticketMerged.title": "{ticket} اتدمجت",
  "notification.ticketMerged.body": "الـ Reviewer دمج PR #{number}.",
  "notification.ticketMerged.bodyNoPullRequest": "الـ Reviewer دمجها.",
  "notification.ticketMerged.pass": "PASS",
  "notification.ticketMerged.passWithNotes": "PASS مع ملاحظات",
  "notification.ticketMerged.quality": "الجودة {score}/10",
  "notification.ticketMerged.ciGreen": "الـ CI أخضر",
  "notification.ticketMerged.viewTicket": "افتح التيكت",
  "notification.ticketMerged.viewPullRequest": "افتح الـ PR",
  "notification.ticketMerged.openFailed": "مقدرناش نفتح الـ PR.",
} as const satisfies PartialTranslation<typeof source>;
