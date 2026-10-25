import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/queue";

export const messages = {
  "queue.label": "طابور الرسائل",
  "queue.moved": "الرسالة اتنقلت لمكان {position} من {total}.",
  "queue.attachment": "مرفق",
  "queue.hold.named": "مستني - {name} شغال في {channel}",
  "queue.hold.unnamed": "مستني - الإيجنت ده شغال في {channel}",
  "queue.item.label": "رسالة في الطابور {position}: {preview}",
  "queue.item.labelEditing": "رسالة في الطابور {position}، بتتعدل: {preview}",
  "queue.item.editing": "بتتعدل",
  "queue.item.steerLabel": "توجيه رسالة الطابور {position}",
  "queue.item.steerTooltip": "توجيه الرسالة",
  "queue.item.steering": "جارٍ التوجيه",
  "queue.item.steer": "وجّه",
  "queue.item.notSteered": "ماتوجّهتش",
  "queue.item.steerFallback.providerUnsupported": "المزوّد ده مبيقدرش يوجّه دور شغال، فالرسالة مستنية في الطابور.",
  "queue.item.steerFallback.steerFailed": "التوجيه مانجحش، فالرسالة مستنية في الطابور.",
  "queue.item.runAsTask": "شغّلها كمهمة",
  "queue.item.runAsTaskLabel": "شغّل رسالة الطابور {position} كمهمة",
  "queue.item.deleteLabel": "حذف رسالة الطابور {position}",
  "queue.item.deleteTooltip": "حذف الرسالة",
  "queue.item.editLabel": "تعديل رسالة الطابور {position}",
  "queue.item.editTooltip": "تعديل الرسالة",
  "queue.deleteHeld.title": "تحذف الرسالة من الطابور؟",
  "queue.deleteHeld.body": "جهاز تاني بيعدّل الرسالة دي. الإيجنت مش هيستلمها.",
  "queue.deleteHeld.keep": "سيبها",
} as const satisfies PartialTranslation<typeof source>;
